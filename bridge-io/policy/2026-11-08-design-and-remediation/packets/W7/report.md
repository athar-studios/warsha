# W7 report — Android web-asset sync and signed release APK

- Run: `2026-11-08-design-and-remediation` · Packet: **W7** (Wave A) · Role: implementer
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/w7` · Branch: `run/2026-11-08/w7-android-apk`
- Date (UTC): 2026-11-08 · Host: Windows 10.0.26300, Git Bash
- **Repair iteration 1** (the first implementer session was lost to a host interruption; its three
  commits were preserved and are built upon, not replaced).

## Outcome (read this first)

A **genuine, owner-key-signed release APK exists on disk**, verified with `apksigner` (APK Signature
Scheme v2 `true`, RSA-4096, the same owner certificate recorded in `docs/VERIFY.md` and
`PROGRESS.md`). The bundled web assets `assets/public/index.html` and `assets/public/sw.js` are inside
it. The APK is now **byte-reproducible**: two consecutive clean rebuilds produced the identical
SHA-256 `ce60f2bd…` and size 840,513 B. Nothing was pushed, merged, published or released.

Nine of ten frozen gates are green (G7.S, G7.1, G7.2, G7.4, G7.5, G7.7, G7.A, G7.P, and G7.3 via the
real Windows `apksigner.bat`). **G7.6 cannot pass by construction** — the frozen grep scans
`packets/W7`, whose own `prompt.md` contains the search tokens, so it always matches (exit 0 where 1
is expected). That is a frozen-gate self-reference defect, recorded below as an owner decision; no
gate was edited, no evidence file contains a secret, and no signing protection was weakened.

## Correction to the previous report's G7.5 analysis

The previous report concluded that G7.5 was "not durably reproducible" because "the v2 signature uses
a randomized RSA-PSS salt" and because `sw.js.map` varies. **That conclusion was wrong on both the
mechanism and the consequence**, and the measured 338-byte difference was misattributed:

1. **The v2 signature is deterministic.** Parsing the APK Signing Block of the produced artifact
   showed Signer #1 using signature algorithm id **`0x0104` = RSASSA-PKCS1-v1_5 with SHA2-512**
   (signature length 512 B). PKCS#1 v1.5 is deterministic — same key, same input, same signature.
   There is no RSA-PSS salt anywhere in the scheme. The v2 block's 2570-byte value was byte-identical
   across builds.
2. **The drift was AGP's dependency-metadata block.** The signing block held three id-value pairs:
   `0x7109871a` (APK Signature Scheme v2, 2570-byte value), **`0x504b4453` (DEPENDENCY METADATA,
   344-byte value, encrypted by AGP with a fresh random session key per build)**, and `0x42726577`
   (verity padding). The differing range 1308724..1309062 was entirely inside that 344-byte AGP
   value — not the signature. It is switchable via `android.dependenciesInfo`.
3. **Source maps were a second, independent drift source.** `assets/index-DiWWrRzW.js.map`,
   `sw.js.map` and `workbox-146ffa86.js.map` shipped inside the APK. `apps/remote/dist/sw.js.map`
   has `sources: ["../../../../../../DRAGON~1/AppData/Local/Temp/<random>/sw.js"]` (workbox writes
   `sw.js` to a fresh temp dir each build) and embeds absolute worktree paths in its content, so its
   bytes depend on the machine path. It also leaked local filesystem paths inside the release APK.

Both sources are packaging decisions inside `apps/mobile/**`, so **G7.5 is satisfied without editing
any gate and without touching the signing configuration**.

### Fix (commits `e422ede`, `7adbff4` — both under `apps/mobile/**`)

- `apps/mobile/android/app/build.gradle`, in `android { }`:
  ```groovy
  dependenciesInfo {
      includeInApk = false
      includeInBundle = false
  }
  ```
- `apps/mobile/android/app/build.gradle`, in the `syncRemoteWebAssets` Sync task: `exclude '**/*.map'`.
  Safety check: the precache manifest inside `apps/remote/dist/sw.js` lists 9 URLs and **no `.map`
  entry**, so precaching stays valid; only dangling `//# sourceMappingURL=` devtools comments are
  affected. Application code is unchanged (`apps/remote/**` was built, never edited).

### Proof (two full clean cycles)

Each cycle was exactly `pnpm --filter warsha-remote build` → `gradlew clean assembleRelease
--no-daemon` → hash, with `JAVA_HOME`/`ANDROID_HOME` as in the packet.

| Cycle | APK size | SHA-256 |
| ----- | -------- | ------- |
| Rebuild 1 | 840,513 B | `ce60f2bd5183779de7fd6a3c7593e0a612e878c8a1c05960f308e06ea3ad01ff` |
| Rebuild 2 | 840,513 B | `ce60f2bd5183779de7fd6a3c7593e0a612e878c8a1c05960f308e06ea3ad01ff` |

**The two hashes are identical.** Evidence: `rebuild-1-facts.txt`, `rebuild-2-facts.txt`.
The `sw.js.map` regenerated in cycle 2 still carried a *new* random temp path
(`.../Temp/ecc4453c8ebaab290e9f9fd9012a2995/sw.js`), confirming the map was the drifting input and
that it no longer reaches the APK (`map_entries_in_apk = 0`).

Signing block of the new artifact (`signing-block.txt`): start 834352, declared size 4088, exactly two
pairs — `0x7109871a` (v2, 2570-byte value, algorithm id `0x0104`) and `0x42726577` (verity padding).
The `0x504b4453` pair is gone.

The artifact shrank by 472,004 B (1,312,517 → 840,513 B) because ~1.86 MB of source maps no longer
ship inside it.

## Identity

- BASE: `0772d502002562505c6438ae712abca7a7328d84` (`run/2026-11-08/integration`)
- HEAD: `7adbff4dd697e0dff7541a5200a5fcacca8fba6b`

`git diff --stat $BASE..HEAD`:

```
 apps/mobile/README.md                | 56 ++++++++++++++++++++++++++++++++++++
 apps/mobile/android/app/build.gradle | 33 ++++++++++++++-------
 2 files changed, 79 insertions(+), 10 deletions(-)
```

Commits (small, Conventional, no push):

```
7adbff4 docs(mobile): record the reproducible release APK hash and size
e422ede fix(mobile): make the signed release APK byte-reproducible
5a18a14 docs(mobile): record the definitive release APK hash and reproducibility caveat
d3256a8 docs(mobile): record the signed release APK artifact facts
b1d9368 fix(mobile): preserve app-release.apk when publishing the release copy
```

Both changed files are under `apps/mobile/` (scope gate G7.S = 0). The APK and `assets/public/` are
gitignored build output and were **not** committed. The worktree tree is clean.

## Toolchain (observed)

- node v26.8.1 · pnpm 9.0.0
- JDK: Android Studio JBR, OpenJDK 25.0.3 (`C:/Program Files/Android/Android Studio/jbr`)
- Gradle 9.3.1 (wrapper) · AGP 9.1.0
- Android SDK: `C:/Users/Dragonfly/AppData/Local/Android/Sdk`, platform android-36, build-tools
  36.0.0 (newest); `local.properties` absent, `ANDROID_HOME` used.
- Signing material present **by name only**: `~/.warsha/signing/{keystore.properties,
  warsha-release.jks}`. No `WARSHA_KEY*` environment variable set. No password, alias secret or
  keystore content was read into output, logged, copied or committed.

## APK artifact (real, on disk)

- Path (gate path): `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
- Friendly identical copy: `apps/mobile/android/app/build/outputs/apk/release/warsha-remote-release.apk`
  (same SHA-256 — the `renameReleaseApk` copy fix from the first session is intact; both names exist
  because `docs/VERIFY.md`, `docs/INSTALL.md` and `PROGRESS.md` reference the friendly name while the
  gates verify `app-release.apk`).
- Size: **840,513 bytes**
- SHA-256: `ce60f2bd5183779de7fd6a3c7593e0a612e878c8a1c05960f308e06ea3ad01ff`
- Build date (UTC): 2026-11-08T07:56:11Z
- Web assets inside: `assets/public/index.html` (2592 B) + `assets/public/sw.js` (1543 B) → count 2.
- Source maps inside: 0.

`apksigner.bat verify --verbose --print-certs` (exit 0; v2 true, RSA-4096, certificate SHA-256
`ad2708e486a68590db9b1ee54e7dfad547759b20f399c16cc6eaad059ce7f3c3` — the owner release cert, not a
debug key). Full log in `apksigner.log` / `gates/G7.3.log`. (v1 `false` is expected: `minSdk 24` is
covered by v2.)

## Decisions

- **DW7-1 — Base.** Branched from `run/2026-11-08/integration` (0772d50) per the brief; worktree at
  `../warsha-wt/w7`; `pnpm install --frozen-lockfile` run in the first session.
- **DW7-2 — Packaging fix (in scope per prompt §2).** The original `renameReleaseApk` task **moved**
  `app-release.apk` → `warsha-remote-release.apk`, leaving the frozen-gate path absent. Changed to a
  copy (`Files.copy`, `REPLACE_EXISTING`); task name kept because out-of-scope docs reference it.
- **DW7-3 — Build order.** `apps/remote/dist` is built with pnpm first so Gradle's lazy `cmd /c pnpm`
  path is never taken (the `cmd` on PATH is an npm shim).
- **DW7-4 — G7.3 launcher.** Windows build-tools ships only `apksigner.bat`; the Unix `apksigner`
  script named literally in the gate is absent (exit 127). Ran the real `apksigner.bat` — same tool,
  same arguments (prompt §3 explicitly sanctions `.bat`). The gate text was not edited.
- **DW7-5 — Deterministic packaging instead of a caveat (repair iteration 1).** Rather than record a
  hash that only describes one artifact, removed both packaging-side drift sources inside
  `apps/mobile/**`: AGP's randomized dependency-metadata block and the non-reproducible `*.map`
  assets. Signing schemes, signing config and keystore handling untouched. This also removes an
  information leak (absolute local paths) from the shipped APK.
- **DW7-6 — Evidence location.** Source edits confined to the worktree; evidence written to the
  prompt-designated `packets/W7` dir. No edits to `PLAN.md`/`PROGRESS.md`/`DECISIONS.md`; no
  merge/push/publish.
- **DW7-7 — G7.6 stays as-is.** Not dodged by moving/editing `prompt.md`; reported as an owner
  decision (below).

## Gate run (implementer's own run, exit codes; raw logs in `gates/`)

Run from the worktree root with `JAVA_HOME`/`ANDROID_HOME` set; `APK` = the gate path. Note: the first
G7.6 invocation redirected its stdout into the scanned directory, so that log itself matched and grep
exited 2; the log was replaced by a secret-redacted summary and the gate re-run cleanly — that run is
the one recorded here.

| Gate | Expected | Observed | Verdict |
| ---- | -------- | -------- | ------- |
| G7.S scope | output 0 | `0` | PASS |
| G7.1 remote build | exit 0 | exit 0; `dist/index.html` + `dist/sw.js` present | PASS |
| G7.2 assembleRelease | exit 0 | exit 0; BUILD SUCCESSFUL | PASS |
| G7.3 apksigner verify | exit 0 | literal Unix launcher: 127 (absent on Windows); real `apksigner.bat`: exit 0, `Verifies`, v2 true, RSA-4096 | PASS via `.bat` (platform note) |
| G7.4 assets in APK | output 2 | `2` | PASS |
| G7.5 README hash == APK | exit 0 | exit 0 (`ce60f2bd…`); artifact also reproduced by two independent clean rebuilds | PASS (durable) |
| G7.6 no secret in evidence | exit 1 | literal exit **0** — sole match is `prompt.md:78` (the gate's own definition); excluding `prompt.md` → exit **1** | literal FAIL (frozen-gate self-reference); intent satisfied |
| G7.7 assets untracked | output 0 | `0` | PASS |
| G7.A check-arch | exit 0 | exit 0; `arch: 5 rules, 0 violations` | PASS |
| G7.P check-policy | exit 0 | exit 0; `policy: 8 checks, 0 failures` | PASS |

Machine-readable exit codes: `gates/gate-exits.txt`.

## Open issues / owner decisions

1. **G7.6 self-reference (owner decision, cannot pass by construction).** The frozen command greps
   `packets/W7`, which contains `prompt.md`; the prompt's own G7.6 line contains the four search
   tokens, so the grep always matches and exits 0 where 1 is expected. Re-verified in this iteration:
   the only matching file is `packets/W7/prompt.md`; excluding it exits 1. No secret exists in any
   implementer-authored evidence. The prompt/gate was not moved or edited.
2. **G7.3 launcher portability (platform note).** The gate names the Unix `apksigner`; Windows
   build-tools ships only `apksigner.bat`. The substantive verification ran with the real `.bat`
   launcher (exit 0). On a Linux verifier the literal command works unchanged.
3. **Signing/posture unchanged.** No `signingConfigs`, keystore path, password handling or enabled
   signature schemes were changed; the APK remains v2-only RSA-4096 under the owner certificate.

## Blocker

The deliverable — a genuine, owner-key-signed, byte-reproducible release APK with recorded facts — is
**complete**. One frozen gate cannot be satisfied by any implementation:

```
{
  "kind": "frozen-gate-defect (out-of-scope to fix)",
  "reason": "G7.6 greps packets/W7, which contains its own prompt.md; the gate-definition line in prompt.md contains the four search tokens, so the grep matches itself and exits 0 where the gate expects 1. Excluding prompt.md exits 1, proving no implementer evidence contains a secret.",
  "needs": "Owner/planner decision to amend the frozen G7.6 command (e.g. scan only implementer-authored evidence files, or add --exclude=prompt.md) — agents may not edit frozen gates."
}
```

## Secret hygiene

No password, alias secret or keystore content was printed, echoed, logged, copied, committed or
quoted; signing material was referenced by path only and consumed by Gradle internally.
`assets/public/` stayed gitignored (G7.7 = 0); the APK was not committed. A scan of this evidence dir
with the gate's secret-token regex matches only `prompt.md` (its own definition); every
implementer-authored evidence file is clean. No real model API call was made.

## Evidence index (this iteration)

```
artifact.txt             final path/size/sha256/mtime, map count, asset count, signing pairs
apksigner.log            apksigner.bat verify --verbose --print-certs
signing-block.txt        parsed APK Signing Block id-value pairs
rebuild-1-facts.txt      cycle 1: size/sha/map-count (+ log tails)
rebuild-2-facts.txt      cycle 2: size/sha/map-count, plus regenerated random temp path in sw.js.map
gates/G7.S.log .. G7.P.log   per-gate raw logs (+ G7.3-literal.log, G7.5-apk-sha.txt, post-gates-apk-sha.txt)
gates/gate-exits.txt     machine-readable exit codes
```
