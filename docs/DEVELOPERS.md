# Warsha for developers

End-user docs: [README](../README.md) · [العربية](../README.ar.md). Milestones: [PLAN.md](../PLAN.md), progress: [PROGRESS.md](../PROGRESS.md), decisions: [DECISIONS.md](../DECISIONS.md).

## Features (technical)

- **Arabic-first (ar + en)**: full RTL support, ICU MessageFormat, language switch
- **Multi-agent pipeline**: intake, researcher, PM, designer, architect, coder, reviewer, QA, security, release, marketer, feedback
- **Mandatory human gates**: Idea (A), Spec (B), Merge (C), Publish (D)
- **Bring your own models**: API keys (OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, Azure), local (Ollama, LM Studio), or official CLIs (Claude Code, Codex CLI, Gemini CLI, Cursor CLI, OpenHands)
- **Secure by default**: secrets in OS keychain only, E2E encrypted remote access via Noise XX, sandboxed code execution
- **Desktop + CLI + Remote PWA**: Tauri 2 desktop app, `warsha` CLI, mobile PWA with QR pairing
- **GitHub integration**: repo creation from templates, branch + PR per task, Gate C merges via API
- **Event-sourced runs**: every step, tool call, cost and gate decision is an append-only event

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
    warsha-relay      optional relay server (axum), opaque frame forwarding
  apps/
    desktop           Tauri 2 + React + TypeScript + Vite
    remote            PWA (React + Vite + Workbox)
  packages/
    ui                shared React components + design tokens (RTL-aware)
    i18n              ar + en message catalogs (ICU MessageFormat)
    client            generated TS client for warshad API
  templates/          project templates (web, cli, android, desktop) with CI
```

## Build from source

```bash
# Prerequisites: Rust 1.78+, Node.js 20+, pnpm 9+
git clone https://github.com/athar-studios/warsha
cd warsha
cargo build --workspace --release
pnpm install

./target/release/warshad          # daemon
./target/release/warsha init      # in another terminal
./target/release/warsha new "Build a todo app with offline sync"
./target/release/warsha run
```

## Contributing and security

See [CONTRIBUTING.md](../CONTRIBUTING.md) and [SECURITY.md](../SECURITY.md).

## License

PolyForm Noncommercial 1.0.0, see [LICENSE](../LICENSE). Commercial licenses: Athar Studio, contact@atharapp.download. Goose and other dependencies keep their own licenses (Goose is Apache-2.0).
