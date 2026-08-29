/**
 * ChatScreen — premium AI chat inspired by Claude/Kimi.
 *
 * Design: dark-first, high-contrast, minimal (Swiss/Vercel).
 * - Header: hamburger menu (left) + model selector (center) + avatar (right)
 * - Model picker: bottom sheet (@gorhom/bottom-sheet). With BYOK quota routing
 *   it shows ONLY the custom endpoint's full catalog; otherwise only the MOUD
 *   gateway catalog. Lazy fetch on first open, search/loading/error/retry.
 * - Composer: image + voice attachment buttons, preview strip, multimodal
 *   send semantics (src/lib/messageContent.ts).
 * - Thinking tokens hidden by default (collapsible)
 * - Motion: react-native-reanimated only, subtle 200-300ms ease-out.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Clipboard,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Menu,
  ChevronDown,
  ImagePlus,
  Mic,
  FileText,
  ArrowUp,
  Square,
  Copy,
} from 'lucide-react-native';
import Markdown, {type MarkedStyles} from 'react-native-marked';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import {launchImageLibrary} from 'react-native-image-picker';
import {pick, types as docTypes, isErrorWithCode, errorCodes} from '@react-native-documents/picker';
import * as RNFS from '@dr.pogodin/react-native-fs';
import {streamChat, ChatErrorInfo, ChatMessage, ChatStreamHandle} from '../api/chat';
import {
  fetchGatewayModels,
  filterTextModels,
  searchModels,
  GatewayModel,
} from '../api/models';
import {searchByokModels, fetchByokModels, ByokModel} from '../lib/byokModels';
import {DEFAULT_MODEL, GATEWAY_URL} from '../config';
import {SunlightSession} from '../auth/secure';
import {
  ByokConfig,
  loadByokSettings,
  type ByokSettings,
  type QuotaMode,
  setQuotaMode as persistQuotaMode,
} from '../lib/byok';
import {resolveChatTarget} from '../lib/chatTarget';
import {
  LOCAL_MODELS,
  useLocalChat,
  type LocalChatStatus,
} from '../hooks/useLocalChat';
import {useLlamaChat} from '../hooks/useLlamaChat';
import {
  CURATED_GGUF_MODELS,
  downloadModel,
  humanBytes,
  loadRegistry,
  resumeActiveModelDownload,
  type GgufRegistry,
} from '../lib/gguf';
import {fetchProfileAvatar} from '../lib/profile';
import {initialFor} from '../lib/avatar';
import {AppIcon} from '../components/CloudLogo';
import {
  PermissionSheet,
  type PermissionKind,
} from '../components/PermissionSheet';
import {
  requestGalleryPermission,
  requestMicPermission,
} from '../lib/permissions';
import {startRecording, stopRecording} from '../lib/audio';
import {transcribeAudio} from '../lib/transcribe';
import {
  AudioAttachment,
  buildUserContent,
  ImageAttachment,
  DocumentAttachment,
  inferImageMime,
  isOversizedImage,
  MAX_IMAGE_BYTES,
  visionSupport,
} from '../lib/messageContent';
import {getModelCapabilities} from '../lib/modelCapabilities';
import {applyVisionFallback} from '../lib/modelFallback';
import {RootStackParamList} from '../../App';
import {typography, spacing, radius} from '../theme';
import {useThemeColors, type ThemeColors} from '../theme/ThemeProvider';
import {
  loadMessages,
  appendMessage,
  updateChat,
  generateTitle,
} from '../lib/chatStorage';
import {detectSearchIntent, searchWeb, formatSearchContext, detectUncertainty} from '../lib/webSearch';
import {buildSystemMessage, buildToolsArray} from '../lib/systemPrompt';
import {ToolCall} from '../api/chat';
import {request} from '../api/client';
import {executeMathEval, executeUnitConvert, executeStatistics} from '../lib/mathTools';
import {executeGenerateFile, executeGeneratePdf, executeGenerateDocx, executeGenerateXlsx, executeGeneratePresentation, executeShareFile} from '../lib/fileTools';
import {parseDocument} from '../lib/documentParser';

interface Bubble {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  showThinking?: boolean;
}

/** An attachment queued in the composer, ready to be sent. */
interface PendingAttachment {
  id: string;
  /** Local file uri — used only for the preview thumbnail. */
  uri?: string;
  /** Recorded clip length, shown on the audio duration chip. */
  durationMs?: number;
  attachment: ImageAttachment | AudioAttachment | DocumentAttachment;
}

interface Props {
  session: SunlightSession;
  chatId: string | null;
  onMenuToggle: () => void;
  onSignOut: () => void;
  /** Optional override for the header avatar tap (defaults to Settings). */
  onPressAvatar?: () => void;
}

/**
 * Persisted model-picker selections, kept per routing context so toggling
 * between MOUD and BYOK restores each context's last-used model.
 */
const SELECTED_MODEL_KEY_MOUD = '@sunlight_selected_model_moud';
const SELECTED_MODEL_KEY_BYOK = '@sunlight_selected_model_byok';
/** Pre-per-mode key; migrated into SELECTED_MODEL_KEY_MOUD on first load. */
const SELECTED_MODEL_KEY_LEGACY = '@sunlight_selected_model';
/** Persisted selection of an on-device model ('local/...' | 'gguf/...'), mode-independent. */
const SELECTED_MODEL_KEY_LOCAL = '@sunlight_selected_model_local';
/** Persisted on-device engine sub-toggle inside the picker's LOCAL segment. */
const LOCAL_ENGINE_KEY = '@sunlight_local_engine';
/** Persisted vision-fallback model id. */
const FALLBACK_VISION_MODEL_KEY = '@sunlight_vision_fallback_model';

/** On-device inference engines exposed under the picker's LOCAL segment. */
type LocalEngine = 'executorch' | 'gguf';

/** Max rows rendered in either picker tab. */
const MODEL_PICKER_LIMIT = 40;

/** Max attachments queued in the composer. */
const MAX_ATTACHMENTS = 4;

/** Auto-hide delay for inline composer notices. */
const NOTICE_MS = 4000;

/**
 * Human-readable model label for the header and picker.
 * - On-device models: use the label from LOCAL_MODELS or CURATED_GGUF_MODELS
 *   (these carry clean names like 'Llama 3.2 1B' vs raw ids like 'llama3_2_1b').
 * - Gateway/BYOK models: strip vendor prefix, then prettify underscores.
 */
function modelDisplayName(id: string): string {
  // On-device ExecuTorch models
  const localMatch = LOCAL_MODELS.find(m => m.id === id);
  if (localMatch) {
    return localMatch.label;
  }
  // On-device GGUF models (picker id is 'gguf/<rawId>')
  if (id.startsWith('gguf/')) {
    const rawId = id.slice(5);
    const ggufMatch = CURATED_GGUF_MODELS.find(m => m.id === rawId);
    if (ggufMatch) {
      return `${ggufMatch.label} ${ggufMatch.quant}`;
    }
  }
  // Gateway/BYOK: strip vendor prefix, then replace underscores with spaces
  // for readability ('qwen2_5_72b_instruct' → 'qwen2 5 72b instruct').
  // Dots are preserved as-is ('qwen3.5' stays 'qwen3.5').
  const parts = id.split('/');
  const tail = parts[parts.length - 1] || id;
  return tail.replace(/_/g, ' ');
}

/** Host portion of a BYOK endpoint URL (no URL API dependency). */
function hostOf(baseUrl: string): string {
  return baseUrl.replace(/^https?:\/\//, '').split('/')[0];
}

/** m:ss formatting for voice-recording chips. */
function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;
}

/** Short placeholder label for a pending attachment inside a sent bubble. */
function attachmentLabel(att: PendingAttachment): string {
  if (att.attachment.kind === 'image') {
    return '[photo]';
  }
  const dur =
    att.durationMs !== undefined ? ` ${formatDuration(att.durationMs)}` : '';
  return `[voice${dur}]`;
}

/** File extension of a recorded clip, lowercased ('wav' fallback). */
function audioFormatOf(uri: string): string {
  const ext = uri.split('.').pop() ?? '';
  return ext.length > 0 && ext.length <= 5 ? ext.toLowerCase() : 'wav';
}

/** Transcription-only models are not chat models: voxtral, whisper, etc. */
function isTranscriptionModelId(id: string): boolean {
  return /voxtral|whisper|transcribe/i.test(id);
}

/** Parse thinking tags and return cleaned content + thinking. */
function parseThinkingTags(raw: string): {content: string; thinking: string} {
  const thinkMatch = raw.match(/<think>([\s\S]*?)<\/think>/);
  if (thinkMatch) {
    const thinking = thinkMatch[1].trim();
    const content = raw.replace(/<think>[\s\S]*?<\/think>/, '').trim();
    return {content, thinking};
  }
  // Also handle partial thinking (streaming)
  if (raw.includes('<think>') && !raw.includes('</think>')) {
    const parts = raw.split('<think>');
    return {
      content: '',
      thinking: parts[1] ?? '',
    };
  }
  return {content: raw, thinking: ''};
}

/** Chip label for a LOCAL picker row's lifecycle status. */
function localChipLabel(status: LocalChatStatus, progress: number): string {
  switch (status) {
    case 'ready':
      return 'ready';
    case 'error':
      return 'error';
    case 'downloading':
      return `${Math.round(progress * 100)}%`;
    default:
      return status;
  }
}

export default function ChatScreen({
  session,
  chatId,
  onMenuToggle,
  onSignOut,
  onPressAvatar,
}: Props) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const markdownStyles = useMemo<MarkedStyles>(
    () => ({
      // Full-markdown dark styles via react-native-marked (marked.js).
      text: {color: c.textPrimary},
      paragraph: {marginBottom: spacing.sm},
      strong: {fontWeight: '700'},
      em: {fontStyle: 'italic'},
      strikethrough: {textDecorationLine: 'line-through'},
      link: {color: c.accent, textDecorationLine: 'underline'},
      h1: {color: c.textPrimary, fontSize: typography.xl, fontWeight: '700', marginBottom: spacing.sm},
      h2: {color: c.textPrimary, fontSize: typography.lg, fontWeight: '700', marginBottom: spacing.sm},
      h3: {color: c.textPrimary, fontSize: typography.md, fontWeight: '600', marginBottom: spacing.xs},
      h4: {color: c.textPrimary, fontSize: typography.md, fontWeight: '600', marginBottom: spacing.xs},
      h5: {color: c.textPrimary, fontSize: typography.md, fontWeight: '600', marginBottom: spacing.xs},
      h6: {color: c.textSecondary, fontSize: typography.sm, fontWeight: '600', marginBottom: spacing.xs},
      codespan: {
        color: c.accent,
        backgroundColor: c.bgSurface,
        fontFamily: typography.mono,
        fontSize: typography.sm,
        borderRadius: radius.sm,
        paddingHorizontal: spacing.xs,
        paddingVertical: 1,
      },
      code: {
        backgroundColor: c.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        borderRadius: radius.sm,
        padding: spacing.md,
        marginBottom: spacing.sm,
      },
      blockquote: {
        backgroundColor: c.bgSurface,
        borderLeftColor: c.borderStrong,
        borderLeftWidth: 3,
        paddingLeft: spacing.md,
        marginBottom: spacing.sm,
      },
      list: {marginBottom: spacing.sm},
      li: {color: c.textPrimary},
      hr: {
        backgroundColor: 'transparent',
        borderColor: c.border,
        borderBottomWidth: StyleSheet.hairlineWidth,
        marginVertical: spacing.md,
      },
      table: {borderColor: c.border, borderWidth: 1, borderRadius: radius.sm},
      tableRow: {borderColor: c.border},
      tableCell: {
        borderColor: c.border,
        borderWidth: 1,
        padding: spacing.sm,
      },
    }),
    [c],
  );
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Active chat-routing mode ('personal' | 'community' | 'byok'). Drives the
  // picker layout: 'byok' shows the custom-endpoint catalog exclusively;
  // every other mode shows the MOUD gateway catalog exclusively.
  const [quotaMode, setQuotaModeState] = useState<QuotaMode>('community');
  const [fallbackVisionModel, setFallbackVisionModel] = useState<
    string | undefined
  >(undefined);
  // Two on-device engines share the LOCAL segment: ExecuTorch ('local/')
  // and llama.cpp ('gguf/'). Both hooks are mounted ONCE and unconditionally
  // (rules-of-hooks) and stay dormant until selectedModel points at their id
  // namespace — lazy loading happens via useLLM's preventLoad flag inside
  // useLocalChat and via first-send initLlama inside useLlamaChat. Neither
  // engine ever downloads or initializes without an explicit picker selection.
  const activeLocalId = selectedModel.startsWith('local/') ? selectedModel : null;
  const local = useLocalChat(activeLocalId);
  // Live mirror of the streaming response so interval callbacks started at
  // send time read fresh tokens without stale-closure re-render churn.
  const localResponseRef = useRef('');
  const bubblesRef = useRef<Bubble[]>([]);
  useEffect(() => {
    bubblesRef.current = bubbles;
  }, [bubbles]);
  useEffect(() => {
    localResponseRef.current = local.response;
  }, [local.response]);
  const isLocalSelected = selectedModel.startsWith('local/');

  // llama.cpp engine ('gguf/<id>' selections route here).
  const activeGgufId = selectedModel.startsWith('gguf/')
    ? selectedModel.slice('gguf/'.length)
    : null;
  const llama = useLlamaChat(activeGgufId);
  useEffect(() => {
    localResponseRef.current = llama.response;
  }, [llama.response]);
  const isGgufSelected = selectedModel.startsWith('gguf/');

  // Engine sub-toggle inside the LOCAL segment (persisted).
  const [localEngine, setLocalEngine] = useState<LocalEngine>('executorch');
  const switchLocalEngine = useCallback((engine: LocalEngine) => {
    setLocalEngine(engine);
    AsyncStorage.setItem(LOCAL_ENGINE_KEY, engine).catch(() => {});
  }, []);

  // GGUF download bookkeeping: live progress fractions per catalog id plus a
  // mirror of the persisted registry (refreshed when the picker opens and
  // after each download completes).
  const [ggufDownloads, setGgufDownloads] = useState<Record<string, number>>({});
  const [ggufRegistry, setGgufRegistry] = useState<GgufRegistry>({});
  const refreshGgufRegistry = useCallback(() => {
    loadRegistry().then(setGgufRegistry).catch(() => {});
  }, []);

  // Re-attach to downloads that survived a restart: surfaces real progress,
  // finalizes tasks that finished in background, and un-sticks FAILED/STOPPED
  // tasks so the "get" button is never trapped at 0%.
  const resumeGgufDownloads = useCallback(() => {
    for (const entry of CURATED_GGUF_MODELS) {
      loadRegistry().then(reg => {
        if (reg[entry.id]) {
          return;
        }
        resumeActiveModelDownload(entry.id, {
          onProgress: fraction =>
            setGgufDownloads(prev => ({...prev, [entry.id]: fraction})),
          onDone: () => {
            setGgufDownloads(prev => {
              const next = {...prev};
              delete next[entry.id];
              return next;
            });
            refreshGgufRegistry();
          },
          onError: () => {
            setGgufDownloads(prev => {
              const next = {...prev};
              delete next[entry.id];
              return next;
            });
            refreshGgufRegistry();
          },
        });
      });
    }
  }, [refreshGgufRegistry]);

  useEffect(() => {
    resumeGgufDownloads();
  }, [resumeGgufDownloads]);


  const [gatewayModels, setGatewayModels] = useState<GatewayModel[] | null>(
    null,
  );
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelQuery, setModelQuery] = useState('');

  const [byokConfig, setByokConfig] = useState<ByokConfig | null>(null);
  const [byokModels, setByokModels] = useState<ByokModel[] | null>(null);
  const [byokLoading, setByokLoading] = useState(false);
  const [byokError, setByokError] = useState<string | null>(null);

  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Profile avatar for the header button (null → letter mark fallback).
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);
  const sheetRef = useRef<BottomSheetModal>(null);
  const activeChatRef = useRef<string | null>(chatId);
  const cloudStreamRef = useRef<ChatStreamHandle | null>(null);
  // Per-mode persisted selections (mirror of AsyncStorage; written eagerly
  // on selection so a quick mode toggle never restores a stale value).
  const storedSelections = useRef<{
    moud: string | null;
    byok: string | null;
    local: string | null;
  }>({
    moud: null,
    byok: null,
    local: null,
  });
  // Latest selected model for async callbacks (catalog auto-select).
  const selectedModelRef = useRef(selectedModel);
  // Legacy '@sunlight_selected_model' migration runs once per mount.
  const legacyMigratedRef = useRef(false);

  // Subtle pulse for the recording indicator (300ms ease-out, reversed).
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (recording) {
      pulse.value = withRepeat(
        withTiming(0.3, {duration: 300, easing: Easing.out(Easing.ease)}),
        -1,
        true,
      );
    } else {
      pulse.value = 1;
    }
  }, [recording, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulse.value,
    transform: [{scale: pulse.value}],
  }));

  useEffect(() => {
    activeChatRef.current = chatId;
  }, [chatId]);

  /** Inline notice above the composer; auto-hides after 4s. */
  const showToast = useCallback((message: string) => {
    if (noticeTimer.current) {
      clearTimeout(noticeTimer.current);
    }
    setNotice(message);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  useEffect(
    () => () => {
      if (noticeTimer.current) {
        clearTimeout(noticeTimer.current);
      }
    },
    [],
  );

  /** Download a curated GGUF model; explicit user intent from the picker. */
  const startGgufDownload = useCallback(
    (id: string) => {
      setGgufDownloads(prev => ({...prev, [id]: 0}));
      downloadModel(id, fraction => {
        setGgufDownloads(prev => ({...prev, [id]: fraction}));
      })
        .then(() => {
          setGgufDownloads(prev => {
            const next = {...prev};
            delete next[id];
            return next;
          });
          refreshGgufRegistry();
        })
        .catch((e: unknown) => {
          setGgufDownloads(prev => {
            const next = {...prev};
            delete next[id];
            return next;
          });
          showToast(
            `download failed: ${e instanceof Error ? e.message : 'unknown'}`,
          );
        });
    },
    [showToast, refreshGgufRegistry],
  );

  /**
   * Re-resolve routing context and per-mode model selection:
   * - migrates the legacy single selection key into the moud key once,
   * - refreshes byokConfig/quotaMode from loadByokSettings(),
   * - applies each routing mode's last-used model (byok falls back to the
   *   configured modelId before any catalog has been fetched).
   * Safe to call repeatedly (mount and every picker open).
   */
  const refreshRouting = useCallback(async (): Promise<ByokSettings> => {
    let moud: string | null = null;
    let byokStored: string | null = null;
    let localStored: string | null = null;
    try {
      moud = await AsyncStorage.getItem(SELECTED_MODEL_KEY_MOUD);
      byokStored = await AsyncStorage.getItem(SELECTED_MODEL_KEY_BYOK);
      localStored = await AsyncStorage.getItem(SELECTED_MODEL_KEY_LOCAL);
      if (!legacyMigratedRef.current) {
        legacyMigratedRef.current = true;
        if (moud === null) {
          const legacy = await AsyncStorage.getItem(SELECTED_MODEL_KEY_LEGACY);
          if (legacy !== null) {
            await AsyncStorage.setItem(SELECTED_MODEL_KEY_MOUD, legacy);
            moud = legacy;
          }
        }
        await AsyncStorage.removeItem(SELECTED_MODEL_KEY_LEGACY);
      }
    } catch {
      // Storage failures degrade to defaults below.
    }
    storedSelections.current = {
      moud,
      byok: byokStored,
      local: localStored,
    };
    try {
      const settings = await loadByokSettings();
      setByokConfig(settings.byok);
      setQuotaModeState(settings.mode);
      if (settings.mode === 'byok') {
        if (byokStored !== null) {
          setSelectedModel(byokStored);
        } else if (settings.byok) {
          setSelectedModel(settings.byok.modelId);
        }
      } else if (moud !== null) {
        setSelectedModel(moud);
      }
      // On-device selection is mode-independent and wins when present: it
      // must not be clobbered by the per-mode restore above. GGUF picks only
      // survive if their weights are still on disk.
      if (localStored !== null && localStored.startsWith('local/')) {
        setSelectedModel(localStored);
      } else if (localStored !== null && localStored.startsWith('gguf/')) {
        try {
          const reg = await loadRegistry();
          if (reg[localStored.slice('gguf/'.length)]) {
            setSelectedModel(localStored);
          }
        } catch {
          // Registry unreadable → fall through to per-mode selection.
        }
      }
      try {
        const engineStored = await AsyncStorage.getItem(LOCAL_ENGINE_KEY);
        if (engineStored === 'executorch' || engineStored === 'gguf') {
          setLocalEngine(engineStored);
        }
      } catch {
        // Storage failure keeps the default engine.
      }
      try {
        const visionFallback = await AsyncStorage.getItem(
          FALLBACK_VISION_MODEL_KEY,
        );
        if (visionFallback) {
          setFallbackVisionModel(visionFallback);
        }
      } catch {
        // Storage failure keeps the default fallback.
      }
      return settings;
    } catch {
      // loadByokSettings never rejects by contract; defensive only.
      return {byok: null, mode: 'community', usePersonalQuota: false};
    }
  }, []);

  useEffect(() => {
    refreshRouting();
  }, [refreshRouting]);

  // Real user avatar for the header (fetchProfileAvatar caches internally;
  // failures resolve to null and keep the letter mark).
  useEffect(() => {
    let alive = true;
    fetchProfileAvatar(session.subject, session.apiKey)
      .then(url => {
        if (alive) {
          setAvatarUrl(url);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [session.subject, session.apiKey]);

  const loadGatewayModels = useCallback((force = false) => {
    setModelsLoading(true);
    setModelsError(null);
    fetchGatewayModels(force ? {force: true} : {})
      .then(models => {
        setGatewayModels(models);
        setModelsLoading(false);
      })
      .catch((e: unknown) => {
        setModelsError(e instanceof Error ? e.message : 'failed to load models');
        setModelsLoading(false);
      });
  }, []);

  /** Persist a per-mode selection without closing the picker (auto-select). */
  const persistSelection = useCallback(
    (modelId: string, route: 'moud' | 'byok') => {
      setSelectedModel(modelId);
      storedSelections.current[route] = modelId;
      AsyncStorage.setItem(
        route === 'byok' ? SELECTED_MODEL_KEY_BYOK : SELECTED_MODEL_KEY_MOUD,
        modelId,
      ).catch(() => {});
    },
    [],
  );

  /**
   * Load the BYOK catalog — the FULL listing from {baseUrl}/models, not just
   * the configured modelId. After a successful fetch, if the active selection
   * is absent from the catalog, auto-select the configured modelId when
   * present, else the first entry; on an offline failure fall back to the
   * configured modelId so the picker still shows a coherent selection.
   */
  const loadByokCatalog = useCallback(
    (cfg: ByokConfig, force = false) => {
      setByokLoading(true);
      setByokError(null);
      fetchByokModels(cfg, force ? {force: true} : {})
        .then(result => {
          setByokModels(result.models);
          setByokError(result.error);
          setByokLoading(false);
          if (result.models.length > 0) {
            const ids = new Set(result.models.map(m => m.id));
            if (!ids.has(selectedModelRef.current)) {
              const preferred =
                result.models.find(m => m.id === cfg.modelId) ??
                result.models[0];
              persistSelection(preferred.id, 'byok');
            }
          } else if (
            result.error !== null &&
            selectedModelRef.current !== cfg.modelId
          ) {
            persistSelection(cfg.modelId, 'byok');
          }
        })
        .catch(() => {
          // fetchByokModels never rejects by contract; defensive only.
          setByokError('request failed');
          setByokLoading(false);
        });
    },
    [persistSelection],
  );

  /**
   * Open the picker sheet. Routing is re-resolved on every open so a mode
   * switch made in Settings is honored on return: BYOK routing lazily loads
   * the custom-endpoint catalog, anything else the MOUD gateway catalog.
   */
  const openPicker = useCallback(() => {
    setPickerOpen(true);
    sheetRef.current?.present();
    refreshGgufRegistry();
    (async () => {
      const settings = await refreshRouting();
      if (settings.mode === 'byok' && settings.byok) {
        if (byokModels === null && !byokLoading) {
          loadByokCatalog(settings.byok);
        }
      } else if (gatewayModels === null && !modelsLoading) {
        loadGatewayModels();
      }
    })();
  }, [
    refreshRouting,
    byokModels,
    byokLoading,
    loadByokCatalog,
    gatewayModels,
    modelsLoading,
    loadGatewayModels,
    refreshGgufRegistry,
  ]);

  // Id set used by resolveChatTarget to decide whether the picked model is a
  // verified gateway-catalog id.
  const gatewayIds = useMemo(
    () => new Set((gatewayModels ?? []).map(m => m.id)),
    [gatewayModels],
  );

  const visibleGatewayModels = useMemo(
    () =>
      searchModels(
        filterTextModels(gatewayModels ?? []).filter(
          m => !isTranscriptionModelId(m.id),
        ),
        modelQuery,
      ).slice(0, MODEL_PICKER_LIMIT),
    [gatewayModels, modelQuery],
  );

  const visibleByokModels = useMemo(
    () =>
      searchByokModels(
        (byokModels ?? []).filter(m => !isTranscriptionModelId(m.id)),
        modelQuery,
      ).slice(0, MODEL_PICKER_LIMIT),
    [byokModels, modelQuery],
  );

  /**
   * Gateway capability tag of the selected model when known (MOUD catalog).
   * BYOK entries are deliberately not consulted: their catalog carries no
   * trusted capability metadata, so vision stays "unverified" there.
   */
  const selectedCapability = useMemo(() => {
    const gw = (gatewayModels ?? []).find(m => m.id === selectedModel);
    return gw?.capability;
  }, [gatewayModels, selectedModel]);

  const selectedModalities = useMemo(() => {
    const gw = (gatewayModels ?? []).find(m => m.id === selectedModel);
    return gw?.modalities;
  }, [gatewayModels, selectedModel]);

  /**
   * BYOK-only picker context: quota routing is 'byok' AND a usable endpoint
   * is configured. In that mode the sheet shows ONLY the custom catalog —
   * no MOUD list and no segmented source control.
   */
  const activeByokConfig = quotaMode === 'byok' ? byokConfig : null;

  /** Commit a picked model id (+ optional routing switch) and close. */
  const commitSelection = useCallback(
    (modelId: string, route?: 'byok') => {
      persistSelection(modelId, route ?? 'moud');
      if (route === 'byok') {
        // Picking a model from the personal endpoint implies BYOK routing.
        persistQuotaMode('byok').catch(() => {});
      }
      setModelQuery('');
      setPickerOpen(false);
      sheetRef.current?.dismiss();
    },
    [persistSelection],
  );

  /**
   * Commit an on-device model selection: persisted under its own
   * mode-independent key and lazily loaded by useLocalChat via preventLoad.
   * Selecting a LOCAL row IS the download/load intent.
   */
  const commitLocalSelection = useCallback((modelId: string) => {
    setSelectedModel(modelId);
    storedSelections.current.local = modelId;
    AsyncStorage.setItem(SELECTED_MODEL_KEY_LOCAL, modelId).catch(() => {});
    setModelQuery('');
    setPickerOpen(false);
    sheetRef.current?.dismiss();
  }, []);

  // Load messages when chatId changes
  useEffect(() => {
    if (!chatId) {
      setBubbles([]);
      return;
    }
    loadMessages(chatId).then(msgs => {
      const loaded: Bubble[] = msgs.map((m, i) => ({
        id: `loaded-${i}-${m.role}`,
        role: m.role,
        content: m.content,
      }));
      setBubbles(loaded);
    });
  }, [chatId]);


  const [permSheet, setPermSheet] = useState<PermissionKind | null>(null);
  const permSheetRef = useRef<BottomSheetModal>(null);
  const permActionRef = useRef<(() => void) | null>(null);
  const runAfterExplain = useCallback(
    (kind: PermissionKind, action: () => void) => {
      AsyncStorage.getItem(`@sunlight_perm_ok_${kind}`)
        .then(ok => {
          if (ok === '1') {
            action();
          } else {
            permActionRef.current = action;
            setPermSheet(kind);
          }
        })
        .catch(action);
    },
    [],
  );
  const handlePermGrant = useCallback(() => {
    const kind = permSheet;
    setPermSheet(null);
    if (kind) {
      AsyncStorage.setItem(`@sunlight_perm_ok_${kind}`, '1').catch(() => {});
    }
    permActionRef.current?.();
    permActionRef.current = null;
  }, [permSheet]);

  // BottomSheetModal se muestra imperativamente vía .present(): montar no
  // basta. Este effect traduce el prop `kind` (null = cerrado) al control
  // imperativo; sin él el botón de galería/micrófono no reaccionaba.
  useEffect(() => {
    if (permSheet) {
      permSheetRef.current?.present();
    } else {
      permSheetRef.current?.dismiss();
    }
  }, [permSheet]);

  const pickImage = useCallback(async () => {
    const permission = await requestGalleryPermission();
    if (permission !== 'granted') {
      showToast('permission needed — enable it in system settings');
      return;
    }
    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 1,
      maxWidth: 1568,
      maxHeight: 1568,
      // Library's PhotoQuality type only allows 0.1 steps; 0.8 ≈ requested 0.85.
      quality: 0.8,
      includeBase64: false,
    });
    const asset = result.assets?.[0];
    if (!asset?.uri) {
      return; // User cancelled or picker returned nothing usable.
    }
    try {
      const base64 = await RNFS.readFile(asset.uri, 'base64');
      // Post-resize guard: launchImageLibrary downscales to 1568px, but
      // output can still exceed the cap. fileSize may be omitted by some
      // pickers, so also check the decoded byte estimate.
      if (
        (asset.fileSize !== undefined && asset.fileSize > MAX_IMAGE_BYTES) ||
        isOversizedImage(Math.floor((base64.length * 3) / 4))
      ) {
        showToast('image too large — max 12MB');
        return;
      }
      const mime = inferImageMime(asset.type, asset.fileName);
      setPending(prev => {
        if (prev.length >= MAX_ATTACHMENTS) {
          showToast(`max ${MAX_ATTACHMENTS} attachments`);
          return prev;
        }
        return [
          ...prev,
          {
            id: `img-${Date.now()}`,
            uri: asset.uri,
            attachment: {
              kind: 'image',
              dataUri: `data:${mime};base64,${base64}`,
            },
      },
        ];
      });
    } catch {
      showToast('could not read image');
    }
  }, [showToast]);

  const docPickerRef = useRef<BottomSheetModal>(null);

  const pickDocument = useCallback(async () => {
    try {
      const [file] = await pick({
        type: [
          docTypes.pdf,
          docTypes.docx,
          docTypes.xls,
          docTypes.xlsx,
          docTypes.csv,
          docTypes.plainText,
          docTypes.json,
          docTypes.allFiles,
        ],
        mode: 'open',
      });

      if (!file?.uri) {
        return;
      }

      const fileName = file.name || file.uri.split('/').pop() || 'document';
      showToast(`reading ${fileName}...`);
      docPickerRef.current?.dismiss();

      const parsed = await parseDocument(file.uri, GATEWAY_URL);
      const preview = parsed.text.slice(0, 3000);

      setPending(prev => {
        if (prev.length >= MAX_ATTACHMENTS) {
          showToast(`max ${MAX_ATTACHMENTS} attachments`);
          return prev;
        }
        return [
          ...prev,
          {
            id: `doc-${Date.now()}`,
            uri: file.uri,
            attachment: {
              kind: 'document' as const,
              dataUri: `[Document: ${fileName} (${parsed.format}, ${parsed.pageCount ?? '?'} pages)]\n\n${preview}${parsed.text.length > 3000 ? '\n\n... (truncated)' : ''}`,
            },
          },
        ];
      });
    } catch (e) {
      if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) {
        return;
      }
      showToast('could not read document');
    }
  }, [showToast]);

  const toggleRecording = useCallback(async () => {
    if (recording) {
      const stopped = await stopRecording();
      setRecording(false);
      if (!stopped.ok) {
        showToast('could not save recording');
        return;
      }
      try {
        const base64 = await RNFS.readFile(stopped.uri, 'base64');
        setPending(prev => {
          if (prev.length >= MAX_ATTACHMENTS) {
            showToast(`max ${MAX_ATTACHMENTS} attachments`);
            return prev;
          }
          return [
            ...prev,
            {
              id: `aud-${Date.now()}`,
              uri: stopped.uri,
              durationMs: stopped.durationMs,
              attachment: {
                kind: 'audio',
                data: base64,
                format: audioFormatOf(stopped.uri),
              },
            },
          ];
        });
      } catch {
        showToast('could not read recording');
      }
      return;
    }

    const permission = await requestMicPermission();
    if (permission !== 'granted') {
      showToast('permission needed — enable it in system settings');
      return;
    }
    const started = await startRecording();
    if (started.ok) {
      setRecording(true);
    } else if (
      started.reason === 'permission_denied' ||
      started.reason === 'permission_blocked'
    ) {
      showToast('permission needed — enable it in system settings');
    } else {
      showToast('could not start recording');
    }
  }, [recording, showToast]);

  const removePending = useCallback((id: string) => {
    setPending(prev => prev.filter(a => a.id !== id));
  }, []);

  /**
   * On-device send path — no network. Appends bubbles locally, feeds our own
   * history to executorch's generate() (we own persistence), and streams
   * tokens into the assistant bubble by polling llm.response at 100ms until
   * the generation promise settles. Interrupt is honored via the busy send
   * button (local.interrupt); a partial response still finalizes normally.
   */
  const runLocalSend = useCallback(
    (
      text: string,
      sendFn: (history: readonly ChatMessage[]) => Promise<string>,
    ) => {
      const currentChat = activeChatRef.current;
      const userBubble: Bubble = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: text,
      };
      const assistantBubble: Bubble = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: '',
        thinking: '',
        showThinking: false,
      };

      setInput('');
      setPending([]);
      setBubbles(prev => [...prev, userBubble, assistantBubble]);
      setBusy(true);

      if (currentChat) {
        appendMessage(currentChat, {
          role: 'user',
          content: userBubble.content,
        });
      }

      // History: add search instruction + prior turns + user message.
      const SEARCH_INSTRUCTION: ChatMessage = {
        role: 'system',
        content:
          'You are a helpful assistant with internet access. When you need current or real-time information that you don\'t have, output EXACTLY this JSON on its own line: {"search":"your search query here"} — then wait for search results. After receiving search results, answer the question using that information. Do NOT output the search JSON unless you genuinely need to search for something. Be concise.',
      };
      const history: ChatMessage[] = [
        SEARCH_INSTRUCTION,
        ...[...bubbles, userBubble]
          .slice(-30)
          .map(b => ({role: b.role, content: b.content})),
      ];

      const applyStreamingDelta = () => {
        setBubbles(prev => {
          const last = prev[prev.length - 1];
          if (last?.role !== 'assistant' || last.id !== assistantBubble.id) {
            return prev;
          }
          const parsed = parseThinkingTags(localResponseRef.current);
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              content: parsed.content,
              thinking: parsed.thinking || last.thinking,
            },
          ];
        });
      };
      const pollTimer = setInterval(applyStreamingDelta, 100);

      // Max 2 search iterations to avoid loops
      let searchCount = 0;
      const MAX_SEARCHES = 2;

      const doSend = async (hist: ChatMessage[]): Promise<string> => {
        const final = await sendFn(hist);
        const searchMatch = final.match(/\{"search"\s*:\s*"([^"]+)"\}/);
        if (searchMatch && searchCount < MAX_SEARCHES) {
          searchCount++;
          const query = searchMatch[1];
          try {
            const resp = await request<{context: string}>('/v1/tools/web_search', {
              method: 'POST',
              body: {query, num_results: 5},
            });
            const searchResults = resp.context || 'No results found.';
            const continuedHistory: ChatMessage[] = [
              ...hist,
              {role: 'assistant', content: final},
              {role: 'user', content: `Search results for "${query}":\n\n${searchResults}\n\nNow answer the original question using these results.`},
            ];
            return doSend(continuedHistory);
          } catch {
            return final;
          }
        }
        return final;
      };

      doSend(history)
        .then(final => {
          clearInterval(pollTimer);
          localResponseRef.current = final;
          applyStreamingDelta();
          setBusy(false);
          if (currentChat) {
            const content = parseThinkingTags(final).content;
            if (content) {
              appendMessage(currentChat, {role: 'assistant', content});
            }
          }
        })
        .catch((e: unknown) => {
          clearInterval(pollTimer);
          const message = e instanceof Error ? e.message : 'generation failed';
          setBubbles(prev => {
            const last = prev[prev.length - 1];
            if (last?.role !== 'assistant') return prev;
            return [
              ...prev.slice(0, -1),
              {...last, content: last.content || `error: ${message}`},
            ];
          });
          setBusy(false);
        });
  }, [bubbles]);


  const stopCloud = useCallback(() => {
    // cancel() does not fire onDone/onError, so reset the stream state here.
    try {
      cloudStreamRef.current?.cancel();
    } catch {
      // Cancel is best-effort.
    }
    cloudStreamRef.current = null;
    setBusy(false);
    const chat = activeChatRef.current;
    // Read the latest bubble from the ref so the updater stays pure.
    const last = bubblesRef.current[bubblesRef.current.length - 1];
    if (chat && last?.role === 'assistant' && last.content) {
      appendMessage(chat, {role: 'assistant', content: last.content}).catch(
        () => {},
      );
    }
  }, []);

  // Local engines can throw SYNCHRONOUSLY on interrupt() (executorch
  // ModuleNotLoaded, llama.rn JSI bindings missing). Never let that reach the
  // tap handler or the app closes.
  const stopLocal = useCallback(() => {
    try {
      if (isGgufSelected) {
        llama.interrupt();
      } else {
        local.interrupt();
      }
    } catch {
      // The generate() promise rejects and runLocalSend finalizes the bubble.
    }
  }, [isGgufSelected, llama, local]);

  const send = useCallback(() => {
    if (busy) {
      return;
    }
    const text = input.trim();
    if (!text && pending.length === 0) {
      return;
    }

    // On-device path (both engines): text-only, no network, bypasses
    // resolveChatTarget and streamChat entirely. ExecuTorch sends are blocked
    // until the model reports ready; llama.cpp loads lazily on first send.
    if (isLocalSelected || isGgufSelected) {
      if (
        pending.some(
          a => a.attachment.kind === 'image' || a.attachment.kind === 'audio',
        )
      ) {
        showToast('on-device models support text only');
        return;
      }
      if (isGgufSelected) {
        if (llama.status === 'error') {
          showToast(`local model error: ${llama.error ?? 'unknown'}`);
          return;
        }
        runLocalSend(text, llama.send);
      } else {
        if (local.status !== 'ready') {
          showToast('local model still loading');
          return;
        }
        runLocalSend(text, local.send);
      }
      return;
    }

    // Multimodal gating: images are handled via vision fallback inside
    // runStream (async). Here we just check capability for the unverified hint.
    const hasImage = pending.some(a => a.attachment.kind === 'image');
    const hasAudio = pending.some(a => a.attachment.kind === 'audio');
    if (hasImage) {
      const vision = visionSupport(selectedModel, selectedCapability, selectedModalities);
      if (!vision.known) {
        showToast('vision capability unverified for this model');
      }
    }
    // Audio is never gated here: voice clips are transcribed to text
    // (whisper.cpp) inside runStream and sent as text, so any chat model
    // accepts them.

    const currentChat = activeChatRef.current;
    const attachedLabels =
      pending.length > 0 ? pending.map(attachmentLabel).join(' ') + ' ' : '';
    const userBubble: Bubble = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: attachedLabels + text,
    };
    const assistantBubble: Bubble = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      content: '',
      thinking: '',
      showThinking: false,
    };

    setInput('');
    setPending([]);
    setBubbles(prev => [...prev, userBubble, assistantBubble]);
    setBusy(true);

    if (currentChat) {
      appendMessage(currentChat, {
        role: 'user',
        content: userBubble.content,
      });
      // Auto-name chat from first message
      if (bubbles.length === 0) {
        updateChat(currentChat, {title: generateTitle(text)});
      }
    }

    let sendCancelled = false;
    const runStream = async () => {
      // Route through BYOK when quota mode says so; otherwise the gateway
      // with the session key.
      try {
        const settings = await loadByokSettings();
        if (sendCancelled) {
          return;
        }
        const target = resolveChatTarget(session, settings, selectedModel, {
          gatewayModelIds: gatewayIds,
        });

        let sendText = text;
        let sendAttachments = pending.map(a => a.attachment);

        // Vision handling:
        // - Gateway models: the gateway handles vision routing server-side
        //   via vision_proxy. No client-side fallback needed.
        // - BYOK models: apply client-side fallback (gateway doesn't know them).
        if (hasImage && target.route === 'byok') {
          try {
            const fallback = await applyVisionFallback(
              sendText,
              sendAttachments,
              selectedModel,
              selectedCapability,
              selectedModalities,
              target.apiKey,
              gatewayModels ?? [],
              fallbackVisionModel,
            );
            if (fallback.usedFallback) {
              sendText = fallback.text;
              sendAttachments = fallback.attachments;
              showToast(
                `image described via ${fallback.visionModel}`,
              );
            } else if (!getModelCapabilities(selectedModel, selectedCapability, selectedModalities).vision) {
              showToast('selected model does not support images and no fallback available');
              setBusy(false);
              return;
            }
          } catch {
            if (!getModelCapabilities(selectedModel, selectedCapability, selectedModalities).vision) {
              showToast('selected model does not support images and no fallback available');
              setBusy(false);
              return;
            }
          }
        }

        // Audio is never sent raw to a chat model: transcribe each clip to
        // text first, then fold the transcript into the prompt and drop the
        // audio part. Transcription models (voxtral/whisper) are not chat
        // models and are filtered out of the picker.

        // Web search: if the user's message contains a search intent,
        // query SearXNG via the gateway and prepend results as context.
        const searchQuery = detectSearchIntent(text);
        if (searchQuery) {
          try {
            setSearching(true);
            const results = await searchWeb(searchQuery, target.apiKey);
            setSearching(false);
            if (results.length > 0) {
              const ctx = formatSearchContext(results, searchQuery);
              sendText = `${ctx}\n\nUser question: ${text}`;
            }
          } catch {
            setSearching(false);
          }
        }

        if (hasAudio) {
          for (const a of pending) {
            if (a.attachment.kind !== 'audio') {
              continue;
            }
            if (!a.uri) {
              showToast('audio file not available');
              setBusy(false);
              return;
            }
            try {
              const transcript = await transcribeAudio(
                target.apiKey,
                a.uri,
                a.attachment.format,
              );
              if (transcript) {
                sendText = `${sendText} ${transcript}`.trim();
              }
            } catch (e) {
              showToast(
                `transcription failed: ${e instanceof Error ? e.message : 'unknown'}`,
              );
              setBusy(false);
              return;
            }
          }
          sendAttachments = sendAttachments.filter(x => x.kind !== 'audio');
        }

        // Outgoing payload: system message + history + user message.
        const systemMsg = buildSystemMessage();
        const outgoing: Array<{
          role: 'system' | Bubble['role'];
          content: string | ReturnType<typeof buildUserContent>;
        }> = [
          systemMsg,
          ...[...bubbles, userBubble].slice(-30).map((b, i, all) => {
            if (i === all.length - 1 && b.role === 'user') {
              return {
                role: b.role,
                content: buildUserContent(
                  sendText,
                  sendAttachments,
                  selectedModel,
                ),
              };
            }
            return {role: b.role, content: b.content};
          }),
        ];

        const tools = buildToolsArray();

        const invokeStream = async (
          messages: Array<{role: string; content: string | ReturnType<typeof buildUserContent>; tool_calls?: unknown[]; tool_call_id?: string}>,
          retries = 0,
        ) => {
          cloudStreamRef.current = streamChat(
            target.apiKey,
            target.model,
            messages as unknown as ChatMessage[],
            {
              onDelta: (token: string) => {
                setBubbles(prev => {
                  const last = prev[prev.length - 1];
                  if (last?.role !== 'assistant') return prev;
                  const raw = last.content + token;
                  const parsed = parseThinkingTags(raw);
                  return [
                    ...prev.slice(0, -1),
                    {
                      ...last,
                      content: parsed.content,
                      thinking: parsed.thinking || last.thinking,
                    },
                  ];
                });
              },
              onReasoning: (chunk: string) => {
                setBubbles(prev => {
                  const last = prev[prev.length - 1];
                  if (last?.role !== 'assistant') return prev;
                  return [
                    ...prev.slice(0, -1),
                    {...last, thinking: (last.thinking ?? '') + chunk},
                  ];
                });
              },
              onError: (message: string, info?: ChatErrorInfo) => {
                cloudStreamRef.current = null;
                setBubbles(prev => {
                  const last = prev[prev.length - 1];
                  if (last?.role !== 'assistant') return prev;
                  return [
                    ...prev.slice(0, -1),
                    {...last, content: last.content || `error: ${message}`},
                  ];
                });
                setBusy(false);
                if (info?.authExpired) onSignOut();
              },
              onDone: async (toolCalls?: ToolCall[]) => {
                cloudStreamRef.current = null;
                // If the model returned tool calls, execute them and loop.
                if (toolCalls && toolCalls.length > 0 && retries < 8) {
                  const toolResults: Array<{role: 'tool'; content: string; tool_call_id: string}> = [];
                  for (const tc of toolCalls) {
                    let result = '';
                    try {
                      if (tc.name === 'web_search') {
                        // Built-in web search tool
                        const args = JSON.parse(tc.arguments || '{}');
                        const query = args.query || args.q || '';
                        setSearching(true);
                        const results = await searchWeb(query, target.apiKey);
                        setSearching(false);
                        result = results.length > 0
                          ? formatSearchContext(results, query)
                          : `No results found for "${query}".`;
                      } else if (tc.name === 'deep_research') {
                        const args = JSON.parse(tc.arguments || '{}');
                        setSearching(true);
                        try {
                          const resp = await request<{
                            context: string;
                            results: Array<{title: string; url: string; snippet: string; source_engine: string; score: number}>;
                            citations: string[];
                            metadata: {engines_used: string[]; total_results: number; elapsed_ms: number};
                          }>('/v1/tools/deep_research', {
                            method: 'POST',
                            body: args,
                            apiKey: target.apiKey,
                            timeoutMs: 30_000,
                          });
                          result = resp.context;
                          if (resp.citations?.length > 0) {
                            result += '\n\nCitations: ' + resp.citations.join(', ');
                          }
                        } finally {
                          setSearching(false);
                        }
                      } else if (tc.name === 'web_extract') {
                        const args = JSON.parse(tc.arguments || '{}');
                        setSearching(true);
                        try {
                          const resp = await request<{content: string; title: string}>(
                            '/v1/tools/web_extract',
                            {
                              method: 'POST',
                              body: args,
                              apiKey: target.apiKey,
                              timeoutMs: 20_000,
                            },
                          );
                          result = resp.content
                            ? `## ${resp.title || args.url}\n\n${resp.content}`
                            : `Could not extract content from ${args.url}`;
                        } catch {
                          // Fallback: try Jina Reader directly
                          try {
                            const resp = await fetch(`https://r.jina.ai/${args.url}`, {
                              headers: {Accept: 'text/plain'},
                            });
                            result = await resp.text();
                          } catch {
                            result = `Error: Could not extract content from ${args.url}`;
                          }
                        } finally {
                          setSearching(false);
                        }
                      } else if (tc.name === 'math_eval') {
                        const args = JSON.parse(tc.arguments || '{}');
                        result = executeMathEval(args.expression || '');
                      } else if (tc.name === 'unit_convert') {
                        const args = JSON.parse(tc.arguments || '{}');
                        result = await executeUnitConvert(
                          args.value || '0',
                          args.from || '',
                          args.to || '',
                        );
                      } else if (tc.name === 'statistics') {
                        const args = JSON.parse(tc.arguments || '{}');
                        result = executeStatistics(args.data || []);
                      } else if (tc.name === 'read_document') {
                        const args = JSON.parse(tc.arguments || '{}');
                        try {
                          const parsed = await parseDocument(args.file_path || '', GATEWAY_URL);
                          result = `[${parsed.format.toUpperCase()} document — ${parsed.pageCount ?? '?'} pages]\n\n${parsed.text}`;
                        } catch (e) {
                          result = `Error reading document: ${e instanceof Error ? e.message : 'unknown'}`;
                        }
                      } else if (tc.name === 'execute_code') {
                        const args = JSON.parse(tc.arguments || '{}');
                        setSearching(true);
                        try {
                          const resp = await request<{
                            success: boolean;
                            stdout: string;
                            stderr: string;
                            exit_code: number;
                            execution_time_ms: number;
                            provider: string;
                            error?: string;
                          }>('/v1/tools/execute_code', {
                            method: 'POST',
                            body: {
                              code: args.code || '',
                              language: args.language || 'python',
                              provider: args.provider || 'novita',
                              timeout: args.timeout || 15,
                            },
                            apiKey: target.apiKey,
                            timeoutMs: 120_000,
                          });

                          let output = '';
                          if (resp.stdout) {
                            output += resp.stdout;
                          }
                          if (resp.stderr) {
                            output += output ? `\n\nSTDERR:\n${resp.stderr}` : resp.stderr;
                          }
                          if (resp.error) {
                            output += output ? `\n\nERROR:\n${resp.error}` : resp.error;
                          }
                          if (resp.exit_code !== 0 && !output) {
                            output = `Exit code: ${resp.exit_code}`;
                          }
                          if (!output) {
                            output = 'Code executed successfully (no output)';
                          }
                          output += `\n\n[${resp.provider} · ${resp.execution_time_ms}ms]`;
                          result = output;
                        } catch (e) {
                          result = `Code execution error: ${e instanceof Error ? e.message : 'unknown'}`;
                        } finally {
                          setSearching(false);
                        }
                      } else if (tc.name === 'generate_file') {
                        const args = JSON.parse(tc.arguments || '{}');
                        result = await executeGenerateFile(
                          args.content || '',
                          args.filename || 'file',
                          args.format || 'txt',
                          target.apiKey,
                        );
                      } else if (tc.name === 'generate_pdf') {
                        const args = JSON.parse(tc.arguments || '{}');
                        result = await executeGeneratePdf(
                          args.html || '',
                          args.filename || 'document',
                          target.apiKey,
                        );
                      } else if (tc.name === 'generate_docx') {
                        const args = JSON.parse(tc.arguments || '{}');
                        result = await executeGenerateDocx(
                          args.spec || {title: 'Document', paragraphs: [{text: ''}]},
                          args.filename || 'document',
                          target.apiKey,
                        );
                      } else if (tc.name === 'generate_xlsx') {
                        const args = JSON.parse(tc.arguments || '{}');
                        result = await executeGenerateXlsx(
                          args.sheets || [{name: 'Sheet1', headers: [], rows: []}],
                          args.filename || 'spreadsheet',
                          target.apiKey,
                        );
                      } else if (tc.name === 'generate_presentation') {
                        const args = JSON.parse(tc.arguments || '{}');
                        result = await executeGeneratePresentation(
                          args.slides || [],
                          args.filename || 'presentation',
                          target.apiKey,
                        );
                      } else if (tc.name === 'share_file') {
                        const args = JSON.parse(tc.arguments || '{}');
                        const filePath = args.file_path || '';
                        const useCloud = args.cloud !== false;

                        if (useCloud && target.apiKey) {
                          try {
                            const {uploadFile} = require('../lib/cloudStorage');
                            const upload = await uploadFile(filePath, target.apiKey);
                            result = `Cloud link: ${upload.url}\n\nShareable URL ready. The link expires never — anyone with the link can view the file.`;
                          } catch (e) {
                            // Fallback to local share
                            result = await executeShareFile(filePath);
                          }
                        } else {
                          result = await executeShareFile(filePath);
                        }
                      } else if (tc.name === 'search_files') {
                        const args = JSON.parse(tc.arguments || '{}');
                        const q = args.query || '';
                        try {
                          const resp = await request(
                            `/v1/files/search?q=${encodeURIComponent(q)}`,
                          );
                          const d = await resp.json();
                          if (d.found) {
                            result = `Found: ${d.filename}\nSize: ${d.size} bytes\nURL: ${d.url}\nConfidence: ${Math.round(d.confidence * 100)}%`;
                          } else {
                            result = 'No matching files found.';
                          }
                        } catch {
                          result = 'File search failed.';
                        }
                      } else {
                        result = `Error: Unknown tool "${tc.name}".`;
                      }
                    } catch (e) {
                      result = `Error executing ${tc.name}: ${e instanceof Error ? e.message : 'unknown'}`;
                      setSearching(false);
                    }
                    toolResults.push({
                      role: 'tool' as const,
                      content: result,
                      tool_call_id: tc.id,
                    });
                  }
                  // Append assistant message with tool_calls and results
                  const updatedMessages = [
                    ...messages,
                    {
                      role: 'assistant' as const,
                      content: '',
                      tool_calls: toolCalls.map(tc => ({
                        id: tc.id,
                        type: 'function',
                        function: {name: tc.name, arguments: tc.arguments},
                      })),
                    },
                    ...toolResults,
                  ];
                  // Show "executing tools..." bubble
                  setBubbles(prev => {
                    const last = prev[prev.length - 1];
                    if (last?.role !== 'assistant') return prev;
                    return [
                      ...prev.slice(0, -1),
                      {...last, content: `executing ${toolCalls.map(tc => tc.name).join(', ')}…`},
                    ];
                  });
                  await invokeStream(updatedMessages, retries + 1);
                  return;
                }

                // Normal completion — check if AI indicated uncertainty.
                // If so, auto-search and re-invoke with results as context.
                const lastBubble = bubblesRef.current[bubblesRef.current.length - 1];
                const aiResponse = lastBubble?.content ?? '';
                if (
                  retries === 0 &&
                  aiResponse.length < 500 &&
                  detectUncertainty(aiResponse)
                ) {
                  const searchQuery = detectSearchIntent(text);
                  if (searchQuery) {
                    try {
                      setSearching(true);
                      const results = await searchWeb(searchQuery, target.apiKey);
                      setSearching(false);
                      if (results.length > 0) {
                        const ctx = formatSearchContext(results, searchQuery);
                        const searchMsg = [
                          ...messages,
                          {role: 'assistant' as const, content: aiResponse},
                          {
                            role: 'user' as const,
                            content: `[Web search results for "${searchQuery}"]:\n\n${ctx}\n\nPlease use this information to answer my original question: ${text}`,
                          },
                        ];
                        // Show "searching..." in bubble
                        setBubbles(prev => {
                          const last = prev[prev.length - 1];
                          if (last?.role !== 'assistant') return prev;
                          return [
                            ...prev.slice(0, -1),
                            {...last, content: 'searching web for more info…'},
                          ];
                        });
                        await invokeStream(searchMsg, retries + 1);
                        return;
                      }
                    } catch {
                      setSearching(false);
                    }
                  }
                }

                // Final completion — save to history
                setBusy(false);
                if (currentChat) {
                  setBubbles(prev => {
                    const last = prev[prev.length - 1];
                    if (last?.role === 'assistant' && last.content) {
                      appendMessage(currentChat, {
                        role: 'assistant',
                        content: last.content,
                      });
                    }
                    return prev;
                  });
                }
              },
            },
            {tools, ...(target.baseUrl ? {baseUrl: target.baseUrl} : {})},
          );
        };

        await invokeStream(outgoing);
      } catch {
        // loadByokSettings never rejects by contract; defensive fallback
        // keeps the community route alive even if that invariant breaks.
        const systemMsg = buildSystemMessage();
        const plainOutgoing: Array<{
          role: 'system' | Bubble['role'];
          content: string;
        }> = [
          systemMsg,
          ...[...bubbles, userBubble].slice(-30).map(b => ({
            role: b.role,
            content: b.content,
          })),
        ];
        cloudStreamRef.current = streamChat(
          session.apiKey,
          selectedModel,
          plainOutgoing as unknown as ChatMessage[],
          {
            onError: (message: string, info?: ChatErrorInfo) => {
              cloudStreamRef.current = null;
              setBubbles(prev => {
                const last = prev[prev.length - 1];
                if (last?.role !== 'assistant') return prev;
                return [
                  ...prev.slice(0, -1),
                  {...last, content: last.content || `error: ${message}`},
                ];
              });
              setBusy(false);
              if (info?.authExpired) onSignOut();
            },
            onDone: () => {
              cloudStreamRef.current = null;
              setBusy(false);
            },
          },
        );
      }
    };
    runStream();

    return () => {
      sendCancelled = true;
    };
  }, [
    input,
    busy,
    pending,
    bubbles,
    session,
    selectedModel,
    selectedCapability,
    onSignOut,
    gatewayIds,
    showToast,
    isLocalSelected,
    isGgufSelected,
    local,
    llama,
    runLocalSend,
    fallbackVisionModel,
    gatewayModels,
  ]);

  useEffect(() => {
    listRef.current?.scrollToEnd({animated: true});
  }, [bubbles]);

  const toggleThinking = (id: string) => {
    setBubbles(prev =>
      prev.map(b => (b.id === id ? {...b, showThinking: !b.showThinking} : b)),
    );
  };

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.6}
      />
    ),
    [],
  );

  const canSend = !busy && (input.trim().length > 0 || pending.length > 0);
  const sendDisabled = !busy && !input.trim() && pending.length === 0;

  const renderBubble = ({item}: {item: Bubble}) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser]}>
        <View style={[styles.avatar, isUser ? styles.avatarUser : styles.avatarAssistant]}>
          <Text
            style={[styles.avatarText, isUser && {color: c.accentText}]}>
            {isUser ? 'Y' : 'S'}
          </Text>
        </View>
        <View style={styles.bubbleContent}>
          {/* Thinking — hidden by default */}
          {!isUser && item.thinking ? (
            <TouchableOpacity onPress={() => toggleThinking(item.id)}>
              <Text style={styles.thinkingLabel}>
                {item.showThinking ? 'v ' : '> '}thinking
              </Text>
              {item.showThinking && (
                <Text style={styles.thinkingText}>{item.thinking}</Text>
              )}
            </TouchableOpacity>
          ) : null}

          {item.content ? (
            isUser ? (
              <Text style={styles.bubbleText}>{item.content}</Text>
            ) : (
              <Markdown value={item.content} styles={markdownStyles} />
            )
          ) : busy && !isUser ? (
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
              <ActivityIndicator size="small" color={c.textTertiary} />
              {searching ? <Text style={{color: c.textTertiary, fontSize: 12}}>searching web…</Text> : null}
            </View>
          ) : null}

          {!isUser && item.content ? (
            <TouchableOpacity
              style={styles.copyBtn}
              hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
              onPress={() => {
                try {
                  Clipboard.setString(item.content);
                  showToast('copied to clipboard');
                } catch {
                  // Clipboard unavailable; ignore.
                }
              }}>
              <Copy size={12} color={c.textTertiary} strokeWidth={1.75} />
              <Text style={styles.copyText}>copy</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}>
        {/* Header — like Claude/Kimi */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.menuBtn} onPress={onMenuToggle}>
            <Menu size={20} color={c.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.modelSelector} onPress={openPicker}>
            <Text style={styles.modelName} numberOfLines={1}>
              {modelDisplayName(selectedModel)}
            </Text>
            <ChevronDown size={14} color={c.textTertiary} style={{transform: [{rotate: pickerOpen ? '180deg' : '0deg'}]}} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.avatarBtn}
            onPress={
              onPressAvatar ??
              (() => navigation.navigate('Settings', {session}))
            }>
            {avatarUrl ? (
              <Image source={{uri: avatarUrl}} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarBtnText}>
                {initialFor(null, session.subject)}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Messages */}
        <FlatList
          ref={listRef}
          data={bubbles}
          keyExtractor={item => item.id}
          renderItem={renderBubble}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => listRef.current?.scrollToEnd({animated: true})}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <AppIcon size={48} />
              <Text style={styles.emptyTitle}>Hi, what can I help with?</Text>
            </View>
          }
        />

        {/* Composer */}
        <View style={styles.composer}>
          {/* On-device load/download banner: slim inline progress or error+retry.
              Covers both engines: ExecuTorch download/load states and the
              llama.cpp lazy first-send context initialization. */}
          {((isLocalSelected && local.status !== 'ready') ||
            (isGgufSelected &&
              (llama.status === 'loading' || llama.status === 'error'))) ? (
            <View style={styles.localBanner}>
              {(isGgufSelected ? llama.status : local.status) === 'error' ? (
                <>
                  <Text style={styles.localBannerError} numberOfLines={1}>
                    {`local model error: ${(isGgufSelected
                      ? llama.error
                      : local.error) ?? 'unknown'}`}
                  </Text>
                  <TouchableOpacity
                    style={styles.retryBtn}
                    onPress={isGgufSelected ? llama.retry : local.retry}>
                    <Text style={styles.retryBtnText}>retry</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <Text style={styles.localBannerText}>
                  {isGgufSelected
                    ? 'preparing GGUF model…'
                    : local.status === 'downloading'
                      ? `loading local model… ${Math.round(local.downloadProgress * 100)}%`
                      : 'preparing local model…'}
                </Text>
              )}
            </View>
          ) : null}

          {notice ? (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          ) : null}

          {/* Attachment previews: thumbnails + duration chips */}
          {pending.length > 0 ? (
            <View style={styles.previewStrip}>
              {pending.map(att => (
                <View key={att.id} style={styles.previewItem}>
                  {att.attachment.kind === 'image' && att.uri ? (
                    <Image source={{uri: att.uri}} style={styles.previewThumb} />
                  ) : att.attachment.kind === 'audio' ? (
                    <View style={styles.previewChip}>
                      <Text style={styles.previewChipText}>
                        {`voice ${formatDuration(att.durationMs ?? 0)} · ${att.attachment.format}`}
                      </Text>
                    </View>
                  ) : att.attachment.kind === 'document' ? (
                    <View style={styles.previewChip}>
                      <Text style={styles.previewChipText} numberOfLines={1}>
                        {att.attachment.dataUri.split('\n')[0].replace('[Document: ', '').slice(0, 30)}
                      </Text>
                    </View>
                  ) : null}
                  <TouchableOpacity
                    style={styles.previewRemove}
                    onPress={() => removePending(att.id)}>
                    <Text style={styles.previewRemoveText}>x</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.inputWrap}>
            {/* Gallery — permission-gated photo picker */}
            <TouchableOpacity
              style={styles.attachBtn}
              onPress={() =>
                runAfterExplain('gallery', () => {
                  pickImage();
                })
              }
              disabled={busy}>
              <ImagePlus size={20} color={c.textSecondary} />
            </TouchableOpacity>

            {/* Mic — toggles recording; pulsing white dot while active */}
            <TouchableOpacity
              style={styles.attachBtn}
              onPress={() =>
                runAfterExplain('microphone', () => {
                  toggleRecording();
                })
              }
              disabled={busy}>
              {recording ? (
                <Animated.View style={[styles.recDot, pulseStyle]} />
              ) : (
                <Mic size={18} color={c.textSecondary} />
              )}
            </TouchableOpacity>

            {/* Document — reads local files (PDF, DOCX, XLSX, CSV, TXT) */}
            <TouchableOpacity
              style={styles.attachBtn}
              onPress={() => docPickerRef.current?.present()}
              disabled={busy}>
              <FileText size={18} color={c.textSecondary} />
            </TouchableOpacity>

            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="message..."
              placeholderTextColor={c.textTertiary}
              multiline
              maxLength={4000}
              editable={!busy}
              returnKeyType="send"
              blurOnSubmit={false}
              onSubmitEditing={send}
            />
            <TouchableOpacity
              style={[
                styles.sendBtn,
                busy ? styles.sendBtnActive : sendDisabled ? styles.sendBtnDisabled : null,
              ]}
              onPress={
                busy
                  ? isLocalSelected || isGgufSelected
                    ? stopLocal
                    : stopCloud
                  : send
              }
              disabled={sendDisabled}>
              {busy ? (
                <Square size={14} color={c.accentText} />
              ) : (
                <ArrowUp size={18} color={canSend ? c.accentText : c.textSecondary} />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Model picker — bottom sheet with MOUD | BYOK sources */}
        <BottomSheetModal
          ref={sheetRef}
          snapPoints={['85%']}
          backdropComponent={renderBackdrop}
          backgroundStyle={styles.sheetBackground}
          handleIndicatorStyle={styles.sheetHandle}
          enableDynamicSizing={false}
          onChange={index => {
            if (index === -1) {
              setPickerOpen(false);
            }
          }}>
          <BottomSheetScrollView style={styles.sheetContent}>
            {activeByokConfig ? (
              <Text style={styles.tabHint} numberOfLines={1}>
                {hostOf(activeByokConfig.baseUrl)}
              </Text>
            ) : null}

            <BottomSheetTextInput
              style={styles.modelSearch}
              value={modelQuery}
              onChangeText={setModelQuery}
              placeholder="search models"
              placeholderTextColor={c.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {!activeByokConfig ? (
              modelsLoading ? (
                <View style={styles.modelState}>
                  <ActivityIndicator size="small" color={c.textTertiary} />
                  <Text style={styles.modelStateText}>loading models</Text>
                </View>
              ) : modelsError ? (
                <View style={styles.modelState}>
                  <Text style={styles.modelStateText} numberOfLines={2}>
                    {modelsError}
                  </Text>
                  <TouchableOpacity
                    style={styles.retryBtn}
                    onPress={() => loadGatewayModels(true)}>
                    <Text style={styles.retryBtnText}>retry</Text>
                  </TouchableOpacity>
                </View>
              ) : visibleGatewayModels.length === 0 ? (
                <View style={styles.modelState}>
                  <Text style={styles.modelStateText}>no matching models</Text>
                </View>
              ) : (
                <View>
                  {visibleGatewayModels.map(item => (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.modelOption, item.id === selectedModel && styles.modelOptionActive]}
                      onPress={() => commitSelection(item.id)}>
                      <Text
                        style={[styles.modelOptionId, item.id === selectedModel && styles.modelOptionIdActive]}
                        numberOfLines={1}>
                        {item.id}
                      </Text>
                      {item.category ? (
                        <View style={styles.modelCategoryChip}>
                          <Text style={styles.modelCategoryText}>{item.category}</Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </View>
              )
            ) : byokLoading ? (
              <View style={styles.modelState}>
                <ActivityIndicator size="small" color={c.textTertiary} />
                <Text style={styles.modelStateText}>loading models</Text>
              </View>
            ) : byokError ? (
              <View style={styles.modelState}>
                <Text style={styles.modelStateText} numberOfLines={2}>
                  {byokError}
                </Text>
                <TouchableOpacity
                  style={styles.retryBtn}
                  onPress={() => byokConfig && loadByokCatalog(byokConfig, true)}>
                  <Text style={styles.retryBtnText}>retry</Text>
                </TouchableOpacity>
              </View>
            ) : visibleByokModels.length === 0 ? (
              <View style={styles.modelState}>
                <Text style={styles.modelStateText}>no matching models</Text>
              </View>
            ) : (
              <View>
                {visibleByokModels.map(item => (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.modelOption, item.id === selectedModel && styles.modelOptionActive]}
                    onPress={() => commitSelection(item.id, 'byok')}>
                    <Text
                      style={[styles.modelOptionId, item.id === selectedModel && styles.modelOptionIdActive]}
                      numberOfLines={1}>
                      {item.id}
                    </Text>
                    <View style={styles.modelCategoryChip}>
                      <Text style={styles.modelCategoryText}>byok</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <Text style={styles.localSectionHeader}>on-device</Text>
            <View style={styles.engineToggle}>
              <TouchableOpacity
                style={[styles.engineBtn, localEngine === 'executorch' && styles.engineBtnActive]}
                onPress={() => switchLocalEngine('executorch')}>
                <Text
                  style={[styles.engineBtnText, localEngine === 'executorch' && styles.engineBtnTextActive]}
                  numberOfLines={1}>
                  ExecuTorch (.pte)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.engineBtn, localEngine === 'gguf' && styles.engineBtnActive]}
                onPress={() => switchLocalEngine('gguf')}>
                <Text
                  style={[styles.engineBtnText, localEngine === 'gguf' && styles.engineBtnTextActive]}
                  numberOfLines={1}>
                  llama.cpp (GGUF)
                </Text>
              </TouchableOpacity>
            </View>
            {localEngine === 'executorch'
              ? LOCAL_MODELS.map(entry => {
                  const isActive = entry.id === selectedModel;
                  const chip = isActive ? localChipLabel(local.status, local.downloadProgress) : 'idle';
                  return (
                    <TouchableOpacity
                      key={entry.id}
                      style={[styles.modelOption, isActive && styles.modelOptionActive]}
                      onPress={() => commitLocalSelection(entry.id)}>
                      <Text style={[styles.modelOptionId, isActive && styles.modelOptionIdActive]} numberOfLines={1}>
                        {entry.label}
                      </Text>
                      <View style={styles.modelCategoryChip}>
                        <Text style={styles.modelCategoryText}>{chip}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              : CURATED_GGUF_MODELS.map(entry => {
                  const pickerId = `gguf/${entry.id}`;
                  const isActive = pickerId === selectedModel;
                  const progress = ggufDownloads[entry.id];
                  const record = ggufRegistry[entry.id];
                  const downloading = progress !== undefined;
                  const chip = downloading
                    ? `${Math.round(progress * 100)}%`
                    : record ? 'ready' : `get · ${humanBytes(entry.bytes)}`;
                  return (
                    <TouchableOpacity
                      key={entry.id}
                      style={[styles.modelOption, isActive && styles.modelOptionActive]}
                      disabled={downloading}
                      onPress={() => {
                        if (record) {
                          commitLocalSelection(pickerId);
                        } else {
                          startGgufDownload(entry.id);
                        }
                      }}>
                      <Text style={[styles.modelOptionId, isActive && styles.modelOptionIdActive]} numberOfLines={1}>
                        {`${entry.label} · ${entry.quant}`}
                      </Text>
                      <View style={styles.modelCategoryChip}>
                        <Text style={styles.modelCategoryText}>{chip}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
          </BottomSheetScrollView>
        </BottomSheetModal>

        {/* Document picker — bottom sheet */}
        <BottomSheetModal
          ref={docPickerRef}
          snapPoints={['240']}
          backdropComponent={renderBackdrop}
          backgroundStyle={styles.sheetBackground}
          handleIndicatorStyle={styles.sheetHandle}
          enableDynamicSizing={false}>
          <BottomSheetScrollView style={styles.sheetContent}>
            <Text style={[styles.sheetTitle, {color: c.textPrimary}]}>Read document</Text>
            <Text style={[styles.sheetSub, {color: c.textSecondary}]}>
              Select a file from your device
            </Text>
            <TouchableOpacity
              style={[styles.sheetBtn, {backgroundColor: c.accent}]}
              onPress={pickDocument}>
              <Text style={[styles.sheetBtnText, {color: c.accentText}]}>Browse files</Text>
            </TouchableOpacity>
            <Text style={[styles.sheetHint, {color: c.textTertiary}]}>
              Supports: PDF, DOCX, XLSX, CSV, TXT, MD, JSON, HTML
            </Text>
          </BottomSheetScrollView>
        </BottomSheetModal>

      </KeyboardAvoidingView>
      <PermissionSheet
        ref={permSheetRef}
        kind={permSheet}
        onGrant={handlePermGrant}
        onDismiss={() => setPermSheet(null)}
      />
    </SafeAreaView>
  );
}


function makeStyles(c: ThemeColors) { return StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: c.bg,
  },
  root: {
    flex: 1,
    backgroundColor: c.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  menuBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIcon: {
    color: c.textSecondary,
    fontSize: typography.xl,
    fontFamily: typography.mono,
  },
  modelSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bgSurface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  modelName: {
    color: c.textPrimary,
    fontSize: typography.sm,
    fontFamily: typography.sans,
    fontWeight: '500',
  },
  modelArrow: {
    color: c.textTertiary,
    fontSize: typography.xs,
    fontFamily: typography.mono,
  },
  avatarBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: c.bgSurface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
  },
  avatarBtnText: {
    color: c.textPrimary,
    fontSize: typography.sm,
    fontFamily: typography.sans,
    fontWeight: '600',
  },
  sheetBackground: {
    backgroundColor: c.bgSurface,
  },
  sheetHandle: {
    backgroundColor: c.borderStrong,
  },
  sheetContent: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  sheetTitle: {
    fontSize: typography.lg,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  sheetSub: {
    fontSize: typography.sm,
    marginBottom: spacing.md,
  },
  sheetInput: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.sm,
    fontFamily: typography.mono,
    marginBottom: spacing.md,
  },
  sheetBtn: {
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sheetBtnText: {
    fontSize: typography.sm,
    fontWeight: '600',
  },
  sheetHint: {
    fontSize: typography.xs,
    textAlign: 'center',
  },
  tabHint: {
    color: c.textTertiary,
    fontSize: typography.xs,
    fontFamily: typography.mono,
    marginBottom: spacing.sm,
  },
  modelSearch: {
    color: c.textPrimary,
    fontSize: typography.sm,
    fontFamily: typography.sans,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  modelState: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  modelStateText: {
    color: c.textTertiary,
    fontSize: typography.sm,
    fontFamily: typography.sans,
    flex: 1,
  },
  retryBtn: {
    backgroundColor: c.accent,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  retryBtnText: {
    color: c.accentText,
    fontSize: typography.sm,
    fontFamily: typography.medium,
  },
  modelOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  modelOptionActive: {
    backgroundColor: c.accentMuted,
  },
  modelOptionId: {
    flex: 1,
    color: c.textSecondary,
    fontSize: typography.xs,
    fontFamily: typography.mono,
    marginRight: spacing.sm,
  },
  modelOptionIdActive: {
    color: c.textPrimary,
  },
  modelCategoryChip: {
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  modelCategoryText: {
    color: c.textTertiary,
    fontSize: typography.true,
    fontFamily: typography.medium,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  messageList: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 40,
  },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    backgroundColor: c.bgSurface,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  logoText: {
    color: c.textPrimary,
    fontSize: typography.xxl,
    fontFamily: typography.sans,
    fontWeight: '700',
  },
  emptyTitle: {
    color: c.textSecondary,
    fontSize: typography.lg,
    fontFamily: typography.sans,
  },
  bubbleRow: {
    flexDirection: 'row',
    marginBottom: spacing.lg,
    alignItems: 'flex-start',
  },
  bubbleRowUser: {
    flexDirection: 'row-reverse',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarUser: {
    backgroundColor: c.accent,
  },
  avatarAssistant: {
    backgroundColor: c.bgSurface,
  },
  avatarText: {
    color: c.textPrimary,
    fontSize: typography.sm,
    fontFamily: typography.sans,
    fontWeight: '600',
  },
  bubbleContent: {
    flex: 1,
    maxWidth: '80%',
  },
  bubbleText: {
    color: c.textPrimary,
    fontSize: typography.md,
    fontFamily: typography.sans,
    lineHeight: 24,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  copyText: {
    color: c.textTertiary,
    fontSize: typography.xs,
    fontFamily: typography.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  thinkingLabel: {
    color: c.textTertiary,
    fontSize: typography.xs,
    fontFamily: typography.sans,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  thinkingText: {
    color: c.textTertiary,
    fontSize: typography.sm,
    fontFamily: typography.sans,
    lineHeight: 20,
    marginBottom: spacing.sm,
    fontStyle: 'italic',
  },
  composer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: spacing.sm,
  },
  notice: {
    borderWidth: 1,
    borderColor: c.warning,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  noticeText: {
    color: c.warning,
    fontSize: typography.xs,
    fontFamily: typography.medium,
  },
  localBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  localBannerText: {
    flex: 1,
    color: c.textSecondary,
    fontSize: typography.xs,
    fontFamily: typography.mono,
  },
  localBannerError: {
    flex: 1,
    color: c.warning,
    fontSize: typography.xs,
    fontFamily: typography.medium,
  },
  localSectionHeader: {
    color: c.textTertiary,
    fontSize: typography.xs,
    fontFamily: typography.mono,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  engineToggle: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  engineBtn: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: radius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  engineBtnActive: {
    backgroundColor: c.accentMuted,
    borderColor: c.accent,
  },
  engineBtnText: {
    color: c.textTertiary,
    fontSize: typography.true,
    fontFamily: typography.medium,
  },
  engineBtnTextActive: {
    color: c.textPrimary,
  },
  previewStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  previewItem: {
    position: 'relative',
  },
  previewThumb: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  previewChip: {
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: c.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewChipText: {
    color: c.textSecondary,
    fontSize: typography.xs,
    fontFamily: typography.mono,
  },
  previewRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 16,
    height: 16,
    borderRadius: radius.full,
    backgroundColor: c.bgElevated,
    borderWidth: 1,
    borderColor: c.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewRemoveText: {
    color: c.textPrimary,
    fontSize: 10,
    fontFamily: typography.mono,
    lineHeight: 12,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: c.bgInput,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: c.border,
    paddingLeft: spacing.sm,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
  },
  attachBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },
  attachIcon: {
    color: c.textSecondary,
    fontSize: typography.xl,
    fontFamily: typography.mono,
    lineHeight: 24,
  },
  attachLabel: {
    color: c.textSecondary,
    fontSize: typography.true,
    fontFamily: typography.mono,
    letterSpacing: 0.5,
  },
  recDot: {
    width: 10,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: '#ffffff',
  },
  input: {
    flex: 1,
    color: c.textPrimary,
    fontSize: typography.md,
    fontFamily: typography.sans,
    maxHeight: 120,
    paddingTop: Platform.OS === 'ios' ? spacing.sm : 0,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: c.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  sendBtnDisabled: {
    backgroundColor: c.bgSurface,
  },
  sendBtnActive: {
    backgroundColor: c.accent,
  },
  sendIcon: {
    color: '#ffffff',
    fontSize: typography.md,
    fontFamily: typography.mono,
    fontWeight: '700',
  },
});
}
