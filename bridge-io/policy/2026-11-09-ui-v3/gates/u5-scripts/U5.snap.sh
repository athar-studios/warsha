#!/bin/sh
# U5.snap — frozen gate, verbatim from packets/U5/gates.md
EV='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3'
BASE=6025715d881f80454286e35ed803d08f801a8c6c
HEAD=ad58a66b42e789de97dbb07f574d177dbf22fafc
export BASE HEAD
cd /c/Users/Dragonfly/Downloads/warsha-wt/v3/u5 || exit 99
node "$EV/tools/pw-gate.mjs" snapshots $BASE HEAD -
