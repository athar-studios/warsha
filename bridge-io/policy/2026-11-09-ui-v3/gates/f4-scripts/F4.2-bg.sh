#!/bin/sh
EV='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3'
sh "$EV/gates/f4-scripts/F4.2.sh" > "$EV/gates/F4.2.log" 2>&1
echo $? > "$EV/gates/F4.2.exit"
touch "$EV/gates/F4.2.done"
