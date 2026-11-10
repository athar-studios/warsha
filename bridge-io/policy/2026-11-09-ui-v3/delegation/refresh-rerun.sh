#!/bin/bash
# Generic fenced refresh, Rx step 8: full re-run at the committed refresh tip. Run INSIDE WSL as root:
#   bash .../delegation/refresh-rerun.sh <LABEL> <40-hex-committed-tip>
set -u
LABEL="$1"; TIP="$2"
EV=/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WT=/root/warsha-refresh-final-$LABEL
if [ -e "$WT" ]; then echo "ABORT: $WT exists; inspect first"; exit 9; fi
git -C /root/warsha-visual fetch /mnt/c/Users/Dragonfly/Downloads/Warsha run/2026-11-09-ui-v3/integration || exit 9
git -C /root/warsha-visual worktree add --detach "$WT" "$TIP" || exit 9
cd "$WT" || exit 9
pnpm install --frozen-lockfile > "$EV/gates/$LABEL.final.install.log" 2>&1 || exit 9
if ss -ltn | grep -qE ":5173|:5174"; then echo "ABORT: ports busy"; exit 9; fi
LISTED=$(CI=true pnpm exec playwright test --list --project=desktop --project=remote 2>/dev/null | grep -oE "Total: [0-9]+" | grep -oE "[0-9]+")
CI=true pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/$LABEL.final.json" 2> "$EV/gates/$LABEL.final.log"
node "$EV/tools/pw-gate.mjs" counts "$EV/gates/$LABEL.final.json" "$LISTED" 0 > "$EV/gates/$LABEL.counts.log" 2>&1
COUNTS=$?
echo "counts_exit=$COUNTS listed=$LISTED" >> "$EV/gates/$LABEL.counts.log"
git -C "$WT" status --porcelain -- '*-snapshots*' > "$EV/gates/$LABEL.final.dirty.txt"
echo "dirty=$(wc -l < "$EV/gates/$LABEL.final.dirty.txt")" >> "$EV/gates/$LABEL.counts.log"
echo "REFRESH_RERUN_DONE label=$LABEL"