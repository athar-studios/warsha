#!/usr/bin/env bash
# Orchestrator REHEARSAL of the post-OD4 end state. SCRATCH ONLY: a throwaway branch + worktree.
# Nothing here is merged into run/2026-11-08/integration and nothing here edits a frozen gate in the
# run. The spec/ratchet edits are PROPOSALS being measured, to make the owner decision evidence-based.
set -u
REPO="C:/Users/Dragonfly/Downloads/Warsha"
R="C:/Users/Dragonfly/Downloads/warsha-wt/rehearsal"
git -C "$REPO" worktree remove --force "$R" >/dev/null 2>&1
git -C "$REPO" worktree add -b scratch/od4-rehearsal "$R" run/2026-11-08/integration >/dev/null 2>&1 || { echo "worktree add failed"; exit 9; }
cd "$R" || exit 9
echo "base (integration tip) = $(git rev-parse --short HEAD)"

echo "--- step 1: merge W5 (held back on OD4) ---"
git merge --no-ff run/2026-11-08/w5-apps-adoption -m "rehearsal: merge W5 (scratch branch only)" 2>&1 | tail -2
echo "after merge = $(git rev-parse --short HEAD); conflicts: $(git diff --name-only --diff-filter=U | wc -l)"

echo "--- step 2: PROPOSED OD4 option 1 - let the assertion accept the token reference ---"
node -e "
const fs=require('fs');
const p='apps/desktop/e2e/states.spec.ts';
let t=fs.readFileSync(p,'utf8');
const oldRe='/border-inline-start:\\\\s*3px solid var\\\\(--warsha-bench-edge\\\\)/';
const newRe='/border-inline-start:\\\\s*(?:3px solid var\\\\(--warsha-bench-edge\\\\)|var\\\\(--warsha-line-band\\\\))/';
const n=t.split(oldRe).length-1;
if(n!==1){console.error('expected exactly 1 occurrence of the old regex, found '+n);process.exit(3);}
fs.writeFileSync(p,t.replace(oldRe,newRe));
console.log('assertion regex updated (1 occurrence)');
" || exit 3
git add apps/desktop/e2e/states.spec.ts
git commit -q -m "rehearsal(OD4 option 1): states.spec accepts the --warsha-line-band token reference [SCRATCH, PROPOSAL]" && echo "committed proposal edit"

echo "--- step 3: INT-2 - APP_LENGTH_BUDGET to 0 (planner-specified one-line tightening) ---"
node -e "
const fs=require('fs');
const p='packages/ui/src/tokens/tokenDrift.test.ts';
let t=fs.readFileSync(p,'utf8');
const m=t.match(/const APP_LENGTH_BUDGET = (\d+);/g)||[];
if(m.length!==1){console.error('expected exactly 1 APP_LENGTH_BUDGET constant, found '+m.length);process.exit(4);}
console.log('was: '+m[0]);
fs.writeFileSync(p,t.replace(/const APP_LENGTH_BUDGET = \d+;/,'const APP_LENGTH_BUDGET = 0;'));
" || exit 4
git add packages/ui/src/tokens/tokenDrift.test.ts
git commit -q -m "test(ui): tighten the R6.9 app-length ratchet to zero [SCRATCH REHEARSAL]" && echo "committed INT-2"
echo "rehearsal head = $(git rev-parse HEAD)"
echo "touched by the two rehearsal commits:"; git diff --name-only HEAD~2..HEAD
