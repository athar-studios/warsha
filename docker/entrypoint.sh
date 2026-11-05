#!/usr/bin/env bash
#
# docker/entrypoint.sh — the container's whole configuration surface.
#
# The daemon reads its settings from a config file; the container must not.
# So this script is the only translator between the two: every knob below
# arrives from the environment, and the ONE thing it puts on disk beyond the
# data itself is the 0600 admin-token config written at first start.
#
# Contract (docs/DEPLOY.md section 4):
#   WARSHA_BIND_HOST            default 0.0.0.0 (a container has no loopback
#                               that a phone or a browser can reach; the
#                               public surface is Caddy's, never this)
#   WARSHA_ADVERTISED_HOST      optional; bare host/IP only, REQUIRED for
#                               pairing links while bound to 0.0.0.0
#   WARSHA_HTTP_PORT            default 8765  (HTTP: /health, /events)
#   WARSHA_WS_PORT              default 8766  (JSON-RPC over WS/HTTP POST)
#   WARSHA_DATA_DIR             default /var/lib/warsha (the named volume)
#   WARSHA_LLM_BASE_URL         default https://router.sayl.site/v1
#   WARSHA_LLM_API_KEY          secret; environment-only, never written to
#                               config.toml (containers have no OS keychain,
#                               so the process env IS the secret store here)
#   WARSHA_LLM_MODEL            default bzl/deepseek-v4-flash-0731free
#   WARSHA_ALLOWED_ORIGINS      optional; comma-separated CORS origins
#   WARSHA_BOOTSTRAP_ADMIN_TOKEN optional; adopted only at first boot, then
#                               unset — see the marker file rules below
#
# The admin bearer token, exactly once:
#   * first start (no config.toml): generate a 256-bit token with
#     `openssl rand -hex 32`, or adopt WARSHA_BOOTSTRAP_ADMIN_TOKEN when the
#     operator injected one; write config.toml at 0600; create
#     $WARSHA_DATA_DIR/.bootstrap_token_printed BEFORE printing, so a crash
#     between touch and log can never earn a second printing; print the token
#     to stdout once for `docker compose logs warshad` to capture.
#   * every later start, and every restart of the same container: the marker
#     exists, the token is never printed again, and an injected
#     WARSHA_BOOTSTRAP_ADMIN_TOKEN is ignored — a rotating secret in a log
#     stream is not a secret.

set -euo pipefail

# ---------------------------------------------------------------- defaults
: "${WARSHA_BIND_HOST:=0.0.0.0}"
: "${WARSHA_HTTP_PORT:=8765}"
: "${WARSHA_WS_PORT:=8766}"
: "${WARSHA_DATA_DIR:=/var/lib/warsha}"
: "${WARSHA_LLM_BASE_URL:=https://router.sayl.site/v1}"
: "${WARSHA_LLM_MODEL:=bzl/deepseek-v4-flash-0731free}"
: "${WARSHA_LLM_API_KEY:=}"

CONFIG_FILE="$WARSHA_DATA_DIR/config.toml"
MARKER_FILE="$WARSHA_DATA_DIR/.bootstrap_token_printed"

# ------------------------------------------------------------ arg handling
# An explicit non-flag command (`docker run warshad ... -- shell`) bypasses
# the daemon exec entirely; anything else is passed through as extra daemon
# flags (defensive: the daemon rejects unknown ones and the container exits
# loudly rather than silently ignoring them).
if [ "$#" -gt 0 ] && [ "${1#-}" = "$1" ]; then
    exec "$@"
fi

# ----------------------------------------------------------- data dir gate
if [ ! -d "$WARSHA_DATA_DIR" ]; then
    echo "FATAL: WARSHA_DATA_DIR=$WARSHA_DATA_DIR does not exist; mount the warsha-data volume" >&2
    exit 1
fi
if [ ! -w "$WARSHA_DATA_DIR" ]; then
    echo "FATAL: WARSHA_DATA_DIR=$WARSHA_DATA_DIR is not writable by uid=$(id -u); check the volume ownership and the compose 'user:' setting" >&2
    exit 1
fi

# ------------------------------------------------------ origins for the file
# Comma-separated WARSHA_ALLOWED_ORIGINS becomes a TOML array. The loopback
# dev origins always stay in the list: they are harmless (nothing on the
# Internet can dial 127.0.0.1 of this container) and their absence would
# break an owner who port-forwards for local administration.
origins_toml='["http://localhost:5173", "tauri://localhost", "http://127.0.0.1:5173"]'
if [ -n "${WARSHA_ALLOWED_ORIGINS:-}" ]; then
    split="${WARSHA_ALLOWED_ORIGINS//,/ }"
    built=""
    for o in $split; do
        built+="\"${o}\", "
    done
    built+="\"http://localhost:5173\", \"tauri://localhost\", \"http://127.0.0.1:5173\""
    origins_toml="[$built]"
fi

# ------------------------------------------------------- first-start token
if [ ! -f "$CONFIG_FILE" ]; then
    if [ -n "${WARSHA_BOOTSTRAP_ADMIN_TOKEN:-}" ]; then
        admin_token="$WARSHA_BOOTSTRAP_ADMIN_TOKEN"
        token_source="injected via WARSHA_BOOTSTRAP_ADMIN_TOKEN"
    else
        admin_token="$(openssl rand -hex 32)"
        token_source="generated with openssl rand -hex 32"
    fi
    # An adopted or generated credential has no reason to survive this file
    # write; drop it from the daemon's environment on every path.
    unset WARSHA_BOOTSTRAP_ADMIN_TOKEN || true

    # umask before the redirect so the file is 0600 from its first byte;
    # the chmod is belt-and-braces for filesystems with odd defaults.
    umask 077
    cat > "$CONFIG_FILE" <<EOF
# Written by docker-entrypoint.sh at first start — every value comes from
# the container environment, so delete this file and the volume's token to
# re-run the bootstrap (docs/DEPLOY.md sections 4 and 10).
#
# The provider API key is deliberately NOT stored here: containers have no
# OS keychain, so WARSHA_LLM_API_KEY lives only in the daemon's environment
# (compose reads it from .env, which is never committed).
data_dir = "$WARSHA_DATA_DIR"
socket_path = "$WARSHA_DATA_DIR/warshad.sock"
http_port = $WARSHA_HTTP_PORT
ws_port = $WARSHA_WS_PORT
bind_host = "$WARSHA_BIND_HOST"
auth_token = "$admin_token"
allowed_origins = $origins_toml
EOF
    if [ -n "${WARSHA_ADVERTISED_HOST:-}" ]; then
        printf 'advertised_host = "%s"\n' "$WARSHA_ADVERTISED_HOST" >> "$CONFIG_FILE"
    fi
    chmod 0600 "$CONFIG_FILE"

    if [ ! -f "$MARKER_FILE" ]; then
        touch "$MARKER_FILE"
        echo "================================================================"
        echo " Warsha bootstrap admin token — shown ONCE, now, ever:"
        echo "   source:  $token_source"
        echo "   token:   $admin_token"
        echo "   holder:  $CONFIG_FILE (0600) on the warsha-data volume"
        echo " Save it now (OS keychain / password manager). Restarts and"
        echo " re-creations of the container never print it again:"
        echo " $MARKER_FILE suppresses this block."
        echo "================================================================"
    else
        # Operator deleted config.toml but the marker survived: mint a fresh
        # token for the file, but honour the once-only printing rule.
        echo "WARN: config.toml was absent but .bootstrap_token_printed exists;"
        echo "      generated a new admin token WITHOUT printing it (see docs/DEPLOY.md section 4)."
    fi
fi

# ------------------------------------------------------------ exec the web
# Ports are re-passed as flags on EVERY start: the daemon's clap defaults
# would rewrite the file's ports anyway, so making the flags match the env
# keeps `docker compose up` with a changed .env authoritative for ports,
# while owner edits of the (secret-bearing) bind/advertised/auth fields
# survive restarts untouched.
daemon_args=(
    warshad
    --config "$CONFIG_FILE"
    --foreground
    --http-port "$WARSHA_HTTP_PORT"
    --ws-port "$WARSHA_WS_PORT"
)
# Only override the file's bind choice when the operator EXPLICITLY set it
# (the ENV default in the image makes it set; compose can clear it).
if [ -n "${WARSHA_BIND_HOST:-}" ]; then
    daemon_args+=(--bind-host "$WARSHA_BIND_HOST")
fi
if [ -n "${WARSHA_ADVERTISED_HOST:-}" ]; then
    daemon_args+=(--advertised-host "$WARSHA_ADVERTISED_HOST")
fi

export WARSHA_LLM_BASE_URL WARSHA_LLM_MODEL
if [ -n "$WARSHA_LLM_API_KEY" ]; then
    export WARSHA_LLM_API_KEY
fi

echo "warsha-entrypoint: bind=$WARSHA_BIND_HOST http=$WARSHA_HTTP_PORT rpc=$WARSHA_WS_PORT data=$WARSHA_DATA_DIR remote_assets=${WARSHA_REMOTE_ASSETS_DIR:-unset} llm_base=$WARSHA_LLM_BASE_URL model=$WARSHA_LLM_MODEL key=$( [ -n "$WARSHA_LLM_API_KEY" ] && echo present || echo ABSENT )"

exec "${daemon_args[@]}" "$@"
