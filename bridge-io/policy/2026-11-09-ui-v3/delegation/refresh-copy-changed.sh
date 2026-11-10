#!/bin/bash
# Rx step 6 prep: copy ONLY the changed snapshot files from the capture refresh tree into the Windows integration
# worktree (via /mnt/c), preserving paths. Run INSIDE WSL as root:
#   bash .../delegation/refresh-copy-changed.sh <LABEL> <capture-worktree-dir> <changed-list-file-basename>
# Example: refresh-copy-changed.sh R0 /root/warsha-r0post R0.changed2.txt
# The Windows side then: git add -- '*-snapshots/*' ; commit "test(e2e): refresh the <set> baselines (owner OD-U1, <LABEL>)"
set -u
LABEL="$1"; WT="$2"; LIST="$3"
EV=/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
DEST=/mnt/c/Users/Dragonfly/Downloads/warsha-wt/v3/integration
n=0
while IFS= read -r line; do
  p="${line:3}"
  case "$p" in *-snapshots/*) ;; *) echo "SKIP non-snapshot: $p"; continue ;; esac
  if [ ! -f "$WT/$p" ]; then echo "MISSING in capture tree: $p"; exit 9; fi
  mkdir -p "$DEST/$(dirname "$p")"
  cp "$WT/$p" "$DEST/$p" || exit 9
  n=$((n+1))
done < "$EV/gates/$LIST"
echo "COPIED=$n label=$LABEL"