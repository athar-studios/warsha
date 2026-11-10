#!/bin/sh
# U5.2 — frozen gate, verbatim from packets/U5/gates.md
cd /c/Users/Dragonfly/Downloads/warsha-wt/v3/u5 || exit 99
pnpm -r typecheck && pnpm --filter warsha-desktop lint && node scripts/check-ds-v3.mjs apps/desktop/src/v3
