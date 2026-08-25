/**
 * Tests for the devices service (src/lib/devices.ts): response-shape
 * normalization, 30s TTL cache, and cache invalidation on delete.
 *
 * Global fetch is mocked; the shared request() client carries the transport.
 */
import {
  listDevices,
  deleteDevice,
  normalizeDeviceList,
  clearDevicesCache,
  DeviceRow,
} from '../src/lib/devices';

const ROWS: DeviceRow[] = [
  {key_id: 'k1', name: 'Pixel 8', created_at: '2025-01-01T00:00:00Z', status: 'active'},
];

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function mockFetch(body: unknown): jest.Mock {
  const mock = jest.fn(async () => jsonResponse(200, body));
  (globalThis as any).fetch = mock;
  return mock;
}

beforeEach(() => {
  clearDevicesCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('normalizeDeviceList', () => {
  test('accepts bare arrays and {devices:[...]} envelopes', () => {
    expect(normalizeDeviceList(ROWS)).toEqual(ROWS);
    expect(normalizeDeviceList({devices: ROWS})).toEqual(ROWS);
    expect(normalizeDeviceList(null)).toEqual([]);
    expect(normalizeDeviceList({})).toEqual([]);
  });
});

describe('listDevices', () => {
  test('GETs /auth/devices with the bearer key and normalizes both shapes', async () => {
    const fetchMock = mockFetch({devices: ROWS});
    await expect(listDevices('moud_k')).resolves.toEqual(ROWS);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/auth/devices');
    expect((init as RequestInit).headers).toEqual(
      expect.objectContaining({Authorization: 'Bearer moud_k'}),
    );

    clearDevicesCache();
    mockFetch(ROWS); // bare-array shape
    await expect(listDevices('moud_k')).resolves.toEqual(ROWS);
  });

  test('caches for 30s and refetches after expiry', async () => {
    let ticks = 0;
    const now = () => 1_000_000 + ticks * 10_000;
    const fetchMock = mockFetch({devices: ROWS});

    await listDevices('moud_k', {now});
    ticks++; // +10s: still fresh → cached
    await listDevices('moud_k', {now}); // fresh → cached
    expect(fetchMock).toHaveBeenCalledTimes(1);

    ticks += 3; // now >30s old → stale, refetch
    await listDevices('moud_k', {now});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('force bypasses a fresh cache', async () => {
    const fetchMock = mockFetch({devices: ROWS});
    const now = () => 5_000_000;
    await listDevices('moud_k', {now});
    await listDevices('moud_k', {now, force: true});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('network failures propagate to the caller', async () => {
    (globalThis as any).fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(listDevices('moud_k')).rejects.toBeDefined();
  });
});

describe('deleteDevice', () => {
  test('DELETEs the device path and invalidates the cache', async () => {
    let fetchMock = mockFetch({devices: ROWS});
    const now = () => 1_000_000;
    await listDevices('moud_k', {now});

    // DELETE goes through request() as a non-GET method (no retry layer).
    globalThis.fetch = jest.fn(async () => jsonResponse(200, {})) as any;
    await deleteDevice('moud_k', 'k1');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // Next list must hit the network again (cache was invalidated).
    fetchMock = mockFetch({devices: []});
    await listDevices('moud_k', {now});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
