/**
 * Unit tests for the pure multimodal message-content builders
 * (src/lib/messageContent.ts).
 */
import {
  buildUserContent,
  detectAudioFlavor,
  inferImageMime,
  isOversizedImage,
  isVisionCapabilityKnown,
  MAX_IMAGE_BYTES,
  supportsAudio,
  supportsVision,
  AudioAttachment,
  ContentPart,
  ImageAttachment,
} from '../src/lib/messageContent';

const IMAGE: ImageAttachment = {
  kind: 'image',
  dataUri: 'data:image/jpeg;base64,QUJD',
};

const AUDIO: AudioAttachment = {kind: 'audio', data: 'QUJD', format: 'wav'};

describe('supportsVision', () => {
  test.each([
    ['moud/Qwen2.5-VL-72B', undefined],
    ['openai/gpt-4-vision-preview', undefined],
    ['vendor/omni-mini', undefined],
    ['vendor/qwen-image-gen', 'text'],
    ['meta/llama-3.2-11b', 'multimodal'],
    ['some/model-with-VISION-tag', 'text'],
    ['byok/unknown-model', undefined], // unknown capability → assumed supported
  ])('id=%s capability=%s → vision', (id, capability) => {
    expect(supportsVision(id, capability)).toBe(true);
  });

  test('gateway text capability is KNOWN to lack vision → blocked', () => {
    expect(supportsVision('moud/Qwen2.5-7B', 'text')).toBe(false);
    expect(isVisionCapabilityKnown('moud/Qwen2.5-7B', 'text')).toBe(true);
  });

  test('unknown capability (BYOK models): supported but flagged unverified', () => {
    expect(supportsVision('mistral/mistral-small')).toBe(true);
    expect(isVisionCapabilityKnown('mistral/mistral-small')).toBe(false);
  });

  test('an id marker makes vision KNOWN even without a capability tag', () => {
    expect(isVisionCapabilityKnown('moud/Qwen2.5-VL-72B')).toBe(true);
  });
});

describe('supportsAudio', () => {
  test.each([
    ['mistral/voxtral-mini'],
    ['openai/whisper-large'],
    ['vendor/audio-flamingo'],
    ['vendor/voice-engine-x'],
  ])('id=%s → audio input supported', id => {
    expect(supportsAudio(id)).toBe(true);
  });

  test('plain text model is not audio-capable', () => {
    expect(supportsAudio('moud/Qwen2.5-7B')).toBe(false);
  });
});

describe('inferImageMime', () => {
  test('asset.type wins when present', () => {
    expect(inferImageMime('image/png', 'photo.jpg')).toBe('image/png');
    expect(inferImageMime('image/webp', null)).toBe('image/webp');
  });

  test.each([
    ['pic.PNG', 'image/png'],
    ['shot.webp', 'image/webp'],
    ['anim.gif', 'image/gif'],
    ['IMG_0001.heic', 'image/heic'],
    ['IMG_0002.heif', 'image/heic'],
    ['render.bmp', 'image/bmp'],
    ['photo.JPG', 'image/jpeg'],
    ['photo.jpeg', 'image/jpeg'],
  ])('fileName=%s infers %s when type is missing', (fileName, expected) => {
    expect(inferImageMime(undefined, fileName)).toBe(expected);
    expect(inferImageMime(null, fileName)).toBe(expected);
  });

  test('falls back to image/jpeg with no usable signal', () => {
    expect(inferImageMime(undefined, undefined)).toBe('image/jpeg');
    expect(inferImageMime(null, 'noextension')).toBe('image/jpeg');
    expect(inferImageMime('', '')).toBe('image/jpeg');
  });
});

describe('isOversizedImage', () => {
  test('at the limit is fine', () => {
    expect(isOversizedImage(MAX_IMAGE_BYTES)).toBe(false);
  });
  test('one byte over is rejected', () => {
    expect(isOversizedImage(MAX_IMAGE_BYTES + 1)).toBe(true);
  });
});

describe('buildUserContent', () => {
  test('no attachments returns a plain trimmed string', () => {
    expect(buildUserContent('  hello  ', [], 'any/model')).toBe('hello');
    // Known non-vision model: the unsupported image is dropped.
    expect(buildUserContent('', [IMAGE], 'text-only/model', 'text')).toBe('');
  });

  test('image on a vision model produces parts array with image_url', () => {
    const content = buildUserContent('what is this?', [IMAGE], 'moud/Qwen2.5-VL');
    expect(content).toEqual([
      {type: 'text', text: 'what is this?'},
      {type: 'image_url', image_url: {url: IMAGE.dataUri}},
    ]);
  });

  test('image attachment is dropped only for KNOWN non-vision models', () => {
    // Gateway tags the model as text → known lack of vision.
    expect(buildUserContent('hi', [IMAGE], 'moud/Qwen2.5-7B', 'text')).toBe(
      'hi',
    );
  });

  test('unknown-capability model keeps the image (unverified, not blocked)', () => {
    expect(buildUserContent('hi', [IMAGE], 'byok/mistral-small')).toEqual([
      {type: 'text', text: 'hi'},
      {type: 'image_url', image_url: {url: IMAGE.dataUri}},
    ]);
  });

  test('audio attachment becomes input_audio on OpenAI-flavor audio models', () => {
    expect(buildUserContent('', [AUDIO], 'openai/whisper-large')).toEqual([
      {type: 'input_audio', input_audio: {data: 'QUJD', format: 'wav'}},
    ]);
    // Non-audio model: falls back to plain text.
    expect(buildUserContent('transcribe', [AUDIO], 'moud/Qwen2.5-7B')).toBe(
      'transcribe',
    );
  });

  test('voxtral model ids auto-pick the audio_url data-URI flavor', () => {
    expect(buildUserContent('', [AUDIO], 'mistral/voxtral-mini')).toEqual([
      {type: 'audio_url', audio_url: {url: 'data:audio/wav;base64,QUJD'}},
    ]);
    expect(detectAudioFlavor('mistral/voxtral-mini')).toBe('voxtral');
    expect(detectAudioFlavor('openai/whisper-large')).toBe('openai');
  });

  test('explicit flavor overrides auto-detection in both directions', () => {
    // Force openai shape even on a voxtral id.
    expect(
      buildUserContent('', [AUDIO], 'mistral/voxtral-mini', undefined, 'openai'),
    ).toEqual([{type: 'input_audio', input_audio: {data: 'QUJD', format: 'wav'}}]);
    // Force voxtral shape on a non-voxtral id.
    expect(
      buildUserContent('', [AUDIO], 'openai/whisper-large', undefined, 'voxtral'),
    ).toEqual([{type: 'audio_url', audio_url: {url: 'data:audio/wav;base64,QUJD'}}]);
  });

  test('mixed attachments keep ordering: text, images, then audio', () => {
    const content = buildUserContent(
      'compare',
      [AUDIO, IMAGE],
      'vendor/omni-vision-audio',
    );
    expect(content).toEqual([
      {type: 'text', text: 'compare'},
      {type: 'image_url', image_url: {url: IMAGE.dataUri}},
      {type: 'input_audio', input_audio: {data: 'QUJD', format: 'wav'}},
    ]);
  });

  test('audio attachments are sent in wav format', () => {
    const content = buildUserContent(
      '',
      [{kind: 'audio', data: 'QUJD', format: 'wav'}],
      'openai/whisper-large',
    ) as ContentPart[];
    expect(content).toHaveLength(1);
    const part = content[0] as Extract<ContentPart, {type: 'input_audio'}>;
    expect(part.type).toBe('input_audio');
    expect(part.input_audio.format).toBe('wav');
    expect(part.input_audio.data).toBe('QUJD');
  });

  test('unsupported attachments with empty text degrade to empty string', () => {
    expect(buildUserContent('', [IMAGE], 'plain-text/model', 'text')).toBe('');
  });
});
