package com.moud.sunlight.accel

/**
 * Hardware information detected from the device.
 */
data class HardwareInfo(
    // CPU
    val cpuCores: Int = 0,
    val hasNeon: Boolean = false,
    val hasSve: Boolean = false,
    val sveVectorLength: Int = 0,
    
    // GPU
    val hasOpencl: Boolean = false,
    val hasVulkan: Boolean = false,
    val gpuVendor: String = "unknown",
    val gpuName: String = "",
    val gpuComputeUnits: Int = 0,
    val gpuMaxWorkGroupSize: Int = 0,
    val gpuMemoryMb: Int = 0,
    
    // NPU
    val hasHexagonHtp: Boolean = false,
    val hasMediatekApu: Boolean = false,
    val socVendor: String = "unknown",
    val socModel: String = "",
    val npuTops: Int = 0,
    
    // Memory
    val totalRamBytes: Long = 0,
    val availableRamBytes: Long = 0,
    
    // Performance hints
    val supportsInt4: Boolean = false,
    val supportsInt8: Boolean = false,
    val supportsFp16: Boolean = false,
    val supportsBatchMatmul: Boolean = false
) {
    val totalRamMb: Long get() = totalRamBytes / (1024 * 1024)
    val availableRamMb: Long get() = availableRamBytes / (1024 * 1024)
}

/**
 * Capabilities of a specific acceleration backend.
 */
data class AccelCapabilities(
    val backend: Int = 0,
    val available: Boolean = false,
    val name: String = "",
    val description: String = "",
    val maxThreads: Int = 0,
    val supportsFp16: Boolean = false,
    val supportsInt8: Boolean = false,
    val supportsInt4: Boolean = false,
    val supportsQuantized: Boolean = false,
    val supportsBatchMatmul: Boolean = false,
    val memoryLimitBytes: Long = 0,
    val estimatedTops: Int = 0,
    val optimalQuant: String = "FP32"
) {
    val memoryLimitMb: Long get() = memoryLimitBytes / (1024 * 1024)
}

/**
 * Model optimization recommendation.
 */
data class ModelOptimization(
    val recommendedQuant: String = "FP32",
    val recommendedBackend: String = "CPU_NEON",
    val recommendedBatchSize: Int = 1,
    val recommendedContextLength: Int = 2048,
    val optimizationNotes: String = ""
)

/**
 * Backend type constants.
 */
object AccelBackend {
    const val NONE = 0
    const val CPU_NEON = 1
    const val CPU_SVE = 2
    const val GPU_OPENCL = 3
    const val GPU_VULKAN = 4
    const val NPU_HTP = 5
    const val NPU_APU = 6
}

/**
 * Quantization format constants.
 */
object QuantFormat {
    const val FP32 = "FP32"
    const val FP16 = "FP16"
    const val INT8 = "INT8"
    const val INT4 = "INT4"
    const val MIXED = "MIXED"
}
