/**
 * Harnesses — coding agents (Hermes, Pi) that run inside the Sunlight VM.
 *
 * Agents execute in the Alpine guest over the serial console. The screen shows
 * an install state chip per agent, INSTALL/LAUNCH actions, editable install
 * scripts, and a short guided flow: 1) start the VM, 2) install the agent,
 * 3) launch it, 4) verify. No Termux involvement.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../../App';
import {typography, spacing} from '../theme';
import {useThemeColors, type ThemeColors} from '../theme/ThemeProvider';
import {
  HARNESS_IDS,
  HarnessError,
  type HarnessId,
  type ResolvedHarness,
  checkInstalled,
  clearHarnessOverride,
  installHarness,
  launchHarness,
  loadEffectiveHarness,
  saveHarnessOverride,
} from '../lib/harness';
import {isVmRunning} from '../lib/vm';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type CheckState =
  | {kind: 'checking'}
  | {kind: 'vm_missing'}
  | {kind: 'not_installed'}
  | {kind: 'installed'; version?: string};

const STEPS = ['start the VM', 'install the agent', 'launch it', 'verify with --version'];

export default function HarnessesScreen(): React.JSX.Element {
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<Nav>();
  const [states, setStates] = useState<Record<HarnessId, CheckState>>({
    hermes: {kind: 'checking'},
    pi: {kind: 'checking'},
  });
  const [vmRunning, setVmRunning] = useState(false);
  const [editing, setEditing] = useState<HarnessId | null>(null);
  const [installDraft, setInstallDraft] = useState('');
  const [busy, setBusy] = useState<HarnessId | null>(null);

  const checkAll = useCallback(async () => {
    setStates({
      hermes: {kind: 'checking'},
      pi: {kind: 'checking'},
    });
    for (const id of HARNESS_IDS) {
      const res = await checkInstalled(id);
      setStates(prev => ({...prev, [id]: res}));
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await checkAll();
      const t = setInterval(async () => {
        const running = await isVmRunning().catch(() => false);
        if (mounted) {
          setVmRunning(running);
        }
      }, 3000);
      return () => {
        mounted = false;
        clearInterval(t);
      };
    })();
  }, [checkAll]);

  const onInstall = useCallback(
    async (id: HarnessId) => {
      setBusy(id);
      try {
        await installHarness(id);
        setStates(prev => ({...prev, [id]: {kind: 'not_installed'}}));
        await checkAll();
      } catch (e) {
        setStates(prev => ({
          ...prev,
          [id]:
            e instanceof HarnessError ? {kind: 'vm_missing'} : {kind: 'not_installed'},
        }));
      } finally {
        setBusy(null);
      }
    },
    [checkAll],
  );

  const onLaunch = useCallback(async (id: HarnessId) => {
    try {
      await launchHarness(id);
      navigation.navigate('VmConsole');
    } catch (e) {
      setStates(prev => ({
        ...prev,
        [id]: e instanceof HarnessError ? {kind: 'vm_missing'} : prev[id],
      }));
    }
  }, [navigation]);

  const onSaveDraft = useCallback(
    async (id: HarnessId) => {
      if (editing !== id) {
        return;
      }
      await saveHarnessOverride(id, {installCmd: installDraft}).catch(() => {});
      setEditing(null);
    },
    [editing, installDraft],
  );

  const onEdit = useCallback(async (id: HarnessId) => {
    const effective = await loadEffectiveHarness(id);
    setInstallDraft(effective.installCmd);
    setEditing(id);
  }, []);

  const onReset = useCallback(async (id: HarnessId) => {
    await clearHarnessOverride(id);
    setEditing(null);
    await checkAll();
  }, [checkAll]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>harnesses</Text>
        <Text style={styles.subtitle}>coding agents inside your vm</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {!vmRunning ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>vm required</Text>
            <Text style={styles.hint}>
              agents run inside the Sunlight VM — start it first, then open the console and log
              in with root / sunlight.
            </Text>
            <TouchableOpacity
              style={styles.button}
              onPress={() => navigation.navigate('Vm')}
              activeOpacity={0.7}>
              <Text style={styles.buttonText}>open vm</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>guided setup</Text>
          {STEPS.map((s, i) => (
            <View key={s} style={styles.stepRow}>
              <Text style={styles.stepNum}>{i + 1}</Text>
              <Text style={styles.stepText}>{s}</Text>
            </View>
          ))}
        </View>

        {HARNESS_IDS.map(id => (
          <HarnessCard
            key={id}
            id={id}
            state={states[id]}
            vmRunning={vmRunning}
            busy={busy === id}
            editing={editing === id}
            installDraft={editing === id ? installDraft : ''}
            onDraftChange={setInstallDraft}
            onInstall={onInstall}
            onLaunch={onLaunch}
            onEdit={() => onEdit(id)}
            onSave={() => onSaveDraft(id)}
            onReset={() => onReset(id)}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function HarnessCard({
  id,
  state,
  vmRunning,
  busy,
  editing,
  installDraft,
  onDraftChange,
  onInstall,
  onLaunch,
  onEdit,
  onSave,
  onReset,
}: {
  id: HarnessId;
  state: CheckState;
  vmRunning: boolean;
  busy: boolean;
  editing: boolean;
  installDraft: string;
  onDraftChange: (v: string) => void;
  onInstall: (id: HarnessId) => void;
  onLaunch: (id: HarnessId) => void;
  onEdit: () => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [effective, setEffective] = useState<ResolvedHarness | null>(null);

  useEffect(() => {
    loadEffectiveHarness(id).then(setEffective).catch(() => {});
  }, [id, editing]);

  const label = effective?.label ?? (id === 'hermes' ? 'Hermes Agent' : 'Pi coding agent');
  const description =
    effective?.description ??
    (id === 'hermes'
      ? 'Streaming coding agent powered by a local GGUF model.'
      : 'Lightweight terminal coding agent for the VM shell.');

  const chip =
    state.kind === 'checking'
      ? {text: 'checking…', ok: false}
      : state.kind === 'vm_missing'
        ? {text: 'vm offline', ok: false}
        : state.kind === 'installed'
          ? {text: `v${state.version ?? ''}`, ok: true}
          : {text: 'not installed', ok: false};

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleWrap}>
          <Text style={styles.cardTitle}>{label}</Text>
          <Text style={styles.cardDesc}>{description}</Text>
        </View>
        <View style={[styles.chip, chip.ok && {backgroundColor: 'rgba(52,199,89,0.12)'}]}>
          <Text style={[styles.chipText, chip.ok && {color: '#34c759'}]}>{chip.text}</Text>
        </View>
      </View>
      {editing ? (
        <View style={styles.editorWrap}>
          <TextInput
            style={styles.editor}
            value={installDraft}
            onChangeText={onDraftChange}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.editorActions}>
            <TouchableOpacity style={styles.smallBtn} onPress={onSave} activeOpacity={0.7}>
              <Text style={styles.smallBtnText}>save</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.smallBtn} onPress={onReset} activeOpacity={0.7}>
              <Text style={[styles.smallBtnText, {color: c.danger}]}>reset</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      <View style={styles.cardActions}>
        <TouchableOpacity
          style={[styles.smallBtn, styles.smallBtnSolid]}
          onPress={() => onInstall(id)}
          disabled={busy || !vmRunning || state.kind === 'installed'}
          activeOpacity={0.7}>
          <Text style={styles.smallBtnSolidText}>{busy ? 'installing…' : 'install'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.smallBtn}
          onPress={() => onLaunch(id)}
          disabled={!vmRunning}
          activeOpacity={0.7}>
          <Text style={styles.smallBtnText}>launch</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.smallBtn} onPress={onEdit} activeOpacity={0.7}>
          <Text style={styles.smallBtnText}>configure</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: {flex: 1, backgroundColor: c.bg},
    header: {paddingHorizontal: spacing.md, paddingVertical: spacing.md},
    title: {color: c.textPrimary, fontSize: typography.lg, fontFamily: typography.medium},
    subtitle: {color: c.textSecondary, fontSize: typography.sm, marginTop: 2},
    body: {paddingHorizontal: spacing.md, paddingBottom: 40},
    section: {marginTop: spacing.lg},
    sectionLabel: {
      color: c.textTertiary,
      fontSize: 11,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    hint: {color: c.textTertiary, fontSize: typography.xs, lineHeight: 16},
    stepRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 10},
    stepNum: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: c.bgElevated,
      borderWidth: 1,
      borderColor: c.border,
      textAlign: 'center',
      fontSize: 11,
      color: c.textSecondary,
      lineHeight: 20,
    },
    stepText: {color: c.textSecondary, fontSize: typography.sm},
    button: {
      backgroundColor: c.accent,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: 'center',
      marginTop: 10,
    },
    buttonText: {color: c.accentText, fontSize: typography.sm, fontFamily: typography.medium},
    card: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      padding: 14,
      marginTop: spacing.md,
      backgroundColor: c.bgSurface,
    },
    cardHeader: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between'},
    cardTitleWrap: {flex: 1, paddingRight: 10},
    cardTitle: {color: c.textPrimary, fontSize: typography.md, fontFamily: typography.medium},
    cardDesc: {color: c.textTertiary, fontSize: typography.xs, marginTop: 2, lineHeight: 15},
    chip: {borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3},
    chipText: {color: c.textSecondary, fontSize: 11},
    editorWrap: {marginTop: 10},
    editor: {
      color: c.textPrimary,
      backgroundColor: c.bgElevated,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 6,
      padding: 8,
      fontSize: 12,
      fontFamily: typography.mono,
      minHeight: 70,
      textAlignVertical: 'top',
    },
    editorActions: {flexDirection: 'row', gap: 8, marginTop: 8},
    cardActions: {flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap'},
    smallBtn: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 6,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    smallBtnSolid: {backgroundColor: c.accent, borderColor: c.accent},
    smallBtnText: {color: c.textSecondary, fontSize: typography.sm},
    smallBtnSolidText: {color: c.accentText, fontSize: typography.sm, fontFamily: typography.medium},
  });
}