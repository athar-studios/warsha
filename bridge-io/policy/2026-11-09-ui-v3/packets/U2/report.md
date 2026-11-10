# Packet U2 Report — v3 App Infrastructure (`apps/desktop/src/v3/`)

- Run: `2026-11-09-ui-v3`
- Packet: `U2` (`u2-app-infra`)
- Role: Implementer
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/u2`
- Branch: `run/2026-11-09-ui-v3/u2-app-infra`
- Base commit: `4c65ead4f46cf97eecffd73149a57056e505568c`
- Head commit: `fc8f06656a1b665913b0aeeecb19cb8278775bb6`

## Changes by Step

1. **i18n v3 Catalogs & Runtime (`862e793`):**
   - Seeded Arabic and English catalogs for `common`, `frame`, `onboarding`, `home`, `projects`, `project`, `inbox`, `bench`, `settings`.
   - Built `useT` hook with `{param}` interpolation and locale sync with `warsha.locale`.
   - Exported `./v3` subpath in `packages/i18n/package.json`.

2. **Router, V3App Shell, & Route Placeholders (`50a1c72`):**
   - Created in-house hash router (`Router.tsx`, `useRoute`, `Link`, `routes.ts`) with zero external router dependencies.
   - Built `V3App` with Providers: Client, Capabilities, I18n v3, Theme, Density.
   - Created placeholder pages for frame, onboarding, home, projects, project, inbox, bench, settings.
   - Built `app/startup.ts` route decision logic and `startup.test.ts` (4 unit tests).
   - Set up `main.tsx` conditional branch for `?ui=v3` and shell config `ui_version === 'v3'`.

3. **Actions Registry, useAction Hook, & Capabilities (`8fc1fc0`):**
   - Created action registry files for all areas (`frame`, `onboarding`, `home`, `projects`, `project`, `inbox`, `bench`, `settings`) exporting empty `ActionDef[]`.
   - Implemented duplicate detection in `actions/index.ts`.
   - Built `useAction(id, fn)` hook with error dispatch to toast composite port (`app/toast.ts`).
   - Built `capabilities.ts` detecting daemon health, active providers, and optional feature flags.

4. **Stages & Events Copy Mappings (`a784b7d`):**
   - Implemented `copy/stages.ts` mapping all 14 daemon stages to 5 macro phases plus gate prompts.
   - Implemented `copy/events.ts` mapping daemon `EventKind` entries to catalog keys.

5. **Initial Data Hooks & Resource Loader (`f58427a`):**
   - Created generic `useResource` loader managing `{ status, data, error, reload }`.
   - Implemented `useProjects`, `useProject`, `useRuns`, `useRun` with 4-state unit tests.

6. **Batch Data Hooks: Gates, Budget, Providers (`ab3be90`):**
   - Implemented `useGates`, `useBudget`, and `useProviders` with 4-state unit tests.

7. **Batch Data Hooks: Models, Roles, Harnesses (`e1b2364`):**
   - Implemented `useModels`, `useRoles`, and `useHarnesses` with 4-state unit tests.

8. **Batch Data Hooks: Skills, Plugins, Routines (`90784c1`):**
   - Implemented `useSkills`, `usePlugins`, and `useRoutines` with 4-state unit tests.

9. **Batch Data Hooks: Devices, Preview, Artifacts (`6de367f`):**
   - Implemented `useDevices`, `usePreview`, and `useArtifacts` with 4-state unit tests.

10. **Batch Data Hooks: Preferences, Health, Files (`9e2a513`):**
    - Implemented `usePreferences`, `useHealth`, and `useFiles` with 4-state unit tests.

11. **Batch Data Hooks: Agent, RunEvents, Data Index (`da233db`):**
    - Implemented `useAgent` and `useRunEvents` (with `runs.subscribe`, `resync_required`/gap handling, backoff reconnect, and unmount unsubscribe).
    - Created `apps/desktop/src/v3/data/index.ts` re-exporting all 21 data hooks.

12. **Typing & Lint Alignment (`fc8f066`):**
    - Aligned unit test mock records with exact wire/API interfaces in `@warsha/client`.
    - Formatted import ordering to pass ESLint strict rules.

## Decisions

- Hash router chosen for v3 desktop: zero external dependencies, seamless compatibility with Tauri static file serving (rejected: adding react-router-dom v7 or external navigation libraries).
- `startup.ts` failure handling: route defaults to `/` with error string rather than rerouting to `/onboarding` (rejected: falling back to onboarding upon daemon error, which caused v2 bug #224).
- `useRunEvents` resilient stream recovery: exponential backoff reconnect combined with immediate resync on `resync_required` or unannounced sequence gaps (rejected: ignoring socket drops or silently dropping intermediate frames).
- All 21 data hooks return unified `HookResult<T>`: uniform `{ status, data, error, reload }` contract ensuring consistent loading/empty/ready/error state handling across all v3 screens (rejected: screen-specific ad-hoc state tuples).

## Measured Unit Counts

- `warsha-desktop` Vitest tests: 584 passed across 78 test files (base 468, +116 new tests, required >= 493).
- All 21 data hooks verified with 87 tests in `src/v3/data`.
- Typecheck: exit 0 across all 7 workspace packages (`pnpm -r typecheck`).
- Desktop lint: exit 0, 0 errors, 0 warnings (`pnpm --filter warsha-desktop lint`).
- `i18n-gate.mjs`: exit 0 (55 keys, 0 violations).
- `actions-gate.mjs`: exit 0 (0 violations).
- Gate U2.1 through U2.11, U2.deps, U2.snap: all pass cleanly.
- Diff stat: 107 files changed, 4357 insertions(+), 5 deletions(-).

## Seen But Left Alone

- Pre-existing warnings in v2 screen tests (`ProjectsBoard.test.tsx` act warnings) left unchanged as v2 code is frozen until U7 cutover.
