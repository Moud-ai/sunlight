/**
 * Local replacement for react-native-executorch's telemetry constants.
 * The library posts model-download events (bundle id, country code, model
 * name) to Software Mansion's analytics endpoint without user consent,
 * which F-Droid policy forbids. Pointing DOWNLOAD_EVENT_ENDPOINT at an
 * empty URL makes the POST fail and the library swallows the rejection,
 * disabling telemetry without patching node_modules.
 */
export const DOWNLOAD_EVENT_ENDPOINT = '';
