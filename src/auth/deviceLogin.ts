/**
 * Device-code login (RFC 8628 style) against the moud gateway.
 *
 * Flow: POST /auth/device/start -> user approves on the web console
 * (verification_url / user_code) -> POST /auth/device/poll returns a minted
 * moud_ API key bound to the approving subject. The key is then stored in the
 * device Keychain and used as `Authorization: Bearer` for /v1/chat/completions.
 *
 * Security: every request is bounded by the shared fetchWithTimeout helper,
 * which combines the internal timeout with any caller-supplied AbortSignal so
 * cancellation actually cancels the in-flight fetch. The verification URL is
 * validated against the gateway origin before being surfaced to the user
 * (defense against a compromised/incompatible gateway injecting arbitrary URLs).
 *
 * Pure helpers (mapPollOutcome, nextPollInterval, buildVerificationDeepLink,
 * formatUserCode) are exported for unit testing without React or network.
 */
import {GATEWAY_URL} from '../config';
import {request} from '../api/client';
import {fetchWithTimeout} from '../lib/fetchWithTimeout';

const FETCH_TIMEOUT_MS = 15_000;
const POLL_FETCH_TIMEOUT_MS = 20_000;

export interface DeviceStartResult {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
}

export type PollStatus = 'pending' | 'slow_down' | 'expired' | 'approved';

export interface DeviceApproval {
  apiKey: string;
  keyId: string;
  subject: string;
}

/** Raw shape of a POST /auth/device/poll response body. */
export interface RawPollResponse {
  status?: string;
  api_key?: string;
  key_id?: string;
  subject?: string;
}

export interface PollOutcome {
  status: PollStatus;
  approval: DeviceApproval | null;
}

/** Map a raw poll body into a typed outcome. Unknown statuses read as pending. */
export function mapPollOutcome(body: unknown): PollOutcome {
  const j = (body ?? {}) as RawPollResponse;
  const raw = String(j.status ?? 'pending');
  const known: PollStatus[] = ['pending', 'slow_down', 'expired', 'approved'];
  const status = (known as string[]).includes(raw) ? (raw as PollStatus) : 'pending';
  const approval =
    status === 'approved' && typeof j.api_key === 'string' && j.api_key.length > 0
      ? {apiKey: j.api_key, keyId: j.key_id ?? '', subject: j.subject ?? ''}
      : null;
  return {status, approval};
}

/** Interval growth between polls: slow_down backs off, capped at 30s. */
export function nextPollInterval(waitMs: number, status: PollStatus): number {
  if (status === 'slow_down') {
    return Math.min(waitMs + 5000, 30000);
  }
  return waitMs;
}

/**
 * QR/deep-link payload: opening it in a phone camera lands on the console
 * /device page with the code prefilled. Trailing slashes on the base URL are
 * stripped safely; a base that already carries a query gets `&code=`.
 */
export function buildVerificationDeepLink(
  verificationUrl: string,
  userCode: string,
): string {
  const base = verificationUrl.replace(/\/+$/, '');
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}code=${encodeURIComponent(userCode)}`;
}

/** Human-readable grouped code, e.g. "ABCD-1234" (groups of 4). */
export function formatUserCode(code: string): string {
  // Idempotent: stripping hyphens first means an already-formatted code
  // ("ABCD-1234") formats to itself instead of "ABCD--123-4".
  return (code.replace(/-/g, '').match(/.{1,4}/g) ?? []).join('-');
}

/**
 * Sanity-check a verification URL: must be https and on the gateway host.
 * Falls back to the gateway root if the server returns something unexpected,
 * so we never open an arbitrary origin in the user's browser.
 */
function safeVerificationUrl(raw: string | undefined): string {
  try {
    const gateway = new URL(GATEWAY_URL);
    if (raw) {
      const u = new URL(raw);
      if (u.protocol === 'https:' && u.hostname === gateway.hostname) {
        return u.toString();
      }
    }
  } catch {
    // fall through
  }
  return GATEWAY_URL;
}

export async function startDeviceLogin(): Promise<DeviceStartResult> {
  const j = await request<any>('/auth/device/start', {
    method: 'POST',
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  return {
    deviceCode: j.device_code,
    userCode: String(j.user_code ?? ''),
    verificationUrl: safeVerificationUrl(j.verification_url ?? j.verification_uri),
    expiresIn: j.expires_in ?? 600,
    interval: (j.interval ?? 5) * 1000,
  };
}

/**
 * Poll until approved/expired. Resolves with the approval or null on expiry.
 * `onStatus` reports progress for UI feedback. Aborting the signal stops it
 * (the external signal is combined with the per-request timeout). Honors
 * `expiresIn` so polling never outlives the device code's lifetime.
 */
export async function pollDeviceLogin(
  deviceCode: string,
  intervalMs: number,
  onStatus?: (s: PollStatus) => void,
  signal?: AbortSignal,
  expiresInSec?: number,
): Promise<DeviceApproval | null> {
  const deadline =
    expiresInSec != null ? Date.now() + expiresInSec * 1000 : Infinity;
  let wait = Math.max(2000, intervalMs);

  while (!signal?.aborted) {
    if (Date.now() >= deadline) {
      return null;
    }
    await new Promise<void>(r => setTimeout(r, wait));
    if (signal?.aborted) {
      return null;
    }
    let body: RawPollResponse;
    try {
      // fetchWithTimeout combines `signal` with the internal timeout so both
      // cancellation paths abort the same in-flight fetch.
      const res = await fetchWithTimeout(
        `${GATEWAY_URL}/auth/device/poll`,
        {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({device_code: deviceCode}),
          signal,
        },
        POLL_FETCH_TIMEOUT_MS,
      );
      const text = await res.text();
      body = text.length > 0 ? JSON.parse(text) : {};
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return null;
      }
      // Transient network/parse error: keep polling, but respect the deadline.
      continue;
    }
    const {status, approval} = mapPollOutcome(body);
    onStatus?.(status);
    if (approval) {
      return approval;
    }
    if (status === 'expired') {
      return null;
    }
    wait = nextPollInterval(wait, status);
  }
  return null;
}
