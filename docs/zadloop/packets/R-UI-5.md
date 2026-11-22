# R-UI-5 — T3 Android smoke (apps/mobile on a local emulator)

Status: spec frozen. Base: `d8dc8d3` (repair/dev-csp-f474776). Depends on R-UI-1–3 + R-UI-4B (merged).
Scope: **T3 only.** T2 Windows capture stays deferred (needs a Windows CI runner; billing-blocked) — it is
not in this packet and must be reported as "unverified/deferred", never as green.

## Why

`apps/mobile` (package `dev.warsha.remote`, pure `android.app.Activity` + framework WebView hosting the
built `apps/remote` PWA from `file:///android_asset/public/index.html`) has never been proven to *boot on
Android*. Everything above it is covered on a desktop browser (Playwright `--project=remote`, vitest), and the
native bridge (`WarshaNative`: Keystore vault, `getInitialPairingUri`, camera permission) is covered only by
vitest fakes (`apps/remote/src/App.test.tsx`, `session.test.ts`). VERIFY.md §3.2 proves a *signed release APK
builds*, not that it launches. The cleartext policy (`network_security_config.xml`), the `file://` origin vs the
page CSP (`connect-src 'self' http://127.0.0.1:8765 ws://127.0.0.1:8766 …`), and the cold/warm
`warsha://pair` paths are exactly the things only a real WebView can falsify.

## Goal

One scripted, repeatable smoke that, on a local emulator, proves: (1) the debug APK builds; (2) the app boots
without crash/ANR; (3) the pairing plate renders; (4) a `warsha://pair` deep link (cold start) against a
loopback daemon pairs and the bench ("what awaits you") renders; (5) no `FATAL EXCEPTION`/`AndroidRuntime`
entry and no leaked token in logcat. Evidence = screenshots + logcat + a one-page report. No product change.

## Measured inputs (this host, 2026-11-14, read-only)

- `adb` = `~/Android/Sdk/platform-tools/adb`; `emulator` = `~/Android/Sdk/emulator/emulator`; both on PATH.
  `ANDROID_HOME=ANDROID_SDK_ROOT=/home/moe/Android/Sdk`. `adb devices` → empty list (daemon was started by the
  check; no emulator running). `emulator -list-avds` → `Athar_GPlay`, `Pixel_7_API_35`.
- Both AVDs: `system-images/android-35/google_apis_playstore/x86_64`, 2 GB RAM (the only image installed).
  Host: 12 cores, 30 GB RAM, `/dev/kvm` present and the user is in group `kvm`.
- SDK: platforms 34/35/36, build-tools 35.0.1/36.0.0/36.1.0 (36.0.0 + platform 36 are what `app/build.gradle`
  needs: `compileSdk 36`, `targetSdk 35`, `minSdk 24`, AGP 9.1.0, Gradle 9.3.1).
- JDK 17 (`/usr/lib/jvm/java-17-openjdk-amd64`, = `JAVA_HOME`). Gradle `9.3.1-all` already in `~/.gradle/wrapper/dists`;
  AGP 9.1.0 is in the Gradle module cache (so the build may work offline; do not assume — see STOP).
- `apps/mobile` has **no package.json / no JS tests**; it is a Gradle project only. No `androidTest`/`test` dirs
  exist. `local.properties` absent (gitignored) — use `ANDROID_HOME`. `~/.warsha/signing` absent → **release
  build is impossible here and not needed**; the smoke uses `assembleDebug` (debug keystore `~/.android/debug.keystore` exists).
- `apps/remote/dist` is already built (`index.html`, `assets/`, `icons/`); Gradle's `syncRemoteWebAssets`
  nevertheless always runs `pnpm --filter warsha-remote build` first.
- `target/debug/warshad` exists. Daemon flags: `--http-port` (8765) `--ws-port` (8766) `--bind-host` `--config`;
  registers a `mock` provider (no network model calls). `/health` needs no token.
- Deep-link shapes accepted by the PWA (`session.ts parseDeepLink`): `warsha://pair?server=<urlenc>&token=…` or
  `host=&port=&token=[&scheme=]`; http only to private/loopback hosts (`10.0.2.2` ok).
- Stable test ids to assert on: pairing `remote-pair-submit`; post-pair `remote-screen-projects`, `remote-nav`,
  `remote-topbar`; run `remote-screen-run`.

## Design (frozen decisions)

- **D1 (mechanism):** scripted `adb` launch + `uiautomator dump`/`screencap`/`logcat` — **no instrumented test
  module, no androidx/Espresso** (the shell deliberately has no androidx; adding test deps is a product-config
  change). WebView content is not in the uiautomator tree reliably, so page state is asserted via the WebView
  DevTools socket (D3) and screenshots as evidence.
- **D2 (network):** the daemon stays bound to loopback. Reach it from the emulator with
  `adb reverse tcp:8765 tcp:8765` and `adb reverse tcp:8766 tcp:8766`, and pair with
  `warsha://pair?host=127.0.0.1&port=8765&token=<tok>`. This matches the page CSP `connect-src` and the
  network-security-config loopback allowance without widening `--bind-host`. (`10.0.2.2` would require binding
  non-loopback — rejected.)
- **D3 (assertions):** the debug build is not WebView-debuggable by code (`setWebContentsDebuggingEnabled` is
  not called; no product edit allowed). The default `android:debuggable` debug APK **does** enable WebView
  DevTools on API ≥ 19 for debuggable apps — the script reads `adb shell cat /proc/net/unix | grep
  webview_devtools_remote`, forwards it, and queries `/json` (title/URL) and, if reachable, evaluates
  `document.querySelector('[data-testid=remote-screen-projects]') !== null` over the CDP websocket (node ≥ 22
  global `WebSocket`; no new deps). If DevTools is unreachable on this image the packet **falls back** to
  screenshot + logcat evidence and marks assertion (4) "visual only" in the report — never silently green.
- **D4 (token hygiene):** the token is generated by the run (`warshad --config <tmp>/config.toml`, read from
  that tmp config) and never echoed; the script greps logcat and its own logs for it and fails on a hit.
- **D5 (isolation):** daemon uses a temp config/data dir under `target/r-ui-5/`; emulator runs `-no-snapshot-save
  -wipe-data` on a **copy-free** boot (wipes AVD userdata only — see Constraints on which AVD).
- **D6 (AVD choice):** primary `Pixel_7_API_35` (stock phone profile); second pass = the same smoke on
  `Athar_GPlay`, default device locale. No device-locale changes (invasive; the shell has no per-app locale API);
  RTL is observed in the screenshots (the PWA renders Arabic/`dir="rtl"` by default).

## Allowed files

- `scripts/android-smoke.sh` (new; bash, `set -euo pipefail`) and `scripts/android-smoke.mjs` (new; only if D3
  CDP evaluation needs it).
- `docs/zadloop/packets/R-UI-5-report.md` (new), `docs/VERIFY.md` §3 (add §3.3 "Emulator smoke" pointing at
  the script; no other edits), `PROGRESS.md` entry.
- Outputs only under `target/r-ui-5/` (gitignored `target`): APK copy, `*.png`, `logcat.txt`, `daemon.log`.

## Out of scope

Any change under `apps/mobile/**`, `apps/remote/**`, `crates/**`, `packages/**`; release signing/keystores;
T2 Windows capture / `.github/workflows`; instrumented tests / androidx; Play Store; real camera/QR scan
(camera permission path is observed only as "no crash if requested", not exercised); real model APIs; pushing,
tagging, publishing; installing/removing SDK components or system images; creating or deleting AVDs.

## Constraints

Isolated worktree, `zl-ui5-*` branch from the post-R-UI-4B tip; implementer never edits gates after freezing;
reviewer and verifier separate; mock provider only; no secrets in logs/commits; no screenshot committed (they
live in `target/`); small Conventional Commits; no force push. Run emulators **headless**
(`-no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect`, KVM accel); the script must
`adb emu kill` and `adb kill-server` on exit (trap) and never leave an emulator or daemon running. Use
`-no-snapshot` and **do not pass `-wipe-data`** to `Athar_GPlay` (owner's AVD may hold state): use
`Pixel_7_API_35` with `-wipe-data` only after confirming with `adb devices` that no other emulator is up;
for `Athar_GPlay` install/uninstall only `dev.warsha.remote` (`adb uninstall` at start, so first-launch is clean).
Build output goes through `./gradlew` from `apps/mobile/android` — never modify `build.gradle`/`gradle.properties`.

## Steps

1. Preflight (read-only, record in the report): `adb version`, `emulator -version`, `emulator -list-avds`,
   `adb devices`, `java -version`, `ls /dev/kvm`, free RAM ≥ 6 GB, free disk ≥ 10 GB.
2. Build the web bundle + debug APK:
   `pnpm install --frozen-lockfile && pnpm --filter warsha-remote build`
   `cd apps/mobile/android && ANDROID_HOME=$HOME/Android/Sdk JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ./gradlew assembleDebug --no-daemon`
   → `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` (copy to `target/r-ui-5/`).
   Then `git status --short apps/` must be empty of tracked changes (`assets/public` and `build/` are gitignored).
3. Start the daemon: `target/debug/warshad --foreground --config target/r-ui-5/cfg/config.toml --http-port 8765
   --ws-port 8766` (build with `cargo build -p warshad` only if the binary is missing/stale); wait for
   `curl -fsS http://127.0.0.1:8765/health`.
4. Boot the emulator: `emulator -avd Pixel_7_API_35 -no-window -no-audio -no-boot-anim -no-snapshot -wipe-data
   -gpu swiftshader_indirect -accel on &`; wait `adb wait-for-device` then poll
   `adb shell getprop sys.boot_completed` = `1` (timeout 240 s).
5. `adb reverse` both ports (D2); `adb install -r target/r-ui-5/app-debug.apk`; `adb logcat -c`.
6. **S1 boot:** `adb shell am start -W -n dev.warsha.remote/.MainActivity`; assert `Status: ok`, then after
   5 s `adb shell pidof dev.warsha.remote` non-empty; screenshot `s1-boot.png`; assert the pairing plate (DevTools
   query for `[data-testid=remote-pair-submit]`, else visual).
7. **S2 cold deep link:** `adb shell am force-stop dev.warsha.remote`; launch
   `adb shell am start -W -a android.intent.action.VIEW -d "warsha://pair?host=127.0.0.1\&port=8765\&token=$TOK" dev.warsha.remote`;
   assert `remote-screen-projects` (or `remote-nav`) present within 15 s; screenshot `s2-paired.png`.
8. **S3 warm deep link:** with the app foregrounded, send a second VIEW intent (singleTask → `onNewIntent`);
   assert process unchanged (same pid), still paired, no crash.
9. **S4 core screens:** from the paired state tap through nav (via DevTools `.click()` on `[data-testid=remote-nav] a`
   or `adb shell input tap` at coordinates read from `uiautomator dump`): Projects, a Run screen if a project
   exists (the daemon is empty: create one through the app's `remote-create-project-form` is **not** done — an
   empty Projects state is a valid render), Gates/Needs-you, Settings; screenshot each (`s4-*.png`). Pass = each
   renders without crash and without the `remote-session-ended`/error plate.
10. **S5 negative:** `warsha://pair?host=8.8.8.8&token=x` must show the pairing refusal (public cleartext host),
    not pair and not crash.
11. Logcat gate: `adb logcat -d -b crash` empty; `adb logcat -d | grep -E "FATAL EXCEPTION|ANR in dev.warsha|Process: dev.warsha.remote.*died"` empty;
    `grep -c "$TOK"` over logcat+daemon.log+script output = 0.
12. Repeat steps 4–11 on `Athar_GPlay` (no `-wipe-data`; D6/Constraints). Teardown (trap): `adb emu kill`, kill
    daemon, `adb kill-server`. Write `R-UI-5-report.md` with every command's exit code and the artifact list.

## Gate commands (exact; all must exit 0)

```bash
pnpm --filter warsha-remote build
pnpm --filter warsha-remote test            # vitest: still green, nothing touched
cd apps/mobile/android && ANDROID_HOME=$HOME/Android/Sdk JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ./gradlew assembleDebug --no-daemon
bash scripts/android-smoke.sh --avd Pixel_7_API_35 --report target/r-ui-5/pixel7.json
bash scripts/android-smoke.sh --avd Athar_GPlay    --report target/r-ui-5/athar.json
node -e "for (const f of ['pixel7','athar']) { const r=require('./target/r-ui-5/'+f+'.json'); if (r.failed!==0||r.crashes!==0||r.tokenLeaks!==0) process.exit(1) }"
git diff --name-only d8dc8d3 -- apps crates packages    # must print nothing
node scripts/check-engineering-policy.mjs
```

`android-smoke.sh` exits non-zero on any failed step and always writes the report JSON
(`{avd, steps:[{id,pass,mode:"devtools"|"visual"}], failed, crashes, tokenLeaks}`). A step marked `visual` is
reported as such and counts as pass only for S1/S4 appearance, never for the S2 pairing assertion.

## STOP rules

- `adb devices` lists nothing **and** the emulator fails to reach `sys.boot_completed=1` in 240 s on both AVDs
  (or `emulator` exits with a KVM/HAXM/hardware-accel error, missing system image, or `PANIC`): **STOP**, write
  the report with verdict "T3 unrunnable on this host" + the emulator's stderr tail. Do not switch to
  software-only `-accel off` (far too slow to be a signal), do not install SDK components, do not create AVDs.
- Gradle cannot resolve dependencies (network blocked and cache incomplete): STOP with the resolver error;
  do not edit `build.gradle`, do not add repositories or pin versions.
- A device other than the emulator you started appears in `adb devices` (physical phone): never target it;
  always pass `-s emulator-5554`; if the serial differs, STOP.
- The app crashes on boot or pairing fails against a correct deep link: that is a **finding**, not a repair
  task — capture logcat/screenshot, STOP, report; no product edit inside this packet.
- Smoke needs any file outside Allowed files: STOP and report the overlap.
- Anything touching T2 / `.github/workflows` / CI billing: out of scope; STOP.
