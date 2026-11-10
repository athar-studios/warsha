#!/usr/bin/env bash
# U5.pw capture gate — full frozen Playwright suite on the SAME scratch merge worktree as U5.6
# (/root/warsha-u5v = 6025715 + ad58a66 --no-ff): --project=desktop --project=remote
# + pw-gate failures vs named/U5.txt (frozen gates.md) and, additionally, vs named/EMPTY.txt
# (brief). Detached with self-written .done/.exit markers; never pipe through tail;
# never --update-snapshots. Never touch /root/warsha-visual's tree.
export HOME=/root
export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EV=/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
WT=/root/warsha-u5v
U5SHA=ad58a66b42e789de97dbb07f574d177dbf22fafc
BASESHA=6025715d881f80454286e35ed803d08f801a8c6c
META="$EV/gates/U5.pw.meta"
DONE="$EV/gates/U5.pw.done"
EXITF="$EV/gates/U5.pw.exit"
fail() { echo "$1" >> "$META"; echo 1 > "$EXITF"; echo done > "$DONE"; exit 0; }
rm -f "$DONE" "$EXITF" "$EV/gates/U5.pw.err" "$EV/gates/U5.pw.json" \
      "$EV/gates/U5.pw.pw-gate.log" "$EV/gates/U5.pw.pw-gate-empty.log" \
      "$EV/gates/U5.pw.script.err" "$EV/gates/U5.pw.dirty"
exec 2> "$EV/gates/U5.pw.script.err"
echo "start $(date -u +%FT%TZ)" > "$META"
# Reuse the U5.6 scratch merge; verify it exactly.
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
  > "$EV/gates/U5.pw.json" 2> "$EV/gates/U5.pw.err"
RC=$?
echo "playwright_exit=$RC" >> "$META"
node "$EV/tools/pw-gate.mjs" failures "$EV/gates/U5.pw.json" "$EV/named/U5.txt" \
  > "$EV/gates/U5.pw.pw-gate.log" 2>&1
echo "pwgate_exit=$?" >> "$META"
node "$EV/tools/pw-gate.mjs" failures "$EV/gates/U5.pw.json" "$EV/named/EMPTY.txt" \
  > "$EV/gates/U5.pw.pw-gate-empty.log" 2>&1
echo "pwgate_empty_exit=$?" >> "$META"
node "$EV/tools/pw-gate.mjs" counts "$EV/gates/U5.pw.json" 800 9999 \
  > "$EV/gates/U5.pw.counts.log" 2>&1
echo "counts_exit=$?" >> "$META"
echo "end $(date -u +%FT%TZ)" >> "$META"
git status --porcelain > "$EV/gates/U5.pw.dirty" 2>&1
echo "$RC" > "$EXITF"
echo done > "$DONE"
exit 0
