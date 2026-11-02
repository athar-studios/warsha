#!/usr/bin/env bash
# Does the bounded refusal meter count every refusal, or only the ones it writes a line for?
#
# A meter that writes one line per (ceiling, caller) per 60s cannot show its running total
# during a 30s flood: the line it prints is a snapshot of the moment it spoke, not of the
# flood that followed. So this probe counts refusals itself in a first burst, waits out the
# interval, bursts again, and reads the total the meter accumulated across both.
#
# Honest meter => the second line's pair total is at least the refusals counted in burst A.
#
# Usage: bash /root/warsha-load2/scripts/load/probe-meter-count.sh
set -uo pipefail

ROOT=${LOAD_ROOT:-/root/warsha-load2}
BIN=$ROOT/target/release/warshad
PSTATE=$ROOT/probe-state
PRUN=$ROOT/probe-meter
HTTP_PORT=38805
RPC_PORT=38806
BURST=${PROBE_BURST:-600}
PAR=${PROBE_PARALLELISM:-12}
WAIT=${PROBE_INTERVAL_WAIT:-63}

rm -rf "$PRUN"; mkdir -p "$PRUN"
[ -f "$PSTATE/config.toml" ] || { echo "run probe-shutdown-and-meter.sh first" >&2; exit 1; }

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

# One request per helper call: the status and whether the body carried -32004, on one
# short line. Marking inside the helper keeps a 8k-request burst off the argument list.
export PRUN
export AUTH="$PRUN/curl-auth"
export URL="http://127.0.0.1:$RPC_PORT"
cat >"$PRUN/one.sh" <<'EOS'
#!/usr/bin/env bash
id=$1
# mktemp inside the helper: a path built from an inherited variable that is unset in this
# shell would silently drop the body and make every refusal look like a success.
body=$(mktemp)
code=$(curl -s -o "$body" -w '%{http_code}' -K "$AUTH" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":$id,\"method\":\"projects.list\",\"params\":[]}" "$URL")
if grep -q -- '-32004' "$body"; then flag=1; else flag=0; fi
rm -f "$body"
printf '%s\t%s\n' "$code" "$flag"
EOS
chmod +x "$PRUN/one.sh"

burst() { # label
  local l=$1
  seq 1 "$BURST" | xargs -P "$PAR" -I{} "$PRUN/one.sh" {} >"$PRUN/$l.tsv"
  local c429 c32004
  c429=$(grep -c '^429' "$PRUN/$l.tsv")
  # `-F'\t'`, not a `grep '\t1$'` pattern: in a POSIX basic regex `\t` is the letter t, so
  # the tab never matched and every refusal looked like a success.
  c32004=$(awk -F'\t' '$2=="1"' "$PRUN/$l.tsv" | wc -l)
  printf '%s\thttp_200\t%s\n' "$l" "$(grep -c '^200' "$PRUN/$l.tsv")"
  printf '%s\thttp_429\t%s\n' "$l" "$c429"
  printf '%s\trpc_minus32004\t%s\n' "$l" "$c32004"
  printf '%s\trefusals_observed\t%s\n' "$l" "$((c429 + c32004))"
}

echo "=== burst A ==="
burst a
printf 'a\tmeter_lines_so_far\t%s\n' "$(grep -c 'requests refused at the' "$PRUN/daemon.log")"

echo
echo "=== waiting ${WAIT}s for the meter's interval to pass ==="
sleep "$WAIT"

echo "=== burst B (its first refusal should let the meter speak with an accumulated total) ==="
burst b

echo
echo "=== the meter's lines ==="
grep 'requests refused at the' "$PRUN/daemon.log"
printf 'summary\tmeter_lines_total\t%s\n' "$(grep -c 'requests refused at the' "$PRUN/daemon.log")"
printf 'summary\tlog_lines_total\t%s\n' "$(wc -l <"$PRUN/daemon.log")"

kill -INT "$PID" 2>/dev/null
for _ in $(seq 1 30); do kill -0 "$PID" 2>/dev/null || break; sleep 1; done
printf 'teardown\tmeter_probe_orphan\t%s\n' "$(pgrep -x warshad | wc -l)"
printf 'teardown\tmeter_probe_lock_after_stop\t%s\n' "$([ -e "$PSTATE/warshad.lock" ] && echo present || echo absent)"
