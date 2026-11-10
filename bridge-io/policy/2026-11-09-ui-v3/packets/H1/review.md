# Review — packet H1 (harness-truth) — run 2026-11-09-ui-v3

- Role: independent REVIEWER (no implementation edits)
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/h1` (clean at review time)
- BASE `4c65ead4f46cf97eecffd73149a57056e505568c` → HEAD `e1644cabc63d46f78a31cf50abd92961b66e0a0a` (5 commits)
- Full diff: `EV/diff/H1.full.patch` (640 lines); format-patch: `EV/diff/H1/0001..0005*.patch`

## Checks performed (verbatim outputs)

- `node scripts/check-wire-contract.mjs` → `wire: 10 checks, 0 violations` (exit 0) — summary exactly as required.
- `node scripts/check-wire-contract.mjs --self-test` → `self-test W10 remote-bench-api-without-harness-stub/remote-bench-api-without-harness-stub: detected`, `wire self-test: 10 checks fire, clean fixture is clean in both modes` (exit 0) — W10 planted violation fires.
- `node scripts/check-arch.mjs` → `arch: 5 rules, 0 violations` (exit 0).
- `pnpm --dir apps/desktop exec vitest run` → `Test Files 51 passed (51) / Tests 474 passed (474)` — matches expected 474; includes `src/harness.contract.test.ts (6 tests)`.
- `pnpm --dir apps/remote exec vitest run` → `Test Files 16 passed (16) / Tests 221 passed (221)` — matches expected 221.
- `git diff --name-only 4c65ead..e1644ca` → exactly the 4 allowed files: `apps/desktop/e2e/harness.ts`, `apps/remote/e2e/harness.ts`, `scripts/check-wire-contract.mjs`, `apps/desktop/src/harness.contract.test.ts` (new). No snapshot, no PLAN/PROGRESS/DECISIONS, no dependency changes, no skip/todo, `git status` clean.

## Judge criteria

1. **Five stub shapes vs daemon ground truth — PASS (defaults).** `crates/warshad/src/lib.rs:3233-3266` returns `RpcResult<Vec<CrashReport>>` / `RpcResult<Vec<StoreReview>>` (bare arrays); `lib.rs:3149-3190` `export_backend`/`create_handoff` return `RpcResult<String>` (bare string paths); `apply_handoff` returns `RpcResult<String>` via `serde_json::to_string(&result)` (JSON-encoded string of `ApplyResult`, `crates/warsha-pipeline/src/handoff.rs:258-272`). The five default stubs in `apps/desktop/e2e/harness.ts` now match exactly, with realistic non-empty fixtures (two crashes / two reviews with Arabic + English bodies, non-empty `applied`/`backups`, `backup_dir`). See Finding 1 for a remaining exception.
2. **remote `runs.subscribe` run snake_case — PASS.** `RUN_STREAM_SYNC_FIXTURE.run` now uses `project_id`, `current_stage`, `created_at`, `started_at`, `updated_at`, `status` (was `projectId`/`startedAt`/`updatedAt`). See advisory A1.
3. **`rpcCalls` exported — PASS.** `StubReport.rpcCalls` records `{method, params}` pushed in wire order alongside `rpcMethods`; `rpcCalls(page)` exported from desktop harness and re-exported by `apps/remote/e2e/harness.ts`. See advisory A2.
4. **Contract test — PASS.** `apps/desktop/src/harness.contract.test.ts` feeds all five stubs through the real `WarshaClient` with a fake `fetch` transport routing into `rpcResult`, plus one negative object-wrapped case asserting `Malformed RPC result from postlaunch.crashes: "crashes" is not a list` (message verified against `packages/client/src/index.ts` `wiringArray`). 6/6 green.
5. **W10 — PASS.** W10 registered, `parseBenchApi` + reachable-stub resolution added, self-test mutation plants `startRun` → `runs.start` and is detected, output contract updated to 10 checks, numeric sort keeps W10 after W9.
6. **Scope/counts — PASS.** Only the 4 allowed files; no snapshot touched; desktop 474 / remote 221 as expected.

## Findings

**F1 (blocking) — object-wrapped postlaunch stubs remain in the `empty` scenario.**
`apps/desktop/e2e/harness.ts:2164-2165` still has

- `'postlaunch.crashes': { result: { crashes: [] } }`
- `'postlaunch.reviews': { result: { reviews: [] } }`

The daemon returns bare arrays and `WarshaClient.listCrashReports/listStoreReviews` go through `wiringArray`, which throws `Malformed RPC result from postlaunch.crashes: "crashes" is not a list` for an object wrapper — the exact defect class this packet fixes, in an allowed file, and it contradicts gate claim H1.6 ("no object-wrapped stubs remain") and step 1 of the implementer report ("Removed all object-wrapped stub payloads"). Consequence: under the `empty` scenario the crash-reports / store-reviews screens render the malformed-error path instead of their empty state (§7 empty state unreachable; the next capture of those screens would be wrong). Repair: `result: []` on both lines (daemon-true bare empty arrays). Non-empty scenario fixtures were fixed; only these two empty overrides were missed.

**A1 (advisory, non-blocking)** — the remote run fixture keeps `stage` and `started_at`, which `warsha_core::Run` (`crates/warsha-core/src/lib.rs:223-234`) does not serialise (it has `project_id`, `current_stage`, `created_at`, `updated_at`, `status`, …). Snake-case criterion is met and the client prefers the real keys first, so nothing fails today, but the extra fallback keys can mask a future client field-read regression. Consider dropping them.

**A2 (advisory, non-blocking)** — `StubReport.rpcCalls` is aliased into the page-scoped `PAGE_RPC_CALLS` WeakMap: a second `openScreen` on the same page inherits prior calls in `report.rpcCalls` while `report.rpcMethods` resets. `rpcCalls()`'s doc comment says "for this page", so the helper semantics are consistent; just note that `rpcMethods` and `rpcCalls` scopes differ across repeated opens on one page.

## Verdict

FINAL verdict: REQUEST-CHANGES

Repair item for the implementer: F1 only (two lines in `apps/desktop/e2e/harness.ts`). A1/A2 are notes, not required repairs.

## Re-review (repair 9d7d7c9)

- Worktree `C:/Users/Dragonfly/Downloads/warsha-wt/v3/h1`, repair commit `9d7d7c9` (parent `e1644ca`), BASE `4c65ead` → HEAD `9d7d7c9` (5+1 commits). Checks verbatim:
- `git show 9d7d7c9` (21 lines) → edits **only** `apps/desktop/e2e/harness.ts`, hunk `@@ -2161,8 +2161,8 @@`, exactly two replacements: `-      'postlaunch.crashes': { result: { crashes: [] } }` / `+      'postlaunch.crashes': { result: [] }` and the `postlaunch.reviews` twin; no other change.
- `grep -nE "^[[:space:]]+(crashes|reviews):[[:space:]]*\[|result: \{ (path|summary):" apps/desktop/e2e/harness.ts` → **empty output, exit 1** — no object-wrapped stub remains (F1 closed). Remaining `result: {` occurrences all belong to object-returning methods (`runs.subscribe` frames, `agent.state`, `models.add`, …), none to list-returning RPCs; `apps/remote/e2e/harness.ts` has zero `result: {`.
- `node scripts/check-wire-contract.mjs` → `wire: 10 checks, 0 violations` (exit 0).
- `pnpm --filter warsha-desktop test` → `Test Files 51 passed (51)` / `Tests 474 passed (474)` (exit 0), includes `src/harness.contract.test.ts (6 tests)`.
- Scope: `git log --name-only 4c65ead..9d7d7c9` shows only the 4 allowed H1 files across all six commits; no snapshot, no deps (`pnpm-lock.yaml`/`package.json`/`Cargo.*` 0 hits), no PLAN/PROGRESS/DECISIONS; `git status --porcelain` empty (clean).
- Patch set refreshed: `EV/diff/H1/0001..0006*.patch` (0006 = repair commit).
- A1/A2 remain advisory, unchanged and not required as repairs.

FINAL verdict: APPROVE
