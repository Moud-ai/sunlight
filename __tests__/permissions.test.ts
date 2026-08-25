/**
 * Tests for src/lib/permissions.ts permission-state mapping.
 *
 * The PermissionsAndroid-like surface is injected per call, so no global
 * 'react-native' module mocking is needed (a global mock would break every
 * other suite). Only Platform.OS/Version are spied to simulate Android.
 */
import {Platform} from 'react-native';
import {
  requestMicPermission,
  requestGalleryPermission,
  requestCameraPermissionIfAvailable,
  blockedMessage,
  BLOCKED_HINT,
  PermissionsApi,
} from '../src/lib/permissions';

type Status = 'granted' | 'denied' | 'never_ask_again';

/** Original Platform.OS/Version property descriptors, restored after tests. */
const origOs = Object.getOwnPropertyDescriptor(Platform, 'OS');
const origVersion = Object.getOwnPropertyDescriptor(Platform, 'Version');

function setPlatform(os: string, version: number): void {
  // Platform.OS/Version are plain (non-getter) properties in the jest
  // environment, so jest.spyOn(.., 'get') cannot be used here.
  Object.defineProperty(Platform, 'OS', {value: os, configurable: true});
  Object.defineProperty(Platform, 'Version', {value: version, configurable: true});
}

function fakeApi(status: Status, perms?: Record<string, string>): PermissionsApi {
  return {
    request: jest.fn().mockResolvedValue(status),
    PERMISSIONS:
      perms ??
      ({
        RECORD_AUDIO: 'android.permission.RECORD_AUDIO',
        READ_MEDIA_IMAGES: 'android.permission.READ_MEDIA_IMAGES',
        READ_EXTERNAL_STORAGE: 'android.permission.READ_EXTERNAL_STORAGE',
        CAMERA: 'android.permission.CAMERA',
      } as Record<string, string>),
  };
}

beforeEach(() => {
  setPlatform('android', 34);
});

afterAll(() => {
  if (origOs) {
    Object.defineProperty(Platform, 'OS', origOs);
  }
  if (origVersion) {
    Object.defineProperty(Platform, 'Version', origVersion);
  }
});

describe('requestMicPermission', () => {
  test('granted → granted', async () => {
    const pa = fakeApi('granted');
    await expect(requestMicPermission(pa)).resolves.toBe('granted');
    expect(pa.request).toHaveBeenCalledWith(
      'android.permission.RECORD_AUDIO',
      expect.objectContaining({buttonPositive: 'OK'}),
    );
  });

  test('never_ask_again → blocked (user must enable it in Settings)', async () => {
    const pa = fakeApi('never_ask_again');
    await expect(requestMicPermission(pa)).resolves.toBe('blocked');
  });

  test('denied → denied', async () => {
    await expect(requestMicPermission(fakeApi('denied'))).resolves.toBe('denied');
  });
});

describe('requestGalleryPermission', () => {
  test('API >= 33 requests READ_MEDIA_IMAGES', async () => {
    setPlatform('android', 33);
    const pa = fakeApi('granted');
    await requestGalleryPermission(pa);
    expect(pa.request).toHaveBeenCalledWith(
      'android.permission.READ_MEDIA_IMAGES',
      expect.anything(),
    );
  });

  test('API < 33 falls back to READ_EXTERNAL_STORAGE', async () => {
    setPlatform('android', 32);
    const pa = fakeApi('granted');
    await requestGalleryPermission(pa);
    expect(pa.request).toHaveBeenCalledWith(
      'android.permission.READ_EXTERNAL_STORAGE',
      expect.anything(),
    );
  });

  test('maps never_ask_again to blocked', async () => {
    await expect(requestGalleryPermission(fakeApi('never_ask_again'))).resolves.toBe(
      'blocked',
    );
  });
});

describe('requestCameraPermissionIfAvailable', () => {
  test('requests CAMERA when the constant exists', async () => {
    const pa = fakeApi('granted');
    await expect(requestCameraPermissionIfAvailable(pa)).resolves.toBe('granted');
    expect(pa.request).toHaveBeenCalledWith(
      'android.permission.CAMERA',
      expect.anything(),
    );
  });

  test('missing CAMERA constant degrades to granted instead of blocking', async () => {
    const pa = fakeApi('granted');
    // PERMISSIONS lacks CAMERA entirely.
    pa.PERMISSIONS = {RECORD_AUDIO: 'android.permission.RECORD_AUDIO'};
    await expect(requestCameraPermissionIfAvailable(pa)).resolves.toBe('granted');
    expect(pa.request).not.toHaveBeenCalled();
  });
});

describe('platform + failure guards', () => {
  test('non-Android platforms short-circuit to granted without prompting', async () => {
    setPlatform('ios', 18);
    const pa = fakeApi('denied');
    await expect(requestMicPermission(pa)).resolves.toBe('granted');
    expect(pa.request).not.toHaveBeenCalled();
  });

  test('a throwing native request resolves to denied instead of rejecting', async () => {
    const pa = fakeApi('granted');
    (pa.request as jest.Mock).mockRejectedValue(new Error('boom'));
    await expect(requestMicPermission(pa)).resolves.toBe('denied');
  });
});

describe('blocked messaging', () => {
  test('blocked hint points users at Android Settings', () => {
    expect(BLOCKED_HINT).toContain('Settings');
    expect(blockedMessage('Microphone')).toContain('Microphone');
    expect(blockedMessage('Microphone')).toContain('Settings');
  });
});
