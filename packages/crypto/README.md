# @warsha/crypto

## Overview

The cryptographic primitives intended for the remote path: X25519 key agreement, HKDF key
derivation, ChaCha20-Poly1305 authenticated encryption, replay protection and device revocation.
It is a library, not a service.

**Nothing imports it today.**
`grep -rl "@warsha/crypto" apps packages --include=*.ts --include=*.tsx` returns only
`packages/crypto/src/index.ts` — the package's own header comment — and no `package.json` in the
workspace declares it as a dependency. The primitives exist and are tested; they are not wired
into the daemon, the desktop app or the phone app. "The relay only ever sees ciphertext" is
therefore a **goal, not current behaviour**: the phone path that runs is authenticated JSON-RPC,
not ciphertext, and the Rust-side `EncryptedChannel` in `crates/warsha-remote` is a stub.

## Interface

All of it is `src/index.ts`:

- Keys and derivation — `generateKeyPair`, `deriveSharedSecret` (X25519), `deriveKey`
  (HKDF-SHA256).
- Authenticated encryption — `encrypt` / `decrypt` (ChaCha20-Poly1305, optional associated
  data), `generateNonce` (12 bytes), `generatePairingSecret` (32 bytes).
- Pairing — `createPairingData` (10-minute expiry), `isPairingExpired`, and the `PairingData`,
  `DeviceIdentity`, `KeyPair` and `EncryptedFrame` types.
- `ReplayProtection` — a nonce cache with a bounded size (default 10000) and FIFO eviction.
- `DeviceRegistry` — `addDevice`, `revokeDevice`, `isRevoked`, `listDevices`, `getLocalIdentity`.
- `EncryptedChannel` — `initializeAsInitiator` / `initializeAsResponder`, `encrypt`, `decrypt`.
- Transport helpers — `serializeFrame` / `deserializeFrame` (base64 nonce and ciphertext),
  `toHex` / `fromHex` / `toBase64` / `fromBase64`.
- `src/index.test.ts` — 22 tests over key exchange, authenticated encryption (round trip,
  tampered ciphertext, wrong key), pairing expiry, replay protection, device revocation, the
  channel and frame serialization.

## Invariants

- Authenticated encryption is mandatory for payloads: `decrypt` returns the cipher's own
  result, so a failed authentication tag throws. There is no plaintext fallback path.
- Each direction has its own key. `initializeAsInitiator` sends with the `warsha-initiator` key
  and receives with `warsha-responder`; `initializeAsResponder` mirrors them, so both peers
  derive the same two keys from one shared secret.
- The HKDF salt is derived deterministically from both public keys — `sha256` over the two keys
  concatenated in lexicographic order (`deriveChannelSalt`) — so neither peer has to send a
  salt first and the value does not depend on who initiated.
- `ReplayProtection.check` rejects a nonce already seen, and `EncryptedChannel.decrypt` consults
  it before decrypting.
- A private key never enters a frame: `serializeFrame` carries only `from`, `to`, `nonce`,
  `ciphertext` and `timestamp`. `createPairingData` *does* place the pairing secret and the
  public key in the `PairingData` record it returns — that record is a bearer credential, and
  its QR plate must be handled as one.
- Despite the `Noise XX pattern (simplified)` comment on `EncryptedChannel`, the class performs
  no handshake transcript: it derives two static keys from one X25519 shared secret. It is not
  a Noise XX implementation and must not be described as one.

## Side Effects

No network, no disk, no keychain and no logging. The package is computation over byte arrays,
with two platform reads: randomness from the CSPRNG (`randomBytes`) for keys, nonces and pairing
secrets, and the wall clock (`Date.now()`) in `createPairingData` and `isPairingExpired`.
`toBase64` / `fromBase64` use the platform's `btoa` / `atob` rather than a Node `Buffer`, so the
module stays portable.

## Verification

- Run: `pnpm --filter @warsha/crypto test`
- Types: `pnpm --filter @warsha/crypto typecheck`
- Lint: `pnpm --filter @warsha/crypto lint`
- Consumers: none. Re-run the `grep` above before claiming this package is used by an app.
