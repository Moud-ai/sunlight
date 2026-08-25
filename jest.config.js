module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['./__mocks__/rn-natives.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|react-native-keychain|react-native-biometrics|react-native-svg|react-native-qrcode-svg|react-native-vision-camera|react-native-nitro-modules|react-native-app-auth|@react-native-async-storage|react-native-screens|react-native-safe-area-context|react-native-gesture-handler|react-native-reanimated|react-native-worklets)/)',
  ],
};
