/**
 * Firebase Cloud Messaging (FCM) integration for Sunlight.
 *
 * FCM is an opt-in feature gated behind the `sunlightFirebase` gradle
 * property. F-Droid builds ship without it; internal builds enable it.
 * When disabled, `@react-native-firebase/messaging` is not installed and
 * every function below short-circuits without throwing.
 *
 * The SDK must NEVER be imported statically: evaluating the package instant
 * constructs RNFBNativeEventEmitter, whose constructor throws when the
 * native Firebase module is absent — a static import here used to kill the
 * whole app during bundle evaluation on F-Droid-style builds.
 */
import {registerPushToken, unregisterPushToken} from './pushNotifications';

type Messaging = typeof import('@react-native-firebase/messaging');

let messagingModule: Messaging | null = null;

/** Lazily requires the Firebase SDK; null when unavailable (no native module). */
function getMessagingModule(): Messaging | null {
  if (messagingModule == null) {
    try {
      const mod: Messaging = require('@react-native-firebase/messaging');
      messagingModule = mod;
    } catch {
      return null;
    }
  }
  return messagingModule;
}

/** Request notification permission (iOS only; Android auto-grants). */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const mod = getMessagingModule();
    if (mod == null) {
      return false;
    }
    const messaging = mod.getMessaging();
    const authStatus = await mod.requestPermission(messaging);
    return (
      authStatus === mod.AuthorizationStatus.AUTHORIZED ||
      authStatus === mod.AuthorizationStatus.PROVISIONAL
    );
  } catch {
    return false;
  }
}

/** Get the current FCM token. */
export async function getFCMToken(): Promise<string | null> {
  try {
    const mod = getMessagingModule();
    if (mod == null) {
      return null;
    }
    const messaging = mod.getMessaging();
    return await mod.getToken(messaging);
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

    const mod = getMessagingModule();
    if (mod != null) {
      const messagingInstance = mod.getMessaging();
      mod.onTokenRefresh(messagingInstance, async (newToken: string) => {
        await registerPushToken(apiKey, newToken);
      });
    }
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
