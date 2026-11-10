#!/bin/bash
# Generic fenced refresh, Rx steps 1-5 (orchestrator plumbing; gate commands verbatim). Run INSIDE WSL as root:
#   bash .../delegation/refresh-update.sh <LABEL> <named-file-basename> <pack-dir-name> <40-hex-tip>
# Example: refresh-update.sh RH1 H1.txt RH1 <tip>   |   refresh-update.sh RU3 U3.txt RU3 <tip>
# No snapshot commits here: the Windows side owns the snapshots-only commit (Rx step 6).
set -u
LABEL="$1"; NAMED="$2"; PACK="$3"; TIP="$4"
EV=/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WT=/root/warsha-refresh-$LABEL
if [ -e "$WT" ]; then echo "ABORT: $WT exists; inspect first"; exit 9; fi
git -C /root/warsha-visual fetch /mnt/c/Users/Dragonfly/Downloads/Warsha run/2026-11-09-ui-v3/integration || exit 9
git -C /root/warsha-visual worktree add --detach "$WT" "$TIP" || exit 9
cd "$WT" || exit 9
pnpm install --frozen-lockfile > "$EV/gates/$LABEL.install.log" 2>&1 || exit 9
if ss -ltn | grep -qE ":5173|:5174"; then echo "ABORT: ports busy"; exit 9; fi
CI=true pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/$LABEL.pre.json" 2> "$EV/gates/$LABEL.pre.log"
node "$EV/tools/pw-gate.mjs" failures "$EV/gates/$LABEL.pre.json" "$EV/named/$NAMED" > "$EV/gates/$LABEL.pw-gate.log" 2>&1
FENCE=$?
echo "fence_exit=$FENCE" >> "$EV/gates/$LABEL.pw-gate.log"
if [ "$FENCE" -ne 0 ]; then echo "STOP: failures outside named/$NAMED; nothing refreshed"; exit 1; fi
mkdir -p "$EV/od-visual/$PACK"
cp -r "$WT/test-results/." "$EV/od-visual/$PACK/" || exit 9
pnpm exec playwright test --project=desktop --project=remote --last-failed --update-snapshots > "$EV/gates/$LABEL.update.log" 2>&1
git -C "$WT" status --porcelain -- '*-snapshots*' > "$EV/gates/$LABEL.changed.txt"
echo "changed=$(wc -l < "$EV/gates/$LABEL.changed.txt")" >> "$EV/gates/$LABEL.update.log"
echo "REFRESH_UPDATE_DONE label=$LABEL"