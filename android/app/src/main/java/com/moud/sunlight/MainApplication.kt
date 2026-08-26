package com.moud.sunlight

import android.app.Application
import com.google.android.material.color.DynamicColors
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import java.io.File

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
              // In-app native modules (not autolinked).
              add(SunlightPackage())
        },
    )
  }

  /**
   * Plain-file native breadcrumb. If JS never boots on some device, this file
   * still proves how far native startup reached (survives restarts; inspect
   * with `adb shell run-as com.moud.sunlight cat files/native_boot.txt`).
   */
  private fun nativeMark(stage: String) {
    try {
      File(filesDir, "native_boot.txt")
        .appendText("$stage@${System.currentTimeMillis()}\n")
    } catch (_: Throwable) {
      // Never let diagnostics break startup.
    }
  }

  override fun onCreate() {
    super.onCreate()
    nativeMark("application-onCreate")
    DynamicColors.applyToActivitiesIfAvailable(this)
    nativeMark("dynamic-colors-done")
    loadReactNative(this)
    nativeMark("react-native-loaded")
  }
}
