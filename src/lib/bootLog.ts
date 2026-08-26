/**
 * bootLog — lightweight cold-start breadcrumb journal.
 *
 * Every boot overwrites the journal with fresh entries; each entry records
 * how far startup reached. If a run ends without 'boot-done' the next launch
 * surfaces the last reached stage (and any fatal error) ON DEVICE, turning
 * un-debuggable failures into actionable text without adb.
 *
 * Deliberately dependency-minimal: only AsyncStorage. Never throws.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@sunlight_boot_log';
const MAX_ENTRIES = 60;

export interface BootLogEntry {
  /** Milliseconds since this run's first mark. */
  at: number;
  stage: string;
  detail?: string;
}

interface Journal {
  /** Entries of the PREVIOUS run (archived at run-start). */
  prev: BootLogEntry[];
  runStartedAt: number | null;
  entries: BootLogEntry[];
}

let runStart: number | null = null;

function emptyJournal(): Journal {
  return {prev: [], runStartedAt: null, entries: []};
}

/** Record a stage. Fire-and-forget; mirrors to console for adb visibility. */
export function bootMark(stage: string, detail?: string): void {
  if (stage === 'run-start') {
    runStart = Date.now();
  }
  const entry: BootLogEntry = {
    at: runStart == null ? 0 : Date.now() - runStart,
    stage,
    ...(detail === undefined ? {} : {detail}),
  };
  console.log(`[boot] ${stage}${detail ? ': ' + detail : ''}`);
  try {
    AsyncStorage.getItem(KEY)
      .then(raw => {
        const journal = raw == null ? emptyJournal() : safelyParse(raw);
        if (stage === 'run-start') {
          journal.prev =
            journal.entries.length > 0 ? journal.entries : journal.prev;
          journal.entries = [];
          journal.runStartedAt = runStart;
        } else {
          if (journal.runStartedAt == null) {
            journal.runStartedAt = runStart ?? Date.now();
          }
          journal.entries.push(entry);
          if (journal.entries.length > MAX_ENTRIES) {
            journal.entries.splice(0, journal.entries.length - MAX_ENTRIES);
          }
        }
        return AsyncStorage.setItem(KEY, JSON.stringify(journal));
      })
      .catch(() => {});
  } catch {
    // Storage unavailable; console breadcrumb above still stands.
  }
}

function safelyParse(raw: string): Journal {
  try {
    const parsed = JSON.parse(raw) as Partial<Journal>;
    if (parsed && Array.isArray(parsed.entries)) {
      return {
        prev: Array.isArray(parsed.prev) ? parsed.prev : [],
        runStartedAt: parsed.runStartedAt ?? null,
        entries: parsed.entries,
      };
    }
  } catch {
    // Corrupt journal: start clean.
  }
  return emptyJournal();
}

/**
 * Last failure recorded in the PREVIOUS run, if that run never reached
 * 'boot-done' (i.e., it died mid-boot). This is what the splash surfaces.
 */
export async function readPreviousFailure(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw == null) {
      return null;
    }
    const journal = safelyParse(raw);
    if (journal.prev.length === 0) {
      return null;
    }
    const reachedDone = journal.prev.some(e => e.stage === 'boot-done');
    if (reachedDone) {
      return null;
    }
    const failure = [...journal.prev]
      .reverse()
      .find(e => e.stage === 'render-error' || e.stage === 'fatal');
    if (failure != null) {
      return `${failure.stage}: ${failure.detail ?? ''}`.trim();
    }
    const last = journal.prev[journal.prev.length - 1];
    return `last stage: ${last.stage}${last.detail ? ' (' + last.detail + ')' : ''}`;
  } catch {
    return null;
  }
}