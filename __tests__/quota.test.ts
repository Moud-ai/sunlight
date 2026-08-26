/**
 * Tests for the personal quota service (src/lib/quota.ts): defensive parsing
 * across response shape variants, the 60s memory+AsyncStorage TTL cache, and
 * null-on-failure semantics.
 *
 * The transport is exercised through the shared request() client, so the
 * global fetch is mocked (same approach as profile.test.ts).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  parseUserQuota,
  fetchUserQuota,
  clearQuotaCache,
  QUOTA_CACHE_KEY,
  QuotaInfo,
} from '../src/lib/quota';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function mockFetch(body: unknown, status = 200): jest.Mock {
  const mock = jest.fn(async () => jsonResponse(status, body));
  (globalThis as any).fetch = mock;
  return mock;
}

const Q: QuotaInfo = {used: 1200, limit: 850000, remaining: 848800};

beforeEach(async () => {
  await clearQuotaCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('parseUserQuota — shape variants', () => {
  test('accepts flat {used, limit}', () => {
    expect(parseUserQuota({used: 5, limit: 100})).toEqual({
      used: 5,
      limit: 100,
      remaining: 95,
    });
  });

  test('accepts nested quota object', () => {
    expect(parseUserQuota({quota: {used: 10, limit: 20}})).toEqual({
      used: 10,
      limit: 20,
      remaining: 10,
    });
  });

  test('accepts nested usage object', () => {
    expect(parseUserQuota({usage: {used: 3, limit: 9, extra: true}})).toEqual({
      used: 3,
      limit: 9,
      remaining: 6,
    });
  });

  test('accepts token-pair spellings at top level and inside usage', () => {
    expect(parseUserQuota({tokens_used: 4, tokens_limit: 6})).toEqual({
      used: 4,
      limit: 6,
      remaining: 2,
    });
    expect(parseUserQuota({usage: {tokens_used: 1, tokens_limit: 2}})).toEqual({
      used: 1,
      limit: 2,
      remaining: 1,
    });
  });

  test('parses the real gateway user_pool shape as the primary quota', () => {
    expect(
      parseUserQuota({
        user_pool: {
          user_pool_tokens: 850000,
          user_tokens_used: 1200,
          user_tokens_remaining: 848800,
        },
        flagship: {
          'moud/kimi-k3': {allowance: 1000000, used: 0, remaining: 1000000, window_hours: 72},
        },
        shared: {pool_tokens: 9000000, tokens_used: 3, tokens_remaining: 8999997},
      }),
    ).toEqual(Q);
  });

  test('falls back to a flagship allowance when user_pool is absent', () => {
    expect(
      parseUserQuota({
        flagship: {
          'moud/kimi-k3': {allowance: 1000000, used: 100, remaining: 999900, window_hours: 72},
        },
      }),
    ).toEqual({used: 100, limit: 1000000, remaining: 999900});
  });

  test('clamps negative remaining to zero', () => {
    expect(parseUserQuota({used: 15, limit: 10})).toEqual({
      used: 15,
      limit: 10,
      remaining: 0,
    });
  });

  test('rejects non-numeric, missing or negative values', () => {
    // Numeric strings ARE accepted now — many gateways serialize quota
    // numbers as strings, and rejecting them caused the profile quota to
    // display '—'. Only genuinely non-numeric values are rejected.
    expect(parseUserQuota({used: '5', limit: 10})).toEqual({
      used: 5,
      limit: 10,
      remaining: 5,
    });
    // Only-consumption payloads still return, with limit=0 meaning "unknown".
    expect(parseUserQuota({used: 5})).toEqual({used: 5, limit: 0, remaining: 0});
    expect(parseUserQuota({limit: 10})).toBeNull();
    expect(parseUserQuota({used: -1, limit: 10})).toBeNull();
    expect(parseUserQuota({used: Number.NaN, limit: 10})).toBeNull();
    // Non-numeric strings are still rejected.
    expect(parseUserQuota({used: 'abc', limit: 10})).toBeNull();
  });

  test('rejects unusable payloads', () => {
    expect(parseUserQuota(null)).toBeNull();
    expect(parseUserQuota('nope')).toBeNull();
    expect(parseUserQuota({})).toBeNull();
    expect(parseUserQuota({error: {type: 'missing_actor'}})).toBeNull();
  });
});

describe('fetchUserQuota', () => {
  test('hits GET /user/quota with a Bearer key and parses the result', async () => {
    const fetchMock = mockFetch({used: 1, limit: 2});
    await expect(fetchUserQuota('moud_k')).resolves.toEqual({
      used: 1,
      limit: 2,
      remaining: 1,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/user/quota');
    expect((init as RequestInit).headers).toEqual(
      expect.objectContaining({Authorization: 'Bearer moud_k'}),
    );
  });

  test('serves repeat calls from cache within the TTL (one network call)', async () => {
    let ticks = 0;
    const now = () => 1_000_000 + ticks * 1000;
    const fetchMock = mockFetch({used: 7, limit: 10});

    const first = await fetchUserQuota('moud_k', {now});
    ticks++;
    const second = await fetchUserQuota('moud_k', {now});

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1); // cached, no second hit
  });

  test('refetches after the 60s TTL expires', async () => {
    let ticks = 0;
    const now = () => 2_000_000 + ticks * 61_000;
    const fetchMock = mockFetch({used: 0, limit: 5});

    await fetchUserQuota('moud_k', {now});
    ticks++; // now 61s later → stale
    await fetchUserQuota('moud_k', {now});

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('serves a fresh AsyncStorage cache even when memory is cold', async () => {
    // Seed ONLY the disk layer (simulates a fresh process: in-memory cache
    // gone, AsyncStorage entry still within TTL).
    await AsyncStorage.setItem(
      QUOTA_CACHE_KEY,
      JSON.stringify({fetchedAt: 7_000_000, quota: {used: 2, limit: 4, remaining: 2}}),
    );

    const fetchMock = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    (globalThis as any).fetch = fetchMock;

    await expect(fetchUserQuota('moud_k', {now: () => 7_005_000})).resolves.toEqual({
      used: 2,
      limit: 4,
      remaining: 2,
    });
    expect(fetchMock).not.toHaveBeenCalled(); // served from AsyncStorage
  });

  test('returns null on gateway errors without caching anything', async () => {
    mockFetch({type: 'missing_actor'}, 401);
    await expect(fetchUserQuota('bad_key')).resolves.toBeNull();

    // A subsequent good response must not be shadowed by a bad cached entry.
    const good = mockFetch({used: 1, limit: 2});
    await expect(fetchUserQuota('good_key')).resolves.toEqual({
      used: 1,
      limit: 2,
      remaining: 1,
    });
    expect(good).toHaveBeenCalledTimes(1);
  });

  test('returns null on network failure and on unparseable bodies', async () => {
    (globalThis as any).fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(fetchUserQuota('moud_k')).resolves.toBeNull();

    mockFetch({unexpected: 'shape'});
    await expect(fetchUserQuota('moud_k')).resolves.toBeNull();
  });

  test('force bypasses a fresh cache', async () => {
    let ticks = 0;
    const now = () => 5_000_000 + ticks * 1000;
    const fetchMock = mockFetch({used: 1, limit: 2});

    await fetchUserQuota('moud_k', {now});
    ticks++;
    await fetchUserQuota('moud_k', {now, force: true});

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('clearQuotaCache', () => {
  test('drops both cache layers so the next call hits the network', async () => {
    const now = () => 9_000_000;
    let fetchMock = mockFetch({used: 1, limit: 2});
    await fetchUserQuota('moud_k', {now});
    await clearQuotaCache();

    expect(await AsyncStorage.getItem(QUOTA_CACHE_KEY)).toBeNull();

    fetchMock = mockFetch({used: 3, limit: 9});
    await fetchUserQuota('moud_k', {now});
    expect(fetchMock).toHaveBeenCalledTimes(1); // no fresh-cache shortcut
  });
});
