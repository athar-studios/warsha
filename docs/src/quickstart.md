# Quickstart

Get Warsha running from source. **There is nothing to download yet**: this repository has no git tag and
no published release, so every "download the installer" instruction you might expect here — a
`releases/latest/download/...` URL, a `.dmg`, a `.deb`, an `.msi` — would end in a 404. What runs today is
what you build from the source tree, and the honest way to get a working install in about five minutes is
below.

If you only want to see the app, [build it and run it](#build-the-binaries) and then follow
[First run: adding your provider key](first-run.md), which is the guide for entering a key through the
app's own screens.

## Build the binaries

The published clone URL is not decided yet: this checkout's remote is the development repository
`athar-studios/warsha-dev`, whose default branch is `main`, while the product repository
`athar-studios/warsha` — named only in the *historic* updater configuration that has since been removed
from the shipped `tauri.conf.json` (`plugins: {}`, see [Known limitations](known-limitations.md)) — is a
separate repo. *Which one readers should clone is an owner decision.* Use the one you have access to:

```bash
git clone https://github.com/athar-studios/warsha-dev
cd warsha-dev
cargo build --workspace --release
```

The two programs land in `target/release/`: `warshad` (the daemon) and `warsha` (the CLI). To put them on
your `PATH`, install them one at a time — `cargo install` takes a single `--path` per invocation, so a
command naming two of them is refused:

```bash
cargo install --path crates/warshad
cargo install --path crates/warsha-cli
```

The desktop app is a separate toolchain: Node 20 or newer (CI tests on 20; the Linux host this work is
validated on runs v22.23.2), the pinned pnpm 9 from `package.json`, and the Rust toolchain Tauri drives. On
a host where Corepack cannot activate at the workspace root, call the pinned manager as
`npx pnpm@9.0.0 ...` — every plain `pnpm` below means exactly that:

```bash
pnpm install
pnpm --filter warsha-desktop tauri dev     # the desktop window, with the daemon started inside it
```

Bundled installers are **planned, not produced** — with one measured exception: the Windows NSIS
package was built, installed and verified on the 2026-11-05 ship run, as [docs/INSTALL.md](../INSTALL.md)
§§2–5 records. The file names a Tauri bundle would create at the current
version (`0.2.0`, from `apps/desktop/src-tauri/tauri.conf.json`) are:

| Platform | File the bundler would produce | Status |
|---|---|---|
| Windows | `Warsha_0.2.0_x64_en-US.msi`, `Warsha_0.2.0_x64-setup.exe` | NSIS built, silently installed and verified on a Windows host 2026-11-05 ([docs/INSTALL.md](../INSTALL.md) §§2–5, [docs/VERIFY.md](../VERIFY.md) §4); MSI not built in that run |
| macOS | `Warsha_0.2.0_*.dmg` — the suffix is the target arch the bundler is given | not built — needs macOS and an Apple signing identity |
| Linux | `warsha_0.2.0_amd64.deb`, `warsha_0.2.0_amd64.AppImage` | not built on this host (it is arm64, and the bundles above are x86_64) |

No byte size is quoted on this page: the measured sizes and SHA-256 hashes of the 2026-11-05 `0.2.0`
Windows artifacts live in [docs/INSTALL.md](../INSTALL.md) §2, and the one open hash disagreement
between that table and the `PROGRESS.md` ledger is flagged — with the re-measurement instruction — in
[docs/VERIFY.md](../VERIFY.md) §4.3.

The installed desktop program is `warsha-desktop.exe` (the NSIS installer file itself is named
`Warsha_<version>_x64-setup.exe`). **No auto-updater is configured**: the shipped
`apps/desktop/src-tauri/tauri.conf.json` sets `bundle.createUpdaterArtifacts: false` and `plugins: {}`,
so no updater plugin runs and no updater artifacts are built — to get a new version you build or install
one, as [docs/VERIFY.md](../VERIFY.md) describes how to check.

## Start the daemon

The CLI is a client: it calls the daemon and answers `Not connected to daemon` if nothing is listening. So
start the daemon first, in its own terminal.

```bash
warshad --foreground
```

`warshad` accepts exactly these five flags — there is no `--data-dir`, no `--port` and no `--verbose`:

| Flag | Meaning |
|---|---|
| `--config <path>` | which `config.toml` to read; the first run creates it with a fresh 32-byte token |
| `--foreground` | accepted, and today it is also the only mode: true daemonization is not implemented, so the process stays in the terminal either way |
| `--http-port <port>` | the HTTP port (`/health`, `/events`); default 8765 |
| `--ws-port <port>` | the JSON-RPC port; default 8766 — yes, the RPC surface is the `ws_port`, that is the flag's name |
| `--socket <path>` | overrides `socket_path` in the config file |

Both servers bind `127.0.0.1` only. The data directory is a `data_dir` **key inside `config.toml`**, not a
command-line flag; `warsha init` writes it.

## First project from the terminal

### 1. Initialize the configuration

```bash
warsha init
```

This writes `config.toml` into your platform's configuration directory
(`~/.config/warsha/` on Linux, `%APPDATA%\warsha\` on Windows) and sets `data_dir` to that same directory.
It does not create a database: `warsha.db` appears when the **daemon** starts, in `data_dir`.

Optionally set the language key at the same time — `warsha init --lang ar` is accepted, and today the
argument is recorded nowhere; the language the daemon hands to new projects is the one each call carries.

### 2. Add an AI provider

A provider needs a key, and `providers.add` puts that key in the OS keychain under the provider's name. The
CLI takes the name and the kind as positional arguments, and refuses to add a provider with no key:

```bash
# warsha providers add <name> <kind> --key <the key>
warsha providers add main-account openai --key <your-openai-key>
warsha providers add sonnet anthropic --key <your-anthropic-key>
warsha providers add local ollama --key placeholder    # the CLI demands a key even for local kinds
```

The kinds the daemon understands are `anthropic` (also matched by `claude`), `ollama` (also matched by
`lm studio`), and anything else as an OpenAI-compatible endpoint — so `openai`, `open_router`,
`deep_seek`, `kimi`, `glm`, `qwen` and `custom` all build an OpenAI-compatible client, each with its own
default base URL. There is no `--name`, no `--budget` and no `--base-url` flag on this command. Note what
that means for a local model: `providers add` has no way to say "no key", so it files whatever string you
pass in the keychain anyway, and Ollama never sends it anywhere. For a local provider — or for any key you
do not want in your shell history or in `ps` output — use the desktop app's first-run screen instead: see
[First run: adding your provider key](first-run.md).

```bash
warsha providers list
warsha providers test main-account    # one id at a time; there is no "test all"
warsha providers remove main-account
```

### 3. Create a project and start a run

```bash
warsha new "Build a todo app with React, TypeScript, and Vite" -n todo-app
```

This creates the project and starts a run at the **Idea** stage, and prints both ids. The `-n` name is
optional (without it the project is called `New Project`); the `-t/--template` flag is accepted and
currently ignored.

### 4. Watch it

```bash
warsha status                      # every project, one per line
warsha status todo-app             # the runs of one project
warsha status --run <run-id>       # one run: its stage and status
warsha run todo-app                # prints the first run's stage; it does not start a run
warsha logs <run-id>               # the run's recorded events
```

## Running the pipeline

The pipeline advances stage by stage and stops at each **Gate** for your decision:

```text
Idea → Gate A → Research → PRD Spec → Gate B → Design → Plan Tasks → Code → Review/QA/Security → Gate C → Release → Gate D → Launch Drafts → Feedback
```

### Approve gates

`gates`, `approve`, `reject` and `logs` all name a run. There is no "every pending gate in the whole
account" list on the CLI: it is a per-run read.

```bash
warsha gates <run-id>                          # that run's four gates and their states

warsha approve <run-id> gate_a                 # gate: gate_a | gate_b | gate_c | gate_d (a/b/c also accepted)
warsha reject <run-id> gate_b --reason "PRD needs more detail"
```

`--reason` is required on `reject`, and there is no `--changes` flag — asking for changes is its own
decision (`gates.changes`) on the RPC, which the CLI does not expose yet.

### Follow a run live

`warsha logs <run-id> --follow` prints the events it already has and then says
`Following... (WebSocket not implemented)` — the flag exists, the live tail does not. Today the live feeds
are the desktop app's own polling and the `/events` route on the daemon's HTTP port, which a browser cannot
open with the `Authorization` header it requires (see
[docs/INSTALL.md](../INSTALL.md), "Not in this build yet").

### Budget

Budgets are counted in **cents** and set per project — the daemon writes the ceiling onto that project's
runs, and a run that reaches it is paused (`RunStatus::Paused`) with a `BudgetExceeded` event, and warned at
80%:

```bash
warsha budget show todo-app            # spent / budget / percent used
warsha budget set todo-app 5000        # 5000 cents = $50.00
```

There is no `warsha providers budget` command: a per-provider monthly ceiling is not something the daemon
stores. Role routing is real, and takes one comma-separated list of `provider:model` targets:

```bash
warsha roles list
warsha roles set researcher main-account:gpt-4o
warsha roles set coder sonnet:claude-3-5-sonnet,main-account:gpt-4o
```

`--fallback` and `--budget` are not flags on `roles set` — fallback is on by default in what the CLI sends,
and a per-role `budget_cents_per_run` is a field the CLI never fills in.

### Check the machine

```bash
warsha doctor
```

This prints whether the daemon answers `/health`, and whether `git`, `docker`, `node`, `pnpm`, `rustc` and
`cargo` are on your `PATH`, plus which coding-agent CLIs it found (`claude`, `codex`, `gemini`, `cursor`,
`openhands`, `opencode`). It is a report, nothing more: Warsha does not use Docker, and finding a CLI there
does not mean a run will call it.

## Desktop App

If you installed the desktop app:

1. Launch Warsha from your applications menu
2. Complete onboarding (language, providers, GitHub)
3. Create projects visually on the kanban board
4. Approve gates with one click
5. View artifacts with syntax highlighting

Steps 3-5 describe the screens as designed; whether each one completes against a running daemon is open
work tracked separately, and [Known limitations](known-limitations.md) says which parts of this document
describe a screen that exists but is not yet wired end to end.

## Remote PWA

Pair your mobile device:

1. Open desktop app → Devices → Pair New Device
2. Scan QR code with mobile browser
3. Approve gates and chat with agents from the phone

There are **no push notifications** on any platform: although the built app now registers a real
service worker (`apps/remote/src/main.tsx` → `registerShellWorker`, with `dist/sw.js` generated by
`apps/remote/scripts/generate-service-worker.mjs` and browser-proved by
`node apps/remote/scripts/verify-pwa.mjs --browser`, exit 0 on 2026-11-05 — see
[docs/VERIFY.md](../VERIFY.md) §3.1), the app requests no notification permission and uses no
`PushManager`, so your phone will never be told anything by itself — you open the app to see the app.
And the pairing channel is not end-to-end encrypted yet; see [Security Model](security.md).

## Next Steps

- [First run: adding your provider key](first-run.md) — the app-UI path, keychain, what is never logged
- [Known limitations](known-limitations.md) — what fails today, and where
- [دليل المستخدم بالعربية](user-guide.ar.md) — the same first steps in Arabic
- [Configure Providers](providers.md) — Add more AI providers
- [Security Model](security.md) — Understand the threat model
- [Architecture](architecture.md) — Learn how it works under the hood
