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
`app/src/main/assets/public/` (gitignored; rebuilt on every assemble) and always
builds `apps/remote` with pnpm before syncing. The WebView loads
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

## Release artifact (v0.2.0 dated record)

Built and signed locally for run `2026-11-08-design-and-remediation` (packet W7, v0.2.0 dated record).
The APK is **not** committed (it is gitignored build output); only its facts are
recorded here. Signing used the owner-scoped release material in `~/.warsha/signing/`
(RSA-4096, APK Signature Scheme v2). No signing secret is stored in the repository
or in this file.

- Artifact (gate path): `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
- Friendly-named identical copy: `apps/mobile/android/app/build/outputs/apk/release/warsha-remote-release.apk`
  — `renameReleaseApk` now **copies** rather than moves, so both names exist; the
  copy is the artifact `docs/VERIFY.md` and `docs/INSTALL.md` reference, while
  `app-release.apk` is the path the W7 release gates verify.
- File size: **842,981 bytes**
- Base commit: `0772d502002562505c6438ae712abca7a7328d84` (`run/2026-11-08/integration`)

SHA-256 (`app-release.apk`; identical for `warsha-remote-release.apk`):

```text
6a4681852c53f01294159b1d6a905ddb8b32ab968d68fbefcd50a93eae2700ef
```

> Reproducibility: the signed APK **is** byte-reproducible. Two consecutive clean
> rebuilds (`pnpm --filter warsha-remote build` + `gradlew clean assembleRelease`)
> produced this exact hash and size. The APK Signature Scheme v2 block is
> deterministic (RSASSA-PKCS1-v1_5 + SHA2-512, algorithm id `0x0104` — no PSS salt),
> and `build.gradle` removes the two inputs that used to drift: AGP's encrypted
> dependency-metadata block (`dependenciesInfo { includeInApk = false }`) and the
> Vite/workbox `*.map` source maps, which embed a random temp directory and absolute
> worktree paths (`syncRemoteWebAssets` excludes `**/*.map`; the precache manifest
> in `sw.js` lists no map).

Toolchain: node v26.8.1, pnpm 9.0.0, Android Studio JBR OpenJDK 25.0.3,
Gradle 9.3.1, AGP 9.1.0, Android SDK platform 36 + build-tools 36.0.0.

`apksigner verify --verbose --print-certs` verdict: **Verifies** (exit 0) — v2
scheme `true`; Signer #1 `CN=Warsha Remote, OU=Engineering, O=Warsha, L=Riyadh, C=SA`;
certificate SHA-256 `ad2708e486a68590db9b1ee54e7dfad547759b20f399c16cc6eaad059ce7f3c3`.
The bundled web assets `assets/public/index.html` and `assets/public/sw.js` are
present inside the APK (synced from `apps/remote/dist` by `syncRemoteWebAssets`).

Reproduce (repo root, Git Bash, owner signing material present):

```bash
pnpm install --frozen-lockfile
pnpm --filter warsha-remote build
JAVA_HOME="<Android Studio JBR>" ANDROID_HOME="<SDK>" \
  apps/mobile/android/gradlew -p apps/mobile/android clean assembleRelease --no-daemon
APK=apps/mobile/android/app/build/outputs/apk/release/app-release.apk
"$ANDROID_HOME/build-tools/36.0.0/apksigner.bat" verify --verbose --print-certs "$APK"
unzip -l "$APK" | grep -E 'assets/public/(index\.html|sw\.js)$'   # → 2 entries
stat -c %s "$APK"                                                 # → 842981
sha256sum "$APK"                                                  # → hash above
```
