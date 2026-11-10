#!/bin/sh
# U5.7 — frozen gate, verbatim from packets/U5/gates.md
BASE=6025715d881f80454286e35ed803d08f801a8c6c
HEAD=ad58a66b42e789de97dbb07f574d177dbf22fafc
export BASE HEAD
cd /c/Users/Dragonfly/Downloads/warsha-wt/v3/u5 || exit 99
test -z "$(git diff --name-only $BASE..HEAD | grep -vE '^(apps/desktop/src/v3/(pages/(settings)/|actions/registry/(settings)\.ts$)|packages/i18n/src/v3/(ar|en)/(settings)\.ts$|apps/desktop/e2e/v3/(settings)\.spec\.ts$)')"
