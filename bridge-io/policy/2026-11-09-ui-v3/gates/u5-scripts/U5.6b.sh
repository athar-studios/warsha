#!/usr/bin/env bash
# U5.6 capture gate, post-repair rerun (U5.6b) — scratch merge of the U5 repair head
# (7d4ceb9) over integration tip 6025715 in a FRESH detached worktree /root/warsha-u5v2,
# then settings.spec.ts without @visual; judged vs named/EMPTY.txt (exit 0) AND
# stats.expected >= 60. A 0-spec/error JSON fails the counts gate.
# Never checkout/reset/stash/clean /root/warsha-visual; only fetch objects + add a worktree.
# Detached with self-written .done/.exit markers; never pipe through tail;
# never --update-snapshots.
export HOME=/root
export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EV=/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
SRC=/mnt/c/Users/Dragonfly/Downloads/warsha
WT=/root/warsha-u5v2
U5SHA=7d4ceb9d589c23a139117ad98a977ff3a073ad9a
BASESHA=6025715d881f80454286e35ed803d08f801a8c6c
GATE=U5.6b
META="$EV/gates/$GATE.meta"
DONE="$EV/gates/$GATE.done"
EXITF="$EV/gates/$GATE.exit"
fail() { echo "$1" >> "$META"; echo 1 > "$EXITF"; echo done > "$DONE"; exit 0; }
rm -f "$DONE" "$EXITF" "$EV/gates/$GATE.err" "$EV/gates/$GATE.json" \
      "$EV/gates/$GATE.pw-gate.log" "$EV/gates/$GATE.script.err" "$EV/gates/$GATE.dirty" \
      "$EV/gates/$GATE.counts.log" "$EV/gates/$GATE.install.log"
exec 2> "$EV/gates/$GATE.script.err"
echo "start $(date -u +%FT%TZ)" > "$META"
echo "u5sha=$U5SHA basesha=$BASESHA wt=$WT" >> "$META"
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
  merge --no-ff -m "scratch: U5 settings repair onto integration tip" "$U5" >> "$META" 2>&1 || {
  git status --porcelain >> "$META"; fail merge_fail; }
echo "merged_head=$(git rev-parse HEAD)" >> "$META"
pnpm install --frozen-lockfile > "$EV/gates/$GATE.install.log" 2>&1 || fail install_fail
echo install_ok >> "$META"
if ss -ltn 2>/dev/null | grep -qE ':(5173|5174)[[:space:]]'; then fail PORT_BUSY; fi
echo ports_free >> "$META"
CI=true pnpm exec playwright test --project=desktop v3/settings.spec.ts --grep-invert @visual \
  --reporter=json > "$EV/gates/$GATE.json" 2> "$EV/gates/$GATE.err"
RC=$?
echo "playwright_exit=$RC" >> "$META"
node "$EV/tools/pw-gate.mjs" failures "$EV/gates/$GATE.json" "$EV/named/EMPTY.txt" \
  > "$EV/gates/$GATE.pw-gate.log" 2>&1
echo "pwgate_exit=$?" >> "$META"
node "$EV/tools/pw-gate.mjs" counts "$EV/gates/$GATE.json" 60 9999 \
  > "$EV/gates/$GATE.counts.log" 2>&1
echo "counts_exit=$?" >> "$META"
echo "end $(date -u +%FT%TZ)" >> "$META"
git status --porcelain > "$EV/gates/$GATE.dirty" 2>&1
echo "$RC" > "$EXITF"
echo done > "$DONE"
exit 0
