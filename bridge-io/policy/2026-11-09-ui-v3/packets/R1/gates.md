# Frozen gates — R1 rust-hardening

Frozen by the planner (2026-11-09T07:03:54Z). The VERIFIER runs them in the packet worktree at the reviewed commit with
`EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3`, `BASE=<packets[R1].base_commit>`, `GATE=<gate id>`; raw output ->
`$EV/gates/<gate id>.log`. The implementer must not edit, narrow or re-word any of them.

| id | host | check | expect |
| --- | --- | --- | --- |
| `R1.1` | windows | `cargo fmt --all --check` | exit 0 |
| `R1.2` | windows | `cargo clippy --workspace --all-targets -- -D warnings` | exit 0 |
| `R1.3` | windows | `cargo test --workspace --all-targets` | exit 0; passed >= base_counts.rust + 8; ignored <= base_counts.rust_ignored |
| `R1.4` | any | `sed -n '1,/#\[cfg(test)\]/p' crates/warsha-pipeline/src/settings.rs \| grep -c "\.unwrap()"` | prints 0 |
| `R1.5` | any | `grep -nE "let _ = pairings\.(revoke\|create)\|let _ = self\.state\.mcp\.(connect\|disconnect)" crates/warshad/src/lib.rs` | exit 1 |
| `R1.6` | any | `grep -nE "command\.split_whitespace\(\)" crates/warshad/src/lib.rs` | exit 1 |
| `R1.7` | any | `grep -rnE "\"(sleep)\"[^)]*\"(30\|120)\"\|sleep (30\|120)" crates/warshad crates/warsha-pipeline` | exit 1 |
| `R1.8` | any | `test -z "$(git diff --name-only $BASE..HEAD \| grep -vE '^crates/(warshad/(src\|tests)\|warsha-pipeline/src)/')"` | exit 0 |
| `R1.9` | any | `git diff $BASE..HEAD -- crates \| grep -nE "^\+.*(#\[ignore\]\|todo!\(\|unimplemented!\()"` | exit 1 |
| `R1.10` | any | `grep -nE "(info\|debug\|warn\|error\|trace)!\([^)]*BOOTSTRAP_ADMIN_TOKEN" crates/warshad/src/lib.rs` | exit 1 (the opt-in token print no longer goes through tracing) |
| `R1.deps` | any | `git diff $BASE..HEAD -- '*package.json' 'crates/*/Cargo.toml' 'apps/*/src-tauri/Cargo.toml' Cargo.toml \| grep -E '^\+\s*"?[@a-zA-Z0-9_./-]+"?\s*[:=]\s*("[~^=]?[0-9]\|\{[^}]*version)' \| grep -vE '^\+\s*"?(version\|rust-version)"?\s*[:=]'` | exit 1 (no dependency added or bumped) |
