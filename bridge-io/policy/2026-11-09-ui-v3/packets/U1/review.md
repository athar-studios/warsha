# U1 review — design-system composites (2026-11-09-ui-v3)

- Reviewer: independent read-only review, 2026-11-10. No files in the worktree edited.
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/u1`
- Base: `128b59c08cbf5ddbe4de002528a50f451ea74296`; stated head `6d7a062`; **actual HEAD `77da2a0`** (7 commits, not 6 — an extra in-scope lint/type fix commit touching only `composites/**`).
- Delta scope verified: `git diff --name-only base..HEAD` = 82 files, **all** under `packages/ui/src/v3/composites/**` (27 × 3 + `composites/index.ts`). No `package.json`, no Cargo, no v2 files. Scope = OK.
- Untracked `packages/ui/storybook-static/` present in the tree — build artifact of the concurrent continuation session's `build-storybook`, not packet code; not counted against U1.
- No heavy commands run (no build/typecheck/test suite), per brief.

## Verdict: REQUEST-CHANGES

Three findings; F1 fails an explicit acceptance criterion of this review, F2 fails a frozen contract from `PACKETS.md` U1.

## Per-area judgement (27 composites)

| # | Composite | Judgement | Note |
| --- | --- | --- | --- |
| 1 | AppFrame | ok | header/nav/main landmarks, skip link first, density, action forwarding; test asserts banner/main/skip `#main` |
| 2 | TopBar | ok | inbox badge `variant="attention"`; labels via props |
| 3 | ProjectSwitcher | ok | `sanitizeProjectName` UUID fallback, search, "new project"; test covers UUID fallback + listbox select |
| 4 | SideNav | ok | `aria-current="page"` on active, groups, link + onClick |
| 5 | Card | **issue (minor, F3)** | ships a `variant='attention'` (orange) card + story, vs "DecisionCard is the only orange card" |
| 6 | ListRow | ok | one interactive element, no nested buttons |
| 7 | EmptyState | ok | icon, one sentence, one action |
| 8 | Banner | ok | tones, `role=status`/`alert` (danger), dismiss |
| 9 | Toast | ok | ToastProvider + `useToast()`; danger = duration 0 (persists) with retry; test proves persistence at +10s and retry |
| 10 | Dialog | ok | focus trap (Tab/Shift+Tab wrap), Esc, return focus, `--w-layer-modal`, `--w-scrim`; test covers trap + Esc |
| 11 | Sheet | ok | same contract as Dialog, verified in source |
| 12 | Menu | ok | `role=menu`/`menuitem`, arrows/Home/End, typeahead, Esc returns focus to trigger |
| 13 | Stepper | ok | 5 states, colours per §3.2 (current=`primary-text`, waiting=`attention`, done=`success`, failed=`danger`), `simple`/`detailed` |
| 14 | DecisionCard | ok | attention card, single `variant="primary"` Approve, request-changes requires non-empty text, reject via Dialog with reason; tests cover all three paths |
| 15 | Composer | ok | `simple`/`advanced`, controlled value, Enter sends / Shift+Enter breaks, `submitVariant`, `disabledReason`, `advancedControls` slot |
| 16 | ModelPicker | ok | options from caller only; empty → `onAddModel`; no internal list (U1.5 grep clean: no DeepSeek/GPT-4o/Claude/fleet/autonomous-factory) |
| 17 | BudgetField | **issue (F2)** | selected preset rendered `variant="primary"` (yellow fill) — contract: never yellow on selected pills/chips/rows; test locks the violation in |
| 18 | ActivityFeed | ok | `aria-live=polite`, grouped by stage, plain vs raw |
| 19 | PreviewCard | ok | start/stop/open, capability-gated (renders null when absent) |
| 20 | CodeView | ok | mono, `dir=ltr`, line numbers, copy |
| 21 | DiffView | ok | mono, `dir=ltr`, line numbers, copy |
| 22 | Transcript | ok | mono, `dir=ltr`, line numbers, copy |
| 23 | DataTable | **issue (F1-adjacent, F4)** | `aria-sort` ✓, scope="col" ✓, row Menu ✓, compact ✓; but sortable `th` is click-only — no `tabIndex`/`button`/`onKeyDown`, so sort has no keyboard path (DS §6) |
| 24 | SettingsSection | ok | title, description, scope sentence, content |
| 25 | CopyField | ok | copy → callback/feedback |
| 26 | KeyValue | ok | label/value + optional copy |
| 27 | QrCode | ok | deterministic SVG, `role=img`, LTR code, copy |

Barrels: `composites/index.ts` exports all 27 ✓. **`packages/ui/src/v3/index.ts` does NOT export `./composites`** — see F1.

## Contract checks (dependent contracts)

- Composer: **PASS** — variant, controlled value, Enter/Shift+Enter, `submitVariant`, `disabledReason`, advanced slot.
- ModelPicker: **PASS** — caller-supplied `options`, empty → `onAddModel`, no internal model list.
- DecisionCard: **PASS** — attention card, single yellow primary (Approve), required text for request-changes, reject via Dialog.
- Button primary: **PASS** — `--w-primary` fill + `--w-on-primary` (`#1B1A17` dark ink); contrast test in tokens asserts ≥4.5. No yellow text/lines found in composites.
- Stepper states: **PASS**.
- Toast/useToast: **PASS** — errors persist + retry callback, test-proven.
- Dialog/Sheet: **PASS** — focus trap, Esc, return focus, `layer-modal`, scrim.
- DataTable: **PARTIAL** — aria-sort, row Menu, compact all present; keyboard sort missing (F4).

## Scan result

`node scripts/check-ds-v3.mjs packages/ui/src/v3`

```
check-ds-v3: 0 violations in packages/ui/src/v3
```

**Exit code: 0.** (Light measurement only, per brief.)

## Findings

- **F1 (blocking, criterion 1):** `packages/ui/src/v3/index.ts` re-exports only `./tokens`, `./icons`, `./primitives` — not `./composites`. `@warsha/ui/v3` therefore exposes no composite and there is no `./v3/composites` subpath in `package.json` exports; the composites barrel is unreachable through the public entry point. The brief's delta listed `packages/ui/src/v3/index.ts` as in-scope, but it was never changed (`git log base..HEAD -- packages/ui/src/v3/index.ts` empty).
- **F2 (blocking, frozen contract):** `BudgetField.tsx:66` renders the selected preset as `variant="primary"` (logo-yellow fill). U1 contract: "never yellow on selected pills/chips/rows" — selection must use `primary-text` (as SideNav, ProjectSwitcher, DataTable sort, ModelPicker already do). `BudgetField.test.tsx:20` asserts `data-variant="primary"`, so the test must change with the fix.
- **F3 (minor):** `Card` ships an `attention` variant (orange) with a story, contradicting "DecisionCard is the only orange (`attention`) card". Either drop the variant or document the exception.
- **F4 (minor/a11y):** `DataTable` sortable headers are mouse-only (`onClick` on `th`); no keyboard path to trigger `onSort`, against DS §6 "Keyboard path for every action". `aria-sort` itself is correct.
- Observation (not a defect): HEAD is `77da2a0`, one commit past the stated `6d7a062`; that commit touches only `composites/**` (lint/type/test-syntax fixes) and stays in scope. `packages/ui/README.md` unchanged (still v2-only) — in allowed scope but not required by any U1 criterion.

## Blockers

F1 and F2 must be fixed (one-line barrel export; BudgetField selection styling + its test). F3/F4 recommended. Re-run `node scripts/check-ds-v3.mjs packages/ui/src/v3` after the fix.
