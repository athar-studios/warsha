# R-EXT-2 — Agent-tool round trip: spawn agent → MCP tool call → events → approval in the UI (X7 as the owner scoped it) · after R-EXT-1

Status: spec frozen. Base: `e65074a` (repair/dev-csp-f474776, R-EXT-1 merged). Planner lane. Pattern:
R-BRIDGE-B5 / R-BRIDGE-B3b. Licence wording: "free and source-available".
**Rust: yes, additive and small. New RPC method: no. New wire *method*: no. New `EventKind` variant: yes.**

> Scope note. `R-UI-RUN-PLAN.md` row 7 names R-EXT-2 "X7 plugin bundle round trip". The owner's brief for this
> packet is the agent-tool round trip (and G1 `run_finished`). The plugin round trip is **not** in this packet;
> it keeps its plan row and must be renumbered (suggest R-EXT-2b) when the plan is next edited. Not done here.

## Why (measured at e65074a)

- **A real agent MCP call writes no event.** `PreparedTurn::call_mcp_tool`
  (`warsha-pipeline/src/agent_loop.rs`, ~l.925) calls `mcp.call_tool(...)` and renders a `ToolResult` into the turn
  response; there is no `append_event` in `agent_loop.rs`, and `AgentLoop` holds no store/event sink (fields:
  router, mcp, mcp_permissions, mcp_approvals, run_id, backend_kit). `EventKind::ToolCall` is constructed in exactly
  one place: `warshad/src/mcp_approvals.rs:115` (`allow_once_event`, payload `action: mcp_allow_once`, no
  arguments). So `subscribeRun`/`useRunEvents` shows the owner's *approval*, never the *call* or its outcome. The UI
  filters already expect the kind (`pages/bench/tabs/TerminalTab.tsx` l.20; `pages/project/index.tsx` l.444 hides
  `tool_call` in simple mode; `copy/events.ts` l.11) — they render nothing real today.
- **`stage_completed` is declared but never emitted.** `EventKind` (`warsha-core/src/lib.rs:275`) has `StageStarted,
  StageCompleted, GateDecision, AgentStep, ToolCall, ArtifactCreated, ArtifactUpdated, CostRecorded, Error, Fallback,
  BudgetWarning, BudgetExceeded`. Constructors found by grep: `StageStarted` (pipeline lib.rs 1338/1370/1393/1413),
  `GateDecision` (1814/1870/1927), `AgentStep` (905, 1589; `warshad/src/events.rs`), `ArtifactCreated` (1969),
  `CostRecorded` (2003), `Error`. **No constructor of `StageCompleted`, `ToolCall` (pipeline), or any run-end
  kind.**
- **G1 (R-UI-3 report l.96–104): there is no `run_finished` kind.** A run ends only by `RunStatus` flipping to
  `Completed` (pipeline lib.rs ~1200, Feedback stage), `Failed` (~1113) or `Cancelled` (`runs.cancel`). Nothing is
  appended to the log, so the sound-cue/inbox code can only learn it by re-polling `runs.list` (the "edge-driven off
  a load that only re-runs when the project list changes" caveat). `RunSummary` (`client/src/index.ts:75`) carries
  `status: string` only.
- **Approval half already exists end to end** (do not rebuild): `mcp.approvals.list` / `mcp.approvals.allow_once`
  (api.rs, `auth.rs:615/620`), Inbox wiring (`pages/inbox/index.tsx`, `Inbox.test.tsx`, e2e `inbox.spec.ts`
  `mcpApprovalCase`), per-tool permissions in Settings → Connections (R-EXT-1). Gate decisions (`gate_decision`)
  are approved in the bench UI. The missing link is *observability after the answer*: the owner approves, the agent
  calls, and nothing says what happened.
- **Spawn path exists:** `runs.start` registers a per-run `AgentLoop` (`warshad/src/lib.rs` ~l.358,
  `agent_sessions.insert`), `agent.approve_mode{run_id}` → `agent.turn_run{run_id,input}` (client
  `index.ts:2237/2242`, registry `bench.assistant.send`, `bench.assistant.mode.agent`). The Rust-side proof harness
  precedent is `ApprovalMcp` in `warshad/src/tests/mod.rs:5348` (records calls, no process).
- **Wire gate coverage of events: none.** `check-wire-contract.mjs` W1–W11 compare JSON-RPC *method names*, policy
  rows, params names, harness stubs and CSP. `EventKind` on the client is `export type EventKind = string`
  (`index.ts:375`); the daemon→client event payload is not parsed by any gate. A new kind therefore cannot trip
  `wire:`; the only guards are the Rust compiler (no exhaustive `match` on `EventKind` found by grep in
  `crates/`) and tests.
- **Storage:** `warsha-store` writes `serde_json::to_string(&event.kind)` (lib.rs:591) and reads it back with
  `serde_json::from_str::<EventKind>` (l.990). A new variant is additive for new binaries, but an **older binary
  reading a DB that already holds a `run_finished` row fails to decode that run's events** (downgrade hazard). Name
  it in DECISIONS.md; there is no migration (the column is text).

## Goal

1. An agent MCP tool call is visible as events on the run's stream: what was requested, whether it needed approval,
   and its outcome — arguments never included.
2. A run's end is one event, `run_finished`, so every client learns it from the stream (closes G1).
3. The bench surfaces both: Terminal tab shows tool-call lines (server.tool, outcome); a finished run is shown from
   the event. Proven end to end against a stub MCP: spawn run → approve Agent mode → tool call hits `ask` →
   pending approval → `allow_once` → call executes → events show requested → approval_required → allow_once →
   succeeded → (run ends) → `run_finished`.

## Frozen design

### Rust-vs-TS verdict: **Rust required** (A) + TS consumption (B)

Reason: (1) no event is emitted at the MCP call site and the loop has no sink; (2) a new `EventKind` variant is a
`warsha-core` change. A TS-only packet cannot make either true. Scope kept to the minimum: no new RPC, no schema
migration, no transport change.

**A1 — `EventKind::ToolCall` for MCP calls (existing kind, new emitters).** Add to `warsha-pipeline` a small seam
`McpCallObserver` (trait, `Send + Sync`): `fn record(&self, run_id: &str, event: McpCallEvent)`. `AgentLoop` gets
`with_mcp_observer(Arc<dyn McpCallObserver>)`; `call_mcp_tool` / `ask_for_approval` / the permission-deny branch call
it with `McpCallEvent { phase: Requested | ApprovalRequired | Denied | Succeeded | Failed, server, tool,
question_id? }`. No arguments, no result text, no summary in the event (same rule as `allow_once_event`: server,
tool, role, question_id). The daemon implements the observer in `warshad` (new small module beside
`mcp_approvals.rs`) by building an `Event { kind: ToolCall, payload: { action: "mcp_call", phase, server, tool,
role, question_id? } }` and `store.append_event` (which already publishes on the live bus, `startup.rs:248`). The
observer is injected in `runtime.rs` where the per-run loop is built (l.~101–125). Layering: pipeline defines the
trait, warshad implements — no pipeline→warshad edge (R2); same pattern as `StoreRunLiveness` (B5) and the
`ArgumentSummarizer` seam. A loop without an observer (unit tests, daemon-wide loop) behaves as today.
Failure to append must not fail the call: log a warning, continue (the audit-before-grant rule of `allow_once`
is unchanged and stays fail-closed).

**A2 — `EventKind::RunFinished` (new, last variant, serde name `run_finished`).** Appended exactly once on each
transition of `RunStatus` into `Completed`, `Failed` or `Cancelled`, payload `{ "status": "completed|failed|
cancelled" }`, `role: None`, `stage` = the stage at the transition, `device_id` = the authenticated device for
`runs.cancel`, else `None`. Emission sites are enumerated by `grep -n "RunStatus::\(Completed\|Failed\|Cancelled\)"
crates/warsha-pipeline/src crates/warshad/src` and each is either covered or listed in the report as not a
transition (e.g. a re-read). Idempotency: written inside the same CAS-guarded update that sets the status (the
`update_run_cas` branch), so a lost CAS race writes nothing and a second advance cannot duplicate it (test T6).
`Paused` is **not** terminal and emits nothing. `StageCompleted` stays declared-but-unemitted: out of scope
(a separate packet; noted so nobody assumes this one fixed it).

**Wire verdict:** no new method, no params change, no policy row. `scripts/check-wire-contract.mjs` → `wire: 11
checks, 0 violations` unchanged (it does not read events; stated, not assumed — verify by running it).
`check-arch.mjs`: no new crate edge (R2 intact). `docs/DAEMON.md` gets an "Event kinds" note (`run_finished`,
`tool_call` payload shapes) because no gate would catch drift there.

**B — TS/UI (consumption only; `EventKind` stays `string`).**
- `packages/client`: export `RUN_FINISHED_KIND = 'run_finished'` and a typed decoder helper
  `decodeRunFinished(event): 'completed'|'failed'|'cancelled'|null` (null for any other kind; unknown status →
  null, never a default) and `decodeMcpCall(event)` for `{phase, server, tool}`; unit-tested. No new RPC wrapper.
- Bench `TerminalTab`: `tool_call` lines render from `decodeMcpCall` ("server · tool — phase") with an
  approval-pending phase pointing at the Inbox; text rendered as text, `dir="ltr"` on server/tool tokens. The
  existing filter list (`tool_call|tool_result|agent_step|error`) is kept; `run_finished` shown as one status line.
- `copy/events.ts` + i18n `events.run_finished` and `events.tool_call.phase.*` in **ar and en**.
- Project page simple mode keeps hiding `tool_call` (unchanged), but shows `run_finished` as the run's end line.
- Sound-cue source (`soundCues.ts`) is **not** rewired here (R-UI-3 follow-up, out of scope); the packet only makes
  the signal available and records in the report that the cue may now key off `run_finished`.
- e2e: harness stub for `runs.events`/`runs.subscribe` fixtures carrying the new events (no new method name).

### Stub MCP fixture

A real stdio stub is needed only for the Rust end-to-end test. Reuse the in-process `McpManager` double pattern
(`ApprovalMcp`, `tests/mod.rs:5348`) — no new process, no network, no model API (mock provider; the turn input is
the `call tool` request form the loop already parses, `parse_tool_request`, so no model is involved). If a real
stdio round trip is wanted, it belongs to a later packet; this one does not spawn processes.

## Allowed files

- `crates/warsha-core/src/lib.rs` (the one enum variant + serde test)
- `crates/warsha-pipeline/src/agent_loop.rs`, `crates/warsha-pipeline/src/lib.rs` (terminal-transition event only),
  new `crates/warsha-pipeline/src/mcp_observer.rs` (+ `mod`/`pub use` line)
- `crates/warshad/src/runtime.rs`, `crates/warshad/src/lib.rs` (cancel/terminal `runs.advance` arms only),
  new `crates/warshad/src/mcp_call_events.rs`, `crates/warshad/src/tests/mod.rs` (new tests only)
- `packages/client/src/index.ts`, `packages/client/src/index.test.ts`
- `apps/desktop/src/v3/pages/bench/tabs/TerminalTab.tsx` (+ its test), `pages/bench/helpers.ts`,
  `pages/project/index.tsx` (run_finished line only), `apps/desktop/src/v3/copy/events.ts`
- `packages/i18n/src/v3/{ar,en}/common.ts` (or the file that owns `events.*`)
- `apps/desktop/e2e/harness.ts` (event fixtures only), `apps/desktop/e2e/v3/` new `agent-tool.spec.ts`
- `docs/DAEMON.md`, `DECISIONS.md` (downgrade hazard), `PROGRESS.md`, `docs/zadloop/packets/R-EXT-2-report.md`

## Out of scope

B4b, B6, Stage B; `StageCompleted` emission; wiring sound cues/inbox to `run_finished`; the plugin round trip
(`plugins.*`, plan row 7); X3 HTTP/WebSocket MCP; X5 registry; real stdio server in tests; new RPC methods or a
changed method shape; arguments/results in any event payload; changing `ToolPermission` / approval semantics or
the `allow_once` audit event; store schema or migration; `mcp.send` UI; changing `check-*` gate tools; baselines.

## Constraints

- Rust: stable, no `unwrap()`/`expect()` outside tests, errors via `thiserror`/`anyhow`; `cargo fmt`, clippy
  `-D warnings`.
- **No secret, argument, tool output or approval summary in any new event payload** (T4 asserts the payload key set
  exactly, as the `allow_once` test does at `tests/mod.rs:5547`).
- `ToolCall` appends never block or fail a tool call; `run_finished` append failure surfaces as the existing store
  error path (it is inside the CAS update).
- Exactly one `run_finished` per run, ever; `Paused`/`Running` never emit it.
- UI strings via catalogs (ar+en, same key set); RTL-safe logical CSS; tokens only; LTR tokens `dir="ltr"`.
- Server-supplied text rendered as text; no `any`; `EventKind` stays `string` on the client.
- Every new test must fail on `e65074a` and pass on the new code; save before/after under
  `target/discrimination/r-ext-2/` (≥ 2 artifacts: (i) revert A1 call-site emit → T1/T2 red; (ii) emit
  `run_finished` outside the CAS branch → T6 duplicate red).
- Small Conventional Commits on an `r-ext-2-*` branch; implementer ≠ reviewer ≠ verifier; no force push, tag,
  publish; mock provider only; `client/src/index.ts` and `harness.ts` are shared — one lane at a time.

## Tests (T-numbered)

- T1 (Rust, daemon): agent in Agent mode, MCP permission `Allow` → one `tool_call` with phases `requested` then
  `succeeded`; the double saw one call.
- T2: permission `Ask` → `requested`, `approval_required` (+`question_id`), double saw **zero** calls; after
  `allow_once` and a second turn → `succeeded`; order is store `seq` order.
- T3: permission `Deny` → `denied`; zero calls. Transport error → `failed`.
- T4: payload key set for every phase is exactly `action, phase, server, tool, role[, question_id]`; SECRET_ARGS
  from the B3b fixtures appear nowhere in any event.
- T5: no observer attached → turn behaves as before (existing agent_loop tests unchanged and green).
- T6: run reaches Feedback → exactly one `run_finished{status:completed}`; a second `advance` / replayed CAS
  loser adds none. `runs.cancel` → one `{cancelled}`; failure path → one `{failed}`; paused → none.
- T7: `EventKind` serde round trip of `run_finished`; an unknown kind string still errors (no silent default).
- T8 (events stream): `events_ws_live`-style test — an open socket receives `tool_call` and `run_finished`.
- T9 (TS unit): decoders accept the shapes, return null/throw on others; TerminalTab renders the phases; ar+en keys.
- T10 (e2e `@non-visual`): fixtures drive the Terminal tab to show requested → approval-required → succeeded and
  the run-finished line; one `dir=rtl` case.

## Steps

1. Grep the terminal-transition sites; write T6/T1/T2 first (red on base, save output).
2. `EventKind::RunFinished` + serde test; pipeline `mcp_observer.rs`; `AgentLoop::with_mcp_observer`; emit at the
   call sites; daemon implementation + injection in `runtime.rs`.
3. `run_finished` at each terminal transition inside the CAS branch; cancel path in `warshad`.
4. Run Rust gates; run `check-wire-contract.mjs` and confirm 11/0 unchanged.
5. Client decoders + bench/project UI + i18n + harness fixtures + e2e.
6. DAEMON.md event note, DECISIONS.md downgrade-hazard entry, PROGRESS.md, discrimination, report.

## Gates (exact; repo root; `TOOLS=bridge-io/policy/2026-11-09-ui-v3/tools`)

Rust (touched):
- `cargo fmt --all --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace --all-targets`
- `cargo test -p warshad --test events_ws_live`
- `cargo deny check`
- `node scripts/check-arch.mjs` and `--self-test` (exit 0); `node scripts/check-wire-contract.mjs` → `wire: 11
  checks, 0 violations`, and `--self-test` exit 0; `node scripts/check-engineering-policy.mjs` exit 0.
- `git grep -nE "In real implementation|mock proposals|MockRoutineRunner::new" -- crates ":!**/tests/**"` prints
  nothing.

TypeScript:
- `pnpm lint`, `pnpm typecheck`, `pnpm -r test`, `pnpm build` all 0 (counts ≥ R-EXT-1 report baseline).
- `node scripts/check-ds-v3.mjs apps/desktop/src/v3 packages/ui/src/v3 apps/remote/src` → 0 violations.
- `node $TOOLS/i18n-gate.mjs "$PWD"` 0; `node $TOOLS/actions-gate.mjs "$PWD"` 0; `node $TOOLS/contrast.mjs
  --check-css packages/ui/src/v3/tokens/tokens.css` 0.
- `pnpm exec playwright test --project=desktop apps/desktop/e2e/v3 --grep-invert "@visual"` → 0 failed, passed ≥
  R-EXT-1 baseline + new cases.

## Acceptance

- An agent MCP tool call yields `tool_call` events (phases above) on `runs.subscribe`/`runs.events`, arguments absent.
- A finished run yields exactly one `run_finished`; the bench shows both from the event stream.
- Round trip proven in Rust (T1–T3, T8) and e2e (T10): ask → pending → `allow_once` → call → success → finish.
- Wire gate 11/0 unchanged; arch gate green; Rust gates green and named in the report with the command output.
- Report states: `StageCompleted` still unemitted; sound cues not rewired; downgrade hazard logged; plugin round
  trip untouched.

## Open points (defaults applied)

- OD-EXT2-a: observer trait vs giving `AgentLoop` a store handle. Default observer (keeps pipeline free of a store
  dependency in the loop; mirrors B5). Reject direct store: widens `AgentLoop`'s constructor used by ~20 tests.
- OD-EXT2-b: one `run_finished` kind with `status` payload rather than three kinds (less enum surface; client
  decodes the status).
- OD-EXT2-c: fold `StageCompleted` in? Default no — different consumers, separate acceptance.
