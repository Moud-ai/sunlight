package com.moud.sunlight.vm

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Sunlight VM lifecycle + serial console bridge.
 *
 * QEMU runs as a child process (the bundled `libqemu-system-aarch64.so` is a
 * PIE executable installed to nativeLibraryDir, which is the only app-owned
 * location whose SELinux label permits execve). The guest's serial console is
 * `-serial stdio`, so process stdout is the VM's console: a reader thread
 * drains it into a capped buffer that JS polls, and JS input is written to
 * process stdin.
 */
class VmModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "SunlightVm"

    private val appContext = reactContext.applicationContext
    private val consoleBuffer = ByteArrayOutputStream()
    private val consoleLock = Any()
    private val maxBuffer = 1 shl 20 // 1 MiB cap, trimmed from the front

    private var qemuProcess: Process? = null
    private var readerThread: Thread? = null
    private val stopping = AtomicBoolean(false)

    private fun drainReader() {
        val input = qemuProcess?.inputStream ?: return
        val buf = ByteArray(8192)
        try {
            while (!stopping.get()) {
                val n = input.read(buf)
                if (n <= 0) break
                synchronized(consoleLock) {
                    consoleBuffer.write(buf, 0, n)
                    if (consoleBuffer.size() > maxBuffer) {
                        val overflow = consoleBuffer.size() - maxBuffer
                        val keep = consoleBuffer.toByteArray()
                        consoleBuffer.reset()
                        consoleBuffer.write(keep, overflow, keep.size - overflow)
                    }
                }
            }
        } catch (_: Exception) {
            // process ended / stream closed
        }
    }

    /** Full status: installed payloads, running state, storage. */
    @ReactMethod
    fun getVmStatus(promise: Promise) {
        try {
            val qemu = VmPaths.qemuBinary(appContext)
            val kernel = VmPaths.kernel(appContext)
            val initrd = VmPaths.initrd(appContext)
            val disk = VmPaths.disk(appContext)
            val map = WritableNativeMap()
            map.putBoolean("qemuInstalled", qemu.exists())
            map.putBoolean("kernelInstalled", kernel.exists())
            map.putBoolean("initrdInstalled", initrd.exists())
            map.putBoolean("diskExists", disk.exists())
            map.putBoolean("running", qemuProcess?.isAlive == true)
            map.putDouble("storageUsed", VmPaths.vmDir(appContext).listFiles()?.sumOf { it.length() }?.toDouble() ?: 0.0)
            map.putString("diskPath", disk.absolutePath)
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("VM_STATUS_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun isQemuInstalled(promise: Promise) {
        promise.resolve(
            VmPaths.qemuBinary(appContext).exists() &&
                VmPaths.kernel(appContext).exists() &&
                VmPaths.initrd(appContext).exists()
        )
    }

    /** Starts the VM. JS must have downloaded kernel + initrd first. */
    @ReactMethod
    fun startVm(ramMb: Int, cpuCores: Int, diskGb: Int, kvmEnabled: Boolean, networkEnabled: Boolean, promise: Promise) {
        try {
            if (qemuProcess?.isAlive == true) {
                promise.reject("VM_RUNNING", "A VM is already running")
                return
            }
            val launcher = QemuLauncher(
                context = appContext,
                ramMb = ramMb,
                cpuCores = cpuCores,
                diskGb = diskGb,
                kvmEnabled = kvmEnabled,
                networkEnabled = networkEnabled,
            )
            stopping.set(false)
            qemuProcess = launcher.start()
            synchronized(consoleLock) { consoleBuffer.reset() }
            readerThread = Thread { drainReader() }.apply {
                name = "sunlight-vm-console"
                isDaemon = true
                start()
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("VM_START_FAILED", "Failed to start VM: ${e.message}", e)
        }
    }

    @ReactMethod
    fun stopVm(promise: Promise) {
        try {
            val proc = qemuProcess
            if (proc == null) {
                promise.resolve(true)
                return
            }
            stopping.set(true)
            try {
                proc.destroy()
            } catch (_: Exception) {}
            // Give it a short grace period, then force-kill.
            val deadline = System.currentTimeMillis() + 3000
            while (proc.isAlive && System.currentTimeMillis() < deadline) {
                Thread.sleep(100)
            }
            if (proc.isAlive) {
                proc.destroyForcibly()
            }
            qemuProcess = null
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("VM_STOP_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun isVmRunning(promise: Promise) {
        promise.resolve(qemuProcess?.isAlive == true)
    }

    /** Sends raw bytes to the guest's serial console. */
    @ReactMethod
    fun writeConsole(text: String, promise: Promise) {
        try {
            val out = qemuProcess?.outputStream
            if (out == null) {
                promise.reject("VM_NOT_RUNNING", "VM is not running")
                return
            }
            out.write(text.toByteArray(Charsets.UTF_8))
            out.flush()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("VM_WRITE_FAILED", e.message, e)
        }
    }

    /** Returns all pending console output since the last poll and clears it. */
    @ReactMethod
    fun pollConsole(promise: Promise) {
        try {
            val bytes = synchronized(consoleLock) {
                if (consoleBuffer.size() == 0) {
                    null
                } else {
                    val b = consoleBuffer.toByteArray()
                    consoleBuffer.reset()
                    b
                }
            }
            promise.resolve(if (bytes == null) null else String(bytes, Charsets.UTF_8))
        } catch (e: Exception) {
            promise.reject("VM_POLL_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun clearConsole(promise: Promise) {
        synchronized(consoleLock) { consoleBuffer.reset() }
        promise.resolve(true)
    }

    @ReactMethod
    fun hasDiskImage(promise: Promise) {
        promise.resolve(VmPaths.disk(appContext).exists())
    }

    @ReactMethod
    fun getDiskImagePath(promise: Promise) {
        promise.resolve(VmPaths.disk(appContext).absolutePath)
    }

    @ReactMethod
    fun deleteDiskImage(promise: Promise) {
        try {
            if (qemuProcess?.isAlive == true) {
                promise.reject("VM_RUNNING", "Stop the VM before deleting the disk")
                return
            }
            val deleted = VmPaths.disk(appContext).delete()
            promise.resolve(deleted)
        } catch (e: Exception) {
            promise.reject("VM_DISK_DELETE_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun getVmStorageUsed(promise: Promise) {
        promise.resolve(
            VmPaths.vmDir(appContext).listFiles()?.sumOf { it.length() }?.toDouble() ?: 0.0
        )
    }
}