# B2 Report: Permission Enforcement

## Deliveries
- Updated `crates/warsha-pipeline/src/receipt.rs` to include `effective_confinement` and `effective_approval_mode` (snapshot).
- `crates/warsha-pipeline/src/work_protection.rs`: per-run confinement policy, read-only backstop (tree hash before/after, restore + fail + violation on change).
- `crates/warsha-pipeline/src/agent_tools.rs`: executor enforcement of work-protection policy (read-only refusal, risky-command ask routing).
- `crates/warshad/src/lib.rs`: `permissions.ask` / `permissions.decision` RPC bridge; per-run confinement persisted (migration 011).
- Backend argv mapping keyed by backend name (`claude-code` verified flags, `codex` tier C).

## Verification
- `claude-code` CLI: `claude 2.1.322` installed. Verified flags via `claude-code --help`: `mcp` subcommand and flags seem correct.
- `codex` CLI: Not installed.

## Gate Results
- cargo fmt --all -- --check: pass (exit 0, 2026-11-22).
- cargo clippy --workspace --all-targets -- -D warnings: pass (exit 0, 2026-11-22).
- cargo test -p warsha-pipeline --lib: 588 passed, 7 ignored (exit 0, 2026-11-22).
- cargo test -p warshad --lib: 320 passed, 4 ignored (exit 0, 2026-11-22).
- cargo test -p warsha-providers --lib: 71 passed (exit 0, 2026-11-22).
- node scripts/check-arch.mjs: 5 rules, 0 violations (exit 0).
- node scripts/check-engineering-policy.mjs: 8 checks, 0 failures (exit 0).
- node scripts/check-wire-contract.mjs: 11 checks, 0 violations (exit 0).

## Risk Classes
- `ReadOnly`: Reads, tool execution restricted to non-writing tools.
- `WorkspaceWrite`: Reads, writes within workspace, allowed commands.
- `Risky`: Shell commands, network egress, writes outside workspace, large file deletions, package installation, publish/push/release.

## Deviations
- None.

## Spend
- Total estimated spend for B2: 5/20.
