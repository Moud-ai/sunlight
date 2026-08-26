/**
 * Hardware acceleration detection and management implementation.
 *
 * Detects Qualcomm Hexagon NPU, MediaTek APU, GPU (OpenCL/Vulkan),
 * and CPU (NEON/SVE) capabilities on Android ARM64 devices.
 *
 * Uses NDK's built-in cpufeatures library for CPU detection.
 */
#include "accel_manager.h"

#include <android/log.h>
#include <cpu-features.h>  // NDK built-in cpufeatures
#include <fstream>
#include <sstream>
#include <cstring>
#include <cstdlib>
#include <cerrno>
#include <climits>
#include <cctype>
#include <algorithm>
#include <dlfcn.h>
#include <sys/system_properties.h>

#define LOG_TAG "SunlightAccel"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace sunlight {

namespace {

/**
 * Parse an integer safely; never throws.
 * Returns |fallback| on empty/invalid/truncated input or range overflow.
 */
int ParseIntSafe(const char* str, int fallback = 0) {
    if (str == nullptr || *str == '\0') return fallback;

    // Skip leading whitespace
    while (*str != '\0' && std::isspace(static_cast<unsigned char>(*str))) str++;
    if (*str == '\0') return fallback;

    errno = 0;
    char* end = nullptr;
    const long value = std::strtol(str, &end, 10);
    if (end == str || errno == ERANGE || errno == EINVAL ||
        value < INT_MIN || value > INT_MAX) {
        return fallback;
    }

    // Reject trailing garbage (allow trailing whitespace only)
    while (*end != '\0' && std::isspace(static_cast<unsigned char>(*end))) end++;
    if (*end != '\0') return fallback;

    return static_cast<int>(value);
}

} // namespace

AccelManager& AccelManager::instance() {
    static AccelManager instance;
    return instance;
}

void AccelManager::detect() {
    if (detected_) return;
    
    LOGI("Starting hardware acceleration detection...");
    
    detectCPU();
    detectGPU();
    detectNPU();
    detectMemory();
    
    // Build capabilities list
    backends_.clear();
    
    // CPU NEON (always available on ARM64)
    if (hw_info_.has_neon) {
        AccelCapabilities caps;
        caps.backend = AccelBackend::CPU_NEON;
        caps.available = true;
        caps.name = "CPU NEON";
        caps.description = "ARM NEON SIMD acceleration";
        caps.max_threads = hw_info_.cpu_cores;
        caps.supports_fp16 = true;
        caps.supports_int8 = true;
        caps.supports_quantized = true;
        caps.supports_batch_matmul = true;
        caps.memory_limit_bytes = hw_info_.total_ram_bytes / 4;
        caps.estimated_tops = hw_info_.cpu_cores * 2;  // ~2 TOPS per core
        caps.optimal_quant = "INT8";
        backends_.push_back(caps);
    }
    
    // CPU SVE
    if (hw_info_.has_sve) {
        AccelCapabilities caps;
        caps.backend = AccelBackend::CPU_SVE;
        caps.available = true;
        caps.name = "CPU SVE";
        caps.description = "ARM Scalable Vector Extension";
        caps.max_threads = hw_info_.cpu_cores;
        caps.supports_fp16 = true;
        caps.supports_int8 = true;
        caps.supports_quantized = true;
        caps.supports_batch_matmul = true;
        caps.memory_limit_bytes = hw_info_.total_ram_bytes / 4;
        caps.estimated_tops = hw_info_.cpu_cores * 4;  // ~4 TOPS per core with SVE
        caps.optimal_quant = "INT8";
        backends_.push_back(caps);
    }
    
    // GPU OpenCL
    if (hw_info_.has_opencl) {
        AccelCapabilities caps;
        caps.backend = AccelBackend::GPU_OPENCL;
        caps.available = true;
        caps.name = "GPU OpenCL";
        caps.description = "GPU acceleration via OpenCL (" + hw_info_.gpu_vendor + ")";
        caps.max_threads = hw_info_.gpu_compute_units * 64;
        caps.supports_fp16 = true;
        caps.supports_int8 = false;
        caps.supports_quantized = false;
        caps.supports_batch_matmul = true;
        caps.memory_limit_bytes = hw_info_.total_ram_bytes / 8;
        caps.estimated_tops = hw_info_.gpu_compute_units * 10;  // ~10 TOPS per CU
        caps.optimal_quant = "FP16";
        backends_.push_back(caps);
    }
    
    // GPU Vulkan
    if (hw_info_.has_vulkan) {
        AccelCapabilities caps;
        caps.backend = AccelBackend::GPU_VULKAN;
        caps.available = true;
        caps.name = "GPU Vulkan";
        caps.description = "GPU acceleration via Vulkan compute";
        caps.max_threads = hw_info_.gpu_compute_units * 64;
        caps.supports_fp16 = true;
        caps.supports_int8 = true;
        caps.supports_quantized = true;
        caps.supports_batch_matmul = true;
        caps.memory_limit_bytes = hw_info_.total_ram_bytes / 8;
        caps.estimated_tops = hw_info_.gpu_compute_units * 15;  // ~15 TOPS per CU
        caps.optimal_quant = "INT8";
        backends_.push_back(caps);
    }
    
    // Qualcomm Hexagon NPU
    if (hw_info_.has_hexagon_htp) {
        AccelCapabilities caps;
        caps.backend = AccelBackend::NPU_HTP;
        caps.available = true;
        caps.name = "Hexagon NPU";
        caps.description = "Qualcomm Hexagon Tensor Processor";
        caps.max_threads = 8;
        caps.supports_fp16 = true;
        caps.supports_int8 = true;
        caps.supports_int4 = true;
        caps.supports_quantized = true;
        caps.supports_batch_matmul = true;
        caps.memory_limit_bytes = 512 * 1024 * 1024;
        caps.estimated_tops = hw_info_.npu_tops > 0 ? hw_info_.npu_tops : 15;  // ~15 TOPS default
        caps.optimal_quant = "INT4";
        backends_.push_back(caps);
    }
    
    // MediaTek APU
    if (hw_info_.has_mediatek_apu) {
        AccelCapabilities caps;
        caps.backend = AccelBackend::NPU_APU;
        caps.available = true;
        caps.name = "MediaTek APU";
        caps.description = "MediaTek NeuroPilot APU";
        caps.max_threads = 4;
        caps.supports_fp16 = true;
        caps.supports_int8 = true;
        caps.supports_quantized = true;
        caps.supports_batch_matmul = true;
        caps.memory_limit_bytes = 256 * 1024 * 1024;
        caps.estimated_tops = hw_info_.npu_tops > 0 ? hw_info_.npu_tops : 8;  // ~8 TOPS default
        caps.optimal_quant = "INT8";
        backends_.push_back(caps);
    }
    
    detected_ = true;
    LOGI("Detection complete. Found %zu acceleration backends.", backends_.size());
}

const HardwareInfo& AccelManager::getHardwareInfo() const {
    return hw_info_;
}

std::vector<AccelCapabilities> AccelManager::getAvailableBackends() const {
    return backends_;
}

AccelBackend AccelManager::getBestBackend(bool prefer_npu, bool prefer_fp16) const {
    if (backends_.empty()) return AccelBackend::NONE;
    
    auto score_backend = [&](const AccelCapabilities& caps) -> int {
        int score = 0;
        
        switch (caps.backend) {
            case AccelBackend::NPU_HTP:    score = 100; break;
            case AccelBackend::NPU_APU:    score = 90;  break;
            case AccelBackend::GPU_VULKAN: score = 80;  break;
            case AccelBackend::GPU_OPENCL: score = 70;  break;
            case AccelBackend::CPU_SVE:    score = 60;  break;
            case AccelBackend::CPU_NEON:   score = 50;  break;
            default: score = 0;
        }
        
        if (prefer_npu && (caps.backend == AccelBackend::NPU_HTP || caps.backend == AccelBackend::NPU_APU)) {
            score += 20;
        }
        if (prefer_fp16 && caps.supports_fp16) score += 10;
        if (caps.supports_quantized) score += 5;
        if (caps.estimated_tops > 0) score += caps.estimated_tops / 10;
        
        return score;
    };
    
    const AccelCapabilities* best = nullptr;
    int best_score = -1;
    
    for (const auto& caps : backends_) {
        if (!caps.available) continue;
        int score = score_backend(caps);
        if (score > best_score) {
            best_score = score;
            best = &caps;
        }
    }
    
    return best ? best->backend : AccelBackend::NONE;
}

AccelCapabilities AccelManager::getBackendCapabilities(AccelBackend backend) const {
    for (const auto& caps : backends_) {
        if (caps.backend == backend) return caps;
    }
    
    AccelCapabilities empty{};
    empty.backend = backend;
    empty.available = false;
    return empty;
}

bool AccelManager::isBackendAvailable(AccelBackend backend) const {
    for (const auto& caps : backends_) {
        if (caps.backend == backend) return caps.available;
    }
    return false;
}

ModelOptimization AccelManager::getModelOptimization(
    const std::string& model_type,
    int parameter_count_m,
    int context_length
) const {
    ModelOptimization opt;
    const bool is_llm = model_type == "llm";
    const bool is_embedding = model_type == "embedding";
    const bool is_vision = model_type == "vision" || model_type == "audio";

    // ── Backend selection ──────────────────────────────────────────────
    // Start from the best detected backend, but demote NPU -> GPU -> CPU
    // when the NPU TOPS budget cannot carry the model (~1 TOPS per 1B params).
    AccelBackend best = getBestBackend(true, true);
    if ((best == AccelBackend::NPU_HTP || best == AccelBackend::NPU_APU) &&
        hw_info_.npu_tops > 0 && parameter_count_m > hw_info_.npu_tops * 1000) {
        LOGW("NPU TOPS (%d) insufficient for %dM params, falling back",
             hw_info_.npu_tops, parameter_count_m);
        if (isBackendAvailable(AccelBackend::GPU_VULKAN)) {
            best = AccelBackend::GPU_VULKAN;
        } else if (isBackendAvailable(AccelBackend::GPU_OPENCL)) {
            best = AccelBackend::GPU_OPENCL;
        } else if (isBackendAvailable(AccelBackend::CPU_SVE)) {
            best = AccelBackend::CPU_SVE;
        } else {
            best = AccelBackend::CPU_NEON;
        }
    }

    const AccelCapabilities caps = getBackendCapabilities(best);
    const bool is_gpu = best == AccelBackend::GPU_OPENCL || best == AccelBackend::GPU_VULKAN;

    // ── Quantization by model size ─────────────────────────────────────
    // >3B -> INT4, 1-3B -> INT4/INT8, <1B -> INT8 (FP16 for vision/audio).
    // Then clamp to what the chosen backend actually supports.
    QuantFormat fmt = QuantFormat::INT8;
    if (parameter_count_m > 3000) {
        fmt = QuantFormat::INT4;
    } else if (parameter_count_m >= 1000) {
        fmt = (best == AccelBackend::NPU_HTP || best == AccelBackend::GPU_VULKAN)
                  ? QuantFormat::INT4 : QuantFormat::INT8;
    } else if (is_vision) {
        fmt = QuantFormat::FP16;  // Preserve accuracy for perception workloads
    }

    if (fmt == QuantFormat::INT4 && !caps.supports_int4) fmt = QuantFormat::INT8;
    if (fmt == QuantFormat::INT8 && !caps.supports_int8) fmt = QuantFormat::FP16;
    if (fmt == QuantFormat::FP16 && !caps.supports_fp16) fmt = is_llm ? QuantFormat::INT8 : QuantFormat::FP32;
    opt.recommended_quant = getQuantFormatName(fmt);

    // ── Batch size by workload ─────────────────────────────────────────
    // LLM decode is latency-bound (batch 1); embedding/vision batch well.
    opt.recommended_batch_size = is_embedding ? 4 : (is_vision ? 2 : 1);
    if (is_gpu) opt.recommended_batch_size *= 2;  // GPUs gain from batching
    opt.recommended_batch_size = std::min(opt.recommended_batch_size, 8);

    // ── Context length ────────────────────────────────────────────────
    // LLMs honor the requested window (capped per backend); other workloads
    // use short fixed-length inputs.
    int ctx_cap;
    if (best == AccelBackend::GPU_OPENCL || best == AccelBackend::GPU_VULKAN) {
        ctx_cap = 8192;
    } else if (best == AccelBackend::NPU_APU) {
        ctx_cap = 2048;
    } else {
        ctx_cap = 4096;
    }
    if (is_llm) {
        opt.recommended_context_length =
            std::min(std::max(context_length, 512), ctx_cap);
    } else {
        opt.recommended_context_length = std::min(context_length <= 0 ? 2048 : context_length,
                                                  std::min(ctx_cap, 2048));
    }

    // ── Rough memory estimate ──────────────────────────────────────────
    // Weights: bytes/param by quant (INT4=0.5, MIXED=1.5, INT8=1, FP16=2,
    // FP32=4). Plus crude activation/KV overhead of ~32KB per context token.
    int bytes_per_param_x2 = 2;  // doubled to stay in integer math
    switch (fmt) {
        case QuantFormat::INT4:  bytes_per_param_x2 = 1; break;
        case QuantFormat::MIXED: bytes_per_param_x2 = 3; break;
        case QuantFormat::INT8:  bytes_per_param_x2 = 2; break;
        case QuantFormat::FP16:  bytes_per_param_x2 = 4; break;
        case QuantFormat::FP32:  bytes_per_param_x2 = 8; break;
    }
    const int64_t weight_bytes =
        static_cast<int64_t>(std::max(parameter_count_m, 0)) * 500000LL * bytes_per_param_x2;
    const int64_t overhead_bytes =
        static_cast<int64_t>(opt.recommended_context_length) * 32768LL;
    const int64_t estimated_memory_mb =
        (weight_bytes + overhead_bytes) / (1024 * 1024);

    // Shrink context if the estimate exceeds the backend memory budget
    if (caps.memory_limit_bytes > 0 &&
        weight_bytes + overhead_bytes > caps.memory_limit_bytes &&
        opt.recommended_context_length > 512) {
        opt.recommended_context_length /= 2;
        opt.optimization_notes = "(context reduced for memory constraints)";
    }

    // ── Summary note ───────────────────────────────────────────────────
    char note[256];
    snprintf(note, sizeof(note), "%s %dM on %s: %s quant, batch %d, ctx %d, ~%lld MB (rough)",
             model_type.c_str(), std::max(parameter_count_m, 0),
             getBackendName(best), opt.recommended_quant.c_str(),
             opt.recommended_batch_size, opt.recommended_context_length,
             static_cast<long long>(estimated_memory_mb));
    if (opt.optimization_notes.empty()) {
        opt.optimization_notes = note;
    } else {
        opt.optimization_notes += std::string(" ") + note;
    }

    opt.recommended_backend = getBackendName(best);

    return opt;
}

const char* AccelManager::getBackendName(AccelBackend backend) {
    switch (backend) {
        case AccelBackend::NONE:       return "None";
        case AccelBackend::CPU_NEON:   return "CPU NEON";
        case AccelBackend::CPU_SVE:    return "CPU SVE";
        case AccelBackend::GPU_OPENCL: return "GPU OpenCL";
        case AccelBackend::GPU_VULKAN: return "GPU Vulkan";
        case AccelBackend::NPU_HTP:    return "Hexagon NPU";
        case AccelBackend::NPU_APU:    return "MediaTek APU";
        default: return "Unknown";
    }
}

const char* AccelManager::getBackendDescription(AccelBackend backend) {
    switch (backend) {
        case AccelBackend::NONE:       return "No acceleration (software fallback)";
        case AccelBackend::CPU_NEON:   return "ARM NEON SIMD instructions for parallel computation";
        case AccelBackend::CPU_SVE:    return "ARM Scalable Vector Extension for advanced SIMD";
        case AccelBackend::GPU_OPENCL: return "GPU acceleration via OpenCL (Mali, Adreno)";
        case AccelBackend::GPU_VULKAN: return "GPU acceleration via Vulkan compute shaders";
        case AccelBackend::NPU_HTP:    return "Qualcomm Hexagon Tensor Processor for AI inference";
        case AccelBackend::NPU_APU:    return "MediaTek APU via NeuroPilot for AI inference";
        default: return "Unknown acceleration backend";
    }
}

const char* AccelManager::getQuantFormatName(QuantFormat format) {
    switch (format) {
        case QuantFormat::FP32:   return "FP32";
        case QuantFormat::FP16:   return "FP16";
        case QuantFormat::INT8:   return "INT8";
        case QuantFormat::INT4:   return "INT4";
        case QuantFormat::MIXED:  return "MIXED";
        default: return "Unknown";
    }
}

// ── Detection implementations ──────────────────────────────────────────

void AccelManager::detectCPU() {
    LOGI("Detecting CPU features...");
    
    // Use NDK's built-in cpufeatures
    AndroidCpuFamily family = android_getCpuFamily();
    uint64_t features = android_getCpuFeatures();
    
    // Get CPU count
    hw_info_.cpu_cores = android_getCpuCount();
    
    // Check NEON (always true on ARM64)
    hw_info_.has_neon = (family == ANDROID_CPU_FAMILY_ARM64) || 
                        (features & ANDROID_CPU_ARM_FEATURE_NEON);
    
    // Check SVE (not directly available via cpufeatures, check /proc/cpuinfo)
    hw_info_.has_sve = false;
    hw_info_.sve_vector_length = 0;
    
    std::ifstream cpuinfo("/proc/cpuinfo");
    std::string line;
    while (std::getline(cpuinfo, line)) {
        if (line.find("sve") != std::string::npos) {
            hw_info_.has_sve = true;
            // Try to get SVE vector length (untrusted input, parse safely)
            if (line.find("sve_length") != std::string::npos) {
                size_t pos = line.find(":");
                if (pos != std::string::npos) {
                    hw_info_.sve_vector_length = ParseIntSafe(line.c_str() + pos + 1);
                }
            }
        }
    }
    
    LOGI("CPU: %d cores, NEON=%d, SVE=%d (VL=%d)", 
         hw_info_.cpu_cores, hw_info_.has_neon, hw_info_.has_sve, hw_info_.sve_vector_length);
}

void AccelManager::detectGPU() {
    LOGI("Detecting GPU features...");
    
    detectOpenCL();
    detectVulkan();
    
    // Detect GPU vendor from system properties
    char soc_vendor[PROP_VALUE_MAX] = {0};
    __system_property_get("ro.hardware.chipname", soc_vendor);
    
    std::string vendor_str(soc_vendor);
    if (vendor_str.find("qualcomm") != std::string::npos || 
        vendor_str.find("sm") != std::string::npos ||
        vendor_str.find("sdm") != std::string::npos ||
        vendor_str.find("snapdragon") != std::string::npos) {
        hw_info_.gpu_vendor = "qualcomm";
        hw_info_.soc_vendor = "qualcomm";
    } else if (vendor_str.find("mediatek") != std::string::npos ||
              vendor_str.find("mt") != std::string::npos ||
              vendor_str.find("dimensity") != std::string::npos) {
        hw_info_.gpu_vendor = "arm";  // Mali
        hw_info_.soc_vendor = "mediatek";
    } else if (vendor_str.find("samsung") != std::string::npos ||
              vendor_str.find("exynos") != std::string::npos) {
        hw_info_.gpu_vendor = "arm";  // Mali
        hw_info_.soc_vendor = "samsung";
    } else {
        // Fallback: check /proc/cpuinfo
        std::ifstream cpuinfo("/proc/cpuinfo");
        std::string line;
        while (std::getline(cpuinfo, line)) {
            if (line.find("Hardware") != std::string::npos) {
                if (line.find("Qualcomm") != std::string::npos) {
                    hw_info_.gpu_vendor = "qualcomm";
                    hw_info_.soc_vendor = "qualcomm";
                } else if (line.find("MediaTek") != std::string::npos) {
                    hw_info_.gpu_vendor = "arm";
                    hw_info_.soc_vendor = "mediatek";
                }
                break;
            }
        }
    }
    
    // Get SoC model
    char soc_model[PROP_VALUE_MAX] = {0};
    __system_property_get("ro.soc.model", soc_model);
    hw_info_.soc_model = soc_model;
    
    LOGI("GPU: vendor=%s, SoC=%s, OpenCL=%d, Vulkan=%d", 
         hw_info_.gpu_vendor.c_str(), hw_info_.soc_model.c_str(), hw_info_.has_opencl, hw_info_.has_vulkan);
}

void AccelManager::detectNPU() {
    LOGI("Detecting NPU features...");
    
    // Detect Qualcomm Hexagon HTP
    if (hw_info_.soc_vendor == "qualcomm") {
        // Check for QNN HTP library
        void* qnn_lib = dlopen("libQnnHtp.so", RTLD_LAZY);
        if (qnn_lib) {
            hw_info_.has_hexagon_htp = true;
            dlclose(qnn_lib);
            LOGI("Detected Qualcomm Hexagon HTP via libQnnHtp.so");
        }
        
        // Alternative: check for Hexagon DSP
        if (!hw_info_.has_hexagon_htp) {
            std::ifstream dsp_file("/sys/kernel/debug/msm_subsys/modem");
            if (dsp_file.good()) {
                hw_info_.has_hexagon_htp = true;
                LOGI("Detected Qualcomm Hexagon HTP via msm_subsys");
            }
        }
        
        // Get NPU TOPS from system property (may be non-numeric garbage)
        char npu_tops[PROP_VALUE_MAX] = {0};
        __system_property_get("ro.hardware.npu_tops", npu_tops);
        hw_info_.npu_tops = ParseIntSafe(npu_tops);
    }
    
    // Detect MediaTek APU
    if (hw_info_.soc_vendor == "mediatek") {
        // Check for NeuroPilot delegate
        void* neuron_lib = dlopen("libneuron_delegate.so", RTLD_LAZY);
        if (neuron_lib) {
            hw_info_.has_mediatek_apu = true;
            dlclose(neuron_lib);
            LOGI("Detected MediaTek NeuroPilot APU via libneuron_delegate.so");
        }
        
        // Alternative: check for MTK APU
        if (!hw_info_.has_mediatek_apu) {
            void* apu_lib = dlopen("libapu.so", RTLD_LAZY);
            if (apu_lib) {
                hw_info_.has_mediatek_apu = true;
                dlclose(apu_lib);
                LOGI("Detected MediaTek APU via libapu.so");
            }
        }
        
        // Get NPU TOPS from system property (may be non-numeric garbage)
        char npu_tops[PROP_VALUE_MAX] = {0};
        __system_property_get("ro.hardware.npu_tops", npu_tops);
        hw_info_.npu_tops = ParseIntSafe(npu_tops);
    }
    
    LOGI("NPU: Hexagon=%d, MediaTek=%d, TOPS=%d", 
         hw_info_.has_hexagon_htp, hw_info_.has_mediatek_apu, hw_info_.npu_tops);
}

void AccelManager::detectMemory() {
    LOGI("Detecting memory...");
    
    std::ifstream meminfo("/proc/meminfo");
    std::string line;
    
    while (std::getline(meminfo, line)) {
        if (line.find("MemTotal:") != std::string::npos) {
            int64_t kb;
            sscanf(line.c_str(), "MemTotal: %lld kB", &kb);
            hw_info_.total_ram_bytes = kb * 1024;
        } else if (line.find("MemAvailable:") != std::string::npos) {
            int64_t kb;
            sscanf(line.c_str(), "MemAvailable: %lld kB", &kb);
            hw_info_.available_ram_bytes = kb * 1024;
        }
    }
    
    LOGI("Memory: total=%lld MB, available=%lld MB", 
         hw_info_.total_ram_bytes / (1024*1024), 
         hw_info_.available_ram_bytes / (1024*1024));
}

void AccelManager::detectOpenCL() {
    void* lib = dlopen("libOpenCL.so", RTLD_LAZY);
    if (lib) {
        hw_info_.has_opencl = true;
        hw_info_.gpu_compute_units = 4;  // Default estimate
        dlclose(lib);
        LOGI("OpenCL available");
    } else {
        hw_info_.has_opencl = false;
        LOGI("OpenCL not available");
    }
}

void AccelManager::detectVulkan() {
    // Check for Vulkan support
    void* vulkan_lib = dlopen("libvulkan.so", RTLD_LAZY);
    if (vulkan_lib) {
        hw_info_.has_vulkan = true;
        dlclose(vulkan_lib);
        LOGI("Vulkan available");
    } else {
        hw_info_.has_vulkan = false;
        LOGI("Vulkan not available");
    }
}

void AccelManager::detectQualcomm() {
    char soc_id[PROP_VALUE_MAX] = {0};
    __system_property_get("ro.soc.id", soc_id);
    LOGI("Qualcomm SoC ID: %s", soc_id);
}

void AccelManager::detectMediaTek() {
    std::ifstream apu_file("/proc/apu_info");
    if (apu_file.good()) {
        std::string line;
        while (std::getline(apu_file, line)) {
            LOGI("MediaTek APU info: %s", line.c_str());
        }
    }
}

} // namespace sunlight
