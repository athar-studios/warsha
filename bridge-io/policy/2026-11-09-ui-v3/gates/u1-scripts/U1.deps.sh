#!/bin/sh
# U1.deps — frozen gate, verbatim from packets/U1/gates.md. BASE/HEAD set by the verifier (worktree refs).
# Expect exit 1 (no dependency added or bumped).
BASE=128b59c08cbf5ddbe4de002528a50f451ea74296
HEAD=1762caa972f1bca55721dc17ed8794125db61bc2
export BASE HEAD
cd /c/Users/Dragonfly/Downloads/warsha-wt/v3/u1 || exit 99
git diff $BASE..HEAD -- '*package.json' 'crates/*/Cargo.toml' 'apps/*/src-tauri/Cargo.toml' Cargo.toml | grep -E '^\+\s*"?[@a-zA-Z0-9_./-]+"?\s*[:=]\s*("[~^=]?[0-9]|\{[^}]*version)' | grep -vE '^\+\s*"?(version|rust-version)"?\s*[:=]'
