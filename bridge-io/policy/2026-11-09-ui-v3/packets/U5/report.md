# Packet U5 Report — Settings (`run/2026-11-09-ui-v3/u5-settings`)

- Run: `2026-11-09-ui-v3`
- Packet: `U5` (`u5-settings`)
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/u5`
- Branch: `run/2026-11-09-ui-v3/u5-settings`
- Base commit: `6025715d881f80454286e35ed803d08f801a8c6c`
- Slice 1 head commit: `af7cd1664164e6e33da5346a470a89720d7b9d55`

---

## Settings Slice 1 — SideNav + First 4 Primary Sections

- Role: Implementer (Settings Slice 1 continuation)
- Built sections (4 of 12):
  1. `general` (عام) — Language (`ar`/`en`), Theme (`light`/`dark`/`system`), Default mode (`simple`/`advanced`), Default budget (`preferences.record`)
  2. `models` (النماذج والمزوّدون) — Providers (`providers.list`, `providers.add`, `providers.test`, `providers.check_models`, `providers.remove`), Custom models (`models.list`, `models.add`, `models.remove`), 12-role routing table (`roles.list`, `roles.set`)
  3. `devices` (الأجهزة) — Paired devices ledger (`devices.list`), QR pairing dialog (`devices.pair-start`), Revoke confirmation dialog (`devices.revoke`)
  4. `about` (حول ورشة) — Daemon status/version (`health`), Data directory (`get_config('data_dir')`), Refresh & Copy info
- Navigation shell: `SettingsNav` (SideNav) shows the 4 primary sections + «إعدادات متقدّمة» disclosure toggle in Simple mode (`settings.advanced.toggle`), and all 12 nav items in Advanced mode (`settings.nav.open`).
- Remaining 8 sections for Slice 2:
  `workflows`, `skills`, `plugins`, `integrations`, `routines`, `budgets`, `postlaunch`, `backend`.

### Commits (Slice 1)

1. `5e5b88f` `feat(i18n): add comprehensive v3 settings catalogs for ar and en`
2. `1a2cc31` `feat(settings): register all v3 settings actions and daemon RPC bindings`
3. `d6cb4fa` `feat(settings): implement SideNav shell and primary settings sections`
4. `184339b` `fix(settings): scope slice-1 actions registry and shell layout`
5. `39ddbb8` `fix(settings): stabilize preferences effect and retry banner in GeneralSection`
6. `060713e` `fix(settings): use standalone action tags and stable load deps in ModelsSection`
7. `e7d8e22` `fix(settings): use standalone action tags in DevicesSection`
8. `eaff0e1` `fix(settings): expose standalone toolbar actions and feedback in AboutSection`
9. `07b3a50` `test(settings): add unit tests for SideNav and slice-1 settings sections`
10. `7b77069` `fix(settings): use exact Capabilities shape in Settings unit tests`
11. `af7cd16` `test(e2e): add v3 Settings slice-1 spec for journeys, actions, a11y, and visual`

### Decisions

- **Scoped `actions/registry/settings.ts` to the 23 Slice-1 action ids:** `actions-gate.mjs` checks A4/A6 against every `settings.*` id in `actions/registry/settings.ts`; keeping only the 23 ids belonging to SideNav and the 4 built sections (`general`, `models`, `devices`, `about`) avoids unbuilt-section violations while keeping full i18n keys ready for Slice 2 (alternative rejected: leaving all 54 action ids registered before the remaining 8 sections exist).
- **Removed partial untracked Slice-2 section drafts (`WorkflowsSection`, `SkillsSection`, `PluginsSection`, `IntegrationsSection`, `RoutinesSection`) from the worktree:** Leftover uncommitted drafts from the interrupted session belonged to the 8 remaining sections and caused A4/A6 failures in Slice 1 (alternative rejected: keeping incomplete Slice-2 files outside Slice-1 scope).
- **Rendered multi-button action bars and Dialog footers as standalone child JSX tags instead of `actions={...}` / `action={...}` prop attributes:** `actions-gate.mjs`'s `jsxTags` parser treats JSX inside an opening tag's attribute block as part of the outer tag and extracts only the first `data-action`; rendering buttons as sibling children in `.v3-settings-row`, `.v3-settings-dialog-actions`, `.v3-settings-section-actions`, and `<Banner>` children lets `actions-gate.mjs` detect all 23 action ids individually (alternative rejected: modifying `actions-gate.mjs` or `@warsha/ui/v3` composites, both outside allowed files).
- **Rendered `PendingAdvancedSection` in `index.tsx` for the 8 unbuilt advanced routes:** Selecting one of the 8 remaining sections in the expanded nav displays its localized `SettingsSection` title/description/scope with `main[data-ready="true"]` and zero dead controls (alternative rejected: redirecting back to `general`).
- **API key security and destructive confirmations:** Provider API key input uses `type="password"` with `autoComplete="off"`, is cleared on save/close, and never appears in logs, URLs, or snapshots; destructive actions (`provider.remove`, `model.remove`, `device.revoke`) all require explicit confirmation through a `Dialog`.
- **Stabilized `GeneralSection` and `ModelsSection` fetch effects:** Removed `t` and `modelProvider` from fetch `useCallback`/`useEffect` dependencies so changing UI language or selecting a custom-model provider does not re-trigger daemon fetches or discard role drafts (alternative rejected: keeping `t` and `modelProvider` in effect dependencies).

### Measured Checks & Unit Counts

- `pnpm -r typecheck`: exit `0`
- `node scripts/check-ds-v3.mjs apps/desktop/src/v3`: exit `0` (`0 violations`)
- `node "$EV/tools/i18n-gate.mjs" .`: exit `0` (`299 keys, 0 violations`)
- `node "$EV/tools/actions-gate.mjs" . --only settings.`: exit `0` (`23 registered, 23 used, 0 violations`)
- `pnpm --filter warsha-desktop lint`: exit `0`
- `pnpm --filter warsha-desktop test`: exit `0` (`80 passed (80)`, `Tests 599 passed (599)`, +9 new tests in `Settings.test.tsx`; base `468 + 30 = 498`)
- `U5.7` scope check (`git diff --name-only 6025715d881f80454286e35ed803d08f801a8c6c..HEAD`): exit `0`
- `U5.deps` check: exit `1` (expected: no dependency added or bumped)
- `U5.snap` check: exit `0` (`snapshot_changes=0 outside=0`)
- Playwright (`U5.6`, `U5.pw`): not run in this session (per prompt: `No Playwright`).

### Seen But Left Alone

- Multi-button JSX passed via props (`Dialog.actions`, `ListRow.actions`, `SettingsSection.action`, `Banner.action`) is flattened by `actions-gate.mjs`'s `jsxTags()` to only the first `data-action`; handled locally in `pages/settings/` without editing `packages/ui/src/v3` or gate tools.

---

## Settings Slice 2 — Remaining 8 Advanced Sections & Full U5 Completion

- Role: Implementer (Continuation session)
- Base commit (Slice 2 start): `af7cd1664164e6e33da5346a470a89720d7b9d55`
- Final head commit: `ad58a66b42e789de97dbb07f574d177dbf22fafc`
- Built sections (all 12 of 12 complete):
  1. `general` (عام) — Done (Slice 1)
  2. `models` (النماذج والمزوّدون) — Done (Slice 1)
  3. `devices` (الأجهزة) — Done (Slice 1)
  4. `about` (حول ورشة) — Done (Slice 1)
  5. `workflows` (سير العمل) — `WorkflowsSection.tsx`: import JSON (`harness.import`), select default (`harness.select`), view details Dialog (`harness.get`), delete confirmation Dialog (`harness.delete`)
  6. `skills` (المهارات) — `SkillsSection.tsx`: import (`skills.import`), enable/disable switch (`skills.toggle`), delete confirmation Dialog (`skills.delete`)
  7. `plugins` (الإضافات وخوادم MCP) — `PluginsSection.tsx`: install manifest (`plugins.install`), enable/disable switch (`plugins.toggle`), env config Dialog with `type="password"` inputs (`plugins.configure`), remove confirmation Dialog (`plugins.remove`)
  8. `integrations` (التكاملات) — `IntegrationsSection.tsx`: connect Dialog with `type="password"` token fields (`integrations.connect`), live test (`integrations.test`), disconnect confirmation Dialog (`integrations.disconnect`)
  9. `routines` (المهام المجدولة) — `RoutinesSection.tsx`: list, run now (`routines.run_now`), pause (`routines.pause`), resume (`routines.resume`), view details Dialog (`routines.get`)
  10. `budgets` (الميزانيات) — `BudgetsSection.tsx`: per-project spending status (`budget.show`) and limit save (`budget.set`)
  11. `postlaunch` (ما بعد الإطلاق) — `PostLaunchSection.tsx`: crash reports filter (`postlaunch.crashes`), copy crash details, store reviews filter (`postlaunch.reviews`)
  12. `backend` (الواجهة الخلفية) — `BackendSection.tsx`: per-run backend kit (`backend.get`), kind selector and feature toggles (`backend.set`), kit export (`backend.export`)
- What remains: None in code/tests/unit gates; only capture-host Playwright execution (`U5.6` and `U5.pw`, per prompt: `No Playwright`).

### Commits (Slice 2, one per section)

12. `e2274ea` `feat(settings): implement and wire WorkflowsSection`
13. `da5290f` `feat(settings): implement and wire SkillsSection`
14. `735337d` `feat(settings): implement and wire PluginsSection`
15. `22f01ef` `feat(settings): implement and wire IntegrationsSection`
16. `74cbaf1` `feat(settings): implement and wire RoutinesSection`
17. `6abf4c2` `feat(settings): implement and wire BudgetsSection`
18. `b909686` `feat(settings): implement and wire PostLaunchSection`
19. `ad58a66` `feat(settings): implement and wire BackendSection`

### Decisions (Slice 2)

- **Replaced `Badge label=...`, `ListRow`, `Dialog actions`, `Banner action`, and un-actioned inner modal buttons with DS-v3-compliant children and `.v3-settings-row` / `.v3-settings-dialog-actions`:** Fixes the `WorkflowsSection` type error (`Badge` uses `children`), preserves mobile `390x844` wrapping, and keeps all 54 `settings.*` action ids individually parsable by `actions-gate.mjs` (alternative rejected: modifying `@warsha/ui/v3` or gate scripts).
- **Rendered existing plugin env entries as `type="password"` `TextField` rows inside `PluginsSection`'s configure Dialog instead of un-registered row-delete buttons:** Prevents `actions-gate` A1 violations and protects secret references while allowing full env editing (alternative rejected: adding unregistered buttons or inventing non-plan action ids).
- **Removed `PendingAdvancedSection` from `index.tsx` once all 12 sections landed:** Every route `/settings/:section` now renders its full daemon-backed section directly (alternative rejected: keeping dead placeholder fallback).
- **Added full e2e coverage in `apps/desktop/e2e/v3/settings.spec.ts`:** Covers journeys for all 12 sections, one test per registered action id (`54/54`), `@a11y` axe + Tab focus walk across all 12 sections in `ar/en x light/dark`, and `@visual` baselines per section/state across `1280x800` and `390x844` in `ar/en x light/dark` (zero PNGs committed).

### Measured Checks & Unit Counts (Final Head `ad58a66`)

- `pnpm -r typecheck`: exit `0`
- `node scripts/check-ds-v3.mjs apps/desktop/src/v3`: exit `0` (`0 violations in apps/desktop/src/v3`)
- `node "$EV/tools/i18n-gate.mjs" .`: exit `0` (`299 keys, 0 violations`)
- `node "$EV/tools/actions-gate.mjs" . --only settings.`: exit `0` (`54 registered, 54 used, 0 violations`)
- `pnpm --filter warsha-desktop lint`: exit `0`
- `pnpm --filter warsha-desktop test`: exit `0` (`Test Files 80 passed (80)`, `Tests 607 passed (607)`, including 17 tests in `Settings.test.tsx`; base `468 + 30 = 498`)
- `U5.5` structure check: exit `0`
- `U5.7` scope check (`git diff --name-only 6025715d881f80454286e35ed803d08f801a8c6c..HEAD`): exit `0`
- `U5.deps` check: exit `1` (expected: 0 dependencies added/bumped)
- `U5.snap` check: exit `0` (`snapshot_changes=0 outside=0`)
- Playwright (`U5.6`, `U5.pw`): not run in this session (per prompt: `No Playwright`).

---

## Settings Repair (`run/2026-11-09-ui-v3/u5-settings`)

- Repair base commit: `ad58a66`
- Repair head commit: `7d4ceb9`

### Root Cause Analysis (`EV/gates/U5.6.json`)

1. **Zero RPCs fired (`Observed calls: []`) in `U5.6.json`:**
   - Walking `EV/gates/U5.6.json` identified 59 failures: 57 behavioural/action failures (`expectRpc timed out ... Observed calls: []` on `preferences.record`, `providers.add`, `models.add`, `devices.pair-start`, `health`, `harness.import`, `skills.import`, `plugins.install`, `integrations.connect`, `postlaunch.crashes`, `postlaunch.reviews`, plus dependent `locator.click`/`fill` timeouts and `settings.error.retry`), and 2 `@a11y` failures (`ar, light` and `en, light` on `general`).
   - All 76 methods in `crates/warshad/src/lib.rs` (including every settings read/mutation method) were **already** stubbed in `apps/desktop/e2e/harness.ts` (`RPC_METHODS` and `rpcResult`), with `check-wire-contract.mjs` at 10 checks / 0 violations. Therefore **0 new stub rows** were added to `harness.ts` (adding non-daemon entries would violate W2).
   - The real cause of `Observed calls: []` was in `apps/desktop/src/v3/app/ClientContext.tsx:23`, which calls `readDaemonEndpoint(invoke)` (invoking `daemon_url`, `daemon_ws_url`, `daemon_token` directly instead of `get_config`), combined with `apps/desktop/e2e/v3/support/index.ts` rejecting any `invoke` command other than `get_config` / `set_config`. Consequently, `ClientProvider` failed to resolve a client and left `useClient()` as `null` across all settings sections.
   - **Fix (`apps/desktop/e2e/v3/support/index.ts`):** Updated `openV3`'s Tauri `invoke` stub to resolve `merged[command]` when `command in merged` (`daemon_url`, `daemon_ws_url`, `daemon_token`, etc.) and await `page.waitForLoadState('networkidle')` + `main[data-ready="true"]` so the client resolves and initial RPCs settle before test assertions begin. *(Note: `apps/desktop/src/v3/app/ClientContext.tsx` itself is outside U5 scope and still calls `readDaemonEndpoint(invoke)` in production Tauri builds.)*
2. **`@a11y` color-contrast failure (`general`, `ar/en` light mode):**
   - `packages/ui/src/v3/composites/SettingsSection.tsx` renders the section `scope` pill with `color: var(--w-text-faint)` (`#7A756B`) on `backgroundColor: var(--w-sunken)` (`#EFECE5`), yielding 3.88:1 contrast (< 4.5:1 WCAG AA) in Light theme.
   - **Fix (`settings.css` + all 12 section files):** Added `.v3-settings-scope { color: var(--w-text-muted); }` (`#5F5B53` on `#EFECE5` = 5.73:1) and wrapped `scope` in `<span className="v3-settings-scope">` across all 12 settings sections (`GeneralSection`, `ModelsSection`, `DevicesSection`, `AboutSection`, `WorkflowsSection`, `SkillsSection`, `PluginsSection`, `IntegrationsSection`, `RoutinesSection`, `BudgetsSection`, `PostLaunchSection`, `BackendSection`).

### Stub Methods Added

- None added to `apps/desktop/e2e/harness.ts`: all 76 daemon RPC methods (including all 48 settings read/mutation methods) were already present in `RPC_METHODS` and `rpcResult` (`check-wire-contract.mjs`: 10 checks, 0 violations).

### Unit Tests Added (`Settings.test.tsx`: +19 tests, 17 -> 36; total 607 -> 626)

1. `validates budget input in GeneralSection and refuses zero or non-numeric values`
2. `validates provider form in ModelsSection and refuses empty name or key`
3. `validates custom model form in ModelsSection and refuses empty model ID`
4. `renders EmptyState in ModelsSection when provider list is empty`
5. `handles provider test failure in ModelsSection`
6. `renders error banner and retries in DevicesSection when listDevices fails`
7. `displays loopback warning in DevicesSection QR pairing dialog`
8. `validates workflow import in WorkflowsSection and refuses empty content`
9. `renders EmptyState in WorkflowsSection when harnesses list is empty`
10. `validates skill import in SkillsSection and refuses empty content`
11. `renders EmptyState in SkillsSection when skills list is empty`
12. `validates plugin install in PluginsSection and refuses empty manifest`
13. `renders EmptyState in PluginsSection when plugins list is empty`
14. `validates integration connect in IntegrationsSection and refuses empty id`
15. `renders EmptyState in IntegrationsSection when integrations list is empty`
16. `renders EmptyState in RoutinesSection when routines list is empty`
17. `renders EmptyState in BudgetsSection when projects list is empty`
18. `renders EmptyState in PostLaunchSection when crashes list is empty`
19. `renders EmptyState in BackendSection when runs list is empty`

### Commits (Repair)

- `41088e7` `fix(e2e): support daemon config key queries in openV3 invoke stub`
- `985907f` `fix(settings): ensure accessible color contrast for section scope badge`
- `7d4ceb9` `test(settings): add 19 discriminating unit tests for settings sections and actions`

### Self-Check Summary (Head `7d4ceb9`)

- `pnpm --filter warsha-desktop test`: exit `0` (`Test Files 80 passed (80)`, `Tests 626 passed (626)`)
- `pnpm exec playwright test --project=desktop v3/settings.spec.ts --grep-invert @visual --reporter=line`: exit `0` (`71 passed (1.1m)` — 13 journeys + 54 action tests + 4 `@a11y` tests across all 12 sections in `ar/en` x `light/dark`)
- `node scripts/check-wire-contract.mjs`: exit `0` (`wire: 10 checks, 0 violations`)
- `node scripts/check-ds-v3.mjs apps/desktop/src/v3`: exit `0` (`0 violations`)
- `actions-gate --only settings.`: exit `0` (`actions: 54 registered, 54 used, 0 violations`)
- `i18n-gate`: exit `0` (`i18n-v3: 299 keys, 0 violations`)
- `pnpm -r typecheck` & `pnpm --filter warsha-desktop lint`: exit `0`
- `U5.snap` check: exit `0` (`snapshot_changes=0 outside=0`)
- `U5.deps` check: exit `1` (expected: 0 dependencies added/bumped)

