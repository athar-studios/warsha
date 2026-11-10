#!/usr/bin/env bash
# E0.pw2 capture gate (REPAIRED E0 head fcd7ae5) — same scratch merge worktree as E0.3b
# (/root/warsha-e0v2 = tip 82430c9 + E0 head fcd7ae5, --no-ff), full frozen Playwright capture:
# --project=desktop --project=remote -> E0.pw2.json + pw-gate failures vs named/EMPTY.txt.
# DETACHED with self-written .done/.exit markers; never pipe through tail; never
# --update-snapshots. Threshold: stats.expected >= 800, unexpected == 0.
export HOME=/root
export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EV=/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
WT=/root/warsha-e0v2
E0SHA=fcd7ae5a686fecaed4529998944d43b174dc11b5
TIPSHA=82430c901375bb4986b5c6103ac5ef05e1925f21
META="$EV/gates/E0.pw2.meta"
DONE="$EV/gates/E0.pw2.done"
EXITF="$EV/gates/E0.pw2.exit"
fail() { echo "$1" >> "$META"; echo 1 > "$EXITF"; echo done > "$DONE"; exit 0; }
rm -f "$DONE" "$EXITF" "$EV/gates/E0.pw2.err" "$EV/gates/E0.pw2.json" \
      "$EV/gates/E0.pw2.pw-gate.log" "$EV/gates/E0.pw2.dirty" "$EV/gates/E0.pw2.script.err"
exec 2> "$EV/gates/E0.pw2.script.err"
echo "start $(date -u +%FT%TZ)" > "$META"
cd "$WT" || fail worktree_missing
P1=$(git rev-parse HEAD^1 2>/dev/null) || fail head_unreadable
P2=$(git rev-parse HEAD^2 2>/dev/null) || fail head_unmerge
echo "head=$(git rev-parse HEAD)" >> "$META"
echo "head^1=$P1" >> "$META"
echo "head^2=$P2" >> "$META"
[ "$P1" = "$TIPSHA" ] || fail parent1_not_tip
[ "$P2" = "$E0SHA" ] || fail parent2_not_e0
DIRTY=$(git status --porcelain)
if [ -n "$DIRTY" ]; then echo "$DIRTY" >> "$META"; fail worktree_dirty_before; fi
echo tree_clean_before >> "$META"
if ss -ltn 2>/dev/null | grep -qE ':(5173|5174)[[:space:]]'; then fail PORT_BUSY; fi
echo ports_free >> "$META"
CI=true pnpm exec playwright test --project=desktop --project=remote --reporter=json \
  > "$EV/gates/E0.pw2.json" 2> "$EV/gates/E0.pw2.err"
RC=$?
echo "playwright_exit=$RC" >> "$META"
node -e 'const fs=require("fs");let d={};try{d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){console.log("stats_unreadable "+e.message);process.exit(0)}const s=d.stats||{};const er=Array.isArray(d.errors)?d.errors.length:-1;const su=Array.isArray(d.suites)?d.suites.length:-1;console.log("stats expected="+s.expected+" unexpected="+s.unexpected+" flaky="+s.flaky+" skipped="+s.skipped+" duration_ms="+Math.round(s.duration||0));console.log("errors="+er+" suites="+su);const ok=(s.expected>=800&&s.unexpected===0&&er===0);console.log("threshold_expected_ge_800_unexpected_0_no_errors="+(ok?"MET":"NOT_MET"))' \
  "$EV/gates/E0.pw2.json" >> "$META" 2>&1
node "$EV/tools/pw-gate.mjs" failures "$EV/gates/E0.pw2.json" "$EV/named/EMPTY.txt" \
  > "$EV/gates/E0.pw2.pw-gate.log" 2>&1
GRC=$?
echo "pw_gate_exit=$GRC" >> "$META"
sed 's/^/pw_gate_out: /' "$EV/gates/E0.pw2.pw-gate.log" >> "$META"
echo "end $(date -u +%FT%TZ)" >> "$META"
git status --porcelain > "$EV/gates/E0.pw2.dirty" 2>&1
echo "$GRC" > "$EXITF"
echo done > "$DONE"
exit 0
