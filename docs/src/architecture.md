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
   │                                │                                │
   │                                │◄──── Scan QR ─────────────────│
   │                                │                                │
   │◄──── handshake ───────────────│──────── handshake ────────────►│
   │                                │                                │
   │  EncryptedFrame ──────────────►│                                │
   │                                │  EncryptedFrame ─────────────►│
   │                                │                                │
   │◄──── EncryptedFrame ──────────│◄──── EncryptedFrame ───────────│
```

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

Nothing below is produced today: no release is published, no container image exists, and no installer has
been built on this host. These are the deployment shapes the code supports or is meant to support, each
labelled.

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
# Real flags only: warshad accepts --config, --foreground, --http-port, --ws-port and --socket.
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

**Planned, not produced.** The bundler is configured (`apps/desktop/src-tauri/tauri.conf.json:35-69`) and
would emit these formats, at the current version `0.2.0`:

- **Windows**: MSI and NSIS installers via the Tauri bundler — needs a Windows host with MSVC plus WiX/NSIS;
  this project's development host is Linux on arm64, so it cannot produce them
- **macOS**: DMG (notarization needs an Apple Developer ID the owner has not provisioned)
- **Linux**: `.deb` and AppImage — `bundle.targets` is `all`, and the declared `deb` dependencies are Ubuntu or
  Debian WebKitGTK package names, but no package has been built or installed on this host

No size, no file name and no download URL is quoted for any of them, because none exists. See
[Quickstart](quickstart.md) for the only path that works today: build from source.

#### Remote PWA

```bash
# Build
cd apps/remote && pnpm build

# Serve the dist/ folder from any static host
```

Two corrections to what this section used to say:

- The build is `tsc && vite build` only. A `workbox-config.js` file exists in `apps/remote`, but no script
  runs it and nothing calls `navigator.serviceWorker`, so **there is no offline service worker today** — and
  therefore no Web Push either (`apps/remote/src` contains no `PushManager` or `Notification` code).
- HTTPS is still what you want for a phone reaching a daemon over a real network, but not because Warsha
  provides the encryption: it doesn't. See [Security Model](security.md).

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

**Not available.** No `warsha/*` container image is published, and no `Dockerfile` or compose file exists in
this repository, so the following plan cannot be run and is kept here only as the intended shape:

```yaml
# PLANNED — no image exists, nothing below can be pulled today
version: '3.8'
services:
  warshad:
    image: warsha/warshad:latest
    ports:
      - "8766:8766"
    volumes:
      - warsha-data:/data
    environment:
      - RUST_LOG=info

  warsha-relay:
    image: warsha/warsha-relay:latest
    ports:
      - "8767:8767"

  remote:
    image: warsha/remote:latest
    ports:
      - "3000:80"
    depends_on:
      - warsha-relay

volumes:
  warsha-data:
```

Note also that a containerised daemon would fight the two properties the code depends on: it binds
`127.0.0.1` only, and it keeps its state in one `warsha.db` plus a lock file.

## Configuration

### Daemon Config (`config.toml` in the platform config directory)

The file is a flat set of keys — the `DaemonConfig` struct serialized directly
(`crates/warshad/src/lib.rs:147-196`). There are no `[data]`, `[daemon]`, `[auth]` or `[pipeline]` tables,
and the key that names the RPC port is `ws_port`, not `rpc_port`:

```toml
# Written by `warsha init`, or by the daemon itself on first run.
data_dir = "/home/user/.config/warsha"       # holds warsha.db, warshad.lock and the socket
socket_path = "/home/user/.config/warsha/warshad.sock"
http_port = 8765                             # /health and /events
ws_port = 8766                               # JSON-RPC, at the root path
auth_token = ""                              # the daemon generates 32 bytes on first run
allowed_origins = ["http://localhost:5173", "tauri://localhost"]

# Optional, and `serde(default)` so an older file still starts the daemon.
allowed_commands = []                        # empty means DEFAULT_ALLOWED_COMMANDS, not "everything"

[rate_limits]
# per-identity inbound ceilings (security audit H-01)
```

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
- JSON-RPC is served at the **root** of the RPC port, `http://127.0.0.1:8766/` — there is no `/rpc` path, and
  `warsha` uses that address by default (`--url`)

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