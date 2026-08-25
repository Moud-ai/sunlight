/**
 * Push notification token registration for the Moud gateway.
 *
 * Handles FCM token registration/unregistration with the backend so the
 * server can route device approval push notifications to this device.
 */
import {Platform} from 'react-native';
import {GATEWAY_URL} from '../config';

export interface PushNotificationPayload {
  type: 'device_approval' | 'device_approved' | 'device_rejected';
  device_code?: string;
  user_code?: string;
  device_name?: string;
}

/**
 * Register the FCM token with the Moud gateway so it can send
 * push notifications to this device.
 */
export async function registerPushToken(apiKey: string, fcmToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${GATEWAY_URL}/auth/push/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        token: fcmToken,
        platform: Platform.OS,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Unregister the FCM token (e.g., on sign out).
 */
export async function unregisterPushToken(apiKey: string, fcmToken: string): Promise<void> {
  try {
    await fetch(`${GATEWAY_URL}/auth/push/unregister`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({token: fcmToken}),
    });
  } catch {
    // Best-effort; ignore failures.
  }
}
