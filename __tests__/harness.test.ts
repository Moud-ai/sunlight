/**
 * Tests for the Termux harness bridge (src/lib/harness.ts): default/override
 * merging, version-output parsing, capture-script construction, sentinel
 * extraction, AsyncStorage persistence round-trip, and the poll loop over the
 * shared output file (happy path + timeout).
 *
 * AsyncStorage and @dr.pogodin/react-native-fs come from __mocks__/rn-natives.js; the
 * native SunlightHarness module is faked per-test via NativeModules.
 */
import {NativeModules} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as RNFS from '@dr.pogodin/react-native-fs';

import {
  DEFAULT_HARNESSES,
  DEFAULT_TERMUX_BASH,
  HARNESS_OUT_FILE,
  HARNESS_SENTINEL,
  HarnessError,
  buildCaptureScript,
  buildRunArgs,
  checkInstalled,
  clearHarnessOverride,
  extractCompletedOutput,
  harnessStorageKey,
  installHarness,
  loadEffectiveHarness,
  loadHarnessOverrides,
  mergeHarnessDefaults,
  parseVersionOutput,
  runCommand,
  saveHarnessOverride,
} from '../src/lib/harness';

const runInTermux = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (RNFS.readFile as jest.Mock).mockReset();
  (RNFS.readFile as jest.Mock).mockResolvedValue('');
  runInTermux.mockReset();
  runInTermux.mockResolvedValue(undefined);
  (NativeModules as Record<string, unknown>).SunlightHarness = {
    isTermuxInstalled: jest.fn().mockResolvedValue(true),
    hasRunCommandPermission: jest.fn().mockResolvedValue(true),
    openAppSettings: jest.fn(),
    runInTermux,
  };
  return Promise.all([
    AsyncStorage.removeItem(harnessStorageKey('hermes')),
    AsyncStorage.removeItem(harnessStorageKey('pi')),
  ]);
});

// ── mergeHarnessDefaults ───────────────────────────────────────────────

describe('mergeHarnessDefaults', () => {
  it('returns full defaults with termux bash when no override exists', () => {
    const merged = mergeHarnessDefaults('hermes', null);
    expect(merged.label).toBe(DEFAULT_HARNESSES.hermes.label);
    expect(merged.installCmd).toBe(DEFAULT_HARNESSES.hermes.installCmd);
    expect(merged.versionCmd).toBe('hermes --version');
    expect(merged.launchCmd).toBe('hermes');
    expect(merged.command).toBe(DEFAULT_TERMUX_BASH);
    // Login shell by default so $PREFIX exists for install scripts.
    expect(merged.args).toEqual(['-l']);
    expect(merged.workdir).toBeNull();
  });

  it('merges persisted overrides per field, keeping other defaults', () => {
    const merged = mergeHarnessDefaults('pi', {
      command: '/data/data/com.termux/files/usr/bin/zsh',
      args: ['-l'],
      workdir: '~/projects',
      installCmd: 'custom install',
    });
    expect(merged.command).toBe('/data/data/com.termux/files/usr/bin/zsh');
    expect(merged.args).toEqual(['-l']);
    expect(merged.workdir).toBe('~/projects');
    expect(merged.installCmd).toBe('custom install');
    // Non-overridable fields stay pinned to defaults.
    expect(merged.versionCmd).toBe(DEFAULT_HARNESSES.pi.versionCmd);
    expect(merged.launchCmd).toBe(DEFAULT_HARNESSES.pi.launchCmd);
  });

  it('falls back to defaults for blank override fields', () => {
    const merged = mergeHarnessDefaults('hermes', {
      command: '   ',
      workdir: '',
      installCmd: undefined,
    });
    expect(merged.command).toBe(DEFAULT_TERMUX_BASH);
    expect(merged.workdir).toBeNull();
    expect(merged.installCmd).toBe(DEFAULT_HARNESSES.hermes.installCmd);
  });
});

// ── parseVersionOutput ─────────────────────────────────────────────────

describe('parseVersionOutput', () => {
  it("parses 'hermes 1.2.3' as installed with version", () => {
    expect(parseVersionOutput('hermes 1.2.3\n')).toEqual({
      installed: true,
      version: '1.2.3',
    });
  });

  it('parses multi-part versions like pi 0.4.10', () => {
    expect(parseVersionOutput('pi 0.4.10 (build abc123)\n')).toEqual({
      installed: true,
      version: '0.4.10',
    });
  });

  it('treats empty output as not installed', () => {
    expect(parseVersionOutput('')).toEqual({installed: false});
    expect(parseVersionOutput('\n  \n')).toEqual({installed: false});
  });

  it('recognizes shell not-found errors as not installed', () => {
    expect(parseVersionOutput('bash: line 1: hermes: command not found\n'))
      .toEqual({installed: false});
    expect(
      parseVersionOutput('/system/bin/sh: pi: No such file or directory\n'),
    ).toEqual({installed: false});
  });

  it('treats unparseable but real output as installed without a version', () => {
    expect(parseVersionOutput('hermes ready\n')).toEqual({installed: true});
  });
});

// ── script wrapping ────────────────────────────────────────────────────

describe('buildCaptureScript / buildRunArgs', () => {
  it('truncates first, redirects stdout+stderr, appends the sentinel last', () => {
    const script = buildCaptureScript('hermes --version');
    const truncate = script.indexOf(`: > "${HARNESS_OUT_FILE}"`);
    const redirect = script.indexOf(`>> "${HARNESS_OUT_FILE}" 2>&1`);
    const sentinel = script.indexOf(
      `echo ${HARNESS_SENTINEL} >> "${HARNESS_OUT_FILE}"`,
    );
    expect(truncate).toBeGreaterThanOrEqual(0);
    expect(redirect).toBeGreaterThan(truncate);
    expect(sentinel).toBeGreaterThan(redirect);
    expect(script).toContain('{ hermes --version ; }');
  });

  it('places user args before the -c wrapper', () => {
    const resolved = mergeHarnessDefaults('pi', {args: ['-l']});
    expect(buildRunArgs(resolved, 'SCRIPT')).toEqual(['-l', '-c', 'SCRIPT']);
  });
});

// ── sentinel extraction ────────────────────────────────────────────────

describe('extractCompletedOutput', () => {
  it('reports done and strips the trailing sentinel line', () => {
    expect(extractCompletedOutput('out line\ndone\n')).toEqual({
      done: true,
      output: 'out line',
    });
  });

  it('ignores blank trailing lines when looking for the sentinel', () => {
    const result = extractCompletedOutput('out line\ndone\n\n \n');
    expect(result.done).toBe(true);
    expect(result.output).toBe('out line');
  });

  it('reports not-done while the sentinel has not appeared yet', () => {
    expect(extractCompletedOutput('partial output\n')).toEqual({
      done: false,
      output: 'partial output\n',
    });
  });

  it('handles an empty snapshot', () => {
    expect(extractCompletedOutput('')).toEqual({done: false, output: ''});
  });
});

// ── persistence ────────────────────────────────────────────────────────

describe('override persistence', () => {
  it('round-trips overrides through AsyncStorage', async () => {
    await saveHarnessOverride('hermes', {
      command: '/usr/bin/env bash',
      args: ['-l', '-v'],
      workdir: '/sdcard',
    });
    await expect(loadHarnessOverrides('hermes')).resolves.toEqual({
      command: '/usr/bin/env bash',
      args: ['-l', '-v'],
      workdir: '/sdcard',
      installCmd: undefined,
    });
    const effective = await loadEffectiveHarness('hermes');
    expect(effective.command).toBe('/usr/bin/env bash');
    expect(effective.args).toEqual(['-l', '-v']);
    expect(effective.installCmd).toBe(DEFAULT_HARNESSES.hermes.installCmd);
  });

  it('drops malformed stored blobs instead of throwing', async () => {
    await AsyncStorage.setItem(harnessStorageKey('pi'), '{not json');
    await expect(loadEffectiveHarness('pi')).resolves.toMatchObject({
      command: DEFAULT_TERMUX_BASH,
    });
  });

  it('clear removes the override entirely', async () => {
    await saveHarnessOverride('pi', {command: '/bin/x'});
    await clearHarnessOverride('pi');
    await expect(loadHarnessOverrides('pi')).resolves.toBeNull();
  });
});

// ── execution + polling ────────────────────────────────────────────────

describe('runCommand', () => {
  it('fires RUN_COMMAND with bash -c wrapper and resolves captured output', async () => {
    (RNFS.readFile as jest.Mock)
      .mockResolvedValueOnce('starting…\n')
      .mockResolvedValueOnce('starting…\n1.2.3\ndone\n');

    const resolved = await loadEffectiveHarness('hermes');
    const onProgress = jest.fn();
    const out = await runCommand('hermes --version', resolved, {
      pollIntervalMs: 1,
      onProgress,
    });

    expect(out).toBe('starting…\n1.2.3');
    expect(runInTermux).toHaveBeenCalledWith(
      DEFAULT_TERMUX_BASH,
      ['-l', '-c', buildCaptureScript('hermes --version')],
      null,
      true,
    );
    expect(onProgress).toHaveBeenCalled();
  });

  it('rejects with HarnessError(timeout) when the sentinel never appears', async () => {
    (RNFS.readFile as jest.Mock).mockResolvedValue('still running\n');
    const resolved = await loadEffectiveHarness('hermes');
    await expect(
      runCommand('long-op', resolved, {pollIntervalMs: 1, timeoutMs: 30}),
    ).rejects.toMatchObject({code: 'timeout', name: 'HarnessError'});
  });

  it('wraps native rejections into typed HarnessError', async () => {
    runInTermux.mockRejectedValue(new Error('denied'));
    const resolved = await loadEffectiveHarness('hermes');
    await expect(runCommand('x', resolved)).rejects.toBeInstanceOf(HarnessError);
  });
});

describe('checkInstalled / installHarness', () => {
  it('maps parsed version output to an InstallCheck', async () => {
    (RNFS.readFile as jest.Mock).mockResolvedValue('hermes 1.2.3\ndone\n');
    await expect(checkInstalled('hermes')).resolves.toEqual({
      installed: true,
      version: '1.2.3',
    });
  });

  it('degrades a version-probe timeout to not-installed', async () => {
    (RNFS.readFile as jest.Mock).mockResolvedValue('');
    await expect(
      checkInstalled('pi', {pollIntervalMs: 1, timeoutMs: 30}),
    ).resolves.toEqual({installed: false});
  });

  it('runs the effective install command headlessly', async () => {
    (RNFS.readFile as jest.Mock).mockResolvedValue('ok\ndone\n');
    const log = await installHarness('hermes');
    expect(log).toBe('ok');
    expect(runInTermux).toHaveBeenCalledTimes(1);
    const [, args, , background] = runInTermux.mock.calls[0];
    expect(background).toBe(true);
    expect(args[args.length - 2]).toBe('-c');
    expect(args[args.length - 1]).toContain(
      DEFAULT_HARNESSES.hermes.installCmd,
    );
  });
});
