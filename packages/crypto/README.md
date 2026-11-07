# @warsha/crypto

## Overview

The cryptographic primitives used by the remote path: key derivation and authenticated encryption
for paired-device traffic, so the relay only ever sees ciphertext. It is a library, not a service.

## Interface

- `src/index.ts` — the exported primitives and their result types.
- `src/index.test.ts` — known-answer and round-trip coverage.

## Invariants

- Authenticated encryption is mandatory for payloads; a failed authentication tag is an error, never
  plaintext fallback.
- Keys are handled as byte buffers and are not logged, serialized into pairing records, or written to
  disk by this package.
- Frames carry a nonce and timestamp, and replay protection rejects a frame already seen from that
  device. The HKDF salt is derived deterministically from both public keys, so neither peer has to
  send a salt first.

## Side Effects

None. Pure computation over byte arrays.

## Verification

- Run: `pnpm --filter @warsha/crypto test`
- Types: `pnpm --filter @warsha/crypto typecheck`
