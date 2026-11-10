#!/usr/bin/env bash
# RU4 genesis refresh (fenced, OD-U1 pre-authorised): generate U5 settings @visual baselines on the integration tip,
# copy them back to the integration worktree. Commit + fence happen on the Windows side afterwards.
export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EV=/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
SRC=/mnt/c/Users/Dragonfly/Downloads/warsha
INT=/mnt/c/Users/Dragonfly/Downloads/warsha-wt/v3/integration
META="$EV/gates/RU4.meta"; DONE="$EV/gates/RU4.done"
rm -f "$DONE"; exec 2> "$EV/gates/RU4.err"
echo "start $(date -u +%FT%TZ)" > "$META"
cd /root/warsha-visual || { echo clone_missing >> "$META"; echo done > "$DONE"; exit 0; }
git fetch "$SRC" '+153690bb1950e64cbe53a420e44d6e06432338fd:refs/remotes/q/tip' >> "$META" 2>&1 || { echo fetch_fail >> "$META"; echo done > "$DONE"; exit 0; }
git worktree remove --force /root/warsha-ru4 2>/dev/null; git worktree prune; rm -rf /root/warsha-ru4
git worktree add --detach /root/warsha-ru4 q/tip >> "$META" 2>&1 || { echo wt_fail >> "$META"; echo done > "$DONE"; exit 0; }
cd /root/warsha-ru4 || { echo cd_fail >> "$META"; echo done > "$DONE"; exit 0; }
pnpm install --frozen-lockfile > "$EV/gates/RU4.install.log" 2>&1 || { echo install_fail >> "$META"; echo done > "$DONE"; exit 0; }
echo install_ok >> "$META"
if ss -ltn 2>/dev/null | grep -qE ':(5173|5174)[[:space:]]'; then echo PORT_BUSY >> "$META"; echo done > "$DONE"; exit 0; fi
CI=true pnpm exec playwright test --project=desktop v3/bench.spec.ts --grep @visual --update-snapshots > "$EV/gates/RU4.update.log" 2>&1
echo "update_exit=$?" >> "$META"
git status --porcelain > "$EV/gates/RU4.snap-list.txt"
N=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  mkdir -p "$INT/$(dirname "$f")"
  cp -a "/root/warsha-ru4/$f" "$INT/$f" && N=$((N+1))
done < <(awk '{print $NF}' "$EV/gates/RU4.snap-list.txt")
echo "copied=$N" >> "$META"
echo "end $(date -u +%FT%TZ)" >> "$META"
echo done > "$DONE"