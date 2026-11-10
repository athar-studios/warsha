#!/bin/bash
# C-final INT-REL (HANDOVER): set every component to the owner's version and commit. Git Bash on Windows:
#   bash .../delegation/int-rel.sh <version> <worktree>
# Requires scripts/check-versions.mjs (V1 deliverable) to exist in the worktree.
set -u
V="$1"; WT="$2"
EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
cd "$WT" || exit 9
if [ ! -f scripts/check-versions.mjs ]; then echo "ABORT: check-versions.mjs missing (V1 not merged?)"; exit 9; fi
node scripts/check-versions.mjs --set "$V" > "$EV/gates/INT-REL.log" 2>&1
S=$?
echo "set_exit=$S" >> "$EV/gates/INT-REL.log"
if [ "$S" -ne 0 ]; then echo "STOP: --set failed"; exit 1; fi
git add -- package.json apps/desktop/package.json apps/remote/package.json packages/ui/package.json packages/client/package.json packages/i18n/package.json packages/crypto/package.json pnpm-lock.yaml apps/mobile/android/app/build.gradle docker/compose.yml Cargo.toml Cargo.lock apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/tauri.conf.json >> "$EV/gates/INT-REL.log" 2>&1
git commit -m "chore(release): set every component to $V" >> "$EV/gates/INT-REL.log" 2>&1
C=$?
echo "commit_exit=$C" >> "$EV/gates/INT-REL.log"
if [ "$C" -ne 0 ]; then echo "STOP: commit failed"; exit 1; fi
node scripts/check-versions.mjs --expect "$V" >> "$EV/gates/INT-REL.log" 2>&1
echo "INT_REL_DONE version=$V tip=$(git rev-parse HEAD)"