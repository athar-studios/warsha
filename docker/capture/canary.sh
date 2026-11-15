#!/usr/bin/env bash
set -euo pipefail
# This script performs the acceptance gate for the capture host:
# 1. Capture a surface twice in target/.
# 2. Compare the output PNG files byte-for-byte.
# 3. Fail if counts differ or files differ.

PROJECT="remote"
SPEC="apps/remote/e2e/bench.visual.spec.ts"
D1="target/canary_1"
D2="target/canary_2"

# Remove existing root-owned leftovers if any
docker run --rm -v "$(pwd):/app" -w /app warsha-capture:0.3.0 rm -rf target/canary_1 target/canary_2
mkdir -p target/canary_1 target/canary_2

# Run captures
./docker/capture/capture.sh "$PROJECT" "$SPEC" "$D1"
./docker/capture/capture.sh "$PROJECT" "$SPEC" "$D2"

# Count actual PNGs
COUNT1=$(find "$D1" -name "*-actual.png" | wc -l)
COUNT2=$(find "$D2" -name "*-actual.png" | wc -l)

echo "Capture 1 count: $COUNT1"
echo "Capture 2 count: $COUNT2"

if [ "$COUNT1" -eq 0 ] || [ "$COUNT1" -ne "$COUNT2" ]; then
    echo "Fail: Count mismatch or zero captures."
    exit 1
fi

# Compare byte-for-byte (both directions)
for f1 in $(find "$D1" -name "*-actual.png"); do
    f2="$D2/${f1#$D1/}"
    if [ ! -f "$f2" ]; then
        echo "Missing in second capture: $f2"
        exit 1
    fi
    if ! cmp -s "$f1" "$f2"; then
        echo "Mismatch: $f1 vs $f2"
        exit 1
    fi
done

echo "Canary passed: $COUNT1 PNGs are byte-identical."
