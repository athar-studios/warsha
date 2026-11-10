# Packet K3 Report — No Silent Fakes

- Run: `2026-11-10-keel`
- Packet: `K3` (`k3-no-fakes`)
- Role: Implementer (continuation from salvaged `63ac0d1`)
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/keel/k3`
- Branch: `run/2026-11-10-keel/k3-no-fakes`
- Base commit: `e6b3e6debd23ceb27f6547a483af5392a5faaaaf`
- Head commit: `bc157e102627c3f7fe5a7fb2c8e70d4ae0502a0c`
- Status: **IMPLEMENTATION COMPLETE (with frozen-gate blockers noted for K3.1 & K3.2)**

---

## Per-Step Changes & Commits

1. `4836e87` `fix(pipeline): require explicit provider routing for stage dispatch and add provider_truth tests` (prior session)
   - Replaced silent `FakeProvider` fallback in `PipelineEngine::dispatch_chat` with `PipelineError::NoProviderRouted(role)` unless explicitly routed or `WARSHA_LLM_PROVIDER=fake`.
   - Unrouted stage failures transition the run to `RunStatus::Paused` and emit an `EventKind::Error` with `"action": "provider_required"`.
   - Added 4 `tests::provider_truth::*` tests in `crates/warshad/src/lib.rs`.
2. `0d2be25` `fix(routines): replace production MockRoutineRunner with UnavailableRoutineRunner` (prior session)
   - Replaced `MockRoutineRunner` in production daemon startup (`crates/warshad/src/lib.rs`) with `UnavailableRoutineRunner` returning an explicit unavailable error; kept `MockRoutineRunner` strictly inside `#[cfg(test)]` in `crates/warsha-pipeline/src/routines.rs`.
3. `63ac0d1` `wip(pipeline): K3 scout registry seam + routing work-in-progress (salvaged after session death)` (prior session)
   - Introduced `ScoutRegistryClient` trait seam and `ProductionScoutRegistryClient` returning `ScoutError::CatalogUnavailable`; removed scout mock proposal prose; added `FixtureRegistryClient` tests.
4. `6b416b9` `fix(scout): route all remote scout sources through registry trait seam and remove placeholder prose` (continuation)
   - Routed `scout_git` and `scout_custom` through `ScoutRegistryClient::fetch_proposals` so all remote sources obey the registry seam.
   - Added `test_production_scout_git_and_custom_return_catalog_unavailable` and `test_recorded_json_fixture_client` (JSON fixture deserialization) in `crates/warsha-pipeline/src/scout.rs` (7/7 `scout::` tests pass).
   - Cleaned residual lowercase `"in real implementation"` comment in `crates/warsha-pipeline/src/skills.rs:276`.
5. `77d9d10` `feat(warshad): probe real daemon capabilities in health and add K3.5 test` (continuation)
   - Added `DaemonState::probe_capabilities` probing `daemon` (store `list_projects`), `providers` (`settings.load_providers` enabled or `role_routings` non-empty), and `keychain` (`secrets.load` operational check).
   - Updated `HealthResponse` (`capabilities: HealthCapabilities`) and both `WarshaRpc::health` and HTTP `health_handler` (`status` = `"healthy"` / `"degraded"` based on `daemon` probe).
   - Added `health_reports_probed_capabilities` at crate root of `crates/warshad/src/lib.rs` so `--exact` matches.
6. `a714994` `test(warshad): update e2e daemon setup to use UnavailableRoutineRunner` (continuation)
   - Updated `crates/warshad/tests/e2e_real_arabic_request.rs` and `crates/warshad/tests/e2e_request_to_artifact.rs` from removed `MockRoutineRunner` export to `UnavailableRoutineRunner::new()`.
7. `bc157e1` `test(pipeline): add status_truth tests for provider, routine, and scout honesty` (continuation)
   - Added `crates/warsha-pipeline/src/status_truth.rs` (6 tests serialized on `ENV_LOCK` for env-var safety) verifying `NoProviderRouted`, `Paused` + `provider_required` event, explicit `WARSHA_LLM_PROVIDER=fake` gating, unrouted `followup_run` refusal with zero artifacts, `UnavailableRoutineRunner` refusal, and `Scout` `CatalogUnavailable`.

## Decisions (One-Line Each)

- Kept `MockRoutineRunner` confined to `#[cfg(test)]` in `routines.rs` and switched integration test setups in `crates/warshad/tests/` to `UnavailableRoutineRunner` so `--all-targets` compiles cleanly.
- Placed `health_reports_probed_capabilities` at crate root (`crates/warshad/src/lib.rs`) because K3.5 runs with `--exact` without a module prefix.
- Left out-of-scope `"In real implementation"` comments in `warsha-backends` (E4), `warsha-cli` (K9), and `warsha-remote` (K7) untouched per packet scope rules.

---

## Gate Measurements

| Gate | Command | Outcome | Measured Result |
|---|---|---|---|
| K3.1 | `git grep -n -E 'In real implementation\|mock proposals' -- crates ':(exclude)**/tests/**'` | **FAIL (out-of-scope hits)** | exit `0`; 7 matches exclusively in out-of-scope crates: `warsha-backends/src/lib.rs:188`, `warsha-cli/src/lib.rs:530,555`, `warsha-remote/src/lib.rs:114,186,657,716`. Scoped to K3 (`crates/warsha-pipeline crates/warshad`): exit `1` (0 matches). |
| K3.2 | `bash tools/k3-mock-scan.sh` | **MISSING TOOL** | exit `127` (`tools/k3-mock-scan.sh: No such file or directory`). Direct grep confirms 0 `MockRoutineRunner` occurrences outside `#[cfg(test)]` (`routines.rs:586-1057`). |
| K3.3 | `cargo test -p warsha-pipeline --lib status_truth::` | **PASS** | exit `0`; `test result: ok. 6 passed; 0 failed` (`N=6 >= 4`). |
| K3.4 | `cargo test -p warshad --lib provider_truth::` | **PASS** | exit `0`; `test result: ok. 4 passed; 0 failed` (`N=4 >= 3`). |
| K3.5 | `cargo test -p warshad --lib health_reports_probed_capabilities -- --exact` | **PASS** | exit `0`; `test result: ok. 1 passed; 0 failed`. |
| STD.1 | `cargo fmt --all -- --check` | **PASS** | exit `0`; clean (no output). |
| STD.2 (pkg) | `cargo clippy -p warsha-pipeline -p warshad --all-targets -- -D warnings` | **PASS** | exit `0`; 0 warnings. |
| STD.8 | `node scripts/check-arch.mjs` | **PASS** | exit `0`; `arch: 5 rules, 0 violations`. |
| STD.9 | `node scripts/check-wire-contract.mjs` | **PASS** | exit `0`; `wire: 10 checks, 0 violations`. |
| STD.10 | `node scripts/check-engineering-policy.mjs` | **PASS** | exit `0`; `policy: 8 checks, 0 failures`. |
| STD.12 | `git diff --name-only 128b59c08cbf5ddbe4de002528a50f451ea74296..HEAD -- '*-snapshots/*' '*.png' '*.webp'` | **PASS** | exit `0`; no output. |

Additional verification in `C:/Users/Dragonfly/Downloads/warsha-wt/keel/k3`:
- `cargo test -p warsha-pipeline --lib`: 368 passed, 0 failed, 7 ignored.
- `cargo test -p warsha-pipeline --tests`: `fake_e2e` (6/6), `harness_skills_wiring` (4/4), `real_llm_failure` (1/1).
- `cargo test -p warshad --tests`: lib (117 passed, 0 failed, 2 ignored) + all 17 integration test binaries passed (0 failed).

---

## Blockers

- **BLOCKER (out-of-scope / frozen gate scope): K3.1** — `acceptance.json` K3.1 greps all of `crates` instead of `crates/warsha-pipeline crates/warshad`, hitting 7 lines in `warsha-backends` (E4), `warsha-cli` (K9), and `warsha-remote` (K7, explicitly tested by `K7.3`). Needs orchestrator/planner decision to narrow K3.1 pathspec to K3's allowed crates (or verify after K7/K9/E4).
- **BLOCKER (missing tool script): K3.2** — `tools/k3-mock-scan.sh` has not been created yet (verifier tool wrapper pending per `state.json`).
