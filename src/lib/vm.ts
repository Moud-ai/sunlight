/**
 * Sunlight VM — QEMU (arm64 Alpine guest) lifecycle + serial console bridge.
 *
 * The QEMU emulator binary ships inside the APK's jniLibs (a PIE executable
 * renamed .so so it lands in nativeLibraryDir where execve is allowed).
 * The kernel + initramfs are downloaded at runtime with the resumable
 * downloader (kesha) into filesDir/vm, which is exactly where the native
 * VmModule reads them.
 */
import {NativeModules} from 'react-native';
import * as RNFS from '@dr.pogodin/react-native-fs';
import {startResumableDownload, resumeExistingDownload} from './download';
import type {VmConfig} from './vmConfig';

const VM_DIR = `${RNFS.DocumentDirectoryPath}/vm`;
export const VM_KERNEL_PATH = `${VM_DIR}/vmlinuz-virt`;
export const VM_INITRD_PATH = `${VM_DIR}/initrd-sunlight`;

export const VM_ARTIFACT_BASE =
  'https://github.com/Moud-ai/sunlight-qemu/releases/download/v1';

export interface VmStatus {
  qemuInstalled: boolean;
  kernelInstalled: boolean;
  initrdInstalled: boolean;
  diskExists: boolean;
  running: boolean;
  storageUsed: number;
}

interface SunlightVmNative {
  getVmStatus(): Promise<VmStatus>;
  isQemuInstalled(): Promise<boolean>;
  startVm(
    ramMb: number,
    cpuCores: number,
    diskGb: number,
    kvmEnabled: boolean,
    networkEnabled: boolean,
  ): Promise<boolean>;
  stopVm(): Promise<boolean>;
  isVmRunning(): Promise<boolean>;
  writeConsole(text: string): Promise<boolean>;
  pollConsole(): Promise<string | null>;
  clearConsole(): Promise<boolean>;
  hasDiskImage(): Promise<boolean>;
  getDiskImagePath(): Promise<string>;
  deleteDiskImage(): Promise<boolean>;
  getVmStorageUsed(): Promise<number>;
}

function getVm(): SunlightVmNative {
  const mod = NativeModules.SunlightVm as SunlightVmNative | undefined;
  if (!mod) {
    throw new Error('SunlightVm native module is not available');
  }
  return mod;
}

export async function getVmStatus(): Promise<VmStatus> {
  const status = await getVm().getVmStatus();
  const needsPayload = !status.kernelInstalled || !status.initrdInstalled;
  return {
    ...status,
    qemuInstalled: status.qemuInstalled && !needsPayload,
  };
}

export function isVmPayloadInstalled(status: VmStatus): boolean {
  return status.kernelInstalled && status.initrdInstalled;
}

/** Downloads kernel + initramfs (resumable) into filesDir/vm. */
export async function installVmPayloads(onProgress?: (done: number, total: number) => void): Promise<void> {
  await RNFS.mkdir(VM_DIR);
  const jobs: Array<{id: string; url: string; dest: string}> = [
    {id: 'vm_vmlinuz', url: `${VM_ARTIFACT_BASE}/vmlinuz-virt`, dest: VM_KERNEL_PATH},
    {id: 'vm_initrd', url: `${VM_ARTIFACT_BASE}/initrd-sunlight`, dest: VM_INITRD_PATH},
  ];
  const weights = [10, 36];
  const weightTotal = weights.reduce((a, b) => a + b, 0);
  let overall = 0;

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const weight = weights[i];
    if (await RNFS.exists(job.dest)) {
      overall += weight;
      onProgress?.(overall, weightTotal);
      continue;
    }
    await new Promise<void>((resolve, reject) => {
      const handlers = {
        onProgress: (d: number, t: number) => {
          onProgress?.(Math.round(overall + (d / t) * weight), weightTotal);
        },
        onDone: () => {
          overall += weight;
          onProgress?.(overall, weightTotal);
          resolve();
        },
        onError: (error: string, code: number) => {
          reject(new Error(`vm payload download failed: ${error} (${code})`));
        },
      };
      resumeExistingDownload(job.id, handlers)
        .then(existing => {
          if (existing == null) {
            startResumableDownload({id: job.id, url: job.url, destination: job.dest, ...handlers});
            return;
          }
          if (existing.state === 'DONE') {
            overall += weight;
            onProgress?.(overall, weightTotal);
            resolve();
            return;
          }
          startResumableDownload({id: job.id, url: job.url, destination: job.dest, ...handlers});
        })
        .catch(() => {
          startResumableDownload({id: job.id, url: job.url, destination: job.dest, ...handlers});
        });
    });
  }
}

export async function startVm(config: VmConfig): Promise<boolean> {
  return getVm().startVm(config.ramMb, config.cpuCores, config.diskGb, false, config.networkEnabled);
}

export async function stopVm(): Promise<boolean> {
  return getVm().stopVm();
}

export async function isVmRunning(): Promise<boolean> {
  return getVm().isVmRunning();
}

export async function writeVmConsole(text: string): Promise<boolean> {
  return getVm().writeConsole(text);
}

export async function pollVmConsole(): Promise<string | null> {
  return getVm().pollConsole();
}

export async function clearVmConsole(): Promise<boolean> {
  return getVm().clearConsole();
}

export async function hasDiskImage(): Promise<boolean> {
  return getVm().hasDiskImage();
}

export async function getDiskImagePath(): Promise<string> {
  return getVm().getDiskImagePath();
}

export async function deleteDiskImage(): Promise<boolean> {
  return getVm().deleteDiskImage();
}

export async function getVmStorageUsed(): Promise<number> {
  return getVm().getVmStorageUsed();
}