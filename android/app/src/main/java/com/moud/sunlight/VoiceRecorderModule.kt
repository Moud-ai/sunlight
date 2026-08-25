package com.moud.sunlight

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Process
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Voice recorder for chat audio attachments — raw PCM capture wrapped into a
 * RIFF/WAVE (.wav) file.
 *
 * Classic NativeModule (works under the New Architecture interop layer).
 * Records 16 kHz mono 16-bit PCM from the MIC via AudioRecord on a dedicated
 * reader thread; stop() joins the thread, then writes the captured samples
 * behind a canonical 44-byte RIFF/WAVE header in the app cache directory.
 *
 * WAV (not AAC/M4A) because OpenAI-compatible audio-input APIs (Whisper,
 * Voxtral, GPT-4o-audio) accept wav/mp3 inputs, not MPEG-4/AAC containers.
 *
 * JS owns permission gating (PermissionsAndroid) and duration timing; the
 * native side guarantees start/stop semantics, thread lifecycle and cleanup.
 */
class VoiceRecorderModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  companion object {
    private const val SAMPLE_RATE = 16_000
    private const val CHANNELS = 1
    private const val BITS_PER_SAMPLE = 16

    /** Bytes per sample frame: mono * 16-bit. */
    private const val BYTES_PER_FRAME = CHANNELS * BITS_PER_SAMPLE / 8

    /** Canonical PCM RIFF/WAVE header size in bytes. */
    private const val WAV_HEADER_BYTES = 44

    /** Max time (ms) waited for the reader thread to finish on stop(). */
    private const val JOIN_TIMEOUT_MS = 2_000L
  }

  private var audioRecord: AudioRecord? = null
  private var pcmFile: File? = null
  private var recordThread: Thread? = null

  /** True between a successful start() and stop()/cancel()/error cleanup. */
  private val running = AtomicBoolean(false)

  override fun getName() = "VoiceRecorder"

  @SuppressLint("MissingPermission") // JS gates RECORD_AUDIO before calling start().
  @ReactMethod
  fun start(promise: Promise) {
    if (!running.compareAndSet(false, true)) {
      promise.reject("already_recording", "A recording is already in progress.")
      return
    }
    try {
      val minBuffer = AudioRecord.getMinBufferSize(
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
      )
      if (minBuffer <= 0) {
        throw IllegalStateException("AudioRecord unavailable (minBufferSize=$minBuffer)")
      }

      val dir = File(ctx.cacheDir, "sunlight-voice").apply { mkdirs() }
      val raw = File(dir, "voice-${System.currentTimeMillis()}.pcm")

      val record = AudioRecord(
        MediaRecorder.AudioSource.MIC,
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        minBuffer * 2,
      )
      if (record.state != AudioRecord.STATE_INITIALIZED) {
        record.release()
        throw IllegalStateException("AudioRecord init failed")
      }

      audioRecord = record
      pcmFile = raw
      record.startRecording()

      val out = FileOutputStream(raw)
      val thread = Thread({ readLoop(record, out) }, "sunlight-voice-record")
      recordThread = thread
      thread.start()

      // Resolve with the FINAL .wav path; the raw PCM sidecar only exists
      // while the recording is in flight and is consumed by stop().
      promise.resolve(wavPathFor(raw))
    } catch (e: Exception) {
      cleanup()
      promise.reject("start_failed", e.message ?: "Failed to start recording.", e)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    val raw = pcmFile
    if (!running.get() || audioRecord == null || raw == null) {
      promise.reject("not_recording", "No recording in progress.")
      return
    }
    running.set(false)
    try {
      joinReader()
      releaseAudioRecord()
      val wav = File(wavPathFor(raw))
      val bytes = wrapPcmAsWav(raw, wav)
      raw.delete()
      promise.resolve(
        Arguments.createMap().apply {
          putString("uri", "file://${wav.absolutePath}")
          putDouble("bytes", bytes.toDouble())
        }
      )
    } catch (e: Exception) {
      cleanup()
      promise.reject("stop_failed", e.message ?: "Failed to stop recording.", e)
    }
  }

  @ReactMethod
  fun cancel(promise: Promise) {
    cleanup()
    promise.resolve(true)
  }

  /**
   * Reader-loop body: drains AudioRecord into the raw PCM file until
   * running flips false (or the record/stream dies), converting each short
   * sample to little-endian bytes. Runs off the main thread; closes the
   * output stream on exit so stop() sees a complete file after joining.
   */
  private fun readLoop(record: AudioRecord, out: FileOutputStream) {
    Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
    // ~100 ms of mono 16 kHz audio per read.
    val chunk = ShortArray(SAMPLE_RATE / 10)
    try {
      while (running.get()) {
        val read = record.read(chunk, 0, chunk.size)
        if (read <= 0) {
          break
        }
        val bytes = ByteArray(read * BYTES_PER_FRAME)
        for (i in 0 until read) {
          val sample = chunk[i].toInt()
          bytes[i * 2] = (sample and 0xFF).toByte()
          bytes[i * 2 + 1] = ((sample shr 8) and 0xFF).toByte()
        }
        out.write(bytes)
      }
    } catch (_: Exception) {
      // Stream/device failure: stop() surfaces the outcome via the file state.
    } finally {
      try { out.flush() } catch (_: Exception) {}
      try { out.close() } catch (_: Exception) {}
    }
  }

  /** Stop and release the AudioRecord, tolerating repeated/broken states. */
  private fun releaseAudioRecord() {
    try {
      audioRecord?.let {
        if (it.state == AudioRecord.STATE_INITIALIZED) {
          it.stop()
        }
      }
    } catch (_: Exception) {
    }
    try {
      audioRecord?.release()
    } catch (_: Exception) {
    }
    audioRecord = null
  }

  /** Wait (bounded) for the reader thread to finish, then drop its handle. */
  private fun joinReader() {
    val thread = recordThread
    if (thread != null && thread.isAlive) {
      try {
        thread.join(JOIN_TIMEOUT_MS)
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
      }
    }
    recordThread = null
  }

  /** Full teardown: stop reading, free hardware, delete partial files. */
  private fun cleanup() {
    running.set(false)
    joinReader()
    releaseAudioRecord()
    try {
      pcmFile?.delete()
    } catch (_: Exception) {
    }
    pcmFile = null
  }

  /** Final artifact path for a raw PCM sidecar file (same stem, .wav). */
  private fun wavPathFor(pcm: File): String =
    pcm.absolutePath.substringBeforeLast('.') + ".wav"

  /** Copy `pcm` into `wav` behind a RIFF/WAVE header. Returns bytes written. */
  private fun wrapPcmAsWav(pcm: File, wav: File): Long {
    val dataLen = pcm.length()
    FileInputStream(pcm).use { input ->
      FileOutputStream(wav).use { out ->
        out.write(waveHeader(dataLen))
        val buf = ByteArray(64 * 1024)
        while (true) {
          val n = input.read(buf)
          if (n <= 0) {
            break
          }
          out.write(buf, 0, n)
        }
      }
    }
    return WAV_HEADER_BYTES + dataLen
  }

  /** Build the 44-byte canonical little-endian PCM RIFF/WAVE header. */
  private fun waveHeader(dataLen: Long): ByteArray {
    val byteRate = SAMPLE_RATE * BYTES_PER_FRAME
    val blockAlign = BYTES_PER_FRAME
    val riffSize = 36 + dataLen
    val header = ByteArray(WAV_HEADER_BYTES)
    var pos = 0
    fun put(bytes: ByteArray) {
      bytes.copyInto(header, pos)
      pos += bytes.size
    }
    put("RIFF".toByteArray(Charsets.US_ASCII))
    put(leInt(riffSize.toInt()))
    put("WAVE".toByteArray(Charsets.US_ASCII))
    put("fmt ".toByteArray(Charsets.US_ASCII))
    put(leInt(16))                    // fmt chunk size (PCM)
    put(leShort(1))                   // audio format: PCM (uncompressed)
    put(leShort(CHANNELS))            // mono
    put(leInt(SAMPLE_RATE))           // 16 kHz
    put(leInt(byteRate))              // byte rate: 16000 * 2
    put(leShort(blockAlign))          // block align: 2
    put(leShort(BITS_PER_SAMPLE))     // 16-bit
    put("data".toByteArray(Charsets.US_ASCII))
    put(leInt(dataLen.toInt()))
    return header
  }

  private fun leInt(v: Int): ByteArray = byteArrayOf(
    (v and 0xFF).toByte(),
    ((v shr 8) and 0xFF).toByte(),
    ((v shr 16) and 0xFF).toByte(),
    ((v shr 24) and 0xFF).toByte(),
  )

  private fun leShort(v: Int): ByteArray = byteArrayOf(
    (v and 0xFF).toByte(),
    ((v shr 8) and 0xFF).toByte(),
  )

  override fun invalidate() {
    super.invalidate()
    cleanup()
  }
}
