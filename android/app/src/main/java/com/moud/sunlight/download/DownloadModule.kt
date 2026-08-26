package com.moud.sunlight.download

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

/**
 * React Native bridge for the download foreground service.
 *
 * Provides methods to start downloads, check progress, and cancel downloads.
 * Downloads run in a foreground service with persistent notifications showing
 * progress.
 */
class DownloadModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule() {

    override fun getName(): String = "SunlightDownload"

    /**
     * Start a file download with foreground service and notification.
     */
    @ReactMethod
    fun download(url: String, destination: String, title: String, promise: Promise) {
        try {
            DownloadService.startDownload(reactContext, url, destination, title)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("DOWNLOAD_START_FAILED", "Failed to start download: ${e.message}", e)
        }
    }

    /**
     * Get the current state of a download.
     */
    @ReactMethod
    fun getDownloadState(url: String, promise: Promise) {
        try {
            val state = DownloadService.getDownloadState(url)
            if (state == null) {
                promise.resolve(null)
                return
            }

            val result = Arguments.createMap().apply {
                putString("url", state.url)
                putString("destination", state.destination)
                putString("title", state.title)
                putInt("progress", state.progress)
                putDouble("totalBytes", state.totalBytes.toDouble())
                putDouble("downloadedBytes", state.downloadedBytes.toDouble())
                putString("status", state.status.name)
                putString("error", state.error)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("DOWNLOAD_STATE_FAILED", "Failed to get download state: ${e.message}", e)
        }
    }

    /**
     * Get all active downloads.
     */
    @ReactMethod
    fun getActiveDownloads(promise: Promise) {
        try {
            val downloads = DownloadService.getAllDownloads()
            val result = Arguments.createArray()
            for ((_, state) in downloads) {
                val map = Arguments.createMap().apply {
                    putString("url", state.url)
                    putString("destination", state.destination)
                    putString("title", state.title)
                    putInt("progress", state.progress)
                    putDouble("totalBytes", state.totalBytes.toDouble())
                    putDouble("downloadedBytes", state.downloadedBytes.toDouble())
                    putString("status", state.status.name)
                    putString("error", state.error)
                }
                result.pushMap(map)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("DOWNLOAD_LIST_FAILED", "Failed to get active downloads: ${e.message}", e)
        }
    }

    /**
     * Check if a download is currently active.
     */
    @ReactMethod
    fun isDownloading(url: String, promise: Promise) {
        try {
            val state = DownloadService.getDownloadState(url)
            promise.resolve(state != null && state.status == DownloadService.DownloadState.Status.DOWNLOADING)
        } catch (e: Exception) {
            promise.reject("DOWNLOAD_CHECK_FAILED", "Failed to check download status: ${e.message}", e)
        }
    }
}
