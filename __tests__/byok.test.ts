/**
 * Tests for the BYOK config store (src/lib/byok.ts): keychain-backed save/
 * load round-trip, graceful AsyncStorage fallback when the keychain rejects,
 * quota-flag persistence and clear semantics.
 *
 * react-native-keychain and AsyncStorage come from __mocks__/rn-natives.js.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import {
  BYOK_META_KEY,
  LEGACY_COMMUNITY_QUOTA_KEY,
  ByokConfig,
  loadByokSettings,
  saveByokConfig,
  clearByokConfig,
  setUsePersonalQuota,
  setQuotaMode,
  byokStorageMode,
} from '../src/lib/byok';

const CFG: ByokConfig = {
  baseUrl: 'https://my-endpoint.example.com',
  apiKey: 'sk-personal-123',
  modelId: 'vendor/my-model',
};

beforeEach(async () => {
  // Reset the shared setup mocks to their pristine behavior.
  (Keychain.setGenericPassword as jest.Mock).mockReset();
  (Keychain.setGenericPassword as jest.Mock).mockResolvedValue({
    service: 's',
    storage: 'k',
  });
  (Keychain.getGenericPassword as jest.Mock).mockReset();
  (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);
  (Keychain.resetGenericPassword as jest.Mock).mockReset();
  (Keychain.resetGenericPassword as jest.Mock).mockResolvedValue(true);
  await AsyncStorage.removeItem(BYOK_META_KEY);
});

describe('saveByokConfig / loadByokSettings', () => {
  test('round-trips through the keychain in the happy path', async () => {
    await saveByokConfig(CFG);

    // Secret went to the keychain under the BYOK service...
    expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
      'byok',
      JSON.stringify({apiKey: CFG.apiKey}),
      expect.objectContaining({service: 'com.moud.sunlight.byok'}),
    );
    // ...and the meta blob holds no secret.
    const meta = JSON.parse(
      (await AsyncStorage.getItem(BYOK_META_KEY)) ?? '{}',
    );
    expect(meta).toEqual({
      baseUrl: CFG.baseUrl,
      modelId: CFG.modelId,
      usePersonalQuota: false,
      quotaMode: 'community',
      secretInKeychain: true,
    });
    expect(byokStorageMode()).toBe('keychain');

    // Wire the mock so a later read returns what was stored.
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
      username: 'byok',
      password: JSON.stringify({apiKey: CFG.apiKey}),
    });
    await expect(loadByokSettings()).resolves.toEqual({
      byok: CFG,
      mode: 'community',
      usePersonalQuota: false,
    });
  });

  test('degrades to AsyncStorage when the keychain write rejects', async () => {
    (Keychain.setGenericPassword as jest.Mock).mockRejectedValue(
      new Error('keychain unavailable'),
    );
    await saveByokConfig(CFG);

    expect(byokStorageMode()).toBe('fallback');
    const meta = JSON.parse(
      (await AsyncStorage.getItem(BYOK_META_KEY)) ?? '{}',
    );
    expect(meta.secretInKeychain).toBe(false);
    expect(meta.apiKey).toBe(CFG.apiKey);

    // Load works without any keychain interaction.
    await expect(loadByokSettings()).resolves.toEqual({
      byok: CFG,
      mode: 'community',
      usePersonalQuota: false,
    });
    expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
  });

  test('reports fallback mode when a keychain-stored secret disappears', async () => {
    await saveByokConfig(CFG);
    // getGenericPassword still resolves false (pristine mock): secret lost.
    const settings = await loadByokSettings();
    expect(settings.byok).toBeNull();
    expect(byokStorageMode()).toBe('fallback');
  });

  test('rejects invalid configs without writing anything', async () => {
    await expect(
      saveByokConfig({baseUrl: 'ftp://bad', apiKey: 'k', modelId: 'm'}),
    ).rejects.toThrow('invalid ByokConfig');
    await expect(saveByokConfig(CFG)).resolves.toBeUndefined();
    expect(await AsyncStorage.getItem(BYOK_META_KEY)).toContain(CFG.baseUrl);
  });

  test('empty store yields default community-gateway settings', async () => {
    await expect(loadByokSettings()).resolves.toEqual({
      byok: null,
      mode: 'community',
      usePersonalQuota: false,
    });
  });
});

describe('setUsePersonalQuota / clearByokConfig', () => {
  test('persists the flag alongside an existing config', async () => {
    await saveByokConfig(CFG);
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
      username: 'byok',
      password: JSON.stringify({apiKey: CFG.apiKey}),
    });

    await setUsePersonalQuota(true);
    await expect(loadByokSettings()).resolves.toEqual({
      byok: CFG,
      mode: 'byok',
      usePersonalQuota: true,
    });

    await setUsePersonalQuota(false);
    await expect(loadByokSettings()).resolves.toMatchObject({
      usePersonalQuota: false,
    });
  });

  test('clear removes both keychain entry and meta blob', async () => {
    await saveByokConfig(CFG);
    await clearByokConfig();

    expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
      service: 'com.moud.sunlight.byok',
    });
    expect(await AsyncStorage.getItem(BYOK_META_KEY)).toBeNull();
    await expect(loadByokSettings()).resolves.toEqual({
      byok: null,
      mode: 'community',
      usePersonalQuota: false,
    });
  });

  test('clear survives a failing keychain reset', async () => {
    await saveByokConfig(CFG);
    (Keychain.resetGenericPassword as jest.Mock).mockRejectedValue(
      new Error('locked'),
    );
    await expect(clearByokConfig()).resolves.toBeUndefined();
    expect(await AsyncStorage.getItem(BYOK_META_KEY)).toBeNull();
  });
});

describe('quota modes (setQuotaMode) and legacy migration', () => {
  beforeEach(async () => {
    // Wire a readable keychain secret so saveByokConfig round-trips.
    await saveByokConfig(CFG);
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
      username: 'byok',
      password: JSON.stringify({apiKey: CFG.apiKey}),
    });
  });

  test('setQuotaMode persists each of the three modes', async () => {
    for (const mode of ['personal', 'community', 'byok'] as const) {
      await setQuotaMode(mode);
      const settings = await loadByokSettings();
      expect(settings.mode).toBe(mode);
      // Deprecated alias stays coherent: only 'byok' means personal routing.
      expect(settings.usePersonalQuota).toBe(mode === 'byok');
    }
  });

  test('deprecated setUsePersonalQuota maps onto the new enum', async () => {
    await setUsePersonalQuota(true);
    await expect(loadByokSettings()).resolves.toMatchObject({mode: 'byok'});

    await setUsePersonalQuota(false);
    await expect(loadByokSettings()).resolves.toMatchObject({mode: 'community'});
  });

  test("legacy '@sunlight_use_community_quota' = true migrates to community", async () => {
    await AsyncStorage.removeItem(BYOK_META_KEY); // no meta blob at all
    await AsyncStorage.setItem(LEGACY_COMMUNITY_QUOTA_KEY, 'true');
    await expect(loadByokSettings()).resolves.toEqual({
      byok: null,
      mode: 'community',
      usePersonalQuota: false,
    });
  });

  test("legacy '@sunlight_use_community_quota' = false maps by BYOK presence", async () => {
    await AsyncStorage.removeItem(BYOK_META_KEY);
    // No BYOK config stored -> degrade to community.
    await AsyncStorage.setItem(LEGACY_COMMUNITY_QUOTA_KEY, 'false');
    await expect(loadByokSettings()).resolves.toMatchObject({
      byok: null,
      mode: 'community',
    });

    // With a config present -> restore BYOK routing.
    await saveByokConfig(CFG);
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
      username: 'byok',
      password: JSON.stringify({apiKey: CFG.apiKey}),
    });
    await expect(loadByokSettings()).resolves.toMatchObject({mode: 'byok'});
  });

  test('a valid quotaMode in the meta blob wins over legacy values', async () => {
    await setQuotaMode('personal');
    await AsyncStorage.setItem(LEGACY_COMMUNITY_QUOTA_KEY, 'false');
    await expect(loadByokSettings()).resolves.toMatchObject({mode: 'personal'});
  });

  test('an unknown quotaMode value falls back through the migration chain', async () => {
    const corrupt = {
      baseUrl: CFG.baseUrl,
      modelId: CFG.modelId,
      usePersonalQuota: false,
      quotaMode: 'galaxy',
      secretInKeychain: true,
    };
    await AsyncStorage.setItem(BYOK_META_KEY, JSON.stringify(corrupt));
    await AsyncStorage.setItem(LEGACY_COMMUNITY_QUOTA_KEY, 'true');
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);
    await expect(loadByokSettings()).resolves.toMatchObject({mode: 'community'});
  });

  test('saveByokConfig rejects plaintext http:// base URLs', async () => {
    await clearByokConfig();
    (Keychain.setGenericPassword as jest.Mock).mockResolvedValue({
      service: 's',
      storage: 'k',
    });
    await expect(
      saveByokConfig({...CFG, baseUrl: 'http://my-endpoint.example.com'}),
    ).rejects.toThrow(/https baseUrl/);
    // Nothing was persisted.
    await expect(loadByokSettings()).resolves.toMatchObject({byok: null});
  });

  test('a stored http:// config is rejected on load', async () => {
    const insecure = {
      baseUrl: 'http://my-endpoint.example.com',
      modelId: CFG.modelId,
      usePersonalQuota: false,
      quotaMode: 'byok',
      secretInKeychain: true,
      apiKey: CFG.apiKey,
    };
    await AsyncStorage.setItem(BYOK_META_KEY, JSON.stringify(insecure));
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
      password: JSON.stringify({apiKey: CFG.apiKey}),
    });
    await expect(loadByokSettings()).resolves.toMatchObject({byok: null});
  });

  test('clear removes the legacy key too', async () => {
    await AsyncStorage.setItem(LEGACY_COMMUNITY_QUOTA_KEY, 'false');
    await clearByokConfig();
    expect(await AsyncStorage.getItem(LEGACY_COMMUNITY_QUOTA_KEY)).toBeNull();
  });
});
