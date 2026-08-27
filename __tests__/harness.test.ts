/**
 * Tests for the VM harness bridge (src/lib/harness.ts): default/override
 * merging, version parsing, and VM-console execution (runInVm) via mocked
 * VmModule primitives.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_HARNESSES,
  HARNESS_IDS,
  HarnessError,
  checkInstalled,
  clearHarnessOverride,
  harnessStorageKey,
  installHarness,
  loadEffectiveHarness,
  mergeHarnessDefaults,
  parseVersionOutput,
  runInVm,
  saveHarnessOverride,
} from '../src/lib/harness';

jest.mock('../src/lib/vm', () => {
  let running = true;
  let out = '';
  return {
    __setRunning: (v: boolean) => {
      running = v;
    },
    __setOut: (v: string) => {
      out = v;
    },
    isVmRunning: jest.fn(async () => running),
    clearVmConsole: jest.fn(async () => true),
    writeVmConsole: jest.fn(async (_text: string) => true),
    pollVmConsole: jest.fn(async () => {
      const chunk = out;
      out = '';
      return chunk;
    }),
  };
});

import * as vm from '../src/lib/vm';

const vmMock = vm as unknown as {
  __setOut: (v: string) => void;
  __setRunning: (v: boolean) => void;
};

beforeEach(async () => {
  jest.useRealTimers();
  vmMock.__setRunning(true);
  vmMock.__setOut('');
  await AsyncStorage.removeItem(harnessStorageKey('hermes'));
  await AsyncStorage.removeItem(harnessStorageKey('pi'));
});

describe('DEFAULT_HARNESSES', () => {
  it('defines both agents with check/install/launch commands', () => {
    expect(HARNESS_IDS).toEqual(['hermes', 'pi']);
    for (const id of HARNESS_IDS) {
      expect(DEFAULT_HARNESSES[id].checkCmd.length).toBeGreaterThan(0);
      expect(DEFAULT_HARNESSES[id].installCmd.length).toBeGreaterThan(0);
      expect(DEFAULT_HARNESSES[id].launchCmd.length).toBeGreaterThan(0);
      expect(DEFAULT_HARNESSES[id].label.length).toBeGreaterThan(0);
    }
  });
});

describe('mergeHarnessDefaults', () => {
  it('uses defaults when no override exists', () => {
    const merged = mergeHarnessDefaults('hermes', null);
    expect(merged.installCmd).toBe(DEFAULT_HARNESSES.hermes.installCmd);
    expect(merged.checkCmd).toBe(DEFAULT_HARNESSES.hermes.checkCmd);
    expect(merged.launchCmd).toBe(DEFAULT_HARNESSES.hermes.launchCmd);
    expect(merged.override).toBeNull();
  });

  it('merges persisted overrides per field, keeping other defaults', () => {
    const merged = mergeHarnessDefaults('hermes', {installCmd: 'custom install'});
    expect(merged.installCmd).toBe('custom install');
    expect(merged.checkCmd).toBe(DEFAULT_HARNESSES.hermes.checkCmd);
    expect(merged.launchCmd).toBe(DEFAULT_HARNESSES.hermes.launchCmd);
  });

  it('falls back to defaults for blank override fields', () => {
    const merged = mergeHarnessDefaults('pi', {installCmd: '   '});
    expect(merged.installCmd).toBe(DEFAULT_HARNESSES.pi.installCmd);
  });
});

describe('loadEffectiveHarness / persistence', () => {
  it('loads defaults from cold storage', async () => {
    const eff = await loadEffectiveHarness('hermes');
    expect(eff.installCmd).toBe(DEFAULT_HARNESSES.hermes.installCmd);
    expect(eff.override).toBeNull();
  });

  it('round-trips an override', async () => {
    await saveHarnessOverride('hermes', {installCmd: 'apk add tree'});
    const eff = await loadEffectiveHarness('hermes');
    expect(eff.installCmd).toBe('apk add tree');
    await clearHarnessOverride('hermes');
    const after = await loadEffectiveHarness('hermes');
    expect(after.installCmd).toBe(DEFAULT_HARNESSES.hermes.installCmd);
  });

  it('tolerates corrupt persisted JSON', async () => {
    await AsyncStorage.setItem(harnessStorageKey('hermes'), '{not json');
    const eff = await loadEffectiveHarness('hermes');
    expect(eff.override).toBeNull();
    expect(eff.installCmd).toBe(DEFAULT_HARNESSES.hermes.installCmd);
  });
});

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

  it('treats non-version output as installed without version', () => {
    expect(parseVersionOutput('hermes not found')).toEqual({installed: true});
  });
});

describe('runInVm', () => {
  it('rejects when the VM is not running', async () => {
    vmMock.__setRunning(false);
    await expect(runInVm('echo hi')).rejects.toBeInstanceOf(HarnessError);
  });

  it('returns output plus exit code from the sentinel', async () => {
    vmMock.__setOut('hello\nVM_DONE_0\n');
    const res = await runInVm('echo hi', {timeoutMs: 2000});
    expect(res.code).toBe(0);
    expect(res.timedOut).toBe(false);
    expect(res.output).toContain('hello');
  });

  it('parses a non-zero exit code', async () => {
    vmMock.__setOut('boom\nVM_DONE_3\n');
    const res = await runInVm('false', {timeoutMs: 2000});
    expect(res.code).toBe(3);
  });
});

describe('checkInstalled / installHarness', () => {
  it('reports vm_missing when the VM is off', async () => {
    vmMock.__setRunning(false);
    const res = await checkInstalled('hermes');
    expect(res.kind).toBe('vm_missing');
  });

  it('reports installed with a version from check output', async () => {
    vmMock.__setOut('hermes 1.2.3\nVM_DONE_0\n');
    const res = await checkInstalled('hermes');
    expect(res.kind).toBe('installed');
    expect(res.version).toBe('1.2.3');
  });

  it('installHarness returns ok on sentinel code 0', async () => {
    vmMock.__setOut('installing...\nVM_DONE_0\n');
    const res = await installHarness('hermes');
    expect(res.ok).toBe(true);
    expect(res.code).toBe(0);
  });
});