/**
 * Secure session storage — how each platform actually protects the keys:
 *
 * iOS (Keychain):
 *   The item is created with kSecAttrAccessible =
 *   WhenUnlockedThisDeviceOnly and kSecAttrAccessControl = BiometryCurrentSet.
 *   That binds the item to the enrolled biometric set: reading it makes the
 *   system present Face ID / Touch ID automatically, items are invalidated if
 *   biometrics are re-enrolled, they never sync to iCloud, and they die with
 *   the device (no iTunes/backup extraction).
 *
 * Android (Keystore):
 *   react-native-keychain stores the payload in EncryptedSharedPreferences /
 *   Keystore-wrapped keys. With accessControl set, the data key lives inside
 *   AndroidKeyStore gated by BiometricPrompt (setInvalidatedByBiometricEnrollment
 *   semantics via BIOMETRY_CURRENT_SET), so the ciphertext is useless without
 *   an unlock. USE_BIOMETRIC permission is declared in the Manifest.
 *
 * Devices WITHOUT enrolled biometrics cannot create an access-controlled item,
 * so saveSession() falls back to a device-only item without the biometric
 * binding; unlockSession() then skips the explicit prompt.
 */
import * as Keychain from 'react-native-keychain';
import ReactNativeBiometrics from 'react-native-biometrics';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SERVICE = 'com.moud.sunlight.session';
const PIN_SERVICE = 'com.moud.sunlight.pin';
const LOCK_MODE_KEY = '@sunlight_lock_mode';

/** How the stored session is unlocked. */
export type LockMode = 'none' | 'pin' | 'biometric';

/** Read the configured lock mode (defaults to 'none'). */
export async function getLockMode(): Promise<LockMode> {
  try {
    const v = await AsyncStorage.getItem(LOCK_MODE_KEY);
    return v === 'pin' || v === 'biometric' ? v : 'none';
  } catch {
    return 'none';
  }
}

/** Persist the lock mode. */
export async function setLockMode(mode: LockMode): Promise<void> {
  try {
    await AsyncStorage.setItem(LOCK_MODE_KEY, mode);
  } catch {
    // Best-effort.
  }
}

/** Store the 4-digit PIN in device-only Keychain. */
export async function setPin(pin: string): Promise<void> {
  try {
    await Keychain.setGenericPassword('pin', pin, {
      service: PIN_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // Best-effort.
  }
}

/** Read the stored PIN (null when unset). */
export async function getPin(): Promise<string | null> {
  try {
    const r = await Keychain.getGenericPassword({service: PIN_SERVICE});
    return r && typeof r === 'object' && r.password ? r.password : null;
  } catch {
    return null;
  }
}

/** Drop the stored PIN. */
export async function clearPin(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({service: PIN_SERVICE});
  } catch {
    // Nothing to clean up.
  }
}

/**
 * Fixed keychain username. Using a constant instead of a possibly-empty keyId
 * keeps entries stable across sessions and platforms.
 */
const KEYCHAIN_USERNAME = 'session';

export interface SunlightSession {
  apiKey: string;
  keyId: string;
  subject: string;
}

const biometrics = new ReactNativeBiometrics({allowDeviceCredentials: true});

/** True when the device can show fingerprint/face/device-credential UI. */
export async function deviceHasBiometrics(): Promise<boolean> {
  try {
    const {available} = await biometrics.isSensorAvailable();
    return available === true;
  } catch {
    return false;
  }
}

function isValidSession(s: any): s is SunlightSession {
  return (
    !!s &&
    typeof s.apiKey === 'string' &&
    s.apiKey.length > 0 &&
    typeof s.keyId === 'string' &&
    typeof s.subject === 'string'
  );
}

export interface UnlockPrompts {
  /** Shown in the biometric prompt. Copy lives in the calling screen. */
  promptMessage?: string;
  cancelButtonText?: string;
}

/**
 * Read + biometric gate in ONE keychain read. The item is bound to
 * BIOMETRY_CURRENT_SET, so reading it already presents the platform prompt
 * natively (Android BiometricPrompt / iOS Face ID). No explicit
 * simplePrompt on top: that stacked a SECOND prompt (double/triple fingerprint)
 * and could fire before the Activity was ready (crash on cold start).
 *
 * Devices without enrolled biometrics saved a non-bound item, so the read
 * returns without a prompt (there is nothing to unlock).
 */
export async function unlockSession(
  prompts?: UnlockPrompts,
): Promise<SunlightSession | null> {
  return readSession({
    authenticationPrompt: {
      title: prompts?.promptMessage ?? 'Unlock Sunlight',
      cancel: prompts?.cancelButtonText ?? 'Cancel',
    },
  });
}

export async function readSession(options?: {
  authenticationPrompt?: {title?: string; cancel?: string};
}): Promise<SunlightSession | null> {
  try {
    const res = await Keychain.getGenericPassword({
      service: SERVICE,
      ...(options?.authenticationPrompt
        ? {authenticationPrompt: options.authenticationPrompt}
        : {}),
    });
    if (!res || !res.password) {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.password);
    } catch {
      // Corrupt or legacy entry: drop it rather than crash on use.
      await Keychain.resetGenericPassword({service: SERVICE});
      return null;
    }
    if (!isValidSession(parsed)) {
      await Keychain.resetGenericPassword({service: SERVICE});
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Session-existence check WITHOUT decrypting. Android checks the prefs entry
 * only (no BiometricPrompt); iOS uses kSecUseAuthenticationUIFail, so this
 * never prompts. Safe to call during cold start / splash.
 */
export async function hasSession(): Promise<boolean> {
  try {
    return await Keychain.hasGenericPassword({service: SERVICE});
  } catch {
    return false;
  }
}

export async function saveSession(
  session: SunlightSession,
  mode: LockMode = 'biometric',
): Promise<void> {
  if (!isValidSession(session)) {
    throw new Error('invalid session: apiKey/keyId/subject required');
  }
  const payload = JSON.stringify(session);
  const base = {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
  if (mode !== 'biometric') {
    // PIN / no-lock sessions are stored device-only WITHOUT the biometric
    // binding, so reading them never prompts.
    await Keychain.setGenericPassword(KEYCHAIN_USERNAME, payload, base);
    return;
  }
  try {
    // Preferred: bind to current biometric enrollment.
    const res = await Keychain.setGenericPassword(KEYCHAIN_USERNAME, payload, {
      ...base,
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET,
    });
    if (res === false) {
      throw new Error('keychain rejected accessControl');
    }
  } catch {
    // Fallback: no enrolled biometrics — still device-only, never backed up.
    await Keychain.setGenericPassword(KEYCHAIN_USERNAME, payload, base);
  }
}

export async function clearSession(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({service: SERVICE});
  } catch {}
}
