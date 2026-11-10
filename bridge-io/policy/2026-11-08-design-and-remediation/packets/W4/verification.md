# W4 verification — wire-contract cleanup, `WarshaClient` expansion, e2e harness completion

- Role: independent VERIFIER (not implementer, not reviewer; verification made no code changes)
- Commit verified: `73b1331c76ccb7c6ea14e78ff4c874b8faf563c4` (branch `run/2026-11-08/w4-wire-client-harness`)
- Scope base: `5abe5ef` (advanced integration tip after W8 merged); `git merge-base --is-ancestor 5abe5ef HEAD` → yes
- Verification worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/verify-w4` (detached at the commit above; `pnpm install --frozen-lockfile`, node v26.8.1, pnpm 9.0.0)
- Worktree state after all gates: `git status --porcelain` → 0 lines; HEAD unchanged at `73b1331`
- Scope of the commit: only the 4 allowed files changed —
  `scripts/check-wire-contract.mjs`, `packages/client/src/index.ts`, `packages/client/src/index.test.ts`, `apps/desktop/e2e/harness.ts`
  (1448 insertions, 46 deletions across 4 files)
- Gate logs: `bridge-io/policy/2026-11-08-design-and-remediation/gates/<gate-id>.log` (each log carries gate id, exact command, commit, UTC timestamp, raw output, exit code)

## Gate results

| Gate | Verdict | Exit code | Measured value | Log |
|---|---|---|---|---|
| G4.S (scope, BASE=5abe5ef) | PASS | 0 | out-of-scope files: **0** (only the 4 allowed files changed) | `gates/G4.S.log` |
| G4.1 (`pnpm --filter @warsha/client test`) | PASS | 0 | **148 passed (148)**, 2 files — threshold ≥ 140 met | `gates/G4.1.log` |
| G4.2 (`pnpm --filter @warsha/client typecheck`) | PASS | 0 | `tsc --noEmit` clean, no diagnostics | `gates/G4.2.log` |
| G4.3 (`pnpm --filter @warsha/client lint`) | PASS | 0 | `eslint src --ext .ts` clean, no findings | `gates/G4.3.log` |
| G4.4 (`node scripts/check-wire-contract.mjs --self-test`) | PASS | 0 | "wire self-test: 9 checks fire, clean fixture is clean in both modes"; all 9 planted cases detected | `gates/G4.4.log` |
| G4.5 (`node scripts/check-wire-contract.mjs`) | PASS | 0 | `wire: 9 checks, 0 violations` (exact line) | `gates/G4.5.log` |
| G4.6 (`pnpm --dir apps/desktop exec tsc --noEmit -p tsconfig.e2e.json`) | PASS | 0 | no diagnostics | `gates/G4.6.log` |
| G4.7 (frozen `node -e` RPC_METHODS count) | PASS | 0 | printed **75** (n===75) | `gates/G4.7.log` |
| G4.8 (stale-wording grep; expect no match) | PASS | 1 (expected) | zero matches for all 4 stale phrases in `check-wire-contract.mjs` + `index.ts` | `gates/G4.8.log` |
| G4.9 (Playwright desktop, Linux capture host) | PASS — pass-by-orchestrator (not re-run by verifier) | 0 | **793 passed, 0 failed**, 0 snapshot writes | `gates/G4.9.log` |
| G4.10 (`git status --porcelain -- '*-snapshots/*' \| wc -l`) | PASS | 0 | snapshot changes: **0** | `gates/G4.10.log` |
| G4.A (`node scripts/check-arch.mjs`) | PASS | 0 | `arch: 5 rules, 0 violations` | `gates/G4.A.log` |
| G4.P (`node scripts/check-engineering-policy.mjs`) | PASS | 0 | `policy: 8 checks, 0 failures` | `gates/G4.P.log` |

**G4.9 is pass-by-orchestrator**: the orchestrator ran `pnpm exec playwright test --project=desktop --reporter=line` on the Linux capture host at exactly commit `73b1331c76ccb7c6ea14e78ff4c874b8faf563c4`, producing 793 passed / 0 failed / exit 0 / 0 snapshot writes — evidenced in `bridge-io/policy/2026-11-08-design-and-remediation/gates/G4.9.log` (lines 839 `[desktop exit code: 0]`, 842 `snapshot_writes: 0`, plus "793 passed"; `head_after` = the verified commit). The verifier did not run Playwright and did not pass `--update-snapshots`.

## Notes

- G4.1 test split: `src/wire-contract.test.ts` 23 tests + `src/index.test.ts` 125 tests = 148 total, 2 files passed.
- G4.4 self-test fires all nine checks including the new W9 case `client-method-without-harness-stub` (detected), and both clean fixtures (shipped and strict) stay at 0 violations.
- G4.8 returning exit 1 is the required outcome (no occurrence of the stale wording); the gate passes on absence of matches.
- No gate was weakened, edited, or re-interpreted; no implementation, dependency, lockfile, snapshot, or PLAN/PROGRESS/DECISIONS file was touched by verification.
- Everything in section 4 of `packets/W4/prompt.md` was executed except G4.9, which is explicitly delegated to the orchestrator's logged run.

## Overall verdict

**PASS** — all 13 frozen gates pass at `73b1331c76ccb7c6ea14e78ff4c874b8faf563c4`: 12 re-executed by the verifier in an isolated clean worktree (G4.S, G4.1–G4.8, G4.10, G4.A, G4.P) plus G4.9 pass-by-orchestrator from `gates/G4.9.log`.
