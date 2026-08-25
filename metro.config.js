const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration.
 *
 * Custom resolution shims third-party telemetry out of the bundle:
 * react-native-executorch reports model downloads to a Software Mansion
 * analytics endpoint without user consent. F-Droid requires opt-in
 * telemetry only, so its constants module is redirected to a local stub
 * (shims/executorch-resource-fetcher.js) that disables reporting while
 * leaving the library's public API untouched.
 */
const config = {
  resolver: {
    resolveRequest: (context, moduleName, platform) => {
      if (
        typeof moduleName === 'string' &&
        /^react-native-executorch\/lib\/(module|commonjs|typescript)\/constants\/resourceFetcher(\.js)?$/.test(
          moduleName,
        )
      ) {
        return {
          filePath: path.join(__dirname, 'shims', 'executorch-resource-fetcher.js'),
          type: 'sourceFile',
        };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
