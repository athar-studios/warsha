# warsha-relay

## Overview

A tiny optional relay server (axum) for paired remote clients. It forwards opaque frames between a
phone and a daemon when direct reachability is not available; it is not part of the local desktop
path and runs only when an operator deploys it.

## Interface

- `src/lib.rs` — router and frame-forwarding logic.
- `src/main.rs` — relay binary entry point.
- `tests/relay_endpoints.rs` — endpoint behaviour.

## Invariants

- Frames are forwarded as opaque bytes; the relay does not decrypt or inspect their payload.
- The relay holds no daemon token and no pairing secret.
- Fan-out is scoped to the room/channel the frame names; it does not broadcast to every connection.

## Side Effects

Binds a listening socket and keeps in-memory connection state. No disk persistence.

## Verification

- Run: `cargo test -p warsha-relay`
