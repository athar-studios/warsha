# warsha-remote

## Overview

The remote-access half of the daemon: device pairing, the relay's wire types and trust store,
and bounded inbound rate limiting. The desktop remains the owner; a paired phone authenticates
with its **own pairing secret**, never the daemon token
(`crates/warshad/src/auth.rs:171-184`).

**Relay payloads are not end-to-end encrypted today.** The `EncryptedChannel` handshake is a
stub (see below); the phone path that actually runs is authenticated JSON-RPC, not ciphertext.

## Interface

- `src/lib.rs` — `DeviceIdentity`, `DeviceRegistry`, `PairingData`, `PairingOffer`,
  `TrustedPairing`, `RelayTrust` and the `EncryptedFrame` wire type, plus the unfinished
  `EncryptedChannel` and `RelayClient`.
- `src/rate_limit.rs` — declared `pub mod rate_limit` at `src/lib.rs:3`. `Quota` (`burst`
  capacity plus `sustained` requests per `window`), `RateLimiter<K>`, `Decision`, `rate_key`,
  `RefusalMeter`, `RefusalSummary` and `caller_digest`. A token bucket keyed on an
  **authenticated identity** where the transport has one and on a **peer address** where it
  does not, with a hard `max_keys` bound (`DEFAULT_MAX_KEYS` = 4096): when the map is full of
  keys that have not gone idle, a *new* key is refused rather than admitted, so the limiter
  fails closed.

## Invariants

- A phone never receives the daemon token. `Sessions::resolve`
  (`crates/warshad/src/auth.rs:171-184`) checks the owner token first and then the live pairing
  store, both constant-time, and answers `None` for an empty, unknown or revoked credential
  without saying which one the caller guessed. Because it reads the pairings the daemon holds
  at the moment of the call, revoking a phone takes effect on its next request rather than on
  the next restart.
- A pairing is short-lived: `PairingData::new` sets `expires_at` to now + 10 minutes
  (`src/lib.rs:161`), and `is_expired` (`:202`) judges it against the clock. The secret is a
  *bearer* credential: `verify_secret` (`:211`) compares constant-time and does not consume it,
  so the "One-time secret" comment on the field (`:125`) is a label, not an enforced single use.
- `PairingData::pairing_link` (`src/lib.rs:267-279`) returns
  `{origin}/?server=<percent-encoded origin>&token=<secret_token>`. **The link is a bearer
  credential**: render it as a QR plate, never as text, never in a log line and never in a file.
- Secrets are redacted when printed, not absent from the record. `PairingData` carries the 32
  secret bytes; its hand-written `Debug` (`src/lib.rs:137-147`) prints
  `pairing_secret: "<redacted>"`, so one `debug!("{pairing:?}")` cannot put a token into a file
  that is rotated or pasted into an issue.

### Encryption: what is and is not implemented

- `EncryptedChannel::initiate` (`src/lib.rs:611`) and `EncryptedChannel::respond` (`:640`) build
  a `snow` Noise XX handshake and bind it to `let _handshake`, discarding it. Both return
  `transport: None`.
- `process_handshake` (`src/lib.rs:656-659`) is a **stub** returning `Ok(false)`. It never
  advances a handshake state machine.
- `write_message` and `read_message` (`src/lib.rs:662-685`) therefore always fail with
  `Handshake("Handshake not complete")`. The only way to set `transport` is to hand
  `complete_handshake` (`:688`) a `HandshakeState` the caller built itself.
- Nothing outside this crate uses `EncryptedChannel` or `RelayClient`. Both are
  `#[allow(dead_code)]` and appear only in this file's own tests. `RelayClient::connect` (`:715`),
  `send_frame` (`:742`) and `receive_frames` (`:747`) are stubs returning `Ok(())` and
  `Ok(vec![])`.
- `crates/warsha-relay` does forward `EncryptedFrame` values, but no production code constructs
  one: outside tests the type appears only as the relay's channel payload and HTTP/WebSocket
  body. "The relay only sees ciphertext" is a design goal, not today's behaviour.

## Side Effects

Pairing state is persisted through the daemon's settings, and `DeviceRegistry` holds devices in
memory behind a mutex. `rate_limit` is in-process bookkeeping: refusals are *counted* rather than
streamed, and `RefusalMeter` writes at most one line per interval
(`DEFAULT_REFUSAL_LOG_INTERVAL` = 60 s) naming counts and a one-way `caller_digest` — never the
credential, the identity or the peer address it was keyed on.

This crate opens no relay socket today: the outbound WebSocket/HTTP client is the `RelayClient`
stub above. The relay server is a separate crate, `crates/warsha-relay`.

## Verification

- Run: `cargo test -p warsha-remote`
- Consumers: `crates/warshad`, `crates/warsha-cli` and `crates/warsha-relay` depend on this crate.
