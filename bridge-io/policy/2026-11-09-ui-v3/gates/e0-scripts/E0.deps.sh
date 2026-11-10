#!/bin/sh
# E0.deps — frozen gate, verbatim from packets/E0/gates.md. BASE/HEAD set by the verifier (worktree refs).
BASE=128b59c08cbf5ddbe4de002528a50f451ea74296
HEAD=bcb5c7a8290a2827cdc20e63832c4fb8960efc58
export BASE HEAD
git diff $BASE..HEAD -- 'package.json' 'crates/*/Cargo.toml' 'apps/*/src-tauri/Cargo.toml' Cargo.toml | grep -E '^\+\s*"?[@a-zA-Z0-9_./-]+"?\s*[:=]\s*("[~^=]?[0-9]|\{[^}]*version)' | grep -vE '^\+\s*"?(version|rust-version)"?\s*[:=]'
