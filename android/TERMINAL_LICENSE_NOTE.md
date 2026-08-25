# Vendored Terminal Libraries — License Note

Sunlight vendors two Android library modules from the
[Termux app](https://github.com/termux/termux-app) repository as source
subprojects to power its embedded sandbox terminal:

| Module | Vendored path | Upstream | License |
| --- | --- | --- | --- |
| `terminal-emulator` | `android/terminal-emulator/` | [`termux-app/v0.118.0/terminal-emulator`](https://github.com/termux/termux-app/tree/v0.118.0/terminal-emulator) | GPL-3.0 |
| `terminal-view` | `android/terminal-view/` | [`termux-app/v0.118.0/terminal-view`](https://github.com/termux/termux-app/tree/v0.118.0/terminal-view) | GPL-3.0 |

- **Source:** https://github.com/termux/termux-app
- **Tag:** `v0.118.0`
- **Commit hash:** `6e2689f55295fa444be8ac8592c527c2c5ef3253`
- **Upstream license file:** `LICENSE.md` at that commit (GPLv3). The full text
  applies; only build files and manifests were adjusted (namespace, SDK levels,
  ABI filters) — no functional source changes.

## Consequence

Both modules are **GNU GPLv3** licensed. Because their compiled code is linked
into the distributed Sunlight APK, **the distributed APK as a whole is subject
to GPLv3** and must ship with its complete corresponding source and the GPLv3
license text when released. This was an accepted, deliberate project decision.
