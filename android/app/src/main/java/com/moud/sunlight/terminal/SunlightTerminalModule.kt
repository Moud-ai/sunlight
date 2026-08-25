package com.moud.sunlight.terminal

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Imperative control surface for the sandbox terminal
 * (`NativeModules.SunlightTerminal` from JS).
 *
 * Rendering happens directly in the native TerminalView; this module only
 * exposes programmatic input into the shared shell session.
 */
class SunlightTerminalModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "SunlightTerminal"

    /** Sends [text] to the shell followed by a newline (runs a command line). */
    @ReactMethod
    fun write(text: String) {
        send((text + "\n").toByteArray(Charsets.UTF_8))
    }

    /** Sends [text] verbatim, without appending a newline (escape sequences). */
    @ReactMethod
    fun paste(text: String) {
        send(text.toByteArray(Charsets.UTF_8))
    }

    private fun send(bytes: ByteArray) {
        val session = TerminalRuntime.current()
        if (session != null && !session.isRunning()) return
        session?.write(bytes, 0, bytes.size)
    }
}
