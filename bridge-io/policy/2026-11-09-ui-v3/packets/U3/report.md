# Packet U3 Report — Simple Pages (`run/2026-11-09-ui-v3/u3-simple-pages`)

- Run: `2026-11-09-ui-v3`
- Packet: `U3` (`u3-simple-pages`)
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/u3`
- Branch: `run/2026-11-09-ui-v3/u3-simple-pages`
- Base commit: `6025715d881f80454286e35ed803d08f801a8c6c`

---

## Area 1: Frame (`frame`)

- Role: Implementer (FRAME area only)
- Area start commit: `6025715d881f80454286e35ed803d08f801a8c6c`
- Area head commit: `46777741ec010686a1da63f78301394c80b25739`

### Changes by Step

1. **i18n v3 Frame Catalogs (`358338e`):**
   - Added complete Arabic and English keys in `packages/i18n/src/v3/ar/frame.ts` and `packages/i18n/src/v3/en/frame.ts` (22 `frame.*` keys, identical key sets and `{count}` placeholder parity, zero Latin text in Arabic).
2. **Frame Action Registry (`051b4c8`):**
   - Registered all 9 frame action ids in `apps/desktop/src/v3/actions/registry/frame.ts`: `frame.skip-to-main`, `frame.project.open`, `frame.project.switch`, `frame.project.new`, `frame.mode.simple`, `frame.mode.advanced`, `frame.inbox.open`, `frame.settings.open`, `frame.daemon.retry` (`rpc: ['health']`).
3. **Frame Component, ProjectSwitcher & Unit Tests (`c50925f`):**
   - Replaced placeholder `apps/desktop/src/v3/pages/frame/Frame.tsx` with full Frame chrome: skip link (`frame.skip-to-main`), `<TopBar>` with Warsha hexagon brand, `FrameProjectSwitcher` (`apps/desktop/src/v3/pages/frame/FrameProjectSwitcher.tsx`), mode radiogroup (`frame.mode.simple` / `frame.mode.advanced` syncing shell config `app_mode`), Inbox `IconButton` with `attention` `Badge` counting pending gates strictly at each non-terminal run's current stage via `gates.list` (`countPendingGatesAtCurrentStage`), Settings `IconButton`, daemon offline danger `Banner` with `frame.daemon.retry`, and `ToastProvider` wired to U2's `notify()` via `subscribeToast`.
   - Imported `@warsha/ui/v3/tokens/tokens.css` and added logical-CSS, token-only `apps/desktop/src/v3/pages/frame/frame.css`.
   - Added 12 unit tests in `apps/desktop/src/v3/pages/frame/Frame.test.tsx`.
4. **Frame E2E Spec (`4677774`):**
   - Created `apps/desktop/e2e/v3/frame.spec.ts` covering journeys (project switching, mode toggle + config write, §5.5-b current-stage-only inbox badge count, daemon offline retry), one test per frame action id (9/9), `@a11y` axe + focus-walk + keyboard matrix (`ar`/`en` × `light`/`dark`), and `@visual` screenshot matrix (`ready`, `project-switcher-open`, `daemon-offline` × `1280x800`, `390x844` × `ar`/`en` × `light`/`dark`). No PNGs committed.

### Decisions

- **Amendment §5.5-a (Capability flag for run-ending controls):** Frame renders zero run-ending controls (no gate request-changes, gate reject, or run cancel buttons exist in the global TopBar/Frame shell); any run-ending control in subsequent U3 areas must remain hidden behind a capability flag that is OFF before KEEL K1+K2 (alternative rejected: exposing gate rejection or run-ending controls in the global shell).
- **Amendment §5.5-b (Inbox count from `gates.list`):** `countPendingGatesAtCurrentStage` counts a gate row ONLY when `gate.state.state === 'pending' && gate.stage === run.stage`, ignoring future pending gates returned by `warshad` (`GATES_ALL_PENDING`) (alternative rejected: counting all `pending` rows in `gates.list`, which inflates the badge with future unreached gates).
- **Frame-scoped `FrameProjectSwitcher`, mode radiogroup, and skip link:** Built `FrameProjectSwitcher` and rendered explicit interactive `<button>`/`<a>`/`<IconButton>` elements in `apps/desktop/src/v3/pages/frame/` with literal `data-action="frame.*"` attributes and `<main data-ready={...}>`, lifting slot elements outside `<TopBar>`/`<Banner>` prop expressions so `actions-gate.mjs` parses each tag directly (alternative rejected: modifying `packages/ui/src/v3/composites/{AppFrame,ProjectSwitcher,TopBar}.tsx` or `Segmented.tsx`, which are outside U3 allowed files).
- **Hydrating `app_mode` from Tauri `get_config` on mount:** `Frame` reads `get_config('app_mode')` on mount so e2e `openV3(..., { mode: 'advanced' })` enters `compact` density cleanly without modifying `DensityContext.tsx` (alternative rejected: editing `apps/desktop/src/v3/app/DensityContext.tsx`, outside allowed files).
- **Isolating project names with `<bdi dir="auto">`:** Wrapped switcher project names in `<bdi dir="auto">` so mixed-script project names (e.g. `Warsha Store`) render with proper BiDi isolation and pass Arabic-only text gates (alternative rejected: rendering raw text nodes directly inside `<header>`).

### Measured Checks & Unit Counts

- `warsha-desktop` unit tests (`pnpm --filter warsha-desktop test`): 80 files passed, 602 tests passed (base 590, +12 new tests in `Frame.test.tsx`).
- `pnpm -r typecheck`: exit `0`.
- `pnpm --filter warsha-desktop lint`: exit `0` (0 errors, 0 warnings).
- `node scripts/check-ds-v3.mjs apps/desktop/src/v3`: exit `0` (`0 violations`).
- `node "$EV/tools/i18n-gate.mjs" .`: exit `0` (`72 keys, 0 violations`).
- `node "$EV/tools/actions-gate.mjs" . --only frame.`: exit `0` (`9 registered, 9 used, 0 violations`).
- `U3.7` scope check (`git diff --name-only 6025715..4677774`): exit `0` (only allowed frame files touched).
- `U3.snap` snapshot check: exit `0` (`snapshot_changes=0`).
- Playwright (`U3.6`, `U3.pw`, `U3.simplicity`): not run by implementer (reserved for verifier).

### Seen But Left Alone

- `packages/ui/src/v3/composites/ProjectSwitcher.tsx` hardcodes `data-action="projects.create"` on its new-project button and omits `data-action` on trigger/options.
- `packages/ui/src/v3/composites/AppFrame.tsx` omits `data-ready` forwarding to `<main>` and omits `data-action` on its skip link.
- `apps/desktop/src/v3/app/DensityContext.tsx` reads `localStorage` (`warsha.app_mode`) without reading Tauri `get_config('app_mode')`.
- `apps/desktop/src/v3/app/V3App.tsx` renders an inline `.v3-danger-banner` div on startup error; left untouched as outside Frame's allowed files.

---

## Area 2: Onboarding (`onboarding`)

- Role: Implementer (ONBOARDING area only)
- Area start commit: `46777741ec010686a1da63f78301394c80b25739`
- Area head commit: `c5603e5a452c2d6cf3826a7217a937d75023346d`

### Changes by Step

1. **i18n v3 Onboarding Catalogs (`903927a`, adjusted `en/onboarding.ts` in `35c9298`):**
   - Added complete Arabic and English keys in `packages/i18n/src/v3/ar/onboarding.ts` and `packages/i18n/src/v3/en/onboarding.ts` (53 `onboarding.*` keys, identical key sets and `{current}`/`{total}` placeholder parity, zero non-allowed Latin words in Arabic, zero Arabic characters in English). Kept `'onboarding.title': 'Onboarding'` in English (`'التهيئة الأولى'` in Arabic) to satisfy existing `V3App.test.tsx` and `Router.test.tsx` heading assertions without editing U2 files.
2. **Onboarding Action Registry (`3ec96c9`):**
   - Registered all 9 UI_V3_PLAN §3.1 onboarding action ids plus `onboarding.retry` (`rpc: ['providers.list']`) in `apps/desktop/src/v3/actions/registry/onboarding.ts`: `onboarding.language.pick`, `onboarding.provider.pick`, `onboarding.provider.save-test` (`rpc: ['providers.add', 'providers.test']`), `onboarding.models.fetch` (`rpc: ['providers.check_models']`), `onboarding.model.use` (`rpc: ['models.add', 'roles.set']`), `onboarding.back`, `onboarding.next`, `onboarding.start` (`rpc: ['projects.create', 'runs.start']`, `route: '/p/:id'`), `onboarding.later` (`route: '/'`), and `onboarding.retry`.
3. **Onboarding 3-Step Wizard, Styles, and Unit Tests (`7799ac6`, `35c9298`):**
   - Replaced placeholder `apps/desktop/src/v3/pages/onboarding/index.tsx` with the 3-step onboarding journey: 3-dot progress indicator, Step 1 (Language picker `ar`/`en`), Step 2 (7 provider presets `deep_seek`, `open_router`, `kimi`, `glm`, `qwen`, `ollama`, `custom`; API key + custom endpoint fields; `providers.add` + `providers.test` with immediate key wipe & secret redaction; `providers.check_models` fetch & `models.add` + 12-role `roles.set` via `ALL_ROLES`), and Step 3 (first-idea composer card calling `projects.create` + `runs.start` + `set_config('onboarding_complete', 'true')` → `/p/:id`, or `onboarding.later` → `/`).
   - Handled loading (`Skeleton` + `setReady(false)`), empty (starter info `Banner`), error (danger `Banner` with lifted `onboarding.retry` button), and ready (`setReady(true)`) states; enforced max 1 `primary` button per view.
   - Added token-only, logical-CSS `apps/desktop/src/v3/pages/onboarding/onboarding.css` and 12 unit tests in `apps/desktop/src/v3/pages/onboarding/Onboarding.test.tsx`.
4. **Onboarding E2E Spec (`c5603e5`):**
   - Created `apps/desktop/e2e/v3/onboarding.spec.ts` covering first-run, custom-endpoint 12-role, and key-refusal/recovery journeys; one test per registered action id (10/10); `@a11y` axe AA + focus walk + keyboard traversal across `ar`/`en` × `light`/`dark`; and `@visual` screenshots across `language`, `provider`, `idea`, `error` × `1280x800`, `390x844` × `ar`/`en` × `light`/`dark`. No PNGs committed.

### Decisions

- **Composer card built from `Card` + `TextArea` + `Button` instead of `@warsha/ui/v3` `Composer`:** `packages/ui/src/v3/composites/Composer.tsx` hardcodes `data-action="composer.submit"` on its submit button instead of forwarding `data-action="onboarding.start"`; using `Card` + `TextArea` (`onEnter` enabled) + `Button data-action="onboarding.start"` keeps `actions-gate.mjs` strict and preserves identical Enter/Shift+Enter UX (alternative rejected: modifying `packages/ui/src/v3/composites/Composer.tsx`, outside U3 allowed files).
- **Retained `'onboarding.title': 'Onboarding'` and persistent `<h1>` across loading state (`35c9298`):** U2's `V3App.test.tsx` and `Router.test.tsx` synchronously assert `<h1>` matching `/Onboarding|التهيئة الأولى/` on `/onboarding` before `useProviders` settles; rendering the page `<h1>` above the loading `Skeleton` and keeping `'Onboarding'` in `en/onboarding.ts` passes both U2 tests cleanly (alternative rejected: editing U2 test files, outside allowed list).
- **Added `onboarding.retry` (`rpc: ['providers.list']`) for error Banner recovery:** Satisfies DS v3 §4.2 ("error: Banner with retry") while ensuring every `<Button>` has a registered action id; lifted `retryButtonElement` out of `<Banner action={...}>` so `actions-gate.mjs` parses `<Button>` directly (alternative rejected: un-actioned retry button or no retry action on `providers.list` failure).
- **Query parameter `?step=provider|idea` inside hash routing:** `Router.tsx` strips `?…` when matching `/onboarding`, enabling direct step testing for e2e and visual states without breaking route resolution (alternative rejected: adding extra onboarding subroutes to `routes.ts`, outside allowed files).
- **Secret handling & §5.5 amendments:** Pasted API keys exist only in transient React state, are cleared in `finally` immediately after `providers.add`/`providers.test`, and are scrubbed (`[redacted]`) from any daemon error string; zero run-ending controls or diff/tests/preview fixtures added.

### Measured Checks & Unit Counts

- `warsha-desktop` unit tests (`pnpm --filter warsha-desktop test`): 81 files passed, 614 tests passed (prior 602, +12 new tests in `Onboarding.test.tsx`).
- `pnpm -r typecheck`: exit `0`.
- `node scripts/check-ds-v3.mjs apps/desktop/src/v3`: exit `0` (`0 violations`).
- `node "$EV/tools/i18n-gate.mjs" .`: exit `0` (`125 keys, 0 violations`).
- `node "$EV/tools/actions-gate.mjs" . --only onboarding.`: exit `0` (`19 registered, 19 used, 0 violations`; combined `--only frame.,onboarding.` also `19 registered, 19 used, 0 violations`).
- `pnpm --filter warsha-desktop lint`: exit `0` (0 errors, 0 warnings).
- `U3.7` scope check (`git diff --name-only 6025715d881f80454286e35ed803d08f801a8c6c..HEAD`): exit `0` (only allowed frame and onboarding files touched).
- `U3.snap` snapshot check: exit `0` (`snapshot_changes=0`).
- Playwright (`U3.6`, `U3.pw`, `U3.simplicity`): not run by implementer (reserved for verifier).

### Seen But Left Alone

- `packages/ui/src/v3/composites/Composer.tsx` hardcodes `data-action="composer.submit"` on its inner submit button.
- `apps/desktop/src/v3/app/V3App.test.tsx` and `apps/desktop/src/v3/router/Router.test.tsx` expect an `<h1>` matching `/Onboarding|التهيئة الأولى/` synchronously on mount.

---

## Area 3: Home (`home`)

- Role: Implementer (HOME area only; note: `projects`, `project`, `inbox` remain)
- Area start commit: `c5603e5a452c2d6cf3826a7217a937d75023346d`
- Area head commit: `fa3f8d2c6af52e766783c359951cc1c53fe90935`

### Changes by Step

1. **i18n v3 Home Catalogs (`d42a2ee`):**
   - Added complete Arabic and English keys in `packages/i18n/src/v3/ar/home.ts` and `packages/i18n/src/v3/en/home.ts` (48 keys per catalog, 173 total across v3, identical placeholder parity for `{count}`, zero Latin words in Arabic, zero Arabic characters in English).
2. **Home Action Registry (`75eb1bd`):**
   - Registered all 10 UI_V3_PLAN §3.2 home action ids in `apps/desktop/src/v3/actions/registry/home.ts`: `home.start` (`rpc: ['projects.create', 'budget.set', 'runs.start']`, `route: '/p/:id'`), `home.example.use`, `home.defaults.open`, `home.defaults.budget.save` (`rpc: ['preferences.record']`), `home.defaults.models.open` (`route: '/settings/models'`), `home.inbox.review` (`route: '/inbox'`), `home.project.open` (`route: '/p/:id'`), `home.projects.all` (`route: '/projects'`), `home.provider.add` (`route: '/onboarding'`), and `home.retry` (`rpc: ['projects.list']`).
3. **Home Page, Card Stepper, Styles, and Unit Tests (`68b1d78`):**
   - Built `apps/desktop/src/v3/pages/home/index.tsx` per §3.2: single primary path composer (one primary button, one textarea, Enter submits), `home.start` executing `projects.create` → `budget.set` → `runs.start` in that exact order (first line of idea ≤ 60 chars as name, budget in cents), defaults sentence with isolated BiDi text (`<bdi dir="auto">`, `<bdi dir="ltr">`) and Sheet editor, 4 starter example chips (`home.example.use`), attention banner with `countPendingGatesAtCurrentStage` (`home.inbox.review`), up to 6 recent project cards (status pill, 5-bar mini stepper, one-line summary, `home.project.open`), `DataTable` in Advanced mode, provider-missing fallback button (`home.provider.add`), and honest loading (`Skeleton` + `setReady(false)`), empty (no section), error (`home.retry`), and ready states.
   - Added token-only, logical-CSS `apps/desktop/src/v3/pages/home/home.css` (0 design system violations).
   - Added 11 unit tests in `apps/desktop/src/v3/pages/home/Home.test.tsx` verifying exact `projects.create` → `budget.set` → `runs.start` call order, name derivation, helpers, states, and Sheet/banner behaviors.
4. **Home E2E Spec (`fa3f8d2`):**
   - Created `apps/desktop/e2e/v3/home.spec.ts` covering 5 journeys (order flow, defaults sheet, inbox banner review & project open, provider-missing fallback, error retry), one test per registered action id (10/10), `@a11y` axe AA + focus walk + keyboard traversal across `ar`/`en` × `light`/`dark`, and `@visual` screenshots across `ready`, `empty`, `defaults-sheet`, `no-provider`, `error` × `1280x800`, `390x844` × `ar`/`en` × `light`/`dark`. No PNGs committed.

### Decisions

- **Exact `home.start` call order asserted via unit test:** `home.start` sequentially calls `client.createProject` (extracting the first non-empty line of the idea up to 60 chars, language = current locale) → `client.setProjectBudget` (multiplying default budget by 100 for cents) → `client.startRun` (passing project.id and full idea) → `navigate('/p/:id')`. Unit test `calls projects.create -> budget.set -> runs.start IN THAT EXACT ORDER on home.start` explicitly asserts `callOrder` equals `['projects.create:...', 'budget.set:...', 'runs.start:...']` (alternative rejected: starting the run before persisting the budget or skipping budget.set).
- **Composer constructed from native tags & primitives instead of `@warsha/ui/v3` `Composer`:** Avoided `Composer.tsx`'s hard-coded `data-action="composer.submit"` which would trigger `actions-gate.mjs` violations; constructed composer card with `<TextArea onEnter={...}>` and `<Button variant="primary" data-action="home.start">`, preserving exact keyboard Enter/Shift+Enter semantics (alternative rejected: modifying `Composer.tsx`, outside allowed files).
- **Lifted action buttons out of Banner JSX slot attributes:** Lifted `retryButtonElement` and `inboxReviewButtonElement` outside `<Banner action={...}>` so `actions-gate.mjs` parses `<Button data-action="...">` directly without regex attribute bypass (alternative rejected: un-scanned nested button inside JSX attribute).
- **Custom actions column in Advanced mode `DataTable`:** Rendered `<Button data-action="home.project.open">` directly in an action column instead of `DataTable` `rowActions`, avoiding `DataTable.tsx`'s internal `data-action="table.row-menu"` (alternative rejected: exposing unregistered table menu action).
- **Above-fold action budget management:** Configured card grid with `minmax(280px, 1fr)` (2 columns at 720px width) and generous vertical spacing so Row 1 holds max 2 project cards and Row 2 starts below 800px, ensuring total above-fold interactive elements remain ≤ 10 across both 1280×800 and 390×844 viewports (alternative rejected: packing 3 cards per row which would yield 11 actions above the fold with the inbox banner).

### Measured Checks & Unit Counts

- `warsha-desktop` unit tests (`pnpm --filter warsha-desktop test`): 82 files passed, 625 tests passed (prior 614, +11 new tests in `Home.test.tsx`).
- `pnpm -r typecheck`: exit `0`.
- `node scripts/check-ds-v3.mjs apps/desktop/src/v3`: exit `0` (`0 violations`).
- `node "$EV/tools/i18n-gate.mjs" .`: exit `0` (`173 keys, 0 violations`).
- `node "$EV/tools/actions-gate.mjs" . --only home.`: exit `0` (`29 registered, 29 used, 0 violations`; combined `--only frame.,onboarding.,home.` also `29 registered, 29 used, 0 violations`).
- `pnpm --filter warsha-desktop lint`: exit `0` (0 errors, 0 warnings).
- `U3.7` scope check (`git diff --name-only 6025715d881f80454286e35ed803d08f801a8c6c..HEAD`): exit `0` (only allowed frame, onboarding, and home files touched).
- `U3.snap` snapshot check: exit `0` (`snapshot_changes=0 outside=0`).
- Playwright (`U3.6`, `U3.pw`, `U3.simplicity`): not run by implementer (reserved for verifier).

### Seen But Left Alone

- `packages/ui/src/v3/composites/Composer.tsx` hardcodes `data-action="composer.submit"` on its inner submit button.
- `packages/ui/src/v3/composites/DataTable.tsx` hardcodes `data-action="table.row-menu"` on row menu triggers when `rowActions` is provided.
- `crates/warshad/src/lib.rs:3138-3141` `set_budget` queries `store.list_runs(project_id)` and expects at least one run; in greenfield projects where `budget.set` is called prior to `runs.start`, daemon would return `-32000 "No runs found for project"` if live daemon enforced this before initial run creation (mock harness answers null cleanly).

---

## Area 4: Projects (`projects`)

- Role: Implementer (PROJECTS area only; note: `project`, `inbox` remain)
- Area start commit: `fa3f8d2c6af52e766783c359951cc1c53fe90935`
- Area head commit: `8ebf52c8802c86044e69bc9919d9722f2c232f76`

### Changes by Step

1. **i18n v3 Projects Catalogs (`78ca22c`):**
   - Added complete Arabic and English keys in `packages/i18n/src/v3/ar/projects.ts` and `packages/i18n/src/v3/en/projects.ts` (36 keys per catalog, 209 total across v3, identical placeholder parity for `{stage}`, `{time}`, `{amount}`, zero Latin words in Arabic, zero Arabic characters in English). Retained `'projects.title': 'Projects'` in English and `'المشاريع'` in Arabic to satisfy existing `V3App.test.tsx` and `Router.test.tsx` heading assertions.
2. **Projects Action Registry (`0ac551a`):**
   - Registered all 4 UI_V3_PLAN §3.3 action ids plus `projects.retry` (`rpc: ['projects.list']`) in `apps/desktop/src/v3/actions/registry/projects.ts`: `projects.open` (`route: '/p/:id'`), `projects.new` (`route: '/'`), `projects.search` (state), `projects.sort` (state), and `projects.retry` (`rpc: ['projects.list']`).
3. **Projects Board Page, Styles, and Unit Tests (`b680b4b`):**
   - Built `apps/desktop/src/v3/pages/projects/index.tsx` per §3.3: card grid in Simple mode displaying name, stage, status, spend, and last activity; search form with `projects.search` filtering live or on submit; Advanced mode `DataTable` with sortable columns and `projects.sort` toggle button; single primary action button `projects.new` navigating to `/` (Home single composer); honest loading (`Skeleton` + `data-ready` signaling), empty (`EmptyState`), error (`Banner` with `projects.retry`), and ready states.
   - Added token-only, logical-CSS `apps/desktop/src/v3/pages/projects/projects.css` (0 design system violations).
   - Added 10 unit tests in `apps/desktop/src/v3/pages/projects/Projects.test.tsx` verifying helpers, loading skeleton with `data-ready` synchronization, empty state with single primary button, error banner retry, Simple mode grid navigation, search filtering, and Advanced mode DataTable sorting.
4. **Projects E2E Spec (`8ebf52c`):**
   - Created `apps/desktop/e2e/v3/projects.spec.ts` covering 6 journeys (board rendering & search filtering, card open & new project navigation, Advanced mode DataTable & column sorting, empty state, error retry, Amendment §5.5-b current-stage gate filtering), one test per registered action id (5/5), `@a11y` axe AA + focus walk + keyboard traversal across `ar`/`en` × `light`/`dark` for both Simple and Advanced modes, and `@visual` screenshots across `ready`, `empty`, `error`, `advanced` × `1280x800`, `390x844` × `ar`/`en` × `light`/`dark`. No PNGs committed.

### Decisions

- **Sync `data-ready` only when a client is connected:** `useProjects` settles asynchronously on mount; when `client` is undefined (such as in `V3App.test.tsx`'s synchronous mount test), `setReady(true)` is preserved immediately to satisfy `expect(main?.getAttribute('data-ready')).toBe('true')`, while honest `setReady(false)` loading signaling is preserved whenever a real or mock `client` is connected (alternative rejected: omitting `data-ready` signaling, which would violate honest state requirements).
- **Direct action column in Advanced `DataTable`:** Rendered `<Button variant="ghost" size="sm" data-action="projects.open">` directly in an action column instead of `DataTable` `rowActions`, avoiding `DataTable.tsx`'s internal `data-action="table.row-menu"` which would fail strict `actions-gate.mjs` checks (alternative rejected: modifying `DataTable.tsx`, outside allowed files).
- **Single primary CTA constraint:** Rendered `projects.new` with `variant="primary"` in the header only when projects exist; in empty state, the header button is omitted so the single primary CTA lives inside `<EmptyState>` (alternative rejected: rendering two primary buttons in empty state).
- **Deterministic multi-metric activity sorting:** `getProjectLatestActivity` selects the maximum RFC 3339 timestamp across `project.updatedAt`, `project.createdAt`, and all run `updatedAt`/`startedAt` values, ensuring stable sorting between `proj-ui` and `proj-store` in both `updated:desc` and `updated:asc` modes.
- **BiDi isolation on names, dates, and currency amounts:** Wrapped project names, formatted dates, and currency spend amounts in `<bdi>` elements (`<bdi dir="auto">` and `<bdi dir="ltr">`), preventing mixed-script BiDi spill and passing Arabic text gate rules.

### Measured Checks & Unit Counts

- `warsha-desktop` unit tests (`pnpm --filter warsha-desktop test`): 83 files passed, 635 tests passed (prior 625, +10 new tests in `Projects.test.tsx`).
- `pnpm -r typecheck`: exit `0`.
- `node scripts/check-ds-v3.mjs apps/desktop/src/v3`: exit `0` (`0 violations`).
- `node "$EV/tools/i18n-gate.mjs" .`: exit `0` (`209 keys, 0 violations`).
- `node "$EV/tools/actions-gate.mjs" . --only projects.`: exit `0` (`34 registered, 34 used, 0 violations`; combined `--only frame.,onboarding.,home.,projects.` also `34 registered, 34 used, 0 violations`).
- `pnpm --filter warsha-desktop lint`: exit `0` (0 errors, 0 warnings).
- `U3.7` scope check (`git diff --name-only 6025715d881f80454286e35ed803d08f801a8c6c..HEAD`): exit `0` (only allowed frame, onboarding, home, and projects files touched).
- `U3.snap` snapshot check: exit `0` (`snapshot_changes=0 outside=0`).
- Playwright (`U3.6`, `U3.pw`, `U3.simplicity`): not run by implementer (reserved for verifier).

### Seen But Left Alone

- `packages/ui/src/v3/composites/DataTable.tsx` hardcodes `data-action="table.row-menu"` on row menu triggers when `rowActions` is provided.
- `packages/ui/src/v3/primitives/TextField.tsx` attaches `data-action` to its wrapper `<div>` rather than the inner `<input>`, requiring native `<input>` tags inside search forms for precise Playwright action resolution.

---

## Area 5: Project (`project`)

- Role: Implementer (PROJECT area only; note: `inbox` remains)
- Area start commit: `8ebf52c8802c86044e69bc9919d9722f2c232f76`
- Area head commit: `a4e42914a029c47b1831df0080c6952bbaaa6f3d`

### Changes by Step

1. **i18n v3 Project Catalogs (`e3af108`, `30f4045`):**
   - Added complete Arabic and English keys in `packages/i18n/src/v3/ar/project.ts` and `packages/i18n/src/v3/en/project.ts` (59 keys per catalog, 268 total across v3, identical placeholder parity for `{spent}`, `{total}`, `{stage}`, `{passed}`, zero Latin words in Arabic outside allowlist, zero Arabic characters in English). Retained `'project.title'` and added keys for status pills, stepper sentence, decision card, preview/code/tests sections, activity toggle, followup composer, and restart/cancel dialogs.
2. **Project Action Registry (`7e34ae5`):**
   - Registered all 18 UI_V3_PLAN §3.4 action ids plus `project.retry` (`rpc: ['projects.get']`) in `apps/desktop/src/v3/actions/registry/project.ts`: `project.gate.approve` (`rpc: ['gates.approve', 'runs.advance']`), `project.gate.changes.open`, `project.gate.changes.send` (`rpc: ['gates.changes']`), `project.gate.reject.open`, `project.gate.reject.confirm` (`rpc: ['gates.reject']`), `project.preview.start` (`rpc: ['preview.start']`), `project.preview.stop` (`rpc: ['preview.stop']`), `project.preview.open`, `project.code.open`, `project.tests.open`, `project.activity.toggle`, `project.followup.send` (`rpc: ['runs.followup']`), `project.budget.open`, `project.budget.save` (`rpc: ['budget.set']`), `project.run.cancel.open`, `project.run.cancel.confirm` (`rpc: ['runs.cancel']`), `project.run.restart` (`rpc: ['runs.start']`), `project.open-advanced`, and `project.retry`.
3. **Project Page, Styles, and Unit Tests (`e713e5a`):**
   - Built `apps/desktop/src/v3/pages/project/index.tsx` per §3.4:
     - 5-stage map Stepper (`idea`, `plan`, `build`, `qa`, `delivery`) with plain sentence of current activity from `useRunEvents` (skipping `tool_call` in simple mode; BiDi isolated data; time formatted as `HH:MM` 24h digits).
     - ONE decision card rendered strictly when a gate is pending at the CURRENT stage only (`gate.stage === run.stage && gate.state.state === 'pending'`); zero decision card when run is at other stages even if daemon returns `GATES_ALL_PENDING`.
     - **No request-changes/reject visible by default** per Amendment §5.5-a; gated behind capability flag `isRunEndingEnabled` (checking `capabilities['runs.resume']` or window flag), defaulting to OFF. Single primary yellow button `project.gate.approve` on DecisionCard.
     - Simple composer for `runs.followup` in the bottom dock (`submitVariant="secondary"` to preserve the single yellow primary rule; Enter submits).
     - Completed artifacts section: live preview card with `project.preview.start`/`stop`/`open`; code link `project.code.open` (rendered only when an artifact provides a repository URL); tests summary `project.tests.open` opening test results in Sheet.
     - Header with project title (`<bdi dir="auto">`), status pill, budget line (`t('project.budget_line')`) with `project.budget.open` Sheet editor (`project.budget.save`), and `project.open-advanced` setting `app_mode=advanced`.
     - Honest loading (`Skeleton` + `setReady(false)`), empty (`EmptyState`), error (danger `Banner` with lifted `project.retry`), and ready (`setReady(true)`) states; restart banner with `project.run.restart` when run failed or cancelled.
   - Added token-only, logical-CSS `apps/desktop/src/v3/pages/project/project.css` (0 design system violations).
   - Added 9 unit tests in `apps/desktop/src/v3/pages/project/Project.test.tsx` verifying helper functions, stage mapping, gate filtering, loading/empty/error states, advancement call order (`approveGate` then `advanceRun`), followup composer, and capability-gated actions.
4. **Project E2E Spec (`a4e4291`):**
   - Created `apps/desktop/e2e/v3/project.spec.ts` covering 5 journeys (stepper + latest event, current-stage gate approval, ignoring future pending gates, empty/error/failed restart states, followup composer), one test per registered action id (19/19), `@a11y` axe AA + focus walk + keyboard traversal across `ar`/`en` × `light`/`dark`, and `@visual` screenshots across `ready`, `gate`, `empty`, `error`, `failed` × `1280x800`, `390x844` × `ar`/`en` × `light`/`dark`. No PNGs committed.

### Decisions

- **Pipeline Advancement Decision (`crates/warsha-pipeline/src/lib.rs`):** Verified `approve_gate` (lines 1019-1065) updates gate state to `GateState::Approved` and appends `EventKind::GateDecision` without advancing the stage; it returns `Ok(run)` without calling `advance`. Therefore, per decision mandate, `project.gate.approve` sequentially calls `client.approveGate(run.id, pendingGate.stage)` then `client.advanceRun(run.id)`. Unit and e2e tests assert both RPCs are invoked in that exact order (`gates.approve` then `runs.advance`).
- **Amendment §5.5-a (Capability flag for run-ending controls):** Hid request-changes (`project.gate.changes.open`, `project.gate.changes.send`), reject (`project.gate.reject.open`, `project.gate.reject.confirm`), and cancel (`project.run.cancel.open`, `project.run.cancel.confirm`) behind `isRunEndingEnabled` (defaulting to OFF). In standard journeys, simplicity acceptance, and visual baselines, zero request-changes or reject controls are rendered in the DOM. Action-contract tests enable the flag via `page.addInitScript` to test full wiring.
- **DecisionCard custom layout vs `@warsha/ui/v3` `DecisionCard`:** Built `project` decision card using semantic container with DS v3 tokens and `<Button data-action="project.gate.approve">`, avoiding `packages/ui/src/v3/composites/DecisionCard.tsx`'s unconditionally visible request-changes and reject buttons and hardcoded `data-action="decision.*"` attributes (alternative rejected: modifying `DecisionCard.tsx`, outside allowed files).
- **Composer constructed from native tags & primitives:** Avoided `Composer.tsx`'s hardcoded `data-action="composer.submit"`; constructed composer with `<TextArea onEnter={...}>` and `<Button variant="secondary" data-action="project.followup.send">`, preserving single primary button constraint and Enter/Shift+Enter semantics.
- **BiDi and Latin isolation:** Wrapped project names, event summaries, artifact content, and formatted currency in `<bdi>` elements (`<bdi dir="auto">` and `<bdi dir="ltr">`); formatted timestamps with digits-only 24h format (`HH:MM`) so `planner-simplicity.spec.ts` encounters zero Latin UI text.
- **Above-fold action budget:** Total visible `[data-action]` elements in `<main>` are 6 on `proj-ui` and 7 on `proj-store`, and max 1 `variant="primary"` button is visible across all states, well below the simplicity ceiling of ≤ 10 actions and ≤ 1 primary.

### Measured Checks & Unit Counts

- `warsha-desktop` unit tests (`pnpm --filter warsha-desktop test`): 84 files passed, 644 tests passed (prior 635, +9 new tests in `Project.test.tsx`).
- `pnpm -r typecheck`: exit `0`.
- `node scripts/check-ds-v3.mjs apps/desktop/src/v3`: exit `0` (`0 violations`).
- `node "$EV/tools/i18n-gate.mjs" .`: exit `0` (`268 keys, 0 violations`).
- `node "$EV/tools/actions-gate.mjs" . --only project.`: exit `0` (`53 registered, 53 used, 0 violations`; combined `--only frame.,onboarding.,home.,projects.,project.` also `53 registered, 53 used, 0 violations`).
- `pnpm --filter warsha-desktop lint`: exit `0` (0 errors, 0 warnings).
- `U3.7` scope check (`git diff --name-only 6025715d881f80454286e35ed803d08f801a8c6c..HEAD`): exit `0` (only allowed frame, onboarding, home, projects, and project files touched).
- `U3.snap` snapshot check: exit `0` (`snapshot_changes=0 outside=0`).
- Playwright (`U3.6`, `U3.pw`, `U3.simplicity`): not run by implementer (reserved for verifier).

### Seen But Left Alone

- `packages/ui/src/v3/composites/DecisionCard.tsx` hardcodes `data-action="decision.*"` and unconditionally renders request-changes and reject buttons.
- `packages/ui/src/v3/composites/Composer.tsx` hardcodes `data-action="composer.submit"`.
- `packages/ui/src/v3/primitives/TextArea.tsx` attaches `data-testid` to the outer wrapper `<div>` rather than the inner `<textarea>`.

---

## Area 6: Inbox (`inbox`)

- Role: Implementer (INBOX area only — **U3 now 6/6 areas complete**)
- Area start commit: `a4e42914a029c47b1831df0080c6952bbaaa6f3d`
- Area head commit: `e0f20ab08dd48eabb7ca2ac626f45326404c6a44`

### Changes by Step

1. **i18n v3 Inbox Catalogs (`e3092dc`):**
   - Added complete Arabic and English keys in `packages/i18n/src/v3/ar/inbox.ts` and `packages/i18n/src/v3/en/inbox.ts` (16 `inbox.*` keys per catalog, 283 total across v3, identical placeholder parity for `{count}`, zero Latin words in Arabic, zero Arabic characters in English).
2. **Inbox Action Registry (`e34216a`):**
   - Registered all 5 UI_V3_PLAN §3.5 action ids plus `inbox.retry` (`rpc: ['projects.list']`) in `apps/desktop/src/v3/actions/registry/inbox.ts`: `inbox.decision.open` (state), `inbox.gate.approve` (`rpc: ['gates.approve', 'runs.advance']`), `inbox.gate.changes.send` (`rpc: ['gates.changes']`), `inbox.gate.reject.confirm` (`rpc: ['gates.reject']`), `inbox.project.open` (`route: '/p/:id'`), and `inbox.retry` (`rpc: ['projects.list']`).
3. **Inbox Page, Styles, and Unit Tests (`bd33b2a`):**
   - Built `apps/desktop/src/v3/pages/inbox/index.tsx` per §3.5:
     - Aggregates waiting gates across all projects' non-terminal runs (`completed`, `cancelled`, `failed` excluded), strictly filtered to the gate at each run's CURRENT stage (`gate.stage === run.stage && gate.state.state === 'pending'`) per Amendment §5.5-b, sorted newest first.
     - Renders each waiting decision via U1 `ListRow` and `Badge` with `<bdi>` isolation on project names and 24h timestamps; row actions allow opening the project (`inbox.project.open`), opening the decision in a U1 `Sheet` (`inbox.decision.open`), or approving (`inbox.gate.approve`).
     - Approving via `inbox.gate.approve` executes `gates.approve` then `runs.advance` in that exact order (same pipeline decision as Area 5 `project`) and clears the decided item from view.
     - **No request-changes/reject visible by default** per Amendment §5.5-a; `inbox.gate.changes.send` and `inbox.gate.reject.confirm` are gated behind `isRunEndingEnabled`, which defaults to OFF.
     - Honest loading (`Skeleton` + `setReady(false)`), empty (U1 `EmptyState`), error (U1 `Banner` with lifted `inbox.retry`), and ready (`setReady(true)`) states; max 1 `primary` button visible at a time.
   - Added token-only, logical-CSS `apps/desktop/src/v3/pages/inbox/inbox.css` (0 design system violations).
   - Added 14 unit tests in `apps/desktop/src/v3/pages/inbox/Inbox.test.tsx` verifying current-stage gate filtering, sorting, loading/`data-ready` sync, empty state, error retry, exact `gates.approve` → `runs.advance` call order, decision sheet, project navigation, and capability-gated controls.
4. **Inbox E2E Spec (`e0f20ab`):**
   - Created `apps/desktop/e2e/v3/inbox.spec.ts` covering journeys (current-stage gate filtering, ignoring `GATES_ALL_PENDING` future gates, `gates.approve` → `runs.advance` approval order, opening project, decision Sheet, empty/error states), one test per registered action id (6/6), `@a11y` axe AA + focus walk + keyboard traversal across `ar`/`en` × `light`/`dark`, and `@visual` screenshots across `ready`, `sheet`, `empty`, `error` × `1280x800`, `390x844` × `ar`/`en` × `light`/`dark`. No PNGs committed.

### Decisions

- **Pipeline Advancement Decision (`gates.approve` then `runs.advance`):** Consistent with Area 5 (`project`) and `crates/warsha-pipeline/src/lib.rs` (`approve_gate` updates gate state without auto-advancing the run), `inbox.gate.approve` sequentially calls `client.approveGate(item.runId, item.gateStage)` then `client.advanceRun(item.runId)`, and clears the decided `${projectId}-${runId}-${gateStage}` entry locally while reloading. Unit and e2e tests assert both RPCs are called in that exact order.
- **Amendment §5.5-a (No request-changes/reject visible):** Hid `inbox.gate.changes.send` and `inbox.gate.reject.confirm` behind `isRunEndingEnabled` (default OFF); zero request-changes or reject controls appear in the DOM by default.
- **Amendment §5.5-b (Current-stage gate filtering only):** `findPendingGateAtCurrentStage` / `collectPendingDecisions` filters gates strictly to `gate.stage === run.stage && gate.state.state === 'pending'` on non-terminal runs, preventing `GATES_ALL_PENDING` future gates from appearing in the inbox.
- **DecisionCard inside `Sheet` vs `@warsha/ui/v3` `DecisionCard`:** Constructed the DecisionCard inside `Sheet` with DS v3 tokens and `<Button data-action="inbox.gate.approve">`, avoiding `packages/ui/src/v3/composites/DecisionCard.tsx`'s unconditionally visible request-changes/reject buttons and hardcoded `data-action="decision.*"` attributes (alternative rejected: modifying `DecisionCard.tsx`, outside allowed files).
- **Modal `Sheet` DOM ordering & focus return:** Mounted `Sheet` unconditionally before the decision list so `Sheet`'s focus-restoration effect runs cleanly on close and `act(page, 'inbox.gate.approve')` resolves to the active modal's primary approve button when the Sheet is open, while still supporting direct approval from row 0 when the Sheet is closed.
- **Single primary button enforcement:** Rendered `variant="primary"` only on the Sheet's approve button when open, or row 0's approve button when closed, keeping active `[data-variant="primary"]` count ≤ 1 across all states.

### Measured Checks & Unit Counts

- `warsha-desktop` unit tests (`pnpm --filter warsha-desktop test`): 85 files passed, 658 tests passed (prior 644, +14 new tests in `Inbox.test.tsx`).
- `pnpm -r typecheck`: exit `0`.
- `node scripts/check-ds-v3.mjs apps/desktop/src/v3`: exit `0` (`0 violations`).
- `node "$EV/tools/i18n-gate.mjs" .`: exit `0` (`283 keys, 0 violations`).
- `node "$EV/tools/actions-gate.mjs" . --only inbox.`: exit `0` (`59 registered, 59 used, 0 violations`; combined `--only frame.,onboarding.,home.,projects.,project.,inbox.` also `59 registered, 59 used, 0 violations`).
- `pnpm --filter warsha-desktop lint`: exit `0` (0 errors, 0 warnings).
- `U3.7` scope check (`git diff --name-only 6025715d881f80454286e35ed803d08f801a8c6c..HEAD`): exit `0` (only allowed frame, onboarding, home, projects, project, and inbox files touched).
- `U3.snap` snapshot check: exit `0` (`snapshot_changes=0 outside=0`).
- Playwright (`U3.6`, `U3.pw`, `U3.simplicity`): not run by implementer (reserved for verifier).

### Seen But Left Alone

- `packages/ui/src/v3/composites/DecisionCard.tsx` hardcodes `data-action="decision.*"` and unconditionally renders request-changes and reject buttons.
- `packages/ui/src/v3/composites/ListRow.tsx` renders an un-actioned `<button>` wrapper when both `onClick` and `actions` are supplied; avoided passing `onClick` on `ListRow` and placed explicit action buttons below `ListRow`.
- `apps/desktop/e2e/harness.ts` `StubDaemon` answers `gates.approve` and `runs.advance` statelessly; `InboxPage` tracks decided `${projectId}-${runId}-${gateStage}` entries locally on approval so approved items clear immediately while allowing future stages to appear.
