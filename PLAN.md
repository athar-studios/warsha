# PLAN.md — Warsha Milestones Checklist

## M0 – Repo scaffold + CI
- [ ] Cargo + pnpm workspaces from §4 exist
- [ ] LICENSE (Apache-2.0)
- [ ] README.md
- [ ] CONTRIBUTING.md
- [ ] SECURITY.md
- [ ] CODE_OF_CONDUCT.md
- [ ] AGENTS.md (created)
- [ ] PLAN.md (this file)
- [ ] PROGRESS.md
- [ ] DECISIONS.md
- [ ] GitHub Actions: fmt, clippy, test (Linux/macOS/Windows matrix for Rust), lint, typecheck, test for TS, cargo-deny, gitleaks, CodeQL
- [ ] AC: `cargo test --workspace` and `pnpm -r test` pass, and the CI workflow file validates (actionlint)

## M1 – Daemon core + state store
- [ ] `warshad` starts, holds a lock (one instance)
- [ ] Exposes JSON-RPC + WS events with a local auth token stored in the user config dir with 0600 permissions
- [ ] Serves a health endpoint
- [ ] SQLite migrations cover projects, runs, events, gates, artifacts, costs, and devices
- [ ] AC: integration tests create a project, append events, survive a daemon restart with state intact, and reject unauthenticated calls

## M2 – Provider layer
- [ ] Adapters, keychain storage, model listing, routing presets, fallback, and the cost meter, with budgets as in §5
- [ ] Ollama is auto-detected
- [ ] AC: mock-provider tests for routing, fallback on 429/5xx/timeout, budget pause, and cost math. No secret ever appears in logs (test with a canary key)

## M3 – Pipeline engine + gates
- [ ] All stages with role prompts (stored as versioned files)
- [ ] Artifact generation into `factory/`
- [ ] Gate state machine
- [ ] AC: an end-to-end test with the mock provider takes a sample idea through to Gate C with artifacts produced. Rejecting Gate B returns the run to the spec stage, and kill/restart resumes correctly

## M4 – CLI (`warsha`)
- [ ] Commands: `init`, `new "<idea>"`, `run`, `status`, `logs -f`, `gates`, `approve <gate>`, `reject <gate> --reason`, `providers add|list|test|remove`, `roles set`, `budget set`, `doctor`, `pair`, `devices list|revoke`
- [ ] Uses `--json` output for scripting, and human output follows the locale
- [ ] AC: snapshot tests for the CLI output. `warsha doctor` reports missing tools, so the whole M3 E2E can be driven from the CLI

## M5 – Desktop app (Tauri 2)
- [ ] Screens: onboarding (language, providers, GitHub), projects board (columns = stages), run view (live event stream, diffs, costs), gates inbox, artifact viewer/editor (markdown), providers and roles settings, budgets, and devices
- [ ] Bundles or spawns `warshad` as a sidecar
- [ ] AC: Playwright/WebDriver smoke tests for onboarding → new project → approve Gate A using the mock provider. Installers build in CI for all 3 OSes (unsigned)

## M6 – Remote PWA + secure pairing
- [ ] QR pairing, the E2E channel, and `warsha-relay`
- [ ] PWA works on mobile for the run list, live status, gate approve/reject with a device confirmation, chat with the current agent, and push notifications (Web Push/VAPID, keys generated locally)
- [ ] AC:
  - Crypto unit tests cover the handshake, replay protection, and revocation
  - An integration test runs daemon ↔ relay ↔ headless PWA client and approves a gate
  - The relay only ever sees ciphertext (assert on it)
  - A revoked device is rejected

## M7 – Coding backends + GitHub
- [ ] The default coder runs on the Goose engine (§4a), and a minimal built-in agent is kept only as a test double
- [ ] Adapters for opencode, OpenHands, Claude Code, Codex CLI, Gemini CLI, Cursor CLI, and dsh (experimental) each detect, run headless in the sandbox with a task prompt, collect the diff, and report usage when available
- [ ] GitHub covers repo creation from a template, issues from tasks.md, a branch + PR per task, and reading check status. Gate C triggers the merge via the API
- [ ] AC:
  - Backend adapters are tested with fake CLIs (stub binaries)
  - The GitHub flow is tested against a recorded/mocked API
  - A real-run guide sits in docs, and the templates in `templates/` include CI

## M8 – i18n ar/en + RTL
- [ ] All UI strings sit in the catalogs, with full RTL layout (logical CSS properties) and a language switch
- [ ] Agents can write artifacts in the user's chosen language
- [ ] AC: a lint fails on hardcoded UI strings, there are visual snapshot tests in both directions, and the CLI messages are localized

## M9 – Packaging, releases, docs
- [ ] Release workflow: tag → build the CLI and daemon (cargo-dist or similar) and the desktop installers (MSI/NSIS, DMG, AppImage/deb), generate checksums and an SBOM, and leave the GitHub Release as a **draft**
- [ ] Prepare manifests for winget, Homebrew, and Scoop, but don't submit them
- [ ] Code signing hooks are present but disabled without secrets
- [ ] Docs site covers quickstart (ar/en), providers, security model, the ToS note, and the architecture
- [ ] AC:
  - A dry-run release succeeds in CI
  - `warsha` installs from the built artifact and passes `warsha doctor`
  - Docs build
  - The full E2E demo with the mock provider runs from a clean machine script

## Definition of Done (v0.1.0)
- [ ] M0–M9 acceptance criteria all pass, CI is green on all three OSes, and there are no `TODO(security)` items left
- [ ] A new user can install, add one provider (API key, Ollama, or an official CLI), create a project from an idea, approve the gates from desktop, CLI, or phone, and end with a GitHub repo containing merged PRs, passing CI, and a draft release with store-listing drafts
- [ ] Secrets live only in the keychain, remote traffic is E2E encrypted, and nothing is ever published or posted without a human gate
- [ ] PROGRESS.md ends with "v0.1.0 ready" plus the human-only checklist

## Human-only steps (prepare them, list them in PROGRESS.md, don't wait on them)
- [ ] Create the GitHub org/repo, add CI secrets, enable branch protection
- [ ] Code signing certificates (Windows: e.g. SignPath/Azure Trusted Signing; macOS: Apple Developer ID + notarization)
- [ ] Store and registry accounts and submissions (winget, Homebrew, Scoop, Microsoft Store, crates.io/npm publish)
- [ ] Domain, hosting of the optional relay, and VAPID key publication
- [ ] Real-provider smoke tests with the user's own keys