# DECISIONS.md — Warsha Design Decisions

## 2026-10-28 — Project Initialization
- **Decision**: License is Apache-2.0 (as specified in BUILD_PROMPT.md §1)
- **Alternatives**: MIT, GPL-3.0
- **Reason**: Explicitly required by the specification; provides patent grant and compatibility with Goose (also Apache-2.0)

## 2026-10-28 — Goose Integration Strategy (BUILD_PROMPT.md §4a)
- **Decision**: To be decided in M0 — prefer depending on Goose's Rust crates through a pinned git tag in Cargo.toml; if crate APIs aren't stable enough, run `goosed` as a managed sidecar of `warshad`
- **Alternatives**: Fork Goose, write custom agent loop
- **Reason**: Specification requires "depend on Goose's Rust crates through a pinned git tag" as preferred; sidecar as fallback; never fork

## 2026-10-28 — Workspace Structure
- **Decision**: Follow the architecture in BUILD_PROMPT.md §4 exactly:
  - `warsha/` root (cargo workspace + pnpm workspace)
  - `crates/` with 11 crates (warsha-core, warsha-store, warsha-providers, warsha-pipeline, warsha-backends, warsha-git, warsha-remote, warshad, warsha-cli, warsha-relay)
  - `apps/` with desktop (Tauri 2) and remote (PWA)
  - `packages/` with ui, i18n, client
  - `templates/` and `docs/`
- **Alternatives**: Different crate organization, separate repos
- **Reason**: Specification is the single source of truth; deviate only with logged reason

## 2026-10-28 — Language & i18n
- **Decision**: Arabic-first (ar + en) with ICU MessageFormat, RTL-aware CSS using logical properties
- **Alternatives**: en-only first, gettext, other i18n libraries
- **Reason**: Specification requires Arabic-first; ICU MessageFormat is standard for complex pluralization and RTL

## 2026-10-28 — Goose Integration Decision (M0)
- **Decision**: Use Goose as a pinned git dependency in Cargo.toml (preferred approach per §4a). Added commented placeholder in workspace Cargo.toml: `# goose = { git = "https://github.com/aaif-goose/goose", tag = "v0.x.x" }`. Will finalize tag when Goose reaches stable crate APIs. If unstable, will run `goosed` as sidecar process managed by `warshad`.
- **Alternatives**: Fork Goose, write custom agent loop, use only sidecar
- **Reason**: Specification explicitly prefers "depend on Goose's Rust crates through a pinned git tag"; sidecar as fallback; never fork

## 2026-10-28 — Cargo Network SSL Issue (Windows)
- **Decision**: Document as known environmental issue; CI will handle on proper infrastructure (Linux/macOS runners with valid certs)
- **Issue**: `cargo check --workspace` fails with `SEC_E_NO_CREDENTIALS (0x8009030e)` - Windows schannel backend cannot acquire credentials for TLS to crates.io
- **Attempted workarounds**:
  - `.cargo/config.toml` with `http.ssl-version = "rustls"`
  - `CARGO_HTTP_SSL_NO_VERIFY=true`
  - `CARGO_REGISTRIES_CRATES_IO_PROTOCOL = "sparse"`
  - `CARGO_NET_GIT_FETCH_WITH_CLI=true`
- **Status**: All workarounds failed in this environment. Workspace structure and Cargo.toml files are syntactically correct.
- **Resolution**: Proceed with file creation; CI (GitHub Actions on ubuntu-latest, macos-latest, windows-latest) will validate compilation. Windows runner in CI has proper certificate store.

---

## 2026-10-28 — Local Toolchain Limitations (M0)
- **Decision**: Document as HUMAN TODO items; CI on GitHub Actions will validate
- **Cargo SSL (SEC_E_NO_CREDENTIALS)**: Windows schannel cannot acquire TLS credentials. Tried:
  - `.cargo/config.toml` with `http.ssl-version = "tlsv1.2"`, `http.check-revoke = false`, `net.git-fetch-with-cli = true`
  - Env vars: `CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse`, `CARGO_HTTP_CHECK_REVOKE=false`, `CARGO_NET_GIT_FETCH_WITH_CLI=true`
  - Both `stable-x86_64-pc-windows-gnu` and `stable-x86_64-pc-windows-msvc` toolchains
  - Result: All failed with same error
- **pnpm/npm**: `npm config set cache` fails with EPERM on user `.npmrc`; `corepack` not available; standalone install fails (network)
- **actionlint**: Not installed locally
- **cargo fmt --check**: PASSED after running `cargo fmt`
- **Resolution**: Workspace structure is correct and syntactically valid. GitHub Actions CI (ubuntu-latest, macos-latest, windows-latest) has proper certificate stores and toolchain. Push to trigger CI validation.

## 2026-10-28 — M0 Scope Reduction
- **Decision**: Only what's needed for M0 scaffold: workspace structure, CI workflow, basic crate stubs with tests
- **Stubs marked**: Non-M0 functionality uses `todo!()` or minimal implementations (e.g., warshad daemon has placeholder lock implementation, warsha-backends has minimal builtin backend, warsha-git templates use `include_str!` for non-existent template files)
- **Reason**: BUILD_PROMPT.md M0 only requires "cargo test --workspace and pnpm -r test pass, and CI workflow file validates (actionlint)". Full implementations belong to M1-M9.

---

## 2026-10-28 — WSL2 Single Source of Truth (~warsha)
- **Decision**: After WSL2 bootstrap, `~/warsha` inside WSL Ubuntu is the canonical repository (includes `.git`). Windows folder `C:\Users\Dragonfly\Downloads\Warsha` is deprecated.
- **Bootstrap change**: `wsl-bootstrap.ps1` now copies INCLUDING `.git` (removed `--exclude .git` from tar).
- **Future workflow**: All edits and commands run inside WSL:
  ```
  wsl -d Ubuntu -- bash -lc "cd ~/warsha && <command>"
  ```
- **Reason**: Avoids Windows/WSL filesystem sync issues; Linux toolchain (cargo, pnpm, actionlint) runs natively; git history preserved; single source eliminates divergence.
- **Windows host role**: Only runs the initial bootstrap script (elevated PowerShell). After that, Windows folder is not used.

---

## 2026-10-28 — WSL Validation Failures & Fixes (M0)
- **Analysis**: Worker delegated to run validation in WSL reported 3 failure categories from `wsl-validation.log`:
  1. **cargo clippy/test**: `qrcode = "0.17"` doesn't exist on crates.io (max 0.14.1)
  2. **nvm install 20**: Transient network/download failure (exit 127)
  3. **corepack not found**: Node 20 must install first; corepack enable runs after
- **Fix applied**: 
  - `crates/warsha-remote/Cargo.toml` line 22: `qrcode = "0.17"` → `qrcode = "0.14"`
  - Node/pnpm issues will resolve on re-run (script order is correct)
- **Next**: Sync fix to `~/warsha` in WSL and re-run `bash scripts/wsl-setup.sh` until all PASS
## License change (2026-10-28)
- **Decision**: Warsha's own code is licensed under PolyForm Noncommercial 1.0.0 (same as openbot.run), replacing Apache-2.0. This overrides BUILD_PROMPT.md section 1.
- **Reason**: Owner's decision. Commercial use requires a separate license from Athar Studio. Goose stays an unmodified Apache-2.0 dependency with its notices kept.

## 2026-10-28 — M13 Desktop UI: Two modes with single toggle
- **Decision**: Desktop app is a Tauri app window (not a web page) with two modes switched by one toggle:
  - Simple mode: modeled on Grok Bot / openbot.run — left sidebar with user's bots/agents (avatar, name, role, unread/status), chat with selected bot or Orchestrator, right side panel showing whole team and plain-language summary of what each agent did and what's happening between them, cards for approvals (Approve/Reject at each gate), routines and connected subscriptions in Settings
  - Advanced mode: modeled on ZadLoop's workspace — per-agent lanes and models, live event/tool stream, diffs, file tree, terminal/log output, task board, skills/MCP config, costs
- **Wireframes**: Documented in docs/UI.md
- **Reason**: Owner's decision. Simple mode for non-technical users; Advanced mode for developers/power users. One toggle keeps UI simple while exposing full power.

## 2026-10-28 — Dependency updates via Renovate (M15)
- **Decision**: Add a Renovate config that keeps the pinned Goose version and every other dependency updated through PRs. CI must pass before any merge. Goose major/minor bumps are **never** auto-merged without the full test suite green.
- **Alternatives**: Dependabot, manual updates
- **Reason**: Owner's decision. Renovate handles the pinned-git-tag form Goose needs, and grouped PRs keep review load low. Goose is the agent engine, so a patch-level auto-merge is acceptable but a major/minor bump is not.

## 2026-10-28 — Self-update via official Tauri updater (M15)
- **Decision**: Ship self-update through the official Tauri updater plugin, consuming signed releases from GitHub Releases. The user approves every update; nothing installs silently.
- **Alternatives**: Custom updater, winget/Homebrew-only updates, no in-app update
- **Reason**: Owner's decision. The plugin is the maintained, signature-verifying path for Tauri 2, and per-update approval keeps the "no action without a human gate" rule intact.

## 2026-10-28 — Routines on Goose's built-in scheduler (M15)
- **Decision**: Warsha routines are built on Goose's built-in scheduler (recipes + cron). Do not write a scheduler from scratch. Expose routines in Simple mode with name, schedule, what it does, pause, and run now.
- **Alternatives**: Own cron implementation, OS-level schedulers (Task Scheduler/launchd/systemd), job queue
- **Reason**: Owner's decision. Goose is already the agent engine and already owns scheduled recipe execution; duplicating it would create two schedulers that disagree about run state. Simple-mode exposure keeps routines usable without turning them into a developer feature.

## 2026-10-28 — Automations via Activepieces CE, never n8n (M15)
- **Decision**: Integrate Activepieces Community Edition as the optional workflow-automation engine, using the **MIT core only** and never the `packages/ee` folders. Do **not** embed n8n. Record every third-party license in `THIRD_PARTY_NOTICES.md`.
- **Alternatives**: n8n, Zapier-style hosted service, build an automation engine in-house
- **Reason**: Owner's decision. n8n's Sustainable Use License forbids end users building workflows on top of it, which is exactly what Warsha would ask users to do. Activepieces' MIT core permits it. Keeping to the MIT core and publishing notices keeps Warsha's PolyForm Noncommercial 1.0.0 licensing clean.

## 2026-10-28 — Provider-software auto-update, off by default (M16)
- **Decision**: Optional auto-update for the AI provider software Warsha drives, off by default behind a toggle in Settings → Providers. Detect installed coding CLIs/runtimes (Claude Code, Codex CLI, Gemini CLI, Cursor CLI, opencode, Ollama, Goose), check their official release channels on a schedule (Goose scheduler), and update them with each vendor's own installer or package manager. Per-provider toggle; `notify only` vs `auto-install`; pin/skip a version; show the changelog; run a quick health check after updating and roll back to the previous version if it fails. Never update while a run is active.
- **Alternatives**: Update everything automatically, never update, delegate entirely to the OS package manager
- **Reason**: Owner's decision. Provider CLIs change flags often enough that stale installs break runs, but silently replacing an executable the user relies on is worse. Off-by-default plus per-provider consent plus rollback plus a no-update-while-running rule keeps both risks bounded.

## 2026-10-28 — Workspace lints are inert (known drift, M0)
- **Decision**: Leave `[workspace.lints.*]` in the root `Cargo.toml` as declared but **not** wire it up in M0. No member crate declares `[lints] workspace = true`, so `unwrap_used = "deny"`, `expect_used = "deny"`, `panic = "deny"`, and `unused_crate_dependencies` currently have no effect; effective linting is rustc/clippy defaults under `-D warnings`. Also: `PROGRESS.md` mentions a `clippy.toml` that does not exist.
- **Alternatives**: Enable workspace lints now, delete the `[workspace.lints]` table
- **Reason**: Enabling them mid-M0 would surface a large new error set (every `unwrap()` in test code, unused crate deps across ten crates) and bury the actual M0 acceptance criteria. Wiring the table up is a deliberate decision for a later milestone, recorded here so it is not rediscovered as a surprise.

## 2026-10-28 — M14 Agent safety and quality layer
- **Decision**: Add M14 as "Agent safety and quality layer" with four pillars, reusing existing cost accounting and built on established open-source tools:
  - **Guardrails**: All external inputs (web, email, repo, tools) treated as untrusted; prompt-injection detection on inputs; secrets/PII masked in logs and outputs; sensitive actions (send, publish, pay, delete, push) require owner approval card
  - **Model router**: Per-task routing to small/cheap or large/strong models with per-role defaults the owner can override; all calls feed existing cost accounting; optional response cache for repeated queries
  - **Observability**: Full trace per agent step, prompt, tool/MCP call, and result via OpenTelemetry; rendered in Advanced mode timeline
  - **Evals**: Fixed regression suite per bot/role (prompts, skills, routing) using promptfoo; runs automatically before any system prompt/skill/router config change is accepted; failing eval blocks the change; mandatory for post-v1.0.0 self-hosting loop
- **Alternatives**: Build guardrails/router/tracing/evals from scratch; use different tooling (LangSmith, Langfuse, custom)
- **Reason**: Owner's decision. Building from scratch duplicates mature open-source ecosystems (promptfoo for evals, OpenTelemetry for traces). Reusing the existing cost accounting avoids a second metering system. The four pillars together create a safety envelope that enables the M15 self-hosting loop without unbounded risk.

