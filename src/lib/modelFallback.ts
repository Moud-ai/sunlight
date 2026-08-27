/**
 * Vision fallback pipeline.
 *
 * When a user sends an image with a model that doesn't support vision,
 * this module uses a vision-capable model to describe the image, then
 * injects the description as text so the text-only model can still
 * process the user's request.
 */
import {request} from '../api/client';
import {getModelCapabilities, findVisionModel} from './modelCapabilities';
import type {MessageAttachment} from './messageContent';

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

/**
 * If the selected model doesn't support vision but there are image attachments,
 * use a vision model to describe the images, then inject the description as text.
 */
export async function applyVisionFallback(
  text: string,
  attachments: MessageAttachment[],
  selectedModel: string,
  selectedCapability: string | undefined,
  selectedModalities: string[] | undefined,
  apiKey: string,
  gatewayModels: GatewayModelEntry[],
  fallbackModelOverride?: string,
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

  // 3. Find a vision model
  let visionModel: string | null = null;
  if (fallbackModelOverride) {
    visionModel = fallbackModelOverride;
  } else {
    visionModel = findVisionModel(
      gatewayModels.map(m => ({id: m.id, moud: m.moud})),
    );
  }

  if (!visionModel) {
    // No fallback available — return unchanged so caller can show error
    return {text, attachments, usedFallback: false};
  }

  // 4. Send each image to the vision model for a description
  const descriptions: string[] = [];
  for (const img of imageAttachments) {
    try {
      const response = await request<VisionCompletionResponse>(
        '/v1/chat/completions',
        {
          method: 'POST',
          apiKey,
          body: {
            model: visionModel,
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
      if (description) {
        descriptions.push(description);
      }
    } catch {
      // Vision call failed — skip this image description
    }
  }

  if (descriptions.length === 0) {
    // All vision calls failed — no fallback usable
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
    visionModel,
  };
}
