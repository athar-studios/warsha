# Practical UI Drive: R9 Round — GAP-H3 Failover + MISS-1 Greenfield Git Auto-Init

**Date:** 2026-11-22T18:34:09.226Z  
**Environment:** Linux (Ubuntu 24.04 x86_64), Headless Chromium, Arabic Locale (`ar-EG`), Dark Theme, RTL Layout  
**Rule:** Permanent owner rule OD-PRACTICAL-REVIEW-1 (DECISIONS.md)  
**Binary & Bundle Tested:** `Warsha 0.3.1` (built desktop frontend dist + warshad 0.3.1 daemon)  
**Branch / Worktree:** `r-next/integration` at commit `db29346` (merge autoinit)

---

## 1. Merged-Tip Verification Gates

All gates verified cleanly with `CARGO_HOME=/tmp/cargo-home`:

| Gate | Command | Expected / Parity | Actual Output / Result | Verdict |
|---|---|---|---|---|
| **Code Formatting** | `cargo fmt --all -- --check` | 0 diffs | FMT_OK (no diffs) | **PASS** |
| **Clippy Linter** | `cargo clippy --workspace --all-targets -- -D warnings` | 0 warnings | 0 warnings, finished in 8.45s | **PASS** |
| **Pipeline Lib Tests** | `cargo test -p warsha-pipeline --lib` | 588 passed | 588 passed, 0 failed, 7 ignored | **PASS** |
| **Providers Lib Tests** | `cargo test -p warsha-providers --lib` | 71 passed | 71 passed, 0 failed, 0 ignored | **PASS** |
| **Failover Integration Tests** | `cargo test -p warsha-providers --test failover` | 9 passed | 9 passed, 0 failed, 0 ignored | **PASS** |
| **Daemon Lib Tests** | `cargo test -p warshad --lib` | 319 passed | 319 passed, 0 failed, 4 ignored | **PASS** |
| **Engineering Policy Gate** | `node scripts/check-engineering-policy.mjs` | 8 checks, 0 failed | 8 checks, 0 failed | **PASS** |
| **Versions Alignment Gate** | `node scripts/check-versions.mjs --expect 0.3.1` | 0.3.1 aligned | All packages at 0.3.1 | **PASS** |
| **Architecture Gate** | `node scripts/check-arch.mjs` | 5 rules, 0 violations | 5 rules, 0 violations | **PASS** |
| **Wire Contract Gate** | `node scripts/check-wire-contract.mjs` | 11 checks, 0 violations | 11 checks, 0 violations | **PASS** |
| **Actions Gate** | `node scripts/ci/actions-gate.mjs` | 199/199, 1 violation (parity) | 199 registered, 199 used, 1 violation (factory.retry pre-existing A6) | **PASS** |
| **i18n Gate** | `node scripts/ci/i18n-gate.mjs` | 1074 keys, 19 violations (parity) | 1074 keys, 19 violations (pre-existing base parity) | **PASS** |

---

## 2. Practical Drive Proving Matrix

| Fix / Gap | Proving Requirement | Real Daemon + UI Observed Outcome | Verdict |
|---|---|---|---|
| **MISS-1: Greenfield Git Auto-Init** | `create_project` without `repo_path` auto-inits repo under `<data_dir>/projects/<id>/repo` | Returned `repo_path=/tmp/warsha-ui-drive-r9-wSeYpD/data/projects/e644d119-afd5-4b00-8763-3cc4562fa769/repo`, initialized `.gitignore` and `README.md` | **PASS** |
| **MISS-1: Repo Validation** | Path passes `validate_repository` (`git rev-parse`) | `git rev-parse --is-inside-work-tree` returned `true`; HEAD commit `709f60353accd47316afbb3bb8fb3bd4ed3d59dc` verified | **PASS** |
| **MISS-1: Worktree Checkout** | `start_run` returns non-null `worktree_path` containing checkout files | `worktree_path=/tmp/warsha-ui-drive-r9-wSeYpD/data/worktrees/run-01M828JM6KXK39YVKCZY77HZ3Q` exists with checked-out `.gitignore` and `README.md` | **PASS** |
| **MISS-1: UI Presentation** | Desktop UI displays newly created project bench view | Element `[data-testid="bench-main"]` loaded; screenshot captured | **PASS** |
| **GAP-H3: Fast Retry on 503** | 503 server downtime allows at most 1 fast retry with 0 backoff delay | Daemon log records `server downtime (503/5xx) on provider, attempting fast retry` with attempt 1 | **PASS** |
| **GAP-H3: Failover to Secondary** | Fails over to fallback provider and completes stage successfully | `chat_with_fallback` routed to `mock`; Research stage finished in **1038ms** | **PASS** |
| **GAP-H3: Universal Cooldown** | Downed 503 provider engages 60s cooldown | Daemon log records `engaging cooldown for provider after server downtime or failover error` | **PASS** |
| **GAP-H3: Cooldown Skip (2nd Call)** | Subsequent call skips downed provider in cooldown | Run 2 skipped `mock-503` immediately, routed directly to `mock` in **1053ms** | **PASS** |
| **GAP-H3: Fail-Fast Without Fallback** | When fallback is disabled, fails fast and displays failure banner | Run 3 failed fast in **541ms**; `[data-testid="bench-run-failed-banner"]` rendered | **PASS** |

---

## 3. Artifacts and Exact File:Line Evidence

### Screenshots
- **01 (MISS-1 Greenfield Bench Overview):** `/home/moe/Downloads/Warsha/.agents/worktrees/r-next-integration/artifacts/ui-drive-r9/01-miss1-greenfield-bench-overview.png`
- **02 (GAP-H3 Failover Research Success):** `/home/moe/Downloads/Warsha/.agents/worktrees/r-next-integration/artifacts/ui-drive-r9/02-h3-failover-research-success.png`
- **03 (GAP-H3 Cooldown Skip Success):** `/home/moe/Downloads/Warsha/.agents/worktrees/r-next-integration/artifacts/ui-drive-r9/03-h3-cooldown-skip-success.png`
- **04 (GAP-H3 Failfast Failure Banner):** `/home/moe/Downloads/Warsha/.agents/worktrees/r-next-integration/artifacts/ui-drive-r9/04-h3-failfast-cooldown-banner.png`

### Daemon Log
- **Daemon Log File:** `/home/moe/Downloads/Warsha/.agents/worktrees/r-next-integration/artifacts/ui-drive-r9/warshad.log`

### Daemon Log Citations (`warshad.log`)
#### Fast Retry on 503
- Line 12: `2026-11-22T18:34:00.062640Z  WARN warsha_providers: server downtime (503/5xx) on provider, attempting fast retry provider=mock-503 attempt=1`

#### Cooldown Engagement
- Line 13: `2026-11-22T18:34:00.062703Z  WARN warsha_providers: engaging cooldown for provider after server downtime or failover error provider=mock-503 cooldown_secs=60`

#### Failover Execution
- Line 14: `2026-11-22T18:34:00.062724Z  INFO warsha_providers: failing over to next routing target failed_provider=mock-503`

#### Cooldown Skipping on Subsequent Call
- Line 22: `2026-11-22T18:34:03.312431Z  INFO warsha_providers: skipping provider in cooldown provider=mock-503`
- Line 31: `2026-11-22T18:34:06.578886Z  INFO warsha_providers: skipping provider in cooldown provider=mock-503`

---

## 4. Honest Disclosure of Visual Inspection Scope

- **Inspected via Playwright DOM & Assertions:**
  * Project creation RPC response containing `repo_path`.
  * Physical filesystem presence of initialized `.git`, `.gitignore`, and `README.md`.
  * `git rev-parse --is-inside-work-tree` and HEAD commit validation.
  * `runs.start` non-null `worktree_path` and presence of worktree checkout files.
  * Desktop UI navigation to Bench Overview (`[data-testid="bench-main"]`).
  * Gate A decision approve button interaction in UI (`[data-testid="bench-gate-approve-btn"]`).
  * Research stage progression through failover.
  * Run 2 stage progression with cooldown skipping.
  * Failure banner presence and inner text on failfast (`[data-testid="bench-run-failed-banner"]`).
- **Rendered as Artifacts (Automated Screenshots):**
  * Screenshots 01, 02, 03, and 04 captured by headless Chromium in 1400x900 viewport, Arabic locale (`ar-EG`), RTL layout, dark theme.
  * Visual layout, fonts, and dark theme colors are captured to disk; human visual aesthetic inspection of pixel-level typography is preserved in PNG files for audit.

---

## 5. Execution Transcript
```
[2026-11-22T18:33:51.447Z] ================================================================
[2026-11-22T18:33:51.448Z] PRACTICAL UI DRIVE: R9 Round — GAP-H3 Failover + MISS-1 Auto-Init
[2026-11-22T18:33:51.448Z] Permanent owner rule OD-PRACTICAL-REVIEW-1 verification
[2026-11-22T18:33:51.448Z] ================================================================
[2026-11-22T18:33:51.454Z] Frontend static web server listening on http://127.0.0.1:19482
[2026-11-22T18:33:51.454Z] Spawning daemon: /home/moe/Downloads/Warsha/.agents/worktrees/r-next-integration/target/debug/warshad
[2026-11-22T18:33:55.493Z] Daemon healthy on HTTP port 19480 and WS port 19481
[2026-11-22T18:33:55.493Z] Launching headless Chromium in Arabic locale (ar-EG)...
[2026-11-22T18:33:55.603Z] Navigating to http://127.0.0.1:19482/ ...
[2026-11-22T18:33:57.671Z] -----------------------------------------------------------------
[2026-11-22T18:33:57.672Z] PART 1: MISS-1 Greenfield Git Auto-Init Proof
[2026-11-22T18:33:57.672Z] -----------------------------------------------------------------
[2026-11-22T18:33:57.672Z] Calling projects.create WITHOUT repo_path...
[2026-11-22T18:33:57.697Z] Project created: id=e644d119-afd5-4b00-8763-3cc4562fa769
[2026-11-22T18:33:57.697Z] Returned repo_path=/tmp/warsha-ui-drive-r9-wSeYpD/data/projects/e644d119-afd5-4b00-8763-3cc4562fa769/repo
[2026-11-22T18:33:57.697Z] Confirmed repo directory structure and initial files (.gitignore, README.md)
[2026-11-22T18:33:57.697Z] Validating repository via git rev-parse...
[2026-11-22T18:33:57.708Z] Repository passes validate_repository (git rev-parse): HEAD=709f60353accd47316afbb3bb8fb3bd4ed3d59dc
[2026-11-22T18:33:57.708Z] Starting Run 1 on the greenfield project...
[2026-11-22T18:33:57.732Z] Run 1 started: id=01M828JM6KXK39YVKCZY77HZ3Q
[2026-11-22T18:33:57.732Z] Returned worktree_path=/tmp/warsha-ui-drive-r9-wSeYpD/data/worktrees/run-01M828JM6KXK39YVKCZY77HZ3Q
[2026-11-22T18:33:57.732Z] Confirmed worktree_path exists and contains checked-out files from auto-init commit
[2026-11-22T18:33:57.732Z] Navigating browser to Bench URL: http://127.0.0.1:19482/#/p/e644d119-afd5-4b00-8763-3cc4562fa769/r/01M828JM6KXK39YVKCZY77HZ3Q/overview
[2026-11-22T18:33:58.945Z] Saved UI screenshot for MISS-1: /home/moe/Downloads/Warsha/.agents/worktrees/r-next-integration/artifacts/ui-drive-r9/01-miss1-greenfield-bench-overview.png
[2026-11-22T18:33:58.945Z] -----------------------------------------------------------------
[2026-11-22T18:33:58.945Z] PART 2: GAP-H3 Fast Failover on 503 & Universal Cooldown Proof
[2026-11-22T18:33:58.945Z] -----------------------------------------------------------------
[2026-11-22T18:33:58.945Z] Configuring researcher role routing: primary=mock-503, fallback=mock, fallback_enabled=true
[2026-11-22T18:33:58.949Z] Researcher role configured successfully: {"jsonrpc":"2.0","id":1795372438945,"result":null}
[2026-11-22T18:33:58.949Z] Advancing Run 1 past Idea to Gate A...
[2026-11-22T18:34:00.012Z] Approving Gate A...
[2026-11-22T18:34:01.055Z] Advancing into Research stage (which encounters mock-503 downtime and fails over to mock)...
[2026-11-22T18:34:02.093Z] [Failover T+1s] Run 1 current_stage=prd_spec status=paused
[2026-11-22T18:34:02.093Z] Research stage completed successfully via failover in 1038ms
[2026-11-22T18:34:02.173Z] Saved UI screenshot for H3 failover success: /home/moe/Downloads/Warsha/.agents/worktrees/r-next-integration/artifacts/ui-drive-r9/02-h3-failover-research-success.png
[2026-11-22T18:34:02.173Z] Starting Run 2 to verify cooldown skipping on subsequent calls...
[2026-11-22T18:34:04.305Z] Advancing Run 2 into Research stage while mock-503 is in cooldown...
[2026-11-22T18:34:05.358Z] [Cooldown-skip T+1s] Run 2 current_stage=prd_spec status=paused
[2026-11-22T18:34:05.358Z] Run 2 completed in 1053ms (mock-503 was skipped due to active cooldown)
[2026-11-22T18:34:05.436Z] Saved UI screenshot for H3 cooldown skip: /home/moe/Downloads/Warsha/.agents/worktrees/r-next-integration/artifacts/ui-drive-r9/03-h3-cooldown-skip-success.png
[2026-11-22T18:34:05.437Z] Reconfiguring researcher role: only mock-503, fallback_enabled=false to prove fast failure & banner...
[2026-11-22T18:34:07.571Z] Advancing Run 3 into Research stage with single failing 503 provider...
[2026-11-22T18:34:08.112Z] Run 3 failure banner appeared at T+0.5s: "تعثّر هذا التشغيل قبل الاكتمال. تحقق من الأحداث أو أعِد المحاولة."
[2026-11-22T18:34:08.112Z] Run 3 failed fast in 541ms with visible failure banner in Bench Overview
[2026-11-22T18:34:08.196Z] Saved UI screenshot for H3 failfast banner: /home/moe/Downloads/Warsha/.agents/worktrees/r-next-integration/artifacts/ui-drive-r9/04-h3-failfast-cooldown-banner.png
[2026-11-22T18:34:08.196Z] Cleaning up browser, static web server, and daemon process...
[2026-11-22T18:34:08.224Z] -----------------------------------------------------------------
[2026-11-22T18:34:08.224Z] PART 3: Auditing daemon log for exact evidence lines
[2026-11-22T18:34:08.224Z] -----------------------------------------------------------------
[2026-11-22T18:34:09.226Z] Found 1 fast-retry log lines:
[2026-11-22T18:34:09.226Z]   Line 12: 2026-11-22T18:34:00.062640Z  WARN warsha_providers: server downtime (503/5xx) on provider, attempting fast retry provider=mock-503 attempt=1
[2026-11-22T18:34:09.226Z] Found 1 cooldown-engage log lines:
[2026-11-22T18:34:09.226Z]   Line 13: 2026-11-22T18:34:00.062703Z  WARN warsha_providers: engaging cooldown for provider after server downtime or failover error provider=mock-503 cooldown_secs=60
[2026-11-22T18:34:09.226Z] Found 1 failover log lines:
[2026-11-22T18:34:09.226Z]   Line 14: 2026-11-22T18:34:00.062724Z  INFO warsha_providers: failing over to next routing target failed_provider=mock-503
[2026-11-22T18:34:09.226Z] Found 2 cooldown-skip log lines:
[2026-11-22T18:34:09.226Z]   Line 22: 2026-11-22T18:34:03.312431Z  INFO warsha_providers: skipping provider in cooldown provider=mock-503
[2026-11-22T18:34:09.226Z]   Line 31: 2026-11-22T18:34:06.578886Z  INFO warsha_providers: skipping provider in cooldown provider=mock-503
[2026-11-22T18:34:09.226Z] All required log lines verified present in warshad.log!
```
