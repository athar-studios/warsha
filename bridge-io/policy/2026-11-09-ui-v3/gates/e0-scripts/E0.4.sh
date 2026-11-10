#!/bin/sh
# E0.4 — frozen gate, verbatim from packets/E0/gates.md. BASE/HEAD set by the verifier (worktree refs).
BASE=128b59c08cbf5ddbe4de002528a50f451ea74296
HEAD=bcb5c7a8290a2827cdc20e63832c4fb8960efc58
export BASE HEAD
test -z "$(git diff --name-only $BASE..HEAD | grep -vE '^apps/desktop/e2e/v3/(support/|smoke\.spec\.ts$)')"
