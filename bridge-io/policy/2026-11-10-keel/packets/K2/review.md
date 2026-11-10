# Packet K2 Review — Run-State Integrity (independent reviewer)

- Run: `2026-11-10-keel` · Packet: `K2` · Role: Reviewer (read-only; no code edited)
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/keel/k2` (clean at review time, branch `run/2026-11-10-keel/k2-run-state`)
- Base: `ced5e30479610fcc4fb196d3039463e284dedefb` → Head: `ffb2cafc856ce8dc56245dc72281a7f6808b728f` (4 commits, matches report)
- Delta: 6 files, +1758/−252 — `crates/warsha-pipeline/src/{lib,run_integrity}.rs`,
  `crates/warsha-store/{migrations/003_run_version.sql,src/lib.rs}`, `crates/warshad/src/{lib,auth}.rs`
- Inputs: `EV/PACKETS.md` K2, `EV/acceptance.json` K2.1–K2.5, `EV/packets/K2/report.md`
- Measurements re-run by this reviewer at `ffb2caf` (worktree clean after run); raw output: `EV/gates/K2.remeasure.log`

## VERDICT: REQUEST-CHANGES

All frozen gates K2.1–K2.5 pass as measured, and the four headline mechanisms (CAS+migration, per-run locks,
real cancel, resume/recovery, change-request loop) are genuinely implemented and discriminated by tests.
One MEDIUM finding: a pre-existing-but-in-scope stale writer (`runs.followup` RPC) still performs an
unlocked, non-CAS read-modify-write on the run row, which is a concrete counterexample to judged points 2
and 3. Fix is small and in scope (route it through `state_lock` + `update_run_cas` + cancel-flag check, as
`runs.cancel`/`budget.set` already were).

## Per-point judgement

### 1. Migration 003 + CAS store update — PASS (with F1 below)
- `migrations/003_run_version.sql`: `ALTER TABLE runs ADD COLUMN version INTEGER NOT NULL DEFAULT 1;` LF-only;
  embedded migrator test now asserts versions `[1, 2, 3]`; `create_run` inserts `version = 1`; all run SELECTs
  read `version`.
- `update_run_cas(&run, expected)` asserts `WHERE id = ? AND version = ?`; `rows_affected() == 0` →
  `StoreError::VersionConflict { run_id, expected, actual }` (actual re-read). `update_run` (blind) still bumps
  `version = version + 1`, but every production stage/state write in the pipeline now goes through CAS:
  stage-start, stage-commit (under `state_lock`, with the stage-start version deliberately NOT refreshed, so any
  interloper forces a conflict-fail rather than an overwrite), gate approve/reject/request_changes, upsert,
  record_cost, budget pause, resume, and cancel (retry loop ≤8 on conflict).
- Test `stale_stage_write_cannot_overwrite_cancelled_status` directly proves a stale writer fails and the
  cancelled status survives → the required "stale stage write FAILS rather than overwrites" property holds
  for pipeline writers.
- Exception: `warshad` `runs.followup` RPC → finding F1.

### 2. Per-run lock — PASS (engine scope; F1 is the residual exception)
- `RunControl { exec_lock, state_lock, cancel_tx }` per `RunId` in `PipelineEngine::run_controls`.
  `advance_stage`, `advance_to_next_gate`, `resume_run` hold `exec_lock` for the whole walk; every
  read-modify-write transition reads + CAS-commits under `state_lock`; `state_lock` is never held across the
  provider await (so cancel can enter), and lock order is always exec → state (no inversion).
- Test `concurrent_advances_execute_each_stage_only_once`: two `tokio::join!` walks over one run assert exactly
  2 provider calls (Research + PrdSpec) and landing at GateB — would fail (4 calls / stage skip) without the lock.
- Residual: `runs.followup` RPC does `get_run → write_artifact → update_run` with no `state_lock` and no CAS —
  it can interleave with a stage advance and revert `current_stage`/`status` (F1).

### 3. Real cancel — PASS with nits (F1 is the resurrection exception)
- `cancel_run` sends `cancel_tx=true` **before** taking `state_lock`, then commits `Cancelled` via CAS with a
  conflict-retry loop, so a cancel can neither be lost nor overtaken; it appends `{"action":"run_cancelled"}`.
- The running worker observes cancellation as a flag, not just a status column: pre-dispatch `cancel_tx.borrow()`
  check, `biased; tokio::select!` on `cancel_rx.changed()` around `dispatch_chat` (in-flight call dropped),
  and a pre-commit flag + `status == Cancelled` check under `state_lock`. Even if a commit wins the lock race,
  `cancel` then retries its CAS and wins last — final state is always `Cancelled`.
- Idempotent in state: a repeat cancel re-reads and rewrites `Cancelled` (cannot be resurrected; `resume_run`
  and both advance paths refuse `Cancelled`). Nit L2: each repeat appends a duplicate `run_cancelled` event.
- Stale-writer resurrection remains possible through `runs.followup` (F1).

### 4. `runs.resume` wire + restart recovery — PASS
- Declared `#[method(name = "runs.resume", with_extensions)]` in the `WarshaApi` trait, impl authorizes
  `"runs.resume"` and delegates to `PipelineEngine::resume_run`; `METHOD_POLICIES` carries an
  `M { method: "runs.resume", policy: Session, tier: Standard }` row (K2.4 measured below).
- Recovery: `Store::recover_interrupted_runs` selects `status = '"running"'` (JSON-encoded status — matches the
  writer format), transitions to `RunStatus::Paused` **via CAS** (version bumps 1→2 proven), appends
  `EventKind::Error {"action":"run_interrupted"}`; wired in `start_daemon_with_provider_factory` before the RPC
  server starts; `resume_run` accepts `Paused` → `Running`.
- **No new `RunStatus` variant**: `warsha-core` is untouched by the delta; the enum remains
  `Running, Paused, Completed, Failed, Cancelled`. Interruption = `Paused` + `{action: run_interrupted}`. ✓
- `daemon_restart_recovers_interrupted_run_and_runs_resume_resumes_it` proves restart → Paused → event →
  `runs.resume` → Running.

### 5. Change-request loop — PASS
- `resume_run` on `GateState::ChangesRequested { notes }` (and `Rejected { reason }`): gate → `Pending`,
  stage → `producing_stage_for_gate(gate)`, status → `Running` (all in one CAS write), then re-executes the
  producing stage via `execute_stage_with_feedback(run, version, ctrl, Some(notes))`;
  `build_context_with_feedback` puts the notes in `context.change_request_notes` and `render_prompt` injects
  `{{feedback}}`/`{{notes}}` or appends a "Feedback / Change Request Notes" section — so the feedback is
  carried into the next stage's model input.
- Discriminated: `change_request_reopens_gate_and_reruns_stage_with_feedback` asserts the provider's actual
  prompt contains the exact notes; `runs_resume_resumes_paused_run_after_change_request` proves the wire path
  end-to-end (Paused → resume → gate Pending → approve).

### 6. Test discrimination + scope — PASS (with LOW/LOW/INFO notes)
- Discrimination (would fail without the mechanism):
  - without `update_run_cas`: `stale_stage_write_cannot_overwrite_cancelled_status`, all 4 `cas::` tests;
  - without `exec_lock`: `concurrent_advances_execute_each_stage_only_once` (exactly-once assertion breaks);
  - without cancel handling: `cancel_during_stage_aborts_worker_and_leaves_no_artifact` (pre-K2 code would
    write the artifact and resurrect `Running`);
  - without feedback injection: prompt-contains-notes assertion fails;
  - without recovery/Paused mapping: both interrupted-run tests fail;
  - without the `METHOD_POLICIES` row: `runs_resume_requires_authorization_and_allows_session` fails in
    either direction (deny → paired resume errors; permissive default → anonymous not refused).
  - LOW L3: no test isolates the `tokio::select!` abort branch itself — `cancel_during_stage…` unblocks the
    provider right after cancel, so a commit-time flag check alone would also pass it. The select! is verified
    by code review, not by a dedicated test.
- Scope: exactly the 6 in-scope files above; **no** `Cargo.toml`/`Cargo.lock` (no deps), **no** `apps/**` or
  `packages/**`; no `#[ignore]`/`todo!()`/`unimplemented!`/`.skip(` added; `unwrap()`/`expect()` added only in
  `#[cfg(test)]` modules. Worktree stayed clean through all measurement runs.

### 7. Measurements (reviewer's own re-run, head `ffb2caf`, worktree clean after run; full workspace suite skipped per brief)

Exact acceptance commands from `EV/acceptance.json` plus the mandated fmt check (raw log: `EV/gates/K2.remeasure.log`):

```
K2.1  cargo test -p warsha-pipeline --lib run_integrity::          EXIT=0
      test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 357 filtered out; finished in 0.28s
K2.2  cargo test -p warsha-store --lib cas::                       EXIT=0
      test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 35 filtered out; finished in 0.16s
K2.3  cargo test -p warshad --lib runs_resume::                    EXIT=0
      test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 109 filtered out; finished in 0.92s
STD.1 cargo fmt --all -- --check                                   EXIT=0 (no output)
```

K2.1 passed tests (all 7, verbatim): `stale_stage_write_cannot_overwrite_cancelled_status`,
`cancel_during_stage_aborts_worker_and_leaves_no_artifact`, `two_different_runs_can_advance_concurrently`,
`interrupted_run_marked_paused_and_resumable`, `change_request_reopens_gate_and_reruns_stage_with_feedback`,
`concurrent_advances_execute_each_stage_only_once`, `budget_exceeded_pauses_and_resumes_after_budget_increase`.
K2.2: all 4 `tests::cas::*` pass. K2.3: all 4 `tests::runs_resume::*` pass.
Accept expectations met: K2.1 N=7 (≥6), K2.2 N=4 (≥2), K2.3 N=4 (≥3); fmt clean.
(Per review brief, no clippy/arch/wire/std suite and no full workspace suite were re-run by the reviewer.)

## Findings

| # | Severity | Finding |
|---|---|---|
| F1 | **MEDIUM** | `crates/warshad/src/lib.rs` `runs.followup` RPC (~L3860–3910) still does `get_run → write_artifact → store.update_run` with no per-run `state_lock`, no version CAS, and no cancel-flag check. (a) It is a second concurrent writer that can interleave a read-modify-write with a stage advance and revert `current_stage`/`status`/`spent_cents` (counterexample to point 2); (b) if it reads before a cancel commits and writes after, it rewrites the snapshot status (`Running`) over `Cancelled` — a stale-writer resurrection (counterexample to point 3); (c) the window includes the `write_artifact` disk I/O. Pre-existing code, but `warshad lib.rs` is in K2's allowed scope and K2 already fixed the identical `runs.cancel`/`budget.set` writers; `PipelineEngine::followup_run` (CAS'd) is reachable only from tests, so the wire path bypasses the new invariant. Fix: wrap the RPC body in `control_for(run_id).state_lock`, refuse on `cancel_tx`/`Cancelled`, and commit with `update_run_cas`. |
| L1 | LOW | `run_controls` `HashMap<RunId, Arc<RunControl>>` is never evicted — one small entry per run for the daemon's lifetime (unbounded growth, tiny per-entry footprint). |
| L2 | LOW | A repeat `runs.cancel` is state-idempotent (stays `Cancelled`) but appends a duplicate `run_cancelled` event each time; consider short-circuiting when already `Cancelled`. |
| L3 | LOW | The `tokio::select!` in-flight abort branch has no test that fails without it (cancel test unblocks the provider immediately after cancel, so the commit-time flag check alone satisfies it). |
| I1 | INFO | Stage-commit CAS uses the stage-start version, not the just-read `latest_v`: any benign concurrent run write (e.g. `upsert_artifact`, `budget.set`, F1's followup) makes the finished stage fail with `VersionConflict` and discards paid provider output. Fail-closed (correct per point 1) but no retry/backoff exists on that path. |
| I2 | INFO | `start_run` still writes the brief artifact via a blind `update_run` immediately after `create_run` (no concurrent holder of the run id yet — benign, but it is the last non-CAS write in the pipeline). |

## Blockers

- No gate blockers: K2.1–K2.5 and `cargo fmt --all -- --check` all pass as measured; worktree clean.
- One open MEDIUM (F1) on a judged invariant → REQUEST-CHANGES. F1 is a same-stack, in-scope, small fix
  (one RPC function in `crates/warshad/src/lib.rs`); recommend one focused follow-up commit plus a regression
  test that cancels concurrently with `runs.followup` (or, cheaper, an assertion that the RPC refuses a
  cancelled run and bumps `version`), then re-run K2.1–K2.5.
