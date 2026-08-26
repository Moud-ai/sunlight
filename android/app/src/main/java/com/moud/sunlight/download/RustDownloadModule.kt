package com.moud.sunlight.download

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * React Native module for chunked downloads using Rust.
 *
 * Features:
 * - Parallel chunk downloads for faster speeds
 * - Resume support for interrupted downloads
 * - Progress tracking with speed and ETA
 * - Pause/cancel support
 */
class RustDownloadModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule() {

    companion object {
        /** False when libsunlight_download.so failed to load; methods then reject gracefully. */
        @Volatile
        var nativeAvailable: Boolean = false
            private set

        init {
            nativeAvailable = try {
                System.loadLibrary("sunlight_download")
                true
            } catch (t: Throwable) {
                android.util.Log.e(
                    "SunlightRustDownload",
                    "libsunlight_download.so unavailable; Rust downloads disabled",
                    t,
                )
                false
            }
        }

        private const val DEFAULT_CHUNK_SIZE = 1024 * 1024L  // 1MB
        private const val DEFAULT_MAX_CONCURRENT = 4
    }

    /** Rejects the promise when the native library is missing instead of crashing. */
    private fun ensureNative(promise: Promise): Boolean {
        if (!Companion.nativeAvailable) {
            promise.reject(
                "NATIVE_UNAVAILABLE",
                "libsunlight_download.so not loaded; Rust download manager is disabled",
            )
            return false
        }
        return true
    }

    override fun getName(): String = "SunlightRustDownload"

    // ── Native methods ──────────────────────────────────────────────────

    private external fun nativeInit(chunkSize: Long, maxConcurrent: Long)
    private external fun nativeStartDownload(url: String, destination: String): String
    private external fun nativeGetProgress(url: String): DownloadProgress?
    private external fun nativeCancelDownload(url: String)
    private external fun nativePauseDownload(url: String)
    private external fun nativeResumeDownload(url: String)
    private external fun nativeGetActiveDownloads(): List<DownloadProgress>

    // ── React Native methods ────────────────────────────────────────────

    /**
     * Initialize the download manager.
     */
    @ReactMethod
    fun init(chunkSize: Long, maxConcurrent: Int, promise: Promise) {
        if (!ensureNative(promise)) return
        try {
            nativeInit(chunkSize, maxConcurrent.toLong())
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("INIT_FAILED", "Failed to init download manager: ${e.message}", e)
        }
    }

    /**
     * Start a chunked download.
     */
    @ReactMethod
    fun startDownload(url: String, destination: String, promise: Promise) {
        if (!ensureNative(promise)) return
        try {
            val id = nativeStartDownload(url, destination)
            promise.resolve(id)
        } catch (e: Exception) {
            promise.reject("DOWNLOAD_FAILED", "Failed to start download: ${e.message}", e)
        }
    }

    /**
     * Get download progress.
     */
    @ReactMethod
    fun getProgress(url: String, promise: Promise) {
        if (!ensureNative(promise)) return
        try {
            val progress = nativeGetProgress(url)
            if (progress != null) {
                val map = Arguments.createMap().apply {
                    putString("url", progress.url)
                    putDouble("totalBytes", progress.totalBytes.toDouble())
                    putDouble("downloadedBytes", progress.downloadedBytes.toDouble())
                    putInt("chunksTotal", progress.chunksTotal)
                    putInt("chunksCompleted", progress.chunksCompleted)
                    putDouble("speedBytesPerSec", progress.speedBytesPerSec.toDouble())
                    putDouble("speedMbps", progress.speedMbps)
                    putDouble("etaSeconds", progress.etaSeconds.toDouble())
                    putInt("progress", progress.progress)
                    putString("status", progress.status.name)
                    putString("error", progress.error)
                }
                promise.resolve(map)
            } else {
                promise.resolve(null)
            }
        } catch (e: Exception) {
            promise.reject("PROGRESS_FAILED", "Failed to get progress: ${e.message}", e)
        }
    }

    /**
     * Cancel a download.
     */
    @ReactMethod
    fun cancelDownload(url: String, promise: Promise) {
        if (!ensureNative(promise)) return
        try {
            nativeCancelDownload(url)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CANCEL_FAILED", "Failed to cancel download: ${e.message}", e)
        }
    }

    /**
     * Pause a download.
     */
    @ReactMethod
    fun pauseDownload(url: String, promise: Promise) {
        if (!ensureNative(promise)) return
        try {
            nativePauseDownload(url)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("PAUSE_FAILED", "Failed to pause download: ${e.message}", e)
        }
    }

    /**
     * Resume a download.
     */
    @ReactMethod
    fun resumeDownload(url: String, promise: Promise) {
        if (!ensureNative(promise)) return
        try {
            nativeResumeDownload(url)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("RESUME_FAILED", "Failed to resume download: ${e.message}", e)
        }
    }

    /**
     * Get all active downloads.
     */
    @ReactMethod
    fun getActiveDownloads(promise: Promise) {
        if (!ensureNative(promise)) return
        try {
            val downloads = nativeGetActiveDownloads()
            val array = Arguments.createArray()
            for (progress in downloads) {
                val map = Arguments.createMap().apply {
                    putString("url", progress.url)
                    putDouble("totalBytes", progress.totalBytes.toDouble())
                    putDouble("downloadedBytes", progress.downloadedBytes.toDouble())
                    putInt("chunksTotal", progress.chunksTotal)
                    putInt("chunksCompleted", progress.chunksCompleted)
                    putDouble("speedBytesPerSec", progress.speedBytesPerSec.toDouble())
                    putDouble("speedMbps", progress.speedMbps)
                    putDouble("etaSeconds", progress.etaSeconds.toDouble())
                    putInt("progress", progress.progress)
                    putString("status", progress.status.name)
                    putString("error", progress.error)
                }
                array.pushMap(map)
            }
            promise.resolve(array)
        } catch (e: Exception) {
            promise.reject("LIST_FAILED", "Failed to get active downloads: ${e.message}", e)
        }
    }
}
