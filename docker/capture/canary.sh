#!/usr/bin/env bash
set -euo pipefail
PROJECT="remote"
SPEC="apps/remote/e2e/bench.visual.spec.ts"
D1="target/canary_1"
D2="target/canary_2"

docker run --rm -v "$(pwd):/app" -w /app warsha-capture:0.3.0 rm -rf target/canary_1 target/canary_2
mkdir -p target/canary_1 target/canary_2

# Run captures (ignoring exit code for tests as they might fail on baselines)
./docker/capture/capture.sh "$PROJECT" "$SPEC" "$D1" || true
./docker/capture/capture.sh "$PROJECT" "$SPEC" "$D2" || true

COUNT1=$(find "$D1" -name "*-actual.png" | wc -l)
COUNT2=$(find "$D2" -name "*-actual.png" | wc -l)
echo "Compared count: $COUNT1"

if [ "$COUNT1" -eq 0 ] || [ "$COUNT1" -ne "$COUNT2" ]; then
    echo "Fail: Count mismatch or zero captures."
    exit 1
fi

for f1 in $(find "$D1" -name "*-actual.png"); do
    f2="$D2/${f1#$D1/}"
    if ! cmp -s "$f1" "$f2"; then
        echo "Mismatch: $f1 vs $f2"
        exit 1
    fi
done
echo "Canary passed: $COUNT1 PNGs are byte-identical."
