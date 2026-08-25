/**
 * Firebase Cloud Messaging (FCM) integration for Sunlight.
 *
 * FCM is an opt-in feature gated behind the `sunlightFirebase` gradle
 * property. F-Droid builds ship without it; internal builds enable it.
 * When disabled, `@react-native-firebase/messaging` is not installed and
 * every function below short-circuits without throwing.
 */
import {getMessaging, getToken, onTokenRefresh, requestPermission as requestMessagingPermission, AuthorizationStatus} from '@react-native-firebase/messaging';
import {registerPushToken, unregisterPushToken} from './pushNotifications';

/** Request notification permission (iOS only; Android auto-grants). */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const messaging = getMessaging();
    const authStatus = await requestMessagingPermission(messaging);
    return (
      authStatus === AuthorizationStatus.AUTHORIZED ||
      authStatus === AuthorizationStatus.PROVISIONAL
    );
  } catch {
    return false;
  }
}

/** Get the current FCM token. */
export async function getFCMToken(): Promise<string | null> {
  try {
    const messaging = getMessaging();
    return await getToken(messaging);
  } catch {
    return null;
  }
}

/**
 * Initialize FCM: request permission, get token, register with gateway.
 * Call this after successful login. Silently no-ops when Firebase is
 * unavailable or permission is denied.
 */
export async function initFCM(apiKey: string): Promise<void> {
  try {
    const granted = await requestNotificationPermission();
    if (!granted) {
      return;
    }

    const token = await getFCMToken();
    if (!token) {
      return;
    }

    await registerPushToken(apiKey, token);

    const messagingInstance = getMessaging();
    onTokenRefresh(messagingInstance, async (newToken: string) => {
      await registerPushToken(apiKey, newToken);
    });
  } catch {
    // FCM initialization is best-effort; failures don't block the user.
  }
}

/**
 * Clean up FCM: unregister token from gateway.
 * Call this on sign out.
 */
export async function cleanupFCM(apiKey: string): Promise<void> {
  try {
    const token = await getFCMToken();
    if (token) {
      await unregisterPushToken(apiKey, token);
    }
  } catch {
    // Best-effort; ignore failures.
  }
}
