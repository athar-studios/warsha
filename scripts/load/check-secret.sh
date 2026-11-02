#!/usr/bin/env bash
# Confirm a run's artifacts carry no credential, and print the count as one TSV row.
#
# Usage: bash scripts/load/check-secret.sh <config.toml> <artifact-dir>
# The credential is read from the config file into a 0600 pattern file, never into a
# command line, so `ps` cannot see it either.
set -uo pipefail

CFG=${1:?usage: check-secret.sh <config.toml> <artifact-dir>}
DIR=${2:?usage: check-secret.sh <config.toml> <artifact-dir>}

TOKEN=$(grep '^auth_token' "$CFG" | sed -e 's/.*= "//' -e 's/"$//')
[ -n "$TOKEN" ] || { echo "no auth_token in $CFG" >&2; exit 1; }

PAT=$(mktemp)
trap 'rm -f "$PAT"' EXIT
printf '%s\n' "$TOKEN" >"$PAT"
chmod 600 "$PAT"

LEAKS=$(grep -rlF -f "$PAT" "$DIR" 2>/dev/null | wc -l)
printf 'teardown\ttoken_leaks_in_artifacts\t%s\n' "$LEAKS"
[ "$LEAKS" = 0 ] || grep -rlF -f "$PAT" "$DIR" >&2

exit "$((LEAKS > 0))"
