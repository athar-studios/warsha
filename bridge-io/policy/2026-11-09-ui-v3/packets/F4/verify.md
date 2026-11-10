# F4 verification — run 2026-11-09-ui-v3 (verifier: Test engineer)

- EV: `C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3`
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/f4` (host windows; F4 has NO Playwright/capture gate — WSL capture host untouched)
- BASE: `128b59c08cbf5ddbe4de002528a50f451ea74296`
- HEAD: `29b04335582ee7383dd56f87827592db5bd64d5e` (worktree HEAD matches; reviewer verdict APPROVE per `packets/F4/review.md`)
- Gates run verbatim from `packets/F4/gates.md`; raw output in `gates/<id>.log`.
- **Result: 5/5 PASS** (F4.2 via second unchanged attempt, see below).

## Per-gate table

| gate | check (abbrev.) | verdict | exit | log |
| --- | --- | --- | --- | --- |
| F4.1 | pnpm --filter warsha-desktop lint | **PASS** | 0 | `gates/F4.1.log` |
| F4.2 | pnpm --filter warsha-desktop test (exit 0, Tests N passed, N ≥ 590) | **PASS** (attempt 2: `Test Files 79 passed (79)`, `Tests 590 passed (590)`) | 0 | `gates/F4.2b.log` |
| F4.3 | diff names limited to `apps/desktop/src/harness.contract.test.ts` | **PASS** (no outside paths) | 0 | `gates/F4.3.log` |
| F4.4 | deps gate (standard regex) vs `$BASE..HEAD` | **PASS** (no dep added/bumped) | 1 | `gates/F4.4.log` |
| F4.5 | pw-gate.mjs snapshots `$BASE HEAD -` | **PASS** (`snapshot_changes=0 outside=0`) | 0 | `gates/F4.5.log` |

## F4.2 second unchanged attempt (permitted by run R0 precedent)

- Attempt 1 (`gates/F4.2.log`): exit 1 — `Tests 1 failed | 589 passed (590)`; the single failure was
  `src/screens/ModelsSettings.test.tsx > validates the add form and then writes the new row through the daemon`
  with `Error: Test timed out in 5000ms.` while a full Playwright suite ran concurrently on the 2-CPU host
  (load-sensitive). Single-file rerun of the same test in the same worktree PASSED 8/8
  (`gates/F4.2.diag.log`, script `gates/f4-scripts/F4.2.diag.sh`).
- Attempt 2 (`gates/F4.2b.log`): same command, unchanged — `pnpm --filter warsha-desktop test`, host idle.
  exit 0; `Test Files 79 passed (79)`; `Tests 590 passed (590)` (N = 590 ≥ 590); zero failures in the log.
- Verdict: **PASS**, judged from attempt 2's own log. Both attempt logs preserved.

## acceptance.json note

F4.2 verdict fields updated to `pass` / exit_code 0 / commit `29b04335582ee7383dd56f87827592db5bd64d5e` /
timestamp `2026-11-10T04:12:29Z` / log `gates/F4.2b.log`, plus a `note` naming both attempts
(attempt 1 = load-sensitive 5s timeout + 8/8 single-file rerun; attempt 2 = this clean run).
Only verdict fields for F4.2 were mutated; nothing else edited.

## Uncovered scope

- No Playwright/capture/axe/system/security gates in this packet (none frozen for F4; WSL capture host not used).
- F4.1/F4.3/F4.4/F4.5 logs are from the first frozen run (unchanged, previously passed); F4.2 judged only from its two attempt logs — no other tests, snapshots, or files were exercised or changed.

## Blockers

- none
