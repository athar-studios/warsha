#!/usr/bin/env bash
# scripts/android-smoke.sh — R-UI-5 T3: the scripted Android smoke for apps/mobile.
#
# Proves, on a local emulator and without touching the product, that:
#   S1  the debug APK installs and boots without crash/ANR and the pairing plate renders;
#   S2  a cold `warsha://pair` deep link against a loopback daemon pairs and the bench renders;
#   S3  a warm deep link (singleTask -> onNewIntent) keeps the same process and stays paired;
#   S4  the core screens (projects, run, gates, needs-you, settings) render from the paired state;
#   S5  a deep link naming a public cleartext host is refused: no pairing, no crash;
#   and that no `FATAL EXCEPTION`/ANR line and no pairing token reached logcat or these logs.
#
# Design (docs/zadloop/packets/R-UI-5.md, frozen):
#   * D1 — adb launch + `uiautomator dump`/`screencap`/`logcat`; no instrumented test module.
#   * D2 — `adb reverse tcp:8765` / `tcp:8766`, pair via `host=127.0.0.1&port=8765`, so the daemon
#          keeps its loopback bind and the page CSP / network-security-config stay unmodified.
#   * D3 — the page is asserted through the WebView DevTools socket the debuggable debug build
#          exposes (`webview_devtools_remote_<pid>` -> `/json` -> CDP `Runtime.evaluate`). When that
#          socket is unreachable the affected step is reported `mode: "visual"` and, per the packet,
#          a visual result is a pass only for S1/S4 appearance — never for S2 (and never for S5).
#   * D4 — the token is minted by the daemon into this run's throwaway config and is never echoed;
#          every log this run writes is grepped for it and a hit fails the run.
#   * D5 — config/data/logs live under `target/r-ui-5/` and the emulator is headless with
#          `-no-snapshot`; `-wipe-data` is passed to `Pixel_7_API_35` only.
#   * D6 — `Athar_GPlay` is the second pass with no `-wipe-data` and an uninstall-first install.
#
# Usage: bash scripts/android-smoke.sh --avd Pixel_7_API_35 --report target/r-ui-5/pixel7.json
# Exits non-zero on any failed step and always writes the report JSON
# `{avd, steps:[{id,pass,mode}], failed, crashes, tokenLeaks, ...}`.
# Artifacts: target/r-ui-5/<avd>/{*.png,logcat.txt,daemon.log,emulator.log,script.log}.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_BASE="$ROOT/target/r-ui-5"
ADB_BIN="${ADB:-adb}"
EMULATOR_BIN="${EMULATOR:-$HOME/Android/Sdk/emulator/emulator}"
SERIAL="${SERIAL:-emulator-5554}"
DPORT="${DPORT:-9333}"
# The page dials these two (`connect-src` in the built index.html and the cleartext policy name
# exactly them), so they are what `adb reverse` exposes *inside* the emulator. The host-side ports
# are the daemon's own and default to the same numbers; when another (foreign, never-killed) daemon
# already owns 8765/8766 on the host, they move and the reverse mapping bridges 8765 -> host port.
HTTP_PORT=8765
WS_PORT=8766
HOST_HTTP_PORT=8765
HOST_WS_PORT=8766
APP_ID="dev.warsha.remote"
ACTIVITY="$APP_ID/.MainActivity"

AVD=""
REPORT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --avd) AVD="${2:-}"; shift 2 ;;
    --report) REPORT="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) printf 'android-smoke: unknown argument: %s\n' "$1" >&2; exit 64 ;;
  esac
done
if [ -z "$AVD" ]; then
  printf 'android-smoke: --avd <name> is required\n' >&2
  exit 64
fi
if [ -z "$REPORT" ]; then
  REPORT="$OUT_BASE/$AVD.json"
fi
case "$REPORT" in
  /*) : ;;
  *) REPORT="$PWD/$REPORT" ;;
esac

RUN_DIR="$OUT_BASE/$AVD"
mkdir -p "$RUN_DIR/cfg" "$(dirname -- "$REPORT")"
rm -rf "$RUN_DIR/cfg" "$RUN_DIR/home" "$RUN_DIR/data"
mkdir -p "$RUN_DIR/cfg" "$RUN_DIR/home"
SCRIPT_LOG="$RUN_DIR/script.log"
: >"$SCRIPT_LOG"
LOGACT="$RUN_DIR/logcat.txt"
DAEMON_LOG="$RUN_DIR/daemon.log"
EMULATOR_LOG="$RUN_DIR/emulator.log"
: >"$DAEMON_LOG"
: >"$EMULATOR_LOG"

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STEPS=()
COMMANDS=()
ARTIFACTS=()
FAILED=0
CRASHES=0
TOKEN_LEAKS=0
LEAKS_MEASURED=0
CAPTURED_LOGCAT=0
VERDICT=""
STOP_REASON=""
TOK=""
DAEMON_PID=""
EMU_PID=""
DEVTOOLS=0
WSURL=""
PREFLIGHT_JSON="{}"
TOKEN_SOURCES=()

# ---------------------------------------------------------------------------
# Reporting helpers
# ---------------------------------------------------------------------------
say() { printf '[android-smoke] %s\n' "$*" >>"$SCRIPT_LOG"; printf '[android-smoke] %s\n' "$*" >&2; }

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/ /g' | tr -d '\n'
}

step() { # id pass mode note
  local id="$1" pass="$2" mode="$3" note="$4"
  STEPS+=("{\"id\":\"$(json_escape "$id")\",\"pass\":$pass,\"mode\":\"$mode\",\"note\":\"$(json_escape "$note")\"}")
  if [ "$pass" -eq 0 ]; then
    FAILED=$((FAILED + 1))
    say "STEP $id FAIL ($mode): $note"
  else
    say "STEP $id pass ($mode): $note"
  fi
}

cmd_entry() { # command exit
  COMMANDS+=("{\"cmd\":\"$(json_escape "$1")\",\"exit\":$2}")
}

artifact() { ARTIFACTS+=("\"$(json_escape "$1")\""); }

stop() { # reason — a packet STOP rule fired
  STOP_REASON="$1"
  say "STOP: $1"
}

# Redact the run token from any text this script persists.
redact() { # <string> — token is URL-safe base64 ('-'/'_' are the only non-alphanumerics)
  local text="$1"
  if [ -n "$TOK" ]; then
    printf '%s' "${text//"$TOK"/<redacted>}"
  else
    printf '%s' "$text"
  fi
}

write_report() {
  local steps_json="" cmds_json="" arts_json="" pf_json="$PREFLIGHT_JSON" tokens_json=""
  if [ "${#STEPS[@]}" -gt 0 ]; then steps_json=$(IFS=,; printf '%s' "${STEPS[*]}"); fi
  if [ "${#COMMANDS[@]}" -gt 0 ]; then cmds_json=$(IFS=,; printf '%s' "${COMMANDS[*]}"); fi
  if [ "${#ARTIFACTS[@]}" -gt 0 ]; then arts_json=$(IFS=,; printf '%s' "${ARTIFACTS[*]}"); fi
  if [ "${#TOKEN_SOURCES[@]}" -gt 0 ]; then tokens_json=$(IFS=,; printf '%s' "${TOKEN_SOURCES[*]}"); fi
  local verdict="${VERDICT:-smoke failed}"
  if [ -n "$STOP_REASON" ]; then verdict="STOP: $STOP_REASON"; fi
  {
    printf '{\n'
    printf '  "schema": "warsha-android-smoke/v1",\n'
    printf '  "avd": "%s",\n' "$(json_escape "$AVD")"
    printf '  "serial": "%s",\n' "$(json_escape "$SERIAL")"
    printf '  "startedAt": "%s",\n' "$STARTED_AT"
    printf '  "finishedAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '  "verdict": "%s",\n' "$(json_escape "$verdict")"
    printf '  "stopReason": %s,\n' "$([ -n "$STOP_REASON" ] && printf '"%s"' "$(json_escape "$STOP_REASON")" || printf 'null')"
    printf '  "steps": [%s],\n' "$steps_json"
    printf '  "failed": %s,\n' "$FAILED"
    printf '  "crashes": %s,\n' "$CRASHES"
    printf '  "tokenLeaks": %s,\n' "$TOKEN_LEAKS"
    printf '  "tokenLeakSources": [%s],\n' "$tokens_json"
    printf '  "commands": [%s],\n' "$cmds_json"
    printf '  "artifacts": [%s],\n' "$arts_json"
    printf '  "ports": {"device": {"http": %s, "ws": %s}, "host": {"http": %s, "ws": %s}},\n' "$HTTP_PORT" "$WS_PORT" "$HOST_HTTP_PORT" "$HOST_WS_PORT"
    printf '  "preflight": %s\n' "$pf_json"
    printf '}\n'
  } >"$REPORT"
  say "report written: ${REPORT#"$ROOT"/}"
  if command -v node >/dev/null 2>&1; then
    if node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$REPORT" >/dev/null 2>&1; then
      say "report JSON parses"
    else
      say "REPORT JSON IS INVALID: ${REPORT#"$ROOT"/}"
    fi
  fi
}

# ---------------------------------------------------------------------------
# Teardown (trap): never leave an emulator or a daemon running.
# ---------------------------------------------------------------------------
teardown() {
  set +e
  trap - EXIT INT TERM
  if [ -n "$DAEMON_PID" ] && kill -0 "$DAEMON_PID" 2>/dev/null; then
    kill -TERM "$DAEMON_PID" 2>/dev/null
    for _ in $(seq 1 20); do
      kill -0 "$DAEMON_PID" 2>/dev/null || break
      sleep 0.25
    done
    kill -KILL "$DAEMON_PID" 2>/dev/null
    say "daemon stopped (pid $DAEMON_PID)"
  fi
  if [ -n "$EMU_PID" ] && kill -0 "$EMU_PID" 2>/dev/null; then
    "$ADB_BIN" -s "$SERIAL" emu kill >/dev/null 2>&1
    local rc=$?
    cmd_entry "adb -s $SERIAL emu kill" "$rc"
    for _ in $(seq 1 40); do
      kill -0 "$EMU_PID" 2>/dev/null || break
      sleep 0.5
    done
    if kill -0 "$EMU_PID" 2>/dev/null; then
      say "emulator pid $EMU_PID did not exit after \`adb emu kill\`; sending SIGTERM"
      kill -TERM "$EMU_PID" 2>/dev/null
      sleep 2
      kill -KILL "$EMU_PID" 2>/dev/null
    fi
    say "emulator stopped"
  fi
  "$ADB_BIN" kill-server >/dev/null 2>&1
}

on_exit() {
  local rc=$?
  # A STOP before the logcat step still owes the report its logcat evidence: grab it while the
  # emulator is alive, then tear down.
  if [ "$CAPTURED_LOGCAT" -eq 0 ] && [ -n "$EMU_PID" ] && kill -0 "$EMU_PID" 2>/dev/null; then
    capture_logcat || true
  fi
  teardown
  if [ "$LEAKS_MEASURED" -eq 0 ]; then measure_token_leaks; fi
  write_report
  if [ "$rc" -eq 0 ] && { [ "$FAILED" -ne 0 ] || [ -n "$STOP_REASON" ]; }; then
    rc=1
  fi
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ---------------------------------------------------------------------------
# Small adb helpers
# ---------------------------------------------------------------------------
device_serials() { # serials currently in state `device`
  "$ADB_BIN" devices 2>/dev/null | awk 'NR > 1 && $2 == "device" { print $1 }'
}

adb_shell() { "$ADB_BIN" -s "$SERIAL" shell "$@" 2>/dev/null | tr -d '\r'; }

pid_of_app() { adb_shell pidof "$APP_ID" | awk '{ print $1 }'; }

port_busy() {
  (ss -ltnH 2>/dev/null || netstat -ltn 2>/dev/null) | grep -qE "[:.]$1[[:space:]]"
}

shot() { # file-name
  "$ADB_BIN" -s "$SERIAL" exec-out screencap -p >"$RUN_DIR/$1" 2>/dev/null || true
  artifact "${RUN_DIR#"$ROOT"/}/$1"
}

ui_dump() { # file-name — uiautomator's view of the shell (WebView content is visual here, D1)
  adb_shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
  "$ADB_BIN" -s "$SERIAL" exec-out cat /sdcard/ui.xml >"$RUN_DIR/$1" 2>/dev/null || true
  artifact "${RUN_DIR#"$ROOT"/}/$1"
}

# ---------------------------------------------------------------------------
# DevTools (D3)
# ---------------------------------------------------------------------------
devtools_target_path() {
  curl -fsS --max-time 3 "http://127.0.0.1:$DPORT/json" 2>/dev/null | node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      let list;
      try { list = JSON.parse(raw); } catch { process.exit(1); }
      if (!Array.isArray(list)) process.exit(1);
      const page = list.find((t) => String(t.url || "").includes("android_asset/public/index.html"))
        || list.find((t) => t.type === "page");
      if (!page || !page.webSocketDebuggerUrl) process.exit(1);
      const url = new URL(page.webSocketDebuggerUrl);
      process.stdout.write(url.pathname);
    });
  '
}

setup_devtools() { # 0 = CDP reachable on WSURL
  local sock="" path="" i
  for i in $(seq 1 40); do
    sock=$(adb_shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | head -1)
    [ -n "$sock" ] && break
    sleep 1
  done
  if [ -z "$sock" ]; then
    say "devtools: no webview_devtools_remote socket on the device"
    return 1
  fi
  "$ADB_BIN" -s "$SERIAL" forward --remove "tcp:$DPORT" >/dev/null 2>&1 || true
  "$ADB_BIN" -s "$SERIAL" forward "tcp:$DPORT" "localabstract:$sock" >/dev/null 2>&1 || {
    say "devtools: adb forward failed for $sock"
    return 1
  }
  for i in $(seq 1 20); do
    if path=$(devtools_target_path); then
      WSURL="ws://127.0.0.1:$DPORT$path"
      DEVTOOLS=1
      say "devtools: $sock -> $path"
      return 0
    fi
    sleep 1
  done
  say "devtools: forwarded $sock but /json listed no page"
  return 1
}

cdp_eval() { # expression -> {"ok":true,"value":…} | {"ok":false,"error":…}
  node - "$WSURL" "$1" 2>>"$RUN_DIR/cdp-stderr.txt" <<'NODE'
const [wsUrl, expression] = process.argv.slice(2);
let settled = false;
const finish = (payload) => {
  if (settled) return;
  settled = true;
  process.stdout.write(JSON.stringify(payload));
  if (ws) { try { ws.close(); } catch { /* closing a closed socket is fine */ } }
  process.exit(0);
};
// Never leave with silence: a caller that gets no reply cannot tell "no" from "broken".
process.on('exit', () => {
  if (settled) return;
  settled = true;
  process.stdout.write(JSON.stringify({ ok: false, error: 'node exited with no CDP reply' }));
});
let ws;
try {
  ws = new WebSocket(wsUrl);
} catch (error) {
  finish({ ok: false, error: `construct: ${error}` });
}
// The timer must hold the loop open: an unref'd timer lets node exit while the socket is still
// connecting, which is a silent "no reply" instead of a diagnosable timeout.
setTimeout(() => finish({ ok: false, error: 'cdp timeout' }), 6000);
ws.addEventListener('open', () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true, userGesture: true },
  }));
});
ws.addEventListener('message', (event) => {
  let message;
  try { message = JSON.parse(event.data); } catch { return; }
  if (message.id !== 1) return;
  if (message.error) return finish({ ok: false, error: JSON.stringify(message.error) });
  const result = message.result ?? {};
  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'exception';
    return finish({ ok: false, error: String(text) });
  }
  finish({ ok: true, value: result.result ? result.result.value : null });
});
ws.addEventListener('error', () => finish({ ok: false, error: 'websocket error' }));
ws.addEventListener('close', () => finish({ ok: false, error: 'socket closed before a reply' }));
NODE
}

page_state() { # label — what the WebView document actually contains, as machine evidence
  local label="$1" out="ERR" i
  for i in 1 2 3; do
    out=$(cdp_value '(() => {
    const root = document.getElementById("root");
    const scripts = Array.from(document.scripts).map((s) => s.src);
    const resources = performance.getEntriesByType("resource")
      .map((e) => ({ name: e.name, status: typeof e.responseStatus === "number" ? e.responseStatus : null }));
    return JSON.stringify({
      url: location.href,
      readyState: document.readyState,
      rootHtmlLength: root ? root.innerHTML.length : -1,
      scripts,
      resources,
    });
  })()' 2>/dev/null) || out="ERR"
    [ "$out" != "ERR" ] && break
    sleep 1
  done
  printf '%s\n' "$out" >"$RUN_DIR/$label-page.txt"
  artifact "${RUN_DIR#"$ROOT"/}/$label-page.txt"
  if [ "$out" = "ERR" ]; then
    printf '%s\n' "${CDP_LAST_RAW:-no reply}" >"$RUN_DIR/$label-page-error.txt"
    artifact "${RUN_DIR#"$ROOT"/}/$label-page-error.txt"
    if [ -s "$RUN_DIR/cdp-stderr.txt" ]; then
      cp "$RUN_DIR/cdp-stderr.txt" "$RUN_DIR/$label-cdp-stderr.txt"
      artifact "${RUN_DIR#"$ROOT"/}/$label-cdp-stderr.txt"
    fi
  fi
}

console_echoes() { # label — the WebView's own console lines from logcat (CORS/404/CSP evidence)
  local label="$1"
  "$ADB_BIN" -s "$SERIAL" logcat -d 2>/dev/null | grep -E 'chromium.*CONSOLE' >"$RUN_DIR/$label-console.txt" || true
  artifact "${RUN_DIR#"$ROOT"/}/$label-console.txt"
}

cdp_value() { # expression -> stringified value (or ERR); the raw reply lands in CDP_LAST_RAW
  local out
  out=$(cdp_eval "$1" 2>/dev/null) || { CDP_LAST_RAW="cdp_eval exited non-zero"; printf 'ERR'; return 0; }
  CDP_LAST_RAW="$out"
  node -e '
    let o; try { o = JSON.parse(process.argv[1]); } catch { process.stdout.write("ERR"); process.exit(0); }
    if (!o.ok) { process.stdout.write("ERR"); process.exit(0); }
    process.stdout.write(String(o.value));
  ' "$out"
}

js_present() { # selector
  cdp_value "document.querySelector($(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1")) !== null"
}

# Paired/unpaired is read from two page facts, because the packet's `remote-nav` / screen ids render
# in both states: the pairing plate is present only while this tab holds no session, and the
# instrument strip prints the session's endpoint host only while one exists (`BenchStrip`).
#   paired   — no `remote-pair-submit`, strip shows the loopback daemon host
#   unpaired — the plate is showing and the strip shows no endpoint
PAIRED_STATE_JS='(() => {
  const plate = document.querySelector("[data-testid=\"remote-pair-submit\"]") !== null;
  const strip = document.querySelector("[data-testid=\"remote-strip\"]");
  const host = strip ? strip.textContent.includes("127.0.0.1") : false;
  if (plate) return "unpaired";
  if (host) return "paired";
  return "unknown";
})()'

paired_state() { cdp_value "$PAIRED_STATE_JS"; }

# 0 = the wanted state, 1 = it never came, 2 = CDP itself is broken (four empty replies in a row).
poll_state() { # want timeout-seconds
  local want="$1" limit="$2" i errs=0 value
  for i in $(seq 1 $((limit * 2))); do
    value=$(paired_state)
    [ "$value" = "$want" ] && return 0
    if [ "$value" = "ERR" ]; then
      errs=$((errs + 1))
      [ "$errs" -ge 4 ] && return 2
    else
      errs=0
    fi
    sleep 0.5
  done
  return 1
}

poll_js() { # selector timeout-seconds -> 0 present, 1 absent, 2 CDP broken
  local selector="$1" limit="$2" i errs=0 value
  for i in $(seq 1 $((limit * 2))); do
    value=$(js_present "$selector")
    [ "$value" = "true" ] && return 0
    if [ "$value" = "ERR" ]; then
      errs=$((errs + 1))
      [ "$errs" -ge 4 ] && return 2
    else
      errs=0
    fi
    sleep 0.5
  done
  return 1
}

# ---------------------------------------------------------------------------
# Preflight (packet step 1; read-only)
# ---------------------------------------------------------------------------
preflight() {
  local adb_version emu_version avds devices_before java_version kvm mem_gb disk_gb
  adb_version="$("$ADB_BIN" version 2>&1 | head -1 | tr -d '\r')"
  emu_version="$("$EMULATOR_BIN" -version 2>&1 | head -1 | tr -d '\r')"
  avds="$("$EMULATOR_BIN" -list-avds 2>/dev/null | paste -sd, -)"
  devices_before="$(device_serials | paste -sd, -)"
  java_version="$(java -version 2>&1 | head -1 | tr -d '\r')"
  kvm="$([ -e /dev/kvm ] && printf present || printf absent)"
  mem_gb="$(free -g 2>/dev/null | awk '/^Mem:/ { print $7 }')"
  disk_gb="$(df -BG --output=avail "$ROOT" 2>/dev/null | tail -1 | tr -dc '0-9')"
  PREFLIGHT_JSON=$(printf '{"adb":"%s","emulator":"%s","avds":"%s","devicesBefore":"%s","java":"%s","kvm":"%s","memAvailableGb":%s,"diskAvailableGb":%s}' \
    "$(json_escape "$adb_version")" "$(json_escape "$emu_version")" "$(json_escape "$avds")" \
    "$(json_escape "$devices_before")" "$(json_escape "$java_version")" "$kvm" "${mem_gb:-0}" "${disk_gb:-0}")
  say "preflight: $adb_version | $emu_version | avds=$avds | devices='${devices_before}' | $java_version | kvm=$kvm | mem=${mem_gb}GB | disk=${disk_gb}GB"

  if ! printf ',%s,' ",$avds," | grep -q ",$AVD,"; then
    stop "AVD '$AVD' is not in \`emulator -list-avds\` ($avds)"
    return 1
  fi
  if [ -n "$devices_before" ]; then
    stop "adb devices already lists a device ('$devices_before'); refusing to touch it (packet STOP rule)"
    return 1
  fi
  if [ "${mem_gb:-0}" -lt 6 ]; then
    stop "only ${mem_gb}GB of available RAM (packet requires >= 6GB)"
    return 1
  fi
  if [ "${disk_gb:-0}" -lt 10 ]; then
    stop "only ${disk_gb}GB free disk (packet requires >= 10GB)"
    return 1
  fi
  if [ "$kvm" != "present" ]; then
    stop "/dev/kvm is absent; the emulator cannot be hardware-accelerated"
    return 1
  fi
  # The daemon this run starts lives on the host ports; a foreign listener there is never killed,
  # so the run moves its own daemon and lets `adb reverse` keep the page's 8765/8766 unchanged.
  if port_busy "$HOST_HTTP_PORT" || port_busy "$HOST_WS_PORT"; then
    HOST_HTTP_PORT=18765
    HOST_WS_PORT=18766
    if port_busy "$HOST_HTTP_PORT" || port_busy "$HOST_WS_PORT"; then
      stop "host ports $HOST_HTTP_PORT/$HOST_WS_PORT are also listening; no free slot for this run's daemon"
      return 1
    fi
    say "host ports 8765/8766 are taken by a foreign listener; this run's daemon uses $HOST_HTTP_PORT/$HOST_WS_PORT with adb reverse 8765->$HOST_HTTP_PORT, 8766->$HOST_WS_PORT"
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Daemon (packet step 3; D4/D5)
# ---------------------------------------------------------------------------
start_daemon() {
  local daemon_bin="$ROOT/target/debug/warshad" cfg="$RUN_DIR/cfg/config.toml" i
  if [ ! -x "$daemon_bin" ]; then
    say "warshad binary missing; building it (packet step 3)"
    (cd "$ROOT" && cargo build -p warshad --bin warshad) >>"$SCRIPT_LOG" 2>&1 || {
      stop "cargo build -p warshad failed; see ${SCRIPT_LOG#"$ROOT"/}"
      return 1
    }
  fi
  env \
    XDG_CONFIG_HOME="$RUN_DIR/home/.config" \
    XDG_DATA_HOME="$RUN_DIR/home/.local/share" \
    XDG_CACHE_HOME="$RUN_DIR/home/.cache" \
    XDG_STATE_HOME="$RUN_DIR/home/.local/state" \
    WARSHA_DATA_DIR="$RUN_DIR/data" \
    "$daemon_bin" --foreground --config "$cfg" --http-port "$HOST_HTTP_PORT" --ws-port "$HOST_WS_PORT" \
    >>"$DAEMON_LOG" 2>&1 &
  DAEMON_PID=$!
  artifact "${DAEMON_LOG#"$ROOT"/}"
  for i in $(seq 1 120); do
    if curl -fsS --max-time 2 "http://127.0.0.1:$HOST_HTTP_PORT/health" >/dev/null 2>&1; then
      cmd_entry "curl -fsS http://127.0.0.1:$HOST_HTTP_PORT/health" 0
      break
    fi
    kill -0 "$DAEMON_PID" 2>/dev/null || break
    sleep 0.5
  done
  if ! curl -fsS --max-time 2 "http://127.0.0.1:$HOST_HTTP_PORT/health" >/dev/null 2>&1; then
    cmd_entry "curl -fsS http://127.0.0.1:$HOST_HTTP_PORT/health" 1
    stop "daemon did not answer /health on 127.0.0.1:$HOST_HTTP_PORT"
    return 1
  fi
  for i in $(seq 1 40); do
    [ -s "$cfg" ] && break
    sleep 0.25
  done
  TOK=$(sed -n 's/^auth_token *= *"\([^"]*\)".*/\1/p' "$cfg" | head -1)
  if [ -z "$TOK" ]; then
    stop "the daemon config at ${cfg#"$ROOT"/} carries no auth_token to pair with"
    return 1
  fi
  say "daemon up on 127.0.0.1:$HOST_HTTP_PORT/$HOST_WS_PORT (token held in memory, never printed)"
  return 0
}

# ---------------------------------------------------------------------------
# Emulator (packet step 4; D5/D6)
# ---------------------------------------------------------------------------
boot_emulator() {
  local flags=(-avd "$AVD" -no-window -no-audio -no-boot-anim -no-snapshot
    -gpu swiftshader_indirect -accel on)
  # D5/D6: only Pixel_7_API_35 is wiped; Athar_GPlay may hold owner state.
  if [ "$AVD" = "Pixel_7_API_35" ]; then
    flags+=(-wipe-data)
  fi
  say "emulator: ${flags[*]}"
  "$EMULATOR_BIN" "${flags[@]}" >"$EMULATOR_LOG" 2>&1 &
  EMU_PID=$!
  artifact "${EMULATOR_LOG#"$ROOT"/}"
  if ! timeout 120 "$ADB_BIN" -s "$SERIAL" wait-for-device >/dev/null 2>&1; then
    stop "emulator did not register as $SERIAL within 120s; stderr tail: $(tail -3 "$EMULATOR_LOG" | tr '\n' ' ')"
    return 1
  fi
  local serials; serials="$(device_serials | paste -sd, -)"
  if [ "$serials" != "$SERIAL" ]; then
    stop "adb devices lists '$serials' but this run started/expects only '$SERIAL' (packet STOP rule)"
    return 1
  fi
  local booted="" i
  for i in $(seq 1 240); do
    booted=$(adb_shell getprop sys.boot_completed)
    [ "$booted" = "1" ] && break
    kill -0 "$EMU_PID" 2>/dev/null || break
    sleep 1
  done
  if [ "$booted" != "1" ]; then
    stop "sys.boot_completed never reached 1 within 240s; emulator stderr tail: $(tail -3 "$EMULATOR_LOG" | tr '\n' ' ')"
    return 1
  fi
  say "emulator booted ($AVD) as $SERIAL"
  adb_shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
  adb_shell wm dismiss-keyguard >/dev/null 2>&1 || true
  for setting in window_animation_scale transition_animation_scale animator_duration_scale; do
    adb_shell settings put global "$setting" 0 >/dev/null 2>&1 || true
  done
  return 0
}

# ---------------------------------------------------------------------------
# Install + deep links
# ---------------------------------------------------------------------------
prepare_device() {
  local rc=0 apk="$OUT_BASE/app-debug.apk" src="$ROOT/apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk"
  if [ -f "$src" ] && { [ ! -f "$apk" ] || [ "$src" -nt "$apk" ]; }; then
    cp "$src" "$apk"
    say "APK copied to ${apk#"$ROOT"/}"
  fi
  if [ ! -f "$apk" ]; then
    stop "no debug APK: ${apk#"$ROOT"/} is absent and the Gradle output does not exist (run packet step 2)"
    return 1
  fi
  artifact "${apk#"$ROOT"/}"
  "$ADB_BIN" -s "$SERIAL" reverse "tcp:$HTTP_PORT" "tcp:$HOST_HTTP_PORT" >/dev/null 2>&1 || rc=1
  "$ADB_BIN" -s "$SERIAL" reverse "tcp:$WS_PORT" "tcp:$HOST_WS_PORT" >/dev/null 2>&1 || rc=1
  if [ "$rc" -ne 0 ]; then
    stop "adb reverse of $HTTP_PORT/$WS_PORT failed (D2 pairing transport unavailable)"
    return 1
  fi
  cmd_entry "adb -s $SERIAL reverse tcp:8765 tcp:$HOST_HTTP_PORT + tcp:8766 tcp:$HOST_WS_PORT" 0
  say "adb reverse: $(adb_shell cat /dev/null >/dev/null 2>&1; "$ADB_BIN" -s "$SERIAL" reverse --list | tr '\n' ' ')"
  # D6: Athar_GPlay is uninstalled first so the launch under test is a genuine first launch.
  if [ "$AVD" != "Pixel_7_API_35" ]; then
    "$ADB_BIN" -s "$SERIAL" uninstall "$APP_ID" >/dev/null 2>&1 || true
    say "uninstalled $APP_ID so this run starts clean"
  fi
  local out rc_install
  out=$("$ADB_BIN" -s "$SERIAL" install -r "$apk" 2>&1 | tr -d '\r')
  rc_install=$?
  cmd_entry "adb -s $SERIAL install -r target/r-ui-5/app-debug.apk" "$rc_install"
  if [ "$rc_install" -ne 0 ] || ! printf '%s' "$out" | grep -q 'Success'; then
    stop "adb install failed: $out"
    return 1
  fi
  "$ADB_BIN" -s "$SERIAL" logcat -c >/dev/null 2>&1 || true
  say "installed ${apk#"$ROOT"/}"
  return 0
}

launch_view_intent() { # uri label — prints adb's exit code; output is redacted into the run dir
  local uri="$1" label="$2" out rc=0
  out=$("$ADB_BIN" -s "$SERIAL" shell am start -W -a android.intent.action.VIEW -d "$uri" "$APP_ID" 2>&1 | tr -d '\r') || rc=$?
  {
    printf '$ adb shell am start -W -a android.intent.action.VIEW -d <pairing-uri redacted> %s\n' "$APP_ID"
    redact "$out"
    printf '\n'
  } >"$RUN_DIR/$label.txt"
  artifact "${RUN_DIR#"$ROOT"/}/$label.txt"
  cmd_entry "adb -s $SERIAL shell am start -W -a android.intent.action.VIEW -d warsha://pair <redacted> $APP_ID" "$rc"
  printf '%s' "$rc"
}

# ---------------------------------------------------------------------------
# Logcat / token gate (packet step 11)
# ---------------------------------------------------------------------------
capture_logcat() {
  CAPTURED_LOGCAT=1
  "$ADB_BIN" -s "$SERIAL" logcat -d >"$LOGACT" 2>/dev/null || true
  artifact "${LOGACT#"$ROOT"/}"
  "$ADB_BIN" -s "$SERIAL" logcat -d -b crash >"$RUN_DIR/logcat-crash.txt" 2>/dev/null || true
  artifact "${RUN_DIR#"$ROOT"/}/logcat-crash.txt"
  # A console capture taken mid-run can race the WebView's own buffered console lines; the logcat
  # now on disk is the authority, so an empty capture is refilled from it.
  local f
  for f in "$RUN_DIR"/*-console.txt; do
    [ -e "$f" ] || continue
    [ -s "$f" ] && continue
    grep -E 'chromium.*CONSOLE' "$LOGACT" >"$f" 2>/dev/null || true
  done
  ui_dump "s-final-ui.xml"
}

measure_token_leaks() {
  local files=("$LOGACT" "$DAEMON_LOG" "$SCRIPT_LOG" "$RUN_DIR/logcat-crash.txt")
  local f count total=0
  TOKEN_SOURCES=()
  if [ -z "$TOK" ]; then
    LEAKS_MEASURED=1
    return 0
  fi
  for f in "${files[@]}"; do
    [ -f "$f" ] || continue
    count=$(grep -F -c -- "$TOK" "$f" 2>/dev/null || true)
    count="${count:-0}"
    total=$((total + count))
    if [ "$count" -ne 0 ]; then
      TOKEN_SOURCES+=("{\"file\":\"$(json_escape "${f#"$ROOT"/}")\",\"lines\":$count}")
    fi
  done
  TOKEN_LEAKS=$total
  LEAKS_MEASURED=1
}

# ---------------------------------------------------------------------------
# The smoke
# ---------------------------------------------------------------------------
run_smoke() {
  preflight || return 1
  start_daemon || return 1
  boot_emulator || return 1
  prepare_device || return 1

  # ---- S1: boot -----------------------------------------------------------
  local s1_out="" s1_pid="" s1_rc=0
  s1_out=$("$ADB_BIN" -s "$SERIAL" shell am start -W -n "$ACTIVITY" 2>&1 | tr -d '\r') || s1_rc=$?
  redact "$s1_out" >"$RUN_DIR/s1-start.txt"
  artifact "${RUN_DIR#"$ROOT"/}/s1-start.txt"
  cmd_entry "adb -s $SERIAL shell am start -W -n $ACTIVITY" "$s1_rc"
  sleep 5
  s1_pid="$(pid_of_app)"
  shot "s1-boot.png"
  local s1_mode="visual" s1_note=""
  if printf '%s' "$s1_out" | grep -q 'Status: ok' && [ -n "$s1_pid" ]; then
    s1_note="start Status: ok; pid $s1_pid alive after 5s"
  else
    s1_note="start output lacks 'Status: ok' or no pid (rc=$s1_rc, pid='${s1_pid}')"
    step S1 0 visual "$s1_note"
    stop "the app did not start cleanly; capture only, no product edit (packet STOP rule)"
    return 1
  fi

  if setup_devtools; then
    s1_mode="devtools"
    local s1_poll=0
    poll_js '[data-testid="remote-pair-submit"]' 20 || s1_poll=$?
    if [ "$s1_poll" -eq 0 ]; then
      s1_note="$s1_note; pairing plate present"
      step S1 1 "$s1_mode" "$s1_note"
    elif [ "$s1_poll" -eq 2 ]; then
      # DevTools answered /json but not one evaluate. That is D3's unreachable case: the screenshot
      # is appearance-only evidence and cannot itself prove the plate rendered, so this is reported
      # as a visual FAIL rather than a silent green.
      page_state s1
      console_echoes s1
      ui_dump "s1-ui.xml"
      s1_note="$s1_note; devtools reached but CDP evaluate never answered; appearance-only, plate not proven (s1-boot.png)"
      step S1 0 visual "$s1_note"
      stop "the pairing plate could not be proven on boot (finding, not a repair task)"
      return 1
    else
      page_state s1
      console_echoes s1
      s1_note="$s1_note; pairing plate NOT found via devtools (s1-page.txt / s1-console.txt)"
      step S1 0 "$s1_mode" "$s1_note"
      stop "the pairing plate did not render on boot (finding, not a repair task)"
      return 1
    fi
  else
    # D3 fallback: the visual result is reported as visual and is allowed to pass only as appearance.
    s1_note="$s1_note; devtools unreachable so the plate is asserted visually (screenshot)"
    step S1 1 visual "$s1_note"
  fi

  # ---- S2: cold deep link -------------------------------------------------
  adb_shell am force-stop "$APP_ID" >/dev/null 2>&1 || true
  local s2_rc s2_note="" s2_state=""
  s2_rc=$(launch_view_intent "warsha://pair?host=127.0.0.1\&port=$HTTP_PORT\&token=$TOK" "s2-start")
  if [ "$DEVTOOLS" -eq 1 ] && setup_devtools; then
    local s2_wait=0
    poll_state paired 15 || s2_wait=$?
    s2_state=$(paired_state)
    shot "s2-paired.png"
    ui_dump "s2-ui.xml"
    if [ "$s2_wait" -eq 2 ] || [ "$s2_state" = "ERR" ]; then
      s2_note="devtools reached but CDP evaluate never answered: the pairing assertion is NOT machine-verified"
      step S2 0 devtools "$s2_note"
      stop "CDP never answered, so the S2 pairing assertion cannot be met (packet D3/gate rule)"
      return 1
    fi
    if [ "$s2_state" = "paired" ] && { poll_js '[data-testid="remote-screen-needs-you"]' 5 || poll_js '[data-testid="remote-screen-projects"]' 5; }; then
      s2_note="cold warsha://pair paired (plate gone, strip shows the loopback daemon) and the bench rendered"
      step S2 1 devtools "$s2_note"
    else
      s2_note="cold warsha://pair did not reach a paired bench within 15s (state=$s2_state, rc=$s2_rc)"
      step S2 0 devtools "$s2_note"
      stop "pairing against a correct deep link failed (finding, not a repair task)"
      return 1
    fi
  else
    s2_state=$(paired_state)
    s2_note="devtools unreachable: the pairing assertion is NOT machine-verified (visual evidence only, state=$s2_state)"
    step S2 0 visual "$s2_note"
    stop "DevTools unreachable, so the S2 pairing assertion cannot be met (packet D3/gate rule)"
    return 1
  fi

  # ---- S3: warm deep link -------------------------------------------------
  local pid_before pid_after s3_note s3_ok=1 s3_state=""
  pid_before="$(pid_of_app)"
  launch_view_intent "warsha://pair?host=127.0.0.1\&port=$HTTP_PORT\&token=$TOK\&warm=1" "s3-start" >/dev/null
  sleep 3
  pid_after="$(pid_of_app)"
  s3_state=$(paired_state)
  shot "s3-warm.png"
  s3_note="pid before=$pid_before after=$pid_after state=$s3_state"
  if [ -z "$pid_before" ] || [ "$pid_before" != "$pid_after" ]; then
    s3_ok=0
    s3_note="$s3_note; the process changed or died (singleTask/onNewIntent regression)"
  fi
  if [ "$s3_state" != "paired" ]; then
    s3_ok=0
    s3_note="$s3_note; the bench is not paired after the warm link"
  fi
  if [ "$s3_ok" -eq 1 ]; then
    step S3 1 devtools "$s3_note"
  else
    step S3 0 devtools "$s3_note"
  fi

  # ---- S4: core screens ---------------------------------------------------
  local route_test_id route_shot route rc_js
  for spec in \
    "/projects|remote-screen-projects|s4-projects.png" \
    "/run|remote-screen-run|s4-run.png" \
    "/gates|remote-screen-gates|s4-gates.png" \
    "/|remote-screen-needs-you|s4-needs-you.png" \
    "/settings|remote-screen-settings|s4-settings.png"; do
    IFS='|' read -r route route_test_id route_shot <<<"$spec"
    rc_js=$(cdp_value "(() => { const links = Array.from(document.querySelectorAll('[data-testid=\"remote-nav\"] a')); const link = links.find((a) => a.getAttribute('href') === '$route'); if (!link) return 'missing-anchor'; link.click(); return 'clicked'; })()")
    sleep 1
    shot "$route_shot"
    local screen_ok=1 note="route $route via nav click ($rc_js)"
    if [ "$rc_js" != "clicked" ]; then
      screen_ok=0
      note="$note; nav anchor for $route not found"
    elif poll_js "[data-testid=\"$route_test_id\"]" 5; then
      note="$note; $route_test_id rendered"
    else
      screen_ok=0
      note="$note; $route_test_id did not render within 5s"
    fi
    if [ "$(js_present '[data-testid="remote-session-ended"]')" = "true" ]; then
      screen_ok=0
      note="$note; the session-ended plate appeared"
    fi
    if [ "$screen_ok" -eq 1 ]; then
      step "S4$route" 1 devtools "$note"
    else
      step "S4$route" 0 devtools "$note"
    fi
  done

  # ---- S5: public cleartext host is refused -------------------------------
  local s5_ok=1 s5_note="" s5_state=""
  adb_shell am force-stop "$APP_ID" >/dev/null 2>&1 || true
  launch_view_intent "warsha://pair?host=8.8.8.8\&token=x" "s5-start" >/dev/null
  poll_state unpaired 10 || true
  s5_state=$(paired_state)
  shot "s5-refusal.png"
  ui_dump "s5-ui.xml"
  if [ "$s5_state" != "unpaired" ]; then
    s5_ok=0
    s5_note="the bench is not in the unpaired state after the bad deep link (state=$s5_state)"
  fi
  # The refusal sentence itself is rendered by the plate's submit path, so submit the same link there:
  # the native deep-link path refuses silently by design (`App.tsx` ignores `pair()`'s failure), and the
  # sentence the owner reads is the plate's own. Both parts must hold: no session, and a stated reason.
  local fill_result
  fill_result=$(cdp_value "(() => {
    const input = document.querySelector('input');
    const submit = document.querySelector('[data-testid=\"remote-pair-submit\"]');
    if (!input || !submit) return 'missing-form';
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'warsha://pair?host=8.8.8.8&token=x');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    submit.click();
    return 'submitted';
  })()")
  sleep 1
  shot "s5-plate-refusal.png"
  local err_text
  err_text=$(cdp_value "(() => { const e = document.querySelector('.w-field__error'); return e ? e.textContent.trim() : ''; })()")
  if [ "$fill_result" != "submitted" ] || [ -z "$err_text" ]; then
    s5_ok=0
    s5_note="$s5_note; the plate showed no refusal sentence (submit=$fill_result)"
  elif ! printf '%s' "$err_text" | grep -q 'http'; then
    s5_ok=0
    s5_note="$s5_note; the refusal sentence is not the address-policy one"
  fi
  if [ "$(paired_state)" = "paired" ]; then
    s5_ok=0
    s5_note="$s5_note; the plate submit paired against the public host (it must refuse)"
  fi
  if [ -z "$(pid_of_app)" ]; then
    s5_ok=0
    s5_note="$s5_note; the process died during the refusal"
  fi
  if [ "$s5_ok" -eq 1 ]; then
    step S5 1 devtools "${s5_note:-public cleartext host refused; no session; reason shown; process alive}"
  else
    step S5 0 devtools "$s5_note"
  fi

  # ---- Logcat + token gate ------------------------------------------------
  capture_logcat
  local crash_buffer fatal_lines
  crash_buffer=$(grep -c . "$RUN_DIR/logcat-crash.txt" 2>/dev/null || true)
  crash_buffer="${crash_buffer:-0}"
  fatal_lines=$(grep -E -c 'FATAL EXCEPTION|ANR in dev\.warsha|Process: dev\.warsha\.remote.*died' "$LOGACT" 2>/dev/null || true)
  fatal_lines="${fatal_lines:-0}"
  CRASHES=$((crash_buffer + fatal_lines))
  measure_token_leaks
  if [ "$CRASHES" -eq 0 ] && [ "$TOKEN_LEAKS" -eq 0 ]; then
    step LOG 1 devtools "no crash-buffer lines, no FATAL/ANR lines, no token in logcat/daemon/script logs"
  else
    step LOG 0 devtools "crashes=$CRASHES (crash-buffer lines $crash_buffer, fatal/anr $fatal_lines), tokenLeaks=$TOKEN_LEAKS"
  fi

  if [ "$FAILED" -eq 0 ] && [ -z "$STOP_REASON" ] && [ "$CRASHES" -eq 0 ] && [ "$TOKEN_LEAKS" -eq 0 ]; then
    VERDICT="T3 smoke passed on $AVD"
  else
    VERDICT="T3 smoke FAILED on $AVD (failed=$FAILED crashes=$CRASHES tokenLeaks=$TOKEN_LEAKS)"
  fi
  return 0
}

say "R-UI-5 T3 Android smoke: avd=$AVD report=${REPORT#"$ROOT"/} serial=$SERIAL"
run_smoke || true
if [ -n "$STOP_REASON" ]; then
  VERDICT="STOP: $STOP_REASON"
fi
say "verdict: ${VERDICT:-smoke finished}"
