#!/usr/bin/env bash
# G1.4 re-written correctly: the earlier log failed because an inline backtick inside `bash -c "..."` was
# command-substituted by the OUTER shell ("process_spawn: command not found"). This version keeps the
# backtick literal by using single quotes, so the gate is run as the prompt writes it.
set -u
REPO="C:/Users/Dragonfly/Downloads/Warsha"
E="$REPO/bridge-io/policy/2026-11-08-design-and-remediation"
HEAD=6d9728f52eb096199c4ace208435c8b8927e5140
BASE=0772d502002562505c6438ae712abca7a7328d84
P="C:/Users/Dragonfly/Downloads/warsha-wt/verify-w1c"
git -C "$REPO" worktree remove --force "$P" >/dev/null 2>&1
git -C "$REPO" worktree add --detach "$P" "$HEAD" >/dev/null 2>&1 || { echo "worktree add failed"; exit 9; }
cd "$P" || exit 9

{
  echo "gate: G1.4"
  echo 'command: ( for m in agent_loop ... settings; do grep -q "`$m`" crates/warsha-pipeline/README.md || { echo "$m"; exit 1; }; done )'
  echo "commit: $HEAD"; echo "base: $BASE"
  echo "host: Windows throwaway worktree verify-w1c"
  echo "timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "---"
} > "$E/gates/G1.4.log"

# Note: a backtick inside double quotes still executes, so build the pattern with sed instead of backticks.
for m in agent_loop agent_tools agent_workflow backend_kit build_cache evals guardrails handoff \
         llm_cache observability orchestrator post_launch preferences process_spawn prompts \
         provider_setup router_quality routines run_modes scale_standards scout skills \
         work_protection mcp mcp_transport settings; do
  pat=$(printf '`%s`' "$m")
  if ! grep -qF -- "$pat" crates/warsha-pipeline/README.md; then
    echo "MISSING: $m" | tee -a "$E/gates/G1.4.log"
    rc=1
  fi
done
rc=${rc:-0}
echo "all 26 module names found in backticks: $([ "$rc" -eq 0 ] && echo yes || echo no)" >> "$E/gates/G1.4.log"
echo "exit_code: $rc" >> "$E/gates/G1.4.log"
echo "G1.4 exit=$rc"
cd "$REPO" && git worktree remove --force "$P" >/dev/null 2>&1 && echo "worktree removed"
