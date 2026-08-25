package com.moud.sunlight.terminal

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray

/**
 * Termux bridge (`NativeModules.SunlightHarness` from JS).
 *
 * Lets the app execute commands inside the Termux sandbox via Termux's
 * explicit-intent [RunCommandService] (action `com.termux.RUN_COMMAND`).
 *
 * External prerequisites (user-controlled, not grantable programmatically):
 * - `com.termux.permission.RUN_COMMAND` must be granted to Sunlight.
 * - `allow-external-apps=true` in Termux's `~/.termux/termux.properties`.
 *
 * Output capture is handled on the JS side: executed shell scripts redirect
 * into a file under /sdcard/Download which both apps can reach.
 */
class SunlightHarnessModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SunlightHarness"

  /** True when the Termux app is installed and visible to this app. */
  @ReactMethod
  fun isTermuxInstalled(promise: Promise) {
    try {
      reactContext.packageManager.getPackageInfo(TERMUX_PACKAGE, 0)
      promise.resolve(true)
    } catch (_: PackageManager.NameNotFoundException) {
      promise.resolve(false)
    } catch (e: Exception) {
      promise.reject(E_CHECK_FAILED, "Failed to query $TERMUX_PACKAGE", e)
    }
  }

  /** True when the user granted `com.termux.permission.RUN_COMMAND`. */
  @ReactMethod
  fun hasRunCommandPermission(promise: Promise) {
    try {
      val granted =
          reactContext.checkSelfPermission(RUN_COMMAND_PERMISSION) ==
              PackageManager.PERMISSION_GRANTED
      promise.resolve(granted)
    } catch (e: Exception) {
      promise.reject(E_CHECK_FAILED, "Failed to check RUN_COMMAND permission", e)
    }
  }

  /** Opens this app's system settings page so the user can grant permissions. */
  @ReactMethod
  fun openAppSettings() {
    val intent =
        Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", reactContext.packageName, null),
        )
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    reactContext.startActivity(intent)
  }

  /**
   * Fires a `com.termux.RUN_COMMAND` intent.
   *
   * @param path       absolute binary path inside Termux (e.g. its bash).
   * @param args       command arguments as a JS string array.
   * @param workdir    optional working directory; null omits the extra.
   * @param background true keeps Termux headless; false opens a visible session.
   */
  @ReactMethod
  fun runInTermux(path: String, args: ReadableArray, workdir: String?, background: Boolean, promise: Promise) {
    try {
      val intent = Intent()
      intent.setClassName(TERMUX_PACKAGE, "com.termux.app.RunCommandService")
      intent.setAction("com.termux.RUN_COMMAND")
      intent.putExtra("com.termux.RUN_COMMAND_PATH", path)
      intent.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", readableArrayToStringArray(args))
      if (workdir != null) {
        intent.putExtra("com.termux.RUN_COMMAND_WORKDIR", workdir)
      }
      intent.putExtra("com.termux.RUN_COMMAND_BACKGROUND", background)
      // Termux's RunCommandService promotes itself to foreground; on O+ the
      // start must go through startForegroundService or the system throws.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        reactContext.startForegroundService(intent)
      } else {
        reactContext.startService(intent)
      }
      promise.resolve(null)
    } catch (e: SecurityException) {
      // Missing RUN_COMMAND permission or allow-external-apps disabled.
      promise.reject(E_RUN_DENIED, "RUN_COMMAND rejected by Termux: ${e.message}", e)
    } catch (e: Exception) {
      promise.reject(E_RUN_FAILED, "Could not start Termux RunCommandService: ${e.message}", e)
    }
  }

  private fun readableArrayToStringArray(array: ReadableArray): Array<String> {
    val out = ArrayList<String>(array.size())
    for (i in 0 until array.size()) {
      out.add(array.getString(i) ?: "")
    }
    return out.toArray(arrayOfNulls<String>(out.size)) as Array<String>
  }

  companion object {
    private const val TERMUX_PACKAGE = "com.termux"
    private const val RUN_COMMAND_PERMISSION = "com.termux.permission.RUN_COMMAND"
    private const val E_CHECK_FAILED = "E_HARNESS_CHECK_FAILED"
    private const val E_RUN_DENIED = "E_RUN_COMMAND_DENIED"
    private const val E_RUN_FAILED = "E_RUN_COMMAND_FAILED"
  }
}
