# Warsha (ورشة) — Arabic-first AI Software Factory

[![CI](https://github.com/warsha/warsha/workflows/CI/badge.svg)](https://github.com/warsha/warsha/actions)
[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-orange.svg)](LICENSE)

**Warsha** is a source-available, Arabic-first AI software factory that runs a team of AI agents to take any software idea through the complete lifecycle: **idea → research → spec → design → plan → code → test/review/security → release → launch drafts → feedback**.

## Features

- **Arabic-first (ar + en)** — Full RTL support, ICU MessageFormat, language switch
- **Multi-agent pipeline** — Specialized roles: intake, researcher, PM, designer, architect, coder, reviewer, QA, security, release, marketer, feedback
- **Mandatory human gates** — Approval required at Idea, Spec, Merge, and Publish stages
- **Bring your own models** — API keys (OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, Azure), local (Ollama, LM Studio), or official CLIs (Claude Code, Codex CLI, Gemini CLI, Cursor CLI, OpenHands)
- **Secure by default** — Secrets in OS keychain only, E2E encrypted remote access via Noise XX, sandboxed code execution
- **Desktop + CLI + Remote PWA** — Tauri 2 desktop app, `warsha` CLI, mobile PWA with QR pairing
- **GitHub integration** — Repo creation from templates, branch+PR per task, Gate C merges via API
- **Event-sourced runs** — Every step, tool call, cost, and gate decision is an append-only event

## Architecture

```
warsha/ (cargo workspace + pnpm workspace)
  crates/
    warsha-core       domain: projects, runs, stages, gates, artifacts, events
    warsha-store      SQLite (sqlx) + artifact files in <repo>/.warsha/ and factory/
    warsha-providers  provider layer: adapters, router, fallback, cost & quota meter
    warsha-pipeline   stage engine, agent roles, prompts, gate state machine
    warsha-backends   coding backends: builtin, OpenHands, Claude Code, Codex CLI, Gemini CLI, Cursor CLI
    warsha-git        git + GitHub (octocrab) integration
    warsha-remote     pairing, E2E crypto, relay client
    warshad           daemon: local API (JSON-RPC + WS) with token auth
    warsha-cli        `warsha` binary (clap)
    warsha-relay      optional relay server (axum) — opaque frame forwarding
  apps/
    desktop           Tauri 2 + React + TypeScript + Vite
    remote            PWA (React + Vite + Workbox)
  packages/
    ui                shared React components + design tokens (RTL-aware)
    i18n              ar + en message catalogs (ICU MessageFormat)
    client            generated TS client for warshad API
  templates/          project templates (web, cli, android, desktop) with CI
  docs/
```

## Quick Start

```bash
# Prerequisites: Rust 1.78+, Node.js 20+, pnpm 9+
# Clone and build
git clone https://github.com/warsha/warsha
cd warsha
cargo build --workspace --release
pnpm install

# Run daemon
./target/release/warshad

# In another terminal, run CLI
./target/release/warsha init
./target/release/warsha new "Build a todo app with offline sync"
./target/release/warsha run
```

## Documentation

- [Quickstart (English)](docs/quickstart-en.md)
- [Quickstart (Arabic)](docs/quickstart-ar.md)
- [Providers](docs/providers.md)
- [Security Model](docs/security.md)
- [Architecture](docs/architecture.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards, and pull request process.

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting and security architecture.

## License

PolyForm Noncommercial License 1.0.0. You may use, modify, and share Warsha for any noncommercial purpose. Commercial use needs a separate license from Athar Studio (contact@atharapp.download). See [LICENSE](LICENSE). Goose and other dependencies keep their own licenses (Goose is Apache-2.0); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).