#!/usr/bin/env bash
# U5.pw capture gate, post-repair rerun (U5.pwb) — full frozen Playwright suite on the
# SAME scratch merge worktree as U5.6b (/root/warsha-u5v2 = 6025715 + 7d4ceb9 --no-ff):
# --project=desktop --project=remote, judged vs named/EMPTY.txt (exit 0) AND
# stats.expected >= 800; additionally pw-gate vs named/U5.txt (the frozen packet gate).
# U5's @visual cases have no committed baselines yet (genesis): any @visual failure
# outside the empty set is genesis-expected, counted, not a defect.
# Detached with self-written .done/.exit markers; never pipe through tail;
# never --update-snapshots. Never touch /root/warsha-visual's tree.
export HOME=/root
export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EV=/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
WT=/root/warsha-u5v2
U5SHA=7d4ceb9d589c23a139117ad98a977ff3a073ad9a
BASESHA=6025715d881f80454286e35ed803d08f801a8c6c
GATE=U5.pwb
META="$EV/gates/$GATE.meta"
DONE="$EV/gates/$GATE.done"
EXITF="$EV/gates/$GATE.exit"
fail() { echo "$1" >> "$META"; echo 1 > "$EXITF"; echo done > "$DONE"; exit 0; }
rm -f "$DONE" "$EXITF" "$EV/gates/$GATE.err" "$EV/gates/$GATE.json" \
      "$EV/gates/$GATE.pw-gate.log" "$EV/gates/$GATE.pw-gate-u5.log" \
      "$EV/gates/$GATE.script.err" "$EV/gates/$GATE.dirty" "$EV/gates/$GATE.counts.log"
exec 2> "$EV/gates/$GATE.script.err"
echo "start $(date -u +%FT%TZ)" > "$META"
# Reuse the U5.6b scratch merge; verify it exactly.
cd "$WT" || fail worktree_missing
P1=$(git rev-parse HEAD^1 2>/dev/null) || fail head_unreadable
P2=$(git rev-parse HEAD^2 2>/dev/null) || fail head_unmerge
echo "head=$(git rev-parse HEAD)" >> "$META"
echo "head^1=$P1" >> "$META"
echo "head^2=$P2" >> "$META"
[ "$P1" = "$BASESHA" ] || fail parent1_not_base
[ "$P2" = "$U5SHA" ] || fail parent2_not_u5
DIRTY=$(git status --porcelain)
if [ -n "$DIRTY" ]; then echo "$DIRTY" >> "$META"; fail worktree_dirty_before; fi
echo tree_clean_before >> "$META"
if ss -ltn 2>/dev/null | grep -qE ':(5173|5174)[[:space:]]'; then fail PORT_BUSY; fi
echo ports_free >> "$META"
CI=true pnpm exec playwright test --project=desktop --project=remote --reporter=json \
  > "$EV/gates/$GATE.json" 2> "$EV/gates/$GATE.err"
RC=$?
echo "playwright_exit=$RC" >> "$META"
node "$EV/tools/pw-gate.mjs" failures "$EV/gates/$GATE.json" "$EV/named/EMPTY.txt" \
  > "$EV/gates/$GATE.pw-gate.log" 2>&1
echo "pwgate_exit=$?" >> "$META"
node "$EV/tools/pw-gate.mjs" failures "$EV/gates/$GATE.json" "$EV/named/U5.txt" \
  > "$EV/gates/$GATE.pw-gate-u5.log" 2>&1
echo "pwgate_u5_exit=$?" >> "$META"
node "$EV/tools/pw-gate.mjs" counts "$EV/gates/$GATE.json" 800 9999 \
  > "$EV/gates/$GATE.counts.log" 2>&1
echo "counts_exit=$?" >> "$META"
echo "end $(date -u +%FT%TZ)" >> "$META"
git status --porcelain > "$EV/gates/$GATE.dirty" 2>&1
echo "$RC" > "$EXITF"
echo done > "$DONE"
exit 0
