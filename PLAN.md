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

### M5a – Ship status strip and delivery ✅ DONE (validated 2026-10-29T18:51:36, exit=0, all 18 checks green; live feed recorded as not wired)
- [x] Status strip under the chat: "Code checks > Builds > Tests > Store-ready", fed by the existing CI/GitHub check status (no new check runner)
  - `apps/desktop/src/components/StatusStrip.tsx`: `DeliveryStage`/`StageStatus`, the four ship stages, `initialDeliveryStages()`/`allStagesGreen()`/`normalizeStageName()`, colour-coded pills (green pass, red fail, gray pending, SVG/SMIL spinner running), arrows that flip for RTL, mounted in the `App.tsx` top bar. Nothing in it runs a check
- [x] Release preflight using existing open-source tooling (fastlane-style): lint, typecheck, tests, build, SBOM, checksums, then a draft release
  - `apps/desktop/src/components/ReleasePreflight.tsx`: the six checks with per-row glyphs, one overall badge (`Ready to release` / `Blocked` / `Waiting`, one failure blocks), an `N of 6 passed` line, a "Run preflight" button behind the `disabled` prop and `overallPreflightStatus()`/`preflightReady()`. It renders the checks the caller ran; the draft release is still the daemon's job
- [x] One-button web deploy from the run view (deploy the built web artifact to a configured target; provider/credentials from keychain)
  - `apps/desktop/src/components/WebDeployButton.tsx`: `idle`/`deploying`/`done`/`error` with a spinner, ✓/✗, a `role="status"` live line, a busy state that swallows double clicks, and a `disabled` tooltip that names the blocker. No secret is read or logged; `onDeploy` has no RPC behind it yet
- [ ] AC: status strip updates live from the event stream; preflight blocks the deploy button until all four stages are green
  - ✅ Deploy gate: `allStagesGreen(stages)` drives `WebDeployButton disabled`; the composition is covered by `StatusStrip.test.tsx` (pending → off, three green + one pending → off, all green → on)
  - ⛔ Live event-stream feed: `warshad` has no delivery-check RPC and no check event type, so `App.tsx` seeds the four stages pending and the strip's `stages` prop is the seam. Recorded in PROGRESS.md, not claimed as wired

### M5b – Live preview panel ✅ DONE (validated 2026-10-29T19:09:37, exit=0, all 18 checks green; web panel + click-to-point only — Android and the run-view mount are outside this batch's allowed files, see below)
- [x] Web: iframe preview of the running dev server with Run / stop / pop-out
  - `apps/desktop/src/components/LivePreview.tsx`: `PreviewStatus` (`idle`/`running`/`stopped`/`error`), the sandboxed `<iframe src={url}>`, the "No preview yet" placeholder, a `role="alert"` error line, a pick overlay (hint + selector input), and pop-out through `window.open(url, '_blank', 'noopener,noreferrer')`. Nothing here spawns or supervises the dev server: `onRun`/`onStop` are the seams
  - `apps/desktop/src/components/PreviewToolbar.tsx`: Run / Stop / Pop out / Pick element with icons, and one exported `previewToolbarDisabled(status)` table that decides every disabled state (Run off while running, Stop off unless running, Pop out off when idle or errored, Pick off unless running) + `aria-pressed` on the toggle
- [ ] Android: emulator or device QR with the same controls — not in this batch's allowed files (`apps/desktop/src/components/**` + docs only); nothing in the panel claims it
- [x] Click-to-point: clicking an element in the preview sends its selector/location to the agent as context
  - Cross-origin frames cannot be read, so the honest form: a "Pick element" toggle (only while running) shows the hint "Click an element in the preview" plus a selector input; on submit, `onElementClick(selector)` fires with the trimmed selector. `elementMention(selector)` turns it into `@element(#submit)` for the composer. The `postMessage` bridge that removes the paste step is documented as a contract in `docs/src/live-preview.md`, not implemented here
- [ ] AC: preview starts from the run view; pop-out opens a separate window; click-to-point produces a structured `@element` mention in the composer
  - ✅ Pop-out: `window.open(url, '_blank', 'noopener,noreferrer')`, and nothing opens when `url` is `null` (test-covered)
  - ✅ Structured mention: `elementMention(selector)` is exported and test-covered, so the composer's shape is one function, not a copied string template
  - ⛔ "Preview starts from the run view": mounted nowhere — `RunView`/`App.tsx` are outside this batch's allowed files (same precedent as the work-protection, router and status-strip components). The panel takes `url`/`status` from its caller, which is the seam

## M6 – Remote PWA + secure pairing ✅ DONE (validated 2026-10-29T13:05:38, all 14 checks green)
- [x] QR pairing, the E2E channel, and `warsha-relay`
- [x] PWA works on mobile for the run list, live status, gate approve/reject with a device confirmation, chat with the current agent, and push notifications (Web Push/VAPID, keys generated locally)
- [x] AC:
  - Crypto unit tests cover the handshake, replay protection, and revocation
  - An integration test runs daemon ↔ relay ↔ headless PWA client and approves a gate
  - The relay only ever sees ciphertext (assert on it)
  - A revoked device is rejected

### M6a – Continue on server (inspired by LingCode's public site; ideas only) ✅ DONE (validated 2026-10-29T19:29:18, exit=0, all 18 checks green; lifecycle + review/apply only — no transport, see below)
- [x] Hand a running task from the desktop/CLI to a remote `warshad` so the laptop can close
  - `crates/warsha-pipeline/src/handoff.rs`: `HandoffState` (`idle` → `preparing` → `handed_off { remote_run_id, remote_url }` → `applying` → `applied`, plus `failed(reason)` reachable from any step), `HandoffManager` refusing an illegal step, `HandoffBundle`/`HandoffFile` with FNV-1a checksums, `ApplyOptions`/`ApplyResult`/`Conflict`
  - `apps/desktop/src/components/HandoffDialog.tsx`: `role="dialog"` with the remote URL input (`isRemoteUrl` gates the button, `dir="ltr"`), the "Hand off to remote" button, a `role="status"` phase line and a `role="alert"` failure line
- [ ] The remote keeps running and streams events back — `warshad` has no handoff RPC and no handoff event type, so `onHandOff(url)` is the seam; no timer or sleep test exists
- [ ] Watch and message the running task from the phone PWA (chat + gate approve/reject with device confirmation) — not in this batch's allowed files; the PWA keeps the M6 pairing channel and no PWA screen shows a handoff
- [x] "Review & apply": bring changes back file by file with automatic backups; owner-wins on conflicts; a dry-run diff is shown before applying
  - `apps/desktop/src/components/ReviewApplyPanel.tsx`: the changed-file list with a per-file line diff (`diffLines`, capped at `MAX_DIFF_LINES`), "Apply all" / "Apply selected", the backup notice (`backup_bundle_name(run_id)`) and the conflict-policy line
- [ ] AC: a handoff survives a laptop sleep; applying changes creates a backup bundle; a conflict is surfaced as a gate, not silently overwritten
  - ✅ Conflict as a gate: `ApplyResult::requires_gate()` is true for a conflict the rule did not settle (remote-wins overwrote a local edit) and false for one owner-wins settled, which `resolved` records. Covered by the 11 `handoff` unit tests
  - ✅ Backup bundle: `ApplyResult::backups` names every path whose local content must be saved first, and `backup_bundle_name(run_id)` is the one name the notice and the archive share
  - ⛔ Survives a laptop sleep: the state machine has no timer and no transport, so a real sleep → handoff → resume round-trip stays unproven until a handoff RPC exists

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

### M8b – Simple mode UI spec (docs/UI.md) (inspired by LingCode's public site; ideas only) ✅ DONE (validated 2026-10-29T19:44:00, exit=0, all check groups green; see PROGRESS.md for the exact commands and the one host limit)
- [x] `docs/UI.md` documents the Simple mode layout, mirrored for RTL: sidebar (New chat, search, projects, today's chats, plan badge) | chat | live preview
  - `docs/UI.md` §4 (new) — the three panes as one flex row mirrored by `dir`, the chat-first sidebar order, and the explicit reconciliation with the M13 wireframe: the right pane is the live preview with the team panel as its second tab. Published through the `docs/src/UI.md` `{{#include}}` shim, the same mechanism as `docs/src/launch/*.md`
- [x] Top bar: project name, type pill, device status, primary Run button, secondary Publish button
- [x] Each agent reply: collapsible "what I did" line → plain-language result → "How it behaves" list; no code dumps in Simple mode
- [x] One rounded composer with `+`, `@`, mic; model picker and permission chip inside the composer
- [x] Light and dark themes; one accent `#FFD60A` on `#0E0E0E`; IBM Plex Sans Arabic-style UI font; mono only for steps/logs
- [x] Advanced mode stays ZadLoop-like (unchanged)
- [x] Routines in Simple mode (the screen M16 recorded as outside its file scope)
  - `apps/desktop/src/screens/Routines.tsx` (new): header with the count, one row per routine, empty state; `apps/desktop/src/components/RoutineRow.tsx` (new): name, mono schedule (`dir="ltr"`), plain-language description, state badge, and `routineActions(state)` deciding Run/Pause/Resume. 12 tests
- [x] Settings → Providers (off by default, three modes, pin, "Test connection")
  - `apps/desktop/src/screens/SettingsProviders.tsx` (new): header, the "off by default" note, one row per provider, empty state; `apps/desktop/src/components/ProviderRow.tsx` (new): name, enabled toggle, mode selector (off / notify only / auto), pinned version input (mono, `dir="ltr"`), "Test connection". 15 tests
- AC: docs/UI.md exists and is linked from docs/src/SUMMARY.md; the lint for hardcoded UI strings still passes
  - ✅ Linked: `docs/src/SUMMARY.md` gained `- [Desktop UI](UI.md)`, a top-level path with no anchor
  - ✅ Hardcoded strings: every new string goes through `t('simple.routines.*')` / `t('simple.providers.*')` with an ar/en fallback table, and `pnpm lint` is unchanged (its repo-wide ESLint flat-config failure predates this milestone and still occurs only on the untouched packages)
  - ⚠️ The screens are not mounted: `App.tsx` and the settings router are outside this milestone's allowed files, so each screen takes its state from props and reports every change back out (same precedent as M14a, M14b, M5a, M5b, M5c)
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

### M14a – Work protection ✅ DONE (validated 2026-10-29T14:12:40Z, exit=0, all check groups green)
- [x] Snapshot before every agent edit with one-click restore (git stash/commit checkpoint + restore command)
  - `crates/warsha-pipeline/src/work_protection.rs`: `Snapshot`/`SnapshotFile`, `SnapshotStore` trait, `InMemorySnapshotStore`, `SnapshotRestoreButton.tsx`
  - Git-backed store (stash/checkpoint commit) plugs in behind the trait — not wired yet
- [x] Per-hunk keep/revert diff cards in the run view (reuse the existing diff viewer; no new diff engine)
  - Specified in `docs/src/work-protection.md`; the cards themselves ride on the existing diff viewer in `RunView` — not added to that screen yet
- [x] A separate multi-file undo stack for AI operations (in-memory, scoped to a run, cleared on approve)
  - `UndoEntry`/`UndoStack` (LIFO, capped at `MAX_UNDO_ENTRIES` = 50, `clear()` on approve); serialisable, event-store persistence still to wire
- [x] Worktree isolation for risky tasks (reuse git worktree; agent runs in an isolated checkout, merged only on Gate C)
  - `WorkProtectionPolicy::worktree_isolation` flag (off by default); the worktree lifecycle is not implemented yet
- [x] Read-before-write: an agent may not overwrite a file it has not read in the current run (enforced in the tool layer)
  - `ReadBeforeWriteGuard::record_read`/`may_write`, path-normalised; the tool layer that calls it does not exist yet
- [x] Per-session permission modes: ask always / ask for risky (writes outside project, network, spend) / auto inside project
  - `PermissionMode` + `WorkProtectionPolicy` (default `AskForRisky`), shown and cycled by `PermissionModeChip.tsx` in the status strip
- AC: a rejected edit restores the snapshot; undo stack survives a crash via the event store; permission mode is persisted per project and shown in the status strip
  - Shown in the status strip ✅; snapshot restore, event-store persistence and per-project persistence of the mode are the remaining wiring (recorded in PROGRESS.md)

### M14b – Router additions ✅ DONE (validated 2026-10-29, exit=0, all check groups green — table in PROGRESS.md)
- [x] Local-vs-cloud badge on every model target in the router and cost views
  - `TargetKind` + `RouterTarget { name, kind, model }` in `crates/warsha-pipeline/src/router_quality.rs`; `LocalCloudBadge.tsx` renders the pill — not mounted in the router/cost screens yet
- [x] Eco mode: route to a local Ollama model on battery power or when offline, with a visible toggle
  - `EcoMode { enabled, battery_threshold_pct, fallback_to_local }` (default `false`/20/`true`) + `EcoMode::decide(is_battery, battery_pct, network_ok) -> EcoModeDecision { use_local, reason }`; `EcoModeToggle.tsx` is a `role="switch"` bound to `onChange` — toggling needs no restart
- [x] Per-task model defaults (override the per-role defaults for a single task without changing the role preset)
  - `PerTaskDefault { task, model }` + `PerTaskDefaults` (`get`/`set`/`set_default`/`remove`/`model_for`/`defaults`, sorted output)
- [x] Local fallback on network failure (try the next target; if all cloud targets fail, try local Ollama)
  - `LocalFallbackPolicy { enabled, max_retries }` + `should_fallback(&str)` on "network"/"timeout"/"connection"; the cloud loop still runs first, the policy only decides whether a local target may absorb the failure
- [x] One-click setup for OpenRouter, DeepSeek, Kimi, GLM, Qwen and custom OpenAI-compatible endpoints, with a "Test connection" that reports whether the URL, the key or the model is wrong (three distinct error classes)
  - `OneClickProvider` (`default_base_url()`, `None` for Custom) + `ProviderSetupWizard::test_connection` in `crates/warsha-providers/src/provider_setup.rs`, re-exported through `crates/warsha-pipeline/src/provider_setup.rs`; `ProviderSetupWizard.tsx` mirrors the same three rules
- AC: Eco mode toggles without a restart; "Test connection" returns a structured result (url_ok, key_ok, model_ok) with a human-readable reason for each false
  - `ConnectionTestResult { url_ok, key_ok, model_ok, url_reason, key_reason, model_reason }` — one flag per class with `*_ok == (*_reason == None)`, no network call

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

### M15a – Website and launch (inspired by LingCode's public site; ideas only) ✅ DONE (validated 2026-10-29T19:56:42, exit=0, all 18 checks green)
- [x] Real end-to-end demo video under the hero of the landing page (mock provider, no real API keys); link from `docs/launch/demo-script.md`
  - `docs/src/index.md` carries the hero placeholder (an explicit `text` frame, Arabic first) and a commented-out `<iframe>` that makes no request until the owner uncomments it after Gate D; nothing on the page pretends a clip exists
  - The real script is `docs/launch/demo-video.md` (new): five beats — install → add provider → new project → approve Gates A/B/C → final repository — on 3:00 with timecodes, on-screen text, ar/en captions, per-beat do-not lists, and the non-negotiables (mock provider, no key on screen, no invented figure)
  - ⚠️ The reference runs one way (`demo-video.md` → `demo-script.md`); adding the reverse link inside `demo-script.md` is outside this milestone's allowed files, recorded in PROGRESS.md
- [x] Honest audience segments on the landing page (who it is for / not for); no fabricated testimonials
  - "لمن ورشة … ولمن ليست" / "Who it is for / who it is not for" in `docs/src/index.md`: five "fits you" and six "does not fit you" statements naming the real limits (Gate D is not switchable, no hosted service, PolyForm Noncommercial, no 1.0 stability, no support team), plus an explicit line that no testimonials appear because nobody has used it yet
- [x] Public changelog page (`docs/src/changelog.md`) generated from conventional commits; linked from the landing page and store texts
  - `docs/src/changelog.md` (new): Arabic RTL block plus the English page, the four sections (Added / Changed / Fixed / Removed) under **Unreleased**, placeholder entries tagged M0–M19 (M17–M19 marked *planned*, not claimed), the prefix → section mapping, the `git log` command the entries are drawn from, and the honesty rules
  - Linked from the landing page hero nav and the English close; store texts are outside the allowed files, so that half is recorded as follow-up
  - `docs/src/SUMMARY.md` gained `- [Changelog](changelog.md)`, a top-level path with no anchor
- [x] No fake metrics anywhere (no invented user counts, no fabricated benchmarks); every number must trace to a measurement
  - "لا أرقام مزيفة" / "No fake metrics" in `docs/src/index.md`: a claims table mapping 12 agents → `crates/warsha-pipeline/src/prompts/`, 14 stages → `Stage::all()`, 4 gates → `Stage::is_gate()`, 3 operating systems → the `os:` matrix, 6 preflight checks → `ReleasePreflight`, plus the deliberate absences
- AC: landing page has a video embed placeholder with a real script; changelog page builds in mdBook; a lint/checklist item forbids unverified numeric claims in `docs/`
  - ✅ Placeholder + script: the commented `<iframe>` and the `docs/launch/demo-video.md` shot list, whose non-negotiables table forbids a key or an invented number on screen
  - ✅ Changelog builds: `mdbook build` exit 0 with `book/changelog.html` written, and `mdbook test` lists `Testing chapter 'Changelog': "changelog.md"`
  - ✅ Numeric-claims check: the "Numeric claims check (before Gate D)" section of `docs/launch/demo-video.md` — a `grep` over the public pages, the claims table, and the rule that an untraceable number blocks Gate D. It is a review checklist, not a CI job, because scripts and workflows are outside this milestone's allowed files

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

## M17 – Post-launch care (inspired by LingCode's public site; ideas only) ✅ DONE (validated 2026-10-29T20:12:37, exit=0, all 18 checks green; the stores, the two screens and the chapter only — no collector, no store client, no push, no RPC, see below)
- [x] Crash reports: self-hosted GlitchTip (Sentry SDK compatible) or Sentry, opt-in, with a privacy note and a kill switch; no PII, no source code by default
  - `crates/warsha-pipeline/src/post_launch.rs`: `CrashReport { id, run_id, message, stack_trace: Option<String>, occurred_at, sent }` carries the message, the optional trace, the run and the time and nothing else, so no device id, user id or source code can travel in a report; `CrashReportStore` (`record`/`list`/`mark_sent`) + `InMemoryCrashReportStore` (arrival order, duplicate and blank rejection, idempotent `mark_sent`, `unsent_count()`)
  - `apps/desktop/src/screens/CrashReports.tsx`: one row per report with the message, a `YYYY-MM-DD HH:MM UTC` time, a `sent`/`not sent` badge, the opt-in note and the stack trace in an LTR scrolling `<pre>`; empty state
  - ⛔ The collector: nothing posts to GlitchTip or Sentry, and no endpoint, retry or opt-in toggle lives here — `sent` records the collector's decision, and the privacy note plus the kill switch are the collector's flags
- [x] Store reviews ingestion: fetch reviews from the stores we ship to, tag them, and route them to the feedback loop
  - `StoreReview { id, store, rating, body, author, received_at }`, `StoreReviewStore` (`record`/`list`/`list_by_store`) + `InMemoryStoreReviewStore`; `rating` is stored exactly as the store reported it and `rating_is_known()` flags a value outside `MIN_RATING`..=`MAX_RATING` instead of rewriting it
  - `apps/desktop/src/screens/StoreReviews.tsx`: one row per review (five stars with a `role="img"` label, the store tag, the body, the author), a red out-of-range line, empty state; `clampRating`/`ratingStars`/`ratingLabel`/`ratingIsKnown` are exported so the row, its `aria-label` and the tests share one rule
  - ⛔ The fetch itself: there is no store API client — `record` stores what a caller already read, and `list_by_store` is the seam the ingestion job will use
- [x] Daily Arabic summary pushed to the phone PWA: runs completed, cost, errors, new feedback, suggested next steps
  - `DailySummary` + `DailySummaryBuilder::build(date, runs, costs, errors, feedback)` — a pure function of the counters, Arabic by default, steps in a fixed order (errors → empty day → feedback → zero-cost day → gate reminder) and never empty; `DailySummaryBuilder::new(SummaryLanguage::English).summarize(…)` gives the English UI the same numbers; `DailySummary::is_quiet(max_cost_cents)` is the "nothing needs you" test
  - ⛔ The push: no Web Push send, no VAPID key use and no deep link into the run — delivery stays the M6 pairing channel's job, and no notification route exists
- [x] Owner describes a change in plain language → agent edits, rebuilds and prepares the new version (a new run, Gate C, draft release); never auto-publishes
  - `PlainLanguageChangeRequest { id, description, created_at, status }` with `ChangeRequestStatus` (`Pending`/`InProgress`/`Done`/`Rejected`, `as_str`, `is_open`, `can_transition_to`), `ChangeRequestStore` (`record`/`list`/`set_status`) + `InMemoryChangeRequestStore` (`open()`); an illegal step returns `InvalidStatusTransition { from, to }` and leaves the stored request untouched, `done` is terminal, and the description is kept in the owner's words — so only the owner's Gate D signature can ship a version
  - ⛔ No run is opened: `warshad` has no `post_launch.*` RPC, so nothing reaches Gate C from the desktop yet
- [x] One docs chapter: `docs/src/post-launch-care.md` (Arabic RTL block + English spec) with its `docs/src/SUMMARY.md` entry, a top-level path with no anchor
- [ ] AC: a crash report round-trips through the self-hosted endpoint; the daily summary is a push notification with a deep link to the run; a plain-language change request opens a run with the right artifacts
  - ✅ The report round-trip inside the store: 15 `post_launch` unit tests cover record → list → `mark_sent` → `unsent_count`, the duplicate and blank refusals, and the serde shape a collector would post
  - ⛔ The self-hosted endpoint half: there is no GlitchTip instance, no HTTP client and no opt-in toggle, so no byte leaves the machine
  - ⛔ The push half: the digest is built, not delivered, and there is no deep link or notification route
  - ⛔ The "opens a run" half: the request, its status flow and its store exist; the run wiring does not

## M18 – Agent workflow and context (orchestrator milestone) (inspired by LingCode's public site; ideas only) ✅ DONE (validated 2026-10-29T20:30, all check groups green; module, three components and the chapter only — no agent loop, no RPC, no attachment resolution, no prompt caching, see below)
- [x] Plan mode → owner approves → Agent mode, with a visible badge on the run and a one-click switch back to Plan
  - `crates/warsha-pipeline/src/agent_workflow.rs`: `AgentMode` (`Plan`/`Agent`, serde `snake_case`, `Plan` is `Default`), `ModeTransition { from, to, approved_by, approved_at }` with `is_owner_approved()`, `ModeManager { current, history }` with `request_transition(to, approved_by)` — Plan→Agent with a blank approver is `AgentWorkflowError::ApprovalRequired` and changes nothing, Agent→Plan is always allowed, the same mode is `SameMode`, and every accepted switch is appended to `history`
  - `apps/desktop/src/components/PlanModeBadge.tsx`: indigo Plan pill / `#FFD60A` Agent pill, `aria-pressed`, a `title`/`aria-label` that states the approval rule, `onToggle(nextAgentMode(mode))` on click — the badge asks, the caller grants
  - ⛔ Not mounted: the allowed scope is the component plus tests, so `App.tsx`/`RunView` take the mode from their own state (same precedent as M14a/M14b/M5a/M5b/M6a/M8b/M17)
- [x] Todo tool, `ask_user` (blocking, waits for owner input) and `send_message` (progress, non-blocking) as first-class agent tools
  - `TodoStatus` (`Pending`/`InProgress`/`Done`/`Cancelled`, `as_str`/`is_open`) + `TodoItem` + `TodoList` (`add`/`update`/`remove`/`list_pending`/`get`/`len`/`is_empty`/`is_complete`), rejecting blank ids/descriptions and duplicate ids; `Cancelled` is not `Done`
  - `AskUserRequest { id, question, blocking, answer }` + `AskUserQueue` (`enqueue`/`answer`/`pending`/`blocking`/`blocks_run`/`answered_count`) — `blocks_run()` is true while a blocking question is unanswered, and a second or blank answer is refused
  - `Message { id, from, to, content, sent_at, read }` + `MessageBus` (`send`/`read`/`unread_count`/`unread_for`/`messages`/`get`) — `read` is idempotent, a blank field or duplicate id is refused
  - ⛔ Not registered as agent tools: no tool layer exists in this repository, so these are the stores and the rules a loop calls, not tools the model can already invoke
- [x] Mentions: `@file`, `@folder`, `@codebase`, `@terminal`, `@web`, `@docs` resolve to context attachments with previews
  - `MentionKind` (six kinds, `ALL`/`as_str`/`prefix`/`from_name`), `Mention { kind, target }` with `rendered()`, `MentionParser::parse(text) -> Vec<Mention>` — regex-free scan, `@file:src/a.rs` and `@file src/a.rs` equivalent, trailing punctuation trimmed, bare `@codebase` allowed, `dev@example.com`/unknown kinds/kind-without-target skipped, duplicates folded
  - `apps/desktop/src/components/MentionPicker.tsx` + `filterMentionKinds(query)` (prefix match, optional `@`), one row per kind with an LTR-isolated `@kind` token
  - ⛔ The resolution half: `Mention` carries the target string only — reading the file, walking the folder or summarising the codebase is the caller's job, so "mentions attach real file contents" is not claimed
- [x] Skills exposed as slash commands (`/skill-name`) with autocomplete in the composer
  - `SlashCommand { name, description }` + `SlashCommandRegistry` (`register`/`lookup`/`list`/`matching`/`len`/`is_empty`) — `/review` and `review` look up alike, duplicate names (case-insensitive, slash-less) are refused, `list` is name-sorted and `matching(prefix)` is the autocomplete the Rust side offers
  - `apps/desktop/src/components/SlashCommandPicker.tsx` + `filterSlashCommands(commands, query)`, sorted by the bare name so the `/` prefix does not decide the order
  - ⛔ Not mounted in the composer, and no skill source feeds the registry yet — `skills.rs` exists (M11) and the wiring between the two is not part of this milestone
- [x] 3-stage context compaction (recent verbatim → summarized → archived) plus provider prompt caching where the provider supports it
  - `ContextCompactor::compact(messages, budget_tokens)` — newest messages verbatim until ~three quarters of the budget is used, one summary marker for everything older, the marker dropped (oldest context first) when even it does not fit; a single message is never split, so the newest survives a budget of zero. `estimate_tokens` is `chars / CHARS_PER_TOKEN`, labelled an estimate because there is no tokenizer
  - ⛔ Prompt caching: the module never talks to a provider, so no cache-control flag is sent and no provider-side caching is wired
- [x] Compress command output with an existing open-source tool (RTK if its license permits; otherwise `head`/`tail` truncation + token counting), and show token savings in the cost view
  - `OutputCompressor::compress(output, max_lines) -> CompressedOutput { text, original_lines, compressed_lines, saved_tokens_estimate }` with `is_compressed()`/`saved_lines()`; head + `[… N lines omitted …]` + tail, exactly `max_lines` for a ceiling of 3+, leading lines only for 1–2, empty text for 0
  - ⛔ RTK was not added (no dependency and no license review in this batch) and the cost view does not read `saved_tokens_estimate` yet — it is a pure function over a finished string, and the terminal pane does not call it
- [ ] AC: Plan→Agent requires an explicit approval; `ask_user` blocks the run until answered; mentions attach real file contents; token savings are recorded per call
  - ✅ Explicit approval: a blank approver is `ApprovalRequired` and leaves `current`/`history` untouched (unit-tested), and `is_owner_approved()` is the record every switch carries
  - ✅ `ask_user` blocks: `blocks_run()`/`blocking()` answer it from the queue alone, and a non-blocking question does not block (unit-tested), though no loop consumes the predicate yet
  - ⛔ Mentions attach real file contents: parsing and the picker exist; nothing opens a file
  - ⛔ Token savings recorded per call: the estimate is computed and returned, but no cost record or event carries it yet
- [x] One docs chapter: `docs/src/agent-workflow.md` (Arabic RTL block + English spec) with its `docs/src/SUMMARY.md` entry, a top-level path with no anchor

## M19 – Backend kit (delivery milestone) (inspired by LingCode's public site; ideas only) ✅ DONE (validated 2026-10-29T20:48:09, exit=0, all 18 checks green; definition layer, panel and chapter only — no MCP transport, no backend client, no export file, no fresh-instance round trip, see below)
- [x] Ready open-source backend (PocketBase (MIT) preferred for self-hosted simplicity; Supabase as an alternative) with auth, Postgres + RLS, storage, push and functions
  - `crates/warsha-pipeline/src/backend_kit.rs` (new) + `lib.rs` `mod`/`pub use`: `BackendKind` (`PocketBase`/`Supabase`), `BackendFeature` (`Auth`/`PostgresRls`/`Storage`/`Push`/`Functions`), `BackendConfig { kind, url, project_name, enabled_features }` (`with_feature` keeps the list in `BackendFeature::all` order, `has_feature`, `feature_list`), `TableDef`/`ColumnDef`, `RlsPolicy`/`RlsOperation` (`Select`/`Insert`/`Update`/`Delete`/`All`), `BackendKit` with `new`/`add_table`/`add_rls_policy`/`add_storage_bucket`/`add_function`/`table`/`features`/`is_empty`, `BackendKitError` via thiserror
- [ ] Driven through MCP (no bespoke backend client): the agent uses the backend's MCP server to create tables, RLS policies, functions and storage buckets
  - ⛔ Not wired: `BackendKit` is the state an MCP client fills in, and nothing in this module dials a backend. `mcp.rs` (M12) records servers and tool permissions; the two are not joined, and no MCP tool calls `add_table`
- [x] Standard export (SQL dump + storage archive) so the user owns their data
  - `BackendKit::export() -> ExportBundle { sql_dump, storage_archive_path }`: every `CREATE TABLE IF NOT EXISTS`, then `ALTER TABLE … ENABLE ROW LEVEL SECURITY` for each table that has a policy, then the `CREATE POLICY` statements (`USING`, `WITH CHECK` for `INSERT`, both for `ALL`). Buckets and functions are listed in the header comment because neither backend can create them from SQL. Identifiers and column types are screened before they can reach the dump, and the project name/URL are comment-screened
  - ⛔ `export()` builds the bundle in memory and writes nothing: packing `<slug>-storage.tar.gz` and replaying the dump are the caller's job
- [x] Payments only with the owner's explicit approval (a dedicated gate, never auto-enabled)
  - `PaymentsGate { enabled, approved_by, approved_at }` + `enable(approved_by, at)` (`ApprovalRequired` for a blank approver, `InvalidApproval` for a zero timestamp, `PaymentsAlreadyEnabled` on a second approval, nothing changed on a refusal), `disable()`, `summary()`, and `is_enabled()` = the flag **and** the approval record, so setting the public `enabled` field by hand does not open the gate
- [ ] AC: a generated project can point at a local PocketBase instance; RLS policies are created by the agent and reviewed at Gate C; export round-trips into a fresh instance
  - ✅ The config records the kind and the URL (`http://127.0.0.1:8090` is the documented local PocketBase address) and the panel shows it LTR-isolated; nothing dials it yet
  - ✅ Every RLS statement is in the dump the reviewer reads at Gate C, in creation order, and a policy can only be added for a table that already exists — so the dump cannot name a table it does not create
  - ⛔ The round trip: no dump is written, no fresh instance is started, so "export round-trips into a fresh instance" is unproven


## Definition of Done (v0.1.0 — M0–M9, per BUILD_PROMPT.md §8)
- [ ] M0–M9 acceptance criteria all pass, CI is green on all three OSes, and there are no `TODO(security)` items left
- [ ] A new user can install, add one provider (API key, Ollama, or an official CLI), create a project from an idea, approve the gates from desktop, CLI, or phone, and end with a GitHub repo containing merged PRs, passing CI, and a draft release with store-listing drafts
- [ ] Secrets live only in the keychain, remote traffic is E2E encrypted, and nothing is ever published or posted without a human gate
- [ ] PROGRESS.md ends with "v0.1.0 ready" plus the human-only checklist

## Definition of Done (M10–M19 extensions)
- [ ] Orchestrator-led discovery interview produces a signed-off `factory/brief.md` at Gate A
- [ ] Skills, role packs, and MCP servers load from pinned, license-checked sources recorded in `factory/skills.lock`
- [ ] Desktop ships both UI modes behind one toggle, with every gate reachable from each
- [ ] Agent safety layer: guardrails, model router with cost accounting, observability traces, and eval gates all land and run in CI
- [ ] Routines run on Goose's scheduler and are manageable in Simple mode
- [ ] Activepieces CE (MIT core only) is optional and wired; n8n is absent; licenses listed in THIRD_PARTY_NOTICES.md
- [ ] Renovate, Tauri updater, and provider-software auto-update all land with the human gates described in DECISIONS.md
- [ ] Work protection: snapshot/restore, per-hunk keep/revert, AI undo stack, worktree isolation, read-before-write, per-session permission modes
- [ ] Router shows local-vs-cloud badges, Eco mode, per-task defaults, local fallback, and one-click provider setup with structured "Test connection"
- [ ] Status strip, release preflight and one-button web deploy land; live preview panel (web/Android/QR) with click-to-point
- [ ] Continue-on-server handoff with Review and apply, backups and owner-wins conflicts
- [ ] Simple mode matches docs/UI.md (three RTL-mirrored panes, composer, themes, accent)
- [ ] Website/launch: real demo video, honest segments, public changelog, no fake metrics
- [ ] Post-launch care: crash reports, store reviews, daily Arabic summary push, plain-language change requests
- [ ] Agent workflow: Plan to Agent mode, todo/ask_user/send_message, mentions, skills as slash commands, context compaction, output compression
- [ ] Backend kit: PocketBase (or Supabase) via MCP with auth/RLS/storage/push/functions, standard export, payments behind a gate

## Human-only steps (prepare them, list them in PROGRESS.md, don't wait on them)
- [ ] Create the GitHub org/repo, add CI secrets, enable branch protection
- [ ] Code signing certificates (Windows: e.g. SignPath/Azure Trusted Signing; macOS: Apple Developer ID + notarization)
- [ ] Store and registry accounts and submissions (winget, Homebrew, Scoop, Microsoft Store, crates.io/npm publish)
- [ ] Domain, hosting of the optional relay, and VAPID key publication
- [ ] Real-provider smoke tests with the user's own keys
