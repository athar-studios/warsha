# R-KEEL Audit — K1 / K2 / K3 verified against code at `4e974db`

- Auditor lane: Architect/Planner (READ-ONLY; no product edits, no commits).
- Tree audited: worktree `zl-keel-audit` at `4e974db` (repaired dev tree; CSP repair + CI portability fixes).
- Evidence dir: PRESENT and read — `/home/moe/Downloads/Warsha/bridge-io/policy/2026-11-10-keel/`
  (`state.json`, `acceptance.json`, `packets/K1|K2|K3/{report,review,verify}.md`). Treated as CLAIMS only;
  every status below was re-verified against this tree's code, and the frozen gate tests were re-run here.
- Lead correction: the task brief places `gate_integrity.rs` in `crates/warsha-core` — on this tree it lives in
  `crates/warsha-pipeline/src/gate_integrity.rs`. `warsha-core` only defines the `GateState` shape
  (`crates/warsha-core/src/lib.rs:128-145`), which carries **no hash field**.
- AGENTS.md note: per the task's read-only constraint (only this file may be written), `PROGRESS.md` was
  deliberately left untouched; the delegating agent should record this audit's outcome there.

## 1. Verdict table

| Packet | Sub-item | Status | Evidence (enforcement file:line + proving test) | What is missing |
|---|---|---|---|---|
| K1 | Current-gate check (approve ahead refused) | DONE | `crates/warsha-pipeline/src/gate_integrity.rs:15-46` (`ensure_gate_decidable`: must be gate `:15-21`, must be `Running` `:23-28`, must be current stage `:30-35`, must be `Pending` `:37-43`). Daemon `gates.approve` `crates/warshad/src/lib.rs:2885-2899` delegates to `pipeline.approve_gate` with no bypass path. Test `gate_integrity::approving_a_gate_the_run_has_not_reached_is_refused` — PASS (re-run here, 4/4 in module). | Nothing |
| K1 | Same rule for reject / changes | DONE | `approve_gate` `:1546`, `reject_gate` `:1600`, `request_changes` `:1657` all call the same `ensure_gate_decidable`; daemon `gates.reject` `:2901-2916`, `gates.changes` `:2918-2933` delegate likewise. Same refusing test covers all three ops; `approving_the_current_gate_succeeds_once` asserts second decision of any kind → `GateNotPending` — PASS (re-run). | Nothing |
| K1 | Decision bound to artifact hash | DONE (with design note) | Hash computed fresh at decision time `:1547`, `:1601`, `:1658` via `artifacts_sha256` (`gate_integrity.rs:53-66`, FIPS 180-4 impl `:74-270`) and recorded in the `GateDecision` event payload `:1571`, `:1628`, `:1685`. Test `the_gate_decision_event_carries_the_artifacts_hash` — PASS (re-run). NOTE: binding is event-log evidence; `GateState` has no hash field and no later step re-validates it. Replay is structurally prevented instead: a decided gate is no longer `Pending`, so any repeat decision is refused. | Nothing — matches the packet's claimed scope |
| K1 | `gate_evidence` (E5) | DONE as claimed (standalone helper, not decision-path) | Collector `crates/warsha-pipeline/src/gate_evidence.rs:78-92`, secret masking `:133-145`; NOT called from any decide path (verified by inspection). Tests `evidence_carries_the_diff_files_and_a_passing_test`, `a_failing_test_is_recorded_not_hidden`, `a_chatty_test_is_capped`, `a_hanging_test_times_out`, `option_like_names_are_refused`, secret-redaction tests — present (not re-run; out of K1 frozen gates). | Nothing — the packet never claimed decision-path wiring |
| K2 | Per-run lock (no overlapping `runs.advance`) | DONE | Locks defined `crates/warsha-pipeline/src/lib.rs:259,262` (`exec_lock`/`state_lock`), `control_for` `:309`; held in `advance_stage` `:445-446,452` and `advance_to_next_gate` `:946-947`. Daemon `runs.advance` `:4241-4253` holds it indirectly via `advance_to_next_gate`; `runs.followup` holds it directly `:4337-4338` + cancel-flag check `:4339`. Tests `run_integrity::*` (7/7 PASS re-run), `agent_lock::*` (5/5 PASS re-run). | Nothing |
| K2 | Versioned (CAS) updates | DONE in daemon, not only store | `Store::update_run_cas` `crates/warsha-store/src/lib.rs:457`, migration `crates/warsha-store/migrations/003_run_version.sql:3`. Daemon `runs.followup` commits via CAS `:4380` (after `get_run_versioned` `:4342-4347`); advance/resume/cancel go through pipeline CAS writes (`lib.rs:487`, `:976`, `:1105,:1137,:1161,:1181`, `:1030`). Plain `update_run` in `warshad/src/lib.rs` appears only in tests. Tests `cas::concurrent_update_with_stale_version_is_rejected`, `cas::sequential_cas_updates_increment_version`, `cas::recovering_interrupted_runs_bumps_version` — PASS (re-run, 4/4). | Nothing |
| K2 | Real cancel (stays cancelled) | DONE | `cancel_run` `crates/warsha-pipeline/src/lib.rs:1020-1037` (cancel signal + `state_lock` + CAS retry loop); commit guard `:680-691` re-checks flag/`Cancelled` before writing; daemon wrapper `:4298-4311`. Daemon `runs.followup` refuses cancelled/terminal runs `:4339-4359`. Tests `run_integrity::stale_stage_write_cannot_overwrite_cancelled_status`, `runs_followup::stale_followup_cannot_resurrect_cancel_and_valid_followup_bumps_version` (`warshad/src/lib.rs:10342`) — PASS (re-run). | Nothing |
| K2 | `runs.resume` | DONE | Registered: `METHOD_POLICIES` row `crates/warshad/src/auth.rs:664-668`, trait decl `:1695-1696`, handler `:4313-4320`. Tests `runs_resume::*` (4/4 PASS re-run: authz, change-request resume, budget-pause resume, restart-recovery resume). | Nothing |
| K2 | Change-request loop (changes → pause → resume re-enters) | DONE | `request_changes` sets `ChangesRequested` + `Paused` + CAS `crates/warsha-pipeline/src/lib.rs:1645-1673`; `resume_run` re-opens gate to `Pending`, resets `current_stage` to producing stage, `Running` + CAS `:1094-1124`. Tests `run_integrity::change_request_reopens_gate_and_reruns_stage_with_feedback`, `runs_resume_resumes_paused_run_after_change_request` (asserts `GateA/Pending`) — PASS (re-run). | Nothing |
| K2 | Restart recovery | DONE, wired on startup | Daemon startup calls `recover_interrupted_runs` `crates/warshad/src/lib.rs:6216` → pipeline `:1258-1260` → store `Running→Paused` via CAS `crates/warsha-store/src/lib.rs:515-530` (+ `Error` event `run_interrupted`). Tests `daemon_restart_recovers_interrupted_run_and_runs_resume_resumes_it` (`:10274`), `cas::recovering_interrupted_runs_bumps_version` — PASS (re-run). | Nothing |
| K3 | No `FakeProvider` fallback for unrouted roles | DONE | `dispatch_chat` order `crates/warsha-pipeline/src/lib.rs:824-848`: routed role → env-key real provider → `WARSHA_LLM_PROVIDER=fake` exact-match opt-in → else `Err(NoProviderRouted)`. No silent-fake arm. Router pre-registration (`crates/warsha-providers/src/lib.rs:644-646`, daemon `:6032`) makes `fake` visible/routable but never auto-dispatched; `routing_for` errors when unrouted (`warsha-providers/src/lib.rs:884-893`). Tests `provider_truth::*` (4/4 PASS re-run), `status_truth::*` (6/6 PASS re-run). | Nothing |
| K3 | No `MockRoutineRunner` / scout mocks in production | DONE | `MockRoutineRunner` defined and used only inside `#[cfg(test)]` (`crates/warsha-pipeline/src/routines.rs:578-1057`); production runs `UnavailableRoutineRunner` (`:173-182`), wired by daemon `:6130`. Zero `In real implementation` / `mock proposals` hits in non-test sources of `warsha-pipeline` + `warshad` (matches amended K3.1 gate). Test `status_truth::scout_registry_seam_reports_honest_catalog_unavailable_in_production` + `unavailable_routine_runner_refuses_execution_honestly` — PASS (re-run). | Nothing — out-of-scope prose hits in `warsha-backends`/`warsha-cli`/`warsha-remote` belong to E4/K9/K7, per the amended K3.1 scope |
| K3 | `health` reports probed capabilities | DONE | `probe_capabilities` `crates/warshad/src/lib.rs:1262` (store `list_projects`, provider enablement/routing, keychain probe); consumed by RPC `health` `:2601-2603` and HTTP `health_handler` `:5813-5814`, status derived `healthy`/`degraded`. Test `health_reports_probed_capabilities` (`:11364`) — PASS (re-run). | Nothing |

Tests re-run on this tree (all green, this session): `warsha-pipeline --lib gate_integrity` 4/4,
`warsha-store --lib cas` 4/4, `warsha-pipeline --lib run_integrity` 7/7, `warsha-pipeline --lib status_truth` 6/6,
`warshad --lib runs_resume` 4/4, `warshad --lib provider_truth` 4/4,
`warshad --lib health_reports_probed_capabilities` 1/1, `warshad --lib runs_followup` 1/1,
`warshad --lib agent_lock` 5/5. Full workspace suite was NOT re-run (local gates cited in context: cargo 928/0/10, JS 1552).

## 2. Packet specs for gaps

**No gaps. No follow-up packets required.** Every K1/K2/K3 sub-item verifies in this tree's code with the
enforcement at the cited file:line and a passing test. Therefore no minimal packet specs are owed
(the deliverable contract specifies specs only per PARTIAL/GAP).

Two observations for the implementing lanes (not gaps, no action in this lane):
1. `MockProvider` is registered on the daemon startup path (`crates/warshad/src/lib.rs:6019-6025`, "for testing").
   Same explicit-routing logic as `FakeProvider` applies — it answers only if an owner routes a role to `"mock"` —
   so it is not a silent fake, but the label invites confusion with the K3 story; a future packet may want to
   gate it behind an explicit env/test flag or rename the comment.
2. K1's artifact-hash binding is audit evidence in the `GateDecision` event, not a re-validated state field
   (`GateState` has no hash slot). If a future milestone wants cryptographic replay *prevention* rather than
   replay *detection*, that would be a new packet (store expected hash in gate state, verify on advance) —
   it is outside what KEEL K1 claimed.

## 3. Verdict

R-KEEL's K1, K2 and K3 are DONE on this tree (`4e974db`): the current-gate + single-decision rule is enforced
for approve, reject and changes through the daemon RPCs (which delegate to the single pipeline check with no
bypass) with the artifact hash recorded on every decision event; per-run locking, CAS versioned writes, real
cancel, `runs.resume`, the change-request loop and restart recovery are all wired through the daemon paths
(not just store/pipeline unit level); and there is no silent fake anywhere in production dispatch — unrouted
roles get an explicit error, `MockRoutineRunner` is test-only with `UnavailableRoutineRunner` in production,
scout seams report `CatalogUnavailable` honestly, and `health` serves probed capabilities. All frozen gate
tests re-run green here. No closing packets are needed for K1–K3; the smallest next step is none — proceed to
auditing K4–K8 (or accept K1–K3 as complete) rather than writing implementation packets.
