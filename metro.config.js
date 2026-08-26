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
      // executorch imports its telemetry constants with a RELATIVE specifier
      // ('../constants/resourceFetcher'), so match on the tail and require
      // the origin to live inside the executorch package.
      if (
        typeof moduleName === 'string' &&
        /constants[\\/]resourceFetcher(\.js)?$/.test(moduleName) &&
        (moduleName.startsWith('react-native-executorch') ||
          (context.originModulePath ?? '').includes(
            `${path.sep}react-native-executorch${path.sep}`,
          ))
      ) {
        return {
          filePath: path.join(__dirname, 'shims', 'executorch-resourceFetcher.js'),
          type: 'sourceFile',
        };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
