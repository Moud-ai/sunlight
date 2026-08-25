package com.moud.sunlight.terminal

import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.termux.terminal.TerminalSession
import com.termux.terminal.TerminalSessionClient
import com.termux.view.TerminalView
import com.termux.view.TerminalViewClient

/**
 * Native runtime owning the sandbox shell session.
 *
 * The [TerminalSession] is a process-scoped singleton so that navigating away
 * from the terminal screen (detaching the view) keeps the shell running; the
 * next mount re-attaches to the live session. All views currently showing the
 * session are tracked so emulator output can trigger redraws on each of them.
 */
object TerminalRuntime {
    private const val LOG_TAG = "SunlightTerminal"

    @Volatile
    private var session: TerminalSession? = null

    private val views = mutableListOf<TerminalView>()
    private val mainHandler = Handler(Looper.getMainLooper())

    /** Returns the shared shell session, starting `/system/bin/sh -l` lazily. */
    fun getOrCreate(context: Context): TerminalSession {
        session?.let { return it }
        synchronized(this) {
            session?.let { return it }
            val appContext = context.applicationContext
            val cwd = appContext.filesDir.absolutePath
            val env = arrayOf(
                "PATH=/system/bin:/system/xbin",
                "HOME=$cwd",
                "TMPDIR=${appContext.cacheDir.absolutePath}",
                "TERM=xterm-256color",
            )
            val created = TerminalSession(
                "/system/bin/sh",
                cwd,
                arrayOf("-l"),
                env,
                null,
                SessionClient(),
            )
            session = created
            return created
        }
    }

    fun current(): TerminalSession? = session

    fun registerView(view: TerminalView) {
        synchronized(views) {
            if (!views.contains(view)) views.add(view)
        }
    }

    fun unregisterView(view: TerminalView) {
        synchronized(views) { views.remove(view) }
    }

    /** Redraw every attached terminal view. Must be called on the UI thread. */
    fun redrawViews() {
        val snapshot = synchronized(views) { views.toList() }
        for (view in snapshot) view.onScreenUpdated()
    }

    /** Posts a redraw of all views onto the UI thread (safe from any thread). */
    fun postRedraw() {
        mainHandler.post { redrawViews() }
    }

    /**
     * Session-side callbacks: forward emulator output/repaint requests to the
     * attached views.
     */
    private class SessionClient : TerminalSessionClient {
        override fun onTextChanged(changedSession: TerminalSession) = postRedraw()
        override fun onTitleChanged(changedSession: TerminalSession) {}
        override fun onSessionFinished(finishedSession: TerminalSession) {
            Log.i(LOG_TAG, "Shell session finished (pid ${finishedSession.pid})")
        }

        override fun onCopyTextToClipboard(session: TerminalSession, text: String) {}
        override fun onPasteTextFromClipboard(session: TerminalSession) {}
        override fun onBell(session: TerminalSession) {}
        override fun onColorsChanged(session: TerminalSession) = postRedraw()
        override fun onTerminalCursorStateChange(state: Boolean) {}
        override fun getTerminalCursorStyle(): Int = 0

        override fun logError(tag: String, message: String) {
            Log.e(tag, message)
        }

        override fun logWarn(tag: String, message: String) {
            Log.w(tag, message)
        }

        override fun logInfo(tag: String, message: String) {
            Log.i(tag, message)
        }

        override fun logDebug(tag: String, message: String) {
            Log.d(tag, message)
        }

        override fun logVerbose(tag: String, message: String) {
            Log.v(tag, message)
        }
        override fun logStackTraceWithMessage(tag: String, message: String, e: Exception) {
            Log.e(tag, message, e)
        }

        override fun logStackTrace(tag: String, e: Exception) {
            Log.e(tag, "stack trace", e)
        }
    }
}

/**
 * View-side client for [TerminalView]. Keyboard input, gestures and resizing
 * are handled inside TerminalView itself; this only supplies configuration and
 * logging hooks.
 */
private class SunlightTerminalViewClient : TerminalViewClient {
    override fun onScale(scale: Float): Float = 1f
    override fun onSingleTapUp(e: MotionEvent) {}
    override fun shouldBackButtonBeMappedToEscape(): Boolean = false
    override fun shouldEnforceCharBasedInput(): Boolean = true
    override fun shouldUseCtrlSpaceWorkaround(): Boolean = false
    override fun isTerminalViewSelected(): Boolean = true
    override fun copyModeChanged(copyMode: Boolean) {}

    override fun onKeyDown(keyCode: Int, e: KeyEvent, session: TerminalSession?): Boolean = false
    override fun onKeyUp(keyCode: Int, e: KeyEvent): Boolean = false
    override fun onLongPress(event: MotionEvent): Boolean = false

    override fun readControlKey(): Boolean = false
    override fun readAltKey(): Boolean = false
    override fun readShiftKey(): Boolean = false
    override fun readFnKey(): Boolean = false

    override fun onCodePoint(codePoint: Int, ctrlDown: Boolean, session: TerminalSession?): Boolean =
        false

    override fun onEmulatorSet() {}

    override fun logError(tag: String, message: String) {
        Log.e(tag, message)
    }

    override fun logWarn(tag: String, message: String) {
        Log.w(tag, message)
    }

    override fun logInfo(tag: String, message: String) {
        Log.i(tag, message)
    }

    override fun logDebug(tag: String, message: String) {
        Log.d(tag, message)
    }

    override fun logVerbose(tag: String, message: String) {
        Log.v(tag, message)
    }
    override fun logStackTraceWithMessage(tag: String, message: String, e: Exception) {
        Log.e(tag, message, e)
    }

    override fun logStackTrace(tag: String, e: Exception) {
        Log.e(tag, "stack trace", e)
    }
}

/**
 * Legacy ViewManager exposing the Termux [TerminalView] to JS as
 * `requireNativeComponent('SunlightTerminalView')`.
 *
 * Props: none — the session auto-starts on first view creation and survives
 * view detach (owned by [TerminalRuntime]).
 */
class TerminalViewManager : SimpleViewManager<TerminalView>() {
    override fun getName(): String = "SunlightTerminalView"

    override fun createViewInstance(reactContext: ThemedReactContext): TerminalView {
        val view = TerminalView(reactContext, null)
        // Swiss palette: pure black behind the terminal renderer (its default
        // color scheme already uses a black background / light foreground).
        view.setBackgroundColor(Color.BLACK)
        view.isFocusable = true
        view.isFocusableInTouchMode = true
        view.setTerminalViewClient(SunlightTerminalViewClient())

        val session = TerminalRuntime.getOrCreate(reactContext)
        view.attachSession(session)

        view.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(v: View) {
                TerminalRuntime.registerView(view)
                view.requestFocus()
            }

            override fun onViewDetachedFromWindow(v: View) {
                // Keep the shell process alive; just stop redrawing this view.
                TerminalRuntime.unregisterView(view)
            }
        })

        return view
    }
}
