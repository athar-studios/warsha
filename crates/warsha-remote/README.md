# warsha-remote

## Overview

The remote-access half of the daemon: device pairing, end-to-end crypto for phone traffic, the relay
client and its rate limiting. The desktop remains the owner; a paired phone speaks through this
crate without ever receiving the daemon token.

## Interface

- `src/lib.rs` — pairing records, crypto handshake and relay client.
- `src/rate_limit.rs` — per-device request budget for the remote path.

## Invariants

- A pairing secret is single-use and short-lived; revoking a device removes its access immediately.
- The relay carries ciphertext only; payload encryption/decryption happens in this crate.
- Secrets never appear in logs or in pairing records.

## Side Effects

Persists pairing state through the daemon settings, opens outbound WebSocket/HTTP connections to the
relay, and enforces rate limits on inbound frames.

## Verification

- Run: `cargo test -p warsha-remote`
