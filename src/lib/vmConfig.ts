/**
 * VM Configuration Storage — SQLite-backed persistence for QEMU virtual
 * machine configurations.
 *
 * Each VM config stores the hardware allocation (RAM, CPU, disk), the
 * guest distro (Alpine or Debian), and runtime flags (KVM, network).
 * The actual disk images and QEMU binaries are managed separately.
 */
import {open} from 'react-native-nitro-sqlite';

export type VmDistro = 'alpine' | 'debian';

export interface VmConfig {
  id: string;
  name: string;
  distro: VmDistro;
  ramMb: number;
  cpuCores: number;
  diskGb: number;
  kvmEnabled: boolean;
  networkEnabled: boolean;
  sshPort: number;
  createdAt: number;
  updatedAt: number;
}

export interface VmConfigInput {
  name: string;
  distro?: VmDistro;
  ramMb?: number;
  cpuCores?: number;
  diskGb?: number;
  kvmEnabled?: boolean;
  networkEnabled?: boolean;
  sshPort?: number;
}

const DB_NAME = 'sunlight_vm.db';

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS vm_configs (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    distro TEXT NOT NULL DEFAULT 'alpine',
    ram_mb INTEGER NOT NULL DEFAULT 512,
    cpu_cores INTEGER NOT NULL DEFAULT 2,
    disk_gb INTEGER NOT NULL DEFAULT 4,
    kvm_enabled INTEGER NOT NULL DEFAULT 1,
    network_enabled INTEGER NOT NULL DEFAULT 1,
    ssh_port INTEGER NOT NULL DEFAULT 2222,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

function generateId(): string {
  return 'vm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function rowToConfig(row: Record<string, unknown>): VmConfig {
  return {
    id: row.id as string,
    name: row.name as string,
    distro: row.distro as VmDistro,
    ramMb: row.ram_mb as number,
    cpuCores: row.cpu_cores as number,
    diskGb: row.disk_gb as number,
    kvmEnabled: (row.kvm_enabled as number) === 1,
    networkEnabled: (row.network_enabled as number) === 1,
    sshPort: row.ssh_port as number,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

/** Open (or create) the VM config database. */
function getDb() {
  const db = open({name: DB_NAME});
  db.execute(CREATE_TABLE);
  return db;
}

/** List all VM configs, ordered by most recently updated. */
export function listVmConfigs(): VmConfig[] {
  const db = getDb();
  const result = db.execute('SELECT * FROM vm_configs ORDER BY updated_at DESC');
  return result.rows?._array?.map(rowToConfig) ?? [];
}

/** Get a single VM config by ID. */
export function getVmConfig(id: string): VmConfig | null {
  const db = getDb();
  const result = db.execute('SELECT * FROM vm_configs WHERE id = ?', [id]);
  const rows = result.rows?._array;
  return rows && rows.length > 0 ? rowToConfig(rows[0]) : null;
}

/** Create a new VM config with defaults. */
export function createVmConfig(input: VmConfigInput): VmConfig {
  const db = getDb();
  const now = Date.now();
  const config: VmConfig = {
    id: generateId(),
    name: input.name,
    distro: input.distro ?? 'alpine',
    ramMb: input.ramMb ?? 512,
    cpuCores: input.cpuCores ?? 2,
    diskGb: input.diskGb ?? 4,
    kvmEnabled: input.kvmEnabled ?? true,
    networkEnabled: input.networkEnabled ?? true,
    sshPort: input.sshPort ?? 2222,
    createdAt: now,
    updatedAt: now,
  };

  db.execute(
    `INSERT INTO vm_configs (id, name, distro, ram_mb, cpu_cores, disk_gb,
     kvm_enabled, network_enabled, ssh_port, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      config.id,
      config.name,
      config.distro,
      config.ramMb,
      config.cpuCores,
      config.diskGb,
      config.kvmEnabled ? 1 : 0,
      config.networkEnabled ? 1 : 0,
      config.sshPort,
      config.createdAt,
      config.updatedAt,
    ],
  );

  return config;
}

/** Update an existing VM config. */
export function updateVmConfig(id: string, input: Partial<VmConfigInput>): VmConfig | null {
  const existing = getVmConfig(id);
  if (!existing) {
    return null;
  }

  const db = getDb();
  const now = Date.now();
  const updated: VmConfig = {
    ...existing,
    name: input.name ?? existing.name,
    distro: input.distro ?? existing.distro,
    ramMb: input.ramMb ?? existing.ramMb,
    cpuCores: input.cpuCores ?? existing.cpuCores,
    diskGb: input.diskGb ?? existing.diskGb,
    kvmEnabled: input.kvmEnabled ?? existing.kvmEnabled,
    networkEnabled: input.networkEnabled ?? existing.networkEnabled,
    sshPort: input.sshPort ?? existing.sshPort,
    updatedAt: now,
  };

  db.execute(
    `UPDATE vm_configs SET name = ?, distro = ?, ram_mb = ?, cpu_cores = ?,
     disk_gb = ?, kvm_enabled = ?, network_enabled = ?, ssh_port = ?,
     updated_at = ? WHERE id = ?`,
    [
      updated.name,
      updated.distro,
      updated.ramMb,
      updated.cpuCores,
      updated.diskGb,
      updated.kvmEnabled ? 1 : 0,
      updated.networkEnabled ? 1 : 0,
      updated.sshPort,
      updated.updatedAt,
      id,
    ],
  );

  return updated;
}

/** Delete a VM config. */
export function deleteVmConfig(id: string): boolean {
  const db = getDb();
  db.execute('DELETE FROM vm_configs WHERE id = ?', [id]);
  return true;
}

/** Get the default VM config (first one, or create a new one). */
export function getOrCreateDefaultVm(): VmConfig {
  const configs = listVmConfigs();
  if (configs.length > 0) {
    return configs[0];
  }
  return createVmConfig({name: 'Sunlight VM'});
}
