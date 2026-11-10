# R1 SEC intake — dependency & supply-chain security (READ-ONLY inventory)

- **Repo:** `C:/Users/Dragonfly/Downloads/Warsha` · **branch:** `dev` · **HEAD:** `ba90e713b2731870a7df3c1791bcbfe98e330717`
- **Captured:** 2026-11-09T21:03Z (gitleaks ran 2026-11-10 00:56 local)
- **Scope:** prep for PROGRAM_PLAN.md §4 R1 (S1a/S1b/S1c/S1d/S2/S3). R1 runs AFTER R0; **re-validate at R1 intake.**
- **Read-only attestation:** no edits, commits, worktree ops or branch switches. Only this file + its `research/` dir were created (the authorized deliverable). `cargo deny` refreshed its advisory-DB cache (permitted). No model API calls. gitleaks run with `--redact`; **no secret values are reproduced here.**
- **Tools:** cargo-deny 0.19.0 · pnpm 9.0.0 · gitleaks 8.30.1 · node v26.8.1.
- **Remotes:** `origin` = github.com/athar-studios/warsha.git · `private` = github.com/athar-studios/warsha-dev.git (the tracked remote; `dev` is ahead 83).

---

## 1. Headline

The current `Cargo.lock` (root mtime 2026-11-09 09:16, src-tauri 09:22) **already absorbed 6 of the 10 origin renovate crate proposals**. The **only advisory that actually fires today** — in BOTH the root workspace and the `src-tauri` graph — is **`libsqlite3-sys 0.30.1` → RUSTSEC-2026-0459 (CVE-2026-119375)**, a transitive dep of `sqlx`/`rusqlite` in `warsha-store` (**S1c**). JS prod audit is **already green at the high gate** (0 high/critical). gitleaks full history is **clean**. Licences/bans/sources are **green on both graphs**.

So at intake: **S1a, S1b, S1d are largely no-ops/stale; S2 and S3 already pass their gates; the real R1 work is S1c** (a coordinated breaking `sqlx` + `rusqlite` bump to lift `libsqlite3-sys` to ≥0.39.0).

---

## 2. Firing advisory (cargo deny check advisories) — both graphs

| Crate (locked) | RUSTSEC | CVE | cargo-deny severity | Patched range | Packet | Dependency path |
|---|---|---|---|---|---|---|
| `libsqlite3-sys 0.30.1` | RUSTSEC-2026-0459 | CVE-2026-119375 | `error[vulnerability]` (deny → FAILED) | **≥0.39.0** (0.39.0 = SQLite 3.54.0; 0.39.1 = 3.54.1; ships with rusqlite 0.41) | **S1c** (also fails the **S1d** src-tauri graph) | `rusqlite 0.32.1` (bundled) → `warsha-store`; and `sqlx-sqlite 0.8.6` → `sqlx 0.8.6` → `warsha-store` |

- Advisory: https://rustsec.org/advisories/RUSTSEC-2026-0459 · NVD: https://nvd.nist.gov/vuln/detail/CVE-2026-119375
- Nature: SQLite <3.54.0 can return uninitialized page-cache memory when opening a DB file with a sibling `-wal` of differing page size. **Local** vector; victim must open attacker-writable files. Bundled SQLite (`bundled` feature) is affected; system-SQLite builds are not.
- Root check also emitted `warning[advisory-not-detected]` for the ignored `RUSTSEC-2024-0370` (proc-macro-error) — that crate is only in the src-tauri/Linux graph, so the ignore entry is non-fatal noise on root (exactly as `deny.toml` documents).
- The 5 `deny.toml` `[advisories].ignore` entries (RUSTSEC-2024-0384 instant, -2024-0388 derivative, -2026-0370 zvariant, -2026-0372 zvariant_derive, -2024-0370 proc-macro-error) are all **unmaintained notices**, none of the 10 renovate crates. They do not mask any vulnerability.

**No other vulnerability fires.** tokio, tracing-subscriber, anyhow, chrono, rand, ring, snow, sqlx (direct), gix, tauri produce **no advisory** in the current lock.

---

## 3. Renovate crate-*-vulnerability proposals vs current lock (reconciliation)

Commit subjects read via `git log -1 --format=%s origin/<branch>`. "Locked" = version resolved in `Cargo.lock` today.

| Crate | Packet | Renovate proposes | Current locked | Advisory fires now? | Status / breaking risk |
|---|---|---|---|---|---|
| anyhow | S1a | 1.0.104 | **1.0.104** | No | **Stale** — already at target |
| chrono | S1a | 0.4.45 | **0.4.45** | No | **Stale** — already at target |
| tokio | S1a | 1.54.1 | **1.54.1** | No | **Stale** — already at target |
| tracing-subscriber | S1a | 0.3.23 | **0.3.23** | No | **Stale** — already at target |
| rand | S1a | 0.10.3 | 0.8.8 / 0.9.5 / **0.10.3** | No | 0.10.3 already in lock; workspace declares `rand = "0.9"`. 0.9→0.10 would be **breaking** if forced, but no advisory compels it |
| ring | S1b | 0.17.14 | **0.17.14** | No | **Stale** — already at target |
| snow | S1b | 0.10.0 | 0.9.6 | No | **BREAKING** 0.9→0.10 (0.x minor) if pursued; **no firing advisory** — optional |
| sqlx | S1c | 0.9.0 | 0.8.6 | Indirect (libsqlite3-sys via sqlx-sqlite) | **BREAKING** 0.8→0.9; **required** to lift libsqlite3-sys ≥0.39 |
| gix | S1c | 0.90.0 | **not in lock** | No | `gix = "0.70"` is an **unused workspace declaration** — no crate depends on it (0 lock entries, 0 manifest refs). Dead branch; 0.70→0.90 breaking only if ever adopted |
| tauri | S1d | 2.12.5 | **2.12.5** (src-tauri) | No (tauri itself) | **Stale** — already at target. src-tauri graph still FAILS advisories on libsqlite3-sys |
| tauri-plugin-shell | S1d *(private remote only)* | 2.6.0 | **not a dependency** | No | Not in `src-tauri/Cargo.toml` or lock. Dead branch |

### Breaking-major / breaking-minor bump risk flags
- **S1c — HIGH risk, the actual blocker.** Fixing RUSTSEC-2026-0459 needs `libsqlite3-sys ≥0.39.0`, which ships with **rusqlite 0.41** and a newer **sqlx-sqlite (sqlx 0.9)**. `crates/warsha-store/Cargo.toml:13-16` pins `rusqlite = "0.32"` *deliberately*: "Pinned to the libsqlite3-sys 0.30 line that `sqlx` already links, so the workspace keeps exactly one native SQLite (`links = "sqlite3"`). A newer rusqlite would demand libsqlite3-sys 0.3x+ and fail the whole build." → **sqlx 0.8→0.9 AND rusqlite 0.32→0.41 must move together** (both breaking). Gates: store migrations + `cargo test -p warsha-store -p warsha-git`. Revert the packet, not the run, on failure (PROGRAM_PLAN §7).
- **S1b — snow 0.9→0.10** is a breaking 0.x minor, but **no advisory fires**; only do it if R1 intake re-validation shows a need. Pairing/crypto vectors must stay unchanged.
- **S1a — rand 0.9→0.10** breaking in principle, but 0.10.3 is already locked and nothing fires → effectively no-op.
- **S1c — gix 0.70→0.90** breaking, but gix is unresolved/unused → no-op unless adopted.
- **S2 (optional) — react-router-dom 6→7** is a **breaking major** to clear the 2 moderate findings (patched ≥7.18.0). **Not required** for the high gate (already exit 0).
- **S2/tooling npm branches** (dev, not prod-high): pnpm 9→10 (breaking major, package manager), vite →6 (major), vitest 2→4 (major, devDependency).

---

## 4. Renovate branch inventory (git branch -r)

`git fetch origin` → **exit 0** (new/forced-update branches fetched; no local refs changed).

**Total renovate remote branches: 38** (origin 23, private 15).

### origin/renovate/crate-*-vulnerability — **10** (the planner's ">=10")
`crate-anyhow-vulnerability`, `crate-chrono-vulnerability`, `crate-gix-vulnerability`, `crate-rand-vulnerability`, `crate-ring-vulnerability`, `crate-snow-vulnerability`, `crate-sqlx-vulnerability`, `crate-tauri-vulnerability`, `crate-tokio-vulnerability`, `crate-tracing-subscriber-vulnerability` (proposed versions in §3).

### private/renovate/crate-*-vulnerability — **11**
Same 10 as origin **plus `crate-tauri-plugin-shell-vulnerability`** (→2.6.0, dead — not a current dep).

### Other origin renovate branches (context, not crate-vulnerability)
- npm: `npm-pnpm-vulnerability` (pnpm→v10), `npm-vite-vulnerability` (vite→v6), `npm-vitest-vulnerability` (vitest→v4)
- GitHub Actions: `actions-checkout-7.x`, `actions-download-artifact-8.x`, `actions-setup-node-7.x`, `actions-upload-artifact-7.x`
- Misc: `desktop-toolchain`, `lock-file-maintenance`, `minor-and-patch-updates`, `storybook-react-10.x`, `storybook-react-vite-10.x`, `testing-library-jest-dom-7.x`
- private also has: `lock-file-maintenance`, `npm-pnpm-vulnerability`, `npm-vite-vulnerability`, `npm-vitest-vulnerability`

---

## 5. S2 — JS production audit

`pnpm audit --prod --audit-level high` → **exit 0** · `2 vulnerabilities found · Severity: 2 moderate`.
`pnpm audit --prod --json` metadata: `{info:0, low:0, moderate:2, high:0, critical:0}`.

| Package | Severity | Patched | Title |
|---|---|---|---|
| react-router (locked **6.30.6**, via `react-router-dom ^6.25.0` in apps/desktop + apps/remote) | moderate | ≥7.18.0 | Open redirect via backslash in `<Link>`/`useNavigate` (CVE-2025-68470 bypass) |
| react-router | moderate | ≥7.18.0 | Arbitrary Constructor Injection via `deserializeErrors()` in SSR Hydration |

**S2 acceptance (`pnpm audit --prod --audit-level high` exit 0) is ALREADY MET.** 0 high/critical. The 2 moderate are below the gate; clearing them needs the breaking react-router-dom 6→7 major (optional, owner call). The npm renovate branches (pnpm/vite/vitest) are dev/tooling and do **not** address these react-router moderates.

---

## 6. S3 — licence / ban / source + secret baseline

### cargo deny check licenses bans sources
| Graph | Exit | Result | Errors | Warnings (non-fatal) |
|---|---|---|---|---|
| root (`Cargo.toml`) | **0** | `bans ok, licenses ok, sources ok` | 0 | 49 `duplicate` (multiple-versions=warn) + 1 `license-exception-not-encountered` (target-lexicon, src-tauri-only) + 3 `license-not-encountered` (CC0-1.0, NCSA, Unicode-DFS-2016) |
| src-tauri (`apps/desktop/src-tauri/Cargo.toml`) | **0** | `bans ok, licenses ok, sources ok` | 0 | 61 `duplicate` + 2 `license-not-encountered` (NCSA, Unicode-DFS-2016); target-lexicon exception IS encountered here |

`[bans]`/`[sources]` are absent from `deny.toml` → cargo-deny defaults (multiple-versions=warn; all sources crates.io). **S3 licence/ban/source acceptance (exit 0) is ALREADY MET on both graphs.** `THIRD_PARTY_NOTICES.md` currency not re-verified this pass (S3 deliverable item).

### gitleaks (full history)
`gitleaks detect --config .gitleaks.toml --no-banner --redact` → **exit 0** · **no leaks found** · **0 findings**.
`215 commits scanned · ~50,783,834 bytes (50.78 MB) in 3.65s`. Well under the 3-min limit — **measured this pass**. `.gitleaks.toml` allowlists only exact fictional canary literals + generated/evidence dirs (node_modules, target, dist, bridge-io, test-results); no blanket file-class exemptions. **S3 secret acceptance (exit 0) is ALREADY MET.**

---

## 7. R1 checkpoint preview (PROGRAM_PLAN §4: `cargo deny check` all-four exit 0 · pnpm high exit 0 · gitleaks exit 0)

| Gate | Status now | Blocking packet |
|---|---|---|
| `cargo deny check advisories` (root + src-tauri) | **FAILED (exit 1)** — libsqlite3-sys RUSTSEC-2026-0459 | **S1c** (sqlx 0.9 + rusqlite 0.41 coordinated) |
| `cargo deny check licenses bans sources` | **exit 0** (both graphs) | — (S3 licence already green) |
| `pnpm audit --prod --audit-level high` | **exit 0** (0 high/critical) | — (S2 already green) |
| `gitleaks detect` full history | **exit 0** (no leaks) | — (S3 secret already green) |

**The sole gate blocking the R1 checkpoint is the advisories section, via libsqlite3-sys (S1c).** Playwright pw-gate `outside=0` and installer build (the other checkpoint items) were **not run** this pass (out of intake scope; R0-dependent).

---

## 8. Blockers classified

- **Network:** none. `git fetch origin` exit 0; cargo-deny fetched/refreshed the advisory DB and resolved both graphs; pnpm audit reached the registry (exit 0).
- **Permission:** none. All commands executed; the only write was this authorized deliverable + `research/` dir.
- **Tooling:** none missing. cargo-deny 0.19.0, pnpm 9.0.0, gitleaks 8.30.1, node v26.8.1 all present and ran.
- **Security finding (not a tooling blocker):** `libsqlite3-sys` RUSTSEC-2026-0459 fails `cargo deny check advisories` (exit 1) on both graphs. Real S1c work; breaking coordinated bump.
- **Intake drift to re-validate at R1:** 6/10 origin crate branches are stale (lock already at target); gix and tauri-plugin-shell are unresolved/unused; rand 0.10.3 already locked. Re-run all gates at R1 intake before dispatching packets — S1a/S1b/S1d may collapse to no-ops, leaving S1c as the substantive packet.

---

## 9. Exact commands run + exit codes

| # | Command (cwd = repo root) | Exit | Key output |
|---|---|---|---|
| 1 | `git fetch origin` | 0 | new + forced-update renovate refs; no local change |
| 2 | `git branch -r \| grep -i renovate` | 0 | 38 total; origin crate-vuln 10, private 11 |
| 3 | `git log -1 --format=%s origin/<each crate branch>` | 0 | subjects in §3 |
| 4 | `cargo deny --manifest-path Cargo.toml --all-features check advisories` | **1** | `advisories FAILED`; libsqlite3-sys RUSTSEC-2026-0459; 1 advisory-not-detected warning |
| 5 | `cargo deny --manifest-path apps/desktop/src-tauri/Cargo.toml --all-features check advisories` | **1** | `advisories FAILED`; same libsqlite3-sys (via warsha-desktop→warshad→warsha-store) |
| 6 | `pnpm audit --prod --audit-level high` | **0** | 2 moderate, 0 high/critical |
| 7 | `pnpm audit --prod --json` | 0 | 2 moderate react-router, patched ≥7.18.0 |
| 8 | `cargo deny --manifest-path Cargo.toml --all-features check licenses bans sources` | **0** | `bans ok, licenses ok, sources ok`; 0 errors; 53 warnings |
| 9 | `cargo deny --manifest-path apps/desktop/src-tauri/Cargo.toml --all-features check licenses bans sources` | **0** | `bans ok, licenses ok, sources ok`; 0 errors; 63 warnings |
| 10 | `gitleaks detect --config .gitleaks.toml --no-banner --redact` | **0** | no leaks found; 215 commits; 50.78 MB; 3.65s |

Supporting read-only greps: `Cargo.lock` / `apps/desktop/src-tauri/Cargo.lock` versions; `crates/warsha-store/Cargo.toml`; `apps/desktop/src-tauri/Cargo.toml`; `pnpm-lock.yaml`; `apps/*/package.json`. gitleaks/pnpm/deny-tauri full output captured to system temp (outside the repo); no secret values reproduced.