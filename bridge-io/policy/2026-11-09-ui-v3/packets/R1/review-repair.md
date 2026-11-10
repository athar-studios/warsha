# Packet R1 Repair Review (re-review v2) — F1/F2/F3 closure

- Run: `2026-11-09-ui-v3` — Role: independent REVIEWER (no implementation edits made)
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/r1` (clean, `git status --porcelain` = 0 lines)
- HEAD: `7fec7a04d91fc3ba9fd6ddc2cb963d12e0d03c62`; packet base: `4c65ead4f46cf97eecffd73149a57056e505568c`
- Range reviewed: `86b57c0..7fec7a0` = repair delta 4 files, +113/−16
  - `52fdd1f` test(warshad): pairing duplicate / plugin disconnect / harness db errors (F1) — 2 files, +109/−11
  - `ee0fd1f` test(warshad, pipeline): Windows long_running ping → stdin block (F2) — 2 files, +3/−4
  - `7fec7a0` test(pipeline): router write lock timeout back to 100ms (F3) — 1 file, +1/−1
- Patches: `C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3/diff/R1/` — `0006`/`0007`/`0008` added (first `format-patch` attempt renumbered from `0001`; those three were removed and re-exported with `--start-number 6`; original `0001`–`0005` never overwritten — final dir lists exactly 8 files, `0001`–`0008`)
- Prior review: `packets/R1/review.md` (REQUEST-CHANGES: F1/F2 blocking, F3 minor)
- Note: `cargo test --workspace` was NOT run here (frozen gate R1.3, verifier runs it in full); measurements below are fmt + clippy + targeted new/affected tests only.

## Per-finding closure

### F1 (blocking) — CLOSED, with two documented observations (O1, O2, non-blocking)

Three tests were added in `crates/warshad/src/lib.rs` (commit `52fdd1f`), each exercising the real `WarshaRpc` handlers (not wrappers), measured green:

1. `create_pairing_returns_an_rpc_error_when_device_already_paired` — calls `rpc.create_pairing` twice with the same device id; second call returns an RPC error, `rpc_error_code == -32000`, message contains `already paired` (real store error `RunModeError::DeviceAlreadyPaired`, `crates/warsha-pipeline/src/run_modes.rs:325-326`, surfaced by `create_pairing`'s `map_err(... rpc_error ...)` at `lib.rs:3665`). Measured: `test tests::create_pairing_returns_an_rpc_error_when_device_already_paired ... ok`.
2. `toggle_plugin_returns_an_rpc_error_when_mcp_disconnect_fails` — installs an **enabled** plugin whose command is a nonexistent binary (never connected), then `toggle_plugin(..., false)`; `mcp.disconnect` returns `McpTransportError::NotFound` (`mcp_transport.rs:833`) and the disable path maps it to `-32000` (`lib.rs:4265-4269`). Measured: `... ok`.
3. `get_active_harness_db_error_returns_an_rpc_error` — writes a corrupt `warsha.db`, opens it with the new `SettingsStore::open_unvalidated`, and `list_harnesses` must return `-32000` instead of falling back to the `autonomous-factory` default (`lib.rs:3952-3958`). Measured: `... ok`.

Revert-sensitivity (would the test fail if the step-2 fix were reverted?):
- Test 2: YES — at base `4c65ead` the disable branch was `let _ = self.state.mcp.disconnect(&def.id).await;` (swallowed); step 2 added `.map_err(|e| rpc_error(e.to_string()))?`. Revert → disable returns `Ok` → `expect_err` panics.
- Test 3: YES — at base the site was `.get_active_harness(...).await.ok().flatten().unwrap_or_else(|| "autonomous-factory")`; step 2 replaced it with `.map_err(rpc_error)?`. Revert → `Ok(vec)` → `expect_err` panics.
- Test 1: partial (see O1) — the behaviour (duplicate → `-32000`) is genuinely exercised and permanently guarded, but the test routes through the `pairing.create` RPC, which F1 itself prescribed ("e.g. duplicate id via the `pairing.create` RPC"; `pair_device` is "guard-protected so near-unreachable — say so in the report").

**O1 (observation, non-blocking, severity: minor):** test 1 would NOT fail on a `pair_device`-only revert. Measured: `git show 4c65ead:crates/warshad/src/lib.rs` shows `create_pairing` already contained `.map_err(|error| rpc_error(error.to_string()))?` at base (that surfacing is pre-existing, not step 2), and the test never calls `pair_device`. The step-2 `pair_device` edit (`let _ = pairings.create(...)` → `map_err(...)?`) sits behind the pre-existing `if pairings.get(...).is_none()` guard, so a duplicate can never reach it — exactly the near-unreachability F1 acknowledged. No observable test can cover that line; the repair followed F1's prescribed route.

**O2 (observation, non-blocking, severity: minor):** F1's sub-requirement "say so in the report" was not delivered — `packets/R1/report.md` (mtime 2026-11-09 20:15, predates the repair) line 32 describes the `pairings.create`/`revoke` surfacing but nowhere states that the `pair_device` site is guard-protected/near-unreachable, and no separate repair report exists in the packet dir (only `gates.md`, `progress-steps236.md`, `report.md`, `review.md`).

### F2 (blocking) — CLOSED

Both cited Windows sites now block-until-killed with the same command, `cmd /C more` (blocks on stdin like the Unix `cat` half):
- `crates/warshad/src/lib.rs:8078-8083` — `long_running()` Windows half: `vec!["/C".to_string(), "more".to_string()]` (replaces `ping -n 30 127.0.0.1 >nul`); doc comment still accurate ("keeps running until the test stops it").
- `crates/warsha-pipeline/src/process_spawn.rs:1014-1020` — same change; doc comment rewritten to "blocks on stdin like `cat`".

No weakening: the repair diff at both sites changes only the `vec![...]` line (plus the one doc comment); zero assertion lines touched by `86b57c0..7fec7a0` in either file, so both sites keep the pre-repair assertions (`ProcessStatus::Running` right after spawn, `Stopped` after stop, etc.) and both Windows halves now use identical behaviour.

Measured (block-until-killed actually holds — `more` did not exit immediately under a piped stdin):
- warshad cited site: `cargo test -p warshad -- process_rpcs_spawn_list_report_and_stop_a_real_process` → `test tests::process_rpcs_spawn_list_report_and_stop_a_real_process ... ok`, `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 108 filtered out; finished in 0.65s`, exit 0.
- warsha-pipeline cited helper (all 8 consumers): `cargo test -p warsha-pipeline -- process_spawn::tests` → `test result: ok. 28 passed; 0 failed; 2 ignored; 0 measured; 323 filtered out; finished in 3.11s`, exit 0. The 2 ignored are pre-existing (`preview_silent_probe`, `preview_url_probe`); the delta adds 0 `#[ignore]`.
- Repo-wide greps at HEAD: `ping -n` in `crates/**.rs` = 0; `sleep (30|120)` in both crates = 0.

### F3 (minor) — CLOSED

`crates/warsha-pipeline/src/agent_loop.rs:1170`: `tokio::time::timeout(Duration::from_millis(100), router.write())`. Measured three-way: base `4c65ead` = `100ms`; step-4 `86b57c0` = `200ms` (the widening); HEAD `7fec7a0` = `100ms` — back to base. Assertion text/logic untouched by the repair (diff changes only the duration literal).

## Scope checks (delta `86b57c0..7fec7a0` only)

- Files (4, all in scope): `crates/warshad/src/lib.rs`, `crates/warshad/src/settings.rs`, `crates/warsha-pipeline/src/agent_loop.rs`, `crates/warsha-pipeline/src/process_spawn.rs`. No `crates/warshad/tests/**` change in this delta; `git diff ... -- crates/warshad/src/run_command.rs | wc -l` = 0.
- No `Cargo.toml`/`Cargo.lock` in delta (grep count = 0); no `PLAN/PROGRESS/DECISIONS` changes; no snapshot files (delta = `.rs` only).
- `grep -c "#[ignore]|todo!|unimplemented!" <(git diff ...)` = 0. `#[ignore]` count in the two touched test files: 0 at HEAD, 0 at base.
- Worktree clean after all measurements: `git status --porcelain | wc -l` = 0.

## Measurements (native Windows, warm `CARGO_TARGET_DIR=C:/Users/Dragonfly/Downloads/warsha-wt/v3/r1/target`)

1. `cargo fmt --all --check` → **exit 0** (no output; recorded as `FMT_EXIT=0`).
2. `cargo clippy --workspace --all-targets -- -D warnings` (background run, `clippy.exit` = **0**) → tail verbatim:
   ```
     Finished `dev` profile [unoptimized + debuginfo] target(s) in 16.06s
   ```
   Output had 0 lines matching `warning`/`error`, 0 `Checking` lines (units already fresh; run included a one-off `Downloading crates ...` registry refresh). Immediate rerun for confirmation: `Finished \`dev\` profile [unoptimized + debuginfo] target(s) in 0.66s` + `CLIPPY2_EXIT=0`.
3. F1 targeted tests — `cargo test -p warshad -- create_pairing_returns_an_rpc_error_when_device_already_paired toggle_plugin_returns_an_rpc_error_when_mcp_disconnect_fails get_active_harness_db_error_returns_an_rpc_error` → **exit 0**:
   ```
   running 3 tests
   test tests::get_active_harness_db_error_returns_an_rpc_error ... ok
   test tests::create_pairing_returns_an_rpc_error_when_device_already_paired ... ok
   test tests::toggle_plugin_returns_an_rpc_error_when_mcp_disconnect_fails ... ok
   test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 106 filtered out; finished in 0.72s
   ```
   (No F1 tests exist in `warsha-pipeline`; the three are all in `warshad`.)
4. F2 targeted tests — see F2 section: warshad 1 passed / exit 0; warsha-pipeline `process_spawn::tests` 28 passed, 0 failed, 2 pre-existing ignored / exit 0.
5. NOT run: `cargo test --workspace` (frozen gate R1.3 — verifier runs it).

## New findings

- **O1 (minor, non-blocking)** — F1 test (a) is not a revert-detector for the step-2 `pair_device` line (pre-existing surfacing at `create_pairing`; guard makes the line unreachable). Behaviour itself is covered as F1 prescribed.
- **O2 (minor, non-blocking)** — F1's "say so in the report" note (pair_device site guard-protected/near-unreachable) is absent from `report.md`; no repair report exists.
- **O3 (observation, non-blocking, severity: info)** — new `SettingsStore::open_unvalidated` (`crates/warshad/src/settings.rs:120`) is a `pub` production-API test helper, not `#[cfg(test)]`-gated; its only caller is the in-crate test at `lib.rs:9125`, so gating was possible. Doc states its test intent; misuse fails loudly (queries on an unmigrated file error rather than defaulting). No action required for this packet.
- **O4 (observation, non-blocking)** — test 2 exercises the disable-side ordering already flagged by F4 for the enable side: the row is persisted disabled before `mcp.disconnect` fails, so an errored disable leaves the row flipped (no rollback). Same pre-existing class as F4; the error correctly surfaces.

No blocking findings.

## FINAL VERDICT: APPROVE
