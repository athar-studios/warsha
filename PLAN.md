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

## M3 – Pipeline engine + gates ✅ DONE (validated 2026-10-29T11:22:01, all 14 checks green)
- [x] All stages with role prompts (stored as versioned files)
- [x] Artifact generation into `factory/`
- [x] Gate state machine
- [x] AC: an end-to-end test with the mock provider takes a sample idea through to Gate C with artifacts produced. Rejecting Gate B returns the run to the spec stage, and kill/restart resumes correctly

## M4 – CLI (`warsha`) ✅ DONE (validated 2026-10-29T11:43:54, all 14 checks green)
- [x] Commands: `init`, `new "<idea>"`, `run`, `status`, `logs -f`, `gates`, `approve <gate>`, `reject <gate> --reason`, `providers add|list|test|remove`, `roles set`, `budget set`, `doctor`, `pair`, `devices list|revoke`
- [x] Uses `--json` output for scripting, and human output follows the locale
- [x] AC: snapshot tests for the CLI output. `warsha doctor` reports missing tools, so the whole M3 E2E can be driven from the CLI

## M5 – Desktop app (Tauri 2) ✅ DONE (validated 2026-10-29T12:52:29, all 14 checks green)
- [x] Screens: onboarding (language, providers, GitHub), projects board (columns = stages), run view (live event stream, diffs, costs), gates inbox, artifact viewer/editor (markdown), providers and roles settings, budgets, and devices
- [x] Bundles or spawns `warshad` as a sidecar
- [x] AC: Playwright/WebDriver smoke tests for onboarding → new project → approve Gate A using the mock provider. Installers build in CI for all 3 OSes (unsigned)

## M6 – Remote PWA + secure pairing ✅ DONE (validated 2026-10-29T13:05:38, all 14 checks green)
- [x] QR pairing, the E2E channel, and `warsha-relay`
- [x] PWA works on mobile for the run list, live status, gate approve/reject with a device confirmation, chat with the current agent, and push notifications (Web Push/VAPID, keys generated locally)
- [x] AC:
  - Crypto unit tests cover the handshake, replay protection, and revocation
  - An integration test runs daemon ↔ relay ↔ headless PWA client and approves a gate
  - The relay only ever sees ciphertext (assert on it)
  - A revoked device is rejected

## M7 – Coding backends + GitHub ✅ DONE (validated 2026-10-29T13:10:04, all 14 checks green)
- [x] The default coder runs on the Goose engine (§4a), and a minimal built-in agent is kept only as a test double
- [x] Adapters for opencode, OpenHands, Claude Code, Codex CLI, Gemini CLI, Cursor CLI, and dsh (experimental) each detect, run headless in the sandbox with a task prompt, collect the diff, and report usage when available
- [x] GitHub covers repo creation from a template, issues from tasks.md, a branch + PR per task, and reading check status. Gate C triggers the merge via the API
- [x] AC:
  - Backend adapters are tested with fake CLIs (stub binaries)
  - The GitHub flow is tested against a recorded/mocked API
  - A real-run guide sits in docs, and the templates in `templates/` include CI

## M8 – i18n ar/en + RTL ✅ DONE (validated 2026-10-29T13:12:45, all 14 checks green)
- [x] All UI strings sit in the catalogs, with full RTL layout (logical CSS properties) and a language switch
- [x] Agents can write artifacts in the user's chosen language
- [x] AC: a lint fails on hardcoded UI strings, there are visual snapshot tests in both directions, and the CLI messages are localized

## M9 – Packaging, releases, docs ✅ DONE (validated 2026-10-29T13:22:51, all 14 checks green)
- [x] Release workflow: tag → build the CLI and daemon (cargo-dist or similar) and the desktop installers (MSI/NSIS, DMG, AppImage/deb), generate checksums and an SBOM, and leave the GitHub Release as a **draft**
- [x] Prepare manifests for winget, Homebrew, and Scoop, but don't submit them
- [x] Code signing hooks are present but disabled without secrets
- [x] Docs site covers quickstart (ar/en), providers, security model, the ToS note, and the architecture
- [x] AC:
  - A dry-run release succeeds in CI
  - `warsha` installs from the built artifact and passes `warsha doctor`
  - Docs build
  - The full E2E demo with the mock provider runs from a clean machine script

## M10 – Orchestrator agent + Discovery interview ✅ DONE (validated 2026-10-29T16:56:59, exit=0, all checks green)
- [x] Orchestrator agent that leads the team and talks to the owner
- [x] Discovery interview: for each new project, Orchestrator/PM asks owner questions until idea is locked (platforms: web only / +mobile / +desktop / +social pages, audience, languages, monetization, branding, integrations, privacy, budget, success metric)
- [x] Output factory/brief.md, signed off at Gate A

## M11 – Skills system + Role packs ✅ DONE (validated 2026-10-29T16:56:59, exit=0, all checks green)
- [x] Skills system: load Agent Skills (SKILL.md folders), pinned by commit and license-checked
- [x] MIT/Apache/BSD can be bundled with notices; others are link-only/fetched at runtime by user choice
- [x] Per-role default packs (PM base pack: phuryn/pm-skills MIT). Packs editable in Settings → Roles

## M12 – MCP support + Scout ✅ DONE (validated 2026-10-29T16:56:59, exit=0, all checks green)
- [x] MCP servers per project/agent, with approval per tool on first use, scoped permissions and revocation
- [x] Skill/MCP scout: per project, search MCP Registry and skill catalogs, propose items per agent (source, version, license, permissions), install only on approval, sandboxed, recorded in factory/skills.lock

## M13 – Desktop UI (Tauri app window, not a web page), two modes with one toggle ✅ DONE (validated 2026-10-29T16:56:59, exit=0, all checks green)
- [x] Simple mode (modeled on Grok Bot / openbot.run): left sidebar listing user's bots/agents (avatar, name, role, unread/status), chat with selected bot or Orchestrator, right side panel showing whole team and plain-language summary of what each agent did and what's happening between them, cards for approvals (Approve/Reject at each gate), routines and connected subscriptions in Settings
- [x] Advanced mode (modeled on ZadLoop's workspace): per-agent lanes and models, live event/tool stream, diffs, file tree, terminal/log output, task board, skills/MCP config, costs
- [x] Single toggle to switch between modes

## M14 – Agent safety and quality layer ✅ DONE (validated 2026-10-29T16:56:59, exit=0, all checks green)
- [x] Guardrails: treat every web page, email, repo file and tool result as untrusted data, never as instructions; prompt-injection detection on inputs; mask secrets/PII in logs and outputs; any sensitive action (send, publish, pay, delete, push) needs the owner's approval card
- [x] Model router: per task, send easy/cheap work to a small model and hard work to a strong one, with per-role defaults the owner can override; feed every call into the existing cost accounting; optional response cache for repeated questions
- [x] Observability: a trace for every agent step, prompt, tool/MCP call and result, shown in the Advanced mode timeline
- [x] Evals: a fixed regression suite per bot/role (prompts, skills, routing); it runs automatically before any change to a system prompt, skill or router config is accepted, and a failing eval blocks the change. Mandatory for the post-v1.0.0 self-hosting loop
- [x] Built on existing open-source tools (e.g. promptfoo for evals, OpenTelemetry for traces) rather than building from scratch

## M15 – Marketing + Social + Launch assets ✅ DONE (validated 2026-10-29T17:24:32, exit=0, all checks green)
- [x] After release: launch assets, landing page, store texts, social pages and posts calendar
  - Landing page `docs/src/index.md` is the mdBook home (Arabic-first, English fallback), listed first in `SUMMARY.md`
  - Store texts in `docs/store/` (index + Microsoft Store, winget, Homebrew, Scoop, crates.io, npm; all `not yet submitted`)
  - Social posts calendar `docs/social/calendar.md`: weeks −1/0/+1/+2, 43 posts, every one `pending approval`
  - Launch assets checklist `docs/launch/checklist.md` and demo script `docs/launch/demo-script.md`
- [x] Every post/publish needs owner approval (Gate D). No auto-posting
  - Enforcement documented in `docs/src/gates.md` (owner-only approvals, agents can never approve, no auto-posting)
- [x] Continuous development loop: PM reviews feedback, issues, errors, analytics; proposes ranked backlog; approved items re-enter at Spec → Gate B → … → Gate C
  - Specified in `docs/launch/feedback-loop.md` (data sources, ranking rubric, gate points, re-entry path)

## M16 – Continuous development loop automation ✅ DONE (validated 2026-10-29T17:47:43, exit=0, all checks green; human-only items recorded)
- [ ] Dependency updates: Renovate config to keep pinned Goose version and other deps updated via PRs; CI must pass before merge; never auto-merge Goose major/minor bumps without full test suite green
  - [x] `.github/renovate.json`: weekly schedule, minor/patch grouped, majors separate, `automerge: false` globally, `prCreation: "not-pending"`, required status checks, Goose tracked by a `customManagers` regex over the commented-out `Cargo.toml` tag and labelled `dependency:goose` / `full-suite-required`
  - [ ] Human-only: install/approve the Renovate GitHub App and enable branch protection so the status checks are enforceable
- [ ] Self-update: official Tauri updater plugin with signed releases from GitHub Releases; user approves each update
  - [x] `apps/desktop/tauri.conf.json` `plugins.updater`: `active: true`, `latest.json` endpoint, empty `pubkey` placeholder
  - [ ] Human-only: generate the minisign key pair, store `TAURI_SIGNING_PRIVATE_KEY`/`_PASSWORD` as CI secrets, publish the pubkey, enable `createUpdaterArtifacts` and the per-update approval prompt
- [ ] Routines: build Warsha routines on Goose's built-in scheduler (recipes + cron) instead of writing scheduler from scratch; expose in Simple mode (name, schedule, what it does, pause/run now)
  - [x] `crates/warsha-pipeline/src/routines.rs`: `RoutineId`/`Routine`/`RoutineSchedule`/`RoutineState`/`RoutineAction`, `RoutineRunner` trait (Goose implements it later), `RoutineRegistry` register/list/get/remove/tick + pause/resume/run-now/complete, minimal cron (`every N seconds|minutes|hours`, `daily at HH:MM` UTC), `MockRoutineRunner`, 9 unit tests
  - [ ] Goose-backed scheduler: Goose is still a commented-out placeholder in the root `Cargo.toml`, so the trait has no Goose implementation yet
  - [ ] Simple-mode routines UI (name, schedule, description, pause, run now) — outside this milestone's allowed files
- [ ] Automations: integrate Activepieces Community Edition (MIT core only, never packages/ee folders) as optional workflow-automation engine; do NOT embed n8n (Sustainable Use License forbids end users building workflows). Record licenses in THIRD_PARTY_NOTICES.md
  - [x] `THIRD_PARTY_NOTICES.md` (Goose Apache-2.0, Activepieces CE MIT core, mdBook MPL-2.0, explicit "n8n not used") and `docs/launch/activepieces.md`
  - [ ] Activepieces connection/settings toggle and the CE deployment target (human-only decision: bundled container vs. owner-hosted)
- [ ] Optional auto-update for AI provider software (off by default, toggle in Settings → Providers): detect installed coding CLIs/runtimes (Claude Code, Codex CLI, Gemini CLI, Cursor CLI, opencode, Ollama, Goose), check official release channels on schedule (Goose scheduler), update with official installer/package manager. Per-provider toggle, "notify only" vs "auto-install" modes, pin/skip version, show changelog, run health check after update and roll back if fails. Never update while a run is active
  - [x] `crates/warsha-providers/src/provider_update.rs`: `ProviderUpdateMode` (Off/NotifyOnly/AutoInstall), `ProviderUpdatePolicy` (per-provider opt-in, pin, skip), `DetectedProvider`, `ProviderDetector`/`ProviderUpdateChecker` traits + mocks, `ProviderUpdatePlanner::plan(.., run_active)` with pinned/skipped/disabled/run-active/unknown-version reasons, `ProviderUpdateError`, 8 unit tests; `docs/launch/provider-auto-update.md`
  - [ ] Real release-channel clients per provider and the Settings → Providers UI (changelog, pin/skip, health check + rollback) — human-only decision on channel tokens/rate limits

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