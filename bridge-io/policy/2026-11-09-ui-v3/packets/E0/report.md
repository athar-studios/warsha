# Packet E0 Report — e2e v3 support (`apps/desktop/e2e/v3/`)

- Run: `2026-11-09-ui-v3`
- Packet: `E0` (`e2e-v3-support`)
- Role: Implementer
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/e0`
- Branch: `run/2026-11-09-ui-v3/e0-e2e-v3-support`
- Base commit: `128b59c08cbf5ddbe4de002528a50f451ea74296`
- Head commit: `bcb5c7ac5579f1ea8974a62193b2a26563339046`

## Changes Per Step

1. **Step 1 — e2e v3 support harness (`apps/desktop/e2e/v3/support/index.ts`)**:
   - `openV3(page, route, { lang = 'ar', theme = 'light', mode = 'simple' })`:
     - Configures `localStorage` with `warsha.theme` and `warsha.locale`.
     - Stubs Tauri `__TAURI_INTERNALS__.invoke` answering `get_config` with daemon URLs, token, `onboarding_complete: 'true'`, `app_mode: mode`, and `ui_version: 'v3'`.
     - Installs `installDaemonStub` and `installEventStub` from `apps/desktop/e2e/harness.ts`.
     - Pins fixed time (`2026-10-05T07:15:00.000Z`), sets viewport, emulates media with reduced motion, and injects motion-zeroing CSS.
     - Aborts external font network requests.
     - Navigates to `/?ui=v3#<route>`, synchronizes hash with the v3 router via `hashchange`, and waits for `main[data-ready="true"]`.
   - `act(page, id, { nth? })`:
     - Clicks `[data-action="<id>"]`, using `nth(options.nth)` if provided or `first()`.
   - `expectRpc(page, method, params?)`:
     - Polls `rpcCalls(page)` until a matching JSON-RPC invocation appears (supporting partial deep object/array matching).
   - `rpcCalls(page)`:
     - Re-exports `rpcCalls` from `apps/desktop/e2e/harness.ts`.

2. **Step 2 — v3 smoke suite (`apps/desktop/e2e/v3/smoke.spec.ts`)**:
   - Iterates over all 7 routes declared in `ROUTES` from `apps/desktop/src/v3/router/routes.ts` (`/onboarding`, `/`, `/projects`, `/p/:projectId`, `/p/:projectId/r/:runId/:tab`, `/inbox`, `/settings/:section`).
   - Generates concrete test paths replacing route parameters with sample identifiers.
   - Tests each route in both `ar` and `en` locales (14 tests total).
   - Verifies that every route boots with `main[data-ready="true"]` visible.

## Decisions & Alternatives Rejected

1. **Consolidated support exports in `apps/desktop/e2e/v3/support/index.ts`**:
   - Decision: Placed all four required exports (`openV3`, `act`, `expectRpc`, `rpcCalls`) in `index.ts`.
   - Alternative rejected: Splitting into multiple auxiliary files (`open.ts`, `act.ts`, `rpc.ts`) with re-exports in `index.ts`, which would cause redundant grep matches under gate `E0.2` (`grep -cE`).

2. **Router hash synchronization in `openV3`**:
   - Decision: In `openV3`, dispatched `hashchange` after page navigation to trigger `RouterProvider`'s `window.addEventListener('hashchange')` handler.
   - Alternative rejected: Modifying `V3App.tsx` or `Router.tsx` to handle initial hash differently. Those files are strictly outside the allowed scope of packet E0 and modifying them would fail gate `E0.4`.

3. **Dynamic parameter hydration in `smoke.spec.ts`**:
   - Decision: Added `concretePath` helper replacing parameterized segments (`:projectId`, `:runId`, etc.) from `routeDef.paramNames` with sample IDs.
   - Alternative rejected: Hardcoding a static list of URLs, which would risk divergence if new routes are added to `ROUTES`.

## Measured Gates

- `E0.1`: `pnpm --filter warsha-desktop typecheck` (tsc + tsc -p tsconfig.e2e.json) -> PASS (exit 0)
- `E0.2`: `cat apps/desktop/e2e/v3/support/*.ts | grep -cE "export (async )?function (openV3|act|expectRpc|rpcCalls)\b"` -> 4 (PASS)
- `E0.3`: Playwright smoke test deferred to capture host verifier per instructions (capture host busy)
- `E0.4`: Scope check `test -z "$(git diff --name-only $BASE..HEAD | grep -vE '^apps/desktop/e2e/v3/(support/|smoke\.spec\.ts$)')"` -> PASS (exit 0, modified files: `apps/desktop/e2e/v3/support/index.ts`, `apps/desktop/e2e/v3/smoke.spec.ts`)
- `E0.deps`: Dependency check -> PASS (exit 1, 0 dependencies added or bumped)
- `E0.snap`: Snapshot check `node "$EV/tools"/pw-gate.mjs snapshots $BASE HEAD -` -> PASS (exit 0, snapshot_changes=0 outside=0)
- `E0.pw`: Full playwright test suite deferred to capture host verifier per instructions

## Uncovered Scope & Blockers

- Uncovered Scope: None.
- Blockers: None.

## Repair (E0 Load Bug — 2026-11-10)

- Repair Commit: `fcd7ae5a686fecaed4529998944d43b174dc11b5` (`fix(e2e): load the v3 smoke spec without the app module graph (E0 repair)`)
- **Root Cause**: `apps/desktop/e2e/v3/smoke.spec.ts` imported `ROUTES` from `apps/desktop/src/v3/router/routes.ts`, which transitively pulled the app's React page/component graph (including `useT` from `@warsha/i18n/v3`) into Playwright's Node runner, failing to load under Node's ESM/CJS interop (`SyntaxError: Named export 'useT' not found. The requested module '@warsha/i18n/v3' is a CommonJS module...`) with 0 tests loaded.
- **Change**:
  - Replaced the `../../src/v3/router/routes` import in `apps/desktop/e2e/v3/smoke.spec.ts` with a local `ROUTES` array defining all 7 route paths (`/onboarding`, `/`, `/projects`, `/p/:projectId`, `/p/:projectId/r/:runId/:tab`, `/inbox`, `/settings/:section`) and their concrete `sampleUrl` strings, plus a comment referencing `apps/desktop/src/v3/router/routes.ts` as the source of truth to keep in sync by review.
  - Audited `apps/desktop/e2e/v3/support/index.ts`; confirmed zero app-module imports (only `@playwright/test` and `../../harness`).
- **Local Smoke & Gate Checks**:
  - `pnpm exec playwright test --project=desktop v3/smoke.spec.ts --reporter=line`: `14 passed (16.8s)` (ar + en across all 7 routes).
  - `pnpm --filter warsha-desktop typecheck`: PASS
  - `E0.2` (`export ... function (openV3|act|expectRpc|rpcCalls)`): 4 (PASS)
  - `E0.4` (allowed-files diff check vs `128b59c`): PASS (`apps/desktop/e2e/v3/smoke.spec.ts`, `apps/desktop/e2e/v3/support/index.ts`)
  - `E0.deps`: PASS
  - `E0.snap`: `snapshot_changes=0 outside=0` (PASS)
