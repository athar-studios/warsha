#!/bin/sh
EV='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3'
BASE=128b59c08cbf5ddbe4de002528a50f451ea74296
HEAD=29b04335582ee7383dd56f87827592db5bd64d5e
GATE=F4.4
cd /c/Users/Dragonfly/Downloads/warsha-wt/v3/f4 || exit 99
git diff $BASE..HEAD -- '*package.json' 'crates/*/Cargo.toml' 'apps/*/src-tauri/Cargo.toml' Cargo.toml | grep -E '^\+\s*"?[@a-zA-Z0-9_./-]+"?\s*[:=]\s*("[~^=]?[0-9]|\{[^}]*version)' | grep -vE '^\+\s*"?(version|rust-version)"?\s*[:=]'
