#!/bin/sh
# E0.2 — frozen gate, verbatim from packets/E0/gates.md. Run in worktree C:/Users/Dragonfly/Downloads/warsha-wt/v3/e0
cat apps/desktop/e2e/v3/support/*.ts | grep -cE "export (async )?function (openV3|act|expectRpc|rpcCalls)\b"
