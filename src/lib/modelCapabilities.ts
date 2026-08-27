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
 */
export function findVisionModel(
  models: Array<{id: string; moud?: {capability?: string; modalities?: string[]}}>,
): string | null {
  // Pass 1: check modalities (most reliable)
  for (const model of models) {
    const mods = model.moud?.modalities;
    if (Array.isArray(mods) && mods.includes('vision')) {
      return model.id;
    }
  }
  // Pass 2: check capability string
  for (const model of models) {
    const cap = model.moud?.capability;
    if (cap !== undefined && VISION_CAPABILITY_RE.test(cap)) {
      return model.id;
    }
  }
  // Pass 3: model ID patterns (weakest signal)
  for (const model of models) {
    if (VISION_ID_RE.test(model.id)) {
      return model.id;
    }
  }
  return null;
}
