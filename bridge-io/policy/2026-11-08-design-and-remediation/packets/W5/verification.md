# W5 — independent verification

- Run: `2026-11-08-design-and-remediation` · Packet W5 (Wave B, apps adopt Design System v2 + live wiring)
- Commit verified: `10a181998af4d0ee79e2435fac2f3b9d217902d5` (branch `run/2026-11-08/w5-apps-adoption`), BASE `406240a`
- Verify worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/verify-w5` (detached at the commit, `pnpm install --frozen-lockfile` exit 0, working tree clean before/after gates)
- Host: native Windows; commands run from the exact `packets/W5/prompt.md` §4 text
- Logs: `bridge-io/policy/2026-11-08-design-and-remediation/gates/<gate-id>.log` (header: gate id, command, commit, worktree, UTC start/end, exit code)
- No implementation, gate, plan, dependency, lockfile or snapshot file was modified.

## Worktree gates (14)

| Gate | Verdict | Exit | Measured value |
|---|---|---|---|
| G5.S scope vs 406240a | PASS | 0 | out-of-scope file count = 0 |
| G5.1 `pnpm --filter warsha-desktop test` | PASS | 0 | 464 passed / 0 failed, 50 files (threshold >= 451) |
| G5.2 `pnpm --filter warsha-remote test` | PASS | 0 | 221 passed / 0 failed, 16 files (threshold >= 221) |
| G5.3 `pnpm --filter @warsha/i18n test` | PASS | 0 | 52 passed / 0 failed, 1 file (threshold >= 52) |
| G5.4 `pnpm -r typecheck` | PASS | 0 | 5 projects Done |
| G5.5 `pnpm -r lint` | PASS | 0 | 5 projects Done, no findings |
| G5.6 `pnpm -r build` | PASS | 0 | all packages built (desktop dist, remote dist + sw precache 9 URLs) |
| G5.7 `WARSHA_R6_APP_LENGTH_BUDGET=0 pnpm --filter @warsha/ui test` | PASS | 0 | 181 passed / 0 failed, 9 files, ratchet at zero holds |
| G5.8 `grep -n 'TODO(M20 wiring)' apps/desktop/src/App.tsx` | PASS | 1 | no match (expected) |
| G5.9 `grep -q "daemon_ws_url: 'ws://127.0.0.1:8765'" apps/desktop/real-acceptance.cjs` | PASS | 0 | match present |
| G5.12 `git status --porcelain -- '*-snapshots/*' \| wc -l` | PASS | 0 | 0 snapshot paths touched |
| G5.A `node scripts/check-arch.mjs` | PASS | 0 | 5 rules, 0 violations |
| G5.P `node scripts/check-engineering-policy.mjs` | PASS | 0 | 8 checks, 0 failures |
| G5.W `node scripts/check-wire-contract.mjs` | PASS | 0 | 9 checks, 0 violations |

Overall for the 14 worktree gates: **PASS (14/14)**.

## Capture-host gates (not run here)

- G5.10 `playwright test --project=desktop` (Linux capture host, expected 793 passed / 0 failed, equal to G0): **orchestrator-run, pending** at the time of this verification. Not executed by the verifier (different host); no `gates/G5.10.log` present in this directory yet. W5 desktop-gate status therefore depends on the orchestrator's own log.
- G5.11 `playwright test --project=remote` (expected 91 passed / 0 failed): **BLOCKED on owner decision OD1** (40 stale remote baselines awaiting owner refresh). Not run — running it would only re-confirm stale baselines, and refreshing them is out of verifier scope. Recorded as blocked, never as passed.

## Overall position

- W5 implementation, quality gates, scope, policy, wire contract and the 14 worktree gates are green at `10a1819`, with test counts at or above every frozen threshold.
- G5.11 remains **unsatisfiable pending OD1**; consequently **W5 as a whole is not fully green** and cannot be closed/flipped to done until the owner names the 40 remote baselines and the gate is re-run on the capture host. G5.10 is likewise outstanding pending the orchestrator's desktop run.
