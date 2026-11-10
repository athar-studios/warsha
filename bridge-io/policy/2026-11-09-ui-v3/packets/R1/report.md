# Packet R1 Report — Rust Hardening (Wave A)

- Run: `2026-11-09-ui-v3`
- Packet: `R1` (`rust-hardening`)
- Role: Implementer
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/r1`
- Branch: `run/2026-11-09-ui-v3/r1-rust-hardening`
- Base commit: `4c65ead4f46cf97eecffd73149a57056e505568c`
- Head commit: `86b57c070e4fa9c6450fdcd2ccb75981124b4dbb`

---

## Commits

1. `1eb5260` — `fix(pipeline): propagate non-test settings serialization errors (R1)`
2. `1d674dd` — `fix(warshad): surface RPC and database errors instead of defaults (R1 step 2)`
3. `937267f` — `fix(warshad): quote-aware preview policy command parsing (R1 step 3)`
4. `6f6ff09` — `fix(warshad): write bootstrap admin token directly to stderr (R1 step 6)`
5. `86b57c0` — `test(warshad, pipeline): replace fixed sleeps with event-driven waits (R1 step 4)`

---

## Changes by Step

1. **Step 1: Settings unwrap propagation (`1eb5260`)**:
   - In `crates/warsha-pipeline/src/settings.rs`: eliminated non-test `.unwrap()` calls at lines 131 and 316.
   - Added `SettingsStore::try_new` returning `Result<Self, SettingsError>` and updated `autonomous_factory_harness` to return `Result<Value, serde_json::Error>`.
   - Gate `R1.4` verified: 0 `.unwrap()` calls in non-test settings code.
   - Tests added: `settings_store_try_new_and_defaults_succeed` and `autonomous_factory_harness_serializes_cleanly`.

2. **Step 2: RPC and Database Error Surfacing (`1d674dd`)**:
   - In `crates/warshad/src/lib.rs`: `pairings.create` and `pairings.revoke` surface failures as RPC errors (`-32000`). Revoking an unknown device returns an explicit error (`Device not found`).
   - In `crates/warshad/src/lib.rs`: `toggle_plugin` and `configure_plugin` propagate `mcp.connect` / `mcp.disconnect` errors instead of ignoring results.
   - In `crates/warshad/src/lib.rs`: `get_active_harness` propagates DB errors via `.map_err(rpc_error)?` rather than silently defaulting via `.ok().flatten()`.
   - In `crates/warshad/src/wave2.rs`: `skill_definition`, `plugin_definition`, `integration_config`, and `integration_status` return descriptive errors naming corrupt rows on JSON parse failures.
   - Gate `R1.5` verified: exit 1 (no ignored pairing or MCP connect/disconnect calls).
   - Tests added:
     - `wave2::tests::a_corrupt_skill_row_returns_an_error_naming_the_row`
     - `wave2::tests::a_corrupt_plugin_row_returns_an_error_naming_the_row`
     - `wave2::tests::a_corrupt_integration_row_returns_an_error_naming_the_row`
     - `tests::revoking_an_unknown_device_returns_an_rpc_error`
     - `tests::toggle_plugin_returns_an_rpc_error_when_mcp_connect_fails`

3. **Step 3: Quote-Aware Preview Policy Command Parsing (`937267f`)**:
   - In `crates/warshad/src/lib.rs`: `start_preview` uses `warsha_pipeline::LivePreviewManager::split_command(&command)` so preview policy judges the exact first token that the pipeline executes.
   - Updated comment explaining quote-aware command splitting.
   - Gate `R1.6` verified: exit 1 (0 occurrences of `command.split_whitespace()`).
   - Tests added:
     - `tests::preview_policy_allows_allow_listed_quoted_path_with_spaces`
     - `tests::preview_policy_refuses_quoted_path_with_spaces_not_allowed`

4. **Step 4: Timing-Fragile Tests Replacement (`86b57c0`)**:
   - Replaced fixed sleeps with children that block until killed (`loop { std::thread::park(); }`) and poll-until-deadline helpers across all target sites:
     - `crates/warshad/src/lib.rs`: `preview_probe` uses `loop { std::thread::park(); }`; Unix `long_running` uses `cat`.
     - `crates/warshad/tests/child_reaping.rs`: `reap_probe_child` uses `loop { std::thread::park(); }`.
     - `crates/warsha-pipeline/src/process_spawn.rs`: `preview_url_probe` and `preview_silent_probe` use `loop { std::thread::park(); }`; Unix `long_running` uses `cat`.
     - `crates/warsha-pipeline/src/mcp_transport.rs`: `mcp_server_call_timeout_probe` (`tools/call`) and `mcp_server_silent_probe` use `loop { std::thread::park(); }`.
     - `crates/warsha-pipeline/src/agent_loop.rs`: replaced `yield_now()` spin loop with poll-until-deadline helper.
     - `crates/warsha-pipeline/src/routines.rs`: replaced fixed `sleep(20ms)` in `scheduler_graceful_stop` with poll-until-deadline helper on runner execution.
     - `crates/warshad/tests/events_stream_sync.rs`: confirmed existing poll-until-deadline pattern in `wait_for_seq_at_least`.
   - Gate `R1.7` verified: exit 1 (0 matches for fixed 30/120s sleep patterns).

5. **Step 5: RunCommand Preservation**:
   - Deliberately left untouched (reserved for packet P7).

6. **Step 6: Bootstrap Admin Token Stderr Output (`6f6ff09`)**:
   - In `crates/warshad/src/lib.rs`: `load_or_create_config` writes `BOOTSTRAP_ADMIN_TOKEN` directly to `eprintln!` instead of `info!` tracing macro behind `WARSHA_PRINT_BOOTSTRAP_TOKEN=1`.
   - Gate `R1.10` verified: exit 1 (no tracing macro emits `BOOTSTRAP_ADMIN_TOKEN`).
   - Test added:
     - `tests::bootstrap_admin_token_is_never_sent_to_tracing_subscriber`

---

## Decisions & Alternatives Rejected

1. **Unknown-device revocation error vs. idempotent success**:
   - Decision: Revoking an unknown device returns an explicit RPC error (`-32000: Device not found`).
   - Alternative rejected: Idempotent success (`null`), because silent success masks client desynchronization and orphaned credentials.
2. **Quote-aware command splitting**:
   - Decision: Reused `LivePreviewManager::split_command` in `crates/warshad/src/lib.rs` for preview policy checks.
   - Alternative rejected: Custom whitespace splitting or regex, which creates divergence between authorization checks and actual execution.
3. **Secret token emission**:
   - Decision: Written directly to `eprintln!` on opt-in.
   - Alternative rejected: Tracing level filtering or secret masking in tracing subscriber, which risks collector leaks if downstream subscribers bypass filters.
4. **Child blocking mechanism in timing tests**:
   - Decision: Probe child processes use `loop { std::thread::park(); }` to suspend execution until killed; Unix shell commands use `cat` instead of `sleep 30`.
   - Alternative rejected: Increasing sleep duration, which remains fragile under heavy CI load and violates Gate `R1.7`.

---

## Measured Unit Counts & Gate Results

- `R1.1` (`cargo fmt --all --check`): Exit 0.
- `R1.2` (`cargo clippy --workspace --all-targets -- -D warnings`): Exit 0.
- `R1.3` (`cargo test --workspace --all-targets`): Exit 0 (756 passed, 0 failed, 10 ignored; base 746 passed, 10 ignored; +10 new tests, requirement >= 754).
- `R1.4` (pipeline unwrap count in non-test settings): 0.
- `R1.5` (no ignored pairing/mcp connect calls): Exit 1.
- `R1.6` (no `command.split_whitespace()` in warshad): Exit 1.
- `R1.7` (no fixed 30/120s sleeps): Exit 1.
- `R1.8` (worktree file scope): Clean, all modifications within `crates/(warshad/(src|tests)|warsha-pipeline/src)`.
- `R1.9` (no forbidden annotations `#[ignore]`, `todo!()`, `unimplemented!()`): Exit 1.
- `R1.10` (no tracing macro emitting bootstrap admin token): Exit 1.
- `R1.deps` (no dependencies touched): Exit 1.
- Diff stat: 8 files changed, 428 insertions(+), 117 deletions(-).

---

## Seen But Left Alone

- `crates/warshad/src/run_command.rs`: Untouched per brief item 5 (reserved for packet P7).
- Workspace base ignored tests: Exactly 10 ignored tests preserved from base (child probe processes).
