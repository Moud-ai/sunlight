/**
 * Tiny diagnosability capture layer.
 *
 * Stores the LAST raw response text (truncated) + timestamp for a named
 * integration ('profile', 'quota', ...) under AsyncStorage
 * `@sunlight_dbg_<key>`. Purpose: recurring device-only failures (avatar,
 * quota) where remote payloads cannot be guessed — the Settings developer
 * section reads these entries back verbatim so bug reports carry ground truth.
 *
 * Never throws: capture failures are swallowed; readDebug resolves to null on
 * any problem.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Max stored payload length (chars). Longer text is truncated. */
export const DEBUG_CAPTURE_MAX_CHARS = 2000;

const KEY_PREFIX = '@sunlight_dbg_';

/** One stored capture entry. */
export interface DebugCapture {
  /** Capture key ('profile' | 'quota'). */
  key: string;
  /** Raw captured text, truncated to DEBUG_CAPTURE_MAX_CHARS. */
  text: string;
  /** Epoch ms of the capture. */
  at: number;
}

function storageKey(key: string): string {
  return `${KEY_PREFIX}${key}`;
}

/**
 * Persist the latest raw capture for [key], truncating to
 * DEBUG_CAPTURE_MAX_CHARS. Overwrites any previous entry. Never throws.
 */
export async function capture(key: string, data: string): Promise<void> {
  const entry: DebugCapture = {
    key,
    text:
      data.length > DEBUG_CAPTURE_MAX_CHARS
        ? `${data.slice(0, DEBUG_CAPTURE_MAX_CHARS)}…[truncated]`
        : data,
    at: Date.now(),
  };
  try {
    await AsyncStorage.setItem(storageKey(key), JSON.stringify(entry));
  } catch {
    // Debug persistence must never break the caller's flow.
  }
}

/** Read back the latest capture for [key], or null when absent/unreadable. */
export async function readDebug(key: string): Promise<DebugCapture | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(key));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<DebugCapture>;
    if (typeof parsed?.text !== 'string') {
      return null;
    }
    return {
      key,
      text: parsed.text,
      at: typeof parsed.at === 'number' ? parsed.at : 0,
    };
  } catch {
    return null;
  }
}
