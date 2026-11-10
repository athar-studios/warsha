#!/usr/bin/env bash
# U5.6 capture gate — scratch merge of the u5 head (ad58a66) over integration tip / base 6025715
# in a fresh detached worktree, then settings.spec.ts without @visual.
# Never checkout/reset/stash/clean /root/warsha-visual; only fetch objects + add a worktree.
# Detached with self-written .done/.exit markers; never pipe through tail; never --update-snapshots.
export HOME=/root
export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EV=/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
SRC=/mnt/c/Users/Dragonfly/Downloads/Warsha
WT=/root/warsha-u5v
U5SHA=ad58a66b42e789de97dbb07f574d177dbf22fafc
BASESHA=6025715d881f80454286e35ed803d08f801a8c6c
META="$EV/gates/U5.6.meta"
DONE="$EV/gates/U5.6.done"
EXITF="$EV/gates/U5.6.exit"
fail() { echo "$1" >> "$META"; echo 1 > "$EXITF"; echo done > "$DONE"; exit 0; }
rm -f "$DONE" "$EXITF" "$EV/gates/U5.6.err" "$EV/gates/U5.6.json" \
      "$EV/gates/U5.6.pw-gate.log" "$EV/gates/U5.6.script.err" "$EV/gates/U5.6.dirty"
exec 2> "$EV/gates/U5.6.script.err"
echo "start $(date -u +%FT%TZ)" > "$META"
cd /root/warsha-visual || fail visual_missing
git fetch "$SRC" "+$BASESHA:refs/remotes/q/base" \
  "+refs/heads/run/2026-11-09-ui-v3/u5-settings:refs/remotes/q/u5" >> "$META" 2>&1 || fail fetch_fail
BASE=$(git rev-parse refs/remotes/q/base)
U5=$(git rev-parse refs/remotes/q/u5)
echo "base=$BASE" >> "$META"
echo "u5=$U5" >> "$META"
[ "$BASE" = "$BASESHA" ] || fail base_mismatch
[ "$U5" = "$U5SHA" ] || fail u5_mismatch
git worktree remove --force "$WT" 2>/dev/null
git worktree prune
rm -rf "$WT"
git worktree add --detach "$WT" "$BASE" >> "$META" 2>&1 || fail worktree_fail
cd "$WT" || fail cd_fail
git -c user.name=u5-verify -c user.email=u5-verify@warsha.local \
  merge --no-ff -m "scratch: U5 settings onto integration tip" "$U5" >> "$META" 2>&1 || {
  git status --porcelain >> "$META"; fail merge_fail; }
echo "merged_head=$(git rev-parse HEAD)" >> "$META"
pnpm install --frozen-lockfile > "$EV/gates/U5.6.install.log" 2>&1 || fail install_fail
echo install_ok >> "$META"
if ss -ltn 2>/dev/null | grep -qE ':(5173|5174)[[:space:]]'; then fail PORT_BUSY; fi
echo ports_free >> "$META"
CI=true pnpm exec playwright test --project=desktop v3/settings.spec.ts --grep-invert @visual \
  --reporter=json > "$EV/gates/U5.6.json" 2> "$EV/gates/U5.6.err"
RC=$?
echo "playwright_exit=$RC" >> "$META"
node "$EV/tools/pw-gate.mjs" failures "$EV/gates/U5.6.json" "$EV/named/EMPTY.txt" \
  > "$EV/gates/U5.6.pw-gate.log" 2>&1
echo "pwgate_exit=$?" >> "$META"
node "$EV/tools/pw-gate.mjs" counts "$EV/gates/U5.6.json" 12 9999 \
  > "$EV/gates/U5.6.counts.log" 2>&1
echo "counts_exit=$?" >> "$META"
echo "end $(date -u +%FT%TZ)" >> "$META"
git status --porcelain > "$EV/gates/U5.6.dirty" 2>&1
echo "$RC" > "$EXITF"
echo done > "$DONE"
exit 0
