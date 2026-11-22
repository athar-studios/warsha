# R-UI-6c-report — `Sync` NO-SOURCE fixed; clean-state APK ships the web assets

Status: **green on the frozen gate**, unmerged. Branch `zl-rui6c-sync`, worktree
`.agents/worktrees/zl-rui6c-sync`. Closes R-UI-6b's third defect (the one `b176558` stopped on).

## Lane

- Base of the lane: `zl-rui6b-gradlew` tip **`b176558`** (`c74aa3a` + `e63ec13` + `b176558` carried in unamended).
- Merged in: **`cd94f53`** (`repair/dev-csp-f474776`) instead of the packet's `68a8d5d`. `68a8d5d` is an
  ancestor of `cd94f53`; the extra content is `docs/progress` + `R-EXT-5` + a v3 gate fix
  (`4a69888`, `apps/desktop` + `packages/{client,i18n}`) and touches no `apps/mobile` file. Merge was
  conflict-free: merge commit **`1a01271`**.
- Fix commit: **`8ef2770`** `fix(mobile): build remote web assets as a dependency of the asset sync`.
- Report commit: `docs(zadloop): R-UI-6c report` (this file).
- `c74aa3a` / `e63ec13` / `b176558` are untouched — no amend, no rebase.

Diff of the lane's own change, `git diff cd94f53 HEAD` (merge tip → HEAD): `apps/mobile/android/app/build.gradle`,
`apps/mobile/android/gradlew`, `docs/zadloop/packets/R-UI-6b-report.md`, `docs/zadloop/packets/R-UI-6c-report.md`.
`build.gradle` is the only fix change: **+14 −5**.

## The fix (as frozen)

`apps/mobile/android/app/build.gradle`, l.107-149 only.

- **D1** — a new untyped `buildRemoteWebAssets` task with `doLast`; the old `Sync.doFirst` body
  (lifecycle line, `repoRoot`/`pnpm`, `providers.exec`, `index.html` post-check) moved verbatim. Not
  `type: Exec`.
- **D2** — `dependsOn buildRemoteWebAssets` inside the `syncRemoteWebAssets` registration. The
  `preBuild` hook is untouched and `buildRemoteWebAssets` is never hooked to `preBuild` directly.
- **D3** — no inputs/outputs, no `onlyIf`: it runs on every build (G5 confirms).
- **D4** — `from` / `into` / `preserve` / `exclude '**/*.map'` and their four comment lines are
  byte-identical; only the `doFirst` block left the `Sync`.
- The frozen shape worked under Gradle 9.3.1 / AGP 9.1.0 on the first attempt, so the STOP-don't-reshape
  rule never fired.

## Discrimination pair (red → green on the same clean state)

| | clean-state `assembleDebug` | task line | `assets/public/` entries | APK |
|---|---|---|---|---|
| **before** (`target/r-ui-6c/repro-clean.log`) | exit **0** | `> Task :app:syncRemoteWebAssets NO-SOURCE` (line 4) | **0** | 862,826 B, `409d3f8b…` |
| **after** (`target/r-ui-6c/gate-clean.log`) | exit **0** | `> Task :app:buildRemoteWebAssets` (l.5) → `Building apps/remote…` (l.6) → `> Task :app:syncRemoteWebAssets` (l.8) | **54** | 1,845,230 B, `94305a4d…` |

The red log reproduces 6b's measurement byte-for-byte (862,826 B, `409d3f8b…`, `NO-SOURCE` at log line 4).

## Gate results (all from the worktree root unless a `cd` is shown)

`APK=apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

- **G0 base — exit 0.** `git merge-base --is-ancestor c74aa3a HEAD && … e63ec13 … && … 68a8d5d HEAD`
  → 0. `git ls-files -s apps/mobile/android/gradlew` → `100755 adff685a…`.
- **G1 clean state — exit 0.** The three absolute targets were resolved and checked to sit inside
  `.agents/worktrees/zl-rui6c-sync` before the `rm -rf`; then `test ! -e` on `apps/remote/dist`,
  `assets/public`, `$APK` all held. Re-run before G2, both G4 cases and the G5 baseline — exit 0 each time.
- **G2 clean-state build — exit 0** (`target/r-ui-6c/gate-clean.log`, `BUILD SUCCESSFUL in 20s`).
  `grep -n '^> Task :app:buildRemoteWebAssets$'` → line 5; `grep -n 'Building apps/remote with pnpm
  before sync…'` → line 6; `grep -n '^> Task :app:syncRemoteWebAssets$'` → line 8, bare (no `NO-SOURCE` /
  `UP-TO-DATE` / `SKIPPED` / `FROM-CACHE`); `grep -cE ':app:(build|sync)RemoteWebAssets NO-SOURCE'` → **0**.
  `Deprecated Gradle features were used in this build` appears at l.54 — it is also at l.54 of the red
  repro log, i.e. pre-existing, not turned into an error.
- **G3 clean-state APK — pass.** `unzip -Z1 | grep -c '^assets/public/'` → **54**. `assets/public/index.html`
  present; `assets/public/assets/.+\.js` matches (`assets/index-DvDUPUH0.js`). `.map` count → **0**.
  Interim-workaround equivalence: `diff -r -x '*.map' apps/remote/dist target/r-ui-6c/apk/assets/public`
  → exit **0**, no output (names **and** bytes). Size **1,845,230 B**, sha256
  **`94305a4d9334a7ac5dc9aa86448a14edcd1c158503bc427b9a17ac164b3a9b8e`**, copied to
  `target/r-ui-6c/app-debug-clean.apk`. Not the empty shell's 862,826 B.
  The fresh `dist` holds 57 files — **54 non-map + 3 `*.map`** — so the entry count equals 54 and there
  is no file-level difference to report against that reference.
- **G4 negatives from the clean state — both fire** (scratch `pnpm` shims under
  `target/r-ui-6c/shim-*`, `PATH`-first, never committed; G1 re-run before each):
  - `exit 3` shim → gradle exit **1**; `> Task :app:buildRemoteWebAssets FAILED` (l.5);
    `Process 'command 'pnpm'' finished with non-zero exit value 3` (l.17); `$APK` absent.
  - `exit 0`, builds nothing → gradle exit **1**; `> Task :app:buildRemoteWebAssets FAILED` (l.5);
    `apps/remote/dist/index.html missing after build.` (l.17); `$APK` absent.
  This is the case 6b could not exercise at all.
- **G5 warm rebuild — exit 0** (`target/r-ui-6c/gate-warm.log`, no cleaning in between).
  `buildRemoteWebAssets` executed again (l.5, D3); `syncRemoteWebAssets UP-TO-DATE` (l.8).
  `diff -r -x '*.map'` still clean (exit 0). APK sha256 **equal to G2's** (`94305a4d…`) — reported, not gated.
- **G6 task graph — exit 0** (`target/r-ui-6c/gate-dryrun.log`): `:app:buildRemoteWebAssets SKIPPED` (l.4) →
  `:app:syncRemoteWebAssets SKIPPED` (l.5) → `:app:preBuild SKIPPED` (l.6).
- **G7 smoke S1 — `pass: true` on both AVDs**, on the G2/G3 APK
  (`target/r-ui-5/app-debug.apk` sha256 `94305a4d…`, identical to `target/r-ui-6c/app-debug-clean.apk`):
  - `Pixel_7_API_35` → `target/r-ui-6c/pixel7.json`: S1 `pass=1 mode=devtools`
    (`start Status: ok; pid 2733 alive after 5s; pairing plate present`), `crashes: 0`, `tokenLeaks: 0`.
  - `Athar_GPlay` → `target/r-ui-6c/athar.json`: S1 `pass=1 mode=devtools`
    (`start Status: ok; pid 1829 alive after 5s; pairing plate present`), `crashes: 0`, `tokenLeaks: 0`.
  Both runs ended `verdict: "STOP: pairing against a correct deep link failed"` from **S2**
  (`cold warsha://pair did not reach a paired bench within 15s (state=unpaired, rc=0)`), script exit 1.
  S2–S5 are R-UI-7's and are reported only; S1 is unaffected. No `-wipe-data` was passed to `Athar_GPlay`
  (D5/D6 as the script has them) and nothing on host `8765/8766` was touched: the script detected the
  foreign listener and moved its own daemon to `18765/18766` with `adb reverse`.
- **G8 file scope — pass, diffed against the merge tip** (it is later than `68a8d5d`, carrying this packet
  and R-EXT-5, so per the packet's own instruction the diff base is `cd94f53`):
  - `git diff --name-only cd94f53 HEAD -- apps/` → exactly `apps/mobile/android/app/build.gradle`,
    `apps/mobile/android/gradlew`.
  - `git diff --name-only cd94f53 HEAD` → exactly those two plus
    `docs/zadloop/packets/R-UI-6b-report.md`, `docs/zadloop/packets/R-UI-6c-report.md`.
  - `git diff cd94f53 HEAD -- apps/mobile/android/gradlew` → `old mode 100644` / `new mode 100755` only.
  - `git status --short` → empty; nothing under `assets/public` or `apps/remote/dist` (both gitignored,
    `apps/mobile/.gitignore:12`, `.gitignore:10`; no built asset is committed).
  - For comparison, `git diff --name-only b176558 HEAD` also lists `apps/desktop/**`,
    `crates/**`, `packages/**`, `DECISIONS.md`, `PROGRESS.md` and the R-EXT packets — all of it inherited
    from the merge tip (`git diff --name-only b176558 cd94f53` names the same set), none of it authored here.

## Not run / limits

- `assembleRelease` — not run. It gains the same rebuild-through-`preBuild` behaviour; release
  byte-compare, signing and the W7 gates are a separate packet. Release APK size/runtime unmeasured.
- No Gradle-8 comparison; the measured mechanism is Gradle 9.3.1 / AGP 9.1.0.
- The Windows `cmd /c pnpm` branch of the OS check is untested (Linux x86_64 only).
- G3's 54 equals this build's own `dist` minus maps (54 of 57 files). 6b measured 54 from a different
  bundle; the APK is 4 B larger than 6b's 1,845,226 B because `packages/client/src/index.ts` and
  `packages/i18n/src/v3/{ar,en}/settings.ts` changed between `1b9bc69` and `68a8d5d`.
- S2–S5 are not this lane's gates; their red is carried to R-UI-7 unchanged.

## Findings / follow-ups (out of scope, not edited)

1. **Smoke S2 is red on both AVDs** — a cold `warsha://pair` against a loopback daemon does not reach a
   paired bench within 15 s (`state=unpaired`), with `crashes: 0` and `tokenLeaks: 0`. Same verdict on
   `Pixel_7_API_35` and `Athar_GPlay`, so it is not AVD-specific. R-UI-7's step, recorded here only.
2. `docs/VERIFY.md:172` still says the Gradle task builds the bundle "if `dist/` is missing"; that
   conditional behaviour no longer exists — it now always builds. Not edited (out of scope).
3. `apps/mobile/README.md:53` attributes the always-build to `syncRemoteWebAssets`; the builder is now
   `buildRemoteWebAssets`, which the `Sync` depends on. The sentence's claim is right, its task name is
   stale. Not edited (out of scope).
