# Review — packet U2 (v3 app infrastructure) — run 2026-11-09-ui-v3

- Reviewer: independent REVIEWER (not implementer, not verifier); no implementation files edited.
- BASE `4c65ead4f46cf97eecffd73149a57056e505568c` → HEAD `fc8f06656a1b665913b0aeeecb19cb8278775bb6` (12 commits, 107 files, +4357/-5).
- Full patch read in 4 chunks (5030 lines): `EV/diff/U2.full.patch`; format-patch: `EV/diff/U2/` (12 .patch files).
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/u2` (clean at review time).

## Verifications run (reviewer, at HEAD)

- Scope: `git diff --name-only` filtered against allowed list → `SCOPE_CLEAN` (only `apps/desktop/src/v3/**`, `apps/desktop/src/main.tsx`, `packages/i18n/src/v3/**`, `packages/i18n/package.json` exports block). No `*-snapshots/**`, no PLAN/PROGRESS/DECISIONS, no dependency changes.
- `node scripts/check-arch.mjs` → `arch: 5 rules, 0 violations` (exit 0).
- `pnpm --filter warsha-desktop test` → **78 passed (78) test files, 584 passed (584) tests** — matches report claim exactly; `src/v3` suites green (startup 4, V3App 2, Router 5, actions 4+3, copy 9, data 87).
- `pnpm --filter warsha-desktop typecheck` → `TYPECHECK_EXIT=0`; `pnpm --filter warsha-desktop lint` → `LINT_EXIT=0`.
- Reject-on-sight sweep: no `.skip/.only/todo!/#[ignore]`, no secrets patterns, no clickable element without literal `data-action` (pages are title-only placeholders; the only `data-action` is in Router.test fixture), no >1 primary button per view, no hard-coded model/role roster in UI code (provider names appear only as mock fixtures in tests), no v2 imports.

## Packet-specific checks

1. **U2.9 / v2 isolation** — grep for `@warsha/ui` in `apps/desktop/src/v3/**` → no matches; v2 files untouched; `packages/i18n/package.json` diff is the `exports` map only.
2. **startup.ts** — onboarding only when `onboarding_complete !== 'true'`; daemon/list failure returns `{route:'/', error}` and V3App renders `role="alert"` banner inside Frame — never onboarding. 4 tests cover the 3 required cases (+last-project).
3. **Hooks** — 21 hooks in `data/index.ts`, each with a 4-state (loading/empty/ready/error + reload) test; `useRunEvents` has 7 tests incl. backoff reconnect (timer advanced, `subscribeRun` called twice), resync replacement on `resync_required|gap`, and `unsubscribeRun` on unmount.
4. **Actions** — 8 registries typed `readonly ActionDef[] = []` (empty arrays, per packet contract); duplicate-id validation; `useAction` pending/error via `notify` port (`app/toast.ts`) with asserted toast payload (type/message/actionId); `capabilities.ts` + 3 tests (daemon/provider detection).
5. **Copy/i18n** — 14 daemon stages → 5 macro phases + 4 gate question keys; 12 EventKind → `events.*` keys with `events.unknown` fallback; ar/en catalogs key-identical (asserted in `packages/i18n/src/v3/index.test.ts`); `useT` `{param}` interpolation tested; Arabic values pure (no Latin words in ar values).
6. **main.tsx** — `?ui=v3` param gate; v2 path (`LocaleProvider/BrowserRouter/App`) is the default and unchanged on invoke failure/config unset.
7. **Data-ready** — Frame `<main data-ready=...>`, asserted `'true'` in `V3App.test.tsx`.

## Findings (advisory, non-blocking)

- **A1 (main.tsx)**: besides `?ui=v3`, `Root` also switches to V3App when shell config `ui_version === 'v3'` (invoked `get_config`). v2 remains the default on unset/failed config, and this is disclosed in the report; flagging because the orchestrator check reads "?ui=v3 only". Confirm the persisted-flag path matches UI_V3_PLAN intent (or defer to the packet that writes `ui_version`).
- **A2 (capabilities)**: only `daemon` and `provider` are detected; `devices/integrations/plugins/skills/harnesses/routines/preview/backend` are hard-coded `true`. Harmless now (no UI consumes them), but later packets must not render daemon-dependent controls from these defaults (UI_V3_PLAN §6) without detection.
- **A3 (startup banner)**: banner renders the raw daemon error message with hard-coded English fallback `'Startup failure'` instead of an i18n catalog key; detail text from the daemon is acceptable, the fallback string is not catalog-managed.
- **A4 (gates)**: `i18n-gate.mjs` / `actions-gate.mjs` are not present in the worktree (frozen gate set is verifier-run per `gates.md`); reviewer could not re-run them — left to the verifier.

No reject-on-sight item, no test weakening, no out-of-scope edit found.

FINAL verdict: APPROVE
