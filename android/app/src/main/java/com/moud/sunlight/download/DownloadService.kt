package com.moud.sunlight.download

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * Foreground service for downloading files (QEMU images, models, etc.)
 * with persistent notification showing progress.
 *
 * Keeps the device awake during downloads and prevents Android from
 * killing the process in the background.
 */
class DownloadService : Service() {

    companion object {
        const val CHANNEL_ID = "sunlight_downloads"
        const val NOTIFICATION_ID = 1001
        const val EXTRA_URL = "url"
        const val EXTRA_DESTINATION = "destination"
        const val EXTRA_NOTIFICATION_TITLE = "title"

        private val activeDownloads = mutableMapOf<String, DownloadState>()
        private var notificationManager: NotificationManager? = null

        fun startDownload(context: Context, url: String, destination: String, title: String = "Downloading") {
            val intent = Intent(context, DownloadService::class.java).apply {
                putExtra(EXTRA_URL, url)
                putExtra(EXTRA_DESTINATION, destination)
                putExtra(EXTRA_NOTIFICATION_TITLE, title)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun getDownloadState(url: String): DownloadState? = activeDownloads[url]

        fun getAllDownloads(): Map<String, DownloadState> = activeDownloads.toMap()
    }

    data class DownloadState(
        val url: String,
        val destination: String,
        val title: String,
        var progress: Int = 0,
        var totalBytes: Long = 0,
        var downloadedBytes: Long = 0,
        var status: Status = Status.PENDING,
        var error: String? = null
    ) {
        enum class Status { PENDING, DOWNLOADING, COMPLETED, FAILED, CANCELLED }
    }

    inner class LocalBinder : Binder() {
        fun getService(): DownloadService = this@DownloadService
    }

    private val binder = LocalBinder()
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        acquireWakeLock()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val url = intent?.getStringExtra(EXTRA_URL) ?: return START_NOT_STICKY
        val destination = intent.getStringExtra(EXTRA_DESTINATION) ?: return START_NOT_STICKY
        val title = intent.getStringExtra(EXTRA_NOTIFICATION_TITLE) ?: "Downloading"

        val state = DownloadState(url = url, destination = destination, title = title)
        activeDownloads[url] = state

        startForeground(NOTIFICATION_ID, buildNotification(state))

        // Start download in background thread
        Thread {
            executeDownload(state)
        }.start()

        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onDestroy() {
        releaseWakeLock()
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Downloads",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "File download progress"
                setShowBadge(false)
            }
            notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager?.createNotificationChannel(channel)
        }
    }

    private fun acquireWakeLock() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Sunlight:DownloadWakeLock").apply {
            acquire(60 * 60 * 1000L) // 1 hour max
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) it.release()
        }
        wakeLock = null
    }

    private fun buildNotification(state: DownloadState): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        return builder
            .setContentTitle(state.title)
            .setContentText("${state.progress}% — ${formatBytes(state.downloadedBytes)} / ${formatBytes(state.totalBytes)}")
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setOngoing(true)
            .setProgress(100, state.progress, state.totalBytes == 0L)
            .build()
    }

    private fun updateNotification(state: DownloadState) {
        val notification = buildNotification(state)
        notificationManager?.notify(NOTIFICATION_ID, notification)
    }

    private fun executeDownload(state: DownloadState) {
        state.status = DownloadState.Status.DOWNLOADING
        updateNotification(state)

        try {
            val url = java.net.URL(state.url)
            val connection = url.openConnection()
            connection.connect()

            val totalBytes = connection.contentLength.toLong()
            state.totalBytes = totalBytes

            val input = connection.getInputStream()
            val output = java.io.FileOutputStream(state.destination)

            val buffer = ByteArray(8192)
            var downloadedBytes = 0L
            var lastProgressUpdate = 0L

            while (true) {
                val bytesRead = input.read(buffer)
                if (bytesRead == -1) break

                output.write(buffer, 0, bytesRead)
                downloadedBytes += bytesRead
                state.downloadedBytes = downloadedBytes

                if (totalBytes > 0) {
                    state.progress = ((downloadedBytes * 100) / totalBytes).toInt()
                }

                // Update notification every 1% or every 100KB
                val now = System.currentTimeMillis()
                if (state.progress != lastProgressUpdate.toInt() || now - lastProgressUpdate > 1000) {
                    updateNotification(state)
                    lastProgressUpdate = now
                }
            }

            output.flush()
            output.close()
            input.close()

            state.status = DownloadState.Status.COMPLETED
            state.progress = 100
            updateNotification(state)

            // Show completion notification
            showCompletionNotification(state)

        } catch (e: Exception) {
            state.status = DownloadState.Status.FAILED
            state.error = e.message
            updateNotification(state)
            showErrorNotification(state)
        } finally {
            activeDownloads.remove(state.url)
            if (activeDownloads.isEmpty()) {
                stopSelf()
            }
        }
    }

    private fun showCompletionNotification(state: DownloadState) {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        val notification = builder
            .setContentTitle("Download complete")
            .setContentText(state.title)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setAutoCancel(true)
            .build()

        notificationManager?.notify(state.url.hashCode(), notification)
    }

    private fun showErrorNotification(state: DownloadState) {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        val notification = builder
            .setContentTitle("Download failed")
            .setContentText("${state.title}: ${state.error ?: "Unknown error"}")
            .setSmallIcon(android.R.drawable.stat_notify_error)
            .setAutoCancel(true)
            .build()

        notificationManager?.notify(state.url.hashCode(), notification)
    }

    private fun formatBytes(bytes: Long): String {
        return when {
            bytes < 1024 -> "$bytes B"
            bytes < 1024 * 1024 -> "${bytes / 1024} KB"
            bytes < 1024 * 1024 * 1024 -> "${bytes / (1024 * 1024)} MB"
            else -> "${bytes / (1024 * 1024 * 1024)} GB"
        }
    }
}
