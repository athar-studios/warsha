# Task: Packet B2 - Permission Enforcement (Warsha R-NEXT)
Plan v5 (docs/zadloop/R-NEXT-MASTER-PLAN.md lines ~847-905)

## Todo List
- [ ] 1. Define risk classes for tools/commands (Read-only, Workspace-write, Risky).
- [ ] 2. Update `crates/warshad/src/runtime.rs`: Change `build_agent_loop_in` to accept effective permissions instead of `WorkProtectionPolicy::default()`.
- [ ] 3. Update `crates/warshad/src/lib.rs`: Pass computed effective permissions from `Run` to `build_agent_loop_in`.
- [ ] 4. Implement risk-based permission mapping table.
- [ ] 5. Implement read-only backstop (hash worktree before/after stage).
- [ ] 6. Implement policy snapshot in run receipt.
- [ ] 7. Update/Add tests (argv matrix tests, read-only proof, approval-bridge, receipt snapshot).
- [ ] 8. Update docs/zadloop/packets/B2-report.md.

## Decisions
- D-RN-B2-001: Replacing hardcoded `WorkProtectionPolicy::default()` in `crates/warshad/src/runtime.rs` with run-specific effective permissions.
- D-RN-B2-002: Using `Project::effective_permissions` from `crates/warsha-core/src/lib.rs` to compute run permissions.
