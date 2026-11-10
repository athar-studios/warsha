#!/bin/sh
export CARGO_TARGET_DIR='C:/Users/Dragonfly/Downloads/warsha-wt/v3/r1/target'
cd /c/Users/Dragonfly/Downloads/warsha-wt/v3/r1 || exit 99
EV='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3'
cargo clippy --workspace --all-targets -- -D warnings > "$EV/gates/R1.2.log" 2>&1
echo $? > "$EV/gates/R1.2.exit"
touch "$EV/gates/R1.2.done"
