package com.moud.sunlight.download

/**
 * Download progress information from Rust.
 */
data class DownloadProgress(
    val url: String = "",
    val totalBytes: Long = 0,
    val downloadedBytes: Long = 0,
    val chunksTotal: Int = 0,
    val chunksCompleted: Int = 0,
    val speedBytesPerSec: Long = 0,
    val etaSeconds: Long = 0,
    val statusCode: Int = 0,
    val error: String? = null
) {
    val progress: Int
        get() = if (totalBytes > 0) ((downloadedBytes * 100) / totalBytes).toInt() else 0

    val speedMbps: Double
        get() = speedBytesPerSec.toDouble() / (1024 * 1024)

    val status: DownloadStatus
        get() = when (statusCode) {
            0 -> DownloadStatus.PENDING
            1 -> DownloadStatus.DOWNLOADING
            2 -> DownloadStatus.PAUSED
            3 -> DownloadStatus.COMPLETED
            4 -> DownloadStatus.FAILED
            5 -> DownloadStatus.CANCELLED
            else -> DownloadStatus.PENDING
        }
}

enum class DownloadStatus {
    PENDING, DOWNLOADING, PAUSED, COMPLETED, FAILED, CANCELLED
}
