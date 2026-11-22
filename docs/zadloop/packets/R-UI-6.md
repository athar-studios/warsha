# R-UI-6 — Make the bundled remote page load under `file://` (fix the T3 RED asset-base defect)

Status: spec frozen. Base: `e65074a` (repair/dev-csp-f474776, R-EXT-1 merged). Planner lane. Pattern:
R-BRIDGE-B3b / R-EXT-1. **No Rust. No Java. No Gradle. No new RPC method.** Scope verdict: **asset fix only;
the `gradlew`-mode + Gradle-9 `Task.exec` build rot is a separate packet (R-UI-6b), see "Scope split".**

## Why (evidence: `R-UI-5-report.md`, re-measured at e65074a)

- F1 (report l.24-60): the shell loads `file:///android_asset/public/index.html`
  (`MainActivity.java` `START_PAGE`). The built `apps/remote/dist/index.html` names `/assets/index-*.js`,
  `/assets/index-*.css`, `/manifest.webmanifest`, `/icons/*` (Vite default `base: '/'`; confirmed in the current
  `dist/index.html` l.12, 20, 21, 60, 61). Under `file://` those resolve to `file:///assets/…`; the WebView console
  says `Access to script at 'file:///assets/index-….js' from origin 'null' has been blocked by CORS policy`,
  `#root` has `rootHtmlLength: 0`, the daemon saw zero RPC (report l.43, l.58). S1 fails; S2–S5 unreachable.
- The report's point 2 (l.52-56) is the trap: **relative URLs alone do not fix it.** Measured here (Chromium
  1148 via the repo's Playwright, `file://` page, origin `null`): `<script type="module" crossorigin src="./a.js">`
  is blocked with the same CORS message and runs nothing; the same file as `<script defer src="./a.js">` runs.
  So the fix is *relative base + a classic (non-module, non-`crossorigin`) bundle*, not just `base: './'`.
- Prototype, built in `/tmp` only (nothing under `apps/` touched): `base: './'`, `format: 'iife'`,
  `inlineDynamicImports`, post-processing `index.html` to `<script defer src="./assets/…js">` and a
  `crossorigin`-free stylesheet link → opened from `file://` in Chromium, `#root` rendered (12,099 chars of HTML),
  no CORS error. The source has no `import()` (grep: none), so one IIFE chunk is lossless.
- Two further `file://` facts measured in the same run, which shape the frozen design:
  1. `history.pushState({}, '', '/gates')` **throws** in origin `null` (`SecurityError`); `pushState(…, '#/gates')`
     succeeds. `main.tsx` uses `BrowserRouter`, so every nav click would throw under `file://`.
  2. `navigator.serviceWorker.register` is refused for origin `null`; `offline.ts` already swallows this as an
     outcome (console warning only), so no change is needed there.

## Goal

`apps/remote`'s production build opens and renders from `file:///android_asset/public/index.html` (pairing plate
present, navigation works), **without changing how the same build behaves when the daemon or `vite preview`
serves it over http** and without changing the dev server.

## Frozen design

**1. `apps/remote/vite.config.ts`** — exact edits.

Add `base` as the first key after `plugins`, and a small build-time plugin; keep every existing key unchanged.

```ts
// Top of file, after the imports:
import type { Plugin } from 'vite';

/**
 * The Android shell opens the bundle from `file://` (origin `null`), where Chromium refuses a
 * `<script type="module">` and any `crossorigin` subresource (R-UI-5 F1). The built page therefore
 * names one classic, deferred script and a plain stylesheet, all relative. Dev (`vite`) is untouched:
 * this runs in `transformIndexHtml` with `order: 'post'` and only when building.
 */
function classicShellHtml(): Plugin {
  return {
    name: 'warsha-classic-shell-html',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler: (html) =>
        html
          .replace('<script type="module" crossorigin ', '<script defer ')
          .replace('<link rel="stylesheet" crossorigin ', '<link rel="stylesheet" '),
    },
  };
}
```

```ts
export default defineConfig({
  plugins: [react(), classicShellHtml()],
  base: './',
  // … resolve / server / preview unchanged …
  build: {
    outDir: 'dist',
    sourcemap: true,
    modulePreload: false,
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } },
  },
});
```

If either `.replace` finds nothing the built page would silently stay a module page, so the build check in step 4
(`verify-pwa`) must fail on that — do not rely on the plugin alone.

**2. Router: hash routing only under `file:`.** New `apps/remote/src/ShellRouter.tsx` exporting a component that
renders `HashRouter` when `window.location.protocol === 'file:'` and `BrowserRouter` otherwise; `main.tsx` swaps
`<BrowserRouter>` for it (import + the two JSX tags, nothing else). http deployments (daemon-served, preview,
dev, Playwright `remote` project) keep real paths and deep links exactly as today. `App.tsx`'s
`currentLocation()` reads `search`/`pathname`/`hash` of the *document*; under `file:` the pairing deep link reaches
the page as a `warsha:pair-deeplink` event (`MainActivity.dispatchPendingPairing`), not as an address, so it is
not affected — confirm in the step-3 test, edit `App.tsx` only if a test proves it needed.

**3. Absolute URLs that stay (deliberately).** `public/manifest.webmanifest` (`start_url`, `icons[].src` begin
`/`), `workbox-config.cjs` (`navigateFallback: '/index.html'`), `offline.ts` `SERVICE_WORKER_PATH = '/sw.js'`.
They concern the http-served PWA only (the service worker cannot register under `file:`); making them relative
would change install/scope semantics for no Android benefit. Not edited.

**4. `apps/remote/scripts/verify-pwa.mjs` (check:pwa)** — its `referenced` regex (l.154) only matches
`(?:src|href)="/…"`, so after this change it would match nothing and the "assets index.html loads are
precached" check would pass vacuously. Update it to (a) match `./`-relative refs too (strip the leading `./`
before comparing to `files`/`precached`), and (b) add checks, each `record()`ed:
`index.html has no root-absolute asset URL` (no `src|href="/…"` at all, manifest and icon links included —
they are all `./` now), `index.html loads no <script type="module">`, `index.html has no
crossorigin attribute`, and `bundle contains no top-level ES import/export` (the built JS file starts as an IIFE;
check with a regex for `^\s*(import|export)\s` on the entry file). These are the regression guard for F1.

## Verified, not assumed

- **apps/mobile asset path.** `app/build.gradle` `syncRemoteWebAssets` (l.118-148) is `Sync` of `apps/remote/dist`
  into `src/main/assets/public` (`exclude '**/*.map'`); the built layout is
  `index.html, assets/*, icons/*, manifest.webmanifest, sw.js`. `./assets/x.js` against
  `file:///android_asset/public/index.html` resolves to `file:///android_asset/public/assets/x.js` — the exact
  copied file. `WebSettings.setAllowFileAccess(true)` is already set (`MainActivity` l.60). No Gradle or Java edit
  is needed for correctness.
- **Desktop.** `apps/desktop` does not consume `apps/remote` (no reference in `apps/desktop/package.json` or
  `tauri.conf.json`; Playwright's `remote` project drives the remote Vite dev server). Dev (`vite`, port 5174)
  ignores `apply: 'build'` and serves `/` with `base: './'` normally. Production: the daemon serves `dist/` at
  `/` (`REMOTE_ASSETS_DIR_ENV`); `./assets/…` from `/` or from a single-level route like `/settings` resolves to
  `/assets/…` (all app routes are single-segment: `App.tsx` l.211-217), so deep links keep working. CSP meta
  `script-src 'self'` allows the classic script under `file:` (prototype rendered with the CSP in place).
- Known and **not** introduced here: inlined `data:` fonts are refused by `font-src 'self'` under any origin
  (prototype console, also true over http); cosmetic only, separate finding, do not touch the CSP in this packet.

## Open risk the acceptance gate does not cover (state it, do not hide it)

Even with the page rendering, a page at origin `null` sends `Origin: null` on `fetch`/WebSocket; the daemon
refuses a present-but-unlisted Origin (`auth.rs` `origin_allowed`: `APP_ORIGINS` + `allowed_origins`, default
list has no `null`; `scripts/android-smoke.sh` writes no `allowed_origins`). Expected consequence: **S2–S5 will
likely fail on a 403 `origin not allowed` after this fix**. That is a different defect (daemon allow-list vs. an
`appassets` origin through `WebViewAssetLoader` — an owner decision, and it touches `crates/warshad` or
`MainActivity.java`). This packet's gate is **S1 only**; S2–S5 are run and *reported*, never claimed green or
counted as this packet's failure. Next packet (R-UI-7) decides the origin story using that run's evidence.

## Scope split — build rot is separate (R-UI-6b)

Recommendation, adopted: **do not fold** `gradlew` mode `100644` (`git ls-files -s apps/mobile/android/gradlew`)
and `build.gradle:128` `exec {}` (removed on `Task` in Gradle 9; wrapper 9.3.1; replace with `providers.exec`)
into this packet. Different files (`apps/mobile/android/**`, a mode bit), different risk (APK reproducibility,
release gates W7), different proof (`./gradlew assembleDebug --no-daemon` and an `assembleRelease` byte-compare),
and R-UI-6 is provable without them (below). Folding them would also make an S1 failure ambiguous (web vs.
build). R-UI-6b is a small standalone packet with its own gate; it can run in parallel or after.

**Interim APK procedure for this packet only** (what R-UI-5 B3 did; not a gate pass for the Gradle build):
build web → `rsync -a --delete --exclude '*.map' apps/remote/dist/ apps/mobile/android/app/src/main/assets/public/`
(gitignored) → `cd apps/mobile/android && bash ./gradlew assembleDebug --no-daemon -x syncRemoteWebAssets`.

## Allowed files

- `apps/remote/vite.config.ts`
- `apps/remote/src/ShellRouter.tsx`, `apps/remote/src/ShellRouter.test.tsx` (new), `apps/remote/src/main.tsx`
  (router swap only), `apps/remote/src/App.tsx` only if step 3 proves it necessary
- `apps/remote/scripts/verify-pwa.mjs`
- `docs/zadloop/packets/R-UI-6-report.md`; `docs/VERIFY.md` §3.4 one-line pointer only if it names the old failure
- `PROGRESS.md` entry; `DECISIONS.md` entry (the classic-bundle + hash-under-`file:` decision, and the `Origin: null`
  open risk)

## Out of scope

Any Rust; `crates/warshad` origin allow-list; `MainActivity.java`, `WebViewAssetLoader`, any Java/Kotlin; `app/build.gradle`,
`gradlew`, `gradle/**` (R-UI-6b); `AndroidManifest.xml`, `network_security_config.xml`; the CSP string in any of its
three copies; `manifest.webmanifest`, `workbox-config.cjs`, `offline.ts`; `scripts/android-smoke.sh` (use as is;
if it needs a change, stop and report); desktop app; the font `data:` CSP finding; any e2e baseline refresh.

## Constraints

- Strict TS, no `any`; ESLint/Prettier clean; UI strings untouched (no new copy).
- The built `dist/` for http serving must still pass `check:pwa` (manifest, icons, `sw.js`, precache) — it is the
  regression guard for the PWA.
- New tests must fail on `e65074a` and pass after; save before/after output under
  `target/discrimination/r-ui-6/` (the `verify-pwa` new checks on the base `dist/` must FAIL, then PASS).
- Do not commit `dist/`, `assets/public`, APKs or `target/`. Do not touch the foreign daemon on 8765/8766 (R-UI-5 B4);
  the smoke script already handles port remap.
- Small Conventional Commits on an `r-ui-6-*` branch from the merge tip; implementer is not reviewer/verifier;
  no force push, tag, publish; mock provider only.
- AVD safety as R-UI-5: `Pixel_7_API_35` may be `-wipe-data`, `Athar_GPlay` never.

## Steps

1. `vite.config.ts` per design 1. `pnpm --filter warsha-remote build`; inspect `dist/index.html`: only `./` URLs,
   one `<script defer src="./assets/…">`, no `type="module"`, no `crossorigin`.
2. `ShellRouter.tsx` + `main.tsx`; tests (jsdom): under `file:` (stub `window.location`/use a `HashRouter`-detecting
   probe) the shell uses hash routing and a nav click changes `location.hash` without `pushState`; under `http:` it
   uses path routing. Existing `App.test.tsx` etc. untouched and green.
3. `verify-pwa.mjs` new checks (design 4); discrimination run on the base build.
4. Prove in a real Chromium without the emulator (cheap pre-gate): open `apps/remote/dist/index.html` via
   `file://` with Playwright, assert `#root` non-empty and no `blocked by CORS` console line; save output.
5. Build the APK by the interim procedure; run the acceptance gate on both AVDs (below). S1 must pass.
6. Run S2–S5 as the script does, record their outcomes verbatim (expect Origin-null refusal; see open risk).
7. Report (`R-UI-6-report.md`), PROGRESS/DECISIONS entries.

## Gates (exact; from repo root)

Web:
- `pnpm --filter warsha-remote build` → 0
- `pnpm --filter warsha-remote test` → 0, ≥ 221 + new tests
- `pnpm --filter warsha-remote typecheck` → 0; `pnpm --filter warsha-remote lint` → 0
- `pnpm --filter warsha-remote check:pwa` → 0, every check PASS incl. the four new ones
- `node scripts/check-wire-contract.mjs` → 0 (it reads the unchanged CSP copies)
- `node scripts/check-ds-v3.mjs apps/desktop/src/v3 packages/ui/src/v3 apps/remote/src` → 0 violations
- `pnpm exec playwright test --project=remote --grep-invert "@visual"` → 0 failed, passed ≥ baseline (dev server, http)
- `pnpm lint` → 0; `pnpm typecheck` → 0
- `node scripts/check-engineering-policy.mjs` → 0

No-collateral proof (prints nothing):
`git diff --name-only e65074a | grep -vE '^(apps/remote/(vite.config.ts|src/|scripts/verify-pwa.mjs)|docs/|PROGRESS.md|DECISIONS.md)'`
and `git diff --name-only e65074a | grep -E '\.rs$|Cargo|apps/mobile|gradle|crates/'`.

**Acceptance gate (device), per AVD:**
`bash scripts/android-smoke.sh --avd Pixel_7_API_35 --report target/r-ui-6/pixel7.json`
`bash scripts/android-smoke.sh --avd Athar_GPlay --report target/r-ui-6/athar.json`
Required: in each report the `S1` step has `pass: true` (pairing plate `remote-pair-submit` present, `#root`
non-empty, no `blocked by CORS` line in `s1-console.txt`/`logcat.txt`), `crashes: 0`, `tokenLeaks: 0`. The overall
script exit code may be non-zero because of S2–S5 (see open risk); the report must say so explicitly and attach the
S2–S5 evidence. If S1 does not pass on a device, STOP and report; do not widen scope.

## Acceptance

- Built `index.html` has relative, classic, non-`crossorigin` asset URLs; `check:pwa` and the unit/e2e gates are green;
  the http-served PWA behaves as before.
- `S1` passes on `Pixel_7_API_35` and `Athar_GPlay` with the evidence files named; the report states the APK came
  from the interim procedure (Gradle gate not claimed), that S2–S5 outcomes are informational, and carries the
  `Origin: null` finding forward to R-UI-7 and the build rot to R-UI-6b.
- No file outside Allowed files changed; no Rust/Gradle/Java diff.

## Open points (defaults applied)

- OD-UI6-a: relative base + classic bundle + hash router under `file:` (chosen, matches the owner's "relative base"
  direction and needs no new native dependency) vs. `WebViewAssetLoader` at `https://appassets.androidplatform.net`
  (keeps modules/`BrowserRouter`, but adds `androidx.webkit` to a deliberately pure-framework app and edits Java).
  The Origin-null problem needs the owner's call in R-UI-7 either way.
- OD-UI6-b: classic bundle applies to every production build (single artifact, one `dist/`) rather than a separate
  Android-only build, so the file Gradle syncs is the file `check:pwa` validated. Cost: the PWA ships an IIFE instead
  of an ES module (≈+44 kB raw in the prototype, no code splitting existed to lose).
