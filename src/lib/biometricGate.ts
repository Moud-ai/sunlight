/**
 * Biometric gating for sensitive operations.
 *
 * Wraps an action behind a biometric prompt (Face ID / fingerprint).
 * Falls back gracefully when biometrics are unavailable — the action
 * proceeds without gating (the device itself is the factor).
 */
import ReactNativeBiometrics from 'react-native-biometrics';

const rnBiometrics = new ReactNativeBiometrics();

export interface BiometricGateResult {
  success: boolean;
  error?: string;
}

/**
 * Prompt the user for biometric authentication before executing `action`.
 * Returns the action's result on success, or throws if biometric fails.
 *
 * Usage:
 *   const devices = await withBiometricGate('Confirm unlink', () =>
 *     request(`/auth/devices/${id}`, {method: 'DELETE', apiKey})
 *   );
 */
export async function withBiometricGate<T>(
  promptMessage: string,
  action: () => Promise<T>,
): Promise<T> {
  const {available, biometryType} = await rnBiometrics.isSensorAvailable();

  if (available && biometryType) {
    const {success} = await rnBiometrics.simplePrompt({
      promptMessage,
      cancelButtonText: 'Cancel',
    });

    if (!success) {
      throw new Error('Biometric authentication cancelled');
    }
  }
  // If biometrics unavailable, proceed without gating — the device
  // itself is the authentication factor.

  return action();
}

/**
 * Check if biometric hardware is available on this device.
 */
export async function isBiometricAvailable(): Promise<boolean> {
  const {available} = await rnBiometrics.isSensorAvailable();
  return available;
}
