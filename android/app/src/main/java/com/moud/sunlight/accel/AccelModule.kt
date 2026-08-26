package com.moud.sunlight.accel

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * React Native module for hardware acceleration detection and management.
 *
 * Detects available acceleration backends:
 * - Qualcomm Hexagon NPU (HTP) via QNN SDK with INT4/INT8 quantization
 * - MediaTek APU via NeuroPilot with INT8 optimization
 * - GPU via OpenCL (Mali, Adreno) with batch matmul
 * - GPU via Vulkan compute with fused operations
 * - CPU via NEON/SVE SIMD with optimized kernels
 *
 * Provides recommendations for optimal model quantization and backend selection.
 */
class AccelModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule() {

    companion object {
        init {
            System.loadLibrary("sunlight_accel")
        }
    }

    override fun getName(): String = "SunlightAccel"

    // ── Native methods ──────────────────────────────────────────────────

    private external fun nativeDetect()
    private external fun nativeIsBackendAvailable(backend: Int): Boolean
    private external fun nativeGetBestBackend(preferNpu: Boolean, preferFp16: Boolean): Int
    private external fun nativeGetHardwareInfo(): HardwareInfo
    private external fun nativeGetAvailableBackends(): Array<AccelCapabilities>
    private external fun nativeGetBackendName(backend: Int): String
    private external fun nativeGetBackendDescription(backend: Int): String
    private external fun nativeGetModelOptimization(modelType: String, parameterCountM: Int, contextLength: Int): ModelOptimization

    // ── React Native methods ────────────────────────────────────────────

    /**
     * Detect all available hardware acceleration backends.
     */
    @ReactMethod
    fun detect(promise: Promise) {
        try {
            nativeDetect()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ACCEL_DETECT_FAILED", "Detection failed: ${e.message}", e)
        }
    }

    /**
     * Get detected hardware information.
     */
    @ReactMethod
    fun getHardwareInfo(promise: Promise) {
        try {
            val info = nativeGetHardwareInfo()
            val map = Arguments.createMap().apply {
                // CPU
                putInt("cpuCores", info.cpuCores)
                putBoolean("hasNeon", info.hasNeon)
                putBoolean("hasSve", info.hasSve)
                putInt("sveVectorLength", info.sveVectorLength)
                
                // GPU
                putBoolean("hasOpencl", info.hasOpencl)
                putBoolean("hasVulkan", info.hasVulkan)
                putString("gpuVendor", info.gpuVendor)
                putString("gpuName", info.gpuName)
                putInt("gpuComputeUnits", info.gpuComputeUnits)
                putInt("gpuMaxWorkGroupSize", info.gpuMaxWorkGroupSize)
                putInt("gpuMemoryMb", info.gpuMemoryMb)
                
                // NPU
                putBoolean("hasHexagonHtp", info.hasHexagonHtp)
                putBoolean("hasMediatekApu", info.hasMediatekApu)
                putString("socVendor", info.socVendor)
                putString("socModel", info.socModel)
                putInt("npuTops", info.npuTops)
                
                // Memory
                putDouble("totalRamBytes", info.totalRamBytes.toDouble())
                putDouble("availableRamBytes", info.availableRamBytes.toDouble())
                putDouble("totalRamMb", info.totalRamMb.toDouble())
                putDouble("availableRamMb", info.availableRamMb.toDouble())
                
                // Performance hints
                putBoolean("supportsInt4", info.supportsInt4)
                putBoolean("supportsInt8", info.supportsInt8)
                putBoolean("supportsFp16", info.supportsFp16)
                putBoolean("supportsBatchMatmul", info.supportsBatchMatmul)
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("ACCEL_INFO_FAILED", "Failed to get hardware info: ${e.message}", e)
        }
    }

    /**
     * Get all available acceleration backends.
     */
    @ReactMethod
    fun getAvailableBackends(promise: Promise) {
        try {
            val backends = nativeGetAvailableBackends()
            val array = Arguments.createArray()
            for (caps in backends) {
                val map = Arguments.createMap().apply {
                    putInt("backend", caps.backend)
                    putBoolean("available", caps.available)
                    putString("name", caps.name)
                    putString("description", caps.description)
                    putInt("maxThreads", caps.maxThreads)
                    putBoolean("supportsFp16", caps.supportsFp16)
                    putBoolean("supportsInt8", caps.supportsInt8)
                    putBoolean("supportsInt4", caps.supportsInt4)
                    putBoolean("supportsQuantized", caps.supportsQuantized)
                    putBoolean("supportsBatchMatmul", caps.supportsBatchMatmul)
                    putDouble("memoryLimitBytes", caps.memoryLimitBytes.toDouble())
                    putDouble("memoryLimitMb", caps.memoryLimitMb.toDouble())
                    putInt("estimatedTops", caps.estimatedTops)
                    putString("optimalQuant", caps.optimalQuant)
                }
                array.pushMap(map)
            }
            promise.resolve(array)
        } catch (e: Exception) {
            promise.reject("ACCEL_BACKENDS_FAILED", "Failed to get backends: ${e.message}", e)
        }
    }

    /**
     * Get the best available backend for a given workload.
     */
    @ReactMethod
    fun getBestBackend(preferNpu: Boolean, preferFp16: Boolean, promise: Promise) {
        try {
            val backend = nativeGetBestBackend(preferNpu, preferFp16)
            val map = Arguments.createMap().apply {
                putInt("backend", backend)
                putString("name", nativeGetBackendName(backend))
                putString("description", nativeGetBackendDescription(backend))
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("ACCEL_BEST_FAILED", "Failed to get best backend: ${e.message}", e)
        }
    }

    /**
     * Check if a specific backend is available.
     */
    @ReactMethod
    fun isBackendAvailable(backend: Int, promise: Promise) {
        try {
            val available = nativeIsBackendAvailable(backend)
            promise.resolve(available)
        } catch (e: Exception) {
            promise.reject("ACCEL_CHECK_FAILED", "Failed to check backend: ${e.message}", e)
        }
    }

    /**
     * Get capabilities for a specific backend.
     */
    @ReactMethod
    fun getBackendCapabilities(backend: Int, promise: Promise) {
        try {
            val backends = nativeGetAvailableBackends()
            val caps = backends.find { it.backend == backend }
            if (caps != null) {
                val map = Arguments.createMap().apply {
                    putInt("backend", caps.backend)
                    putBoolean("available", caps.available)
                    putString("name", caps.name)
                    putString("description", caps.description)
                    putInt("maxThreads", caps.maxThreads)
                    putBoolean("supportsFp16", caps.supportsFp16)
                    putBoolean("supportsInt8", caps.supportsInt8)
                    putBoolean("supportsInt4", caps.supportsInt4)
                    putBoolean("supportsQuantized", caps.supportsQuantized)
                    putBoolean("supportsBatchMatmul", caps.supportsBatchMatmul)
                    putDouble("memoryLimitBytes", caps.memoryLimitBytes.toDouble())
                    putDouble("memoryLimitMb", caps.memoryLimitMb.toDouble())
                    putInt("estimatedTops", caps.estimatedTops)
                    putString("optimalQuant", caps.optimalQuant)
                }
                promise.resolve(map)
            } else {
                promise.resolve(null)
            }
        } catch (e: Exception) {
            promise.reject("ACCEL_CAPS_FAILED", "Failed to get capabilities: ${e.message}", e)
        }
    }

    /**
     * Get model optimization recommendation.
     */
    @ReactMethod
    fun getModelOptimization(modelType: String, parameterCountM: Int, contextLength: Int, promise: Promise) {
        try {
            val opt = nativeGetModelOptimization(modelType, parameterCountM, contextLength)
            val map = Arguments.createMap().apply {
                putString("recommendedQuant", opt.recommendedQuant)
                putString("recommendedBackend", opt.recommendedBackend)
                putInt("recommendedBatchSize", opt.recommendedBatchSize)
                putInt("recommendedContextLength", opt.recommendedContextLength)
                putString("optimizationNotes", opt.optimizationNotes)
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("ACCEL_OPT_FAILED", "Failed to get optimization: ${e.message}", e)
        }
    }

    /**
     * Get human-readable name for a backend.
     */
    @ReactMethod
    fun getBackendName(backend: Int, promise: Promise) {
        try {
            val name = nativeGetBackendName(backend)
            promise.resolve(name)
        } catch (e: Exception) {
            promise.reject("ACCEL_NAME_FAILED", "Failed to get name: ${e.message}", e)
        }
    }

    /**
     * Get human-readable description for a backend.
     */
    @ReactMethod
    fun getBackendDescription(backend: Int, promise: Promise) {
        try {
            val desc = nativeGetBackendDescription(backend)
            promise.resolve(desc)
        } catch (e: Exception) {
            promise.reject("ACCEL_DESC_FAILED", "Failed to get description: ${e.message}", e)
        }
    }
}
