/**
 * Pure-part tests for useLlamaChat: history composition is extracted as a
 * module-level pure helper so it can be tested without React. The hook wiring
 * itself (lazy initLlama, interrupt, release-on-switch) is exercised on-device.
 */
import {CURATED_GGUF_MODELS} from '../src/lib/gguf';
import {toLlamaMessages} from '../src/hooks/useLlamaChat';

describe('toLlamaMessages', () => {
  it('maps roles and content onto llama.rn OpenAI-compatible messages', () => {
    const history = [
      {role: 'system' as const, content: 'be brief'},
      {role: 'user' as const, content: 'hi'},
      {role: 'assistant' as const, content: 'hello'},
    ];
    expect(toLlamaMessages(history)).toEqual([
      {role: 'system', content: 'be brief'},
      {role: 'user', content: 'hi'},
      {role: 'assistant', content: 'hello'},
    ]);
  });

  it('returns a new array (does not alias the input)', () => {
    const history = [{role: 'user' as const, content: 'x'}];
    const out = toLlamaMessages(history);
    expect(out).not.toBe(history);
    expect(out[0]).not.toBe(history[0]);
  });

  it('handles empty history', () => {
    expect(toLlamaMessages([])).toEqual([]);
  });
});

describe('useLlamaChat catalog contract', () => {
  it('every curated GGUF id is addressable via the gguf/ picker prefix', () => {
    // The hook receives bare ids; ChatScreen slices them out of 'gguf/<id>'.
    // This guards against an id ever colliding with the ExecuTorch namespace.
    for (const entry of CURATED_GGUF_MODELS) {
      expect(entry.id.startsWith('gguf/')).toBe(false);
      expect(entry.id.startsWith('local/')).toBe(false);
    }
  });
});
