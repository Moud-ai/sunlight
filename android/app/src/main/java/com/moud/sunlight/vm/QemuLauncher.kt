package com.moud.sunlight.vm

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile

/**
 * Builds the QEMU command line for the Sunlight VM and owns the running
 * QEMU process. Direct kernel boot (no UEFI firmware), serial console on
 * stdio, SLIRP user networking, sparse raw disk that the guest formats on
 * first boot (no qemu-img, no cloud-init).
 */
class QemuLauncher(
    private val context: Context,
    private val ramMb: Int = 512,
    private val cpuCores: Int = 2,
    private val diskGb: Int = 4,
    private val kvmEnabled: Boolean = false,
    private val networkEnabled: Boolean = true,
    private val sshPort: Int = 2222,
) {
    /** Ensures the sparse disk image exists and is at least [diskGb] GB. */
    fun ensureDisk(): File {
        val disk = VmPaths.disk(context)
        if (!disk.exists()) {
            RandomAccessFile(disk, "rw").use { it.setLength(diskGb * 1024L * 1024 * 1024) }
        }
        return disk
    }

    fun buildCommand(): List<String> {
        val qemu = VmPaths.qemuBinary(context)
        val kernel = VmPaths.kernel(context)
        val initrd = VmPaths.initrd(context)
        val disk = ensureDisk()

        require(kernel.exists()) { "kernel not downloaded: ${kernel.absolutePath}" }
        require(initrd.exists()) { "initrd not downloaded: ${initrd.absolutePath}" }

        val cmd = mutableListOf(
            qemu.absolutePath,
            "-M", "virt",
            "-cpu", "max",
            "-smp", "$cpuCores",
            "-m", "${ramMb}M",
            "-kernel", kernel.absolutePath,
            "-initrd", initrd.absolutePath,
            "-append", "console=ttyAMA0,115200",
            "-drive", "file=${disk.absolutePath},format=raw,if=virtio",
            "-nographic",
            "-monitor", "none",
            "-serial", "stdio",
            "-nodefaults",
        )
        if (networkEnabled) {
            cmd += listOf(
                "-netdev",
                "user,id=n0,hostfwd=tcp:127.0.0.1:$sshPort-:22",
                "-device",
                "virtio-net-pci,netdev=n0",
            )
        }
        return cmd
    }

    /** Starts QEMU as a child process (TCG by default; KVM only if available and requested). */
    fun start(): Process {
        val cmd = buildCommand()
        val builder = ProcessBuilder(cmd)
        builder.redirectErrorStream(true)
        val env = builder.environment()
        val nativeLibDir = context.applicationInfo.nativeLibraryDir
        env["LD_LIBRARY_PATH"] = "$nativeLibDir:${env["LD_LIBRARY_PATH"] ?: ""}"
        return builder.start()
    }

    /** Creates the sparse disk up front so the VM screen can report size used. */
    fun createDiskIfNeeded(): File {
        return ensureDisk()
    }
}