#!/usr/bin/env bash
# Orchestrator read-only check of W2's repair-iteration-2 head against its ten frozen gates.
# Verification only: runs commands in a throwaway detached worktree, edits nothing.
set -u
REPO="C:/Users/Dragonfly/Downloads/Warsha"
P="C:/Users/Dragonfly/Downloads/warsha-wt/verify-w2b"
HEADREF="${1:?commit}"
git -C "$REPO" worktree remove --force "$P" >/dev/null 2>&1
git -C "$REPO" worktree add --detach "$P" "$HEADREF" >/dev/null 2>&1 || { echo "worktree add failed"; exit 9; }
cd "$P" || exit 9
echo "HEAD=$(git rev-parse HEAD)"

scope=$(git diff --name-only 406240a..HEAD | grep -vE '^(docs/(ARCHITECTURE|ARCH_RULES|DEPLOY|DEVELOPERS|VERIFY)\.md|docs/src/(architecture|SUMMARY|design-system-v2|skills-and-harnesses|install|deploy|verify)\.md|docs/designs/SITEMAP\.md|_agents/skills/warsha_elephant/SKILL\.md|SECURITY\.md)$' | wc -l)
echo "G2.S out-of-scope files: $scope (expect 0)"
echo "planner-owned DESIGN_SYSTEM_V2.md touched: $(git diff --name-only 406240a..HEAD | grep -c 'docs/designs/DESIGN_SYSTEM_V2.md') (expect 0)"

node -e "const fs=require('fs');const n=(fs.readFileSync('packages/ui/src/tokens/tokenDrift.test.ts','utf8').match(/^\s*it\(/gm)||[]).length;const ok=fs.readFileSync('docs/ARCH_RULES.md','utf8').includes('tokenDrift.test.ts\` ('+n+' tests)');console.log('G2.4 N='+n+' ok='+ok);process.exit(ok?0:1)"
echo "G2.4 exit=$?"

n=$(node scripts/check-wire-contract.mjs | grep -oE '[0-9]+ checks' | head -1)
if grep -qF "$n" docs/ARCH_RULES.md; then echo "G2.5 ok (string '$n' present in ARCH_RULES.md)"; else echo "G2.5 FAIL ('$n' absent)"; fi

echo "G2.A: $(node scripts/check-arch.mjs | tail -1)"
echo "G2.P: $(node scripts/check-engineering-policy.mjs | tail -1)"
echo "G2.W: $(node scripts/check-wire-contract.mjs | tail -1)"

( cd docs && mdbook build >/dev/null 2>&1; echo "G2.1 mdbook build exit=$?" )
( cd docs && mdbook test  >/dev/null 2>&1; echo "mdbook TEST exit=$? (the GC.4 repair target; expect 0)" )

cd "$REPO" && git worktree remove --force "$P" >/dev/null 2>&1
echo "verify worktree removed"
