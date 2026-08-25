/**
 * Gateway model catalog service.
 *
 * GET /v1/models is PUBLIC (no auth required). The gateway answers with the
 * OpenAI-style envelope:
 *
 *   {"data":[{"id":"moud/Qwen-...","object":"model","created":0,
 *             "owned_by":"...","moud":{"capability":"text","category":
 *             "general","context_window":0,"description":"...",
 *             "candidates":[...]}}]}
 *
 * Entries are normalized to a flat GatewayModel and cached in AsyncStorage
 * under '@sunlight_models_cache_v1' with a 24h TTL. On network failure the
 * stale cache (if any) is served so the model picker keeps working offline.
 *
 * Testability: `now` and `fetch` are injectable via FetchOpts so TTL and
 * transport behavior can be exercised without fake timers or network mocks
 * leaking into other suites.
 */
import {GATEWAY_URL} from '../config';
import {request} from './client';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface GatewayModel {
  id: string;
  capability?: string;
  category?: string;
  contextWindow?: number;
  description?: string;
}

/** Raw `moud` extension block on a gateway model entry. */
interface RawMoudInfo {
  capability?: unknown;
  category?: unknown;
  context_window?: unknown;
  description?: unknown;
}

interface RawGatewayModel {
  id?: unknown;
  moud?: RawMoudInfo | null;
}

interface ModelsCacheEntry {
  fetchedAt: number;
  models: GatewayModel[];
}

export const MODELS_CACHE_KEY = '@sunlight_models_cache_v1';

/** Cache lifetime in milliseconds (24 hours). */
export const MODELS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type InjectedFetch = (url: string) => Promise<{ok: boolean; json(): Promise<unknown>}>;

export interface FetchModelsOpts {
  /** Skip the freshness check and always hit the network. */
  force?: boolean;
  /** Injectable clock for TTL tests; defaults to Date.now. */
  now?: () => number;
  /**
   * Injectable transport for tests. When provided it bypasses request()
   * entirely; production callers never pass it and go through the shared
   * client (with its timeout + retry semantics).
   */
  fetch?: InjectedFetch;
}

/**
 * Normalize one raw gateway entry. Returns null for entries without a usable
 * string id; unknown/missing moud fields are simply omitted.
 */
export function normalizeModel(raw: unknown): GatewayModel | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const rec = raw as RawGatewayModel;
  if (typeof rec.id !== 'string' || rec.id.length === 0) {
    return null;
  }
  const out: GatewayModel = {id: rec.id};
  const m = rec.moud ?? {};
  if (typeof m.capability === 'string' && m.capability.length > 0) {
    out.capability = m.capability;
  }
  if (typeof m.category === 'string' && m.category.length > 0) {
    out.category = m.category;
  }
  if (
    typeof m.context_window === 'number' &&
    Number.isFinite(m.context_window)
  ) {
    out.contextWindow = m.context_window;
  }
  if (typeof m.description === 'string' && m.description.length > 0) {
    out.description = m.description;
  }
  return out;
}

async function readCache(): Promise<ModelsCacheEntry | null> {
  try {
    const text = await AsyncStorage.getItem(MODELS_CACHE_KEY);
    if (!text) {
      return null;
    }
    const parsed = JSON.parse(text) as Partial<ModelsCacheEntry>;
    if (
      typeof parsed?.fetchedAt !== 'number' ||
      !Array.isArray(parsed?.models)
    ) {
      return null;
    }
    return {fetchedAt: parsed.fetchedAt, models: parsed.models};
  } catch {
    // Corrupt cache entry — behave as if there were no cache at all.
    return null;
  }
}

async function writeCache(entry: ModelsCacheEntry): Promise<void> {
  try {
    await AsyncStorage.setItem(MODELS_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Persistence failures must not break catalog delivery.
  }
}

/** Load raw entries either through the injected fetch or the shared client. */
async function loadRawModels(injected?: InjectedFetch): Promise<RawGatewayModel[]> {
  if (injected) {
    const res = await injected(`${GATEWAY_URL}/v1/models`);
    const body = (await res.json()) as {data?: RawGatewayModel[]} | null;
    if (!res.ok) {
      throw new Error(`GET /v1/models failed`);
    }
    return Array.isArray(body?.data) ? body!.data! : [];
  }
  // /v1/models is public; request() works fine unauthenticated.
  const body = await request<{data?: RawGatewayModel[]}>('/v1/models');
  return Array.isArray(body?.data) ? body.data : [];
}

/**
 * Fetch the gateway catalog, backed by the AsyncStorage cache:
 * - Fresh cache (< 24h old) is returned without a network call.
 * - On network error the stale cache is returned when present.
 * - With no usable cache and a failing network, the error propagates.
 */
export async function fetchGatewayModels(
  opts: FetchModelsOpts = {},
): Promise<GatewayModel[]> {
  const now = opts.now ?? Date.now;

  if (!opts.force) {
    const cached = await readCache();
    if (cached && now() - cached.fetchedAt < MODELS_CACHE_TTL_MS) {
      return cached.models;
    }
  }

  try {
    const raws = await loadRawModels(opts.fetch);
    const models: GatewayModel[] = [];
    for (const raw of raws) {
      const normalized = normalizeModel(raw);
      if (normalized) {
        models.push(normalized);
      }
    }
    await writeCache({fetchedAt: now(), models});
    return models;
  } catch (e) {
    const stale = await readCache();
    if (stale) {
      return stale.models;
    }
    throw e;
  }
}

/**
 * Case-insensitive filter over id/description/category with prefix matches
 * ranked before substring matches. Order within each rank preserves input
 * order (stable sort).
 */
export function searchModels(models: GatewayModel[], query: string): GatewayModel[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [...models];
  }
  const PREFIX_ID = 0;
  const PREFIX_OTHER = 1;
  const SUBSTRING = 2;
  const ranked: Array<{model: GatewayModel; rank: number}> = [];
  for (const model of models) {
    const id = model.id.toLowerCase();
    const description = (model.description ?? '').toLowerCase();
    const category = (model.category ?? '').toLowerCase();
    let rank: number | null = null;
    if (id.startsWith(q)) {
      rank = PREFIX_ID;
    } else if (description.startsWith(q) || category.startsWith(q)) {
      rank = PREFIX_OTHER;
    } else if (
      id.includes(q) ||
      description.includes(q) ||
      category.includes(q)
    ) {
      rank = SUBSTRING;
    }
    if (rank !== null) {
      ranked.push({model, rank});
    }
  }
  return ranked.sort((a, b) => a.rank - b.rank).map(r => r.model);
}

/** Keep chat-usable text models: capability 'text' or unspecified. */
export function filterTextModels(models: GatewayModel[]): GatewayModel[] {
  return models.filter(m => m.capability === 'text' || m.capability === undefined);
}
