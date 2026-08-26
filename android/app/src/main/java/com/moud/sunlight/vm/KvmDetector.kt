package com.moud.sunlight.vm

import android.content.Context
import java.io.File

/**
 * Detects whether hardware virtualization (/dev/kvm) is accessible on this
 * device, and whether it would even apply to the selected guest architecture.
 * KVM only accelerates SAME-architecture virtualization — on an ARM64 host,
 * an x86_64 (AMD64) guest can NEVER use KVM regardless of /dev/kvm access;
 * it always runs in software emulation (TCG).
 */
object KvmDetector {

    enum class AccelMode { KVM, TCG }
    enum class GuestArch(val label: String) { ARM64("ARM64"), X86_64("x86_64 (AMD64)") }

    data class AccelResult(
        val mode: AccelMode,
        val reason: String
    )

    fun detect(guestArch: GuestArch = GuestArch.ARM64): AccelResult {
        if (guestArch == GuestArch.X86_64) {
            return AccelResult(
                mode = AccelMode.TCG,
                reason = "x86_64 guest on ARM64 host — KVM cannot accelerate cross-architecture."
            )
        }

        val kvmNode = File("/dev/kvm")

        if (!kvmNode.exists()) {
            return AccelResult(
                mode = AccelMode.TCG,
                reason = "No /dev/kvm on this device. VM will run in software emulation."
            )
        }

        if (!kvmNode.canRead() || !kvmNode.canWrite()) {
            return AccelResult(
                mode = AccelMode.TCG,
                reason = "/dev/kvm exists but no access. Will run in TCG mode."
            )
        }

        return AccelResult(
            mode = AccelMode.KVM,
            reason = "Hardware virtualization available — near native speed."
        )
    }
}
