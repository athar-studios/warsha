#!/bin/bash
# Orchestrator C0.5: merge F1 into integration after its verification is green. Git Bash on Windows:
#   bash .../delegation/c05-merge.sh
set -u
WT=C:/Users/Dragonfly/Downloads/warsha-wt/v3/integration
EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
cd "$WT" || exit 9
git merge --no-ff run/2026-11-09-ui-v3/f1-v2-mobile-providers -m "chore(integration): C0.5 merge F1 (owner OD-F1)" > "$EV/gates/C0.5.merge.log" 2>&1
M=$?
echo "merge_exit=$M" >> "$EV/gates/C0.5.merge.log"
if [ "$M" -ne 0 ]; then echo "STOP: C0.5 merge conflict"; exit 1; fi
{ node scripts/check-arch.mjs; echo "arch_exit=$?";
  node scripts/check-engineering-policy.mjs; echo "policy_exit=$?";
  node scripts/check-wire-contract.mjs; echo "wire_exit=$?"; } > "$EV/gates/C0.5.guards.log" 2>&1
if grep -qE "(arch|policy|wire)_exit=[1-9]" "$EV/gates/C0.5.guards.log"; then echo "STOP: guard failure after C0.5"; exit 1; fi
echo "C0.5_DONE tip=$(git rev-parse HEAD)"