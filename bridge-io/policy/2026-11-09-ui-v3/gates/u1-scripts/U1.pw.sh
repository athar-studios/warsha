#!/usr/bin/env bash
# U1.pw capture gate — scratch merge of the u1 head (1762caa) onto the current integration tip
# (04ae669, contains F4+F3+RH1) in a fresh detached worktree, then the frozen Playwright capture.
# Never checkout/reset/stash/clean /root/warsha-visual; only fetch objects + add a worktree.
export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EV=/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
SRC=/mnt/c/Users/Dragonfly/Downloads/warsha
WT=/root/warsha-u1v
U1SHA=1762caa972f1bca55721dc17ed8794125db61bc2
TIPSHA=04ae66992df85ecfc04f05e94e1eddc3487818f3
META="$EV/gates/U1.pw.meta"
DONE="$EV/gates/U1.pw.done"
EXITF="$EV/gates/U1.pw.exit"
fail() { echo "$1" >> "$META"; echo 1 > "$EXITF"; echo done > "$DONE"; exit 0; }
rm -f "$DONE" "$EXITF" "$EV/gates/U1.pw.err" "$EV/gates/U1.pw.json"
exec 2> "$EV/gates/U1.pw.script.err"
echo "start $(date -u +%FT%TZ)" > "$META"
cd /root/warsha-visual || fail clone_missing
# The brief's refspec '+04ae669:...' (abbreviated) is rejected by fetch ("couldn't find remote ref");
# the same commit is fetched by full 40-hex. u1 is fetched by branch ref as instructed.
git fetch "$SRC" "+refs/heads/run/2026-11-09-ui-v3/u1-ds-composites:refs/remotes/q/u1" "+$TIPSHA:refs/remotes/q/tip" >> "$META" 2>&1 || fail fetch_fail
SHA=$(git rev-parse refs/remotes/q/tip)
U1=$(git rev-parse refs/remotes/q/u1)
echo "tip=$SHA" >> "$META"
echo "u1=$U1" >> "$META"
[ "$SHA" = "$TIPSHA" ] || fail tip_mismatch
[ "$U1" = "$U1SHA" ] || fail u1_mismatch
git worktree remove --force "$WT" 2>/dev/null
git worktree prune
rm -rf "$WT"
git worktree add --detach "$WT" "$SHA" >> "$META" 2>&1 || fail worktree_fail
cd "$WT" || fail cd_fail
git -c user.name=u1-pw-verify -c user.email=u1-pw-verify@warsha.local \
  merge --no-ff -m "scratch: U1 ds-composites onto integration tip" "$U1" >> "$META" 2>&1 || { git status --porcelain >> "$META"; fail merge_fail; }
echo "merged_head=$(git rev-parse HEAD)" >> "$META"
pnpm install --frozen-lockfile > "$EV/gates/U1.pw.install.log" 2>&1 || fail install_fail
echo install_ok >> "$META"
if ss -ltn 2>/dev/null | grep -qE ':(5173|5174)[[:space:]]'; then fail PORT_BUSY; fi
echo ports_free >> "$META"
CI=true pnpm exec playwright test --project=desktop --project=remote --reporter=json \
  > "$EV/gates/U1.pw.json" 2> "$EV/gates/U1.pw.err"
RC=$?
echo "playwright_exit=$RC" >> "$META"
echo "end $(date -u +%FT%TZ)" >> "$META"
git status --porcelain > "$EV/gates/U1.pw.dirty" 2>&1
echo "$RC" > "$EXITF"
echo done > "$DONE"
exit 0
