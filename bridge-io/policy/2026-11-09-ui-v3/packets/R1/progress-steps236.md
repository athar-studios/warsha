# Packet R1 Progress — Steps 1, 2, 3, and 6

Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/r1`  
Branch: `run/2026-11-09-ui-v3/r1-rust-hardening`  
Base commit: `4c65ead4f46cf97eecffd73149a57056e505568c`  
Head commit: `6f6ff09d57545ca8735da85d564fa7848c777e5c`

---

## 1. Commits on Branch

1. **`1eb5260`** — `fix(pipeline): propagate non-test settings serialization errors (R1)`
   - Scope: `crates/warsha-pipeline/src/settings.rs`
   - Replaced non-test `.unwrap()` calls at lines 131 and 316 with `Result` propagation via `try_new` and `autonomous_factory_harness`.
   - Gate `R1.4` (`grep -c "\.unwrap()"`) verified 0.
   - Tests: added `settings_store_try_new_and_defaults_succeed` and `autonomous_factory_harness_serializes_cleanly`.

2. **`1d674dd`** — `fix(warshad): surface RPC and database errors instead of defaults (R1 step 2)`
   - Scope: `crates/warshad/src/lib.rs`, `crates/warshad/src/wave2.rs`
   - In `lib.rs`: `pairings.create` (`:2836`) and `pairings.revoke` (`:2919`) surface failure as RPC errors. Revoking an unknown device returns an error (`-32000`).
   - In `lib.rs`: `toggle_plugin` (`:4251`, `:4264`) and `configure_plugin` (`:4305`) propagate `mcp.connect` / `mcp.disconnect` errors rather than ignoring them.
   - In `lib.rs`: `get_active_harness` (`:3956`, `:3981`, `:4008`, `:4071`) uses `.map_err(rpc_error)?` instead of `.ok().flatten()`.
   - In `wave2.rs`: `skill_definition`, `plugin_definition`, `integration_config`, and `integration_status` return `Checked<T>` naming corrupt rows on JSON parse failure.
   - Gate `R1.5` passed (exit 1).
   - Tests added:
     - `wave2::tests::a_corrupt_skill_row_returns_an_error_naming_the_row`
     - `wave2::tests::a_corrupt_plugin_row_returns_an_error_naming_the_row`
     - `wave2::tests::a_corrupt_integration_row_returns_an_error_naming_the_row`
     - `tests::revoking_an_unknown_device_returns_an_rpc_error`
     - `tests::toggle_plugin_returns_an_rpc_error_when_mcp_connect_fails`

3. **`937267f`** — `fix(warshad): quote-aware preview policy command parsing (R1 step 3)`
   - Scope: `crates/warshad/src/lib.rs`
   - Replaced `command.split_whitespace().next()` with `warsha_pipeline::LivePreviewManager::split_command(&command)` in `start_preview` (`:3485-3498`) so policy checks the exact first token that the pipeline spawns.
   - Updated the stale comment explaining quote-aware splitting.
   - Gate `R1.6` passed (exit 1).
   - Tests added:
     - `tests::preview_policy_allows_allow_listed_quoted_path_with_spaces`
     - `tests::preview_policy_refuses_quoted_path_with_spaces_not_allowed`

4. **`6f6ff09`** — `fix(warshad): write bootstrap admin token directly to stderr (R1 step 6)`
   - Scope: `crates/warshad/src/lib.rs`
   - In `load_or_create_config` (`:5911`), replaced `info!("BOOTSTRAP_ADMIN_TOKEN=...", ...)` with direct `eprintln!("BOOTSTRAP_ADMIN_TOKEN=...", ...)` to prevent secret leakage into tracing collectors/loggers.
   - Gate `R1.10` passed (exit 1).
   - Test added:
     - `tests::bootstrap_admin_token_is_never_sent_to_tracing_subscriber`

---

## 2. Gate Verification Summary

- `R1.1` (`cargo fmt --all --check`): Exit 0.
- `R1.2` (`cargo clippy --workspace --all-targets -- -D warnings`): Exit 0.
- `R1.4` (pipeline unwrap count): 0.
- `R1.5` (no ignored pairing/mcp connect calls): Exit 1.
- `R1.6` (no `command.split_whitespace()` in warshad): Exit 1.
- `R1.8` (worktree file scope): Clean, all changes strictly in `crates/warshad/src` and `crates/warsha-pipeline/src`.
- `R1.9` (no forbidden annotations): Exit 1.
- `R1.10` (no tracing BOOTSTRAP_ADMIN_TOKEN print): Exit 1.
- `R1.deps` (no dependencies touched): Exit 1.
- Unit tests added: 10 new tests, all passing.

---

## 3. Remaining Work for Step 4 (Timing Tests)

Step 4 addresses timing-fragile tests across 7 distinct sites. A separate session owns Step 4. Children must block until killed (e.g. read stdin or loop until signaled) rather than sleeping for 30s or 120s, and parents must use poll-until-deadline helpers while preserving assertions.

Target sites:
1. `crates/warshad/src/lib.rs`:
   - Line ~8025 (`preview_probe`): `std::thread::sleep(Duration::from_secs(30))`
   - Line ~8060/8069 (`long_running`): `ping -n 30 127.0.0.1` (Windows) / `sleep 30` (Unix)
2. `crates/warshad/tests/child_reaping.rs`:
   - Line ~68 (`reap_probe_child`): `std::thread::sleep(Duration::from_secs(120))`
3. `crates/warsha-pipeline/src/process_spawn.rs`:
   - Line ~967 (`preview_url_probe`): `std::thread::sleep(Duration::from_secs(30))`
   - Line ~983 (`preview_silent_probe`): `std::thread::sleep(Duration::from_secs(30))`
   - Line ~1016/1025 (`long_running`): `ping -n 30 127.0.0.1` (Windows) / `sleep 30` (Unix)
4. `crates/warsha-pipeline/src/mcp_transport.rs`:
   - Line ~1083 (`tools/call` mock handler): `std::thread::sleep(Duration::from_secs(30))`
   - Line ~1167 (`mcp_server_silent_probe`): `std::thread::sleep(Duration::from_secs(30))`
   - Line ~1559 (`test_mcp_call_tool_timeout`): timing assertion calibration
5. `crates/warsha-pipeline/src/agent_loop.rs`:
   - Lines ~1157-1166: turn backoff wait and router write lock timeout
6. `crates/warsha-pipeline/src/routines.rs`:
   - Lines ~1025-1029 (`scheduler_graceful_stop`): fixed thread sleeps
7. `crates/warshad/tests/events_stream_sync.rs`:
   - Line ~198 (`wait_for_seq_at_least`): 20s deadline polling loop

Gate to satisfy in Step 4:
- `R1.7`: `grep -rnE "\"(sleep)\"[^)]*\"(30|120)\"|sleep (30|120)" crates/warshad crates/warsha-pipeline` must return exit 1.
