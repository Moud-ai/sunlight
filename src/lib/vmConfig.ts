/**
 * VM configuration — CPU/RAM/disk sizing for the Sunlight QEMU VM.
 * Persisted in AsyncStorage (no native sqlite dependency).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type VmDistro = 'alpine';

export interface VmConfig {
  distro: VmDistro;
  ramMb: number;
  cpuCores: number;
  diskGb: number;
  networkEnabled: boolean;
  sshPort: number;
}

const STORAGE_KEY = '@sunlight_vm_config';

export const VM_PRESETS: Record<string, Pick<VmConfig, 'ramMb' | 'cpuCores' | 'diskGb'>> = {
  lightweight: {ramMb: 512, cpuCores: 2, diskGb: 4},
  balanced: {ramMb: 1024, cpuCores: 4, diskGb: 8},
  performance: {ramMb: 2048, cpuCores: 8, diskGb: 16},
};

export const DEFAULT_VM_CONFIG: VmConfig = {
  distro: 'alpine',
  ...VM_PRESETS.lightweight,
  networkEnabled: true,
  sshPort: 2222,
};

const MIN_RAM = 256;
const MAX_RAM = 4096;
const MIN_CORES = 1;
const MAX_CORES = 8;
const MIN_DISK = 1;
const MAX_DISK = 64;

export function clampRam(v: number): number {
  return Math.max(MIN_RAM, Math.min(MAX_RAM, Math.round(v)));
}
export function clampCores(v: number): number {
  return Math.max(MIN_CORES, Math.min(MAX_CORES, Math.round(v)));
}
export function clampDisk(v: number): number {
  return Math.max(MIN_DISK, Math.min(MAX_DISK, Math.round(v)));
}

function isVmConfig(v: unknown): v is VmConfig {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const c = v as Record<string, unknown>;
  return (
    c.distro === 'alpine' &&
    typeof c.ramMb === 'number' &&
    typeof c.cpuCores === 'number' &&
    typeof c.diskGb === 'number' &&
    typeof c.networkEnabled === 'boolean' &&
    typeof c.sshPort === 'number'
  );
}

export async function loadVmConfig(): Promise<VmConfig> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {...DEFAULT_VM_CONFIG};
    }
    const parsed: unknown = JSON.parse(raw);
    return isVmConfig(parsed) ? parsed : {...DEFAULT_VM_CONFIG};
  } catch {
    return {...DEFAULT_VM_CONFIG};
  }
}

export async function saveVmConfig(config: VmConfig): Promise<void> {
  const next: VmConfig = {
    distro: 'alpine',
    ramMb: clampRam(config.ramMb),
    cpuCores: clampCores(config.cpuCores),
    diskGb: clampDisk(config.diskGb),
    networkEnabled: config.networkEnabled,
    sshPort: config.sshPort,
  };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export async function applyPreset(name: keyof typeof VM_PRESETS): Promise<VmConfig> {
  const current = await loadVmConfig();
  const next = {...current, ...VM_PRESETS[name]};
  await saveVmConfig(next);
  return next;
}