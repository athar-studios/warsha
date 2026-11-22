# D5 — Swarm run mode (packet report)

Branch `r-next/d5-swarm`. Worker partials (corr-4 @ `6dd7553`) + PM takeover
implementation @ `6163644`; merged into `r-next/integration` as PM merge
`feda620` (`--no-ff`, 0 conflicts). Entry gate satisfied: N0, N1, N3, B2, B3,
D4 all merged before start (per PROGRESS merge order).

## What shipped

### Datum (worker corr-4, committed `6dd7553`)
- `crates/warsha-store/migrations/017_run_subtasks.sql` — `run_subtasks`
  (id UUID PK, run_id FK, session_id FK nullable, title, files JSON,
  status TEXT) + `project_settings` (project_id TEXT PK, `enable_swarm`
  BOOLEAN NOT NULL DEFAULT FALSE, `max_parallel_agents` INTEGER NOT NULL
  DEFAULT 4).
- `crates/warsha-store/src/settings.rs` — `load_project_swarm_settings` /
  `save_project_swarm_settings` (upsert), defaults false/4.
- `crates/warsha-pipeline/src/swarm.rs` skeleton — Subtask/SubtaskReceipt/
  SubtaskStatus, BudgetReservations, SwarmScheduler, SwarmMerger stub,
  `RunReceipt.subtasks: Vec<SubtaskReceipt>` (serde default).

### Runtime (PM, commit `6163644`)
- `crates/warsha-core/src/subtask.rs` — `RunSubtask` +
  `RunSubtaskStatus{Queued, Dispatched, Succeeded, Failed, Conflicted,
  Unmerged}` (snake_case serde, Display, named parse).
- `crates/warsha-store` — `create_run_subtask` / `update_run_subtask` /
  `list_run_subtasks` over migration 017 (row mapping after
  `session_from_row`; unknown status → `StoreError::ParseError`).
- `crates/warsha-pipeline/src/swarm_runtime.rs` — `swarm_code_completion`
  hooked into `code_stage_completion` when the project's `enable_swarm` is
  on (settings read through `Store.settings()`; default off/4):
  - Decomposition from the run's `plan_tasks` (else `brief` else prompt)
    artifact; bullet-only parser with `files:` suffix; a subtask with no
    declared files runs alone (nothing else dispatched while it runs).
  - Scheduler: max parallel = per-project setting, default 4, hard cap 20
    (`MAX_PARALLEL_HARD_CAP`); declared-file overlap serializes.
  - Per-agent cap = run budget ÷ max parallel; `BudgetReservations`
    reserve at dispatch (A16.7) and release on settle; dispatch stops when
    the remaining budget after spend and outstanding reservations cannot
    fit one more cap; per-receipt cost recorded on settle (CLI spend is
    recorded at session end — surfaced in the swarm summary).
  - Rate-limit stop (A16.6): first rate-limit from any agent stops new
    dispatch for the run; running agents finish; queue left queued;
    "rate-limited halt" in the completion/summary surface.
  - Child sessions with `parent_session_id` = the run's coder session
    (N1 parent link); each subtask gets its own git worktree
    `run-{id}-subtask-{ulid}` and branch `warsha/run-{id}-subtask-{ulid}`
    (N3 mechanism, flat naming — see decisions below).
  - Read-only backstop per subtask (dirty-set before/after + restore),
    mirrors the single-agent Code path.
  - One designated merger session; merges each succeeded subtask branch
    `--no-ff` into the run branch locally — nothing is pushed, no remote.
  - Conflicts: `git merge --abort`, subtask re-queued `Conflicted`, at
    most 2 re-dispatches, then `Unmerged` and reported failed. Never
    force-merged.
- 8 engine acceptance tests (`crates/warsha-pipeline/tests/d5_swarm_engine.rs`):
  dispatch+local merge; overlap serialize + runs-alone; load at 8 and
  guard at 20 (cap never exceeded, per-agent caps = budget ÷ 20);
  budget-reservation block (remaining < cap → no dispatch); rate-limit
  halt; filesystem isolation between subtasks; conflict → queue →
  Unmerged; setting-off leaves no swarm path (no rows, no worktrees).
- `warshad`: `runs.subtasks` (Session/Standard),
  `swarm.project.get` (Session/Standard), `swarm.project.set`
  (Owner/Standard) + auth rows.
- Client: `listRunSubtasks`, `getSwarmSettings`, `setSwarmSettings`
  (literal params, wire-clean); strict decode with named errors.
- Desktop: `SwarmSection` (per-project toggle + max-agents 1..=20 +
  honest copy A16.6 — "20 is a ceiling, not a throughput claim"); settings
  section id `swarm` (advanced); action id `settings.swarm.save` registered
  + e2e case; run-mode picker shows Swarm only when the project's
  `enable_swarm` is on (v5 note; a swarm run is an agent run — no separate
  wire mode); i18n `swarm.*` folded into `settings.ts` catalogs (ar
  reworded Latin-free per gate rule I4); orphan `swarm.json` removed.

## Engine CAS/cost fixes made during the takeover (recorded for the audit trail)
- The stage commit block CAS'd with the pre-stage version → VersionConflict
  when a stage bumped the run row mid-stage (swarm per-receipt costs).
  Commit block now commits on the latest version and syncs the caller's
  run struct.
- Swarm completion previously double-counted spend; per-receipt
  `record_cost` is now the single accounting path (completion cost 0).

## Decisions
- D-RN-D5-001: flat subtask naming `run-{id}-subtask-{ulid}` (worktree
  path/branch) — `create_run_worktree` validates the run-id charset and
  cannot carry `/`; the slash form silently failed every dispatch.
- D-RN-D5-002: `BudgetReservations` release-on-settle — without it the
  dispatch loop spun after max_parallel dispatches (reservations never
  released). `try_reserve` signature and error text unchanged.
- D-RN-D5-003: swarm spend accounting goes only through per-receipt
  `record_cost` (CAS commit path); the swarm StageCompletion carries cost 0.
- D-RN-D5-004: no separate swarm wire mode — the picker's swarm choice
  starts an `agent` run; the project setting carries the behaviour.
- D-RN-D5-005: swarm i18n lives in `settings.ts` catalogs (the i18n gate
  reads `.ts` only); orphan `swarm.json` files removed.

## Gates (PM-verified on the lane tree @ `6163644` and post-merge on integration)
- cargo fmt --check clean; clippy --workspace --all-targets -D warnings 0.
- cargo test --workspace 0 failed (incl. d5_swarm_engine 8/8, store 51+,
  pipeline 518+, swarm_budget/swarm_scheduler/swarm_overlap).
- desktop 876/876; client 194/194; ui 383/383.
- i18n-gate 912 keys 0 violations; wire 11 checks / 4 violations (the
  pre-existing A1 debt catalog.refresh/apply — unchanged set); arch 5/0;
  policy 8/0; actions 167 registered / 174 used / 19 violations (the
  pre-existing set — D5 adds none, and adds 1 registered id + 1 e2e case);
  ds-v3 unchanged (2 pre-existing outside-scope hits); gitleaks clean;
  cargo deny: bans/licences/sources ok, advisories FAILED (pre-existing
  RUSTSEC set — unchanged).

## Honest copy check (A16.6)
The settings row carries `swarm.enable.description` ("Swarm parallelism
uses more tokens and budget … Experimental.") beside the toggle and the
max-agents control, plus `swarm.max_agents.capped` ("Hard cap 20").

## Spend
- D5 spend ≈ 15 of cap 20 (worker corr-4 partial ≈ 6, PM takeover ≈ 8,
  seam ≈ 1 already charged). Cumulative ≈ 154 of 400 (38.5%).
