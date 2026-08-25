/**
 * Central API client for the Moud gateway.
 *
 * Base URL comes from config GATEWAY_URL. Every request is bounded by
 * fetchWithTimeout. Upstream errors arrive as {"error":{"type":"..."}}
 * and are normalized into a typed ApiError {status, type, message}.
 * 401 is mapped distinctly so callers can sign the user out.
 */
import {GATEWAY_URL} from '../config';
import {fetchWithTimeout} from '../lib/fetchWithTimeout';
import {requestWithRetry, isRetryable} from '../lib/network';

export class ApiError extends Error {
  /** HTTP status; 0 means the request never got a response (network/abort). */
  readonly status: number;
  /** Machine-readable error type from the body ("totp_invalid", ...). */
  readonly type: string;

  constructor(status: number, type: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.type = type;
  }
}

/** Extract `error.type` from an upstream body, with a sane fallback. */
export function errorTypeFromBody(body: unknown, fallback = 'error'): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as {error?: unknown}).error;
    if (err && typeof err === 'object' && 'type' in err) {
      const type = (err as {type: unknown}).type;
      if (typeof type === 'string' && type.length > 0) {
        return type;
      }
    }
  }
  return fallback;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH';
  /** JSON-serializable request body. */
  body?: unknown;
  /** moud_ API key sent as `Authorization: Bearer`. */
  apiKey?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Perform a JSON request against the gateway and return the parsed body.
 * Non-2xx responses throw ApiError carrying the upstream error.type.
 */
export async function request<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (opts.apiKey) {
    headers.Authorization = `Bearer ${opts.apiKey}`;
  }

  const doFetch = async (): Promise<T> => {
    let res: Response;
    try {
      res = await fetchWithTimeout(
        `${GATEWAY_URL}${path}`,
        {
          method: opts.method ?? 'GET',
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        },
        opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw e;
      }
      throw new ApiError(0, 'network_error', `${path}: network request failed`);
    }

    let parsed: unknown = null;
    const text = await res.text();
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }

    if (!res.ok) {
      const type = errorTypeFromBody(
        parsed,
        res.status === 401 ? 'unauthorized' : 'error',
      );
      throw new ApiError(
        res.status,
        type,
        `${path} HTTP ${res.status}${type !== 'error' ? ` (${type})` : ''}`,
      );
    }

    return parsed as T;
  };

  // POST and other non-GET methods are not retried (not idempotent).
  if (opts.method && opts.method !== 'GET') {
    return doFetch();
  }

  return requestWithRetry(doFetch, {
    retryConfig: {maxRetries: 2},
  });
}

/** True when the error represents an expired/revoked session (HTTP 401). */
export function isAuthExpired(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401;
}
