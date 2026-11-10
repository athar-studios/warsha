# Packet K4 Report — RunCommand Policy

- Run: `2026-11-10-keel`
- Packet: `K4` (`k4-command-policy`)
- Role: Implementer
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/keel/k4`
- Branch: `run/2026-11-10-keel/k4-command-policy`
- Base commit: `9c64d2422a5d572971a91bd36f0b4005e44db780` (`chore(integration): KEEL merge K3`)
- Head commit: `d2224f1657bc3cc25bdc12142131645725c82606`
- Status: **IMPLEMENTATION COMPLETE** (K4.1–K4.5 green; fmt/clippy/arch/wire/policy green; 0 blockers)

---

## Per-Step Changes & Commits

1. `6fe59e2` `feat(pipeline): add command_policy module with allow-list, env clear, timeout, and output cap`
   - Added `crates/warsha-pipeline/src/command_policy.rs` defining `CommandPolicy`, `CommandPolicyError`, `CommandOutput`, `DEFAULT_ALLOWED_COMMANDS`, `SHELL_COMMANDS` (`sh`, `bash`, `cmd`, `powershell`, `pwsh`), `DEFAULT_COMMAND_TIMEOUT` (120s), `DEFAULT_OUTPUT_CAP_BYTES` (1 MiB), and `MINIMAL_CHILD_ENV`.
   - Judges the first token from `split_command` against the configured allow-list (mirroring `warshad::auth::ProcessPolicy` without introducing a `warsha-pipeline -> warshad` dependency), rejecting shells unless explicitly allow-listed, metacharacters, and `..` parent traversals.
   - Executes via `tokio::process::Command` with `kill_on_drop(true)`, `env_clear()` + `MINIMAL_CHILD_ENV`, bounded pipe readers (1 MiB combined cap), and explicit `start_kill()` + `wait().await` reaping on timeout.
   - Exposed `split_command` in `crates/warsha-pipeline/src/process_spawn.rs` and re-exported `command_policy` types and `split_command` in `crates/warsha-pipeline/src/lib.rs`.
   - Added 7 unit tests under `command_policy::` including `a_child_that_prints_its_environment_sees_none_of_the_daemons_variables` (K4.2) and `a_sleeping_child_is_killed_at_the_timeout_and_no_process_remains` (K4.3).
2. `73b64d7` `feat(pipeline): route RunCommand through CommandPolicy with async ToolExecutor and phased turn execution`
   - Removed `std::process::Command` from `crates/warsha-pipeline/src/agent_tools.rs` (K4.5).
   - Added `CommandPolicy` field (`CommandPolicy::default()` fail-closed by default) and `with_command_policy` builder to `FilesystemToolExecutor`, plus `ToolError::CommandRefused` and `ToolError::CommandTimedOut` mapped from `CommandPolicyError`.
   - Made `ToolExecutor::execute` async via `#[async_trait]`.
   - Updated `crates/warsha-pipeline/src/agent_loop.rs`: switched `AgentLoop::tool_executor` to `Arc<dyn ToolExecutor>`, added `prepare_turn` / `PreparedTurn::execute` / `finish_turn` so tool/model execution runs without holding any lock on `AgentLoop`, and routed `run command` turn parsing through `split_command`.
   - Exported `PreparedTurn` and `ExecutedTurn` in `crates/warsha-pipeline/src/lib.rs`.
3. `d2224f1` `feat(warshad): wire allowed_commands into build_agent_loop and release agent lock across execution`
   - Updated `build_agent_loop` in `crates/warshad/src/lib.rs` to accept `&config.allowed_commands` and install `CommandPolicy::from_config(allowed_commands)` on `FilesystemToolExecutor`, ensuring the workspace directory exists for `current_dir`.
   - Updated `WarshaRpc::agent_turn` in `crates/warshad/src/lib.rs` to prepare under the write lock, drop the write lock across `prepared.execute().await`, and re-acquire to commit `finish_turn` and snapshot.
   - Added 3 tests in `tests::agent_lock` verifying `agent.state` answers immediately while a command is running and daemon `allowed_commands` policy governs `agent.turn` command execution.

---

## Decisions (One-Line Each)

- Placed `CommandPolicy` in `crates/warsha-pipeline/src/command_policy.rs` mirroring `warshad::auth::ProcessPolicy` allow-list semantics to preserve architecture rule R2 (`warsha-pipeline` must not depend on `warshad`).
- Refused `data_dir` path auto-exemption on `RunCommand` (unlike daemon `ProcessPolicy`) because the agent has `WriteFile` access inside its workspace; only explicitly allow-listed programs run.
- Made `ToolExecutor::execute` async and split `AgentLoop::run_turn` into `prepare_turn` -> unlocked `PreparedTurn::execute().await` -> `finish_turn` so `WarshaRpc::agent_turn` releases `state.agent_loop` during execution while `agent.state` remains non-blocking.
- Placed K4.2 and K4.3 test functions directly in `command_policy` (not inside a nested `mod tests`) so `--exact` filters `command_policy::<name>` match directly.
- Created `<data_dir>/workspace` in `build_agent_loop` so `RunCommand` works in fresh daemons before any `WriteFile` call instead of failing with OS error 267 (`current_dir` invalid).

---

## Gate Measurements

| Gate | Check | Outcome | Measured Result |
|---|---|---|---|
| K4.1 | `cargo test -p warsha-pipeline --lib command_policy::` | **PASS** | exit `0`; `test result: ok. 7 passed; 0 failed` (`N=7 >= 5`) |
| K4.2 | `cargo test -p warsha-pipeline --lib command_policy::a_child_that_prints_its_environment_sees_none_of_the_daemons_variables -- --exact` | **PASS** | exit `0`; `test result: ok. 1 passed; 0 failed` |
| K4.3 | `cargo test -p warsha-pipeline --lib command_policy::a_sleeping_child_is_killed_at_the_timeout_and_no_process_remains -- --exact` | **PASS** | exit `0`; `test result: ok. 1 passed; 0 failed` |
| K4.4 | `cargo test -p warshad --lib agent_lock::` | **PASS** | exit `0`; `test result: ok. 3 passed; 0 failed` (`N=3 >= 2`) |
| K4.5 | `git grep -n 'std::process::Command' -- crates/warsha-pipeline/src/agent_tools.rs` | **PASS** | exit `1`; no output (0 matches) |
| STD.1 | `cargo fmt --all -- --check` | **PASS** | exit `0`; clean (no output) |
| STD.2 (pkg) | `cargo clippy -p warsha-pipeline -p warshad --all-targets -- -D warnings` | **PASS** | exit `0`; 0 warnings |
| STD.8 | `node scripts/check-arch.mjs` | **PASS** | exit `0`; `arch: 5 rules, 0 violations` |
| STD.9 | `node scripts/check-wire-contract.mjs` | **PASS** | exit `0`; `wire: 10 checks, 0 violations` |
| STD.10 | `node scripts/check-engineering-policy.mjs` | **PASS** | exit `0`; `policy: 8 checks, 0 failures` |
| STD.11 | `git grep -n '#\[ignore' -- crates/ \| wc -l` | **PASS** | `10` (`ignore-now=10`, unchanged from base) |
| STD.12 | `git diff --name-only 128b59c08cbf5ddbe4de002528a50f451ea74296..HEAD -- '*-snapshots/*' '*.png' '*.webp'` | **PASS** | exit `0`; no output |

Additional verification in `C:/Users/Dragonfly/Downloads/warsha-wt/keel/k4`:
- Modified files vs base `9c64d24`: 6 files, all in-scope (`crates/warsha-pipeline/src/{agent_loop,agent_tools,command_policy,lib,process_spawn}.rs`, `crates/warshad/src/lib.rs`).
- `cargo test -p warsha-pipeline` (all targets): `388 passed; 0 failed` (377 lib + 11 integration, 7 ignored).
- `cargo test -p warshad` (all targets): `201 passed; 0 failed` (120 lib + 81 integration across 17 integration test binaries, 3 ignored).

---

## Blockers

None.
