/**
 * Tests for the gateway model catalog service (src/api/models.ts):
 * normalization of real gateway entries, TTL/cache behavior with an injected
 * clock + fetch, stale-cache fallback on network failure, search ranking and
 * text-model filtering.
 */
import {
  MODELS_CACHE_KEY,
  MODELS_CACHE_TTL_MS,
  normalizeModel,
  fetchGatewayModels,
  searchModels,
  filterTextModels,
  GatewayModel,
} from '../src/api/models';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SAMPLE_RAW = {
  id: 'moud/Qwen-Qwen3-235B-A22B-Instruct-2507',
  object: 'model',
  created: 0,
  owned_by: 'moud',
  moud: {
    capability: 'text',
    category: 'general',
    context_window: 0,
    description: 'Large instruct model',
    candidates: ['moud/other'],
  },
};

type InjectedFetch = NonNullable<
  Parameters<typeof fetchGatewayModels>[0]
>['fetch'];

function okFetch(data: unknown[]): InjectedFetch {
  return async () => ({
    ok: true,
    json: async () => ({data}),
  });
}

function failingFetch(): InjectedFetch {
  return async () => {
    throw new Error('network down');
  };
}

beforeEach(async () => {
  await AsyncStorage.removeItem(MODELS_CACHE_KEY);
});

describe('normalizeModel', () => {
  test('normalizes a real gateway entry, dropping non-catalog fields', () => {
    expect(normalizeModel(SAMPLE_RAW)).toEqual({
      id: 'moud/Qwen-Qwen3-235B-A22B-Instruct-2507',
      capability: 'text',
      category: 'general',
      contextWindow: 0,
      description: 'Large instruct model',
    });
  });

  test('keeps models without a moud block and rejects unusable entries', () => {
    expect(normalizeModel({id: 'moud/bare'})).toEqual({id: 'moud/bare'});
    expect(normalizeModel({moud: {capability: 'text'}})).toBeNull();
    expect(normalizeModel(null)).toBeNull();
    expect(normalizeModel('nope')).toBeNull();
  });
});

describe('fetchGatewayModels', () => {
  const now = () => 1_000_000;

  test('fetches, normalizes and caches the catalog', async () => {
    const fetchFn = jest.fn(okFetch([SAMPLE_RAW, {id: 'moud/bare'}]));
    const models = await fetchGatewayModels({now, fetch: fetchFn});
    expect(models).toHaveLength(2);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const cached = JSON.parse(
      (await AsyncStorage.getItem(MODELS_CACHE_KEY)) ?? 'null',
    );
    expect(cached.fetchedAt).toBe(1_000_000);
    expect(cached.models).toEqual(models);
  });

  test('serves fresh cache without hitting the network', async () => {
    await AsyncStorage.setItem(
      MODELS_CACHE_KEY,
      JSON.stringify({
        fetchedAt: now(),
        models: [{id: 'cached/model'}],
      }),
    );
    const fetchFn = jest.fn(okFetch([SAMPLE_RAW]));
    const models = await fetchGatewayModels({now, fetch: fetchFn});
    expect(models).toEqual([{id: 'cached/model'}]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('refetches once the TTL expires', async () => {
    let clock = 1_000;
    await fetchGatewayModels({now: () => clock, fetch: okFetch([SAMPLE_RAW])});

    // Still fresh: no second network call.
    const fetchFn = jest.fn(okFetch([{id: 'fresh/again'}]));
    clock += MODELS_CACHE_TTL_MS - 1;
    await expect(
      fetchGatewayModels({now: () => clock, fetch: fetchFn}),
    ).resolves.toEqual([normalizeModel(SAMPLE_RAW)]);
    expect(fetchFn).not.toHaveBeenCalled();

    // TTL elapsed: refetch happens.
    clock += 1;
    await expect(
      fetchGatewayModels({now: () => clock, fetch: fetchFn}),
    ).resolves.toEqual([{id: 'fresh/again'}]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test('force=true bypasses a fresh cache', async () => {
    await AsyncStorage.setItem(
      MODELS_CACHE_KEY,
      JSON.stringify({fetchedAt: now(), models: [{id: 'cached/model'}]}),
    );
    const fetchFn = jest.fn(okFetch([{id: 'forced/model'}]));
    await expect(
      fetchGatewayModels({now, fetch: fetchFn, force: true}),
    ).resolves.toEqual([{id: 'forced/model'}]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test('falls back to stale cache when the network fails after TTL', async () => {
    await fetchGatewayModels({now: () => 1_000, fetch: okFetch([SAMPLE_RAW])});
    const later = 1_000 + MODELS_CACHE_TTL_MS + 5;
    await expect(
      fetchGatewayModels({now: () => later, fetch: failingFetch()}),
    ).resolves.toEqual([normalizeModel(SAMPLE_RAW)]);
  });

  test('propagates the error when the network fails with no cache', async () => {
    await expect(
      fetchGatewayModels({now, fetch: failingFetch()}),
    ).rejects.toThrow('network down');
  });
});

describe('searchModels', () => {
  const models: GatewayModel[] = [
    {id: 'zephyr/chat', description: 'The Qwen family chat model'},
    {id: 'qwen/qwen3-235b', description: 'Big general model'},
    {id: 'other/model', category: 'qwen-tools', description: 'misc'},
    {id: 'unrelated/thing', description: 'nothing here'},
  ];

  test('empty query returns all models in input order', () => {
    expect(searchModels(models, '   ')).toEqual(models);
  });

  test('prefix matches rank before substring matches', () => {
    const ranked = searchModels(
      [
        {id: 'x/qwen-turbo'},
        {id: 'qwen/original'},
        {id: 'y/not-qwen'},
      ],
      'qwen',
    );
    expect(ranked.map(m => m.id)).toEqual([
      'qwen/original',
      'x/qwen-turbo',
      'y/not-qwen',
    ]);
  });

  test('matches case-insensitively across id, description and category', () => {
    const hits = searchModels(models, 'QWEN');
    expect(hits.map(m => m.id)).toContain('qwen/qwen3-235b');
    expect(hits.map(m => m.id)).toContain('zephyr/chat');
    expect(hits.map(m => m.id)).toContain('other/model');
    expect(hits.map(m => m.id)).not.toContain('unrelated/thing');
  });
});

describe('filterTextModels', () => {
  test('keeps capability text or unspecified, drops others', () => {
    expect(
      filterTextModels([
        {id: 'a', capability: 'text'},
        {id: 'b'},
        {id: 'c', capability: 'image'},
        {id: 'd', capability: 'embedding'},
      ]),
    ).toEqual([{id: 'a', capability: 'text'}, {id: 'b'}]);
  });
});
