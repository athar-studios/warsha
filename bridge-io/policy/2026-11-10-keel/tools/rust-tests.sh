#!/usr/bin/env bash
# KEEL long gate STD.3 — EV/tools/rust-tests.sh
# Runs the full workspace test suite, aggregates per-binary `test result:` lines,
# and prints: KEEL-PASS rust-tests passed=N ignored=M
# Exit 0 only if 0 failed AND ignored <= 10 AND passed >= 759.
set -uo pipefail

WT="${KEEL_WORKTREE:-C:/Users/Dragonfly/Downloads/warsha-wt/keel/k1}"
EV="${KEEL_EV:-C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-10-keel}"
OUT="${KEEL_STD3_LOG:-$EV/gates/STD.3.log}"

cd "$WT" || { echo "rust-tests: worktree not found: $WT" >&2; exit 2; }
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$WT/target}"

mkdir -p "$EV/gates" || exit 2

echo "rust-tests: cwd=$WT CARGO_TARGET_DIR=$CARGO_TARGET_DIR"
cargo test --workspace --no-fail-fast > "$OUT" 2>&1
cargo_rc=$?
echo "rust-tests: cargo exit=$cargo_rc (full output: $OUT)"

# Aggregate the per-*binary* summary lines, i.e. those printed under a
# `Running <target>` section. `Doc-tests <crate>` sections are counted
# separately and reported for transparency, but excluded from N/M/F:
# the frozen expectation is `ignored=10`, which is exactly the 10 `#[ignore]`
# attributes audited by STD.11 (`ignore-now=10 base=10`). Doc fences such as
# `rust,ignore` in warsha-store persistence.rs:343 pre-exist at BASE and are
# not part of the test-binary skip budget.
#   test result: ok. 759 passed; 0 failed; 10 ignored; 0 measured; 0 filtered out
stats=$(awk '
  /^ *(Running|Doc-tests)/ { doc = ($0 ~ /Doc-tests/) ? 1 : 0; next }
  /^[[:space:]]*test result:/ {
    p = 0; f = 0; g = 0
    for (i = 1; i <= NF; i++) {
      if ($(i + 1) == "passed;"  || $(i + 1) == "passed")  p = $i
      if ($(i + 1) == "failed;"  || $(i + 1) == "failed")  f = $i
      if ($(i + 1) == "ignored;" || $(i + 1) == "ignored") g = $i
    }
    if (doc) { dp += p; df += f; dg += g; dlines++ }
    else     { bp += p; bf += f; bg += g; blines++ }
  }
  END { printf "%d %d %d %d %d %d %d", bp, bf, bg, blines + 0, dp, df, dg }' "$OUT")

N=$(echo "$stats" | cut -d' ' -f1)
F=$(echo "$stats" | cut -d' ' -f2)
M=$(echo "$stats" | cut -d' ' -f3)
L=$(echo "$stats" | cut -d' ' -f4)
DP=$(echo "$stats" | cut -d' ' -f5)
DF=$(echo "$stats" | cut -d' ' -f6)
DG=$(echo "$stats" | cut -d' ' -f7)

echo "rust-tests: binary summary-lines=$L passed=$N failed=$F ignored=$M cargo_exit=$cargo_rc"
echo "rust-tests: doctest summary (excluded from pass criteria): passed=$DP failed=$DF ignored=$DG"

if [ "$L" -eq 0 ]; then
  echo "KEEL-FAIL rust-tests: no 'test result:' lines found in $OUT"
  exit 1
fi

if [ "$F" -eq 0 ] && [ "$M" -le 10 ] && [ "$N" -ge 759 ] && [ "$cargo_rc" -eq 0 ]; then
  echo "KEEL-PASS rust-tests passed=$N ignored=$M"
  exit 0
fi

echo "KEEL-FAIL rust-tests passed=$N failed=$F ignored=$M cargo_exit=$cargo_rc (need failed=0, ignored<=10, passed>=759, cargo=0)"
exit 1
