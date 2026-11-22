# R-UI-6c — Android build: `Sync` is `NO-SOURCE` on a clean tree, APK ships no web assets

Status: spec frozen. Base: `68a8d5d` (repair/dev-csp-f474776). **Continues the unmerged lane `zl-rui6b-gradlew`
(`c74aa3a` + `e63ec13` + `b176558`) — not a restart.** Closes R-UI-6b. Independent of bridge / R-EXT work.

## Why

R-UI-6b-report (branch `zl-rui6b-gradlew`, `b176558`) fixed both of R-UI-6b's frozen defects and then stopped on a
third one that R-UI-6b's measured inputs did not contain:

- §"Gate results" G2 *as scripted from clean state* **FAIL**: `./gradlew assembleDebug --no-daemon` exits **0**,
  log line 4 is `> Task :app:syncRemoteWebAssets NO-SOURCE`, the `Building apps/remote…` line is absent, no pnpm run.
- §"Gate results" G3 *clean-state APK* **FAIL**: `app-debug.apk` 862,826 B (sha256 `409d3f8b…`), **0**
  `assets/public/` entries. The same build with `dist` present: 1,845,226 B, 54 entries, 0 `*.map`.
- §"The blocker": `syncRemoteWebAssets` is a `Sync` whose only source is `apps/remote/dist`; Gradle decides
  `NO-SOURCE` before any task action, so the `doFirst` that builds `dist` never runs. The build that used to fail
  loudly now succeeds silently with an empty shell. G4 (negative) cannot fire from the clean state either.
- §"The blocker" names the follow-up (a separate build task the `Sync` depends on) and leaves the shape to the
  packet author. This packet freezes it.

`PROGRESS.md` (run 2026-11-15) holds R-UI-6b red and unmerged for exactly this reason.

## Goal

From a clean tree (no `apps/remote/dist`, no `assets/public`), `cd apps/mobile/android && ./gradlew assembleDebug
--no-daemon` exits 0 **and** the APK carries the web assets: the same file set and bytes the interim workaround
produced (`dist` minus `*.map`). A failing or empty web build fails the Gradle build, from the clean state too.

## Measured inputs (2026-11-15, base `68a8d5d`)

- **The 6b fixes are not in the base.** `git merge-base --is-ancestor e63ec13 68a8d5d` → exit 1. At `68a8d5d`
  `gradlew` is still `100644 adff685a…` and `app/build.gradle` still has the bare `exec {`. On `zl-rui6b-gradlew`:
  `100755 adff685a…` and `providers.exec`. The lane's fork point is `1b9bc69`, an ancestor of `68a8d5d`.
- **The two lines join cleanly.** `git merge-tree --write-tree 68a8d5d zl-rui6b-gradlew` → exit 0, no conflict.
  `git diff --stat 1b9bc69 68a8d5d -- apps/mobile apps/remote` is empty; `packages/client/src/index.ts` and
  `packages/i18n/src/v3/{ar,en}/settings.ts` did change in that range, so the web bundle hash may differ from 6b's.
- **Task graph, `apps/mobile/android/app/build.gradle` at `b176558`:** l.111-114 `remoteDistDir`; l.116
  `webAssetsDir`; l.118-149 `syncRemoteWebAssets` (`Sync`): l.123-138 `doFirst` (lifecycle line l.124,
  `repoRoot`/`pnpm` locals l.125-127, `providers.exec` l.128-132, `index.html` post-check l.133-137), then `from
  remoteDistDir` / `into webAssetsDir` / `preserve { include ".gitkeep" }` / `exclude '**/*.map'` (l.140-148);
  l.153-155 `tasks.matching { it.name == "preBuild" }.configureEach { dependsOn syncRemoteWebAssets }`. That hook
  is the only edge into the Android graph and serves debug and release alike. No other task or script in the repo
  names `syncRemoteWebAssets` (grep over `*.gradle`, `*.sh`, `*.yml`, `*.mjs`, `package.json`).
- **Mechanism reproduced** in a scratch project outside the repo, with the installed `gradle-9.3.1`:
  `Sync` + `doFirst` + absent source dir → `> Task :syncIt NO-SOURCE`, exit 0, nothing built. With the frozen shape
  below → `> Task :buildIt`, lifecycle line, `> Task :syncIt`, exit 0, `out/index.html` present, `.map` excluded;
  build command exiting 3 → `:buildIt FAILED`, `finished with non-zero exit value 3`, exit 1; build command
  succeeding without `index.html` → the post-check `GradleException`, exit 1; second run → `:buildIt` runs again,
  `:syncIt UP-TO-DATE`. The Android build itself was **not** run for this packet (research only).
- **Asset count.** 6b measured 54 `assets/public/` entries. The shared checkout's leftover `apps/remote/dist`
  (built 2026-11-14, commit unknown) holds 58 files: 55 non-map + 3 `*.map`. The count is therefore build-dependent;
  the gate freezes *equality with `dist` minus `*.map`*, and treats 54 as the reference to report against.
- `assets/public/` and `dist/` are gitignored (`apps/mobile/.gitignore:12`, `.gitignore:10`); no `.gitkeep` is
  tracked under `app/src/main/assets`. Configuration cache is not enabled. No fresh worktree has `node_modules`.

## Frozen fix

`apps/mobile/android/app/build.gradle` only. Move the build out of the `Sync`'s `doFirst` into its own task and
make the `Sync` depend on it. Replace l.107-149 of `b176558` with:

```groovy
// ---------------------------------------------------------------------------
// Sync the built remote PWA (apps/remote/dist) into assets/public.
// buildRemoteWebAssets builds apps/remote via pnpm first, as a dependency: a
// Sync with a missing source dir is NO-SOURCE and would skip any doFirst.
// ---------------------------------------------------------------------------
def remoteDistDir = rootDir.toPath()
        .normalize().resolve("../../../apps/remote/dist").toFile()
// rootDir = apps/mobile/android → ../../.. = repo root → apps/remote/dist
assert remoteDistDir.parentFile.name == "remote"

def webAssetsDir = file("src/main/assets/public")

def buildRemoteWebAssets = tasks.register("buildRemoteWebAssets") {
    description = "Builds apps/remote into apps/remote/dist " +
            "(pnpm --filter warsha-remote build)."
    group = "warsha"

    doLast {
        logger.lifecycle("Building apps/remote with pnpm before sync…")
        def repoRoot = remoteDistDir.parentFile.parentFile.parentFile
        def pnpm = org.gradle.internal.os.OperatingSystem.current().isWindows()
                ? ["cmd", "/c", "pnpm"] : ["pnpm"]
        def result = providers.exec {
            workingDir repoRoot
            commandLine pnpm + ["--filter", "warsha-remote", "build"]
        }.result.get()
        result.assertNormalExitValue()
        if (!new File(remoteDistDir, "index.html").isFile()) {
            throw new GradleException(
                    "apps/remote/dist/index.html missing after build. " +
                    "Run `pnpm --filter warsha-remote build` manually.")
        }
    }
}

def syncRemoteWebAssets = tasks.register("syncRemoteWebAssets", Sync) {
    description = "Copies apps/remote/dist into android assets/public " +
            "(the WebView loads file:///android_asset/public/index.html)."
    group = "warsha"

    dependsOn buildRemoteWebAssets

    from remoteDistDir
    into webAssetsDir
    // (the four existing comment lines and the two statements below stay byte-identical)
    preserve { include ".gitkeep" }
    exclude '**/*.map'
}
```

Frozen decisions:

- **D1 (shape):** an untyped task with `doLast`, not `type: Exec`. The body is l.124-137 of `b176558` moved
  verbatim — same lifecycle line, same `providers.exec`, same post-check — so 6b's measured G4 behaviour (cannot
  start → exit 1; exit 3 → exit 1) carries over unchanged. An `Exec`-typed task would be a second, unmeasured
  mechanism for the same command.
- **D2 (edge):** `dependsOn buildRemoteWebAssets` inside the `Sync` registration. The `preBuild` hook (l.151-155)
  is untouched; `buildRemoteWebAssets` is never hooked to `preBuild` directly.
- **D3 (always runs):** `buildRemoteWebAssets` declares **no** inputs/outputs and no `onlyIf`, so it runs on every
  build and the APK always reflects current sources; the `Sync` keeps its own up-to-date check. No "skip when
  `dist` exists" shortcut — that is the stale-reuse path. Cost: one pnpm build per Gradle build (~1m50 in 6b).
- **D4 (Sync body):** `from` / `into` / `preserve` / `exclude '**/*.map'` and their comments unchanged; the
  `doFirst` block is removed whole, nothing else in the file changes.
- If the frozen shape does not make the clean-state gate green under Gradle 9.3.1 / AGP 9.1.0, STOP and report
  the log — do not try a different shape (`from(provider)`, `onlyIf`, declared outputs, `mustRunAfter`, …).

## Allowed files

- `apps/mobile/android/app/build.gradle` (the block above only)
- the packet report `docs/zadloop/packets/R-UI-6c-report.md`

Carried in by continuing the 6b lane, **not to be edited here**: `apps/mobile/android/gradlew` (mode bit,
`c74aa3a`), the `providers.exec` rewrite (`e63ec13`), `docs/zadloop/packets/R-UI-6b-report.md` (`b176558`).

## Out of scope

Everything else: `gradlew`/`gradlew.bat`, wrapper config, `gradle.properties`, root `build.gradle`,
`settings.gradle`, AGP/Gradle versions, configuration cache, `apps/remote` (sources, `package.json`, Vite/SW
scripts), `MainActivity.java`, manifest, CSP, bridge/daemon/Rust, `scripts/` (incl. `android-smoke.sh`), smoke
S2–S5 (R-UI-7's), `assembleRelease` signing/naming/byte-compare and the W7 gates, `renameReleaseApk`,
`docs/VERIFY.md:172` and `apps/mobile/README.md:53` wording (they describe the old "if dist/ is missing"
behaviour — list as a follow-up in the report, do not edit), `PROGRESS.md`/`DECISIONS.md` (the PM's at merge),
`R-UI-6b.md`, `R-UI-6b-report.md`, this packet.

## Constraints

Isolated worktree, `zl-rui6c-*` branch; implementer never authors the gate; reviewer separate, never edits;
verifier separate, never repairs; no force push/tag/publish; no rebase or amend of `c74aa3a`/`e63ec13`/`b176558`
(the 6b report cites those hashes); no secrets; no test weakening; one small Conventional Commit for the fix
(e.g. `fix(mobile): build remote web assets as a dependency of the asset sync`) plus one for the report.
`assets/public` and `dist` stay gitignored — never commit built assets. No `-x` and no `bash ./gradlew` anywhere
in the gate. Never touch the shared checkout's `apps/remote/dist` or a foreign listener on host `8765/8766`.

## Steps

1. `git worktree add .agents/worktrees/zl-rui6c-sync -b zl-rui6c-sync zl-rui6b-gradlew` (tip `b176558`), then
   inside it `git merge --no-edit 68a8d5d` (measured conflict-free). Run G0.
2. `pnpm install --frozen-lockfile` at the worktree root (a fresh worktree has no `node_modules`).
3. Reproduce the red before editing: clean state (G1 commands), `./gradlew assembleDebug --no-daemon` → exit 0,
   `syncRemoteWebAssets NO-SOURCE`, 0 `assets/public/` entries. Log to `target/r-ui-6c/repro-clean.log`.
4. Apply the frozen fix; commit.
5. Run G1–G8 in order; logs and APK copies under `target/r-ui-6c/` (gitignored).
6. Write the report: commits, diff stat, each gate's exit code and evidence line, APK size/sha256, entry count
   vs 54 with the file-level difference if it is not 54, anything not run.

## Acceptance gate (frozen)

All paths relative to the worktree root unless a `cd` is shown. `APK=apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

- **G0 base.** `git merge-base --is-ancestor c74aa3a HEAD && git merge-base --is-ancestor e63ec13 HEAD && git
  merge-base --is-ancestor 68a8d5d HEAD` → exit 0. `git ls-files -s apps/mobile/android/gradlew` → starts `100755`.
- **G1 clean state.** `rm -rf apps/remote/dist apps/mobile/android/app/src/main/assets/public
  apps/mobile/android/app/build`, then `test ! -e apps/remote/dist && test ! -e
  apps/mobile/android/app/src/main/assets/public && test ! -e "$APK"` → exit 0. (Resolve and check the three
  absolute paths are inside the lane's own worktree before running the `rm`.)
- **G2 clean-state build** (failed in 6b). `cd apps/mobile/android && ./gradlew assembleDebug --no-daemon
  --console=plain > ../../../target/r-ui-6c/gate-clean.log 2>&1` → **exit 0**. In the log:
  `grep -n '^> Task :app:buildRemoteWebAssets$'` matches; `grep -n 'Building apps/remote with pnpm before sync…'`
  matches; `grep -n '^> Task :app:syncRemoteWebAssets$'` matches on a later line (bare — no `NO-SOURCE`,
  `UP-TO-DATE`, `SKIPPED`, `FROM-CACHE`); `grep -cE ':app:(build|sync)RemoteWebAssets NO-SOURCE'` → 0;
  `BUILD SUCCESSFUL`; no deprecation-turned-error.
- **G3 clean-state APK** (failed in 6b). `test -f "$APK"`; then
  - `unzip -Z1 "$APK" | grep -c '^assets/public/'` → > 0; report the number against 54;
  - `unzip -Z1 "$APK" | grep -x 'assets/public/index.html'` and `… | grep -E '^assets/public/assets/.+\.js$'` match;
  - `unzip -Z1 "$APK" | grep -c '\.map$'` → 0;
  - interim-workaround equivalence, names **and** bytes: `rm -rf target/r-ui-6c/apk && unzip -q "$APK"
    'assets/public/*' -d target/r-ui-6c/apk && diff -r -x '*.map' apps/remote/dist
    target/r-ui-6c/apk/assets/public` → exit 0, no output;
  - record size and `sha256sum "$APK"`; copy to `target/r-ui-6c/app-debug-clean.apk`. Size must not be the empty
    shell's 862,826 B.
- **G4 negative from the clean state** (could not fire in 6b). Scratch shims only, under `target/r-ui-6c/shim-*/`,
  never committed; re-run the G1 commands before each case:
  - a `pnpm` shim that `exit 3`, first on `PATH` → `./gradlew assembleDebug --no-daemon` exits **non-zero**, log
    has `> Task :app:buildRemoteWebAssets FAILED` and `finished with non-zero exit value 3`, `"$APK"` absent;
  - a `pnpm` shim that `exit 0` and builds nothing → exits **non-zero** with `apps/remote/dist/index.html missing
    after build`, `"$APK"` absent.
- **G5 warm rebuild.** Without cleaning after a green G2: same command → exit 0, `> Task
  :app:buildRemoteWebAssets` executed again (D3), G3's `diff -r` still clean. Report whether the APK sha256 equals
  G2's (reported, not gated).
- **G6 task graph.** `cd apps/mobile/android && ./gradlew :app:assembleDebug --dry-run --no-daemon
  --console=plain` → `:app:buildRemoteWebAssets SKIPPED` precedes `:app:syncRemoteWebAssets SKIPPED` precedes
  `:app:preBuild SKIPPED`.
- **G7 smoke S1 on the G2/G3 APK**, script as-is: `bash scripts/android-smoke.sh --avd Pixel_7_API_35 --report
  target/r-ui-6c/pixel7.json` and the same for `Athar_GPlay` (`target/r-ui-6c/athar.json`) → S1 `pass: true` on
  both, `crashes: 0`, `tokenLeaks: 0`. S2–S5 are run and reported only (R-UI-7's); read the JSON, not the script's
  exit code (it exits 0 on a `STOP` verdict — 6b-report §"Not run / limits").
- **G8 file scope.** This lane's own change: `git diff --name-only b176558 HEAD -- apps/` → exactly
  `apps/mobile/android/app/build.gradle`. Whole lane against the base: `git diff --name-only 68a8d5d HEAD` →
  exactly `apps/mobile/android/app/build.gradle`, `apps/mobile/android/gradlew`,
  `docs/zadloop/packets/R-UI-6b-report.md`, `docs/zadloop/packets/R-UI-6c-report.md`. If the merge-in tip is later
  than `68a8d5d` (e.g. it already carries this packet), diff against that tip instead and say so.
  `git diff 68a8d5d HEAD -- apps/mobile/android/gradlew` → mode change only. `git status --short` lists nothing
  under `assets/public` or `apps/remote/dist`.
- Discrimination: step 3's red log plus G2's green log on the same clean state are the pair; both are kept.
- Not run here, state in the report: `assembleRelease` (same `preBuild` hook, so it now rebuilds the web bundle
  too — release byte-compare / W7 is a separate packet), any Gradle-8 comparison, Windows (`cmd /c pnpm`) path.
