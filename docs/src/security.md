# Security Model

Warsha is designed with security as a first-class concern. This document describes the threat model, cryptographic guarantees, and operational security practices.

## Threat Model

### Assets to Protect

| Asset | Classification | Protection |
|-------|----------------|------------|
| API Keys | Secret | OS Keychain, never logged |
| Source Code | Confidential | Local-first, E2E encrypted in transit |
| Pipeline Artifacts | Confidential | Local filesystem, encrypted at rest (optional) |
| Budget/Spend Data | Confidential | Local SQLite, not transmitted |
| Device Pairing Keys | Secret | Secure enclave, hardware-backed when available |

### Threat Actors

| Actor | Capability | Mitigation |
|-------|------------|------------|
| Network eavesdropper | Passive sniffing | TLS 1.3 for all HTTP, Noise XX for WebSocket |
| Malicious relay operator | Sees ciphertext only | Relay never has decryption keys |
| Compromised device | Full local access | Revocation, short-lived sessions |
| Malicious AI provider | Sees prompts | Data minimization, no PII in prompts |
| Supply chain attack | Dependency compromise | cargo-deny, gitleaks, CodeQL, pinned deps |

### Out of Scope

- Physical device compromise (full disk encryption recommended)
- OS-level keyloggers (use hardware security keys)
- Social engineering (user education)
- Side-channel attacks on local crypto

## E2E Encryption

### Pairing (QR Code)

1. Desktop generates `PairingData`:
   - X25519 static public key
   - One-time pairing secret (32 bytes)
   - Relay URL (optional)
   - 10-minute expiry

2. QR code encodes `PairingData` as base64 PNG

3. Mobile scans QR, verifies expiry, stores pairing secret

3. Both sides derive shared secret via X25519

### Noise XX Handshake

```text
Initiator (Mobile)                    Responder (Desktop)
─────────────────                     ──────────────────
   │                                        │
   │── e, es, s ───────────────────────────►│
   │                                        │
   │◄── e, ee, se ──────────────────────────│
   │                                        │
   │── s, se ──────────────────────────────►│
   │                                        │
   │    Handshake Complete                  │
```

- **Pattern**: Noise_XX_25519_ChaChaPoly_BLAKE2s
- **Forward secrecy**: Ephemeral keys per session
- **Mutual authentication**: Static keys verified via pairing secret

### Message Encryption

- **Cipher**: ChaCha20-Poly1305 (AEAD)
- **Nonce**: 96-bit (32-bit counter + 64-bit random)
- **Associated Data**: Device IDs, timestamps
- **Replay protection**: Nonce cache (10,000 entries)

### Relay Security

The relay (`warsha-relay`) only forwards **opaque ciphertext**:

```rust,ignore
// Relay NEVER sees:
// - Plaintext messages
// - Decryption keys
// - Pairing secrets
// - Device static private keys

pub struct EncryptedFrame {
    from: DeviceId,
    to: DeviceId,
    nonce: [u8; 12],
    ciphertext: Vec<u8>,  // OPAQUE
    timestamp: DateTime<Utc>,
}
```

**Assertion**: `relay.forward(&frame)` only checks frame size and routes by `to` field. Ciphertext is never decrypted.

## Key Management

### Key Hierarchy

```text
Root Identity (X25519)
│
├── Pairing Secret (per-device, one-time)
│   └── Session Keys (Noise XX derived)
│       ├── Encryption Key (ChaCha20-Poly1305)
│       ├── Decryption Key (ChaCha20-Poly1305)
│       └── Replay Cache (nonces)
│
└── Device Registry
    ├── Local Identity (persisted)
    ├── Paired Devices (persisted)
    └── Revocation List (persisted)
```

### Storage

| Key Type | Storage | Backup |
|----------|---------|--------|
| Root Identity | OS Keychain / Secure Enclave | Encrypted export |
| Pairing Secrets | Memory only (10 min) | None |
| Session Keys | Memory only | None |
| Device Registry | SQLite (encrypted) | Encrypted export |

### Rotation

- **Pairing secrets**: Single-use, 10-minute TTL
- **Session keys**: Per-connection, ephemeral
- **Root identity**: User-initiated rotation (re-pair all devices)

## Device Revocation

```bash
# List paired devices
warsha devices list

# Revoke a device
warsha devices revoke <device-id>
```

Revoked devices:
- Immediately rejected by daemon
- Cannot complete handshake
- Frames from revoked devices dropped at relay
- Local registry updated with `revoked_at` timestamp

## Audit Logging

All security-relevant events are logged locally:

| Event | Logged Fields |
|-------|---------------|
| Device paired | device_id, name, timestamp |
| Device revoked | device_id, reason, timestamp |
| Gate decision | gate, decision, device_id, timestamp |
| Budget exceeded | project_id, amount, timestamp |
| Provider error | provider, error, timestamp |
| CLI command | command, args (no secrets), timestamp |

Logs are stored in `~/.config/warsha/audit.log` (JSON Lines format).

## Secure Defaults

- **No telemetry** — Zero outbound analytics
- **Local-first** — All data stays on your machine
- **No auto-update** — Manual approval required
- **Minimal permissions** — Daemon binds to localhost only
- **No sudo** — Runs as current user

## Hardening Checklist

- [ ] Use OS Keychain for API keys
- [ ] Enable disk encryption (BitLocker, FileVault, LUKS)
- [ ] Use strong device passcodes/biometrics
- [ ] Regularly audit paired devices
- [ ] Keep Warsha updated
- [ ] Review audit logs periodically
- [ ] Use `--json` output for scripting (no secrets in output)

## Reporting Security Issues

Email security@warsha.dev or use GitHub Security Advisories. We follow responsible disclosure.