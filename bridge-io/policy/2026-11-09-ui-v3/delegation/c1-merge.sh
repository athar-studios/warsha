#!/usr/bin/env bash
# C1 merges — run 2026-11-09-ui-v3 (orchestrator). Order: F2 -> R1 -> V1 -> U0 -> U2 -> H1.
# Guards after every merge: check-arch, check-engineering-policy, check-wire-contract (9 checks before H1, 10 after).
set -e
cd "C:/Users/Dragonfly/Downloads/warsha-wt/v3/integration"
echo "== pre == $(git rev-parse --short HEAD) $(git branch --show-current) dirty=$(git status --porcelain | wc -l)"

git merge --no-ff a3d24a949e44951dbfc2671f62b1477f4d7ec276 -m "chore(integration): C1 merge F2"
echo "== after F2 == guards:"
node scripts/check-arch.mjs | tail -1
node scripts/check-engineering-policy.mjs | tail -1
node scripts/check-wire-contract.mjs | tail -1

git merge --no-ff 7fec7a04d91fc3ba9fd6ddc2cb963d12e0d03c62 -m "chore(integration): C1 merge R1"
echo "== after R1 == guards:"
node scripts/check-arch.mjs | tail -1
node scripts/check-engineering-policy.mjs | tail -1
node scripts/check-wire-contract.mjs | tail -1

git merge --no-ff 017ffb9d98f63181ec73d9b00a8b81df1e0b29dc -m "chore(integration): C1 merge V1"
echo "== after V1 == guards:"
node scripts/check-arch.mjs | tail -1
node scripts/check-engineering-policy.mjs | tail -1
node scripts/check-wire-contract.mjs | tail -1

git merge --no-ff bae6c0bbb056dccffc78f561b572bb21398a8db3 -m "chore(integration): C1 merge U0"
echo "== after U0 == guards:"
node scripts/check-arch.mjs | tail -1
node scripts/check-engineering-policy.mjs | tail -1
node scripts/check-wire-contract.mjs | tail -1

git merge --no-ff fc8f06656a1b665913b0aeeecb19cb8278775bb6 -m "chore(integration): C1 merge U2"
echo "== after U2 == guards:"
node scripts/check-arch.mjs | tail -1
node scripts/check-engineering-policy.mjs | tail -1
node scripts/check-wire-contract.mjs | tail -1

git merge --no-ff 9d7d7c911d49c7618348538c36e0af3f552a77e1 -m "chore(integration): C1 merge H1"
echo "== after H1 == guards:"
node scripts/check-arch.mjs | tail -1
node scripts/check-engineering-policy.mjs | tail -1
node scripts/check-wire-contract.mjs | tail -1

echo "== C1 TIP == $(git rev-parse HEAD)"
echo "== dirty == $(git status --porcelain | wc -l)"
