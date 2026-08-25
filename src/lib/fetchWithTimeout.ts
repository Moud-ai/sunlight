/**
 * Fetch bounded by an abort-based timeout that also honors a caller-supplied
 * AbortSignal.
 *
 * Hermes does not expose AbortSignal.any, so the combination is wired
 * manually: whichever fires first (the external signal or the internal timer)
 * aborts the single controller driving the fetch, so external cancellation
 * always reaches the in-flight request and the timeout still fires
 * independently when no external signal is given.
 */
export function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  ms: number,
): Promise<Response> {
  const controller = new AbortController();
  const external = init.signal ?? null;

  const onExternalAbort = () => {
    try {
      controller.abort(external?.reason);
    } catch {
      // Some runtimes ignore an abort reason; plain abort is enough.
      controller.abort();
    }
  };

  if (external) {
    if (external.aborted) {
      onExternalAbort();
    } else {
      external.addEventListener('abort', onExternalAbort);
    }
  }

  const timer = setTimeout(() => {
    try {
      controller.abort(new Error('timeout'));
    } catch {
      controller.abort();
    }
  }, ms);

  return fetch(input, {...init, signal: controller.signal}).finally(() => {
    clearTimeout(timer);
    if (external) {
      external.removeEventListener('abort', onExternalAbort);
    }
  });
}
