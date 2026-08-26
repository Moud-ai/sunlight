/**
 * Enhanced hardware acceleration detection and management for Sunlight.
 *
 * Detects and optimizes for:
 * - Qualcomm Hexagon NPU (HTP) via QNN SDK with INT4/INT8 quantization
 * - MediaTek APU via NeuroPilot with INT8 optimization
 * - GPU via OpenCL (Mali, Adreno) with batch matmul
 * - GPU via Vulkan compute with fused operations
 * - CPU via NEON/SVE SIMD with optimized kernels
 *
 * Provides recommendations for optimal model quantization and backend selection.
 */
#pragma once

#include <jni.h>
#include <string>
#include <vector>
#include <cstdint>

namespace sunlight {

/**
 * Acceleration backend types.
 */
enum class AccelBackend {
    NONE,       // No acceleration (software fallback)
    CPU_NEON,   // ARM NEON SIMD
    CPU_SVE,    // ARM Scalable Vector Extension
    GPU_OPENCL, // OpenCL (Mali, Adreno)
    GPU_VULKAN, // Vulkan compute
    NPU_HTP,    // Qualcomm Hexagon Tensor Processor
    NPU_APU,    // MediaTek APU (NeuroPilot)
};

/**
 * Quantization formats supported by backends.
 */
enum class QuantFormat {
    FP32,
    FP16,
    INT8,
    INT4,
    MIXED,
};

/**
 * Device hardware information.
 */
struct HardwareInfo {
    // CPU
    int cpu_cores;
    bool has_neon;
    bool has_sve;
    int sve_vector_length;
    
    // GPU
    bool has_opencl;
    bool has_vulkan;
    std::string gpu_vendor;
    std::string gpu_name;
    int gpu_compute_units;
    int gpu_max_work_group_size;
    int gpu_memory_mb;
    
    // NPU
    bool has_hexagon_htp;
    bool has_mediatek_apu;
    std::string soc_vendor;
    std::string soc_model;
    int npu_tops;  // Tera Operations Per Second
    
    // Memory
    int64_t total_ram_bytes;
    int64_t available_ram_bytes;
    
    // Performance hints
    bool supports_int4;
    bool supports_int8;
    bool supports_fp16;
    bool supports_batch_matmul;
};

/**
 * Acceleration capabilities for a specific backend.
 */
struct AccelCapabilities {
    AccelBackend backend = AccelBackend::NONE;
    bool available = false;
    std::string name;
    std::string description;
    int max_threads = 0;
    bool supports_fp16 = false;
    bool supports_int8 = false;
    bool supports_int4 = false;
    bool supports_quantized = false;
    bool supports_batch_matmul = false;
    int64_t memory_limit_bytes = 0;
    int estimated_tops = 0;  // Estimated Tera Operations Per Second
    std::string optimal_quant;
};

/**
 * Model optimization recommendation.
 */
struct ModelOptimization {
    std::string recommended_quant = "FP32";
    std::string recommended_backend = "CPU NEON";
    int recommended_batch_size = 1;
    int recommended_context_length = 2048;
    std::string optimization_notes;
};

/**
 * Main acceleration manager class.
 */
class AccelManager {
public:
    static AccelManager& instance();
    
    /**
     * Detect all available hardware acceleration backends.
     */
    void detect();
    
    /**
     * Get detected hardware information.
     */
    const HardwareInfo& getHardwareInfo() const;
    
    /**
     * Get all available acceleration backends.
     */
    std::vector<AccelCapabilities> getAvailableBackends() const;
    
    /**
     * Get the best available backend for a given workload.
     */
    AccelBackend getBestBackend(bool prefer_npu = true, bool prefer_fp16 = true) const;
    
    /**
     * Get capabilities for a specific backend.
     */
    AccelCapabilities getBackendCapabilities(AccelBackend backend) const;
    
    /**
     * Check if a specific backend is available.
     */
    bool isBackendAvailable(AccelBackend backend) const;
    
    /**
     * Get model optimization recommendation.
     */
    ModelOptimization getModelOptimization(
        const std::string& model_type,
        int parameter_count_m,
        int context_length
    ) const;
    
    /**
     * Get human-readable name for a backend.
     */
    static const char* getBackendName(AccelBackend backend);
    
    /**
     * Get human-readable description for a backend.
     */
    static const char* getBackendDescription(AccelBackend backend);
    
    /**
     * Get human-readable name for a quantization format.
     */
    static const char* getQuantFormatName(QuantFormat format);

private:
    AccelManager() = default;
    
    HardwareInfo hw_info_{};
    std::vector<AccelCapabilities> backends_;
    bool detected_ = false;
    
    void detectCPU();
    void detectGPU();
    void detectNPU();
    void detectMemory();
    void detectOpenCL();
    void detectVulkan();
    void detectQualcomm();
    void detectMediaTek();
};

} // namespace sunlight
