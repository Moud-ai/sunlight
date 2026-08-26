package com.moud.sunlight.terminal

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Receives the result broadcast Termux sends to the PendingIntent passed via
 * `com.termux.RUN_COMMAND_PENDING_INTENT` (Termux >= 0.109). The result
 * arrives as a Bundle under the key `result` (TermuxConstants
 * EXTRA_PLUGIN_RESULT_BUNDLE) and is forwarded to JS through
 * [SunlightHarnessModule]. Explicit-component only; never exported.
 */
class TermuxResultReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    val executionId = intent.getIntExtra(EXTRA_EXECUTION_ID, 0)
    val result = intent.getBundleExtra(KEY_RESULT_BUNDLE)
    if (result == null) {
      SunlightHarnessModule.deliverResult(executionId, null, null, 0, -1, null)
      return
    }
    SunlightHarnessModule.deliverResult(
        executionId,
        result.getString(KEY_STDOUT),
        result.getString(KEY_STDERR),
        result.getInt(KEY_EXIT_CODE, 0),
        result.getInt(KEY_ERR, -1),
        result.getString(KEY_ERRMSG),
    )
  }

  companion object {
    const val EXTRA_EXECUTION_ID = "execution_id"
    // TermuxConstants: EXTRA_PLUGIN_RESULT_BUNDLE = "result",
    // bundle keys STDOUT = "stdout", STDERR = "stderr",
    // EXIT_CODE = "exitCode", ERR = "err", ERRMSG = "errmsg".
    const val KEY_RESULT_BUNDLE = "result"
    const val KEY_STDOUT = "stdout"
    const val KEY_STDERR = "stderr"
    const val KEY_EXIT_CODE = "exitCode"
    const val KEY_ERR = "err"
    const val KEY_ERRMSG = "errmsg"
  }
}