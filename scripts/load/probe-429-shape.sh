#!/usr/bin/env bash
# Who answers a flood with HTTP 429, and what do they say?
#
# The meter counted 401 refusals while curl independently saw 1,235 of them, so most 429
# responses never reached the code that reports a refusal. The response itself says who
# wrote it: our own ceiling refusal carries {"error":"rate limited"} and a Retry-After
# header, and anything else is a different layer answering for it.
#
# Usage: bash /root/warsha-load2/scripts/load/probe-429-shape.sh
set -uo pipefail

ROOT=${LOAD_ROOT:-/root/warsha-load2}
BIN=$ROOT/target/release/warshad
PSTATE=$ROOT/probe-state
PRUN=$ROOT/probe-429
HTTP_PORT=38795
RPC_PORT=38796

rm -rf "$PRUN"; mkdir -p "$PRUN"
if [ ! -f "$PSTATE/config.toml" ]; then
  echo "expected $PSTATE/config.toml from probe-shutdown-and-meter.sh" >&2
  exit 1
fi

umask 077
TOKEN=$(grep '^auth_token' "$PSTATE/config.toml" | sed -e 's/.*= "//' -e 's/"$//')
{ printf 'header = "Authorization: Bearer %s"\n' "$TOKEN"; printf 'header = "Content-Type: application/json"\n'; } >"$PRUN/curl-auth"
chmod 600 "$PRUN/curl-auth"

setsid bash -c "echo \$\$ > '$PRUN/daemon.pid'; exec '$BIN' --config '$PSTATE/config.toml' --http-port $HTTP_PORT --ws-port $RPC_PORT --foreground" >"$PRUN/daemon.log" 2>&1 &
sleep 1
PID=$(cat "$PRUN/daemon.pid")
for _ in $(seq 1 30); do
  curl -fsS --max-time 2 -K "$PRUN/curl-auth" -d '{"jsonrpc":"2.0","id":1,"method":"health","params":[]}' \
    "http://127.0.0.1:$RPC_PORT" 2>/dev/null | grep -q healthy && break
  sleep 1
done

# Keep the ceiling saturated from another shell while the sample is taken.
( for _ in $(seq 1 3000); do
    curl -s -o /dev/null -K "$PRUN/curl-auth" -d '{"jsonrpc":"2.0","id":2,"method":"projects.list","params":[]}' \
      "http://127.0.0.1:$RPC_PORT"
  done ) &
FLOOD=$!
sleep 2

echo "=== one refused response, in full ==="
curl -s -D "$PRUN/headers.txt" -o "$PRUN/body.txt" -w 'http_status=%{http_code}\n' \
  -K "$PRUN/curl-auth" -d '{"jsonrpc":"2.0","id":7,"method":"projects.list","params":[]}' \
  "http://127.0.0.1:$RPC_PORT"
echo "--- headers ---"; cat "$PRUN/headers.txt"
echo "--- body ---"; cat "$PRUN/body.txt"; echo

kill "$FLOOD" 2>/dev/null
wait "$FLOOD" 2>/dev/null
kill -INT "$PID" 2>/dev/null
for _ in $(seq 1 30); do kill -0 "$PID" 2>/dev/null || break; sleep 1; done

echo "=== what the daemon said about it ==="
printf 'probe\tmeter_lines\t%s\n' "$(grep -c 'requests refused at the' "$PRUN/daemon.log")"
grep 'requests refused at the' "$PRUN/daemon.log" | tail -3
printf 'probe\ttotal_log_lines\t%s\n' "$(wc -l <"$PRUN/daemon.log")"
printf 'probe\torphan_after_probe\t%s\n' "$(pgrep -x warshad | wc -l)"
