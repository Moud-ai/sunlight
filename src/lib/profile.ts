/**
 * User profile/avatar lookup against the gateway.
 *
 * GET /user/profile is public and accepts either ?subject=<subject> or
 * ?username=<username>; a bearer apiKey may be attached when provided. The
 * exact profile shape is not fully pinned down, so extraction is defensive:
 * extractAvatarUrl walks the WHOLE payload recursively and accepts any string
 * starting with https:// whose KEY (at any depth) matches the avatar-ish key
 * regex (/avatar|image|photo|picture|pfp|profile_?pic/i); nearest-to-root wins
 * on multiple matches. Only https URLs count as avatar URLs.
 *
 * API-call reduction:
 * - Positive results are cached in AsyncStorage under '@sunlight_avatar_<subject>'.
 *   Once cached, the value is returned immediately while a background refresh
 *   keeps it current.
 * - Negative results (no usable profile found) are cached for 5 minutes under
 *   '@sunlight_profile_negative_<subject>' so repeated mounts of a screen for
 *   an unknown subject do not re-hit the gateway.
 *
 * Any failure resolves to null — this helper must never break a caller's
 * render path.
 */
import {GATEWAY_URL} from '../config';
import {request} from '../api/client';
import {fetchWithTimeout} from './fetchWithTimeout';
import {capture as debugCapture} from './debugCapture';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AVATAR_KEY_PREFIX = '@sunlight_avatar_';
const NEGATIVE_KEY_PREFIX = '@sunlight_profile_negative_';

/** Negative-result cache lifetime in milliseconds (5 minutes). */
export const PROFILE_NEGATIVE_TTL_MS = 5 * 60 * 1000;

/** AsyncStorage key holding the last avatar-lookup outcome (debug only). */
export const AVATAR_DEBUG_KEY = '@sunlight_avatar_debug';

/** Field names accepted as display names at any level, in preference order. */
const NAME_FIELDS = ['display_name', 'displayName', 'name', 'username'] as const;

export interface ProfileSummary {
  avatarUrl?: string | null;
  displayName?: string | null;
  subject: string;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  if (value.startsWith('https://')) {
    return value;
  }
  // Gateway returns relative URLs like /media/avatars/xxx.jpg
  if (value.startsWith('/')) {
    return `${GATEWAY_URL}${value}`;
  }
  return null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Key regex deciding which string values count as avatar URLs. */
const AVATAR_KEY_RE = /avatar|image|photo|picture|pfp|profile_?pic/i;

function firstField(
  rec: Record<string, unknown>,
  fields: readonly string[],
  accept: (v: unknown) => string | null,
): string | null {
  for (const field of fields) {
    const found = accept(rec[field]);
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * Defensively extract an https avatar URL from an arbitrary profile payload.
 *
 * Recursive breadth-first walk: at each level, any object key matching the
 * avatar-ish regex whose value is an https string wins. Breadth-first order
 * guarantees nearest-to-root wins when multiple matches exist. Objects AND
 * arrays are traversed. Exported for direct unit testing of shape variants.
 */
export function extractAvatarUrl(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const queue: unknown[] = [body];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') {
      continue;
    }
    if (Array.isArray(node)) {
      // Arrays carry no keys; enqueue elements to keep walking deeper levels.
      queue.push(...node);
      continue;
    }
    const rec = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(rec)) {
      if (AVATAR_KEY_RE.test(key)) {
        // Resolve relative URLs to absolute before returning — the old code
        // returned the raw value here, handing bare '/media/...' paths to
        // <Image> which silently fails to load them.
        const url = httpsUrl(value);
        if (url) {
          return url;
        }
      }
      if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }
  return null;
}

/**
 * Defensively extract a display name from an arbitrary profile payload.
 * Exported for direct unit testing of shape variants.
 */
export function extractDisplayName(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const queue: unknown[] = [body];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      if (Array.isArray(node)) {
        queue.push(...node);
      }
      continue;
    }
    const rec = node as Record<string, unknown>;
    const found = firstField(rec, NAME_FIELDS, nonEmptyString);
    if (found) {
      return found;
    }
    for (const value of Object.values(rec)) {
      if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }
  return null;
}

function avatarKey(subject: string): string {
  return `${AVATAR_KEY_PREFIX}${subject}`;
}

function negativeKey(subject: string): string {
  return `${NEGATIVE_KEY_PREFIX}${subject}`;
}

async function readNegative(subject: string, now: () => number): Promise<boolean> {
  try {
    const text = await AsyncStorage.getItem(negativeKey(subject));
    if (!text) {
      return false;
    }
    const parsed = JSON.parse(text) as {at?: unknown};
    if (typeof parsed?.at !== 'number') {
      return false;
    }
    return now() - parsed.at < PROFILE_NEGATIVE_TTL_MS;
  } catch {
    return false;
  }
}

async function writeNegative(subject: string, now: () => number): Promise<void> {
  try {
    await AsyncStorage.setItem(
      negativeKey(subject),
      JSON.stringify({at: now()}),
    );
  } catch {
    // Cache write failures must not fail the lookup.
  }
}

interface LookupOpts {
  /** Bearer key attached to the first (authenticated) attempt when present. */
  apiKey?: string;
}

interface LookupResult {
  body: unknown;
  /** Which endpoint produced the body ('subject' | 'username'), null on failure. */
  endpoint: 'subject' | 'username' | null;
}

/**
 * Resolve a profile body for a subject: try the authenticated/primary subject
 * lookup first; on any failure retry publicly via the username param. Returns
 * {body: null, endpoint: null} when both attempts fail. Never throws.
 */
async function lookupProfileBody(
  subject: string,
  opts: LookupOpts = {},
): Promise<LookupResult> {
  try {
    return {
      body: await request<unknown>(
        `/user/profile?subject=${encodeURIComponent(subject)}`,
        opts.apiKey ? {apiKey: opts.apiKey} : {},
      ),
      endpoint: 'subject',
    };
  } catch {
    // not_found, auth errors, network problems — try the username fallback.
  }
  try {
    return {
      body: await request<unknown>(
        `/user/profile?username=${encodeURIComponent(subject)}`,
      ),
      endpoint: 'username',
    };
  } catch {
    return {body: null, endpoint: null};
  }
}

/**
 * Persist the last lookup outcome for diagnosability (recurring reports of
 * missing avatars). Debug-only: nothing reads this key in the UI. Never throws.
 */
async function writeDebugOutcome(outcome: {
  subject: string;
  endpoint: string | null;
  found: boolean;
}): Promise<void> {
  try {
    await AsyncStorage.setItem(
      AVATAR_DEBUG_KEY,
      JSON.stringify({...outcome, at: Date.now()}),
    );
  } catch {
    // Debug writes must never break the lookup path.
  }
}

async function refreshAvatar(
  subject: string,
  apiKey?: string,
): Promise<string | null> {
  const now = Date.now;
  if (await readNegative(subject, now)) {
    return null;
  }
  const {body, endpoint} = await lookupProfileBody(subject, {apiKey});
  if (!body || typeof body !== 'object') {
    await writeNegative(subject, now);
    writeDebugOutcome({subject, endpoint, found: false}).then(() => undefined, () => undefined);
    return null;
  }
  const avatar = extractAvatarUrl(body);
  writeDebugOutcome({subject, endpoint, found: avatar !== null}).then(() => undefined, () => undefined);
  if (avatar) {
    try {
      await AsyncStorage.setItem(avatarKey(subject), avatar);
    } catch {
      // Cache write failures must not fail the lookup.
    }
  } else {
    // A valid profile without an avatar is still a "no avatar" answer worth
    // caching briefly to avoid hammering the gateway on every mount.
    await writeNegative(subject, now);
  }
  return avatar;
}

/**
 * Resolve an avatar URL for a subject:
 * - Fresh negative result (< 5 min old) short-circuits to null without I/O.
 * - Cached positive value is returned immediately while a background refresh
 *   runs.
 * - Without a cache entry the lookup is awaited (null on any failure).
 */
export async function fetchProfileAvatar(
  subject: string,
  apiKey?: string,
): Promise<string | null> {
  if (!subject) {
    return null;
  }
  let cached: string | null = null;
  try {
    cached = await AsyncStorage.getItem(avatarKey(subject));
  } catch {
    cached = null;
  }
  if (cached && (cached.startsWith('https://') || cached.startsWith('/'))) {
    // Fire-and-forget refresh; failures are swallowed by refreshAvatar.
    refreshAvatar(subject, apiKey).then(() => undefined, () => undefined);
    return cached;
  }
  return refreshAvatar(subject, apiKey);
}

/**
 * Fetch the signed-in user's own profile with the richest data available:
 * the subject lookup is attempted WITH Authorization first (may return
 * private fields like display_name/email); on failure it falls back to the
 * public lookup chain (subject, then username). Never throws.
 */
export async function fetchOwnProfile(
  apiKey: string,
  subject: string,
): Promise<ProfileSummary> {
  const summary: ProfileSummary = {
    avatarUrl: null,
    displayName: null,
    subject,
  };
  if (!subject || !apiKey) {
    return summary;
  }

  let body: unknown = null;
      try {
        // Single-shot authenticated attempt (no retry loop): profile lookups
        // are best-effort UI sugar and must not multiply gateway calls.
        const res = await fetchWithTimeout(
          `https://mound.opceanai.com/user/profile?subject=${encodeURIComponent(subject)}`,
          {
            method: 'GET',
            headers: {
              'content-type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
          },
          10_000,
        );
        if (res.ok) {
          body = await res.json();
        }
      } catch {
        body = null;
      }
  if (!body || typeof body !== 'object') {
    body = (await lookupProfileBody(subject)).body;
  }

  if (body && typeof body === 'object') {
    summary.avatarUrl = extractAvatarUrl(body);
    summary.displayName = extractDisplayName(body);
  }
  return summary;
}

/** Drop the cached avatar + negative entry for a subject (no-op on errors). */
export async function clearProfileCache(subject: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(avatarKey(subject));
    await AsyncStorage.removeItem(negativeKey(subject));
  } catch {
    // Nothing to clean up.
  }
}
