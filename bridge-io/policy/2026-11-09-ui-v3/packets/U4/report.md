# Packet U4 Report — Advanced Workbench (`apps/desktop/src/v3/pages/bench/**`)

- Run: `2026-11-09-ui-v3`
- Packet: `U4` (`workbench`)
- Role: Implementer
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/u4`
- Branch: `run/2026-11-09-ui-v3/u4-workbench`
- Base commit: `6025715d881f80454286e35ed803d08f801a8c6c`
- Head commit: `4300d93f5dff2ea791b2056a7451cddf2c878e9a`

## Commits

1. `0f5d12c` `feat(bench): register 31 action ids for Advanced Workbench`
2. `2880460` `feat(i18n): add v3 Arabic and English catalogs for Advanced Workbench`
3. `7227d74` `feat(bench): implement Advanced Workbench page, 10 tabs, rail, header, 14-stage strip, real assistant, and advanced composer`
4. `2449b07` `test(bench): add 35 unit tests for Advanced Workbench components, tabs, assistant wiring, and amendments`
5. `8420fae` `fix(bench): ensure dialog action buttons, TextArea labels, and aria-controls pass a11y and actions-gate`
6. `47c3c48` `style(bench): add focus-visible ring and token stylesheet import for v3 workbench`
7. `4300d93` `test(e2e): add v3 Advanced Workbench journeys, 31 action contracts, a11y, and visual specs`

## Changes by Step

1. **Step 1 — Actions Registry (`0f5d12c`):**
   - Registered all 31 action ids in `apps/desktop/src/v3/actions/registry/bench.ts` matching UI_V3_PLAN §3.6:
     `bench.project.new`, `bench.run.select`, `bench.run.start`, `bench.run.advance`, `bench.run.cancel.open`, `bench.run.cancel.confirm`, `bench.tab.select`, `bench.gate.approve`, `bench.gate.changes.send`, `bench.gate.reject.confirm`, `bench.files.expand`, `bench.files.open`, `bench.code.copy`, `bench.handoff.create`, `bench.handoff.apply`, `bench.terminal.follow`, `bench.terminal.copy`, `bench.team.model.set`, `bench.assistant.send`, `bench.assistant.mode.plan`, `bench.assistant.mode.agent`, `bench.budget.save`, `bench.artifact.open`, `bench.artifact.copy-path`, `bench.preview.start`, `bench.preview.stop`, `bench.preview.open`, `bench.followup.send`, `bench.harness.select`, `bench.runmode.set`, `bench.stream.reconnect`.
   - Wired capabilities for optional features (`runs.resume`, `preview`, `harnesses`).

2. **Step 2 — i18n Catalogs (`2880460`):**
   - Implemented `packages/i18n/src/v3/ar/bench.ts` and `packages/i18n/src/v3/en/bench.ts` with 1:1 key parity (86 keys each).
   - Zero Latin words in Arabic catalog (allow-list and `{placeholder}` compliant); zero Arabic characters in English catalog.
   - Handled all actions, rail, header, 14 stages, 12 roles, 10 tabs, DecisionCard prompts, and dialogs.

3. **Step 3 — Workbench Architecture & Ten Tabs (`7227d74`):**
   - `BenchRail`: collapsible/wrapping rail with new project action, projects list, runs list with StatusPills, and error retry.
   - `BenchHeader`: project name, run id in mono bdi, status pill, 5-stage category tag, current-stage gate waiting pill, advance, new run, cancel with confirmation dialog, stream reconnect.
   - `StageStrip`: all 14 daemon stages (`idea` through `feedback`) in visual order with done, current, waiting, failed, and todo states.
   - `BenchTabs`: line-style tabs with roving tabIndex and RTL-safe keyboard navigation (`ArrowRight`, `ArrowLeft`, `Home`, `End`, `Enter`, `Space`).
   - `BenchDecisionCard`: single yellow primary button for `bench.gate.approve`; request-changes and reject hidden behind capability flag OFF per Amendment (a).
   - The Ten Tabs:
     1. Overview: DecisionCard (when waiting at current stage), ActivityFeed, artifacts count summary.
     2. Plan: plan/spec markdown artifacts, honest empty state when none.
     3. Files: lazy directory tree with `client.getFilesTree`, CodeView via `client.readFileContent`, and code copy.
     4. Changes: DiffView for diff artifacts, handoff create/apply with bundle path input and feedback banners.
     5. Terminal: read-only Transcript of tool calls, agent steps, and errors; stream follow toggle; copy log.
     6. Team: 12 roles table with live metrics, tokens, cost, and inline model routing via `roles.set`.
     7. Assistant: real conversation on `agent.state`, `agent.plan_mode`, `agent.approve_mode`, and `agent.turn` (Plan <-> Agent mode with owner click as approval; zero fake replies).
     8. Cost: budget meter, spent vs total, remaining, save budget via `budget.set`, role and stage cost breakdowns.
     9. Artifacts: versioned artifact cards, open in Sheet, copy path.
     10. Preview: dev preview status, start, stop, open URL in browser.
   - `AdvancedComposer`: textarea -> `runs.followup`, workflow select -> `harness.select`, run mode select -> `runmode.set`, budget field -> `budget.set`. Zero fake tier/permission/slash/mention controls.
   - Sets `data-ready="true"` on `main` when primary data settles.

4. **Step 4 — Unit Tests (`2449b07`):**
   - Created `apps/desktop/src/v3/pages/bench/bench.test.tsx` containing 35 comprehensive unit tests.
   - Verified components, tabs, DecisionCard, assistant Plan <-> Agent transitions, and all three amendments.

5. **Step 5 — a11y, actions-gate & focus styling (`8420fae`, `47c3c48`):**
   - Relocated dialog action buttons out of JSX prop expressions into children to ensure full detection by `actions-gate.mjs`.
   - Added accessible labels to all TextAreas for WCAG 2.1 AA compliance.
   - Created `apps/desktop/src/v3/pages/bench/bench.css` declaring `:focus-visible` ring using DS v3 tokens (`var(--w-border-width-strong)` and `var(--w-focus)`).
   - Imported `@warsha/ui/v3/tokens/tokens.css` into `bench/index.tsx` for token styling in v3.

6. **Step 6 — e2e Spec (`4300d93`):**
   - Built `apps/desktop/e2e/v3/bench.spec.ts` covering:
     - Journeys: full workbench mounting, Amendment (a) capability flag OFF, Amendment (b) current-stage gate filtering, Amendment (c) honest empty states, read-only terminal, and real assistant Plan <-> Agent conversation.
     - Action contracts: one dedicated test for each of the 31 registered action IDs, asserting RPC calls, URL transitions, or DOM state.
     - `@a11y` tests across ar/en x light/dark asserting zero axe AA violations and clean focus walk.
     - `@visual` tests across all 10 tabs and states x 1280x800 and 390x844 x ar/en x light/dark with layout/clipping assertions (zero PNGs committed).

## Decisions & Alternatives Rejected

1. **Gate review capability flag (Amendment a)**:
   - Decision: Hid request-changes and reject behind `hasGateResumeCapability` (checking `capabilities['runs.resume']` or window flag), defaulting to OFF.
   - Alternative rejected: Rendering disabled buttons or leaving run-ending controls accessible before KEEL K1+K2 ship.

2. **Single yellow primary rule (DS v3 §2.1)**:
   - Decision: `BenchDecisionCard`'s Approve button is the view's single `primary` yellow button; composer send and all other buttons use `secondary` or `ghost`.
   - Alternative rejected: Making the composer submit primary on the workbench, which would create competing yellow primary buttons when a gate awaits approval.

3. **No fake replies or data (UI_V3_PLAN §0, Amendment c)**:
   - Decision: `AssistantTab` communicates exclusively through `agent.turn`, `agent.plan_mode`, `agent.approve_mode`, and `agent.state`, displaying real error states when calls fail; diff, files, and preview render honest empty/stopped states when no data exists.
   - Alternative rejected: Mocking canned chat responses or generating synthetic diffs/previews in the UI.

4. **Action buttons in Dialogs**:
   - Decision: Placed dialog action buttons inside `children` rather than `actions={<>...</>}` prop.
   - Alternative rejected: Leaving action buttons in prop expressions, which `actions-gate.mjs`'s JSX attribute depth scanner skips as non-interactive prop attributes.

## Measured Unit Counts & Gate Checks

- `U4.1`: `pnpm --filter warsha-desktop test` -> PASS (80 test files, 625 passed; base was 590, +35 new bench tests, required >= 620).
- `U4.2`: `pnpm -r typecheck && pnpm --filter warsha-desktop lint && node scripts/check-ds-v3.mjs apps/desktop/src/v3` -> PASS (all exit 0, 0 violations).
- `U4.3`: `node "$EV/tools"/i18n-gate.mjs .` -> PASS (221 keys, 0 violations).
- `U4.4`: `node "$EV/tools"/actions-gate.mjs . --only bench.` -> PASS (31 registered, 31 used, 0 violations).
- `U4.5`: File existence check -> PASS (exit 0).
- `U4.7`: Scope check against `6025715..HEAD` -> PASS (exit 0, all 25 files inside allowed directories).
- `U4.deps`: Dependency check -> PASS (exit 1, zero dependencies added or bumped).
- `U4.snap`: Snapshot check -> PASS (zero snapshot PNGs committed).

## Blockers

BLOCKER (out-of-scope): None
