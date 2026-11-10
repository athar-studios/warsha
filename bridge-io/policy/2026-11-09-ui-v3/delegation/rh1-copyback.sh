#!/usr/bin/env bash
# RH1 copy-back: copy the refreshed snapshot files from /root/warsha-rh1 into the integration worktree (correct path).
SRC=/root/warsha-rh1
DEST=/mnt/c/Users/Dragonfly/Downloads/warsha-wt/v3/integration
EV=/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
cd "$SRC" || { echo "src_missing"; exit 1; }
git status --porcelain > "$EV/gates/RH1.snap-list-2.txt"
N=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  mkdir -p "$DEST/$(dirname "$f")"
  cp -a "$SRC/$f" "$DEST/$f" || echo "cp_fail:$f"
  N=$((N + 1))
done < <(awk '{print $NF}' "$EV/gates/RH1.snap-list-2.txt")
echo "copied=$N"
cd "$DEST" || { echo "dest_missing"; exit 1; }
echo "dest_dirty=$(git status --porcelain | wc -l)"