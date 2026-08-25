/**
 * @format
 */

import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

// ── Global fatal-error persistence ─────────────────────────────────────
// Persist the message + stack of any uncaught JS error to AsyncStorage BEFORE
// default handling, so crash reports remain diagnosable without device logs.
// The hook itself is wrapped in try/catch at every level — it must never be
// the thing that crashes the app.
try {
  const ErrorUtils = global.ErrorUtils;
  const previousHandler = ErrorUtils?.getGlobalHandler?.();
  if (ErrorUtils?.setGlobalHandler) {
    ErrorUtils.setGlobalHandler((error, isFatal) => {
      try {
        const err = error || null;
        const payload = JSON.stringify({
          message:
            err && typeof err.message === 'string' ? err.message : String(error),
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
// BEFORE any useLLM call. Uses dynamic require inside try/catch so a missing
// native module (e.g. under jest/unit tests or an outdated binary) degrades to
// a warning instead of crashing boot; remote (network) chat is unaffected.
try {
  const { initExecutorch } = require('react-native-executorch');
  const { BareResourceFetcher } = require(
    'react-native-executorch-bare-resource-fetcher',
  );
  initExecutorch({ resourceFetcher: BareResourceFetcher });
} catch (e) {
  console.warn('[executorch] init skipped:', e && e.message);
}

AppRegistry.registerComponent(appName, () => App);
