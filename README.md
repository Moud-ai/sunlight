# Sunlight

![Sunlight](assets/icon.png)

Private AI chat with on-device models and your own API keys.

<p>
  <a href="https://www.gnu.org/licenses/gpl-3.0.html"><img src="https://img.shields.io/badge/License-GPL--3.0-555?style=flat" alt="License"></a>
  <a href="https://reactnative.dev"><img src="https://img.shields.io/badge/React%20Native-0.87-0a7ea4?style=flat&logo=react&logoColor=white" alt="React Native"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://f-droid.org"><img src="https://img.shields.io/badge/F--Droid-ready-1976d2?style=flat&logo=f-droid&logoColor=white" alt="F-Droid"></a>
</p>

Sunlight is an AI chat client built around privacy and user control. It connects to the Moud gateway or, alternatively, to any OpenAI-compatible endpoint with a bring-your-own-key setup. Conversations can also run entirely on the device using local open-weight models, so no chat data ever has to leave the phone. The app ships with no advertising, no tracking and no analytics.

---

## Overview

| Metric | Value |
|:-------|:------|
| **Platform** | Android (React Native / Expo-style toolchain) |
| **Language** | TypeScript |
| **UI** | Tamagui, Material You dynamic theming |
| **Local models** | llama.cpp / ExecuTorch (GGUF), optional Hexagon NPU |
| **Push (opt-in)** | Firebase Cloud Messaging (excluded on F-Droid) |

Sunlight keeps secrets in the Android Keystore-backed credential store, renders markdown natively, and supports voice and image attachments. Device linking, QR-code pairing, two-factor auth, and a sandboxed terminal for running agent tooling are all included.

---

## Features

### On-device inference
Download and chat with open-weight models locally. Optional NPU acceleration on Qualcomm devices (Hexagon HTP) and CPU fallback otherwise.

### Bring your own key
Talk directly to OpenAI-compatible providers. The API key is stored in the platform credential store, never in plaintext preferences.

### Streaming and markdown
Messages stream token-by-token with markdown rendering, syntax-highlighted code blocks, and safe link handling (https-only, with a confirmation prompt).

### Voice and images
Record, transcribe, and attach voice clips; attach images for multimodal models.

### Device linking
Pair a second device with QR-code scanning and two-factor authentication, and approve or revoke linked sessions from anywhere.

### Sandboxed terminal
Run agent tooling inside a vendored Termux terminal emulator, kept local to the device.

### Theming
Material You dynamic color on Android 12+, plus several built-in themes. The whole UI reacts to the selected palette at runtime.

---

## Architecture

The app is a single React Native shell with a sidebar (chat history + settings) and a main chat surface.

| Layer | Technology |
|:------|:-----------|
| UI framework | React Native 0.87 |
| Design system | Tamagui (Swiss-style components) |
| Styling | ThemeProvider-driven palette via `useThemeColors()` + memoized `StyleSheet` |
| Local models | llama.rn, react-native-executorch (GGUF) |
| Gateway client | typed `fetch` wrapper with retry and normalized `ApiError` |
| Secure storage | react-native-keychain (Keystore / Keychain bound) |
| Navigation | React Navigation native stack |

### Theming model

Screens declare styles with a factory `makeStyles(c: ThemeColors)` and rebuild them whenever the live palette changes:

```ts
const c = useThemeColors();
const styles = useMemo(() => makeStyles(c), [c]);
```

This replaces the old pattern of snapshotting a static `colors` object at module load, which silently ignored theme switches.

---

## Getting Started

### Prerequisites

- Node.js is not required; use Node 20+.
- Android SDK 24+ (min) / compile SDK 37.
- For local models: an ARM64 device with at least a few GB of free storage.

### Install

```sh
npm install --legacy-peer-deps
```

### Run on a device or emulator

```sh
npm run android
```

### Build a release APK / AAB

```sh
cd android
./gradlew assembleRelease
```

### F-Droid builds

F-Droid builds exclude proprietary components (Firebase, Google Play Services). See [docs/FDROID.md](docs/FDROID.md) for the full recipe, including the `sunlightFirebase` and `SUNLIGHT_EXCLUDE_FIREBASE` flags and the telemetry shim.

---

## Security

- Session credentials are stored with biometric-bound Keystore / Keychain access.
- BYOK endpoints are HTTPS-only; plaintext `http://` URLs are rejected.
- Assistant-generated links are confirmed before opening and restricted to `https://`.
- ExecuTorch download telemetry is disabled in every build.
- No analytics, no crash reporters, no third-party trackers.

---

## License

Sunlight is free software released under the GNU General Public License version 3 (GPL-3.0-only).

The vendored terminal libraries (android/terminal-emulator, android/terminal-view) are derived from Termux and carry their own GPLv3 terms; see [android/TERMINAL_LICENSE_NOTE.md](android/TERMINAL_LICENSE_NOTE.md).

You should have received a copy of the GNU General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.
