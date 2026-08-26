/**
 * Per-user quota API key.
 *
 * Quota reads go through a DEDICATED key per user (POST /auth/quota-token on
 * the gateway), not the session key directly. The quota key is stored in
 * Keychain, survives session-key rotation, expires after 24h and is re-minted
 * on demand. Keeping it separate means a revoked/rotated session key can still
 * fetch quota once the app re-mints.
 */
import * as Keychain from 'react-native-keychain';
import {request} from '../api/client';

const SERVICE = 'com.moud.sunlight.quota';
const USERNAME = 'quota';

/** Read the cached per-user quota key (null when absent/expired). */
export async function getQuotaKey(): Promise<string | null> {
  try {
    const res = await Keychain.getGenericPassword({service: SERVICE});
    if (res && typeof res === 'object' && res.password) {
      return res.password;
    }
    return null;
  } catch {
    return null;
  }
}

/** Persist the quota key. */
export async function setQuotaKey(key: string): Promise<void> {
  try {
    await Keychain.setGenericPassword(USERNAME, key, {service: SERVICE});
  } catch {
    // Best-effort; re-minted on next use.
  }
}

/** Drop the cached quota key. */
export async function clearQuotaKey(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({service: SERVICE});
  } catch {
    // Nothing to clean up.
  }
}

/**
 * Mint a per-user quota key bound to the authenticated subject
 * (POST /auth/quota-token with the session key). Stores and returns it, or
 * null when the session key cannot mint one (401/stale session).
 */
export async function requestQuotaKey(
  sessionApiKey: string,
): Promise<string | null> {
  try {
    const body = await request<{quota_key?: string}>('/auth/quota-token', {
      method: 'POST',
      apiKey: sessionApiKey,
    });
    if (body && typeof body.quota_key === 'string' && body.quota_key.length > 0) {
      await setQuotaKey(body.quota_key);
      return body.quota_key;
    }
    return null;
  } catch {
    return null;
  }
}