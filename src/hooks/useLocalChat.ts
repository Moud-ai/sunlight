/**
 * useLocalChat — thin functional wrapper over react-native-executorch's useLLM
 * for on-device chat in ChatScreen.
 *
 * Design notes:
 * - The app owns conversation history (AsyncStorage + bubbles), so the wrapper
 *   uses llm.generate(history) — NOT sendMessage, which would let the library
 *   keep its own messageHistory.
 * - Hook-rules compliance: useLLM is called UNCONDITIONALLY at the top level of
 *   this wrapper, which ChatScreen mounts once. Lazy loading is achieved via
 *   the library's documented `preventLoad` flag (verified present in
 *   LLMProps of react-native-executorch 0.9.3): while `modelId` is null the
 *   hook stays mounted but dormant; passing a LOCAL_MODELS id flips
 *   preventLoad to false and the library's effect loads (and, on first use,
 *   downloads) that model. Selecting a different local model changes the
 *   watched model identity fields (modelName/modelSource/...) and triggers a
 *   reload; selecting a remote model passes null again and the previous
 *   controller is deleted by the library's own effect cleanup.
 * - State mapping is honest: 'downloading' only while a download is in flight
 *   (0 < progress < 1); after progress reaches 1 the remaining work is weight
 *   deserialization, surfaced as 'loading'.
 */
import {useCallback, useEffect, useMemo, useState} from 'react';
import type {LLMModel} from 'react-native-executorch';
import type {ChatMessage} from '../api/chat';

type ExecutorchModule = typeof import('react-native-executorch');
// Resolved ONCE at module evaluation (which itself is deferred behind a lazy
// require elsewhere). Deciding availability here — instead of during render —
// guarantees the hook branch below is constant for the whole process
// lifetime: rules-of-hooks can never flip between renders.
let executorchModule: ExecutorchModule | null = null;
try {
  executorchModule = require('react-native-executorch');
} catch {
  executorchModule = null;
}

/** Like executorchModule but throws a clear error for callers that require it. */
function requireExecutorch(): ExecutorchModule {
  if (executorchModule == null) {
    throw new Error('react-native-executorch unavailable');
  }
  return executorchModule;
}

/**
 * Structural subset of useLLM's return that this wrapper consumes; lets a
 * native-module failure degrade to an inert stub without crashing the app.
 */
interface LlmStateLike {
  isReady: boolean;
  isGenerating: boolean;
  downloadProgress: number;
  response: string;
  error: {message?: string} | null;
  generate: (
    messages: Array<{role: 'system' | 'user' | 'assistant'; content: string}>,
  ) => Promise<string>;
  interrupt: () => void;
}

/** Safe degraded state used when react-native-executorch cannot load. */
function degradedLlm(): LlmStateLike {
  return {
    isReady: false,
    isGenerating: false,
    downloadProgress: 0,
    response: '',
    error: null,
    generate: () => Promise.resolve(''),
    interrupt: () => {},
  };
}

/** On-device catalog entry shown in the picker's LOCAL segment. */
export interface LocalModelEntry {
  /** Picker id; always starts with 'local/'. */
  id: string;
  /** Human label rendered in the picker row. */
  label: string;
  /** Builds the executorch model config for useLLM. */
  factory: () => LLMModel;
}

/**
 * On-device models. Registry keys verified against
 * node_modules/react-native-executorch/src/constants/modelRegistry.ts:
 * - models.llm.lfm2_5_1_2b_instruct() → base precision (pair accessor)
 * - models.llm.llama3_2_1b({quant: true}) → spinquant variant
 */
export const LOCAL_MODELS: readonly LocalModelEntry[] = [
  {
    id: 'local/lfm2_5_1_2b_instruct',
    label: 'LFM 2.5 1.2B (on-device)',
    factory: () => requireExecutorch().models.llm.lfm2_5_1_2b_instruct(),
  },
  {
    id: 'local/llama3_2_1b_spinquant',
    label: 'Llama 3.2 1B (on-device)',
    factory: () => requireExecutorch().models.llm.llama3_2_1b({quant: true}),
  },
];

/** Lifecycle status derived from the underlying executorch hook state. */
export type LocalChatStatus = 'idle' | 'downloading' | 'loading' | 'ready' | 'error';

/**
 * Pure state mapper (unit-tested without React):
 * - error wins over everything,
 * - ready once the model reports itself ready,
 * - downloading only while a fetch is genuinely in flight,
 * - loading covers both "not started yet" and "download finished, weights
 *   deserializing" (progress >= 1 but not ready).
 */
export function mapExecutorchState(
  isReady: boolean,
  downloadProgress: number,
  error: unknown,
): LocalChatStatus {
  if (error) {
    return 'error';
  }
  if (isReady) {
    return 'ready';
  }
  if (downloadProgress > 0 && downloadProgress < 1) {
    return 'downloading';
  }
  return 'loading';
}

/**
 * Pure history composition (unit-tested without React): map our persisted
 * ChatMessage[] onto executorch's Message shape. Roles already line up
 * ('system' | 'user' | 'assistant'); media content parts never reach local
 * models (ChatScreen blocks attachments before calling this).
 */
export function toExecutorchMessages(
  history: readonly ChatMessage[],
): Array<{role: 'system' | 'user' | 'assistant'; content: string}> {
  return history.map(m => ({role: m.role, content: m.content}));
}

export interface UseLocalChatResult {
  /** Derived lifecycle status ('idle' while no local model is selected). */
  status: LocalChatStatus;
  /** Download progress 0..1 (0 when idle/loading-from-cache). */
  downloadProgress: number;
  /** Human-readable error message when status === 'error'. */
  error: string | null;
  /**
   * Run generation over the provided history (we own persistence). Resolves
   * with the full response text. Only meaningful when status === 'ready'.
   */
  send: (history: readonly ChatMessage[]) => Promise<string>;
  /** Interrupt the current generation. */
  interrupt: () => void;
  /** True while the model is actively generating tokens. */
  isGenerating: boolean;
  /** Streaming response text of the active/most recent generation. */
  response: string;
  /** Re-attempt load/download after an error (briefly re-arms preventLoad). */
  retry: () => void;
}

/** Dormant placeholder config passed to useLLM while nothing is selected. */
let placeholderModel: LLMModel | null = null;
function getPlaceholderModel(): LLMModel {
  if (placeholderModel == null) {
    placeholderModel = LOCAL_MODELS[0].factory();
  }
  return placeholderModel;
}

/**
 * @param modelId A LOCAL_MODELS id ('local/...') or null when the selected
 *   model is remote/unselected. Non-null triggers lazy load via preventLoad.
 */
export function useLocalChat(modelId: string | null): UseLocalChatResult {
  const entry = useMemo(
    () => LOCAL_MODELS.find(m => m.id === modelId) ?? null,
    [modelId],
  );

  // Retry mechanism: the library's load effect watches primitive model fields
  // plus preventLoad — none of which change on a plain retry. Briefly flipping
  // preventLoad back to true forces the effect to tear down and reload.
  const [suppressed, setSuppressed] = useState(false);
  const retry = useCallback(() => setSuppressed(true), []);

  // Branch on the process-stable module flag resolved at eval time. Both
  // arms keep this component's hook count fixed for its entire lifetime.
  let llm: LlmStateLike;
  if (executorchModule == null) {
    llm = degradedLlm();
  } else {
    llm = executorchModule.useLLM({
      model: entry ? entry.factory() : getPlaceholderModel(),
      preventLoad: entry === null || suppressed,
    });
  }

  // Re-arm the load one tick after a retry request: flipping preventLoad
  // true→false makes the library tear down and reload from scratch.
  useEffect(() => {
    if (!suppressed) {
      return;
    }
    const t = setTimeout(() => setSuppressed(false), 50);
    return () => clearTimeout(t);
  }, [suppressed]);

  const status =
    entry === null
      ? 'idle'
      : mapExecutorchState(llm.isReady, llm.downloadProgress, llm.error);

  const send = useCallback(
    (history: readonly ChatMessage[]) => {
      if (!llm.isReady) {
        return Promise.reject(new Error('local model still loading'));
      }
      return llm.generate(toExecutorchMessages(history));
    },
    [llm],
  );

  const interrupt = useCallback(() => llm.interrupt(), [llm]);

  return {
    status,
    downloadProgress: llm.downloadProgress,
    error: llm.error ? String(llm.error.message ?? llm.error) : null,
    send,
    interrupt,
    isGenerating: llm.isGenerating,
    response: llm.response,
    retry,
  };
}
