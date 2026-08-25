/**
 * Tests for the voice recorder helper (src/lib/audio.ts): typed results on
 * every path (permission denied/blocked, native failures) and the
 * {uri, durationMs} success shape.
 *
 * The in-app VoiceRecorder native module surface is mocked via
 * globalThis.__sunlightVoiceRecorderMock (registered in __mocks__/rn-natives.js)
 * and attached to NativeModules before each test.
 */
import {NativeModules} from 'react-native';
import {
  startRecording,
  stopRecording,
  isRecording,
} from '../src/lib/audio';

jest.mock('../src/lib/permissions', () => {
  const g = globalThis as any;
  if (!g.__sunlightMicPermissionMock) {
    g.__sunlightMicPermissionMock = jest.fn();
  }
  return {__esModule: true, requestMicPermission: g.__sunlightMicPermissionMock};
});

function recorder() {
  return (globalThis as any).__sunlightVoiceRecorderMock;
}

function micPermission() {
  return (globalThis as any).__sunlightMicPermissionMock as jest.Mock;
}

beforeEach(async () => {
  jest.clearAllMocks();
  (NativeModules as any).VoiceRecorder = recorder();
  // Reset module-level recorder state if a previous test left a recording
  // dangling.
  if (isRecording()) {
    recorder().stop.mockResolvedValue({
      uri: 'file:///cache/cleanup.wav',
      bytes: 1,
    });
    await stopRecording();
  }
});

describe('startRecording', () => {
  test('happy path: permission granted → typed success with a file path', async () => {
    micPermission().mockResolvedValue('granted');
    recorder().start.mockResolvedValue('/cache/sunlight-voice-a.wav');

    const result = await startRecording();
    expect(result).toEqual({
      ok: true,
      path: '/cache/sunlight-voice-a.wav',
    });
    expect(recorder().start).toHaveBeenCalledTimes(1);
    expect(isRecording()).toBe(true);

    await stopRecording(); // cleanup
  });

  test('denied permission → typed failure without touching the recorder', async () => {
    micPermission().mockResolvedValue('denied');
    const result = await startRecording();
    expect(result).toEqual({
      ok: false,
      reason: 'permission_denied',
      message: expect.any(String),
    });
    expect(recorder().start).not.toHaveBeenCalled();
  });

  test('blocked permission surfaces a Settings hint in the message', async () => {
    micPermission().mockResolvedValue('blocked');
    const result = await startRecording();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('permission_blocked');
      expect(result.message).toContain('Settings');
    }
  });

  test('native start failure → typed start_failed, never throws raw', async () => {
    micPermission().mockResolvedValue('granted');
    recorder().start.mockRejectedValue(
      Object.assign(new Error('AudioRecord init failed'), {code: 'start_failed'}),
    );
    const result = await startRecording();
    expect(result).toEqual({
      ok: false,
      reason: 'start_failed',
      message: 'AudioRecord init failed',
    });
    expect(isRecording()).toBe(false);
  });
});

describe('stopRecording', () => {
  test('returns uri + durationMs on success', async () => {
    micPermission().mockResolvedValue('granted');
    recorder().start.mockResolvedValue('/cache/sunlight-voice-1.wav');
    recorder().stop.mockResolvedValue({
      uri: 'file:///cache/sunlight-voice-1.wav',
      bytes: 4096,
    });

    await startRecording();

    const result = await stopRecording();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.uri).toBe('file:///cache/sunlight-voice-1.wav');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }
    expect(isRecording()).toBe(false);
  });

  test('not_recording when nothing is active', async () => {
    await expect(stopRecording()).resolves.toEqual({
      ok: false,
      reason: 'not_recording',
      message: expect.any(String),
    });
  });

  test('native stop failure → typed stop_failed and state kept for retry', async () => {
    micPermission().mockResolvedValue('granted');
    recorder().start.mockResolvedValue('/cache/sunlight-voice-x.wav');
    await startRecording();

    recorder().stop.mockRejectedValue(new Error('busy'));
    const result = await stopRecording();
    expect(result).toEqual({
      ok: false,
      reason: 'stop_failed',
      message: 'busy',
    });
    expect(isRecording()).toBe(true); // retry stays possible

    // Retry succeeds and clears the state.
    recorder().stop.mockResolvedValue({uri: 'file:///cache/y.wav', bytes: 8});
    await expect(stopRecording()).resolves.toMatchObject({ok: true});
    expect(isRecording()).toBe(false);
  });
});
