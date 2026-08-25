package com.moud.sunlight

import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Reads the system's Material You dynamic color palette (Android 12+ / API 31+).
 *
 * On devices running Android 12+, the OS extracts a palette from the user's
 * wallpaper and exposes it as system resource colors. This module reads those
 * colors and returns them to JS so the app can theme itself to match.
 *
 * On older devices every method resolves to null — callers fall back to a
 * static palette.
 */
class DynamicColorModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  override fun getName() = "DynamicColor"

  /**
   * Returns the Material You tonal palette as a JS object, or null when
   * dynamic colors are unavailable (API < 31).
   *
   * Shape: { accent1: {100:'#...', 200:'#...', ...}, accent2, accent3, neutral1, neutral2, neutral3 }
   * Each tonal group has stops 0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000.
   * We read only the stops we actually use in the app (100, 300, 500, 700, 900)
   * to keep the bridge payload small.
   */
  @ReactMethod
  fun getPalette(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      promise.resolve(null)
      return
    }
    try {
      val res = ctx.resources
      val groups = arrayOf("accent1", "accent2", "accent3", "neutral1", "neutral2", "neutral3")
      val stops = intArrayOf(100, 300, 500, 700, 900)
      val result = Arguments.createMap()

      for (group in groups) {
        val groupMap = Arguments.createMap()
        for (stop in stops) {
          val resName = "system_${group}_$stop"
          val resId = res.getIdentifier(resName, "color", "android")
          if (resId != 0) {
            val color = res.getColor(resId, ctx.theme)
            groupMap.putString(stop.toString(), String.format("#%06X", 0xFFFFFF and color))
          }
        }
        result.putMap(group, groupMap)
      }
      promise.resolve(result)
    } catch (e: Exception) {
      promise.resolve(null)
    }
  }
}
