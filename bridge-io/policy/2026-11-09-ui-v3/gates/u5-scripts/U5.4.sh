#!/bin/sh
# U5.4 — frozen gate, verbatim from packets/U5/gates.md
EV='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3'
cd /c/Users/Dragonfly/Downloads/warsha-wt/v3/u5 || exit 99
node "$EV/tools/actions-gate.mjs" . --only settings.
