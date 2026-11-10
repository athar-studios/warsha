#!/usr/bin/env bash
# Final pre-release Rust preflight on the release commit (owner-requested:
# cargo fmt, cargo clippy -D warnings, cargo test --workspace).
set -u
out=bridge-io/policy/2026-11-08-design-and-remediation/release/preflight-rust.out
{
  echo "=== PRE-RELEASE RUST PREFLIGHT @ $(git rev-parse --short HEAD) ($(git rev-parse HEAD)) ==="
  echo "host: $(uname -srm) | $(rustc -V) | $(cargo -V)"
  echo
  echo "--- cargo fmt --all --check ---"
  cargo fmt --all --check; echo "fmt exit=$?"
  echo "--- cargo clippy --workspace --all-targets -- -D warnings ---"
  cargo clippy --workspace --all-targets -- -D warnings; echo "clippy exit=$?"
  echo "--- cargo test --workspace --all-targets ---"
  cargo test --workspace --all-targets; echo "cargo_test exit=$?"
  echo "DONE"
} > "$out" 2>&1
