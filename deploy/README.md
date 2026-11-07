# deploy

## Overview

The deployable stack: a compose file that runs the daemon image behind Caddy, a Caddyfile for TLS
termination, and an environment template. It is intended for a single host that must be reachable by
paired devices without exposing the daemon port directly.

## Interface

- `docker-compose.yml` — daemon service plus the Caddy edge on an internal network.
- `Caddyfile` — TLS termination and reverse proxy to the daemon.
- `.env.example` — required environment names (no secrets committed).

## Invariants

- Only Caddy publishes a port; the daemon is reachable on the internal network, not from the host's
  public interface.
- TLS is terminated at Caddy; the daemon does not serve plaintext to the public network.
- Secrets come from the environment at deploy time and are never committed; the template carries
  names and placeholders only.
- The data volume persists across container upgrades.

## Side Effects

Creates containers, networks and a volume; Caddy obtains/renews TLS certificates for the configured
hostname.

## Verification

- Syntax: `docker compose -f deploy/docker-compose.yml config`
- Caddyfile: `caddy validate --config deploy/Caddyfile` (when Caddy is installed)
