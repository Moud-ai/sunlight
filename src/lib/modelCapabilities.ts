/**
 * Model capability detection.
 *
 * Source of truth: the gateway's `modalities` array (e.g. ["text", "vision"]).
 * Falls back to `capability` string and model-ID patterns when modalities
 * are unavailable (BYOK models).
 *
 * The old `-v` regex has been removed — it caused false positives on
 * deepseek-v4-flash, deepseek-v3, etc.
 */

export interface ModelCapabilities {
  vision: boolean;
  audio: boolean;
}

/** Capability markers treated as vision-capable in a gateway capability tag. */
const VISION_CAPABILITY_RE = /vision|image|multimodal|omni/i;

/** Audio markers in a gateway capability tag. */
const AUDIO_CAPABILITY_RE = /audio|voice|whisper|voxtral/i;

/** Vision markers looked for inside a model id ( tightened — no `-v` ). */
const VISION_ID_RE = /vision|vl\b|vl[-_.]|image|omni/i;

/** Audio markers looked for inside a model id. */
const AUDIO_ID_RE = /voxtral|audio|voice|whisper/i;

/**
 * Vision fallback chain — models tried in order when the selected model
 * doesn't support vision. If one fails, the next is tried.
 */
const VISION_FALLBACK_CHAIN = [
  'moud/v2.5',
  'moud/xiaomi-mimo-v2.5',
  'moud/xiaomi-mimo-v2-5',
  'moud/mimo-v2.5',
  'moud/mimo-2.5',
];

/**
 * Returns the ordered list of vision model IDs to try as fallback.
 */
export function getVisionFallbackChain(): string[] {
  return VISION_FALLBACK_CHAIN;
}

/**
 * Resolve the capability set for a model.
 *
 * Detection priority:
 *  1. `modalities` array from the gateway (most reliable).
 *  2. `capability` string from the gateway.
 *  3. Model-ID pattern matching (BYOK fallback).
 *  4. Default: text-only.
 */
export function getModelCapabilities(
  modelId: string,
  capability?: string,
  modalities?: string[],
): ModelCapabilities {
  let vision = false;
  let audio = false;

  // 1. Gateway modalities array (source of truth)
  if (Array.isArray(modalities)) {
    if (modalities.includes('vision')) {
      vision = true;
    }
    if (modalities.includes('audio')) {
      audio = true;
    }
    // If modalities is present and explicit, trust it fully — skip other checks
    if (modalities.length > 0) {
      return {vision, audio};
    }
  }

  // 2. Gateway capability tag
  if (capability !== undefined) {
    if (VISION_CAPABILITY_RE.test(capability)) {
      vision = true;
    }
    if (AUDIO_CAPABILITY_RE.test(capability)) {
      audio = true;
    }
  }

  // 3. Model-ID pattern matching (BYOK fallback)
  if (!vision && VISION_ID_RE.test(modelId)) {
    vision = true;
  }
  if (!audio && AUDIO_ID_RE.test(modelId)) {
    audio = true;
  }

  return {vision, audio};
}

/**
 * Find a vision-capable model from a list of gateway models.
 * Tries the fallback chain order first, then falls back to any vision-capable model.
 */
export function findVisionModel(
  models: Array<{id: string; moud?: {capability?: string; modalities?: string[]}}>,
): string | null {
  const availableIds = new Set(models.map(m => m.id));

  // Try the fallback chain first
  for (const chainId of VISION_FALLBACK_CHAIN) {
    if (availableIds.has(chainId)) {
      return chainId;
    }
  }

  // Otherwise, find any vision-capable model
  for (const model of models) {
    const caps = getModelCapabilities(model.id, model.moud?.capability, model.moud?.modalities);
    if (caps.vision) {
      return model.id;
    }
  }

  return null;
}
