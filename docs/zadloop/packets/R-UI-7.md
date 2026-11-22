# R-UI-7 — the Android shell gets a real origin, and the daemon admits it (Origin:null decision)

Status: spec frozen. Base: `db5b8ab` (repair/dev-csp-f474776; R-UI-6 + R-EXT-2 merged).
Depends on R-UI-6 (done). Planner-authored; this packet CONTAINS the owner decision (OD-UI7).

## Why

R-UI-6 made the bundled remote page load under `file:///android_asset/public/index.html` (S1 green on
`Pixel_7_API_35` and `Athar_GPlay`) and then measured the next wall directly
(`R-UI-6-report.md`, "The `Origin: null` finding"; `target/discrimination/r-ui-6/origin-null-probe.txt`;
`DECISIONS.md` 2026-11-15 R-UI-6 entry):

- `Origin: null` → **403** `{"error":"origin not allowed"}`
- `Origin: http://127.0.0.1:8765` → **403** (smoke config writes no `allowed_origins`)
- `Origin: tauri://localhost` → **401** (origin passed, token check next — proves the 403s are the origin rule)

So the page renders and cannot pair: `scripts/android-smoke.sh` **S2 fails on both AVDs** and the script
stops, `S3`–`S5` never run. The gate is `warshad`'s `origin_allowed` (`crates/warshad/src/auth.rs:1560`):
`APP_ORIGINS` (`tauri://localhost`, `http://tauri.localhost`) ∪ `config.allowed_origins`, applied by
`RpcAuthService::call` (`auth.rs:~1690`) to any *present* `Origin` before the credential is read.

## Measured inputs (base `db5b8ab`)

- A `file:` document can only present `Origin: null`. `null` is also what a browser sends from a
  sandboxed `<iframe sandbox>`, a `data:` URL, and some cross-origin redirects — i.e. any web page can
  make a victim's browser send `null` at will. It identifies no one.
- Desktop precedent: the Tauri webview presents `tauri://localhost` / `http://tauri.localhost`. Those are
  compiled into `APP_ORIGINS` ("always allowed whatever a config.toml lists, because an existing config
  must not lock its own app out") and the desktop additionally merges its origins into the config it
  hands the daemon (`apps/desktop/src-tauri/src/lib.rs:242`, `with_webview_origins`). `DaemonConfig`
  `Default` lists three origins (`state.rs:208`); a config file that omits the key (the smoke config)
  gets none — measured empty.
- `allowed_origins` is a daemon-side `config.toml` list (docker entrypoint writes it, `docs/src/architecture.md:274`).
  It is **not** per-device user data: a phone pairing to an existing desktop/server daemon cannot add to
  it. Any fix that relies on the operator editing the daemon config per phone is unusable.
- CORS layers (`http.rs:~200`, `startup.rs:~435`) read `config.allowed_origins` only, **not**
  `APP_ORIGINS` — so an `APP_ORIGINS`-only admission passes the WS gate but leaves REST/preflight
  `fetch` from that origin without CORS headers. Step 2 measures whether pairing needs it.
- `MainActivity.java` is framework-only (no `androidx.*`); `START_PAGE = file:///android_asset/public/index.html`,
  `setAllowFileAccess(true)`, one `new WebViewClient()`. Page CSP: `connect-src 'self' http://127.0.0.1:8765
  ws://127.0.0.1:8766 …`. `network_security_config.xml` already permits loopback cleartext only.

## Goal

`scripts/android-smoke.sh` **S2 passes on both AVDs** (`Pixel_7_API_35`, `Athar_GPlay`): a cold
`warsha://pair?host=127.0.0.1&port=8765&token=…` pairs against a loopback daemon and the bench renders.
`S3`–`S5` then run; they are expected to pass, and any that do not are reported as findings, not widened into.

## FROZEN decision (OD-UI7): option (b) — give the shell a real, non-null origin; admit that one origin

**Chosen: (b).** The WebView loads the bundled page from `https://appassets.androidplatform.net/` through a
`shouldInterceptRequest` handler in `MainActivity` (framework API only — **no `androidx.webkit`**), so the
page's `Origin` is the single fixed string `https://appassets.androidplatform.net`. The daemon admits
exactly that string by adding it to `APP_ORIGINS` (one constant, one test). `null` is **never** admitted.

### Security reasoning (CSRF / cross-site WebSocket hijacking, stated honestly)

The Origin check exists because a browser lets any web page open a WebSocket to `127.0.0.1:8766` and
attach cookies/ambient credentials; the check is what stops a hostile page in the user's browser from
talking to the local daemon. Its strength is that a hostile page cannot choose its `Origin`.

- **(a) admit `null` is rejected.** Any hostile page can force `Origin: null` (sandboxed iframe,
  `data:` document). Admitting it makes the check admit every attacker page, i.e. it deletes the
  protection while leaving the code in place. Writing `"null"` into `allowed_origins` is the same hole
  with extra steps, and it would be a *global* daemon weakening paid for by every deployment (desktop,
  docker, server) to serve one Android shell.
- **(b) residual risk, honestly:** (1) `https://appassets.androidplatform.net` is a *public* hostname, so
  a daemon admitting it admits *that string*. A hostile page cannot present it from a normal browser
  (the browser's `Origin` is its own page's origin, and a page genuinely served from that host would need
  to control that domain, which Google/AndroidX owns; the daemon is on loopback and DNS for that name
  is not under the attacker's control). Any other Android app using `WebViewAssetLoader` with the default
  domain shares the string, but it must also be on the same device, reach the loopback port, and
  still pass the bearer-token check — origin is defence in depth, **the token remains the credential**.
  (2) The check is a browser-protection control, not authentication: a non-browser client can forge
  any `Origin`, which was already true for `tauri://localhost`. (3) The admission is unconditional on
  every deployment (it is in `APP_ORIGINS`, not config), widening the allowlist by one fixed,
  non-attacker-reachable origin — the same trade the daemon already made for the two Tauri origins.
- **Why `APP_ORIGINS`, not `allowed_origins`:** `allowed_origins` is not per-device configurable
  (above), the smoke config is empty, and `APP_ORIGINS` is the stated precedent for "the app's own
  origin must not depend on a config that predates it".

### Alternatives rejected

- **(a) admit `null` / write `"null"` into `allowed_origins`** — security reasoning above; also leaves
  the shell on `file:` with `HashRouter` and no service worker, a permanently second-class origin.
- **(b′) `WebViewAssetLoader` from `androidx.webkit`** — same origin outcome, but adds an AndroidX
  dependency to a deliberately pure-framework app and a Gradle resolution step while the Gradle build is
  already rotting (R-UI-6b). The ~40-line framework interceptor delivers the same origin with no new dependency.
- **(c) smoke harness writes `allowed_origins=["http://127.0.0.1:8765"]`** — does not work: a `file:` page
  presents `null`, not the daemon's address; and it would only green the smoke, not a real phone.
- **(d) serve the bundle from the daemon (`http://<host>:8765/`)** — changes the product model (phone
  loads UI from the daemon, no offline shell) and needs cleartext to a non-loopback host; out of scope.

## Allowed files (narrow)

- `crates/warshad/src/auth.rs` — add the one origin to `APP_ORIGINS` and extend the existing doc comment.
- `crates/warshad/src/tests/origin_guard.rs` — new assertions (T1–T3).
- `crates/warshad/src/http.rs` and/or `crates/warshad/src/startup.rs` — **only if** Step 2 measures that
  pairing needs CORS: union `APP_ORIGINS` into the two `CorsLayer` allow-lists (smallest change; no new config key).
- `apps/mobile/android/app/src/main/java/dev/warsha/remote/MainActivity.java` — interceptor, `START_PAGE`,
  `setAllowFileAccess(false)`.
- `apps/remote/src/ShellRouter.tsx` (+ its test file) — treat the app origin like `file:` for
  `usesHashRouting` (page path is `/index.html`; `BrowserRouter` would 404 every route).
- `docs/DAEMON.md` (origin rule row), `PROGRESS.md`, `DECISIONS.md`, and the packet report `R-UI-7-report.md`.

## Out of scope

Admitting `null` anywhere; any new config key; `androidx.*`; CSP changes (CSP copies must stay byte-identical,
`check-wire-contract.mjs`); `network_security_config.xml`; the Gradle build rot / `gradlew` mode bit (R-UI-6b);
service-worker work (record the outcome only); `scripts/android-smoke.sh` edits; remote visual baselines (OD1);
v2 code; wire/RPC method changes.

## Constraints

Isolated worktree, `zl-rui7-*` branch from the current `repair/dev-csp-f474776` tip; implementer never authors
gates; reviewer separate, never edits; verifier separate, never repairs; no force push/tag/publish; mock
provider only; no secrets; never log the pairing token; no test weakening; small Conventional Commits.
The interceptor serves **only** `GET` for host exactly `appassets.androidplatform.net`, resolves the path
through `AssetManager` under `public/`, rejects any path containing `..`, `\`, or a NUL / encoded form
thereof, answers 404 otherwise, and never forwards to the network. Every other URL (including the
loopback daemon) is returned `null` so the WebView handles it normally. If after Step 3 the page's `connect-src`
or mixed-content rules block `http(s)://127.0.0.1` from the https origin, STOP and report — do not edit the CSP.

## Steps

1. **Daemon:** add `"https://appassets.androidplatform.net"` to `APP_ORIGINS`; tests T1–T3.
2. **Measure CORS need:** with a smoke-style config (empty `allowed_origins`), probe the pairing path with
   that `Origin` for WS (expect 401, not 403) and for the REST/preflight route the page uses to pair. If a
   preflight lacks `Access-Control-Allow-Origin`, apply the `APP_ORIGINS` union to the CORS layers and add T4.
3. **Shell:** `MainActivity` — `shouldInterceptRequest` per Constraints, `START_PAGE` →
   `https://appassets.androidplatform.net/index.html`, `setAllowFileAccess(false)`.
4. **Page:** `usesHashRouting` true for `file:` **or** `location.origin === 'https://appassets.androidplatform.net'`;
   unit tests for both, http path unchanged.
5. Build the APK by the R-UI-6 interim procedure (`pnpm --filter warsha-remote build`; `rsync -a --delete
   --exclude '*.map' apps/remote/dist/ apps/mobile/android/app/src/main/assets/public/`;
   `bash ./gradlew assembleDebug --no-daemon -x syncRemoteWebAssets`) and build `warshad`.
6. **Acceptance:** run `bash scripts/android-smoke.sh --avd Pixel_7_API_35 --report target/r-ui-7/pixel7.json`
   and `bash scripts/android-smoke.sh --avd Athar_GPlay --report target/r-ui-7/athar.json`. Record S1–S5 per AVD
   verbatim. An emulator-wide ANR at S1 (R-UI-6's Athar run 1) is re-run once and both runs kept.
7. Discrimination (`target/discrimination/r-ui-7/`): T1 fails with the `APP_ORIGINS` entry removed; the
   S2 result before/after quoted from R-UI-6's run vs this one.
8. Report `R-UI-7-report.md`; update PROGRESS/DECISIONS; commit.

## Acceptance (frozen)

- **T1** `app_origin_for_the_android_shell_is_allowed`: `origin_allowed(&[], "https://appassets.androidplatform.net")`.
- **T2** `null_origin_is_still_refused`: `!origin_allowed(&configured, "null")` for empty and for a populated list
  — the regression guard for this decision.
- **T3** `lookalike_origins_are_refused`: `http://appassets.androidplatform.net`, `https://appassets.androidplatform.net.evil.example`,
  `https://appassets.androidplatform.net:8443`, trailing-slash form → all refused (exact match only).
- **T4** (only if Step 2 requires it): preflight from the app origin gets CORS headers; `null` does not.
- **Device:** `android-smoke.sh` S2 `pass: true` mode `devtools` on **both** AVDs; S1, S3, S4, S5 pass
  (a non-pass is reported as a finding with logs); `crashes: 0`, `tokenLeaks: 0`; 0 `blocked by CORS` lines.
  S5 (public cleartext host refused) must still pass — the origin change must not loosen it.
- **Gate commands** (all exit 0, quoted verbatim in the report):
  `cargo fmt --all --check`; `cargo clippy --workspace --all-targets -- -D warnings`;
  `cargo test --workspace --all-targets`; `pnpm --filter warsha-remote test`;
  `pnpm --filter warsha-remote typecheck`; `pnpm --filter warsha-remote lint`;
  `pnpm --filter warsha-remote build && pnpm --filter warsha-remote check:pwa`;
  `node scripts/check-wire-contract.mjs`; `node scripts/check-ds-v3.mjs apps/desktop/src/v3 packages/ui/src/v3 apps/remote/src`;
  `node scripts/check-engineering-policy.mjs`; `pnpm lint`; `pnpm typecheck`.
  The remote e2e gate stays at the known base result (84 visual diffs, 7 passed — OD1); state it, do not claim it green.
- **No-collateral:** `git diff --name-only db5b8ab` lists only the Allowed files; no CSP, manifest, gradle, `scripts/`, wire file, or `dist`/APK committed.

## Open risks (name, do not hide)

- https page → `ws://127.0.0.1` mixed content: Chromium treats loopback as potentially trustworthy and the CSP
  already lists the loopback pairs, but this is measured only on device (Step 6). If blocked: STOP, report.
- Service-worker registration now becomes possible on a secure origin; the interceptor does not serve a SW
  scope specially. Record the observed outcome only.
- `appassets.androidplatform.net` is shared by any WebViewAssetLoader app; origin stays defence in depth,
  the bearer token is the credential (see reasoning).
