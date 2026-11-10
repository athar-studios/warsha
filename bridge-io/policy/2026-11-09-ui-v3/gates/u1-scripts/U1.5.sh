#!/bin/sh
# U1.5 — frozen gate, verbatim from packets/U1/gates.md. Run in worktree C:/Users/Dragonfly/Downloads/warsha-wt/v3/u1
# Expect exit 1 (absent = data-driven, no hard-coded model list).
cd /c/Users/Dragonfly/Downloads/warsha-wt/v3/u1 || exit 99
grep -nE "DeepSeek\|GPT-4o\|Claude 3\.5\|fleet-worktrees\|autonomous-factory" packages/ui/src/v3/composites/ModelPicker.tsx
