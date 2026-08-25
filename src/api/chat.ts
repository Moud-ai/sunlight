/**
 * OpenAI-compatible streaming chat against the moud gateway.
 *
 * Hermes-safe SSE: XMLHttpRequest with progressive responseText parsing
 * (RN fetch ReadableStream is unreliable on Hermes; XHR incremental text is).
 *
 * Implementation notes:
 * - A line buffer accumulates partial SSE frames split across chunks; the
 *   frame-parsing state machine is a pure factory (createSseFrameParser) so it
 *   is unit-testable without React or XHR.
 * - Incremental delivery is driven by xhr.onprogress with a cursor index over
 *   responseText (Hermes/RN has no ReadableStream); readyState===4 performs a
 *   final flush of any buffered tail BEFORE the terminal finish()/finishHttp
 *   Error() dispatch so no frame is lost.
 * - An XHR timeout prevents indefinite hangs if the server stalls.
 * - onError and onDone are mutually exclusive: on error we report once and
 *   stop, so the UI never shows a "done" state over an error bubble.
 * - HTTP errors include the server body (truncated) and 401 is surfaced as a
 *   status on the error payload so callers can sign the user out.
 */
import {GATEWAY_URL} from '../config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Error payload handed to StreamHandlers.onError alongside the message. */
export interface ChatErrorInfo {
  /** HTTP status when the stream failed at the protocol level. */
  status?: number;
  /** True when the server answered 401 (session revoked/expired). */
  authExpired?: boolean;
}

export interface StreamHandlers {
  onDelta?: (text: string) => void;
  onReasoning?: (text: string) => void;
  onError?: (message: string, info?: ChatErrorInfo) => void;
  onDone?: () => void;
}

export interface ChatStreamHandle {
  cancel(): void;
}

const XHR_TIMEOUT_MS = 120_000;

/** Max characters of upstream error body included in an error message. */
export const MAX_ERROR_BODY_CHARS = 300;

/** Truncate an upstream error body for safe inclusion in a message. */
export function truncateBody(text: string, max = MAX_ERROR_BODY_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max)}…`;
}

export interface SseFrameHandlers {
  onDelta?: (text: string) => void;
  onReasoning?: (text: string) => void;
}

/**
 * Pure SSE frame-parser factory. Feed it progressive chunks of
 * `data: {...}\n` text; it buffers partial lines across chunks and dispatches
 * delta/reasoning payloads. Malformed JSON frames are skipped silently.
 */
export function createSseFrameParser(
  handlers: SseFrameHandlers,
): {(chunk: string): void} {
  let lineBuffer = '';
  return (chunk: string) => {
    lineBuffer += chunk;
    const lines = lineBuffer.split('\n');
    // Keep the last (possibly incomplete) line in the buffer.
    lineBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) {
        continue;
      }
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') {
        continue;
      }
      try {
        const json = JSON.parse(payload);
        const choice = json.choices?.[0];
        const delta = choice?.delta?.content ?? '';
        const reasoning =
          choice?.delta?.reasoning_content ?? choice?.delta?.reasoning ?? '';
        if (delta) {
          handlers.onDelta?.(delta);
        }
        if (reasoning) {
          handlers.onReasoning?.(reasoning);
        }
      } catch {
        // Malformed JSON frame — skip; a well-formed frame will arrive later.
      }
    }
  };
}

export interface StreamChatOpts {
  /** Custom base URL (BYOK endpoint). Trailing slashes are stripped. */
  baseUrl?: string;
}

export function streamChat(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  handlers: StreamHandlers,
  opts?: StreamChatOpts,
): ChatStreamHandle {
  const baseUrl = (opts?.baseUrl ?? GATEWAY_URL).replace(/\/+$/, '');
  const XMLHttp = globalThis.XMLHttpRequest as any;
  const xhr = new XMLHttp();
  let cancelled = false;
  let seen = 0;
  let finished = false;

  const processChunk = createSseFrameParser(handlers);

  /** Feed everything after the cursor through the parser (never throws). */
  const drain = () => {
    if (cancelled || finished) {
      return;
    }
    try {
      const text: string = xhr.responseText ?? '';
      if (text.length > seen) {
        const chunk = text.slice(seen);
        seen = text.length;
        processChunk(chunk);
      }
    } catch {
      // responseText access can throw in edge states; a later onprogress or
      // the final flush will catch up.
    }
  };

  const finish = (error?: string, info?: ChatErrorInfo) => {
    if (finished) {
      return;
    }
    finished = true;
    if (error) {
      handlers.onError?.(error, info);
    } else {
      handlers.onDone?.();
    }
  };

  /** Build the error message for a terminal non-2xx response. */
  const finishHttpError = () => {
    const status = xhr.status;
    const info: ChatErrorInfo = {
      status,
      authExpired: status === 401,
    };
    finish(`HTTP ${status}: ${truncateBody(xhr.responseText ?? '')}`, info);
  };

  xhr.open('POST', `${baseUrl}/v1/chat/completions`, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', `Bearer ${apiKey}`);
  xhr.setRequestHeader('Accept', 'text/event-stream');
  xhr.timeout = XHR_TIMEOUT_MS;

  xhr.onprogress = () => {
    drain();
  };

  xhr.onreadystatechange = () => {
    if (cancelled || finished || xhr.readyState !== 4) {
      return;
    }
    // Flush any tail the last onprogress did not cover BEFORE deciding the
    // terminal state, so a final SSE frame is never dropped.
    drain();
    if (xhr.status >= 400) {
      finishHttpError();
    } else {
      finish();
    }
  };

  xhr.ontimeout = () => {
    if (!cancelled) {
      finish('timeout');
    }
  };

  xhr.onerror = () => {
    if (!cancelled) {
      finish('error de red');
    }
  };

  xhr.send(JSON.stringify({model, messages, stream: true}));

  return {
    cancel() {
      cancelled = true;
      try {
        xhr.abort();
      } catch {}
    },
  };
}
