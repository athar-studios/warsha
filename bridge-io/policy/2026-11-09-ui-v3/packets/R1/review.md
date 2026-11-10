# Packet R1 Review — Rust error hygiene and test timing (wave A)

- Run: `2026-11-09-ui-v3` — Role: independent REVIEWER (no edits made)
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/r1` (clean, HEAD `86b57c070e4fa9c6450fdcd2ccb75981124b4dbb`)
- Range reviewed: `4c65ead4f46cf97eecffd73149a57056e505568c..86b57c070e4fa9c6450fdcd2ccb75981124b4dbb` (5 commits, 8 files, +428/−117)
- Patch: `C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3/diff/R1/` (5 `.patch` files from `git format-patch`)

## Checks passed

1. **Scope** — changed files are exactly `crates/warshad/src/{lib.rs,wave2.rs}`, `crates/warshad/tests/child_reaping.rs`, `crates/warsha-pipeline/src/{agent_loop,mcp_transport,process_spawn,routines,settings}.rs`. `crates/warshad/src/run_command.rs` diff = 0 lines (P7/deferred, untouched). No `Cargo.toml`/dependency change, no `PLAN/PROGRESS/DECISIONS`, no snapshots, no `#[ignore]`/`todo!()`/`unimplemented!()` added (`#[ignore]` count 10 at HEAD == 10 at base), worktree clean.
2. **Step 2 semantics (code)** — `pairings.create`/`pairings.revoke` in `pair_device`/`revoke_device` now `map_err(rpc_error)?`; `toggle_plugin`/`configure_plugin` propagate `mcp.connect`/`mcp.disconnect`; all four `get_active_harness` sites use `.map_err(rpc_error)?` (no `ok().flatten()` remains anywhere in `lib.rs`); `skill_definition`/`plugin_definition`/`integration_config`/`integration_status` return errors naming the corrupt row. Unknown-device revoke decision = explicit RPC error (`DeviceNotFound` → `-32000`), justified in `report.md` (silent success masks desync/orphans), tested by `revoking_an_unknown_device_returns_an_rpc_error`. **Coverage gap: see F1.**
3. **Step 3** — `start_preview` now calls `warsha_pipeline::LivePreviewManager::split_command` (the same splitter `LivePreviewManager` uses to spawn, `process_spawn.rs:811`), stale "split on whitespace" comment rewritten; two tests present (`preview_policy_allows_allow_listed_quoted_path_with_spaces`, `preview_policy_refuses_quoted_path_with_spaces_not_allowed`) — the refuse test discriminates (POLICY_REFUSED `-32001`), the allow test fails only on a policy refusal by design.
4. **Step 4** — sleep(30/120) → `loop { thread::park() }` / `cat` / poll-until-deadline at the cited sites; no `sleep 30|120` string remains in either crate; assertion texts unchanged (only `.expect(...)` → `assert!(..., same message)`, `assert_eq!(...unwrap(), ...)` conversions). **Two cited sites not event-driven on Windows: see F2; one tolerance widened: see F3.**
5. **Step 6** — single emission of `BOOTSTRAP_ADMIN_TOKEN` is `eprintln!` (`lib.rs:5911`, opt-in `WARSHA_PRINT_BOOTSTRAP_TOKEN=1` kept); `bootstrap_admin_token_is_never_sent_to_tracing_subscriber` captures a tracing subscriber and asserts 0 matches for both the marker and the token value.
6. **Verification (run by reviewer in the worktree, native Windows):**
   - `cargo fmt --all --check` → exit 0
   - `cargo clippy --workspace --all-targets -- -D warnings` → exit 0 (`Finished dev profile ... in 0.86s`)
   - `cargo test --workspace --all-targets` → exit 0; aggregate **756 passed / 0 failed / 10 ignored** (36 result lines; ignored 7+2+1 = 10) — consistent with `report.md` (base 746 + 10 new tests)
   - `node scripts/check-arch.mjs` → `arch: 5 rules, 0 violations`
   - New tests = 10 (5 `lib.rs`, 3 `wave2.rs`, 2 `settings.rs`), matching the +10 delta.

## Findings (repair items)

- **F1 (blocking) — step 2 tests: 3 of the 6 named surfaces have no test.** Present: revoke (unknown device), MCP connect (toggle enable), corrupt rows (skill/plugin/integration). Missing: (a) `pairings.create` failure surfacing (e.g. duplicate id via the `pairing.create` RPC → `DeviceAlreadyPaired` → `-32000`; note the `pair_device` site is guard-protected so near-unreachable — say so in the report); (b) plugin **disable** failing on an `mcp.disconnect` error (reachable: enabled row with a command that is not connected → `disconnect` errors → `-32000`); (c) `get_active_harness` DB error → `-32000` instead of `autonomous-factory` default (reachable: point `SettingsStore` at an unreadable/corrupt `warsha.db`). Brief and judge both require "one test per behaviour".
- **F2 (blocking) — 2 of the 12 cited timing sites still use a fixed 30 s wait on Windows.** `crates/warshad/src/lib.rs:8062` and `crates/warsha-pipeline/src/process_spawn.rs:1020`: `cmd /C ping -n 30 127.0.0.1 >nul`. The cited site was "ping -n 30 (Windows) / sleep 30 (Unix)"; only the Unix half became `cat`. Gate R1.7 greps only `sleep (30|120)`, so it is blind to this. Replace with a block-until-killed command (the Windows `cat` equivalent) or justify leaving it in the report.
- **F3 (minor) — tolerance widened:** `agent_loop.rs` `router.write()` timeout `100ms → 200ms`. Assertion text/logic unchanged, but the tolerated lock-hold bound is now twice as permissive; revert or justify.
- **F4 (observation, non-blocking)** — on a surfaced `mcp.connect` failure the plugin row is already persisted as enabled (no rollback; pre-existing ordering, error now surfaces). `disconnect` is skipped when the command is empty — symmetric with the enable path, acceptable.
- **F5 (observation, non-blocking)** — the bootstrap-token test sets a process-wide env var; cleanup is guarded, and no other test asserts on stderr, so parallel runs are safe today.

## FINAL VERDICT: REQUEST-CHANGES
