#!/usr/bin/env bash
set -euo pipefail
PROJECT=$1
SPEC=$2
OUTPUT_DIR=$3
mkdir -p "$OUTPUT_DIR"
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp/pw-home \
  -v "$(pwd):/app" \
  -w /app \
  -e FONTCONFIG_FILE=/scripts/ci/capture-fontconfig.conf \
  -e NODE_OPTIONS="--dns-result-order=ipv4first" \
  warsha-capture:0.3.0 \
  pnpm exec playwright test --project="$PROJECT" "$SPEC" --output="/app/$OUTPUT_DIR"
