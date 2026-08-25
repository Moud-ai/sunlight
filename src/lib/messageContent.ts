/**
 * Pure builders for OpenAI-compatible multimodal message content.
 *
 * The chat transport (src/api/chat.ts) JSON-stringifies whatever sits in
 * `messages[].content`, so a user turn may be either:
 * - a plain string (text-only turns, unchanged behavior), or
 * - an array of typed content parts (vision / audio attachments):
 *
 *   [{type:'text',text}, {type:'image_url',image_url:{url:dataUri}},
 *    {type:'input_audio',input_audio:{data:<base64>,format}}]
 *
 * Everything here is pure and synchronous: callers read files to base64 and
 * gate permissions before invoking these helpers. Capability detection is
 * best-effort heuristics over the gateway `capability` field and model id —
 * exact provider capability matrices are out of scope by design.
 */

/**
 * Max image attachment size after picker-side resize (12MB guard). Assets
 * above this are rejected with an inline warning instead of being sent.
 */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** A picked photo already converted to an inline data URI. */
export interface ImageAttachment {
  kind: 'image';
  /** Full `data:<mime>;base64,<payload>` URI. */
  dataUri: string;
}

/** A voice recording already converted to base64. */
export interface AudioAttachment {
  kind: 'audio';
  /** Raw base64 payload (no data-uri prefix). */
  data: string;
  /** Short format tag; recordings are WAV, so this is 'wav' in practice. */
  format: string;
}

export type MessageAttachment = ImageAttachment | AudioAttachment;

/** Text part of a multimodal content array. */
interface TextPart {
  type: 'text';
  text: string;
}

/** Vision part (OpenAI-compatible image_url shape). */
interface ImageUrlPart {
  type: 'image_url';
  image_url: {url: string};
}

/** Audio part (OpenAI-compatible input_audio shape). */
interface InputAudioPart {
  type: 'input_audio';
  input_audio: {data: string; format: string};
}

/** Audio part (data-URI shape expected by Voxtral-style providers). */
export interface AudioUrlPart {
  type: 'audio_url';
  audio_url: {url: string};
}

export type ContentPart = TextPart | ImageUrlPart | InputAudioPart | AudioUrlPart;

/**
 * Wire flavor for audio parts:
 * - 'openai'  → {type:'input_audio', input_audio:{data, format}} (default).
 * - 'voxtral' → {type:'audio_url', audio_url:{url:dataUri}}.
 */
export type AudioFlavor = 'openai' | 'voxtral';

/** Auto-pick the wire flavor from a model id (Voxtral-family detection). */
export function detectAudioFlavor(modelId: string): AudioFlavor {
  return /voxtral/i.test(modelId) ? 'voxtral' : 'openai';
}

/** Build the data URI for one audio attachment. */
function audioDataUri(data: string, format: string): string {
  return `data:audio/${format};base64,${data}`;
}

/** Capability markers treated as vision-capable in a gateway capability tag. */
const VISION_CAPABILITY_RE = /vision|image|multimodal|omni/i;

/** Vision markers looked for inside a model id ('-v' covers gpt-4-v/-vl tags). */
const VISION_ID_RE = /vision|vl|image|omni|-v/i;

/** Result of a vision-support check. */
export interface VisionVerdict {
  supported: boolean;
  /**
   * True when the verdict rests on real evidence (a vision marker in the id,
   * or a gateway capability tag that either grants or denies vision). False
   * when capability metadata is unknown (typical for BYOK catalog entries):
   * support is then assumed true but unverified, so the UI can hint instead
   * of blocking.
   */
  known: boolean;
}

/**
 * Vision-input support check:
 * - A capability tag containing vision/image/multimodal/omni → supported+known.
 * - A known vision marker in the model id (/vision|vl|image|omni|-v/i) →
 *   supported+known.
 * - Any other non-empty capability tag (e.g. 'text') → KNOWN to lack vision.
 * - No capability information at all → assumed supported, flagged unverified.
 *
 * Send-time gating should block only on `!supported`; `known === false` is a
 * hinting signal, not a blocker.
 */
export function visionSupport(modelId: string, capability?: string): VisionVerdict {
  if (capability !== undefined && VISION_CAPABILITY_RE.test(capability)) {
    return {supported: true, known: true};
  }
  if (VISION_ID_RE.test(modelId)) {
    return {supported: true, known: true};
  }
  if (capability !== undefined && capability.length > 0) {
    return {supported: false, known: true};
  }
  return {supported: true, known: false};
}

/** True when vision support can be asserted from real capability evidence. */
export function isVisionCapabilityKnown(
  modelId: string,
  capability?: string,
): boolean {
  return visionSupport(modelId, capability).known;
}

/** Convenience wrapper over {@link visionSupport} for gating decisions. */
export function supportsVision(modelId: string, capability?: string): boolean {
  return visionSupport(modelId, capability).supported;
}

/**
 * Best-effort audio-input support check: model id carries a known audio
 * marker (/voxtral|audio|voice|whisper/i). Capability strings are not
 * trusted here because gateways commonly tag audio-output-only models as
 * generic 'audio' too — the id is the stronger signal in practice.
 */
export function supportsAudio(modelId: string): boolean {
  return /voxtral|audio|voice|whisper/i.test(modelId);
}

/**
 * Resolve the mime type of a picked image asset:
 * - asset.type when present (trusted verbatim),
 * - else inferred from the fileName extension,
 * - else 'image/jpeg' as the safe default.
 */
export function inferImageMime(
  assetType?: string | null,
  fileName?: string | null,
): string {
  if (assetType) {
    return assetType;
  }
  const ext =
    fileName && fileName.includes('.')
      ? (fileName.split('.').pop() ?? '').toLowerCase()
      : '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'heic':
    case 'heif':
      return 'image/heic';
    case 'bmp':
      return 'image/bmp';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    default:
      return 'image/jpeg';
  }
}

/** True when the raw asset exceeds the image size guard. */
export function isOversizedImage(byteLength: number): boolean {
  return byteLength > MAX_IMAGE_BYTES;
}

/**
 * Build the `content` value for one user turn.
 *
 * - No (usable) attachments → plain string (legacy text-only payload).
 * - Otherwise → parts array: optional text part first, then supported
 *   image parts, then supported audio parts. Attachments whose kind is
 *   not supported by the target model are dropped silently; send-time
 *   gating in ChatScreen surfaces that to the user with an explicit
 *   message.
 *
 * `capability` is the selected model's gateway capability tag when known
 * (MOUD catalog); omit it when unknown (BYOK entries) so images ride
 * along as unverified rather than being dropped.
 *
 * `flavor` picks the audio wire shape: 'openai' (input_audio) or 'voxtral'
 * (audio_url data-URI). Defaults to auto-detection from the model id
 * (/voxtral/i → voxtral), so most callers never need to pass it.
 */
export function buildUserContent(
  text: string,
  attachments: readonly MessageAttachment[],
  modelId: string,
  capability?: string,
  flavor?: AudioFlavor,
): string | ContentPart[] {
  const resolvedFlavor = flavor ?? detectAudioFlavor(modelId);
  const usable: ContentPart[] = [];
  // Images first, then audio — deterministic grouping independent of the
  // order the user attached things in.
  for (const att of attachments) {
    if (
      att.kind === 'image' &&
      visionSupport(modelId, capability).supported
    ) {
      usable.push({type: 'image_url', image_url: {url: att.dataUri}});
    }
  }
  for (const att of attachments) {
    if (att.kind === 'audio' && supportsAudio(modelId)) {
      if (resolvedFlavor === 'voxtral') {
        usable.push({
          type: 'audio_url',
          audio_url: {url: audioDataUri(att.data, att.format)},
        });
      } else {
        usable.push({
          type: 'input_audio',
          input_audio: {data: att.data, format: att.format},
        });
      }
    }
  }

  const trimmed = text.trim();
  if (usable.length === 0) {
    return trimmed;
  }
  const parts: ContentPart[] = [];
  if (trimmed.length > 0) {
    parts.push({type: 'text', text: trimmed});
  }
  parts.push(...usable);
  return parts;
}
