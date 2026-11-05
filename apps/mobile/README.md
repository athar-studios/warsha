# Warsha Remote — Android shell (WS2)

Capacitor-style shell (`capacitor.config.json`) hosting the built
`apps/remote` PWA in a hardened Android WebView. Application ID
`dev.warsha.remote`, app name **Warsha Remote** / **ورشة عن بُعد**
(`values/` + `values-ar/` string catalogs — no hardcoded UI strings).

The `android/` directory is a complete, self-contained Gradle project
(AGP 9.1.0 / Gradle 9.3.1, pure `android.app.Activity` + framework
WebView — no androidx/Capacitor AARs needed).

## What the native bridge (`window.WarshaNative`) provides

| Method                          | Behaviour                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `saveSecret(k, v)`              | AES-**256**-GCM seal with a non-exportable **Android Keystore** key; stores only IV + ciphertext in `getFilesDir()/warsha_keystore_vault.json`. Never plain SharedPreferences / localStorage. |
| `loadSecret(k)` / `deleteSecret(k)` | Decrypt / remove vault entries (GCM auth failure ⇒ `null`, no crash, no logs of values). |
| `getInitialPairingUri()`        | Returns the `warsha://pair?...` deep link this launch came from; also dispatched as `CustomEvent("warsha:pair-deeplink")`. |
| `requestCameraPermission()`     | Runtime `CAMERA` request; on grant, `getUserMedia` (`RESOURCE_VIDEO_CAPTURE`) is allowed **only for the local bundled origin**; result event `warsha:camera-permission` carries `fallback: "manual_code_and_url"` when denied. |
| `getAppRole()` / `getNativeInfo()` | `"remote_companion"` — this app never holds LLM API keys.                                |

## Cleartext policy

`network_security_config.xml` keeps `<base-config cleartextTrafficPermitted="false"/>`
and only allows cleartext to loopback / `10.0.2.2` / `.local` / `.ts.net` /
`100.100.100.100` / enumerated common LAN hosts. The header comment in that
file documents exactly how the platform list complements the strict
client-side RFC1918/Tailscale pairing-URL validator (Android cannot express
CIDRs; the validator is the security boundary).

## Release signing (kept OUT of the repository)

```bash
bash scripts/generate-android-keystore.sh   # writes ~/.warsha/signing/{warsha-release.jks,keystore.properties}
```

`android/app/build.gradle` reads `~/.warsha/signing/keystore.properties`, or
the `WARSHA_KEYSTORE_FILE` / `WARSHA_KEYSTORE_PASSWORD` / `WARSHA_KEY_ALIAS` /
`WARSHA_KEY_PASSWORD` environment variables (CI). `assembleRelease` fails
fast with instructions when neither exists. Committing any `.jks`,
`.keystore`, `.p12` or `keystore.properties` into git is forbidden by
`SECURITY.md` and blocked by `apps/mobile/.gitignore`.

## Build

```bash
pnpm --filter warsha-remote build            # or let Gradle do it automatically
JAVA_HOME="<Android Studio JBR>" ANDROID_HOME="<SDK>" \
  apps/mobile/android/gradlew -p apps/mobile/android assembleRelease
# → apps/mobile/android/app/build/outputs/apk/release/warsha-remote-release.apk
```

`syncRemoteWebAssets` (runs before `preBuild`) copies `apps/remote/dist` into
`app/src/main/assets/public/` (gitignored; rebuilt on every assemble) and
builds `apps/remote` with pnpm first if `dist/` is missing. The WebView loads
`file:///android_asset/public/index.html`.

Verify a built APK:

```bash
"$ANDROID_HOME/build-tools/36.0.0/apksigner.bat" verify --print-certs \
  apps/mobile/android/app/build/outputs/apk/release/warsha-remote-release.apk
```

## Requirements

- JDK 17+ (the Android Studio JBR works), Android SDK platform 36 +
  build-tools 36.0.0, `local.properties` with `sdk.dir=...` (gitignored).
- `minSdk 24` — Android Keystore AES-256-GCM requires API ≥ 23; we target 24+
  for WebView security-patch coverage.
