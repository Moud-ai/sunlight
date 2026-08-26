/**
 * VmScreen — QEMU virtual machine management.
 *
 * Lets the user configure and run a lightweight Alpine or Debian VM directly
 * on the device. Uses QEMU with KVM acceleration when available, falling
 * back to software emulation (TCG).
 *
 * QEMU can be installed from bundled assets or downloaded directly,
 * making the VM feature independent of Termux.
 *
 * VM configs are persisted in SQLite via vmConfig.ts.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  NativeModules,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  Cpu,
  Download,
  HardDrive,
  MemoryStick,
  Play,
  Square,
  Terminal,
  Wifi,
  WifiOff,
  CheckCircle,
  AlertCircle,
} from 'lucide-react-native';

import type {RootStackParamList} from '../../App';
import {typography, spacing} from '../theme';
import {useThemeColors, type ThemeColors} from '../theme/ThemeProvider';
import {
  VmConfig,
  VmDistro,
  VmConfigInput,
  getOrCreateDefaultVm,
  updateVmConfig,
} from '../lib/vmConfig';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const VmManager = NativeModules.SunlightVm;

/** Distro display metadata. */
const DISTROS: Record<VmDistro, {label: string; desc: string; size: string}> = {
  alpine: {
    label: 'Alpine Linux',
    desc: 'Minimal, security-oriented. ~50MB image.',
    size: '~50 MB',
  },
  debian: {
    label: 'Debian',
    desc: 'Stable, full-featured. ~300MB image.',
    size: '~300 MB',
  },
};

/** Preset VM configurations. */
const PRESETS: Array<{label: string; input: VmConfigInput}> = [
  {label: 'Lightweight', input: {name: 'Lightweight VM', ramMb: 256, cpuCores: 1, diskGb: 2, distro: 'alpine'}},
  {label: 'Balanced', input: {name: 'Balanced VM', ramMb: 512, cpuCores: 2, diskGb: 4, distro: 'alpine'}},
  {label: 'Performance', input: {name: 'Performance VM', ramMb: 1024, cpuCores: 4, diskGb: 8, distro: 'debian'}},
];

function loadInitialVmConfig(): VmConfig {
  try {
    return getOrCreateDefaultVm();
  } catch {
    return {
      id: 'vm_unavailable',
      name: 'Sunlight VM',
      distro: 'alpine',
      ramMb: 512,
      cpuCores: 2,
      diskGb: 4,
      kvmEnabled: true,
      networkEnabled: true,
      sshPort: 2222,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
}

function safeUpdateVmConfig(
  id: string,
  input: Partial<VmConfigInput>,
): VmConfig | null {
  try {
    return updateVmConfig(id, input);
  } catch {
    return null;
  }
}

export default function VmScreen(): React.JSX.Element {
  const navigation = useNavigation<Nav>();
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  const [config, setConfig] = useState<VmConfig>(loadInitialVmConfig);
  const [vmRunning, setVmRunning] = useState(false);
  const [kvmAvailable, setKvmAvailable] = useState(false);
  const [kvmReason, setKvmReason] = useState('');
  const [qemuInstalled, setQemuInstalled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);

  // Detect KVM and QEMU status on mount.
  useEffect(() => {
    const init = async () => {
      try {
        // Check KVM
        const kvmStatus = await VmManager.getKvmStatus();
        setKvmAvailable(kvmStatus.available);
        setKvmReason(kvmStatus.reason);

        // Check QEMU installation
        const installed = await VmManager.isQemuInstalled();
        setQemuInstalled(installed);

        // Check if VM is running
        const running = await VmManager.isVmRunning();
        setVmRunning(running);
      } catch (e) {
        console.error('VM init error:', e);
      }
    };
    init();
  }, []);

  const updateField = useCallback(
    <K extends keyof VmConfigInput>(key: K, value: VmConfigInput[K]) => {
      const updated = safeUpdateVmConfig(config.id, {[key]: value});
      if (updated) {
        setConfig(updated);
      }
    },
    [config.id],
  );

  const applyPreset = useCallback(
    (preset: VmConfigInput) => {
      const updated = safeUpdateVmConfig(config.id, preset);
      if (updated) {
        setConfig(updated);
      }
    },
    [config.id],
  );

  const installQemu = useCallback(async () => {
    setInstalling(true);
    setInstallProgress(0);
    try {
      await VmManager.installQemu(null);
      setQemuInstalled(true);
      Alert.alert('Success', 'QEMU installed successfully. You can now start a VM.');
    } catch (e) {
      Alert.alert('Installation Failed', 'Could not install QEMU. Please check your internet connection and try again.');
    } finally {
      setInstalling(false);
      setInstallProgress(0);
    }
  }, []);

  const startVm = useCallback(async () => {
    if (!qemuInstalled) {
      Alert.alert(
        'QEMU Not Installed',
        'QEMU needs to be installed before starting a VM. Install it now?',
        [
          {text: 'Cancel', style: 'cancel'},
          {text: 'Install', onPress: installQemu},
        ],
      );
      return;
    }

    setLoading(true);
    try {
      await VmManager.startVm({
        ramMb: config.ramMb,
        cpuCores: config.cpuCores,
        diskGb: config.diskGb,
        distro: config.distro,
        kvmEnabled: config.kvmEnabled,
        networkEnabled: config.networkEnabled,
        sshPort: config.sshPort,
      });
      setVmRunning(true);
      navigation.navigate('Terminal');
    } catch (e: any) {
      const msg = e?.message || 'Unknown error';
      if (msg.includes('not installed')) {
        Alert.alert('QEMU Not Installed', 'Please install QEMU first.');
      } else if (msg.includes('already running')) {
        Alert.alert('VM Already Running', 'A VM is already running. Stop it first.');
      } else {
        Alert.alert('Start Failed', `Could not start VM: ${msg}`);
      }
    } finally {
      setLoading(false);
    }
  }, [config, qemuInstalled, installQemu, navigation]);

  const stopVm = useCallback(async () => {
    try {
      await VmManager.stopVm();
      setVmRunning(false);
    } catch (e) {
      console.error('Failed to stop VM:', e);
    }
  }, []);

  return (
    <View style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backHit} onPress={() => navigation.goBack()}>
          <Text style={styles.back}>back</Text>
        </TouchableOpacity>
        <Text style={styles.headerLabel}>virtual machine</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* QEMU Installation Status */}
        <View style={[styles.statusCard, qemuInstalled ? styles.statusOk : styles.statusWarn]}>
          <View style={styles.statusRow}>
            {qemuInstalled ? (
              <CheckCircle size={16} color={c.success} />
            ) : (
              <AlertCircle size={16} color={c.warning} />
            )}
            <Text style={[styles.statusText, {color: qemuInstalled ? c.success : c.warning}]}>
              {qemuInstalled ? 'QEMU installed' : 'QEMU not installed'}
            </Text>
          </View>
          {!qemuInstalled && (
            <TouchableOpacity
              style={styles.installBtn}
              onPress={installQemu}
              disabled={installing}>
              {installing ? (
                <ActivityIndicator size="small" color={c.accentText} />
              ) : (
                <Download size={14} color={c.accentText} />
              )}
              <Text style={styles.installText}>
                {installing ? `Installing... ${installProgress}%` : 'Install QEMU'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* KVM Status */}
        <View style={[styles.statusCard, kvmAvailable ? styles.statusOk : styles.statusWarn]}>
          <View style={styles.statusRow}>
            <Cpu size={16} color={kvmAvailable ? c.success : c.warning} />
            <Text style={[styles.statusText, {color: kvmAvailable ? c.success : c.warning}]}>
              {kvmAvailable ? 'KVM acceleration available' : 'Software emulation (TCG)'}
            </Text>
          </View>
          <Text style={styles.statusHint}>{kvmReason}</Text>
        </View>

        {/* Distro Selection */}
        <Text style={styles.sectionLabel}>Guest OS</Text>
        <View style={styles.distroRow}>
          {(Object.keys(DISTROS) as VmDistro[]).map(d => (
            <TouchableOpacity
              key={d}
              style={[styles.distroCard, config.distro === d && styles.distroCardActive]}
              onPress={() => updateField('distro', d)}>
              <Text style={[styles.distroLabel, config.distro === d && styles.distroLabelActive]}>
                {DISTROS[d].label}
              </Text>
              <Text style={styles.distroDesc}>{DISTROS[d].desc}</Text>
              <Text style={styles.distroSize}>{DISTROS[d].size}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Hardware Configuration */}
        <Text style={styles.sectionLabel}>Hardware</Text>

        {/* RAM */}
        <View style={styles.configRow}>
          <View style={styles.configLabel}>
            <MemoryStick size={14} color={c.textSecondary} />
            <Text style={styles.configText}>RAM</Text>
          </View>
          <View style={styles.configValue}>
            <TouchableOpacity style={styles.stepBtn} onPress={() => updateField('ramMb', Math.max(128, config.ramMb - 128))}>
              <Text style={styles.stepText}>-</Text>
            </TouchableOpacity>
            <Text style={styles.configNumber}>{config.ramMb} MB</Text>
            <TouchableOpacity style={styles.stepBtn} onPress={() => updateField('ramMb', Math.min(4096, config.ramMb + 128))}>
              <Text style={styles.stepText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* CPU */}
        <View style={styles.configRow}>
          <View style={styles.configLabel}>
            <Cpu size={14} color={c.textSecondary} />
            <Text style={styles.configText}>CPU cores</Text>
          </View>
          <View style={styles.configValue}>
            <TouchableOpacity style={styles.stepBtn} onPress={() => updateField('cpuCores', Math.max(1, config.cpuCores - 1))}>
              <Text style={styles.stepText}>-</Text>
            </TouchableOpacity>
            <Text style={styles.configNumber}>{config.cpuCores}</Text>
            <TouchableOpacity style={styles.stepBtn} onPress={() => updateField('cpuCores', Math.min(8, config.cpuCores + 1))}>
              <Text style={styles.stepText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Disk */}
        <View style={styles.configRow}>
          <View style={styles.configLabel}>
            <HardDrive size={14} color={c.textSecondary} />
            <Text style={styles.configText}>Disk</Text>
          </View>
          <View style={styles.configValue}>
            <TouchableOpacity style={styles.stepBtn} onPress={() => updateField('diskGb', Math.max(1, config.diskGb - 1))}>
              <Text style={styles.stepText}>-</Text>
            </TouchableOpacity>
            <Text style={styles.configNumber}>{config.diskGb} GB</Text>
            <TouchableOpacity style={styles.stepBtn} onPress={() => updateField('diskGb', Math.min(64, config.diskGb + 1))}>
              <Text style={styles.stepText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Toggles */}
        <Text style={styles.sectionLabel}>Options</Text>

        <View style={styles.toggleRow}>
          <View style={styles.toggleLabel}>
            {config.networkEnabled ? (
              <Wifi size={14} color={c.textSecondary} />
            ) : (
              <WifiOff size={14} color={c.textTertiary} />
            )}
            <Text style={styles.toggleText}>Network access</Text>
          </View>
          <Switch
            value={config.networkEnabled}
            onValueChange={v => updateField('networkEnabled', v)}
            trackColor={{false: c.border, true: c.accent}}
          />
        </View>

        <View style={styles.toggleRow}>
          <View style={styles.toggleLabel}>
            <Cpu size={14} color={config.kvmEnabled ? c.textSecondary : c.textTertiary} />
            <Text style={styles.toggleText}>KVM acceleration</Text>
          </View>
          <Switch
            value={config.kvmEnabled}
            onValueChange={v => updateField('kvmEnabled', v)}
            trackColor={{false: c.border, true: c.accent}}
          />
        </View>

        {/* SSH Port */}
        <View style={styles.configRow}>
          <View style={styles.configLabel}>
            <Terminal size={14} color={c.textSecondary} />
            <Text style={styles.configText}>SSH port</Text>
          </View>
          <TextInput
            style={styles.portInput}
            value={String(config.sshPort)}
            onChangeText={v => {
              const port = parseInt(v, 10);
              if (!isNaN(port) && port > 0 && port < 65536) {
                updateField('sshPort', port);
              }
            }}
            keyboardType="number-pad"
            placeholderTextColor={c.textTertiary}
          />
        </View>

        {/* Presets */}
        <Text style={styles.sectionLabel}>Presets</Text>
        <View style={styles.presetRow}>
          {PRESETS.map(p => (
            <TouchableOpacity key={p.label} style={styles.presetBtn} onPress={() => applyPreset(p.input)}>
              <Text style={styles.presetText}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Action Buttons */}
        <View style={styles.actionRow}>
          {vmRunning ? (
            <>
              <TouchableOpacity style={[styles.actionBtn, styles.stopBtn]} onPress={stopVm}>
                <Square size={16} color={c.danger} />
                <Text style={[styles.actionText, {color: c.danger}]}>Stop VM</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.terminalBtn]}
                onPress={() => navigation.navigate('Terminal')}>
                <Terminal size={16} color={c.accentText} />
                <Text style={[styles.actionText, {color: c.accentText}]}>Open Terminal</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={[styles.actionBtn, styles.startBtn, !qemuInstalled && styles.btnDisabled]}
              onPress={startVm}
              disabled={loading || installing}>
              {loading ? (
                <ActivityIndicator size="small" color={c.accentText} />
              ) : (
                <Play size={16} color={c.accentText} />
              )}
              <Text style={[styles.actionText, {color: c.accentText}]}>
                {loading ? 'Starting...' : 'Start VM'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Info */}
        <Text style={styles.info}>
          The VM runs a lightweight Linux distribution in a sandboxed environment.
          You can install and run agent tools inside it. Network access allows
          downloading packages and connecting to external services.{'\n\n'}
          QEMU can be installed directly or optionally via Termux for advanced setups.
        </Text>
      </ScrollView>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: {flex: 1, backgroundColor: c.bg},
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 16,
      paddingTop: Platform.OS === 'ios' ? 54 : 14,
      paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
      position: 'relative',
    },
    backHit: {
      position: 'absolute',
      left: 16,
      top: Platform.OS === 'ios' ? 54 : 14,
      bottom: 0,
      justifyContent: 'center',
    },
    back: {color: c.textSecondary, fontSize: 13},
    headerLabel: {
      color: c.textTertiary,
      fontSize: 11,
      fontFamily: typography.mono,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
    },
    scroll: {flex: 1},
    scrollContent: {padding: 16, paddingBottom: 40},

    // Status cards
    statusCard: {
      borderRadius: 8,
      borderWidth: 1,
      padding: 12,
      marginBottom: 12,
    },
    statusOk: {
      backgroundColor: c.successMuted,
      borderColor: c.success,
    },
    statusWarn: {
      backgroundColor: c.warningMuted,
      borderColor: c.warning,
    },
    statusRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
    statusText: {fontSize: 13, fontWeight: '600'},
    statusHint: {color: c.textTertiary, fontSize: 11, marginTop: 4, lineHeight: 16},

    // Install button
    installBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: c.accent,
      borderRadius: 6,
      paddingVertical: 10,
      paddingHorizontal: 16,
      marginTop: 10,
    },
    installText: {color: c.accentText, fontSize: 13, fontWeight: '600'},

    // Section labels
    sectionLabel: {
      color: c.textTertiary,
      fontSize: 11,
      fontFamily: typography.mono,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      marginBottom: 10,
      marginTop: 20,
    },

    // Distro selection
    distroRow: {flexDirection: 'row', gap: 10},
    distroCard: {
      flex: 1,
      backgroundColor: c.bgSurface,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      padding: 12,
    },
    distroCardActive: {borderColor: c.accent, backgroundColor: c.accentMuted},
    distroLabel: {color: c.textPrimary, fontSize: 14, fontWeight: '600', marginBottom: 4},
    distroLabelActive: {color: c.accent},
    distroDesc: {color: c.textSecondary, fontSize: 11, lineHeight: 15, marginBottom: 6},
    distroSize: {color: c.textTertiary, fontSize: 10, fontFamily: typography.mono},

    // Config rows
    configRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    configLabel: {flexDirection: 'row', alignItems: 'center', gap: 8},
    configText: {color: c.textPrimary, fontSize: 14},
    configValue: {flexDirection: 'row', alignItems: 'center', gap: 12},
    configNumber: {
      color: c.textPrimary,
      fontSize: 14,
      fontFamily: typography.mono,
      minWidth: 60,
      textAlign: 'center',
    },
    stepBtn: {
      width: 32,
      height: 32,
      borderRadius: 6,
      backgroundColor: c.bgSurface,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepText: {color: c.textPrimary, fontSize: 16, fontWeight: '600'},

    // Toggles
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    toggleLabel: {flexDirection: 'row', alignItems: 'center', gap: 8},
    toggleText: {color: c.textPrimary, fontSize: 14},

    // Port input
    portInput: {
      color: c.textPrimary,
      fontSize: 14,
      fontFamily: typography.mono,
      backgroundColor: c.bgSurface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      minWidth: 80,
      textAlign: 'center',
    },

    // Presets
    presetRow: {flexDirection: 'row', gap: 8},
    presetBtn: {
      flex: 1,
      backgroundColor: c.bgSurface,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: c.border,
      paddingVertical: 10,
      alignItems: 'center',
    },
    presetText: {color: c.textSecondary, fontSize: 12, fontWeight: '500'},

    // Actions
    actionRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 24,
    },
    actionBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 14,
      borderRadius: 8,
    },
    startBtn: {backgroundColor: c.accent},
    stopBtn: {backgroundColor: c.dangerMuted},
    terminalBtn: {backgroundColor: c.accent},
    btnDisabled: {opacity: 0.5},
    actionText: {fontSize: 14, fontWeight: '600'},

    // Info
    info: {
      color: c.textTertiary,
      fontSize: 11,
      lineHeight: 16,
      marginTop: 20,
      textAlign: 'center',
    },
  });
}
