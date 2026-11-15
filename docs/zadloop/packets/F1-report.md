# Packet F1: Capture Host Determinism

The R-UI-4 capture host environment has been standardized to ensure deterministic output for visual regression tests.

## Changes
- Updated `docker/capture/capture.sh` to run as host user and use `/tmp/pw-home`.
- Created `docker/capture/canary.sh` to verify byte-stability.
- Updated `scripts/ci/baseline-manifest.json`.

## Gate Results
- Docker build exit: 0
- Canary output:
  ```
  Compared count: 84
  Canary passed: 84 PNGs are byte-identical.
  ```
- Policy validator output: (Validated, non-breaking)

The committed remote baselines remain pending re-capture.
