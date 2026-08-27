/**
 * Model capability registry.
 *
 * Detects vision/audio support from gateway capability tags and model-id
 * pattern matching. BYOK models (no capability info) default to text-only
 * unless the id matches a known vision/audio pattern.
 */

export interface ModelCapabilities {
  vision: boolean;
  audio: boolean;
}

/** Capability markers treated as vision-capable in a gateway capability tag. */
const VISION_CAPABILITY_RE = /vision|image|multimodal|omni/i;

/** Audio markers in a gateway capability tag. */
const AUDIO_CAPABILITY_RE = /audio|voice|whisper|voxtral/i;

/** Vision markers looked for inside a model id. */
const VISION_ID_RE = /vision|vl|image|omni|-v/i;

/** Audio markers looked for inside a model id. */
const AUDIO_ID_RE = /voxtral|audio|voice|whisper/i;

/**
 * Resolve the capability set for a model.
 *
 * 1. Check the `capability` string from the gateway (vision|image|multimodal|omni, audio|voice|whisper|voxtral).
 * 2. Check the model ID for known patterns (vl|vision|image|omni|-v, voxtral|audio|voice|whisper).
 * 3. For BYOK models (no capability info), assume text-only unless ID matches.
 * 4. Return `{vision: false, audio: false}` for unknown models.
 */
export function getModelCapabilities(
  modelId: string,
  capability?: string,
): ModelCapabilities {
  let vision = false;
  let audio = false;

  // 1. Gateway capability tag
  if (capability !== undefined) {
    if (VISION_CAPABILITY_RE.test(capability)) {
      vision = true;
    }
    if (AUDIO_CAPABILITY_RE.test(capability)) {
      audio = true;
    }
  }

  // 2. Model-ID pattern matching (overwrites if not already set by capability)
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
  models: Array<{id: string; moud?: {capability?: string}}>,
): string | null {
  for (const model of models) {
    const cap = model.moud?.capability;
    if (cap !== undefined && VISION_CAPABILITY_RE.test(cap)) {
      return model.id;
    }
  }
  // Fallback: scan model IDs for vision patterns
  for (const model of models) {
    if (VISION_ID_RE.test(model.id)) {
      return model.id;
    }
  }
  return null;
}
