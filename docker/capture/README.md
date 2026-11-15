# Warsha Capture Host

This directory contains the definition of a reproducible visual capture environment used for Warsha's visual baselines.

## Building the Image

To build the image, run the following command from the repository root:

```bash
docker build -f docker/capture/Dockerfile -t warsha-capture:0.3.0 .
```

## Running the Canary

The canary verifies that the capture host is deterministic by capturing the same surface twice and checking if the resulting PNGs are byte-identical.

```bash
./docker/capture/canary.sh
```

## Capturing a Surface

To capture a surface, use the provided script:

```bash
./docker/capture/capture.sh <project> <spec> <output-dir>
```

Example:
```bash
./docker/capture/capture.sh remote apps/remote/e2e/bench.visual.spec.ts tmp/bench-results
```

## Baseline Manifest

The baseline manifest (`scripts/ci/baseline-manifest.json`) tracks the status of visual baseline captures for each surface.

- `name`: A unique identifier for the surface.
- `spec`: Path to the Playwright spec file.
- `image_digest`: Digest of the Docker image used for the capture.
- `capture_date`: Date of the capture.
- `status`: `pending` or `captured`.
