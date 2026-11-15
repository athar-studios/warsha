# R-UI-5 report — T3 Android smoke (STOPPED: product finding, no product edit)

Coder lane. Worktree `.agents/worktrees/zl-rui5-smoke`, branch `zl-rui5-smoke`, cut from `e435a8a`
(`repair/dev-csp-f474776`, the packet commit; the packet's frozen base `d8dc8d3` is its ancestor).
Reviewer and verifier are separate roles and have not run.

**Verdict: STOP — T3 is red on this host because the shipped Android shell renders nothing.**
The debug APK builds (with one pre-existing build-script blocker, B2 below), installs and boots
cleanly (`Status: ok`, process alive, no crash/ANR), and the DevTools/loopback machinery works — but
the WebView never executes the bundled page, so there is no pairing plate, no pairing, no screens
and no refusal plate to assert. That is the finding the packet asked a real WebView for; fixing it
needs product files this packet forbids, so nothing under `apps/`, `crates/` or `packages/` was
touched (`git diff --name-only d8dc8d3 -- apps crates packages` prints nothing).

## Commits

| #   | Commit    | Subject                                                  |
| --- | --------- | -------------------------------------------------------- |
| 1   | `d63054b` | `feat(smoke): add the T3 Android smoke script (R-UI-5)`  |
| 2   | `c7d7146` | `docs(verify): add §3.4 pointing at the emulator smoke`  |
| 3   | `8a83f94` | `fix(smoke): make the DevTools probe fail loudly, not silently` |
| 4   | this file | `docs(zadloop): R-UI-5 report — T3 stopped on a product finding` |

## Finding F1 — the bundled page does not load under `file://` (product, out of scope)

On both AVDs the activity starts, the process stays alive and the WebView reaches
`readyState: complete`, but `#root` is empty. The WebView's own console (captured in
`s1-console.txt`, and in `logcat.txt`) states both halves of the cause:

```
Access to script at 'file:///assets/index-DxbOVwyV.js' from origin 'null' has been blocked by
CORS policy: Cross origin requests are only supported for protocol schemes: http, data, chrome,
https, chrome-untrusted.
Access to CSS stylesheet at 'file:///assets/index-B9O2b0Lu.css' from origin 'null' has been
blocked by CORS policy: …
```

The page state through CDP is the same on both AVDs:

```json
{"url":"file:///android_asset/public/index.html","readyState":"complete","rootHtmlLength":0,
 "scripts":["file:///assets/index-DxbOVwyV.js"],"resources":[]}
```

1. **Root-absolute asset URLs.** The built `apps/remote/dist/index.html` names `/assets/index-*.js`,
   `/assets/index-*.css` and `/manifest.webmanifest` (Vite's default base). Loaded from
   `file:///android_asset/public/index.html`, an absolute path resolves to `file:///assets/…`
   (verified with the same URL rules: `new URL('/assets/x.js','file:///android_asset/public/index.html')`
   → `file:///assets/x.js`), which is neither the document directory nor the APK's asset tree.
2. **Module scripts cannot load from `file://` at all.** Even with relative URLs, `<script
   type="module">` from a `file://` document has origin `null` and Chromium refuses it (the CORS line
   above). The shell would need a `WebViewAssetLoader` origin (e.g.
   `https://appassets.androidplatform.net`) or a non-module bundle — a product decision outside this
   packet's allowed files.

The daemon this run started received **no RPC request** (`daemon.log` holds only the four startup
lines), so the cold/warm pairing paths, the screens and the refusal plate are unreachable: S2–S5 were
not run because the packet's STOP rule applies at S1.

## Steps (packet steps 4–11, step 12 repeated per AVD)

| Step | `Pixel_7_API_35` | `Athar_GPlay` | Mode | Evidence |
| ---- | ---------------- | ------------- | ---- | -------- |
| S1 boot | **fail** — `Status: ok`, pid 2684 alive after 5 s, no crash, but no `remote-pair-submit` | **fail** — `Status: ok`, pid 1925 alive after 5 s, no crash, plate not proven | Pixel: devtools; Athar: visual (CDP silent) | `s1-boot.png`, `s1-start.txt`, `s1-page.txt`, `s1-console.txt` |
| S2 cold `warsha://pair` | not reached (STOP at S1) | not reached | — | — |
| S3 warm deep link | not reached | not reached | — | — |
| S4 screens | not reached | not reached | — | — |
| S5 public-host refusal | not reached | not reached | — | — |
| Logcat + token gate (step 11) | measured at teardown: crash buffer empty, 0 `FATAL EXCEPTION`/`ANR in dev.warsha`/`Process: … died`, `tokenLeaks 0` | same | — | `logcat.txt`, `logcat-crash.txt`, `daemon.log`, `script.log` |

What did work, and is worth recording: the debug build exposes `webview_devtools_remote_<pid>`
(D3's mechanism) — on `Pixel_7_API_35` the CDP assertions ran end to end and produced the page state
above; on `Athar_GPlay` `/json` answered and the page target was found, but every
`Runtime.evaluate` returned an empty reply (empty node stderr too), so that pass is reported
`mode: "visual"` with the plate *not* proven — its finding rests on `s1-console.txt`/`logcat.txt`,
the screenshot, the empty `#root` state seen on the Pixel image and the daemon's zero traffic. Also
working: `adb reverse` carried the page's 8765/8766 to the daemon, the daemon answered `/health`, the
APK installed with `Success`, and no token reached any log (`tokenLeaks: 0`; `am start` output is
redacted before it is written).

Report JSONs: `target/r-ui-5/pixel7.json`, `target/r-ui-5/athar.json` — both
`{"failed":1,"crashes":0,"tokenLeaks":0}` with `stopReason` naming the S1 finding; the Athar pass
records `mode: "visual"` and an `s1-page.txt` of `ERR` for the CDP silence noted above.

## Blocks and deviations (all outside the packet's allowed files)

- **B1 — `gradlew` is not executable in git.** `git ls-files -s` says `100644` (also in the shared
  checkout), so the packet's exact build gate dies instantly:
  `./gradlew assembleDebug --no-daemon` → `Permission denied`, exit `126`. Fixing it means a mode
  change under `apps/`, which the diff gate forbids; not done.
- **B2 — `apps/mobile/android/app/build.gradle:128` calls `Task.exec {}`**, removed in Gradle 9 (the
  wrapper is 9.3.1). `bash ./gradlew assembleDebug --no-daemon` → `BUILD FAILED`,
  `Could not find method exec() … on task ':app:syncRemoteWebAssets'`, exit `1`. `build.gradle` is
  explicitly out of scope; not edited.
- **B3 — how the APK under test was produced.** To still run the smoke, `apps/remote/dist` was
  rsynced into `apps/mobile/android/app/src/main/assets/public/` (both gitignored — the same copy
  `syncRemoteWebAssets` performs) and the build skipped that one task:
  `bash ./gradlew assembleDebug --no-daemon -x syncRemoteWebAssets` → exit `0`, 1,842,439-byte
  `app-debug.apk`, verified to contain `assets/public/index.html` and its bundle. This is not a gate
  pass: the packet's gate command itself fails at B1/B2.
- **B4 — host ports 8765/8766 were already taken** by a foreign daemon
  (`warshad --config /var/lib/warsha/config.toml … --bind-host 0.0.0.0`, running since 2026-11-14).
  It was left untouched. This run's throwaway daemon bound `127.0.0.1:18765/18766` and
  `adb reverse tcp:8765 tcp:18765` / `tcp:8766 tcp:18766` kept the page-facing ports exactly the
  8765/8766 the CSP and cleartext policy allow — D2's rule (daemon stays on loopback, no
  `--bind-host` widening) is unchanged.
- **B5 — section number.** `docs/VERIFY.md` §3.3 is already *"Cleartext network-security-config
  verification"*, so the packet's "add §3.3 Emulator smoke" is §3.4 in the same section. No other
  VERIFY.md edit; §5 still lists the device gap as deferred, which stays true.
- **B6 — `PROGRESS.md` not updated.** The packet allows an entry, but this session's dispatch
  instruction forbids touching `PROGRESS.md`; the instruction wins and the omission is reported here.
- **S2–S5 code paths are unexercised.** The script stops at S1 per the packet, so the cold/warm
  pairing, nav-click and refusal assertions have not been run on a device yet. They are written but
  unproven; re-running on a fixed shell is the next step, not a green claim.

## Gate commands (packet's exact commands, from the worktree root)

| Gate | Command | Exit | Result |
| ---- | ------- | ---- | ------ |
| build | `pnpm --filter warsha-remote build` | 0 | built |
| tests | `pnpm --filter warsha-remote test` | 0 | 16 files, 221/221 |
| APK | `cd apps/mobile/android && … ./gradlew assembleDebug --no-daemon` | **126** | B1 (`Permission denied`) |
| APK (same script) | `bash ./gradlew assembleDebug --no-daemon` | **1** | B2 (`syncRemoteWebAssets`, Gradle 9 `exec`) |
| smoke 1 | `bash scripts/android-smoke.sh --avd Pixel_7_API_35 --report target/r-ui-5/pixel7.json` | **1** | F1, S1 fail, STOP |
| smoke 2 | `bash scripts/android-smoke.sh --avd Athar_GPlay --report target/r-ui-5/athar.json` | **1** | F1, S1 fail, STOP |
| report JSON | the packet's `node -e "for (const f of ['pixel7','athar']) …"` | **1** | both reports `failed:1` (F1) |
| no product change | `git diff --name-only d8dc8d3 -- apps crates packages` | 0 | prints nothing |
| policy | `node scripts/check-engineering-policy.mjs` | 0 | 8 checks, 0 failures |

## AVD safety, isolation, teardown

- `Pixel_7_API_35` booted with `-wipe-data` only after `adb devices` was empty; `Athar_GPlay` booted
  **without** `-wipe-data` (no snapshot save: `-no-snapshot` on both) and only `dev.warsha.remote`
  was uninstalled/installed on it, per D6/Constraints.
- The daemon's config, data and logs live under `target/r-ui-5/<avd>/` (throwaway; the token is
  minted there by `warshad` itself, never printed).
- The script's trap killed its emulator and its daemon and ran `adb kill-server`; afterwards
  `adb devices` is empty and no run-owned process remains (the pre-existing foreign `warshad` was
  never touched).

## Evidence inventory (all gitignored under `target/r-ui-5/`)

- `pixel7.json`, `athar.json` — per-step reports (`{avd, steps, failed, crashes, tokenLeaks, ports,
  preflight, commands, artifacts}`), `app-debug.apk`.
- `Pixel_7_API_35/`, `Athar_GPlay/` — `s1-boot.png`, `s1-start.txt`, `s1-page.txt`, `s1-console.txt`,
  `logcat.txt`, `logcat-crash.txt`, `daemon.log`, `emulator.log`, `s-final-ui.xml`, `script.log`,
  plus the throwaway `cfg/`, `data/`, `home/`; Athar additionally has `s1-page-error.txt`
  (`no reply`) and the empty `cdp-stderr.txt` that documents the CDP silence, and `s1-ui.xml`.

## T2 (Windows capture)

Not attempted and not green: out of this packet, needs a Windows CI runner, and no such host exists
here. Reported as **unverified/deferred**.

## What would close T3

1. Product fix (owner decision, outside this packet): serve the bundled page from a WebView-safe
   origin (`WebViewAssetLoader`) or emit a `file://`-safe bundle (relative URLs, classic script), then
   re-run the two smoke commands above; S2–S5 should then be able to pass.
2. Build repairs (also outside this packet): make `gradlew` executable in git and replace
   `build.gradle`'s `Task.exec {}` with `providers.exec` so `assembleDebug` runs as documented.
