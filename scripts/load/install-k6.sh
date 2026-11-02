#!/usr/bin/env bash
# Install official k6 into this WSL userland from the official grafana/k6 release
# archive, verified against that release's own SHA-256 file. No-op when k6 is present.
set -euo pipefail

if command -v k6 >/dev/null 2>&1; then
  echo "k6 already installed: $(k6 version | head -1)"
  exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

API=https://api.github.com/repos/grafana/k6/releases/latest
TAG=$(curl -fsSL --max-time 30 "$API" | grep -o '"tag_name": *"[^"]*"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
[ -n "$TAG" ] || { echo "could not read the latest k6 tag from $API" >&2; exit 1; }

ARCHIVE=k6-$TAG-linux-amd64.tar.gz
SUMS=k6-$TAG-checksums.txt
BASE=https://github.com/grafana/k6/releases/download/$TAG

curl -fsSL --max-time 300 -o "$TMP/$ARCHIVE" "$BASE/$ARCHIVE"
curl -fsSL --max-time 60 -o "$TMP/$SUMS" "$BASE/$SUMS"

grep -F "$ARCHIVE" "$TMP/$SUMS" > "$TMP/one.sum"
[ -s "$TMP/one.sum" ] || { echo "$ARCHIVE is not listed in $SUMS" >&2; exit 1; }
(cd "$TMP" && sha256sum -c one.sum)

tar -xzf "$TMP/$ARCHIVE" -C "$TMP"
BIN=$(find "$TMP" -type f -name k6 -perm -u+x | head -1)
[ -n "$BIN" ] || { echo "k6 binary not found in archive" >&2; exit 1; }

install -m 0755 "$BIN" /usr/local/bin/k6
echo "installed: $(k6 version | head -1)"
