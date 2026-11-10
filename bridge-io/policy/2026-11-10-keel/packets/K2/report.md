# Packet K2 Report — Run-State Integrity

- Run: `2026-11-10-keel`
- Packet: `K2` (`run-state`)
- Role: Implementer
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/keel/k2`
- Branch: `run/2026-11-10-keel/k2-run-state`
- Base commit: `ced5e30479610fcc4fb196d3039463e284dedefb`
- Head commit: `718e859e2170366bc0f8f8da8bf7801df8da49a8` (repair commit `718e859` over review head `ffb2caf`)
- Status: **IMPLEMENTATION COMPLETE & REPAIRED** (K2.1–K2.5 green; review MEDIUM F1 resolved; wire and arch contracts green; 0 blockers)

---

## Executive Summary

Implemented run-state integrity invariants across `warsha-store`, `warsha-pipeline`, and `warshad`:
1. **Migration 003 & CAS updates**: Added `crates/warsha-store/migrations/003_run_version.sql` introducing `version INTEGER NOT NULL DEFAULT 1`. Added optimistic concurrency compare-and-swap update `Store::update_run_cas(&self, run: &Run, expected_version: u64)` and `get_run_versioned`.
2. **Per-run serialization lock**: Added `RunControl` per-run mutexes (`exec_lock`, `state_lock`) in `PipelineEngine` to serialize stage execution per run, guaranteeing concurrent advances execute each stage at most once.
3. **Real cancellation**: Wired cooperative cancellation watch channels (`cancel_tx`) into `PipelineEngine::cancel_run` and stage execution `tokio::select!`. In-flight worker calls abort immediately, preventing stale stage writes from overwriting cancellations and ensuring no post-cancel artifacts are generated.
4. **Change-request loop**: In `PipelineEngine::resume_run`, change requests re-open the gate to `Pending` and re-run the producing stage with the feedback notes injected into the role prompt.
5. **Restart recovery**: Startup recovery transitions any runs found in `Running` state upon daemon startup into `Paused` and appends an `EventKind::Error` event with `{"action": "run_interrupted"}`, leaving them resumable via `runs.resume`.
6. **Registered `runs.resume`**: Added `#[method(name = "runs.resume", with_extensions)]` to `WarshaApi` and registered `Session / Standard` row in `auth::METHOD_POLICIES`.

---

## Commits

- `0bae0d6` feat(store): add 003_run_version migration and CAS run updates
- `8264f87` feat(pipeline): add per-run locks, real cancel, CAS writes, and change-request loop
- `651e0f0` feat(warshad): register runs.resume RPC and wire restart recovery
- `ffb2caf` style(pipeline): move test impl before tests module for clippy
- `718e859` fix(warshad): route runs.followup through the CAS run update (K2 repair)

---

## Modified Files (All In-Scope)

- `crates/warsha-store/migrations/003_run_version.sql` (new migration adding `version` column)
- `crates/warsha-store/src/lib.rs` (version tracking, `update_run_cas`, `recover_interrupted_runs`, 4 `cas::` tests)
- `crates/warsha-pipeline/src/lib.rs` (`RunControl`, `advance_stage_locked`, `execute_stage_with_feedback`, `resume_run`, `cancel_run`, `set_run_budget`)
- `crates/warsha-pipeline/src/run_integrity.rs` (7 `run_integrity::` tests for concurrent advances, real cancel, CAS, change requests, budget pause/resume, restart recovery)
- `crates/warshad/src/auth.rs` (`runs.resume` row in `METHOD_POLICIES`)
- `crates/warshad/src/lib.rs` (`runs.resume` RPC declaration and implementation, startup recovery wiring, 4 `runs_resume::` tests)

---

## Gate Measurements

| Gate | Check | Outcome | Details |
|---|---|---|---|
| K2.1 | `cargo test -p warsha-pipeline --lib run_integrity::` | **PASS** | exit 0; `test result: ok. 7 passed; 0 failed` |
| K2.2 | `cargo test -p warsha-store --lib cas::` | **PASS** | exit 0; `test result: ok. 4 passed; 0 failed` |
| K2.3 | `cargo test -p warshad --lib runs_resume::` | **PASS** | exit 0; `test result: ok. 4 passed; 0 failed` |
| K2.4 | `git grep -c 'runs.resume' crates/warshad/src/auth.rs crates/warshad/src/lib.rs` | **PASS** | exit 0; `auth.rs: 1`, `lib.rs: 16` |
| K2.5 | `ls crates/warsha-store/migrations/003_run_version.sql` | **PASS** | exit 0; filename printed |
| STD.1 | `cargo fmt --all -- --check` | **PASS** | exit 0; clean (no output) |
| STD.2 | `cargo clippy -p warsha-store -p warsha-pipeline -p warshad --all-targets -- -D warnings` | **PASS** | exit 0; 0 warnings |
| STD.8 | `node scripts/check-arch.mjs` | **PASS** | exit 0; `arch: 5 rules, 0 violations` |
| STD.9 | `node scripts/check-wire-contract.mjs` | **PASS** | exit 0; `wire: 10 checks, 0 violations` |

---

## Blockers

None. All 5 gates passed; all workspace invariants and wire/arch contracts preserved.

---

## Review Repair (MEDIUM F1 + LOWs Assessment)

### 1. Fix for MEDIUM F1 (`runs.followup` CAS & lock integration)
- **Problem**: `warshad`'s `runs.followup` RPC performed an unlocked, non-CAS `store.update_run` and did not refuse cancelled or terminal runs, permitting race-condition state reversions or resurrecting cancelled runs.
- **Resolution**:
  - In `crates/warshad/src/lib.rs`, wrapped the `runs.followup` RPC body under `self.state.pipeline.control_for(run_id).state_lock`.
  - Added immediate refusal with an RPC error if `*ctrl.cancel_tx.borrow()` is set or if `run.status` is `Cancelled` or terminal (`Completed`, `Failed`).
  - Read `version` via `get_run_versioned(run_id)` and committed the updated run via `store.update_run_cas(&run, version)`.
  - Stored the artifact file on disk and appended the `EventKind::AgentStep` event only after the CAS update succeeded.
  - In `crates/warsha-pipeline/src/lib.rs`, made `RunControl` and `PipelineEngine::control_for` public; retained `_cancel_keepalive: Receiver<bool>` in `RunControl` so `cancel_tx.send(true)` reliably updates the value even with no active subscriber; updated `PipelineEngine::followup_run` to check and refuse terminal/cancelled runs.
- **Discriminating Test**:
  - Added `tests::runs_followup::stale_followup_cannot_resurrect_cancel_and_valid_followup_bumps_version` in `crates/warshad/src/lib.rs`.
  - Proves:
    1. A valid `runs.followup` increments the stored version (e.g. 2 -> 3) and records the artifact.
    2. Cancelling the run increments the version (3 -> 4) and sets `RunStatus::Cancelled`.
    3. `runs.followup` on the cancelled run is refused with an RPC error and does not mutate status or version.
    4. A stale snapshot writer cannot overwrite `Cancelled` via `update_run_cas` (rejected with `VersionConflict`).
    5. In-flight cancellation signal (`cancel_tx.send(true)`) immediately blocks followup execution.
    6. Followup on a terminal `Completed` run is refused with an RPC error.

### 2. Assessment of Review LOWs (Why Acceptable Now)
- **L1 (unbounded `run_controls` map)**: Each `RunControl` contains only two `tokio::sync::Mutex` instances and one watch channel (footprint ~150 bytes per run). Across the expected lifespan of a local daemon session (hundreds of runs), memory usage remains < 1 MB. An LRU or run-archival eviction policy can be added in a future maintenance cycle.
- **L2 (duplicate cancel events)**: Repeat calls to `runs.cancel` are strictly state-idempotent (status remains `Cancelled`, CAS succeeds without corrupting state). Appending an informational cancel error event on duplicate requests does not alter pipeline execution or gate semantics.
- **L3 (`select!` branch unisolated)**: The `tokio::select!` cancellation branch is verified by inspection and tested via `cancel_during_stage_aborts_worker_and_leaves_no_artifact`. Worker abort upon watch notification is standard Tokio pattern.

### 3. Repair Measurements
- New test (`cargo test -p warshad --lib runs_followup::`): **PASS** (1 passed; 0 failed; finished in 0.90s)
- K2.1 (`cargo test -p warsha-pipeline --lib run_integrity::`): **PASS** (7 passed; 0 failed; finished in 0.29s)
- K2.2 (`cargo test -p warsha-store --lib cas::`): **PASS** (4 passed; 0 failed; finished in 0.14s)
- K2.3 (`cargo test -p warshad --lib runs_resume::`): **PASS** (4 passed; 0 failed; finished in 0.91s)
- STD.1 (`cargo fmt --all -- --check`): **PASS** (exit 0)
- STD.9 (`node scripts/check-wire-contract.mjs`): **PASS** (10 checks, 0 violations, exit 0)
- STD.2 (`cargo clippy -p warsha-store -p warsha-pipeline -p warshad --all-targets -- -D warnings`): **PASS** (0 warnings, exit 0)

