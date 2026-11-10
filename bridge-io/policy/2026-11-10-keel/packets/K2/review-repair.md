# Packet K2 Repair Re-Review — independent reviewer (read-only)

- Run: `2026-11-10-keel` · Packet: `K2` · Prior review: `EV/packets/K2/review.md` (F1 MEDIUM)
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/keel/k2` (clean before and after measurements)
- Base `ced5e30` · prior head `ffb2caf` · repair head `718e859` (1 commit: `fix(warshad): route runs.followup through the CAS run update (K2 repair)`)
- Delta judged: `git diff ffb2caf..718e859` → 2 files, +190/−20:
  `crates/warshad/src/lib.rs`, `crates/warsha-pipeline/src/lib.rs`
- Measurements re-run by this reviewer at `718e859` (raw log: `EV/gates/K2.repair-remeasure.log` equivalent, captured in reviewer session output)

## VERDICT: APPROVE

## F1 closure — CLOSED

`git diff ffb2caf..718e859` shows `runs.followup` (`crates/warshad/src/lib.rs` ~L3853–3915) rewritten to:

1. **Per-run lock**: `state.pipeline.control_for(run_id)` then `ctrl.state_lock.lock().await` held across
   the whole read-modify-write — it can no longer interleave a stage advance's transition (F1(a) gone).
2. **Cancel-flag check**: `*ctrl.cancel_tx.borrow()` → RPC error before any DB write.
3. **Status refusal**: `get_run_versioned` under the lock; `Cancelled` → error ("cancelled"),
   `Completed | Failed` → error ("terminal"); only `Running | Paused` proceed.
4. **CAS commit**: `store.update_run_cas(&run, version)` replaces the blind `update_run`; a snapshot read
   before a cancel commits cannot overwrite it (F1(b) gone). `write_artifact` (the disk I/O window,
   F1(c)) now runs only *after* the CAS succeeds.

`crates/warsha-pipeline/src/lib.rs` mirrors the guard: `PipelineEngine::followup_run` refuses
`Cancelled | Completed | Failed` at both the pre-read and the under-lock re-read.
`RunControl` fields widened `pub(crate)` → `pub` (plus a `_cancel_keepalive` receiver so
`cancel_tx.send(true)` is reliable with no subscribed worker) — both required by the warshad call site.

## Test discrimination — YES

`tests::runs_followup::stale_followup_cannot_resurrect_cancel_and_valid_followup_bumps_version`
(warshad, 6 steps). Without the fix (pre-`718e859` RPC: no status check, no cancel-flag check, blind
`update_run`):
- step 3 (followup on Cancelled → `.expect_err`) — pre-fix RPC succeeds → panic: DISCRIMINATES;
- step 5 (cancel flag set → error + version unchanged) — pre-fix RPC has no flag check → panic: DISCRIMINATES;
- step 6 (Completed run → "terminal" error) — pre-fix RPC succeeds → panic: DISCRIMINATES;
- steps 1–2 (valid followup bumps version; cancel bumps again) pin the happy-path/CAS bookkeeping;
- step 4 proves a stale `Running` snapshot fails `update_run_cas` and the `Cancelled` row survives.

## Scope — PASS

Only K2's files (`warshad/src/lib.rs`, `warsha-pipeline/src/lib.rs`). No `Cargo.toml`/`Cargo.lock`
(no deps), no `apps/**`/`packages/**`, no `#[ignore]`/`todo!()`/`.unimplemented!()`; new `unwrap()`/
`expect()` only inside `#[cfg(test)] mod tests`. Wire intact: `#[method(name = "runs.followup")]`
declaration, `authorize(ext, "runs.followup")`, and `METHOD_POLICIES` untouched by this diff.
Worktree clean at `718e859` after all runs.

## Measurements (reviewer's own run, head `718e859`)

```
NEW   cargo test -p warshad --lib runs_followup::
      test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 113 filtered out   EXIT=0
K2.1  cargo test -p warsha-pipeline --lib run_integrity::
      test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 357 filtered out   EXIT=0
K2.2  cargo test -p warsha-store --lib cas::
      test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 35 filtered out     EXIT=0
K2.3  cargo test -p warshad --lib runs_resume::
      test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 110 filtered out    EXIT=0
STD   cargo fmt --all -- --check                                                     EXIT=0 (no output)
```

All accept expectations met (K2.1 N=7 ≥6, K2.2 N=4 ≥2, K2.3 N=4 ≥3), new test N=1, fmt clean.

## Remaining findings (none blocking)

| # | Severity | Finding |
|---|---|---|
| L1 | LOW | (carried from prior review) `run_controls` map never evicted — one small entry per run for the daemon's lifetime. |
| L2 | LOW | (carried) repeat `runs.cancel` appends a duplicate `run_cancelled` event. |
| L3 | LOW | (carried) the `tokio::select!` in-flight abort branch still has no test that fails without it. |
| I1 | INFO | (carried) stage-commit CAS uses the stage-start version with no retry; benign concurrent writes fail the stage closed (fail-correct, but discards paid provider output). |
| I2 | INFO | (carried) `start_run` writes the brief artifact via blind `update_run` right after `create_run` (no concurrent holder yet). |
| I3 | INFO | (new, minor) if `write_artifact` fails after the CAS succeeds, state is committed but the durable artifact file is missing and the RPC returns an error. Order is deliberate (CAS first) and self-heals on next run write; noted only. |

## Blockers

None. F1 (the sole prior MEDIUM) is closed by an in-scope, same-stack fix with a discriminating
regression test; gates re-me green; fmt clean; worktree clean.
