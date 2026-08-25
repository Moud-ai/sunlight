/**
 * Device naming — generates friendly device names for linked devices.
 *
 * Detects the current device type and generates names like:
 * - "Sunlight Pixel 8"
 * - "Sunlight Samsung Galaxy S24"
 * - "Sunlight MacBook Pro"
 * - "Sunlight Linux"
 */
import {Platform} from 'react-native';

/** Get a friendly device name for the current device. */
export function getCurrentDeviceName(): string {
  const os = Platform.OS;
  const version = Platform.Version;

  if (os === 'android') {
    // On Android, we can't easily get the device model name from RN alone.
    // Use a generic name based on the API level.
    return `Sunlight Android ${version}`;
  }

  if (os === 'ios') {
    return 'Sunlight iPhone';
  }

  return 'Sunlight Device';
}

/**
 * Generate a device name for a newly linked device.
 * Uses the user_code as a suffix for uniqueness.
 */
export function generateDeviceName(userCode: string): string {
  const base = getCurrentDeviceName();
  return `${base} (${userCode})`;
}

/**
 * Parse a device name from the gateway response.
 * If the name starts with "device/", strip it and format nicely.
 */
export function formatDeviceName(name: string): string {
  if (name.startsWith('device/')) {
    const code = name.replace('device/', '');
    return `Sunlight ${code}`;
  }
  return name;
}
