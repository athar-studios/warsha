#!/bin/sh
# U5.deps — frozen gate, verbatim from packets/U5/gates.md (expect exit 1)
BASE=6025715d881f80454286e35ed803d08f801a8c6c
HEAD=ad58a66b42e789de97dbb07f574d177dbf22fafc
export BASE HEAD
cd /c/Users/Dragonfly/Downloads/warsha-wt/v3/u5 || exit 99
git diff $BASE..HEAD -- '*package.json' 'crates/*/Cargo.toml' 'apps/*/src-tauri/Cargo.toml' Cargo.toml | grep -E '^\+\s*"?"?[@a-zA-Z0-9_./-]+"?\s*[:=]\s*("[~^=]?[0-9]|\{[^}]*version)' | grep -vE '^\+\s*"?(version|rust-version)"?\s*[:=]'
