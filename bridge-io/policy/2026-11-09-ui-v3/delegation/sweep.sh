#!/bin/bash
# Post-merge workspace sweep (memory rule: sweep after every checkpoint merge; probe the pre-merge tip on failure).
# Git Bash on Windows:  bash .../delegation/sweep.sh <worktree> <label>
set -u
WT="$1"; LABEL="$2"
EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
cd "$WT" || exit 9
LOG="$EV/gates/sweep-$LABEL.log"
{ echo "== sweep $LABEL at $(date -u +%H:%M:%SZ) tip=$(git rev-parse HEAD)";
  pnpm -r typecheck; echo "typecheck_exit=$?";
  pnpm -r lint; echo "lint_exit=$?";
  pnpm -r test; echo "test_exit=$?";
  pnpm -r build; echo "build_exit=$?";
  node scripts/check-arch.mjs; echo "arch_exit=$?";
  node scripts/check-engineering-policy.mjs; echo "policy_exit=$?";
  node scripts/check-wire-contract.mjs; echo "wire_exit=$?"; } > "$LOG" 2>&1
if grep -qE "(typecheck|lint|test|build|arch|policy|wire)_exit=[1-9]" "$LOG"; then
  echo "SWEEP_FAILURE $LABEL — probe the pre-merge tip in a disposable worktree before assigning blame"; exit 1;
fi
echo "SWEEP_OK $LABEL"