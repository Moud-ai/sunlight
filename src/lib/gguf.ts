/**
 * gguf.ts — curated GGUF model catalog + download manager for the llama.cpp
 * engine (llama.rn), the SECOND on-device engine alongside ExecuTorch.
 *
 * Design notes:
 * - Catalog entries carry DIRECT HuggingFace `resolve/main` URLs that were all
 *   verified live (HTTP 200 via HEAD) with exact byte sizes recorded from the
 *   `content-length` response header at integration time. Any entry that stops
 *   resolving upstream can be removed from this list without touching callers.
 * - Downloads stream to `{DocumentDirectory}/models/<file>` through
 *   react-native-fs `downloadFile` with progress events (the same FS module the
 *   app already uses elsewhere), and bookkeeping lives in an AsyncStorage
 *   registry (`@sunlight_gguf_models`) keyed by catalog id:
 *   `{[id]: {path, bytes, downloadedAt}}`.
 * - Pure helpers (registry merge/remove/parse, URL validation, progress math)
 *   are extracted as module-level functions so they are unit-testable without
 *   React or native modules.
 *
 * ── F4 applied-optimization notes (research trail, code-level anchors) ──────
 *
 * Quantization choice: Q4_K_M is the community sweet spot for phone-class
 * CPUs/GPUs — k-quants keep perplexity close to Q8 while roughly halving the
 * footprint versus Q8_0/f16; Q4_K_M consistently dominates the
 * quality-vs-size curve in community benchmarks (e.g. xebathic/xebench-style
 * comparisons and r/LocalLLaMA measurements) for 0.5B–2B instruct models,
 * whereas lower quants (Q3/IQ3) degrade small models disproportionately.
 * Exception documented below: SmolLM2-360M ships Q8_0 here because a 360M
 * model already fits comfortably and Q4 quantization noise hurts tiny models
 * more than the saved ~200MB is worth.
 *
 * Engine-level perf levers we set JS-side (see src/hooks/useLlamaChat.ts):
 * - n_ctx 2048: bounded KV cache for phone RAM headroom.
 * - n_threads 0: llama.cpp auto-detects big.LITTLE topology (better than hard
 *   coding core counts across arm64 SoCs).
 * - n_gpu_layers 0: CPU-only decode baseline; OpenCL/Vulkan backends are opt-in
 *   upstream and not yet validated for llama.rn on our targets.
 *
 * Relative engine positioning (why ExecuTorch stays the default):
 * - ExecuTorch .pte with XNNPACK + SpinQuant/LPB quantization reaches roughly
 *   ~50 tok/s for Llama-3.2-1B-class models on recent flagship arm64 devices.
 * - llama.cpp (GGUF, K-quants) CPU decode benchmarks ~20% faster than naive
 *   baselines thanks to its hand-tuned kernels, and wins on model breadth
 *   (any GGUF on HF), but does not yet beat XNNPACK+SpinQuant on the specific
 *   supported .pte models.
 * - Future NPU/heterogeneous anchors: ExecuTorch QNN delegate (Hexagon NPU),
 *   PowerInfer-2-style heterogeneous sparse execution (CPU+NPU+GPU split),
 *   and MobileQuant W8A8 edge quantization. When any of these mature in the
 *   RN ecosystem, the engine toggle added in this feature is the seam.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as RNFS from '@dr.pogodin/react-native-fs';
import {
  startResumableDownload,
  resumeExistingDownload,
  type ResumableDownloadHandle,
} from './download';

/** Picker-id prefix for the llama.cpp engine; mirrors 'local/' for ExecuTorch. */
export const GGUF_PREFIX = 'gguf/';

/** AsyncStorage key holding the downloaded-models registry. */
export const GGUF_REGISTRY_KEY = '@sunlight_gguf_models';

/** Directory (under DocumentDirectoryPath) where GGUF weights are stored. */
export const GGUF_MODELS_DIR = `${RNFS.DocumentDirectoryPath}/models`;

/** One curated GGUF model exposed in the picker's llama.cpp sub-list. */
export interface GgufModelEntry {
  /** Bare catalog id (picker id gets the 'gguf/' prefix). */
  id: string;
  /** Human label rendered in the picker row. */
  label: string;
  /** File name used on disk (last path segment of `url`). */
  file: string;
  /** Direct HF resolve URL, HEAD-verified HTTP 200 at integration time. */
  url: string;
  /** Exact byte size from the verified content-length header. */
  bytes: number;
  /** Quantization tag shown next to the size chip. */
  quant: string;
  /** Marks oversized entries (>4GB) so the picker can badge them. */
  large?: boolean;
}

/**
 * Curated catalog — every URL below was verified live (curl -sIL → HTTP 200)
 * and its byte size recorded from content-length. Sorted smallest-first.
 *
 * | id                     | repo/file                                           | bytes       |
 * |------------------------|-----------------------------------------------------|-------------|
 * | lfm25_230m_q8_0        | LiquidAI/LFM2.5-230M-GGUF …Q8_0.gguf                |   246598496 |
 * | lfm25_350m_q8_0        | LiquidAI/LFM2.5-350M-GGUF …Q8_0.gguf                |   379217632 |
 * | smollm2_360m_q8_0      | HuggingFaceTB/SmolLM2-360M …q8_0.gguf               |   386404992 |
 * | qwen25_0_5b_q4_k_m     | Qwen/Qwen2.5-0.5B-Instruct-GGUF …q4_k_m             |   491400032 |
 * | qwen35_0_8b_q4_k_s     | unsloth/Qwen3.5-0.8B-GGUF …Q4_K_S.gguf              |   508104960 |
 * | lfm2_1_2b_q4_k_m       | liquidai/LFM2-1.2B-GGUF …Q4_K_M.gguf                |   730893248 |
 * | lfm25_1_2b_q4_k_m      | LiquidAI/LFM2.5-1.2B-Instruct-GGUF …Q4_K_M.gguf     |   730895168 |
 * | gemma3_1b_it_q4_k_m    | unsloth/gemma-3-1b-it-GGUF …Q4_K_M.gguf             |   806058272 |
 * | llama32_1b_q4_k_m      | bartowski/Llama-3.2-1B-Instruct-GGUF …Q4_K_M        |   807694464 |
 * | qwen25_1_5b_q4_k_m     | Qwen/Qwen2.5-1.5B-Instruct-GGUF …q4_k_m             |  1117320736 |
 * | qwen3_1_7b_q4_k_m      | ggml-org/Qwen3-1.7B-GGUF …Q4_K_M.gguf               |  1282439264 |
 * | lfm25_2_6b_q4_k_m      | LiquidAI/LFM2.5-2.6B-GGUF …Q4_K_M.gguf              |  1674455040 |
 * | smollm3_3b_q4_k_m      | unsloth/SmolLM3-3B-GGUF …Q4_K_M.gguf                |  1915306528 |
 * | llama32_3b_q4_k_m      | bartowski/Llama-3.2-3B-Instruct-GGUF …Q4_K_M        |  2019377696 |
 * | nanbeige42_3b_q4_k_s   | bartowski/Nanbeige_Nanbeige4.2-3B-GGUF …Q4_K_S      |  2554778784 |
 * | gemma4_e2b_q4_k_m      | unsloth/gemma-4-E2B-it-GGUF …Q4_K_M.gguf            |  3106738272 |
 * | ling30_tiny_q4_k_m     | bartowski/Ling-3.0-tiny-GGUF …Q4_K_M.gguf           | 4917354688 (large) |
 */
export const CURATED_GGUF_MODELS: readonly GgufModelEntry[] = [
  {
    id: 'lfm25_230m_q8_0',
    label: 'LFM2.5 230M',
    file: 'LFM2.5-230M-Q8_0.gguf',
    url: 'https://huggingface.co/LiquidAI/LFM2.5-230M-GGUF/resolve/main/LFM2.5-230M-Q8_0.gguf',
    bytes: 246598496,
    // Q8_0 on purpose: tiny models degrade disproportionately under Q4.
    quant: 'Q8_0',
  },
  {
    id: 'lfm25_350m_q8_0',
    label: 'LFM2.5 350M',
    file: 'LFM2.5-350M-Q8_0.gguf',
    url: 'https://huggingface.co/LiquidAI/LFM2.5-350M-GGUF/resolve/main/LFM2.5-350M-Q8_0.gguf',
    bytes: 379217632,
    quant: 'Q8_0',
  },
  {
    id: 'smollm2_360m_q8_0',
    label: 'SmolLM2 360M',
    file: 'smollm2-360m-instruct-q8_0.gguf',
    url: 'https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct-GGUF/resolve/main/smollm2-360m-instruct-q8_0.gguf',
    bytes: 386404992,
    // Q8_0 on purpose: at 360M params the whole model fits in well under
    // 500MB, and Q4 quantization noise disproportionately hurts tiny models.
    quant: 'Q8_0',
  },
  {
    id: 'qwen25_0_5b_q4_k_m',
    label: 'Qwen2.5 0.5B',
    file: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
    bytes: 491400032,
    quant: 'Q4_K_M',
  },
  {
    id: 'qwen35_0_8b_q4_k_s',
    label: 'Qwen 3.5 0.8B',
    file: 'Qwen3.5-0.8B-Q4_K_S.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_S.gguf',
    bytes: 508104960,
    quant: 'Q4_K_S',
  },
  {
    id: 'lfm2_1_2b_q4_k_m',
    label: 'LFM2 1.2B',
    file: 'LFM2-1.2B-Q4_K_M.gguf',
    url: 'https://huggingface.co/liquidai/LFM2-1.2B-GGUF/resolve/main/LFM2-1.2B-Q4_K_M.gguf',
    bytes: 730893248,
    quant: 'Q4_K_M',
  },
  {
    id: 'lfm25_1_2b_q4_k_m',
    label: 'LFM2.5 1.2B Instruct',
    file: 'LFM2.5-1.2B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF/resolve/main/LFM2.5-1.2B-Instruct-Q4_K_M.gguf',
    bytes: 730895168,
    quant: 'Q4_K_M',
  },
  {
    id: 'gemma3_1b_it_q4_k_m',
    label: 'Gemma 3 1B Instruct',
    file: 'gemma-3-1b-it-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf',
    bytes: 806058272,
    quant: 'Q4_K_M',
  },
  {
    id: 'llama32_1b_q4_k_m',
    label: 'Llama 3.2 1B Instruct',
    file: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    bytes: 807694464,
    quant: 'Q4_K_M',
  },
  {
    id: 'qwen25_1_5b_q4_k_m',
    label: 'Qwen2.5 1.5B',
    file: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    bytes: 1117320736,
    quant: 'Q4_K_M',
  },
  {
    id: 'qwen3_1_7b_q4_k_m',
    label: 'Qwen3 1.7B',
    file: 'Qwen3-1.7B-Q4_K_M.gguf',
    url: 'https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf',
    bytes: 1282439264,
    quant: 'Q4_K_M',
  },
  {
    id: 'lfm25_2_6b_q4_k_m',
    label: 'LFM2.5 2.6B',
    file: 'LFM2.5-2.6B-Q4_K_M.gguf',
    url: 'https://huggingface.co/LiquidAI/LFM2.5-2.6B-GGUF/resolve/main/LFM2.5-2.6B-Q4_K_M.gguf',
    bytes: 1674455040,
    quant: 'Q4_K_M',
  },
  {
    id: 'smollm3_3b_q4_k_m',
    label: 'SmolLM3 3B',
    file: 'SmolLM3-3B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/SmolLM3-3B-GGUF/resolve/main/SmolLM3-3B-Q4_K_M.gguf',
    bytes: 1915306528,
    quant: 'Q4_K_M',
  },
  {
    id: 'llama32_3b_q4_k_m',
    label: 'Llama 3.2 3B Instruct',
    file: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    bytes: 2019377696,
    quant: 'Q4_K_M',
  },
  {
    id: 'nanbeige42_3b_q4_k_s',
    label: 'Nanbeige 4.2 3B',
    file: 'Nanbeige_Nanbeige4.2-3B-Q4_K_S.gguf',
    url: 'https://huggingface.co/bartowski/Nanbeige_Nanbeige4.2-3B-GGUF/resolve/main/Nanbeige_Nanbeige4.2-3B-Q4_K_S.gguf',
    bytes: 2554778784,
    quant: 'Q4_K_S',
  },
  {
    id: 'gemma4_e2b_q4_k_m',
    label: 'Gemma 4 E2B',
    file: 'gemma-4-E2B-it-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf',
    bytes: 3106738272,
    quant: 'Q4_K_M',
  },
  {
    id: 'ling30_tiny_q4_k_m',
    label: 'Ling 3.0 Tiny',
    file: 'Ling-3.0-tiny-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Ling-3.0-tiny-GGUF/resolve/main/Ling-3.0-tiny-Q4_K_M.gguf',
    bytes: 4917354688,
    quant: 'Q4_K_M',
    large: true,
  },
];

/** Registry record persisted per downloaded model. */
export interface GgufRegistryEntry {
  /** Absolute path of the downloaded .gguf file. */
  path: string;
  /** Byte size recorded at download completion. */
  bytes: number;
  /** Epoch ms of download completion. */
  downloadedAt: number;
}

/** AsyncStorage-backed registry shape: catalog id → record. */
export type GgufRegistry = Record<string, GgufRegistryEntry>;


/** 'x' → 'gguf/x'; identity for ids already carrying the prefix. */
export function toPickerId(bareId: string): string {
  return bareId.startsWith(GGUF_PREFIX) ? bareId : GGUF_PREFIX + bareId;
}

/** 'gguf/x' → 'x'; null for anything else (incl. 'local/…'). */
export function fromPickerId(pickerId: string): string | null {
  return pickerId.startsWith(GGUF_PREFIX)
    ? pickerId.slice(GGUF_PREFIX.length)
    : null;
}

/**
 * Parse raw AsyncStorage contents into a registry. Defensive: invalid JSON,
 * arrays, nulls, and malformed entries are dropped instead of throwing so a
 * corrupted registry can never wedge the picker.
 */
export function parseRegistry(raw: string | null): GgufRegistry {
  if (raw === null) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  const out: GgufRegistry = {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof (value as GgufRegistryEntry).path === 'string' &&
      typeof (value as GgufRegistryEntry).bytes === 'number' &&
      typeof (value as GgufRegistryEntry).downloadedAt === 'number'
    ) {
      out[id] = value as GgufRegistryEntry;
    }
  }
  return out;
}

/** Immutable merge of one entry (returns a NEW registry object). */
export function mergeRegistryEntry(
  prev: GgufRegistry,
  id: string,
  entry: GgufRegistryEntry,
): GgufRegistry {
  return {...prev, [id]: entry};
}

/** Immutable removal of one entry (returns a NEW registry object). */
export function removeRegistryEntry(
  prev: GgufRegistry,
  id: string,
): GgufRegistry {
  if (!(id in prev)) {
    return prev;
  }
  const next = {...prev};
  delete next[id];
  return next;
}

/**
 * Download progress sentinel: bytesWritten/contentLength clamped to [0, 1].
 * A missing/non-positive contentLength yields 0 rather than NaN/Infinity so
 * the UI never renders a broken percentage.
 */
export function progressFraction(
  bytesWritten: number,
  contentLength: number,
): number {
  if (!(contentLength > 0)) {
    return 0;
  }
  const frac = bytesWritten / contentLength;
  if (Number.isNaN(frac)) {
    return 0;
  }
  return Math.min(1, Math.max(0, frac));
}

/** Compact human-readable byte size ('491 MB', '1.2 GB'). */
export function humanBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * URL gate for anything this module will download: HTTPS on huggingface.co,
 * a direct `/resolve/main/` link, ending in `.gguf`. Guards against someone
 * editing the catalog into pointing at blob pages, other hosts, or LFS stubs.
 */
export function isValidGgufUrl(url: string): boolean {
  if (!url.startsWith('https://')) {
    return false;
  }
  const rest = url.slice('https://'.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) {
    return false;
  }
  const host = rest.slice(0, slash);
  const path = rest.slice(slash);
  return (
    host === 'huggingface.co' &&
    path.includes('/resolve/main/') &&
    path.endsWith('.gguf')
  );
}

/**
 * Structural validation of a catalog against the invariants the downloader
 * relies on. Returns a list of human-readable problems (empty ⇒ valid); used
 * by tests and cheap enough to assert in debug builds.
 */
export function validateGgufCatalog(
  catalog: readonly GgufModelEntry[],
): string[] {
  const problems: string[] = [];
  const seenIds = new Set<string>();
  for (const entry of catalog) {
    const at = `catalog[${entry.id}]`;
    if (!/^[a-z0-9_]+$/.test(entry.id)) {
      problems.push(`${at}: id must be lowercase slug`);
    }
    if (seenIds.has(entry.id)) {
      problems.push(`${at}: duplicate id`);
    }
    seenIds.add(entry.id);
    if (entry.label.trim().length === 0) {
      problems.push(`${at}: empty label`);
    }
    if (!Number.isInteger(entry.bytes) || entry.bytes <= 0) {
      problems.push(`${at}: bytes must be a positive integer`);
    }
    if (entry.quant.trim().length === 0) {
      problems.push(`${at}: empty quant`);
    }
    if (!isValidGgufUrl(entry.url)) {
      problems.push(`${at}: url is not a direct HF resolve URL`);
    }
    const lastSegment = entry.url.split('/').pop() ?? '';
    if (lastSegment !== entry.file) {
      problems.push(`${at}: file does not match url basename`);
    }
  }
  return problems;
}


function findEntry(id: string): GgufModelEntry {
  const entry = CURATED_GGUF_MODELS.find(m => m.id === id);
  if (!entry) {
    throw new Error(`unknown GGUF model id: ${id}`);
  }
  return entry;
}

/** Absolute on-device path a catalog id downloads to. */
export function localPath(id: string): string {
  return `${GGUF_MODELS_DIR}/${findEntry(id).file}`;
}

/** Read + sanitize the persisted registry. */
export async function loadRegistry(): Promise<GgufRegistry> {
  try {
    return parseRegistry(await AsyncStorage.getItem(GGUF_REGISTRY_KEY));
  } catch {
    return {};
  }
}

/** Persist the registry; failures are swallowed (downloads still succeed). */
export async function saveRegistry(reg: GgufRegistry): Promise<void> {
  try {
    await AsyncStorage.setItem(GGUF_REGISTRY_KEY, JSON.stringify(reg));
  } catch {
    // Storage failures must not break the download pipeline itself.
  }
}

/** True when the registry records the model AND the file still exists. */
export async function isDownloaded(id: string): Promise<boolean> {
  const reg = await loadRegistry();
  const rec = reg[id];
  if (!rec) {
    return false;
  }
  try {
    return await RNFS.exists(rec.path);
  } catch {
    return false;
  }
}

// In-flight download tracking: dedupes concurrent requests for one model and
// keeps a mutable handle box for cancellation.
interface ActiveJob {
  promise: Promise<string>;
  /** Mutable box: populated once the resumable task is created. */
  handle: {current: ResumableDownloadHandle | null};
}
const activeJobs = new Map<string, ActiveJob>();

/**
 * Download a curated GGUF model to DocumentDirectory/models/, streaming
 * progress (0..1) through `onProgress`, and persist it into the registry.
 * Resolves with the absolute file path. Concurrent calls for the same id
 * share one job; different models can download in parallel.
 *
 * Backed by the resumable download layer: the same task id is reused across
 * sessions, so an interrupted download resumes (DownloadManager persists the
 * job) instead of starting from zero.
 */
export async function downloadModel(
  id: string,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const entry = findEntry(id);
  const inflight = activeJobs.get(id);
  if (inflight) {
    return inflight.promise;
  }

  const dest = localPath(id);
  const dlId = `gguf:${id}`;
  const handleBox: {current: ResumableDownloadHandle | null} = {current: null};
  const promise: Promise<string> = new Promise<string>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      fn();
    };

    const handlers = {
      onProgress: (bytesDownloaded: number, bytesTotal: number) => {
        onProgress?.(progressFraction(bytesDownloaded, bytesTotal));
      },
      onDone: () => {
        settle(() => {
          loadRegistry()
            .then(reg => {
              const record: GgufRegistryEntry = {
                path: dest,
                bytes: entry.bytes,
                downloadedAt: Date.now(),
              };
              return saveRegistry(mergeRegistryEntry(reg, id, record));
            })
            .catch(() => {});
          resolve(dest);
        });
      },
      onError: (error: string, code: number) => {
        settle(() => {
          // Remove the partial file so a later retry starts clean.
          RNFS.unlink(dest).catch(() => {});
          reject(
            new Error(`download failed: ${error || 'unknown'} (${code ?? 0})`),
          );
        });
      },
    };

    // Prefer re-attaching a surviving DownloadManager task (app restart,
    // network drop) before starting a brand-new one.
    RNFS.mkdir(GGUF_MODELS_DIR)
      .then(() => resumeExistingDownload(dlId, handlers))
      .then(existing => {
        if (existing != null) {
          handleBox.current = existing;
        } else {
          handleBox.current = startResumableDownload({
            id: dlId,
            url: entry.url,
            destination: dest,
            ...handlers,
          });
        }
      })
      .catch(() => {
        handleBox.current = startResumableDownload({
          id: dlId,
          url: entry.url,
          destination: dest,
          ...handlers,
        });
      });
  });

  activeJobs.set(id, {promise, handle: handleBox});
  return promise;
}

/** Abort an active download (best-effort; no-op when none is running). */
export async function cancelDownload(id: string): Promise<void> {
  const job = activeJobs.get(id);
  if (!job?.handle?.current) {
    return;
  }
  try {
    await job.handle.current.stop();
  } catch {
    // Native side may have already finished the job.
  }
}

/**
 * Delete a downloaded model: abort any active job, remove the file
 * (best-effort) and drop the registry entry.
 */
export async function deleteModel(id: string): Promise<void> {
  findEntry(id);
  await cancelDownload(id);
  const reg = await loadRegistry();
  const rec = reg[id];
  if (rec?.path) {
    await RNFS.unlink(rec.path).catch(() => {});
  }
  await saveRegistry(removeRegistryEntry(reg, id));
}
