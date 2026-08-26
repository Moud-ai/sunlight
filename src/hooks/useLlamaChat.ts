/**
 * useLlamaChat — llama.cpp (llama.rn) engine wrapper, parallel to
 * useLocalChat (ExecuTorch). This is the SECOND on-device chat engine.
 *
 * Design notes:
 * - Lazy by contract: initLlama runs on the FIRST send after the user selects a
 *   GGUF model that is already downloaded — never at mount, never before an
 *   explicit picker selection. The hook is mounted once (rules-of-hooks) and
 *   stays dormant ('idle') while ggufId is null.
 * - We own conversation history (AsyncStorage + bubbles in ChatScreen), so the
 *   wrapper uses ctx.completion({messages}) per turn rather than any library
 *   session state.
 * - Memory hygiene: switching models (or unmount) releases the previous
 *   LlamaContext via ctx.release(); loading is serialized so two sends can
 *   never double-init the same model, and a load that resolves after the user
 *   switched away releases its context instead of leaking it.
 * - Context flags are the JS-side perf levers (see src/lib/gguf.ts for the F4
 *   research trail): n_ctx 2048 bounds KV-cache RAM; n_threads 0 defers to
 *   llama.cpp's big.LITTLE auto-detection; n_gpu_layers 0 pins CPU decode.
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import type {LlamaContext, RNLlamaOAICompatibleMessage} from 'llama.rn';
import type {ChatMessage} from '../api/chat';
import {isDownloaded, localPath, toPickerId} from '../lib/gguf';

type LlamaRn = typeof import('llama.rn');
let llamaRnCache: LlamaRn | null = null;
function getLlamaRn(): LlamaRn {
  if (llamaRnCache == null) {
    const mod: LlamaRn = require('llama.rn');
    llamaRnCache = mod;
  }
  return llamaRnCache;
}

/** Lifecycle status of the llama.cpp engine. */
export type LlamaChatStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Pure history composition (unit-tested without React): map our persisted
 * ChatMessage[] onto llama.rn's OpenAI-compatible message shape. Roles line up
 * ('system' | 'user' | 'assistant'); media parts never reach this path because
 * ChatScreen blocks attachments on on-device sends.
 */
export function toLlamaMessages(
  history: readonly ChatMessage[],
): RNLlamaOAICompatibleMessage[] {
  return history.map(m => ({role: m.role, content: m.content}));
}

export interface UseLlamaChatResult {
  /** Derived lifecycle status ('idle' while no GGUF model is selected). */
  status: LlamaChatStatus;
  /** Human-readable error message when status === 'error'. */
  error: string | null;
  /**
   * Run generation over the provided history (we own persistence). Lazily
   * initializes the context on first call. Resolves with the full response.
   */
  send: (history: readonly ChatMessage[]) => Promise<string>;
  /** Interrupt the active generation via ctx.stopCompletion(). */
  interrupt: () => void;
  /**
   * Release the loaded context and drop back to 'idle' (memory hygiene when
   * leaving the GGUF engine without changing ids).
   */
  unload: () => void;
  /** Re-attempt loading after an error. */
  retry: () => void;
  /** Streaming text of the active/most recent generation. */
  response: string;
}

/**
 * @param bareGgufId A CURATED_GGUF_MODELS id (WITHOUT the 'gguf/' prefix) or
 *   null when another engine/model is selected. Non-null + first send triggers
 *   lazy initLlama.
 */
export function useLlamaChat(bareGgufId: string | null): UseLlamaChatResult {
  const [status, setStatus] = useState<LlamaChatStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState('');

  // Latest id as a ref so async continuations can detect "user switched away
  // mid-load" and release instead of adopting a stale context.
  const activeIdRef = useRef<string | null>(bareGgufId);
  useEffect(() => {
    activeIdRef.current = bareGgufId;
  }, [bareGgufId]);

  const ctxRef = useRef<LlamaContext | null>(null);
  const loadRef = useRef<Promise<void> | null>(null);

  /** Release the current context, if any (idempotent). */
  const releaseCtx = useCallback(() => {
    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx) {
      ctx.release().catch(() => {});
    }
  }, []);

  // Model switch / unmount: release the old context and reset state. The id
  // change IS the unload trigger for switches; unload() covers same-id exits.
  useEffect(() => {
    setStatus('idle');
    setError(null);
    setResponse('');
    releaseCtx();
    loadRef.current = null;
    return () => {
      // Cleanup closure sees the PREVIOUS id's context through refs.
      releaseCtx();
      loadRef.current = null;
    };
  }, [bareGgufId, releaseCtx]);

  /** Serialize context initialization; resolves once status is ready. */
  const ensureLoaded = useCallback(async () => {
    const id = bareGgufId;
    if (!id) {
      throw new Error('no GGUF model selected');
    }
    if (ctxRef.current) {
      return ctxRef.current;
    }
    if (loadRef.current) {
      await loadRef.current;
      if (!ctxRef.current) {
        throw new Error('GGUF model failed to load');
      }
      return ctxRef.current;
    }

    const load = (async () => {
      setStatus('loading');
      setError(null);
      try {
        const path = localPath(id);
        const downloaded = await isDownloaded(id);
        if (!downloaded) {
          throw new Error(`GGUF model not downloaded yet (${toPickerId(id)})`);
        }
        // Perf levers documented in src/lib/gguf.ts (F4 notes): bounded KV
        // cache, auto thread detection, CPU decode baseline.
        const ctx = await getLlamaRn().initLlama({
          model: path,
          n_ctx: 2048,
          n_threads: 0,
          n_gpu_layers: 0,
        });
        if (activeIdRef.current !== id) {
          // User switched models while we were loading: free immediately.
          ctx.release().catch(() => {});
          return;
        }
        ctxRef.current = ctx;
        setStatus('ready');
      } catch (e) {
        if (activeIdRef.current === id) {
          setError(e instanceof Error ? e.message : String(e));
          setStatus('error');
        }
        throw e instanceof Error ? e : new Error(String(e));
      } finally {
        loadRef.current = null;
      }
    })();

    loadRef.current = load;
    await load;
    if (!ctxRef.current) {
      // Load resolved but its context was discarded (model switch mid-load).
      throw new Error('GGUF model failed to load');
    }
    return ctxRef.current;
  }, [bareGgufId]);

  const send = useCallback(
    async (history: readonly ChatMessage[]) => {
      const id = bareGgufId;
      if (!id) {
        throw new Error('no GGUF model selected');
      }
      const ctx = await ensureLoaded();
      setResponse('');
      let acc = '';
      try {
        const result = await ctx.completion(
          {
            messages: toLlamaMessages(history),
            n_predict: 512,
          },
          data => {
            acc += data.token ?? '';
            setResponse(acc);
          },
        );
        // NativeCompletionResult.content excludes reasoning/tool-call noise;
        // fall back to raw text/accumulated tokens defensively.
        const text =
          result.content || result.text || acc || '';
        setResponse(text);
        return text;
      } catch (e) {
        // stopCompletion() surfaces as a completion rejection: keep whatever
        // streamed so far so interrupted turns still show partial output.
        const partial = acc;
        setResponse(partial);
        throw e instanceof Error ? e : new Error(String(e));
      }
    },
    [bareGgufId, ensureLoaded],
  );

  const interrupt = useCallback(() => {
    ctxRef.current?.stopCompletion().catch(() => {});
  }, []);

  const unload = useCallback(() => {
    releaseCtx();
    loadRef.current = null;
    setStatus('idle');
    setResponse('');
  }, [releaseCtx]);

  const retry = useCallback(() => {
    // Next send() re-runs ensureLoaded from scratch.
    setError(null);
    setStatus(ctxRef.current ? 'ready' : 'idle');
  }, []);

  return {status, error, send, interrupt, unload, retry, response};
}
