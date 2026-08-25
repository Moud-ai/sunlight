# Building Sunlight for F-Droid

Sunlight is a React Native (0.87) application with an Android target only
at this time. This document describes how to produce a fully free build
suitable for inclusion in the F-Droid repository.

## Proprietary components and how they are excluded

The upstream project supports an optional push-notification feature built
on Firebase Cloud Messaging, which is proprietary Google infrastructure.
All of it is gated behind build flags and **must not** be enabled for
F-Droid builds:

| Component | Location | Exclusion mechanism |
|---|---|---|
| `google-services` Gradle plugin | `android/build.gradle`, `android/app/build.gradle` | Applied only when the `sunlightFirebase` Gradle property is set |
| Firebase SDK dependencies (`firebase-bom`, `firebase-messaging`) | `android/app/build.gradle` | Wrapped in the same `sunlightFirebase` condition |
| Firebase native autolinking | root `react-native.config.js` | **Excluded by default.** Internal builds opt in with `SUNLIGHT_FIREBASE=1` |
| ExecuTorch download telemetry (`ai.swmansion.com`) | `metro.config.js` + `shims/executorch-resource-fetcher.js` | Metro resolver redirects the telemetry constants module to a no-op stub in every build |
| `google-services.json` | not committed | Listed in `.gitignore`; builds without Firebase never read it |

The JavaScript layer degrades gracefully without Firebase: every function
in `src/lib/firebase.ts` catches the missing-native-module error and
no-ops. Chat, on-device models, BYOK providers and all other features work
normally; only push notifications are absent.

### Firebase exclusion logic

Firebase is excluded **by default** in `react-native.config.js`. This means
F-Droid builds (and any build that does not explicitly opt in) will never
link the proprietary Firebase native modules, regardless of environment
variables.

Internal release builds that need push notifications must set both:

- `SUNLIGHT_FIREBASE=1` (environment variable, re-enables autolinking)
- `-PsunlightFirebase=true` (Gradle property, enables plugin + SDK deps)

F-Droid builds require **neither**: the default behavior is Firebase-free.

## Build recipe

```
git clone --depth 1 https://github.com/Moud-ai/sunlight sunlight
cd sunlight

npm ci --legacy-peer-deps
# Node 20+ required by React Native 0.87.

cd android
./gradlew assembleRelease -PsunlightFirebase=false
```

No environment variables are needed: Firebase autolinking is excluded by
default in `react-native.config.js`.

Notes:

* The release signing configuration reads keystore material from
  `SUNLIGHT_STORE_FILE`, `SUNLIGHT_STORE_PASSWORD`, `SUNLIGHT_KEY_ALIAS`
  and `SUNLIGHT_KEY_PASSWORD`. When those variables are unset (as in the
  F-Droid build server) release builds fall back to debug signing so that
  fdroidserver can sign with its own key. No keystore or password is
  committed to the repository.
* `react-native-executorch-bare-resource-fetcher` pulls
  `@dr.pogodin/react-native-fs`, which is used for model file management.
  Both are open source.

## Prebuilt binaries shipped in assets

`android/app/src/main/assets/ggml-hexagon/` contains Qualcomm Hexagon HTP
libraries (`libggml-htp-v*.so`) used for NPU-accelerated local inference.
They correspond to the llama.cpp Hexagon kernels published by the
ggml/executorch projects (MIT licensed) and are compiled from the source
at https://github.com/ggml-org/llama.cpp. They are optional at runtime:
devices without a supported Hexagon DSP fall back to CPU inference via
llama.rn.

## Fonts

`android/app/src/main/assets/fonts/Outfit_*.ttf` are licensed under the
SIL Open Font License 1.1 (https://github.com/Outfitio/Outfit-Fonts).

## Terminal emulator

`android/terminal-emulator` and `android/terminal-view` vendor the Termux
terminal emulator libraries, built from source in-tree. See
`android/TERMINAL_LICENSE_NOTE.md` for licensing details (GPLv3).

## Server dependency

Sunlight's primary chat mode connects to the Moud gateway
(`https://mound.opceanai.com`) for server-side data processing. Login is
required to obtain an API key. This is a proprietary network service.

The app also supports a bring-your-own-key (BYOK) mode where the user
points to any OpenAI-compatible endpoint, and on-device inference via local
GGUF models where no server is involved at all. These alternatives mean the
app does not depend **entirely** on the Moud gateway.

## Agent harness URLs

The sandboxed terminal harness feature includes hardcoded install commands
for third-party agent tools:

- `https://hermes-agent.nousresearch.com/install.sh` (Hermes Agent)
- `https://pi.dev/install.sh` (Pi coding agent)

These URLs are intentional and necessary for the harness feature. The
commands are only executed when the user explicitly runs them inside the
sandboxed terminal; they are not auto-executed by the app.
