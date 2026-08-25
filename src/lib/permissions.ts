/**
 * Android runtime permission helpers (core PermissionsAndroid — no new deps).
 *
 * Every helper resolves to 'granted' | 'denied' | 'blocked':
 * - 'granted'  → proceed.
 * - 'denied'   → user dismissed the dialog; a retry may show it again.
 * - 'blocked'  → "never ask again"; the user must enable the permission in
 *                Android Settings (see BLOCKED_HINT / blockedMessage).
 *
 * On non-Android platforms these helpers report 'granted': iOS prompts are
 * handled inside the underlying libraries (react-native-image-picker,
 * react-native-audio-recorder-player), so callers should not double-gate.
 *
 * The PermissionsAndroid-like surface is injectable for tests.
 */
import {PermissionsAndroid, Platform} from 'react-native';

export type PermissionResult = 'granted' | 'denied' | 'blocked';

/** Static guidance shown when a permission is in the blocked state. */
export const BLOCKED_HINT =
  'Permission is blocked. Enable it in Android Settings → Apps → Sunlight → Permissions.';

export function blockedMessage(what: string): string {
  return `${what} access is blocked. Enable it in Settings → Apps → Sunlight → Permissions.`;
}

/** Minimal structural surface of react-native's PermissionsAndroid. */
export interface PermissionsApi {
  request: (
    permission: string,
    rationale?: {title: string; message: string; buttonPositive: string},
  ) => Promise<'granted' | 'denied' | 'never_ask_again'>;
  /** Flat permission-name → android-permission-string map. */
  PERMISSIONS: Record<string, string>;
}

function api(): PermissionsApi {
  return PermissionsAndroid as unknown as PermissionsApi;
}

function mapStatus(
  status: 'granted' | 'denied' | 'never_ask_again',
): PermissionResult {
  if (status === 'granted') {
    return 'granted';
  }
  return status === 'never_ask_again' ? 'blocked' : 'denied';
}

async function ensure(
  client: PermissionsApi,
  resolvePermission: () => string | null,
  title: string,
  message: string,
): Promise<PermissionResult> {
  if (Platform.OS !== 'android') {
    return 'granted';
  }
  const permission = resolvePermission();
  // Permission constant unavailable on this OS level → nothing to request.
  if (!permission) {
    return 'granted';
  }
  try {
    const status = await client.request(permission, {
      title,
      message,
      buttonPositive: 'OK',
    });
    return mapStatus(status);
  } catch {
    return 'denied';
  }
}

/** RECORD_AUDIO for voice recording. */
export async function requestMicPermission(
  pa?: PermissionsApi,
): Promise<PermissionResult> {
  const client = pa ?? api();
  return ensure(
    client,
    () => client.PERMISSIONS?.RECORD_AUDIO ?? null,
    'Microphone',
    'Sunlight needs microphone access to record voice messages.',
  );
}

/**
 * Gallery/image access: READ_MEDIA_IMAGES on API 33+, READ_EXTERNAL_STORAGE
 * on older levels (maxSdk <= 32 semantics).
 */
export async function requestGalleryPermission(
  pa?: PermissionsApi,
): Promise<PermissionResult> {
  const client = pa ?? api();
  const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : 0;
  return ensure(
    client,
    () =>
      apiLevel >= 33
        ? client.PERMISSIONS?.READ_MEDIA_IMAGES ?? null
        : client.PERMISSIONS?.READ_EXTERNAL_STORAGE ?? null,
    'Photos',
    'Sunlight needs photo access so you can attach images.',
  );
}

/**
 * CAMERA is optional (e.g. QR scanning): when the constant or hardware
 * capability is missing this resolves to 'granted' so optional flows degrade
 * instead of blocking.
 */
export async function requestCameraPermissionIfAvailable(
  pa?: PermissionsApi,
): Promise<PermissionResult> {
  const client = pa ?? api();
  return ensure(
    client,
    () => client.PERMISSIONS?.CAMERA ?? null,
    'Camera',
    'Sunlight needs camera access to scan codes and take photos.',
  );
}
