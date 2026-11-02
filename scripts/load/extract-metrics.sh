#!/usr/bin/env bash
# Turn k6's text summary into a flat TSV of the numbers this suite is judged on.
#
# Kept separate from run-load.sh so the table can be rebuilt from a stored summary
# without putting load on a daemon again.
#
# Usage: bash scripts/load/extract-metrics.sh <dir-of-k6-*.clean.txt> <out.tsv>
set -uo pipefail

DIR=${1:?usage: extract-metrics.sh <run-dir> <out.tsv>}
OUT=${2:?usage: extract-metrics.sh <run-dir> <out.tsv>}

# Metric lines look like `     name.......: value ...`; the leading-whitespace anchor
# skips the threshold lines above them, which start with a pass/fail mark.
metric_line() { grep -m1 -E "^[[:space:]]*$2\.+:" "$1" || true; }

# A Counter or Trend with no samples is missing from the summary altogether, and a blank
# cell reads like a missed measurement rather than a zero.
cell() { # file metric
  local v
  v=$(metric_line "$1" "$2" | sed 's/.*: //' | awk '{print $1}')
  printf '%s' "${v:-0}"
}

scenario() { # file name
  local f=$1 s=$2 line label pat val
  printf '%s\titerations\t%s\n' "$s" "$(cell "$f" iterations)"
  for m in ok_responses limiter_method_32004 limiter_http_429 true_errors error_rate http_req_failed; do
    printf '%s\t%s\t%s\n' "$s" "$m" "$(cell "$f" "$m")"
  done
  for m in admitted_latency limited_latency http_req_duration iteration_duration; do
    line=$(metric_line "$f" "$m")
    for spec in 'avg:avg=' 'med:med=' 'max:max=' 'p90:p\(90\)=' 'p95:p\(95\)=' 'p99:p\(99\)='; do
      label=${spec%%:*}
      pat=${spec#*:}
      val=$(printf '%s' "$line" | grep -oE "${pat}[0-9.]+[^[:space:]]*" | head -1 | cut -d= -f2)
      # `n/a`, not `0`: no sample means nothing was measured, and 0ms would read as an
      # impossibly fast daemon.
      printf '%s\t%s_%s\t%s\n' "$s" "$m" "$label" "${val:-n/a}"
    done
  done
}

printf 'scenario\tmetric\tvalue\n' >"$OUT"
for n in smoke expected spike; do
  [ -f "$DIR/k6-$n.txt" ] && scenario "$DIR/k6-$n.txt" "$n" >>"$OUT"
done
