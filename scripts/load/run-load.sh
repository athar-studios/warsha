#!/usr/bin/env bash
# Run the Warsha load suite against a staging daemon in this WSL instance.
#
# Everything is loopback-only and confined to $LOAD_ROOT (default /root/warsha-load).
# The bearer token is generated fresh, written to the daemon's config file, and exported
# into k6's environment — it is never echoed, never lands in a log, and every artifact
# is redacted and verified clean before it is handed to the Windows tree.
#
# Only read-only RPC methods are exercised (`health`, `projects.list`), so no run of
# this script can spend money on a provider.
#
# Usage:  bash scripts/load/run-load.sh [smoke|expected|spike|all]
set -uo pipefail

ROOT=${LOAD_ROOT:-/root/warsha-load}
STATE=$ROOT/state
RUN=$ROOT/run
BIN=$ROOT/target/release/warshad
CFG=$STATE/config.toml
HTTP_PORT=${LOAD_HTTP_PORT:-38765}
RPC_PORT=${LOAD_RPC_PORT:-38766}
K6_DIR=$ROOT/scripts/load/k6
OUT=${LOAD_OUT:-/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/security/load}
# The per-identity ceilings are measured over a 60s window, so a scenario only starts
# with a full bucket if the previous one has had that window to refill.
COOLDOWN=${LOAD_COOLDOWN:-65}
WHICH=${1:-all}

fail() { echo "LOAD-FAIL: $*" >&2; exit 1; }
note() { echo "== $*"; }

[ -x "$BIN" ] || fail "no staging binary at $BIN — build first: cargo build -p warshad --release"
command -v k6 >/dev/null 2>&1 || fail "k6 is not installed — run scripts/load/install-k6.sh"
command -v curl >/dev/null 2>&1 || fail "curl is not installed"
ss -ltn | grep -qE "127\.0\.0\.1:$HTTP_PORT " && fail "port $HTTP_PORT already in use"
ss -ltn | grep -qE "127\.0\.0\.1:$RPC_PORT " && fail "port $RPC_PORT already in use"
pgrep -x warshad >/dev/null 2>&1 && fail "a warshad process is already running"

rm -rf "$RUN"
mkdir -p "$STATE" "$RUN" "$OUT"

# --- fresh credential -------------------------------------------------------------
umask 077
TOKEN=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
[ "${#TOKEN}" -eq 64 ] || fail "could not generate a token"
cat >"$CFG" <<EOF
data_dir = "$STATE"
socket_path = "$STATE/warshad.sock"
http_port = $HTTP_PORT
ws_port = $RPC_PORT
auth_token = "$TOKEN"
allowed_origins = ["http://localhost:5173", "tauri://localhost"]
EOF
chmod 600 "$CFG"
# The credential is used to scrub artifacts. `printf` is a shell builtin, so the pattern
# lands in a 0600 file without ever appearing in a command line another process could read.
printf 's/%s/[REDACTED]/g\n' "$TOKEN" >"$RUN/redact.sed"
chmod 600 "$RUN/redact.sed"
note "staging config written (token generated, not printed)"

# --- daemon -----------------------------------------------------------------------
# setsid so the daemon owns a process group and takes SIGINT on its own; the pid file
# records the daemon itself, because the wrapper execs into it.
setsid bash -c "echo \$\$ > '$RUN/daemon.pid'; exec '$BIN' --config '$CFG' --http-port $HTTP_PORT --ws-port $RPC_PORT --foreground" \
  >"$RUN/daemon.log" 2>&1 &
sleep 1
PID=$(cat "$RUN/daemon.pid" 2>/dev/null || echo "")
[ -n "$PID" ] || fail "daemon did not write a pid; see daemon.log"

ready=0
for _ in $(seq 1 60); do
  kill -0 "$PID" 2>/dev/null || break
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$HTTP_PORT/health" || echo 000)
  if [ "$code" = "200" ]; then
    rpc=$(curl -s --max-time 2 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"health","params":[]}' \
      "http://127.0.0.1:$RPC_PORT" || echo "")
    case "$rpc" in *'"healthy"'*) ready=1; break ;; esac
  fi
  sleep 1
done
[ "$ready" = 1 ] || { sed -f "$RUN/redact.sed" "$RUN/daemon.log" | tail -30; fail "daemon not ready on loopback (pid $PID alive: $(kill -0 "$PID" 2>/dev/null && echo yes || echo no))"; }
note "daemon up: pid $PID, http 127.0.0.1:$HTTP_PORT, rpc 127.0.0.1:$RPC_PORT"

listeners=$(ss -ltn | grep -cE "127\.0\.0\.1:($HTTP_PORT|$RPC_PORT) ")
[ "$listeners" = 2 ] || fail "expected 2 loopback listeners, saw $listeners"

# --- scenarios -------------------------------------------------------------------
run_scenario() { # name
  local n=$1
  note "scenario: $n"
  WARSHA_TOKEN="$TOKEN" WARSHA_HTTP_PORT="$HTTP_PORT" WARSHA_RPC_PORT="$RPC_PORT" \
    k6 run --quiet --log-output=none \
      --summary-mode=full \
      --summary-trend-stats='avg,min,med,max,p(90),p(95),p(99)' \
      --summary-time-unit=ms \
      --summary-export="$RUN/summary-$n.json" \
      "$K6_DIR/$n.js" >"$RUN/k6-$n.txt" 2>&1
  local rc=$?
  # Redact in place: everything downstream, handoff included, only ever sees the scrubbed file.
  sed -f "$RUN/redact.sed" "$RUN/k6-$n.txt" >"$RUN/k6-$n.tmp" && mv "$RUN/k6-$n.tmp" "$RUN/k6-$n.txt"
  printf '%s\tk6_exit\t%s\n' "$n" "$rc" >>"$RUN/lifecycle.tsv"
  note "$n finished (k6 exit $rc; non-zero means a threshold was breached)"
  grep -E '^[[:space:]]+(✓|✗)' "$RUN/k6-$n.txt" | head -20
}

: >"$RUN/lifecycle.tsv"

case "$WHICH" in
  smoke)    run_scenario smoke ;;
  expected) run_scenario expected ;;
  spike)    run_scenario spike ;;
  all)
    run_scenario smoke;    sleep "$COOLDOWN"
    run_scenario expected; sleep "$COOLDOWN"
    run_scenario spike
    ;;
  *) fail "unknown scenario '$WHICH'" ;;
esac

# --- teardown ---------------------------------------------------------------------
note "stopping daemon $PID"
kill -INT "$PID" 2>/dev/null
stopped=0
for _ in $(seq 1 30); do kill -0 "$PID" 2>/dev/null || { stopped=1; break; }; sleep 1; done
if [ "$stopped" = 0 ]; then
  note "daemon ignored SIGINT; sending SIGTERM"
  kill -TERM "$PID" 2>/dev/null
  for _ in $(seq 1 15); do kill -0 "$PID" 2>/dev/null || { stopped=1; break; }; sleep 1; done
fi
[ "$stopped" = 1 ] || { kill -KILL "$PID" 2>/dev/null; printf 'teardown\tkilled_forced\t1\n' >>"$RUN/lifecycle.tsv"; }
printf 'teardown\tgraceful_stop\t%s\n' "$stopped" >>"$RUN/lifecycle.tsv"

sleep 2
note "orphan check"
{
  printf 'teardown\torphan_warshad\t%s\n' "$(pgrep -x warshad | wc -l)"
  printf 'teardown\tlisteners_left\t%s\n' "$(ss -ltn | grep -cE "127\.0\.0\.1:($HTTP_PORT|$RPC_PORT) ")"
  printf 'teardown\tlockfile_left\t%s\n' "$([ -e "$STATE/warshad.lock" ] && echo 1 || echo 0)"
  # Proof the run stayed on read paths: a spend method or a provider call in the
  # daemon's own log would show up here.
  printf 'evidence\tspend_or_provider_markers_in_daemon_log\t%s\n' \
    "$(grep -icE 'anthropic|openai|gemini|runs\.start|agent\.turn|process\.spawn' "$RUN/daemon.log")"
  printf 'evidence\tmethods_exercised\thealth,projects.list\n'
  # S1c acceptance, read off the daemon's own log.
  printf 's1c\tstartup_http_listener_lines\t%s\n' "$(grep -c 'HTTP server listening on' "$RUN/daemon.log")"
  printf 's1c\tstartup_rpc_listener_lines\t%s\n' "$(grep -c 'JSON-RPC server listening on' "$RUN/daemon.log")"
  printf 's1c\trefusal_meter_lines\t%s\n' "$(grep -c 'requests refused at the' "$RUN/daemon.log")"
  # The pre-S1c shape: one line per refusal. Any non-zero count here is a regression.
  printf 's1c\tlegacy_per_refusal_warn_lines\t%s\n' "$(grep -c 'ceiling hit' "$RUN/daemon.log")"
} >>"$RUN/lifecycle.tsv"
pgrep -a -f "warshad --config" >/dev/null 2>&1 && echo "LOAD-WARN: a warshad command line is still running"

# --- hand off sanitized artifacts -------------------------------------------------
bash "$ROOT/scripts/load/extract-metrics.sh" "$RUN" "$OUT/metrics.tsv"
cat "$RUN/lifecycle.tsv" >>"$OUT/metrics.tsv"

# The log is excerpted with counts rather than copied: even a bounded meter can write a
# lot under a flood, and the numbers are the evidence.
bash "$ROOT/scripts/load/summarize-log.sh" "$RUN/daemon.log" "$CFG" >"$OUT/daemon-log-excerpt.txt"

# The pairing probe may start and stop its own short-lived daemon, so the orphan
# assertion is taken again after it rather than trusted from teardown alone.
bash "$ROOT/scripts/load/check-pairings.sh" "$STATE" "$BIN" >"$OUT/pairings-check.txt" 2>&1
printf 'teardown\torphan_warshad_after_pairings_probe\t%s\n' "$(pgrep -x warshad | wc -l)" >>"$OUT/metrics.tsv"

for n in smoke expected spike; do
  [ -f "$RUN/k6-$n.txt" ] && cp "$RUN/k6-$n.txt" "$OUT/k6-$n.txt"
  [ -f "$RUN/summary-$n.json" ] && sed -f "$RUN/redact.sed" "$RUN/summary-$n.json" > "$OUT/summary-$n.json"
done

leaks_rc=0
bash "$ROOT/scripts/load/check-secret.sh" "$CFG" "$OUT" >>"$OUT/metrics.tsv" || leaks_rc=$?
[ "$leaks_rc" = 0 ] || fail "credential found in artifacts under $OUT"

note "artifacts (redacted) in $OUT"
note "done"
