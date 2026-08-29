/**
 * Vision fallback pipeline.
 *
 * When a user sends an image with a model that doesn't support vision,
 * this module uses a vision-capable model to describe the image, then
 * injects the description as text so the text-only model can still
 * process the user's request.
 *
 * If the first vision model in the chain fails, it tries the next one.
 */
import {request} from '../api/client';
import {getModelCapabilities, findVisionModel, getVisionFallbackChain} from './modelCapabilities';
import type {MessageAttachment, ImageAttachment} from './messageContent';

export interface FallbackResult {
  /** The enriched text to send instead of the original */
  text: string;
  /** The attachments to send (images stripped, audio kept) */
  attachments: MessageAttachment[];
  /** Whether fallback was used */
  usedFallback: boolean;
  /** Which model was used for vision */
  visionModel?: string;
}

interface GatewayModelEntry {
  id: string;
  moud?: {capability?: string; modalities?: string[]};
}

interface VisionCompletionChoice {
  message?: {content?: string};
}

interface VisionCompletionResponse {
  choices?: VisionCompletionChoice[];
}

/** Result of a vision call attempt */
interface VisionAttempt {
  success: boolean;
  description?: string;
  modelId: string;
}

/**
 * Try describing an image with a specific vision model via the gateway.
 * Returns null if the call failed or produced no usable output.
 */
async function describeImageWithModel(
  img: ImageAttachment,
  modelId: string,
  apiKey: string,
): Promise<string | null> {
  try {
    const response = await request<VisionCompletionResponse>(
      '/v1/chat/completions',
      {
        method: 'POST',
        apiKey,
        body: {
          model: modelId,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Describe this image in detail. Focus on what is relevant to the user\'s likely intent. Be concise but thorough.',
                },
                {
                  type: 'image_url',
                  image_url: {url: img.dataUri},
                },
              ],
            },
          ],
          max_tokens: 1024,
        },
        timeoutMs: 60_000,
      },
    );

    const description = response?.choices?.[0]?.message?.content;
    return description || null;
  } catch {
    return null;
  }
}

/**
 * Try a list of vision models in order. Returns the first successful description.
 */
async function describeImageWithChain(
  img: ImageAttachment,
  modelChain: string[],
  apiKey: string,
): Promise<VisionAttempt> {
  for (const modelId of modelChain) {
    const description = await describeImageWithModel(img, modelId, apiKey);
    if (description) {
      return {success: true, description, modelId};
    }
  }
  return {success: false, modelId: modelChain[modelChain.length - 1]};
}

/**
 * If the selected model doesn't support vision but there are image attachments,
 * use a vision model to describe the images, then inject the description as text.
 *
 * Tries vision models in a predefined chain. If one fails, tries the next.
 */
export async function applyVisionFallback(
  text: string,
  attachments: MessageAttachment[],
  selectedModel: string,
  selectedCapability: string | undefined,
  selectedModalities: string[] | undefined,
  apiKey: string,
  gatewayModels: GatewayModelEntry[],
): Promise<FallbackResult> {
  // 1. Check if any attachments are images
  const imageAttachments = attachments.filter(a => a.kind === 'image');
  if (imageAttachments.length === 0) {
    return {text, attachments, usedFallback: false};
  }

  // 2. Check if selected model supports vision
  const caps = getModelCapabilities(selectedModel, selectedCapability, selectedModalities);
  if (caps.vision) {
    return {text, attachments, usedFallback: false};
  }

  // 3. Build the vision fallback chain
  // Start with the hardcoded chain, then check if gateway has any other vision models
  const chain = getVisionFallbackChain().slice(); // copy
  const gatewayVisionModel = findVisionModel(gatewayModels);
  if (gatewayVisionModel && !chain.includes(gatewayVisionModel)) {
    chain.push(gatewayVisionModel);
  }

  if (chain.length === 0) {
    return {text, attachments, usedFallback: false};
  }

  // 4. Send each image to vision models in the chain
  const descriptions: string[] = [];
  let modelUsed = '';

  for (const img of imageAttachments) {
    const attempt = await describeImageWithChain(img, chain, apiKey);
    if (attempt.success && attempt.description) {
      descriptions.push(attempt.description);
      modelUsed = attempt.modelId;
    }
  }

  if (descriptions.length === 0) {
    // All vision calls failed
    return {text, attachments, usedFallback: false};
  }

  // 5. Prepend descriptions to user text
  const enrichedText =
    descriptions.length === 1
      ? `[Image description: ${descriptions[0]}]\n\n${text}`
      : descriptions
          .map((d, i) => `[Image ${i + 1} description: ${d}]`)
          .join('\n\n') +
        '\n\n' +
        text;

  // 6. Return enriched text + audio-only attachments (images stripped)
  const audioAttachments = attachments.filter(a => a.kind !== 'image');

  return {
    text: enrichedText,
    attachments: audioAttachments,
    usedFallback: true,
    visionModel: modelUsed,
  };
}