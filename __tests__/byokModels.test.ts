/**
 * Tests for the BYOK remote model catalog (src/lib/byokModels.ts): OpenAI-
 * compatible response normalization, graceful handling of non-OpenAI error
 * bodies, the 60s in-memory TTL cache and search ranking reuse.
 */
import {
  fetchByokModels,
  normalizeByokModel,
  searchByokModels,
  clearByokModelsCache,
  ByokConfig,
} from '../src/lib/byokModels';

const CFG: ByokConfig = {
  baseUrl: 'https://my-endpoint.example.com/v1',
  apiKey: 'sk-personal-123',
  modelId: 'vendor/my-model',
};

interface FakeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

function makeFetchImpl(
  status: number,
  body: string | unknown,
): jest.Mock<Promise<FakeResponse>> {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  }));
}

function openAiList(ids: string[]) {
  return {object: 'list', data: ids.map(id => ({id, object: 'model'}))};
}

beforeEach(() => {
  clearByokModelsCache();
});

describe('normalizeByokModel', () => {
  test('maps OpenAI entries to GatewayModel-like objects tagged byok', () => {
    expect(normalizeByokModel({id: 'gpt-4o', object: 'model'})).toEqual({
      id: 'gpt-4o',
      capability: 'text',
      source: 'byok',
    });
  });

  test('keeps a usable description when present', () => {
    expect(normalizeByokModel({id: 'llama', description: 'Meta model'})).toEqual({
      id: 'llama',
      capability: 'text',
      source: 'byok',
      description: 'Meta model',
    });
  });

  test('rejects entries without a usable string id', () => {
    expect(normalizeByokModel(null)).toBeNull();
    expect(normalizeByokModel('x')).toBeNull();
    expect(normalizeByokModel({})).toBeNull();
    expect(normalizeByokModel({id: ''})).toBeNull();
    expect(normalizeByokModel({id: 42})).toBeNull();
  });
});

describe('fetchByokModels', () => {
  test('GETs baseUrl/models with Bearer auth and normalizes the list', async () => {
    const fetchImpl = makeFetchImpl(200, openAiList(['m1', 'm2']));
    const result = await fetchByokModels(CFG, {fetchImpl});

    expect(result).toEqual({
      models: [
        {id: 'm1', capability: 'text', source: 'byok'},
        {id: 'm2', capability: 'text', source: 'byok'},
      ],
      error: null,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://my-endpoint.example.com/v1/models');
    expect((init as RequestInit).headers).toEqual(
      expect.objectContaining({Authorization: `Bearer ${CFG.apiKey}`}),
    );
    // Timeout is bounded (~10s contract).
    expect(fetchImpl.mock.calls[0][2]).toBe(10_000);
  });

  test('caches for 60s keyed per config (repeat call does not hit network)', async () => {
    let ticks = 0;
    const now = () => 1_000_000 + ticks * 1000;
    const fetchImpl = makeFetchImpl(200, openAiList(['m1']));

    await fetchByokModels(CFG, {fetchImpl, now});
    ticks++;
    const second = await fetchByokModels(CFG, {fetchImpl, now});

    expect(second.error).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // served from cache
  });

  test('a different baseUrl gets its own cache entry', async () => {
    const now = () => 1_000_000;
    await fetchByokModels(CFG, {fetchImpl: makeFetchImpl(200, openAiList(['a'])), now});
    const other = {...CFG, baseUrl: 'https://other.example.com/v1'};
    const fetchImpl2 = makeFetchImpl(200, openAiList(['b']));
    const result = await fetchByokModels(other, {fetchImpl: fetchImpl2, now});
    expect(result.models.map(m => m.id)).toEqual(['b']);
  });

  test('force bypasses the cache', async () => {
    const now = () => 1_000_000;
    const fetchImpl = makeFetchImpl(200, openAiList(['m1']));
    await fetchByokModels(CFG, {fetchImpl, now});
    await fetchByokModels(CFG, {fetchImpl, now, force: true});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('non-OpenAI error bodies resolve to {models:[], error} instead of throwing', async () => {
    const html = makeFetchImpl(502, '<html>Bad Gateway</html>');
    let result = await fetchByokModels(CFG, {fetchImpl: html});
    expect(result.models).toEqual([]);
    expect(result.error).toContain('HTTP 502');

    const jsonError = makeFetchImpl(401, {error: {message: 'bad key'}});
    result = await fetchByokModels(CFG, {fetchImpl: jsonError});
    expect(result.models).toEqual([]);
    expect(result.error).toBe('HTTP 401: bad key');
  });

  test('non-JSON success bodies are reported as an unexpected format', async () => {
    const fetchImpl = makeFetchImpl(200, '<html>not json</html>');
    const result = await fetchByokModels(CFG, {fetchImpl});
    expect(result.models).toEqual([]);
    expect(result.error).toBe('unexpected response format');
  });

  test('missing data array in an OK body is handled gracefully', async () => {
    const fetchImpl = makeFetchImpl(200, {weird: true});
    const result = await fetchByokModels(CFG, {fetchImpl});
    expect(result.models).toEqual([]);
    expect(result.error).toBe('unexpected response format');
  });

  test('transport failures (timeout/network) never throw out', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('timeout');
    }) as unknown as jest.Mock<Promise<{ok: boolean; status: number; text(): Promise<string>}>>;
    const result = await fetchByokModels(CFG, {fetchImpl: fetchImpl as any});
    expect(result).toEqual({models: [], error: 'connection failed'});
  });

  test('rejects configs without an http(s) baseUrl outright', async () => {
    const result = await fetchByokModels({...CFG, baseUrl: 'ftp://nope'});
    expect(result).toEqual({models: [], error: 'invalid BYOK configuration'});
  });

  test('tolerates endpoints that return a bare array', async () => {
    const fetchImpl = makeFetchImpl(200, [{id: 'bare-1'}]);
    const result = await fetchByokModels(CFG, {fetchImpl});
    expect(result.models).toEqual([{id: 'bare-1', capability: 'text', source: 'byok'}]);
  });
});

describe('searchByokModels', () => {
  test('reuses gateway ranking (prefix before substring)', async () => {
    const {models} = await fetchByokModels(CFG, {
      fetchImpl: makeFetchImpl(200, openAiList(['gpt-x', 'my-gpt-4o', 'gpt-4o'])),
    });
    expect(searchByokModels(models, 'gpt')).toEqual([
      models[0], // 'gpt-x' — id prefix
      models[2], // 'gpt-4o' — id prefix
      models[1], // 'my-gpt-4o' — substring
    ]);
  });

  test('empty query returns everything in input order', async () => {
    const {models} = await fetchByokModels(CFG, {
      fetchImpl: makeFetchImpl(200, openAiList(['b', 'a'])),
    });
    expect(searchByokModels(models, '').map(m => m.id)).toEqual(['b', 'a']);
  });
});
