# R-BRIDGE-B1 — Run-scoped assistant (G1)

Status: spec frozen. Base: `bdd0c07` (repair/dev-csp-f474776). Licence wording: "free and source-available".

## Why

The v3 Workbench assistant talks to the daemon's global loop: `bench.ts` binds
`bench.assistant.send` to `agent.turn`, and `bench/index.tsx` calls
`client.agentTurn(text)` / `approveAgentMode()` / `returnAgentToPlanMode()`
with no run. The daemon retired the legacy `agent.turn` (it refuses with the
migration message, `crates/warshad/src/lib.rs:3532`); the run-scoped methods
exist (`agent.turn_run`, `agent.approve_mode` / `agent.plan_mode` /
`agent.state` with optional `run_id`, OD-E2b). The UI never sends a run id, so
two runs in one Workbench share one assistant. This packet wires the run id
through per OD-B2. No Rust.

## Goal

`agentTurn(runId, input)` with runId required; `approveAgentMode(runId?)`,
`returnAgentToPlanMode(runId?)`, `agentState(runId?)` send `run_id` only when
given. The Workbench always passes its run (`effectiveRunId`,
`bench/index.tsx:79`). `useAgent(runId)` reads that run's state and reloads
when the run changes. v2 callers (`screens/AdvancedMode.tsx:733`) stay
untouched until U7.

## Allowed files

- `packages/client/src/index.ts`, `packages/client/src/index.test.ts`
- `apps/desktop/src/v3/actions/registry/bench.ts`
- `apps/desktop/src/v3/pages/bench/index.tsx`, `apps/desktop/src/v3/pages/bench/bench.test.tsx`
- `apps/desktop/src/v3/data/useAgent.ts`, `apps/desktop/src/v3/data/useAgent.test.ts`
- `apps/desktop/e2e/harness.ts`, `apps/desktop/e2e/v3/bench.spec.ts`
- `docs/DAEMON.md`, plus the packet report. No Rust.

## Out of scope

Daemon or wire-shape changes; `gates.evidence` (B2); MCP (B3); v3 default
(B4a); preview (B5); v2 callers. No test weakening: every claim stays 1:1.

## Steps

1. Client per OD-B2: `agentTurn(runId, input)` → method `agent.turn_run` with
   params `{ run_id, input }`; `approveAgentMode(runId?)` /
   `returnAgentToPlanMode(runId?)` / `agentState(runId?)` send `run_id` only
   when given, omit otherwise. Update the three-methods test at
   `packages/client/src/index.test.ts:805` (it pins the old shapes, so it
   must change with them — new assertions: `agent.turn_run` + `{ run_id,
   input }`; mode/state calls carry `run_id` when given, omit when not).
2. `bench.ts:23` binds `agent.turn_run`; the three assistant handlers in
   `bench/index.tsx` pass the route's run id (`effectiveRunId`).
   `useAgent(runId)` reads that run's state and reloads when the run changes.
3. `harness.ts`: add an `agent.turn_run` stub shaped like the daemon answers;
   the `agent.turn` case returns the daemon's real refusal text so a
   regression is loud.
4. `bench.spec.ts:123,127,135,325,331,337` assert the run-scoped method and
   the `run_id` param. Bench test: render two runs in turn and prove
   approve-mode for run A sends A's id and never B's. The daemon-side
   isolation is already pinned by e2_wiring; re-run it and quote the count.
5. `docs/DAEMON.md`: rows for `agent.turn` (retired, refuses),
   `agent.turn_run`, `agent.approve_mode`, `agent.plan_mode`, `agent.state`,
   copied from the trait signatures (`lib.rs:814-830`).
6. Discrimination: the new client and bench tests fail on the base commit
   (`git stash` the fix, run, save output, restore); pass on the new code.

## Acceptance (frozen gate table excerpt; full table in §7 of the run brief)

- Client tests assert method `agent.turn_run` and params `{ run_id, input }`,
  and that each of the three mode/state calls carries `run_id` when given
  and omits it when not.
- Bench two-runs test proves run-A approval sends A's id and never B's.
- `grep -rn "'agent.turn'" apps/desktop/src/v3 packages/client/src` returns
  nothing outside tests that assert the refusal.
- T1 fmt 0; T2 clippy 0 (no Rust touched — quote from this merge);
  T9 `pnpm lint && pnpm typecheck && pnpm -r test && pnpm build` 0 with
  counts not below baseline; T10 action/i18n checks 0; wire 11/0 quoted
  (no wire shape touched — report not re-run).

## Constraints

Small Conventional Commits on a `zl-b1-*` worktree from `bdd0c07`;
implementer never authors gates; reviewer separate, never edits; verifier
separate, never repairs; no force push/tag/publish; mock provider only.
