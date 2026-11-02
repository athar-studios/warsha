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

## Windows

The working copy is validated from WSL, but a Windows-shell install is supported and needs three
extra steps. `scripts\windows-setup.ps1` runs the install and both binary checks; run it with
`-Check` to verify an existing tree without installing:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows-setup.ps1
```

1. **Install with pnpm running on Windows.** `pnpm install` started from WSL writes POSIX shell
   scripts into `node_modules/.bin`, so `tsc`, `vite`, `vitest` and `storybook` are "not recognized"
   on Windows. The setup script installs on Windows and reports that state in one line.
2. **Import the MSVC environment** for any C tooling you run by hand — `cl curve25519.c`,
   `dumpbin /imports`, `cdb` on a crash dump. Dot-source the script so the variables stay in your
   session; it also proves the toolchain works by compiling a one-line C file:

   ```powershell
   . .\scripts\windows-msvc-env.ps1
   ```

   To check the toolchain without keeping the environment, or to run one command inside it:

   ```powershell
   pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\windows-msvc-env.ps1
   pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\windows-msvc-env.ps1 '{ cl /nologo probe.c }'
   ```

   The trailing command is passed as a quoted string with `-File` (a scriptblock when
   dot-sourcing with `-Command`); its exit code becomes the script's. The script invokes
   `System32\cmd.exe` by full path and redirects vcvars output to a temp file on purpose: a global
   npm `cmd` shim can shadow `cmd.exe` on PATH, and an MSYS layer (Git Bash) rewrites a `>nul`
   token to `/dev/null`, which cmd cannot open.

   `cargo` itself does not need it: `cc-rs` finds the toolchain on its own. `cl.exe` 14.44 does fail
   with `D8050 : cannot execute 'c1.dll'` on the C sources of `ring` when its object files go into
   this repository's `target/` directory. The `-Z7` debug switch that `cc-rs` derives from the
   profile is what triggers it, so debug info is switched off for the two crates that compile C.
   `.cargo/` is gitignored, so add this to your own `.cargo/config.toml` (Rust debug info and the C
   compiler's other defaults stay as they are):

   ```toml
   [profile.dev.package.ring]
   debug = 0
   [profile.dev.package.libsqlite3-sys]
   debug = 0
   [profile.test.package.ring]
   debug = 0
   [profile.test.package.libsqlite3-sys]
   debug = 0
   ```

   It is removable once a newer MSVC toolset is in use.
3. **Install the Playwright browser** once per machine — the package comes from `pnpm install`, the
   Chromium build it drives does not:

   ```powershell
   pnpm exec playwright install chromium
   pnpm visual   # apps/desktop/e2e + apps/remote/e2e
   ```

The docs book builds on Windows too, but `mdbook` must be the version this repository pins; an older
or mismatched build crashes with `0xC0000005` on startup:

```powershell
cargo install mdbook --version 0.5.4 --locked --force
cargo install mdbook-mermaid --version 0.17.1 --locked --force
pnpm --dir docs build
pnpm --dir docs test
```

## Contributing and security

See [CONTRIBUTING.md](../CONTRIBUTING.md) and [SECURITY.md](../SECURITY.md).

## License

PolyForm Noncommercial 1.0.0, see [LICENSE](../LICENSE). Commercial licenses: Athar Studio, contact@atharapp.download. Goose and other dependencies keep their own licenses (Goose is Apache-2.0).
