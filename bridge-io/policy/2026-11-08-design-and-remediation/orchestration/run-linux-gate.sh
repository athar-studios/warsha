#!/usr/bin/env bash
# Orchestrator Linux-capture-host gate runner (verification infrastructure, NOT product code).
# Verifies ONE reviewed commit in a throwaway clean worktree on the authoritative WSL x86_64 host.
# It never edits the commit, never updates snapshots, and never touches /root/warsha-visual.
#
# Usage: run-linux-gate.sh <label> <commit> <desktop|remote|both> [--list-only]
#   label    short id used for the log / marker name, e.g. G8.4 or G3.8
#   commit   full 40-hex commit SHA present in the Windows checkout
#   project  which Playwright project to run
#
# Environment matches the recorded G0 baseline: CI unset (3 workers), the repo fontconfig pin is
# resolved by playwright.config.ts on Linux, IBM Plex faces are installed.
set -u
LABEL="${1:?label}"; COMMIT="${2:?commit}"; PROJECT="${3:?project}"; MODE="${4:-run}"
WIN_REPO=/mnt/c/Users/Dragonfly/Downloads/Warsha
EV="$WIN_REPO/bridge-io/policy/2026-11-08-design-and-remediation"
WT="/root/verify-$LABEL"
LOG="$EV/gates/$LABEL.log"
DONE="$EV/gates/$LABEL.done"
mkdir -p "$EV/gates"
rm -f "$DONE"

{
  echo "=== Linux gate $LABEL ==="
  echo "commit:  $COMMIT"
  echo "project: $PROJECT  mode: $MODE"
  echo "host:    WSL Ubuntu x86_64 user=$(whoami) node=$(node --version) pnpm=$(pnpm --version)"
  echo "worktree: $WT"
  echo "CI: unset (matches the G0 baseline: 3 workers)"
  echo "plex faces: $(fc-list | grep -ci plex)"
  echo
} > "$LOG" 2>&1

# Refuse to run while another gate holds the shared dev-server ports: both projects use
# reuseExistingServer:false on 5173/5174, so concurrent runs produce false failures.
PORTS_FREE=1
ss -lptn 'sport = :5173' 2>/dev/null | grep -q LISTEN && PORTS_FREE=0
ss -lptn 'sport = :5174' 2>/dev/null | grep -q LISTEN && PORTS_FREE=0
if [ "$PORTS_FREE" -eq 0 ]; then
  echo "ABORT: port 5173 or 5174 already has a listener; another gate is running." >> "$LOG"
  printf 'status=aborted-ports-busy\n' > "$DONE"; exit 7
fi

# Bring the commit's objects into the capture clone WITHOUT pushing or touching its working tree.
# Prefer the main Windows checkout (a worktree's .git is a Windows-style gitdir file WSL cannot read).
if ! git -C /root/warsha-visual cat-file -e "$COMMIT^{commit}" 2>/dev/null; then
  {
    echo "--- fetching objects from $WIN_REPO (additive only) ---"
    git -C /root/warsha-visual fetch "$WIN_REPO" '+refs/heads/*:refs/remotes/origin-win/*' 2>&1
  } >> "$LOG" 2>&1
fi
# Accept a short SHA: resolve it to the full 40-hex object name before any comparison, because
# `git rev-parse HEAD` always returns the full name and the worktree guard compares the two.
if ! RESOLVED=$(git -C /root/warsha-visual rev-parse --verify "$COMMIT^{commit}" 2>/dev/null); then
  echo "ABORT: commit $COMMIT is not present in the capture clone after fetch." >> "$LOG"
  printf 'status=aborted-commit-missing\n' > "$DONE"; exit 8
fi
if [ "$RESOLVED" != "$COMMIT" ]; then
  echo "note: resolved $COMMIT -> $RESOLVED" >> "$LOG"
  COMMIT="$RESOLVED"
fi

# Fresh throwaway worktree at exactly that commit.
if [ -d "$WT" ]; then
  git -C /root/warsha-visual worktree remove --force "$WT" >> "$LOG" 2>&1 || rm -rf "$WT"
fi
git -C /root/warsha-visual worktree add --detach "$WT" "$COMMIT" >> "$LOG" 2>&1
if [ "$(git -C "$WT" rev-parse HEAD 2>/dev/null)" != "$COMMIT" ]; then
  echo "ABORT: worktree is not at $COMMIT." >> "$LOG"
  printf 'status=aborted-worktree\n' > "$DONE"; exit 9
fi

cd "$WT" || exit 10
{
  echo "--- pnpm install --frozen-lockfile ---"
} >> "$LOG" 2>&1
pnpm install --frozen-lockfile >> "$LOG" 2>&1
INSTALL_EXIT=$?
echo "[install exit: $INSTALL_EXIT]" >> "$LOG"
if [ "$INSTALL_EXIT" -ne 0 ]; then
  printf 'status=install-failed\ninstall_exit=%s\n' "$INSTALL_EXIT" > "$DONE"; exit 11
fi

run_project() {
  local proj="$1"
  if [ "$MODE" = "--list-only" ]; then
    echo "=== pnpm exec playwright test --project=$proj --list ===" >> "$LOG"
    pnpm exec playwright test --project="$proj" --list >> "$LOG" 2>&1
    echo "[list exit for $proj: $?]" >> "$LOG"
    return 0
  fi
  echo "=== pnpm exec playwright test --project=$proj --reporter=line ===" >> "$LOG"
  pnpm exec playwright test --project="$proj" --reporter=line >> "$LOG" 2>&1
  local rc=$?
  echo "[$proj exit code: $rc]" >> "$LOG"
  echo "$rc"
}

DESKTOP_EXIT=skipped; REMOTE_EXIT=skipped
case "$PROJECT" in
  desktop) DESKTOP_EXIT=$(run_project desktop) ;;
  remote)  REMOTE_EXIT=$(run_project remote) ;;
  both)    DESKTOP_EXIT=$(run_project desktop); REMOTE_EXIT=$(run_project remote) ;;
esac

{
  echo
  echo "=== post-run integrity ==="
  echo "snapshot_writes: $(git status --porcelain -- '*-snapshots/*' | wc -l)"
  echo "dirty_after: $(git status --porcelain | wc -l)"
  echo "head_after: $(git rev-parse HEAD)"
  echo "desktop_exit=$DESKTOP_EXIT remote_exit=$REMOTE_EXIT"
} >> "$LOG" 2>&1

printf 'status=finished\ndesktop_exit=%s\nremote_exit=%s\nsnapshot_writes=%s\n' \
  "$DESKTOP_EXIT" "$REMOTE_EXIT" "$(git status --porcelain -- '*-snapshots/*' | wc -l)" > "$DONE"