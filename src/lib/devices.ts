/**
 * Linked-devices service wrapping the /auth/devices endpoints.
 *
 * GET  /auth/devices          → list (accepts a bare array or {devices:[...]}).
 * DELETE /auth/devices/<key>  → unlink one device.
 *
 * API-call reduction: listings are cached in memory for 30s so screens that
 * remount frequently (Settings) do not re-hit the gateway on every mount.
 * Deleting a device invalidates the cache so the next list is fresh.
 */
import {request} from '../api/client';

export const DEVICES_CACHE_TTL_MS = 30_000;

export interface DeviceRow {
  key_id: string;
  name: string;
  created_at: string;
  status: string;
}

export interface ListDevicesOpts {
  /** Skip the cache and always hit the network. */
  force?: boolean;
  /** Injectable clock for TTL tests; defaults to Date.now. */
  now?: () => number;
}

let memCache: {fetchedAt: number; devices: DeviceRow[]} | null = null;

/** Normalize both accepted response shapes into a device array. */
export function normalizeDeviceList(body: unknown): DeviceRow[] {
  if (Array.isArray(body)) {
    return body as DeviceRow[];
  }
  if (body && typeof body === 'object' && Array.isArray((body as {devices?: unknown}).devices)) {
    return (body as {devices: DeviceRow[]}).devices;
  }
  return [];
}

/**
 * List linked devices for the signed-in user. Fresh cache (< 30s old) is
 * returned without a network call; network failures propagate to the caller.
 */
export async function listDevices(
  apiKey: string,
  opts: ListDevicesOpts = {},
): Promise<DeviceRow[]> {
  const now = opts.now ?? Date.now;

  if (!opts.force && memCache && now() - memCache.fetchedAt < DEVICES_CACHE_TTL_MS) {
    return memCache.devices;
  }

  const body = await request<unknown>('/auth/devices', {apiKey});
  const devices = normalizeDeviceList(body);
  memCache = {fetchedAt: now(), devices};
  return devices;
}

/**
 * Unlink one device. On success the cache is dropped so subsequent lists
 * reflect reality immediately.
 */
export async function deleteDevice(apiKey: string, keyId: string): Promise<void> {
  await request(`/auth/devices/${encodeURIComponent(keyId)}`, {
    method: 'DELETE',
    apiKey,
  });
  memCache = null;
}

/** Drop the cached listing (used by tests and forced refreshes). */
export function clearDevicesCache(): void {
  memCache = null;
}
