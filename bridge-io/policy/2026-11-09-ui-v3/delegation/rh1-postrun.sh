#!/usr/bin/env bash
# RH1 post-refresh re-run on the WSL capture host. Run AFTER rh1-refresh.sh completed and the snapshots-only commit
# landed on the integration branch. The refreshed PNGs are present in /root/warsha-rh1 (uncommitted) -> the run proves
# the refreshed baselines render green. Writes RH1.post.json + RH1.post.meta + RH1.post.done.
export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EV=/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
DONE="$EV/gates/RH1.post.done"
META="$EV/gates/RH1.post.meta"
rm -f "$DONE"
exec 2> "$EV/gates/RH1.post.err"
echo "start $(date -u +%FT%TZ)" > "$META"
cd /root/warsha-rh1 || { echo "worktree_missing" >> "$META"; echo done > "$DONE"; exit 0; }
LISTED=$(CI=true pnpm exec playwright test --list --project=desktop --project=remote 2>/dev/null | grep -oE 'Total: [0-9]+' | grep -oE '[0-9]+' | head -1)
echo "listed=$LISTED" >> "$META"
if ss -ltn 2>/dev/null | grep -qE ':(5173|5174)[[:space:]]'; then echo "PORT_BUSY" >> "$META"; echo done > "$DONE"; exit 0; fi
CI=true pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/RH1.post.json" 2>> "$EV/gates/RH1.post.err"
echo "playwright_exit=$?" >> "$META"
node "$EV/tools/pw-gate.mjs" counts "$EV/gates/RH1.post.json" "$LISTED" 0 >> "$META" 2>&1
echo "pw_gate_exit=$?" >> "$META"
git status --porcelain -- '*-snapshots*' >> "$META"
echo "end $(date -u +%FT%TZ)" >> "$META"
echo done > "$DONE"