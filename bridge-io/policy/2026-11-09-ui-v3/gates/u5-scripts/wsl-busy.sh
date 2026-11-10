#!/bin/sh
# U5 serialization check: count playwright processes (non-self-matching via -f list + grep)
n=$(pgrep -f playwright | grep -cv "^$$\$" 2>/dev/null || echo 0)
# fallback: exclude this script's own shell and pgrep itself
echo "pgrep_raw=$(pgrep -f playwright | wc -l)"
pgrep -f playwright | while read p; do
  [ "$p" = "$$" ] && continue
  cmd=$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null)
  case "$cmd" in
    *wsl-busy*|*pgrep*) ;;
    *) echo "LIVE pid=$p cmd=$cmd" ;;
  esac
done
echo "done"
