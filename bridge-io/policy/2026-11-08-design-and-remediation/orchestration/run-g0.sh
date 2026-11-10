#!/usr/bin/env bash
# G0 baseline verifier run — run 2026-11-08-design-and-remediation.
# Verifier role only: this script never edits code, never updates snapshots, never fixes anything.
# CI=true is set deliberately: Playwright then FAILS on a missing baseline instead of silently
# writing one, which protects the pixel-neutral contract. Reporter is pinned by the gate command.
set -u
WT=/root/warsha-g0
EV=/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation
LOG="$EV/gates/G0.log"
DONE="$EV/gates/G0.done"
mkdir -p "$EV/gates"
rm -f "$DONE"
cd "$WT" || exit 9

export CI=true

{
  echo "=== G0 baseline — run 2026-11-08-design-and-remediation ==="
  echo "started_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "host: WSL Ubuntu x86_64, user=$(whoami)"
  echo "worktree: $WT"
  echo "commit: $(git rev-parse HEAD)"
  echo "dirty_before: $(git status --porcelain | wc -l)"
  echo "node: $(node --version)  pnpm: $(pnpm --version)"
  echo "env: CI=true (missing baselines fail instead of being written)"
  echo "fontconfig_pin: $WT/scripts/ci/capture-fontconfig.conf"
  echo "plex_faces: $(fc-list | grep -ci plex)"
  echo
  echo "=== G0-a: pnpm exec playwright test --project=desktop --reporter=line ==="
} > "$LOG" 2>&1

pnpm exec playwright test --project=desktop --reporter=line >> "$LOG" 2>&1
DESKTOP_EXIT=$?
echo "[G0-a exit code: $DESKTOP_EXIT]" >> "$LOG"

{
  echo
  echo "=== G0-b: pnpm exec playwright test --project=remote --reporter=line ==="
} >> "$LOG" 2>&1

pnpm exec playwright test --project=remote --reporter=line >> "$LOG" 2>&1
REMOTE_EXIT=$?
echo "[G0-b exit code: $REMOTE_EXIT]" >> "$LOG"

{
  echo
  echo "=== post-run integrity ==="
  echo "snapshot_writes: $(git status --porcelain -- '*-snapshots/*' | wc -l)"
  echo "dirty_after: $(git status --porcelain | wc -l)"
  echo "commit_after: $(git rev-parse HEAD)"
  echo "finished_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "desktop_exit=$DESKTOP_EXIT remote_exit=$REMOTE_EXIT"
} >> "$LOG" 2>&1

printf 'desktop_exit=%s\nremote_exit=%s\nfinished_at=%s\n' \
  "$DESKTOP_EXIT" "$REMOTE_EXIT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DONE"