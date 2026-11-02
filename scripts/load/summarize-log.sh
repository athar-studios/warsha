#!/usr/bin/env bash
# Turn a flooded daemon's log into a bounded, sanitized excerpt.
#
# The daemon refuses through a bounded meter now, but the log is still the evidence for
# that claim, so the counts are taken here rather than trusting the shape: total lines,
# line kinds, and the refusal-meter interval lines in full.
#
# Usage: bash scripts/load/summarize-log.sh <daemon.log> <config.toml> > excerpt.txt
# The credential is read out of the config file rather than taken as an argument, so it
# never appears in a command line that another process could read from `ps`.
set -uo pipefail

LOG=${1:?usage: summarize-log.sh <daemon.log> <config.toml>}
CFG=${2:?usage: summarize-log.sh <daemon.log> <config.toml>}
TOKEN=$(grep '^auth_token' "$CFG" | sed -e 's/.*= "//' -e 's/"$//')
[ -n "$TOKEN" ] || { echo "no auth_token in $CFG" >&2; exit 1; }

# The credential goes into a sed script file, not into a command line: argv is readable
# by every process on the machine, a 0600 file is not.
SED=$(mktemp)
trap 'rm -f "$SED"' EXIT
umask 077
printf 's/%s/[REDACTED]/g\n' "$TOKEN" >"$SED"

{
  printf 'log_lines_total\t%s\n' "$(wc -l <"$LOG")"
  printf 'log_bytes\t%s\n' "$(wc -c <"$LOG")"
  printf 'log_lines_warn\t%s\n' "$(grep -c ' WARN ' "$LOG")"
  printf 'log_lines_info\t%s\n' "$(grep -c ' INFO ' "$LOG")"
  # Bounded refusal meter (LOAD-1 finding 2): one aggregated interval line per period,
  # not one per refusal. Its absence of growth is the acceptance evidence.
  printf 'log_lines_refusal_meter\t%s\n' "$(grep -c 'requests refused at the' "$LOG")"
  printf 'log_lines_startup_http_listener\t%s\n' "$(grep -c 'HTTP server listening on' "$LOG")"
  printf 'log_lines_startup_rpc_listener\t%s\n' "$(grep -c 'JSON-RPC server listening on' "$LOG")"
  # The pre-S1c shapes, kept so a regression to per-refusal logging is visible as a
  # non-zero count rather than as a missing metric.
  printf 'log_lines_per_refusal_warn_legacy\t%s\n' "$(grep -c 'ceiling hit' "$LOG")"
  printf 'log_lines_per_method_refusal_legacy\t%s\n' "$(grep -c 'after its' "$LOG")"
  echo
  echo '--- refusal-meter lines, in full ---'
  grep 'requests refused at the' "$LOG" || echo '(none)'
  echo
  echo '--- first 10 lines ---'
  head -10 "$LOG"
  echo '--- distinct message shapes ---'
  sed -e 's/^[^Z]*Z *//' "$LOG" | cut -c1-76 | sort | uniq -c | sort -rn | head -12
  echo '--- last 10 lines ---'
  tail -10 "$LOG"
} | sed -f "$SED"
