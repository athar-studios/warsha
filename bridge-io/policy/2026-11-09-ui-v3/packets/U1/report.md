# Packet U1 Report — Design System Composites (v3)

- Run: `2026-11-09-ui-v3`
- Packet: `U1` (`u1-ds-composites`)
- Role: Implementer / Continuation
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/u1`
- Branch: `run/2026-11-09-ui-v3/u1-ds-composites`
- Base commit: `128b59c08cbf5ddbe4de002528a50f451ea74296`
- Head commit: `1762caa972f1bca55721dc17ed8794125db61bc2` (repaired; pre-repair was `77da2a0`)

## Commits
1. `95571c8` feat(ui): add v3 shell composites (AppFrame, TopBar, ProjectSwitcher, SideNav)
2. `c9ef04a` feat(ui): add v3 feedback and overlay composites (Banner, Toast, Dialog, Sheet, Menu)
3. `99048c9` feat(ui): add v3 content container composites (Card, ListRow, EmptyState, SettingsSection, KeyValue)
4. `eabb536` feat(ui): add v3 workflow and action composites (Stepper, DecisionCard, Composer, ModelPicker, BudgetField)
5. `4d08b51` feat(ui): add v3 data and inspection composites (DataTable, ActivityFeed, PreviewCard, CopyField, QrCode)
6. `6d7a062` feat(ui): add v3 code/diff/transcript composites and barrel (U1, salvaged session)
7. `77da2a0` fix(ui): align v3 composites types, lint rules, and test syntax

## The 27 Composites List
All 27 composite components exist with complete `.tsx`, `.test.tsx`, and `.stories.tsx` triads (81 files) plus `packages/ui/src/v3/composites/index.ts`:

1. **AppFrame** (`AppFrame.tsx`, `AppFrame.test.tsx`, `AppFrame.stories.tsx`) — App layout shell with header, main content, and skip links.
2. **TopBar** (`TopBar.tsx`, `TopBar.test.tsx`, `TopBar.stories.tsx`) — Top navigation bar with project title, inbox counter badge, and slot actions.
3. **ProjectSwitcher** (`ProjectSwitcher.tsx`, `ProjectSwitcher.test.tsx`, `ProjectSwitcher.stories.tsx`) — Project selection trigger and popover dropdown.
4. **SideNav** (`SideNav.tsx`, `SideNav.test.tsx`, `SideNav.stories.tsx`) — Primary navigation with grouped sections, icons, and `aria-current="page"`.
5. **Card** (`Card.tsx`, `Card.test.tsx`, `Card.stories.tsx`) — Content container with header, body, footer, and interactive elevation tokens.
6. **ListRow** (`ListRow.tsx`, `ListRow.test.tsx`, `ListRow.stories.tsx`) — Dense row item for lists with leading icon/badge and trailing actions.
7. **EmptyState** (`EmptyState.tsx`, `EmptyState.test.tsx`, `EmptyState.stories.tsx`) — Zero-data placeholder with graphic/icon, title, description, and primary CTA.
8. **Banner** (`Banner.tsx`, `Banner.test.tsx`, `Banner.stories.tsx`) — Prominent feedback notification banner (info, success, warning, danger).
9. **Toast** (`Toast.tsx`, `Toast.test.tsx`, `Toast.stories.tsx`) — Transient toast notification element with status variants and dismiss trigger.
10. **Dialog** (`Dialog.tsx`, `Dialog.test.tsx`, `Dialog.stories.tsx`) — Modal confirmation dialog with focus trap, Esc handling, and scrim layer.
11. **Sheet** (`Sheet.tsx`, `Sheet.test.tsx`, `Sheet.stories.tsx`) — Slide-over side panel drawer with logical start/end positioning and focus trap.
12. **Menu** (`Menu.tsx`, `Menu.test.tsx`, `Menu.stories.tsx`) — Context menu popover with `role="menu"` and `role="menuitem"` navigation.
13. **Stepper** (`Stepper.tsx`, `Stepper.test.tsx`, `Stepper.stories.tsx`) — Multi-phase progress indicator supporting click handlers and active state styling.
14. **DecisionCard** (`DecisionCard.tsx`, `DecisionCard.test.tsx`, `DecisionCard.stories.tsx`) — User decision prompt card displaying question, rationale, consequences, and action buttons.
15. **Composer** (`Composer.tsx`, `Composer.test.tsx`, `Composer.stories.tsx`) — Message / prompt input area supporting Enter-to-send, Shift+Enter newline, and simple/advanced modes.
16. **ModelPicker** (`ModelPicker.tsx`, `ModelPicker.test.tsx`, `ModelPicker.stories.tsx`) — Dynamic data-driven model selector without hardcoded model strings.
17. **BudgetField** (`BudgetField.tsx`, `BudgetField.test.tsx`, `BudgetField.stories.tsx`) — Numeric budget limit input with isolated LTR currency prefix and preset pills.
18. **ActivityFeed** (`ActivityFeed.tsx`, `ActivityFeed.test.tsx`, `ActivityFeed.stories.tsx`) — Live activity stream with polite live region and stage-grouped events.
19. **PreviewCard** (`PreviewCard.tsx`, `PreviewCard.test.tsx`, `PreviewCard.stories.tsx`) — Media and artifact preview container with metadata chips.
20. **CodeView** (`CodeView.tsx`, `CodeView.test.tsx`, `CodeView.stories.tsx`) — Syntax-highlighted code display with line numbers, copy action, and LTR direction.
21. **DiffView** (`DiffView.tsx`, `DiffView.test.tsx`, `DiffView.stories.tsx`) — Unified diff viewer rendering additions, deletions, and line numbers.
22. **Transcript** (`Transcript.tsx`, `Transcript.test.tsx`, `Transcript.stories.tsx`) — Terminal stdout/stderr log stream viewer with line numbers and full copy action.
23. **DataTable** (`DataTable.tsx`, `DataTable.test.tsx`, `DataTable.stories.tsx`) — Tabular data grid with sortable columns (`aria-sort`) and action menu.
24. **SettingsSection** (`SettingsSection.tsx`, `SettingsSection.test.tsx`, `SettingsSection.stories.tsx`) — Settings layout card with title, description, and slot children.
25. **CopyField** (`CopyField.tsx`, `CopyField.test.tsx`, `CopyField.stories.tsx`) — Read-only value field with inline copy-to-clipboard button and success feedback.
26. **KeyValue** (`KeyValue.tsx`, `KeyValue.test.tsx`, `KeyValue.stories.tsx`) — Key-value pair display with optional copy action.
27. **QrCode** (`QrCode.tsx`, `QrCode.test.tsx`, `QrCode.stories.tsx`) — SVG QR code renderer and textual pairing string display.

## Measured Gate Results

| Gate | Check | Expected | Measured Result | Status |
| --- | --- | --- | --- | --- |
| `U1.1` | `pnpm --filter @warsha/ui test` | exit 0, tests >= base + 30 | 58 test files passed, 372 tests passed (base: 309, +63 new tests) | **PASS** |
| `U1.2` | `pnpm --filter @warsha/ui build-storybook && pnpm -r typecheck && pnpm --filter @warsha/ui lint` | exit 0 | Storybook built in 16.61s; typecheck passed across all 7 workspace packages; ESLint passed with 0 errors | **PASS** |
| `U1.3` | `node scripts/check-ds-v3.mjs packages/ui/src/v3` | exit 0 | `check-ds-v3: 0 violations in packages/ui/src/v3` | **PASS** |
| `U1.4` | Check existence of all 27 `.tsx`, `.test.tsx`, `.stories.tsx` | exit 0 | All 27 triads verified present | **PASS** |
| `U1.5` | `grep -nE "DeepSeek\|GPT-4o\|Claude 3\.5\|fleet-worktrees\|autonomous-factory" packages/ui/src/v3/composites/ModelPicker.tsx` | exit 1 | 0 matches found, exit code 1 | **PASS** |
| `U1.6` | `git diff --name-only $BASE..HEAD` scope check | exit 0 | `scope check passed: zero files outside allowed pattern` | **PASS** |
| `U1.deps` | Dependency change ratchet | exit 1 | 0 dependency additions or bumps across manifests, exit code 1 | **PASS** |
| `U1.snap` | `node "$EV/tools"/pw-gate.mjs snapshots $BASE HEAD -` | exit 0 | `snapshot_changes=0 outside=0` | **PASS** |
| `U1.pw` | Playwright E2E suite | Deferred | NOT run per brief instructions (capture host busy) | **DEFERRED** |

## Fixes Applied During Continuation (`77da2a0`)
During gate execution, the following issues were identified and resolved strictly within the permitted path scope (`packages/ui/src/v3/composites/**`):
- `CodeView.test.tsx`: Replaced unescaped quotes in JSX attribute string with JS expression `{...}` to resolve Vite/esbuild parse failure.
- `Transcript.test.tsx`: Passed newline string via JSX expression `{'...\n...'}` so simulated copy receives actual newlines matching test expectations.
- `Dialog.stories.tsx` & `Sheet.stories.tsx`: Supplied required `onClose: () => {}` prop in story metadata args.
- `SideNav.tsx` & `SideNav.test.tsx`: Broadened `SideNavItem.onClick` parameter type to `(event: React.MouseEvent<HTMLElement>) => void` to support event-handling callbacks and prevent mock type mismatch.
- `Stepper.tsx`: Used optional chaining `onStageClick?.(stage.key)` to resolve strict null check error.
- ESLint Cleanup: Fixed import order across 10 composite story/component files and removed unused imports/variables in `Composer.tsx`, `Dialog.test.tsx`, and `Toast.stories.tsx`.

## Seen But Left Alone
- `packages/ui/storybook-static/`: Storybook build output directory left untracked and excluded from git commits per project brief.

## Repair (F1-F4)

Independent review verdict REQUEST-CHANGES resolved with 4 commits (one commit per finding):

- **Head commit:** `1762caa972f1bca55721dc17ed8794125db61bc2`
- **Commits:**
  1. `52060f0` fix(ui): export v3 composites from package entry point (F1)
  2. `20e58df` fix(ui): replace yellow primary preset with sunken selection in BudgetField (F2)
  3. `9b22c47` fix(ui): remove attention variant from Card to reserve orange for DecisionCard (F3)
  4. `1762caa` fix(ui): make DataTable sort headers keyboard-operable (F4)

### Per-Finding Changes
- **F1 (blocking):** Added `export * from './composites';` to `packages/ui/src/v3/index.ts` so all 27 composites are exposed from `@warsha/ui/v3` public entry point while keeping existing token/icon/primitive exports intact.
- **F2 (blocking):** Updated `BudgetField.tsx` to eliminate yellow `primary` preset styling. Selected preset now renders with token-compliant `sunken` background (`var(--w-sunken)`), `primary-text` (`var(--w-primary-text)`), and primary-text border accent. Updated `BudgetField.test.tsx` to assert `data-selected="true"`, `data-variant="secondary"`, and `not.toHaveAttribute('data-variant', 'primary')`.
- **F3 (minor):** Removed `attention` variant from `Card.tsx` (`CardVariant = 'default' | 'sunken'`), preserving the DS v3 invariant that DecisionCard is the only orange card. Replaced `Attention` story with `Sunken` story in `Card.stories.tsx`.
- **F4 (minor):** Made `DataTable` sortable column headers keyboard-accessible by adding `tabIndex={0}` and an `onKeyDown` handler (Enter / Space activating sort) on `<th scope="col" aria-sort={...}>`. Added a test in `DataTable.test.tsx` verifying keyboard navigation and activation.

### Measured Results
- `pnpm --filter @warsha/ui test`: **PASS** (exit 0) — 58 test files passed, 373 tests passed.
- `node scripts/check-ds-v3.mjs packages/ui/src/v3`: **PASS** (exit 0) — 0 violations.
- `pnpm -r typecheck`: **PASS** (exit 0) — all 7 workspace packages typecheck cleanly.
- Scope: `git diff --name-only 128b59c..HEAD` touches only `packages/ui/src/v3/composites/**` and `packages/ui/src/v3/index.ts`.

