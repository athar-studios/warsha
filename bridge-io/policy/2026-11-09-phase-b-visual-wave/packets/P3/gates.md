# Frozen gates — P3 rust-hardening

Frozen at plan time by the planner (2026-11-09T06:29:36Z). Run by the VERIFIER, in the packet worktree, at the reviewed commit, with
`EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-phase-b-visual-wave`, `BASE=<packets[P3].base_commit>`, `GATE=<gate id>`.
Raw output -> `$EV/gates/<gate id>.log`. The implementer must not edit, narrow or re-word any of them.

| id | host | check | expect |
| --- | --- | --- | --- |
| `P3.1` | windows | `cargo fmt --all --check` | exit 0 |
| `P3.2` | windows | `cargo clippy --workspace --all-targets -- -D warnings` | exit 0 |
| `P3.3` | windows | `cargo test --workspace --all-targets` | exit 0; sum of "test result: ok. N passed" >= base_counts.rust + 8; ignored total <= base_counts.rust_ignored |
| `P3.4` | any | `sed -n '1,/#\[cfg(test)\]/p' crates/warsha-pipeline/src/settings.rs \| grep -c "\.unwrap()"` | prints 0 |
| `P3.5` | any | `grep -nE "let _ = pairings\.(revoke\|create)\|let _ = self\.state\.mcp\.(connect\|disconnect)" crates/warshad/src/lib.rs` | exit 1 |
| `P3.6` | any | `grep -nE "command\.split_whitespace\(\)" crates/warshad/src/lib.rs` | exit 1 |
| `P3.7` | any | `grep -rnE "\"(sleep)\"[^)]*\"(30\|120)\"\|sleep (30\|120)" crates/warshad crates/warsha-pipeline` | exit 1 |
| `P3.8` | any | `test -z "$(git diff --name-only $BASE..HEAD -- Cargo.toml Cargo.lock 'crates/*/Cargo.toml')"` | exit 0 (no dependency change) |
| `P3.9` | any | `test -z "$(git diff --name-only $BASE..HEAD \| grep -vE '^crates/(warshad/(src\|tests)\|warsha-pipeline/src)/')"` | exit 0 |
| `P3.10` | any | `git diff $BASE..HEAD -- crates \| grep -nE "^\+.*(#\[ignore\]\|todo!\(\|unimplemented!\()"` | exit 1 (no test disabled, no stand-in) |
