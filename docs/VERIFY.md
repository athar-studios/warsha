# VERIFY.md — how to verify Warsha's shipped artifacts, and what counts as evidence

This is the reproduction guide for every verification claim this repository makes about the
**desktop installer** and the **Android half** (PWA + native shell). Each section names the exact
commands, the exact files they touch, and the exact output a previous run measured — so a later
reader can re-measure and compare, not just trust.

Companion documents: [`INSTALL.md`](INSTALL.md) (build/install/uninstall transcript),
[`docs/src/known-limitations.md`](src/known-limitations.md) (what is not wired),
`PROGRESS.md` and `DECISIONS.md` (the running log and reasoning; historical rows are never rewritten).

---

## 1. The shipped truth this guide verifies

| Fact | Value | Where it is defined (the source of truth) |
|---|---|---|
| Android application id / namespace | `dev.warsha.remote` | `apps/mobile/capacitor.config.json` (`appId`, `android.packageName`), `apps/mobile/android/app/build.gradle` (`namespace`, `applicationId`), Java sources `apps/mobile/android/app/src/main/java/dev/warsha/remote/*.java` (`package dev.warsha.remote;`) |
| Android app name | `Warsha Remote` (en) / `ورشة عن بُعد` (ar) | `apps/mobile/android/app/src/main/res/values/strings.xml`, `res/values-ar/strings.xml` — the manifest uses `android:label="@string/app_name"`, no hardcoded UI strings |
| Release APK artifact | `apps/mobile/android/app/build/outputs/apk/release/warsha-remote-release.apk` | `build.gradle` task `renameReleaseApk` |
| Installed desktop executable | `warsha-desktop.exe` | built at `apps/desktop/src-tauri/target/release/warsha-desktop.exe`; the NSIS install directory contains `warsha-desktop.exe` + `uninstall.exe` (measured 2026-11-05, `INSTALL.md` §5) |
| Desktop installer file | `Warsha_0.2.0_x64-setup.exe` (NSIS) | `apps/desktop/src-tauri/target/release/bundle/nsis/` |
| Auto-updater | **none configured** — `bundle.createUpdaterArtifacts: false` (`tauri.conf.json:38`) and `plugins: {}` (`tauri.conf.json:70`) | `apps/desktop/src-tauri/tauri.conf.json` |

### 1.1 Documentation consistency audit (run from the repo root)

There must be exactly one Android package name in the whole tree, and no documentation may claim a
configured updater. These greps are the audit; every one must answer as stated:

```bash
# 1) No stale Android package id anywhere (must print nothing):
grep -rn "studio\.athar" --include='*.md' --include='*.json' --include='*.gradle' \
  --include='*.java' --include='*.xml' docs apps package.json README.md README.ar.md

# 2) Every statement of the id says dev.warsha.remote:
grep -rn "dev\.warsha\.remote" docs apps/mobile | sort

# 3) The installed binary is always warsha-desktop.exe; no doc may name a bare product-name exe
#    as the binary (installer file names like Warsha_0.2.0_x64-setup.exe are different files and are fine):
grep -rn "warsha-desktop\.exe" docs | sort
grep -rn "Warsha\.exe" docs --exclude=VERIFY.md   # must print nothing (this file's own example is excluded)

# 4) No doc may present plugins.updater as configured in the shipped build. The only line docs/src/
#    may print is dated history — the changelog "Removed" entry recording that the block was deleted:
grep -rn "plugins\.updater" docs/src   # expected: only docs/src/changelog.md (Removed entry, and the
                                       # M16 entry it supersedes). Any PRESENT-TENSE claim that an
                                       # updater is configured contradicts tauri.conf.json.
                                       # known-limitations.md, security.md and quickstart.md must all
                                       # read createUpdaterArtifacts:false + plugins:{} as the truth.
```

If a doc contradicts the table above, the table wins — it reads the config files directly.
(Older `PROGRESS.md` rows describing `plugins.updater.active: true` or `createUpdaterArtifacts: true`
are the state *before* the 2026-11-05 W1 decision in `DECISIONS.md`; they are history and are kept.)

### 1.2 Updater config — one-command check

```powershell
# PowerShell: the two keys must read exactly as the shipped truth above.
node -e "const c=require('./apps/desktop/src-tauri/tauri.conf.json');
  console.log('createUpdaterArtifacts:', c.bundle.createUpdaterArtifacts);
  console.log('plugins:', JSON.stringify(c.plugins));"
```

Expected verbatim: `createUpdaterArtifacts: false` and `plugins: {}`. Consequences that follow from
this and should be stated wherever updates are discussed: **no auto-updater plugin is configured, no
updater artifacts (`latest.json`, `.sig`) are produced, `tauri build` requires no
`TAURI_SIGNING_PRIVATE_KEY`, and nothing updates itself.** Re-enabling is human-only work
(minisign key + published `latest.json`); see `DECISIONS.md` (W1, 2026-11-05) for how to reverse it.

---

## 2. Acceptable verification evidence — the bar every claim here meets

1. **Verbatim logs.** Paste the command and its complete stdout/stderr, exactly as printed — not a
   paraphrase ("it passed" is not evidence; `warsha-desktop self-check ok (zero-key FakeProvider run
   completed through ReleasePrep)` is).
2. **Exact exit codes.** Every recorded run states its exit code (`exit 0`, or the failing code).
3. **SHA-256 hashes and byte sizes** of each artifact, computed on the artifact itself
   (`Get-FileHash -Algorithm SHA256` / `sha256sum`), with the byte length alongside and the date of
   the measurement — two 64-hex strings that differ mid-string are two different builds, and the
   newest dated record is the one §4.3 claims (§4.3).
4. **No stubbing.** A verification counts only against the real artifact: the release-signed APK,
   the NSIS-installed binary, the built `dist/`, a real daemon process. Playwright's `harness.ts`
   stub daemon is fine for *UI* tests and is labelled as a stub; it is **not** evidence that the
   wire, the installer, or the APK work. Likewise `--self-check` runs the real embedded daemon and
   the real RPC surface with a zero-key `FakeProvider` — the provider is mock by design (AGENTS.md:
   no real model calls in tests), the daemon, socket, keychain and bundling are not.
5. **Dated and host-labelled.** Measurements carry the date and host they were taken on; a build
   hash is only valid for the exact commit that produced it.

---

## 3. Android — reproduce the verification

Android ships as **two things**, and a claim must name which one it rests on:

* the **`apps/remote` PWA** — fully verifiable on a host browser via `localhost` (Chrome treats
  localhost as a secure context: installability, manifest, service worker);
* the **native shell** in `apps/mobile/android` — a self-contained Gradle project (AGP 9.1.0 /
  Gradle 9.3.1, plain `android.app.Activity` + framework WebView) that hosts the built PWA from
  `file:///android_asset/public/index.html`.

### 3.1 PWA verification (localhost, no device needed)

```bash
pnpm install --frozen-lockfile
pnpm --filter warsha-remote build
node apps/remote/scripts/verify-pwa.mjs --browser
```

`verify-pwa.mjs --browser` serves the built `dist/` on `127.0.0.1` with an OS-chosen port and drives
a real browser: it asserts the manifest parses, the icons exist at the sizes the manifest claims,
and `navigator.serviceWorker.getRegistration()` actually resolves against the served build.
Measured 2026-11-05: exit 0, log line `service worker active at http://127.0.0.1:.../sw.js`
(`PROGRESS.md` Ship Run ledger).

The PWA also has browser-level *behaviour* coverage (manual pairing entry, gate actions, reconnect)
in Playwright, started by the root config's own dev servers:

```bash
npx playwright test --project=remote     # apps/remote/e2e/flows.spec.ts et al.
```

Recorded 2026-11-05: desktop + remote flows `20 passed`, exit 0.

### 3.2 Build and verify the release APK

Requirements: JDK 17+ (the Android Studio JBR works), Android SDK platform 36 + build-tools 36.0.0,
`apps/mobile/android/local.properties` with `sdk.dir=...` (gitignored). Signing material lives
**outside** the repository (`~/.warsha/signing/`, or the `WARSHA_KEYSTORE_*` environment variables in
CI); committing any `.jks`/`.keystore`/`.p12`/`keystore.properties` is forbidden by `SECURITY.md`.

```bash
# 0) once per machine, outside the repo:
bash scripts/generate-android-keystore.sh

# 1) build the bundled web app (Gradle's syncRemoteWebAssets also does this if dist/ is missing):
pnpm --filter warsha-remote build

# 2) assemble + sign the release APK (renamed to warsha-remote-release.apk by renameReleaseApk):
JAVA_HOME="<Android Studio JBR>" ANDROID_HOME="<SDK>" \
  apps/mobile/android/gradlew -p apps/mobile/android assembleRelease
# → apps/mobile/android/app/build/outputs/apk/release/warsha-remote-release.apk

# 3) verify the signature and print the signing certificate:
"$ANDROID_HOME/build-tools/36.0.0/apksigner.bat" verify --verbose --print-certs \
  apps/mobile/android/app/build/outputs/apk/release/warsha-remote-release.apk

# 4) verify the manifest truth as the platform sees it (package id, label, permissions, deep link):
"$ANDROID_HOME/build-tools/36.0.0/aapt2.exe" dump badging \
  apps/mobile/android/app/build/outputs/apk/release/warsha-remote-release.apk | head -40
```

What must come back:

* Step 3: `Verified using v2 scheme (APK Signature Scheme v2): true`, exit 0. Measured 2026-11-05:
  exit 0 with signing certificate SHA-256
  `ad2708e486a68590db9b1ee54e7dfad547759b20f399c16cc6eaad059ce7f3c3` (RSA-4096), APK 1,280,713 bytes
  (`PROGRESS.md` Ship Run ledger, W2).
* Step 4: `package: name='dev.warsha.remote'` — the single shipped application id (§1); `label`
  resolves to `Warsha Remote` / `ورشة عن بُعد` via `@string/app_name`;
  `uses-permission: 'android.permission.INTERNET'` and `'android.permission.CAMERA'` with
  `uses-feature: 'android:hardware_camera'` `required="false"`; launchable-activity
  `dev.warsha.remote/.MainActivity`; and the `warsha://pair` intent filter visible in
  `dump badging` / `dump xmltree` output.
* `assembleRelease` **fails fast** (nonzero exit, with instructions) when no signing material is
  present — that refusal is itself the expected evidence that unsigned release artifacts cannot
  leak from this build.

### 3.3 Cleartext network-security-config verification

The policy lives in
`apps/mobile/android/app/src/main/res/xml/network_security_config.xml` and is wired via
`android:networkSecurityConfig="@xml/network_security_config"` plus
`android:usesCleartextTraffic="false"` in `AndroidManifest.xml`. Checks:

```bash
# a) The manifest binds the config and forbids global cleartext (both lines must appear):
grep -n "networkSecurityConfig\|usesCleartextTraffic" \
  apps/mobile/android/app/src/main/AndroidManifest.xml

# b) Well-formed, with the deny-by-default base and the expected allow-list classes:
grep -n "base-config" \
  apps/mobile/android/app/src/main/res/xml/network_security_config.xml
# must show: <base-config cleartextTrafficPermitted="false" />
grep -c "<domain " apps/mobile/android/app/src/main/res/xml/network_security_config.xml
# loopback + emulator host + Tailscale + mDNS/wildcards + the enumerated LAN hosts
```

Static truth (read 2026-11-05): the file permits cleartext **only** to `127.0.0.1`, `localhost`,
`10.0.2.2` (emulator host gateway), `100.100.100.100`, `*.ts.net`, `*.local`, `10.0.0.1`, and the
enumerated ranges `192.168.0.1–254` / `192.168.1.1–254` — i.e. loopback and LAN endpoints. The
header comment documents why: Android cannot express CIDRs, so the client-side RFC1918/Tailscale
pairing-URL validator (`apps/remote`) is the real security boundary and this file is the
platform-level exception for validator-approved local traffic. `debug-overrides` trusts user CAs in
debug builds only; release builds never include that block.

On-device behaviour (connect to a loopback/LAN daemon over `http://`, and confirm a public
`http://` host is refused) requires an emulator or phone — deferred, see §5.

---

## 4. Desktop — verify the NSIS installer on Windows

Full transcript in [`INSTALL.md`](INSTALL.md) §§2–5; this is the reproduction sequence with the
evidence bar from §2 applied.

### 4.1 Build

```bash
pnpm install --frozen-lockfile
pnpm --filter warsha-desktop tauri build --bundles nsis
```

Produces `apps/desktop/src-tauri/target/release/warsha-desktop.exe` and
`apps/desktop/src-tauri/target/release/bundle/nsis/Warsha_0.2.0_x64-setup.exe`. No
`TAURI_SIGNING_PRIVATE_KEY` is read or required (consistent with §1.2).

### 4.2 Silent install and self-check (run exactly like this)

```powershell
# Silent install into a scratch directory. /D= must be LAST and unquoted.
Start-Process -FilePath "...\bundle\nsis\Warsha_0.2.0_x64-setup.exe" `
  -ArgumentList '/S', '/D=C:\Users\<user>\warsha-nsis-test\install' -Wait -PassThru
# expected: exit code 0; the directory then contains warsha-desktop.exe and uninstall.exe
```

(From `cmd.exe`, call `%WINDIR%\System32\cmd.exe` by full path — an npm shim named `cmd` on the
`PATH` produced a nonsense `too many arguments` error on the measurement host; see `INSTALL.md` §5.)

```powershell
# Verify the INSTALLED binary against a scratch data dir (never %APPDATA%\warsha):
& "C:\Users\<user>\warsha-nsis-test\install\warsha-desktop.exe" `
  --self-check --data-dir "C:\Users\<user>\warsha-nsis-test\data"
```

Expected verbatim tail (measured 2026-11-05 from the installed binary, exit 0 — full block in
`INSTALL.md` §3):

```text
PASS  an authorized JSON-RPC call answers
PASS  a wrong token is refused
PASS  the webview's CORS preflight is answered
PASS  GET /health on the daemon's HTTP port answers 200 with a healthy status
PASS  projects.create creates the smoke project
PASS  runs.start starts the smoke run at the Idea stage
PASS  gates.approve records the Gate A decision over RPC
PASS  runs.advance walks Idea -> GateA -> Research -> PrdSpec on the zero-key FakeProvider
PASS  the smoke run is waiting at Gate B
PASS  zero-key FakeProvider run produced research and prd_spec artifacts
daemon stopped (children reaped, lock released)
warsha-desktop self-check ok (zero-key FakeProvider run completed through ReleasePrep)
```

Uninstall (also measured exit 0, `INSTALL.md` §5):

```powershell
& "...\install\uninstall.exe" /S "_?=C:\Users\<user>\warsha-nsis-test\install"   # keeps uninstall.exe itself
Start-Process -FilePath "...\install\uninstall.exe" -ArgumentList '/S' -Wait     # full removal
```

### 4.3 Recorded hashes — current measurement (2026-11-08)

| Artifact | Size | SHA-256 as recorded | Source of the record |
|---|---|---|---|
| `warsha-desktop.exe` | 25,215,488 B | `f3549485798919c9d81627d52e34c4a897483a3b4483fadfb0590ed45be0e7a9` | `INSTALL.md` §2 (English table), measured 2026-11-08 |
| `Warsha_0.2.0_x64-setup.exe` | 6,864,766 B (6.55 MiB) | `294b8e259e88c804275154e8f3bd4ba4e957b15eb912cff3e7f2b9cbb4aabd99` | `INSTALL.md` §2, measured 2026-11-08 |
| `warsha-remote-release.apk` | 1,280,713 B | (file hash not recorded; cert SHA-256 `ad2708e4…f3c3`) | `PROGRESS.md` ledger W2 |

The 2026-11-08 build supersedes the earlier measurements; the values below are kept as history so a
reader who finds an older number in a commit can identify which build it belonged to.

**History — 2026-11-05 build (superseded):** `warsha-desktop.exe` 23,673,856 B
(`087f31a6298e26539c04b9d147b2849073bee5b38f40163c1c343de14ac3a47e`), NSIS installer 6,487,879 B
(recorded twice in the ledgers as `7e9c35d9433c86570fa399daf6bbfabe2c5984d0985a170e948e61d32c88369e`
and `7e9c35d99fe9f346b9228bf25e7a480a710a6ab426a4708a3dbcb3d06262369e`). Those artifacts are no
longer on disk and the 2026-11-08 rebuild produced different sizes and hashes, so the current table
above is the only set this guide claims as the shipped build.

---

## 5. GAP 5 — emulator / device verification: deferred items, stated plainly

Everything below was **logged as deferred** because the verification host (a headless-style Windows
/Linux maintenance setup with no attached Android hardware) cannot honestly produce it. Each entry
says what is deferred, why, and what *was* covered instead. None of these may be claimed green until
a device or emulator is attached and §3's steps are run on it.

### 5.1 Physical Android device / emulator hardware testing — **DEFERRED**

* **What would close it:** install the §3.2 release APK on a physical phone or a running
  AVD/emulator (`adb install -r`), launch it, and complete a real pairing + gate-approval round
  trip against a daemon on the LAN (loopback via `10.0.2.2` on an emulator).
* **Why deferred:** no Android device is attached to the verification hosts, and no emulator is
  installed or runnable there (recorded in `DECISIONS.md` 2026-11-04, "Android is scoped as a PWA by
  this repo itself": `adb`/`emulator` absent; and the 2026-11-05 ledger's owner-blocked list:
  "physical Android hardware pairing"). An APK *build* and *signature verification* were completed
  on the host (§3.2) — running it on Android hardware was not.
* **What localhost PWA verification covered instead:** everything that is provable without a
  device — the built `dist/` contents, manifest validity against the icon files, a real
  `serviceWorker.getRegistration()` hit against the served build via `verify-pwa.mjs --browser`
  (exit 0, 2026-11-05), and the Playwright remote flows including the manual pairing path. These
  prove the *web layer* Warsha will ship inside the WebView; they do **not** prove WebView
  behaviour, Keystore sealing on a real TPM-backed key, deep-link delivery from the launcher, or
  cleartext policy enforcement by the platform. Any "Android works" claim must state which half it
  rests on (`DECISIONS.md` 2026-11-04).

### 5.2 QR-code hardware camera scan — **DEFERRED**

* **What would close it:** on a device, tap scan, grant `CAMERA`, and have `getUserMedia` +
  the QR decode actually complete a pairing.
* **Why deferred:** no physical camera device on the host (§5.1 covers the device half); the
  permission flow itself is exercised only at code level in the shell
  (`MainActivity` runtime `CAMERA` request, `WarshaNative.requestCameraPermission()`).
* **What was tested instead (software fallback):** the shell's documented degradation path — on
  denial the `warsha:camera-permission` CustomEvent carries `fallback: "manual_code_and_url"`
  (`MainActivity.java:195-197`), and the web app's manual pairing entry (paste the pairing link /
  type the code) is covered by the remote Playwright flow *"a pairing link typed by hand becomes a
  session, and leaves the address"* (`apps/remote/e2e/flows.spec.ts`, recorded PASS in the 2026-11-05
  run) plus the `warsha://pair` deep-link handling unit tests (`apps/remote/src/App.test.tsx`). The
  manifest declares the camera `required="false"` precisely so the fallback is a supported path,
  not a dead end.

### 5.3 Small fixes found while verifying the mobile shell — **DONE on host, static**

Two items surfaced during shell review were fixed and re-read on the host (static verification only;
on-device rendering of the Arabic label still rides on §5.1):

* **String catalogs complete:** `res/values/strings.xml` (`Warsha Remote`) and
  `res/values-ar/strings.xml` (`ورشة عن بُعد`) both exist, carry the same key set (`app_name`), and
  the manifest uses `@string/app_name` with `android:supportsRtl="true"` — no hardcoded UI strings
  in the shell.
* **Cleartext policy allows loopback and LAN endpoints:** `network_security_config.xml` denies
  cleartext by default and permits exactly the local/emulator/LAN/Tailscale hosts listed in §3.3;
  `AndroidManifest.xml` wires the config and sets `usesCleartextTraffic="false"`. Verified by the
  §3.3 greps on 2026-11-05 (file content as stated).

### 5.4 Deferred-item summary

| Item | Status | Real test that closes it | Closest evidence on host today |
|---|---|---|---|
| Device/emulator run of the APK | deferred (§5.1) | `adb install -r` + pairing round trip | signed APK + `apksigner verify` v2 true; localhost PWA proofs |
| QR camera scan | deferred (§5.2) | physical scan → session | `manual_code_and_url` fallback tested in software (Playwright + unit) |
| Platform cleartext enforcement | deferred (needs §5.1 runtime) | connect allowed + blocked host from device | static read of `network_security_config.xml` (§3.3) |
| Arabic app name on device | deferred (§5.1) | launcher label on an Arabic-locale device | complete `values-ar/strings.xml` + `supportsRtl` (§5.3) |
