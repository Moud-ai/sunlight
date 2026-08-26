/**
 * React Native CLI configuration.
 *
 * F-Droid policy forbids shipping proprietary binaries. Firebase Cloud
 * Messaging is distributed as closed-source native artifacts from Google's
 * Maven repository, so it must be excluded from F-Droid builds entirely.
 *
 * DEFAULT BEHAVIOR: Firebase native modules are EXCLUDED from autolinking.
 * This is the safe default for F-Droid builds and any build that does not
 * explicitly opt in to push notifications.
 *
 * Internal release builds that need push notifications set the environment
 * variable SUNLIGHT_FIREBASE=1, which re-enables autolinking of:
 *   - @react-native-firebase/app
 *   - @react-native-firebase/messaging
 *
 * The JS layer degrades gracefully without Firebase: every function in
 * src/lib/firebase.ts catches the missing-native-module error and no-ops,
 * so chat, on-device models, BYOK providers and all other features work
 * normally; only push notifications are absent.
 */
const includeFirebase = process.env.SUNLIGHT_FIREBASE === '1';

module.exports = {
  dependencies: {
    /**
     * vision-camera registers a LEGACY package whose createNativeModules runs
     * EAGERLY during ReactInstance creation (bridgeless + turboModuleInterop).
     * Its companion does System.loadLibrary with a re-thrown
     * UnsatisfiedLinkError, and CameraDevicesManager's constructor issues
     * synchronous binder calls (cameraIdList / ProcessCameraProvider.await).
     * Any failure there wedges the single-thread bgExecutor forever: process
     * alive, gray windowBackground, zero logs (Bolts only catches Exception,
     * BridgelessAtomicRef stays 'Creating'). Excluding it removes that whole
     * failure class from cold start; the JS package still resolves and the
     * scan screen degrades to manual-code entry via its own boundary.
     */
    'react-native-vision-camera': {
      platforms: {
        android: null,
        ios: null,
      },
    },
    ...(!includeFirebase
      ? {
          '@react-native-firebase/app': {
            platforms: {
              android: null,
              ios: null,
            },
          },
          '@react-native-firebase/messaging': {
            platforms: {
              android: null,
              ios: null,
            },
          },
        }
      : {}),
  },
};
