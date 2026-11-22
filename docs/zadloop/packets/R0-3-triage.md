# R0-3 triage — Renovate PRs #5, #12, #13, #14, #16

- Packet: `R0-3` (`docs/zadloop/packets/R0-3-renovate-triage.md`)
- Phase: **READING only** — this file records evidence and *proposed* decisions. No GitHub mutation was
  made (no `gh pr comment/close/merge/edit`), no dependency file changed, no lockfile regenerated, nothing
  pushed. Decisions belong to the owner + PM after `R0-2`'s green baseline.
- Tree under measurement: `57d8de3` (branch `zl-r0-3-triage`, CSP repair `da7732c` + docs commits), clean
  at start (`git status --porcelain=v1` empty).
- Repo: `athar-studios/warsha`, **public**, remote `origin`.
- Date of GitHub reads: 2026-11-13 (PR/run timestamps on GitHub read 2026-11-10).

## 1. Snapshot (verbatim)

```bash
gh pr list --state open --json number,title,baseRefName,headRefName,mergeStateStatus,mergeable,additions,deletions,changedFiles
```

Every field below is copied from that command's JSON. All five: `baseRefName: main`, `mergeable:
MERGEABLE`, `mergeStateStatus: UNSTABLE`.

| PR | Title | Head branch | Base | Δ | Files | mergeState | mergeable |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #5 | `chore(deps): update rust crate gix to 0.90.0 [security]` | `renovate/crate-gix-vulnerability` | `main` | +1/−1 | 1 | UNSTABLE | MERGEABLE |
| #12 | `chore(deps): update dependency vite to v6 [security]` | `renovate/npm-vite-vulnerability` | `main` | +344/−23 | 4 | UNSTABLE | MERGEABLE |
| #13 | `chore(deps): update dependency vitest to v4 [security]` | `renovate/npm-vitest-vulnerability` | `main` | +141/−177 | 8 | UNSTABLE | MERGEABLE |
| #14 | `chore(deps): update pnpm to v10 [security]` | `renovate/npm-pnpm-vulnerability` | `main` | +2/−2 | 1 | UNSTABLE | MERGEABLE |
| #16 | `fix(deps): update minor and patch updates` | `renovate/minor-and-patch-updates` | `main` | +281/−291 | 28 | UNSTABLE | MERGEABLE |

Snapshot agrees field-for-field with the packet's planning measurement — the packet's table needed no
correction on counts, base branch or merge state.

### Refs involved

| Ref | SHA | Note |
| --- | --- | --- |
| `main` / `origin/main` | `939a173` | base of all five PRs |
| `origin/dev` | `15b99f9` | the actual re-target target available on the remote |
| local `dev` | `f0920e9` | ahead of `origin/dev` (unpushed) |
| this worktree | `57d8de3` | `da7732c` CSP repair + docs commits |

## 2. Red-check matrix — base-tree cause vs the PR's own diff

`gh pr checks <n>` was run for all five. Five base-tree causes appear across the set (numbered as in the
`R0-2` packet), and **two failures are caused by a PR's own diff** — the planning note that "all five are
red for base-tree reasons" is not quite true for #16 and #13.

| Check | #5 | #12 | #13 | #14 | #16 |
| --- | --- | --- | --- | --- | --- |
| Actionlint | pass | pass | pass | pass | pass |
| CodeQL | pass | pass | skipping | pass | skipping |
| CodeQL (javascript-typescript) | pass | pass | **fail (own diff)** | pass | pass |
| CodeQL (rust) | pass | pass | pass | pass | **fail (own diff)** |
| Rust (ubuntu-latest) | fail (causes 2) | fail (cause 2) | fail (cause 2) | fail (cause 2) | **fail (own diff)** |
| Rust (macos-latest) | fail (cause 3) | fail (cause 3) | fail (cause 3) | fail (cause 3) | fail (cause 3) |
| Rust (windows-latest) | fail (cause 4) | fail (cause 4) | fail (cause 4) | fail (cause 4) | fail (cause 4) |
| TypeScript | fail (cause 1) | fail (cause 1) | fail (cause 1) | fail (cause 1) | fail (cause 1) |
| Secret scan (gitleaks) | fail (cause 5) | **pending** | fail (cause 5) | fail (cause 5) | fail (cause 5) |
| Summary | fail | fail | fail | fail | fail |
| `renovate/artifacts` | — | — | — | — | **fail (own diff, 0s, no log)** |

Runs read (`gh run view <id> --log-failed`): #5 `42891180278`, #12 `42891244480`, #13 `42891283151`,
#14 `42891304800`, #16 `42891465154`. #12's gitleaks check is `pending` on the run that was read — that
run is incomplete, not green; its Rust/TS reds are unaffected.

### Cause 1 — TypeScript lint (base tree, `main` only)

```text
[TypeScript] packages/client lint: /home/runner/work/warsha/warsha/packages/client/src/index.test.ts
[TypeScript] packages/client lint:    6:3  error  'ALL_ROLES' is defined but never used               @typescript-eslint/no-unused-vars
[TypeScript] packages/client lint:   10:3  error  'decodeModelCatalogDiff' is defined but never used  @typescript-eslint/no-unused-vars
[TypeScript] packages/client lint:   11:3  error  'decodeModelInfo' is defined but never used         @typescript-eslint/no-unused-vars
[TypeScript] packages/client lint:   26:8  error  'ModelCatalogDiff' is defined but never used        @typescript-eslint/no-unused-vars
[TypeScript] packages/client lint:   27:8  error  'ModelInfo' is defined but never used               @typescript-eslint/no-unused-vars
[TypeScript]  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @warsha/client@0.1.0 lint: `eslint src --ext .ts`
```

**Correction for `R0-2`:** the failing file is `packages/client/src/index.test.ts`, not
`packages/client/src/index.ts`. Measured: on `939a173` that file is **2354** lines and the five symbols
occur **exactly once each** — the import list at lines 6, 10, 11, 26, 27 — so they are genuinely unused
*there*, and the reported `line:col` matches that file. On `dev` (`f0920e9`) and on this tree (`57d8de3`)
all five symbols occur **0** times: the lint failure exists on `main` only. That makes it a `main`-only
base-tree cause, cleared by basing on the fixed `dev`, and it means `R0-2`'s hypothesis (a) (ESLint config
lacks a TypeScript parser/project) is not needed to explain the reported positions.

```bash
for ref in 939a173 dev 57d8de3; do for s in ALL_ROLES decodeModelCatalogDiff decodeModelInfo ModelCatalogDiff ModelInfo; do
  git cat-file -p "$ref:packages/client/src/index.test.ts" | grep -c "\b$s\b"; done; done
# 939a173: 1 1 1 1 1      dev: 0 0 0 0 0      57d8de3: 0 0 0 0 0
```

### Cause 2 — Rust (ubuntu-latest), and a divergence from the packet

The packet expected `warning[advisory-not-detected]` to be the active cause. Measured on every PR run,
the failing condition is a **real, unignored `error[vulnerability]`**:

```text
error[vulnerability]: `libsqlite3-sys` via C SQLite CVE-2026-119375
    ┌─ /home/runner/work/warsha/warsha/Cargo.lock:178:1
178 │ libsqlite3-sys 0.30.1 registry+https://github.com/rust-lang/crates.io-index
    ├ ID: RUSTSEC-2026-0459
    ├ Solution: Upgrade to >=0.39.0 (try `cargo update -p libsqlite3-sys`)
    ├ libsqlite3-sys v0.30.1
      ├── rusqlite v0.32.1
      │   └── warsha-store v0.2.1
      └── sqlx-sqlite v0.8.6
```

`warning[advisory-not-detected]` is also present, but it belongs to a **different** entry — the ignore for
`RUSTSEC-2024-0370` at `deny.toml:151` on the PR's tree:

```text
warning[advisory-not-detected]: advisory was not encountered
    ┌─ deny.toml:151:13
151 │     { id = "RUSTSEC-2024-0370", reason = "Transitive unmaintained notice on proc-macro-error 1.0.4 …
advisories FAILED, bans ok, licenses ok, sources ok
##[error]Process completed with exit code 1.
```

Root cause is base-tree **staleness, not a gate defect**: `deny.toml` ignores `RUSTSEC-2026-0459` in this
lane's tree but **not** on the PRs' base.

```bash
for ref in 939a173 main dev f0920e9 15b99f9 57d8de3; do
  printf '%-9s ' "$ref"; git cat-file -p "$ref:deny.toml" | grep -c 'id = "RUSTSEC-2026-0459"'; done
# 939a173   0
# main      0
# dev       1
# f0920e9   1
# 15b99f9   0      <-- origin/dev, the only remote re-target target
# 57d8de3   1
```

So the ubuntu leg is red because these PRs sit on `main` @ `939a173`, which predates the OD-S1c
acceptance already recorded on `dev`. `R0-2` should treat this as "base is stale", not as
`advisory-not-detected` — the gate is behaving correctly here: an advisory that `deny.toml` accepts is
rejected on `main`. Any *new* `error[vulnerability]` would still be `R0-2`'s call, not ours.

### Cause 3 — Rust (macos-latest)

```text
usage: sha256sum [-bctwz] [files ...]
##[error]cargo-deny-0.20.2-aarch64-apple-darwin.tar.gz checksum mismatch against pinned fe67d82a10d8597a3549364cb733a3f9cc1bfff9031b7ae46384a9f2a72090c3 for aarch64-apple-darwin
##[error]Process completed with exit code 1.
```

Pipeline defect in the "Install cargo-deny" step (macOS ships `sha256sum -bctwz`, no check-file form).
Owned by `R0-2`; identical on all five PRs.

### Cause 4 — Rust (windows-latest)

```text
tar (child): Cannot connect to D: resolve failed
##[error]Process completed with exit code 2.
```

GNU tar reads `D:` as a remote host. Same step, same `R0-2` ownership, identical on all five PRs.

### Cause 5 — Secret scan (gitleaks)

```text
WRN leaks found: 1
##[error]Process completed with exit code 1.
```

Recorded by count only — the finding itself is **not** reproduced in any artifact here (no match, rule or
file contents; `R0-2` owns locating and redacting it). Note `R0-2`'s local full-history scan prints
`no leaks found`, so it is range-specific. Nothing in this document quotes it.

### Cause 6 (new, measured) — #16's own diff breaks the Rust graph before any gate

`Rust (ubuntu-latest)` on #16 does not reach cargo-deny:

```text
error: failed to select a version for `sqlx`.
    ... required by package `warsha-store v0.2.1 (/home/runner/work/warsha/warsha/crates/warsha-store)`
versions that meet the requirements `^0.9.0` are: 0.9.0
package `warsha-store` depends on `sqlx` with feature `runtime-tokio-rustls` but `sqlx` does not have that feature.
help: available features: _rt-async-global-executor, _rt-async-std, _rt-smol, _rt-tokio, _sqlite, … macros
[ERROR] `cargo metadata` exited with an error:  Updating crates.io index
```

Cause, from the PR's own diff — the version was raised but the feature name was not:

```diff
-sqlx = { version = "0.8", features = ["runtime-tokio-rustls", "sqlite", "migrate", "chrono", "uuid", "json"] }
+sqlx = { version = "0.9.0", features = ["runtime-tokio-rustls", "sqlite", "migrate", "chrono", "uuid", "json"] }
-rusqlite = { version = "0.32", features = ["bundled"] }
+rusqlite = { version = "0.41.1", features = ["bundled"] }
```

`sqlx 0.9.0` renamed/removed `runtime-tokio-rustls` (it offers `_rt-tokio`/`runtime-tokio`), so the
manifest cannot resolve at all. The same metadata failure kills `CodeQL (rust)` (exit 101) on #16 and is
why #16 has **no** cargo-deny result. Separately: the `rusqlite 0.41.1` half of the bump is exactly the
move that would retire RUSTSEC-2026-0459, and it cannot land while `sqlx` pins the `libsqlite3-sys` bound —
this is the OD-S1c deadlock appearing in a real PR, worth noting for `R1 SEC` rather than fixing here.

### Cause 7 (new, measured) — #13's own diff breaks `packages/crypto`'s build

`CodeQL (javascript-typescript)` fails on #13 only:

```text
##[error]packages/crypto build: src/index.test.ts(49,12): error TS2580: Cannot find name 'Buffer'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node`.
##[error]packages/crypto build: src/index.test.ts(49,50): error TS2580: Cannot find name 'Buffer'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node`.
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @warsha/crypto@0.1.0 build: `tsc --noEmit`
##[error]Process completed with exit code 2.
CodeQL job status was configuration error.
```

Attribution evidence:

- `packages/crypto/package.json` on `main` declares `typescript ^5.5.0` and `vitest ^2.0.0` only — **no
  `@types/node`**, and neither does the root `package.json` devDependencies. `Buffer` at
  `src/index.test.ts:49` therefore resolves through vitest's transitive type graph today.
- The same job **passes** on #5, #12 and #14 (none of which touch `packages/crypto`); #13 is the only PR
  that edits `packages/crypto/package.json` (`vitest ^2.0.0` → `^4.0.0`).
- #13's lockfile moves that importer to `vitest 4.1.12(…)(vite@5.4.21…)` while touching no `.ts` file and
  no tsconfig.
- Consequence: #13 cannot go green without a manifest/source edit Renovate will not make — add
  `@types/node` to `packages/crypto` devDependencies (and check the other four packages it bumps) rather
  than hand-edit the test. The exact defect is a phantom type dependency the bump exposes; the mechanism
  beyond "vitest 2 supplied it, vitest 4 does not" is **not** established by this phase.

Note also `#13`'s title says vitest 3 → 4, but the tree has `^2.0.0` in `packages/crypto`,
`packages/i18n`, `packages/ui` (and 2.1.9 in the lockfile). The bump is a **two-major** jump for those
packages, not one.

## 3. Per-PR triage rows

### #5 — `chore(deps): update rust crate gix to 0.90.0`

- **What it bumps:** `gix` `0.70` → `0.90.0`, one line in the root `[workspace.dependencies]` table.
- **Files touched:** `Cargo.toml` (1).
- **Diff, quoted in full** (`gh pr diff 5`):

  ```diff
  Cargo.toml
    @@ -62,7 +62,7 @@ clap = { version = "4.5", features = ["derive", "env", "string"] }
    -gix = "0.70"
    +gix = "0.90.0"
     octocrab = "0.30"
  ```

- **Why CI is red:** all ten red/pass checks classify as base-tree (causes 1–5). No check mentions `gix`:
  no resolution error, no compile error, no advisory about gix. The bump is not exercised.
- **Evidence that the declaration is dead** (C3): see §4.
- **PROPOSED decision: `merge-after-R0-2 + owner-approval`, recorded as manifest hygiene — not as a
  security fix.** Rationale: it is a one-line, zero-runtime-change edit; merging it keeps Renovate's
  signal honest and stops the `[security]` label from recurring. It must **not** be recorded as closing a
  shipped exposure, and `R1 SEC` must not claim it as S1 credit.
- **Alternative for the owner:** delete the stale `Cargo.toml:65` line instead of upgrading it (the
  declaration has no consumer; `crates/warsha-git` uses `octocrab`, not `gix`). If the owner wants a real
  `gix` consumer, that is a separate packet, not this bump.
- **Owner decision needed:** upgrade-and-keep vs delete. Either way the breaking surface (`Force::
  OverrideLock`, `max-performance-safe`, `Submodule::git_dir()`) is unreachable today because nothing
  selects the crate.

### #12 — `chore(deps): update dependency vite to v6`

- **What it bumps:** `vite` `^5.4.0` → `^6.0.0` (resolved `5.4.21` → `6.4.6`).
- **Files touched:** `apps/desktop/package.json`, `apps/remote/package.json`, `packages/ui/package.json`,
  `pnpm-lock.yaml` (4).
- **Why CI is red:** causes 1–5 only; no check fails for a vite reason. `CodeQL (javascript-typescript)`
  — the job that actually builds the TS packages — **passes**, which is the strongest available read that
  vite 6 is not breaking the build. Its gitleaks check was `pending` on the run read, so that run is
  incomplete rather than fully red.
- **PROPOSED decision: `merge-after-R0-2 + owner-approval`.** Smallest blast radius among the three
  npm bumps, no own-diff failure measured.
- **Gates still owed before merge:** C6 (`pnpm -r test`, `pnpm lint`, `pnpm typecheck`) with the test
  count recorded, and C8 (`pnpm visual`) — **not run in this phase**, and `pnpm visual` cannot be run in
  the agent sandbox at all (Playwright browsers + pinned capture fonts). Note vite 6 also lifts the
  `@vitest/mocker`/storybook peer to `vite@6.4.6` and adds `esbuild 0.25.12` platform packages.

### #13 — `chore(deps): update dependency vitest to v4`

- **What it bumps:** `vitest` → `^4.0.0` (resolved `2.1.9` in `packages/crypto`/`i18n`/`ui`, and `4.1.12`
  across the workspace).
- **Files touched:** `apps/desktop/package.json`, `apps/remote/package.json`, `package.json`,
  `packages/client/package.json`, `packages/crypto/package.json`, `packages/i18n/package.json`,
  `packages/ui/package.json`, `pnpm-lock.yaml` (8). No `.ts` file, no tsconfig.
- **Why CI is red:** causes 1–5 **plus one own-diff failure** — cause 7, `packages/crypto` `tsc --noEmit`
  → `TS2580 Cannot find name 'Buffer'` (§2). This is not a stale-branch artefact and will not clear when
  the base is fixed.
- **PROPOSED decision: `close-with-successor`** — successor `R1-DEPS-vitest4` (a real two-major vitest
  migration: `@types/node` declared explicitly in the five packages, test-count comparison per C6, and
  `pnpm visual`). Reason: the PR as authored cannot be made green without manifest edits outside its diff,
  and Renovate will not make them.
- **Alternative for the owner:** fix forward inside this packet's execution phase (add `@types/node`, then
  run C6 and compare counts) and merge after `R0-2`. That work is *not* done here and is not a reading-phase
  claim.
- **Risk if merged as-is:** red `CodeQL (javascript-typescript)`, and an unknown test-count movement
  (vitest 2 → 4 changes the counts; a *drop* in passed tests would be a finding).

### #14 — `chore(deps): update pnpm to v10`

- **What it bumps:** `packageManager` `pnpm@9.0.0` → `pnpm@10.34.5`, and `engines.pnpm` `>=9.0.0` →
  `>=10.34.5`.
- **Files touched:** `package.json` (1).
- **Diff, quoted in full:**
  ```diff
  -    "pnpm": ">=9.0.0"
  +    "pnpm": ">=10.34.5"
  -  "packageManager": "pnpm@9.0.0"
  +  "packageManager": "pnpm@10.34.5"
  ```
- **Why CI is red:** causes 1–5 only. Notably `Setup pnpm` did **not** fail — no `Multiple versions of
  pnpm specified` — so the `packageManager`-as-single-source contract holds for this bump.
- **PROPOSED decision: `merge-after-R0-2 + owner-approval`, first in the order.** It is one file and no
  code; the risk is that it is load-bearing for every other npm PR.
- **Gates still owed:** C5, `pnpm install --frozen-lockfile` on the #14 tree, **not run in this phase**.
  The PR changes no lockfile line, and pnpm 9 and 10 both use lockfile version `9.0`, so it is plausible
  the frozen install passes — but that is unmeasured here and must be measured before merge.
- **Owner-visible detail:** `engines.pnpm: ">=10.34.5"` raises the floor to a specific minor; every
  contributor and CI image must satisfy it.

### #16 — `fix(deps): update minor and patch updates`

- **What it bumps:** the grouped minor+patch set: root `Cargo.toml` (~40 workspace deps, incl. `sqlx
  0.8→0.9.0`, `rusqlite 0.32→0.41.1`, `axum 0.7→0.8.9`, `rand 0.9→0.10.3`, `toml 0.8→0.9.12`), nine crate
  manifests, `apps/desktop/src-tauri/Cargo.toml`, five `package.json`s, `pnpm-lock.yaml`, the gradle
  wrapper, `deploy/docker-compose.yml`, `docker/Dockerfile`, `docker/compose.yml`, and three workflows.
- **Files touched (28):** `.github/workflows/ci.yml`, `.github/workflows/desktop-bundle.yml`,
  `.github/workflows/release.yml`, `Cargo.toml`, `apps/desktop/package.json`,
  `apps/desktop/src-tauri/Cargo.toml`, `apps/mobile/android/build.gradle`,
  `apps/mobile/android/gradle/wrapper/gradle-wrapper.properties`, `apps/remote/package.json`,
  `crates/warsha-{backends,cli,core,pipeline,providers,relay,remote,store}/Cargo.toml`,
  `crates/warshad/Cargo.toml`, `deploy/docker-compose.yml`, `docker/Dockerfile`, `docker/compose.yml`,
  `docs/package.json`, `package.json`, `packages/{client,crypto,i18n,ui}/package.json`,
  `pnpm-lock.yaml`.
- **Why CI is red:** causes 1, 3, 4, 5 **plus two own-diff failures** — cause 6 (`sqlx 0.9.0` keeps the
  removed `runtime-tokio-rustls` feature → `cargo metadata` aborts → `Rust (ubuntu-latest)` and
  `CodeQL (rust)` both die before cargo-deny) and the `renovate/artifacts` check
  (`Artifact file update failure`, 0s, no log, no target URL).
- **PROPOSED decision: `close-with-successor`** — successor `R1-DEPS-split` (split by ecosystem and by
  major: (a) Rust workspace minor+patch with `sqlx`/`rusqlite` handled on their own because of the
  `links = "sqlite3"` deadlock, (b) npm minor+patch, (c) workflow/docker/gradle housekeeping). Reason: the
  PR is unresolvable as authored, and a 28-file grouped PR that also rewrites `.github/workflows/ci.yml`
  cannot be reviewed or bisected.
- **Overlap warning:** #16 edits `.github/workflows/ci.yml`, which `R0-2` owns. Per the packet's overlap
  section, #16 must not land before `R0-2`'s CI fix, or the two race the same hunk. #16 also rewrites the
  root `Cargo.toml` that #5 touches.

## 4. gix evidence (C3) — `#5` is manifest hygiene, not a shipped exposure

Run in this worktree at `57d8de3`:

```bash
$ cargo tree -i gix --workspace
error: package ID specification `gix` did not match any packages

help: a package with a similar name exists: `nix`
$ echo $?
101

$ git grep -n "gix" -- Cargo.toml crates/
Cargo.toml:65:gix = "0.70"

$ git cat-file -p HEAD:Cargo.lock | grep -c gix
0
```

`crates/warsha-*/Cargo.toml` contain no `gix` dependency, so nothing in the workspace selects the
declaration: line 65 is an entry in the `[workspace.dependencies]` table (header at `Cargo.toml:25`) that no
member opts into. `Cargo.lock` has **0** `gix` lines, on every ref measured:

```bash
for ref in dev 939a173 main f0920e9 15b99f9 57d8de3; do
  printf '%-9s ' "$ref"; git cat-file -p "$ref:Cargo.lock" | grep -c gix; done
# dev 0 | 939a173 0 | main 0 | f0920e9 0 | 15b99f9 0 | 57d8de3 0
```

The three breaking surfaces of `gix` 0.90 are likewise absent:

```bash
$ git grep -n "Force::OverrideLock\|max-performance\|Submodule::" -- crates/
$ echo $?
1
```

Repo-wide occurrences of the byte sequence (context, not consumers): `Cargo.toml`, `HANDOFF.md`,
`PROGRESS.md`, two PNG visual baselines (`gates-768x1024-ar-dark-desktop-linux.png`,
`run-768x1024-en-dark-remote-linux.png`) and the `R0-3` packet/README themselves. `crates/warsha-git`
depends on `warsha-core`, `thiserror`, `anyhow`, `serde`, `serde_json`, `tokio`, `tracing`, `reqwest`,
`uuid`, `chrono` — not `gix`.

**Conclusion for the record:** Renovate's `[security]` label does **not** describe the shipped graph.
`#5` cannot fix an advisory this graph never carried. Merging it changes nothing at runtime. Both
consequences follow: (i) the record must not claim a security fix, and (ii) the worth of the PR is
manifest hygiene only.

## 5. Recommended order and the two traps

**Order by blast radius, smallest first (packet step 2, unchanged by this read):**

| Order | PR | Blast radius | Why here |
| --- | --- | --- | --- |
| 1 | #14 | 1 file, no code | Sets the pnpm major that every other npm PR's lockfile is generated with; land it first or the others churn |
| 2 | #13 | 8 files | Own-diff failure (cause 7) must be resolved or the PR closed before the others stack on vitest 4's peer graph |
| 3 | #12 | 4 files | Touches the same three `package.json`s as #13 and #16; second-smallest npm change |
| 4 | #16 | 28 files | Grouped; rewrites `Cargo.toml`, `package.json`, `pnpm-lock.yaml` and `ci.yml` that #5/#12/#13/`R0-2` touch — lands last or not at all |
| 5 | #5 | 1 file, zero runtime effect | Independent, but its `[security]` framing needs the most correction before any merge text is written |

**Trap 1 — every PR is based on stale `main`, not `dev`.** All five say `baseRefName: main` (`939a173`).
`AGENTS.md`/`PLAN.md` put feature work on `dev`; a bump merged into `main` does not reach `dev` and will
conflict at the next promotion. **Measured caveat that changes the plan:** re-targeting to `dev` does not
by itself turn anything green. `origin/dev` is at `15b99f9`, and `15b99f9` has **no** `RUSTSEC-2026-0459`
ignore (count 0) and **still carries** the five unused imports in `packages/client/src/index.test.ts`
(count 1 each) — i.e. it is as red as `main` for causes 1 and 2. Only `dev` **with the R0-FIX commits**
(local `f0920e9` / this lane's `57d8de3`, count 1 and 0) clears them. So the re-target instruction is
"`gh pr edit --base dev` **after** `R0-2`'s fixes are on `origin/dev`", never as a way to get green
immediately.

**Trap 2 — #5 is manifest hygiene, not a security fix.** See §4. The record must not repeat Renovate's
`[security]` label as if the shipped graph were exposed, and the merge text must say "adopts a newer
declaration for an unconsumed crate" — not "fixes RUSTSEC-2025-0021 / the 2026 gix advisories in Warsha".

## 6. Decision summary (PROPOSED — owner + PM decide after `R0-2`)

| PR | Decision | Successor | Blocking measurement still owed |
| --- | --- | --- | --- |
| #5 | `merge-after-R0-2 + owner-approval` as manifest hygiene (alt: delete `Cargo.toml:65`) | `R1 SEC` may *not* claim it | C7 (`cargo test --workspace --all-targets`), C4 (`cargo deny`) |
| #12 | `merge-after-R0-2 + owner-approval` | — | C6 (test counts), C8 (`pnpm visual`, not runnable in sandbox) |
| #13 | `close-with-successor` | `R1-DEPS-vitest4` | C6 on the successor tree; cause 7 must be fixed first |
| #14 | `merge-after-R0-2 + owner-approval` (first) | — | C5 (`pnpm install --frozen-lockfile`) |
| #16 | `close-with-successor` | `R1-DEPS-split` | none — PR is unresolvable as authored (cause 6) |

No PR is left open-and-red without a proposed outcome.

## 7. Gates this phase did not run

This was the READING phase; the packet's C4–C8 need a built tree and/or a real install. Explicit list so
the omission is visible, not implied:

| Gate | Status | Why |
| --- | --- | --- |
| C1 snapshot | **run** | §1 |
| C2 `gh pr checks` | **run** | §2 |
| C3 `cargo tree -i gix --workspace` | **run** | §4 — prints "did not match any packages", exit 101 |
| C4 `cargo deny … --all-features check` on a bumped tree | **not run** | no bumped tree built; needs network for the advisory DB |
| C5 `pnpm install --frozen-lockfile` on the #14 tree | **not run** | needs an install; #14 worktree not created |
| C6 `pnpm -r test` / `lint` / `typecheck` on #12/#13/#16 trees | **not run** | same |
| C7 `cargo test --workspace --all-targets` on #16/#5 trees | **not run** | same |
| C8 `pnpm visual` | **not run** | not runnable in the agent sandbox (Playwright browsers + pinned capture fonts); must be stated in any PR comment |
| C9 `git status --porcelain=v1` | **run** | this file is the only change |
| C10 `gh pr view 5 --json mergeStateStatus,mergeable` | **run** | `UNSTABLE` / `MERGEABLE` — `CLEAN` is impossible until the base-tree causes clear |

## 8. Constraints honoured

- Read-only on GitHub: this phase ran `gh pr list`, `gh pr view`, `gh pr checks`, `gh pr diff`, `gh run
  view` and `gh repo view` only. No comment, close, merge, edit, push or label operation.
- No dependency file, lockfile or `deny.toml` change; nothing outside `docs/zadloop/`.
- No secret content anywhere; the gitleaks finding is recorded by count only.
- Licence wording: **free and source-available**.
- Overlaps respected and not touched: `crates/warshad/src/lib.rs` (`R0-1`), `packages/client/src/index.ts`
  and `deny.toml` and `.github/workflows/ci.yml` (`R0-2`).
