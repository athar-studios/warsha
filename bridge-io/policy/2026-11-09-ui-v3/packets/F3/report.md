# Packet F3 Report: flows-flake-warmup

- Run: `2026-11-09-ui-v3`
- Packet: `F3` (`flows-flake-warmup`)
- Role: Implementer
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/f3`
- Branch: `run/2026-11-09-ui-v3/f3-flake-warmup`
- Base commit: `128b59c08cbf5ddbe4de002528a50f451ea74296`
- Head commit: `738aba6` (continuation of `ff337d57ca3fe7fc0ad5c0a37c35e3fb8fdbcb90`)

## Commits

- `ff337d5`: `test(desktop): add globalSetup warm-up helper for simple and advanced benches (F3)`

## What Changed

- Created `apps/desktop/e2e/support/global-setup.ts`:
  1. Concurrently probes dev servers `http://localhost:5173` and `http://localhost:5174` until each answers (polling with timeout, without assuming startup order).
  2. Launches one Chromium instance, creates a browser context with `baseURL: http://localhost:5173`.
  3. Sequentially navigates to and warms `/?screen=simple` (waiting for `.simple-mode, [data-ready]`) and `/?screen=advanced` (waiting for `.bench-advanced, [data-ready]`) using `openScreen`.
  4. Closes browser cleanly to ensure Vite transforms both bench module graphs before parallel test workers launch.

## Decisions

- Probed dev server URLs with concurrent `Promise.all` polling to satisfy non-assumption of dev-server startup order.
- Used `openScreen` harness helper with explicit `1440x900` typed viewport and combined selector `.simple-mode, [data-ready]` / `.bench-advanced, [data-ready]` to satisfy the contract.
- Kept root `playwright.config.ts` untouched pending orchestrator gate/scope refreeze to avoid failing frozen gate F3.4.

## Measured Results

- `F3.1` (`pnpm -r typecheck`): PASS (exit 0 across all 7 workspace packages).
- `F3.2` (`pnpm --filter warsha-desktop lint`): FAIL (exit 1 — base defect in `apps/desktop/src/harness.contract.test.ts`, see BLOCKER).
- `F3.3` (`pnpm --filter warsha-desktop test`): PASS (exit 0, 79 test files passed, 590 unit tests passed).
- `F3.4` (Scope): PASS (only `apps/desktop/e2e/support/global-setup.ts` committed).
- `F3.5` (Deps): PASS (exit 1 on regex, no dependencies added or bumped).
- `F3.6` (Snapshots): PASS (`snapshot_changes=0 outside=0`).

## Seen But Left Alone

- `apps/desktop/src/harness.contract.test.ts`: 2 import order ESLint errors (pre-existing base defect from H1 commit `fca542d`), left alone per allowed scope boundaries.
- `playwright.config.ts`: repo root configuration file; wiring `globalSetup` into root config was prepared but not committed to avoid violating frozen gate F3.4.

## BLOCKER

Two out-of-scope blockers prevent completing F3 without violating frozen gates or allowed scope:

1. **Gate F3.4 vs Config Path Mismatch**:
   - TASK and Gate F3.4 restrict config changes to `apps/desktop/playwright.config.ts`.
   - The repository's actual Playwright configuration is located at `playwright.config.ts` (workspace root). `apps/desktop/playwright.config.ts` does not exist.
   - Modifying root `playwright.config.ts` fails frozen gate F3.4 (`grep -vE '^(apps/desktop/playwright\.config\.ts|apps/desktop/e2e/support/global-setup\.ts)$'`).
   - Creating `apps/desktop/playwright.config.ts` is ignored by Playwright root execution during F3.7.pw (`pnpm exec playwright test --project=desktop --project=remote`).
   - Orchestrator action needed: update gate F3.4 to permit root `playwright.config.ts` (e.g. `^(playwright\.config\.ts|apps/desktop/e2e/support/global-setup\.ts)$`).

2. **Pre-existing Base Lint Defect on Gate F3.2**:
   - `pnpm --filter warsha-desktop lint` fails at BASE `128b59c08cbf5ddbe4de002528a50f451ea74296` with 2 errors in `apps/desktop/src/harness.contract.test.ts`:
     - Line 2:1: `There should be at least one empty line between import groups (import/order)`
     - Line 2:1: ``@warsha/client` import should occur before import of `vitest` (import/order)`
   - Fixing `apps/desktop/src/harness.contract.test.ts` is forbidden by F3 allowed scope ("ALLOWED FILES (only these)... NEVER touch tests").
   - Orchestrator action needed: dispatch micro-fix or waive `harness.contract.test.ts` for F3.2.

## Continuation (Scope Amended — seq 58)

- Head commit: `738aba6` (`test(e2e): wire globalSetup warm-up helper into root playwright config (F3)`).
- Root-config wiring: added `globalSetup: './apps/desktop/e2e/support/global-setup.ts'` to root `playwright.config.ts` (export matches Playwright contract `export default async function globalSetup(_config: FullConfig)`).
- Measured typecheck: `pnpm -r typecheck` exited 0 across all 7 workspace packages.
- Measured lint: `pnpm --filter warsha-desktop lint` exited 1 (only the pre-existing 2 `import/order` errors in `apps/desktop/src/harness.contract.test.ts`, scoped to parallel packet F4).
- Blockers: Blocker 1 resolved; Blocker 2 handled in F4.
