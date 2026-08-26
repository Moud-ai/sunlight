/**
 * Personal quota service for the moud gateway.
 *
 * GET /user/quota is the REAL personal-quota endpoint: it requires a Bearer
 * moud_ key (unauthenticated calls answer 401 {"type":"missing_actor"}). The
 * previously used /dashboard/user/quota path is a Next.js PAGE that 307s to a
 * login route — never usable from the app.
 *
 * The exact response shape is not pinned down, so parsing is defensive across
 * common variants ({used,limit}, {quota:{...}}, {usage:{...}},
 * {tokens_used,tokens_limit}, and one level of nesting under data/result).
 *
 * API-call reduction (user requirement): successful lookups are cached in
 * memory AND in AsyncStorage under '@sunlight_quota_cache' with a 60s TTL, so
 * remounting screens does not re-hit the gateway.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {request} from '../api/client';

export const QUOTA_CACHE_KEY = '@sunlight_quota_cache';

/** Cache lifetime in milliseconds. */
export const QUOTA_CACHE_TTL_MS = 60_000;

export interface QuotaInfo {
  used: number;
  limit: number;
  remaining: number;
}

export interface FetchQuotaOpts {
  /** Skip the cache and always hit the network. */
  force?: boolean;
  /** Injectable clock for TTL tests; defaults to Date.now. */
  now?: () => number;
}

interface QuotaCacheEntry {
  fetchedAt: number;
  quota: QuotaInfo | null;
}

let memCache: QuotaCacheEntry | null = null;

/**
 * Coerce a value to a finite number. Accepts plain numbers AND numeric strings
 * ('1234', '1234.5', '-3'). Many gateway implementations serialize numbers as
 * strings — rejecting them silently caused the profile quota to display '—'.
 */
function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === 'string' && v.trim().length > 0) {
    const n = Number(v);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return null;
}

/** Keys whose numeric value may carry consumed tokens. */
const USED_KEY_RE = /(?:used|usage|consumed|tokens_used)/i;

/** Keys whose numeric value may carry the quota ceiling. */
const LIMIT_KEY_RE = /(?:limit|total|quota|max|tokens_limit|pool_tokens|allowance)/i;

/** Key carrying precomputed remaining budget (used = limit - remaining). */
const REMAINING_KEY_RE = /remaining/i;

/** Numeric entries of one object matching [regex]. */
function numbersMatching(rec: Record<string, unknown>, re: RegExp): number[] {
  const out: number[] = [];
  for (const [key, value] of Object.entries(rec)) {
    if (!re.test(key)) {
      continue;
    }
    // Coerce via toFiniteNumber so numeric strings ('1234') are accepted —
    // many gateways serialize quota numbers as strings.
    const n = toFiniteNumber(value);
    if (n !== null && n >= 0) {
      out.push(n);
    }
  }
  return out;
}

function firstNumber(rec: Record<string, unknown>, re: RegExp): number | null {
  const found = numbersMatching(rec, re);
  return found.length > 0 ? Math.max(...found) : null;
}

/** Collect every object reachable from [node] in breadth-first (nearest-to-
 * root first) order, traversing objects and arrays. */
function collectObjects(node: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const queue: unknown[] = [node];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur || typeof cur !== 'object') {
      continue;
    }
    if (Array.isArray(cur)) {
      queue.push(...cur);
      continue;
    }
    const rec = cur as Record<string, unknown>;
    out.push(rec);
    for (const value of Object.values(rec)) {
      if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }
  return out;
}

/** Derive a FULL {used, limit} pairing from one object (or limit+remaining). */
function fullPairFromObject(rec: Record<string, unknown>): QuotaInfo | null {
  const used = firstNumber(rec, USED_KEY_RE);
  const limit = firstNumber(rec, LIMIT_KEY_RE);
  if (used !== null && limit !== null) {
    return {used, limit, remaining: Math.max(0, limit - used)};
  }
  // {limit, remaining} without an explicit used value.
  const remaining = numbersMatching(rec, REMAINING_KEY_RE);
  if (used === null && limit !== null && remaining.length > 0) {
    const derivedUsed = limit - Math.max(...remaining);
    if (derivedUsed >= 0) {
      return {used: derivedUsed, limit, remaining: Math.max(...remaining)};
    }
  }
  return null;
}

/**
 * Defensively extract {used, limit} from an arbitrary quota payload.
 *
 * Recursive breadth-first scan: within any object reachable from the body,
 * keys matching USED_KEY_RE paired with LIMIT_KEY_RE form a quota (also
 * accepting {limit, remaining} with used derived as limit-remaining). Full
 * pairings win regardless of depth (nearest-to-root among them); when NO
 * object pairs the keys but a used-style number exists somewhere, it is still
 * returned with limit=0 meaning "unknown". Exported for direct unit testing
 * of shape variants.
 */
export function parseUserQuota(body: unknown): QuotaInfo | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  // The daily user pool is the PRIMARY quota. Check it explicitly before the
  // generic BFS so payload key order can never demote it below flagship/shared.
  if (!Array.isArray(body)) {
    const pool = (body as Record<string, unknown>).user_pool;
    if (pool && typeof pool === 'object' && !Array.isArray(pool)) {
      const poolQuota = fullPairFromObject(pool as Record<string, unknown>);
      if (poolQuota) {
        return poolQuota;
      }
    }
  }
  const objects = collectObjects(body);
  for (const rec of objects) {
    const quota = fullPairFromObject(rec);
    if (quota) {
      return quota;
    }
  }
  // Fallback: consumption known but no ceiling anywhere in the payload.
  for (const rec of objects) {
    const used = firstNumber(rec, USED_KEY_RE);
    if (used !== null) {
      return {used, limit: 0, remaining: 0};
    }
  }
  return null;
}

async function readDiskCache(now: () => number): Promise<QuotaInfo | null> {
  try {
    const text = await AsyncStorage.getItem(QUOTA_CACHE_KEY);
    if (!text) {
      return null;
    }
    const parsed = JSON.parse(text) as Partial<QuotaCacheEntry>;
    if (
      typeof parsed?.fetchedAt !== 'number' ||
      !parsed.quota ||
      typeof parsed.quota.used !== 'number' ||
      typeof parsed.quota.limit !== 'number'
    ) {
      return null;
    }
    if (now() - parsed.fetchedAt >= QUOTA_CACHE_TTL_MS) {
      return null;
    }
    // Re-derive `remaining` so hand-edited/stale blobs stay coherent.
    return {
      used: parsed.quota.used,
      limit: parsed.quota.limit,
      remaining: Math.max(0, parsed.quota.limit - parsed.quota.used),
    };
  } catch {
    return null;
  }
}

async function writeCache(quota: QuotaInfo, now: () => number): Promise<void> {
  memCache = {fetchedAt: now(), quota};
  try {
    await AsyncStorage.setItem(
      QUOTA_CACHE_KEY,
      JSON.stringify({fetchedAt: now(), quota}),
    );
  } catch {
    // Persistence failures must not break quota delivery.
  }
}

/**
 * Fetch the signed-in user's personal quota:
 * - Fresh cache (< 60s old, memory or disk) is returned without a network call.
 * - Any failure (network, auth, unparseable body) resolves to null — this
 *   helper must never break a caller's render path.
 */
export async function fetchUserQuota(
  apiKey: string,
  opts: FetchQuotaOpts = {},
): Promise<QuotaInfo | null> {
  const now = opts.now ?? Date.now;

  if (!opts.force) {
    if (memCache && now() - memCache.fetchedAt < QUOTA_CACHE_TTL_MS) {
      return memCache.quota;
    }
    const disk = await readDiskCache(now);
    if (disk) {
      memCache = {fetchedAt: now(), quota: disk};
      return disk;
    }
  }

  try {
    const body = await request<unknown>('/user/quota', {apiKey});
    const quota = parseUserQuota(body);
    if (quota) {
      await writeCache(quota, now);
    }
    return quota;
  } catch {
    // 401/missing_actor, network errors, malformed payloads: no quota either way.
    return null;
  }
}

/** Drop both cache layers so the next fetchUserQuota hits the gateway again. */
export async function clearQuotaCache(): Promise<void> {
  memCache = null;
  try {
    await AsyncStorage.removeItem(QUOTA_CACHE_KEY);
  } catch {
    // Nothing to clean up.
  }
}
