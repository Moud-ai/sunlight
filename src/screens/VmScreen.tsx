/**
 * VmScreen — Sunlight VM (QEMU arm64 Alpine guest) management.
 *
 * Status cards for QEMU/kernel/initrd/disk, install payloads with progress,
 * Start/Stop, editable CPU/RAM/disk (presets + steppers), storage used, and a
 * button to open the serial console.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../../App';
import {typography, spacing} from '../theme';
import {useThemeColors, type ThemeColors} from '../theme/ThemeProvider';
import {
  deleteDiskImage,
  getVmStatus,
  installVmPayloads,
  isVmRunning,
  startVm,
  stopVm,
  getVmStorageUsed,
  type VmStatus,
} from '../lib/vm';
import {
  applyPreset,
  clampCores,
  clampDisk,
  clampRam,
  loadVmConfig,
  saveVmConfig,
  VM_PRESETS,
  type VmConfig,
} from '../lib/vmConfig';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function VmScreen(): React.JSX.Element {
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<Nav>();

  const [status, setStatus] = useState<VmStatus | null>(null);
  const [config, setConfig] = useState<VmConfig | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installPct, setInstallPct] = useState(0);
  const [starting, setStarting] = useState(false);
  const [msg, setMsg] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [s, cfg, used] = await Promise.all([
        getVmStatus(),
        loadVmConfig(),
        getVmStorageUsed(),
      ]);
      setStatus({...s, storageUsed: used});
      setConfig(cfg);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      isVmRunning()
        .then(running => {
          setStatus(prev => {
            if (prev && prev.running && !running) {
              queueMicrotask(() => setMsg('VM stopped unexpectedly'));
            }
            return prev ? {...prev, running} : prev;
          });
        })
        .catch(e => {
          console.warn('isVmRunning poll failed:', e);
        });
    }, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const onInstall = useCallback(async () => {
    setInstalling(true);
    setInstallPct(0);
    setMsg('');
    try {
      await installVmPayloads((done, total) => {
        setInstallPct(Math.round((done / total) * 100));
      });
      setMsg('payloads ready');
    } catch (e) {
      setMsg(`install failed: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setInstalling(false);
      refresh();
    }
  }, [refresh]);

  const onStart = useCallback(async () => {
    if (!config) {
      return;
    }
    setStarting(true);
    setMsg('');
    try {
      await startVm(config);
      setMsg('vm started');
    } catch (e) {
      setMsg(`start failed: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setStarting(false);
      refresh();
    }
  }, [config, refresh]);

  const onStop = useCallback(async () => {
    setMsg('');
    try {
      await stopVm();
      setMsg('vm stopped');
    } catch (e) {
      setMsg(`stop failed: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      refresh();
    }
  }, [refresh]);

  const updateConfig = useCallback(
    async (patch: Partial<VmConfig>) => {
      if (!config) {
        return;
      }
      const next = {...config, ...patch};
      setConfig(next);
      await saveVmConfig(next).catch(() => {});
    },
    [config],
  );

  const onResetDisk = useCallback(async () => {
    setMsg('');
    try {
      const ok = await deleteDiskImage();
      setMsg(ok ? 'disk wiped (reformats on next boot)' : 'disk delete failed');
    } catch (e) {
      setMsg(`reset failed: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      refresh();
    }
  }, [refresh]);

  const ready = !!status && status.kernelInstalled && status.initrdInstalled;
  const running = !!status?.running;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>virtual machine</Text>
        <Text style={styles.subtitle}>arm64 Alpine guest via QEMU</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <StatusRow c={c} styles={styles} label="QEMU emulator" ok={!!status?.qemuInstalled} />
        <StatusRow c={c} styles={styles} label="Kernel (vmlinuz-virt)" ok={!!status?.kernelInstalled} />
        <StatusRow c={c} styles={styles} label="Initramfs (initrd-sunlight)" ok={!!status?.initrdInstalled} />
        <StatusRow c={c} styles={styles} label="VM running" ok={running} />
        <StatusRow c={c} styles={styles} label="Persistent disk" ok={!!status?.diskExists} />

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>storage</Text>
          <Text style={styles.hint}>
            {(status?.storageUsed ?? 0) / 1024 / 1024 / 1024 > 1
              ? `${((status?.storageUsed ?? 0) / 1024 / 1024 / 1024).toFixed(1)} GB used`
              : `${Math.round((status?.storageUsed ?? 0) / 1024 / 1024)} MB used`}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>presets</Text>
          <View style={styles.row}>
            {(Object.keys(VM_PRESETS) as Array<keyof typeof VM_PRESETS>).map(name => (
              <TouchableOpacity
                key={name}
                style={styles.chip}
                onPress={() => applyPreset(name).then(setConfig)}
                activeOpacity={0.7}>
                <Text style={styles.chipText}>{name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {config ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>resources</Text>
            <Stepper
              c={c}
              styles={styles}
              label="RAM"
              value={`${config.ramMb} MB`}
              onDec={() => updateConfig({ramMb: clampRam(config.ramMb - 256)})}
              onInc={() => updateConfig({ramMb: clampRam(config.ramMb + 256)})}
            />
            <Stepper
              c={c}
              styles={styles}
              label="CPU cores"
              value={`${config.cpuCores}`}
              onDec={() => updateConfig({cpuCores: clampCores(config.cpuCores - 1)})}
              onInc={() => updateConfig({cpuCores: clampCores(config.cpuCores + 1)})}
            />
            <Stepper
              c={c}
              styles={styles}
              label="Disk"
              value={`${config.diskGb} GB`}
              onDec={() => updateConfig({diskGb: clampDisk(config.diskGb - 1)})}
              onInc={() => updateConfig({diskGb: clampDisk(config.diskGb + 1)})}
            />
          </View>
        ) : null}

        {installing ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>installing payloads… {installPct}%</Text>
            <View style={[styles.progressTrack, {backgroundColor: c.bgElevated}]}>
              <View
                style={[
                  styles.progressFill,
                  {width: `${installPct}%`, backgroundColor: c.accent},
                ]}
              />
            </View>
          </View>
        ) : null}

        <View style={styles.actions}>
          {!ready ? (
            <TouchableOpacity style={styles.button} onPress={onInstall} disabled={installing}>
              <Text style={styles.buttonText}>install kernel + initramfs</Text>
            </TouchableOpacity>
          ) : running ? (
            <TouchableOpacity style={[styles.button, {backgroundColor: c.danger}]} onPress={onStop}>
              <Text style={styles.buttonText}>stop vm</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.button} onPress={onStart} disabled={starting}>
              <Text style={styles.buttonText}>{starting ? 'starting…' : 'start vm'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.button, styles.buttonGhost]}
            onPress={() => navigation.navigate('VmConsole')}
            disabled={!running}>
            <Text style={[styles.buttonText, {color: c.accent}]}>open console</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.buttonGhost]}
            onPress={onResetDisk}
            disabled={running}>
            <Text style={[styles.buttonText, {color: c.danger}]}>wipe disk</Text>
          </TouchableOpacity>
        </View>

        {msg ? <Text style={styles.hint}>{msg}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusRow({
  c,
  styles,
  label,
  ok,
}: {
  c: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
  label: string;
  ok: boolean;
}) {
  return (
    <View style={styles.statusRow}>
      <Text style={styles.statusLabel}>{label}</Text>
      <View
        style={[
          styles.dot,
          {backgroundColor: ok ? c.accent : c.bgElevated, borderColor: ok ? c.accent : c.border},
        ]}
      />
    </View>
  );
}

function Stepper({
  c,
  styles,
  label,
  value,
  onDec,
  onInc,
}: {
  c: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
  label: string;
  value: string;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.statusLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <TouchableOpacity style={styles.stepperBtn} onPress={onDec} activeOpacity={0.7}>
          <Text style={styles.stepperBtnText}>−</Text>
        </TouchableOpacity>
        <Text style={[styles.stepperValue, {color: c.textPrimary}]}>{value}</Text>
        <TouchableOpacity style={styles.stepperBtn} onPress={onInc} activeOpacity={0.7}>
          <Text style={styles.stepperBtnText}>+</Text>
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
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    statusLabel: {color: c.textSecondary, fontSize: typography.sm, fontFamily: typography.medium},
    dot: {width: 12, height: 12, borderRadius: 6, borderWidth: 2},
    section: {marginTop: spacing.lg},
    sectionLabel: {
      color: c.textTertiary,
      fontSize: 11,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    hint: {color: c.textTertiary, fontSize: typography.xs, marginTop: 4},
    row: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
    chip: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    chipText: {color: c.textSecondary, fontSize: typography.sm},
    stepperRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    stepperControls: {flexDirection: 'row', alignItems: 'center', gap: 10},
    stepperBtn: {
      width: 30,
      height: 30,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepperBtnText: {color: c.textPrimary, fontSize: 16},
    stepperValue: {fontSize: typography.sm, fontFamily: typography.mono, minWidth: 72, textAlign: 'center'},
    progressTrack: {height: 6, borderRadius: 3, overflow: 'hidden'},
    progressFill: {height: 6, borderRadius: 3},
    actions: {marginTop: spacing.lg, gap: 10},
    button: {
      backgroundColor: c.accent,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: 'center',
    },
    buttonGhost: {backgroundColor: 'transparent', borderWidth: 1, borderColor: c.border},
    buttonText: {color: c.accentText, fontSize: typography.sm, fontFamily: typography.medium},
  });
}