#!/usr/bin/env bash
# E0.3b capture gate (REPAIRED E0 head fcd7ae5) — fetch in /root/warsha-visual (fetch + worktree
# add ONLY; never checkout/reset/stash/clean), fresh detached worktree /root/warsha-e0v2 at the
# integration tip (82430c9), scratch --no-ff merge of the E0 head, frozen install, port-guard,
# then the frozen smoke capture: playwright --project=desktop v3/smoke.spec.ts -> E0.3b.json,
# pw-gate failures vs named/EMPTY.txt. Threshold: stats.expected >= 14, unexpected == 0.
export HOME=/root
export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EV=/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
SRC=/mnt/c/Users/Dragonfly/Downloads/warsha
WT=/root/warsha-e0v2
E0SHA=fcd7ae5a686fecaed4529998944d43b174dc11b5
TIPSHA=82430c901375bb4986b5c6103ac5ef05e1925f21
META="$EV/gates/E0.3b.meta"
DONE="$EV/gates/E0.3b.done"
EXITF="$EV/gates/E0.3b.exit"
fail() { echo "$1" >> "$META"; echo 1 > "$EXITF"; echo done > "$DONE"; exit 0; }
rm -f "$DONE" "$EXITF" "$EV/gates/E0.3b.err" "$EV/gates/E0.3b.json" \
      "$EV/gates/E0.3b.pw-gate.log" "$EV/gates/E0.3b.dirty" "$EV/gates/E0.3b.script.err"
exec 2> "$EV/gates/E0.3b.script.err"
echo "start $(date -u +%FT%TZ)" > "$META"
cd /root/warsha-visual || fail clone_missing
# Brief refspec: +82430c9:refs/remotes/q/tip (abbreviated). Previous run found the abbreviated
# form rejected ("couldn't find remote ref"); fall back to the full 40-hex (same precedent).
git fetch "$SRC" "+refs/heads/run/2026-11-09-ui-v3/e0-e2e-v3-support:refs/remotes/q/e0" \
  "+82430c9:refs/remotes/q/tip" >> "$META" 2>&1 \
|| git fetch "$SRC" "+refs/heads/run/2026-11-09-ui-v3/e0-e2e-v3-support:refs/remotes/q/e0" \
  "+$TIPSHA:refs/remotes/q/tip" >> "$META" 2>&1 \
|| fail fetch_fail
SHA=$(git rev-parse refs/remotes/q/tip)
E0=$(git rev-parse refs/remotes/q/e0)
echo "tip=$SHA" >> "$META"
echo "e0=$E0" >> "$META"
[ "$SHA" = "$TIPSHA" ] || fail tip_mismatch
[ "$E0" = "$E0SHA" ] || fail e0_mismatch
git worktree remove --force "$WT" 2>/dev/null
git worktree prune
rm -rf "$WT"
git worktree add --detach "$WT" "$SHA" >> "$META" 2>&1 || fail worktree_fail
cd "$WT" || fail cd_fail
git -c user.name=e03b-verify -c user.email=e03b-verify@warsha.local \
  merge --no-ff -m "scratch: E0 e2e-v3-support onto integration tip" "$E0" >> "$META" 2>&1 \
  || { git status --porcelain >> "$META"; fail merge_fail; }
echo "merged_head=$(git rev-parse HEAD)" >> "$META"
pnpm install --frozen-lockfile > "$EV/gates/E0.3b.install.log" 2>&1 || fail install_fail
echo install_ok >> "$META"
if ss -ltn 2>/dev/null | grep -qE ':(5173|5174)[[:space:]]'; then fail PORT_BUSY; fi
echo ports_free >> "$META"
CI=true pnpm exec playwright test --project=desktop v3/smoke.spec.ts --reporter=json \
  > "$EV/gates/E0.3b.json" 2> "$EV/gates/E0.3b.err"
RC=$?
echo "playwright_exit=$RC" >> "$META"
node -e 'const fs=require("fs");let d={};try{d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){console.log("stats_unreadable "+e.message);process.exit(0)}const s=d.stats||{};const er=Array.isArray(d.errors)?d.errors.length:-1;const su=Array.isArray(d.suites)?d.suites.length:-1;console.log("stats expected="+s.expected+" unexpected="+s.unexpected+" flaky="+s.flaky+" skipped="+s.skipped+" duration_ms="+Math.round(s.duration||0));console.log("errors="+er+" suites="+su);const ok=(s.expected>=14&&s.unexpected===0&&er===0);console.log("threshold_expected_ge_14_unexpected_0_no_errors="+(ok?"MET":"NOT_MET"))' \
  "$EV/gates/E0.3b.json" >> "$META" 2>&1
node "$EV/tools/pw-gate.mjs" failures "$EV/gates/E0.3b.json" "$EV/named/EMPTY.txt" \
  > "$EV/gates/E0.3b.pw-gate.log" 2>&1
GRC=$?
echo "pw_gate_exit=$GRC" >> "$META"
sed 's/^/pw_gate_out: /' "$EV/gates/E0.3b.pw-gate.log" >> "$META"
echo "end $(date -u +%FT%TZ)" >> "$META"
git status --porcelain > "$EV/gates/E0.3b.dirty" 2>&1
echo "$GRC" > "$EXITF"
echo done > "$DONE"
exit 0
