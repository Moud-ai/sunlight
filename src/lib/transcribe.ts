/**
 * Audio transcription via the gateway's whisper.cpp endpoint.
 *
 * Sunlight never sends raw audio to chat models: voice clips are transcribed
 * here (POST /v1/audio/transcriptions, multipart) and the resulting text is
 * sent to the selected model. Transcription models like voxtral/whisper are
 * intentionally not usable as chat models directly.
 */
import {request} from '../api/client';

/**
 * Transcribe a local audio file to text. Resolves with the trimmed transcript
 * (empty string when nothing was transcribed).
 */
export async function transcribeAudio(
  apiKey: string,
  uri: string,
  format = 'wav',
): Promise<string> {
  const form = new FormData();
  // React Native's FormData accepts a {uri, name, type} descriptor as a file.
  form.append('file', {
    uri,
    name: `recording.${format}`,
    type: `audio/${format}`,
  } as unknown as Blob);

  const body = await request<{text?: string}>('/v1/audio/transcriptions', {
    method: 'POST',
    apiKey,
    body: form,
    multipart: true,
  });

  return typeof body?.text === 'string' ? body.text.trim() : '';
}