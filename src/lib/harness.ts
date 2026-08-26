/**
 * Harness bridge — run coding agents (Hermes, Pi) inside Termux.
 *
 * Execution path: JS builds a `bash -c` script that redirects output into a
 * shared file under /sdcard/Download, then fires Termux's RUN_COMMAND intent
 * through the native SunlightHarness module. JS polls the output file until
 * the `done` sentinel line appears (or the deadline expires).
 *
 * Per-harness configuration (command, extra args, working directory,
 * install command) is user-editable and persisted in AsyncStorage under
 * '@sunlight_harness_<id>'; defaults are merged on load.
 *
 * There is deliberately NO API-key injection: users enter their own keys
 * wherever they want (inside the Termux session or the raw terminal).
 */
import {NativeEventEmitter, NativeModules} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';


export type HarnessId = 'hermes' | 'pi';

export interface HarnessDefinition {
  label: string;
  installCmd: string;
  versionCmd: string;
  launchCmd: string;
}

/** User-editable per-harness overrides persisted in AsyncStorage. */
export interface HarnessOverride {
  /** Binary handed to RUN_COMMAND_PATH (default: Termux bash). */
  command?: string;
  /** Extra flags placed before `-c` (e.g. ['-l'] for a login shell). */
  args?: string[];
  workdir?: string;
  installCmd?: string;
}

/** Defaults merged with persisted overrides — the resolved runtime shape. */
export interface ResolvedHarness {
  id: HarnessId;
  label: string;
  installCmd: string;
  versionCmd: string;
  launchCmd: string;
  command: string;
  args: string[];
  workdir: string | null;
}

export interface InstallCheck {
  installed: boolean;
  version?: string;
}

export type HarnessErrorCode =
  | 'module_missing'
  | 'termux_missing'
  | 'run_command_failed'
  | 'timeout'
  | 'storage_read_failed';

export class HarnessError extends Error {
  readonly code: HarnessErrorCode;

  constructor(code: HarnessErrorCode, message: string) {
    super(message);
    this.name = 'HarnessError';
    this.code = code;
  }
}


/** Shared capture file both Sunlight and Termux can read/write. */
export const HARNESS_OUT_FILE = '/sdcard/Download/sunlight_harness_out.txt';

/** Last line appended to the capture file when the wrapped script finishes. */
export const HARNESS_SENTINEL = 'done';

export const TERMUX_PACKAGE = 'com.termux';

export const DEFAULT_TERMUX_BASH =
  '/data/data/com.termux/files/usr/bin/bash';

/** One-liner the user must append to Termux's termux.properties. */
export const ALLOW_EXTERNAL_APPS_CMD =
  "printf 'allow-external-apps=true\\n' >> ~/.termux/termux.properties && termux-reload-settings";

export const F_DROID_TERMUX_URL =
  'https://f-droid.org/en/packages/com.termux/';

/** Status/version probe budget. */
export const VERSION_TIMEOUT_MS = 20_000;

/** Install ops download + compile; give them room. */
export const INSTALL_TIMEOUT_MS = 10 * 60_000;

export const POLL_INTERVAL_MS = 500;

export const HARNESS_IDS: readonly HarnessId[] = ['hermes', 'pi'];

export const DEFAULT_HARNESSES: Record<HarnessId, HarnessDefinition> = {
  hermes: {
    label: 'Hermes Agent',
    // ANDROID_API_LEVEL is required by Termux's python build env when maturin/
    // jiter wheels compile from source during the Hermes install (official
    // Termux troubleshooting); getprop is always available on-device.
    installCmd:
      'export ANDROID_API_LEVEL=$(getprop ro.build.version.sdk); ' +
      'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash',
    versionCmd: 'hermes --version',
    launchCmd: 'hermes',
  },
  pi: {
    label: 'Pi coding agent',
    installCmd:
      'pkg install -y nodejs-lts && curl -fsSL https://pi.dev/install.sh | sh',
    versionCmd: 'pi --version',
    launchCmd: 'pi',
  },
};


/**
 * Merges a harness definition with its persisted overrides. Pure so tests can
 * pin the merge semantics (override wins per-field, everything else default).
 */
export function mergeHarnessDefaults(
  id: HarnessId,
  override: HarnessOverride | null,
): ResolvedHarness {
  const def = DEFAULT_HARNESSES[id];
  return {
    id,
    label: def.label,
    versionCmd: def.versionCmd,
    launchCmd: def.launchCmd,
    command: override?.command?.trim() ? override.command : DEFAULT_TERMUX_BASH,
    args: Array.isArray(override?.args) ? override.args : ['-l'],
    workdir: override?.workdir?.trim() ? override.workdir : null,
    installCmd: override?.installCmd?.trim()
      ? override.installCmd
      : def.installCmd,
  };
}

/**
 * Wraps a shell command into a script that truncates the shared capture file,
 * appends stdout+stderr, and finishes with the sentinel line.
 */
export function buildCaptureScript(cmd: string): string {
  return (
    `: > "${HARNESS_OUT_FILE}" 2>/dev/null` +
    `; { ${cmd} ; } 2>&1 | tee "${HARNESS_OUT_FILE}"` +
    `; echo ${HARNESS_SENTINEL}`
  );
}

/**
 * Final RUN_COMMAND_ARGUMENTS: user's extra flags first, then the `-c`
 * wrapper. Custom flags never displace the wrapper, so output capture and
 * sentinel polling keep working regardless of configuration.
 */
export function buildRunArgs(
  resolved: ResolvedHarness,
  script: string,
): string[] {
  return [...resolved.args, '-c', script];
}

/**
 * Sentinel check over one snapshot of the capture file. Done only when the
 * last non-blank line IS the sentinel; the sentinel itself is stripped from
 * the returned output.
 */
export function extractCompletedOutput(content: string): {
  done: boolean;
  output: string;
} {
  const lines = content.split('\n');
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  if (lines.length > 0 && lines[lines.length - 1].trim() === HARNESS_SENTINEL) {
    lines.pop();
    return {done: true, output: lines.join('\n')};
  }
  return {done: false, output: content};
}

const NOT_FOUND_PATTERN =
  /command not found|no such file|not recognized|is not installed/i;

/**
 * Parses the captured output of a harness `versionCmd`. First non-empty line
 * decides: contains a dotted version number → installed with that version;
 * looks like a not-found error → not installed; anything else → installed but
 * unknown version.
 */
export function parseVersionOutput(raw: string): InstallCheck {
  const firstLine = raw
    .split('\n')
    .map(line => line.trim())
    .find(line => line.length > 0);
  if (!firstLine) {
    return {installed: false};
  }
  if (NOT_FOUND_PATTERN.test(firstLine)) {
    return {installed: false};
  }
  // Require at least one dot so stray integers don't read as versions.
  const match = firstLine.match(/(?:\d+\.)+\d+/);
  if (match) {
    return {installed: true, version: match[0]};
  }
  return {installed: true};
}


export function harnessStorageKey(id: HarnessId): string {
  return `@sunlight_harness_${id}`;
}

function sanitizeOverride(raw: unknown): HarnessOverride | null {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  return {
    command: typeof obj.command === 'string' ? obj.command : undefined,
    args: Array.isArray(obj.args)
      ? obj.args.filter((a): a is string => typeof a === 'string')
      : undefined,
    workdir: typeof obj.workdir === 'string' ? obj.workdir : undefined,
    installCmd: typeof obj.installCmd === 'string' ? obj.installCmd : undefined,
  };
}

export async function loadHarnessOverrides(
  id: HarnessId,
): Promise<HarnessOverride | null> {
  try {
    const raw = await AsyncStorage.getItem(harnessStorageKey(id));
    if (!raw) {
      return null;
    }
    return sanitizeOverride(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveHarnessOverride(
  id: HarnessId,
  override: HarnessOverride,
): Promise<void> {
  await AsyncStorage.setItem(
    harnessStorageKey(id),
    JSON.stringify(sanitizeOverride(override)),
  );
}

export async function clearHarnessOverride(id: HarnessId): Promise<void> {
  await AsyncStorage.removeItem(harnessStorageKey(id));
}

/** Defaults merged with whatever the user has configured for [id]. */
export async function loadEffectiveHarness(id: HarnessId): Promise<ResolvedHarness> {
  return mergeHarnessDefaults(id, await loadHarnessOverrides(id));
}


type SunlightHarnessNative = {
  isTermuxInstalled(): Promise<boolean>;
  hasRunCommandPermission(): Promise<boolean>;
  openAppSettings(): void;
  runInTermux(
    path: string,
    args: string[],
    workdir: string | null,
    background: boolean,
  ): Promise<void>;
  runInTermuxCapture(
    executionId: number,
    path: string,
    args: string[],
    workdir: string | null,
    background: boolean,
  ): Promise<void>;
};

/** Native module accessor; throws typed HarnessError when absent. */
export function getSunlightHarness(): SunlightHarnessNative {
  const mod = NativeModules.SunlightHarness as SunlightHarnessNative | undefined;
  if (!mod) {
    throw new HarnessError(
      'module_missing',
      'SunlightHarness native module is not available.',
    );
  }
  return mod;
}

export interface TermuxPrereqs {
  installed: boolean;
  permissionGranted: boolean;
}

/** Snapshot of both external prerequisites. Never throws. */
export async function ensureTermuxReady(): Promise<TermuxPrereqs> {
  try {
    const mod = getSunlightHarness();
    const [installed, permissionGranted] = await Promise.all([
      mod.isTermuxInstalled(),
      mod.hasRunCommandPermission(),
    ]);
    return {installed, permissionGranted};
  } catch {
    return {installed: false, permissionGranted: false};
  }
}


export interface RunCommandOpts {
  /** false opens a visible Termux session (launch); default headless true. */
  background?: boolean;
  /** When false the command runs verbatim (no redirect/sentinel wrapping). */
  capture?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
  /** Receives the latest captured text after every poll tick. */
  onProgress?: (text: string) => void;
}

/**
 * Runs [cmd] inside Termux via RUN_COMMAND, then polls the shared output
 * file until the sentinel appears, resolving with the captured text. Throws
 * HarnessError('timeout') when the deadline passes first.
 */
interface TermuxResultPayload {
  executionId: number;
  stdout?: string | null;
  stderr?: string | null;
  exitCode: number;
  err: number;
  errmsg?: string | null;
}

let resultEmitter: NativeEventEmitter | null = null;
const pendingResults = new Map<
  number,
  {
    resolve: (out: string) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

let execSeq = 0;
function nextExecutionId(): number {
  return ++execSeq;
}

function getResultEmitter(): NativeEventEmitter {
  if (!resultEmitter) {
    resultEmitter = new NativeEventEmitter(
      getSunlightHarness() as unknown as ConstructorParameters<
        typeof NativeEventEmitter
      >[0],
    );
    resultEmitter.addListener('SunlightHarnessResult', (payload: any) => {
      const p = payload as TermuxResultPayload;
      const entry = pendingResults.get(p.executionId);
      if (!entry) {
        return;
      }
      pendingResults.delete(p.executionId);
      clearTimeout(entry.timer);
      if (p.err !== -1) {
        entry.reject(
          new HarnessError(
            'run_command_failed',
            p.errmsg || `Termux reported an internal error (${p.err}).`,
          ),
        );
      } else {
        entry.resolve((p.stdout ?? '').trim());
      }
    });
  }
  return resultEmitter;
}

function waitForTermuxResult(
  executionId: number,
  timeoutMs: number,
): Promise<string> {
  getResultEmitter();
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingResults.delete(executionId)) {
        reject(
          new HarnessError(
            'timeout',
            `Timed out after ${timeoutMs}ms waiting for Termux output.`,
          ),
        );
      }
    }, timeoutMs);
    pendingResults.set(executionId, {resolve, reject, timer});
  });
}

function dropTermuxResult(executionId: number): void {
  const entry = pendingResults.get(executionId);
  if (!entry) {
    return;
  }
  pendingResults.delete(executionId);
  clearTimeout(entry.timer);
}

async function execWithCapture(
  cmd: string,
  resolved: ResolvedHarness,
  opts: RunCommandOpts & {timeoutMs: number},
): Promise<string> {
  const mod = getSunlightHarness();
  const background = opts.background ?? true;
  const executionId = nextExecutionId();

  // Register the resolver BEFORE firing so a fast result can never be missed.
  const resultPromise = waitForTermuxResult(executionId, opts.timeoutMs);

  try {
    await mod.runInTermuxCapture(
      executionId,
      resolved.command,
      buildRunArgs(resolved, buildCaptureScript(cmd)),
      resolved.workdir,
      background,
    );
  } catch (e) {
    dropTermuxResult(executionId);
    throw new HarnessError(
      'run_command_failed',
      e instanceof Error ? e.message : String(e),
    );
  }

  let stdout: string;
  try {
    stdout = await resultPromise;
  } catch (e) {
    if (e instanceof HarnessError) {
      throw e;
    }
    throw new HarnessError('run_command_failed', String(e));
  }

  const {done, output} = extractCompletedOutput(stdout);
  const finalOutput = done ? output : stdout.trim();
  opts.onProgress?.(finalOutput);
  return finalOutput;
}

/**
 * Fire-and-capture execution used by status/install ops (background=true by
 * default so no Termux UI flashes over the app).
 */
export async function runCommand(
  cmd: string,
  resolved: ResolvedHarness,
  opts: RunCommandOpts & {timeoutMs?: number} = {},
): Promise<string> {
  return execWithCapture(cmd, resolved, {
    ...opts,
    timeoutMs: opts.timeoutMs ?? VERSION_TIMEOUT_MS,
  });
}

/**
 * Opens a visible Termux session running the harness launch command
 * (background=false, no output capture — output stays in the session).
 */
export async function launchHarness(id: HarnessId): Promise<void> {
  const resolved = await loadEffectiveHarness(id);
  const mod = getSunlightHarness();
  try {
    await mod.runInTermux(
      resolved.command,
      [...resolved.args, '-c', resolved.launchCmd],
      resolved.workdir,
      false,
    );
  } catch (e) {
    throw new HarnessError(
      'run_command_failed',
      e instanceof Error ? e.message : String(e),
    );
  }
}

/**
 * Runs the harness install command headlessly, streaming progress into
 * [onProgress], resolving with the full captured log.
 */
export async function installHarness(
  id: HarnessId,
  onProgress?: (text: string) => void,
): Promise<string> {
  const resolved = await loadEffectiveHarness(id);
  return runCommand(resolved.installCmd, resolved, {
    timeoutMs: INSTALL_TIMEOUT_MS,
    onProgress,
  });
}

/**
 * Version probe: runs versionCmd and parses the first output line. A timeout
 * degrades to {installed:false} rather than throwing — an unreachable binary
 * is, for our purposes, not usable.
 */
export async function checkInstalled(
  id: HarnessId,
  opts: RunCommandOpts = {},
): Promise<InstallCheck> {
  const resolved = await loadEffectiveHarness(id);
  try {
    const out = await runCommand(resolved.versionCmd, resolved, {
      timeoutMs: VERSION_TIMEOUT_MS,
      ...opts,
    });
    return parseVersionOutput(out);
  } catch (e) {
    if (e instanceof HarnessError && e.code === 'timeout') {
      return {installed: false};
    }
    throw e;
  }
}
