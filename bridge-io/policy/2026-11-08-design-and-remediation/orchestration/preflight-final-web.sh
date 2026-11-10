#!/usr/bin/env bash
# Final pre-release web/contract preflight on the release commit (owner-requested:
# pnpm -r test, pnpm -r build, check-arch, check-wire-contract).
set -u
out=bridge-io/policy/2026-11-08-design-and-remediation/release/preflight-web.out
{
  echo "=== PRE-RELEASE WEB PREFLIGHT @ $(git rev-parse --short HEAD) ($(git rev-parse HEAD)) ==="
  echo "host: $(uname -srm) | node $(node -v) | pnpm $(pnpm -v)"
  echo
  echo "--- pnpm -r build ---"
  pnpm -r build; echo "build exit=$?"
  echo "--- pnpm -r test ---"
  pnpm -r test; echo "test exit=$?"
  echo "--- node scripts/check-arch.mjs --self-test ---"
  node scripts/check-arch.mjs --self-test; echo "arch_selftest exit=$?"
  echo "--- node scripts/check-arch.mjs ---"
  node scripts/check-arch.mjs; echo "arch exit=$?"
  echo "--- node scripts/check-engineering-policy.mjs --self-test ---"
  node scripts/check-engineering-policy.mjs --self-test; echo "policy_selftest exit=$?"
  echo "--- node scripts/check-engineering-policy.mjs ---"
  node scripts/check-engineering-policy.mjs; echo "policy exit=$?"
  echo "--- node scripts/check-wire-contract.mjs --self-test ---"
  node scripts/check-wire-contract.mjs --self-test; echo "wire_selftest exit=$?"
  echo "--- node scripts/check-wire-contract.mjs ---"
  node scripts/check-wire-contract.mjs; echo "wire exit=$?"
  echo "--- mdbook test (docs) ---"
  (cd docs && mdbook test); echo "mdbook_test exit=$?"
  echo "--- gitleaks detect (history) ---"
  gitleaks detect --source . --config .gitleaks.toml --no-banner; echo "gitleaks exit=$?"
  echo "DONE"
} > "$out" 2>&1
