#!/usr/bin/env bash
# F3.7.pw capture on the WSL host — scratch merge of F3 (738aba6) onto the integration tip 7894d63.
# Never checkout/reset/stash/clean /root/warsha-visual; only fetch objects + a fresh detached worktree.
# Run INSIDE WSL as root, detached (setsid), self-written .done/.exit markers.
export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EV=/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
SRC=/mnt/c/Users/Dragonfly/Downloads/Warsha
META="$EV/gates/F3.7.meta"
DONE="$EV/gates/F3.7.done"
EXIT="$EV/gates/F3.7.exit"
rm -f "$DONE" "$EXIT"
exec 2> "$EV/gates/F3.7.err"
echo "start $(date -u +%FT%TZ)" > "$META"
cd /root/warsha-visual || { echo "clone_missing" >> "$META"; echo 1 > "$EXIT"; echo done > "$DONE"; exit 0; }
git fetch "$SRC" '+refs/heads/run/2026-11-09-ui-v3/f3-flake-warmup:refs/remotes/q/f3' '+refs/heads/run/2026-11-09-ui-v3/integration:refs/remotes/q/tip' >> "$META" 2>&1 || { echo "fetch_fail" >> "$META"; echo 1 > "$EXIT"; echo done > "$DONE"; exit 0; }
TIP=$(git rev-parse refs/remotes/q/tip)
F3=$(git rev-parse refs/remotes/q/f3)
echo "TIP=$TIP" >> "$META"
echo "F3=$F3" >> "$META"
git worktree remove --force /root/warsha-f3v 2>/dev/null
git worktree prune
rm -rf /root/warsha-f3v
git worktree add --detach /root/warsha-f3v "$TIP" >> "$META" 2>&1 || { echo "worktree_fail" >> "$META"; echo 1 > "$EXIT"; echo done > "$DONE"; exit 0; }
cd /root/warsha-f3v || { echo "cd_fail" >> "$META"; echo 1 > "$EXIT"; echo done > "$DONE"; exit 0; }
git -c user.name=verifier -c user.email=verifier@local merge --no-ff "$F3" -m "scratch: F3 onto integration tip for verification" >> "$META" 2>&1 || { echo "merge_fail" >> "$META"; echo 1 > "$EXIT"; echo done > "$DONE"; exit 0; }
echo "scratch_head=$(git rev-parse HEAD)" >> "$META"
pnpm install --frozen-lockfile > "$EV/gates/F3.7.install.log" 2>&1 || { echo "install_fail" >> "$META"; echo 1 > "$EXIT"; echo done > "$DONE"; exit 0; }
echo "install_ok" >> "$META"
if ss -ltn 2>/dev/null | grep -qE ':(5173|5174)[[:space:]]'; then echo "PORT_BUSY" >> "$META"; echo 1 > "$EXIT"; echo done > "$DONE"; exit 0; fi
echo "ports_free" >> "$META"
CI=true pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/F3.7.json" 2>> "$EV/gates/F3.7.log"
RC=$?
echo "playwright_exit=$RC" >> "$META"
node "$EV/tools/pw-gate.mjs" failures "$EV/gates/F3.7.json" "$EV/named/EMPTY.txt" > "$EV/gates/F3.7.pw-gate.log" 2>&1
PG=$?
echo "pwgate_exit=$PG" >> "$META"
echo "end $(date -u +%FT%TZ)" >> "$META"
echo "$PG" > "$EXIT"
echo done > "$DONE"
exit 0
