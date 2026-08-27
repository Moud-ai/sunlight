/**
 * Resumable download layer for large files (AI model weights).
 *
 * Backed by @kesha-antonov/react-native-background-downloader (Android
 * DownloadManager + foreground service + persistent task registry), so a
 * download survives network drops, backgrounding and even app restarts.
 * This module is safe to import at boot: nothing initializes eagerly — the
 * native piece only spins up on the first createDownloadTask call.
 */
import {
  createDownloadTask,
  getExistingDownloadTasks,
  directories,
  setConfig,
  type DownloadTask,
  type DownloadTaskState,
} from '@kesha-antonov/react-native-background-downloader';
import {Platform} from 'react-native';
import {requestNotificationsPermission} from './permissions';

/** Documents directory for model payloads. */
export const downloadRoot = directories.documents;

export interface ResumableDownloadOptions {
  id: string;
  url: string;
  destination: string;
  begin?: () => void;
  onProgress?: (bytesDownloaded: number, bytesTotal: number) => void;
  onDone?: () => void;
  onError?: (error: string, errorCode: number) => void;
}

export interface ResumableDownloadHandle {
  id: string;
  /** Current task state ('DOWNLOADING', 'PAUSED', 'DONE', ...). */
  state: DownloadTaskState;
  /** Bytes transferred so far (re-attached tasks expose their progress). */
  bytesDownloaded: number;
  bytesTotal: number;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
}

/** Enable download notifications (progress in the shade). Idempotent. */
let configured = false;
export function ensureDownloadNotifications(): void {
  if (configured) {
    return;
  }
  configured = true;
  // Android 13+ (targetSdk 36) needs POST_NOTIFICATIONS before the progress
  // notification can appear. Best-effort: never blocks or breaks the download.
  if (Platform.OS === 'android') {
    requestNotificationsPermission().catch(() => {});
  }
  try {
    setConfig({showNotificationsEnabled: true});
  } catch {
    // Notifications are cosmetic; never break the download over them.
  }
}

function attach(
  task: DownloadTask,
  opts: ResumableDownloadOptions,
): ResumableDownloadHandle {
  task.begin(() => opts.begin?.());
  task.progress(({bytesDownloaded, bytesTotal}) => {
    opts.onProgress?.(bytesDownloaded, bytesTotal);
  });
  task.done(() => opts.onDone?.());
  task.error(({error, errorCode}) => opts.onError?.(error, errorCode));
  return {
    id: task.id,
    state: task.state,
    bytesDownloaded: task.bytesDownloaded,
    bytesTotal: task.bytesTotal,
    pause: () => task.pause(),
    resume: () => task.resume(),
    stop: () => task.stop(),
  };
}

/**
 * Start a new resumable download. Callers should persist the id (e.g. in
 * AsyncStorage) so a future session can re-attach with resumeExistingDownload.
 */
export function startResumableDownload(
  opts: ResumableDownloadOptions,
): ResumableDownloadHandle {
  ensureDownloadNotifications();
  const task = createDownloadTask({
    id: opts.id,
    url: opts.url,
    destination: opts.destination,
  });
  const handle = attach(task, opts);
  task.start();
  return handle;
}

/**
 * Re-attach to a previously-started download. Returns null when no task with
 * that id exists. Handlers can be supplied fresh after an app restart.
 */
export async function resumeExistingDownload(
  id: string,
  opts?: Partial<ResumableDownloadOptions>,
): Promise<ResumableDownloadHandle | null> {
  const tasks = await getExistingDownloadTasks();
  const task = tasks.find(t => t.id === id);
  if (task == null) {
    return null;
  }
  const handle = attach(task, {
    id,
    url: '',
    destination: '',
    ...(opts ?? {}),
  });
  if (task.state === 'PENDING' || task.state === 'PAUSED') {
    await task.resume();
  }
  return handle;
}