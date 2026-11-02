#!/usr/bin/env bash
# Prove the staging lane left no plaintext pairing material on disk (S1c N-1).
#
# Three separate facts, because "no plaintext pairing file" can fail in three ways:
#  1. a standalone pairings file exists;
#  2. the daemon's store holds a pairing row (whose `secret` column is plain TEXT);
#  3. the binary will open a plaintext pairings input at all.
# The scan runs before the probe, and the probe works in a throwaway directory so it
# cannot contaminate the lane being measured.
#
# Usage: bash scripts/load/check-pairings.sh <state-dir> <warshad-binary>
set -uo pipefail

STATE=${1:?usage: check-pairings.sh <state-dir> <warshad-bin>}
BIN=${2:?usage: check-pairings.sh <state-dir> <warshad-bin>}

echo '=== files the daemon left in its state dir ==='
printf 'file\tbytes\tkind\n'
find "$STATE" -mindepth 1 -maxdepth 1 -printf '%P\t%s\t%y\n' | sort

printf '\ns1c\tpairing_named_files_in_state_dir\t%s\n' "$(find "$STATE" -iname '*pairing*' | wc -l)"
printf 's1c\tstate_dir_file_count\t%s\n' "$(find "$STATE" -type f | wc -l)"
# Permissions matter as much as presence: the config file is the one artifact that does
# hold a credential, and it must not be world-readable.
printf 's1c\tconfig_file_mode\t%s\n' "$(stat -c '%a' "$STATE/config.toml" 2>/dev/null || echo missing)"

echo
echo '=== pairing rows in the daemon store ==='
# The `secret` column is TEXT, so a stored pairing would be readable in the clear.
# Counting rows is the honest version of a text search, which also matches the schema.
python3 - "$STATE/warsha.db" <<'PY'
import sqlite3, sys
db = sys.argv[1]
try:
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "pairing_devices" not in tables:
        print("s1c\tdb_pairing_table_present\t0")
        print("s1c\tdb_pairing_rows\tno-table")
        print("s1c\tdb_pairing_rows_with_secret\tno-table")
    else:
        rows = con.execute("SELECT COUNT(*) FROM pairing_devices").fetchone()[0]
        with_secret = con.execute(
            "SELECT COUNT(*) FROM pairing_devices WHERE secret IS NOT NULL AND secret <> ''"
        ).fetchone()[0]
        print("s1c\tdb_pairing_table_present\t1")
        print(f"s1c\tdb_pairing_rows\t{rows}")
        print(f"s1c\tdb_pairing_rows_with_secret\t{with_secret}")
except Exception as exc:  # an unreadable store is a finding, not a silent pass
    print(f"s1c\tdb_pairing_rows\tunreadable: {exc}")
PY

echo
echo '=== does the daemon expose a plaintext pairings input? ==='
printf 's1c\thelp_advertises_pairings_flag\t%s\n' \
  "$("$BIN" --help 2>&1 | grep -c -- '--pairings')"

# A deliberately plaintext pairings file with an inert value. Nothing here is a real
# credential; the point is only whether the binary agrees to open it.
PROBE=$(mktemp -d)
trap 'rm -rf "$PROBE"' EXIT
cat >"$PROBE/pairings.json" <<'EOF'
[{ "device_id": "00000000-0000-0000-0000-000000000000", "secret": "inert-probe-value-not-a-credential", "created_at": "2026-01-01T00:00:00Z", "revoked": false }]
EOF
printf 'auth_token = "probe-token-not-a-credential"\ndata_dir = "%s"\nsocket_path = "%s/warshad.sock"\nhttp_port = 39997\nws_port = 39998\n' \
  "$PROBE" "$PROBE" >"$PROBE/config.toml"
chmod 600 "$PROBE/config.toml"

echo
echo '=== probe: start the daemon pointed at that plaintext file ==='
PROBE_OUT=$(timeout 20 "$BIN" --config "$PROBE/config.toml" --pairings "$PROBE/pairings.json" \
  --http-port 39997 --ws-port 39998 --foreground 2>&1)
PROBE_RC=$?
printf 's1c\tpairings_probe_exit\t%s\n' "$PROBE_RC"
printf 's1c\tpairings_probe_listener_lines\t%s\n' "$(printf '%s' "$PROBE_OUT" | grep -c 'server listening on')"
echo '--- first lines of the probe output ---'
printf '%s\n' "$PROBE_OUT" | head -6
# A daemon that reached its listener line read the file; `timeout` gives 124 in that
# case, so the listener count, not the exit code, is the verdict.
if [ "$(printf '%s' "$PROBE_OUT" | grep -c 'server listening on')" != 0 ]; then
  echo 'S1C-N1-FAIL: the daemon accepted a plaintext pairings file and started.'
else
  echo 'S1C-N1-OK: the daemon refused to start on a plaintext pairings file.'
fi
