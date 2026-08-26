/**
 * @format
 */

// NOTE: no static `import` of ./App here on purpose. Babel hoists ES imports
// above every other statement, which used to evaluate the ENTIRE screen
// graph (and every third-party module it touches) before the error handler
// below existed — any throw there killed the app instantly with no trace.
// CommonJS require() runs in written order, so the handler installs first.

// ── Boot journal ───────────────────────────────────────────────────────
let bootMark = null;
try {
  bootMark = require('./src/lib/bootLog').bootMark;
} catch {
  // Journal unavailable (non-RN env): breadcrumbs become no-ops.
}
if (bootMark) {
  bootMark('run-start');
  bootMark('js-entry');
}

// ── Global fatal-error persistence ─────────────────────────────────────
// Persist the message + stack of any uncaught JS error to AsyncStorage BEFORE
// default handling, so crash reports remain diagnosable without device logs.
// The hook itself is wrapped in try/catch at every level — it must never be
// the thing that crashes the app.
let lastFatalError = null;
try {
  const ErrorUtils = global.ErrorUtils;
  const previousHandler = ErrorUtils?.getGlobalHandler?.();
  if (ErrorUtils?.setGlobalHandler) {
    ErrorUtils.setGlobalHandler((error, isFatal) => {
      lastFatalError = error;
      try {
        const err = error || null;
        const message =
          err && typeof err.message === 'string' ? err.message : String(error);
        if (bootMark) {
          bootMark('fatal', message);
        }
        const payload = JSON.stringify({
          message,
          stack: err && typeof err.stack === 'string' ? err.stack : null,
          isFatal: isFatal === true,
          at: Date.now(),
        });
        // Required lazily so this file stays loadable in every environment;
        // failures (storage full/unavailable) are swallowed below.
        const AsyncStorage =
          require('@react-native-async-storage/async-storage').default;
            AsyncStorage.setItem('@sunlight_last_error', payload).then(
          () => {},
        );
      } catch {
        // Persistence is best-effort only.
      }
      if (typeof previousHandler === 'function') {
        try {
          previousHandler(error, isFatal);
        } catch {
          // A broken previous handler must not mask the original error path.
        }
      }
    });
  }
} catch {
  // ErrorUtils unavailable (non-RN environment): boot normally.
}

// On-device LLM support: initialize react-native-executorch ONCE at app entry,
// BEFORE any useLLM call. Dynamic require inside try/catch: a missing native
// module degrades to a warning instead of crashing boot; remote chat unaffected.
try {
  const { initExecutorch } = require('react-native-executorch');
  const { BareResourceFetcher } = require(
    'react-native-executorch-bare-resource-fetcher',
  );
  initExecutorch({ resourceFetcher: BareResourceFetcher });
  if (bootMark) {
    bootMark('executorch-init');
  }
} catch (e) {
  console.warn('[executorch] init skipped:', e && e.message);
  if (bootMark) {
    bootMark('executorch-skipped', e && e.message);
  }
}

const {AppRegistry} = require('react-native');
const {createElement} = require('react');
const appName = require('./app.json').name;

AppRegistry.registerComponent(appName, () => {
  try {
    const App = require('./App').default;
    const {default: RootBoundary} = require('./src/components/ErrorBoundary');
    // Root render-error shield: a throw anywhere in the tree used to unmount
    // everything and leave the native gray windowBackground with no trace.
    if (bootMark) {
      bootMark('app-required');
    }
    return function Root() {
      return createElement(RootBoundary, null, createElement(App));
    };
  } catch (e) {
    // The screen graph failed to evaluate. Render a minimal diagnostic
    // screen instead of dying silently; the global handler above already
    // persisted the stack.
    console.warn('[boot] App evaluation failed:', e && e.message);
    const {StyleSheet, Text, View} = require('react-native');
    const styles = StyleSheet.create({
      container: {
        alignItems: 'center',
        backgroundColor: '#000000',
        flex: 1,
        justifyContent: 'center',
        padding: 24,
      },
      title: {color: '#ffffff', fontSize: 14, letterSpacing: 4},
      detail: {color: '#888888', fontSize: 11, marginTop: 12, textAlign: 'center'},
    });
    return function BootErrorScreen() {
      return createElement(
        View,
        {style: styles.container},
        createElement(Text, {style: styles.title}, 'SUNLIGHT'),
        createElement(
          Text,
          {style: styles.detail},
          'Startup failed' +
            (lastFatalError && lastFatalError.message
              ? ': ' + lastFatalError.message
              : ''),
        ),
      );
    };
  }
});
