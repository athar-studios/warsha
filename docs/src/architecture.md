# Architecture

High-level and detailed architecture of the Warsha AI software factory.

## Overview

Warsha follows a **modular, crate-based architecture** with clear separation of concerns:

```text
┌─────────────────────────────────────────────────────────────────┐
│                        User Interfaces                          │
├─────────────────┬─────────────────┬─────────────────────────────┤
│   Desktop App   │   Remote PWA    │        CLI (warsha)         │
│   (Tauri 2)     │   (React PWA)   │   (Rust + clap)             │
└────────┬────────┴────────┬────────┴────────────┬────────────────┘
         │                 │                     │
         ▼                 ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Daemon (warshad)                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │ JSON-RPC │ │  WebSocket│ │  Auth    │ │  Lifecycle       │   │
│  │  Server  │ │  (/events)│ │  (Token) │ │  (Lock, Signal)  │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  warsha-store   │ │ warsha-pipeline │ │ warsha-providers│
│  (SQLite + SQLx)│ │ (Engine + Gates)│ │ (Router + Adapters)│
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                      warsha-core                                 │
│  Types: Stage, GateState, Role, ProviderKind, Event, TokenUsage │
└─────────────────────────────────────────────────────────────────┘
```

## Crates

| Crate | Responsibility | Key Types |
|-------|----------------|-----------|
| `warsha-core` | Shared types, enums, constants | `Stage`, `GateState`, `Role`, `ProviderKind`, `Event`, `TokenUsage`, `CredentialsRef` |
| `warsha-store` | Persistence (SQLite + SQLx) | `Store`, migrations, CRUD for projects/runs/gates/artifacts/costs |
| `warsha-pipeline` | Pipeline engine, gates, artifacts | `PipelineEngine`, `Stage`, `GateState`, role prompts, `factory/` artifacts |
| `warsha-providers` | LLM provider abstraction | `ProviderRouter`, `ProviderKind`, `MockProvider`, cost tracking |
| `warsha-backends` | Coding agent backends | `CodingBackend` trait, `BuiltinBackend`, `CliBackend`, adapters |
| `warsha-git` | Git + GitHub types | `GitRepo`, `GitHubClient`, `ProjectTemplate`. **Nothing in the daemon or the app calls them:** no `github.*` RPC is served, and `DaemonState.github` is built from a keychain token and then never used (`crates/warshad/src/lib.rs:504`, `:3203`) |
| `warsha-relay` | Optional relay server | `RelayState`, WebSocket frame forwarding |
| `warsha-remote` | Pairing, E2E crypto, relay client | `DeviceIdentity`, `PairingData` (both in use); `EncryptedChannel` exists but its handshake is a stub — see [Security Model](security.md) |
| `warshad` | Daemon binary | HTTP/WS server, JSON-RPC methods, sidecar support |
| `warsha-cli` | CLI binary | All 15 commands, RPC client, config management |

## Data Flow

### Pipeline Execution

```text
1. warsha new "idea" 
         │
         ▼
2. warshad.start_run(project_id, idea)
         │
         ▼
3. PipelineEngine.start_run() → creates Run, emits StageStarted(Idea)
         │
         ▼
4. PipelineEngine.advance_stage() → Idea → Research
         │
         ▼
5. PipelineEngine.execute_stage(Research)
         │
         ├── fetch prompt (researcher.md)
         ├── build context (previous artifacts)
         ├── ProviderRouter.chat_with_fallback()
         ├── parse JSON output
         ├── upsert_artifact("research.md")
         ├── record_cost()
         └── emit AgentStep event
         │
         ▼
6. Continue through stages...
         │
         ▼
7. At Gate: PipelineEngine pauses, emits GatePending
         │
         ▼
8. User: warsha approve gate_a
         │
         ▼
9. warshad.approve_gate() → GateState = Approved
         │
         ▼
10. PipelineEngine.advance_stage() continues
```

### Event Streaming

```text
warshad                          Client
────────                          ──────
   │                                │
   ├── /events (WebSocket) ────────►│  (subscribes)
   │                                │
   │   Event { id, run_id, stage,   │
   │           role, kind, payload, │
   │           cost_cents, ... }    │
   ├───────────────────────────────►│
   │                                │
```

### Mobile Pairing

```text
Desktop                          Relay                          Mobile
────────                          ──────                          ──────
   │                                │                                │
   │  PairingData (QR) ────────────►│                                │
   │                                │◄──── Scan QR ─────────────────│
   │                                │                                │
   │◄──── pairing secret ──────────│──────── pairing secret ───────►│
   │                                │                                │
   │  Frame ───────────────────────►│                                │
   │                                │  Frame ───────────────────────►│
   │◄──── Frame ───────────────────│◄──── Frame ────────────────────│
```

`PairingData` carries an X25519 static public key, a one-time secret and a 10-minute expiry. The
encrypted channel is **scaffolding, not encryption**: `EncryptedChannel::process_handshake` is a
stub that returns `Ok(false)` (`crates/warsha-remote/src/lib.rs:656-659`) and no session keys are
derived, so today's frames are not end-to-end encrypted. The phone opens the daemon's address with
the bearer token instead, and on any network that is not your own machine it must sit behind HTTPS
or a tunnel the owner controls (see [Security Model](security.md)).

## Deployment

### Development

```bash
# Terminal 1: Start the daemon
cargo run -p warshad

# Terminal 2: Start the desktop app (starts its own daemon if none is reachable)
cd apps/desktop && pnpm tauri dev

# Terminal 3: Serve the remote PWA
cd apps/remote && pnpm dev
```

### Production

The repository ships the container deployment: `docker/Dockerfile`, `docker/compose.yml`,
`deploy/docker-compose.yml` and `deploy/Caddyfile` build and run the daemon behind Caddy, and the
daemon itself serves the remote bundle when `WARSHA_REMOTE_ASSETS_DIR` is set. The NSIS installer and
the signed Android APK were built and measured on the project's Windows host (`INSTALL.md` §2;
`VERIFY.md` §3–4). No release is published and no image is published to a registry; each subsection
below states what exists and what does not.

#### Daemon (systemd)

```ini
# /etc/systemd/system/warshad.service
[Unit]
Description=Warsha Daemon
After=network.target

[Service]
Type=simple
User=warsha
WorkingDirectory=/opt/warsha
# Real flags only: warshad accepts --config, --foreground, --http-port, --ws-port, --socket,
# --bind-host and --advertised-host.
# There is no --data-dir flag; the data directory is the `data_dir` key inside the config file.
ExecStart=/opt/warsha/warshad --foreground --config /etc/warsha/config.toml
Restart=on-failure
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
```

The daemon writes its own `config.toml` on first run, so a system-wide service either pre-creates that file
(`warsha init` does, with `data_dir` set to the config directory) or names one with `--config`.

#### Desktop App

**Built locally, not published.** `tauri build --bundles nsis` on the Windows host produced
`apps/desktop/src-tauri/target/release/warsha-desktop.exe` (25,215,488 B) and
`bundle/nsis/Warsha_0.2.0_x64-setup.exe` (6,864,766 B) at version `0.2.0`; `INSTALL.md` §2 records
the sizes and SHA-256 hashes and §5 the silent install/uninstall transcript. The bundler is
configured for the other formats too (`apps/desktop/src-tauri/tauri.conf.json`):

- **Windows**: MSI and NSIS — NSIS measured; MSI not built
- **macOS**: DMG (notarization needs an Apple Developer ID the owner has not provisioned)
- **Linux**: `.deb` and AppImage (`bundle.targets` is `all`) — not built

No download URL is quoted because nothing is published. See [Quickstart](quickstart.md) for the
build-from-source path.

#### Remote PWA

```bash
# Build — tsc, vite, then the service-worker post-build step
cd apps/remote && pnpm build

# dist/ is served either by warshad (WARSHA_REMOTE_ASSETS_DIR, see DEPLOY.md)
# or by any static host on the same domain.
```

The build is `tsc && vite build && node scripts/generate-service-worker.mjs`
(`apps/remote/package.json:9`). The post-build step writes `dist/sw.js` from `workbox-config.cjs`, and
the app registers it in production only — `registerShellWorker({ prod: import.meta.env.PROD })`
(`apps/remote/src/main.tsx:44`; `apps/remote/src/offline.ts:96`). A development server has no
`dist/sw.js` and registers nothing; a browser without service workers is a supported outcome, not an
error. There is still no Web Push (`apps/remote/src` contains no `PushManager` or `Notification`
code).

HTTPS is what a phone needs for installability and transport confidentiality, but not because Warsha
provides the encryption: the daemon has no TLS listener and the encrypted channel is a stub. See
[Security Model](security.md) and [`DEPLOY.md`](../DEPLOY.md).

#### Relay (Optional)

```bash
# Build
cargo build --release -p warsha-relay

# Run (these flags are real: --bind, --max-frame-size, --max-devices, --trust-device)
./target/release/warsha-relay --bind 0.0.0.0:8767
```

The relay compiles and its endpoints are tested, but there is no end-to-end channel for it to carry yet, so a
paired phone does not go through it.

### Docker Compose (Full Stack)

**Shipped in the repository.** The topology is `deploy/docker-compose.yml` with `deploy/Caddyfile`;
the image is `docker/Dockerfile`, and `docker/compose.yml` is the same topology with paths relative
to `docker/`. [`DEPLOY.md`](../DEPLOY.md) is the operating manual. In one line:

```text
Internet → host :80/:443 (+443/udp) → caddy → warsha_internal → warshad :8765/:8766
```

`warshad` has no published host port and sits on an `internal: true` network; Caddy is the only
dual-homed container and the only one that terminates TLS. The image bakes the built `apps/remote`
bundle at `/usr/share/warsha/remote` and sets `WARSHA_REMOTE_ASSETS_DIR` to it
(`docker/Dockerfile:102`, `:115`). The daemon serves that bundle from its HTTP listener — a real
file, a directory's `index.html`, the SPA history fallback, with traversal refused and `/rpc`,
`/events*` and `/health*` never answered from static serving
(`crates/warshad/src/lib.rs:5654-5655`, `:6220`). Caddy routes `/health*` and `/events*` to 8765,
`/rpc*` to 8766 and everything else to 8765 (`deploy/Caddyfile:39-66`).

The daemon still binds loopback by default; the container's `0.0.0.0` is the owner's explicit opt-in
through `WARSHA_BIND_HOST`, safe because the internal network has no route from outside. State still
lives in one `warsha.db` plus a lock file, on the `warsha-data` volume.

## Configuration

### Daemon Config (`config.toml` in the platform config directory)

The file is a flat set of keys — the `DaemonConfig` struct serialized directly
(`crates/warshad/src/lib.rs:520-590`). There are no `[data]`, `[daemon]`, `[auth]` or `[pipeline]` tables,
and the key that names the RPC port is `ws_port`, not `rpc_port`:

```toml
# Written by `warsha init`, or by the daemon itself on first run.
data_dir = "/home/user/.config/warsha"       # holds warsha.db, warshad.lock and the socket
socket_path = "/home/user/.config/warsha/warshad.sock"
http_port = 8765                             # /health, /events and the optional remote bundle
ws_port = 8766                               # JSON-RPC, POST <base>/rpc
auth_token = ""                              # the daemon generates 32 bytes on first run
allowed_origins = ["http://localhost:5173", "tauri://localhost"]

# The address both listeners bind: loopback by default, a bare IP literal.
bind_host = "127.0.0.1"
# advertised_host = "warsha.example.com"     # only needed for a wildcard bind; a bare host, no scheme
# remote_assets_dir = "/usr/share/warsha/remote"  # serve the built remote UI from http_port

# Optional, and `serde(default)` so an older file still starts the daemon.
allowed_commands = []                        # empty means DEFAULT_ALLOWED_COMMANDS, not "everything"

[rate_limits]
# per-identity inbound ceilings (security audit H-01)
```

The three address keys have environment overrides applied at startup:
`WARSHA_BIND_HOST`, `WARSHA_ADVERTISED_HOST` and `WARSHA_REMOTE_ASSETS_DIR`
(`crates/warshad/src/lib.rs:5899`, `:5902`, `:6192`). `bind_host` is a bare IP literal, not a
hostname; a wildcard bind (`0.0.0.0`, `::`) serves, but `devices.pair-start` refuses to mint a
pairing link until `advertised_host` says which address the phone should dial. The daemon has no TLS
listener, so `advertised_host` accepts a bare host with no scheme.

There is no `default_budget_cents` key: a budget is written per project through `warsha budget set` or the
app, and stored with the project's runs.

### Project Config (per-project, in project dir)

**Not implemented.** No code reads a `.warsha/config.toml`. A project's name, description and language are
rows in `warsha.db`; its budget is set through `warsha budget set <project> <cents>`; and role routing lives
in the daemon's role-routing store, edited with `warsha roles set`. The block below is what was planned, not
what is read:

```toml
# PLANNED — nothing in the workspace opens this file
[project]
name = "my-project"
budget_cents = 5000

[roles]
researcher = "openai-gpt4o:gpt-4o"
coder = "anthropic-claude:claude-3-5-sonnet"
security = "local-llama3:codellama"

[github]
enabled = true
repo_template = "warsha/template-web"
```

## Scaling Considerations

| Component | Horizontal Scaling | Notes |
|-----------|-------------------|-------|
| warshad | No (single-writer SQLite) | One per project directory |
| warsha-relay | Yes (stateless) | Add more behind load balancer |
| ProviderRouter | Yes (stateless) | Built-in fallback, no shared state |
| PipelineEngine | No (per-run) | Multiple runs in parallel OK |

## Monitoring

### Health Endpoints

- `GET http://127.0.0.1:8765/health` — daemon liveness, and the only route that needs no token
- `GET http://127.0.0.1:8765/events` — the live event feed; it requires the bearer token, which a browser
  cannot attach when opening it (see [docs/INSTALL.md](../INSTALL.md), "Not in this build yet")
- JSON-RPC is `POST <base>/rpc` on the RPC port; the typed client appends `/rpc`
  (`packages/client/src/index.ts:1338`), so the default is `http://127.0.0.1:8766/rpc`, and `warsha` uses
  that address by default (`--url`). Caddy forwards `/rpc*` to 8766; the HTTP listener on 8765 refuses
  `/rpc` rather than serving the SPA shell.

### Key Metrics

There is no metrics endpoint and no dashboard. What exists today is the daemon's own counters — refusals per
identity and per method, spent cents per run, and the rate-limit ceilings it answers with `Retry-After` — all
of which are read through the RPC methods (`budget.show`, `runs.events`, `runs.get`), not exported. Active runs,
gate state and budget utilisation are the numbers a screen shows you; a relay connection count is not
collected anywhere.

### Logs

Plain-text `tracing` output on stderr, filtered by `RUST_LOG` (`info,warshad=debug` when it is unset —
`crates/warshad/src/main.rs:9-15`):

```text
2026-01-15T10:30:00.123456Z  INFO warsha_pipeline: Gate GateA approved for run 01HXY3... by device 3f2a9c12-...
2026-01-15T10:30:00.654321Z  INFO warshad: warshad serving on http://127.0.0.1:8765 and RPC 127.0.0.1:8766
```

There is **no JSON formatter**: nothing in the workspace installs
`tracing_subscriber::fmt::format::Json`, so no log line is emitted as JSON and no log pipeline can be pointed
at one. The desktop shell writes the same plain-text format into `desktop.log` inside its data directory
(`apps/desktop/src-tauri/src/lib.rs:50`, `:298`). Structured *events* — stage, gate, cost, tool calls — are
rows in the database, not log lines; see [Security Model](security.md).