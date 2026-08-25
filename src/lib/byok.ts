/**
 * Bring-your-own-key (BYOK) configuration store.
 *
 * Secrets (the personal API key) live in react-native-keychain under the
 * 'com.moud.sunlight.byok' generic-password service; non-secret metadata
 * (baseUrl, modelId, usePersonalQuota flag) lives in AsyncStorage. If the
 * keychain write fails, everything degrades into AsyncStorage and
 * `byokStorageMode()` reports 'fallback' so callers can warn the user.
 *
 * Routing semantics (three modes):
 * - 'personal'  -> session key against the moud gateway (user's own quota).
 * - 'community' -> session key against the moud gateway (community pool).
 * - 'byok'      -> the user's own endpoint + key instead of the gateway.
 *
 * Legacy compat: the old boolean flag (`usePersonalQuota`, plus the separate
 * '@sunlight_use_community_quota' AsyncStorage value from earlier builds) is
 * migrated on load into the mode enum.
 */
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYCHAIN_SERVICE = 'com.moud.sunlight.byok';
const KEYCHAIN_USERNAME = 'byok';

export const BYOK_META_KEY = '@sunlight_byok_meta';

/**
 * Legacy preference key written by earlier builds. Semantics there were
 * inverted ('use_community_quota'): true meant community, false meant
 * personal/BYOK routing.
 */
export const LEGACY_COMMUNITY_QUOTA_KEY = '@sunlight_use_community_quota';

export type QuotaMode = 'personal' | 'community' | 'byok';

const QUOTA_MODES: ReadonlySet<string> = new Set(['personal', 'community', 'byok']);

export function isQuotaMode(v: unknown): v is QuotaMode {
  return typeof v === 'string' && QUOTA_MODES.has(v);
}

export interface ByokConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

export interface ByokSettings {
  byok: ByokConfig | null;
  /** Active chat-routing mode. */
  mode: QuotaMode;
  /**
   * @deprecated Compat alias kept so pre-mode callers keep compiling and old
   * stored blobs stay readable. True only when routing through BYOK.
   */
  usePersonalQuota: boolean;
}

interface ByokMeta {
  baseUrl: string;
  modelId: string;
  usePersonalQuota: boolean;
  /** Three-state routing mode; absent in blobs written before the migration. */
  quotaMode?: QuotaMode;
  /** False only when the keychain rejected us and we fell back to storage. */
  secretInKeychain: boolean;
}

type StorageMode = 'keychain' | 'fallback';

let lastStorageMode: StorageMode = 'keychain';

/**
 * Storage mode observed during the most recent save/load operation.
 * Defaults to 'keychain' before any operation has run.
 */
export function byokStorageMode(): StorageMode {
  return lastStorageMode;
}

function isValidConfig(cfg: unknown): cfg is ByokConfig {
  if (!cfg || typeof cfg !== 'object') {
    return false;
  }
  const c = cfg as Partial<ByokConfig>;
  return (
    typeof c.baseUrl === 'string' &&
    /^https:\/\//.test(c.baseUrl) &&
    typeof c.apiKey === 'string' &&
    c.apiKey.length > 0 &&
    typeof c.modelId === 'string' &&
    c.modelId.length > 0
  );
}

async function readMeta(): Promise<ByokMeta | null> {
  try {
    const text = await AsyncStorage.getItem(BYOK_META_KEY);
    if (!text) {
      return null;
    }
    const parsed = JSON.parse(text) as Partial<ByokMeta>;
    if (
      typeof parsed?.baseUrl !== 'string' ||
      typeof parsed?.modelId !== 'string' ||
      typeof parsed?.usePersonalQuota !== 'boolean'
    ) {
      return null;
    }
    return {
      baseUrl: parsed.baseUrl,
      modelId: parsed.modelId,
      usePersonalQuota: parsed.usePersonalQuota,
                secretInKeychain: parsed.secretInKeychain !== false,
          ...(isQuotaMode(parsed.quotaMode) ? {quotaMode: parsed.quotaMode} : {}),
    };
  } catch {
    return null;
  }
}

async function readKeychainSecret(): Promise<string | null> {
  try {
    const res = await Keychain.getGenericPassword({service: KEYCHAIN_SERVICE});
    if (!res || !res.password) {
      return null;
    }
    // The secret is stored as plain JSON {"apiKey": "..."} for forward compat.
    try {
      const parsed = JSON.parse(res.password) as {apiKey?: unknown};
      if (typeof parsed?.apiKey === 'string') {
        return parsed.apiKey;
      }
    } catch {
      // Legacy/plain entry: treat the whole password as the key.
    }
    return res.password;
  } catch {
    return null;
  }
}

/**
 * Resolve the active routing mode from stored state, migrating legacy values:
 * 1. A valid `quotaMode` in the meta blob wins.
 * 2. Otherwise a legacy '@sunlight_use_community_quota' value migrates:
 *    'true' -> 'community'; 'false' -> 'byok' when a BYOK config exists,
 *    else 'community'.
 * 3. Otherwise fall back to the legacy meta boolean: true meant BYOK routing
 *    (only meaningful with a config), false meant community.
 */
async function resolveQuotaMode(
  meta: ByokMeta | null,
  byok: ByokConfig | null,
): Promise<QuotaMode> {
  if (meta && isQuotaMode(meta.quotaMode)) {
    return meta.quotaMode;
  }
  try {
    const legacy = await AsyncStorage.getItem(LEGACY_COMMUNITY_QUOTA_KEY);
    if (legacy === 'true') {
      return 'community';
    }
    if (legacy === 'false') {
      return byok ? 'byok' : 'community';
    }
  } catch {
    // Storage read failure falls through to the boolean-flag migration.
  }
  return meta?.usePersonalQuota ? (byok ? 'byok' : 'community') : 'community';
}

/**
 * Load the current BYOK settings. Never throws: a missing or corrupt store
 * yields `{byok: null, mode: 'community', usePersonalQuota: false}` so callers
 * can render the default (community gateway) state.
 */
export async function loadByokSettings(): Promise<ByokSettings> {
  const meta = await readMeta();
  if (!meta) {
    return {byok: null, mode: 'community', usePersonalQuota: false};
  }

  let apiKey: string | null = null;
  if (meta.secretInKeychain) {
    apiKey = await readKeychainSecret();
    lastStorageMode = apiKey ? 'keychain' : 'fallback';
  } else {
    // Fallback mode keeps the secret inside the meta blob itself.
    const raw = await AsyncStorage.getItem(BYOK_META_KEY);
    try {
      const withSecret = JSON.parse(raw ?? '{}') as {apiKey?: unknown};
      apiKey = typeof withSecret.apiKey === 'string' ? withSecret.apiKey : null;
    } catch {
      apiKey = null;
    }
    lastStorageMode = 'fallback';
  }

  const byok =
    apiKey && isValidConfig({baseUrl: meta.baseUrl, apiKey, modelId: meta.modelId})
      ? {baseUrl: meta.baseUrl, apiKey, modelId: meta.modelId}
      : null;

  const mode = await resolveQuotaMode(meta, byok);
  return {byok, mode, usePersonalQuota: mode === 'byok'};
}

/**
 * Derive the initial routing mode for a first-time save from the legacy
 * '@sunlight_use_community_quota' preference, so a user upgrading with a
 * stored BYOK endpoint keeps their previous routing choice on load.
 */
async function legacyInitialMode(): Promise<QuotaMode> {
  try {
    const legacy = await AsyncStorage.getItem(LEGACY_COMMUNITY_QUOTA_KEY);
    if (legacy === 'false') {
      return 'byok';
    }
  } catch {
    // Storage read failure falls back to the community default.
  }
  return 'community';
}

/**
 * Persist a BYOK config. Prefers the keychain for the apiKey; on keychain
 * failure stores the whole config in AsyncStorage ('fallback' mode).
 * Preserves the current usePersonalQuota flag when a meta entry exists.
 */
export async function saveByokConfig(cfg: ByokConfig): Promise<void> {
  if (!isValidConfig(cfg)) {
    throw new Error(
      'invalid ByokConfig: https baseUrl, non-empty apiKey and modelId are required',
    );
  }

  const existing = await readMeta();
  const quotaMode: QuotaMode = existing
    ? (existing.quotaMode ?? (existing.usePersonalQuota ? 'byok' : 'community'))
    : await legacyInitialMode();

  let storedInKeychain = false;
  try {
    const res = await Keychain.setGenericPassword(
      KEYCHAIN_USERNAME,
      JSON.stringify({apiKey: cfg.apiKey}),
      {
        service: KEYCHAIN_SERVICE,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      },
    );
    storedInKeychain = res !== false;
  } catch {
    storedInKeychain = false;
  }

  const meta: ByokMeta & {apiKey?: string} = {
    baseUrl: cfg.baseUrl,
    modelId: cfg.modelId,
    usePersonalQuota: quotaMode === 'byok',
    quotaMode,
    secretInKeychain: storedInKeychain,
  };
  if (!storedInKeychain) {
    meta.apiKey = cfg.apiKey;
  }
  lastStorageMode = storedInKeychain ? 'keychain' : 'fallback';

  await AsyncStorage.setItem(BYOK_META_KEY, JSON.stringify(meta));
}

/** Remove the BYOK config entirely (keychain + meta + quota flag). */
export async function clearByokConfig(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({service: KEYCHAIN_SERVICE});
  } catch {
    // Nothing to clean up or keychain unavailable; still drop the meta blob.
  }
  await AsyncStorage.removeItem(BYOK_META_KEY);
  try {
    await AsyncStorage.removeItem(LEGACY_COMMUNITY_QUOTA_KEY);
  } catch {
    // Nothing to clean up.
  }
  lastStorageMode = 'keychain';
}

/**
 * Persist an explicit routing mode without touching the stored credentials.
 * Also refreshes the legacy boolean inside the blob so pre-migration readers
 * stay coherent ('personal'/'community' map to false there).
 */
export async function setQuotaMode(mode: QuotaMode): Promise<void> {
  const meta = await readMeta();
  const next: ByokMeta = meta
    ? {...meta, quotaMode: mode, usePersonalQuota: mode === 'byok'}
    : {
        baseUrl: '',
        modelId: '',
        usePersonalQuota: mode === 'byok',
        quotaMode: mode,
        secretInKeychain: true,
      };
  await AsyncStorage.setItem(BYOK_META_KEY, JSON.stringify(next));
}

/**
 * @deprecated Use setQuotaMode instead. Kept so existing callers keep
 * compiling until the UI phase lands. Old semantics: true routed chat through
 * the BYOK endpoint; false used the community gateway.
 */
export async function setUsePersonalQuota(v: boolean): Promise<void> {
  await setQuotaMode(v ? 'byok' : 'community');
}
