# Packet K1 Review — Gate Integrity (run 2026-11-10-keel)

- Role: Independent REVIEWER (read-only; no files edited in the worktree)
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/keel/k1` (clean)
- Branch: `run/2026-11-10-keel/k1-gate-integrity`
- Base `128b59c08cbf5ddbe4de002528a50f451ea74296` → head `bef00eb203f98973fb157a789f278b38e27862f4` (6 commits)
- Verdict: **APPROVE**

## Per-point judgement

### 1. Enforcement — PASS
`crates/warsha-pipeline/src/gate_integrity.rs::ensure_gate_decidable` checks, in order: `stage.is_gate()`, `run.status == RunStatus::Running`, `run.current_stage == stage`, and `gate_states[stage] == GateState::Pending` (else `PipelineError::GateNotPending`). `approve_gate`, `reject_gate`, `request_changes` in `crates/warsha-pipeline/src/lib.rs` all call it (base's inline `is_gate` + `Pending` checks replaced), so a decision is refused unless the run is Running, the gate is the run's current stage, and it is Pending; Pending-gate-only + single transition gives approve-once. Each of the three functions computes `artifacts_sha256(&run.artifacts)` before mutating state and embeds it as `artifacts_sha256` in the `EventKind::GateDecision` payload. Digest: sorted-by-name, length-prefixed fields (name/stage/version/content) over a pure-Rust FIPS 180-4 SHA-256 with published test vectors; no new dependency.

### 2. Test discrimination — PASS (with one precision)
- **K1.1** (`approving_a_gate_the_run_has_not_reached_is_refused`): `expect_err` + `"not current stage"` on GateA/GateB/GateD at Idea and GateD at GateA; asserts all gates stay `Pending` and **zero** `GateDecision` events. Without the current-stage/status enforcement the base code would approve GateA at Idea → test fails. Discriminates.
- **K1.2** (`approving_the_current_gate_succeeds_once`): asserts second approve / reject-after-approve / changes-after-approve each return `GateNotPending(GateA)`, and exactly **one** `GateDecision` event with the first device. Fails if the Pending/once enforcement is removed (second approval would emit a 2nd event). Precision: the once-rule pre-existed at base; this test locks it into the frozen gate. It does not itself discriminate the current-stage check — K1.1 covers that.
- **K1.3** (`the_gate_decision_event_carries_the_artifacts_hash`): recomputes `artifacts_sha256` from the run's artifacts and asserts `payload["artifacts_sha256"]` equals it, plus a changed artifact yields a different hash (assert_ne) on a second run's reject event. Without the payload injection the assertion fails. Discriminates.

### 3. The 7 `crates/warshad/tests/**` updates — PASS (setup/order only, hunk by hunk)
- `e2e_real_arabic_request.rs`, `e2e_request_to_artifact.rs`: the existing `advance_stage Idea→GateA` block was **moved earlier**, before the GateA approval (+5/-5, +5/-4). No assertion touched.
- `events_stream_sync.rs`: `gates.approve` moved after `runs.advance` (×2). No assertion changed.
- `events_ws_live.rs`: adds an advance (with new `stage_started` assertions — a strengthening) and includes `at_gate_a` in the persistence loop; second test advances + approves gate_a before the post-attach gate_b decision. `WARSHA_LLM_PROVIDER=fake` added in `Daemon::start` (determinism, no network). No assertion weakened.
- `gates_list.rs`: first run now advances before each decision; the `changes_requested` + `notes == "tighten"` assertion was **moved to a second run** that approves through gate_b (rejection pauses the run), with the flat-shape `detail`-absent loop duplicated for it; first run's gate_c asserted `pending`. Feature coverage preserved (and one extra run added), not deleted.
- `security_identity.rs`: `runs.advance` inserted before each decision (5 sites); all identity/refusal assertions unchanged.
- `security_rate_limits.rs`: `runs.advance` before gate decisions (4 sites); rate-limit assertions unchanged.

### 4. Scope — PASS
Diff touches only: `crates/warsha-pipeline/src/{gate_integrity.rs,lib.rs}`, `crates/warsha-pipeline/tests/harness_skills_wiring.rs` (4 hunks, all advance-before-approve setup), `crates/warshad/src/lib.rs` (test seeding: `stored_run_with_gate` seats `current_stage = GateA`; one test seeds GateB current before its reject — assertions unchanged), and the 7 amended `crates/warshad/tests/**` files. No `Cargo.toml`/`Cargo.lock` (no deps), no snapshots, no `apps/**`/`packages/**`, no `#[skip]`/`#[ignore]`/`todo!()` added. No pipeline→daemon reference (`grep warshad` in `gate_integrity.rs` and `warsha-pipeline/Cargo.toml`: empty) — arch R2 intact.

## Measurements (only the frozen gates + STD.1, per reviewer brief)

| Gate | Command | Result |
|---|---|---|
| K1.1 | `cargo test -p warsha-pipeline --lib gate_integrity::approving_a_gate_the_run_has_not_reached_is_refused -- --exact` | exit 0 — `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 356 filtered out; finished in 0.08s` |
| K1.2 | `cargo test -p warsha-pipeline --lib gate_integrity::approving_the_current_gate_succeeds_once -- --exact` | exit 0 — `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 356 filtered out; finished in 0.09s` |
| K1.3 | `cargo test -p warsha-pipeline --lib gate_integrity::the_gate_decision_event_carries_the_artifacts_hash -- --exact` | exit 0 — `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 356 filtered out; finished in 0.13s` |
| STD.1 | `cargo fmt --all -- --check` | exit 0 (no diff) |

Full workspace suite skipped (STD.3) per reviewer brief; worktree remained clean (read-only).

## Findings

1. **[info]** `crates/warsha-pipeline/tests/harness_skills_wiring.rs` is not literally inside the packet's allowed glob `crates/warsha-pipeline/src/{lib,gate*}`; it is pipeline non-daemon test setup required by the new enforcement (advance-before-approve, +28/-0, no feature assertion changed) and inside the reviewer brief's scope. Not a blocker.
2. **[info]** K1.2's approve-once rule pre-existed at base; the frozen test now pins it (would fail if the Pending/GateNotPending check were removed). K1.1 carries the new current-stage discrimination.
3. **[info]** `WARSHA_LLM_PROVIDER=fake` added in 4 daemon test fixtures — setup determinism (no network), not an assertion change.

Blockers: none.
