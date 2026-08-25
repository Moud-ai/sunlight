/**
 * Pure-part tests for useLocalChat: the state mapper and history composition
 * are extracted as module-level pure helpers precisely so they can be tested
 * without @testing-library/react-native (not a dependency of this project).
 * The hook wiring itself is exercised on-device.
 */
import {
  LOCAL_MODELS,
  mapExecutorchState,
  toExecutorchMessages,
} from '../src/hooks/useLocalChat';

describe('mapExecutorchState', () => {
  it('maps pristine state to loading', () => {
    expect(mapExecutorchState(false, 0, null)).toBe('loading');
  });

  it('maps in-flight download progress to downloading', () => {
    expect(mapExecutorchState(false, 0.01, null)).toBe('downloading');
    expect(mapExecutorchState(false, 0.5, null)).toBe('downloading');
    expect(mapExecutorchState(false, 0.99, null)).toBe('downloading');
  });

  it('never reports downloading when ready', () => {
    expect(mapExecutorchState(true, 0.5, null)).toBe('ready');
    expect(mapExecutorchState(true, 1, null)).toBe('ready');
  });

  it('maps download-complete-but-deserializing to loading', () => {
    expect(mapExecutorchState(false, 1, null)).toBe('loading');
  });

  it('error wins over every other state', () => {
    expect(mapExecutorchState(false, 0.4, new Error('boom'))).toBe('error');
    expect(mapExecutorchState(true, 1, new Error('boom'))).toBe('error');
  });

  it('idle is derived by the hook (no entry), not by this mapper', () => {
    // Documented contract: mapper never returns 'idle'; useLocalChat short-
    // circuits to 'idle' when no local model id is selected.
    expect(mapExecutorchState(false, 0, null)).not.toBe('idle');
  });
});

describe('toExecutorchMessages', () => {
  it('maps roles and content onto executorch Message shape', () => {
    const history = [
      {role: 'system' as const, content: 'be brief'},
      {role: 'user' as const, content: 'hi'},
      {role: 'assistant' as const, content: 'hello'},
    ];
    expect(toExecutorchMessages(history)).toEqual([
      {role: 'system', content: 'be brief'},
      {role: 'user', content: 'hi'},
      {role: 'assistant', content: 'hello'},
    ]);
  });

  it('returns a new array (does not alias the input)', () => {
    const history = [{role: 'user' as const, content: 'x'}];
    const out = toExecutorchMessages(history);
    expect(out).not.toBe(history);
    expect(out[0]).not.toBe(history[0]);
  });

  it('handles empty history', () => {
    expect(toExecutorchMessages([])).toEqual([]);
  });
});

describe('LOCAL_MODELS catalog', () => {
  it('uses local/ ids and exposes factories that resolve configs', () => {
    expect(LOCAL_MODELS.length).toBeGreaterThanOrEqual(2);
    for (const entry of LOCAL_MODELS) {
      expect(entry.id.startsWith('local/')).toBe(true);
      expect(typeof entry.label).toBe('string');
      const cfg = entry.factory();
      expect(typeof cfg.modelName).toBe('string');
      expect(cfg.modelSource).toBeDefined();
      expect(cfg.tokenizerSource).toBeDefined();
    }
  });

  it('contains the two briefed models with exact ids', () => {
    const ids = LOCAL_MODELS.map(m => m.id);
    expect(ids).toContain('local/lfm2_5_1_2b_instruct');
    expect(ids).toContain('local/llama3_2_1b_spinquant');
  });
});
