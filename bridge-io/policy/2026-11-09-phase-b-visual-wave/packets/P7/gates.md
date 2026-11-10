# Frozen gates — P7 agent-command-policy

Frozen at plan time by the planner (2026-11-09T06:29:36Z). Run by the VERIFIER, in the packet worktree, at the reviewed commit, with
`EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-phase-b-visual-wave`, `BASE=<packets[P7].base_commit>`, `GATE=<gate id>`.
Raw output -> `$EV/gates/<gate id>.log`. The implementer must not edit, narrow or re-word any of them.

| id | host | check | expect |
| --- | --- | --- | --- |
| `P7.1` | windows | `cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings` | exit 0 |
| `P7.2` | windows | `cargo test --workspace --all-targets` | exit 0; passed >= base_counts.rust + 4 |
| `P7.3` | windows | `cargo test -p warsha-pipeline -- --list 2>/dev/null \| grep -ciE "run_command.*(refus\|allow)"` | count >= 2 (one refuse, one allow test) |
| `P7.4` | any | `test -z "$(git diff --name-only $BASE..HEAD \| grep -vE '^crates/(warsha-pipeline/src/(agent_tools\|agent_loop\|process_spawn\|work_protection)\.rs\|warshad/src/lib\.rs)$')"` | exit 0 |
