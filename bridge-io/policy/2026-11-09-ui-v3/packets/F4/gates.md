# Packet F4 — base lint fix (planner-capacity micro-packet, base defect)

Base: `128b59c08cbf5ddbe4de002528a50f451ea74296`. Branch `run/2026-11-09-ui-v3/f4-lint-fix`. Worktree
`C:/Users/Dragonfly/Downloads/warsha-wt/v3/f4`. Head to verify: `29b04335582ee7383dd56f87827592db5bd64d5e`.
Why: at the C1 tip `pnpm --filter warsha-desktop lint` failed with 2 ESLint `import/order` errors in
`apps/desktop/src/harness.contract.test.ts` (H1's file; H1's gate set had no lint gate). F4 fixes ordering only.
Allowed file: `apps/desktop/src/harness.contract.test.ts`.

## Acceptance gates (frozen; never edited by the implementer)
| id | check | expect |
|---|---|---|
| F4.1 | `pnpm --filter warsha-desktop lint` | exit 0 |
| F4.2 | `pnpm --filter warsha-desktop test` | exit 0 and "Tests N passed" with N >= 590 |
| F4.3 | `test -z "$(git diff --name-only $BASE..HEAD \| grep -vE '^apps/desktop/src/harness\\.contract\\.test\\.ts$')"` | exit 0 (scope) |
| F4.4 | deps gate (standard regex vs `$BASE..HEAD`) | exit 1 (no dependency added or bumped) |
| F4.5 | `node "$EV/tools"/pw-gate.mjs snapshots $BASE HEAD -` | exit 0, snapshot_changes=0 |

Host: Windows only (no capture gate). Reviewer verdict: APPROVE (`packets/F4/review.md`).
