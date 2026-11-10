#!/bin/bash
# Orchestrator plumbing for R0 completion (Rx steps 1-5) at the C0.5 tip. Run INSIDE WSL as root:
#   bash /mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3/delegation/r0-post-update.sh <40-hex-tip>
# Gate commands inside are the frozen ones, verbatim. No snapshot commits here (Windows side owns the commit).
set -u
TIP="$1"
EV=/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WT=/root/warsha-r0post
if [ -e "$WT" ]; then echo "ABORT: $WT exists; inspect first"; exit 9; fi
git -C /root/warsha-visual fetch /mnt/c/Users/Dragonfly/Downloads/Warsha run/2026-11-09-ui-v3/integration || exit 9
git -C /root/warsha-visual worktree add --detach "$WT" "$TIP" || exit 9
cd "$WT" || exit 9
pnpm install --frozen-lockfile > "$EV/gates/R0.post.install.log" 2>&1 || exit 9
if ss -ltn | grep -qE ":5173|:5174"; then echo "ABORT: ports busy"; exit 9; fi
CI=true pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/R0.pre2.json" 2> "$EV/gates/R0.pre2.log"
node "$EV/tools/pw-gate.mjs" failures "$EV/gates/R0.pre2.json" "$EV/named/R0.txt" > "$EV/gates/R0.pw-gate2.log" 2>&1
FENCE=$?
echo "fence_exit=$FENCE" >> "$EV/gates/R0.pw-gate2.log"
if [ "$FENCE" -ne 0 ]; then echo "STOP: failures outside named/R0.txt; nothing refreshed"; exit 1; fi
mkdir -p "$EV/od-visual/R0-post"
cp -r "$WT/test-results/." "$EV/od-visual/R0-post/" || exit 9
pnpm exec playwright test --project=desktop --project=remote --last-failed --update-snapshots > "$EV/gates/R0.update2.log" 2>&1
git -C "$WT" status --porcelain -- '*-snapshots*' > "$EV/gates/R0.changed2.txt"
echo "changed=$(wc -l < "$EV/gates/R0.changed2.txt")" >> "$EV/gates/R0.update2.log"
echo "R0_POST_UPDATE_DONE"