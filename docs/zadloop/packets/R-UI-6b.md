# R-UI-6b — Android build rot: `gradlew` mode + Gradle-9 `exec`

Status: spec frozen. Base: `32b8764` (repair/dev-csp-f474776). Independent of R-UI-7 / bridge work.

## Why

R-UI-5-report (B1, B2, B3) and R-UI-6-report ("Acceptance gate (device)") record that `assembleDebug` cannot run
as documented, and that R-UI-5/6/7 built their APKs with an interim workaround (`pnpm --filter warsha-remote
build`, `rsync -a --delete --exclude '*.map' apps/remote/dist/ apps/mobile/android/app/src/main/assets/public/`,
`bash ./gradlew assembleDebug --no-daemon -x syncRemoteWebAssets`). R-UI-6 (§"Scope split") deferred both defects
here. Until fixed, the Gradle build is never proven and the APK under smoke is not what the documented build makes.

## Goal

`cd apps/mobile/android && ./gradlew assembleDebug --no-daemon` exits 0, as scripted, with no `-x`, and the APK it
produces passes smoke S1.

## Measured inputs (base `32b8764`)

- **B1 — mode.** `git ls-files -s apps/mobile/android/gradlew` → `100644 adff685a… 0` (non-executable in git;
  `gradlew.bat` is `100644`, correct). Direct exec → `Permission denied`, exit 126 (R-UI-5 B1). Note the local
  working-copy file is `-rw-rw-r--` too; the index is what must change.
- **B2 — failing line.** `apps/mobile/android/app/build.gradle:128`: `exec { workingDir repoRoot; commandLine
  pnpm + ["--filter", "warsha-remote", "build"] }` inside `doFirst` (l.123-137) of the `Sync` task
  `syncRemoteWebAssets` (l.118). The unqualified `exec` resolves to `Task.exec`/`Project.exec`, both removed in
  Gradle 9 → `Could not find method exec() … on task ':app:syncRemoteWebAssets'`, exit 1 (R-UI-5 B2). It is the
  only `exec` in any `*.gradle` under `apps/mobile/android` (grep).
- **Versions.** `gradle/wrapper/gradle-wrapper.properties`: `distributionUrl=…/gradle-9.3.1-all.zip`,
  `validateDistributionUrl=true`. `~/.gradle/wrapper/dists/gradle-9.3.1-all` is already present: wrapper and
  installed distribution are both 9.3.1 — **no version mismatch, the wrapper config needs no change**. AGP is
  `9.1.0` (`android/build.gradle:4`). No system `gradle` on PATH; the wrapper is the only entry point.
- Configuration cache is not enabled (`gradle.properties`: jvmargs, parallel, caching, androidx only).

## Frozen fix

1. **Mode bit:** `git update-index --chmod=+x apps/mobile/android/gradlew` → index `100755`; also `chmod +x` the
   working file. Content unchanged. (`gradlew.bat` untouched.)
2. **`build.gradle` l.128-131:** replace the `exec {…}` block with `providers.exec` (Gradle-9-supported, runs at
   execution time inside `doFirst`):
   ```groovy
   def result = providers.exec {
       workingDir repoRoot
       commandLine pnpm + ["--filter", "warsha-remote", "build"]
   }.result.get()
   result.assertNormalExitValue()
   ```
   Keep the surrounding `doFirst`, the `repoRoot`/`pnpm` locals, the `index.html` post-check and the Sync
   `from/into/preserve/exclude` untouched. The pnpm output is captured by the provider, not streamed — acceptable;
   a failure must still fail the task with the non-zero exit surfaced. If `providers.exec` cannot satisfy that
   under 9.3.1, the sole permitted fallback is `new ProcessBuilder(pnpm).directory(repoRoot).inheritIO().start()`
   with `waitFor() != 0` → `GradleException`; record which was used and why.
3. **Wrapper config:** no change expected. Touch `gradle-wrapper.properties` only if the gate proves a Gradle-9
   incompatibility that cannot be solved inside `build.gradle` — report it instead of guessing.
4. If the first un-skipped build surfaces another Gradle-9 removal in `app/build.gradle`/`build.gradle`, fix it in
   the same allowed files and list it; anything outside them → STOP and report.

## Allowed files

- `apps/mobile/android/gradlew` (mode bit only; zero content diff)
- `apps/mobile/android/app/build.gradle` (the `syncRemoteWebAssets` exec only, plus step 4 if forced)
- `apps/mobile/android/gradle/wrapper/gradle-wrapper.properties` (only per step 3)
- the packet report `docs/zadloop/packets/R-UI-6b-report.md`

## Out of scope

Everything else: bridge/daemon/Rust, `apps/remote`, `MainActivity.java`, manifest, CSP, `scripts/` (incl.
`android-smoke.sh`), the `Origin: null` / S2–S5 story (R-UI-7), `assembleRelease` signing/naming
(`renameReleaseApk`, W7 gates), AGP/Gradle version bumps, `gradle.properties`, docs outside the report.

## Constraints

Isolated worktree, `zl-rui6b-*` branch from `32b8764`; implementer never authors the gate; reviewer separate;
verifier separate, never repairs; no force push/tag/publish; no secrets; no test weakening; small Conventional
Commits (e.g. `fix(mobile): make gradlew executable`, `fix(mobile): replace removed Task.exec with providers.exec`).
`assets/public` stays gitignored — never commit built assets. No `-x` flag anywhere in the gate.

## Steps

1. Worktree + branch; record `git ls-files -s …/gradlew` (expect 100644) and reproduce both failures
   (`./gradlew assembleDebug --no-daemon` → 126; `bash ./gradlew …` → exit 1, `Could not find method exec()`).
2. Apply fix 1, then fix 2; commit separately.
3. Remove `apps/mobile/android/app/src/main/assets/public/*` (except `.gitkeep`) and `apps/remote/dist` so the sync
   task is proven to build and copy, not reuse leftovers.
4. Run the gate commands below; capture logs under `target/r-ui-6b/`.
5. Write the report (exact modes, diff stat, exit codes, APK size/sha256).

## Acceptance gate (frozen)

- G1 `git ls-files -s apps/mobile/android/gradlew` → starts `100755`; `git diff --stat 32b8764 --
  apps/mobile/android/gradlew` shows mode change only (no line changes).
- G2 `cd apps/mobile/android && ./gradlew assembleDebug --no-daemon` → **exit 0**, invoked directly (no `bash`
  prefix, no `-x`), log shows `Building apps/remote with pnpm before sync…` and `:app:syncRemoteWebAssets`
  executed (not SKIPPED/UP-TO-DATE-from-leftovers), no deprecation-turned-error.
- G3 `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` exists; `unzip -l` lists
  `assets/public/index.html` and `assets/public/assets/*.js`, and no `*.map`.
- G4 Negative check: with pnpm made to fail (e.g. `PATH` without pnpm, or a temporary broken filter name in a
  scratch copy — never committed) the build fails non-zero, proving errors are not swallowed.
- G5 Smoke S1 on the G2 APK, script as-is:
  `bash scripts/android-smoke.sh --avd Pixel_7_API_35 --report target/r-ui-6b/pixel7.json` and the same for
  `Athar_GPlay` → S1 `pass: true` on both (S2–S5 are run and reported only; failures there are R-UI-7's, per
  R-UI-6 report, and do not fail this packet). `crashes: 0`, `tokenLeaks: 0`.
- G6 `git diff --name-only 32b8764` ⊆ allowed files above.
- Not run here, state in the report: `assembleRelease` byte-compare / W7 gates (outside scope).
