#!/bin/sh
# U1.1 — frozen gate, verbatim from packets/U1/gates.md. Run in worktree C:/Users/Dragonfly/Downloads/warsha-wt/v3/u1
cd /c/Users/Dragonfly/Downloads/warsha-wt/v3/u1 || exit 99
pnpm --filter @warsha/ui test
