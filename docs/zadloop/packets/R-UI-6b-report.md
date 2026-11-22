# R-UI-6b report — `gradlew` mode + Gradle-9 `exec`

**Status: both frozen defects are fixed and measured; `G1`, `G4`, `G5`, `G6` pass. `G2` and `G3` do not pass
as scripted from the packet's own mandated clean state (step 3).** A third defect that the packet's measured
inputs do not contain pre-empts the whole task: the `Sync` task `syncRemoteWebAssets` is `NO-SOURCE` whenever
`apps/remote/dist` is absent, so the `doFirst` that builds `dist` never runs, and `assembleDebug` exits **0** with
an APK that carries **no web assets at all**. Fixing that means reshaping the task (build as a *dependency*, not a
`doFirst` action), which is outside the frozen scope — the packet allows the `exec` rewrite plus step-4
Gradle-9 removals, and this is neither. It is therefore reported, not repaired (`STOP` on that point).

- **Branch:** `zl-rui6b-gradlew` (lane `zl-rui6b-*`).
- **Base:** `1b9bc69` on `repair/dev-csp-f474776` (packet base `32b8764` is an ancestor; this lane was told to cut
  from the packet-merge tip, which adds only `docs/zadloop/packets/R-EXT-4.md` + `R-UI-6b.md`).
- **Worktree:** `.agents/worktrees/zl-rui6b-gradlew` (isolated).

| Commit | What |
|---|---|
| `c74aa3a` | `fix(mobile): make gradlew executable` — index `100644` → `100755` via `git update-index --chmod=+x`, `chmod +x` on the working file. Blob `adff685a…` unchanged, zero content diff. |
| `e63ec13` | `fix(mobile): replace removed Task.exec with providers.exec` — `app/build.gradle` `syncRemoteWebAssets.doFirst`, +3/−2. |
| *this commit* | `docs(zadloop): R-UI-6b report` — this file only. |

Diff against the base: 2 files, `+3 / −2` (`app/build.gradle`, `gradlew` mode only) plus this report. No Rust, TS,
`apps/remote`, manifest, CSP, `scripts/`, `gradle.properties`, wrapper config or version change.

## What changed

**Mode (`apps/mobile/android/gradlew`).** `git update-index --chmod=+x` + `chmod +x`; index is now
`100755 adff685a0348c64b2b64f0b302f1f82b28eeaaea 0` — the same blob id as the base, so the diff is a pure mode
change (`0 insertions(+), 0 deletions(-)`). `gradlew.bat` untouched.

**Exec (`apps/mobile/android/app/build.gradle:128`).** The frozen replacement, verbatim; `providers.exec` **won**,
the `ProcessBuilder` fallback was **not** needed and was not written:

```groovy
def result = providers.exec {
    workingDir repoRoot
    commandLine pnpm + ["--filter", "warsha-remote", "build"]
}.result.get()
result.assertNormalExitValue()
```

`doFirst`, the `repoRoot`/`pnpm` locals, the `index.html` post-check and `from/into/preserve/exclude` are
untouched. The provider captures the pnpm output instead of streaming it (as the packet allows) and a non-zero
exit still fails the task (`G4` below measures both the "cannot start" and "exit 3" paths).

**Wrapper config:** unchanged — `gradle-9.3.1-all` is the installed distribution and `validateDistributionUrl=true`
is fine under it; no Gradle-9 incompatibility was found that needed an edit.

**Reproduction → fix, measured.** Base, `cd apps/mobile/android && ./gradlew assembleDebug --no-daemon` →
`bash: ./gradlew: Permission denied`, **exit 126** (`target/r-ui-6b/repro-B1.log`). Base, `bash ./gradlew …` with
`apps/remote/dist` present → **exit 1**, `Could not find method exec() … on task ':app:syncRemoteWebAssets' of type
org.gradle.api.tasks.Sync` (`repro-B2-dist.log`), the packet's B2 exactly. After the fix the same command
(direct `./gradlew`, no `bash`, no `-x`) → **exit 0** in 1m50s, log carrying both `> Task :app:syncRemoteWebAssets`
and `Building apps/remote with pnpm before sync…` (`gate-B-exec-dist.log`).

## Gate results

| Gate | Result | Evidence |
|---|---|---|
| G1 mode | **PASS** | `git ls-files -s …/gradlew` → `100755 adff685a… 0`; `git diff --stat 32b8764 -- …/gradlew` → `1 file changed, 0 insertions(+), 0 deletions(-)` (mode-only header, no line hunks). |
| G2 as scripted from clean state | **FAIL** | `./gradlew assembleDebug --no-daemon` → exit **0**, but log line 4 is `> Task :app:syncRemoteWebAssets NO-SOURCE`, the `Building apps/remote…` line is **absent**, and no pnpm build happens (`gate-A-clean.log`, `gate-A2-clean.log` — byte-identical APK both times). |
| G2 with `apps/remote/dist` present | **PASS** | exit **0**, `> Task :app:syncRemoteWebAssets` executed, `Building apps/remote with pnpm before sync…` present, pnpm ran to completion, `BUILD SUCCESSFUL in 1m 50s`, deprecation warning only (no deprecation-turned-error) — `gate-B-exec-dist.log`. |
| G3 clean-state APK | **FAIL** | `app-debug.apk` 862,826 B, sha256 `409d3f8bfa2ab1d58a9c6c38959212452930f1ba9b4213c41578e6dac993bb7c`, **0** `assets/public/` entries in `unzip -l`. Saved as `target/r-ui-6b/app-debug-clean-noassets.apk`. |
| G3 exec-path APK | **PASS** | 1,845,226 B, sha256 `e95e8042004728679049c885b55ddd1f5f1a0ad4b4095720c29941c9caf7610e`, 54 `assets/public/` entries incl. `assets/public/index.html` and `assets/public/assets/index-DvDUPUH0.js`, **0** `*.map` (`assets/public/…/sw.js.map` excluded by the task's own `exclude '**/*.map'`). Saved as `target/r-ui-6b/app-debug-exec-path.apk`. |
| G4 negative | **PASS** (with dist present) | `PATH` without pnpm → exit **1**, `A problem occurred starting process 'command 'pnpm''` (`gate-G4-negative.log`); a scratch `pnpm` shim exiting 3 on `PATH` → exit **1**, `Process 'command 'pnpm'' finished with non-zero exit value 3` (`gate-G4b-nonzero.log`). Errors are surfaced, not swallowed. From the clean state the same negative check cannot fire at all (task `NO-SOURCE`) — the same blocker as `G2`. |
| G5 smoke S1 | **PASS both AVDs** | `Pixel_7_API_35`: `S1 pass (devtools)` — "start Status: ok; pid 2436 alive after 5s; pairing plate present"; `Athar_GPlay`: `S1 pass (devtools)` — same wording, pid 1819. Both reports: `crashes: 0`, `tokenLeaks: 0`. `S2` fails on both (`Pixel_7_API_35`: cold `warsha://pair` never reached a paired bench, state=unpaired; `Athar_GPlay`: CDP evaluate never answered) and stops the script — that is R-UI-7's, as the packet says, and does not fail this packet. |
| G6 file scope | **PASS** | `git diff --name-only 1b9bc69` → `apps/mobile/android/app/build.gradle`, `apps/mobile/android/gradlew`, plus this report. Against the packet's `32b8764` two packet docs also appear (`docs/zadloop/packets/R-EXT-4.md`, `R-UI-6b.md`): they arrived with the base branch (`1b9bc69`), not with this lane. |

Smoke was run on the exec-path APK (sha256 `e95e8042…`), i.e. the APK the fixed build makes when the sync task
actually runs; both runs used `scripts/android-smoke.sh` exactly as it is, outside `target/r-ui-6b/`. The foreign
listener owning host `8765/8766` was never touched: the script moved this run's daemon to `18765/18766` and bridged
with `adb reverse`. `Athar_GPlay` ran without `-wipe-data` (uninstall-first only); `Pixel_7_API_35` carried the
script's own `-wipe-data`.

## The blocker (why G2/G3 read red above)

`syncRemoteWebAssets` is a `Sync` whose only source is `apps/remote/dist`. Gradle 9 decides `NO-SOURCE` **before**
running any task action, so when `dist` is absent — exactly the state packet step 3 mandates — `doFirst` never
executes: no `Building apps/remote…` line, no pnpm run, and the copy is skipped. `assembleDebug` then reports
`BUILD SUCCESSFUL` and packages an APK with no `assets/public/` at all (862,826 B vs 1,845,226 B; deterministic:
same sha256 on two separate clean runs). The documented build therefore still does not produce the APK that smoke
needs, and it fails *silently* where it used to fail loudly.

This is not a Gradle-9 removal (nothing about it depends on `Task.exec`), so step 4 — "another Gradle-9 removal …
fix it in the same allowed files" — does not authorise a repair, and repointing the build out of `doFirst` changes
the task shape the frozen fix explicitly told me to keep. Not applied; proposed as the minimal follow-up for a
packet amendment (R-UI-6c):

```groovy
def buildRemoteWebAssets = tasks.register("buildRemoteWebAssets") {
    group = "warsha"
    doLast { /* same providers.exec block + the index.html post-check */ }
}
syncRemoteWebAssets.configure { dependsOn buildRemoteWebAssets }
```

A dependency runs before the `Sync` snapshots its source, so `dist` would exist by the time `NO-SOURCE` is
evaluated, `G2`/`G3` would hold from a clean tree, and the `providers.exec` body stays identical. Whether the packet
wants that shape or something else (e.g. `from(buildDir/…, remoteDistDir)`) is the author's call, so it is named
here rather than guessed at in code.

## Not run / limits

- `assembleRelease` byte-compare, release signing/naming and the W7 gates: out of scope by the packet.
- No Gradle-8 comparison for the `NO-SOURCE` behaviour: only `gradle-9.3.1-all` is installed, so "pre-existing
  rather than Gradle-9-introduced" is unverified here.
- The smoke script exits **0** on a `STOP` verdict (its body ends with `say "verdict: …"`, no failing exit); the
  report JSON is the verdict, and that is what was read above. Pre-existing and in `scripts/`, so untouched.
- `PROGRESS.md`, `DECISIONS.md` and the packet file were not edited (not in this packet's allowed files).

## Artifacts

All under `target/r-ui-6b/` (gitignored): `repro-B1.log`, `repro-B2-dist.log`, `gate-A-clean.log`,
`gate-A2-clean.log`, `gate-B-exec-dist.log`, `gate-G4-negative.log`, `gate-G4b-nonzero.log`,
`seed-pnpm-build.log`, `app-debug-exec-path.apk`, `app-debug-clean-noassets.apk`, `pixel7.json`, `athar.json`;
smoke run dirs under `target/r-ui-5/{Pixel_7_API_35,Athar_GPlay}/` (`script.log`, `logcat.txt`, `*.png`).
