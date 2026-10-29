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
| `warsha-git` | Git + GitHub integration | `GitRepo`, `GitHubClient`, `ProjectTemplate` |
| `warsha-relay` | Optional relay server | `RelayState`, WebSocket frame forwarding |
| `warsha-remote` | Pairing, E2E crypto, relay client | `DeviceIdentity`, `PairingData`, `EncryptedChannel` |
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
# Terminal 1: Start daemon
cargo run -p warshad

# Terminal 2: Start desktop
cd apps/desktop && pnpm tauri dev

# Terminal 3: Start remote PWA
cd apps/remote && pnpm dev
```

### Production

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
ExecStart=/opt/warsha/warshad --data-dir /var/lib/warsha
Restart=on-failure
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
```

#### Desktop App

- **Windows**: MSI/NSIS installer via Tauri bundler
- **macOS**: DMG with notarization
- **Linux**: AppImage + .deb

#### Remote PWA

```bash
# Build
cd apps/remote && pnpm build

# Deploy to static hosting (Netlify, Vercel, GitHub Pages)
# Requires HTTPS for Service Workers + Web Push
```

#### Relay (Optional)

```bash
# Build
cargo build --release -p warsha-relay

# Run
./warsha-relay --bind 0.0.0.0:8767
```

### Docker Compose (Full Stack)

```yaml
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

## Configuration

### Daemon Config (`~/.config/warsha/config.toml`)

```toml
[data]
dir = "/home/user/.config/warsha"

[daemon]
http_port = 8766
rpc_port = 8766

[auth]
# token = "auto-generated"  # or set explicitly

[pipeline]
default_budget_cents = 10000  # $100

[providers]
# Configured via CLI/desktop
```

### Project Config (per-project, in project dir)

```toml
# .warsha/config.toml
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

- `GET /health` — Daemon liveness
- `GET /rpc` — JSON-RPC endpoint (POST only)

### Key Metrics

- Active runs
- Gate pending count
- Budget utilization
- Provider latency/error rates
- Relay connection count

### Logs

Structured JSON logging via `tracing`:

```json
{"timestamp":"2026-01-15T10:30:00Z","level":"INFO","target":"warshad","message":"Gate approved","gate":"gate_a","device":"dev-1","run_id":"01H..."}
```