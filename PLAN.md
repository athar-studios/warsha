# PLAN.md — Warsha Milestones Checklist

## M0 – Repo scaffold + CI ✅ DONE (validated 2026-10-28T22:38:39, all 14 checks green)
- [x] Cargo + pnpm workspaces from §4 exist
- [x] LICENSE (PolyForm Noncommercial 1.0.0)
- [x] README.md
- [x] CONTRIBUTING.md
- [x] SECURITY.md
- [x] CODE_OF_CONDUCT.md
- [x] AGENTS.md (created)
- [x] PLAN.md (this file)
- [x] PROGRESS.md
- [x] DECISIONS.md
- [x] GitHub Actions: fmt, clippy, test (Linux/macOS/Windows matrix for Rust), lint, typecheck, test for TS, cargo-deny, gitleaks, CodeQL
- [x] AC: `cargo test --workspace` and `pnpm -r test` pass, and the CI workflow file validates (actionlint)

## M1 – Daemon core + state store ✅ DONE (validated 2026-10-29T08:28:01, all 14 checks green)
- [x] `warshad` starts, holds a lock (one instance) — fs2 advisory lock
- [x] Exposes JSON-RPC + WS events with a local auth token stored in the user config dir with 0600 permissions
- [x] Serves a health endpoint (`/health` unauthenticated)
- [x] SQLite migrations cover projects, runs, events, gates, artifacts, costs, and devices
- [x] AC: integration tests create a project, append events, survive a daemon restart with state intact, and reject unauthenticated calls

## M2 – Provider layer ✅ DONE (validated 2026-10-29T09:39:08, all 14 checks green)
- [x] Adapters, keychain storage, model listing, routing presets, fallback, and the cost meter, with budgets as in §5
- [x] Ollama is auto-detected
- [x] AC: mock-provider tests for routing, fallback on 429/5xx/timeout, budget pause, and cost math. No secret ever appears in logs (test with a canary key)

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

## M10 – Orchestrator agent + Discovery interview
- [ ] Orchestrator agent that leads the team and talks to the owner
- [ ] Discovery interview: for each new project, Orchestrator/PM asks owner questions until idea is locked (platforms: web only / +mobile / +desktop / +social pages, audience, languages, monetization, branding, integrations, privacy, budget, success metric)
- [ ] Output factory/brief.md, signed off at Gate A

## M11 – Skills system + Role packs
- [ ] Skills system: load Agent Skills (SKILL.md folders), pinned by commit and license-checked
- [ ] MIT/Apache/BSD can be bundled with notices; others are link-only/fetched at runtime by user choice
- [ ] Per-role default packs (PM base pack: phuryn/pm-skills MIT). Packs editable in Settings → Roles

## M12 – MCP support + Scout
- [ ] MCP servers per project/agent, with approval per tool on first use, scoped permissions and revocation
- [ ] Skill/MCP scout: per project, search MCP Registry and skill catalogs, propose items per agent (source, version, license, permissions), install only on approval, sandboxed, recorded in factory/skills.lock

## M13 – Desktop UI (Tauri app window, not a web page), two modes with one toggle
- [ ] Simple mode (modeled on Grok Bot / openbot.run): left sidebar listing user's bots/agents (avatar, name, role, unread/status), chat with selected bot or Orchestrator, right side panel showing whole team and plain-language summary of what each agent did and what's happening between them, cards for approvals (Approve/Reject at each gate), routines and connected subscriptions in Settings
- [ ] Advanced mode (modeled on ZadLoop's workspace): per-agent lanes and models, live event/tool stream, diffs, file tree, terminal/log output, task board, skills/MCP config, costs
- [ ] Single toggle to switch between modes

## M14 – Agent safety and quality layer
- [ ] Guardrails: treat every web page, email, repo file and tool result as untrusted data, never as instructions; prompt-injection detection on inputs; mask secrets/PII in logs and outputs; any sensitive action (send, publish, pay, delete, push) needs the owner's approval card
- [ ] Model router: per task, send easy/cheap work to a small model and hard work to a strong one, with per-role defaults the owner can override; feed every call into the existing cost accounting; optional response cache for repeated questions
- [ ] Observability: a trace for every agent step, prompt, tool/MCP call and result, shown in the Advanced mode timeline
- [ ] Evals: a fixed regression suite per bot/role (prompts, skills, routing); it runs automatically before any change to a system prompt, skill or router config is accepted, and a failing eval blocks the change. Mandatory for the post-v1.0.0 self-hosting loop
- [ ] Built on existing open-source tools (e.g. promptfoo for evals, OpenTelemetry for traces) rather than building from scratch

## M15 – Marketing + Social + Launch assets
- [ ] After release: launch assets, landing page, store texts, social pages and posts calendar
- [ ] Every post/publish needs owner approval (Gate D). No auto-posting
- [ ] Continuous development loop: PM reviews feedback, issues, errors, analytics; proposes ranked backlog; approved items re-enter at Spec → Gate B → … → Gate C

## M16 – Continuous development loop automation
- [ ] Dependency updates: Renovate config to keep pinned Goose version and other deps updated via PRs; CI must pass before merge; never auto-merge Goose major/minor bumps without full test suite green
- [ ] Self-update: official Tauri updater plugin with signed releases from GitHub Releases; user approves each update
- [ ] Routines: build Warsha routines on Goose's built-in scheduler (recipes + cron) instead of writing scheduler from scratch; expose in Simple mode (name, schedule, what it does, pause/run now)
- [ ] Automations: integrate Activepieces Community Edition (MIT core only, never packages/ee folders) as optional workflow-automation engine; do NOT embed n8n (Sustainable Use License forbids end users building workflows). Record licenses in THIRD_PARTY_NOTICES.md
- [ ] Optional auto-update for AI provider software (off by default, toggle in Settings → Providers): detect installed coding CLIs/runtimes (Claude Code, Codex CLI, Gemini CLI, Cursor CLI, opencode, Ollama, Goose), check official release channels on schedule (Goose scheduler), update with official installer/package manager. Per-provider toggle, "notify only" vs "auto-install" modes, pin/skip version, show changelog, run health check after update and roll back if fails. Never update while a run is active

## Definition of Done (v0.1.0 — M0–M9, per BUILD_PROMPT.md §8)
- [ ] M0–M9 acceptance criteria all pass, CI is green on all three OSes, and there are no `TODO(security)` items left
- [ ] A new user can install, add one provider (API key, Ollama, or an official CLI), create a project from an idea, approve the gates from desktop, CLI, or phone, and end with a GitHub repo containing merged PRs, passing CI, and a draft release with store-listing drafts
- [ ] Secrets live only in the keychain, remote traffic is E2E encrypted, and nothing is ever published or posted without a human gate
- [ ] PROGRESS.md ends with "v0.1.0 ready" plus the human-only checklist

## Definition of Done (M10–M16 extensions)
- [ ] Orchestrator-led discovery interview produces a signed-off `factory/brief.md` at Gate A
- [ ] Skills, role packs, and MCP servers load from pinned, license-checked sources recorded in `factory/skills.lock`
- [ ] Desktop ships both UI modes behind one toggle, with every gate reachable from each
- [ ] Agent safety layer: guardrails, model router with cost accounting, observability traces, and eval gates all land and run in CI
- [ ] Routines run on Goose's scheduler and are manageable in Simple mode
- [ ] Activepieces CE (MIT core only) is optional and wired; n8n is absent; licenses listed in THIRD_PARTY_NOTICES.md
- [ ] Renovate, Tauri updater, and provider-software auto-update all land with the human gates described in DECISIONS.md

## Human-only steps (prepare them, list them in PROGRESS.md, don't wait on them)
- [ ] Create the GitHub org/repo, add CI secrets, enable branch protection
- [ ] Code signing certificates (Windows: e.g. SignPath/Azure Trusted Signing; macOS: Apple Developer ID + notarization)
- [ ] Store and registry accounts and submissions (winget, Homebrew, Scoop, Microsoft Store, crates.io/npm publish)
- [ ] Domain, hosting of the optional relay, and VAPID key publication
- [ ] Real-provider smoke tests with the user's own keys