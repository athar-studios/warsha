#!/usr/bin/env bash
# Two facts the load run could not settle on its own:
#
#  1. does the bounded refusal meter count what it refuses? k6 saw 1.6M refusals in the
#     spike; the meter's own line reported a few hundred. A controlled flood with a known
#     request count says which number is right.
#  2. does a clean SIGINT shutdown release the daemon's lock file? LOAD-2 found
#     `warshad.lock` left behind, and a stale lock that blocks the next start is an
#     availability problem, not a tidiness one.
#
# Everything runs in its own throwaway state directory on its own ports; it does not
# touch the measured lane's artifacts.
#
# Usage: bash /root/warsha-load2/scripts/load/probe-shutdown-and-meter.sh
set -uo pipefail

ROOT=${LOAD_ROOT:-/root/warsha-load2}
BIN=$ROOT/target/release/warshad
PSTATE=$ROOT/probe-state
PRUN=$ROOT/probe-run
HTTP_PORT=38785
RPC_PORT=38786
FLOOD=${PROBE_FLOOD:-2000}
PAR=${PROBE_PARALLELISM:-32}

rm -rf "$PRUN"
mkdir -p "$PSTATE" "$PRUN"
umask 077
TOKEN=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
cat >"$PSTATE/config.toml" <<EOF
data_dir = "$PSTATE"
socket_path = "$PSTATE/warshad.sock"
http_port = $HTTP_PORT
ws_port = $RPC_PORT
auth_token = "$TOKEN"
allowed_origins = ["http://localhost:5173", "tauri://localhost"]
EOF
chmod 600 "$PSTATE/config.toml"

# A curl config file keeps the bearer token out of argv, where `ps` would show it.
HDR="$PRUN/curl-auth"
{ printf 'header = "Authorization: Bearer %s"\n' "$TOKEN"; printf 'header = "Content-Type: application/json"\n'; } >"$HDR"
chmod 600 "$HDR"

start_daemon() { # log-file
  setsid bash -c "echo \$\$ > '$PRUN/daemon.pid'; exec '$BIN' --config '$PSTATE/config.toml' --http-port $HTTP_PORT --ws-port $RPC_PORT --foreground" >"$1" 2>&1 &
  sleep 1
  cat "$PRUN/daemon.pid"
}

wait_ready() { # pid
  local pid=$1 i
  for i in $(seq 1 30); do
    kill -0 "$pid" 2>/dev/null || return 1
    if curl -fsS --max-time 2 -K "$HDR" -d '{"jsonrpc":"2.0","id":1,"method":"health","params":[]}' \
      "http://127.0.0.1:$RPC_PORT" 2>/dev/null | grep -q healthy; then return 0; fi
    sleep 1
  done
  return 1
}

echo "=== first start ==="
PID=$(start_daemon "$PRUN/daemon-1.log")
wait_ready "$PID" || { echo "probe: daemon did not become ready"; tail -5 "$PRUN/daemon-1.log"; exit 1; }
printf 'probe\tstart_1_ready\t1\n'
printf 'probe\tlock_present_while_running\t%s\n' "$([ -e "$PSTATE/warshad.lock" ] && echo 1 || echo 0)"

echo
echo "=== controlled flood: $FLOOD RPC calls at the ceiling ==="
seq 1 "$FLOOD" | xargs -P "$PAR" -I@ curl -s -o /dev/null -w '%{http_code}\n' \
  -K "$HDR" -d '{"jsonrpc":"2.0","id":@,"method":"projects.list","params":[]}' \
  "http://127.0.0.1:$RPC_PORT" >"$PRUN/codes.txt" 2>/dev/null
echo "--- status distribution (k6-independent count) ---"
sort "$PRUN/codes.txt" | uniq -c
printf 'probe\tflood_requests_sent\t%s\n' "$FLOOD"
printf 'probe\tflood_status_200\t%s\n' "$(grep -c '^200$' "$PRUN/codes.txt")"
printf 'probe\tflood_status_429\t%s\n' "$(grep -c '^429$' "$PRUN/codes.txt")"
echo "--- a refused response, body and headers ---"
curl -s -D - -o "$PRUN/refusal-body.txt" -K "$HDR" \
  -d '{"jsonrpc":"2.0","id":99999,"method":"projects.list","params":[]}' \
  "http://127.0.0.1:$RPC_PORT" | head -8
echo "--- refusal body ---"
head -c 300 "$PRUN/refusal-body.txt"; echo

printf 'probe\tmeter_lines_after_flood\t%s\n' "$(grep -c 'requests refused at the' "$PRUN/daemon-1.log")"
echo "--- meter lines, in full ---"
grep 'requests refused at the' "$PRUN/daemon-1.log" || echo '(none)'

echo
echo "=== SIGINT, then look for the lock ==="
kill -INT "$PID" 2>/dev/null
for _ in $(seq 1 30); do kill -0 "$PID" 2>/dev/null || break; sleep 1; done
sleep 2
printf 'probe\texit_after_sigint\t%s\n' "$(kill -0 "$PID" 2>/dev/null && echo no || echo yes)"
printf 'probe\tlock_after_stop_1\t%s\n' "$([ -e "$PSTATE/warshad.lock" ] && echo present || echo absent)"

echo
echo "=== second start on the same state dir (does a stale lock block it?) ==="
PID2=$(start_daemon "$PRUN/daemon-2.log")
if wait_ready "$PID2"; then
  printf 'probe\trestart_after_stale_lock\tok\n'
else
  printf 'probe\trestart_after_stale_lock\tFAILED\n'
  tail -5 "$PRUN/daemon-2.log"
fi
kill -INT "$PID2" 2>/dev/null
for _ in $(seq 1 30); do kill -0 "$PID2" 2>/dev/null || break; sleep 1; done
sleep 2
printf 'probe\tlock_after_stop_2\t%s\n' "$([ -e "$PSTATE/warshad.lock" ] && echo present || echo absent)"

echo
echo "=== credential hygiene: the token must be absent from every probe artifact ==="
# The scan pattern lives in a 0600 file, not in a command line.
PAT="$PRUN/scan.pattern"
printf '%s\n' "$TOKEN" >"$PAT"
chmod 600 "$PAT"
# The three 0600 inputs that legitimately hold the credential (the daemon's config, curl's
# header file, and this scan's own pattern) are excluded; nothing else may contain it.
LEAKS=$(grep -rlF -f "$PAT" "$PRUN" "$PSTATE" 2>/dev/null \
  | grep -vE 'config\.toml$|curl-auth$|scan\.pattern$' | wc -l)
printf 'probe\ttoken_appears_outside_config\t%s\n' "$LEAKS"

kill -KILL "$PID2" 2>/dev/null
printf 'probe\torphan_after_probe\t%s\n' "$(pgrep -x warshad | wc -l)"
