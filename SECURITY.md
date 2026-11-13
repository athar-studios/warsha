# Security Policy

## Supported Versions

**One release is published: `v0.2.0` (2026-11-09), a normal public release with seven assets.** The tag
`v0.2.0` exists; the tree has moved on to `0.2.1`, so the published build and the source head are not the
same code. Treat `v0.2.0` as the only supported published build; source on `main` is work in progress. Two
known labelling defects in that release: its Docker asset is labelled `0.1.0`, and its notes predate the
current workflow. `release.yml` currently produces an intermediate **draft**; making a release public is a
separate, gated promotion, so a draft is not a release.

| Component | Version in the tree | Supported |
| --------- | ------------------- | --------- |
| Published release | `v0.2.0` (2026-11-09) | Yes — the only published build |
| Desktop app (`apps/desktop/src-tauri/tauri.conf.json:4`) | `0.2.1` | Source head; not published |
| Rust crates (`Cargo.toml:18`) | `0.2.1` | Source head; not published |

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
- **One Content-Security-Policy, on every answer the routes and the bundle produce.** The HTTP listener's
  middleware puts the same policy on `/health`, `/events`, the static bundle and the SPA fallback —
  together with `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` (the half of
  `frame-ancestors` a `<meta>` tag cannot state for itself). The one answer that does not carry it is a
  refusal the auth layer writes itself (its 401 and its 429): that layer sits outside the CSP layer so a
  preflight is answered before authentication, and the refusal is JSON. `apps/remote/index.html` declares
  the identical bytes in its `<meta http-equiv="Content-Security-Policy">`, and the desktop webview
  carries the same directives in `apps/desktop/src-tauri/tauri.conf.json` — its copy is JSON-embedded and
  names the `ipc:` and wildcard-loopback sources Tauri adds, so that surface is directive-level parity,
  not byte parity. The parity is checked, not asserted in prose: `scripts/check-wire-contract.mjs` reads
  all three surfaces and fails on a drifted directive, and the in-crate test
  `the_http_listener_sends_the_canonical_csp_and_framing_headers` reads the headers off a response the
  app itself produces. The canonical string (`crates/warshad/src/lib.rs`, `REMOTE_CSP`) is:

  ```text
  default-src 'self' data: blob:; script-src 'self' data: blob:; style-src 'self' data: blob: 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' http://127.0.0.1:8765 ws://127.0.0.1:8766 http://localhost:8765 ws://localhost:8766; frame-ancestors 'none'; form-action 'self'; object-src 'none'; base-uri 'self';
  ```

  `object-src 'none'` and `base-uri 'self'` are stated rather than left to `default-src 'self'`, so
  same-origin plugin content and a same-origin `<base>` override are refused. `'unsafe-inline'` and
  `'unsafe-eval'` are absent from `script-src`; the one `'unsafe-inline'` is in `style-src`, for Vite's
  dev-server HMR `<style>` injection.
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
  public key, a one-time secret and a 10-minute expiry
  (`crates/warsha-remote/src/lib.rs:121-128` for the struct; `:150-161` mints the 32-byte secret and
  `expires_at`; `:197-200` checks expiry). The daemon checks that expiry on use, not only at mint time:
  `devices.pair-start` writes the offer's deadline beside the secret (`crates/warshad/src/lib.rs`,
  `start_pairing`), the deadline is persisted (`crates/warsha-store/src/persistence.rs`, `save_pairing` /
  `load_pairings`, and migration `005_pairing_expiry.sql`), and `Sessions::resolve` accepts a secret only
  while `PhonePairing::is_active_at(now_epoch_secs())` holds — `!revoked && now < expires_at`
  (`crates/warshad/src/auth.rs`, `resolve`/`resolve_at`; `crates/warsha-pipeline/src/run_modes.rs`).
  `devices.pair` refuses an expired `PairingData` and writes neither a device row nor a pairing. Rows stored
  before the expiry migration are grandfathered **once** with a 10-minute grace window (the `UPDATE` in
  `005_pairing_expiry.sql`), so upgrading does not strand a phone the owner already paired; after that window
  their secret is dead unless it was minted with its own deadline.
- **Identity**: long-term device keypair with a revocable device list — **built** on the daemon side; a
  revoked pairing resolves no session even when it presents the right secret
  (`crates/warshad/src/auth.rs`, `resolve`), and the registry keeps the revoked row with
  `revoked = true` (`crates/warsha-store/src/persistence.rs`, `save_pairing` / `load_pairings`).
  Enrolling a device is the owner's act: `devices.pair` is `Owner` (tier `Pairing`), so a paired device that
  presents a caller-supplied `PairingData` is refused with `-32002`; the CLI's `warsha pair` authenticates
  with the owner token from `config.toml`, which is the supported path.
- **Handshake**: a Noise-style handshake over the `snow` crate — **not built**. The crypto stubs were
  deleted (OD-R6, KEEL K7): there is no handshake channel or relay client in the tree today. No
  session keys are derived, so nothing is encrypted end-to-end, and "the relay sees only ciphertext" is a
  frame-layout goal, not a proof about the traffic.
- **Relay**: **built as a forwarder** — `warsha-relay` checks the frame size and routes on the `to` device id,
  and has no key to decrypt with (`crates/warsha-relay/src/lib.rs:747`). Because no handshake exists, "the
  relay sees only ciphertext" is a property of the frame layout, not a proof about the traffic.
- **What the phone does today instead**: it opens the daemon's address with the bearer token, reads the token
  out of the URL immediately, and keeps it for the tab only, never in a file
  (`apps/remote/src/App.tsx:70-73`, `:108-109`). So on any network that is not your own machine, run it behind
  HTTPS or a tunnel you control.
- **Network**: `warshad` listens on loopback only by default, and dials **out** to the relay when one is
  configured; the relay binary builds, but there is no live encrypted channel for it to carry yet.

## Trust boundaries

The daemon runs on the owner's machine, and the owner is the root of trust. These are the boundaries a
caller crosses, and what enforces each one today:

- **RunCommand (the agent's shell)**: an allow-list plus a command policy, not a sandbox. The child starts
  with `env_clear()`, the trusted daemon `PATH`, a timeout and a bounded capture; arguments are not
  constrained and interpreters on the list can run arbitrary code inside the agent workspace
  (`crates/warsha-pipeline/src/command_policy.rs`, `process_spawn.rs`).
- **MCP servers**: a server is a child process or an HTTP peer. Launch goes through the pinned-launcher
  and `ProcessPolicy` checks, its environment is built not inherited, and every agent-initiated tool call
  consults the `server::tool::role` permission table (default `Ask`) before the transport
  (`crates/warsha-pipeline/src/mcp_permission.rs`, `mcp_transport.rs`).
- **Plugins**: an installed manifest is a third-party definition. Install/toggle/configure run the launch
  policy, secrets are filed in the OS keychain and resolved only for that child's spawn, and a non-stdio
  manifest may not carry a program (`crates/warshad/src/wave2.rs`, `lib.rs`).
- **Skills**: skill packs are content the agent loads into its context, not code the daemon executes; they
  are scoped by role and shipped packs are pinned and seeded disabled
  (`crates/warsha-pipeline/src/skills.rs`, `crates/warsha-core/src/plugin.rs`).
- **Remote devices**: a paired device is a session, not the owner. `pairing.list`, permission writes and
  every mutating settings RPC are `Owner`; a revoked or expired pairing is refused on its next request,
  and `/events` closes for it (`crates/warshad/src/auth.rs`, `lib.rs`).

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
`main` **or `dev`**, and `release.yml` fires on a `v*` tag (the repository has one published tag,
`v0.2.0`). Work on any other branch runs none of the above.

**Accepted advisory — RUSTSEC-2026-0459 (`libsqlite3-sys` 0.30.1).** The bundled SQLite is older than
3.54.0. The vector is local (`AV:L`, `UI:P`): it requires the victim to open a database file together
with a `-wal` written by a less trusted party. The fix needs `libsqlite3-sys >= 0.39`, which cannot be
resolved today: `sqlx-sqlite 0.9.0` caps the crate below `0.38` while `rusqlite 0.41` requires `^0.39`,
and both declare the native `links = "sqlite3"` library, so Cargo accepts only one version. The owner
accepted the risk temporarily (OD-S1c, `DECISIONS.md` 2026-11-10), and `deny.toml` carries the matching
time-boxed `[advisories].ignore` entry.

Exposure in this tree: every production SQLite open is `<data_dir>/warsha.db`, a file inside Warsha's
own data directory — daemon start-up (`crates/warshad/src/lib.rs:5465-5473`: `db_path` at 5465,
`SettingsStore::open` at 5472, `Store::open_at` at 5473), the library default
(`crates/warsha-store/src/lib.rs:196-201`) and pool open (`crates/warsha-store/src/lib.rs:205-222`),
and the settings seam (`crates/warsha-store/src/persistence.rs:365`). No RPC parameter, provider
response, model output, project path or plugin manifest selects the database path, and `data_dir` can
be changed only by the owner through daemon configuration. The residual exposure is a local process
that can already write inside that directory. The ignore entry is removed at the first of: SQLx
allowing `libsqlite3-sys 0.39+`, packet E7 landing, or the 1.0.0-rc milestone.

## Threat Model

| Threat | Mitigation in the code today |
|--------|------------------------------|
| Secret leakage | OS keychain only, configuration and secret deliberately split (`secrets.rs`), daemon errors that name no secret, gitleaks declared in CI |
| Supply chain attack | `cargo deny` and CodeQL declared in CI, `Cargo.lock`/`pnpm-lock.yaml` pinned. An SBOM is attempted only by `release.yml` (which needs a tag, and tolerates the step failing) |
| Local port hijack | Loopback bind by default (a wider `bind_host` is an owner opt-in), bearer token on every route but `/health`, `config.toml` at 0600 on Unix, single-instance lock on the data directory |
| Network interception | **Not mitigated by Warsha today.** No TLS listener, and the E2E channel is unimplemented — stay on loopback, or add HTTPS/VPN yourself |
| Malicious code execution | Owner-role check first, then the program allow-list. No container, no sandbox, no egress control |
| Unauthorized gate approval | Session identity taken from the transport, per-method policy tiers and rate ceilings, revoked or expired pairings resolve nothing, and only the owner can enrol a device. No second factor on the device |
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