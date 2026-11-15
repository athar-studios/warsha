# Capture Host

This directory contains the tooling for capturing visual regression baselines in a containerized environment to ensure determinism.

## Baseline Manifest (scripts/ci/baseline-manifest.json)
The manifest tracks the image digest and capture date per surface:
- `surfaces`: Array of objects, each with `id`, `spec`, `status`, `image_digest`, and `capture_date`.
- `f1`: Record for the capture host canary, containing `capture_date` and `image_digest`.

## Canary (docker/capture/canary.sh)
Verifies byte-stability of the capture process.
