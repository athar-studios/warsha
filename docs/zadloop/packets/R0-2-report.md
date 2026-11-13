# R0-2 report — local gates green on the repair tree; two CI install defects fixed

- Packet: `R0-2` (baseline green)
- Lane: R0-FIX · Implementer: Coder
- Worktree: `zl-r0-2-gates`, based on `57d8de3`
- Commits landed by this packet: `01d3401` (workflow), `78e4429` (this report) and
  the review-fix commit `fix(ci): use the same sha256sum form the probe tests`
  that follows it (§10)
- Push/PR: **not done** — PM owns integration; no branch of ours was pushed.

## 1. Headline

Every local gate passes on our tree, with counts recorded below. Of the five CI-red
causes measured on the **public** repo (`athar-studios/warsha`), **three do not
reproduce on our tree at all** (causes 1, 2 and 5 are properties of the stale
public branches and/or of a newer `.gitleaks.toml`/ignore set our tree already
carries), and **two are genuine portability defects in `.github/workflows/ci.yml`
that affect every branch, ours included** (causes 3 and 4). Those two are fixed
here; the fix is verified locally under **seven scenario runs** across the runner
shapes that matter (GNU/Linux, busybox-style macOS `sha256sum`, bsdtar macOS `tar`,
the Perl-`shasum`-only branch, and the Windows backslash `RUNNER_TEMP` shape),
including tampered-pin negatives on **both** verifier branches (§4).

Nothing was weakened: no test deleted, skipped or narrowed, no threshold moved,
no `continue-on-error`, no job or matrix entry removed, no `eslint-disable`.

## 2. Gate table — measured on our tree

Run from the worktree root with the toolchain that CI also uses (cargo 1.99.1,
pnpm 9.0.0, node v22.22.1, cargo-deny 0.20.2, gitleaks 8.30.1). Raw logs are kept
under the gitignored `target/r0-2-evidence/`.

| # | Gate | Exit | Measured result |
| --- | --- | --- | --- |
| B1 | `cargo fmt --all --check` | 0 | no diff |
| B2 | `cargo clippy --workspace --all-targets -- -D warnings` | 0 | `Finished`, **0** warnings |
| B3 | `cargo test --workspace --all-targets --no-fail-fast` | 0 | **928 passed / 0 failed / 10 ignored** (baseline 896/0/10) |
| B4 | `cargo deny --manifest-path Cargo.toml --all-features check` | 0 | `advisories ok, bans ok, licenses ok, sources ok` |
| B5 | `pnpm lint` (whole workspace) | 0 | all 6 packages `Done`, 0 errors |
| B6 | `pnpm typecheck` | 0 | clean |
| B7 | `pnpm -r test` | 0 | **1552** tests — crypto 22, client 149, i18n 58, ui 373, remote 221, desktop 729 |
| B8 | `node scripts/check-arch.mjs --self-test && node scripts/check-arch.mjs` | 0 / 0 | self-test ok; `arch: 5 rules, 0 violations` |
| B9 | `node scripts/check-engineering-policy.mjs --self-test && …` | 0 / 0 | self-test ok; `policy: 8 checks, 0 failures` |
| B10 | `node scripts/check-wire-contract.mjs --self-test && …` | 0 / 0 | self-test ok; **`wire: 10 checks, 0 violations`** |
| B11 | `node --test scripts/verify-release-artifacts.test.mjs` | 0 | `8` tests, `8` pass, `0` fail |
| B12 | `gitleaks detect --source . --config .gitleaks.toml --no-banner --redact --exit-code 1` | 0 | `370 commits scanned`, `no leaks found` |
| B13 | `scripts/cp5-stub-scan.sh` | — | **not run — script absent from this tree** (see §7) |
| B14 | `actionlint .github/workflows/ci.yml` | — | **not run — `actionlint` not installed, install is not permitted** (see §7) |
| B15 | `pnpm visual` | — | not run in this packet (needs Playwright browsers + pinned capture fonts), as the packet states |

Notes on the counts:

- **B3 is above** the last recorded baseline (928 vs 896) and the ignored count is
  **unchanged at 10** — no silent growth.
- **B7 is above** the last recorded baseline (1552 vs 1349). The per-package split
  moved in `ui` (309 → 373) and `desktop` (590 → 729); no package went down.

## 3. The five measured causes — ours vs stale public branch

### Cause 1 — TypeScript `Lint`: 5 × `no-unused-vars` — **stale-branch property**

`pnpm lint` exits **0** on our tree, whole workspace, all six packages `Done`.

The five symbols named in the CI log (`ALL_ROLES`, `decodeModelCatalogDiff`,
`decodeModelInfo`, `ModelCatalogDiff`, `ModelInfo`) were counted on our tree:

| Symbol | occurrences in `packages/client/src/index.ts` |
| --- | --- |
| `ALL_ROLES` | 1 (declaration; used through the surrounding module) |
| `decodeModelInfo` | 3 |
| `decodeModelCatalogDiff` | 2 |
| `ModelInfo` | 5 |
| `ModelCatalogDiff` | 4 |

All five have live definitions and call sites, and none of them is unused. The
CI failure the packet quoted is reported against `packages/client/src/index.ts`
at lines 6/10/11/26/27, which do not match our 3022-line file (declarations at
482, 1316, 1334; uses near 1712). Re-measuring the newer private-repo run
`43291164448` (repaired `dev`) shows `pnpm lint` **passing** there too, so the red
in the packet is a property of the older public `dev`/`main` tips and not of the
current tree.

**Verdict: cleared by basing on the repaired dev.** No edit to
`packages/client/src/index.ts` or to any ESLint config was made or needed —
deleting those symbols would have broken live call sites, which is exactly the
gate-weakening move the packet forbids.

### Cause 2 — `cargo-deny`: `advisory-not-detected` — **stale-branch property**

`cargo deny --manifest-path Cargo.toml --all-features check` exits **0** on our
tree, tail reading:

```
advisories ok, bans ok, licenses ok, sources ok
```

An `advisory-not-detected` **warning** is present and points at `deny.toml:160`
(the `RUSTSEC-2024-0370` / proc-macro-error ignore entry), **not** at the
`version = 2` key the packet suspected. That warning is non-fatal — the same
run that printed it exited 0, and the identical warning appears in the *green*
local run. So the packet's hypothesis (a bad `version = 2` key under
`[advisories]`) is **not** what fails CI, and `deny.toml` was **not** touched.

Re-measuring the private-repo run `43291164448` on the ubuntu leg, `Run
cargo-deny` **passed** and the job's red came from the *next* step, `cargo fmt
--all --check`, which diffed `crates/warshad/src/lib.rs` — a file this packet
must not touch and which is already formatted on our tree (`cargo fmt --all
--check` exits 0 here).

**Verdict: cleared by basing on the repaired dev; no `deny.toml` change.**

### Cause 3 — macOS `Install cargo-deny 0.20.2` — **genuine, OURS, FIXED**

Reproduced verbatim from run `43291164448` (`Rust (macos-latest)`):

```
usage: sha256sum [-bctwz] [files ...]
##[error]cargo-deny-0.20.2-aarch64-apple-darwin.tar.gz checksum mismatch against
         pinned fe67d82a10d8597a3549364cb733a3f9cc1bfff9031b7ae46384a9f2a72090c3
         for aarch64-apple-darwin
```

Diagnosis: the pinned digest is **correct**. Downloading the assets and hashing
them locally reproduces the pinned `aarch64-apple-darwin → fe67d82a…a72090c3`
value. The image's `sha256sum` is a busybox-style build: it **accepts `-c` and
does verify** (right digest `OK` exit 0, wrong digest `FAILED` exit 1), and it
**rejects the long `--check` form** as an unrecognized option, exit 1. The old
step probed with the short form and then ran the **long** form, so the probe
passed and the real verification died with that usage error — which surfaced as
"checksum mismatch" against a *correct* digest. The failure came from the long
form, not from a missing check mode; probe and production must therefore use the
same short form, `-c`, which GNU coreutils, uutils coreutils and busybox all
accept. `shasum -a 256 -c` remains the second candidate and is now the macOS
path of record only when `sha256sum` is absent or fails the probe.

Fix: the verifier is selected **by capability** — each candidate is fed a
correct digest (must pass) *and* a wrong digest (must fail), and only the first
that does both is used. Order is `sha256sum -c` from a stdin check line, then
`shasum -a 256 -c` from a check file, then a loud failure. The stored production
invocation is `sha256sum -c` — the **same** short form the probe exercises; it
is no longer `--check`. On a busybox-style `sha256sum` the step now passes
through the `sha256sum` branch (exit 0, checksum `OK`); with the old long form
it died. §4 records the re-verification.

### Cause 4 — Windows `Install cargo-deny 0.20.2` — **genuine, OURS, FIXED**

Reproduced verbatim from run `43291164448` (`Rust (windows-latest)`):

```
D:\a\_temp/cargo-deny-0.20.2-x86_64-pc-windows-msvc.tar.gz: OK
tar (child): Cannot connect to D: resolve failed
tar: Child returned status 128
tar: Error is not recoverable: exiting now
##[error]Process completed with exit code 2.
```

The checksum **passed** there; extraction is what died. GNU tar parsed the
leading `D:` of the archive argument as a **remote host** (`host:path`).

Fix: extraction prefers `tar --force-local` when the tarball provably supports
it (`tar --force-local --version` succeeds), and otherwise `cd`s into the
archive's directory and passes the bare base name, which contains no colon. Both
forms keep `-xzf … -C … --strip-components=1` and the checksum verification is
untouched.

### Cause 5 — gitleaks `leaks found: 1` — **stale-branch property, not a credential**

Reproduced on the exact public commit CI scanned (`15b99f9`, which *is* an
ancestor of our HEAD), with the repo's own `.gitleaks.toml` and gitleaks 8.30.1:

```
WRN leaks found: 12     (exit 1)
```

(The count differs from CI's 1 because CI's job log is truncated for
unprivileged readers — 212 lines total — and the `--log-failed` stream does not
carry the finding detail; the local run on the same commit and config is the
authoritative measurement.)

All 12 findings on that commit are **synthetic test literals**, not credentials:

| Commit | File | Line | Rule id | What the literal is |
| --- | --- | --- | --- | --- |
| `b798d5e` | `crates/warsha-pipeline/src/command_policy.rs` | 814 | `generic-api-key` | env-clearing test canary (`EnvVarGuard::set`) — value **REDACTED** |
| `b798d5e` | `crates/warsha-pipeline/src/command_policy.rs` | 877 | `generic-api-key` | same canary, second assertion — **REDACTED** |
| `b798d5e` | `crates/warsha-pipeline/src/process_spawn.rs` | 2258 | `generic-secret` | stderr-masking test sentinel — **REDACTED** |
| `b798d5e` | `crates/warsha-pipeline/src/process_spawn.rs` | 2329 | `generic-secret` | same sentinel — **REDACTED** |
| `b798d5e` | `crates/warsha-store/src/persistence.rs` | 1519 | `generic-secret` | pairing "expiring" fixture secret — **REDACTED** |
| `b798d5e` | `crates/warsha-store/src/persistence.rs` | 1526 | `generic-secret` | pairing "legacy" fixture secret — **REDACTED** |
| `5fd673e` | `crates/warsha-pipeline/src/process_spawn.rs` | 2329 | `generic-secret` | as above — **REDACTED** |
| `decccde` | `crates/warsha-pipeline/src/process_spawn.rs` | 2168 | `generic-secret` | as above — **REDACTED** |
| `b0805b2` | `crates/warsha-store/src/persistence.rs` | 1519 | `generic-secret` | as above — **REDACTED** |
| `b0805b2` | `crates/warsha-store/src/persistence.rs` | 1526 | `generic-secret` | as above — **REDACTED** |
| `cd8c58b` | `crates/warsha-pipeline/src/command_policy.rs` | 877 | `generic-api-key` | as above — **REDACTED** |
| `6fe59e2` | `crates/warsha-pipeline/src/command_policy.rs` | 716 | `generic-api-key` | as above — **REDACTED** |

No secret value appears anywhere in this report.

**Verdict: test fixture, already covered on our tree by a newer `.gitleaks.toml`.**

`git diff 15b99f9 HEAD -- .gitleaks.toml` shows exactly the 19 added lines that
exempt these by **exact value** (`64a2db9` "exempt the env-clearing test canary",
`285105e` "exempt the K5/H1H2 synthetic test secrets by exact value"). The
allowlist entries are value-anchored (`^…$`), so any *other* value in the same
position still fires. Our full-history scan is clean: **370 commits, no leaks
found**, exit 0.

This is **not** an incident: no real credential was found, so no escalation is
warranted and **no allowlist entry was added by this packet**.

## 4. The `ci.yml` fix — verification matrix

The step's `run:` script was **extracted from the committed workflow** (not
re-typed) and executed locally under seven scenario runs. `RUNNER_TEMP`,
`GITHUB_PATH`, `HOME` and `CARGO_DENY_VERSION` were supplied as CI does, and each
run recorded the selected branch (`sha256sum` vs `shasum`) so a pass cannot be a
silent fallback. Downloads are served by a `curl` stand-in from a local fixture
asset pinned to its real digest: the step's own logic is unchanged, only the
network is local.

The busybox shim is **faithful, measured against real busybox 1.37.0** present on
this host: it **verifies** with `-c` (right digest `OK` exit 0, wrong digest
`FAILED` exit 1), **rejects `--check`** with `unrecognized option '--check'` and
exit 1, and does not backslash-escape file names (unlike GNU). Busybox's own
`--help` prints `Usage: sha256sum [-c[sw]] [FILE]...`, confirming `-c` is the
supported form.

| # | Scenario | Emulated by | Branch taken | Exit | Result |
| --- | --- | --- | --- | --- | --- |
| S1 | GNU/Linux native | `/usr/bin/gnusha256sum` + GNU tar | `sha256sum` | **0** | checksum `OK`, pin asserted, extraction ok |
| S2 | busybox `sha256sum` (macOS shape) | faithful shim: verifies with `-c`, rejects `--check` | `sha256sum` | **0** | checksum `OK` — **old code exited 1 here** |
| S3 | bsdtar-like `tar` (macOS flavour) | `tar` shim rejecting `--force-local` | `sha256sum` | **0** | `cd` + base name fallback, extracts |
| S4 | Tampered pin, `sha256sum` branch | pin replaced with zeros (GNU) | `sha256sum` | **1** | `checksum mismatch` |
| S4b | Tampered pin, `sha256sum` branch | pin replaced with zeros (busybox shim) | `sha256sum` | **1** | `checksum mismatch` |
| S5 | `shasum -a 256 -c` branch positive | `PATH` with no `sha256sum` | `shasum` | **0** | checksum `OK`, extraction ok |
| S5b | Tampered pin, `shasum` branch | pin zeros, `PATH` with no `sha256sum` | `shasum` | **1** | `checksum mismatch` |
| S6 | Windows shape (`RUNNER_TEMP` = `D:\a\_temp`) | `RUNNER_TEMP` containing real backslashes | `sha256sum` | **0** | clean **64-char** digest |

Verification still bites on **both** branches (S4/S4b and S5b), so the fix did not
trade correctness for green.

Two old-vs-new controls, run on the identical shims:

| Control | Old code (`78e4429`) | New code |
| --- | --- | --- |
| busybox `sha256sum` (S2) | `SELECTED_BRANCH=stdin`, then `sha256sum: unrecognized option '--check'` → `::error::… checksum mismatch against pinned <correct sha>`, exit 1 | branch `stdin`, `-c` verifies, exit 0 |
| Windows shape (S6) | `good_sha` 65 chars, leading `\`, `SELECTED_BRANCH=file` (perl-shasum dependency) | `good_sha` 64 chars clean, `SELECTED_BRANCH=stdin` |

The Windows control matters for a second reason found while fixing it: GNU
coreutils, uutils and shasum all escape a name containing a backslash **and**
prefix the digest with `\`; busybox does neither. A backslash-prefixed digest
with an *unescaped* name is rejected outright as
`no properly formatted checksum lines found`. So the fix strips the marker from
`good_sha` *and* makes the check-line writer re-apply GNU's escaping to digest
and name together, which is what keeps selection on `sha256sum` on Windows.

The Windows `D:` tar failure remains reproduced and resolved in isolation:

```
tar -tzf "D:/a/_temp/x.tar.gz"            -> tar (child): Cannot connect to D: resolve failed   (exit 2)
tar --force-local -tzf "D:/a/_temp/x.tgz" -> wrap/ wrap/payload.bin                              (exit 0)
```

Scope of the change: `.github/workflows/ci.yml` only. Against `57d8de3` the
workflow diff is `+84 −11` (the original fix); against `78e4429` this review pass
adds the probe/production form change, the digest de-escaping and the check-line
escaping. YAML parses, **6 jobs** unchanged, the step keeps its name and its
five pinned digests, and exactly **one `run:` leaf** differs from `57d8de3`
(checked structurally, per job and per step: `strategy`, `runs-on`,
`permissions`, `timeout-minutes`, `needs`, `if` and step `name`/`uses`/`with` are
all identical). No `continue-on-error` was added — the only occurrence is the
pre-existing `actionlint` container step's `false`, unchanged from base.

## 5. Remote-state measurement

Measured with `git ls-remote`; feeds the public/private `dev` reconciliation
decision.

| Ref | SHA |
| --- | --- |
| our HEAD (`zl-r0-2-gates`) | `01d3401` workflow → `78e4429` report → review-fix commit (§10); base `57d8de3` |
| `origin` (public `athar-studios/warsha`) `dev` | `15b99f9d354f1bc59149a04aebcf01b7151e517b` |
| `origin` `main` | `939a173ff94d6de5aeb6b4827c57143b247d09e1` |
| `warsha-dev` (private) `dev` | `f47477619e406e1f51aa610b8fc0d69a506e5b86` |
| `warsha-dev` `main` | `2f042d1cb6d714f242de36b636eb3c962d6b12fc` |
| `warsha-dev` `backup/2026-11-10/main` | `c1bcf4fbdac8b283c1dbcdf6dc80780a0f142294` |

Our base `57d8de3` sits **ahead of** the public `dev` (`15b99f9`) and of the
private `dev` (`f474776`), which is why causes 1, 2 and 5 do not reproduce here:
our tree already contains both the `.gitleaks.toml` repair and the OD-S1c
`deny.toml` ignore entry, and the public/private tips do not.

`gh run list --limit 5` in the worktree returns runs belonging to
**`athar-studios/warsha`** (the public repo, `isPrivate: false`,
default branch `main`). The newer, more informative runs come from
`athar-studios/warsha-dev` (private) — `43291164448` on `dev` at `f474776`,
shown in §3. So the two repos are separate CI surfaces over diverged histories,
and only the private one has been fed the repair.

## 6. What remains red, and only where

- **Public `dev` @ `15b99f9` and `main` @ `939a173`** remain red for causes 1, 2
  and 5 by construction: those tips lack the TS pickups, the OD-S1c ignore entry
  and the newer `.gitleaks.toml`. Nothing in this packet can turn a commit that
  is already published green; it is cleared by landing the repair on that repo.
- **Causes 3 and 4** are red on every branch until this workflow change lands,
  and are fixed here. They cannot be *proven* green locally — they need real
  macOS and Windows runners. The verification in §4 is the strongest local
  evidence available: the exact failing argument shapes were reproduced and the
  exact fix was exercised against them.

## 7. Gates not run — named, with reasons

- `scripts/cp5-stub-scan.sh` — **absent from this tree**. `git ls-files | grep -i
  cp5` and `git ls-files | grep -i stub` both return nothing: no such path (nor
  any `*stub-scan*` file) is tracked here. The only reference is a prose line in
  `COMPLETION_STATUS.md:36`. Recording it as "0 stubs" would be a fabricated
  pass, so it is recorded as **not run**. If the PM has the script from another
  lane it can be added later; it is not in this packet's allowed file list.
- `actionlint` — **not installed** and installing it is explicitly not allowed.
  The workflow change was instead validated structurally (YAML parses, 6 jobs,
  no `continue-on-error`, step name and digests intact) and by executing the
  extracted step script.
- `pnpm visual` — outside this packet (needs Playwright browsers and the pinned
  capture fonts), as the packet's own B15 row states.

## 8. Blockers

None that block R0-2's own definition of done. Two items are **out of scope and
for the PM/owner**, not blockers I can clear:

1. **Public/private `dev` reconciliation.** Two remotes hold diverged `dev`
   tips (`15b99f9` public, `f474776` private) and CI runs are attached to the
   public repo by default. Until one `dev` is designated authoritative, the same
   commit will keep producing different verdicts in the two repos.
2. **`cp5-stub-scan.sh` provenance.** The baseline "0 stubs" cannot be
   reproduced from this tree because the script is not in it. Either it lives in
   another lane's tree or the baseline should be retired; that is a PM decision.

## 9. Proposed next step

Open **one draft PR against `dev`** (never `main`) from a branch carrying the
three commits in §10, under owner approval, and let `gh pr checks` confirm the
macOS and Windows `Install cargo-deny 0.20.2` legs against real runners. That is
the only way to convert §4's local simulation into CI evidence. The PR should
also be the vehicle for causing the authoritative `dev` choice in §8(1) to be
recorded.

## 10. Commits landed by this packet

| Commit | Subject | Files |
| --- | --- | --- |
| `01d3401` | `fix(ci): make the cargo-deny install portable on macOS and Windows` | `.github/workflows/ci.yml` |
| `78e4429` | `docs(zadloop): add R0-2 report (gates green, 3 of 5 causes stale-base, 2 fixed)` | `docs/zadloop/packets/R0-2-report.md` |
| (review fix) | `fix(ci): use the same sha256sum form the probe tests` | `.github/workflows/ci.yml`, this report |

Relative to `57d8de3` the packet changes **two** files —
`.github/workflows/ci.yml` and this report — across the three commits above, and
nothing else. The earlier "only commit / no other file changed" wording was
wrong: the packet lands two commits before the review fix, not one.
