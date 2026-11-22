# R-UI-7 report — the Android shell's real origin, admitted exactly

**Status: the packet's daemon, shell and page work is done and measured; its device acceptance is not met.**
`S2` (pairing against a correct deep link) is **red on both AVDs**, and this report names what it is *not*
before naming what it is: the origin admission this packet owns is proven working end to end (Step 2's
measurement, `T1`–`T4`, `S1` on both AVDs, the page served from
`https://appassets.androidplatform.net/index.html`). The wall is behind that gate — the page is handed a valid
link by the shell's own bridge and does not adopt it — and every candidate this packet could have introduced
was excluded by measurement (§ "Why `S2` is red", with the Chromium runs that pair at the *same* origin with
the *same* bundle). `S3`–`S5` never run: `android-smoke.sh` stops at the pairing step by its own design, as it
did for `R-UI-6`. `crashes: 0`, `tokenLeaks: 0`, and **0** `blocked by CORS` lines on both AVDs.

- **Branch:** `zl-rui7-appassets` (the lane's `zl-rui7-*`), isolated worktree `.agents/worktrees/zl-rui7-appassets`.
- **Base:** `af66ff0` on `repair/dev-csp-f474776` (the frozen `R-UI-7` merge tip; `db5b8ab` is an ancestor).
- **Commits:**

| Commit | What |
|---|---|
| `a9f279f` | `feat(warshad): admit the android app-assets origin exactly (R-UI-7)` — `auth.rs` (`APP_ORIGINS` + `cors_origins`), `http.rs`/`startup.rs` (both CORS layers), `tests/origin_guard.rs` (`T1`–`T4`) |
| `96c31d4` | `feat(shell): serve the bundled page from the app-assets origin (R-UI-7)` — `MainActivity.java` (interceptor, `START_PAGE`, `setAllowFileAccess(false)`), `ShellRouter.tsx` + test |
| *this commit* | `docs(zadloop): R-UI-7 report, PROGRESS/DECISIONS, DAEMON origin rule` — this file, `PROGRESS.md`, `DECISIONS.md`, `docs/DAEMON.md` |

8 files, all of them on the packet's allowed list (§ "No collateral"). No Rust change outside the origin rule,
no new config key, no new RPC, no `androidx.*`, no CSP edit, no `scripts/` edit, no Gradle or manifest edit.

## What changed, and what each part is measured against

**Daemon (`crates/warshad/src/auth.rs`).** `APP_ORIGINS` gains the one string
`https://appassets.androidplatform.net`, and the doc comment records why `null` is *not* the alternative: any
web page can force a browser to send `null` (sandboxed iframe, `data:` document), so admitting it would delete
the origin check while leaving it in the code. Exact match only — scheme, host, no port, no trailing slash — is
already how `origin_allowed` compares. The second addition is the function the layers now share:

```rust
pub(crate) fn cors_origins(configured: &[String]) -> Vec<axum::http::HeaderValue>
```

`APP_ORIGINS` first, then the configured list, invalid header values dropped (the configured half keeps the
behaviour it always had). One union, written once, so a CORS layer cannot drift from the gate that admits the
same strings.

**Both CORS layers (`http.rs`, `startup.rs`) — taken because Step 2 measured the need.** They used to read
`config.allowed_origins` alone, which is exactly the list `APP_ORIGINS` exists to outrank. Measured before the
union, on this branch's binary, with a smoke-style config (no `allowed_origins` for the app origin): the
WebSocket handshake from the app origin passed the origin gate (`401 Unauthorized`, i.e. "the credential is
next") and the preflight for its `POST /rpc` came back **without** `Access-Control-Allow-Origin`, so the page
would have been unable to read any answer. After the union both listeners answer
`access-control-allow-origin: https://appassets.androidplatform.net`. Full before/after:
`target/discrimination/r-ui-7/out-before-cors/measurement.txt` and `out-after-cors/measurement.txt`, quoted in
§ "Step 2 measurement".

**Shell (`MainActivity.java`).** `START_PAGE` is `https://appassets.androidplatform.net/index.html`; the page is
served by a framework `shouldInterceptRequest` handler (API 21+ `WebResourceRequest`/`WebResourceResponse`) from
`assets/public/`, with `setAllowFileAccess(false)`. The handler serves **only** `GET` for exactly that host,
resolves the path through `AssetManager` under `public/`, rejects any path containing `..`, `\` or a NUL —
including their repeated percent-encoded forms (`URLDecoder` until stable) — answers `404` with an empty body
otherwise, and returns `null` for every other URL so the WebView handles the loopback daemon normally. No
`androidx.webkit`, no `WebViewAssetLoader`, no network fallback. `isLocalOrigin` also accepts `https` +
`ASSET_HOST` so the camera/QR permission grant (which is origin-gated) keeps working on the new origin — a
regression guard, not a widening: every other host is still refused.

**Page (`apps/remote/src/ShellRouter.tsx` + its test).** `ANDROID_ASSET_ORIGIN` is a named constant;
`usesHashRouting(protocol, origin)` is true for `file:` **or** that exact origin, so the page path `/index.html`
does not 404 every route under `BrowserRouter`. The http path (daemon-served PWA, `vite preview`, dev server) is
unchanged. The origin is a prop with a `window.location` default for the same jsdom reason `R-UI-6` recorded.

**Docs (`docs/DAEMON.md`).** The `allowed_origins` row now says what the code does, and a new section states the
rule once: `APP_ORIGINS` ∪ `allowed_origins`, exact match, `null` never admitted, and the CORS layers admit the
same union.

## Step 2 measurement (verbatim, `target/discrimination/r-ui-7/`)

Before the union (`out-before-cors/measurement.txt`):

```
## RPC WebSocket handshake, no credential (401 = origin admitted, 403 = refused)
Origin https://appassets.androidplatform.net          -> HTTP/1.1 401 Unauthorized
Origin null                                           -> HTTP/1.1 403 Forbidden
Origin https://appassets.androidplatform.net.evil.example -> HTTP/1.1 403 Forbidden
Origin http://appassets.androidplatform.net           -> HTTP/1.1 403 Forbidden
Origin https://appassets.androidplatform.net:8443     -> HTTP/1.1 403 Forbidden

listener http://127.0.0.1:18765
  preflight OPTIONS /rpc ACAO: (none — the preflight is answered without Access-Control-Allow-Origin)
  POST /rpc ACAO:              (none)
  POST status: HTTP/1.1 404 Not Found
listener http://127.0.0.1:18766
  preflight OPTIONS /rpc ACAO: (none — the preflight is answered without Access-Control-Allow-Origin)
```

After the union (`out-after-cors/measurement.txt`), same daemon, same config, same probes:

```
listener http://127.0.0.1:18765
  preflight OPTIONS /rpc ACAO: access-control-allow-origin: https://appassets.androidplatform.net
  POST /rpc ACAO:              access-control-allow-origin: https://appassets.androidplatform.net
  POST status: HTTP/1.1 404 Not Found
listener http://127.0.0.1:18766
  preflight OPTIONS /rpc ACAO: access-control-allow-origin: https://appassets.androidplatform.net
  POST /rpc ACAO:              access-control-allow-origin: https://appassets.androidplatform.net
  POST status: HTTP/1.1 200 OK
```

The WebSocket table is identical before and after (the gate was already right; only CORS moved). `POST /rpc`
answers `404` on `18765` because the RPC route lives on `18766` — the packaged page also reaches `18765` for its
`/events` socket, which is why both listeners were measured and both were changed. The measured config carries
`allowed_origins = ["http://localhost:5173", "tauri://localhost", "http://tauri.localhost"]` and no app-assets
entry: the union, not a config key, is what admits the page.

## Gates (final tree, `zl-rui7-appassets`)

| Gate | Command | Exit | Result |
|---|---|---|---|
| fmt | `cargo fmt --all --check` | 0 | |
| clippy | `cargo clippy --workspace --all-targets -- -D warnings` | 0 | |
| test (rust) | `cargo test --workspace --all-targets` | 0 | 39 `test result: ok` lines, **0** failed; `origin_guard` 7/7 |
| unit (remote) | `pnpm --filter warsha-remote test` | 0 | **228 passed** (17 files); base 221 + 7 new `ShellRouter` cases |
| typecheck (remote) | `pnpm --filter warsha-remote typecheck` | 0 | |
| lint (remote) | `pnpm --filter warsha-remote lint` | 0 | clean |
| build | `pnpm --filter warsha-remote build` | 0 | classic `./`-relative shell, unchanged shape |
| PWA | `pnpm --filter warsha-remote check:pwa` | 0 | **19 of 19 checks passed** |
| wire | `node scripts/check-wire-contract.mjs` | 0 | 11 checks, 0 violations (CSP copies untouched) |
| DS | `node scripts/check-ds-v3.mjs apps/desktop/src/v3 packages/ui/src/v3 apps/remote/src` | 0 | 0 violations |
| policy | `node scripts/check-engineering-policy.mjs` | 0 | 8 checks, 0 failures |
| lint (repo) | `pnpm lint` | 0 | 1 pre-existing warning (`apps/desktop/src/v3/pages/inbox/index.tsx:360`, untouched) |
| typecheck (repo) | `pnpm typecheck` | 0 | |
| e2e (remote) | `pnpm exec playwright test --project=remote --grep-invert "@visual"` | **1** | **84 failed / 7 passed** — the known base result (`OD1`), re-measured on this tree; not claimed green |

The remote e2e gate is red and is red at the base too, with the same composition: the 84 failures are
`toHaveScreenshot` diffs in `bench.visual.spec.ts` on the pre-existing stale baselines (`OD1`, font/host drift),
the seven functional `flows.spec.ts` cases pass, and nothing here re-baselines or weakens them. Re-measured on
this tree (3.8 min, `target/r-ui-7/e2e-remote.log`): 84 failed / 7 passed — `passed ≥ baseline` holds exactly.

## Device acceptance

APK from the packet's interim procedure (not a Gradle gate — the build rot stays `R-UI-6b`):
`pnpm --filter warsha-remote build` → `rsync -a --delete --exclude '*.map' apps/remote/dist/
apps/mobile/android/app/src/main/assets/public/` → `bash ./gradlew assembleDebug --no-daemon -x
syncRemoteWebAssets` (`BUILD SUCCESSFUL`). `warshad` for the runs is this tree's `target/debug/warshad`.

| AVD | Command | S1 | S2 | crashes | tokenLeaks | script exit |
|---|---|---|---|---|---|---|
| `Pixel_7_API_35` | `bash scripts/android-smoke.sh --avd Pixel_7_API_35 --report target/r-ui-7/pixel7.json` | **pass**, `devtools` — "start Status: ok; pid 2666 alive after 5s; pairing plate present" | fail, `devtools`, "cold `warsha://pair` did not reach a paired bench within 15s (state=unpaired, rc=0)" | 0 | 0 | 1 |
| `Athar_GPlay` (run 1) | `bash scripts/android-smoke.sh --avd Athar_GPlay --report target/r-ui-7/athar.json` | **pass**, `devtools` — "start Status: ok; pid 1902 alive after 5s; pairing plate present" | fail, `devtools`, "devtools reached but CDP evaluate never answered" | 0 | 0 | 1 |
| `Athar_GPlay` (run 2, kept) | `bash scripts/android-smoke.sh --avd Athar_GPlay --report target/r-ui-7/athar-rerun.json` | **pass**, `devtools` — "start Status: ok; pid 1864 alive after 5s; pairing plate present" | fail, `devtools`, "cold `warsha://pair` did not reach a paired bench within 15s (state=unpaired, rc=0)" | 0 | 0 | 1 |

`S1`'s clause holds on both AVDs, and it is the clause this packet's change owns: the page is found through
CDP at `https://appassets.androidplatform.net/index.html` (the interceptor served it — no `file:`, no `null`
origin), the plate renders, and logcat carries **0** `blocked by CORS` lines on either run. `S3`–`S5` did not
run; the script stops at the first failing pairing step, so the packet's `S5` clause ("public cleartext host
still refused") is **not machine-verified by this run** and is not claimed.

Athar's two runs are both kept because run 1's `S2` is a harness non-answer rather than a page state: the app
process changed between `S1` and `S2` (`webview_devtools_remote_1902` → `…_2394`), the devtools target the
script had cached went with it, and its CDP evaluate never returned. That is the same failure mode `R-UI-6`
recorded on this AVD, and it is why run 2 exists. Run 2 reproduces Pixel's substantive result — `state=unpaired`
after 15 s against a correct deep link — so the pairing finding is now measured on **both** AVDs, not inferred
from one.

## Why `S2` is red — measured, not guessed

The daemon admits the origin and the page loads from it; what fails is that the page never adopts the deep link
the shell hands it. Each candidate that this packet could have introduced was excluded by measurement:

1. **The origin is not the wall.** Step 2 above: the app origin is admitted (`401`, not `403`), and both CORS
   layers answer it.
2. **The bundle is not the wall.** The same `apps/remote/dist` bundle, served at the *same* origin
   (`https://appassets.androidplatform.net`, via `--host-resolver-rules` + a local TLS server) in Chromium with
   a scripted `window.WarshaNative`, pairs on the cold path, on the `warsha:pair-deeplink` event, and after a
   reload: `{"origin":"https://appassets.androidplatform.net","plate":false,…}`. Evidence:
   `target/discrimination/r-ui-7/same-origin.cjs` output. So the origin + hash routing + page logic this packet
   touched are all compatible with pairing.
3. **The keystore's refusal is not the wall either.** With a bridge whose `saveSecret` returns `false` — what
   this emulator image actually does — and with one that throws, the page still pairs in Chromium
   (`target/discrimination/r-ui-7/variants.cjs`).
4. **The link the shell hands over is valid.** Read out of the device page itself:
   `getInitialPairingUri()` returns the full 88-character `warsha://pair?host=127.0.0.1&port=8765&token=…` link
   (`typeof` = `function`, `length` = 88), and the page's deep-link listener is attached
   (`deeplinkListeners: 1`). Offline, the parser accepts that exact string shape
   (`{"ok":true,"session":{"baseUrl":"http://127.0.0.1:8765",…}}`).

So the remaining difference between the run that pairs and the run that does not is the real
`@JavascriptInterface` bridge inside the device WebView. Two device facts sit next to it, both pre-existing and
both outside this packet's allowed files:

- **The emulator's Keystore refuses writes.** `WarshaMainActivity: native bridge operation failed:
  saveSecret:keystore (InvalidAlgorithmParameterException)` — measured by calling the bridge from the page. The
  page survives it (the session lives in memory), but nothing it stores survives a process restart, and the
  package-install path restarts the app shortly after launch (the pid changes between `S1` and `S2`).
- **`loadSecret` answers `undefined`, not `null`,** for a key the vault does not hold (Java `null` across this
  bridge). `readStoredSession` treats that as "no session", so it is not the failure, but it is not the contract
  the TypeScript declares either.

**Next step, named and small (not taken here):** one `evaluateJavascript` in `MainActivity` — or a
`Page.addScriptToEvaluateOnNewDocument` hook — that wraps `window.WarshaNative.getInitialPairingUri` and
`console.error`, to record what the page's own effect sees at mount and whether `pair()` returns a reason. That
is a shell edit outside this packet's narrow allowance (`interceptor`, `START_PAGE`, `setAllowFileAccess`), so it
is reported rather than taken, per the packet's own "findings, not widened into".

## Findings (reported, not repaired)

1. **`S2` red on both AVDs** — as above. Not caused by the origin admission; the chain of exclusions is § "Why
   `S2` is red".
2. **The mixed-content risk is closed.** The packet's open risk — an `https:` page reaching `http://127.0.0.1`
   and `ws://127.0.0.1` — does **not** fire: 0 mixed-content refusals and 0 `blocked by CORS` lines in the
   device logcat, and the page's requests reach the daemon. No CSP edit was needed or made; the CSP copies are
   byte-identical (`check-wire-contract.mjs`, 11 checks, 0 violations).
3. **Service worker: recorded outcome only.** `sw.js` ships inside the APK, but the framework interceptor is not
   consulted for the worker script fetch, so registration fails with "An unknown error occurred when fetching
   the script". `offline.ts` already treats a refusal as an outcome, not an error, and nothing about the page's
   rendering depends on it. Untouched, as the packet requires.
4. **`data:` fonts are still refused** by `font-src 'self'` (8 console lines per load, identical to the base).
   Pre-existing and cosmetic; the CSP must not change, so it did not.
5. **The emulator Keystore is broken** (`InvalidAlgorithmParameterException` on every `saveSecret`). Pre-existing,
   shell-side, and outside this packet.

## Discrimination (`target/discrimination/r-ui-7/`, gitignored)

- **`T1` kills the code it guards.** With `"https://appassets.androidplatform.net"` removed from `APP_ORIGINS`,
  `cargo test -p warshad --lib origin_guard` fails **3 of 7** — `app_origin_for_the_android_shell_is_allowed`
  (`assertion failed: origin_allowed(&[], ANDROID_SHELL_ORIGIN)`),
  `a_preflight_from_the_android_shell_origin_is_answered_with_cors_headers` (no ACAO), and
  `the_app_origins_and_no_origin_reach_the_auth_check` (`left: 403, right: 401`) — exit **101**
  (`target/r-ui-7/t1-mutation.txt`). Restored: 7/7, exit 0 (`target/r-ui-7/t1-restored.txt`). The entry is what
  makes the daemon answer, and the tests are what notice when it goes.
- **CORS: before/after** — § "Step 2 measurement". The union is load-bearing: without it the preflight carries no
  `Access-Control-Allow-Origin`, and the browser refuses the answer the daemon already authorised.
- **`S2` before/after, quoted.** `R-UI-6` (`file:`, origin `null`): `state=unpaired` because the daemon answered
  `{"error":"origin not allowed"}` — the origin gate refused the page. `R-UI-7` (asset origin): `state=unpaired`
  with the gate now admitting it (`401`, CORS present) — the page still does not pair. The origin defect is
  closed; the pairing defect behind it is now visible and is finding 1.

## No collateral

`git diff --name-only HEAD` on the committed tree lists exactly the 8 files in the table at the top — every one
of them on the packet's allowed list (`auth.rs`, `tests/origin_guard.rs`, `http.rs`, `startup.rs`,
`MainActivity.java`, `ShellRouter.tsx` + test, `docs/DAEMON.md`, plus `PROGRESS.md`/`DECISIONS.md`/this report).
`git diff --name-only db5b8ab` adds only `docs/zadloop/packets/R-EXT-3.md` and `R-UI-7.md`, which came from
upstream merges on the base branch and are not this lane's work. No CSP file, no
`network_security_config.xml`, no manifest, no `gradle`/`gradlew`, no `scripts/`, no wire/RPC file, and no
`dist`/APK is in the diff — the APK and the built bundle stay untracked under `target/` and
`apps/mobile/.../assets/public/`.
