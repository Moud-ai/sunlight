/**
 * BYOK remote model catalog.
 *
 * Fetches the OpenAI-compatible `GET {baseUrl}/models` listing from a
 * user-configured endpoint (BYOK = bring your own key) and normalizes entries
 * into GatewayModel-like objects tagged with source 'byok'.
 *
 * Error handling is graceful by contract: non-OpenAI bodies (HTML error pages,
 * plain text, unexpected JSON) never throw out of fetchByokModels — callers
 * receive `{models: [], error: "<reason>"}`.
 *
 * API-call reduction: successful listings are cached in memory for 60s keyed
 * by a hash of baseUrl + modelId (+ apiKey) so re-opening the picker does not
 * re-hit the remote endpoint.
 */
import {GatewayModel, searchModels} from '../api/models';
import {fetchWithTimeout} from './fetchWithTimeout';
import {ByokConfig} from './byok';

export type {ByokConfig};

/** GatewayModel plus a provenance tag. */
export type ByokModel = GatewayModel & {source: 'byok'};

export interface ByokModelsResult {
  models: ByokModel[];
  /** null on success; a human-readable reason otherwise. */
  error: string | null;
}

export interface FetchByokModelsOpts {
  /** Skip the cache and always hit the network. */
  force?: boolean;
  /** Injectable clock for TTL tests; defaults to Date.now. */
  now?: () => number;
  /**
   * Injectable transport for tests. When provided it bypasses
   * fetchWithTimeout entirely; production callers never pass it.
   */
  fetchImpl?: (
    url: string,
    init: RequestInit,
    ms: number,
  ) => Promise<{ok: boolean; status: number; text(): Promise<string>}>;
}

const CACHE_TTL_MS = 60_000;
const TIMEOUT_MS = 10_000;

interface CacheEntry {
  fetchedAt: number;
  models: ByokModel[];
}

const cache = new Map<string, CacheEntry>();

/** Small djb2-style hex hash — enough to key an in-memory cache. */
function hashKey(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

function cacheKeyFor(cfg: ByokConfig): string {
  return hashKey(`${cfg.baseUrl}|${cfg.modelId}|${cfg.apiKey}`);
}

/**
 * Normalize one raw OpenAI-compatible model entry. Returns null for entries
 * without a usable non-empty string id.
 */
export function normalizeByokModel(raw: unknown): ByokModel | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const id = (raw as {id?: unknown}).id;
  if (typeof id !== 'string' || id.length === 0) {
    return null;
  }
  const rec = raw as Record<string, unknown>;
  const model: ByokModel = {id, capability: 'text', source: 'byok'};
  if (typeof rec.description === 'string' && rec.description.length > 0) {
    model.description = rec.description;
  }
  return model;
}

async function loadRawList(
  cfg: ByokConfig,
  opts: FetchByokModelsOpts,
): Promise<unknown[]> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/models`;
  const init: RequestInit = {
    method: 'GET',
    headers: {Authorization: `Bearer ${cfg.apiKey}`},
  };

  let res: {ok: boolean; status: number; text(): Promise<string>};
  try {
    res = opts.fetchImpl
      ? await opts.fetchImpl(url, init, TIMEOUT_MS)
      : await fetchWithTimeout(url, init, TIMEOUT_MS);
  } catch {
    throw new Error('connection failed');
  }

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body (HTML error page, plain text, ...).
    throw new Error(
      res.ok
        ? 'unexpected response format'
        : `HTTP ${res.status}`,
    );
  }

  if (!res.ok) {
    const detail =
      parsed && typeof parsed === 'object'
        ? (parsed as {error?: unknown}).error
        : null;
    const message =
      typeof detail === 'string'
        ? detail
        : detail && typeof detail === 'object' && typeof (detail as {message?: unknown}).message === 'string'
          ? (detail as {message: string}).message
          : '';
    throw new Error(`HTTP ${res.status}${message ? `: ${message}` : ''}`);
  }

  if (Array.isArray(parsed)) {
    // Tolerate endpoints that return a bare array instead of {data:[...]}.
    return parsed;
  }
  const data = (parsed as {data?: unknown} | null)?.data;
  if (!Array.isArray(data)) {
    throw new Error('unexpected response format');
  }
  return data;
}

/**
 * Fetch and normalize the BYOK endpoint's model list:
 * - Fresh cache (< 60s old) is returned without a network call.
 * - Any failure resolves to `{models: [], error}` — never throws.
 */
export async function fetchByokModels(
  cfg: ByokConfig,
  opts: FetchByokModelsOpts = {},
): Promise<ByokModelsResult> {
  if (
    !cfg ||
    typeof cfg.baseUrl !== 'string' ||
    !/^https:\/\//.test(cfg.baseUrl)
  ) {
    return {models: [], error: 'invalid BYOK configuration'};
  }

  const now = opts.now ?? Date.now;
  const key = cacheKeyFor(cfg);

  if (!opts.force) {
    const cached = cache.get(key);
    if (cached && now() - cached.fetchedAt < CACHE_TTL_MS) {
      return {models: cached.models, error: null};
    }
  }

  try {
    const raws = await loadRawList(cfg, opts);
    const models: ByokModel[] = [];
    for (const raw of raws) {
      const normalized = normalizeByokModel(raw);
      if (normalized) {
        models.push(normalized);
      }
    }
    cache.set(key, {fetchedAt: now(), models});
    return {models, error: null};
  } catch (e) {
    return {
      models: [],
      error: e instanceof Error ? e.message : 'request failed',
    };
  }
}

/**
 * Ranked search over a BYOK model list, reusing the gateway ranking rules
 * (prefix matches before substrings, case-insensitive over id/description).
 */
export function searchByokModels(models: ByokModel[], query: string): ByokModel[] {
  return searchModels(models, query) as ByokModel[];
}

/** Drop every cached BYOK listing (used by tests and forced refreshes). */
export function clearByokModelsCache(): void {
  cache.clear();
}
