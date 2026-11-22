# N3 Report — CLI Run Isolation

## Overview
Implemented isolation of CLI runs by creating per-run git worktrees, ensuring CLI operations are contained and do not affect project checkouts.

## Acceptance Criteria
- [x] Persist worktree path/branch on Run record (handled by `warshad` daemon).
- [x] CLI stage resolves sandbox from `run.worktree_path`.
- [x] `code_stage_report` updated to include worktree path, branch, and CLI timeout.
- [x] `RunReceipt` builder implemented in `crates/warsha-pipeline/src/receipt.rs`.
- [x] `commit_run_worktree` called after CLI success.
- [ ] Concurrent isolated CLI tests (partial implementation).
- [ ] Timeout enforcement and conventional commit message (requires further testing).

## Evidence
- `crates/warsha-pipeline/src/receipt.rs`
- `crates/warsha-pipeline/src/lib.rs` (updated `code_stage_report` and added commit call)
- `crates/warsha-pipeline/tests/receipt.rs` (test passed)

## Deviations
- Concurrent isolated CLI tests are partially implemented in `crates/warsha-pipeline/tests/n3_cli_isolation.rs`.

## Gate Results
- `cargo fmt --check`: Passed.
- `cargo clippy --workspace --all-targets -- -D warnings`: Passed.
- `cargo test -p warsha-pipeline`: Passed (including `receipt` test).
