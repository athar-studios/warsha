# Security Model

Warsha is designed with security as a first-class concern. This document is the honest version of that
design: each section says whether the control is **in the code today** or **designed and not built**, because
a reader using this page to decide what to trust needs the difference, not the aspiration.

The single most important fact on this page: **`warshad` binds 127.0.0.1 only and serves no TLS.** Warsha is
a single-machine tool by construction. Anything that reaches it from another device travels over a network you
built, and the daemon's bearer token is the only credential on that link until the encrypted channel below is
actually implemented.

## Threat Model

### Assets to Protect

| Asset | Classification | Protection in the code today |
|-------|----------------|------------------------------|
| API keys | Secret | OS credential store (`keyring`, service `warsha-provider`); never in the database, the config file, logs or crash output |
| Daemon access token | Secret | 32 bytes from the OS RNG in `config.toml`, `0600` on Unix; required on every HTTP route but `/health` and on every RPC |
| Source code | Confidential | Local-first; it leaves your machine only toward a provider endpoint you configured |
| Pipeline Artifacts | Confidential | Local filesystem plus `artifacts` rows in SQLite. **Not encrypted at rest** — no at-rest encryption exists in any crate, so disk encryption is yours to enable |
| Budget/Spend Data | Confidential | Local SQLite, never transmitted |
| Device Pairing Keys | Secret | A long-lived X25519 keypair and a one-time pairing secret in the daemon's pairing store. **No secure enclave and no hardware-backed claim** — nothing in the code asks for one |

### Threat Actors

| Actor | Capability | Mitigation |
|-------|------------|------------|
| Someone else using your account | Reads your files, your keychain, your loopback port | Out of scope, as it is for every local-first app: the daemon cannot tell you from yourself |
| Another machine on your network | Would have to reach the daemon | It cannot: both listeners bind `127.0.0.1` (`crates/warshad/src/lib.rs:3300`, `:3364`) and no flag or config key changes that |
| Network eavesdropper | Passive sniffing of a link you added yourself | **Not mitigated by Warsha.** There is no TLS listener; use an HTTPS reverse proxy or a VPN you control. (The transport rule at `crates/warshad/src/auth.rs:896-921` requires `https`/`wss` for endpoints the daemon dials *out* to — MCP servers, relays, provider APIs — and says nothing about traffic coming in) |
| Malicious relay operator | Sees the frames it routes | The relay holds no keys and never decrypts (`crates/warsha-relay/src/lib.rs:747-750`); today there is no end-to-end channel behind that frame, so it carries whatever the caller put in it |
| Compromised device | Full local access | Revocation: a revoked pairing resolves no session even with the correct secret (`crates/warshad/src/auth.rs:1049-1068`) |
| Malicious AI provider | Sees prompts | Data minimization, no PII in prompts |
| Supply chain attack | Dependency compromise | `cargo deny`, gitleaks and CodeQL are declared in `.github/workflows/ci.yml` — read the trigger note at the bottom of this page before calling that "enforced" |

### Out of Scope

- Physical device compromise (enable full-disk encryption — Warsha does not encrypt at rest)
- OS-level keyloggers (use hardware security keys)
- Social engineering (user education)
- Side-channel attacks on local crypto

## Secrets and the Daemon Token — built

- Provider keys go to the OS credential store through `keyring`: one service name (`warsha-provider`) and the
  provider's own name as the account, so two providers cannot collide and a renamed provider is a different
  entry (`crates/warsha-providers/src/secrets.rs:36-43`).
- The key is transported on exactly one RPC, `providers.add`, and nowhere else
  (`crates/warshad/src/lib.rs:752-766`).
- Error text is written for the owner's screen and carries no key, no request headers, and no base URL that
  could hold a token in a query string (`crates/warshad/src/lib.rs:138-145`).
- The desktop wizard holds the pasted key in component state only, erases it as soon as the call is on its way,
  and scrubs it out of the daemon's reply before rendering it (`apps/desktop/src/screens/Onboarding.tsx:16-19`).
- A machine with no keychain service — headless CI, or a shell without a D-Bus secret service, where `keyring`
  answers `PlatformFailure` — is handed the in-memory store by test code, whose `Debug` implementation prints
  the accounts it holds and never their values. There is no plaintext-file fallback: nothing in Warsha writes a
  key to disk outside the OS store.
- **The token file, honestly:** `config.toml` is created `0600` **on Unix only**. That `chmod` sits inside
  `#[cfg(unix)]` (`crates/warshad/src/lib.rs:3492-3513`), so on Windows the file inherits whatever ACL your
  profile directory already grants.

## Local Transport — built

- HTTP server on `127.0.0.1:<http_port>` (default 8765) with exactly two routes: `/health`, which needs no
  auth, and `/events`, which does (`crates/warshad/src/lib.rs:3357-3364`).
- JSON-RPC on `127.0.0.1:<ws_port>` (default 8766), served at the root path — there is no `/rpc` endpoint. Note
  the flag names: the RPC port is the one called `--ws-port`.
- A caller's identity comes from the authenticated transport, never from the params it sends; a method that
  skipped that check would know nothing at all about its caller (`crates/warshad/src/lib.rs:1250-1285`).
- Every method declares a policy tier (owner-only, standard, read) and a request ceiling (the tier and
  ceiling declared per method at `crates/warshad/src/auth.rs:195-220`, the ceiling values configured at
  `:570-641`); past the ceiling the answer is a rate-limit error carrying `Retry-After`: the header value is
  built at `crates/warshad/src/lib.rs:399-402` and inserted into the refusals at `:386-390` (RPC transport,
  `rpc_refusal`) and `:3710-3711` (HTTP listener, `http_refusal`), while the JSON-RPC form of the same answer
  carries `retry_after_secs` in the error data (`:2638-2644`); the ceiling checks that produce them are at
  `:438` and `:1272-1276`.
- One daemon per data directory, enforced by a lock file that records the holding process id
  (`crates/warshad/src/lib.rs:3516-3533`).
- CORS sits *outside* the auth layer, so a browser preflight is answered and the real POST still carries its
  token (`crates/warshad/src/lib.rs:3296-3312`). The webview's own CSP restricts `connect-src` to `ipc:`,
  `http.localhost`, `127.0.0.1` and `localhost` (`apps/desktop/src-tauri/tauri.conf.json:31`).

## E2E Encryption — designed, and the handshake is not built

### Pairing (QR code) — built

1. Desktop generates `PairingData`:
   - X25519 static public key
   - One-time pairing secret (32 bytes)
   - Relay URL (optional)
   - 10-minute expiry (`crates/warsha-remote/src/lib.rs:143-155`)

2. QR code encodes `PairingData` as base64 PNG

3. Mobile scans QR, verifies expiry, stores the pairing secret. The expiry is genuinely checked on use — an
   expired pairing, a revoked one and a wrong secret all answer the same way, deliberately, so the endpoint
   cannot be probed for which case happened (`crates/warsha-remote/src/lib.rs:180-191`, `:370-380`)

4. Both sides *would* derive a shared secret via X25519. They do not: see the handshake below.

### Noise XX Handshake — **not built**

The pattern is chosen — `Noise_XX_25519_ChaChaPoly_BLAKE2s`, with `snow` as a real dependency — and the
scaffold exists, but nothing runs:

- `EncryptedChannel` is annotated `#[allow(dead_code)]` (`crates/warsha-remote/src/lib.rs:423-434`).
- `process_handshake` is a stub: `// In real implementation, use snow's handshake state machine`, then
  `Ok(false)` (`crates/warsha-remote/src/lib.rs:493-497`).
- Because no handshake completes, `write_message`/`read_message` have no transport to use, and the
  `replay_cache` field is never consulted (`crates/warsha-remote/src/lib.rs:432`, `:500-521`).

```text
Initiator (Mobile)                    Responder (Desktop)
─────────────────                     ──────────────────
   │                                        │
   │── e, es, s ───────────────────────────►│   not implemented
   │                                        │
   │◄── e, ee, se ──────────────────────────│   not implemented
   │                                        │
   │── s, se ──────────────────────────────►│   not implemented
   │                                        │
   │    Handshake Complete                  │   never reached today
```

Forward secrecy, mutual authentication via the pairing secret, a 96-bit nonce, "replay protection: nonce
cache (10,000 entries)" and ChaCha20-Poly1305 message encryption are therefore **design notes, not properties
of your traffic**. Do not rely on them. What protects a remote phone today is the daemon's bearer token and
the network you chose to put it on — see [SECURITY.md](../../SECURITY.md).

### Relay Security — built as a forwarder

The relay (`warsha-relay`) only forwards **opaque frames**:

```rust,ignore
// Relay NEVER holds:
// - Decryption keys
// - Pairing secrets (the --pairings flag is refused; see below)
// - Device static private keys

pub struct EncryptedFrame {
    pub from: DeviceId,
    pub to: DeviceId,
    pub nonce: [u8; 12],
    pub ciphertext: Vec<u8>,  // OPAQUE to the relay
    pub timestamp: DateTime<Utc>,
}
```

**Assertion**: `relay.forward(&frame)` checks the frame size against a bound and routes by the `to` field, and
has no key with which to decrypt (`crates/warsha-relay/src/lib.rs:740-755`). Its own trust hygiene is real:
handing pairing secrets over a command line or a plaintext file is *refused*, and the operator is pointed at
the OS keychain instead (`crates/warsha-relay/src/lib.rs:392-412`).

Because there is no handshake yet, "the relay sees only ciphertext" is a statement about the frame layout, not
a guarantee about your messages.

## Key Management

### Key Hierarchy

```text
Root Identity (X25519)                                    — built
│
├── Pairing Secret (per-device, one-time, 10-min TTL)     — built, TTL enforced
│   └── Session Keys (Noise XX derived)                   — NOT BUILT (no handshake)
│       ├── Encryption Key (ChaCha20-Poly1305)            — NOT BUILT
│       ├── Decryption Key (ChaCha20-Poly1305)            — NOT BUILT
│       └── Replay Cache (nonces)                         — field exists, never consulted
│
└── Device Registry                                       — built
    ├── Local Identity (persisted)
    ├── Paired Devices (persisted)
    └── Revocation List (persisted, with revoked_at)
```

### Storage

| Key Type | Storage today | Backup |
|----------|---------------|--------|
| Provider API keys | OS credential store, service `warsha-provider`, one account per provider | none — and that is deliberate: an exported key is an exposed key |
| Daemon bearer token | `config.toml`, `0600` on Unix (inherited ACL on Windows) | none |
| Device static keypair | the daemon's pairing store, in plain SQLite rows in `warsha.db` | the database file itself; **the database is not encrypted** |
| Pairing secrets | the pairing record, with expiry and revocation flags | none |
| Session keys | **none exist yet** — no handshake completes, so there is nothing to store | none |

The old row here read "Device Registry | SQLite (encrypted) | Encrypted export". There is no encrypted SQLite:
`rusqlite` is the bundled build and `sqlx` links the same `libsqlite3-sys`
(`crates/warsha-store/Cargo.toml:13-16`), with no SQLCipher and no key to encrypt with. Secrets are kept *out*
of that file rather than encrypted inside it, which is why a provider key never appears in a backup of
`warsha.db` — and why the projects, artifacts and event history in it appear in a backup exactly as written.

### Rotation

- **Pairing secrets**: single-use in intent, 10-minute TTL, and the TTL is enforced.
- **Session keys**: per-connection and ephemeral — once the handshake is built. Today there are none.
- **Root identity**: no rotation command exists. Re-pairing a device is the user-facing equivalent, and the
  daemon's bearer token changes only when you edit `config.toml` yourself.

## Device Revocation

```bash
# List paired devices
warsha devices list

# Revoke a device
warsha devices revoke <device-id>
```

A revoked device:

- is refused by the daemon from its **next** request. An already-open session is not killed mid-flight, which is
  what the test at `crates/warshad/src/auth.rs:1465-1477` pins down
- resolves nothing even when it presents the correct pairing secret
  (`crates/warshad/src/auth.rs:1049-1068`)
- cannot complete a handshake — trivially true, since no handshake is implemented
- **is not** dropped at the relay: the relay routes on the `to` id and keeps no revocation list, and with no
  end-to-end channel there is nothing yet for it to drop
- keeps its row in the local registry with `revoked` and `revoked_at`, so the history stays answerable
  (`crates/warsha-store/src/persistence.rs:360-370`)

## Audit Trail — the event log, not an `audit.log` file

There is no `~/.config/warsha/audit.log`, and no JSON-Lines audit writer anywhere in the code. What exists is an
**append-only event log in the same SQLite file as everything else**, and it does carry the security-relevant
events this page used to promise:

| Event | Where it is recorded |
|-------|----------------------|
| Device paired / revoked | the pairing store's rows, with `revoked` and `revoked_at`; the daemon persists pairings so a revoke survives a restart (`crates/warshad/src/lib.rs:1227`) |
| Gate decision | an `Event` row of kind `GateDecision` holding the decision, the device id and `created_at`, plus the `Approved { by, at }` state written onto the run (`crates/warsha-pipeline/src/lib.rs:650-663`) |
| Stage started/completed, agent step, tool call, artifact created/updated | `Event` rows (`crates/warsha-core/src/lib.rs:255-268`) |
| Budget warning / exceeded | `BudgetWarning` and `BudgetExceeded` events with the amounts; at the ceiling the run is set to `Paused` (`crates/warsha-pipeline/src/lib.rs:449-470`) |
| Provider error | the daemon's refusal path, counted and reported on a cadence with no secret in the message (`crates/warshad/src/auth.rs:664-672`, `crates/warshad/src/lib.rs:1275`) |
| CLI command | **not logged.** The CLI prints its result and no component records a command history |
| The daemon's and the desktop shell's own lines | plain-text `tracing` output on stderr; the desktop shell also writes `desktop.log` in its data directory (`apps/desktop/src-tauri/src/lib.rs:50`, `:298`) |

Two consequences are worth stating plainly: a gate decision is never rewritten, and a superseded decision (a
rejection later followed by an approval) is two rows, not one — that is what makes "who approved this, from
which device, when" answerable after the fact. And those rows live in `warsha.db`, which is **not encrypted**,
so reading your decision history means reading your database file: exactly the protection your projects have,
and no more.

Read them back with `warsha logs <run-id>`. There is no export, no signature and no tamper-evidence for the
log.

## Secure Defaults — checked against the code

- **No telemetry** — true: no analytics or telemetry dependency exists under `apps/`, `packages/` or `crates/`
- **Local-first** — true: data and code stay on your machine; the only outbound calls are to the provider
  endpoints and MCP servers you configured
- **No auto-update** — true in the shipped config, not just in effect: `apps/desktop/src-tauri/tauri.conf.json`
  sets `bundle.createUpdaterArtifacts: false` (`:38`) and `plugins: {}` (`:70`), so no updater plugin is
  configured, no update artifacts or `latest.json` are produced, and nothing can update itself. (Earlier
  revisions of this page described a configured-but-inert updater block under `plugins`; that block was
  removed — the `DECISIONS.md` W1 entry of 2026-11-05 and
  [`docs/INSTALL.md`](../INSTALL.md) §5 record the change, and
  [`docs/VERIFY.md`](../VERIFY.md) shows how to re-measure it.)
- **Minimal permissions** — true: the daemon binds loopback only and runs as your user
- **No sudo** — true: no code path and no document asks for it
- **Programs the daemon may start** — an allow-list read from `config.toml`
  (`crates/warshad/src/auth.rs:722-781`): no shell and no `-c` interpreter is in the default list, and no RPC
  can widen it. The code describes this as defense-in-depth and **not** a sandbox, and so does this page

## Hardening Checklist

- [ ] Keep the daemon on loopback; if you must expose it, do it behind HTTPS or a VPN you control
- [ ] Use the OS credential store — i.e. add keys through the app, not through a shell command line
- [ ] Enable disk encryption (BitLocker, FileVault, LUKS): Warsha's files are not encrypted at rest
- [ ] Use strong device passcodes on any paired phone — the approval path has no second factor of its own
- [ ] Regularly audit paired devices with `warsha devices list`, and revoke what you no longer trust
- [ ] Read the run's event log (`warsha logs <run-id>`) when you want the decision trail — there is no
      separate audit file to review
- [ ] Review the daemon's `config.toml` permissions yourself on Windows, where nothing sets them
- [ ] Use `warsha --json` for scripting (no secrets in output)
- [ ] Keep dependencies updated — `cargo deny` is what CI declares; `cargo audit` is not wired up anywhere

## Reporting Security Issues

Email **security@warsha.dev** or use the repository's Security Advisories form. We follow responsible
disclosure.

*Note: that address is not confirmed. `warsha.dev` has not been verified as a domain the owner controls, and
Warsha has published no security contact; the contact addresses used across this repository
(`security@warsha.dev`, `conduct@warsha.dev`, `licensing@warsha.dev`, `support@warsha.dev` and
`contact@atharapp.download`) disagree with one another, and settling them is an owner decision. Until that is
decided, use GitHub Security Advisories: it reaches the maintainers without any address being published, and it
does not weaken the "do not open a public issue" rule.*