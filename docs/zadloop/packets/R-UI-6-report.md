# R-UI-6 report — the bundled remote page loads under `file://`

**Status: DONE for this packet's gate.** `S1` is green on both AVDs (`Pixel_7_API_35`, `Athar_GPlay`), the web
gates are green, and the base defect is reproduced and then closed with saved before/after evidence. `S2`–`S5`
are **not** green and were not expected to be: the packet's "open risk" fired exactly as written — the WebView
presents `Origin: null`, the daemon refuses it, so nothing pairs. `S2` therefore stops the smoke script on both
AVDs by its own design and `S3`–`S5` never run. That is carried to `R-UI-7` with a direct measurement below.
The Gradle build was **not** run as a gate: the APK came from the packet's interim procedure (build rot stays
`R-UI-6b`).

- **Branch:** `zl-rui6-filebase` (the lane's `zl-rui6-*`).
- **Base:** `8fc58db` on `repair/dev-csp-f474776` (the packet's own base `e65074a` is an ancestor; this lane was
  told to cut from the packet-merge tip).
- **Commits:**

| Commit | What |
|---|---|
| `c2ca721` | `feat(remote): build a relative, classic shell bundle for file:// (R-UI-6)` — `vite.config.ts`: `base: './'`, `modulePreload: false`, IIFE output, the `classicShellHtml` post-transform |
| `9e7dd95` | `feat(remote): route on the fragment only under file: (R-UI-6)` — `ShellRouter.tsx`, `main.tsx` router swap, 4 jsdom tests |
| `e59e977` | `test(remote): guard the file:// shell in check:pwa (R-UI-6)` — the `./`-aware `referenced` regex + four recorded checks |
| *this commit* | `docs(zadloop): R-UI-6 report, PROGRESS/DECISIONS, VERIFY pointer` — the four files below |

9 files, `+435 / −7` against the base (5 of them code — `vite.config.ts`, `ShellRouter.tsx`, `ShellRouter.test.tsx`, `main.tsx`, `verify-pwa.mjs` — the rest docs). No Rust, Gradle, Java, manifest, CSP, `scripts/`, `package.json` or e2e
file in the diff. `scripts/android-smoke.sh` was used exactly as it is.

## What changed

**Build (`apps/remote/vite.config.ts`).** `base: './'` rewrites every URL the page names to sit beside it;
`rollupOptions.output.format: 'iife'` + `inlineDynamicImports: true` (there is no `import()` in the source, so
nothing is lost) makes the page name one classic script; `modulePreload: false` keeps a module-page hint out of a
classic page; `classicShellHtml()` runs in `transformIndexHtml` with `order: 'post'` under `apply: 'build'` and
drops `type="module"`/`crossorigin` from the emitted tags. Dev is untouched.

Measured artifact: `dist/index.html` now carries only `./` URLs —
`<script defer src="./assets/index-Jb6XKgDv.js">`, `./manifest.webmanifest`, `./icons/…` — with no
`type="module"`, no `crossorigin` and no stylesheet link.

**The stylesheet does not exist, and that is the frozen design's own consequence.** With `format: 'iife'` Vite
has no CSS asset to emit for a non-ES output and inlines the whole stylesheet into the script as a runtime
`<style>` (`document.createElement("style")` + the CSS text at the top of the bundle), which is the packet's
"≈+44 kB raw" (455.88 kB → 499.77 kB). Font URLs inside it are rewritten to `new URL(name, document.currentScript.src)`,
i.e. script-relative, so they still resolve beside the page. Injected `<style>` is allowed by the CSP's
`style-src 'unsafe-inline'`. The plugin's stylesheet `.replace` is therefore a no-op on this tree: the packet's
own instruction — "do not rely on the plugin alone" — is what keeps that honest, and `check:pwa` asserts the page,
not the replace. `cssCodeSplit: false` *does* restore a real `./assets/style-*.css` + `<link rel="stylesheet">`
(measured), but that key is not in the frozen design and changes the artifact shape for the http-served PWA, so
it was not taken. This is the one place the built page differs from the packet's prose ("one classic deferred
script and a plain stylesheet"); it is recorded rather than silently edited.

**Routing (`apps/remote/src/ShellRouter.tsx`).** `usesHashRouting(protocol = window.location.protocol)` is the
whole rule: `file:` → `HashRouter`, everything else → `BrowserRouter`. `main.tsx` only swaps the tags. Path
routing over http is unchanged, so the daemon-served bundle, `vite preview`, the dev server and the Playwright
`remote` project keep real paths and deep links. `App.tsx` was **not** edited: its `currentLocation()` reads the
document's `search`/`pathname`/`hash`, and the pairing deep link reaches a `file:` page as a
`warsha:pair-deeplink` event, not as an address — no test proved an edit was needed.

The protocol is a prop with a `window.location.protocol` default, for one measured reason: jsdom's `History`
refuses **every** `pushState` from a `file:` document, including a fragment one
(`SecurityError: pushState() cannot update history to the URL file:///…#/gates`), and `window.location` and
`Location.prototype` are non-configurable there, so the test environment cannot stand a `file:` window. Production
never passes the prop; the tests name the protocol instead of faking a window the environment forbids faking.

**PWA gate (`apps/remote/scripts/verify-pwa.mjs`).** The `referenced` regex now matches `./`-relative refs as well
as root-absolute ones and normalises both to a `dist/` path, so the precache check can no longer pass vacuously
on a relative page. Four checks were added, in their own `checkClassicShell()` (outside `checkArtifacts()`'s early
returns, so a broken manifest cannot skip them): `index.html has no root-absolute asset URL`,
`index.html loads no <script type="module">`, `index.html has no crossorigin attribute`,
`bundle contains no top-level ES import/export`. 19/19 pass on the fixed build.

## Gates (final tree, `zl-rui6-filebase`)

| Gate | Command | Exit | Result |
|---|---|---|---|
| build | `pnpm --filter warsha-remote build` | 0 | 8 precache URLs, `dist/index.html` relative + classic |
| unit | `pnpm --filter warsha-remote test` | 0 | **225 passed** (17 files); base 221 + 4 new |
| typecheck | `pnpm --filter warsha-remote typecheck` | 0 | |
| lint | `pnpm --filter warsha-remote lint` | 0 | clean (first run caught one `import/order` slip in `main.tsx`, fixed) |
| PWA | `pnpm --filter warsha-remote check:pwa` | 0 | **19 of 19 checks passed**, incl. the four new ones |
| wire | `node scripts/check-wire-contract.mjs` | 0 | 11 checks, 0 violations (CSP copies untouched) |
| DS | `node scripts/check-ds-v3.mjs apps/desktop/src/v3 packages/ui/src/v3 apps/remote/src` | 0 | 0 violations |
| e2e (remote) | `pnpm exec playwright test --project=remote --grep-invert "@visual"` | **1** | **84 failed / 7 passed** — see below (`final/playwright-remote-final.log`, re-measured on the committed tree) |
| lint (repo) | `pnpm lint` | 0 | 1 pre-existing warning (`apps/desktop/src/v3/pages/inbox/index.tsx:360`, untouched) |
| typecheck (repo) | `pnpm typecheck` | 0 | |
| policy | `node scripts/check-engineering-policy.mjs` | 0 | 8 checks, 0 failures |

**The e2e gate is red and is red at the base too.** `--grep-invert "@visual"` does not exclude
`apps/remote/e2e/bench.visual.spec.ts` — its cases carry no `@visual` tag — so the run includes the 84 remote
visual snapshots, and every one of the 84 failures is a `toHaveScreenshot` diff in that file (0.10–0.19 of
pixels). The seven functional `flows.spec.ts` cases pass. Measured on a clean worktree at `8fc58db`, same
command: **84 failed / 7 passed**, identical composition
(`playwright-remote-baseline.log`). So this change causes no e2e regression, and
`passed ≥ baseline` holds exactly (7 = 7), but `0 failed` is not achievable on this tree. Nothing was
re-baselined and no test was weakened — the stale remote visual baselines are the pre-existing `OD1` item
(`PROGRESS.md`, "blocked on owner decisions").

## Discrimination (`target/discrimination/r-ui-6/`, gitignored)

- `check-pwa-before.log` vs `check-pwa-after.log`: on the base `dist/`, **3 of the 4** new checks FAIL
  (`root-absolute: /manifest.webmanifest, /icons/apple-touch-icon.png, /icons/favicon-32.png,
  /assets/index-DxW-KrEm.js, /assets/index-B9O2b0Lu.css`; `type="module" crossorigin`; the two `crossorigin`
  tags) and `check:pwa` exits 1. The fourth (`no top-level ES import/export`) PASSES on the base too: the ESM
  bundle also starts with `var`, so it is a guard for a future bundle, not a discriminator for this one. Said
  plainly rather than counted as a fourth kill.
- `file-shell-before.json` vs `file-shell-after.json` (the step-4 pre-gate, real Chromium, `file://`): the base
  page gives `rootHtmlLength: 0`, `scriptType: "module"` and two `blocked by CORS` lines
  (`file:///assets/index-B9O2b0Lu.css`, `file:///assets/index-DxW-KrEm.js`). The fixed page gives
  `rootHtmlLength: 12131`, pairing plate + nav present, `scriptType: ""`, **0** blocked lines, and a nav click
  under `file:` moves `location.hash` to `#/` while `location.pathname` stays the document's own path. Its only
  console errors are the known ones: `data:` fonts refused by `font-src 'self'` (packet: known, cosmetic, not
  touched), the `frame-ancestors`-in-`<meta>` warning, and the service-worker refusal at origin `null`
  (`offline.ts` already treats that as an outcome).
- `shellrouter-test-on-base.log`: the new test file on the base tree fails to resolve `./ShellRouter`
  (`1 file failed, no tests`); on the branch it is 4/4.

## Acceptance gate (device)

APK from the packet's interim procedure, not a Gradle gate: `pnpm --filter warsha-remote build` →
`rsync -a --delete --exclude '*.map' apps/remote/dist/ apps/mobile/android/app/src/main/assets/public/` →
`bash ./gradlew assembleDebug --no-daemon -x syncRemoteWebAssets` (exit 0, 1,843,226 B,
`assets/public/index.html` inside the APK carries `<script defer src="./assets/index-Jb6XKgDv.js">`).
`warshad` for the runs is the host's `target/debug/warshad` (built 02:08, after the last `crates/` commit at
01:48; this branch has no Rust diff). `./gradlew assembleDebug --no-daemon` **without** `-x` and the wrapper's
mode bit remain `R-UI-6b`'s.

| AVD | Command | S1 | S2 | crashes | tokenLeaks | script exit |
|---|---|---|---|---|---|---|
| `Pixel_7_API_35` | `bash scripts/android-smoke.sh --avd Pixel_7_API_35 --report target/r-ui-6/pixel7.json` | **pass**, mode `devtools` — "start Status: ok; pid 2722 alive after 5s; pairing plate present" | fail, `devtools`, `state=unpaired` after the cold deep link | 0 | 0 | 1 |
| `Athar_GPlay` (run 2, the gate) | `bash scripts/android-smoke.sh --avd Athar_GPlay --report target/r-ui-6/athar.json` | **pass**, mode `devtools` — "start Status: ok; pid 1894 alive after 5s; pairing plate present" | fail, `devtools`, "CDP evaluate never answered: the pairing assertion is NOT machine-verified" | 0 | 0 | 1 |
| `Athar_GPlay` (run 1, preserved) | same command | fail, `visual` — `am start -W` answered `Status: timeout` (`WaitTime: 14776`) | not reached | 0 | 0 | 1 |

`S1`'s acceptance clause holds on both AVDs: `pass: true`, plate present, `#root` non-empty (proven by the plate
being found through CDP), and **0** `blocked by CORS` lines in `logcat.txt` on either run. `crashes: 0`,
`tokenLeaks: 0` on both. The script's exit code is 1 on both, and only because of `S2` — the packet's acceptance
says that is expected and that the report must say so; it does.

**Why Athar needs two runs, stated plainly.** Run 1 is not a page failure: the emulator itself stalled —
`ANR in com.google.android.apps.nexuslauncher`, `ANR in com.google.android.apps.messaging`,
`ANR in com.android.vending`, a `System UI isn't responding` dialog in `s-final-ui.xml` — while our WebView had
already logged its own console lines, and the app's pid was alive. The script keys `S1` on `am start -W` saying
`Status: ok`, so a device-wide stall fails it and stops the run. The identical command was run again (no change
to the script, the APK, or the device beyond an uninstall-first install) and `S1` was green. Both runs are kept:
`target/r-ui-6/athar-run1.json`, `target/r-ui-5/Athar_GPlay-run1/`. Neither AVD was ever wiped except
`Pixel_7_API_35` (`-wipe-data`, allowed); `Athar_GPlay` was not.

**`S2`–`S5` outcomes, verbatim.** `S2` FAIL on both AVDs (notes above). `S3`, `S4`, `S5`: **not run** — the
script `stop`s at the first failed step by its own design ("pairing against a correct deep link failed (finding,
not a repair task)"; "CDP never answered, so the S2 pairing assertion cannot be met"). Nothing was re-run to
chase them and no scope was widened.

**The `Origin: null` finding, carried to `R-UI-7`, measured directly**
(`target/discrimination/r-ui-6/origin-null-probe.txt`; throwaway daemon on host 18767/18768 with a smoke-style
config, foreign 8765/8766 untouched, never logged the token):

- `Origin: null` → **403** `{"error":"origin not allowed"}`
- `Origin: http://127.0.0.1:8765` → **403** `{"error":"origin not allowed"}` (the smoke config writes no
  `allowed_origins`)
- `Origin: tauri://localhost` (the only `APP_ORIGINS` entry that matters here) → **401** `{"error":"unauthorized"}`
  — i.e. the origin passed and the token check was next, which is what proves the 403s above are the origin rule

So the page now renders and cannot yet talk: the RPC listener is jsonrpsee on the ws port and refuses any
present-but-unlisted `Origin`, and a `file:` document can only ever present `null`. Whether the answer is
admitting `null`, an `allowed_origins` entry written by the harness, or a `WebViewAssetLoader` `appassets`
origin is a product decision for `R-UI-7` (it touches `crates/warshad` or `MainActivity.java`, both out of scope
here). Nothing in this packet tried to work around it, and the CSP was not touched.

## No-collateral proof

```
git diff --name-only 8fc58db | grep -vE '^(apps/remote/(vite.config.ts|src/|scripts/verify-pwa.mjs)|docs/|PROGRESS.md|DECISIONS.md)'
git diff --name-only 8fc58db | grep -E '\.rs$|Cargo|apps/mobile|gradle|crates/'
```

Both print nothing (run after the docs commit; the same grep over tracked + untracked paths printed nothing
before it). No `dist/`, `assets/public`, APK or `target/` file is committed.

## Findings and limits

- **The stylesheet-inlining above** is the one deviation from the packet's prose, forced by Vite's non-ES output
  handling; the fix that would restore a real stylesheet (`cssCodeSplit: false`) is outside the frozen edit.
- **`check:pwa`'s fourth new check does not discriminate** on this base (both bundles start with `var`). It is a
  guard, not a proof.
- **The e2e gate cannot be green on this tree** (`OD1` stale remote visual baselines, 84 diffs) and is identical
  at the base; this packet neither caused nor fixed it.
- **`S3`–`S5` are unproven**, by the script's design and the `Origin: null` wall — not by anything in this
  packet passing silently.
- **The `data:` font refusal** under `font-src 'self'` is visible in the same console that used to show the CORS
  error; it is the known cosmetic finding the packet says not to touch, and it is on http too.
- **Athar's `S2` CDP silence** matches R-UI-5's note about that AVD; the step is reported as not machine-verified
  rather than passed.
- The `warshad` binary used for the device runs is the host's existing debug build (no Rust diff on this branch),
  not a build made in this worktree.
