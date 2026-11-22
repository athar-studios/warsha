# R-ENGINE audit — verdict against code at `bf55dec` (`zl-rengine-audit`)

Scope: Architect/Planner lane, READ-ONLY. No product code changed. Tree is the
repaired dev tree after R-KEEL (K1–K9 + checkpoint PASS) and R-SEC (all 22
checkpoint findings closed). Prior run claims (`COMPLETION_STATUS.md`,
2026-11-11) say: E1b/E2/E3/E4/E5/E5a/E6 slices DONE; E2/E3/E5 daemon wiring DONE
(`2f763dd`/`42b9a93`/`56d552e`); NOT DONE: H1, rest of E1, E7, E8. Every claim
is treated as unverified below — the code is the judge.

Prior-work staleness notes (context, not verdicts):
- `COMPLETION_STATUS.md` is older than `PROGRESS.md` (R-SEC-7, 2026-11-13
  runs). `COMPLETION_CHECKLIST.md:95,99,115` still lists "Wire per-run agent
  loop", "`projects.attach` RPC", "Wire Gate C evidence collection" as
  `[ ]` pending — the code shows the first and third are *partially* wired
  (diff/tests side DONE, remainder GAP). The checklist is stale, not the code.
- `PROGRESS.md:86` records `scripts/cp5-stub-scan.sh` as absent (recorded
  not-run, no fabricated pass). Same rule applies here: anything not found in
  code is GAP, not assumed.

## 1. Verdict table

| Item | Sub-item | Status | Evidence (file:line + test) | What is missing |
|---|---|---|---|---|
| E1 | cancel | DONE | Enforce: `crates/warsha-pipeline/src/lib.rs:1020` `cancel_run` (CAS-loop to `Cancelled`, `run_cancelled` event); worker abort via `tokio::select! biased` on `cancel_rx` at `:645-658`; re-checks in `advance_stage_locked` `:453`, `execute_stage_with_feedback` `:532`, `record_stage_failure` `:874`; `resume_run` refuses `Cancelled` at `:1067`; RPC `crates/warshad/src/lib.rs:4351` `cancel_run`. Tests: `cancel_during_stage_aborts_worker_and_leaves_no_artifact` (`crates/warsha-pipeline/src/run_integrity.rs:259`); `stale_stage_write_cannot_overwrite_cancelled_status` (`run_integrity.rs:340`). KEEL K2 `runs_followup`/CAS tests also cover this. | Nothing. |
| E1 | streaming | DONE | Enforce: `crates/warshad/src/lib.rs:295` `EventSequencer::publish` (stamps `seq`), `:319` `subscribe`, `:334` `sync` (gap/resync); RPC `subscribe_run` at `:4270` (`events.sync` + run fetch); single-writer pump at `:6434`; `/events` socket at `:7574`. Tests (`crates/warshad/tests/events_stream_sync.rs`): `seq_is_monotonic_across_start_advance_approve_followup_cancel_artifacts` (`:357`); `reconnecting_with_since_seq_replays_later_frames_in_exact_order` (`:542`); `reconnecting_with_last_event_id_header_replays_later_frames_too` (`:550`); `a_cursor_the_ring_cannot_honour_answers_gap_and_resync` (`:588`). | Nothing. |
| E1 | budget pre-check | PARTIAL | Enforce (mid-run/resume only): `crates/warsha-pipeline/src/lib.rs:432` `ensure_budget`, called in `advance_stage_locked` `:464` and `execute_stage_with_feedback` `:540`; `resume_run` refuses `spent >= budget` at `:1082`; `set_run_budget` at `:1239`; RPCs `budget.set` / `budget.show` at `crates/warshad/src/lib.rs:3530` / `:3507`. Tests: `budget_exceeded_pauses_and_resumes_after_budget_increase` (`run_integrity.rs:452`); `runs_resume_budget_paused_run_succeeds_after_budget_set` (`crates/warshad/src/lib.rs:10673`). | No start-time refusal and no ask-first/confirm gate: `start_run` (`crates/warsha-pipeline/src/lib.rs:334`) always creates `budget_cents: None` and never checks. No test for refuse-to-start-over-budget. |
| E1 | real discovery | PARTIAL | Enforce (half): `execute_stage_with_feedback` (`crates/warsha-pipeline/src/lib.rs:554-596`) loads real catalog — `settings.get_active_harness` → `get_harness` → match `harness_def.stages` by `role` → `prompt_template` override, plus enabled-skills preamble from `settings.list_skills`. | Stage-to-role map itself is canned: `role_for_stage` (`crates/warsha-pipeline/src/prompts.rs:60`, static `match`); stage list is `Stage::all()` enum (`lib.rs:351`); fallback harness `"autonomous-factory"`. No test pins real-harness-vs-canned prompt selection. |
| E1 | project language | GAP | `Project.language` is stored by `create_project` (`crates/warshad/src/lib.rs:2643`), but `start_run` (`crates/warsha-pipeline/src/lib.rs:334`, daemon call at `crates/warshad/src/lib.rs:2678`) never reads it; `render_prompt` (`crates/warsha-pipeline/src/lib.rs:1508-1514`) hardcodes `result.replace("{{language}}", "en")` with comment "This is a simplification - in reality we'd get language from project". Tests only assert hardcoded `"en"` (`lib.rs:1865,1890,1984,2025,2068,2110`). | Plumbing: thread `Project.language` into run context / `render_prompt`; test with a non-English project language. |
| E2 | model-driven loop + tool calling, per run | PARTIAL | Loop: `crates/warsha-pipeline/src/agent_loop.rs:421` `run_turn(input, skills)`, `:352` `with_router`, `:379` `has_router`, tool path via `ToolExecutor` / `execute_turn` (`MAX_TOOL_OUTPUT_LINES` at `:67`). Per-run: `crates/warsha-pipeline/src/agent_sessions.rs:39` `RunAgentSessions`, `:73` `insert` refuses `Duplicate`, `:95` `run_turn(run_id, …)` in run's own `AgentLoop`. Wiring: `crates/warshad/src/lib.rs:2790` `build_agent_loop_in(…)` + `:2798` `insert(run.id, per_run_loop)` at `runs.start`; `:3732` `agent_turn_run` → `agent_sessions.run_turn`. Tests: `two_runs_keep_independent_mode_and_context`, `a_duplicate_run_is_refused_and_the_first_loop_stays`, `an_unknown_run_is_not_found`, `removal_drops_the_session` (`agent_sessions.rs:125-194`); daemon `mod e2_wiring` at `:13226-13296`; `agent_turn_runs_a_tool_inside_the_agent_workspace` at `:9092`. | Legacy global `agent_loop` (`crates/warshad/src/lib.rs:1100`) + `agent.turn` (`:3693`) still exists alongside per-run sessions (comment at `:2781-2784` says so explicitly). `COMPLETION_CHECKLIST.md:95` "Wire per-run agent loop" is stale as a code claim — wired — but retiring/gating the legacy loop is the real remainder. |
| E3 | repo attach + per-run worktree, files via tools | PARTIAL | Worktree: `crates/warsha-pipeline/src/worktree.rs:70` `create_run_worktree`, `:51` `worktree_path`; daemon `crates/warshad/src/lib.rs:2742-2779` (`if let Some(repo_path)` → `create_run_worktree(…)` → cancel run on failure), `:2785` workspace = worktree path, `:2810` `runs.worktree` RPC. Tests: `a_run_gets_its_own_detached_worktree`, `removal_takes_the_worktree_away` (`worktree.rs:173-252`); `a_repository_backed_run_gets_its_own_worktree` (`mod e3_wiring`, `crates/warshad/src/lib.rs:13131-13226`, test ~`:13173`). Files-via-tools is proven on the agent-loop side (`FilesystemToolExecutor`, `agent_loop.rs:1209,1580,1649,2134`, read-before-write guard at `:2134`). | No `projects.attach` RPC: grep finds only `repo_path` read at `runs.start`; `COMPLETION_CHECKLIST.md:99` "`projects.attach` RPC … pending" is accurate. Attaching an existing repo today = setting `repo_path` at project create; no attach/clone/init path in the daemon. |
| E4 | coding-CLI backend, reachable | PARTIAL | Exists: `crates/warsha-backends/src/lib.rs:134` `CliBackend`, `:144` `new`, `:159` `task_prompt`, `:184` `execute`, `:142` `CODING_CLI_TIMEOUT`; `:293` `BackendFactory`, `:340` `all_available()` filtered by `is_available()`. Reachable-ish: `crates/warshad/src/lib.rs:1068` `pub backends`, `:6306` `BackendFactory::all_available()`, `:7885` test state. Tests: `the_prompt_names_the_task_files_and_context`, `a_fake_cli_receives_the_prompt_and_its_changes_are_reported` (`crates/warsha-backends/src/lib.rs:413-479`), `test_cli_backend_check`. | Never invoked: no caller of `backends.*.execute(task)` in `warshad`/pipeline (grep: only construction at `:6306`/`:7885`). Selectable inventory, not wired into the Code stage. |
| E5 | Gate C evidence (diff + tests + preview) | PARTIAL (diff+tests DONE; preview GAP) | Enforce (diff+tests): `crates/warsha-pipeline/src/gate_evidence.rs:77` `collect_gate_evidence` (`:17` `GATE_EVIDENCE_CAPTURE_BYTES`, `:19` `GATE_EVIDENCE_TIMEOUT`); handler `crates/warshad/src/lib.rs:2820` `gate_evidence` → `:2834` `Stage::GateC` gate, `:2844` worktree required ("no worktree" error), `:2860` `policy.check_program` + `:2863` `collect_gate_evidence`. `GateEvidence { diff, files_changed, tests }` at `gate_evidence.rs:67-74`. Tests: `evidence_carries_the_diff_files_and_a_passing_test`, `a_failing_test_is_recorded_not_hidden`, `a_chatty_test_is_capped`, `a_hanging_test_times_out`, `option_like_names_are_refused`, `evidence_needs_gate_c_and_a_worktree` (`crates/warshad/src/lib.rs:13373-13449`, `mod e5_wiring` at `:13296-13451`; `gate_evidence.rs:294+`). R-KEEL/CP hardening applies here — solid. | Preview is not part of evidence: `GateEvidence` has no preview field; `LivePreviewManager` / `preview.*` (`crates/warsha-pipeline/src/process_spawn.rs`, daemon preview RPCs) is unrelated to Gate C. `COMPLETION_CHECKLIST.md:115` "Wire Gate C evidence" is stale for diff/tests, true for preview. |
| E6 | skills scoped per role + lock file | PARTIAL (library DONE; daemon wiring GAP) | Library: `crates/warsha-pipeline/src/skills.rs:161` `skills_for_role` ("never silent-skip, error fail-closed"), `:512` `SkillsLockfile::verify` fail-closed both directions, `:437` `SkillsLockEntry`, `:457` `SkillsLockfile`, `:178` `default_role_packs`. Tests: `role_packs_return_only_their_own_skills_and_fail_closed_on_a_gap`, `verification_fails_on_version_or_commit_drift_and_on_an_unlocked_skill`, lock round-trip (`skills.rs:710-812`). | Wiring: daemon `crates/warshad/src/lib.rs:5394-5425` `SKILL_CATALOG` hardcoded ("until that wiring exists … nothing here reads a directory or a lockfile", `:5397-5400`); `:2590` `active_skill_catalog()` serves constants + settings rows, never `SkillRegistry` / `skills_for_role` / `SkillsLockfile::verify`. |
| H1 | split `warshad/src/lib.rs` | GAP (known NOT DONE) | File is `13451` lines (`wc -l`). Structure mapped in section 2. No split started. | The whole split (section 2 is the H1 packet plan). |
| E7 | one SQLite stack | PARTIAL (one native lib; two Rust API stacks) | Manifests: workspace `Cargo.toml:41` declares `sqlx 0.8` (features `runtime-tokio-rustls, sqlite, migrate, chrono, uuid, json`); `crates/warsha-store/Cargo.toml:12` inherits it, `:13-16` adds `rusqlite 0.32` (`bundled`) with comment pinning to the `libsqlite3-sys 0.30` line `sqlx` links so the workspace keeps exactly one native SQLite (`links = "sqlite3"`). No other crate declares `rusqlite`/`sqlx`/`libsqlite3-sys`; `crates/warshad/Cargo.toml` has no direct SQL dep (uses `warsha-store` by path). `Cargo.lock` contains exactly one `libsqlite3-sys` (`0.30.1`). | Two Rust APIs over that one native lib: async `sqlx` pool + migrations (`crates/warsha-store/src/lib.rs`: `Store`, `sqlx::migrate!("./migrations")`) vs sync `rusqlite::Connection` + own idempotent migration (`crates/warsha-store/src/persistence.rs`: `SqliteStore`). E7 = unify the API stack (migrate `SqliteStore` tables into the `sqlx` migrator or vice versa), then drop one dep. Hard constraint: DO NOT upgrade `libsqlite3-sys` — OD-S1c keeps `0.30.1` pinned (`deny.toml:144-170`, `DECISIONS.md:1665+`, `SECURITY.md:268-284`); RUSTSEC-2026-0459 is accepted risk because `sqlx-sqlite 0.9` caps `libsqlite3-sys <0.38` while `rusqlite 0.41` requires `^0.39` (unresolvable today). |
| E8 | pilot | GAP (undefined) | `PLAN.md:29` lists "`E8` pilot" as the last ENGINE item with no expansion; `PLAN.md:14` lists "`SH5` pilot" for R3 the same way. `grep [Pp]ilot` under `docs/` returns no matches; full-text `grep E8\|SH5\|pilot` on `PLAN.md` returns only those two lines. `COMPLETION_STATUS.md:10,24` mentions "pilot" only inside the FIN label ("version sweep/pilot/1.0-rc"). | No acceptance criteria exist. Packet P-E8 below proposes the minimal mock-provider end-to-end, but its scope is owner-gated until the owner confirms or redefines "pilot" (real-provider keys would additionally gate it). |

## 2. H1 split plan — `crates/warshad/src/lib.rs` (13,451 lines)

### 2.1 Module map (approximate boundaries, ±20 lines)

| Region | Lines | Contents |
|---|---|---|
| header | 1-77 | imports, `mod auth/lock/providers/settings/wave2`, `pub use` |
| rpc session helpers | 79-111 | `session_extensions`, `owner_session`, `anonymous_session` |
| errors | 113-151 | `DaemonError` (`thiserror`) |
| streaming | 187-403 | `SequencedEventFrame`, `RunStreamSync`, `StreamSync`, `EventSequencer` (`publish` :295, `sync` :334) |
| scrub/firewall | 405-522 | token scrubbing, `windows_firewall_command` |
| config | 524-640 | `DaemonConfig`, `Default`, `default_bind_host` |
| handle | 640-808 | `DaemonHandle` |
| auth layer | 808-1020 | `RpcAuthLayer`, `RpcAuthService`, `bearer_token`, `rpc_refusal` |
| args | 1020-1063 | `DaemonArgs` |
| state | 1063-1323 | `DaemonState` struct (`store/providers/pipeline/backends/…/agent_loop/agent_sessions/processes/mcp/previews/settings/…/events`), small impl + `McpPermissionRow` |
| rpc trait | 1324-1869 | `#[rpc(server)] pub trait WarshaApi` (runs, gates, processes, MCP, plugins, …) |
| DTOs | 1869-2050 | `HealthCapabilities`, `HealthResponse`, `ProviderRecord`, `RoleRoutingConfig`, `BudgetStatus`, `GateSummary`, `AgentState` |
| rpc helpers | 2050-2617 | `WarshaRpc::new`, `backend_kit`, stored-harness/skill/plugin/integration, `check_plugin_launch`, `process_policy`, `authorize`, `agent_switch` |
| rpc impl | 2617-5327 | `impl WarshaApiServer` — runs/projects `:2634-2902`, gates `:2902-2952`, providers/devices `:2990-3416`, agent `:3693-3732`, processes/MCP/routines/pairings, `subscribe/advance/cancel/resume/followup` `:4270-4493`, harnesses/skills `:4493-4719`, plugins `:4719-5059`, integrations/project-files `:5059-5327` |
| rpc errors + seeds | 5327-5947 | `rpc_*` constructors, `skill_catalog`, `seed_*`, `build_agent_loop` |
| http/csp | 5947-6195 | `health_handler`, `pairing_origin`, `REMOTE_CSP`, `http_app` + CSP middleware |
| startup | 6198-6656 | `start_daemon*` trio, lock, `warsha.db` open, `InMemoryProcessManager/McpManager` |
| daemon run | 6656-7390 | `run_daemon`, config/env, `auth_handler_inner`, static assets |
| events socket | 7390-7705 | `events_handler`, `EventStreamParams`, `handle_socket_command`, `handle_events_socket` |
| tests | 7706-12235 | `mod tests` (harness, policy, gates, process+MCP, preview/routines, CSP at `:12235`) |
| health/pair/origin/e2/e3/e5 tests | 12303-13451 | `health_reports_probed_capabilities` + stub `SecretStore`, `mod pair_repair`, `mod origin_guard`, `mod e3_wiring`, `mod e2_wiring`, `mod e5_wiring` |

### 2.2 Target layout

```text
crates/warshad/src/
  lib.rs            # re-exports only (trait + state + start fns), ~150 lines
  state.rs          # DaemonState, DaemonConfig, DaemonArgs, DaemonHandle
  api.rs            # WarshaApi trait + DTOs
  rpc/
    mod.rs          # WarshaRpc struct, authorize, constructors
    runs.rs         # runs/projects/subscribe/advance/cancel/resume/followup + E2/E3 wiring
    gates.rs        # approve/reject/request_changes/list_gates + E5 handler
    providers.rs    # providers/devices/agent_turn(_run)/harnesses/skills
    processes.rs    # spawn/stop/status/list + previews + routines
    mcp.rs          # connect/disconnect/list/send/call + permissions
    plugins.rs      # list/install/toggle/configure/remove + integrations/files
  events.rs         # EventSequencer + StreamSync + socket handlers
  auth.rs           # (exists) RpcAuthLayer/Service + session helpers + DaemonError
  http.rs           # health_handler, http_app, CSP middleware, static assets
  startup.rs        # start_daemon* + run_daemon + seeds (seed_*)
  tests/            # matching split of mod tests (gates.rs, processes.rs, …)
```

### 2.3 Step order (most self-contained first; each step = pure move, no behaviour change)

1. `errors` + session helpers → `auth.rs` (leaf, no deps).
2. `streaming` (`EventSequencer`…) → `events.rs` (leaf; socket handlers follow in step 6).
3. `scrub/firewall` + `config/handle/args` → `state.rs` part 1.
4. `DaemonState` struct + small impl → `state.rs` part 2.
5. `DTOs` + `WarshaApi` trait → `api.rs` (trait only; impl stays).
6. `events socket` handlers → `events.rs` part 2.
7. `http/csp` → `http.rs`.
8. `rpc errors` + seeds + `build_agent_loop` → `rpc/mod.rs` + `startup.rs` (seeds).
9. `rpc impl`, one section per step: gates → providers → processes → MCP → plugins → runs (runs last: touches E2/E3/E5 wiring, biggest blast radius).
10. `startup` + `daemon run` → `startup.rs`.
11. `tests`, mirroring the impl split, one module per step.
12. Shrink `lib.rs` to re-exports; delete nothing else.

Estimate: **~14 steps** (12 moves + 1 re-export + 1 buffer for fallout).

### 2.4 Invariants (every step)

- Pure moves: `pub(crate)` visibility, `use super::…` / `use crate::…`
  re-exports so no caller changes.
- After EVERY step: `cargo fmt --check`, `cargo clippy -D warnings`,
  `cargo test` (workspace) green; behaviour identical (no logic edits in
  move steps — split diffs from logic diffs).
- AGENTS.md constraints hold throughout: stable toolchain, no `unwrap()` in
  non-test code, errors via `thiserror`/`anyhow`, tests with every change,
  no real model APIs in tests (mock provider), no secrets, UI strings via
  i18n catalogs (ar + en) where touched.

## 3. Packet specs (one per PARTIAL/GAP)

Common constraints for every packet: AGENTS.md (stable toolchain;
`cargo fmt`, `cargo clippy -D warnings`, no `unwrap()` outside tests,
`thiserror`/`anyhow`; tests with every change; mock provider only — no
network calls to real model APIs in tests; no secrets; small Conventional
Commits; self-review; read ENGINEERING_POLICY.md before dispatching workers).
Acceptance commands run from the workspace root. "Green" = exit 0.

### P-E1a — budget start-time pre-check

- Goal: a run refuses to start over budget / asks first.
- Targets: `crates/warsha-pipeline/src/lib.rs:334` (`start_run`: honour
  project/default budget instead of always `budget_cents: None`);
  `crates/warshad/src/lib.rs` (`runs.start` passes budget through;
  `budget.set`/`budget.show` at `:3530`/`:3507` unchanged).
- Tests: `start_run` with `spent >= budget` is refused (or requires explicit
  confirm flag — decide, log in DECISIONS.md, never ask); `runs_resume`-style
  daemon round-trip for start-refusal.
- Accept: `cargo test -p warsha-pipeline budget` → pass, incl. new test;
  `cargo test -p warshad budget` → pass; `cargo clippy -D warnings` → 0.

### P-E1b — real discovery pinning

- Goal: prove stages/roles come from real catalog data.
- Targets: `crates/warsha-pipeline/src/lib.rs:518-596`
  (`execute_stage_with_feedback`), `crates/warsha-pipeline/src/prompts.rs:60`
  (`role_for_stage`); keep `Stage::all()` (`lib.rs:351`) and
  `"autonomous-factory"` fallback, but cover the override path.
- Tests: harness with a custom `prompt_template` + stage list produces that
  prompt (fails if the canned map is used); unknown-role error path.
- Accept: `cargo test -p warsha-pipeline discovery` (new names contain
  `discovery`) → pass; `cargo clippy -D warnings` → 0.

### P-E1c — project language plumbing (GAP)

- Goal: the run knows the project's language.
- Targets: `crates/warsha-pipeline/src/lib.rs:334` (`start_run` reads
  `Project.language`), `:1508-1514` (`render_prompt` uses it instead of
  hardcoded `"en"`); daemon `runs.start` at `crates/warshad/src/lib.rs:2678`.
- Tests: project with `language: "ar"` (or any non-English) renders prompts
  with that language; existing `"en"` fixtures keep passing.
- Accept: `cargo test -p warsha-pipeline language` → pass incl. new test;
  `cargo fmt --check` + `cargo clippy -D warnings` → 0.

### P-E2 — retire or gate the legacy global loop

- Goal: one loop story — per-run is the loop; legacy `agent.turn` is either
  removed or explicitly gated/documented.
- Targets: `crates/warshad/src/lib.rs:1100` (`agent_loop` field),
  `:3693` `agent_turn` vs `:3732` `agent_turn_run`, `:2781-2805` wiring
  comment; `COMPLETION_CHECKLIST.md:95` (mark actually-done).
- Tests: existing `agent_sessions.rs:125-194` + `mod e2_wiring`
  (`:13226-13296`) stay green; add refusal/migration test for the legacy
  path (refused, or delegated to a run — decided in DECISIONS.md).
- Accept: `cargo test -p warshad e2_wiring` + `agent_turn` tests → pass;
  `cargo clippy -D warnings` → 0.

### P-E3 — `projects.attach` RPC

- Goal: attach an existing repo (clone/init/path-attach) as a project op,
  not just `repo_path`-at-create.
- Targets: new RPC next to `create_project`
  (`crates/warshad/src/lib.rs:2643`); reuse `create_run_worktree`
  (`crates/warsha-pipeline/src/worktree.rs:70`) validation; error paths
  mirror `:2764-2777` (cancel, never silently share).
- Tests: attach existing git repo → project with `repo_path`; attach
  garbage path → clean error, no project; `mod e3_wiring`
  (`:13131-13226`) stays green.
- Accept: `cargo test -p warshad e3_wiring` + new `attach` tests → pass;
  `cargo clippy -D warnings` → 0.

### P-E4 — wire the coding-CLI backend into the Code stage

- Goal: the Code stage can execute through a selected CLI backend.
- Targets: `crates/warsha-backends/src/lib.rs:134-184` (`CliBackend::execute`,
  `:159` `task_prompt`), `:293-340` (`BackendFactory::all_available`);
  call site in pipeline Code-stage execution + daemon selection plumbing
  (today only constructed at `crates/warshad/src/lib.rs:6306,7885`).
- Tests: Code stage with fake CLI receives prompt and reports changes
  (extend `:413-479` pattern to the stage path); unavailable backend →
  clean skip/error, never a hang (honour `:142` `CODING_CLI_TIMEOUT`).
- Accept: `cargo test -p warsha-backends` + new stage test → pass;
  `cargo clippy -D warnings` → 0.

### P-E5 — Gate C preview evidence

- Goal: preview joins diff+tests in what a Gate C reviewer looks at.
- Targets: `crates/warsha-pipeline/src/gate_evidence.rs:67-74`
  (`GateEvidence` gains preview handle/URL/status — read-only, never stages
  or commits); handler `crates/warshad/src/lib.rs:2820-2863` (requirement
  mirrors `:2844` worktree rule).
- Tests: extend `mod e5_wiring` (`:13296-13451`): evidence with a running
  preview carries its URL; no preview → explicit `None`, not an error.
- Accept: `cargo test -p warshad e5_wiring` → pass incl. new tests;
  `cargo clippy -D warnings` → 0.

### P-E6 — wire role-scoped skills + lockfile into the daemon

- Goal: daemon serves `skills_for_role` + `SkillsLockfile::verify`,
  replacing the hardcoded catalog.
- Targets: `crates/warshad/src/lib.rs:5394-5425` (`SKILL_CATALOG`,
  "until that wiring exists" `:5397-5400`), `:2590`
  `active_skill_catalog()`; library already DONE
  (`crates/warsha-pipeline/src/skills.rs:161,457,512`).
- Tests: daemon `skills.*` RPCs served from registry; drifted lockfile →
  fail-closed error (mirror `skills.rs:710-812` at daemon level).
- Accept: `cargo test -p warshad skills` + `cargo test -p warsha-pipeline skills`
  → pass; `cargo clippy -D warnings` → 0.

### P-H1 — split `warshad/src/lib.rs` (the section 2 plan, ~14 steps)

- Goal: section 2.2 layout with `lib.rs` ≈ re-exports only, zero behaviour change.
- Targets: `crates/warshad/src/lib.rs` (13,451 lines) → `state.rs`,
  `api.rs`, `rpc/`, `events.rs`, `http.rs`, `startup.rs`, `tests/` in section 2.3
  order.
- Tests: no new behaviour tests; the whole workspace suite is the guard.
- Accept (after EVERY step): `cargo fmt --check` → 0;
  `cargo clippy -D warnings` → 0; `cargo test` (workspace) → green.

### P-E7 — one SQLite API stack (NOT a version bump)

- Goal: one Rust API over the one native SQLite (already exactly one
  `libsqlite3-sys 0.30.1` in `Cargo.lock`).
- Targets: `crates/warsha-store/src/lib.rs` (`sqlx` `Store` + migrator) and
  `crates/warsha-store/src/persistence.rs` (`rusqlite` `SqliteStore`) —
  migrate one side's tables into the other's migrator, then drop the
  surplus dep (`crates/warsha-store/Cargo.toml:12-16`); `deny.toml:144-170`
  stays untouched.
- Tests: store + persistence suites; daemon start twice (idempotent
  migration); `cargo tree -i libsqlite3-sys` shows exactly one version.
- Accept: `cargo test -p warsha-store` → pass; `cargo deny check` → 0
  (OD-S1c ignore intact); `cargo clippy -D warnings` → 0.
- Constraint (owner decision, not negotiable in-packet): keep
  `libsqlite3-sys 0.30.1` pinned; RUSTSEC-2026-0459 stays accepted risk
  until SQLx allows `0.39+` or the milestone says otherwise.

### P-E8 — pilot (owner-gated on scope)

- Goal (proposed): end-to-end run against the mock provider proving the
  loop — attach repo → run → Gate C decision → evidence.
- Targets: none until scoped; runs on mock provider only (no real keys,
  no secrets, no network to real model APIs).
- Tests: ignored-by-default e2e (`#[ignore]`) runnable with
  `cargo test -- --ignored`; asserts gate decision + evidence contain
  diff + passing test (+ preview once P-E5 lands).
- Accept: `cargo test -p warshad -- --ignored pilot` → pass.
- Gate: owner confirms this definition of "pilot" (or redefines it); if
  real provider keys are required, that half is owner-run, never in CI.

## 4. Verdict: smallest packet set that completes ENGINE on this tree

E1-cancel and E1-streaming are DONE; everything else needs a packet:
P-E1a (budget start-time), P-E1b (discovery pinning), P-E1c (language),
P-E2 (legacy loop), P-E3 (`projects.attach`), P-E4 (CLI backend into Code
stage), P-E5 (preview evidence), P-E6 (skills wiring) — eight small
behaviour packets with P-E1c/P-E3/P-E4/P-E6 as the load-bearing GAPs;
P-H1 (the section 2 ~14-step pure-move split, runnable in parallel with
behaviour work but merged carefully); P-E7 (SQLite API unification, version
pin untouched); and P-E8 (pilot e2e, owner-gated on scope). Dependency
order: P-E1c → P-E1a/P-E1b (independent) → P-E3 → P-E2 → P-E4 → P-E6 →
P-E5 → P-E8, with P-H1 and P-E7 on separate tracks. Nothing claimed-DONE
was found fully DONE except cancel, streaming, and the diff+tests half of
Gate C — the rest is PARTIAL with the library side solid and the daemon
wiring as the gap, which is why each packet above is scoped to the wiring,
not a rewrite.
