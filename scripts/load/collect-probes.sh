#!/usr/bin/env bash
# Copy the meter/shutdown probes' evidence into a lane's artifact directory, sanitized.
#
# Each probe keeps its own throwaway credential in its config and in a curl header file;
# those are inputs, never artifacts, so they are excluded and every copied file is passed
# through a redaction script built from the credential that produced it.
#
# Usage: bash /root/warsha-load2/scripts/load/collect-probes.sh <probe-state> <out-dir> <root>
set -uo pipefail

PSTATE=${1:?usage: collect-probes.sh <probe-state> <out-dir> <lane-root>}
OUT=${2:?usage: collect-probes.sh <probe-state> <out-dir> <lane-root>}
ROOT=${3:?usage: collect-probes.sh <probe-state> <out-dir> <lane-root>}

[ -d "$OUT" ] || { echo "no artifact dir at $OUT" >&2; exit 1; }
mkdir -p "$OUT/probes"

CFG="$PSTATE/config.toml"
[ -f "$CFG" ] || { echo "no probe config at $CFG" >&2; exit 1; }
TOKEN=$(grep '^auth_token' "$CFG" | sed -e 's/.*= "//' -e 's/"$//')
SED="$OUT/probes/.redact.sed"
printf 's/%s/[REDACTED]/g\n' "$TOKEN" >"$SED"
chmod 600 "$SED"

copy() { # src dest
  [ -f "$1" ] || return 0
  sed -f "$SED" "$1" >"$OUT/probes/$2"
  printf 'copied\t%s\n' "$2"
}

# The bounded-meter proof: six log lines for a flood that refused thousands of requests.
copy "$ROOT/probe-meter/daemon.log" meter-burst-daemon.log
copy "$ROOT/probe-run/daemon-1.log" meter-flood-daemon.log
copy "$ROOT/probe-429/daemon.log" high-rate-flood-daemon.log
# The refusal contract, verbatim: what a rate-limited RPC actually looks like on the wire.
copy "$ROOT/probe-429/headers.txt" refusal-response-headers.txt
copy "$ROOT/probe-429/body.txt" refusal-response-body.txt

rm -f "$SED"
printf '\n=== probe credentials must not survive in the artifact dir ===\n'
PAT=$(mktemp)
printf '%s\n' "$TOKEN" >"$PAT"
chmod 600 "$PAT"
printf 'probe_token_leaks_in_artifacts\t%s\n' "$(grep -rlF -f "$PAT" "$OUT" 2>/dev/null | wc -l)"
rm -f "$PAT"
