# E0 review — e2e v3 support (independent reviewer, read-only)

**VERDICT: APPROVE**

- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/e0`, base `128b59c08cbf5ddbe4de002528a50f451ea74296`, head `bcb5c7a8290a2827cdc20e63832c4fb8960efc58` (matches brief's `bcb5c7a…9046` prefix), worktree clean, branch `run/2026-11-09-ui-v3/e0-e2e-v3-support`.
- Delta inspected: `git diff --name-only 128b59c… HEAD` → exactly
  `apps/desktop/e2e/v3/smoke.spec.ts` (+32), `apps/desktop/e2e/v3/support/index.ts` (+227).

## Per-point judgement

1. **Four exports — PASS.** `apps/desktop/e2e/v3/support/index.ts` exports `openV3(page, route, {lang='ar', theme='light', mode='simple', …})`, `act(page, id, {nth?})`, `expectRpc(page, method, params?, {timeoutMs, intervalMs})`, and `rpcCalls`.
   - `openV3` mirrors the v2 harness (`harness.ts:2056–2116`): viewport + `emulateMedia` + `page.clock.setFixedTime`, `installDaemonStub`/`installEventStub`, Google Fonts aborted, `addInitScript` writing `warsha.theme`/`warsha.locale` to localStorage and a `__TAURI_INTERNALS__` `invoke` stub serving `get_config` from a merged config that includes `app_mode: mode` (default `simple`), `onboarding_complete`, daemon urls/token and `ui_version: 'v3'` — then `goto('/?ui=v3#<route>')` and `locator('main[data-ready="true"]').waitFor({state:'visible'})` (awaited twice, after a hash re-assert). Same mechanism `main.tsx:24–43` uses to select v3.
   - `act` clicks `[data-action="<id>"]` with `nth`/`first()` selection — as specified.
   - `expectRpc` polls `rpcCalls(page)` every 50 ms up to 5 s, matching method + deep params (subset/array-prefix match), throws with the observed call list on timeout — a real poll, not an assert-once.
   - `rpcCalls` delegates one line to `harnessRpcCalls` imported from `../../harness` (`rpcCalls` at `harness.ts:1910`) — no re-implementation of collection/polling. Note: the frozen gate E0.2 greps for `export (async )?function (openV3|act|expectRpc|rpcCalls)` (expects 4), so a function-form delegating wrapper is the gate-conformant shape of the re-export; behavior is identical to the harness function.
   - Gate E0.2 spot-checked read-only: `grep -cE '^export (async )?function (openV3|act|expectRpc|rpcCalls)\b'` → **4**.
2. **smoke.spec.ts — PASS.** Iterates `LOCALES = ['ar','en']` × `ROUTES` from `apps/desktop/src/v3/router/routes.ts`, which contains exactly 7 `compileRoute(...)` entries (`/onboarding`, `/`, `/projects`, `/p/:projectId`, `/p/:projectId/r/:runId/:tab`, `/inbox`, `/settings/:section`) → **14 tests**. Each calls `openV3(page, concretePath(route), { lang: locale })` and asserts `expect(page.locator('main[data-ready="true"]')).toBeVisible()`; dynamic params substituted (`:projectId→proj-1`, `:runId→run-1`, `:tab→overview`, `:section→general`). No `.skip`/`.only`/`.fixme`/`test.todo` anywhere (grep exit 1); assertions target real app state, no tautologies (the `openV3` wait is a precondition, the `expect` is the checked assertion — a boot failure fails the test).
3. **Scope / style — PASS.** Diff limited to the 2 allowed files; no `harness.ts`, v2 spec, snapshot, named, gate, or dependency edits (E0.scope pattern `git diff --name-only BASE..HEAD | grep -vE '^apps/desktop/e2e/v3/(support/|smoke\.spec\.ts$)'` would be empty). No `: any` / `as any` / `any[]` / `<any>` in either file (grep exit 1); strict-safe types only (`unknown` for params, typed option interfaces).
4. **Measurement (only the one permitted) — PASS.** `pnpm --filter warsha-desktop typecheck` → script is `tsc --noEmit && tsc --noEmit -p tsconfig.e2e.json`, **exit 0** (no diagnostics). `tsconfig.e2e.json` has `include: ["e2e"]` + `files: ["e2e/harness.ts"]`, so `e2e/v3/**` is in the program. Playwright / full suite NOT run, per instruction.

## Typecheck (verbatim)

```
$ pnpm --filter warsha-desktop typecheck
> warsha-desktop@0.2.1 typecheck C:\Users\Dragonfly\Downloads\warsha-wt\v3\e0\apps\desktop
> tsc --noEmit && tsc --noEmit -p tsconfig.e2e.json

TYPECHECK_EXIT=0
```

## Findings

- **Blockers: none.**
- Non-blocking observations (no change requested): (a) `expectRpc`/`rpcCalls` type `method` as plain `string` rather than reusing harness `RpcMethod` — looser but harmless and gate-conformant; (b) `openV3` waits for `main[data-ready="true"]` twice (before and after the hash re-assert) — deliberate hash-routing guard, not a defect; (c) gate E0.3 (`pnpm exec playwright test …`), E0.4 (scope), E0.deps, E0.snap were not executed — outside the reviewer's single-measurement mandate; E0.4/E0.deps/E0.snap judged statically above.
