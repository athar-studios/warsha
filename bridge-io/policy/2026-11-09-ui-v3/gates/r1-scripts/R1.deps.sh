#!/bin/sh
EV='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3'
BASE=4c65ead4f46cf97eecffd73149a57056e505568c
HEAD=7fec7a04d91fc3ba9fd6ddc2cb963d12e0d03c62
GATE=R1.deps
cd /c/Users/Dragonfly/Downloads/warsha-wt/v3/r1 || exit 99
git diff $BASE..HEAD -- '*package.json' 'crates/*/Cargo.toml' 'apps/*/src-tauri/Cargo.toml' Cargo.toml | grep -E '^\+\s*"?[@a-zA-Z0-9_./-]+"?\s*[:=]\s*("[~^=]?[0-9]|\{[^}]*version)' | grep -vE '^\+\s*"?(version|rust-version)"?\s*[:=]'
