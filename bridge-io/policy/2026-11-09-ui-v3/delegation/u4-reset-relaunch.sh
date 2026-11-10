#!/usr/bin/env bash
# Deliberate reset of the confused/obsolete capture state, then relaunch the corrected U4 capture.
pkill -9 chrome 2>/dev/null
for p in $(pgrep -f node); do
  if [ "$p" != "$$" ]; then kill -9 "$p" 2>/dev/null; fi
done
sleep 2
cd /root/warsha-visual && git worktree remove --force /root/warsha-u4v 2>/dev/null; git worktree prune
echo "ports_after_reset=$(ss -ltn | grep -cE ':(5173|5174)[[:space:]]')"
setsid nohup bash /mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3/delegation/u4-capture.sh >/tmp/u4cap3.log 2>&1 </dev/null &
echo relaunched_corrected