/**
 * JNI bridge for hardware acceleration detection.
 *
 * Exposes the AccelManager to Kotlin/Java via JNI.
 */
#include "accel_manager.h"
#include <jni.h>
#include <android/log.h>

#define LOG_TAG "SunlightAccelJNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)

using namespace sunlight;

extern "C" {

JNIEXPORT void JNICALL
Java_com_moud_sunlight_accel_AccelModule_nativeDetect(JNIEnv* env, jobject thiz) {
    AccelManager::instance().detect();
}

JNIEXPORT jboolean JNICALL
Java_com_moud_sunlight_accel_AccelModule_nativeIsBackendAvailable(JNIEnv* env, jobject thiz, jint backend) {
    return AccelManager::instance().isBackendAvailable(static_cast<AccelBackend>(backend));
}

JNIEXPORT jint JNICALL
Java_com_moud_sunlight_accel_AccelModule_nativeGetBestBackend(JNIEnv* env, jobject thiz, 
                                                               jboolean prefer_npu, jboolean prefer_fp16) {
    return static_cast<jint>(AccelManager::instance().getBestBackend(prefer_npu, prefer_fp16));
}

JNIEXPORT jobject JNICALL
Java_com_moud_sunlight_accel_AccelModule_nativeGetHardwareInfo(JNIEnv* env, jobject thiz) {
    const auto& info = AccelManager::instance().getHardwareInfo();
    
    // Create HardwareInfo Java object
    jclass cls = env->FindClass("com/moud/sunlight/accel/HardwareInfo");
    jmethodID ctor = env->GetMethodID(cls, "<init>", "()V");
    jobject obj = env->NewObject(cls, ctor);
    
    // Set all fields explicitly
    env->SetIntField(obj, env->GetFieldID(cls, "cpuCores", "I"), info.cpu_cores);
    env->SetBooleanField(obj, env->GetFieldID(cls, "hasNeon", "Z"), info.has_neon);
    env->SetBooleanField(obj, env->GetFieldID(cls, "hasSve", "Z"), info.has_sve);
    env->SetIntField(obj, env->GetFieldID(cls, "sveVectorLength", "I"), info.sve_vector_length);
    env->SetBooleanField(obj, env->GetFieldID(cls, "hasOpencl", "Z"), info.has_opencl);
    env->SetBooleanField(obj, env->GetFieldID(cls, "hasVulkan", "Z"), info.has_vulkan);
    env->SetObjectField(obj, env->GetFieldID(cls, "gpuVendor", "Ljava/lang/String;"), 
                        env->NewStringUTF(info.gpu_vendor.c_str()));
    env->SetObjectField(obj, env->GetFieldID(cls, "gpuName", "Ljava/lang/String;"), 
                        env->NewStringUTF(info.gpu_name.c_str()));
    env->SetIntField(obj, env->GetFieldID(cls, "gpuComputeUnits", "I"), info.gpu_compute_units);
    env->SetIntField(obj, env->GetFieldID(cls, "gpuMaxWorkGroupSize", "I"), info.gpu_max_work_group_size);
    env->SetIntField(obj, env->GetFieldID(cls, "gpuMemoryMb", "I"), info.gpu_memory_mb);
    env->SetBooleanField(obj, env->GetFieldID(cls, "hasHexagonHtp", "Z"), info.has_hexagon_htp);
    env->SetBooleanField(obj, env->GetFieldID(cls, "hasMediatekApu", "Z"), info.has_mediatek_apu);
    env->SetObjectField(obj, env->GetFieldID(cls, "socVendor", "Ljava/lang/String;"), 
                        env->NewStringUTF(info.soc_vendor.c_str()));
    env->SetObjectField(obj, env->GetFieldID(cls, "socModel", "Ljava/lang/String;"), 
                        env->NewStringUTF(info.soc_model.c_str()));
    env->SetIntField(obj, env->GetFieldID(cls, "npuTops", "I"), info.npu_tops);
    env->SetLongField(obj, env->GetFieldID(cls, "totalRamBytes", "J"), info.total_ram_bytes);
    env->SetLongField(obj, env->GetFieldID(cls, "availableRamBytes", "J"), info.available_ram_bytes);
    env->SetBooleanField(obj, env->GetFieldID(cls, "supportsInt4", "Z"), info.supports_int4);
    env->SetBooleanField(obj, env->GetFieldID(cls, "supportsInt8", "Z"), info.supports_int8);
    env->SetBooleanField(obj, env->GetFieldID(cls, "supportsFp16", "Z"), info.supports_fp16);
    env->SetBooleanField(obj, env->GetFieldID(cls, "supportsBatchMatmul", "Z"), info.supports_batch_matmul);
    
    return obj;
}

JNIEXPORT jobjectArray JNICALL
Java_com_moud_sunlight_accel_AccelModule_nativeGetAvailableBackends(JNIEnv* env, jobject thiz) {
    const auto& backends = AccelManager::instance().getAvailableBackends();
    
    jclass cls = env->FindClass("com/moud/sunlight/accel/AccelCapabilities");
    jobjectArray array = env->NewObjectArray(backends.size(), cls, nullptr);
    
    for (size_t i = 0; i < backends.size(); i++) {
        const auto& caps = backends[i];
        
        // AllocObject skips Kotlin constructors, so every field declared in
        // AccelCapabilities must be set explicitly or it stays null/garbage.
        jobject obj = env->AllocObject(cls);
        env->SetIntField(obj, env->GetFieldID(cls, "backend", "I"), static_cast<jint>(caps.backend));
        env->SetBooleanField(obj, env->GetFieldID(cls, "available", "Z"), caps.available);
        env->SetObjectField(obj, env->GetFieldID(cls, "name", "Ljava/lang/String;"), 
                            env->NewStringUTF(caps.name.c_str()));
        env->SetObjectField(obj, env->GetFieldID(cls, "description", "Ljava/lang/String;"), 
                            env->NewStringUTF(caps.description.c_str()));
        env->SetIntField(obj, env->GetFieldID(cls, "maxThreads", "I"), caps.max_threads);
        env->SetBooleanField(obj, env->GetFieldID(cls, "supportsFp16", "Z"), caps.supports_fp16);
        env->SetBooleanField(obj, env->GetFieldID(cls, "supportsInt8", "Z"), caps.supports_int8);
        env->SetBooleanField(obj, env->GetFieldID(cls, "supportsInt4", "Z"), caps.supports_int4);
        env->SetBooleanField(obj, env->GetFieldID(cls, "supportsQuantized", "Z"), caps.supports_quantized);
        env->SetBooleanField(obj, env->GetFieldID(cls, "supportsBatchMatmul", "Z"), caps.supports_batch_matmul);
        env->SetLongField(obj, env->GetFieldID(cls, "memoryLimitBytes", "J"), caps.memory_limit_bytes);
        env->SetIntField(obj, env->GetFieldID(cls, "estimatedTops", "I"), caps.estimated_tops);
        env->SetObjectField(obj, env->GetFieldID(cls, "optimalQuant", "Ljava/lang/String;"), 
                            env->NewStringUTF(caps.optimal_quant.c_str()));
        
        env->SetObjectArrayElement(array, i, obj);
    }
    
    return array;
}

JNIEXPORT jstring JNICALL
Java_com_moud_sunlight_accel_AccelModule_nativeGetBackendName(JNIEnv* env, jobject thiz, jint backend) {
    return env->NewStringUTF(AccelManager::getBackendName(static_cast<AccelBackend>(backend)));
}

JNIEXPORT jstring JNICALL
Java_com_moud_sunlight_accel_AccelModule_nativeGetBackendDescription(JNIEnv* env, jobject thiz, jint backend) {
    return env->NewStringUTF(AccelManager::getBackendDescription(static_cast<AccelBackend>(backend)));
}

JNIEXPORT jobject JNICALL
Java_com_moud_sunlight_accel_AccelModule_nativeGetModelOptimization(JNIEnv* env, jobject thiz,
                                                                     jstring model_type,
                                                                     jint parameter_count_m,
                                                                     jint context_length) {
    // Null-safe string extraction
    const char* type_cstr = model_type ? env->GetStringUTFChars(model_type, nullptr) : nullptr;
    std::string type_str = type_cstr ? type_cstr : "";
    if (type_cstr) env->ReleaseStringUTFChars(model_type, type_cstr);

    const ModelOptimization opt = AccelManager::instance().getModelOptimization(
        type_str, parameter_count_m, context_length);

    // Create ModelOptimization Java object; set every field explicitly since
    // AllocObject does not run Kotlin constructors or apply default values.
    jclass cls = env->FindClass("com/moud/sunlight/accel/ModelOptimization");
    jobject obj = env->AllocObject(cls);

    env->SetObjectField(obj, env->GetFieldID(cls, "recommendedQuant", "Ljava/lang/String;"),
                        env->NewStringUTF(opt.recommended_quant.c_str()));
    env->SetObjectField(obj, env->GetFieldID(cls, "recommendedBackend", "Ljava/lang/String;"),
                        env->NewStringUTF(opt.recommended_backend.c_str()));
    env->SetIntField(obj, env->GetFieldID(cls, "recommendedBatchSize", "I"),
                     opt.recommended_batch_size);
    env->SetIntField(obj, env->GetFieldID(cls, "recommendedContextLength", "I"),
                     opt.recommended_context_length);
    env->SetObjectField(obj, env->GetFieldID(cls, "optimizationNotes", "Ljava/lang/String;"),
                        env->NewStringUTF(opt.optimization_notes.c_str()));

    return obj;
}

} // extern "C"
