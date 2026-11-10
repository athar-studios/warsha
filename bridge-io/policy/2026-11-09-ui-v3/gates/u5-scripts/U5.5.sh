#!/bin/sh
# U5.5 — frozen gate, verbatim from packets/U5/gates.md
cd /c/Users/Dragonfly/Downloads/warsha-wt/v3/u5 || exit 99
for a in settings; do test -d apps/desktop/src/v3/pages/$a && test -f apps/desktop/src/v3/actions/registry/$a.ts && test -f packages/i18n/src/v3/ar/$a.ts && test -f packages/i18n/src/v3/en/$a.ts && test -f apps/desktop/e2e/v3/$a.spec.ts || exit 1; done
