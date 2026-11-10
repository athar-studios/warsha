# U1 repair re-review — run 2026-11-09-ui-v3 (2026-11-10)

- Reviewer: independent read-only re-review of packet U1's repair. No worktree files edited.
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/u1` (clean; only pre-existing untracked `packages/ui/storybook-static/` build artifact, not packet code).
- Base: `128b59c08cbf5ddbe4de002528a50f451ea74296`; prior reviewed head `77da2a0`; repair head `1762caa` (= `1762caa972f1bca55721dc17ed8794125db61bc2`).
- Repair delta `77da2a0..1762caa` = 4 commits: `52060f0` (F1), `20e58df` (F2), `9b22c47` (F3), `1762caa` (F4) — exactly one commit per finding.
- Prior review: `packets/U1/review.md` (F1 blocking, F2 blocking, F3 minor, F4 minor).

## Verdict: APPROVE

All four findings closed. All three warm measurements pass. No new findings.

## Per-finding closure

- **F1 (blocking) — CLOSED.** `packages/ui/src/v3/index.ts` now ends with `export * from './composites';` alongside the intact `./tokens`, `./icons`, `./primitives` re-exports (commit `52060f0`, the only commit touching that file since base). The composites barrel `composites/index.ts` has exactly 27 `export * from './…'` lines, so all 27 composites are reachable via `@warsha/ui/v3`; typecheck + tests green prove it compiles. No `package.json` change was needed (entry point is the subpath already exported).
- **F2 (blocking) — CLOSED.** `BudgetField.tsx` selected preset no longer switches to `variant="primary"`; it renders `variant="secondary"` plus a token-only selection style (`--w-sunken` bg, `--w-primary-text` text/border, semibold) — DS-compliant selection, no yellow fill, no hardcoded colours. The test was **updated, not deleted** (`BudgetField.test.tsx` +3/−1): asserts `data-selected="true"`, `data-variant="secondary"`, and `not data-variant="primary"`. Commit `20e58df`.
- **F3 (minor) — CLOSED.** `Card.tsx` drops `attention` from `CardVariant` and from `VARIANT_STYLES`; story `Attention` replaced by `Sunken` story coherently; `grep attention packages/ui/src/v3/composites/Card*` → no matches. `DecisionCard.tsx` remains the only orange card ("The only orange (attention) card"). Other `attention` uses (Banner, Toast, TopBar badge) are tones, not cards — consistent with the contract. Commit `9b22c47`.
- **F4 (minor) — CLOSED.** `DataTable.tsx` sortable `th` gains `tabIndex={0}` and `onKeyDown` handling Enter/Space (with `preventDefault`, non-sortable headers skipped), keeping `aria-sort` (line 123) and `scope="col"` intact. `DataTable.test.tsx` +26 lines adds a keyboard test: `tabindex="0"` on sortable header, Enter → `onSort('name','desc')`, Space → second call, non-sortable header has no tabindex. Commit `1762caa`.

## Scope

`git diff --name-only 128b59c..1762caa` = only `packages/ui/src/v3/composites/**` (7 files) + `packages/ui/src/v3/index.ts`. No deps, no v2, no `package.json`/Cargo. `packages/ui/README.md` unchanged (allowed, not required). Scope = OK.

## Measurements (warm, this re-review)

1. `pnpm --filter @warsha/ui test` → **exit 0**, `Test Files 58 passed (58)`, `Tests 373 passed (373)` (33.01s) — matches expected ~373/58.
2. `node scripts/check-ds-v3.mjs packages/ui/src/v3` → `check-ds-v3: 0 violations in packages/ui/src/v3`, **exit 0**.
3. `pnpm -r typecheck` → all packages/apps Done (client, crypto, ui, i18n, desktop, remote), **exit 0**.

Playwright not run, per brief.

## Findings

None. No regressions, no out-of-scope changes, no new defects in the repair delta.
