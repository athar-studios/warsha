#!/usr/bin/env bash
# KEEL K3.2 tool: no production MockRoutineRunner. Verifier tooling; does not touch product code.
# A hit is production only if it appears BEFORE the file's first #[cfg(test)] marker (test modules are allowed).
set -uo pipefail
cd "${KEEL_WORKTREE:-C:/Users/Dragonfly/Downloads/warsha-wt/keel/k3}" || exit 2
prod=""
while IFS=: read -r file line rest; do
  [ -n "$file" ] || continue
  cfg=$(grep -n '#\[cfg(test)\]' "$file" 2>/dev/null | head -1 | cut -d: -f1)
  if [ -z "$cfg" ] || [ "$line" -lt "$cfg" ]; then
    prod="$prod$file:$line:$rest\n"
  fi
done < <(git grep -n "MockRoutineRunner" -- crates/warsha-pipeline/src crates/warshad/src crates/warsha-core/src ':(exclude)**/tests/**' || true)
if [ -n "$prod" ]; then
  printf '%b' "$prod"
  echo "k3-mock-scan: production MockRoutineRunner found"
  exit 1
fi
echo "no production MockRoutineRunner"
exit 0