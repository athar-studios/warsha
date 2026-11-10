#!/bin/sh
# U1.6 — frozen gate, verbatim from packets/U1/gates.md. BASE/HEAD set by the verifier (worktree refs).
BASE=128b59c08cbf5ddbe4de002528a50f451ea74296
HEAD=1762caa972f1bca55721dc17ed8794125db61bc2
export BASE HEAD
cd /c/Users/Dragonfly/Downloads/warsha-wt/v3/u1 || exit 99
test -z "$(git diff --name-only $BASE..HEAD | grep -vE '^packages/ui/(src/v3/(composites/|index\.ts$)|README\.md$)')"
