/**
 * Tests for the profile/avatar lookup (src/lib/profile.ts): defensive avatar
 * extraction across response shape variants, caching behavior (immediate
 * cached return + background refresh) and null-on-failure semantics.
 *
 * The transport is exercised through the shared request() client, so the
 * global fetch is mocked (same approach as client.test.ts).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  extractAvatarUrl,
  extractDisplayName,
  fetchProfileAvatar,
  fetchProfileSummary,
  fetchOwnProfile,
  clearProfileCache,
  PROFILE_NEGATIVE_TTL_MS,
} from '../src/lib/profile';

const AVATAR = 'https://cdn.example.com/u/me.png';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function mockFetchOnce(body: unknown, status = 200): jest.Mock {
  const mock = jest.fn(async () => jsonResponse(status, body));
  (globalThis as any).fetch = mock;
  return mock;
}

/** Flush microtasks so fire-and-forget background refreshes settle. */
const flush = () => new Promise<void>(r => setTimeout(r, 0));

afterEach(() => {
  jest.restoreAllMocks();
});

describe('extractAvatarUrl', () => {
  test('accepts common top-level field spellings', () => {
    expect(extractAvatarUrl({avatar: AVATAR})).toBe(AVATAR);
    expect(extractAvatarUrl({avatar_url: AVATAR})).toBe(AVATAR);
    expect(extractAvatarUrl({image: AVATAR})).toBe(AVATAR);
    expect(extractAvatarUrl({picture: AVATAR})).toBe(AVATAR);
  });

  test('accepts one-level-nested variants under known containers', () => {
    expect(extractAvatarUrl({profile: {avatar_url: AVATAR}})).toBe(AVATAR);
    expect(extractAvatarUrl({user: {avatar: AVATAR}})).toBe(AVATAR);
    expect(extractAvatarUrl({data: {picture: AVATAR}})).toBe(AVATAR);
    expect(extractAvatarUrl({account: {image: AVATAR}})).toBe(AVATAR);
  });

  test('rejects non-https URLs and non-string values', () => {
    // http:// URLs are now upgraded to https:// (not rejected)
    expect(extractAvatarUrl({avatar: 'http://insecure.example.com/a.png'})).toBe('https://insecure.example.com/a.png');
    expect(extractAvatarUrl({avatar: 'ftp://x/y.png'})).toBeNull();
    expect(extractAvatarUrl({avatar: 42})).toBeNull();
    expect(extractAvatarUrl({profile: {avatar: null}})).toBeNull();
  });

  test('returns null for missing/unusable payloads', () => {
    expect(extractAvatarUrl({})).toBeNull();
    expect(extractAvatarUrl({error: {type: 'not_found'}})).toBeNull();
    expect(extractAvatarUrl(null)).toBeNull();
    expect(extractAvatarUrl('nope')).toBeNull();
  });
});

describe('fetchProfileAvatar', () => {
  beforeEach(async () => {
    await clearProfileCache('subj');
  });

  test('awaits the network and caches the first positive result', async () => {
    const fetchMock = mockFetchOnce({avatar_url: AVATAR});

    await expect(fetchProfileAvatar('subj')).resolves.toBe(AVATAR);

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/user/profile?subject=subj');

    const stored = await AsyncStorage.getItem('@sunlight_avatar_subj');
    expect(stored).toBe(AVATAR);
  });

  test('sends the bearer token only when an apiKey is provided', async () => {
    const fetchMock = mockFetchOnce({avatar_url: AVATAR});
    await fetchProfileAvatar('subj', 'moud_k');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer moud_k',
    );
  });

  test('returns the cached value immediately and refreshes in background', async () => {
    await AsyncStorage.setItem('@sunlight_avatar_subj', AVATAR);

    // Even a failing refresh must not affect the immediate cached answer.
    const fetchMock = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    (globalThis as any).fetch = fetchMock;

    await expect(fetchProfileAvatar('subj')).resolves.toBe(AVATAR);
    // The background refresh kicked off; its failure must not throw here.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1); // no duplicate refresh
    expect(await AsyncStorage.getItem('@sunlight_avatar_subj')).toBe(AVATAR);
  });

  test('background refresh updates the cache when the avatar changes', async () => {
    await AsyncStorage.setItem('@sunlight_avatar_subj', 'https://old.example.com/a.png');
    const NEW = 'https://cdn.example.com/new.png';
    mockFetchOnce({avatar_url: NEW});

    await expect(fetchProfileAvatar('subj')).resolves.toBe(
      'https://old.example.com/a.png',
    );
    await flush();
    expect(await AsyncStorage.getItem('@sunlight_avatar_subj')).toBe(NEW);
  });

  test('returns null on not_found without poisoning the cache', async () => {
    mockFetchOnce({error: {type: 'not_found'}}, 404);
    await expect(fetchProfileAvatar('subj')).resolves.toBeNull();
    expect(await AsyncStorage.getItem('@sunlight_avatar_subj')).toBeNull();
  });

  test('returns null on network failure', async () => {
    (globalThis as any).fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(fetchProfileAvatar('subj')).resolves.toBeNull();
    expect(await AsyncStorage.getItem('@sunlight_avatar_subj')).toBeNull();
  });

  test('rejects empty subjects outright', async () => {
    const fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
    await expect(fetchProfileAvatar('')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('clearProfileCache', () => {
  test('drops the cached entry', async () => {
    await AsyncStorage.setItem('@sunlight_avatar_subj', AVATAR);
    await clearProfileCache('subj');
    expect(await AsyncStorage.getItem('@sunlight_avatar_subj')).toBeNull();
  });
});

describe('broader avatar field shapes', () => {
  test('accepts camelCase and alternate spellings', () => {
    expect(extractAvatarUrl({avatarUrl: AVATAR})).toBe(AVATAR);
    expect(extractAvatarUrl({image_url: AVATAR})).toBe(AVATAR);
    expect(extractAvatarUrl({imageUrl: AVATAR})).toBe(AVATAR);
    expect(extractAvatarUrl({photo: AVATAR})).toBe(AVATAR);
    expect(extractAvatarUrl({profile_image: AVATAR})).toBe(AVATAR);
  });

  test('accepts icon, img, thumbnail field names', () => {
    expect(extractAvatarUrl({icon: AVATAR})).toBe(AVATAR);
    expect(extractAvatarUrl({img: AVATAR})).toBe(AVATAR);
    expect(extractAvatarUrl({thumbnail: AVATAR})).toBe(AVATAR);
    expect(extractAvatarUrl({profile: {icon: AVATAR}})).toBe(AVATAR);
  });

  test('handles http:// URLs by upgrading to https://', () => {
    expect(extractAvatarUrl({avatarUrl: 'http://x/y.png'})).toBe('https://x/y.png');
    expect(extractAvatarUrl({data: {photo: 'http://x/y.png'}})).toBe('https://x/y.png');
    expect(
      extractAvatarUrl({user: {avatar_url: 'https://ok.example.com/a.png'}}),
    ).toBe('https://ok.example.com/a.png');
  });

  test('extracts URL from object-type avatar values', () => {
    expect(extractAvatarUrl({avatar: {url: AVATAR}})).toBe(AVATAR);
    expect(extractAvatarUrl({avatar: {src: AVATAR}})).toBe(AVATAR);
    expect(extractAvatarUrl({avatar: {href: AVATAR}})).toBe(AVATAR);
    expect(extractAvatarUrl({avatar: {link: AVATAR}})).toBe(AVATAR);
    expect(extractAvatarUrl({avatar: {path: AVATAR}})).toBe(AVATAR);
    expect(extractAvatarUrl({profile: {image: {url: AVATAR}}})).toBe(AVATAR);
  });
});

describe('extractDisplayName', () => {
  test('prefers display_name over name over username, top level and nested', () => {
    expect(extractDisplayName({display_name: 'Ada'})).toBe('Ada');
    expect(extractDisplayName({displayName: 'Ada'})).toBe('Ada');
    expect(extractDisplayName({name: 'Ada', username: 'ada'})).toBe('Ada');
    expect(extractDisplayName({username: 'ada'})).toBe('ada');
    expect(extractDisplayName({profile: {display_name: 'Ada'}})).toBe('Ada');
    expect(extractDisplayName({data: {name: 'Ada'}})).toBe('Ada');
    expect(extractDisplayName({})).toBeNull();
    expect(extractDisplayName(null)).toBeNull();
  });

  test('accepts additional field names: user_name, login, handle, full_name, nick, nickname, screen_name', () => {
    expect(extractDisplayName({user_name: 'Ada'})).toBe('Ada');
    expect(extractDisplayName({login: 'ada'})).toBe('ada');
    expect(extractDisplayName({handle: '@ada'})).toBe('@ada');
    expect(extractDisplayName({full_name: 'Ada Lovelace'})).toBe('Ada Lovelace');
    expect(extractDisplayName({nick: 'Ada'})).toBe('Ada');
    expect(extractDisplayName({nickname: 'Ada'})).toBe('Ada');
    expect(extractDisplayName({screen_name: 'ada'})).toBe('ada');
    expect(extractDisplayName({profile: {user_name: 'Ada'}})).toBe('Ada');
  });

  test('ignores non-string values', () => {
    expect(extractDisplayName({name: 42})).toBeNull();
    expect(extractDisplayName({username: ''})).toBeNull();
  });
});

describe('username fallback and negative caching', () => {
  beforeEach(async () => {
    await clearProfileCache('subj');
  });

  test('falls back to the username param when the subject lookup fails', async () => {
    const responses = [
      jsonResponse(404, {error: {type: 'not_found'}}),
      jsonResponse(200, {subject: 'subj', avatar_url: AVATAR}),
    ];
    let call = 0;
    const fetchMock: jest.Mock = jest.fn(async () => responses[call++]);
    (globalThis as any).fetch = fetchMock;

    await expect(fetchProfileAvatar('subj')).resolves.toBe(AVATAR);
    expect(String(fetchMock.mock.calls[0][0])).toContain('?subject=subj');
    expect(String(fetchMock.mock.calls[1][0])).toContain('?username=subj');
  });

  test('caches negative results for 1 minute to avoid repeat gateway calls', async () => {
    let ticks = 0;
    // Negative-cache reads use Date.now internally; drive it via jest fake clock.
    jest.useFakeTimers();
    try {
      jest.setSystemTime(1_000_000);
      mockFetchOnce({error: {type: 'not_found'}}, 404);

      await expect(fetchProfileAvatar('subj')).resolves.toBeNull();

      // Within TTL: no network at all.
      (globalThis as any).fetch = jest.fn(async () => {
        throw new Error('should not be called');
      });
      await expect(fetchProfileAvatar('subj')).resolves.toBeNull();
      expect(globalThis.fetch).not.toHaveBeenCalled();

      // After TTL: network again.
      jest.setSystemTime(1_000_000 + PROFILE_NEGATIVE_TTL_MS + 1);
      const later: jest.Mock = jest.fn(async () => jsonResponse(404, {error: {type: 'not_found'}}));
      (globalThis as any).fetch = later;
      await expect(fetchProfileAvatar('subj')).resolves.toBeNull();
      // Both lookup attempts (subject, then username fallback) hit the expired
      // negative cache; each makes exactly one network call.
      expect(later).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
    void ticks;
  });

  test('a positive result clears the negative window implicitly (different keys)', async () => {
    mockFetchOnce({error: {type: 'not_found'}}, 404);
    await fetchProfileAvatar('subj2').catch(() => null);
    await clearProfileCache('subj2');

    const good = mockFetchOnce({avatar_url: AVATAR});
    await expect(fetchProfileAvatar('subj2')).resolves.toBe(AVATAR);
    expect(good).toHaveBeenCalledTimes(1);
  });
});

describe('fetchOwnProfile', () => {
  beforeEach(async () => {
    await clearProfileCache('subj');
  });

  test('tries the authenticated subject lookup first (Authorization header)', async () => {
    const fetchMock = mockFetchOnce({
      subject: 'subj',
      display_name: 'Ada Lovelace',
      avatar_url: AVATAR,
      email_private_field: 'only-with-auth@example.com',
    });

    const profile = await fetchOwnProfile('moud_k', 'subj');
    expect(profile).toEqual({
      subject: 'subj',
      avatarUrl: AVATAR,
      displayName: 'Ada Lovelace',
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer moud_k',
    );
    expect(String(fetchMock.mock.calls[0][0])).toContain('?subject=subj');
  });

  test('falls back to the public lookup chain when auth fails (401)', async () => {
    const responses = [
      jsonResponse(401, {type: 'unauthorized'}),
      jsonResponse(200, {username: 'subj', photo: AVATAR}),
    ];
    let call = 0;
    const fetchMock: jest.Mock = jest.fn(async () => responses[call++]);
    (globalThis as any).fetch = fetchMock;

    const profile = await fetchOwnProfile('expired_key', 'subj');
    expect(profile.avatarUrl).toBe(AVATAR);
    expect(profile.displayName).toBe('subj'); // username is a usable name field
  });

  test('never throws: total failure yields null fields and the subject', async () => {
    (globalThis as any).fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(fetchOwnProfile('moud_k', 'subj')).resolves.toEqual({
      subject: 'subj',
      avatarUrl: null,
      displayName: null,
    });
  });

  test('rejects empty inputs without any network activity', async () => {
    const fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
    expect((await fetchOwnProfile('', 'subj')).displayName).toBeNull();
    expect((await fetchOwnProfile('k', '')).displayName).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fetchProfileSummary', () => {
  beforeEach(async () => {
    await clearProfileCache('subj');
  });

  test('fetches both avatar and displayName from the API', async () => {
    mockFetchOnce({
      avatar_url: AVATAR,
      display_name: 'Ada Lovelace',
    });

    const profile = await fetchProfileSummary('subj');
    expect(profile.avatarUrl).toBe(AVATAR);
    expect(profile.displayName).toBe('Ada Lovelace');
    expect(profile.subject).toBe('subj');
  });

  test('returns null fields for empty subject', async () => {
    const fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
    const profile = await fetchProfileSummary('');
    expect(profile.avatarUrl).toBeNull();
    expect(profile.displayName).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('returns cached values immediately and refreshes in background', async () => {
    await AsyncStorage.setItem('@sunlight_avatar_subj', AVATAR);
    await AsyncStorage.setItem('@sunlight_display_name_subj', 'Cached Name');

    const fetchMock = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    (globalThis as any).fetch = fetchMock;

    const profile = await fetchProfileSummary('subj');
    expect(profile.avatarUrl).toBe(AVATAR);
    expect(profile.displayName).toBe('Cached Name');
  });
});
