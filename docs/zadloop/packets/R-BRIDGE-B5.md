# R-BRIDGE-B5 — per-run preview (G5, U7 second half)

Status: spec frozen. Base: `31973cf` (repair/dev-csp-f474776). Depends on B4a
(done). Licence wording: "free and source-available".

## Why

The live preview is keyed by **project**, not by run: `LivePreviewManager`
holds `Mutex<Vec<(String, PreviewEntry)>>` (`process_spawn.rs:1080`) where the
key is the project string; the daemon RPCs `start_preview` / `stop_preview` /
`preview_status` (`warshad/src/lib.rs:3512-3560`) all take `project_id` only.
Nothing stops a run's dev server when the run ends — `runs.advance`'s terminal
arm (lib.rs:3850-3858) purges MCP approvals but never touches previews, and
`runs.cancel` (lib.rs:3870-) neither. A second run on the same project inherits
(or collides with) the first run's server: the preview is ambient, not owned.
The owner authorised one preview per run that dies with its run (OD-U7 = yes).

## Goal

A run owns its preview: starting a run with a preview command registers the
server under the run id; the run's end (terminal `runs.advance`:
`Completed`/`Failed`/`Cancelled`, plus `runs.cancel`) stops the server it owns;
`preview_status` answers for the calling run's server. A new run on the same
project starts clean — never inherits a live server from a dead run.

## Measured inputs (2026-11-14, base `31973cf`)

- `LivePreviewManager::start(&project_id, &command)` → `LivePreview
  { project_id, process_id, command, args, status, url }`; `stop(&project_id)`;
  `status(&project_id)` re-reads the transcript. `PreviewEntry { process_id }`
  only — no owner field today (this packet adds the run link).
- `process_spawn.rs` has NO worktree concept (grep: none) — the run link is a
  plain run-id string on the entry, not a path.
- `runs.cancel` hook pattern (lib.rs:3881) and terminal-advance hook
  (lib.rs:3856-3858, added by B3a-M1) are the two purge sites to mirror.

## Design (frozen decisions)

- **D1 (keying):** the manager entry gains `run_id: Option<String>`; `start`
  takes an optional run id. Keying stays `(project)` for lookup; the run id is
  ownership metadata, not a second key. Rationale: project-scoped status calls
  keep working; ownership answers "whose server is this".
- **D2 (stop on close):** terminal `runs.advance` + `runs.cancel` call
  `previews.stop_run(&run_id)` (new method: stop every entry owned by the run,
  drop them). Best-effort: a stop failure is logged, never fails the run close.
- **D3 (no steal):** `start` with a run id on a project that already has a
  LIVE server owned by another LIVE run is refused with a typed error
  (`PreviewOwnedByRun`). A dead run's entry never blocks: entries whose run is
  terminal are stopped+dropped lazily on the next `start`/`status` for the
  project. Rationale: exact-args-style determinism is impossible for servers;
  liveness + ownership is the checkable rule.
- **D4 (status scoping):** `preview_status` keeps its shape; when called in a
  run context it reports the run's server, else the project's. No new RPC
  method — wire stays frozen (OD-B2).
- **D5 (restart):** previews stay in-memory only (like MCP grants, T10
  precedent) — a restart starts clean. Documented, tested.

## Allowed files

- `crates/warsha-pipeline/src/process_spawn.rs` (+ its `#[cfg(test)]` module),
  `crates/warshad/src/lib.rs` (the two hook sites + RPC bodies only),
  `docs/DAEMON.md` (preview rows), plus the packet report. No client, no UI,
  no harness, no wire files.

## Out of scope

New RPC methods; worktree-path previews; port management changes; touching the
MCP approval code except calling the same two hook sites; v2 code.

## Steps

1. Entry gains `run_id`; `start(project, command, run_id: Option<&str>)`;
   `stop_run(&run_id)`; lazy sweep of dead-run entries on `start`/`status`.
2. Wire both hook sites (advance-terminal + cancel) best-effort.
3. `preview_status` run-scoping per D4.
4. Tests T1–T6 (below) + DAEMON.md rows + report.

## Acceptance (frozen)

- T1 `second_run_never_inherits_a_live_server`: run A starts a preview; run B
  on the same project with a live A-server is refused (`PreviewOwnedByRun`).
- T2 `terminal_advance_stops_the_owned_server`: A completes → process stopped,
  entry dropped; `status` reports none.
- T3 `cancel_stops_the_owned_server`: same via `runs.cancel`.
- T4 `dead_run_entry_swept_lazily`: A dies without hook (kill the entry's run
  record directly); next `start`/`status` for the project sweeps it and starts
  fresh — no refusal.
- T5 `stop_failure_never_fails_run_close`: stop path poisoned → run still
  completes/cancels cleanly.
- T6 `restart_starts_clean`: manager rebuilt → no entries (in-memory proof).
- Full spec command list green: `cargo fmt --all --check`, `cargo clippy
  --workspace --all-targets -- -D warnings`, `cargo test --workspace
  --all-targets`, `wire` 11/0 + self-test, `policy` 8/0 + self-test, `arch`
  5/0 + self-test. Desktop unit suites quoted (no desktop files touched).
- Discrimination: T2 fails when the advance hook is removed; T1 fails when the
  liveness check is removed. Artifacts under `target/discrimination/`.

## Constraints

Isolated worktree, `zl-b5-*` branch from the B5-base tip; implementer never
authors gates; reviewer separate, never edits; verifier separate, never
repairs; no force push/tag/publish; mock provider only; no secrets; no test
weakening; small Conventional Commits. The two hook sites are shared with the
B3a-M1 code — read them, do not refactor them.
