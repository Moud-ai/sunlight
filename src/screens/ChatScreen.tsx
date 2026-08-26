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
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
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
  ArrowUp,
  Square,
  X,
} from 'lucide-react-native';
import Markdown from 'react-native-markdown-display';
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
import * as RNFS from '@dr.pogodin/react-native-fs';
import {streamChat, ChatErrorInfo, ChatMessage} from '../api/chat';
import {
  fetchGatewayModels,
  filterTextModels,
  searchModels,
  GatewayModel,
} from '../api/models';
import {searchByokModels, fetchByokModels, ByokModel} from '../lib/byokModels';
import {DEFAULT_MODEL} from '../config';
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
import {
  AudioAttachment,
  buildUserContent,
  ImageAttachment,
  inferImageMime,
  isOversizedImage,
  MAX_IMAGE_BYTES,
  supportsAudio,
  visionSupport,
} from '../lib/messageContent';
import {RootStackParamList} from '../../App';
import {colors as staticColors, typography, spacing, radius} from '../theme';
import {useThemeColors, type ThemeColors} from '../theme/ThemeProvider';
import {
  loadMessages,
  appendMessage,
} from '../lib/chatStorage';

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
  attachment: ImageAttachment | AudioAttachment;
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
  // Assistant messages may contain arbitrary links. Confirm before
  // opening and refuse non-https schemes (no javascript:/file:/etc).
  const handleLinkPress = useCallback((url: string): boolean => {
    if (!/^https:\/\//i.test(url)) {
      return true;
    }
    Alert.alert('Open link', url, [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Open', onPress: () => {
        Linking.openURL(url).catch(() => {});
      }},
    ]);
    return true;
  }, []);
  const markdownStyles = useMemo(
    () => ({
      body: {color: c.textPrimary, fontSize: typography.md, fontFamily: typography.sans, lineHeight: 24},
      paragraph: {color: c.textPrimary, fontSize: typography.md, lineHeight: 24, marginBottom: 4},
      heading1: {color: c.textPrimary, fontSize: typography.xl, fontWeight: '700', marginBottom: 8},
      heading2: {color: c.textPrimary, fontSize: typography.lg, fontWeight: '600', marginBottom: 6},
      heading3: {color: c.textPrimary, fontSize: typography.md, fontWeight: '600', marginBottom: 4},
      link: {color: c.accent, textDecorationLine: 'underline'},
      code: {color: c.accent, fontFamily: typography.mono, fontSize: typography.sm, backgroundColor: c.bgSurface, borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1},
      code_block: {color: c.textPrimary, fontFamily: typography.mono, fontSize: typography.sm, backgroundColor: c.bgSurface, borderRadius: radius.sm, padding: spacing.md, marginBottom: 8, overflow: 'scroll'},
      blockquote: {color: c.textSecondary, borderLeftColor: c.border, borderLeftWidth: 2, paddingLeft: spacing.md, marginBottom: 8},
      list: {color: c.textPrimary, marginBottom: 8},
      hr: {borderColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth, marginVertical: spacing.md},
      table: {borderColor: c.border, borderWidth: 1, borderRadius: radius.sm},
      th: {color: c.textPrimary, fontWeight: '600', borderColor: c.border, borderWidth: 1, padding: spacing.sm},
      td: {color: c.textPrimary, borderColor: c.border, borderWidth: 1, padding: spacing.sm},
    }),
    [c],
  );
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Active chat-routing mode ('personal' | 'community' | 'byok'). Drives the
  // picker layout: 'byok' shows the custom-endpoint catalog exclusively;
  // every other mode shows the MOUD gateway catalog exclusively.
  const [quotaMode, setQuotaModeState] = useState<QuotaMode>('community');

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
      searchModels(filterTextModels(gatewayModels ?? []), modelQuery).slice(
        0,
        MODEL_PICKER_LIMIT,
      ),
    [gatewayModels, modelQuery],
  );

  const visibleByokModels = useMemo(
    () => searchByokModels(byokModels ?? [], modelQuery).slice(0, MODEL_PICKER_LIMIT),
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
  const permActionRef = useRef<(() => void) | null>(null);
  const permSheetRef = useRef<any>(null);
  useEffect(() => {
    if (permSheet) {
      permSheetRef.current?.present();
    }
  }, [permSheet]);
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

      // History: prior turns plus the new user message. Local models are
      // text-only; ChatScreen blocks attachments on this path.
      const history = [...bubbles, userBubble]
        .slice(-30)
        .map(b => ({role: b.role, content: b.content}));

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

      sendFn(history)
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

    // Multimodal gating: refuse sends the target model cannot accept.
    // Images block ONLY when vision is KNOWN to be absent; unknown
    // capability (BYOK models) sends with an inline unverified hint.
    const hasImage = pending.some(a => a.attachment.kind === 'image');
    const hasAudio = pending.some(a => a.attachment.kind === 'audio');
    if (hasImage) {
      const vision = visionSupport(selectedModel, selectedCapability);
      if (!vision.supported) {
        showToast('selected model does not support images');
        return;
      }
      if (!vision.known) {
        showToast('vision capability unverified for this model');
      }
    }
    if (hasAudio && !supportsAudio(selectedModel)) {
      showToast('selected model does not support audio input');
      return;
    }

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
    }

    // Outgoing payload: plain strings for text-only turns, OpenAI-compatible
    // content parts when attachments ride along. streamChat JSON-stringifies
    // content verbatim, so only the TS surface needs widening here (the
    // transport module stays untouched).
    const outgoing: Array<{role: Bubble['role']; content: string | ReturnType<typeof buildUserContent>}> =
      [...bubbles, userBubble].slice(-30).map((b, i, all) => {
        if (i === all.length - 1 && b.role === 'user') {
          return {
            role: b.role,
            content: buildUserContent(
              text,
              pending.map(a => a.attachment),
              selectedModel,
            ),
          };
        }
        return {role: b.role, content: b.content};
      });

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
        streamChat(
          target.apiKey,
          target.model,
          outgoing as unknown as ChatMessage[],
          {
            onDelta: (token: string) => {
              setBubbles(prev => {
                const last = prev[prev.length - 1];
                if (last?.role !== 'assistant') return prev;
                // Accumulate raw content, then parse thinking tags
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
          target.baseUrl ? {baseUrl: target.baseUrl} : undefined,
        );
      } catch {
        // loadByokSettings never rejects by contract; defensive fallback
        // keeps the community route alive even if that invariant breaks.
        streamChat(session.apiKey, selectedModel, outgoing as unknown as ChatMessage[], {
          onError: (message: string, info?: ChatErrorInfo) => {
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
          onDone: () => setBusy(false),
        });
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

  const renderBubble = ({item}: {item: Bubble}) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser]}>
        <View style={[styles.avatar, isUser ? styles.avatarUser : styles.avatarAssistant]}>
          <Text style={styles.avatarText}>{isUser ? 'Y' : 'S'}</Text>
        </View>
        <View style={[styles.bubbleContent, isUser && styles.bubbleContentUser]}>
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
              <Text style={[styles.bubbleText, styles.bubbleTextUser]}>{item.content}</Text>
            ) : (
              <Markdown
                style={markdownStyles}
                onLinkPress={handleLinkPress}>
                {item.content}
              </Markdown>
            )
          ) : busy && !isUser ? (
            <ActivityIndicator size="small" color={c.textTertiary} />
          ) : null}
        </View>
      </View>
    );
  };

  const renderGatewayRow = useCallback(
    ({item}: {item: GatewayModel}) => {
      const active = item.id === selectedModel;
      return (
        <TouchableOpacity
          style={[styles.modelOption, active && styles.modelOptionActive]}
          onPress={() => commitSelection(item.id)}>
          <Text
            style={[styles.modelOptionId, active && styles.modelOptionIdActive]}
            numberOfLines={1}>
            {item.id}
          </Text>
          {item.category ? (
            <View style={styles.modelCategoryChip}>
              <Text style={styles.modelCategoryText}>{item.category}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      );
    },
    [selectedModel, commitSelection],
  );

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
                (!input.trim() && pending.length === 0) || busy
                  ? styles.sendBtnDisabled
                  : null,
              ]}
              onPress={
                busy && (isLocalSelected || isGgufSelected)
                  ? () => {
                      if (isGgufSelected) {
                        llama.interrupt();
                      } else {
                        local.interrupt();
                      }
                    }
                  : send
              }
              disabled={(!input.trim() && pending.length === 0) || busy}>
              {busy ? (
                busy && (isLocalSelected || isGgufSelected) ? (
                  <Square size={14} color={c.textPrimary} />
                ) : (
                  <ActivityIndicator size="small" color={c.textTertiary} />
                )
              ) : (
                <ArrowUp size={18} color="#fff" />
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
  bubbleContentUser: {
    backgroundColor: c.userBubble,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleTextUser: {
    color: c.accentText,
  },
  bubbleText: {
    color: c.textPrimary,
    fontSize: typography.md,
    fontFamily: typography.sans,
    lineHeight: 24,
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
  sendIcon: {
    color: '#ffffff',
    fontSize: typography.md,
    fontFamily: typography.mono,
    fontWeight: '700',
  },
});
}
