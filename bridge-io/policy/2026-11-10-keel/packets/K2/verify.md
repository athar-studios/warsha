# K2 verification (completed by the orchestrator from the surviving logs)

- Worktree keel/k2, base ced5e30, head 718e859. Reviewer: APPROVE (review-repair.md).
- The verifier ran every gate, then died on a platform error before writing this file; every row below is backed by a log on disk.

| gate | result | exit | log |
|---|---|---|---|
| K2.1 run_integrity (7 tests) | PASS | 0 | gates/K2.1.log |
| K2.2 cas (4 tests) | PASS | 0 | gates/K2.2.log |
| K2.3 runs_resume (4 tests) | PASS | 0 | gates/K2.3.log |
| K2.4 runs.resume greps (auth 1 / lib 16) | PASS | 0 | gates/K2.4.log |
| K2.5 migration 003 present | PASS | 0 | gates/K2.5.log |
| STD.1 fmt | PASS | 0 | gates/STD.1.log |
| STD.2 clippy workspace -D warnings | PASS | 0 | gates/STD.2.log |
| STD.3 rust-tests | PASS | 0 | gates/STD.3.log: KEEL-PASS passed=763 ignored=10 cargo_exit=0 |
| STD.8 arch 5/0 | PASS | 0 | gates/STD.8.log |
| STD.9 wire 10/0 | PASS | 0 | gates/STD.9.log |
| STD.10 policy 8/0 | PASS | 0 | gates/STD.10.log |
| STD.12 snapshots | PASS | 0 | gates/STD.12.log |
| STD.13 scope-ok K2: 6 files | PASS (corrected; the earlier fail was the K1-only tool) | 0 | tools/scope.sh K2 |

Uncovered: none in the packet. Blockers: none.
