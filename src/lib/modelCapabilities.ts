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
 * Preferred vision models for fallback, in priority order.
 * These are gateway (moud) models that are known to support vision well.
 */
const PREFERRED_VISION_MODELS = [
  /qwen.*3\.[5-8]/i,
  /mimo.*2\.5.*base/i,
  /gemma.*4.*[24]b/i,
];

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
 * Returns the model id of the first match, or null if none found.
 * Prefers models matching PREFERRED_VISION_MODELS (qwen3.5-3.8, mimo 2.5 base, gemma4).
 */
export function findVisionModel(
  models: Array<{id: string; moud?: {capability?: string; modalities?: string[]}}>,
): string | null {
  // Collect all vision-capable models
  const visionModels: string[] = [];
  for (const model of models) {
    const caps = getModelCapabilities(model.id, model.moud?.capability, model.moud?.modalities);
    if (caps.vision) {
      visionModels.push(model.id);
    }
  }
  if (visionModels.length === 0) {
    return null;
  }

  // Prefer models matching preferred patterns
  for (const pattern of PREFERRED_VISION_MODELS) {
    const match = visionModels.find(id => pattern.test(id));
    if (match) {
      return match;
    }
  }

  // Fall back to first vision model found
  return visionModels[0];
}
