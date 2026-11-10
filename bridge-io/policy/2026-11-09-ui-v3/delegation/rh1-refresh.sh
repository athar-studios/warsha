#!/usr/bin/env bash
# RH1 refresh stage on the WSL capture host (runs AFTER RH1.pre.done and AFTER pw-gate failures exits 0).
# Refreshes the last-failed baselines in /root/warsha-rh1 and copies the changed snapshot files into the integration worktree.
# Never --update-snapshots outside this fenced step; never touch /root/warsha-visual.
export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EV=/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
INT=/mnt/c/Users/Dragonfly/Downloads/Warsha/warsha-wt/v3/integration
DONE="$EV/gates/RH1.refresh.done"
META="$EV/gates/RH1.refresh.meta"
rm -f "$DONE"
exec 2> "$EV/gates/RH1.refresh.err"
echo "start $(date -u +%FT%TZ)" > "$META"
cd /root/warsha-rh1 || { echo "worktree_missing" >> "$META"; echo done > "$DONE"; exit 0; }
CI=true pnpm exec playwright test --project=desktop --project=remote --last-failed --update-snapshots > "$EV/gates/RH1.refresh.log" 2>&1
echo "refresh_exit=$?" >> "$META"
git status --porcelain > "$EV/gates/RH1.snap-list.txt"
N=$(git status --porcelain | wc -l)
echo "changed_files=$N" >> "$META"
git status --porcelain | awk '{print $NF}' | while IFS= read -r f; do
  mkdir -p "$INT/$(dirname "$f")"
  cp -a "/root/warsha-rh1/$f" "$INT/$f"
done
echo "copied_to_integration=$N" >> "$META"
echo "end $(date -u +%FT%TZ)" >> "$META"
echo done > "$DONE"