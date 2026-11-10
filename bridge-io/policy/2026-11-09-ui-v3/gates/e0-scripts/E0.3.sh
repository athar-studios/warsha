#!/usr/bin/env bash
# E0.3 capture gate — fresh detached worktree /root/warsha-e0v at the integration tip (82430c9,
# F4+F3+U1+RH1), scratch merge of the E0 head (bcb5c7a) --no-ff, frozen install, port-guard,
# then the frozen smoke capture: playwright --project=desktop v3/smoke.spec.ts + pw-gate failures
# vs named/EMPTY.txt. Never checkout/reset/stash/clean /root/warsha-visual; only fetch + add a worktree.
export HOME=/root
export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EV=/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
SRC=/mnt/c/Users/Dragonfly/Downloads/warsha
WT=/root/warsha-e0v
E0SHA=bcb5c7a8290a2827cdc20e63832c4fb8960efc58
TIPSHA=82430c901375bb4986b5c6103ac5ef05e1925f21
META="$EV/gates/E0.3.meta"
DONE="$EV/gates/E0.3.done"
EXITF="$EV/gates/E0.3.exit"
fail() { echo "$1" >> "$META"; echo 1 > "$EXITF"; echo done > "$DONE"; exit 0; }
rm -f "$DONE" "$EXITF" "$EV/gates/E0.3.err" "$EV/gates/E0.3.json" \
      "$EV/gates/E0.3.pw-gate.log" "$EV/gates/E0.3.dirty"
exec 2> "$EV/gates/E0.3.script.err"
echo "start $(date -u +%FT%TZ)" > "$META"
cd /root/warsha-visual || fail clone_missing
# The brief's refspec '+82430c9:...' (abbreviated) is rejected by fetch ("couldn't find remote ref");
# the same commit is fetched by full 40-hex (same precedent as U1.pw.sh). e0 is fetched by branch ref.
git fetch "$SRC" "+refs/heads/run/2026-11-09-ui-v3/e0-e2e-v3-support:refs/remotes/q/e0" \
  "+$TIPSHA:refs/remotes/q/tip" >> "$META" 2>&1 || fail fetch_fail
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
git -c user.name=e0-pw-verify -c user.email=e0-pw-verify@warsha.local \
  merge --no-ff -m "scratch: E0 e2e-v3-support onto integration tip" "$E0" >> "$META" 2>&1 \
  || { git status --porcelain >> "$META"; fail merge_fail; }
echo "merged_head=$(git rev-parse HEAD)" >> "$META"
pnpm install --frozen-lockfile > "$EV/gates/E0.3.install.log" 2>&1 || fail install_fail
echo install_ok >> "$META"
if ss -ltn 2>/dev/null | grep -qE ':(5173|5174)[[:space:]]'; then fail PORT_BUSY; fi
echo ports_free >> "$META"
CI=true pnpm exec playwright test --project=desktop v3/smoke.spec.ts --reporter=json \
  > "$EV/gates/E0.3.json" 2> "$EV/gates/E0.3.err"
RC=$?
echo "playwright_exit=$RC" >> "$META"
node -e 'const fs=require("fs");let d={};try{d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){console.log("stats_unreadable "+e.message);process.exit(0)}const s=d.stats||{};console.log("stats expected="+s.expected+" unexpected="+s.unexpected+" flaky="+s.flaky+" skipped="+s.skipped+" duration_ms="+Math.round(s.duration||0))' \
  "$EV/gates/E0.3.json" >> "$META" 2>&1
node "$EV/tools/pw-gate.mjs" failures "$EV/gates/E0.3.json" "$EV/named/EMPTY.txt" \
  > "$EV/gates/E0.3.pw-gate.log" 2>&1
GRC=$?
echo "pw_gate_exit=$GRC" >> "$META"
sed 's/^/pw_gate_out: /' "$EV/gates/E0.3.pw-gate.log" >> "$META"
echo "end $(date -u +%FT%TZ)" >> "$META"
git status --porcelain > "$EV/gates/E0.3.dirty" 2>&1
echo "$GRC" > "$EXITF"
echo done > "$DONE"
exit 0
