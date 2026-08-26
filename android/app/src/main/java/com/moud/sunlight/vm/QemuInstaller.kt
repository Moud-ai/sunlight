package com.moud.sunlight.vm

import android.content.Context
import java.io.File
import java.io.InputStream
import java.net.URL

/**
 * Manages downloading and installing QEMU binaries without requiring Termux.
 *
 * Downloads prebuilt QEMU binaries from a configurable URL, extracts them
 * to a writable app directory, and prepares them for execution.
 *
 * This makes the VM feature independent of Termux — users can optionally
 * use Termux for advanced setups, but the basic VM works out of the box.
 */
class QemuInstaller(private val context: Context) {

    companion object {
        // Default URL for prebuilt QEMU binaries (GitHub releases)
        // Users can configure this to use their own mirror
        const val DEFAULT_QEMU_URL = "https://github.com/Moud-ai/sunlight-qemu/releases/latest/download"

        const val BINARY_NAME = "libqemu_system_aarch64.so"
        const val FIRMWARE_NAME = "edk2-aarch64-code.fd"

        private val REQUIRED_LIBS = listOf(
            "libglib-2.0.so",
            "libgobject-2.0.so",
            "libgmodule-2.0.so",
            "libpixman-1.so",
            "libpng16.so",
            "libjpeg.so",
            "libz.so",
            "libfdt.so",
            "libslirp.so",
        )
    }

    private val binDir: File
        get() = File(context.filesDir, "qemu/bin").apply { mkdirs() }

    private val vmDir: File
        get() = File(context.filesDir, "vm").apply { mkdirs() }

    private val firmwareDir: File
        get() = File(context.filesDir, "qemu-libs").apply { mkdirs() }

    /**
     * Check if QEMU binary is already installed.
     */
    fun isInstalled(): Boolean {
        val binary = File(binDir, BINARY_NAME)
        return binary.exists() && binary.canExecute()
    }

    /**
     * Check if firmware is already installed.
     */
    fun isFirmwareInstalled(): Boolean {
        val firmware = File(firmwareDir, FIRMWARE_NAME)
        return firmware.exists()
    }

    /**
     * Get the path to the QEMU binary.
     */
    fun getBinaryPath(): String {
        return File(binDir, BINARY_NAME).absolutePath
    }

    /**
     * Install UEFI firmware from an arbitrary stream (user-provided file,
     * download, etc.) into the writable firmware directory.
     *
     * Use this when the firmware is not bundled in assets.
     */
    fun installFirmware(source: InputStream): Boolean {
        return try {
            val dest = File(firmwareDir, FIRMWARE_NAME)
            source.use { input ->
                dest.outputStream().use { output -> input.copyTo(output) }
            }
            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    /**
     * Install UEFI firmware from a local file path.
     */
    fun installFirmware(path: String): Boolean {
        return try {
            installFirmware(File(path).inputStream())
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    /**
     * Get the path to the firmware file.
     */
    fun getFirmwarePath(): String {
        return File(firmwareDir, FIRMWARE_NAME).absolutePath
    }

    /**
     * Install QEMU binary from assets (if bundled) or download from URL.
     *
     * @param downloadUrl Optional custom URL to download from
     * @param onProgress Progress callback (0-100)
     * @return true if installation succeeded
     */
    fun install(downloadUrl: String? = null, onProgress: ((Int) -> Unit)? = null): Boolean {
        try {
            // Try to copy from assets first (if bundled)
            if (copyFromAssets()) {
                onProgress?.invoke(100)
                return true
            }

            // Download from URL
            val url = downloadUrl ?: DEFAULT_QEMU_URL
            return downloadAndInstall(url, onProgress)
        } catch (e: Exception) {
            e.printStackTrace()
            return false
        }
    }

    /**
     * Copy QEMU binary from assets (if bundled with the app).
     */
    private fun copyFromAssets(): Boolean {
        return try {
            // Copy binary to the writable bin dir (nativeLibraryDir is read-only)
            val binaryDest = File(binDir, BINARY_NAME)
            if (!binaryDest.exists()) {
                context.assets.open("qemu/$BINARY_NAME").use { input ->
                    binaryDest.outputStream().use { output -> input.copyTo(output) }
                }
                binaryDest.setExecutable(true, false)
            }

            // Copy firmware
            val firmwareDest = File(firmwareDir, FIRMWARE_NAME)
            if (!firmwareDest.exists()) {
                context.assets.open("qemu-libs/$FIRMWARE_NAME").use { input ->
                    firmwareDest.outputStream().use { output -> input.copyTo(output) }
                }
            }

            true
        } catch (e: Exception) {
            // Assets not available, need to download
            false
        }
    }

    /**
     * Download and install QEMU from a URL.
     */
    private fun downloadAndInstall(baseUrl: String, onProgress: ((Int) -> Unit)? = null): Boolean {
        try {
            // Download binary
            val binaryUrl = "$baseUrl/$BINARY_NAME"
            val binaryDest = File(vmDir, BINARY_NAME)
            downloadFile(binaryUrl, binaryDest) { progress ->
                onProgress?.invoke(progress / 2) // First half of progress
            }

            // Move binary into the writable bin dir
            val finalBinary = File(binDir, BINARY_NAME)
            binaryDest.copyTo(finalBinary, overwrite = true)
            finalBinary.setExecutable(true, false)
            binaryDest.delete()

            // Download firmware
            val firmwareUrl = "$baseUrl/$FIRMWARE_NAME"
            val firmwareDest = File(firmwareDir, FIRMWARE_NAME)
            downloadFile(firmwareUrl, firmwareDest) { progress ->
                onProgress?.invoke(50 + progress / 2) // Second half of progress
            }

            // Download required libraries
            for (lib in REQUIRED_LIBS) {
                val libUrl = "$baseUrl/$lib"
                val libDest = File(binDir, lib)
                if (!libDest.exists()) {
                    downloadFile(libUrl, libDest) {}
                }
            }

            onProgress?.invoke(100)
            return true
        } catch (e: Exception) {
            e.printStackTrace()
            return false
        }
    }

    /**
     * Download a file from a URL with progress callback.
     */
    private fun downloadFile(urlString: String, dest: File, onProgress: (Int) -> Unit) {
        val url = URL(urlString)
        val connection = url.openConnection()
        connection.connect()

        val totalBytes = connection.contentLength
        val input = connection.getInputStream()
        val output = dest.outputStream()

        val buffer = ByteArray(8192)
        var downloadedBytes = 0
        var lastProgress = 0

        while (true) {
            val bytesRead = input.read(buffer)
            if (bytesRead == -1) break

            output.write(buffer, 0, bytesRead)
            downloadedBytes += bytesRead

            if (totalBytes > 0) {
                val progress = (downloadedBytes * 100) / totalBytes
                if (progress != lastProgress) {
                    onProgress(progress)
                    lastProgress = progress
                }
            }
        }

        output.flush()
        output.close()
        input.close()
    }

    /**
     * Get installation status information.
     */
    fun getStatus(): Map<String, Any> {
        return mapOf(
            "installed" to isInstalled(),
            "firmwareInstalled" to isFirmwareInstalled(),
            "binaryPath" to getBinaryPath(),
            "firmwarePath" to getFirmwarePath(),
            "binDir" to binDir.absolutePath,
            "vmDir" to vmDir.absolutePath,
        )
    }
}
