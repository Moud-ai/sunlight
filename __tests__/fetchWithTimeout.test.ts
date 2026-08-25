/**
 * fetchWithTimeout combined-signal behavior against a mocked global fetch:
 * the internal timeout and an external AbortSignal must each be able to abort
 * the same in-flight request, whichever fires first.
 */
import {fetchWithTimeout} from '../src/lib/fetchWithTimeout';

type FetchMock = jest.Mock;

/** A fetch that never resolves but rejects when its signal aborts. */
function hangingFetch(): FetchMock {
  return jest.fn((_input: unknown, init: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const fail = () => {
        const err = new Error('Aborted');
        (err as any).name = 'AbortError';
        reject(err);
      };
      // Real fetch rejects immediately for an already-aborted signal.
      if (init.signal!.aborted) {
        fail();
        return;
      }
      init.signal!.addEventListener('abort', fail);
    });
  });
}

function okFetch(): FetchMock {
  return jest.fn(async () => ({ok: true, status: 200}) as unknown as Response);
}
const flush = () => new Promise<void>(r => setTimeout(r, 0));

afterEach(() => {
  jest.restoreAllMocks();
});

describe('fetchWithTimeout', () => {
  test('resolves normally when the request beats the timeout', async () => {
    const mock = okFetch();
    (globalThis as any).fetch = mock;
    const res = await fetchWithTimeout('https://x/y', {}, 1000);
    expect(res.ok).toBe(true);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  test('aborts on timeout with no external signal', async () => {
    const mock = hangingFetch();
    (globalThis as any).fetch = mock;
    await expect(fetchWithTimeout('https://x/y', {}, 20)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  test('external abort cancels the in-flight request before the timeout', async () => {
    const mock = hangingFetch();
    (globalThis as any).fetch = mock;
    const external = new AbortController();
    const pending = fetchWithTimeout(
      'https://x/y',
      {signal: external.signal},
      10_000,
    );
    await flush();
    external.abort();
    await expect(pending).rejects.toMatchObject({name: 'AbortError'});
    // The fetch saw a different (combined) controller's signal.
    const passedSignal = mock.mock.calls[0][1].signal as AbortSignal;
    expect(passedSignal).not.toBe(external.signal);
    expect(passedSignal.aborted).toBe(true);
  });

  test('a pre-aborted external signal aborts immediately', async () => {
    const mock = hangingFetch();
    (globalThis as any).fetch = mock;
    const external = new AbortController();
    external.abort();
    await expect(
      fetchWithTimeout('https://x/y', {signal: external.signal}, 10_000),
    ).rejects.toMatchObject({name: 'AbortError'});
  });

  test('completion clears the timer so a late timeout cannot fire', async () => {
    jest.useFakeTimers();
    try {
      const mock = okFetch();
      (globalThis as any).fetch = mock;
      await fetchWithTimeout('https://x/y', {}, 50);
      // Advancing well past the timeout must not throw or reject anything.
      await jest.advanceTimersByTimeAsync(500);
      expect(mock).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
