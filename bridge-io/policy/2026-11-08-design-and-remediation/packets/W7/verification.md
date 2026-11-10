# Independent verification — packet W7 (Android web-asset sync and signed APK)

Run: `2026-11-08-design-and-remediation` · Packet: W7 · Verifier: independent (not implementer, not reviewer)
Verified commit: `7adbff4dd697e0dff7541a5200a5fcacca8fba6b` — "docs(mobile): record the reproducible release APK hash and size"
Branch: `run/2026-11-08/w7-android-apk` · Base: `0772d502002562505c6438ae712abca7a7328d84` (confirmed ancestor)
Packet worktree (read-only for this verification): `C:/Users/Dragonfly/Downloads/warsha-wt/w7`
Verification time: 2026-11-08T08:54Z–09:02Z · Deliverable written: 2026-11-08T09:02:38Z

## Overall verdict — runnable gates: PASS

All ten gate commands that are implementable on this host pass against commit `7adbff4`. The APK is genuinely byte-reproducible: an isolated clean rebuild produced the exact SHA-256 recorded in `apps/mobile/README.md`. G7.6 is separate: it is a **frozen-gate self-reference defect**, not an implementation failure — no credential value exists in the packet evidence (see §G7.6).

## Environment used

| Item | Value |
|---|---|
| Java | `JAVA_HOME=C:/Program Files/Android/Android Studio/jbr` (OpenJDK bundled with Android Studio) |
| Android SDK | `ANDROID_HOME=C:/Users/Dragonfly/AppData/Local/Android/Sdk` (both env vars were unset in the shell; set explicitly) |
| build-tools / apksigner | `build-tools/36.0.0/apksigner.bat` |
| Node / pnpm | node v26.8.1 / pnpm 9.0.0 |
| unzip | Info-ZIP 6.00 |
| Gradle / AGP (from build output and README) | Gradle 9.3.1 / AGP 9.1.0, compile SDK 36 |

All commands ran in `C:/Users/Dragonfly/Downloads/warsha-wt/w7` with `APK=apps/mobile/android/app/build/outputs/apk/release/app-release.apk`. Each gate has its own log under `gates/` with gate id, exact command, commit, UTC timestamp, real exit code and raw output.

## Gate results

| Gate | Verdict | Exit code | Measured value |
|---|---|---|---|
| G7.S scope | **pass** | 0 | `0` files changed outside `apps/mobile/` |
| G7.1 remote bundle | **pass** | 0 | Vite build OK (106 modules); `dist/sw.js` and `dist/index.html` exist (1,543 B / 2,592 B) |
| G7.2 Gradle rebuild (in place) | **pass (with caveat)** | 0 | `BUILD SUCCESSFUL in 24s`; only 3 tasks executed, `:app:packageRelease UP-TO-DATE` — APK was not repackaged, so this run alone does not prove reproducibility |
| G7.2-detached (true clean rebuild) | **pass** | 0 | `clean assembleRelease` in an isolated copy: `46 actionable tasks: 22 executed, 23 from cache, 1 up-to-date`; `:app:syncRemoteWebAssets` and `:app:packageRelease` **executed**; produced SHA-256 `ce60f2bd…01ff`, size 840,513 B — identical to README |
| G7.3 signature | **pass** | 0 | `Verifies`; v1 false, **v2 true**, v3/v3.1/v4 false; 1 signer `CN=Warsha Remote, OU=Engineering, O=Warsha, L=Riyadh, C=SA`; cert SHA-256 `ad2708e486a68590db9b1ee54e7dfad547759b20f399c16cc6eaad059ce7f3c3` |
| G7.4 web assets in APK | **pass** | 0 | `2` entries (`assets/public/index.html`, `assets/public/sw.js`) |
| G7.5 README hash | **pass** | 0 | APK SHA-256 `ce60f2bd5183779de7fd6a3c7593e0a612e878c8a1c05960f308e06ea3ad01ff` found in `apps/mobile/README.md:92` |
| G7.6 no secret in evidence | **defect** (see §G7.6) | literal **0**; `--exclude=prompt.md` **0**; also excluding scanner transcripts **1** | Only matches are the gate definition itself and logs that quote the search tokens; no credential value present |
| G7.7 assets untracked | **pass** | 0 | `0` tracked files under `apps/mobile/android/app/src/main/assets` |
| G7.A architecture | **pass** | 0 | `arch: 5 rules, 0 violations` |
| G7.P engineering policy | **pass** | 0 | `policy: 8 checks, 0 failures` |

Post-G7.2 re-checks on the final artifact: G7.5-post exit 0 (same hash), G7.4-post exit 0 (`2`), G7.3-post exit 0 (`Verifies`, v2 true) — logs `G7.5-post-rebuild.log`, `G7.4-post-rebuild.log`, `G7.3-post-rebuild.log`.

## APK artifact observed

| Fact | Value |
|---|---|
| Path | `apps/mobile/android/app/build/outputs/apk/release/app-release.apk` |
| Size | **840,513 bytes** |
| SHA-256 | **`ce60f2bd5183779de7fd6a3c7593e0a612e878c8a1c05960f308e06ea3ad01ff`** |
| mtime | 2026-11-08 11:56:11 +0400 (07:56:11Z) |
| Friendly copy `warsha-remote-release.apk` | same size and **identical SHA-256** |
| Git state | untracked/ignored — `apps/mobile/.gitignore:8` (`build/`); worktree `git status --porcelain` = 0 entries before and after builds |

## README hash match: YES

`apps/mobile/README.md` line 92 contains exactly `ce60f2bd5183779de7fd6a3c7593e0a612e878c8a1c05960f308e06ea3ad01ff`; line 83 records `840,513 bytes`. Both match the observed APK (and the newly built one). The friendly-copy claim on line 84 also holds (identical hash).

**Reproducibility evidence.** The in-place G7.2 invocation reported `:app:packageRelease UP-TO-DATE` (its only executed tasks were unrelated), so it did not itself re-sign the APK. To test the claim the gate sequence implies, a genuine `clean assembleRelease` was run in a **detached copy** of the working tree at HEAD (temp dir, `.git`/`node_modules`/`build`/`.gradle`/`dist` excluded; `apps/remote/dist` copied from the fresh G7.1 build; signing resolved from `~/.warsha/signing`). Result: exit 0, `syncRemoteWebAssets` and `packageRelease` executed, output `ce60f2bd…01ff` at 840,513 bytes — **byte-identical to the README and the packet artifact**. Nothing was copied back and the packet worktree's git state was not touched. Supporting detail: after G7.1 regenerated `apps/remote/dist`, Gradle still judged `syncRemoteWebAssets UP-TO-DATE`, so the Vite output itself is byte-stable. Caveat recorded: the detached build reused the G7.1 dist rather than running a second Vite build inside the detached copy (node_modules were not copied); `clean` was not run in the packet worktree, deliberately, to leave the verified artifact intact.

## G7.6 both-ways evidence (frozen-gate self-reference defect)

Gate command (literal, as frozen):
`grep -rniE 'storePassword|keyPassword|WARSHA_KEYSTORE_PASSWORD=|WARSHA_KEY_PASSWORD=' C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W7`

| Run | Exit | Matches |
|---|---|---|
| Literal (expected 1) | **0** | `packets/W7/prompt.md:78` only — the gate definition quotes its own search tokens |
| `--exclude=prompt.md` | **0** | `gates/G7.6.log` only — the verifier's literal-scan transcript necessarily quotes the tokens |
| `--exclude=prompt.md --exclude=G7.6.log --exclude=G7.6-excluded.log` | **1** | none — **no credential value anywhere in the packet** |

Disposition: **gate defect, not implementation failure.** The only matches are variable *names* inside the gate definition and its transcripts; no password, alias secret or keystore content is present, and no secret was printed by this verification. Do not "fix" the implementation for this. Any log or report that records the literal command (including this file) will keep matching the literal and `--exclude=prompt.md` scans, so the meaningful scan is the third row above. A future gate revision should exclude `prompt.md` (or scan for assigned values), but per the brief the prompt/gate was not edited.

## Scope and diff

`git diff --stat 0772d50…HEAD`:

```
 apps/mobile/README.md                | 56 ++++++++++++++++++++++++++++++++++++
 apps/mobile/android/app/build.gradle | 33 +++++++++++++++-------
 2 files changed, 79 insertions(+), 10 deletions(-)
```

Both files are inside allowed scope `apps/mobile/**`; G7.S measured 0 out-of-scope files. `git status --porcelain` was clean before and after all builds.

## G7.3 launcher observation

The frozen gate text names Unix `apksigner`, which does not exist on this Windows host; only `apksigner.bat` exists in `build-tools/36.0.0`. The brief sanctions the `.bat`, so G7.3 was run with `apksigner.bat verify --print-certs` (and again post-rebuild with `--verbose`). Both exited 0 and printed the expected certificate. Java 25 emitted four `WARNING:` lines about restricted native access in `apksigner.jar`; they are warnings only and do not affect the verdict. This is a launcher mismatch observation, not a failure.

## What could not be run / limitations

- **G7.3 literal Unix binary**: unavailable on Windows; `apksigner.bat` used instead (sanctioned).
- **G7.2 in packet worktree did not repackage** (`packageRelease UP-TO-DATE`); the artifact-preserving alternative was a detached clean rebuild, which passed. `clean` was intentionally not run in the packet worktree to avoid destroying the artifact under verification.
- **Detached build reused the G7.1 dist** rather than rebuilding it in isolation (see caveat above).
- No real model API calls, no network-dependent gates, no edits to implementation, gates, plan/progress/decisions, dependencies, lockfiles or snapshots; no push/merge/publish/release.
- Gate logs in `gates/` are verifier-authored where names collide with earlier self-run logs; they supersede those self-run logs.

## Log index (all with header: gate, command, cwd, commit, UTC timestamp, exit code)

`gates/G7.S.log`, `G7.1.log`, `G7.2.log`, `G7.2-detached.log`, `G7.3.log`, `G7.3-post-rebuild.log`, `G7.4.log`, `G7.4-post-rebuild.log`, `G7.5.log`, `G7.5-post-rebuild.log`, `G7.6.log`, `G7.6-excluded.log`, `G7.7.log`, `G7.A.log`, `G7.P.log`.
