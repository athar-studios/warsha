# Served RPC inventory — core set for U3/U4 (run 2026-11-09-ui-v3)

Read-only research at integration tip `4c65ead` (daemon/client/plan files byte-identical to that tip;
handlers all in `crates/warshad/src/lib.rs`; `wave2.rs` holds no RPC handler for this set).
Param names are the wire field names (jsonrpsee `ParamsObject`: serde rename = Rust snake_case arg,
plus a generated lowerCamelCase alias — `jsonrpsee-proc-macros` 0.26.1 `render_server.rs:411-421`,
so both `{run_id}` and `{runId}` deserialize).

| method (exact string) | served? | handler file:line | params (field names) | result (field names) | stream/subscribe |
| --- | --- | --- | --- | --- | --- |
| `agent.turn` | yes | `crates/warshad/src/lib.rs:3281` (trait `:1402`) | `input: string` | `AgentTurnResult { mode: "plan"\|"agent", mentions[], command?, response, todos[], tools[] }` (`warsha-pipeline/src/agent_loop.rs:207`) | no |
| `agent.plan_mode` | yes | `crates/warshad/src/lib.rs:3316` (`return_agent_to_plan`; trait `:1408`) | none | `ModeTransition { from, to, approved_by, approved_at }` (`warsha-pipeline/src/agent_workflow.rs:136`) | no |
| `agent.approve_mode` | yes | `crates/warshad/src/lib.rs:3307` (`approve_agent_mode`; trait `:1405`) | none | `ModeTransition { from, to, approved_by, approved_at }` | no |
| `agent.state` | yes | `crates/warshad/src/lib.rs:3321` (trait `:1411`) | none | `AgentState { mode, approvals[ModeTransition], todos[], model_wired }` (`lib.rs:1873`) | no |
| `runs.start` | yes | `crates/warshad/src/lib.rs:2424` (trait `:1227`) | `project_id: string`, `idea: string` | `Run { id, project_id, current_stage, gate_states{}, artifacts{}, created_at, updated_at, status, budget_cents?, spent_cents }` (`warsha-core/src/lib.rs:223`) | no |
| `runs.followup` | yes | `crates/warshad/src/lib.rs:3848` (trait `:1550`) | `run_id: string`, `prompt: string` | `Run` (same shape) | no — writes an `AgentStep` event that later rides `/events` |
| `runs.advance` | yes | `crates/warshad/src/lib.rs:3756` (trait `:1537`) | `run_id: string` | `Run` | no |
| `runs.subscribe` | yes | `crates/warshad/src/lib.rs:3732` (trait `:1525`); WS twin command `lib.rs:6606` | `run_id?: string\|null`, `since_seq?: number\|null` | `RunStreamSync { seq, gap_detected, resync_required, dropped_count, run?, events[] }` where each event = `{ seq, gap_detected, dropped_count, resync_required, ...Event }` flattened (`lib.rs:201`, `:183`) | **replay/resync RPC only** (one-shot, not a jsonrpsee subscription); live push is the `/events` WebSocket, which accepts the same `runs.subscribe`/`runs.unsubscribe` socket commands |
| `runs.artifacts` | yes | `crates/warshad/src/lib.rs:3914` (trait `:1554`) | `run_id: string` | `Vec<Artifact { name, content, stage, role?, created_at, updated_at, version }>` (`warsha-core/src/lib.rs:248`) | no |
| `gates.list` | yes | `crates/warshad/src/lib.rs:2565` (trait `:1289`) | `run_id: string`, `device_id?: string\|null` (legacy slot, ignored on this read) | `Vec<GateSummary { stage, state }>`; `state` is tag-`state` snake_case: `pending` \| `approved{by, at}` \| `rejected{reason, by, at}` \| `changes_requested{notes, by, at}` (`lib.rs:1825`, `:1834`) | no |
| `gates.approve` | yes | `crates/warshad/src/lib.rs:2515` (trait `:1248`) | `run_id: string`, `stage: Stage`, `device_id?: string\|null` (validated against session, mismatch → `-32003`) | `Run` | no |
| `gates.reject` | yes | `crates/warshad/src/lib.rs:2531` (trait `:1256`) | `run_id: string`, `stage: Stage`, `reason: string`, `device_id?: string\|null` (same session check) | `Run` | no |

Client wrappers (`packages/client/src/index.ts`) use these exact method strings
(`:1531, :1597, :1611, :1626, :1632, :1653, :1657, :1662, :1815, :1819, :1823, :1828`).
Two wrappers send camelCase field names — `runs.start` `{projectId, idea}` and `gates.list` `{runId}` —
which the daemon accepts through jsonrpsee's generated camelCase alias; not wire mismatches.
No method in this set is unserved. `Stage` wire values are snake_case (`idea`, `gate_a`, …, `feedback`,
`warsha-core/src/lib.rs:74`).
