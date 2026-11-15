# Capture Host

This directory contains the tooling for capturing visual regression baselines in a containerized
environment to ensure determinism.

## Building the image

From the repository root:

```bash
docker build -f docker/capture/Dockerfile -t warsha-capture:0.3.0 .
```

The image pins: the Node base by digest (`node:22-bookworm-slim@sha256:e9f565d3...`), pnpm 9.0.0,
`@playwright/test` 1.49.1 with its chromium, and the nine IBM Plex faces via the repo's pinned
installer (`scripts/ci/install-capture-fonts.sh`, google/fonts commit `6c1dbe27`, SHA-256 per face,
refuses on mismatch), with `FONTCONFIG_FILE` pinned to `scripts/ci/capture-fontconfig.conf`.

## Capturing a surface

```bash
./docker/capture/capture.sh <project> <spec> <output-dir> [extra playwright args...]
```

The container runs as the host user (`--user "$(id -u):$(id -g)"`, `HOME=/tmp/pw-home`) with pinned
resources (`--cpus=2 --memory=4g --shm-size=1g`), so output files are host-owned and resource
variance is bounded. Results land in the host directory you name (use `target/…`, which is
gitignored).

## Canary (docker/capture/canary.sh)

Verifies the capture process's determinism: captures the `remote` bench surface twice and compares.

```bash
./docker/capture/canary.sh
```

The compare is a **decoded-pixel compare**, not a byte compare: Chromium's software rasterizer is
not bit-deterministic on curved and shadowed edges (`playwright.config.ts:56-64`; measured on this
image: 3 px at ≤ 8 levels on the SVG brand-mark edge, intermittent — a byte compare fails ~1 run in
2). The repo's own contract (config `threshold: 0.05`) is a tolerance on *how much* a pixel
differs, never on *how many*: every differing pixel must stay within `WARSHA_CANARY_MAX_DELTA`
(default 13 per channel) and their count within `WARSHA_CANARY_MAX_PIXELS` (default 64 per image).
A moved edge, a shifted line or a re-rendered glyph exceeds both and fails. The compare also fails
on missing/extra images and on geometry/format mismatches. Measured: 84/84 within tolerance across
repeated runs; a 60-level block tamper is rejected.

## Baseline manifest (scripts/ci/baseline-manifest.json)

Tracks the image digest and capture date per surface:

- `surfaces`: array of `{ id, spec, status, image_digest, capture_date }` — one row per UI surface;
  `status` is `pending` until that surface's baselines are captured on this host.
- `f1`: the capture-host canary's own record (`capture_date`, `image_digest` of the capture image).

Later packets (F2, E5) update rows to `captured` with the digest and date of the image that
captured them.
