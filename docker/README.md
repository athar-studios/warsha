# docker

## Overview

The container build for the daemon and CLI: a multi-stage `Dockerfile` that produces `warshad` and
`warsha`, an entrypoint that prepares the data directory, and a compose file for a single-host
deployment. The same image is the base for the `deploy/` stack.

## Interface

- `Dockerfile` — multi-stage build of `warshad` and `warsha-cli`; runtime runs as the non-root user
  `warsha` (UID 10001).
- `entrypoint.sh` — data-directory preparation and process start.
- `compose.yml` — single-service local/container composition.

## Invariants

- The runtime image never runs as root and does not bake a token or provider key into a layer.
- Configuration is environment-only; a one-time bootstrap admin token is used to pair, not stored in
  the image.
- The data directory is a volume; rebuilding the image does not create a second store.

## Side Effects

Pulls build dependencies, writes image layers, and at runtime binds the daemon ports and mounts the
data volume.

## Verification

- Build: `docker build -f docker/Dockerfile -t warsha .`
- Compose syntax: `docker compose -f docker/compose.yml config`
