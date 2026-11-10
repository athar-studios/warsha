#!/usr/bin/env bash
# KEEL K3 verifier STEP 2 launcher (verifier tooling; touches no product code).
# Runs STD.2 (workspace clippy) then STD.3 (full rust-tests), sequentially so the
# shared cargo target-dir lock is never contended. Markers (inside EV/gates/):
#   K3.STD.2.log / K3.STD.2.exit / K3.STD.2.done
#   K3.STD.3.log (full cargo output) / K3.STD.3.run.log (transcript)
#   K3.STD.3.exit / K3.STD.3.done
set -uo pipefail
EV="${KEEL_EV:-C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-10-keel}"
WT="${KEEL_WORKTREE:-C:/Users/Dragonfly/Downloads/warsha-wt/keel/k3}"
mkdir -p "$EV/gates" || exit 2
rm -f "$EV/gates/K3.STD.2.done" "$EV/gates/K3.STD.2.exit" \
      "$EV/gates/K3.STD.3.done" "$EV/gates/K3.STD.3.exit"

echo "step2 launch start=$(date -u +%Y-%m-%dT%H:%M:%SZ) pid=$$ wt=$WT"
cd "$WT" || exit 2
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$WT/target}"
echo "step2 CARGO_TARGET_DIR=$CARGO_TARGET_DIR"

echo "step2 STD.2 start=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cargo clippy --workspace --all-targets -- -D warnings > "$EV/gates/K3.STD.2.log" 2>&1
rc2=$?
echo "$rc2" > "$EV/gates/K3.STD.2.exit"
echo "step2 STD.2 finish=$(date -u +%Y-%m-%dT%H:%M:%SZ) exit=$rc2"
touch "$EV/gates/K3.STD.2.done"

echo "step2 STD.3 start=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
KEEL_WORKTREE="$WT" KEEL_STD3_LOG="$EV/gates/K3.STD.3.log" \
  bash "$EV/tools/rust-tests.sh" > "$EV/gates/K3.STD.3.run.log" 2>&1
rc3=$?
echo "$rc3" > "$EV/gates/K3.STD.3.exit"
echo "step2 STD.3 finish=$(date -u +%Y-%m-%dT%H:%M:%SZ) exit=$rc3"
touch "$EV/gates/K3.STD.3.done"
echo "step2 all done std2=$rc2 std3=$rc3"
exit 0
