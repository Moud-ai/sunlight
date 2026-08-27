/**
 * Harness bridge — run coding agents (Hermes, Pi) inside the Sunlight VM.
 *
 * Agents execute inside the Alpine guest. JS drives the VM's serial console:
 * it writes a scripted command followed by a `VM_DONE_$?` sentinel and polls
 * the console until the sentinel appears (or a timeout elapses). The guest
 * console is owned by the VmModule (QEMU `-serial stdio`).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {clearVmConsole, isVmRunning, pollVmConsole, writeVmConsole} from './vm';

export type HarnessId = 'hermes' | 'pi';

export interface HarnessDefinition {
  id: HarnessId;
  label: string;
  description: string;
  /** Command that prints the agent's version; empty output means not installed. */
  checkCmd: string;
  /** POSIX script run in the guest to install the agent. */
  installCmd: string;
  /** Command that launches the agent in the guest. */
  launchCmd: string;
}

export interface HarnessOverride {
  installCmd?: string;
  checkCmd?: string;
  launchCmd?: string;
}

export const HARNESS_IDS: HarnessId[] = ['hermes', 'pi'];

export const DEFAULT_HARNESSES: Record<HarnessId, HarnessDefinition> = {
  hermes: {
    id: 'hermes',
    label: 'Hermes Agent',
    description: 'Streaming coding agent powered by a local GGUF model.',
    checkCmd: 'hermes --version 2>/dev/null',
    installCmd: [
      'apk add --no-cache python3 py3-pip git build-base 2>/dev/null',
      'pip install --break-system-packages --quiet hermes-agent 2>/dev/null || pip install --quiet hermes-agent',
    ].join('\n'),
    launchCmd: 'hermes',
  },
  pi: {
    id: 'pi',
    label: 'Pi coding agent',
    description: 'Lightweight terminal coding agent for the VM shell.',
    checkCmd: 'pi --version 2>/dev/null || which pi',
    installCmd: [
      'apk add --no-cache python3 py3-pip git 2>/dev/null',
      'pip install --break-system-packages --quiet pi-agent 2>/dev/null || pip install --quiet pi-agent',
    ].join('\n'),
    launchCmd: 'pi',
  },
};

export function harnessStorageKey(id: HarnessId): string {
  return `@sunlight_harness_${id}`;
}

export interface ResolvedHarness extends HarnessDefinition {
  override: HarnessOverride | null;
}

/** Merges persisted overrides onto the default definition for a harness id. */
export function mergeHarnessDefaults(
  id: HarnessId,
  override: HarnessOverride | null,
): ResolvedHarness {
  const def = DEFAULT_HARNESSES[id];
  return {
    ...def,
    installCmd: override?.installCmd?.trim() ? override.installCmd : def.installCmd,
    checkCmd: override?.checkCmd?.trim() ? override.checkCmd : def.checkCmd,
    launchCmd: override?.launchCmd?.trim() ? override.launchCmd : def.launchCmd,
    override,
  };
}

export async function loadEffectiveHarness(id: HarnessId): Promise<ResolvedHarness> {
  let override: HarnessOverride | null = null;
  try {
    const raw = await AsyncStorage.getItem(harnessStorageKey(id));
    if (raw) {
      const parsed = JSON.parse(raw) as HarnessOverride;
      override =
        typeof parsed === 'object' && parsed !== null
          ? {
              installCmd: typeof parsed.installCmd === 'string' ? parsed.installCmd : undefined,
              checkCmd: typeof parsed.checkCmd === 'string' ? parsed.checkCmd : undefined,
              launchCmd: typeof parsed.launchCmd === 'string' ? parsed.launchCmd : undefined,
            }
          : null;
    }
  } catch {
    override = null;
  }
  return mergeHarnessDefaults(id, override);
}

export async function saveHarnessOverride(
  id: HarnessId,
  override: HarnessOverride,
): Promise<void> {
  await AsyncStorage.setItem(harnessStorageKey(id), JSON.stringify(override));
}

export async function clearHarnessOverride(id: HarnessId): Promise<void> {
  await AsyncStorage.removeItem(harnessStorageKey(id));
}

export function parseVersionOutput(output: string): {installed: boolean; version?: string} {
  const text = output.trim();
  if (!text) {
    return {installed: false};
  }
  const match = text.match(/([\d]+(?:\.[\d]+){1,3}(?:[-.][A-Za-z0-9]+)?)/);
  return {installed: true, version: match?.[1]};
}

/** Thrown when the VM is not running — agents can only execute inside it. */
export class HarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HarnessError';
  }
}

const DONE_MARKER = 'VM_DONE_';

/**
 * Runs [script] in the guest over the serial console and resolves once the
 * sentinel `VM_DONE_<exitcode>` appears (or a timeout elapses). Returns the
 * guest output (sentinel line stripped) plus the exit code when detected.
 */
export async function runInVm(
  script: string,
  opts: {timeoutMs?: number; onOutput?: (chunk: string) => void} = {},
): Promise<{output: string; code: number | null; timedOut: boolean}> {
  if (!(await isVmRunning())) {
    throw new HarnessError('start the VM first — agents run inside it');
  }
  const timeoutMs = opts.timeoutMs ?? 120_000;
  await clearVmConsole();
  const wrapped = `{ ${script}; } 2>&1; echo ${DONE_MARKER}$?`;
  await writeVmConsole(`\n${wrapped}\n`);

  const started = Date.now();
  let output = '';
  let timedOut = false;
  while (Date.now() - started < timeoutMs) {
    const chunk = await pollVmConsole();
    if (chunk) {
      output += chunk;
      opts.onOutput?.(chunk);
      const idx = output.lastIndexOf(DONE_MARKER);
      if (idx >= 0) {
        const tail = output.slice(idx + DONE_MARKER.length);
        const codeMatch = tail.match(/^(\d+)/);
        const code = codeMatch ? parseInt(codeMatch[1], 10) : null;
        return {output: stripPrompt(output), code, timedOut: false};
      }
    }
    await new Promise<void>(resolve => setTimeout(resolve, 150));
  }
  timedOut = true;
  return {output: stripPrompt(output), code: null, timedOut};
}

function stripPrompt(output: string): string {
  return output
    .replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/sunlight:[^\n#]*#\s*/g, '')
    .trim();
}

export async function checkInstalled(id: HarnessId): Promise<{
  kind: 'checking' | 'vm_missing' | 'not_installed' | 'installed';
  version?: string;
  output?: string;
}> {
  if (!(await isVmRunning())) {
    return {kind: 'vm_missing'};
  }
  const effective = await loadEffectiveHarness(id);
  try {
    const {output, code} = await runInVm(effective.checkCmd, {timeoutMs: 30_000});
    const parsed = parseVersionOutput(output);
    return code === 0 && parsed.installed
      ? {kind: 'installed', version: parsed.version, output}
      : {kind: 'not_installed', output};
  } catch (e) {
    return {kind: 'vm_missing', output: e instanceof Error ? e.message : undefined};
  }
}

/** Installs the agent inside the guest, streaming output via onOutput. */
export async function installHarness(
  id: HarnessId,
  onOutput?: (chunk: string) => void,
): Promise<{ok: boolean; output: string; code: number | null}> {
  const effective = await loadEffectiveHarness(id);
  const {output, code, timedOut} = await runInVm(effective.installCmd, {
    timeoutMs: 300_000,
    onOutput,
  });
  return {ok: !timedOut && (code === 0 || code === null), output, code};
}

/** Launches the agent inside the guest (interactive; returns immediately). */
export async function launchHarness(id: HarnessId): Promise<void> {
  const effective = await loadEffectiveHarness(id);
  await writeVmConsole(`\n${effective.launchCmd}\n`);
}