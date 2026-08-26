package com.moud.sunlight.permissions

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments

/**
 * Comprehensive permissions manager for Sunlight.
 *
 * Handles all runtime permissions including:
 * - Camera, microphone, storage (media)
 * - Notifications (Android 13+)
 * - Battery optimization exemption
 * - Foreground service permissions
 * - Wake lock
 */
class PermissionsModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule() {

    companion object {
        private const val REQUEST_CODE_PERMISSIONS = 1001
        private const val REQUEST_CODE_BATTERY = 1002
        private const val REQUEST_CODE_NOTIFICATION = 1003

        private val REQUIRED_PERMISSIONS = mutableListOf(
            Manifest.permission.INTERNET,
            Manifest.permission.ACCESS_NETWORK_STATE,
            Manifest.permission.ACCESS_WIFI_STATE,
            Manifest.permission.WAKE_LOCK,
            Manifest.permission.VIBRATE,
        ).apply {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                add(Manifest.permission.POST_NOTIFICATIONS)
                add(Manifest.permission.READ_MEDIA_IMAGES)
                add(Manifest.permission.READ_MEDIA_VIDEO)
                add(Manifest.permission.READ_MEDIA_AUDIO)
            } else if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.S_V2) {
                add(Manifest.permission.READ_EXTERNAL_STORAGE)
            }
        }
    }

    override fun getName(): String = "SunlightPermissions"

    /**
     * Check if a specific permission is granted.
     */
    @ReactMethod
    fun checkPermission(permission: String, promise: Promise) {
        try {
            val granted = ContextCompat.checkSelfPermission(reactContext, permission) ==
                PackageManager.PERMISSION_GRANTED
            promise.resolve(granted)
        } catch (e: Exception) {
            promise.reject("PERMISSION_CHECK_FAILED", "Failed to check permission: ${e.message}", e)
        }
    }

    /**
     * Check if all required permissions are granted.
     */
    @ReactMethod
    fun checkAllPermissions(promise: Promise) {
        try {
            val results = Arguments.createMap()
            for (permission in REQUIRED_PERMISSIONS) {
                val granted = ContextCompat.checkSelfPermission(reactContext, permission) ==
                    PackageManager.PERMISSION_GRANTED
                results.putBoolean(permission, granted)
            }
            promise.resolve(results)
        } catch (e: Exception) {
            promise.reject("PERMISSION_CHECK_FAILED", "Failed to check permissions: ${e.message}", e)
        }
    }

    /**
     * Request a specific permission.
     */
    @ReactMethod
    fun requestPermission(permission: String, promise: Promise) {
        try {
            val activity = reactContext.currentActivity
            if (activity == null) {
                promise.reject("NO_ACTIVITY", "No current activity")
                return
            }

            if (ContextCompat.checkSelfPermission(reactContext, permission) ==
                PackageManager.PERMISSION_GRANTED) {
                promise.resolve(true)
                return
            }

            // Store promise for later callback
            pendingPromises[permission] = promise
            ActivityCompat.requestPermissions(activity, arrayOf(permission), REQUEST_CODE_PERMISSIONS)
        } catch (e: Exception) {
            promise.reject("PERMISSION_REQUEST_FAILED", "Failed to request permission: ${e.message}", e)
        }
    }

    /**
     * Request multiple permissions at once.
     */
    @ReactMethod
    fun requestPermissions(permissions: ReadableArray, promise: Promise) {
        try {
            val activity = reactContext.currentActivity
            if (activity == null) {
                promise.reject("NO_ACTIVITY", "No current activity")
                return
            }

            val toRequest = mutableListOf<String>()
            for (i in 0 until permissions.size()) {
                val permission = permissions.getString(i) ?: continue
                if (ContextCompat.checkSelfPermission(reactContext, permission) !=
                    PackageManager.PERMISSION_GRANTED) {
                    toRequest.add(permission)
                }
            }

            if (toRequest.isEmpty()) {
                promise.resolve(true)
                return
            }

            pendingPromises["batch"] = promise
            ActivityCompat.requestPermissions(activity, toRequest.toTypedArray(), REQUEST_CODE_PERMISSIONS)
        } catch (e: Exception) {
            promise.reject("PERMISSION_REQUEST_FAILED", "Failed to request permissions: ${e.message}", e)
        }
    }

    /**
     * Check if battery optimization is disabled for this app.
     */
    @ReactMethod
    fun isBatteryOptimizationDisabled(promise: Promise) {
        try {
            val pm = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            val isIgnoring = pm.isIgnoringBatteryOptimizations(reactContext.packageName)
            promise.resolve(isIgnoring)
        } catch (e: Exception) {
            promise.reject("BATTERY_CHECK_FAILED", "Failed to check battery optimization: ${e.message}", e)
        }
    }

    /**
     * Request battery optimization exemption.
     * Opens system settings for the user to manually disable optimization.
     */
    @ReactMethod
    fun requestBatteryOptimizationExemption(promise: Promise) {
        try {
            val activity = reactContext.currentActivity
            if (activity == null) {
                promise.reject("NO_ACTIVITY", "No current activity")
                return
            }

            val pm = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            if (pm.isIgnoringBatteryOptimizations(reactContext.packageName)) {
                promise.resolve(true)
                return
            }

            // Try to directly request exemption
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:${reactContext.packageName}")
            }
            activity.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            // Fallback: open battery optimization settings
            try {
                val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                reactContext.currentActivity?.startActivity(intent)
                promise.resolve(true)
            } catch (e2: Exception) {
                promise.reject("BATTERY_REQUEST_FAILED", "Failed to request battery exemption: ${e2.message}", e2)
            }
        }
    }

    /**
     * Open app settings page.
     */
    @ReactMethod
    fun openAppSettings() {
        try {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", reactContext.packageName, null)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactContext.startActivity(intent)
        } catch (_: Exception) {}
    }

    /**
     * Open notification settings.
     */
    @ReactMethod
    fun openNotificationSettings() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                    putExtra(Settings.EXTRA_APP_PACKAGE, reactContext.packageName)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(intent)
            } else {
                openAppSettings()
            }
        } catch (_: Exception) {}
    }

    /**
     * Check if the app can draw overlays (for floating windows).
     */
    @ReactMethod
    fun canDrawOverlays(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val canDraw = Settings.canDrawOverlays(reactContext)
                promise.resolve(canDraw)
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("OVERLAY_CHECK_FAILED", "Failed to check overlay permission: ${e.message}", e)
        }
    }

    /**
     * Request overlay permission.
     */
    @ReactMethod
    fun requestOverlayPermission(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                if (Settings.canDrawOverlays(reactContext)) {
                    promise.resolve(true)
                    return
                }
                val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION).apply {
                    data = Uri.parse("package:${reactContext.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(intent)
                promise.resolve(true)
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("OVERLAY_REQUEST_FAILED", "Failed to request overlay permission: ${e.message}", e)
        }
    }

    /**
     * Get comprehensive permission status report.
     */
    @ReactMethod
    fun getPermissionReport(promise: Promise) {
        try {
            val report = Arguments.createMap()

            // Camera
            report.putBoolean("camera", ContextCompat.checkSelfPermission(reactContext, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)

            // Microphone
            report.putBoolean("microphone", ContextCompat.checkSelfPermission(reactContext, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)

            // Notifications
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                report.putBoolean("notifications", ContextCompat.checkSelfPermission(reactContext, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
            } else {
                report.putBoolean("notifications", true)
            }

            // Storage/Media
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                report.putBoolean("images", ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED)
                report.putBoolean("video", ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_MEDIA_VIDEO) == PackageManager.PERMISSION_GRANTED)
                report.putBoolean("audio", ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_MEDIA_AUDIO) == PackageManager.PERMISSION_GRANTED)
            } else {
                report.putBoolean("images", ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED)
                report.putBoolean("video", ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED)
                report.putBoolean("audio", ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED)
            }

            // Battery optimization
            val pm = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            report.putBoolean("batteryOptimizationDisabled", pm.isIgnoringBatteryOptimizations(reactContext.packageName))

            // Network
            report.putBoolean("network", ContextCompat.checkSelfPermission(reactContext, Manifest.permission.INTERNET) == PackageManager.PERMISSION_GRANTED)

            promise.resolve(report)
        } catch (e: Exception) {
            promise.reject("REPORT_FAILED", "Failed to get permission report: ${e.message}", e)
        }
    }

    // Storage for pending permission callbacks
    private val pendingPromises = mutableMapOf<String, Promise>()

    /**
     * Called by the activity when permission results are available.
     */
    fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        if (requestCode == REQUEST_CODE_PERMISSIONS) {
            val allGranted = grantResults.all { it == PackageManager.PERMISSION_GRANTED }

            // Resolve batch promise
            pendingPromises["batch"]?.resolve(allGranted)
            pendingPromises.remove("batch")

            // Resolve individual promises
            for (i in permissions.indices) {
                val permission = permissions[i]
                val granted = grantResults[i] == PackageManager.PERMISSION_GRANTED
                pendingPromises[permission]?.resolve(granted)
                pendingPromises.remove(permission)
            }
        }
    }
}
