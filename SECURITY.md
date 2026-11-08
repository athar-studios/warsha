# Security Policy

## Supported Versions

**Nothing has been released.** The repository carries no git tag, so there is no published build to patch
or to support. These are the version strings in the tree today:

| Component | Version in the tree | Supported |
| --------- | ------------------- | --------- |
| Desktop app (`apps/desktop/src-tauri/tauri.conf.json:4`) | `0.2.0` | Source work on `main` only — no released build exists |
| Rust crates (`Cargo.toml:18`) | `0.1.0` | Same |

## Reporting a Vulnerability

**Do not open a public issue** for security vulnerabilities.

Instead, email **security@warsha.dev** (or use GitHub Security Advisories) with:

*Note: this address is not confirmed. `warsha.dev` is not verified as a domain the owner controls, and
Warsha has published no security contact. Choosing one is an owner decision. Until that happens, use the
**Security Advisories** tab of the repository you are reading this in — it reaches the maintainers without
any email address.*

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and provide a timeline for a fix.

## Security Architecture

This section separates what the code enforces today from what is designed but not built. If you are
reading it to decide whether to trust a build, the "not built" lines are the ones that matter.

### Secrets Management — built

- **API keys, tokens, credentials** are stored **only** in the OS keychain:
  - Windows: Credential Manager
  - macOS: Keychain
  - Linux: Secret Service / libsecret
- Implemented via the `keyring` crate, under one service name for all provider keys (`warsha-provider`,
  `crates/warsha-providers/src/secrets.rs:43`) with the provider's own name as the account, so two
  providers cannot collide on one entry.
- **Never** in config files, logs, database, crash reports, or git. This is a structure, not a promise: a
  provider's *configuration* is a SQLite settings row and its *secret* is not, because "an API key in a
  SQLite file is a key in every backup, every `SELECT *` pasted into a bug report and every crash dump"
  (`crates/warsha-providers/src/secrets.rs:7-9`).
- A host with no keychain service — headless CI, a WSL shell without a D-Bus secret service, where
  `keyring` answers `PlatformFailure` — uses the in-memory store, which the daemon accepts as a parameter
  and which prints the accounts it holds and never their values. There is no on-disk fallback.
- Log and error output is scrubbed by construction: the daemon's provider refusals carry no key, no request
  headers and no base URL that could hold a token in its query string
  (`crates/warshad/src/lib.rs:139-145`), and the first-run wizard keeps the key in component state only,
  erases it as soon as `providers.add` is on its way, and strips it out of the daemon's message before
  showing it (`apps/desktop/src/screens/Onboarding.tsx:16-19`).

### No ToS-Violating Subscription Reuse

Warsha does **not** extract or replay consumer OAuth tokens (e.g., reusing Claude Pro/Max or ChatGPT Plus sessions as an API).

Subscriptions are supported **only** by:
- Launching the vendor's official CLI as a subprocess under the user's own login
- Officially documented third-party OAuth
- User-supplied "custom OpenAI-compatible endpoint" (with clear UI warning)

### Local Transport — built, and it is not encrypted

- `warshad` binds **loopback by default** (`127.0.0.1`) on both its JSON-RPC and its HTTP listener.
  Binding another interface is an **owner opt-in**, never a default: the `bind_host` config key
  (`crates/warshad/src/lib.rs:542-543`), `--bind-host` (`:1009-1010`) or `WARSHA_BIND_HOST` (`:5899`)
  take a bare IP literal. The daemon has no TLS listener, so a non-loopback bind is only as private as
  the network and proxy in front of it; a wildcard bind additionally needs `advertised_host`
  (`:555-556`, `--advertised-host` `:1012-1014`, `WARSHA_ADVERTISED_HOST` `:5902`) before it will
  mint a pairing link. The Docker image sets `WARSHA_BIND_HOST=0.0.0.0` for a container attached
  solely to an `internal: true` network — a deliberate deployment decision, not a changed default.
- Every HTTP route except `/health` requires the bearer token (`crates/warshad/src/lib.rs:5644`,
  `:6088`), and every RPC method reads its caller from the authenticated transport rather than from
  the params the caller sends (`crates/warshad/src/lib.rs:2176`, `authorize(&RpcExtensions, …)`; the
  RPC auth layer is `:914-960`).
- On first run the daemon generates a 32-byte token from the OS RNG and writes it into `config.toml`, which
  is then set to `0600` **on Unix only** — the permission call sits inside `#[cfg(unix)]`
  (`crates/warshad/src/lib.rs:5866-5867`). On Windows nothing in the code sets the ACL; the file inherits
  whatever the profile directory grants.
- Inbound requests are rate-limited per verified identity, and the answer past a ceiling carries a
  `Retry-After` (`crates/warshad/src/lib.rs:953`, `:2189`).
- **There is no TLS in the daemon.** No `rustls`, `openssl` or `native-tls` dependency exists anywhere under
  `crates/`, so `warshad` serves no `https://` or `wss://` listener. What *is* implemented is a transport
  rule for the endpoints the daemon **dials out to** — MCP servers, provider APIs, a relay: `https`/`wss` are
  accepted anywhere, a plain `http`/`ws` only on loopback (`crates/warshad/src/auth.rs:896-921`). That rule
  does not encrypt anything coming *in* to the daemon.
- **Consequence for a remote phone or a second machine:** loopback is the default, so Warsha is
  single-machine until the owner opts into `bind_host`. If you expose it yourself — a LAN bind, reverse
  proxy, SSH tunnel, Tailscale — the confidentiality of that hop is your infrastructure's job, not
  Warsha's, and the token in `config.toml` is the only credential on it. This is the 2026-11-04
  infrastructure-boundary decision (#11): TLS for the phone is an owner decision at the proxy or
  tunnel, not a daemon feature, and a self-signed certificate on the daemon was rejected.

### No ToS-Violating Subscription Reuse

Warsha does **not** extract or replay consumer OAuth tokens (e.g., reusing Claude Pro/Max or ChatGPT Plus sessions as an API).

Subscriptions are supported **only** by:
- Launching the vendor's official CLI as a subprocess under the user's own login
- Officially documented third-party OAuth
- User-supplied "custom OpenAI-compatible endpoint" *(the UI names it "Custom endpoint" and asks for the
  base URL; there is no separate warning about the endpoint's operator yet, so the owner reads their own URL
  back to themselves here)*

### Remote Access — partly built, and the encryption is the part that is not

- **Pairing**: QR code with a one-time pairing secret — **built**. `PairingData` carries an X25519 static
  public key, a one-time secret and a 10-minute expiry that is genuinely checked on use
  (`crates/warsha-remote/src/lib.rs:121-128` for the struct; `:150-161` mints the 32-byte secret and
  `expires_at`; `:197-200` checks expiry).
- **Identity**: long-term device keypair with a revocable device list — **built** on the daemon side; a
  revoked pairing resolves no session even when it presents the right secret
  (`crates/warshad/src/auth.rs:169-171`), and the registry keeps the revoked row with
  `revoked = true` (`crates/warsha-store/src/persistence.rs:194-195`, `:526-540`).
- **Handshake**: a Noise-style handshake over the `snow` crate — **not built**. `EncryptedChannel` is annotated
  `#[allow(dead_code)]` at `crates/warsha-remote/src/lib.rs:587-588`, and `process_handshake` is a stub
  that returns `Ok(false)` without running a handshake (`:656-659`). No session keys are derived today,
  so nothing is encrypted end-to-end, and the replay cache is a field nothing reads (`:594`).
- **Relay**: **built as a forwarder** — `warsha-relay` checks the frame size and routes on the `to` device id,
  and has no key to decrypt with (`crates/warsha-relay/src/lib.rs:747`). Because no handshake exists, "the
  relay sees only ciphertext" is a property of the frame layout, not a proof about the traffic.
- **What the phone does today instead**: it opens the daemon's address with the bearer token, reads the token
  out of the URL immediately, and keeps it for the tab only, never in a file
  (`apps/remote/src/App.tsx:70-73`, `:108-109`). So on any network that is not your own machine, run it behind
  HTTPS or a tunnel you control.
- **Network**: `warshad` listens on loopback only by default, and dials **out** to the relay when one is
  configured; the relay binary builds, but there is no live encrypted channel for it to carry yet.

### Code Execution Control — an allow-list, not a sandbox

- **No Docker.** There is no container path in the code: `warsha doctor` only reports whether a `docker`
  binary is on `PATH` (`crates/warsha-cli/src/lib.rs:717-732`) and nothing runs it. No VM, no seccomp, no
  Job Object, no AppArmor profile either.
- **What does exist**: the daemon refuses to start any program its own configuration does not name.
  `DEFAULT_ALLOWED_COMMANDS` (`crates/warshad/src/auth.rs:749-781`) is the set of toolchains a generated
  project builds and runs with; shells and `-c` interpreters are deliberately absent, and no RPC can widen
  the list — only `config.toml` can (`crates/warshad/src/lib.rs:1236-1247`).
- The code states its own limit, and this document repeats it: that policy is **defense-in-depth, not a
  sandbox**. A caller who already holds the owner credential is not confined by a list of program names, and
  arguments are not inspected (`crates/warshad/src/auth.rs:728-735`). Anything Warsha runs, runs as you.
- **Working-directory confinement** is real for the agent file tools
  (`crates/warsha-pipeline/src/agent_tools.rs:292`) and separate git branches per run are how work is laid out
  for review (`crates/warsha-git/src/lib.rs:104`). Both are review boundaries, not security boundaries.
- **Network egress is not restricted.** There is no per-run firewall, proxy or registry allow-list in the code.

### Approval Gates

Irreversible actions require **explicit human approval**:
- Merge to main
- Release / publish
- Any spend above budget
- Any public post

- **Built**: a gate decision is accepted only from a verified session — the owner's bearer token or a paired
  device's pairing secret — resolved from the transport, never from a device id the caller types in params
  (`crates/warshad/src/lib.rs:1255-1285`, `crates/warshad/src/auth.rs:163-168`), and it is stored with the
  device id and timestamp (`crates/warsha-pipeline/src/lib.rs:650-661`).
- **Not built**: device-local confirmation. There is no PIN, biometric or WebAuthn code anywhere in this
  repository — `grep -rEi "webauthn|biometric" apps packages crates` returns nothing — so a phone approval is
  protected by the daemon's token alone, not by a second factor on the device.
- **Agents can never approve gates.** An agent session has no device identity, and no tool the agents reach
  (MCP, backend CLI, GitHub client, webhook) is wired to a gate decision.

### Supply Chain

`.github/workflows/ci.yml` declares:

- `cargo fmt --all --check`, `cargo clippy -D warnings --workspace --all-targets`, `cargo test --workspace --all-targets`
- `cargo deny --manifest-path Cargo.toml --all-features check` with a pinned, checksum-verified
  cargo-deny 0.20.2, against the root **`deny.toml`** this project wrote (the license allow-list is
  measured from the committed lock graph — `.github/workflows/ci.yml:188-192`)
- `gitleaks` (`gitleaks/gitleaks-action@v2` with `config: .gitleaks.toml`)
- CodeQL (`github/codeql-action/init@v3` + `analyze@v3`, Rust and TypeScript)
- ESLint, `tsc --noEmit`, Vitest, the architecture-boundary script, Playwright, and the mdBook build
- `actionlint` for the workflows themselves

It does **not** run `cargo audit` or `pnpm audit` — neither step exists in any workflow file. And before
repeating a "CI is green" claim, read its trigger: `ci.yml` fires on pushes and pull requests that target
`main` only, and `release.yml` fires on a `v*` tag, which this repository has never had. Work on any other
branch runs none of the above.

## Threat Model

| Threat | Mitigation in the code today |
|--------|------------------------------|
| Secret leakage | OS keychain only, configuration and secret deliberately split (`secrets.rs`), daemon errors that name no secret, gitleaks declared in CI |
| Supply chain attack | `cargo deny` and CodeQL declared in CI, `Cargo.lock`/`pnpm-lock.yaml` pinned. An SBOM is attempted only by `release.yml` (which needs a tag, and tolerates the step failing) |
| Local port hijack | Loopback bind by default (a wider `bind_host` is an owner opt-in), bearer token on every route but `/health`, `config.toml` at 0600 on Unix, single-instance lock on the data directory |
| Network interception | **Not mitigated by Warsha today.** No TLS listener, and the E2E channel is unimplemented — stay on loopback, or add HTTPS/VPN yourself |
| Malicious code execution | Owner-role check first, then the program allow-list. No container, no sandbox, no egress control |
| Unauthorized gate approval | Session identity taken from the transport, per-method policy tiers and rate ceilings, revoked pairings resolve nothing. No second factor on the device |
| Subscription ToS violation | Official CLI subprocess only, no token extraction |

## Security Checklist for Contributors

- [ ] No secrets in code, config, logs, or tests
- [ ] Use `keyring` crate for all credential storage
- [ ] Redact secrets in all log output
- [ ] No `unwrap()` on security-critical paths
- [ ] Validate all external input
- [ ] Use bound parameters — every statement in `warsha-store` is `sqlx::query` with `?` placeholders and
      `.bind(...)`; no SQL is assembled by string interpolation
- [ ] Keep dependencies updated; `cargo deny` is what CI runs. `cargo audit`/`pnpm audit` are not wired up
- [ ] Add tests for security-relevant code paths
- [ ] Never describe a control as a sandbox, TLS, or a second factor unless the code enforces it

## Third-Party Notices

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for Goose and other dependencies. Goose is **not** a
workspace dependency: it is still a commented placeholder, as `docs/UI.md:360-362` says.