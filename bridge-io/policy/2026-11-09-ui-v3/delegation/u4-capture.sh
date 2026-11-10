#!/usr/bin/env bash
# U4 capture gates (U4.6 + U4.pw) — detached, survives pauses. Judge from the JSONs afterwards.
export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EV=/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
SRC=/mnt/c/Users/Dragonfly/Downloads/warsha
META="$EV/gates/U4cap.meta"; DONE="$EV/gates/U4cap.done"
rm -f "$DONE"; exec 2> "$EV/gates/U4cap.err"
echo "start $(date -u +%FT%TZ)" > "$META"
cd /root/warsha-visual || { echo clone_missing >> "$META"; echo done > "$DONE"; exit 0; }
git fetch "$SRC" '+refs/heads/run/2026-11-09-ui-v3/u4-workbench:refs/remotes/q/u4' '+14bea00a4b11555370de252a1af4667dbe92f584:refs/remotes/q/tip' >> "$META" 2>&1 || { echo fetch_fail >> "$META"; echo done > "$DONE"; exit 0; }
git worktree remove --force /root/warsha-u4v 2>/dev/null; git worktree prune; rm -rf /root/warsha-u4v
git worktree add --detach /root/warsha-u4v q/tip >> "$META" 2>&1 || { echo wt_fail >> "$META"; echo done > "$DONE"; exit 0; }
cd /root/warsha-u4v || { echo cd_fail >> "$META"; echo done > "$DONE"; exit 0; }
git merge --no-ff q/u4 -m "scratch: U4 capture" >> "$META" 2>&1 || { echo merge_fail >> "$META"; echo done > "$DONE"; exit 0; }
pnpm install --frozen-lockfile > "$EV/gates/U4cap.install.log" 2>&1 || { echo install_fail >> "$META"; echo done > "$DONE"; exit 0; }
echo install_ok >> "$META"
if ss -ltn 2>/dev/null | grep -qE ':(5173|5174)[[:space:]]'; then echo PORT_BUSY >> "$META"; echo done > "$DONE"; exit 0; fi
CI=true pnpm exec playwright test --project=desktop v3/bench.spec.ts --grep-invert @visual --reporter=json > "$EV/gates/U4.6.json" 2>> "$EV/gates/U4cap.err"
echo "u46_exit=$?" >> "$META"
CI=true pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/U4.pw.json" 2>> "$EV/gates/U4cap.err"
echo "u4pw_exit=$?" >> "$META"
echo "end $(date -u +%FT%TZ)" >> "$META"
echo done > "$DONE"