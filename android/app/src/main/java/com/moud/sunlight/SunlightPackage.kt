package com.moud.sunlight

import android.view.View
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ReactShadowNode
import com.facebook.react.uimanager.ViewManager
import com.moud.sunlight.terminal.SunlightHarnessModule
import com.moud.sunlight.terminal.SunlightTerminalModule
import com.moud.sunlight.terminal.TerminalViewManager

/** Registers native modules and view managers implemented in-app. */
class SunlightPackage : ReactPackage {
  override fun createNativeModules(
    reactContext: ReactApplicationContext
  ): List<NativeModule> =
      listOf(
          VoiceRecorderModule(reactContext),
              DynamicColorModule(reactContext),
          SunlightTerminalModule(reactContext),
          SunlightHarnessModule(reactContext),
      )

  override fun createViewManagers(
    reactContext: ReactApplicationContext
  ): List<ViewManager<out View, out ReactShadowNode<*>>> = listOf(TerminalViewManager())
}
