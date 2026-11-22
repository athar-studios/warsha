# R-NEXT-FINAL-REPORT — Z1 release report

| Field          | Value                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status         | FINAL (branch `r-next/z1-final`, worktree `.agents/worktrees/rn-z1`)                                                                                         |
| Base commit    | `28ee5e2` (`r-next/integration`; tip is merge of E2 + A5 + E5 + all prior packets merged)                                                                  |
| Merged packets | All Phase 0 packets (F0–FIN5, N0, N1, A1) + All Release-run packets (B1–B3, A2–A4, N2–N3, D1, D4–D5, E1–E6, A5, Z1)                                         |
| Version        | stays `0.3.0` (mobile `versionCode 300`) — this report only _recommends_ (§5)                                                                              |
| `main`         | unchanged: `939a173ff94d6de5aeb6b4827c57143b247d09e1` (verified 2026-11-19)                                                                                |
| Spec           | `docs/zadloop/R-NEXT-MASTER-PLAN.md` §10 (Z1), §3.1 (acceptance), §3.4 (packet report), A11 (Z1 = release report)                                           |

**Rule for filling this file (§10 acceptance):** every claim cites an evidence file or a commit.
Gate numbers come from Z1 gate logs under `bridge-io/audit/z1/` and merged packet evidence under `bridge-io/audit/`.

---

## 1. Per-packet table

Merged = ancestor of `28ee5e2` (verified with `git merge-base --is-ancestor <commit> 28ee5e2`).
"VERIFY / gates" points to the report section holding the evidence; Z1 re-confirms the outcome
and copies it here. "Audit ref" = the report's third-party/audit table or the section that
replaces it, where one exists.

### 1.1 Phase 0 (merged before this run's packets; see `docs/zadloop/packets/FINAL_REPORT.md`)

| Packet    | State                                                   | Evidence path                                                                                             | VERIFY / gates                            | Audit ref | Fleet decisions                    |
| --------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------- | ---------------------------------- |
| F0        | merged (`debc525`, `5b2bf5f`)                           | `docs/zadloop/R-NEXT-OWNER-CHECKLIST.md`                                                                  | FINAL_REPORT §1                           | —         | `D-RN-AUTONOMY`                    |
| F1        | merged (`a1a548f`)                                      | `docs/zadloop/packets/F1-report.md`                                                                       | FINAL_REPORT §1                           | —         | `D-RN-F1-1`                        |
| F2        | merged (`d71f66d`), one gate blocked then closed by A10 | `docs/zadloop/packets/F2-report.md`                                                                       | FINAL_REPORT §2                           | —         | `D-RN-F2-2` (cited in FIN4-report) |
| F3        | merged (`c3a2d14`); pairing S2–S5 owner-side            | `docs/zadloop/packets/F3-report.md`                                                                       | FINAL_REPORT §4                           | —         | `D-RN-F3-1`, `D-RN-F3-2`           |
| RF2 / A10 | merged (`33162dd`, `1ef5020`)                           | `docs/zadloop/packets/RF2-report.md`                                                                      | FINAL_REPORT §2                           | —         | `D-RN-RF2-1`…`D-RN-RF2-5`          |
| FIN3      | merged                                                  | `docs/zadloop/packets/FIN3-report.md`                                                                     | FINAL_REPORT §1                           | —         | `D-RN-FIN3-1`                      |
| FIN4      | merged                                                  | `docs/zadloop/packets/FIN4-report.md`                                                                     | FIN4-report §5.1                          | —         | —                                  |
| FIN5      | merged (tag `r-next/cp-phase0`, local)                  | `docs/zadloop/packets/FINAL_REPORT.md`                                                                    | FINAL_REPORT §3                           | —         | `D-RN-FIN5-1`                      |
| N0        | merged (`b4e1653`)                                      | `docs/zadloop/packets/N0-report.md`                                                                       | N0-report                                 | —         | `D-RN-N0-1`, `D-RN-N0-2`           |
| N1        | merged (`602f360`)                                      | `PROGRESS.md` "Run 2026-11-17 — N3", git commit `602f360`                                                 | `crates/warshad/tests/sessions_rpc.rs`    | —         | commit `602f360`                   |
| A1        | merged (`797721c`, `6ada34d`)                           | `DECISIONS.md` "2026-11-16 — A1: Model Catalog Persistence"                                               | `apps/desktop/src/screens/ModelsSettings.tsx` | —     | `DECISIONS.md:9-13`                |

### 1.2 Release-run packets (A11 order: B1 → A2 → B2 → A3 → A4 → B3 → N2 → N3 → D1 → D4 → D5 → E1 → E6 → E4 → E3 → E2 → E5 → A5 → Z1)

| Packet | State                                                                                                        | Merge commit                    | Evidence path                                                                        | VERIFY / gates                           | Audit ref                                                    | Fleet decisions                                |
| ------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| B1     | merged                                                                                                       | `dbc56f7`                       | `docs/zadloop/packets/B1-report.md`                                                  | §Tests, §Findings                        | —                                                            | `D-RN-B1-1`, `-2`, `-3`, `-4`                  |
| A2     | merged                                                                                                       | `9fdb797`                       | `docs/zadloop/packets/A2-report.md`                                                  | §VERIFY Evidence, §Gate Results          | §Audit Tables                                                | `D-RN-A2-1`                                    |
| B2     | merged                                                                                                       | `4d5337c`                       | `docs/zadloop/packets/B2-report.md`                                                  | §Verification, §Gate Results             | §Risk Classes (no audit table)                               | `DECISIONS.md:24-26`                           |
| A3     | merged                                                                                                       | `5abf6a5`                       | `docs/zadloop/packets/A3-report.md`                                                  | §VERIFY evidence, §Tests and gates       | —                                                            | `D-RN-A3-001`                                  |
| A4     | merged                                                                                                       | `ff41b0e`                       | `docs/zadloop/packets/A4-report.md`                                                  | §Verification Evidence, §Gate Table      | —                                                            | `D-RN-A4-001`                                  |
| B3     | merged                                                                                                       | `2c6f288`                       | `docs/zadloop/packets/B3-report.md` (+ `B3-rules-syntax.md`)                         | §Gates (cc5c88e)                         | —                                                            | `D-RN-B3-001`, `-002` (§Fleet decisions)       |
| N2     | merged                                                                                                       | `f99feee`                       | `docs/zadloop/packets/N2-report.md`                                                  | §Evidence, §Gate Results, §Tier Table    | —                                                            | `D-RN-N2-001`                                  |
| N3     | merged                                                                                                       | `8ad0bad`                       | `docs/zadloop/packets/N3-report.md`                                                  | §Evidence, §Gate Results                 | —                                                            | `DECISIONS.md:28-30`                           |
| D1     | merged                                                                                                       | `c500b7a`                       | `docs/zadloop/packets/D1-report.md`                                                  | §Verification                            | —                                                            | `D-RN-D1-001`…`-004`                           |
| D4     | merged (+ seam `4907e61`)                                                                                    | `f215057`                       | `docs/zadloop/packets/D4-report.md`                                                  | §Gate table (@ 875fab0), §Acceptance map | —                                                            | `D-RN-D4-001`…`-007`                           |
| D5     | merged (+ seam `92e3225`)                                                                                    | `feda620`                       | `docs/zadloop/packets/D5-report.md`                                                  | §Gates (PM-verified @ 6163644)           | — (§Honest copy check A16.6)                                 | `D-RN-D5-001`…`-005`                           |
| E1     | merged                                                                                                       | `fe438bf`                       | `docs/zadloop/packets/E1-report.md`                                                  | §Gate Table                              | §Legacy UI Retirement Inventory                              | `D-RN-E1-001`…`-003`                           |
| E6     | merged                                                                                                       | `612f3a3`                       | `docs/zadloop/packets/E6-report.md` (+ `E6-audit.md`, `E6-notes.md`)                 | §Gates Status                            | `E6-audit.md`                                                | `DECISIONS.md:5-7`                             |
| E4     | merged                                                                                                       | `c053213`                       | `docs/zadloop/packets/E4-report.md`                                                  | §Verification                            | —                                                            | `D-RN-E3/E4-001`, `-002`                       |
| E3     | merged                                                                                                       | `c997e34`                       | `docs/zadloop/packets/E3-report.md`                                                  | §Gates, §State Machine Fixtures          | §Skipped Audits (pixel-skin audit skipped, `D-RN-E3/E4-003`) | `D-RN-E3/E4-001`…`-003`                        |
| E2     | merged (Lane A `d4dc30d`, Lane B `90c1086`, wire fix `11104c8`)                                              | `d4dc30d`, `90c1086`, `11104c8` | `docs/zadloop/packets/E2-report-laneA.md`, `docs/zadloop/packets/E2-report-laneB.md` | Lane B §Gate matrix                      | —                                                            | `D-RN-E2B-001`…`-005`                          |
| E5     | merged                                                                                                       | `28ee5e2`                       | `docs/zadloop/packets/E5-report.md`                                                  | §Gate results (144 passed / 0 failed)    | §Third-party components audit                                | `D-RN-E5-001`                                  |
| A5     | merged                                                                                                       | `43ec295`                       | `docs/zadloop/packets/A5-report.md`                                                  | §Gate matrix, `bridge-io/audit/a5/`      | HIGH/MEDIUM/LOW findings table                               | `D-RN-A5-1`, `D-RN-A5-2`                       |
| Z1     | merged / current                                                                                             | `r-next/z1-final`               | `docs/zadloop/R-NEXT-FINAL-REPORT.md`                                                | §3 FIN4 matrix, `bridge-io/audit/z1/`    | §2 Audit-tables index                                        | `D-RN-Z1-1`                                    |

Blocked packets in the release run: **none**.
Deferred by A11 (not blocked, self-hosted queue §13): C1 → C2 → C3 (R2); D2 → D3 (R3).

---

## 2. Audit-tables index

| Source                                                              | What it contains                                                                                                       | Status                            |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `docs/zadloop/packets/A2-report.md` §Audit Tables                   | third-party audit for `oauth2`, `url` (`THIRD_PARTY_NOTICES.md` updated)                                               | merged                            |
| `docs/zadloop/packets/E1-report.md` §Legacy UI Retirement Inventory | per-screen reachability / disposition                                                                                  | merged                            |
| `docs/zadloop/packets/E6-audit.md`                                  | CodeMirror 6 third-party audit                                                                                         | merged                            |
| `docs/zadloop/packets/E3-report.md` §Skipped Audits                 | pixel-skin audit skipped (`D-RN-E3/E4-003`)                                                                            | merged                            |
| `docs/zadloop/packets/A5-report.md`                                 | code-health audit, HIGH/MEDIUM/LOW table, dead code / `TODO`/`FIXME` sweep, largest files, duplication, docs freshness | merged (`43ec295`)                |
| `docs/zadloop/packets/E5-report.md`                                 | visual-baseline sweep (144 surfaces), baseline manifest update, third-party audit                                      | merged (`28ee5e2`)                |
| `THIRD_PARTY_NOTICES.md`, `deny.toml`                               | A3 §3.3 audit-before-adoption state                                                                                    | updated / audited                 |

### 2.1 A5 Code-Health Audit: HIGH/MEDIUM/LOW Table (from `docs/zadloop/packets/A5-report.md`)

| Finding | Severity | Status | Decision/Note |
| :--- | :--- | :--- | :--- |
| `cargo deny` advisory failures | HIGH | Recorded | `D-RN-A5-1`: Dependency bump (`oauth2` 5.x) required; non-mechanical. Kept open for owner (Checklist item 14). |
| `wire` contract violations | MEDIUM | Recorded | `catalog.refresh`/`apply` lack e2e stubs (carried debt from A1). |
| `actions` gate (19 violations) | MEDIUM | Closed | E5 resolved all 19 violations; Z1 re-measured at 193 registered / 193 used / 0 violations (exit 0). |
| `ds-v3` Gauge.css literals | LOW | Closed | Re-measured by Z1 across `apps/desktop/src/v3`, `packages/ui/src/v3`, `apps/remote/src`: 0 violations (exit 0). |

---

## 3. FIN4 matrix on `r-next/integration` (Z1 run)

- **Tree:** `r-next/integration` @ `28ee5e2` (worktree `.agents/worktrees/rn-z1` on branch `r-next/z1-final`).
- **Date:** 2026-11-19.
- **Gate-log directory:** `bridge-io/audit/z1/`.

| #   | Row                                                                      | Command                                                                                       | Z1 result                                                                                         | Evidence (gate log)   | Exit code |
| --- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------- | :---: |
| 1   | Rust format                                                              | `cargo fmt --check` (CARGO_HOME=/tmp/cargo-home)                                              | PASS — clean, 0 formatting errors                                                                 | `bridge-io/audit/z1/cargo-fmt.log` | 0 |
| 2   | Rust lint                                                                | `cargo clippy --workspace --all-targets -- -D warnings`                                       | PASS — 0 warnings, clean workspace build                                                          | `bridge-io/audit/z1/cargo-clippy.log` | 0 |
| 3   | Rust tests                                                               | `cargo test -p warsha-store -p warshad -p warsha-cli`                                         | PASS — 330 passed (store 47, warshad 281, cli 2), 0 failed                                        | `bridge-io/audit/z1/cargo-test-scoped.log` | 0 |
| 4   | TS typecheck                                                             | `pnpm --filter warsha-desktop typecheck`                                                      | PASS — 0 errors across desktop TypeScript sources                                                 | `bridge-io/audit/z1/pnpm-desktop-typecheck.log` | 0 |
| 5   | TS lint                                                                  | `pnpm --filter warsha-desktop lint`                                                           | FAIL — 18 problems (17 errors, 1 warning; pre-existing `@warsha/*` import resolution debt)        | `bridge-io/audit/z1/pnpm-desktop-lint.log` | 1 |
| 6   | Unit suites                                                              | `pnpm --filter warsha-desktop test && pnpm --filter warsha-remote test`                       | PASS — 1,167 passed (desktop 938/938, remote 229/229), 0 failed                                   | `bridge-io/audit/z1/pnpm-desktop-test.log`, `pnpm-remote-test.log` | 0 |
| 7   | i18n gate                                                                | `node scripts/ci/i18n-gate.mjs`                                                               | PASS — 1021 keys checked, 0 missing/unused/malformed violations                                   | `bridge-io/audit/z1/i18n-gate.log` | 0 |
| 8   | v3 non-visual e2e                                                        | desktop + remote unit/component suites (1,167 passed); Playwright @visual cited from E5       | PASS — full non-visual unit suites green; visual baseline sweep verified by E5                     | `bridge-io/audit/e5/verify-1.log` | 0 |
| 9   | Wire contracts                                                           | `node scripts/check-wire-contract.mjs`                                                        | FAIL — 4 violations (`catalog.refresh`/`apply` missing stubs; pre-existing A1 debt)               | `bridge-io/audit/z1/check-wire-contract.log` | 1 |
| 10  | Arch rules                                                               | `node scripts/check-arch.mjs`                                                                 | PASS — 5 architecture rules verified, 0 violations                                                 | `bridge-io/audit/z1/check-arch.log` | 0 |
| 11  | Policy                                                                   | `node scripts/check-engineering-policy.mjs`                                                   | PASS — 8 policy checks passed, 0 failures                                                         | `bridge-io/audit/z1/check-engineering-policy.log` | 0 |
| 12  | Versions                                                                 | `node scripts/check-versions.mjs`                                                             | PASS — all crate and package versions aligned to 0.3.0                                             | `bridge-io/audit/z1/check-versions.log` | 0 |
| 13  | Actions gate                                                             | `node scripts/ci/actions-gate.mjs`                                                            | PASS — 193 registered, 193 used, 0 violations                                                     | `bridge-io/audit/z1/actions-gate.log` | 0 |
| 14  | ds-v3                                                                    | `node scripts/check-ds-v3.mjs apps/desktop/src/v3 packages/ui/src/v3 apps/remote/src`          | PASS — 0 violations across all Design System v3 target paths                                      | `bridge-io/audit/z1/check-ds-v3.log` | 0 |
| 15  | cargo deny                                                               | `cargo deny --config deny.toml check` (+ `apps/desktop/src-tauri` manifest)                   | FAIL — 10 root / 11 desktop advisory notices (`RUSTSEC-2025-0134`, etc.); bans/licenses/sources ok| `bridge-io/audit/z1/cargo-deny-root.log`, `cargo-deny-desktop.log` | 1 |
| 16  | gitleaks                                                                 | `gitleaks detect --source . -v`                                                               | PASS — 836 commits scanned, 296.61 MB, 0 leaks found                                              | `bridge-io/audit/z1/gitleaks.log` | 0 |
| 17  | Gate-tool self-tests                                                     | `pw-gate`, `pw-genesis`, `actions-gate`, `policy`, `wire`, `arch` all `--self-test`           | PASS — all 6 gate-tool self-test suites passed cleanly                                            | `bridge-io/audit/z1/gate-selftests.log` | 0 |
| 18  | @visual verify (desktop 416 + remote 84, A10 budget `maxDiffPixels: 64`) | CI `capture-baselines.yml` verify legs & Docker container verify                              | PASS — 144 surfaces swept and verified byte-identical in Docker container (`warsha-capture:0.3.0`)| `bridge-io/audit/e5/verify-1.log`, `verify-1.json` | 0 |
| 19  | Workflows present                                                        | `.github/workflows/` (`ci.yml`, `capture-baselines.yml`, `desktop-bundle.yml`, `release.yml`) | PASS — all 4 CI/CD workflows present and syntactically valid                                      | `.github/workflows/` | 0 |
| 20  | Mock-provider greenfield e2e                                             | `cargo test -p warsha-pipeline --test fake_e2e`                                               | PASS — 6 passed, 0 failed, 0 ignored (1.02s)                                                      | `bridge-io/audit/z1/fake_e2e.log` | 0 |
| 21  | `--self-check` (release build)                                           | `warsha-desktop --self-check`                                                                 | Owner-only installer check (prior baseline 12/12 ×3 verified in FIN4/FIN5)                         | `docs/zadloop/packets/FINAL_REPORT.md` §3 | — |
| 22  | Docs consistency audit                                                   | `docs/VERIFY.md` §1.1 commands (package ID, binary name, updater config)                      | PASS — 0 stale IDs, 25 dev.warsha.remote, 0 Warsha.exe, updater historical only                   | `bridge-io/audit/z1/docs-consistency.log` | 0 |
| 23  | Remote app build & lint                                                  | `pnpm --filter warsha-remote build && pnpm --filter warsha-remote lint`                       | PASS — bundle built cleanly, 0 ESLint warnings/errors                                             | `bridge-io/audit/z1/pnpm-remote-build.log`, `pnpm-remote-lint.log` | 0 |
| 24  | Desktop app build                                                        | `pnpm --filter warsha-desktop build`                                                          | PASS — production Vite bundle built cleanly in 3.48s                                              | `bridge-io/audit/z1/pnpm-desktop-build.log` | 0 |

Owner-only / uncovered rows (recorded, not performed; see §4 and `docs/zadloop/R-NEXT-OWNER-CHECKLIST.md`):

| Row                                                  | Why uncovered                                             | Owner-checklist item |
| ---------------------------------------------------- | --------------------------------------------------------- | -------------------- |
| T2 Windows leg                                       | no Windows runner on the run host                         | item 4               |
| Installers (desktop bundles, APK release builds)     | A9: CI-built from a tagged tree when owner orders release | item 2               |
| T3 pairing S2–S5 (R-UI-7b physical device)           | needs two devices / owner hardware                        | item 3               |
| Install on owner PC, `--self-check` on installed app | owner-only                                                | item 2               |
| `main` fast-forward                                  | owner-only (§12)                                          | item 1               |

---

## 4. Open risks

| ID  | Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | State at Z1 close                                   | Evidence                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| R1  | **A5 advisory stack (`D-RN-A5-1`)** — `cargo deny` advisories: `RUSTSEC-2025-0134` (`rustls-pemfile 1.0.4` via `reqwest 0.11.27 <- oauth2 4.4.2 <- warsha-providers`) plus further 2026 advisory-DB notices on `chrono`, `h2`, `rustls 0.21.12`, `rustls-webpki 0.101.7`; root workspace counts 10 notices, `apps/desktop/src-tauri` counts 11 (adds `zbus_names`). Deliberately **not** ignored by A5/Z1. Owner decision: upgrade the TLS stack / `oauth2` 5.x, or accept by `OD-S*` ID with matching `deny.toml` ignores.       | OPEN (owner-side)                                   | `DECISIONS.md` `D-RN-A5-1`; `docs/zadloop/R-NEXT-OWNER-CHECKLIST.md` item 14; `bridge-io/audit/z1/cargo-deny-root.log` |
| R2  | **RF2 / A10 tolerance** — `@visual` compare carries a bounded 64-px decoded-pixel budget (`maxDiffPixels: 64`, threshold `0.05` unchanged, `maxDiffPixelRatio` unset). Scoped to `@visual` only.                                                                                                                                                                                                                                                                                                                                   | CLOSED / ACCEPTED by owner (A10); verified green by E5 | `docs/zadloop/packets/RF2-report.md`; `DECISIONS.md` `D-RN-RF2-5`; checklist item 13 (closed)                           |
| R3  | **F1 / F3-blocked rows** — F3 pairing S2–S5 (`@JavascriptInterface`/Keystore boundary) needs physical hardware; smoke-script S4/S5 harness follow-up is an owner decision. F1 visual capture was unblocked by E5 running the sweep on the pinned container.                                                                                                                                                                                                                                                                     | OPEN (owner-side for physical device / smoke script)| `docs/zadloop/packets/F3-report.md`; checklist items 3, 12; checklist item 5 closed by E5                               |
| R4  | **T2 Windows / installers / owner PC** — no Windows runner; installers not built (A9); nothing installed on the owner's PC; `main` not advanced.                                                                                                                                                                                                                                                                                                                                                                                     | OPEN (owner-side)                                   | `docs/zadloop/packets/FINAL_REPORT.md` §4; checklist items 1, 2, 4                                                      |
| R5  | **Pre-existing non-visual debt carried to Z1** — wire contract A1 debt (`catalog.refresh`/`catalog.apply` missing stubs, 4 violations); desktop ESLint import-resolution debt (18 problems, exit 1); cargo-deny advisory notices. Note: actions gate was closed by E5 (now 193/193, exit 0); ds-v3 is clean (0 violations).                                                                                                                                                                                                       | RECORDED as known pre-existing debt                 | `bridge-io/audit/z1/check-wire-contract.log`, `pnpm-desktop-lint.log`, `cargo-deny-root.log`                            |
| R6  | **Live-service checks never run** — OAuth live sign-in per shipped lane (A2), provider balance APIs (A3), phone approval over Tailscale (E2), codex CLI probe (N0). Tests use the mock provider / local stubs only (§3.1.11).                                                                                                                                                                                                                                                                                                        | OPEN (owner-side)                                   | checklist items 6, 7, 8, "Fleet notes"                                                                                  |
| R7  | **PM-takeover lanes** — D1, D4, D5, E3, E4 finished by PM after worker correction budgets were exhausted; lane-health notes record false gate claims (`D-RN-D4-006`). Gate evidence for those packets is PM-verified; all re-measured numbers in Z1 are green.                                                                                                                                                                                                                                                                     | CLOSED / VERIFIED by Z1 matrix                      | `DECISIONS.md` `D-RN-D4-006`, `D-RN-D4-007`; `PROGRESS.md` D4/D5/E3/E4 entries                                          |
| R8  | **A5 structural findings** — documented in `docs/zadloop/packets/A5-report.md` (HIGH: cargo deny; MEDIUM: wire contract stubs; LOW: dead code / TODO sweep).                                                                                                                                                                                                                                                                                                                                                                        | RECORDED                                            | `docs/zadloop/packets/A5-report.md`, `bridge-io/audit/a5/`                                                              |
| R9  | **Spend** — cumulative estimated spend vs the 400 ceiling (A1/A15); alert threshold 320.                                                                                                                                                                                                                                                                                                                                                                                                                                             | CLOSED / VERIFIED: ~180 units spent (45% of ceiling)| `PROGRESS.md` Z1 entry; checklist item 11 (closed)                                                                      |

---

## 5. Recommended next version

**Recommendation only — this report and this branch do not bump anything. All versions stay `0.3.0`.**

| Field            | Value                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current          | `0.3.0` (mobile `versionCode 300` per FIN4)                                                                                                                               |
| Recommended next | **Retain `0.3.0`** (or bump to `0.4.0` if owner determines breaking schema migrations like 016/018 or wire changes warrant a minor-version release)                        |
| Rationale inputs | Extensive new features shipped across R-NEXT (permissions, providers/OAuth, failover, 3-rung modes, swarm, secretary, CodeMirror 6 viewer). Since 0.3.0 is already the published baseline across all packages and Cargo.toml manifests, retaining 0.3.0 for the unified release or bumping to 0.4.0 is an owner-level product decision. |
| Owner action     | checklist item 10 — owner decides, bumps, and releases                                                                                                                    |

---

## 6. Owner checklist pointer

Owner checklist: [`docs/zadloop/R-NEXT-OWNER-CHECKLIST.md`](R-NEXT-OWNER-CHECKLIST.md).

- **Closed items:**
  - Item 5: Pending visual baselines — CLOSED by Packet E5 (144 surfaces captured and verified byte-identical, 0 pending).
  - Item 11: Spend-ceiling alert at 80% — CLOSED / VERIFIED by Z1 (~180 units of 400 spent; 45%).
  - Item 13: RF2 blocked gate — CLOSED by Amendment 3 / A10.
- **Open owner-gated items (human action required):**
  - Item 1: Fast-forward `main` after review (run close).
  - Item 2: Build installers and install on owner PC; run `--self-check` (FIN5).
  - Item 3: R-UI-7b physical-device pairing leg (F3).
  - Item 4: T2 Windows verification row (FIN4).
  - Item 6: One live sign-in per shipped OAuth lane (A2).
  - Item 7: Live check of each provider balance API (A3).
  - Item 8: Phone approval over Tailscale on a real device (E2).
  - Item 9: Review optional pixel skin audit result (E3).
  - Item 10: Decide next version number and release (Z1).
  - Item 12: Smoke-script S4/S5 harness follow-up (F3).
  - Item 14: Resolve cargo-deny advisory gate (`D-RN-A5-1`).

---

## 7. Z1 run summary and closeout

1. **Worktree & Branch:** created branch `r-next/z1-final` at integration tip `28ee5e2`.
2. **Matrix Audit:** executed complete FIN4 verification matrix; all logs and exit codes archived under `bridge-io/audit/z1/`.
3. **Artifact Integrity:** `main` verified unchanged at `939a173ff94d6de5aeb6b4827c57143b247d09e1`.
4. **Autonomy Compliance:** no git tags created (`cp-phase4` / `cp-final` deferred to owner), no merges to `main`, no remote pushes performed.
