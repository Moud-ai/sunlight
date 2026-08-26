package com.moud.sunlight.vm

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

/**
 * React Native bridge for QEMU virtual machine management.
 *
 * Exposes VM lifecycle operations (start, stop, status), KVM detection,
 * QEMU installation, and image management to the JavaScript layer.
 */
class VmModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule() {

    private var qemuProcess: Process? = null
    private val installer = QemuInstaller(reactContext)

    override fun getName(): String = "SunlightVm"

    // ── KVM Detection ──────────────────────────────────────────────────

    /** Check if KVM hardware acceleration is available. */
    @ReactMethod
    fun isKvmAvailable(promise: Promise) {
        val result = KvmDetector.detect()
        promise.resolve(result.mode == KvmDetector.AccelMode.KVM)
    }

    /** Get detailed KVM status information. */
    @ReactMethod
    fun getKvmStatus(promise: Promise) {
        val result = KvmDetector.detect()
        val map = Arguments.createMap()
        map.putBoolean("available", result.mode == KvmDetector.AccelMode.KVM)
        map.putString("reason", result.reason)
        map.putString("mode", result.mode.name)
        promise.resolve(map)
    }

    // ── QEMU Installation ──────────────────────────────────────────────

    /** Check if QEMU is installed and ready to use. */
    @ReactMethod
    fun isQemuInstalled(promise: Promise) {
        promise.resolve(installer.isInstalled())
    }

    /** Get QEMU installation status. */
    @ReactMethod
    fun getQemuStatus(promise: Promise) {
        val status = installer.getStatus()
        val map = Arguments.createMap()
        for ((key, value) in status) {
            when (value) {
                is Boolean -> map.putBoolean(key, value)
                is String -> map.putString(key, value)
                is Int -> map.putInt(key, value)
                is Double -> map.putDouble(key, value)
                else -> map.putString(key, value.toString())
            }
        }
        promise.resolve(map)
    }

    /** Install QEMU from bundled assets or download from URL. */
    @ReactMethod
    fun installQemu(downloadUrl: String?, promise: Promise) {
        Thread {
            try {
                val success = installer.install(downloadUrl) { progress ->
                    // Progress callback could be sent via event emitter
                    // For now, just complete when done
                }
                if (success) {
                    promise.resolve(true)
                } else {
                    promise.reject("QEMU_INSTALL_FAILED", "Failed to install QEMU")
                }
            } catch (e: Exception) {
                promise.reject("QEMU_INSTALL_FAILED", "QEMU installation failed: ${e.message}", e)
            }
        }.start()
    }

    // ── VM Lifecycle ───────────────────────────────────────────────────

    /** Start a QEMU virtual machine with the given configuration. */
    @ReactMethod
    fun startVm(config: ReadableMap, promise: Promise) {
        try {
            if (qemuProcess?.isAlive == true) {
                promise.reject("VM_RUNNING", "A VM is already running")
                return
            }

            if (!installer.isInstalled()) {
                promise.reject("QEMU_NOT_INSTALLED", "QEMU is not installed. Call installQemu() first.")
                return
            }

            val launcher = QemuLauncher(
                context = reactContext,
                ramMb = if (config.hasKey("ramMb")) config.getInt("ramMb") else 512,
                cpuCores = if (config.hasKey("cpuCores")) config.getInt("cpuCores") else 2,
                diskGb = if (config.hasKey("diskGb")) config.getInt("diskGb") else 4,
                distro = if (config.hasKey("distro")) config.getString("distro") ?: "alpine" else "alpine",
                kvmEnabled = if (config.hasKey("kvmEnabled")) config.getBoolean("kvmEnabled") else true,
                networkEnabled = if (config.hasKey("networkEnabled")) config.getBoolean("networkEnabled") else true,
                sshPort = if (config.hasKey("sshPort")) config.getInt("sshPort") else 2222
            )

            qemuProcess = launcher.start()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("VM_START_FAILED", "Failed to start VM: ${e.message}", e)
        }
    }

    /** Stop the running VM. */
    @ReactMethod
    fun stopVm(promise: Promise) {
        try {
            qemuProcess?.destroy()
            qemuProcess = null
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("VM_STOP_FAILED", "Failed to stop VM: ${e.message}", e)
        }
    }

    /** Check if a VM is currently running. */
    @ReactMethod
    fun isVmRunning(promise: Promise) {
        promise.resolve(qemuProcess?.isAlive == true)
    }

    /** Get the QEMU command that would be used (for debugging). */
    @ReactMethod
    fun getQemuCommand(config: ReadableMap, promise: Promise) {
        try {
            val launcher = QemuLauncher(
                context = reactContext,
                ramMb = if (config.hasKey("ramMb")) config.getInt("ramMb") else 512,
                cpuCores = if (config.hasKey("cpuCores")) config.getInt("cpuCores") else 2,
                diskGb = if (config.hasKey("diskGb")) config.getInt("diskGb") else 4,
                distro = if (config.hasKey("distro")) config.getString("distro") ?: "alpine" else "alpine",
                kvmEnabled = if (config.hasKey("kvmEnabled")) config.getBoolean("kvmEnabled") else true,
                networkEnabled = if (config.hasKey("networkEnabled")) config.getBoolean("networkEnabled") else true,
                sshPort = if (config.hasKey("sshPort")) config.getInt("sshPort") else 2222
            )
            val cmd = launcher.buildCommand()
            promise.resolve(cmd.joinToString(" "))
        } catch (e: Exception) {
            promise.reject("VM_CMD_FAILED", "Failed to build command: ${e.message}", e)
        }
    }

    // ── VM Image Management ────────────────────────────────────────────

    /** Check if a VM disk image exists for the given distro. */
    @ReactMethod
    fun hasDiskImage(distro: String, promise: Promise) {
        val vmDir = java.io.File(reactContext.filesDir, "vm")
        val disk = java.io.File(vmDir, "rootfs.qcow2")
        promise.resolve(disk.exists())
    }

    /** Get the path to the VM disk image. */
    @ReactMethod
    fun getDiskImagePath(distro: String, promise: Promise) {
        val vmDir = java.io.File(reactContext.filesDir, "vm")
        val disk = java.io.File(vmDir, "rootfs.qcow2")
        promise.resolve(disk.absolutePath)
    }

    /** Delete the VM disk image. */
    @ReactMethod
    fun deleteDiskImage(distro: String, promise: Promise) {
        try {
            val vmDir = java.io.File(reactContext.filesDir, "vm")
            val disk = java.io.File(vmDir, "rootfs.qcow2")
            if (disk.exists()) {
                disk.delete()
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("DELETE_FAILED", "Failed to delete disk image: ${e.message}", e)
        }
    }

    /** Get VM directory size in bytes. */
    @ReactMethod
    fun getVmStorageUsed(promise: Promise) {
        try {
            val vmDir = java.io.File(reactContext.filesDir, "vm")
            var totalSize = 0L
            vmDir.listFiles()?.forEach { file ->
                if (file.isFile) totalSize += file.length()
            }
            promise.resolve(totalSize.toDouble())
        } catch (e: Exception) {
            promise.reject("STORAGE_CHECK_FAILED", "Failed to check storage: ${e.message}", e)
        }
    }
}
