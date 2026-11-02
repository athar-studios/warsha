#!/usr/bin/env bash
# LOAD-2 lane: the S1c fixes, measured in their own isolated WSL workspace.
#
# The paths live in a file rather than on a command line because Git Bash rewrites a
# `VAR=/path` argument into a Windows path before wsl.exe ever sees it.
#
# Usage: bash /root/warsha-load2/scripts/load/run-load2.sh [smoke|expected|spike|all]
export LOAD_ROOT=/root/warsha-load2
export LOAD_OUT=/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/security/load2
export LOAD_HTTP_PORT=${LOAD_HTTP_PORT:-38775}
export LOAD_RPC_PORT=${LOAD_RPC_PORT:-38776}

exec bash "$LOAD_ROOT/scripts/load/run-load.sh" "${1:-all}"
