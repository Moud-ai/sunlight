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

const SERVICE = 'com.moud.sunlight.session';

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
 * Explicit biometric gate + read. On iOS with an access-controlled item the
 * system may show its own prompt too; simplePrompt gives us a consistent
 * pre-read gate on both platforms and covers the non-bound fallback case.
 *
 * Devices without biometrics skip the prompt (there is nothing to unlock).
 * All user-facing copy is injected by the caller.
 */
export async function unlockSession(
  prompts?: UnlockPrompts,
): Promise<SunlightSession | null> {
  const hasBio = await deviceHasBiometrics();
  if (hasBio) {
    try {
      const {success} = await biometrics.simplePrompt({
        promptMessage: prompts?.promptMessage ?? 'Unlock',
        cancelButtonText: prompts?.cancelButtonText ?? 'Cancel',
      });
      if (!success) {
        return null;
      }
    } catch {
      return null;
    }
  }
  return readSession();
}

export async function readSession(): Promise<SunlightSession | null> {
  try {
    const res = await Keychain.getGenericPassword({service: SERVICE});
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

export async function saveSession(session: SunlightSession): Promise<void> {
  if (!isValidSession(session)) {
    throw new Error('invalid session: apiKey/keyId/subject required');
  }
  const payload = JSON.stringify(session);
  const base = {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
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
