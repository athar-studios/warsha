# Packet K1 Report — Gate Integrity

- Run: `2026-11-10-keel`
- Packet: `K1` (`gate-integrity`)
- Role: Implementer
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/keel/k1`
- Branch: `run/2026-11-10-keel/k1-gate-integrity`
- Base commit: `128b59c08cbf5ddbe4de002528a50f451ea74296`
- Head commit: `2974eea4d11512314ddd4a9042ad8d0cb4a125a1`
- Status: **IMPLEMENTATION COMPLETE** (K1.1–K1.3 green; out-of-scope blocker recorded for STD.3)

---

## Executive Summary

Implemented K1 gate integrity invariants across pipeline gate decisions:
1. Gate decisions (`approve_gate`, `reject_gate`, `request_changes`) require `run.status == RunStatus::Running`, `run.current_stage == stage`, `stage.is_gate()`, and `GateState::Pending`. Approving any gate before the run reaches it is refused.
2. A gate can be decided only once; repeated decisions return `PipelineError::GateNotPending`.
3. Every `EventKind::GateDecision` event records `artifacts_sha256`, a deterministic FIPS 180-4 SHA-256 hex digest of the run's artifacts at the moment of decision (zero external dependencies).
4. Added the three frozen gate tests (`gate_integrity::approving_a_gate_the_run_has_not_reached_is_refused`, `gate_integrity::approving_the_current_gate_succeeds_once`, `gate_integrity::the_gate_decision_event_carries_the_artifacts_hash`).
5. Aligned in-scope tests in `crates/warsha-pipeline/tests/harness_skills_wiring.rs` and `crates/warshad/src/lib.rs` to seat runs at their current gate before deciding.

---

## Commits

- `fdfeea9d0a2dc13f7b557af1609bde343396707c` wip(pipeline): K1 gate-integrity work-in-progress (salvaged after the 150-turn ceiling)
- `a70a18d2c100f13fa1cab8ecdf03bc1328e71bcf` feat(pipeline): enforce current-gate decisions and artifacts_sha256 digest
- `73a9bea81c57d3d464ad8dba3bc29d3a5844cbc1` test(pipeline): advance to GateA before approving in harness_skills_wiring
- `b537ea5a297a26260b596dac2554245ab54f856b` test(warshad): seat unit tests at current gate before deciding
- `2974eea4d11512314ddd4a9042ad8d0cb4a125a1` style(pipeline): satisfy clippy lints in gate_integrity

---

## Modified Files (All In-Scope)

- `crates/warsha-pipeline/src/gate_integrity.rs` (new module: gate decision validation, FIPS 180-4 SHA-256 digest, 3 behavior tests)
- `crates/warsha-pipeline/src/lib.rs` (`approve_gate`, `reject_gate`, `request_changes` wired with validation and `artifacts_sha256`)
- `crates/warsha-pipeline/tests/harness_skills_wiring.rs` (advance to GateA before approving)
- `crates/warshad/src/lib.rs` (`stored_run_with_gate` seated at GateA; advance to GateB before reject)

---

## Gate Measurements

| Gate | Check | Outcome | Details |
|---|---|---|---|
| K1.1 | `cargo test -p warsha-pipeline --lib gate_integrity::approving_a_gate_the_run_has_not_reached_is_refused -- --exact` | **PASS** | exit 0; test result: ok. 1 passed; 0 failed |
| K1.2 | `cargo test -p warsha-pipeline --lib gate_integrity::approving_the_current_gate_succeeds_once -- --exact` | **PASS** | exit 0; test result: ok. 1 passed; 0 failed |
| K1.3 | `cargo test -p warsha-pipeline --lib gate_integrity::the_gate_decision_event_carries_the_artifacts_hash -- --exact` | **PASS** | exit 0; test result: ok. 1 passed; 0 failed |
| STD.1 | `cargo fmt --all -- --check` | **PASS** | exit 0; no diff |
| STD.2 (scoped) | `cargo clippy -p warsha-pipeline --all-targets -- -D warnings` | **PASS** | exit 0; 0 warnings |
| STD.8 | `node scripts/check-arch.mjs` | **PASS** | exit 0; arch: 5 rules, 0 violations |
| STD.9 | `node scripts/check-wire-contract.mjs` | **PASS** | exit 0; wire: 10 checks, 0 violations |
| Pipeline suite | `cargo test -p warsha-pipeline` | **PASS** | exit 0; 350 passed, 0 failed, 7 ignored |
| Warshad lib | `cargo test -p warshad --lib` | **PASS** | exit 0; 107 passed, 0 failed, 2 ignored |

---

## Out-of-Scope Blocker (RESOLVED)

BLOCKER (out-of-scope): Seven legacy daemon integration test files in `crates/warshad/tests/` fail under workspace test check STD.3 (`bash tools/rust-tests.sh`) because they call `gates.approve`/`reject`/`changes` on unreached gates immediately after `runs.start` without advancing the run:
1. `crates/warshad/tests/e2e_real_arabic_request.rs:724` (approves GateA while run is at Idea)
2. `crates/warshad/tests/e2e_request_to_artifact.rs:270` (approves GateA while run is at Idea)
3. `crates/warshad/tests/events_stream_sync.rs:371,474` (approves gate_a while run is at Idea)
4. `crates/warshad/tests/events_ws_live.rs:334,400` (approves gate_a and gate_b while run is at Idea)
5. `crates/warshad/tests/gates_list.rs:230-244` (approves gate_a, rejects gate_b, requests changes on gate_c on unadvanced run)
6. `crates/warshad/tests/security_identity.rs:201-250` (approves gate_a, approves gate_b, requests changes on gate_c on unadvanced run)
7. `crates/warshad/tests/security_rate_limits.rs:329-360,511` (approves gate_a and gate_b on unadvanced runs)

— RESOLUTION: Scope amended to permit `crates/warshad/tests/**`. All 7 integration test files aligned in follow-up commit `bef00eb203f98973fb157a789f278b38e27862f4`.

---

## Follow-Up: Daemon Integration Test Alignment

- Commit: `bef00eb203f98973fb157a789f278b38e27862f4` (`test(warshad): approve only the current gate in integration tests (K1 follow-up)`)
- Scope: `crates/warshad/tests/**` only (7 files modified, 95 insertions, 27 deletions)

### Fixed Files

1. `crates/warshad/tests/e2e_real_arabic_request.rs` (advance `Idea -> GateA` before `approve_gate(GateA)`)
2. `crates/warshad/tests/e2e_request_to_artifact.rs` (advance `Idea -> GateA` before `approve_gate(GateA)`)
3. `crates/warshad/tests/events_stream_sync.rs` (advance `Idea -> GateA` before `gates.approve(gate_a)` in monotonic seq and replay seed tests)
4. `crates/warshad/tests/events_ws_live.rs` (advance `Idea -> GateA` before `gate_a` approval; advance to `gate_b` before post-attach `gate_b` approval; set `WARSHA_LLM_PROVIDER=fake`)
5. `crates/warshad/tests/gates_list.rs` (advance to reached gates; exercise `rejected` on first run and `changes_requested` on second run since rejection pauses the run; set `WARSHA_LLM_PROVIDER=fake`)
6. `crates/warshad/tests/security_identity.rs` (advance through `GateA`, `GateB`, `GateC` before their respective decisions; set `WARSHA_LLM_PROVIDER=fake`)
7. `crates/warshad/tests/security_rate_limits.rs` (advance runs to `GateA` and `GateB` before decisions; set `WARSHA_LLM_PROVIDER=fake`)

### Setup Change Pattern

- Replaced premature unadvanced gate decisions with sequential stage advances (`engine.advance_stage` or `runs.advance`) so that every decision occurs while `run.status == Running` and `run.current_stage == stage`.
- For multi-gate tests, advanced runs through prerequisite approved gates (`GateA -> GateB -> GateC`).
- In `gates_list.rs`, used a secondary run to exercise `changes_requested` alongside `approved`/`rejected`/`pending` without violating the state machine invariant that a rejected gate pauses the run.
- Set `WARSHA_LLM_PROVIDER=fake` in test `Daemon::start` fixtures to enforce zero-network determinism across full pipeline stage walks.
- Zero assertions or expectations weakened; all wire format, identity, rate limit, event streaming, and queue shape verifications preserved.

### Measured Test Counts

| Suite | Status | Passed | Failed | Ignored | Targets |
|---|---|---|---|---|---|
| `cargo test -p warshad` | **PASS** | 179 | 0 | 3 | 19 targets (107 lib, 72 integration) |
| `cargo test -p warsha-pipeline` | **PASS** | 361 | 0 | 7 | 5 targets (350 lib, 11 tests) |
| `cargo fmt --all -- --check` | **PASS** | - | - | - | exit 0 (clean) |
| `cargo clippy -p warsha-pipeline -p warshad --all-targets -- -D warnings` | **PASS** | - | - | - | exit 0 (0 warnings) |

Blockers: None. All 7 test files pass.

