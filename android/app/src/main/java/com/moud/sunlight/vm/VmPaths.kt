package com.moud.sunlight.vm

import android.content.Context
import java.io.File

/**
 * Locates QEMU payloads. The QEMU emulator is a PIE executable shipped as a
 * `.so` inside jniLibs so Android extracts it into nativeLibraryDir, whose
 * SELinux label (`exec_type`) is the only app-writable location that allows
 * execve. The kernel + initrd are downloaded at runtime into filesDir.
 */
object VmPaths {
    /** Executable QEMU binary (bundled in the APK's jniLibs). */
    fun qemuBinary(context: Context): File =
        File(context.applicationInfo.nativeLibraryDir, "libqemu-system-aarch64.so")

    fun vmDir(context: Context): File =
        File(context.filesDir, "vm").apply { mkdirs() }

    fun kernel(context: Context): File = File(vmDir(context), "vmlinuz-virt")
    fun initrd(context: Context): File = File(vmDir(context), "initrd-sunlight")
    fun disk(context: Context): File = File(vmDir(context), "disk.img")
}