# W7 review — Android web-asset sync and signed release APK

- Run: `2026-11-08-design-and-remediation` · Packet: **W7** · Role: **reviewer** (independent; not implementer/verifier)
- Reviewed range: `0772d502002562505c6438ae712abca7a7328d84..7adbff4dd697e0dff7541a5200a5fcacca8fba6b`
  (BASE `0772d502002562505c6438ae712abca7a7328d84`, HEAD `7adbff4dd697e0dff7541a5200a5fcacca8fba6b`)
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/w7` · Branch: `run/2026-11-08/w7-android-apk`
- Commits (linear, 0 merges): `b1d9368`, `d3256a8`, `5a18a14`, `e422ede`, `7adbff4`
- Verdict: **APPROVE**

## Verified identity and scope

`git diff --stat BASE..HEAD` (independently run):

```
 apps/mobile/README.md                | 56 ++++++++++++++++++++++++++++++++++++
 apps/mobile/android/app/build.gradle | 33 ++++++++++++++-------
 2 files changed, 79 insertions(+), 10 deletions(-)
```

Numstat: `apps/mobile/README.md` 56/0, `apps/mobile/android/app/build.gradle` 23/10. Exactly two files, both under `apps/mobile/**`. **G7.S = 0** (`git diff --name-only $BASE..HEAD | grep -vE '^apps/mobile/' | wc -l`).

Scope bar: the Gradle edits are not opportunistic. `b1d9368` fixes a real packaging defect — BASE `renameReleaseApk` **moved** `app-release.apk` away, so the frozen-gate path was absent (BASE `build.gradle:159-177`; HEAD copies instead, `build.gradle:177-179`). The determinism edits implement the orchestrator's frozen repair item W7-R1 verbatim (`state.json:1640`): disable `dependenciesInfo`, exclude `**/*.map`, prove two identical rebuilds. Recorded as DW7-5 (`report.md:151-155`). Each change is small and confined to the packaging pipeline.

## Packaging changes — verdict

**(a) `dependenciesInfo { includeInApk = false; includeInBundle = false }` (`build.gradle:95-101`).** Correct and necessary. I parsed the final APK's Signing Block directly (Node, offsets from EOCD): exactly two id-value pairs — `0x7109871a` (v2, 2570-byte value) and `0x42726577` (verity padding). `0x504b4453` (AGP dependency metadata, encrypted with a fresh random session key per build) is absent. This was the real drift source; the previous "randomized RSA-PSS" attribution was wrong. `includeInApk` is the operative flag; `includeInBundle` is surplus for this APK-only pipeline (nit N1).

**(b) `exclude '**/*.map'` (`build.gradle:145-149`).** Correct and **safe for the PWA**. I inspected the built `apps/remote/dist/sw.js:1`: the `precacheAndRoute` manifest lists exactly **9 URLs** (`manifest.webmanifest`, `index.html`, 5 icons, the CSS and JS bundle) and **no `.map` entry**; Workbox reports "will precache 9 URLs, totaling 493 kB" (`gates/G7.1.log`). All three `.map` files in `dist/` are source maps (1,730,300 + 3,599 + 147,250 = 1,858,149 B), none is an application asset. `sourceMappingURL` comments remain in three built JS files, but they are devtools-only; there is no runtime map consumer (`apps/remote/vite.config.ts:32` only enables generation). The exclusion therefore changes no user-visible or service-worker behaviour; it also removes a real leak — `sw.js.map` embeds a random `.../Temp/<random>/sw.js` path and an absolute worktree path in `sourcesContent`, and the shipped APK now contains **0** occurrences of the worktree path, `C:/Users` or `Downloads`. Verified: APK has 0 `*.map` entries, `assets/public` has 0 maps, and embedded `assets/public/index.html`/`sw.js` are byte-identical to the current `dist/` files.

## Reproducibility verdict — SOUND (same host/toolchain), with an evidence-provenance caveat

Independently confirmed from the artifact on disk:
- `sha256sum app-release.apk` = `ce60f2bd5183779de7fd6a3c7593e0a612e878c8a1c05960f308e06ea3ad01ff`, size 840,513 B; friendly copy identical; matches `apps/mobile/README.md:92` and both `rebuild-1-facts.txt:1` / `rebuild-2-facts.txt:12`.
- Signing Block has no randomized pair; v2 signature record uses algorithm id **`0x0104`** (RSASSA-PKCS1-v1_5 + SHA2-512 — deterministic, 512-byte RSA-4096 signature), consistent with the report's corrected mechanism.
- `:app:packageRelease` is the step that re-signs/re-zips; it cannot be satisfied by a cached old APK in the retained logs. However, the only **full** Gradle logs in evidence (`gradle.log`, `gradle-initial.log`) are dated **05:32**, i.e. the first session *before* the determinism fix — they show `packageRelease` executed rather than `FROM-CACHE`, but they are not logs of the two final cycles. The final cycles left only `rebuild-2-facts.txt:6-8` (a 5-line `BUILD SUCCESSFUL ... 20 executed, 23 from cache, 3 up-to-date` tail) and no tail in `rebuild-1-facts.txt`.
- All core facts files (`apksigner.log`, `signing-block.txt`, `rebuild-1-facts.txt`, `rebuild-2-facts.txt`) were written within 0.15 s of each other at **11:59:13**, after the 11:56:11 artifact — they are a consolidated end-of-session summary, not live per-cycle captures.

Plainly: the timestamp/provenance gap **does not undermine the reproducibility conclusion** — the on-disk artifact matches both recorded hashes, the mechanism is deterministic, the drift inputs are provably gone, and the packaging/repack step is shown to execute where a full log exists. It does mean the "two consecutive clean rebuilds" is supported only by implementer-authored fact files and cannot be independently recomputed from retained logs (minor M1). I did not re-run the ~20-minute Gradle cycle, per the review brief.

## Signing — not weakened

Comparing BASE and HEAD: the signing-material resolution (`build.gradle:17-51`), `signingConfigs` (`:65-74`), `buildTypes.release` binding (`:76-84`) and the `assembleRelease` fail-fast guard (`:184-198`) are unchanged; no signing line appears in the diff. No `enableV*Signing` toggle exists in BASE or HEAD, so the scheme set is unchanged. `apksigner.bat verify --verbose --print-certs` exits **0**, `Verifies`, v2 `true` (v1/v3/v3.1/v4 `false` as expected for `minSdk 24`), RSA-4096, certificate SHA-256 `ad2708e4…f3c3` — the owner certificate recorded in `docs/VERIFY.md:159` and `PROGRESS.md:119`, not a debug key. Nothing was disabled and nothing switched to debug signing.

## Gate adjudication

**G7.6 — frozen-gate self-reference; unsatisfiable as written.** Re-ran the exact frozen command on `packets/W7`: exit **0** (expected 1); the only matching file is `prompt.md:78`, which contains the gate's own four literal token patterns. Excluding `prompt.md`: exit **1** (no match). No implementer-authored evidence file (report, logs, facts, diff) contains a credential. The gate cannot pass by construction; the implementer correctly did not edit or move it. Owner/planner must amend the command (e.g. exclude the prompt or scan only implementer evidence). Not an implementation defect.

**G7.3 — platform/text mismatch, intent satisfied.** `$ANDROID_HOME/build-tools/36.0.0` contains `apksigner.bat` and no Unix `apksigner`; the literal frozen command exits **127**. The prompt sanctions `apksigner(.bat)` (`prompt.md:51-52`); the real `.bat` run exits **0** with the v2/RSA-4096 result above. On a Linux verifier the literal command should work; not tested here. No gate was edited.

## Secret hygiene and untracked artifacts

- Exact G7.6 scan: only `prompt.md`; excluding it, no match. Diff, commit messages, `apps/mobile/README.md` and `report.md` scans: **0** credential assignments/private-key headers. No keystore file is tracked (`git ls-files` returns only the generator script `scripts/generate-android-keystore.sh`). No keystore content or password was read or printed.
- **G7.7 = 0**: `git ls-files apps/mobile/android/app/src/main/assets | wc -l` = 0. The APK is not tracked (`git ls-files '*.apk'` = 0; build outputs = 0); `apps/mobile/.gitignore:12` ignores the synced assets.
- Nothing pushed/merged/published/released: no remote branch or tag contains HEAD; HEAD is not in `run/2026-11-08/integration` or `dev`; 0 merge commits.

## Other checks I ran

G7.4 = 2 (index.html + sw.js inside the APK); G7.5 exit 0 (README contains the artifact's hash); G7.A exit 0 (`arch: 5 rules, 0 violations`); G7.P exit 0 (`policy: 8 checks, 0 failures`); `git diff --check` clean; Conventional Commits; no dependency/lockfile, `.github/**`, `PLAN.md`/`PROGRESS.md`/`DECISIONS.md` or snapshot changes. G7.1/G7.2 were not re-run (build steps); their outputs and logs were inspected instead (`apps/remote/dist/index.html` + `sw.js` present; `gates/G7.1.log`, `gates/G7.2.log`, `BUILD SUCCESSFUL`).

## Findings

**Blocker:** none.

**Major:** none.

**Minor**
1. **M1 — two-cycle proof is a consolidated summary.** `report.md:224` advertises `rebuild-1-facts.txt` as "size/sha/map-count (+ log tails)", but the file (`rebuild-1-facts.txt:1-17`) has no Gradle tail; neither final cycle retained a full Gradle log. The only full logs are the 05:32 pre-fix session (`gradle.log`, `gradle-initial.log`). Conclusion is corroborated by the artifact and mechanism, but the two-rebuild claim is not independently recomputable from evidence. Fix: retain per-cycle `gradle` logs (and correct the evidence index).
2. **M2 — evidence immutability.** The first G7.6 invocation's log was replaced in place by a redacted summary (`report.md:164-167`; `gates/gate-exits.txt:14-16`; `gates/G7.6.log:7-9`), contrary to `ENGINEERING_POLICY.md:144-146` ("evidence is immutable … a repair iteration adds files, never rewrites old evidence"). Disclosed and no secret was involved; keep the original attempt as a separate `*-attempt1.log` next time.

**Nits**
1. `build.gradle:100` — `includeInBundle = false` is surplus for an APK-only pipeline (no AAB is built), and disabling dependency metadata also drops Play SDK-dependency reporting; harmless for a sideloaded APK, but the trade-off is undocumented.
2. `README.md:101-102` — "the Vite/workbox `*.map` … embed a random temp directory and absolute worktree paths" generalizes; in the current `dist/` only `sw.js.map` carries both (checked `index-DiWWrRzW.js.map` and `workbox-146ffa86.js.map`). Safety conclusion unaffected.
3. `README.md:95-97` — unqualified "the signed APK **is** byte-reproducible"; proven only for consecutive rebuilds on the recorded host/toolchain. Cross-toolchain/C3 environments are not covered by the claim.
4. `report.md:17-19` — "nine of ten gates green" counts G7.3, whose literal command exits 127 on Windows; the `.bat` substitution is sanctioned, but the count should be qualified.

## Not verified

- Did not re-run G7.1/G7.2 or the two clean Gradle cycles (read-only review; brief says not to duplicate the build), so no independent per-cycle packaging log.
- Cross-machine/toolchain reproducibility not tested.
- The pre-fix 1,312,517-byte artifact is not retained; the shrinkage is corroborated only by `5a18a14:apps/mobile/README.md:85`.
- Cannot attest to private-key custody beyond the certificate digest matching the recorded owner certificate.

## Verdict

**APPROVE** — no blocker or major finding. Minors M1/M2 are evidence-process improvements for the implementer; the two gate defects (G7.6, G7.3-literal) are frozen-gate/owner issues outside the implementation. No implementation or gate was edited during this review.
