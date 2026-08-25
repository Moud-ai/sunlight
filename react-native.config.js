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
