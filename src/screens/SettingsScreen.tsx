/**
 * SettingsScreen — account, quota routing, BYOK, devices.
 *
 * Swiss International Style rebuild: pure black canvas, sections separated by
 * whitespace and hairline borders (no cards), uppercase micro-labels with
 * letterspacing, inverted white primary actions, no gradients/shadows/emojis.
 *
 * Quota routing is an explicit two-row radio choice ('community pool' vs
 * 'personal (BYOK)'); personal selection requires a saved BYOK config. BYOK
 * credentials live in react-native-keychain via src/lib/byok.ts (AsyncStorage
 * fallback), never in this screen's own storage.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {typography, spacing, radius} from '../theme';
import {SunlightSession, getLockMode, setLockMode, setPin, saveSession, type LockMode} from '../auth/secure';
import {formatDeviceName} from '../lib/deviceName';
import {fetchProfileAvatar} from '../lib/profile';
import {fetchUserQuota, QuotaInfo} from '../lib/quota';
import {listDevices, deleteDevice, DeviceRow} from '../lib/devices';
import {
  ByokConfig,
  QuotaMode,
  loadByokSettings,
  saveByokConfig,
  clearByokConfig,
  setQuotaMode,
  byokStorageMode,
} from '../lib/byok';
import {fetchWithTimeout} from '../lib/fetchWithTimeout';
import {useTheme, useThemeColors} from '../theme/ThemeProvider';
import {THEME_NAMES, THEME_LABELS, THEME_SWATCHES, ThemeName, type Palette} from '../theme/themes';

interface Props {
  session: SunlightSession;
  onSignOut: () => void;
  onNavigate: (screen: string) => void;
}

type QuotaChoice = QuotaMode; // 'personal' | 'community' | 'byok'

/** Provider quick-picks: label + preset base URL (null = free-form custom). */
const PROVIDER_PRESETS: Array<{label: string; baseUrl: string | null}> = [
  {label: 'OpenAI', baseUrl: 'https://api.openai.com/v1'},
  {label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1'},
  {label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1'},
  {label: 'Custom', baseUrl: null},
];

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

// onNavigate is kept in Props for API compatibility; the back affordance it
// served was removed (native stack back gesture covers it).
export default function SettingsScreen({
  session,
  onSignOut,
  onNavigate: _onNavigate,
}: Props) {
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [quotaChoice, setQuotaChoice] = useState<QuotaChoice>('community');
  const [byokExists, setByokExists] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [byokApiKey, setByokApiKey] = useState('');
  const [modelId, setModelId] = useState('');
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ok: boolean; message: string} | null>(
    null,
  );
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    // Load persisted BYOK settings + routing flag.
    loadByokSettings()
      .then(settings => {
        const hasConfig = settings.byok !== null;
        setByokExists(hasConfig);
        if (settings.byok) {
          setEndpoint(settings.byok.baseUrl);
          setByokApiKey(settings.byok.apiKey);
          setModelId(settings.byok.modelId);
        }
        setQuotaChoice(settings.mode ?? 'community');
      })
      .catch(() => {});

    // Profile avatar for the account row (never breaks the render path).
    fetchProfileAvatar(session.subject, session.apiKey)
      .then(setAvatarUrl)
      .catch(() => {});

    // Load personal quota (real endpoint /user/quota; cached 60s to reduce
    // gateway calls). Gateway rejections surface as a visible warning instead
    // of a silent empty quota.
    fetchUserQuota(session.apiKey, {
      onError: (status, type) =>
        setQuotaError(`quota unavailable (${status} ${type})`),
    })
      .then(q => {
        if (q != null) {
          setQuotaError(null);
        }
        setQuota(q);
      })
      .catch(() => {});

    // Load devices (cached 30s in src/lib/devices.ts).
    listDevices(session.apiKey)
      .then(setDevices)
      .catch(() => {});
  }, [session]);

  const selectQuota = useCallback(
    async (choice: QuotaChoice) => {
      if (choice === 'byok' && !byokExists) {
        setMessage('configure BYOK first');
        return;
      }
      setQuotaChoice(choice);
      try {
        await setQuotaMode(choice);
        setMessage(
          choice === 'personal'
            ? 'using your moud key quota'
            : choice === 'byok'
              ? 'routing chats through your external endpoint'
              : 'using the community pool',
        );
      } catch {
        setMessage('failed to update routing');
      }
    },
    [byokExists],
  );

  const applyPreset = useCallback((label: string, baseUrl: string | null) => {
    setActivePreset(label);
    if (baseUrl) {
      setEndpoint(baseUrl);
    }
  }, []);

  const persistByok = useCallback(async () => {
    const cfg: ByokConfig = {
      baseUrl: normalizeBaseUrl(endpoint),
      apiKey: byokApiKey.trim(),
      modelId: modelId.trim(),
    };
    if (!cfg.baseUrl || !cfg.apiKey || !cfg.modelId) {
      setMessage('endpoint, api key and model id are required');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      await saveByokConfig(cfg);
      setByokExists(true);
      // If the user picked personal before a config existed, lock it in now.
      if (quotaChoice === 'byok') {
        await setQuotaMode('byok');
      }
      setMessage(
        byokStorageMode() === 'keychain'
          ? 'saved - stored in keychain'
          : 'saved - fallback storage',
      );
    } catch {
      setMessage('failed to save configuration');
    }
    setSaving(false);
  }, [endpoint, byokApiKey, modelId, quotaChoice]);

  const testConnection = useCallback(async () => {
    const base = normalizeBaseUrl(endpoint);
    if (!base || !byokApiKey.trim()) {
      setTestResult({ok: false, message: 'endpoint and api key are required'});
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetchWithTimeout(
        `${base}/models`,
        {headers: {Authorization: `Bearer ${byokApiKey.trim()}`}},
        10_000,
      );
      setTestResult(
        res.ok
          ? {ok: true, message: 'connection ok'}
          : {ok: false, message: `connection failed - HTTP ${res.status}`},
      );
    } catch {
      setTestResult({ok: false, message: 'connection failed'});
    }
    setTesting(false);
  }, [endpoint, byokApiKey]);

  const wipeByok = useCallback(async () => {
    try {
      await clearByokConfig();
      setEndpoint('');
      setByokApiKey('');
      setModelId('');
      setActivePreset(null);
      setByokExists(false);
      setTestResult(null);
      setQuotaChoice('community');
      setMessage('configuration removed - using community pool');
    } catch {
      setMessage('failed to remove configuration');
    }
  }, []);

  const unlinkDevice = useCallback(
    async (keyId: string) => {
      try {
        await deleteDevice(session.apiKey, keyId);
        setDevices(prev => prev.filter(d => d.key_id !== keyId));
        setMessage('device unlinked');
      } catch {
        setMessage('failed to unlink device');
      }
    },
    [session],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
        </View>

        {/* Appearance */}
        <AppearanceSection />

        {/* Security */}
        <SecuritySection session={session} />

        {/* Account */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>account</Text>
          <View style={styles.accountRow}>
            {avatarUrl ? (
              <Image source={{uri: avatarUrl}} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarLetter}>
                  {(session.subject || '?').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <Text style={styles.subjectValue} numberOfLines={1}>
              {session.subject || '-'}
            </Text>
          </View>
        </View>

        {/* Quota routing */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>quota</Text>
          <TouchableOpacity
            style={styles.radioRow}
            onPress={() => selectQuota('community')}
            disabled={false}>
            <View
              style={[
                styles.radioCircle,
                quotaChoice === 'community' && styles.radioCircleSelected,
              ]}>
              {quotaChoice === 'community' && <View style={styles.radioDot} />}
            </View>
            <View style={styles.radioCopy}>
              <Text style={styles.radioTitle}>community pool</Text>
              <Text style={styles.radioHint}>shared pool across all users</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
                style={styles.radioRow}
                onPress={() => selectQuota('personal')}>
                <View
                  style={[
                    styles.radioCircle,
                    quotaChoice === 'personal' && styles.radioCircleSelected,
                  ]}>
                  {quotaChoice === 'personal' && <View style={styles.radioDot} />}
                </View>
                <View style={styles.radioCopy}>
                  <Text style={styles.radioTitle}>personal (your moud key)</Text>
                  <Text style={styles.radioHint}>
                    your own moud allocation, shown below
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.radioRow}
                onPress={() => selectQuota('byok')}>
                <View
                  style={[
                    styles.radioCircle,
                    quotaChoice === 'byok' && styles.radioCircleSelected,
                  ]}>
                  {quotaChoice === 'byok' && <View style={styles.radioDot} />}
                </View>
                <View style={styles.radioCopy}>
                  <Text style={styles.radioTitle}>byok (external provider)</Text>
                  <Text style={styles.radioHint}>
                    route chats through your own endpoint
                  </Text>
                  {!byokExists && (
                    <Text style={styles.radioWarn}>configure BYOK first</Text>
                  )}
                </View>
              </TouchableOpacity>

          {quotaError ? (
            <Text style={styles.quotaErrorText}>{quotaError}</Text>
          ) : (
            quota && (
              <View style={styles.quotaBar}>
                <View style={styles.quotaTrack}>
                  <View
                    style={[
                      styles.quotaFill,
                      {width: `${Math.min(100, (quota.used / quota.limit) * 100)}%`},
                    ]}
                  />
                </View>
                <Text style={styles.quotaText}>
                  {quota.used.toLocaleString()} / {quota.limit.toLocaleString()} tokens
                </Text>
              </View>
            )
          )}
        </View>

        {/* BYOK */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>bring your own key</Text>

          {/* Provider quick-picks */}
          <View style={styles.chipRow}>
            {PROVIDER_PRESETS.map(preset => (
              <TouchableOpacity
                key={preset.label}
                style={[
                  styles.chip,
                  activePreset === preset.label && styles.chipActive,
                ]}
                onPress={() => applyPreset(preset.label, preset.baseUrl)}>
                <Text
                  style={[
                    styles.chipText,
                    activePreset === preset.label && styles.chipTextActive,
                  ]}>
                  {preset.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.input}
            value={endpoint}
            onChangeText={text => {
              setEndpoint(text);
              setActivePreset(null);
            }}
            placeholder="https://api.openai.com/v1"
            placeholderTextColor={c.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TextInput
            style={styles.input}
            value={byokApiKey}
            onChangeText={setByokApiKey}
            placeholder="sk-..."
            placeholderTextColor={c.textTertiary}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={styles.input}
            value={modelId}
            onChangeText={setModelId}
            placeholder="gpt-4o-mini"
            placeholderTextColor={c.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.primaryBtn, saving && styles.btnDisabled]}
              onPress={persistByok}
              disabled={saving}>
              <Text style={styles.primaryBtnText}>{saving ? '...' : 'save'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={testConnection}
              disabled={testing}>
              <Text style={styles.secondaryBtnText}>
                {testing ? 'testing...' : 'test connection'}
              </Text>
            </TouchableOpacity>
          </View>

          {testResult && (
            <Text
              style={[
                styles.testResult,
                testResult.ok ? styles.testOk : styles.testFail,
              ]}>
              {testResult.message}
            </Text>
          )}

          <View style={styles.byokMetaRow}>
            <Text style={styles.storageHint}>
              {byokStorageMode() === 'keychain'
                ? 'stored in keychain'
                : 'fallback storage'}
            </Text>
            {byokExists && (
              <TouchableOpacity onPress={wipeByok}>
                <Text style={styles.clearLink}>remove</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Devices */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>devices ({devices.length})</Text>
          {devices.length === 0 ? (
            <Text style={styles.emptyHint}>no linked devices</Text>
          ) : (
            devices.map(device => (
              <View key={device.key_id} style={styles.deviceRow}>
                <View style={styles.deviceInfo}>
                  <Text style={styles.deviceName}>
                    {formatDeviceName(device.name)}
                  </Text>
                  <Text style={styles.deviceDate}>
                    {new Date(device.created_at).toLocaleDateString()}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.unlinkBtn}
                  onPress={() => unlinkDevice(device.key_id)}>
                  <Text style={styles.unlinkText}>unlink</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        {message !== '' && <Text style={styles.message}>{message}</Text>}

        {/* Sign out */}
        <TouchableOpacity style={styles.signOutBtn} onPress={onSignOut}>
          <Text style={styles.signOutText}>sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}


/** Theme switcher — MD3-role palettes rendered as swatch rows. */
function SecuritySection({session}: {session: SunlightSession}): React.JSX.Element {
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [mode, setMode] = useState<LockMode>('none');
  const [pinA, setPinA] = useState('');
  const [pinB, setPinB] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    getLockMode().then(setMode).catch(() => {});
  }, []);

  const applyMode = useCallback(
    async (next: LockMode) => {
      setMsg('');
      if (next === 'pin') {
        if (!/^\d{4}$/.test(pinA) || pinA !== pinB) {
          setMsg('enter the same 4-digit code twice');
          return;
        }
        await setPin(pinA);
      }
      try {
        await saveSession(session, next);
        await setLockMode(next);
        setMode(next);
        setMsg(`lock: ${next}`);
      } catch {
        setMsg('could not change lock');
      }
    },
    [session, pinA, pinB],
  );

  const modes: Array<{value: LockMode; label: string}> = [
    {value: 'none', label: 'no lock'},
    {value: 'pin', label: '4-digit code'},
    {value: 'biometric', label: 'fingerprint / face'},
  ];

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>security</Text>
      {modes.map(m => (
        <TouchableOpacity
          key={m.value}
          style={styles.radioRow}
          onPress={() => {
            applyMode(m.value);
          }}>
          <View style={styles.radioCircle}>
            {mode === m.value ? <View style={styles.radioDot} /> : null}
          </View>
          <Text style={styles.radioTitle}>{m.label}</Text>
        </TouchableOpacity>
      ))}
      {mode === 'pin' ? (
        <View>
          <TextInput
            style={styles.input}
            value={pinA}
            onChangeText={t => setPinA(t.replace(/[^0-9]/g, '').slice(0, 4))}
            placeholder="new code"
            placeholderTextColor={c.textTertiary}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={4}
          />
          <TextInput
            style={styles.input}
            value={pinB}
            onChangeText={t => setPinB(t.replace(/[^0-9]/g, '').slice(0, 4))}
            placeholder="repeat code"
            placeholderTextColor={c.textTertiary}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={4}
          />
          <TouchableOpacity
            style={styles.themeRow}
            onPress={() => {
              applyMode('pin');
            }}>
            <Text style={styles.themeLabel}>save code</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {msg ? <Text style={styles.quotaErrorText}>{msg}</Text> : null}
    </View>
  );
}

function AppearanceSection(): React.JSX.Element {
  const {theme, setTheme} = useTheme();
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>appearance</Text>
      <View style={styles.card}>
        {THEME_NAMES.map(name => {
          const [a, b, d] = THEME_SWATCHES[name];
          return (
            <TouchableOpacity
              key={name}
              style={styles.themeRow}
              onPress={() => setTheme(name as ThemeName)}
              activeOpacity={0.7}>
              <View style={styles.swatchRowWrap}>
                <View style={[styles.swatch, {backgroundColor: a}]} />
                <View style={[styles.swatch, {backgroundColor: b}]} />
                <View style={[styles.swatch, {backgroundColor: d}, styles.swatchLast]} />
                <Text
                  style={[
                    styles.themeLabel,
                    theme === name && styles.themeLabelActive,
                  ]}>
                  {THEME_LABELS[name]}
                </Text>
              </View>
              <View
                style={[
                  styles.radioCircle,
                  theme === name && styles.radioCircleSelected,
                ]}>
                {theme === name && <View style={styles.radioDot} />}
              </View>
            </TouchableOpacity>
          );
        })}
        <Text style={styles.hint}>color roles follow Material Design 3 tonal mapping</Text>
      </View>
      {theme === 'custom' ? (
        <CustomThemeEditor />
      ) : null}
    </View>
  );
}

const CUSTOM_FIELDS: Array<[keyof Palette, string]> = [
  ['bg', 'background'],
  ['surface', 'surface'],
  ['elevated', 'elevated'],
  ['border', 'border'],
  ['borderStrong', 'border strong'],
  ['textPrimary', 'text primary'],
  ['textSecondary', 'text secondary'],
  ['textTertiary', 'text tertiary'],
  ['accent', 'accent'],
  ['accentText', 'accent text'],
  ['danger', 'danger'],
];

function CustomThemeEditor(): React.JSX.Element {
  const {setTheme, setCustomPalette} = useTheme();
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [fields, setFields] = useState<Palette>(() => ({
    bg: c.bg,
    surface: c.surface,
    elevated: c.bgElevated,
    border: c.border,
    borderStrong: c.borderStrong,
    textPrimary: c.textPrimary,
    textSecondary: c.textSecondary,
    textTertiary: c.textTertiary,
    accent: c.accent,
    accentText: c.accentText,
    danger: c.danger,
  }));

  const setField = useCallback((key: keyof Palette, value: string) => {
    setFields(prev => ({...prev, [key]: value}));
  }, []);

  const apply = useCallback(() => {
    const next: Palette = {...fields};
    setCustomPalette(next);
    setTheme('custom');
  }, [fields, setCustomPalette, setTheme]);

  return (
    <View style={styles.card}>
      <Text style={styles.sectionLabel}>custom hex values</Text>
      {CUSTOM_FIELDS.map(([key, label]) => (
        <View key={key} style={styles.customRow}>
          <Text style={styles.themeLabel}>{label}</Text>
          <TextInput
            style={styles.customInput}
            value={fields[key]}
            onChangeText={t => setField(key, t)}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={7}
          />
        </View>
      ))}
      <TouchableOpacity style={styles.themeRow} onPress={apply}>
        <Text style={styles.themeLabelActive}>apply custom colors</Text>
      </TouchableOpacity>
    </View>
  );
}


/** Live-palette styles for AppearanceSection (theme-reactive). */
function makeStyles(c: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    card: {
      backgroundColor: c.bgSurface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      padding: 16,
    },
    themeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
    },
    customRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 4,
    },
    customInput: {
      color: c.textPrimary,
      backgroundColor: c.bgElevated,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      fontSize: 12,
      minWidth: 90,
      textAlign: 'center',
      fontFamily: typography.mono,
    },
    swatchRowWrap: {flexDirection: 'row', alignItems: 'center', flex: 1},
    swatch: {
      width: 22,
      height: 22,
      borderRadius: 4,
      marginRight: -6,
      borderWidth: 1,
      borderColor: c.borderStrong,
    },
    swatchLast: {marginRight: 12},
    themeLabel: {color: c.textSecondary, fontSize: 14},
    themeLabelActive: {color: c.textPrimary, fontWeight: '600'},
    hint: {color: c.textTertiary, fontSize: 11, marginTop: 8},
  safe: {
    flex: 1,
    backgroundColor: c.bg,
  },
  root: {
    flex: 1,
    backgroundColor: c.bg,
  },
  content: {
    padding: spacing.xl,
    paddingBottom: 100,
  },
  header: {
    marginBottom: spacing.xxl,
  },
  title: {
    color: c.textPrimary,
    fontSize: typography.xxl,
    fontFamily: typography.medium,
    letterSpacing: -0.5,
  },
  section: {
    marginBottom: spacing.xxl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
    paddingTop: spacing.lg,
  },
  sectionLabel: {
    color: c.textTertiary,
    fontSize: typography.true,
    fontFamily: typography.medium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: spacing.md,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: c.bgElevated,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  avatarLetter: {
    color: c.textSecondary,
    fontSize: typography.sm,
    fontFamily: typography.medium,
  },
  subjectValue: {
    flex: 1,
    color: c.textPrimary,
    fontSize: typography.sm,
    fontFamily: typography.mono,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: c.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  radioCircleSelected: {
    borderColor: c.accent,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: c.accent,
  },
  radioCopy: {
    flex: 1,
  },
  radioTitle: {
    color: c.textPrimary,
    fontSize: typography.md,
    fontFamily: typography.medium,
  },
  radioHint: {
    color: c.textTertiary,
    fontSize: typography.xs,
    fontFamily: typography.sans,
    marginTop: 2,
  },
  radioWarn: {
    color: c.warning,
    fontSize: typography.xs,
    fontFamily: typography.medium,
    marginTop: spacing.xs,
  },
  quotaBar: {
    marginTop: spacing.lg,
  },
  quotaTrack: {
    height: 2,
    backgroundColor: c.bgElevated,
    overflow: 'hidden',
  },
  quotaFill: {
    height: '100%',
    backgroundColor: c.accent,
  },
  quotaText: {
    color: c.textTertiary,
    fontSize: typography.xs,
    fontFamily: typography.mono,
    marginTop: spacing.sm,
  },
  quotaErrorText: {
    color: c.warning,
    fontSize: typography.xs,
    fontFamily: typography.mono,
    marginTop: spacing.lg,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  chip: {
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipActive: {
    backgroundColor: c.accent,
    borderColor: c.accent,
  },
  chipText: {
    color: c.textSecondary,
    fontSize: typography.true,
    fontFamily: typography.medium,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  chipTextActive: {
    color: c.accentText,
  },
  input: {
    backgroundColor: c.bgElevated,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    color: c.textPrimary,
    fontSize: typography.sm,
    fontFamily: typography.mono,
    marginBottom: spacing.sm,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: c.accent,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  btnDisabled: {
    opacity: 0.4,
  },
  primaryBtnText: {
    color: c.accentText,
    fontSize: typography.sm,
    fontFamily: typography.medium,
  },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: c.textPrimary,
    fontSize: typography.sm,
    fontFamily: typography.sans,
  },
  testResult: {
    fontSize: typography.xs,
    fontFamily: typography.mono,
    marginTop: spacing.sm,
  },
  testOk: {
    color: c.success,
  },
  testFail: {
    color: c.danger,
  },
  byokMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  storageHint: {
    color: c.textTertiary,
    fontSize: typography.xs,
    fontFamily: typography.sans,
  },
  clearLink: {
    color: c.danger,
    fontSize: typography.xs,
    fontFamily: typography.medium,
  },
  emptyHint: {
    color: c.textTertiary,
    fontSize: typography.sm,
    fontFamily: typography.sans,
  },
  deviceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    color: c.textPrimary,
    fontSize: typography.sm,
    fontFamily: typography.sans,
  },
  deviceDate: {
    color: c.textTertiary,
    fontSize: typography.xs,
    fontFamily: typography.mono,
    marginTop: spacing.xs,
  },
  unlinkBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: radius.sm,
  },
  unlinkText: {
    color: c.danger,
    fontSize: typography.xs,
    fontFamily: typography.sans,
  },
  message: {
    color: c.textTertiary,
    fontSize: typography.sm,
    fontFamily: typography.sans,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  signOutBtn: {
    marginTop: spacing.xxxl,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: radius.sm,
  },
  signOutText: {
    color: c.danger,
    fontSize: typography.sm,
    fontFamily: typography.medium,
  },
});

}
