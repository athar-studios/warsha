#!/usr/bin/env bash
# OD1 second half, OWNER-AUTHORISED: refresh the stale remote visual baselines on the authoritative
# capture host, then hand the exact changed PNGs back to the Windows checkout for a reviewed commit.
# Only the mismatched baselines are rewritten; nothing else is touched and no source is edited.
set -u
WT=/root/verify-OD1-poststub
WIN=/mnt/c/Users/Dragonfly/Downloads/Warsha
EV="$WIN/bridge-io/policy/2026-11-08-design-and-remediation"
LOG="$EV/gates/OD1-baseline-refresh.log"

cd "$WT" || exit 9
{
  echo "=== OD1 baseline refresh (owner-authorised) ==="
  echo "host: WSL Ubuntu x86_64 as $(whoami)"
  echo "worktree: $WT"
  echo "commit: $(git rev-parse HEAD)"
  echo "timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "command: pnpm exec playwright test --project=remote --update-snapshots"
  echo "---"
} > "$LOG"

pnpm exec playwright test --project=remote --update-snapshots >> "$LOG" 2>&1
UPD=$?
echo "[update exit: $UPD]" >> "$LOG"

echo "--- changed snapshot files ---" >> "$LOG"
CHANGED=$(git status --porcelain -- '*-snapshots/*' | awk '{print $2}')
echo "$CHANGED" >> "$LOG"
echo "[changed count: $(echo "$CHANGED" | sed '/^$/d' | wc -l)]" >> "$LOG"

# Copy exactly the changed PNGs into the Windows checkout at the same relative paths.
N=0
for f in $CHANGED; do
  mkdir -p "$WIN/$(dirname "$f")"
  cp "$WT/$f" "$WIN/$f" && N=$((N+1))
done
echo "[copied to Windows checkout: $N]" >> "$LOG"

# Prove the refresh: re-run with NO flags and expect remote 91 passed / 0 failed.
echo "=== verification run after refresh ===" >> "$LOG"
echo "command: pnpm exec playwright test --project=remote --reporter=line" >> "$LOG"
pnpm exec playwright test --project=remote --reporter=line >> "$LOG" 2>&1
VER=$?
echo "[verify exit: $VER]" >> "$LOG"
echo "[snapshot writes after verify: $(git status --porcelain -- '*-snapshots/*' | wc -l)]" >> "$LOG"

printf 'status=finished\nupdate_exit=%s\nchanged=%s\ncopied=%s\nverify_exit=%s\n' \
  "$UPD" "$(echo "$CHANGED" | sed '/^$/d' | wc -l)" "$N" "$VER" > "$EV/gates/OD1-refresh.done"
echo "update exit=$UPD changed=$(echo "$CHANGED" | sed '/^$/d' | wc -l) copied=$N verify exit=$VER"
