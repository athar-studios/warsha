#!/usr/bin/env bash
# RH1 pre-run on the WSL capture host — full Playwright JSON at the C1 integration tip (128b59c).
# Never checkout/reset/stash/clean /root/warsha-visual; only fetch objects + a fresh detached worktree.
export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EV=/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
SRC=/mnt/c/Users/Dragonfly/Downloads/Warsha
META="$EV/gates/RH1.pre.meta"
DONE="$EV/gates/RH1.pre.done"
rm -f "$DONE"
exec 2> "$EV/gates/RH1.pre.err"
echo "start $(date -u +%FT%TZ)" > "$META"
cd /root/warsha-visual || { echo "clone_missing" >> "$META"; echo done > "$DONE"; exit 0; }
git fetch "$SRC" '+refs/heads/run/2026-11-09-ui-v3/integration:refs/remotes/q/integration' >> "$META" 2>&1 || { echo "fetch_fail" >> "$META"; echo done > "$DONE"; exit 0; }
SHA=$(git rev-parse refs/remotes/q/integration)
echo "SHA=$SHA" >> "$META"
git worktree remove --force /root/warsha-rh1 2>/dev/null
git worktree prune
rm -rf /root/warsha-rh1
git worktree add --detach /root/warsha-rh1 "$SHA" >> "$META" 2>&1 || { echo "worktree_fail" >> "$META"; echo done > "$DONE"; exit 0; }
cd /root/warsha-rh1 || { echo "cd_fail" >> "$META"; echo done > "$DONE"; exit 0; }
pnpm install --frozen-lockfile > "$EV/gates/RH1.pre.install.log" 2>&1 || { echo "install_fail" >> "$META"; echo done > "$DONE"; exit 0; }
echo "install_ok" >> "$META"
if ss -ltn 2>/dev/null | grep -qE ':(5173|5174)[[:space:]]'; then echo "PORT_BUSY" >> "$META"; echo done > "$DONE"; exit 0; fi
CI=true pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/RH1.pre.json" 2>> "$EV/gates/RH1.pre.err"
RC=$?
echo "playwright_exit=$RC" >> "$META"
echo "end $(date -u +%FT%TZ)" >> "$META"
echo done > "$DONE"