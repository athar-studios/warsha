# BUILD PROMPT — Warsha (ورشة): a source-available AI Software Factory

You are an autonomous senior engineering team building **Warsha** from an empty repository to a released v0.1.0. You work alone, for many hours, across many sessions. **Never ask the human questions.** When something is ambiguous, pick the simplest sensible default, record it in `DECISIONS.md`, and keep going. Stop only for the items in "Human-only steps" below, and even then continue with everything else.

## 1. Product summary
Warsha is a generic, standalone, Arabic-first (ar + en) desktop/CLI/remote product. It runs a team of AI agents that takes any software idea through the stages **idea → research → spec → design → plan → code → test/review/security → release → launch drafts → feedback**. It has mandatory human approval gates. Users bring their own model access (API keys, local models, or official coding CLIs). Warsha is not tied to any specific company, account, or cloud.

Names:
- Rust core library: `warsha-core`.
- Daemon: `warshad`.
- CLI binary: `warsha`.
- Desktop app: "Warsha" (Tauri 2).
- Remote companion: "Warsha Remote" (PWA).
- License: **PolyForm Noncommercial 1.0.0** (owner decision 2026-10-28, replaces Apache-2.0; see LICENSE and DECISIONS.md).

## 2. Operating rules (follow always)
1. **Persistent memory.** At the start of every session, read `PLAN.md`, `PROGRESS.md`, `DECISIONS.md`, and `AGENTS.md`, then continue from the first unchecked item. Before your context fills or the session ends, update `PROGRESS.md` with what you did, the current state, and the exact next step.
2. **No questions.** Decide, log it in `DECISIONS.md` (date, decision, alternatives, reason), and move on.
3. **Milestone discipline.** Work M0→M9 in order. A milestone is done only when every one of its acceptance criteria passes locally **and** in CI. Never start the next milestone with red CI.
4. **Small commits.** Use Conventional Commits, one logical change each, and push often. Work on `main` through short-lived branches and PRs if a remote exists; otherwise commit locally.
5. **Tests first where practical.** Every module ships with unit tests. Cross-component flows get integration tests. Never delete or skip a failing test to go green; fix the cause.
6. **Self-review before every merge.** Re-read the diff for bugs, security problems, dead code, and missing tests. Run `cargo fmt`, `cargo clippy -D warnings`, `pnpm lint`, `pnpm typecheck`, and all tests.
7. **Cost discipline.** Prefer reading code over re-generating it. Don't paste huge files into context, and don't loop retries more than 3 times on the same failure. Instead, write the blocker to `PROGRESS.md` under "Blocked", pick the next unblocked task, and come back later. Keep dependencies minimal.
8. **Stay in the sandbox.** Never touch files outside the repo. Never push with `--force` to `main`. Never publish packages, create releases on public registries, or send messages. Prepare them and list them under "Human-only steps" in `PROGRESS.md`.
9. **Docs as you go.** Each milestone updates `README.md` and the `docs/` page for that feature.

## 3. Security rules (non-negotiable)
- Store secrets (API keys, tokens) **only** in the OS keychain through the `keyring` crate: Windows Credential Manager, macOS Keychain, or Secret Service/libsecret. Never put them in config files, logs, the DB, crash reports, or git. Redact secrets in all logs.
- **No ToS-violating subscription reuse.** Do NOT implement extraction or replay of consumer OAuth tokens (e.g. reusing Claude Pro/Max or ChatGPT Plus sessions as an API). Subscriptions are supported **only** by launching the vendor's official CLI as a subprocess under the user's own login, or through officially documented third-party OAuth. A user-supplied "custom OpenAI-compatible endpoint" is allowed, with a clear warning in the UI.
- Remote access is **end-to-end encrypted**:
  - Pair the devices with a QR code that carries a one-time pairing secret.
  - Run a Noise XX handshake (`snow` crate) or libsodium-style X25519 + XChaCha20-Poly1305.
  - Use a long-term device keypair, with a revocable device list.
  - The relay is untrusted and forwards opaque frames only. `warshad` dials **out** to the relay and never opens inbound ports by default.
  - The relay must be optional; direct LAN/Tailscale mode is also supported.
- Agents execute code only inside a sandbox: a Docker container per run when Docker exists, otherwise a git worktree with a restricted env and no inherited secrets except the ones explicitly scoped. Default network is allowed only for package registries and model APIs (document it).
- Gates that cause irreversible effects (merge to main, release, publish, any spend above budget, any public post) require explicit human approval. Remote approvals require a device-local confirmation (PIN/biometric via WebAuthn where available). Agents can never approve gates.
- Run `cargo audit`, `cargo deny`, `pnpm audit`, CodeQL (or equivalent), and gitleaks in CI.

## 4. Architecture (defaults; deviations go in DECISIONS.md)
```
warsha/ (cargo workspace + pnpm workspace)
  crates/
    warsha-core/       domain: projects, runs, stages, gates, artifacts, events
    warsha-store/      SQLite (sqlx, migrations) + artifact files in <repo>/.warsha/ and factory/ docs
    warsha-providers/  provider layer: adapters, router, fallback, cost & quota meter
    warsha-pipeline/   stage engine, agent roles, prompts, gate state machine
    warsha-backends/   coding backends: builtin agent, OpenHands, Claude Code, Codex CLI, Gemini CLI, Cursor CLI
    warsha-git/        git + GitHub (octocrab) integration: repos, branches, issues, PRs, checks
    warsha-remote/     pairing, E2E crypto, relay client
    warshad/           daemon binary: local API (JSON-RPC over Unix socket / named pipe + localhost HTTP/WebSocket with token)
    warsha-cli/        `warsha` binary (clap)
    warsha-relay/      tiny optional relay server (axum) — opaque frame forwarding
  apps/
    desktop/           Tauri 2 + React + TypeScript + Vite; talks to warshad
    remote/            PWA (React + Vite + Workbox); talks to warshad via relay or direct
  packages/
    ui/                shared React components + design tokens (RTL-aware)
    i18n/              ar + en message catalogs (ICU MessageFormat)
    client/            generated TS client for the warshad API (from OpenAPI/JSON schema)
  templates/           project templates (web, cli, android, desktop) with CI, tests, factory/ folder
  docs/
```
- **Single engine.** Desktop, CLI, and Remote are thin clients. All state and logic live in `warshad`, and the CLI can auto-spawn it.
- **Event-sourced runs.** Every agent step, tool call, cost, and gate decision is an append-only event, so the UIs stream events over WebSocket.
- **Artifacts** are markdown in the user's project repo under `factory/`: `idea.md`, `research.md`, `prd.md`, `spec.md`, `constitution.md`, `design.md`, `plan.md`, `tasks.md`, `review.md`, `qa.md`, `release.md`, `launch.md`, `feedback.md`. Follow the spirit of spec-driven development (constitution → specify → plan → tasks → implement).


## 4a. Agent engine base: Goose (dependency, not a fork)
- Use **Goose** (https://github.com/aaif-goose/goose, Apache-2.0, Rust) as the default agent loop and tool runtime. Do not write your own agent loop from scratch.
- **Integration (decide in M0, log it in DECISIONS.md):**
  - Preferred: depend on Goose's Rust crates through a pinned git tag in `Cargo.toml`.
  - If the crate APIs aren't stable enough to embed, run `goosed` (Goose's server) as a managed sidecar of `warshad` and talk to its HTTP API.
  - In both cases, isolate it behind the `AgentBackend` trait in `warsha-backends` so Goose stays swappable.
- **Do NOT fork.** Keep upstream untouched. If a patch is required, put it in `patches/`, write it up in DECISIONS.md, and draft it as an upstream PR (don't submit it).
- **What Warsha keeps from Goose:** the agent loop, tool calling, MCP extensions, provider adapters where usable, and session handling.
- **What Warsha adds on top:** the stages and gates engine, the `factory/` artifacts, per-role routing/fallback/budgets (the Warsha provider layer can feed Goose's provider config), event store, E2E remote, GitHub flow, release adapters, and the ar/en UI.
- **Additional backends via adapters (M7):** opencode (`opencode` server/CLI, MIT), Codex CLI (`codex exec`, Apache-2.0), Claude Code, Gemini CLI, Cursor CLI, OpenHands Agent SDK/server, and DeepSeek Harness (`dsh`, MIT, developer preview, so it's marked experimental).
- **License hygiene:** add the Goose NOTICE and attribution, and keep THIRD_PARTY_NOTICES.md generated by `cargo about` or `cargo deny`.

## 5. Provider layer requirements
- Provider kinds:
  1. **API key**: OpenAI, Anthropic, Google Gemini, DeepSeek, OpenRouter, Azure OpenAI, any OpenAI-compatible base URL.
  2. **Local**: Ollama, LM Studio (OpenAI-compatible).
  3. **Agent CLI backends**: Claude Code (`claude -p`), Codex CLI (`codex exec`), Gemini CLI, Cursor CLI, OpenHands (headless/REST). Detect whether each is installed and logged in, and use it as a backend for the Coder role.
- One internal trait: `ChatProvider { stream_chat, list_models, health, cost_of(usage) }`. Use native adapters for OpenAI-compatible APIs, Anthropic, and Gemini. Keep it simple; LiteLLM may be supported as an optional external endpoint, not a hard dependency.
- **Role routing.** Each role (intake, researcher, pm, designer, architect, coder, reviewer, qa, security, release, marketer, feedback) maps to an ordered list of `provider/model` targets, with sensible presets: cheap, balanced, and max-quality. The reviewer defaults to a different model family than the coder when one is available.
- **Fallback.** On rate-limit, quota exhaustion, 5xx, or timeout, move to the next target with exponential backoff, and record the fallback as an event.
- **Cost and quota.** Use a price table (a versioned JSON the user can edit) and record tokens and cost per call, stage, run, and project. Support budgets per project and per day, with a soft warning at 80%. A hard stop at 100% pauses the run and opens a "budget" gate.
- Ship a mock provider (deterministic) used by all tests and CI. CI never calls real model APIs.

## 6. Pipeline & gates
- Stages: Idea → **Gate A (idea)** → Research → PRD+Spec → **Gate B (spec)** → Design → Plan/Tasks → Code (one branch + PR per task, parallelism configurable, default 2) → Review + QA + Security (loop back to Code on failure, max N iterations) → **Gate C (merge to main)** → Release (build artifacts, changelog, store-listing drafts, checklist) → **Gate D (publish)** → Launch drafts (never auto-post) → Feedback ingestion → new ideas.
- Gate state machine: `pending → approved | rejected(reason) | changes_requested(notes)`. Every gate decision records who, which device, and when.
- An optional "domain reviewer" gate is human-only, for sensitive content (medical, legal, religious, and so on).
- Stages are resumable and idempotent: a crash mid-run resumes from the last committed event.

## 7. Milestones & acceptance criteria
For every milestone: tests pass, CI is green, the docs are updated, PROGRESS.md is updated, and a tag `m<N>` is created locally.

**M0 – Repo scaffold + CI**
- The cargo + pnpm workspaces from §4 exist, plus LICENSE (PolyForm Noncommercial 1.0.0), README, CONTRIBUTING, SECURITY.md, CODE_OF_CONDUCT, AGENTS.md, PLAN.md, PROGRESS.md, DECISIONS.md.
- GitHub Actions: fmt, clippy, test (Linux/macOS/Windows matrix for Rust), lint, typecheck, test for TS, cargo-deny, gitleaks, CodeQL.
- AC: `cargo test --workspace` and `pnpm -r test` pass, and the CI workflow file validates (actionlint).

**M1 – Daemon core + state store**
- `warshad` starts, holds a lock (one instance), exposes JSON-RPC + WS events with a local auth token stored in the user config dir with 0600 permissions, and serves a health endpoint.
- SQLite migrations cover projects, runs, events, gates, artifacts, costs, and devices.
- AC: integration tests create a project, append events, survive a daemon restart with state intact, and reject unauthenticated calls.

**M2 – Provider layer**
- Adapters, keychain storage, model listing, routing presets, fallback, and the cost meter, with budgets as in §5. Ollama is auto-detected.
- AC: mock-provider tests for routing, fallback on 429/5xx/timeout, budget pause, and cost math. No secret ever appears in logs (test with a canary key).

**M3 – Pipeline engine + gates**
- All stages with role prompts (stored as versioned files), artifact generation into `factory/`, and the gate state machine.
- AC: an end-to-end test with the mock provider takes a sample idea through to Gate C with artifacts produced. Rejecting Gate B returns the run to the spec stage, and kill/restart resumes correctly.

**M4 – CLI (`warsha`)**
- Commands: `init`, `new "<idea>"`, `run`, `status`, `logs -f`, `gates`, `approve <gate>`, `reject <gate> --reason`, `providers add|list|test|remove`, `roles set`, `budget set`, `doctor`, `pair`, `devices list|revoke`.
- It uses `--json` output for scripting, and human output follows the locale.
- AC: snapshot tests for the CLI output. `warsha doctor` reports missing tools, so the whole M3 E2E can be driven from the CLI.

**M5 – Desktop app (Tauri 2)**
- Screens: onboarding (language, providers, GitHub), projects board (columns = stages), run view (live event stream, diffs, costs), gates inbox, artifact viewer/editor (markdown), providers and roles settings, budgets, and devices.
- It bundles or spawns `warshad` as a sidecar.
- AC: Playwright/WebDriver smoke tests for onboarding → new project → approve Gate A using the mock provider. Installers build in CI for all 3 OSes (unsigned).

**M6 – Remote PWA + secure pairing**
- QR pairing, the E2E channel, and `warsha-relay`. The PWA works on mobile for the run list, live status, gate approve/reject with a device confirmation, chat with the current agent, and push notifications (Web Push/VAPID, keys generated locally).
- AC:
  - Crypto unit tests cover the handshake, replay protection, and revocation.
  - An integration test runs daemon ↔ relay ↔ headless PWA client and approves a gate.
  - The relay only ever sees ciphertext (assert on it).
  - A revoked device is rejected.

**M7 – Coding backends + GitHub**
- The default coder runs on the Goose engine (§4a), and a minimal built-in agent is kept only as a test double.
- Adapters for opencode, OpenHands, Claude Code, Codex CLI, Gemini CLI, Cursor CLI, and dsh (experimental) each detect, run headless in the sandbox with a task prompt, collect the diff, and report usage when available.
- GitHub covers repo creation from a template, issues from tasks.md, a branch + PR per task, and reading check status. Gate C triggers the merge via the API.
- AC:
  - Backend adapters are tested with fake CLIs (stub binaries).
  - The GitHub flow is tested against a recorded/mocked API.
  - A real-run guide sits in docs, and the templates in `templates/` include CI.

**M8 – i18n ar/en + RTL**
- All UI strings sit in the catalogs, with full RTL layout (logical CSS properties) and a language switch. Agents can write artifacts in the user's chosen language.
- AC: a lint fails on hardcoded UI strings, there are visual snapshot tests in both directions, and the CLI messages are localized.

**M9 – Packaging, releases, docs**
- Release workflow: tag → build the CLI and daemon (cargo-dist or similar) and the desktop installers (MSI/NSIS, DMG, AppImage/deb), generate checksums and an SBOM, and leave the GitHub Release as a **draft**. Prepare manifests for winget, Homebrew, and Scoop, but don't submit them. Code signing hooks are present but disabled without secrets.
- Docs site covers quickstart (ar/en), providers, security model, the ToS note, and the architecture.
- AC:
  - A dry-run release succeeds in CI.
  - `warsha` installs from the built artifact and passes `warsha doctor`.
  - Docs build.
  - The full E2E demo with the mock provider runs from a clean machine script.

## 8. Definition of done (v0.1.0)
- M0–M9 acceptance criteria all pass, CI is green on all three OSes, and there are no `TODO(security)` items left.
- A new user can install, add one provider (API key, Ollama, or an official CLI), create a project from an idea, approve the gates from desktop, CLI, or phone, and end with a GitHub repo containing merged PRs, passing CI, and a draft release with store-listing drafts.
- Secrets live only in the keychain, remote traffic is E2E encrypted, and nothing is ever published or posted without a human gate.
- PROGRESS.md ends with "v0.1.0 ready" plus the human-only checklist.

## 9. Human-only steps (prepare them, list them in PROGRESS.md, don't wait on them)
- Create the GitHub org/repo, add CI secrets, enable branch protection.
- Code signing certificates (Windows: e.g. SignPath/Azure Trusted Signing; macOS: Apple Developer ID + notarization).
- Store and registry accounts and submissions (winget, Homebrew, Scoop, Microsoft Store, crates.io/npm publish).
- Domain, hosting of the optional relay, and VAPID key publication.
- Real-provider smoke tests with the user's own keys.

## 10. First actions in session 1
1. Create PLAN.md (copy §7 as checklists), PROGRESS.md, DECISIONS.md, AGENTS.md (§11).
2. Execute M0. Commit. Continue to M1 without waiting.

## 11. AGENTS.md (create this file in the repo)
```markdown
# AGENTS.md — rules for any AI agent working on Warsha
- Read PLAN.md, PROGRESS.md, DECISIONS.md first; update PROGRESS.md before you stop.
- Never ask questions; decide, log in DECISIONS.md, continue.
- Rust: stable toolchain, `cargo fmt`, `cargo clippy -D warnings`, no `unwrap()` in non-test code, errors via `thiserror`/`anyhow`.
- TS: strict mode, pnpm, ESLint + Prettier, no `any`.
- Tests with every change; CI must be green before merging or moving milestones.
- Secrets only via OS keychain; never log secrets; no consumer-OAuth token reuse.
- No network calls to real model APIs in tests — use the mock provider.
- Never publish, release (non-draft), push --force to main, or post anything.
- Small Conventional Commits; self-review every diff.
- UI strings only via i18n catalogs (ar + en), RTL-safe CSS (logical properties).
```
