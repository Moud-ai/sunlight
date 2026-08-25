/**
 * Pure-logic tests for the SSE frame parser extracted from src/api/chat.ts:
 * delta content, reasoning extraction (both field spellings), malformed frame
 * tolerance, and partial-frame buffering across chunks.
 */
import {createSseFrameParser, truncateBody} from '../src/api/chat';

function frame(json: unknown): string {
  return `data: ${JSON.stringify(json)}\n\n`;
}

interface Collected {
  deltas: string[];
  reasoning: string[];
}

function collect(): {acc: Collected; feed(chunk: string): void} {
  const acc: Collected = {deltas: [], reasoning: []};
  const parser = createSseFrameParser({
    onDelta: t => acc.deltas.push(t),
    onReasoning: t => acc.reasoning.push(t),
  });
  return {acc, feed: parser};
}

describe('createSseFrameParser', () => {
  test('dispatches delta content frames', () => {
    const {acc, feed} = collect();
    feed(frame({choices: [{delta: {content: 'hola'}}]}));
    feed(frame({choices: [{delta: {content: ' mundo'}}]}));
    expect(acc.deltas).toEqual(['hola', ' mundo']);
    expect(acc.reasoning).toEqual([]);
  });

  test('extracts reasoning_content and falls back to reasoning', () => {
    const {acc, feed} = collect();
    feed(frame({choices: [{delta: {reasoning_content: 'pensando'}}]}));
    feed(frame({choices: [{delta: {reasoning: 'más'}}]}));
    expect(acc.reasoning).toEqual(['pensando', 'más']);
  });

  test('a single frame can carry both reasoning and content', () => {
    const {acc, feed} = collect();
    feed(
      frame({
        choices: [{delta: {reasoning_content: 'r1', content: 'c1'}}],
      }),
    );
    expect(acc.reasoning).toEqual(['r1']);
    expect(acc.deltas).toEqual(['c1']);
  });

  test('skips malformed JSON frames without breaking the stream', () => {
    const {acc, feed} = collect();
    feed('data: {broken json\n');
    feed(frame({choices: [{delta: {content: 'ok'}}]}));
    expect(acc.deltas).toEqual(['ok']);
  });

  test('ignores [DONE], comments and empty payloads', () => {
    const {acc, feed} = collect();
    feed('data: [DONE]\n\n');
    feed(': keep-alive comment\n\n');
    feed('data: \n\n');
    feed('event: ping\n\n');
    expect(acc.deltas).toEqual([]);
    expect(acc.reasoning).toEqual([]);
  });

  test('buffers partial frames split across chunks', () => {
    const {acc, feed} = collect();
    const whole = frame({choices: [{delta: {content: 'split'}}]});
    const cut = whole.indexOf('"content');
    feed(whole.slice(0, cut));
    expect(acc.deltas).toEqual([]); // nothing dispatchable yet
    feed(whole.slice(cut));
    expect(acc.deltas).toEqual(['split']);
  });

  test('tolerates unexpected payload shapes', () => {
    const {acc, feed} = collect();
    feed(frame({}));
    feed(frame({choices: []}));
    feed(frame({choices: [{delta: null}]}));
    feed('not sse at all\n');
    expect(acc.deltas).toEqual([]);
    expect(acc.reasoning).toEqual([]);
  });
});

describe('truncateBody', () => {
  test('keeps short bodies intact', () => {
    expect(truncateBody('  boom  ')).toBe('boom');
  });

  test('truncates long bodies to ~300 chars with ellipsis', () => {
    const long = 'x'.repeat(500);
    const out = truncateBody(long);
    expect(out.length).toBeLessThanOrEqual(301);
    expect(out.endsWith('…')).toBe(true);
  });
});
