#!/usr/bin/env bash
# Re-run W1's 13 frozen gates from scratch in a throwaway worktree, writing a REAL log per gate.
# Reason: packets/W1/verification.md asserted pass for all 13 and listed log filenames, but no G1.*.log
# existed on disk. A verdict with no log is not evidence (ENGINEERING_POLICY §4), so this re-derives it.
set -u
REPO="C:/Users/Dragonfly/Downloads/Warsha"
E="$REPO/bridge-io/policy/2026-11-08-design-and-remediation"
BASE=0772d502002562505c6438ae712abca7a7328d84
HEAD=6d9728f52eb096199c4ace208435c8b8927e5140
P="C:/Users/Dragonfly/Downloads/warsha-wt/verify-w1b"
git -C "$REPO" worktree remove --force "$P" >/dev/null 2>&1
git -C "$REPO" worktree add --detach "$P" "$HEAD" >/dev/null 2>&1 || { echo "worktree add failed"; exit 9; }
cd "$P" || exit 9
echo "verifying HEAD=$(git rev-parse HEAD) base=$BASE"
mkdir -p "$E/gates"

log() { # log <id> <command-string> ; body runs the command itself
  local id="$1"; shift
  { echo "gate: $id"; echo "command: $*"; echo "commit: $HEAD"; echo "base: $BASE"
    echo "host: Windows throwaway worktree verify-w1b"; echo "timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "---"; } > "$E/gates/$id.log"
  bash -c "$*" >> "$E/gates/$id.log" 2>&1
  local rc=$?
  echo "exit_code: $rc" >> "$E/gates/$id.log"
  printf '%-7s exit=%s\n' "$id" "$rc"
}

log G1.S "git diff --name-only $BASE..$HEAD | grep -vE '^(crates/warsha-(remote|git|pipeline)/README\.md|packages/crypto/README\.md|apps/(remote|desktop)/README\.md|templates/README\.md|README(\.ar)?\.md)\$' | wc -l"
log G1.1 "grep -nE 'registers no service worker|لا يسجّل خدمة' README.md README.ar.md"
log G1.2 "grep -nE '^(Planned:|المخطط له:)' README.md README.ar.md"
log G1.3 "( for f in README.md README.ar.md; do for m in M10 M11 M12 M13 M14 M15 M16 M17 M18 M19 M20 'Wave 2'; do grep -qE \"^\\| \$m \\|\" \"\$f\" || { echo \"\$f \$m\"; exit 1; }; done; done )"
log G1.4 "( for m in agent_loop agent_tools agent_workflow backend_kit build_cache evals guardrails handoff llm_cache observability orchestrator post_launch preferences process_spawn prompts provider_setup router_quality routines run_modes scale_standards scout skills work_protection mcp mcp_transport settings; do grep -q \"\`\$m\`\" crates/warsha-pipeline/README.md || { echo \"\$m\"; exit 1; }; done )"
log G1.5 "grep -q process_handshake crates/warsha-remote/README.md && grep -qiE 'stub|not implemented' crates/warsha-remote/README.md"
log G1.6 "( grep -q ProjectTemplate templates/README.md && for t in web cli desktop android; do grep -qw \"\$t\" templates/README.md || exit 1; done )"
log G1.7 "grep -q 'The pipeline asks this crate' crates/warsha-git/README.md"
log G1.8 "grep -q flows.spec.ts apps/desktop/README.md && grep -q real-acceptance.cjs apps/desktop/README.md && grep -q 188 apps/desktop/README.md"
log G1.9 "grep -q registerShellWorker apps/remote/README.md && grep -q RemoteProvider apps/remote/README.md"
log G1.A "node scripts/check-arch.mjs"
log G1.P "node scripts/check-engineering-policy.mjs"
log G1.W "node scripts/check-wire-contract.mjs"

echo "--- logs written: $(ls "$E/gates"/G1.*.log | wc -l) ---"
cd "$REPO" && git worktree remove --force "$P" >/dev/null 2>&1 && echo "verify worktree removed"
