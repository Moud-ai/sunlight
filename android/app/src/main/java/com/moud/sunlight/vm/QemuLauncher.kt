package com.moud.sunlight.vm

import android.content.Context
import java.io.File
import java.io.FileNotFoundException

/**
 * High-performance QEMU launcher for Sunlight VM.
 *
 * Optimizations:
 * - KVM acceleration with host CPU features
 * - virtio-blk with native AIO and cache=none
 * - virtio-net with vhost-net for network performance
 * - Memory ballooning for dynamic RAM allocation
 * - CPU pinning for consistent performance
 * - virtio-fs for host-guest file sharing
 * - virtio-vsock for host-guest communication
 * - Hugepages support for memory-intensive workloads
 */
class QemuLauncher(
    private val context: Context,
    private val ramMb: Int = 512,
    private val cpuCores: Int = 2,
    private val diskGb: Int = 4,
    private val distro: String = "alpine",
    private val kvmEnabled: Boolean = true,
    private val networkEnabled: Boolean = true,
    private val sshPort: Int = 2222,
    private val enableBalloon: Boolean = true,
    private val enableVhostNet: Boolean = true,
    private val enableHugepages: Boolean = false,
    private val enableVirtioFs: Boolean = true,
    private val enableVsock: Boolean = true,
    private val cpuModel: String = "max",
    private val machineType: String = "virt"
) {
    private val nativeLibDir: File
        get() = File(context.applicationInfo.nativeLibraryDir)

    private val binDir: File
        get() = File(context.filesDir, "qemu/bin")

    private val vmDir: File
        get() = File(context.filesDir, "vm").apply { mkdirs() }

    private val sharedDir: File
        get() = File(context.filesDir, "shared").apply { mkdirs() }

    /** Resolves the QEMU binary: installed copy first, bundled fallback second. */
    private fun resolveQemuBinary(): File {
        val installed = File(binDir, QemuInstaller.BINARY_NAME)
        if (installed.exists()) return installed
        // Fall back to a copy packaged inside the APK's native library dir.
        return File(nativeLibDir, QemuInstaller.BINARY_NAME)
    }

    /** Copies the UEFI firmware from assets or an installed copy on first run. */
    private fun ensureFirmwareExtracted(): File {
        val dest = File(vmDir, QemuInstaller.FIRMWARE_NAME)
        if (dest.exists()) return dest

        // Prefer firmware provided via QemuInstaller.installFirmware()/install().
        val installed = File(context.filesDir, "qemu-libs/${QemuInstaller.FIRMWARE_NAME}")
        if (installed.exists()) {
            installed.copyTo(dest, overwrite = true)
            return dest
        }

        try {
            context.assets.open("qemu-libs/${QemuInstaller.FIRMWARE_NAME}").use { input ->
                dest.outputStream().use { output -> input.copyTo(output) }
            }
        } catch (e: FileNotFoundException) {
            throw IllegalStateException(
                "UEFI firmware qemu-libs/${QemuInstaller.FIRMWARE_NAME} is not bundled; " +
                    "provide it in assets or call installFirmware(url)",
                e
            )
        }
        return dest
    }

    fun buildCommand(): List<String> {
        val accel = KvmDetector.detect(KvmDetector.GuestArch.ARM64)
        val qemuBinary = resolveQemuBinary()
        val uefiCode = ensureFirmwareExtracted()
        val disk = File(vmDir, "rootfs.qcow2")
        val seedIso = File(vmDir, "seed.iso")

        val cmd = mutableListOf(
            qemuBinary.absolutePath,
            "-M", "$machineType${if (kvmEnabled && accel.mode == KvmDetector.AccelMode.KVM) ",accel=kvm" else ""}",
            "-cpu", cpuModel,
            "-smp", "$cpuCores,threads=1,sockets=1",
            "-m", "${ramMb}M${if (enableHugepages) ",slots=4,maxmem=${ramMb * 2}M" else ""}",
            "-bios", uefiCode.absolutePath,

            // virtio-blk with performance optimizations
            "-drive", "file=${disk.absolutePath},if=none,id=disk0,format=qcow2,cache=none,aio=native,discard=unmap,detect-zeroes=unmap",
            "-device", "virtio-blk-pci,drive=disk0,scsi=off,config-wce=off",

            // Serial console (headless)
            "-nographic",

            // Disable unnecessary devices for performance
            "-nodefaults",
            "-serial", "mon:stdio",

            // Watchdog for reliability
            "-watchdog", "i6300esb",
            "-watchdog-action", "reset"
        )

        // Network with virtio-net and optional vhost-net
        if (networkEnabled) {
            val netdevOpts = mutableListOf(
                "user,id=net0",
                "hostfwd=tcp:127.0.0.1:$sshPort-:22",
                "hostfwd=tcp:127.0.0.1:8080-:80",
                "hostfwd=tcp:127.0.0.1:8443-:443"
            )
            cmd.add("-netdev")
            cmd.add(netdevOpts.joinToString(","))

            val deviceOpts = mutableListOf("virtio-net-pci,netdev=net0")
            if (enableVhostNet && accel.mode == KvmDetector.AccelMode.KVM) {
                deviceOpts.add("vhost=on")
            }
            cmd.add("-device")
            cmd.add(deviceOpts.joinToString(","))
        }

        // Memory ballooning for dynamic RAM allocation
        if (enableBalloon) {
            cmd.add("-device")
            cmd.add("virtio-balloon-pci")
        }

        // virtio-fs for host-guest file sharing
        if (enableVirtioFs) {
            cmd.add("-device")
            cmd.add("vhost-user-fs-pci,queue-size=1024,chardev=fs0")
            cmd.add("-chardev")
            cmd.add("socket,id=fs0,path=/tmp/vhost-fs.sock")
            cmd.add("-object")
            cmd.add("memory-backend-memfd,id=mem,size=${ramMb}M,share=on")
            cmd.add("-numa")
            cmd.add("node,memdev=mem")
        }

        // virtio-vsock for host-guest communication
        if (enableVsock) {
            cmd.add("-device")
            cmd.add("vhost-vsock-pci,guest-cid=3")
        }

        // Seed ISO for cloud-init
        if (seedIso.exists()) {
            cmd.add("-cdrom")
            cmd.add(seedIso.absolutePath)
        }

        // KVM acceleration
        if (kvmEnabled && accel.mode == KvmDetector.AccelMode.KVM) {
            cmd.add("-enable-kvm")
        }

        // Hugepages support
        if (enableHugepages && accel.mode == KvmDetector.AccelMode.KVM) {
            cmd.add("-mem-path")
            cmd.add("/dev/hugepages")
        }

        return cmd
    }

    /** Launches QEMU with LD_LIBRARY_PATH covering installed and bundled libs. */
    fun start(): Process {
        val cmd = buildCommand()
        return ProcessBuilder(cmd)
            .redirectErrorStream(true)
            .apply {
                // Installed libs first, then any bundled in the APK.
                environment()["LD_LIBRARY_PATH"] =
                    listOf(binDir.absolutePath, nativeLibDir.absolutePath).joinToString(":")
                // Set CPU affinity for better performance
                environment()["QEMU_CPU_AFFINITY"] = "0-${cpuCores - 1}"
            }
            .start()
    }

    /** Get QEMU command as string for debugging. */
    fun getCommandString(): String = buildCommand().joinToString(" ")
}
