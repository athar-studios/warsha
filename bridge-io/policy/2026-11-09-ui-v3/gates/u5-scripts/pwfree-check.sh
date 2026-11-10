#!/bin/bash
# One-lane check: playwright processes + port guard 5173/5174
n=$(pgrep -fc playwright 2>/dev/null || true)
echo "playwright_procs=$n"
ss -ltn | grep -qE ':(5173|5174)[[:space:]]'
echo "port_guard_rc=$?"
ss -ltn | grep -E ':(5173|5174)[[:space:]]' || true
