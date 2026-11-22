# B2 Report: Permission Enforcement

## Deliveries
- Updated `crates/warsha-pipeline/src/receipt.rs` to include `effective_confinement` and `effective_approval_mode` (snapshot).
- TODO: Add remaining deliveries as implemented.

## Verification
- `claude-code` CLI: `claude 2.1.322` installed. Verified flags via `claude-code --help`: `mcp` subcommand and flags seem correct.
- `codex` CLI: Not installed.

## Gate Results
- cargo fmt --check: Pending.
- cargo clippy: Pending.
- cargo test: Pending.
- arch/policy/wire checks: Pending.

## Risk Classes
- `ReadOnly`: Reads, tool execution restricted to non-writing tools.
- `WorkspaceWrite`: Reads, writes within workspace, allowed commands.
- `Risky`: Shell commands, network egress, writes outside workspace, large file deletions, package installation, publish/push/release.

## Deviations
- None.

## Spend
- Total estimated spend for B2: 5/20.
