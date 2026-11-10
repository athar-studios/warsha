# Packet F3 — flows mode-group flake warm-up (planner-capacity micro-packet, base defect)

Base: C1 tip `128b59c08cbf5ddbe4de002528a50f451ea74296`. Branch `run/2026-11-09-ui-v3/f3-flake-warmup`.
Worktree `C:/Users/Dragonfly/Downloads/warsha-wt/v3/f3`.
Basis: `research/h1-flake-rootcause.md` §2.1 — the mode-group `browser closed` flake is a pre-existing, load-sensitive
chromium target death at the live simple→advanced switch; the fix is to warm both bench module graphs before workers start.
Allowed files: `apps/desktop/playwright.config.ts` (add `globalSetup` only) and `apps/desktop/e2e/support/global-setup.ts` (new).

## Acceptance gates (frozen by the orchestrator at planner capacity; never edited by the implementer)

| id | check | expect |
|---|---|---|
| F3.1 | `pnpm -r typecheck` | exit 0 |
| F3.2 | `pnpm --filter warsha-desktop lint` | exit 0 |
| F3.3 | `pnpm --filter warsha-desktop test` | exit 0 ("Tests N passed") |
| F3.4 | `test -z "$(git diff --name-only $BASE..HEAD | grep -vE '^(playwright\.config\.ts|apps/desktop/e2e/support/global-setup\.ts)$')"` | exit 0 (scope) — **amended at planner capacity 2026-11-10T03:08Z**: the repo Playwright config is at the ROOT `playwright.config.ts`; the original `apps/desktop/playwright.config.ts` path does not exist (review finding F-1) |
| F3.5 | deps gate (standard regex vs `$BASE..HEAD`) | exit 1 (no dependency added or bumped) |
| F3.6 | `node "$EV/tools"/pw-gate.mjs snapshots $BASE HEAD -` | exit 0, snapshot_changes=0 |
| F3.7.pw | on a scratch merge of F3 onto the integration tip: `pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/$GATE.json"; node "$EV/tools"/pw-gate.mjs failures "$EV/gates/$GATE.json" "$EV/named/EMPTY.txt"` | pw-gate exit 0 (0 failures; retries stay 0 — no test, threshold, named-set or gate change) |

## What the fix must NOT do
- No `retries` change (stays 0 — a retry would mask the flake and soften the gate).
- No edit to any test/assertion, `named/*.txt`, snapshots, or gate command.
- No `--update-snapshots`, no dependency change, no file outside the two allowed.

## Process rule (recorded, not code)
Capture-host exclusivity during `.pw` runs: no other Playwright/chromium-heavy lane concurrently (extends "capture serialized").
