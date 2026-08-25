/**
 * Thin voice-recording helper backed by the in-app VoiceRecorder native
 * module (Kotlin AudioRecord → RIFF/WAVE writer, see
 * android/app/src/main/java/com/moud/sunlight/VoiceRecorderModule.kt).
 *
 * Surface is intentionally tiny:
 * - startRecording() → requests mic permission (src/lib/permissions), then
 *   starts a raw PCM (16 kHz mono 16-bit) recording under the OS cache
 *   directory, finalized as a .wav file on stop.
 * - stopRecording()  → stops and returns {uri, durationMs} (duration measured
 *   wall-clock JS-side; native only guarantees start/stop semantics).
 *
 * WAV output keeps recordings directly consumable by OpenAI-compatible
 * audio-input APIs (Whisper, Voxtral, GPT-4o-audio), which do not accept
 * the previous AAC/M4A container.
 *
 * Never throws raw: every failure path resolves to a typed
 * {ok:false, reason, message} result so callers can render a message without
 * try/catch gymnastics.
 */
import {NativeModules} from 'react-native';
import {requestMicPermission} from './permissions';

export type StartFailureReason =
  | 'already_recording'
  | 'permission_denied'
  | 'permission_blocked'
  | 'unavailable'
  | 'start_failed';

export type StopFailureReason = 'not_recording' | 'stop_failed' | 'unavailable';

export type StartRecordingResult =
  | {ok: true; path: string}
  | {ok: false; reason: StartFailureReason; message: string};

export type StopRecordingResult =
  | {ok: true; uri: string; durationMs: number}
  | {ok: false; reason: StopFailureReason; message: string};

interface VoiceRecorderNative {
  start(): Promise<string>;
  stop(): Promise<{uri: string; bytes: number}>;
  cancel(): Promise<boolean>;
}

function getNative(): VoiceRecorderNative | null {
  const mod = (NativeModules as Record<string, unknown>).VoiceRecorder as
    | VoiceRecorderNative
    | undefined;
  return mod ?? null;
}

let startedAt: number | null = null;
let activePath: string | null = null;

/** True while a recording started by this helper is still running. */
export function isRecording(): boolean {
  return activePath !== null;
}

/** Build a cache-dir path for a new recording. Exported for tests. */
export function buildRecordingPath(cacheDir?: string): string {
  const dir = cacheDir ?? '';
  return `${dir}/sunlight-voice-${Date.now()}.wav`;
}

/**
 * Request mic permission and start recording. Permission denials map to typed
 * failures ('permission_denied' / 'permission_blocked'); everything else that
 * goes wrong collapses into 'start_failed'.
 */
export async function startRecording(): Promise<StartRecordingResult> {
  if (activePath) {
    return {
      ok: false,
      reason: 'already_recording',
      message: 'A recording is already in progress.',
    };
  }

  const permission = await requestMicPermission();
  if (permission === 'denied') {
    return {
      ok: false,
      reason: 'permission_denied',
      message: 'Microphone permission was denied.',
    };
  }
  if (permission === 'blocked') {
    return {
      ok: false,
      reason: 'permission_blocked',
      message:
        'Microphone access is blocked. Enable it in Settings → Apps → Sunlight → Permissions.',
    };
  }

  const native = getNative();
  if (!native) {
    return {
      ok: false,
      reason: 'unavailable',
      message: 'Voice recording is not available on this platform yet.',
    };
  }

  try {
    const path = await native.start();
    activePath = path;
    startedAt = Date.now();
    return {ok: true, path};
  } catch (e) {
    activePath = null;
    startedAt = null;
    const code = (e as {code?: string})?.code;
    if (code === 'already_recording') {
      return {
        ok: false,
        reason: 'already_recording',
        message: 'A recording is already in progress.',
      };
    }
    return {
      ok: false,
      reason: 'start_failed',
      message: e instanceof Error ? e.message : 'Failed to start recording.',
    };
  }
}

/**
 * Stop the active recording. Returns the file uri plus accumulated duration;
 * 'not_recording' when nothing is in flight, 'stop_failed' if the native
 * layer errors out.
 */
export async function stopRecording(): Promise<StopRecordingResult> {
  if (!activePath || startedAt === null) {
    return {
      ok: false,
      reason: 'not_recording',
      message: 'No recording is in progress.',
    };
  }
  const path = activePath;
  const durationMs = Date.now() - startedAt;
  const native = getNative();
  if (!native) {
    activePath = null;
    startedAt = null;
    return {
      ok: false,
      reason: 'unavailable',
      message: 'Voice recording is not available on this platform yet.',
    };
  }
  try {
    const result = await native.stop();
    activePath = null;
    startedAt = null;
    const uri =
      result?.uri && result.uri.length > 0 ? result.uri : `file://${path}`;
    return {ok: true, uri, durationMs};
  } catch (e) {
    // Keep activePath so a retry of stopRecording stays possible.
    return {
      ok: false,
      reason: 'stop_failed',
      message: e instanceof Error ? e.message : 'Failed to stop recording.',
    };
  }
}
