/**
 * Harnesses — manage coding agents running inside Termux.
 *
 * Swiss/Vercel layout: hairline-separated harness sections, no heavy cards.
 * Each section shows a status chip, INSTALL/REMOVE, LAUNCH, and a CONFIG
 * disclosure with user-editable command/args/workdir (persisted via
 * src/lib/harness.ts). A prerequisites banner appears when Termux itself is
 * not usable yet. No API keys are managed here by design.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Linking,
  NativeModules,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

// lucide-react-native removed: SVG icon dependency causes crash on some devices.
// Using simple inline status indicators instead.
import type {RootStackParamList} from '../../App';
import {colors as staticColors, typography, spacing} from '../theme';
import {useThemeColors, type ThemeColors} from '../theme/ThemeProvider';
import {
  ALLOW_EXTERNAL_APPS_CMD,
  F_DROID_TERMUX_URL,
  HARNESS_IDS,
  HarnessError,
  HarnessId,
  ResolvedHarness,
  runCommand,
  checkInstalled,
  clearHarnessOverride,
  ensureTermuxReady,
  installHarness,
  launchHarness,
  loadEffectiveHarness,
  mergeHarnessDefaults,
  saveHarnessOverride,
} from '../lib/harness';

type AppSettingsModule = {openAppSettings(): void};

const SunlightHarness =
  NativeModules.SunlightHarness as AppSettingsModule | undefined;

type Status =
  | {kind: 'checking'}
  | {kind: 'not_installed'}
  | {kind: 'installed'; version?: string}
  | {kind: 'termux_missing'};

interface Props {
  /** Unused today; kept so the route signature matches sibling screens. */
  session?: unknown;
}

export default function HarnessesScreen(_props: Props): React.JSX.Element {
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [termuxMissing, setTermuxMissing] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(true);
  const [status, setStatus] = useState<Record<HarnessId, Status>>({
    hermes: {kind: 'checking'},
    pi: {kind: 'checking'},
  });
  const [busy, setBusy] = useState<Partial<Record<HarnessId, string>>>({});
  const [removeConfirm, setRemoveConfirm] = useState<Partial<
    Record<HarnessId, boolean>
  > >({});
  const [configOpen, setConfigOpen] = useState<Partial<Record<HarnessId, boolean>>>(
    {},
  );
  const [configs, setConfigs] = useState<Record<HarnessId, ResolvedHarness>>(() => {
    // Seed with real defaults from mergeHarnessDefaults so draftFrom() never
    // receives an empty object. The old `{} as ResolvedHarness` caused a crash
    // because cfg.args was undefined → .join(', ') threw on first render.
    const init: Record<string, ResolvedHarness> = {};
    for (const id of HARNESS_IDS) {
      init[id] = mergeHarnessDefaults(id, null);
    }
    return init as Record<HarnessId, ResolvedHarness>;
  });

  const refreshPrereqs = useCallback(() => {
    ensureTermuxReady().then(({installed, permissionGranted: granted}) => {
      setTermuxMissing(!installed);
      setPermissionGranted(granted);
      if (!installed) {
        setStatus({
          hermes: {kind: 'termux_missing'},
          pi: {kind: 'termux_missing'},
        });
      }
    });
  }, []);

  // Re-check on every focus: the user may have just fixed permissions or
  // allow-external-apps in another app and come straight back.
  useFocusEffect(
    useCallback(() => {
      refreshPrereqs();
      HARNESS_IDS.forEach(id => {
        loadEffectiveHarness(id).then(cfg =>
          setConfigs(prev => ({...prev, [id]: cfg})),
        );
        setStatus(prev => ({...prev, [id]: {kind: 'checking'}}));
        checkInstalled(id)
          .then(result =>
            setStatus(prev => ({
              ...prev,
              [id]: result.installed
                ? {kind: 'installed', version: result.version}
                : {kind: 'not_installed'},
            })),
          )
          .catch(() =>
            setStatus(prev => ({...prev, [id]: {kind: 'not_installed'}})),
          );
      });
    }, [refreshPrereqs]),
  );

  useEffect(() => {
    return () => setBusy({});
  }, []);

  const runOp = useCallback(
    async (id: HarnessId, label: string, op: () => Promise<void>) => {
      setBusy(prev => ({...prev, [id]: label}));
      try {
        await op();
      } catch (e) {
        if (e instanceof HarnessError && e.code === 'termux_missing') {
          setTermuxMissing(true);
        }
        // Errors surface through status re-check; keep the screen usable.
      } finally {
        setBusy(prev => {
          const next = {...prev};
          delete next[id];
          return next;
        });
      }
    },
  [],
  );

  const handleInstall = useCallback(
    (id: HarnessId) => {
      runOp(id, 'installing…', async () => {
        await installHarness(id);
        const result = await checkInstalled(id);
        setStatus(prev => ({
          ...prev,
          [id]: result.installed
            ? {kind: 'installed', version: result.version}
            : {kind: 'not_installed'},
        }));
      });
    },
    [runOp],
  );

  // REMOVE semantics: clears Sunlight's per-harness config and stops tracking
  // the installation. It does NOT uninstall anything inside Termux — that
  // stays under the user's explicit control.
  const handleRemove = useCallback((id: HarnessId) => {
    clearHarnessOverride(id)
      .then(() => loadEffectiveHarness(id))
      .then(cfg => {
        setConfigs(prev => ({...prev, [id]: cfg}));
        setStatus(prev => ({...prev, [id]: {kind: 'not_installed'}}));
        setRemoveConfirm(prev => ({...prev, [id]: false}));
      })
      .catch(() => {});
  }, []);

  const handleLaunch = useCallback(
    (id: HarnessId) => {
      runOp(id, 'launching…', () => launchHarness(id));
    },
    [runOp],
  );

  const saveConfig = useCallback(
    (id: HarnessId, draft: ConfigDraft) => {
      saveHarnessOverride(id, {
        command: draft.command,
        args: parseArgsText(draft.argsText),
        workdir: draft.workdir,
        installCmd: draft.installCmd,
      })
        .then(() => loadEffectiveHarness(id))
        .then(fresh => setConfigs(prev => ({...prev, [id]: fresh})))
        .catch(() => {});
    },
    [],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backHit}
          onPress={() => navigation.goBack()}>
          <Text style={styles.back}>{'‹ back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerLabel}>harnesses</Text>
        <View style={styles.headerSpacer} />
      </View>

          <HarnessDiagnostic />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}>
        {termuxMissing || !permissionGranted ? (
          <PrerequisitesBanner
            termuxMissing={termuxMissing}
            permissionGranted={permissionGranted}
          />
        ) : null}

        {HARNESS_IDS.map((id, index) => (
          <View key={id}>
            {index > 0 ? <View style={styles.divider} /> : null}
            <HarnessSection
              id={id}
              cfg={configs[id]}
              status={status[id]}
              busyLabel={busy[id]}
              removeConfirmed={removeConfirm[id] === true}
              configOpen={configOpen[id] === true}
              onToggleRemoveConfirm={() =>
                setRemoveConfirm(prev => ({...prev, [id]: true}))
              }
              onCancelRemove={() =>
                setRemoveConfirm(prev => ({...prev, [id]: false}))
              }
              onInstall={() => handleInstall(id)}
              onRemove={() => handleRemove(id)}
              onLaunch={() => handleLaunch(id)}
              onToggleConfig={() =>
                setConfigOpen(prev => ({...prev, [id]: !(configOpen[id] === true)}))
              }
              onSaveConfig={draft => saveConfig(id, draft)}
              onOpenTerminal={() => navigation.navigate('Terminal')}
            />
          </View>
        ))}

        <View style={styles.divider} />
        <TouchableOpacity
          style={styles.rawRow}
          onPress={() => navigation.navigate('Terminal')}>
          <Text style={styles.rawRowLabel}>OPEN RAW TERMINAL</Text>
          <Text style={styles.rawChevron}>{'>'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.rawRow}
          onPress={() => navigation.navigate('Vm')}>
          <Text style={styles.rawRowLabel}>VIRTUAL MACHINE (QEMU)</Text>
          <Text style={styles.rawChevron}>{'>'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}


function PrerequisitesBanner({
  termuxMissing,
  permissionGranted,
}: {
  termuxMissing: boolean;
  permissionGranted: boolean;
}): React.JSX.Element {
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerTitle}>TERMUX REQUIRED</Text>
      <View style={styles.stepRow}>
        <Text style={styles.stepNum}>1</Text>
        <View style={styles.stepBody}>
          <Text style={styles.stepText}>
            Install Termux from F-Droid (the Play Store build is outdated).
          </Text>
          <TouchableOpacity onPress={() => Linking.openURL(F_DROID_TERMUX_URL)}>
            <Text style={styles.stepLink}>f-droid.org/packages/com.termux</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={[styles.stepRow, !permissionGranted && styles.stepPending]}>
        <Text style={styles.stepNum}>2</Text>
        <View style={styles.stepBody}>
          <Text style={styles.stepText}>
            Grant Sunlight the RUN_COMMAND permission.
          </Text>
          {!permissionGranted ? (
            <TouchableOpacity
              onPress={() => {
                try {
                  SunlightHarness?.openAppSettings();
                } catch {}
              }}>
              <Text style={styles.stepLink}>open app settings</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
      {termuxMissing ? (
        <View style={styles.stepRow}>
          <Text style={styles.stepNum}>3</Text>
          <View style={styles.stepBody}>
            <Text style={styles.stepText}>
              Inside Termux, enable external apps:
            </Text>
            <Text selectable style={styles.stepCmd}>
              {ALLOW_EXTERNAL_APPS_CMD}
            </Text>
            <TouchableOpacity
              onPress={() => {
                Share.share({message: ALLOW_EXTERNAL_APPS_CMD}).catch(() => {});
              }}>
              <Text style={styles.stepLink}>share command</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}


interface ConfigDraft {
  command: string;
  argsText: string;
  workdir: string;
  installCmd: string;
}

function draftFrom(cfg: ResolvedHarness): ConfigDraft {
  // Defensive: cfg may arrive from a partially-initialized state or a future
  // code path that forgets to seed defaults. Coerce missing fields to safe
  // fallbacks instead of crashing on `.join()`.
  const args = Array.isArray(cfg?.args) ? cfg.args : [];
  return {
    command: cfg?.command ?? '',
    argsText: args.join(', '),
    workdir: cfg?.workdir ?? '',
    installCmd: cfg?.installCmd ?? '',
  };
}

function parseArgsText(text: string): string[] {
  return text
    .split(',')
    .map(part => part.trim())
    .filter(part => part.length > 0);
}

function HarnessSection(props: {
  id: HarnessId;
  cfg: ResolvedHarness;
  status: Status;
  busyLabel?: string;
  removeConfirmed: boolean;
  configOpen: boolean;
  onToggleRemoveConfirm: () => void;
  onCancelRemove: () => void;
  onInstall: () => void;
  onRemove: () => void;
  onLaunch: () => void;
  onToggleConfig: () => void;
  onSaveConfig: (draft: ConfigDraft) => void;
  onOpenTerminal: () => void;
}): React.JSX.Element {
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const {
    id,
    cfg,
    status,
    busyLabel,
    removeConfirmed,
    configOpen,
    onToggleRemoveConfirm,
    onCancelRemove,
    onInstall,
    onRemove,
    onLaunch,
    onToggleConfig,
    onSaveConfig,
    onOpenTerminal,
  } = props;

  const [draft, setDraft] = useState<ConfigDraft>(() => draftFrom(cfg));
  useEffect(() => {
    setDraft(draftFrom(cfg));
  }, [cfg]);

  const installed = status.kind === 'installed';
  const busyNow = busyLabel !== undefined;

  let chipText = 'CHECKING…';
  let chipStyle: object = styles.chipChecking;
  let chipDimmed = true;
  if (status.kind === 'termux_missing') {
    chipText = 'TERMUX MISSING';
    chipStyle = styles.chipWarn;
    chipDimmed = false;
  } else if (status.kind === 'not_installed') {
    chipText = 'NOT INSTALLED';
    chipStyle = styles.chipOff;
    chipDimmed = false;
  } else if (status.kind === 'installed') {
    chipText = status.version ? `V${status.version.toUpperCase()}` : 'INSTALLED';
    chipStyle = styles.chipOk;
    chipDimmed = false;
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.harnessLabel}>{cfg.label || id}</Text>
        <View style={[styles.chip, chipStyle, chipDimmed && styles.dimmed]}>
          <Text style={styles.chipText}>{chipText}</Text>
        </View>
      </View>

      {busyNow ? <Text style={styles.busyText}>{busyLabel}</Text> : null}

      <View style={styles.btnRow}>
        {installed ? (
          removeConfirmed ? (
            <>
              <TouchableOpacity style={styles.btnDanger} onPress={onRemove}>
                <Text style={styles.btnDangerText}>CONFIRM REMOVE</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnGhost} onPress={onCancelRemove}>
                <Text style={styles.btnGhostText}>CANCEL</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={styles.btnGhost}
                disabled={busyNow}
                onPress={onToggleRemoveConfirm}>
                <Text style={styles.btnGhostText}>REMOVE</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnPrimary, busyNow && styles.disabled]}
                disabled={busyNow}
                onPress={onLaunch}>
                <Text style={styles.btnPrimaryText}>LAUNCH</Text>
              </TouchableOpacity>
            </>
          )
        ) : (
          <TouchableOpacity
            style={[styles.btnPrimary, busyNow && styles.disabled]}
            disabled={busyNow || status.kind === 'termux_missing'}
            onPress={onInstall}>
            <Text style={styles.btnPrimaryText}>INSTALL</Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity style={styles.configToggle} onPress={onToggleConfig}>
        <Text style={styles.configToggleText}>
          {configOpen ? '– CONFIG' : '+ CONFIG'}
        </Text>
      </TouchableOpacity>

      {configOpen ? (
        <View style={styles.configBody}>
          <ConfigField
            label="COMMAND"
            value={draft.command}
            onChangeText={text => setDraft({...draft, command: text})}
            placeholder="/data/data/com.termux/files/usr/bin/bash"
            multiline={false}
          />
          <ConfigField
            label="ARGUMENTS (COMMA-SEPARATED)"
            value={draft.argsText}
            onChangeText={text => setDraft({...draft, argsText: text})}
            placeholder="-l, --noprofile"
          />
          <ConfigField
            label="WORKING DIRECTORY"
            value={draft.workdir}
            onChangeText={text => setDraft({...draft, workdir: text})}
            placeholder="~/"
          />
          <ConfigField
            label="INSTALL COMMAND"
            value={draft.installCmd}
            onChangeText={text => setDraft({...draft, installCmd: text})}
            multiline
          />
          <View style={styles.configActions}>
            <TouchableOpacity
              style={styles.btnSave}
              onPress={() => onSaveConfig(draft)}>
              <Text style={styles.btnSaveText}>SAVE</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.terminalLink}
              onPress={onOpenTerminal}>
              <Text style={styles.terminalLinkText}>open raw terminal ›</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ConfigField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
}): React.JSX.Element {
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        multiline={multiline}
      />
    </View>
  );
}


/** Staged bridge diagnostic: pinpoints exactly where Termux integration fails. */
type StageState = 'pending' | 'running' | 'pass' | 'fail';
interface DiagStage {
  label: string;
  state: StageState;
  detail?: string;
}

function HarnessDiagnostic(): React.JSX.Element {
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [stages, setStages] = useState<DiagStage[] | null>(null);
  const [running, setRunning] = useState(false);

  const setStage = (idx: number, patch: Partial<DiagStage>) =>
    setStages(prev =>
      prev
        ? prev.map((st, i) => (i === idx ? {...st, ...patch} : st))
        : prev,
    );

  const run = useCallback(async () => {
    setRunning(true);
    const initial: DiagStage[] = [
      {label: 'Termux installed', state: 'pending'},
      {label: 'RUN_COMMAND permission granted', state: 'pending'},
      {label: 'echo test through Termux bridge', state: 'pending'},
      {label: 'harness binary reachable', state: 'pending'},
    ];
    setStages(initial);

    // [1] + [2]
    let prereqs = {installed: false, permissionGranted: false};
    try {
      prereqs = await ensureTermuxReady();
    } catch {}
    setStage(0, prereqs.installed
      ? {state: 'pass'}
      : {state: 'fail', detail: 'install Termux from F-Droid (not Play Store)'});
    setStage(1, prereqs.permissionGranted
      ? {state: 'pass'}
      : {state: 'fail', detail: 'App info > Permissions > Additional permissions'});

    if (!prereqs.installed || !prereqs.permissionGranted) {
      setStage(2, {state: 'fail', detail: 'skipped: prerequisites missing'});
      setStage(3, {state: 'fail', detail: 'skipped'});
      setRunning(false);
      return;
    }

    // [3] echo test — proves allow-external-apps + bridge end-to-end.
    setStage(2, {state: 'running'});
    try {
      const resolved = await loadEffectiveHarness('pi');
      await runCommand(
        'echo sunlight_ok',
        resolved,
        {timeoutMs: 8000},
      );
      setStage(2, {state: 'pass'});
    } catch {
      setStage(2, {
        state: 'fail',
        detail:
          'no response - run inside Termux: printf "allow-external-apps=true\\n" >> ~/.termux/termux.properties && termux-reload-settings',
      });
      setStage(3, {state: 'fail', detail: 'skipped'});
      setRunning(false);
      return;
    }

    // [4]
    setStage(3, {state: 'running'});
    try {
      const res = await checkInstalled('pi');
      setStage(3, res.installed
        ? {state: 'pass', detail: res.version ? `pi ${res.version}` : undefined}
        : {state: 'fail', detail: 'bridge OK - pi not installed yet (use INSTALL)'});
    } catch {
      setStage(3, {state: 'fail', detail: 'version check failed'});
    }
    setRunning(false);
  }, []);

  return (
    <View style={styles.diagCard}>
      <TouchableOpacity style={styles.diagBtn} onPress={run} disabled={running}>
        <Text style={styles.diagBtnText}>
          {running ? 'running…' : 'run diagnostic'}
        </Text>
      </TouchableOpacity>
      {stages?.map((st, i) => (
        <View key={i} style={styles.diagRow}>
          {st.state === 'pass' ? (
            <Text style={{color: '#34C759', fontSize: 15, width: 15, textAlign: 'center'}}>{'\u2713'}</Text>
          ) : st.state === 'fail' ? (
            <Text style={{color: '#FF453A', fontSize: 15, width: 15, textAlign: 'center'}}>{'\u2717'}</Text>
          ) : st.state === 'running' ? (
            <Text style={{color: '#888', fontSize: 15, width: 15, textAlign: 'center'}}>{'\u21BB'}</Text>
          ) : (
            <View style={styles.diagPendingDot} />
          )}
          <View style={{flex: 1}}>
            <Text style={styles.diagLabel}>{st.label}</Text>
            {st.detail ? <Text style={styles.diagDetail}>{st.detail}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

function makeStyles(c: ThemeColors) { return StyleSheet.create({
    diagCard: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      padding: spacing.md,
      marginBottom: spacing.xl,
    },
    diagBtn: {
      backgroundColor: c.accent,
      borderRadius: 6,
      alignItems: 'center',
      paddingVertical: 10,
      marginBottom: spacing.md,
    },
    diagBtnText: {color: '#000', fontWeight: '600', fontSize: 13},
    diagRow: {flexDirection: 'row', gap: 8, paddingVertical: 5, alignItems: 'flex-start'},
    diagPendingDot: {
      width: 15, height: 15, borderRadius: 8, borderWidth: 1, borderColor: c.borderStrong,
    },
    diagLabel: {color: c.textPrimary, fontSize: 13},
    diagDetail: {color: c.textTertiary, fontSize: 11, marginTop: 1},
  safe: {flex: 1, backgroundColor: c.bg},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  backHit: {paddingRight: spacing.lg},
  back: {
    color: c.textSecondary,
    fontSize: typography.sm,
    fontFamily: typography.mono,
  },
  headerLabel: {
    color: c.textPrimary,
    fontSize: typography.true,
    fontFamily: typography.medium,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  headerSpacer: {flex: 1},
  scroll: {flex: 1},
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  banner: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  bannerTitle: {
    color: c.warning,
    fontSize: typography.true,
    fontFamily: typography.semiBold,
    letterSpacing: 2,
    marginBottom: spacing.md,
  },
  stepRow: {flexDirection: 'row', marginBottom: spacing.md},
  stepPending: {opacity: 1},
  stepNum: {
    color: c.textTertiary,
    fontSize: typography.sm,
    fontFamily: typography.mono,
    width: 20,
  },
  stepBody: {flex: 1},
  stepText: {
    color: c.textSecondary,
    fontSize: typography.sm,
    fontFamily: typography.sans,
    lineHeight: typography.lg,
  },
  stepLink: {
    color: c.textPrimary,
    fontSize: typography.sm,
    fontFamily: typography.mono,
    textDecorationLine: 'underline',
    marginTop: spacing.xs,
  },
  stepCmd: {
    color: c.textPrimary,
    fontSize: typography.xs,
    fontFamily: typography.mono,
    marginTop: spacing.xs,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: c.border,
    marginVertical: spacing.lg,
  },
  section: {},
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  harnessLabel: {
    color: c.textPrimary,
    fontSize: typography.lg,
    fontFamily: typography.semiBold,
  },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chipText: {
    color: c.textSecondary,
    fontSize: typography.true,
    fontFamily: typography.mono,
    letterSpacing: 1,
  },
  chipOk: {borderColor: c.success},
  chipOff: {borderColor: c.border},
  chipWarn: {borderColor: c.warning},
  chipChecking: {opacity: 1},
  dimmed: {opacity: 0.6},
  busyText: {
    color: c.textTertiary,
    fontSize: typography.xs,
    fontFamily: typography.mono,
    marginTop: spacing.sm,
  },
  btnRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
  },
  btnPrimary: {
    flex: 1,
    backgroundColor: c.accent,
    borderRadius: 4,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
  btnPrimaryText: {
    color: c.accentText,
    fontSize: typography.true,
    fontFamily: typography.medium,
    letterSpacing: 2,
  },
  btnDanger: {
    flex: 1,
    backgroundColor: c.danger,
    borderRadius: 4,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  btnDangerText: {
    color: '#000000',
    fontSize: typography.true,
    fontFamily: typography.medium,
    letterSpacing: 2,
  },
  btnGhost: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.borderStrong,
    borderRadius: 4,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
  },
  btnGhostText: {
    color: c.textSecondary,
    fontSize: typography.true,
    fontFamily: typography.medium,
    letterSpacing: 2,
  },
  disabled: {opacity: 0.4},
  configToggle: {marginTop: spacing.md, alignSelf: 'flex-start'},
  configToggleText: {
    color: c.textTertiary,
    fontSize: typography.true,
    fontFamily: typography.mono,
    letterSpacing: 2,
  },
  configBody: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  fieldWrap: {marginBottom: spacing.md},
  fieldLabel: {
    color: c.textTertiary,
    fontSize: typography.true,
    fontFamily: typography.mono,
    letterSpacing: 1.5,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.borderStrong,
    borderRadius: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    color: c.textPrimary,
    fontSize: typography.sm,
    fontFamily: typography.mono,
  },
  inputMultiline: {minHeight: 64, textAlignVertical: 'top'},
  configActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  btnSave: {
    backgroundColor: c.accent,
    borderRadius: 4,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  btnSaveText: {
    color: c.accentText,
    fontSize: typography.true,
    fontFamily: typography.medium,
    letterSpacing: 2,
  },
  terminalLink: {paddingVertical: spacing.sm},
  terminalLinkText: {
    color: c.textSecondary,
    fontSize: typography.sm,
    fontFamily: typography.mono,
  },
  rawRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  rawRowLabel: {
    color: c.textPrimary,
    fontSize: typography.true,
    fontFamily: typography.medium,
    letterSpacing: 1.5,
  },
  rawChevron: {
    color: c.textTertiary,
    fontSize: typography.sm,
    fontFamily: typography.mono,
  },
});
}
