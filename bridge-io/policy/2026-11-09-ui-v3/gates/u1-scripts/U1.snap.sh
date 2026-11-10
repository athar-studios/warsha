#!/bin/sh
# U1.snap — frozen gate, verbatim from packets/U1/gates.md. BASE/HEAD set by the verifier (worktree refs).
EV='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3'
BASE=128b59c08cbf5ddbe4de002528a50f451ea74296
HEAD=1762caa972f1bca55721dc17ed8794125db61bc2
export BASE HEAD
cd /c/Users/Dragonfly/Downloads/warsha-wt/v3/u1 || exit 99
node "$EV/tools/pw-gate.mjs" snapshots $BASE HEAD -
