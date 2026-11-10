#!/usr/bin/env bash
# Detached launcher for KEEL long gate STD.3.
# Markers (all inside EV/gates/):
#   STD.3.run.log  - console transcript of the launcher
#   STD.3.log      - full cargo test output (owned by rust-tests.sh)
#   STD.3.exit     - numeric exit code of rust-tests.sh
#   STD.3.done     - present only after the run has finished
set -uo pipefail
EV="${KEEL_EV:-C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-10-keel}"
mkdir -p "$EV/gates"
rm -f "$EV/gates/STD.3.done" "$EV/gates/STD.3.exit"
echo "STD.3 launch start=$(date -u +%Y-%m-%dT%H:%M:%SZ) pid=$$"
bash "$EV/tools/rust-tests.sh"
rc=$?
echo "$rc" > "$EV/gates/STD.3.exit"
echo "STD.3 finish=$(date -u +%Y-%m-%dT%H:%M:%SZ) exit=$rc"
touch "$EV/gates/STD.3.done"
exit "$rc"
