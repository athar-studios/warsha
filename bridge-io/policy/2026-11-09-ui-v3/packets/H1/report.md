# Packet H1 Report: harness-truth

- Run: `2026-11-09-ui-v3`
- Packet: `H1` (`harness-truth`)
- Role: Implementer
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/h1`
- Branch: `run/2026-11-09-ui-v3/h1-harness-truth`
- Base commit: `4c65ead4f46cf97eecffd73149a57056e505568c`
- Head commit: `e1644cabc63d46f78a31cf50abd92961b66e0a0a`

## Changes Per Step

1. **Step 1 — Desktop stub shapes (commit `c6f1924`)**:
   - In `apps/desktop/e2e/harness.ts`: adjusted `postlaunch.crashes` and `postlaunch.reviews` to return bare arrays matching daemon serialization (`crates/warshad/src/lib.rs:3235-3266`).
   - Adjusted `backend.export` and `handoff.create` to return bare string paths (`crates/warshad/src/lib.rs:3149-3190`).
   - Adjusted `handoff.apply` to return the JSON-encoded string of `ApplyResult` (`crates/warsha-pipeline/src/handoff.rs:258-272`).
   - Removed all object-wrapped stub payloads `{ crashes: [...] }`, `{ reviews: [...] }`, `{ path: ... }`, and `{ summary: ... }`.

2. **Step 2 — Remote `runs.subscribe` fixture (commit `0562828`)**:
   - In `apps/remote/e2e/harness.ts`: adjusted `RUN_STREAM_SYNC_FIXTURE.run` to provide the daemon's honest snake_case fields (`project_id`, `current_stage`, `created_at`, `started_at`, `updated_at`).

3. **Step 3 — RPC call log & `rpcCalls` helper (commit `d36c613`)**:
   - In `apps/desktop/e2e/harness.ts`: added `rpcCalls: { method: string; params: unknown }[]` to `StubReport` and `createStubReport`.
   - Recorded every intercepted RPC call with method and params in order in `installDaemonStub`.
   - Exported `async function rpcCalls(page: Page): Promise<{ method: string; params: unknown }[]>` backed by `PAGE_RPC_CALLS` WeakMap.

4. **Step 4 — Harness contract test (commit `fca542d`)**:
   - Created `apps/desktop/src/harness.contract.test.ts` (6 tests).
   - Tested each of the five stubs (`postlaunch.crashes`, `postlaunch.reviews`, `backend.export`, `handoff.create`, `handoff.apply`) through real `WarshaClient` methods (`listCrashReports`, `listStoreReviews`, `exportBackend`, `createHandoff`, `applyHandoff`) using a fake transport routing into `rpcResult`.
   - Included negative case verifying an object-wrapped list `{ crashes: [...] }` is rejected with `Malformed RPC result from postlaunch.crashes: "crashes" is not a list`.

5. **Step 5 — Wire check W10 (commit `e1644ca`)**:
   - In `scripts/check-wire-contract.mjs`: added wire check `W10` (`remote-bench-api-without-harness-stub`), verifying every RPC dialed by `BenchApi` in `apps/remote/src/bench.tsx` has a stub reachable from `apps/remote/e2e/harness.ts`.
   - Added self-test mutation `remote-bench-api-without-harness-stub` verifying W10 detection on missing stubs.
   - Updated self-test and output summary to `wire: 10 checks, 0 violations`.
   - In `apps/remote/e2e/harness.ts`: re-exported `rpcCalls` and `RPC_METHODS` imported from desktop harness.

## Decisions & Alternatives Rejected

1. **Fake transport via global fetch in contract tests**:
   - Decision: Stubbed global `fetch` routing to `rpcResult(method, params, daemon)` in `apps/desktop/src/harness.contract.test.ts` to test actual harness stub outcomes directly through `WarshaClient`.
   - Alternative rejected: Testing `WarshaClient` methods against synthetic manual mock payloads instead of the harness stubs.

2. **Static analysis of `BenchApi` and harness imports for W10**:
   - Decision: Parsed `BenchApi` interface declarations and mapped methods to wire RPC names, resolving reachable stubs across local fixtures, declarations, and relative harness imports.
   - Alternative rejected: Runtime evaluation of browser bundle, which cannot run in offline/pre-install CLI environments.

3. **Numerical sorting of wire contract violations**:
   - Decision: Sorted violations by numeric check id (`checkNum(id)`) so W10 appears after W9 rather than between W1 and W2.
   - Alternative rejected: Lexicographical sorting (`'W10' < 'W2'`), which produced out-of-order check output.

## Measured Unit Counts

- `node scripts/check-wire-contract.mjs`: exit 0, `wire: 10 checks, 0 violations`.
- `node scripts/check-wire-contract.mjs --self-test`: exit 0, `wire self-test: 10 checks fire, clean fixture is clean in both modes`.
- `pnpm --filter warsha-desktop test`: exit 0, 474 passed across 51 test files (base 468 + 6 = 474).
- `pnpm --filter warsha-remote test`: exit 0, 221 passed across 16 test files (base 221).
- `pnpm -r typecheck`: exit 0 across all 7 workspace projects.
- `node scripts/check-arch.mjs`: exit 0, 5 rules, 0 violations.
- Git diff stat (`$BASE..HEAD`): 4 files changed, 348 insertions(+), 79 deletions(-) across 5 commits.

## Frozen Gates Verdict

- `H1.1`: Pass (exit 0, `wire: 10 checks, 0 violations`).
- `H1.2`: Pass (exit 0, `wire self-test: 10 checks fire, clean fixture is clean in both modes`).
- `H1.3`: Pass (exit 0, 474 tests passed >= 474).
- `H1.4`: Pass (exit 0, 221 tests passed >= 221).
- `H1.5`: Pass (exit 0, typecheck and check-arch green).
- `H1.6`: Pass (exit 1, no object-wrapped stubs remain in desktop harness).
- `H1.7`: Pass (exit 0, grep count = 8 >= 5).
- `H1.8`: Pass (exit 0, `rpcCalls` exported).
- `H1.9`: Pass (exit 0, only allowed 4 files modified).
- `H1.deps`: Pass (exit 1, no dependencies added or bumped).
- `H1.snap`: Pass (exit 0, `snapshot_changes=0 outside=0`).

## Left Alone (Out of Packet Scope)

None. All changes strictly confined to the four allowed files.

---

# Reviewer Report (independent review, see `review.md`)

- BASE `4c65ead` → HEAD `e1644ca`, 5 commits, 4 allowed files only; no snapshot / dependency / PLAN edits; `git status` clean.
- Verifications: `wire: 10 checks, 0 violations`; self-test `W10 … detected` + `10 checks fire`; `arch: 5 rules, 0 violations`; desktop `474 passed (474)`; remote `221 passed (221)` (contract test 6/6).
- Criteria 1–6 met for the default stubs, snake_case run fixture, `rpcCalls`, contract test, W10, scope/counts — with one blocking exception (F1): `apps/desktop/e2e/harness.ts:2164-2165` (`empty` scenario) still returns object-wrapped `{ crashes: [] }` / `{ reviews: [] }`, which the client rejects with `Malformed RPC result … is not a list`, making the postlaunch empty states unreachable under that scenario and contradicting gate H1.6. Repair: `result: []` on both lines.
- Advisories (non-blocking): remote run fixture keeps non-daemon `stage`/`started_at` keys; `StubReport.rpcCalls` is page-scoped across repeated `openScreen` while `rpcMethods` resets.

FINAL verdict: REQUEST-CHANGES

---

# Repair (Finding F1)

- Head commit: `9d7d7c911d49c7618348538c36e0af3f552a77e1` (`9d7d7c9`)
- Addressed blocking finding F1 in `apps/desktop/e2e/harness.ts`: changed `postlaunch.crashes` and `postlaunch.reviews` under `empty` scenario from object-wrapped `{ crashes: [] }` / `{ reviews: [] }` to bare `[]`.
- Verified H1.6 gate: `grep -nE "^[[:space:]]+(crashes|reviews):[[:space:]]*\[|result: \{ (path|summary):" apps/desktop/e2e/harness.ts` exits 1.
- Verified wire contract: `node scripts/check-wire-contract.mjs` prints `wire: 10 checks, 0 violations`.
- Verified desktop test suite: `pnpm --filter warsha-desktop test` passed 474/474 tests.
