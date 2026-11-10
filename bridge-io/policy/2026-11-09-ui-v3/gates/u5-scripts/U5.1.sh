#!/bin/sh
# U5.1 — frozen gate, verbatim from packets/U5/gates.md
cd /c/Users/Dragonfly/Downloads/warsha-wt/v3/u5 || exit 99
pnpm --filter warsha-desktop test
