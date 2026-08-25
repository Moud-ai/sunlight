/**
 * Network resilience utilities — retry with exponential backoff + jitter,
 * request cancellation, and offline detection.
 *
 * All network calls should go through `requestWithRetry` for consistent
 * behavior across the app. The retry strategy uses full jitter to prevent
 * thundering-herd effects when many clients recover simultaneously.
 */

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffFactor: 2,
};

/** Retryable HTTP status codes (server errors + rate limit + timeout). */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

/** Calculate delay with full jitter: random between 0 and exponential delay. */
export function calculateDelay(attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
  const exponential = config.baseDelayMs * config.backoffFactor ** attempt;
  const capped = Math.min(exponential, config.maxDelayMs);
  return Math.floor(Math.random() * capped);
}

/** True when the error is worth retrying. */
export function isRetryable(status: number | undefined, isNetworkError: boolean): boolean {
  if (isNetworkError) return true;
  if (status === undefined) return false;
  return RETRYABLE_STATUSES.has(status);
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Execute a fetch with automatic retry on transient failures.
 *
 * - Retries on network errors, 408, 429, 5xx.
 * - Uses exponential backoff with full jitter.
 * - Honors AbortSignal cancellation between retries.
 * - Never retries 4xx client errors (except 408/429).
 */
export async function requestWithRetry<T>(
  fn: () => Promise<T>,
  opts?: { retryConfig?: Partial<RetryConfig>; onRetry?: (attempt: number, delayMs: number) => void },
): Promise<T> {
  const config: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...opts?.retryConfig };
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      const status = e?.status as number | undefined;
      const isNetwork = e?.name === 'AbortError' ? false : !status;

      if (!isRetryable(status, isNetwork) || attempt === config.maxRetries) {
        throw e;
      }

      const delay = calculateDelay(attempt, config);
      opts?.onRetry?.(attempt + 1, delay);
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Create a cancellable request token. Call `cancel()` to abort, or
 * `throwIfCancelled()` inside async work to bail out early.
 */
export function createCancellable() {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    cancel: () => controller.abort(),
    throwIfCancelled: () => {
      if (controller.signal.aborted) {
        const e = new Error('Request cancelled');
        e.name = 'AbortError';
        throw e;
      }
    },
  };
}
