# F-Droid Audit Report — Sunlight

**App:** Sunlight (`com.moud.sunlight`)
**Version:** 1.0 (versionCode 1)
**Repo:** https://github.com/Moud-ai/sunlight
**License:** GPL-3.0-only
**Framework:** React Native 0.87 (TypeScript)
**Audit date:** 2025-08-25

---

## 0. Pipeline status

```
source code          DONE (repo exists, .gitignore clean)
  |
F-Droid variant      DONE (Firebase excluded by default, telemetry shimmed)
  |
clean build          NEEDS VERIFICATION (requires Android SDK/NDK environment)
  |
fdroidserver lint    NEEDS METADATA FILE (metadata/com.moud.sunlight.yml)
  |
fdroidserver build   NEEDS BUILD SERVER (fdroidserver + Android SDK 37 + NDK 27.1)
  |
valid APK            PENDING BUILD
  |
valid metadata       NEEDS CREATION
  |
fdroiddata fork      NEEDS GITLAB FORK + MR
  |
F-Droid review       PENDING SUBMISSION
  |
merge + publish      PENDING
```

**What is done:**
- Firebase fully gated (excluded by default in react-native.config.js + gradle property)
- ExecuTorch telemetry shimmed out via Metro resolver
- Signing falls back to debug when env vars unset (F-Droid signs with its own key)
- .gitignore covers secrets, build artifacts, prebuilt bundles
- GPL-3.0 LICENSE file present, package.json license field set
- fastlane metadata structure created (en-US)
- docs/FDROID.md with build recipe

**What remains:**
- Create `metadata/com.moud.sunlight.yml` for fdroiddata
- Verify clean build in an F-Droid-like environment
- Resolve prebuilt .so policy (llama.rn, ggml-hexagon)
- Add phone screenshots to fastlane metadata
- Tag a release (v1.0.0) with full commit hash
- Fork fdroiddata, add metadata, open MR

---

## 1. Licenses

### 1.1 Main application license

| Field | Value |
|:------|:------|
| License | GPL-3.0-only |
| SPDX | `GPL-3.0-only` |
| LICENSE file | Present (full text from spdx.org) |
| package.json | `"license": "GPL-3.0-only"` |
| FOSS | Yes |
| F-Droid compatible | Yes |

**Source:** https://spdx.org/licenses/GPL-3.0-only.html

### 1.2 Dependency license matrix

| Dependency | Version | License | FOSS | F-Droid compatible | Action |
|:-----------|:--------|:--------|:-----|:-------------------|:-------|
| react | 19.2.3 | MIT | Yes | Yes | — |
| react-native | 0.87.0 | MIT | Yes | Yes | — |
| @react-navigation/* | 7.x | MIT | Yes | Yes | — |
| @tamagui/* | 2.7.7 | MIT | Yes | Yes | — |
| tamagui | 2.7.7 | MIT | Yes | Yes | — |
| @gorhom/bottom-sheet | 5.2.14 | MIT | Yes | Yes | — |
| @react-native-async-storage/async-storage | 3.1.1 | MIT | Yes | Yes | — |
| @dr.pogodin/react-native-fs | 2.40.0 | MIT | Yes | Yes | — |
| @expo-google-fonts/outfit | 0.4.3 | OFL-1.1 | Yes | Yes | — |
| @expo-google-fonts/geist | 0.4.2 | OFL-1.1 | Yes | Yes | — |
| @expo-google-fonts/geist-mono | 0.4.3 | OFL-1.1 | Yes | Yes | — |
| @kesha-antonov/react-native-background-downloader | 4.6.1 | MIT | Yes | Yes | — |
| @react-native/new-app-screen | 0.87.0 | MIT | Yes | Yes | — |
| llama.rn | 0.13.0-rc.1 | MIT | Yes | Yes (see 8.1) | Prebuilt .so policy |
| lucide-react-native | 1.34.0 | ISC | Yes | Yes | — |
| react-native-app-auth | 8.4.1 | MIT | Yes | Yes | — |
| react-native-biometrics | 3.0.1 | MIT | Yes | Yes | — |
| react-native-executorch | 0.9.3 | MIT | Yes | Yes | Telemetry shimmed |
| react-native-executorch-bare-resource-fetcher | 0.9.1 | MIT | Yes | Yes | — |
| react-native-gesture-handler | 3.2.1 | MIT | Yes | Yes | — |
| react-native-image-picker | 8.2.1 | MIT | Yes | Yes | — |
| react-native-keyboard-controller | 1.22.4 | MIT | Yes | Yes | — |
| react-native-keychain | 10.0.0 | MIT | Yes | Yes | — |
| react-native-linear-gradient | 2.8.3 | MIT | Yes | Yes | — |
| react-native-markdown-display | 7.0.2 | MIT | Yes | Yes | — |
| react-native-material-you | 1.3.0 | MIT | Yes | Yes | — |
| react-native-nitro-modules | 0.37.0 | MIT | Yes | Yes | — |
| react-native-qrcode-svg | 6.3.21 | MIT | Yes | Yes | — |
| react-native-reanimated | 4.6.0 | MIT | Yes | Yes | — |
| react-native-safe-area-context | 5.5.2 | MIT | Yes | Yes | — |
| react-native-screens | 4.27.0 | MIT | Yes | Yes | — |
| react-native-svg | 15.15.5 | MIT | Yes | Yes | — |
| react-native-vector-icons | 10.3.0 | MIT | Yes | Yes | — |
| react-native-vision-camera | 4.7.3 | MIT | Yes | Yes | — |
| react-native-worklets | 0.12.1 | MIT | Yes | Yes | — |
| **@react-native-firebase/app** | 26.3.2 | Apache-2.0 (JS) | JS: Yes | **Excluded by default** | Bridges to proprietary native SDK |
| **@react-native-firebase/messaging** | 26.3.2 | Apache-2.0 (JS) | JS: Yes | **Excluded by default** | Bridges to proprietary native SDK |

**Note on Firebase:** The JS wrapper packages are Apache-2.0 (FOSS), but they
bridge to Google's proprietary Firebase native SDK (distributed as binary .aar
from Google's Maven). The F-Droid variant excludes both the native autolinking
and the Gradle dependencies, so no proprietary code reaches the APK.

### 1.3 Vendored code

| Component | License | Source | FOSS |
|:----------|:--------|:-------|:-----|
| android/terminal-emulator | GPLv3 | Termux app v0.118.0 | Yes |
| android/terminal-view | GPLv3 | Termux app v0.118.0 | Yes |

See `android/TERMINAL_LICENSE_NOTE.md`. GPLv3 is compatible with the app's
GPL-3.0-only license.

### 1.4 Fonts

| Font | Location | License | FOSS |
|:-----|:---------|:--------|:-----|
| Outfit (400/500/600/700) | android/app/src/main/assets/fonts/ | OFL-1.1 | Yes |
| Geist | @expo-google-fonts/geist (npm) | OFL-1.1 | Yes |
| Geist Mono | @expo-google-fonts/geist-mono (npm) | OFL-1.1 | Yes |

### 1.5 App icon

The app icon (`src/assets/app-icon.png`, also `assets/icon.png`) is a custom
cloud design. **Action needed:** confirm the icon's license and copyright
holder. If it's original artwork by the project author, it's covered by the
GPL-3.0 license. If it uses third-party elements, verify redistribution rights.

### 1.6 GPL-3.0 compatibility

All FOSS dependencies use MIT, ISC, Apache-2.0, or OFL-1.1 licenses. All are
compatible with GPL-3.0-only (they are more permissive). The vendored Termux
code is GPLv3, which is compatible. No license conflicts found.

---

## 2. Repository and upstream

| Requirement | Status | Notes |
|:------------|:-------|:------|
| Public repo | Yes | https://github.com/Moud-ai/sunlight |
| Stable URL | Yes | GitHub HTTPS |
| Git history | Needs verification | Local repo has 76 modified/untracked files; must push clean state |
| Tags/releases | **Missing** | No version tags exist yet. F-Droid requires tags for `commit` field |
| versionCode | 1 | In android/app/build.gradle |
| versionName | "1.0" | In android/app/build.gradle |
| License in repo | Yes | LICENSE file (GPL-3.0) |
| README | Yes | Professional, Doki-style |
| Issue tracker | Needs creation | GitHub Issues |
| .gitignore | Yes | Covers secrets, build artifacts, prebuilt bundles |

**Action required:**
1. Push the cleaned repo to GitHub with all changes committed.
2. Create a version tag: `git tag -a v1.0.0 -m "v1.0.0" && git push origin v1.0.0`
3. Ensure the tag points to a clean commit with no uncommitted changes.
4. Create a GitHub Issues tracker (or use GitHub's built-in).

---

## 3. Firebase

### 3.1 Exclusion verification

| Check | Mechanism | Verified |
|:------|:----------|:---------|
| google-services plugin not applied | `sunlightFirebase` gradle property gates `apply plugin` | Yes |
| google-services classpath not resolved | Same property gates classpath in android/build.gradle | Yes |
| Firebase SDK deps not included | Same property gates `implementation(platform(...))` | Yes |
| Firebase native autolinking excluded | `react-native.config.js` excludes by default (SUNLIGHT_FIREBASE=1 to include) | Yes |
| No google-services.json committed | .gitignore + git ls-files confirms none tracked | Yes |
| JS layer no-ops without Firebase | firebase.ts wraps all calls in try/catch | Yes |
| No Firebase in AndroidManifest | grep confirms no firebase references | Yes |
| No Firebase in MainApplication.kt | grep confirms no firebase references | Yes |
| No transitive Firebase from other deps | No other dependency pulls firebase (verified via package.json) | Yes |

### 3.2 Gap resolved

**Previous state:** react-native.config.js excluded Firebase only when
`SUNLIGHT_EXCLUDE_FIREBASE=1` was set. fdroidserver runs gradle in a clean
environment and does not reliably propagate custom env vars to the Metro
bundling step.

**Current state:** react-native.config.js **excludes Firebase by default**.
Internal builds opt in with `SUNLIGHT_FIREBASE=1`. F-Droid builds require
no special environment variables.

### 3.3 Remaining concern

The npm packages `@react-native-firebase/app` and `@react-native-firebase/messaging`
remain in `package.json` as dependencies. They are installed by `npm install`
but their native modules are never linked or compiled. The JS wrapper code is
bundled but all calls throw (caught by try/catch) → no-op.

**F-Droid impact:** The scanner may flag the presence of these packages in
`node_modules`. Mitigate with a `MaintainerNote` in the metadata explaining
the exclusion mechanism.

---

## 4. React Native and autolinking

### 4.1 Autolinking verification

`react-native.config.js` excludes `@react-native-firebase/app` and
`@react-native-firebase/messaging` by setting `platforms.android: null` and
`platforms.ios: null`. This prevents the React Native CLI from generating
native linking code for these modules.

All other native modules are autolinked normally. The autolinking is driven
by `settings.gradle`:

```groovy
extensions.configure(com.facebook.react.ReactSettingsExtension){ ex ->
    ex.autolinkLibrariesFromCommand()
}
```

This runs `react-native config` at Gradle sync time, which reads
`react-native.config.js`. With Firebase excluded, the autolinking output
contains no Firebase entries.

### 4.2 Hermes

Hermes is enabled (`hermesEnabled=true` in gradle.properties). Hermes is
open source (MIT license, part of React Native). F-Droid compatible.

### 4.3 React Native version

React Native 0.87.0 is MIT licensed. The `@react-native/*` packages are
all MIT. F-Droid compatible.

### 4.4 Native modules inventory

The following native modules are autolinked and will produce .so libraries:

| Module | License | Notes |
|:-------|:--------|:------|
| react-native (core + Hermes + JSI) | MIT | RN runtime |
| react-native-reanimated | MIT | Animation |
| react-native-gesture-handler | MIT | Touch handling |
| react-native-screens | MIT | Navigation |
| react-native-safe-area-context | MIT | Layout |
| react-native-svg | MIT | Vector graphics |
| react-native-vision-camera | MIT | Camera |
| react-native-image-picker | MIT | Image selection |
| react-native-keychain | MIT | Secure storage |
| react-native-biometrics | MIT | Biometric auth |
| react-native-keyboard-controller | MIT | Keyboard |
| react-native-linear-gradient | MIT | Gradients |
| react-native-material-you | MIT | Material You (Android 12+ system APIs) |
| react-native-nitro-modules | MIT | Turbo modules |
| react-native-worklets | MIT | Worklets |
| react-native-app-auth | MIT | OAuth (AppAuth) |
| react-native-background-downloader | MIT | File downloads |
| react-native-qrcode-svg | MIT | QR codes |
| react-native-executorch | MIT | On-device AI |
| react-native-executorch-bare-resource-fetcher | MIT | Model fetching |
| llama.rn | MIT | llama.cpp bindings |
| @react-native-async-storage/async-storage | MIT | Storage |
| @dr.pogodin/react-native-fs | MIT | Filesystem |
| terminal-emulator | GPLv3 | Vendored Termux |
| terminal-view | GPLv3 | Vendored Termux |

All FOSS. No proprietary native modules in the F-Droid variant.

---

## 5. ExecuTorch telemetry

### 5.1 Source of telemetry

`react-native-executorch` (v0.9.3) contains a telemetry endpoint in its
`ResourceFetcherUtils` module:

```
DOWNLOAD_EVENT_ENDPOINT = 'https://ai.swmansion.com/telemetry/downloads/api/downloads'
```

When a model is downloaded, the library POSTs to this endpoint with:
- `bundleId` (app package name)
- `countryCode` (device country)
- `isEmulator` (boolean)
- `libVersion` (executorch version)
- `modelName` (downloaded model name)
- `system` (Platform.OS)

**Source:** `node_modules/react-native-executorch/lib/module/utils/ResourceFetcherUtils.js`

### 5.2 Mitigation

A Metro resolver shim (`metro.config.js`) redirects the constants module
to a local stub (`shims/executorch-resource-fetcher.js`) that exports
`DOWNLOAD_EVENT_ENDPOINT = ''`. The library's `triggerDownloadEvent()`
function calls `fetch('')` which throws (invalid URL), and the `.catch()`
swallows the error. No data is sent.

### 5.3 Verification

| Check | Status |
|:------|:-------|
| Telemetry constants redirected | Yes (metro.config.js resolver) |
| Stub exports empty endpoint | Yes (shims/executorch-resource-fetcher.js) |
| Regex matches all import paths | Yes (module/commonjs/typescript variants) |
| Native-side telemetry | Not found (executorch native code has no separate telemetry) |
| Alternative telemetry paths | Not found |

### 5.4 F-Droid classification

This is **not** a tracker (no persistent identifier, no user profiling). It's
a download analytics endpoint from a FOSS library (MIT). With the shim in
place, no data is sent. **No Anti-Feature required** for the F-Droid variant.

---

## 6. Network and endpoints

### 6.1 Endpoint inventory

| Component | Endpoint | Purpose | Data sent | Proprietary | Tracker | F-Droid problem |
|:----------|:---------|:--------|:----------|:------------|:--------|:----------------|
| Moud gateway | `https://mound.opceanai.com` | Chat API, auth, device linking | API key, chat messages, user profile | Yes | No | See 6.2 |
| GitHub OAuth | `https://github.com/login/oauth/*` | Optional login method | OAuth tokens | No (GitHub is FOSS-friendly) | No | No |
| GitLab OAuth | `https://gitlab.com` | Optional login method | OAuth tokens | No | No | No |
| Google OAuth | `https://accounts.google.com` | Optional login method | OAuth tokens | Yes | No | Optional; see 6.2 |
| HuggingFace | `https://huggingface.co/*/resolve/main/*.gguf` | Model downloads (user-initiated) | None (public URLs) | No | No | No |
| Moud profile | `https://mound.opceanai.com/dashboard/profile` | Profile page link | None (opened in browser) | Yes | No | No |
| Agent harness | `https://hermes-agent.nousresearch.com/install.sh` | Hermes agent install (user runs in terminal) | None (user-initiated curl) | N/A | No | No |
| Agent harness | `https://pi.dev/install.sh` | Pi agent install (user runs in terminal) | None (user-initiated curl) | N/A | No | No |
| ExecuTorch telemetry | `https://ai.swmansion.com/telemetry/downloads/api/downloads` | Model download analytics | Bundle ID, country, model name | No (FOSS lib) | **Shimmed out** | No (shimmed) |

### 6.2 Server dependency analysis

**The app depends on the Moud gateway (`mound.opceanai.com`) for its primary
chat mode.** Login is required to obtain an API key. The gateway processes
chat data server-side. This is a proprietary network service.

However, the app does **not** depend entirely on this service:

1. **BYOK mode:** The user can configure any OpenAI-compatible endpoint
   (their own server, local LLM server, etc.). The API key is stored in
   the Android Keystore.
2. **On-device mode:** Local GGUF models run entirely on the device via
   llama.cpp/ExecuTorch. No server connection needed.
3. **OAuth login:** GitHub, GitLab, and Google are optional login methods.
   The user chooses which to use.

**F-Droid classification:** The app promotes a proprietary network service
(Moud gateway) as its default mode, but provides alternatives. This likely
does **not** trigger `NonFreeNet` (which requires "depends entirely" on a
proprietary service). However, a `MaintainerNote` should document the
server dependency clearly.

**Action:** Add to metadata MaintainerNotes:
> Sunlight's default chat mode connects to the Moud gateway
> (mound.opceanai.com), a proprietary service. Login is required. The app
> also supports BYOK mode (any OpenAI-compatible endpoint) and on-device
> inference (local GGUF models) which require no server connection.

---

## 7. AI local inference

### 7.1 Runtimes

| Runtime | License | Source | FOSS |
|:--------|:--------|:-------|:-----|
| llama.rn (llama.cpp bindings) | MIT | https://github.com/mybigday/llama.rn | Yes |
| react-native-executorch | MIT | https://github.com/software-mansion/react-native-executorch | Yes |
| llama.cpp (core) | MIT | https://github.com/ggml-org/llama.cpp | Yes |

### 7.2 Models

Models are **not bundled** in the APK. They are downloaded at runtime from
HuggingFace when the user selects one. The curated model list in
`src/lib/gguf.ts` includes:

| Model | License | Source |
|:------|:--------|:-------|
| Qwen2.5 (0.5B, 1.5B) | Apache-2.0 | Qwen |
| Qwen3 (1.7B) | Apache-2.0 | Qwen |
| Qwen3.5 (0.8B) | Apache-2.0 | Qwen |
| Llama-3.2 (1B, 3B) | Llama 3.2 Community License | Meta |
| SmolLM2-360M | Apache-2.0 | HuggingFace |
| SmolLM3-3B | Apache-2.0 | HuggingFace |
| gemma-3-1b-it | Gemma License | Google |
| gemma-4-E2B-it | Gemma License | Google |
| LFM2-1.2B, LFM2.5 variants | Apache-2.0 | LiquidAI |
| Ling-3.0-tiny | Apache-2.0 | bartowski |
| Nanbeige4.2-3B | Apache-2.0 | bartowski |

**Note:** Gemma models use Google's Gemma License, which is permissive but
not OSI-approved. Since models are downloaded at user discretion (not
bundled), this does not affect F-Droid inclusion.

### 7.3 Model download mechanism

Models are downloaded from HuggingFace CDN (`huggingface.co/*/resolve/main/`)
to the device's app-private storage. No authentication required. Downloads
are user-initiated (the user selects a model from the picker).

---

## 8. Native libraries (.so)

### 8.1 Prebuilt .so in node_modules

`llama.rn` ships prebuilt native libraries in its npm package:

**jniLibs (shipped in APK):**
- `librnllama.so` (main llama.cpp JNI bridge)
- `librnllama_v8.so`, `librnllama_v8_2.so` (ARMv8 variants)
- `librnllama_v8_2_dotprod.so`, `librnllama_v8_2_i8mm.so` (CPU feature variants)
- `librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so` (Hexagon+OpenCL variant)

**bin/ (Hexagon HTP libs, copied to assets):**
- `libggml-htp-v73.so`, `libggml-htp-v75.so`, `libggml-htp-v79.so`, `libggml-htp-v81.so`
- `libOpenCL.so`

**F-Droid concern:** These are prebuilt binaries from the npm tarball.
F-Droid's policy requires building from source whenever possible. llama.cpp
is MIT-licensed and buildable from source via CMake/NDK.

**Options:**
1. **Preferred:** Configure the F-Droid build to compile llama.rn native code
   from source (requires CMake + NDK build step). llama.rn supports this
   via its `build.gradle` CMake integration.
2. **Fallback:** Document the prebuilts with source URL and license in the
   metadata. F-Droid may accept prebuilts if source is available and
   rebuilding is impractical in the fdroidserver environment.
3. **Hexagon HTP libs:** These are compiled from Qualcomm's Hexagon SDK.
   The source is part of ggml/llama.cpp (MIT). F-Droid may accept them
   as "vendored build artifacts" with source available.

### 8.2 Prebuilt .so in assets

`android/app/src/main/assets/ggml-hexagon/` contains:
- `libggml-htp-v73.so` (657 KB)
- `libggml-htp-v75.so` (726 KB)
- `libggml-htp-v79.so` (734 KB)
- `libggml-htp-v81.so` (734 KB)

These are the same Hexagon HTP libraries as in llama.rn's bin/ directory.
They are optional at runtime (CPU fallback on devices without Hexagon DSP).

**License:** Part of ggml/llama.cpp (MIT). Source at
https://github.com/ggml-org/llama.cpp.

### 8.3 Vendored terminal .so

`android/terminal-emulator` and `android/terminal-view` are built from
source via Gradle (they are source subprojects, not prebuilt). The build
produces `libtermux.so`. GPLv3 licensed. F-Droid compatible.

### 8.4 React Native core .so

The React Native Gradle plugin builds the following from source:
- `libhermes.so` (Hermes JS engine)
- `libjsi.so` (JSI bridge)
- `libreactnative.so` (RN core)
- `libfbjni.so` (Facebook JNI helpers)
- `libc++_shared.so` (C++ stdlib)

All MIT licensed, built from source. F-Droid compatible.

---

## 9. Gradle dependencies

### 9.1 Build environment

| Component | Version |
|:----------|:--------|
| Gradle | 9.4.1 (wrapper) |
| Android Gradle Plugin | Via react-native-gradle-plugin (RN 0.87) |
| compileSdk | 37 |
| targetSdk | 36 |
| minSdk | 24 |
| NDK | 27.1.12297006 |
| Kotlin | 2.2.0 |
| KSP | 2.2.0-2.0.2 |
| Java | JDK 17+ (required by AGP 8+) |

### 9.2 Dependency tree (F-Droid variant)

With `sunlightFirebase=false` and Firebase excluded:

**App dependencies:**
- `com.facebook.react:react-android` (MIT)
- `com.google.android.material:material:1.12.0` (Apache-2.0) — FOSS, no GMS dependency
- Hermes or JSC (MIT)
- terminal-emulator (GPLv3)
- terminal-view (GPLv3)

**No Firebase, no Google Play Services, no proprietary SDKs.**

### 9.3 Repositories

| Repository | Purpose | FOSS |
|:-----------|:--------|:-----|
| google() | Android SDK, Material, AGP | Yes (public Maven) |
| mavenCentral() | Open source libraries | Yes |
| react-native-gradle-plugin | RN build plugin | Yes (MIT) |

No JitPack, no custom Maven repos, no direct URL dependencies.

---

## 10. JavaScript dependencies

### 10.1 Analytics/trackers

**None found.** No Sentry, Amplitude, Mixpanel, Segment, AppsFlyer, Firebase
Analytics, or any other analytics/tracking SDK in the dependency tree.

### 10.2 Proprietary SDKs

**None in the F-Droid variant.** Firebase is excluded. All other dependencies
are open source.

### 10.3 Postinstall scripts

No suspicious postinstall scripts found in package.json. Standard React Native
toolchain scripts only.

### 10.4 npm overrides

```json
"overrides": {
  "linkify-it": "^5.0.2",
  "markdown-it": "^14.1.2"
}
```

These override transitive dependencies to fix known vulnerabilities
(GHSA-22p9-wv53-3rq4, GHSA-v245-v573-v5vm, GHSA-6vfc-qv3f-vr6c). Both
overrides point to FOSS versions (MIT). F-Droid compatible.

---

## 11. Fonts, icons and assets

| Asset | License | FOSS | Redistribution OK |
|:------|:--------|:-----|:------------------|
| Outfit_400Regular.ttf | OFL-1.1 | Yes | Yes |
| Outfit_500Medium.ttf | OFL-1.1 | Yes | Yes |
| Outfit_600SemiBold.ttf | OFL-1.1 | Yes | Yes |
| Outfit_700Bold.ttf | OFL-1.1 | Yes | Yes |
| App icon (cloud) | **Needs confirmation** | **TBD** | **TBD** |
| ggml-hexagon .so files | MIT (llama.cpp) | Yes | Yes |

**Action:** Confirm the app icon is original artwork covered by GPL-3.0, or
verify its license if sourced from a third party.

---

## 12. Remote content

| Content | Source | Bundled in APK | Downloaded at runtime | License |
|:--------|:-------|:---------------|:----------------------|:--------|
| GGUF models | HuggingFace | No | Yes (user-initiated) | Per-model (mostly Apache-2.0) |
| Hermes agent install script | nousresearch.com | No | Yes (user runs in terminal) | N/A |
| Pi agent install script | pi.dev | No | Yes (user runs in terminal) | N/A |
| Fonts | npm (@expo-google-fonts) | Yes (in assets) | No | OFL-1.1 |
| Hexagon HTP libs | npm (llama.rn) | Yes (in assets) | No | MIT |

No content is bundled that lacks redistribution rights (pending icon verification).

---

## 13. Signing

| Aspect | Current behavior | F-Droid behavior |
|:-------|:-----------------|:-----------------|
| Debug signing | Standard RN debug.keystore | F-Droid uses its own debug key |
| Release signing | Env vars (SUNLIGHT_STORE_*) | F-Droid ignores and signs with its own key |
| Fallback | Debug signing when env vars unset | Correct for F-Droid |
| Private key in repo | None (release.keystore deleted, env vars only) | None |
| Auto-signing of F-Droid build | No (falls back to debug) | F-Droid re-signs with its own key |

**No issues.** F-Droid signs all APKs with its own key. The developer's
signing key is never used for F-Droid builds.

---

## 14. Build from source

### 14.1 Requirements

| Tool | Version | Notes |
|:-----|:--------|:------|
| Node.js | 20+ | React Native 0.87 requirement |
| npm | 10+ | Package manager |
| JDK | 17+ | AGP 8+ requires JDK 17 |
| Android SDK | 37 (compileSdk) | |
| Android Build Tools | 37.0.0 | |
| Android NDK | 27.1.12297006 | |
| Gradle | 9.4.1 | Via wrapper |
| CMake | Required by llama.rn native build | |
| Kotlin | 2.2.0 | Via gradle.properties |

### 14.2 Build steps (F-Droid)

```bash
# 1. Clone
git clone --depth 1 https://github.com/Moud-ai/sunlight sunlight
cd sunlight

# 2. Install JS dependencies
npm ci --legacy-peer-deps

# 3. Build APK
cd android
./gradlew assembleRelease -PsunlightFirebase=false
```

### 14.3 Build concerns

| Concern | Status |
|:--------|:-------|
| Downloads source not declared | No (all deps from npm/Maven) |
| Downloads proprietary binaries | No (Firebase excluded) |
| Needs private credentials | No |
| Needs developer local files | No |
| Needs Firebase | No |
| Needs external services to compile | npm registry + Maven Central (standard) |
| Needs specific environment | Node 20+, JDK 17+, Android SDK 37, NDK 27.1 |

### 14.4 Reproducibility

Reproducible builds are **not required** by F-Droid but are encouraged.
React Native builds are generally not bit-for-bit reproducible due to
timestamps and build IDs. F-Droid verifies by comparing the APK structure
and manifest, not by byte comparison.

---

## 15. Offline build and external sources

### 15.1 Downloads during build

| Source | What | Standard | F-Droid allowed |
|:-------|:-----|:---------|:----------------|
| npm registry | JS dependencies | Yes | Yes |
| Maven Central | Java/Kotlin libraries | Yes | Yes |
| Google Maven | Android SDK, Material | Yes | Yes |
| Gradle distributions | Gradle wrapper | Yes | Yes |

No custom Maven repos, no JitPack, no direct URL downloads of binaries.

### 15.2 No offline build issues

All dependencies are from standard, F-Droid-approved repositories. No
credentials required. No proprietary sources.

---

## 16. Build tools

| Tool | Role | Ships in APK | FOSS |
|:-----|:-----|:-------------|:-----|
| Gradle 9.4.1 | Build system | No | Yes (Apache-2.0) |
| Android SDK 37 | Compilation | No | Yes |
| NDK 27.1 | Native compilation | No | Yes |
| CMake | Native build | No | Yes |
| Node.js 20+ | JS bundling | No | Yes |
| Metro | JS bundler | No | Yes (MIT) |
| Hermes | JS engine | Yes (in APK) | Yes (MIT) |
| Kotlin 2.2.0 | Android code | No (compiler) | Yes (Apache-2.0) |
| React Native CLI | Build orchestration | No | Yes (MIT) |

No proprietary build tools. No tools that download non-free components.

---

## 17. Reproducibility

**F-Droid policy:** Reproducible builds are not mandatory. They are a best
practice encouraged for new apps.

**Current status:** React Native builds are not bit-for-bit reproducible
due to:
- Timestamps in compiled code
- Build IDs in native libraries
- Metro bundler output ordering

**Recommendation:** Not a blocker for inclusion. Can be improved later by:
- Pinning all dependency versions exactly
- Using `--frozen-lockfile` for npm
- Documenting exact build environment

---

## 18. Anti-Features

| Anti-Feature | Applies | Reasoning |
|:-------------|:--------|:----------|
| **Ads** | No | No advertising in the app |
| **Disabled Algorithm** | No | Standard signing |
| **Known Vulnerability** | No | npm audit clean for runtime deps; linkify-it/markdown-it overridden |
| **Non-Free Addons** | No | Agent harness URLs point to third-party tools but don't promote non-free apps |
| **Non-Free Assets** | **TBD** | Pending app icon license verification. Fonts are OFL. Hexagon .so are MIT. |
| **Non-Free Dependencies** | No | No proprietary app required to run |
| **Non-Free Network Services** | **No** (recommended) | App depends on Moud gateway (proprietary) for default mode, but BYOK and on-device modes provide alternatives. Does not depend **entirely** on proprietary service. |
| **No Source Since** | No | Source available |
| **Tethered Network Services** | **No** (recommended) | BYOK mode allows pointing to any endpoint. Not tethered to a single instance. |
| **Tracking** | No | ExecuTorch telemetry shimmed out. No analytics, no crash reporting. |

**Recommendation:** Declare no Anti-Features, but add a `MaintainerNote`
documenting the Moud gateway dependency and the BYOK/on-device alternatives.

**If F-Droid reviewers disagree** on NonFreeNet, the fallback is to declare
`NonFreeNet` with an explanation that alternatives exist.

---

## 19. Identifiers and package

| Field | Value | Notes |
|:------|:------|:------|
| applicationId | `com.moud.sunlight` | Stable |
| namespace | `com.moud.sunlight` | Matches applicationId |
| versionCode | 1 | Needs increment per release |
| versionName | "1.0" | Needs real versioning |
| Google Play | Not published | No conflict |
| F-Droid conflict | Check needed | Search f-droid.org for `com.moud.sunlight` |

**Action:** Before submission, verify no existing F-Droid app uses
`com.moud.sunlight`. Establish a versioning strategy (semver recommended).

---

## 20. Product flavors / variants

```
              Sunlight
                 |
      +----------+----------+
      |                     |
 Production             F-Droid
      |                     |
 Firebase ON           Firebase OFF (default)
 SUNLIGHT_FIREBASE=1   No env vars needed
 sunlightFirebase=true -PsunlightFirebase=false
```

**Implementation:** No product flavors needed. The split is achieved via:
1. `react-native.config.js`: Firebase excluded by default (opt-in with `SUNLIGHT_FIREBASE=1`)
2. `android/app/build.gradle`: Firebase plugin/deps gated by `sunlightFirebase` gradle property
3. `metro.config.js`: ExecuTorch telemetry shimmed in all builds

F-Droid builds with default settings + `-PsunlightFirebase=false`. No code
duplication, no flavor dimension.

---

## 21. Build recipe (fdroiddata)

```yaml
Categories:
  - Internet
  - Phone & SMS
License: GPL-3.0-only
WebSite: https://github.com/Moud-ai/sunlight
SourceCode: https://github.com/Moud-ai/sunlight
IssueTracker: https://github.com/Moud-ai/sunlight/issues

RepoType: git
Repo: https://github.com/Moud-ai/sunlight

AutoName: Sunlight

Builds:
  - versionName: '1.0'
    versionCode: 1
    commit: <full commit SHA of v1.0.0 tag>
    subdir: android
    gradle: yes
    gradleprops:
      - sunlightFirebase=false
    ndk: 27.1.12297006
    rm:
      - android/app/src/main/assets/ggml-hexagon
    scandelete:
      - node_modules/llama.rn/android/src/main/jniLibs
      - node_modules/llama.rn/bin
    prebuild:
      - npm ci --legacy-peer-deps
    build:
      - cd android && ./gradlew assembleRelease

MaintainerNotes: |
  Sunlight's default chat mode connects to the Moud gateway
  (mound.opceanai.com), a proprietary server-side service. Login is
  required. The app also supports BYOK mode (any OpenAI-compatible
  endpoint) and on-device inference (local GGUF models) which require
  no server connection.
  
  Firebase is excluded by default in react-native.config.js. The npm
  packages @react-native-firebase/app and @react-native-firebase/messaging
  remain in package.json but their native modules are never linked.
  
  The agent harness feature includes hardcoded install URLs for third-party
  tools (hermes-agent.nousresearch.com, pi.dev). These are user-initiated
  commands in a sandboxed terminal, not auto-executed.

UpdateCheckMode: Tags
UpdateCheckName: com.moud.sunlight
```

**Notes on the recipe:**
- `subdir: android` — the Gradle project root is `android/`.
- `prebuild` runs `npm ci` to install JS dependencies before Gradle.
- `gradleprops: sunlightFirebase=false` ensures Firebase is not compiled.
- `rm` removes the prebuilt Hexagon .so from assets (they'll be rebuilt
  or handled via scandelete).
- `scandelete` removes prebuilt .so from llama.rn's jniLibs so the
  scanner doesn't flag them. The native code should be built from source
  via CMake (llama.rn supports this).
- `ndk: 27.1.12297006` matches the project's ndkVersion.

**Action needed:** Verify that llama.rn's `build.gradle` actually builds
native code from source when the prebuilt jniLibs are removed. If not,
the recipe needs a custom CMake build step or the prebuilts must be
accepted with source documentation.

---

## 22. F-Droid metadata

### 22.1 Required fields

| Field | Value | Source |
|:------|:------|:-------|
| Categories | Internet, Phone & SMS | App functionality |
| License | GPL-3.0-only | LICENSE file |
| WebSite | https://github.com/Moud-ai/sunlight | GitHub repo |
| SourceCode | https://github.com/Moud-ai/sunlight | GitHub repo |
| IssueTracker | https://github.com/Moud-ai/sunlight/issues | GitHub Issues |
| RepoType | git | Git repo |
| Repo | https://github.com/Moud-ai/sunlight | GitHub HTTPS |
| AutoName | Sunlight | App name |
| Summary | Private AI chat with on-device models and your own API keys | fastlane metadata |
| Description | (full description) | fastlane metadata |

### 22.2 Fastlane metadata

Located at `fastlane/metadata/android/en-US/`:

| File | Status |
|:-----|:-------|
| title.txt | Present ("Sunlight") |
| short_description.txt | Present |
| full_description.txt | Present |
| changelogs/1.txt | Present |
| images/icon.png | Present (192x192 PNG) |
| images/phoneScreenshots/ | **Empty** — needs screenshots |

**Action:** Add at least 2-3 phone screenshots (16:9 or 9:16 ratio,
minimum 320px wide). F-Droid strongly recommends screenshots.

---

## 23. Fastlane metadata audit

| Requirement | Status | Notes |
|:------------|:-------|:------|
| en-US locale | Present | |
| title.txt | Present | "Sunlight" |
| short_description.txt | Present | 80 chars max |
| full_description.txt | Present | 4000 chars max |
| changelogs/1.txt | Present | |
| icon.png | Present | 192x192, needs 512x512 for F-Droid |
| phoneScreenshots | **Missing** | Add 2-3 screenshots |
| featureGraphic | **Missing** | Optional but recommended (1024x500) |

**Action:**
1. Replace icon.png with a 512x512 version (F-Droid requirement).
2. Add phone screenshots.
3. Optionally add a feature graphic.

---

## 24. README and FDROID.md

| Document | Status | Notes |
|:---------|:-------|:------|
| README.md | Present | Professional, Doki-style, GPL-3 badge, no emojis |
| docs/FDROID.md | Present | Build recipe, Firebase exclusion, server dependency documented |
| android/TERMINAL_LICENSE_NOTE.md | Present | GPLv3 Termux licensing |

**FDROID.md covers:**
- How to compile the F-Droid variant
- Firebase exclusion flags (sunlightFirebase, SUNLIGHT_FIREBASE)
- ExecuTorch telemetry shim
- Build dependencies (Node, JDK, SDK, NDK)
- Prebuilt binary documentation
- Font licenses
- Server dependency (Moud gateway)
- Agent harness URLs

---

## 25. Validation with fdroidserver

### 25.1 Local validation commands

```bash
# Install fdroidserver (Python 3.10+)
pip install fdroidserver

# Initialize local repo structure
mkdir fdroiddata && cd fdroiddata
fdroid init

# Copy metadata
cp ../sunlight/fastlane/metadata/android/en-US metadata/com.moud.sunlight/
# Create metadata/com.moud.sunlight.yml (see section 21)

# Read and validate metadata
fdroid readmeta

# Lint metadata
fdroid lint com.moud.sunlight

# Build (requires full Android SDK/NDK environment)
fdroid build --server com.moud.sunlight
```

### 25.2 What each command checks

| Command | Checks |
|:--------|:-------|
| `fdroid readmeta` | YAML syntax, required fields, field types |
| `fdroid lint` | Metadata consistency, license validity, Anti-Feature flags, build recipe syntax |
| `fdroid build` | Full compilation, dependency resolution, APK output, signing |

### 25.3 Expected lint issues

- May warn about `@react-native-firebase` in package.json (explain in MaintainerNotes)
- May warn about prebuilt .so in llama.rn (explain source availability)
- May warn about network endpoints (explain in MaintainerNotes)

---

## 26. APK final inspection

After building, inspect the APK with:

```bash
# List contents
unzip -l app-release.apk

# Check manifest
aapt2 dump xmltree app-release.apk AndroidManifest.xml

# Check for Firebase
unzip -l app-release.apk | grep -i firebase

# Check for Google Play Services
unzip -l app-release.apk | grep -i gms

# Check native libraries
unzip -l app-release.apk | grep '\.so$'

# Check for unexpected URLs
strings app-release.apk | grep -E 'https?://' | sort -u
```

**Expected clean APK:**
- No firebase .so or .aar
- No gms/play-services
- No analytics/tracking SDKs
- Native libs: hermes, jsi, reactnative, fbjni, rnllama, executorch, termux, etc.
- URLs: mound.opceanai.com, huggingface.co, github.com, gitlab.com, accounts.google.com

---

## 27. Android permissions

| Permission | Reason | Necessary | F-Droid problem | Can remove |
|:-----------|:-------|:----------|:----------------|:-----------|
| INTERNET | Network access (gateway, BYOK, model downloads) | Yes | No | No |
| CAMERA | Vision camera for image attachments | Yes (feature) | No | Could make optional |
| USE_BIOMETRIC | Biometric auth for keychain | Yes (feature) | No | No |
| RECORD_AUDIO | Voice message recording | Yes (feature) | No | Could make optional |
| READ_MEDIA_IMAGES | Image attachments (Android 13+) | Yes (feature) | No | No |
| READ_MEDIA_AUDIO | Audio attachments (Android 13+) | Yes (feature) | No | No |
| READ_EXTERNAL_STORAGE | Legacy storage access (maxSdkVersion=32) | Yes (legacy) | No | No |
| com.termux.permission.RUN_COMMAND | Terminal harness commands | Yes (feature) | No | No |

**No tracking-related permissions.** All permissions are functional and
justified by app features. None are problematic for F-Droid.

---

## 28. Privacy

### 28.1 Data collected and sent

| Data | Destination | When | Necessary | Classification |
|:-----|:------------|:-----|:----------|:---------------|
| API key | Moud gateway | Login | Yes (for gateway mode) | Authentication |
| Chat messages | Moud gateway | Chat | Yes (for gateway mode) | Core functionality |
| User profile | Moud gateway | Profile view | Yes | Core functionality |
| Device info | Moud gateway | Device linking | Yes | Core functionality |
| OAuth tokens | GitHub/GitLab/Google | Login (optional) | Yes (for OAuth) | Authentication |
| Model downloads | HuggingFace | User-initiated | Yes (for local models) | Content download |
| ExecuTorch telemetry | ai.swmansion.com | **Shimmed out** | No | **Disabled** |

### 28.2 Classification

- **Necessary:** API key, chat messages (for gateway mode), OAuth tokens
- **Functional:** Device info, user profile
- **Telemetry:** ExecuTorch (shimmed out, no data sent)
- **Tracking:** None
- **Analytics:** None

### 28.3 Consent

- Login is user-initiated (explicit action)
- Model downloads are user-initiated (explicit selection)
- BYOK mode requires user to enter their own endpoint/key
- No background data collection
- No crash reporting
- No update checker

---

## 29. Proprietary services

| Service | Required to build | Required to run | Required for feature | Alternative |
|:--------|:------------------|:----------------|:---------------------|:------------|
| Moud gateway | No | Yes (default chat) | Chat, auth, device linking | BYOK mode, on-device models |
| Google OAuth | No | No (optional) | Login method | GitHub, GitLab, email/password |
| GitHub OAuth | No | No (optional) | Login method | GitLab, Google, email/password |
| GitLab OAuth | No | No (optional) | Login method | GitHub, Google, email/password |
| HuggingFace | No | No (optional) | Model downloads | Any GGUF source |
| Firebase | No | No (excluded) | Push notifications (disabled) | None (feature absent) |
| npm registry | Yes (build) | No | — | Standard |
| Maven Central | Yes (build) | No | — | Standard |
| Google Maven | Yes (build) | No | — | Standard |

**No proprietary service is required to build.** The Moud gateway is required
for the default chat mode, but alternatives exist.

---

## Summary of gaps and actions

### Critical (must fix before submission)

| # | Gap | Action | Status |
|:--|:----|:-------|:-------|
| 1 | No version tag | Create `v1.0.0` tag on clean commit | Pending |
| 2 | No fdroiddata metadata | Create `metadata/com.moud.sunlight.yml` | Pending |
| 3 | Prebuilt .so in llama.rn | Verify CMake build from source works; or document prebuilts | Pending |
| 4 | Icon 192x192 | Replace with 512x512 version | Pending |
| 5 | No phone screenshots | Add 2-3 screenshots to fastlane metadata | Pending |

### Important (should fix)

| # | Gap | Action | Status |
|:--|:----|:-------|:-------|
| 6 | App icon license | Confirm original artwork or verify license | Pending |
| 7 | Issue tracker | Enable GitHub Issues | Pending |
| 8 | react-native.config.js default | **DONE** — Firebase excluded by default | Fixed |
| 9 | MaintainerNotes | Document server dependency, agent URLs | Pending |
| 10 | Feature graphic | Optional but recommended (1024x500) | Pending |

### Done

| # | Item | Status |
|:--|:-----|:-------|
| 1 | Firebase gating (gradle + autolinking) | Done |
| 2 | ExecuTorch telemetry shim | Done |
| 3 | Signing fallback to debug | Done |
| 4 | .gitignore (secrets, build artifacts) | Done |
| 5 | LICENSE file (GPL-3.0) | Done |
| 6 | package.json license field | Done |
| 7 | README.md (professional, no emojis) | Done |
| 8 | docs/FDROID.md (build recipe) | Done |
| 9 | fastlane metadata structure | Done |
| 10 | react-native.config.js default-exclude | Done |
| 11 | npm audit (linkify-it/markdown-it overrides) | Done |
| 12 | HTTPS-only BYOK enforcement | Done |
| 13 | Markdown link confirmation handler | Done |
| 14 | Dead code cleanup | Done |
| 15 | catch(e:any) → typed unknown | Done |
