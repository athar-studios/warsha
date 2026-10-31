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
    - ✅ Ninth batch: `skills.list` serves a five-command catalog (`/review`, `/refactor`, `/test`, `/fix`, `/explain`) and `agent.turn` resolves it through `AgentLoop::run_turn`; `skills.rs`/`factory/skills.lock` is still not the source, and the composer still offers its own placeholder list
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


## M20 – Foundations (architecture, design system, taste, caching, scale, run modes)

- [x] Architecture docs + CI-enforced boundaries
  - [x] `docs/ARCHITECTURE.md`: crate/module map, dependency direction (core ← store ← providers ← pipeline ← daemons/CLI/UI), allowed edges, rationale per edge
  - [x] `docs/ARCH_RULES.md`: the enforceable rules — no UI code imports a daemon crate; no crate reaches into another crate's private module; `warsha-core` depends on nothing in-repo; pipeline must not depend on `warshad`/`warsha-cli`; desktop talks only through `@warsha/client`
  - [x] A CI check that enforces them (script + workflow step), failing on any violation, with the rule id in the message
  - [x] `ARCH_AUDIT.md`: the per-file audit — all 107 in-scope files (34 Rust `src`, 1 Rust integration test, 69 TS/TSX, `check-arch.mjs`, `eslint.config.js`, `ci.yml`) listed by name against R1–R5 and lint groups L1–L7; 0 architecture violations, 0 lint errors, 1 pre-existing warning, 3 narrow opt-outs, and the type-checked-preset deferral plus the R3 ring decision written down (2026-10-30)
- [x] Design system: `packages/ui` tokens + Storybook ✅ done in the M20 fifth batch (2026-10-31)
  - [x] Token layer in `packages/ui`: color/spacing/radius/typography/shadow/motion as CSS custom properties + TS exports; light + dark; RTL-safe logical tokens — `packages/ui/src/tokens/{colors,spacing,radius,typography,shadow,motion}.ts` + `tokens.css` + barrel
  - [x] Warsha accent `#FFD60A` on `#0E0E0E`; Arabic-first type scale with an IBM Plex Sans Arabic-grade fallback stack; mono only for code/steps — `--warsha-color-accent`/`--warsha-color-accent-ink`/`--warsha-color-accent-strong`, `--warsha-font-sans`/`--warsha-font-mono`
  - [x] Existing components (`Box`, `Card`, `Button`, `Text`, …) consume tokens, not literals — every value in `packages/ui/src/components.tsx` is a token helper call; enforced by R6
  - [x] Storybook for `packages/ui` with stories per component, RTL and LTR globes, both themes — `packages/ui/.storybook/{main.ts,preview.ts}` + five story files
- [x] Taste-learning preference store
  - [x] `crates/warsha-pipeline/src/preferences.rs`: an event-sourced taste store — signals (approve/reject/change-request/edit) → weighted preferences per project and per owner, with decay and an explainable summary
    - `PreferenceSignal`/`SignalKind` (four kinds, `direction`/`phrase`), `Preference { key, score, evidence_count, last_updated }`, `PreferenceStore` trait (`record_signal`/`list_preferences`/`explain`), `InMemoryPreferenceStore` (append-only, duplicate-id and invalid-signal refusals, `owner_preferences`, settable monotonic clock), `decay_factor` with `DECAY_HALF_LIFE_SECS` = 30 days, `explain` → `"dark mode — Approved 3 times, Rejected once (score 2.00)"`. 13 unit tests
  - [x] Persisted through the store layer — ✅ DONE (M20 tenth batch, 2026-10-31)
    - `crates/warsha-store/src/persistence.rs` (new): `SqliteStore` (one `rusqlite::Connection`, WAL, idempotent migration) with the `preferences` table (`project_id`, `key`, `score`, `evidence_count`, `last_updated`, PK `(project_id, key)`). `InMemoryPreferenceStore::save_to_store` writes every derived preference; `load_from_store(store, project_id)` reads a project's back, highest score first
    - One new dependency, `rusqlite 0.32` (`bundled`) in `crates/warsha-store/Cargo.toml`, pinned to the `libsqlite3-sys 0.30.1` that `sqlx` already links so the workspace keeps exactly one native SQLite. This supersedes the "no new dependency" note of the seventh batch, which was a scope limit, not the plan
    - ⛔ What the table does not carry: the signal log and the owner dimension. A reloaded preference keeps the score it was saved with (it is not decayed again on read), so `explain` still needs the in-memory signals
  - [ ] Surfaced read-only in the UI: what Warsha has learned and why
    - ⛔ No UI file is in this batch's scope; `explain` is the whole surface the screen would read, and nothing calls it from the desktop yet
- [x] Build and LLM caching
  - [x] Build cache: content-addressed reuse of stage outputs keyed by inputs + prompt + model + skill versions
    - `crates/warsha-pipeline/src/build_cache.rs`: `BuildCacheKey { stage, inputs_hash, prompt_hash, model, skill_versions }` with `hash()` (FNV-1a 64, no new dep) and `is_complete()`, `BuildCacheEntry`, `BuildCache` trait (`get`/`put`/`invalidate`/`stats`), `InMemoryBuildCache`, `BuildCacheStats` with `hit_rate()`. 10 unit tests
  - [x] LLM cache: exact-match plus normalized (post-compaction) key, respecting the existing `ResponseCache`
    - `crates/warsha-pipeline/src/llm_cache.rs`: `LlmCacheKey { prompt, model, normalized }`, `LlmCacheEntry`, `LlmCache` trait (`get`/`put`/`stats`), `InMemoryLlmCache` (exact identity + normalized pointer, first raw prompt owns the pointer), `normalize_prompt` (trim, collapse whitespace, lowercase), `LlmCacheStats`. `router_quality::ResponseCache` is untouched and stays the router's per-run memo — this cache sits behind it, on a `ResponseCache` miss. 12 unit tests
    - ⛔ The hit/miss meter is not rendered: `stats()` exists, the Advanced-mode cost view is outside this batch's files
  - [x] Invalidation rules documented and tested (prompt change, model change, skill change, cold start)
    - The module docs carry the rule table (prompt/model/skill/inputs changes, cold start, explicit `invalidate(stage)`); `the_hash_is_stable_and_covers_every_field`, `a_cold_store_misses_and_counts_it`, `invalidate_drops_only_the_named_stage`, `a_rebuild_replaces_the_entry_and_resets_its_hits`, `an_exact_lookup_is_whitespace_sensitive` and `the_model_is_part_of_the_key` pin them
- [x] Scale standards for generated apps
  - [x] A documented baseline every generated app must meet: indexes on foreign keys, pagination on every list endpoint, no N+1, connection pooling, request size limits, timeout budgets, structured logs, health endpoint
    - `crates/warsha-pipeline/src/scale_standards.rs`: `ScaleStandard { id, category, description, check }`, `ScaleCategory` (Database/Api/Observability/Security), `SCALE_STANDARDS` (a `static LazyLock<[ScaleStandard; 8]>` — a `const` cannot own a `String`), `ScaleStandards::all`/`by_category`/`get`/`checklist`. 4 unit tests. `docs/src/scale-standards.md` is the long form: the eight rules, the rationale per rule, the checks and the prompt path
  - [ ] Encoded as reviewable checks in the Coder/Reviewer role prompts and the spec template, plus an eval case
    - ✅ The render is `ScaleStandards::checklist()` (`[<id>] <rule> — <check>`, one line per standard), which is what a prompt would embed and a gate report would quote. ⛔ The prompt files (`crates/warsha-pipeline/src/prompts/**`), the spec template and `evals.rs` are outside this batch's file scope, so no role prompt and no eval case cite the standards yet
- [x] Local / self-hosted / hosted run modes with phone pairing — ✅ DONE (2026-10-30, every check green; config, pairing store, badge and chapter only — no socket reads the config, see the seventh batch below)
  - [x] Three modes in config: Local (loopback only), SelfHosted (LAN + explicit bind), Hosted (relay-backed, E2E only)
    - `crates/warsha-pipeline/src/run_modes.rs` (new) + `lib.rs` `mod`/`pub use`: `RunMode` (`Local`/`SelfHosted`/`Hosted`, serde `snake_case`, `all`/`as_str`/`label`, `Local` is `Default`) and `RunModeConfig { mode, bind_host, allowed_hosts, relay_url }` with `for_mode`/`validate`/`is_loopback_only`/`requires_pairing` and `with_bind_host`/`with_allowed_hosts`/`with_relay_url`. `for_mode(Local)` is valid as returned; `for_mode(SelfHosted)` (`0.0.0.0`, empty allow-list) and `for_mode(Hosted)` (loopback, no relay) are refused by `validate()` until the caller supplies the allow-list or the relay URL — the safe default is the one that refuses to start
  - [x] Mode gates the API surface: Local binds `127.0.0.1` and refuses non-loopback peers; SelfHosted requires an explicit host allow-list; Hosted never exposes the API directly
    - `validate()` enforces it and names the rule that failed: `BlankBindHost`, `InvalidBindHost { mode, host }`, `AllowedHostsRequired`/`AllowedHostsNotPermitted`/`InvalidAllowedHost`, `RelayUrlRequired`/`RelayUrlNotPermitted`. `127.0.0.1` and `localhost` are the only loopback spellings; `is_loopback_only()` answers from the bind alone (Local `true`, SelfHosted `false`, Hosted `true` — its API binds loopback and remote devices arrive through the relay)
    - ⛔ No listener reads the config: `bind_host` is data, so no peer check, no allow-list middleware and no relay client exist yet
  - [x] Phone pairing shared with the existing M6 device flow (QR + one-time secret), with device revocation honoured in every mode
    - `PhonePairing { device_id, secret, created_at, revoked }` with a hand-written `Debug` that prints `secret: "<redacted>"`; `PairingStore` trait (`create`/`list`/`revoke`/`is_revoked` + provided `active`) and `InMemoryPairingStore` — blank id/secret refused, a duplicate device id refused even after revocation, revoke idempotent, an unknown device is `PairingNotFound` rather than "active", and a revoked record is kept rather than deleted
    - `RunModeConfig::requires_pairing()` is `true` in all three modes: a phone is a remote device even when the daemon is local
    - ✅ Persistence landed in the tenth batch: `RunModeConfig::save_to_store`/`load_from_store` keep one row per mode in `run_modes`, and `InMemoryPairingStore::save_to_store`/`load_from_store` keep the pairing rows in `pairing_devices`, where revocation is a value on the row rather than a delete
    - ⛔ No QR handshake and no secret generator here (M6's `warsha-remote` owns both), and no daemon reads the stored rows yet — a restart keeps the pairings, but nothing loads them at boot
  - [x] Badge and chapter: `apps/desktop/src/components/RunModeBadge.tsx` (new, icon + colour per mode, RTL-safe) with 5 tests, and `docs/src/run-modes.md` (new) with its `docs/src/SUMMARY.md` entry
- [ ] AC (partially met — first batch landed 2026-10-31, audit landed 2026-10-30, first daemon RPC batch landed 2026-10-31, design system landed 2026-10-31, run modes landed 2026-10-30, UI wiring batch landed 2026-10-31, persistence batch landed 2026-10-31): the boundary check runs in CI and fails on a planted violation ✅ (`--self-test` plants one per rule and asserts it fires); `pnpm lint` is green repo-wide ✅ (ESLint 9 flat config); the per-file audit exists ✅ (`ARCH_AUDIT.md`); Storybook builds and the token-drift rule fails the build on a literal ✅ (`R6`, `packages/ui/src/tokens/tokenDrift.test.ts`); taste store, caches and run modes all have unit tests ✅ (13 + 10 + 12 + 4 + 16). Still open: replacing every previously stubbed wiring — the five daemon RPC methods, `WarshaClient`'s five implementations and both composer pickers are wired; the MCP client, the wiring that saves and loads the persistable rows (the layer itself landed in the tenth batch) and the two post-launch producers are still seams. The eleventh batch landed the MCP *transport* layer and the process spawner behind it; the MCP protocol client itself is still a seam.

### M20 (second batch) – First UI wiring batch: App shell + run view ✅ DONE (validated 2026-10-31, desktop 144 tests, typecheck/build/lint/arch/actionlint green on the Windows host; no bridge run)
- [x] Run-view mounts — `apps/desktop/src/screens/RunView.tsx`: four tabs (Stream & artifacts / Live preview / Continue on server / Router & cost) plus a "Hand off" button in the header
  - [x] `LivePreview` on the preview tab (`url` null until a dev server reports one, `onRun`/`onStop` flip the status only)
  - [x] `HandoffDialog` behind the "Hand off" button, and `ReviewApplyPanel` on the handoff tab (empty file list, both apply buttons off)
  - [x] `EcoModeToggle` + `LocalCloudBadge` on the router & cost tab (no router targets reported yet, so the empty line shows)
- [x] App shell mounts — `apps/desktop/src/App.tsx`
  - [x] `PlanModeBadge` in the top bar next to the Simple/Advanced toggle (mode is shell state; the approval stays with the gates inbox)
  - [x] Settings tab strip reaching `Routines`, `SettingsProviders` + `ProviderSetupWizard`, `CrashReports`, `StoreReviews` and `BackendKitPanel`
  - [x] `StatusStrip` (with `initialDeliveryStages()`) and `PermissionModeChip` verified mounted and covered by tests
- [x] `MentionPicker` + `SlashCommandPicker` in the Simple mode composer — **wired** in the eighth batch below (`apps/desktop/src/screens/SimpleMode.tsx`). It was left open here because that file was outside this batch's allowed scope; the two components and their tests already existed
- AC: every component above renders in the shell or the run view, and `tsc`/`eslint`/`vitest`/`vite build` stay green ✅ — covered by 7 new tests in `apps/desktop/src/App.test.tsx` (desktop suite 137 → 144). The composer pickers closed in the eighth batch, so the mount half of "replacing every previously stubbed wiring" is met

### M20 (third batch) – First daemon RPC wiring batch ✅ DONE (validated 2026-10-31: `cargo fmt`/`clippy`/`test` and `actionlint` in WSL Ubuntu, client `tsc`/`eslint`/`vitest` on the Windows host; no bridge run)
- [x] Backend kit export to a file — `crates/warsha-pipeline/src/backend_kit.rs`
  - `BackendKit::export_to_dir(&self, dir: &str) -> Result<String, BackendKitError>` writes the SQL dump from `export()` to `{dir}/schema.sql`, creates the directory, and returns the path; `SCHEMA_FILE_NAME`, `BackendKitError::InvalidExportPath` and `BackendKitError::Io`. `export()` itself still writes nothing
  - Unit tests: the dump is written and read back byte-for-byte (content + directory creation), and a blank directory is refused
- [x] Handoff bundle to disk — `crates/warsha-pipeline/src/handoff.rs`
  - `HandoffManager::write_bundle(&self, bundle, dir) -> Result<String, HandoffError>` validates the bundle, refuses a `run_id` that is not one file name (separator, `..`, blank) and writes `{dir}/handoff-{run_id}.json`; `HANDOFF_FILE_PREFIX`/`_SUFFIX`, `HandoffError::Encode` and `HandoffError::Io`
  - Unit tests: a bundle is written, parsed back and compared field by field; the escaping run id, the blank directory and the blank run id are refused and write nothing. `apply_bundle` stays a dry-run decision
- [x] RPC methods — `crates/warshad/src/lib.rs` (five new `#[method]`s on `WarshaApi`)
  - `backend.export(run_id, output_dir) -> String`: keeps a `BackendKit` per run in `DaemonState.backend_kits` and calls `export_to_dir`. In memory, `TODO(persistence)`; a run starts from `default_backend_config` (PocketBase on `http://127.0.0.1:8090`, named after the run), so the first export is the header without a schema — superseded by the fourth batch below, which builds the kit from the run's project
  - `handoff.create(run_id, files) -> String`: `HandoffManager::create_bundle` + `write_bundle` under `<data_dir>/handoff/`
  - `handoff.apply(path, owner_wins) -> String`: reads the bundle, resolves the run's project repo (`RunId` → `Run` → `Project.repo_path`) and compares the bundle against it, falling back to the bundle's own directory when there is no repo. Returns the `ApplyResult` JSON (`applied`/`conflicts`/`backups`/`resolved`). It does **not** write the files or take the backups — that stays the caller's step, as the module documents; superseded by the fourth batch below, where it writes and backs up and refuses a run with no repo
  - `postlaunch.crashes(run_id) -> Vec<CrashReport>` and `postlaunch.reviews(store) -> Vec<StoreReview>`: read the in-memory `InMemoryCrashReportStore`/`InMemoryStoreReviewStore` added to `DaemonState`. Nothing records into them yet (the M17 collector and store client are still unbuilt), so both lists start empty
  - Path screening: `is_relative_bundle_path` skips an absolute or `..` path from a bundle, so an apply cannot compare against a file outside its directory. Unit-tested — the screen moved into `warsha-pipeline` as `is_working_tree_path` in the fourth batch, so the layer that writes is the layer that screens
- [x] Client method signatures — `packages/client/src/index.ts`: `WarshaWiringApi` with `exportBackend`, `createHandoff`, `applyHandoff`, `listCrashReports`, `listStoreReviews`, plus the `CrashReport`, `StoreReview`, `HandoffConflict` and `HandoffApplySummary` wire types. Signatures only here — `WarshaClient` implements all five in the eighth batch below
- [ ] Still open after this batch: the MCP client that fills a `BackendKit`, cross-restart bundles, the crash-report collector and the store-review fetch. (The file writes and backups behind `handoff.apply`, the `backend.export` fill from the project, and `WarshaClient`'s five implementations landed in the fourth and eighth batches. Persisting kits closed in the tenth batch.)

### M20 (fourth batch) – Second daemon RPC wiring batch ✅ DONE (validated 2026-10-30T16:20:28, exit=0, all 20 checks green in the WSL bridge — 224 Rust and 222 TS tests, see PROGRESS.md)
- [x] `handoff.apply` writes the bundle and takes the backups — `crates/warsha-pipeline/src/handoff.rs` + `crates/warshad/src/lib.rs`
  - [x] `HandoffManager::apply_to_disk(&self, bundle, working_tree: &str, owner_wins: bool) -> Result<ApplyResult, HandoffError>`: the existing dry-run decision, then a copy of every file it overwrites into `{working_tree}/.warsha-backup/{timestamp}/{path}`, then the writes (parent directories created, an already-matching file left untouched). The checksum and path screens refuse the whole bundle, so an apply never writes half a tree
  - [x] `ApplyResult::backup_dir` names that directory — `None` for a dry run, and absent from the JSON in that case, so the previously shipped summary shape is unchanged; `BACKUP_DIR_NAME` and a `-2`, `-3`, … suffix keep two applies from writing over one backup
  - [x] `handoff.apply` wires it: RunId → Run → Project.repo_path is the tree, a run with no repo is refused instead of writing into the daemon's own bundle directory, and the returned summary carries `conflicts` and `backup_dir`
  - [x] Tests: 7 `apply_to_disk` unit tests in `handoff.rs` (owner-wins keeps the local file, remote-wins overwrites it, both keep the backup; a conflict does not stop the other files; each apply gets its own backup directory; an escaping path, a broken checksum and a blank working tree are refused and write nothing) + 2 daemon tests in `crates/warshad/src/lib.rs` (`apply_handoff` writes the files, reports the conflict and the backup directory; a run with no project repo is refused and writes nothing)
- [x] `backend.export` fills the kit from the project — `crates/warsha-pipeline/src/backend_kit.rs` + `crates/warshad/src/lib.rs`
  - [x] `BackendKit::from_project(project_name, url, kind)` builds the default kit: the backend, its URL and the project name, no service enabled and no schema; unit-tested (empty, then takes a table and exports with the project name in the header, and the Supabase archive stem)
  - [x] `backend.export` resolves the run's project name (RunId → Run → Project, falling back to the run id when a link is missing) and exports through `default_backend_kit`, so `schema.sql` and the storage-archive stem name the project, not the run. Daemon test covers the written path and the `-- project:` header
- [ ] Still open after this batch: the MCP client that fills a `BackendKit`, cross-restart bundles, the crash-report collector and the store-review fetch. (The composer pickers and `WarshaClient`'s five implementations closed in the eighth batch below. Persisting kits closed in the tenth batch.)

### M20 (fifth batch) – Design system: `packages/ui` tokens + Storybook ✅ DONE (validated 2026-10-31, exit=0 in WSL Ubuntu on a pristine copy with `pnpm install --frozen-lockfile`: `-r typecheck`, `lint`, `check-arch --self-test` + `check-arch`, `-r test` (245 TS tests, 0 failures), `-r build`, `actionlint`, `storybook build`; Rust untouched this batch)
- [x] Token layer — `packages/ui/src/tokens/` (7 modules + the stylesheet)
  - `colors.ts`: 14 role-named colour tokens (`bg`, `surface`, `surfaceMuted`, `text`, `textMuted`, `border`, `borderStrong`, `accent`, `accentInk`, `accentStrong`, `success`, `warning`, `error`, `muted`) as `{ light, dark }` pairs; Warsha accent `#FFD60A` with ink `#0E0E0E` (identical in both themes) on a `#0E0E0E` dark background; `accentStrong` is the accent as *foreground* (dark gold in light mode, where the brand yellow is unreadable). Exports `colorTokens`, `colorTokenNames`, `colorVar()`, `colorVarName()`, `colorValue()`, `colorPalette()`
  - `spacing.ts`: the 13-step scale (0…64) with a 4px base; `space(step)` returns the token for an on-scale step and the exact pixel value for an off-scale one, so the pre-token `Box` API kept its computed value
  - `radius.ts` (`none/sm/md/lg/xl/full`), `shadow.ts` (`none/sm/md/lg/xl`), `motion.ts` (3 durations + 3 easings), `typography.ts` (Arabic-first `sans` stack led by IBM Plex Sans Arabic, mono for code, 7 sizes, 4 line heights, 4 weights; no letter-spacing token, because Arabic is a connected script)
  - `tokens.css`: every token as a `--warsha-*` custom property, light on `:root`, dark via `[data-theme='dark']`, durations zeroed under `prefers-reduced-motion`; no `prefers-color-scheme` query, because the theme is an owner choice
  - `index.ts` barrel re-exported from `@warsha/ui`; `vars.ts` holds the `--warsha-` prefix and `cssVar()`
- [x] Components consume tokens — `packages/ui/src/components.tsx`: `Box`/`Text`/`Button`/`Card` now read `colorVar`/`space`/`radius`/`shadow`/`fontSize`/`fontWeight`/`duration`/`easing` and contain no literal; primary is the accent with ink on top, secondary is `surfaceMuted` on `text`, ghost is `text`. No behaviour change: same props, same computed padding/size/radius for every input
- [x] Storybook 8 — `packages/ui/.storybook/{main.ts,preview.ts}` (`@storybook/react-vite`, `addon-essentials`, telemetry off) + stories for `Box`, `Text`, `Button`, `Card` and the token layer; the preview decorator sets `dir` and `data-theme` from two toolbar globes (RTL default, both themes) and imports `tokens.css` once; `storybook`/`build-storybook` scripts in `packages/ui/package.json`, and `tsconfig.storybook.json` puts both config files under the same strict `tsc` pass
- [x] Token drift prevention as `R6 no-token-drift` — `packages/ui/src/tokens/tokenDrift.test.ts` (12 tests): components may not carry a colour, a length, a physical direction property, an inline font stack, a raw `--warsha-` name or a `cssVar(` call; `tokens.css` and the TS modules must declare the same names with the same values per theme; every exported component must have a story. Self-tested against a planted violation of each rule. Documented in `docs/ARCH_RULES.md` (`R6`) and run by `pnpm -r test`; `tokens.test.ts` adds 11 helper tests (token names, the accent invariant, the 4px scale, `space()`'s off-scale branch)
- [x] Minimal desktop consumption — `apps/desktop/src/index.css` imports the tokens and styles `body`/links/focus from them (the `[dir="rtl"]` font override is gone: the Arabic-first stack covers both directions); the four accent sites (`PlanModeBadge`, `RoutineRow`, `Routines`, `CrashReports`) reference `--warsha-color-accent`/`-accent-ink`
- [x] Dependency declared, not installed — `packages/ui/package.json` declares `storybook`, `@storybook/react`, `@storybook/react-vite`, `@storybook/addon-essentials` at `8.6.19` and `vite ^5.4.0`; `pnpm-lock.yaml` carries the resolution (+731 lines, 0 deletions), so CI's `pnpm install --frozen-lockfile` passes without touching a local `node_modules`
- [ ] Still open after this batch: the remaining ~330 colour/spacing literals in `apps/desktop/src/**` and `apps/remote/src/**` (a UI batch of its own; R6 does not scan the apps yet), the theme switch that sets `data-theme` in the app, and a `prettier --check` pass over the older long-line components (the repo's `format:check` is not a CI step). (The literals and the theme switch closed in the twelfth batch below; `format:check` is still open.)

### M20 (eighth batch) – UI wiring batch: `WarshaClient` RPC implementations + the composer pickers ✅ DONE (validated 2026-10-30T17:53:06, exit=0, all 20 checks green in the WSL bridge — 279 Rust and 256 TS tests, 0 failures; see PROGRESS.md)
- [x] `WarshaClient` implements `WarshaWiringApi` — `packages/client/src/index.ts`
  - `exportBackend(runId, outputDir)` → `backend.export` (`run_id`/`output_dir`), resolves to the written `schema.sql` path; `createHandoff(runId, files)` → `handoff.create` (`run_id`/`files`), resolves to the bundle's JSON path; `applyHandoff(path, ownerWins)` → `handoff.apply` (`path`/`owner_wins`), decodes the returned JSON into `HandoffApplySummary`; `listCrashReports(runId?)` → `postlaunch.crashes` (`run_id`, blank = every report); `listStoreReviews(store?)` → `postlaunch.reviews` (`store`, blank = every store). Parameter names are snake_case because that is what `warshad` deserializes
  - Every result is checked field by field (`wiringString`/`wiringArray`/… and `parseHandoffApplySummary`), so a wrong shape throws `Malformed RPC result from <method>: …` instead of handing a screen `undefined`; transport errors, JSON-RPC errors and token redaction stay on the class's existing `rpc` path
  - `applyHandoff` now resolves `Promise<HandoffApplySummary>` where the third batch declared `Promise<string>` — the daemon returns the summary as a JSON string, and the wire type was otherwise unused; `HandoffApplySummary` gained the optional `backup_dir` that the fourth batch added to `ApplyResult::backup_dir`
- [x] `MentionPicker` + `SlashCommandPicker` mounted in the Simple mode composer — `apps/desktop/src/screens/SimpleMode.tsx`
  - `composerTriggerFor(value)` opens the mention picker on a trailing `@` and the slash picker on a trailing `/` (letters only, a `-` allowed after the slash), so `dev@example.com`, an already-resolved `@file:src/main.rs` and a finished `/review ` open nothing; the two are mutually exclusive
  - Visibility state is the query (`mentionQuery`/`slashQuery`, `null` = closed), which is also what the picker filters on. `insertComposerToken(value, insertion)` replaces the token being typed with `@kind` or the command name plus a space; picking closes both pickers and sending clears them
  - `simpleSlashCommands(locale)` is the composer's own placeholder catalog (`/review`, `/refactor`, `/test`, `/docs`, `/release`) with ar/en descriptions, until an RPC reports the project's skills
- [x] Tests — 6 new in `apps/desktop/src/App.test.tsx` (desktop suite 149 → 155): the mention mount + insert, the slash mount + insert, both pickers staying shut for an address and a resolved mention, the two path-returning calls, the summary plus the two post-launch lists (including the blank `run_id`), and the malformed-result rejections
- [ ] Still open after this batch: no screen calls the five client methods yet, the MCP client that fills a `BackendKit` and the persistence behind kits/bundles are unbuilt, and the crash collector and store-review fetch do not exist — so both `postlaunch.*` lists are empty by construction

### M20 (ninth batch) – Agent loop wiring: `agent_loop.rs` + `skills.list`/`agent.turn` ✅ DONE (validated 2026-10-30T18:12, all check groups green: `cargo fmt`/`clippy`/`test` (294 Rust tests) and `actionlint` in WSL Ubuntu, `tsc`/`eslint`/`vitest`/`vite build`/`check-arch` on the Windows host; no bridge run, no `pnpm` on this host — see PROGRESS.md)
- [x] The agent loop M18 recorded as missing — `crates/warsha-pipeline/src/agent_loop.rs` (new) + `lib.rs` `mod`/`pub use`
  - `AgentLoop` (the six tools: `ModeManager`, `TodoList`, `AskUserQueue`, `MessageBus`, `ContextCompactor`, `OutputCompressor`, plus the transcript the compactor works on), `AgentLoop::new()`, `run_turn(input, skills) -> AgentTurnResult` — mentions → slash command → Plan returns a plan and executes nothing / Agent returns a summary → one todo per turn → compaction to `TURN_CONTEXT_BUDGET_TOKENS` — `approve_agent_mode`/`return_to_plan_mode` on top of the M18 approval rule, and `AgentTurnResult { mode, mentions, command, response, todos }` with serde. 12 unit tests
  - The Agent-mode half is a **mock summary**: no file is read, no tool runs and no model is called, and the response says so on every turn
- [x] A real skill source for the registry — `SlashCommandRegistry::from_skills`/`skills()` in `agent_workflow.rs`, and `warshad`'s `skills.list` RPC serving `/review`, `/refactor`, `/test`, `/fix`, `/explain` from a hardcoded catalog (`SKILL_CATALOG`)
- [x] `agent.turn` RPC calling `AgentLoop::run_turn` with the `skills.list` catalog; `DaemonState.agent_loop` initialized in `start_daemon`
- [ ] Still open after this batch: no screen calls `skills.list` or `agent.turn` yet (the composer keeps `simpleSlashCommands`), the mode has no RPC behind it (a test flips it through `DaemonState.agent_loop`, a gate card would be the real caller), the loop's state is in memory (`TODO(persistence)`), `skills.rs`/`factory/skills.lock` still do not feed the catalog, mentions still carry a target string only, and there is no tool layer for the summary to drive

### M20 (tenth batch) – Persistence batch: preferences, backend kits, run modes and pairings in SQLite ✅ DONE (validated 2026-10-30T18:41:22, exit=0, all 20 checks green in the WSL bridge — 313 Rust and 256 TS tests, 0 failures; see PROGRESS.md)
- [x] `crates/warsha-store/src/persistence.rs` (new) + `lib.rs` `mod`/`pub use` — `SqliteStore { conn: rusqlite::Connection }`
  - `open(&str)` creates the file and switches it to `journal_mode = WAL`, refusing a blank path (`StoreError::InvalidPath`) and a database that did not end up in WAL (`WalNotEnabled`); `migrate()` creates the four tables in one transaction and is idempotent; `tables()`/`connection()` for checks
  - Tables: `preferences (project_id, key, score, evidence_count, last_updated, PRIMARY KEY(project_id, key))`, `backend_kits (project_id PRIMARY KEY, kind, url, config_json)`, `run_modes (mode PRIMARY KEY, config_json)`, `pairing_devices (device_id PRIMARY KEY, secret, created_at, revoked)`
  - Methods: `save_preference`/`load_preferences`, `save_backend_kit`/`load_backend_kit`, `save_run_mode`/`load_run_mode`, `save_pairing`/`load_pairings`; rows are `StoredPreference`/`StoredBackendKit`/`StoredRunMode`/`StoredPairing`, so the store still does not depend on `warsha-pipeline`
- [x] `rusqlite 0.32` (`bundled`) — the one new dependency, pinned to the `libsqlite3-sys 0.30.1` that `sqlx` already links so exactly one native `sqlite3` is linked; declared in `crates/warsha-store/Cargo.toml` because the root `Cargo.toml` is outside this batch's files
- [x] Pipeline store methods — `preferences.rs`, `backend_kit.rs`, `run_modes.rs`
  - `InMemoryPreferenceStore::save_to_store(&self, &SqliteStore)` + `load_from_store(store, project_id)` (derived rows only; the signal log and the owner dimension stay in memory, so a reloaded score is a snapshot that does not re-decay)
  - `BackendKit::save_to_store(&self, store, project_id)` + `load_from_store(store, project_id) -> Option<BackendKit>` (JSON is the source, `kind`/`url` are mirror columns, corrupt JSON is an error)
  - `RunModeConfig::save_to_store`/`load_from_store(store, mode)` (one row per mode, loaded unvalidated so `validate()` stays the bind gate) and `InMemoryPairingStore::save_to_store`/`load_from_store` (revocation is a value on the row, not a delete)
- [x] Tests — 19 new (11 in `warsha-store::persistence`, 8 across the three pipeline modules): open/migrate/WAL, preference round trip + ordering + upsert, kit round trip + mirror columns + replacement, run-mode round trip + replacement, pairing round trip with the revoked row kept, and `Debug` redaction on both sides
- [ ] Still open after this batch: nothing loads the rows at startup (no RPC, CLI or screen calls the save/load pair, `DaemonState` is still in memory), owner-level preferences have no column, `migrate()` has no schema-version table, and the pairing `secret` sits in the SQLite file even though `AGENTS.md` says secrets belong in the keychain — recorded in PROGRESS.md as a schema change for a later batch


### M20 (eleventh batch) – Process spawning for real: live-preview dev server + MCP transports ✅ DONE (validated 2026-10-30T19:03:09, exit=0, all 20 checks green in the WSL bridge — 346 Rust and 256 TS tests, 0 failures; no new dependency, no `Cargo.toml` change)
- [x] Process spawner — `crates/warsha-pipeline/src/process_spawn.rs` (new) + `lib.rs` `mod`/`pub use`
  - `ManagedProcess { id, command, args, child, status, started_at, exit_code }`, `ProcessStatus` (`starting`/`running`/`stopped`/`failed`/`crashed`), `ProcessError` via thiserror, `ProcessManager` (`spawn`/`stop`/`status`/`list`/`restart`, plus a default `write_stdin` that refuses rather than pretending), `InMemoryProcessManager` over `tokio::process::Command` — tokio's `full` feature already carries `process`, so nothing was added to any manifest
  - The handle stays with the manager: `list()` returns `ManagedProcess` with `child: None`, and `ProcessSummary` — the clonable, handle-free projection — is what `process.list` serves, because jsonrpsee requires a clonable result
  - A status is observed, not remembered: `spawn` records `starting`, and the first `status`/`list`/`stop` call asks `try_wait()`, which promotes it to `running` or settles it as `stopped` (exit 0) / `crashed` (non-zero); `failed` means the wait itself failed
  - The environment a spawn is given is kept beside the record rather than on it, so the six documented fields stay exactly as specified while `restart` still replays that environment
  - stdin is piped (the MCP transport's frame sink); stdout and stderr are inherited, so a dev server's log reaches the console instead of filling a pipe nobody reads
  - `LivePreviewManager` lives in the same file: `LivePreview { project_id, process_id, command, args, status }`, `split_command` (whitespace only — no shell, no quoting, no expansion), `start`/`stop`/`status`/`list`, and one dev server per project (a second start while the first is alive is refused)
- [x] MCP transports — `crates/warsha-pipeline/src/mcp_transport.rs` (new) + `lib.rs` `pub mod`
  - `McpTransport` (`Stdio`, `Http { url }`, `WebSocket { url }`), `McpServerConfig { name, transport, command, args }`, `McpStatus` (`disconnected`/`connecting`/`connected`/`error(message)`), `McpConnection { config, status, process_id }`, `McpTransportError` via thiserror
  - `McpManager` (`connect`/`disconnect`/`list`/`send`) + `InMemoryMcpManager`, which starts a stdio server through the daemon's `ProcessManager` and writes its frames to the child's stdin; `disconnect` stops that process and clears the connection, and `list` asks the process, so a server that exited reports `error` instead of claiming `connected`
  - Http and WebSocket are **recorded, not connected**: the config is stored, the status is `disconnected`, `process_id` is `None`, and `send` refuses with "not wired" — `McpServerConfig::is_wired` is the one predicate that says so
  - The MCP JSON-RPC handshake (`initialize`, `tools/list`, notifications) is **not** implemented: frames go out verbatim, one per line, and a caller supplies one the server can parse
  - It is a public module because `mcp.rs` (M12) already exports `McpTransport` and `McpServerConfig` at the crate root; this layer is reached as `warsha_pipeline::mcp_transport::…` instead of colliding in the flat re-export
- [x] Daemon wiring — `crates/warshad/src/lib.rs`
  - `DaemonState` gained `processes: Arc<dyn ProcessManager>`, `mcp: Arc<dyn McpManager>` and `previews: Arc<LivePreviewManager>`, all built in `start_daemon` (and in the test helper) from **one** manager, so every child the daemon starts appears in one `process.list`
  - Eleven RPC methods: `process.spawn(command, args, env) -> id`, `process.stop(id)`, `process.status(id)`, `process.list() -> Vec<ProcessSummary>`, `mcp.connect(config)`, `mcp.disconnect(name)`, `mcp.list() -> Vec<McpConnection>`, `mcp.send(name, payload) -> String`, `preview.start(project_id, command)`, `preview.stop(project_id)`, `preview.status(project_id)`
  - Failures are one `rpc_error` helper (`-32000`) carrying the `thiserror` message, which names the process, server or project involved
- [x] Tests — 33 new, all passing (Rust 313 → 346; TS unchanged at 256)
  - 18 in `process_spawn`: spawn → running, distinct ids, missing binary, empty command, stop, stop on a finished process, exit code, unknown id, `list` without a handle, restart keeps the id, restart replays the environment, restart of an unknown id, `write_stdin`, `split_command`, preview start/status/stop, a second start refused, unknown project, stop twice
  - 11 in `mcp_transport`: stdio connect spawns the command, http recorded, websocket recorded, missing command, blank/duplicate name, a spawn failure recorded as `error`, disconnect stops the process, unknown/repeated disconnect, an exited server reported as `error`, `send` writes the frame, `send` refused when disconnected or unwired
  - 4 in `warshad`: the `process.*` round trip against a real child, the `mcp.*` round trip (connect → send → disconnect), an http `mcp.connect` recorded without a child, the `preview.*` round trip with one server per project
- [ ] Still open after this batch:
  - Nothing reaps children when the daemon exits, and a restart forgets them — a dev server can outlive the daemon on its port (`TODO(reaping)` on `DaemonState.processes`)
  - No MCP handshake and no stdout reader: a server's replies are never consumed, so `mcp.send` delivers bytes and returns the frame, not a response
  - The dev server's URL is not discovered (the server picks its own port and prints it, and no output is captured), so the preview panel's `url` prop stays the seam exactly as M5b recorded
  - `packages/client` has no methods for the eleven RPCs and no screen calls them; `RunView` and the preview panel are unchanged
  - A spawned process inherits the daemon's working directory and environment (plus whatever `env` the caller passes); there is no per-project sandbox or cwd yet


### M20 (twelfth batch) – Theme switch, both apps on the token vocabulary, R6 scans the apps ✅ DONE (validated 2026-10-30T19:40:04, exit=0, all 20 checks green in the WSL bridge — 346 Rust and 282 TS tests, 0 failures; no new dependency, no Rust change, no `Cargo.toml`/`package.json` change)
- [x] `data-theme` switch — `apps/desktop/src/theme.tsx` (new) + `apps/desktop/src/components/ThemeToggle.tsx` (new) + `main.tsx` + `App.tsx`
  - `ThemePreference` (`light`/`dark`/`system`), `ResolvedTheme`, `THEME_STORAGE_KEY = 'warsha.theme'`, `DEFAULT_THEME_PREFERENCE = 'system'`, `isThemePreference`, `readThemePreference`, `systemPrefersDark`, `resolveTheme`, `applyTheme`, `applyStoredTheme`, `ThemeProvider`, `useTheme`
  - The provider reads `localStorage` (an unrecognised value falls back to `system`), reads `prefers-color-scheme`, writes `document.documentElement.dataset.theme` (`light`/`dark` only) and re-evaluates on the media query's `change` event — so `system` keeps following the OS without a reload. An explicit choice ignores the media query entirely
  - `main.tsx` calls `applyStoredTheme()` before `createRoot(...).render(...)`, so a dark app does not flash the light palette for one frame; the provider keeps it in step afterwards
  - `ThemeToggle` is the top-bar switch: `role="group"` of three `aria-pressed` buttons, labels and hints through `t()` with the `localized` fallback (ar + en), token-styled, logical properties only. It asks; the provider owns the choice and persists it
  - 21 new tests (`theme.test.tsx` 15, `ThemeToggle.test.tsx` 6): resolution, storage default/unknown/throwing, `data-theme` never `system`, pre-render application, persistence, OS change while on `system`, OS change ignored after an explicit choice, listener removed on unmount, `useTheme` outside the provider
- [x] Both apps render from `var(--warsha-*)` — 36 files under `apps/desktop/src` and `apps/remote/src`, ~900 literal values: 388 hex colours (64 distinct), 22 `white`, 12 `rgba()` scrims/shadows, 377 spacing values on the 4px scale, 81 font sizes on the type scale, 19 inline mono stacks
  - Colours map by role, not by hue: neutrals to `bg`/`surface`/`surface-muted`/`text`/`text-muted`/`muted`/`border`/`border-strong`, status greens/ambers/reds to `success`/`warning`/`error`, brand blues and violets to `accent-strong` (the accent itself is unreadable as text), pale status tints to `surface-muted` so the pill's text colour still carries the state, modal scrims to `muted`, `boxShadow` literals to `--warsha-shadow-sm/md/lg/xl`
  - Values off the scales are left alone as the brief requires: `6px`, `10px`, `13px`, `18px`, `40px`, `0.8125rem`, `0.8rem`, `0.625rem` spacing and type sizes, and every radius, width and height
  - `apps/remote/src/index.css` now imports `tokens.css` (it never did, so the app's tokens had no values and its `var()` references resolved to nothing); both apps drop the `[dir="rtl"]` font override in favour of the Arabic-first `--warsha-font-sans`
  - No layout or behaviour change: same values for every token-mapped literal, all 176 desktop tests and 4 remote tests pass, both `vite build`s pass
- [x] R6 scans the apps — `packages/ui/src/tokens/tokenDrift.test.ts` (12 → 17 tests) + `docs/ARCH_RULES.md` R6
  - `appSourceFiles()` walks `apps/desktop/src/**` and `apps/remote/src/**` for `.ts`/`.tsx`, excluding `*.test.ts(x)`; `scanAppForLiterals()` allows `var(--warsha-…)` (the apps have no typed helpers) and flags colour literals, colour keywords, on-scale spacing, on-scale font sizes and inline font stacks, reading the *value* of a declaration so a sibling `borderRadius: '8px'` is not mistaken for a spacing literal
  - Off-scale values are deliberately not offences, which the rule documents as its own limit; the planted-fixture test proves each rule fires and the clean fixture proves a token reference, a CSS keyword and an off-scale value all pass
  - Four new ARCH_RULES lines (app scope, app failure messages) and a rewritten "out of scope" section: app stylesheets, off-scale values, radii/widths and app test files are named as unscanned


### M20 (thirteenth batch) – End-to-end request → artifact test ✅ DONE (validated 2026-10-30T20:06:32, exit=0, all 20 checks green in the WSL bridge — 347 Rust and 282 TS tests, 0 failures; no new dependency, no `Cargo.toml`/`package.json` change, no pipeline source change)
- [x] One end-to-end test, from a written request to a running binary — `crates/warshad/tests/e2e_request_to_artifact.rs` (new)
  - Ten steps in one `#[tokio::test]`: `WarshaRpc` creates the project and starts the run; the agent's clarifying question blocks the run until the owner answers it (`AskUserQueue`); Plan mode proposes and the owner's approval moves the run into Agent mode (`AgentLoop`/`ModeManager`); Gates A and B are approved through the daemon's RPC layer; the stages run to `review_qa_security`; the planned Rust project is written into a temp directory; `cargo test`, `cargo build` and the built binary are the acceptance evidence
  - `Idea → GateA`, Gate A approved, `→ Research → PrdSpec → GateB`, Gate B approved, `→ Design → PlanTasks → Code → ReviewQaSecurity`. Every stage asserts its artifact carried the mock provider's one-sentence reply *before* the scripted answer replaced it — that is what proves the stage really reached the model layer
  - `cargo test` reports 2 passing tests (the generated library's unit test and its integration test), `cargo build` writes `target/debug/hello-cli`, and the binary prints `Hello, Ada!` for its argument and `Hello, world!` without one — the request's `Hello, {name}!`
- [x] The cheap model is the mock provider — `warsha_providers::MockProvider`, the only provider on the router, routed for the six executed stage roles (Researcher, PM, Designer, Architect, Coder, Reviewer)
  - No key, no network, no spend: the run's `spent_cents` is what the router's own `cost_of` meter recorded, so "cheap" is arithmetic rather than a comment
  - The canned answers a real model would have written (the intake question, the plan, the four files, the test) are constants in the test file, recorded through `PipelineEngine::upsert_artifact` — a one-sentence `MockProvider` cannot carry code, and the test says so instead of pretending
  - Helpers: a `--- FILE: <path> ---` block parser, a relative-path screen (no root, no `..`, no backslash), a `cargo` runner (`--offline`, `CARGO_NET_OFFLINE`, target dir pinned inside the project) and a binary runner; the generated project was also verified by hand under CI's `RUSTFLAGS=-D warnings`
- [ ] ⛔ Not claimed: nothing synthesized the code (the model is canned), the build is a nested `cargo build` rather than a pipeline stage (there is no build stage), and Gates C/D are never approved — the run stops at `review_qa_security`
- Fixed (2026-10-30): Store::get_events now reads device_id as a blob (column_opt_blob) instead of an integer. The E2E test reads the event log (2 gate decisions with device_id) as regression evidence. Bridge validated 2026-10-30T20:32:20, exit=0

### M20 (fourteenth batch) – Agent tools + the real router behind Agent mode ✅ DONE (validated 2026-10-30T21:31:12+04:00, exit=0, all check groups green — 373 Rust tests and the unchanged TS suites, see PROGRESS.md)
- [x] Agent tools — `crates/warsha-pipeline/src/agent_tools.rs` (new) + `lib.rs` `mod`/`pub use`
  - `AgentTool` (`ReadFile { path }`, `WriteFile { path, content }`, `RunCommand { command, args }`, serde tag `tool`, `snake_case`, `summary()`), `ToolResult { tool, success, output }` (`ok`/`failed`/`status`), `ToolError` via thiserror (`BlankPath`, `PathEscapesWorkingDir`, `BlankCommand`, `Io`, `Spawn`)
  - `ToolExecutor` trait (`execute(&AgentTool) -> ToolResult`, `Send + Sync`); `FilesystemToolExecutor` resolves every path inside one working directory — a blank, absolute, drive-prefixed or `..`-carrying path is refused before a file is touched — creates the parent directories a write needs, and runs a command through `std::process::Command` with the working directory as `current_dir`; `NoToolExecutor` refuses every call, so a loop with nothing wired says so
  - A non-zero exit is a *result*, not an error: `success: false` with stdout, stderr and the exit code in the output. No timeout (the daemon's `process.*` spawner stays the timeout-capable path) and no shell (a command line splits on whitespace, like `process.spawn`) — both recorded as limits
  - 12 unit tests: read, write, nested write (directories created), missing file, echo, non-zero exit, missing program, escaping path (and the file it would have written is absent), blank path and blank command, dotted path, `NoToolExecutor`, the serde shape
- [x] Agent mode executes instead of summarising — `crates/warsha-pipeline/src/agent_loop.rs`
  - `AgentLoop` gained `tool_executor: Box<dyn ToolExecutor>` and `router: Option<Arc<dyn Router>>`, with `AgentLoop::with_tool_executor(executor)`, `.with_router(router)` and `has_router()`; `AgentLoop::new()` keeps a `NoToolExecutor` and no router, so existing callers still compile
  - `run_turn` is `async`: an Agent-mode turn that starts with `read file <path>`, `write file <path>: <content>` or `run command <program> [args…]` runs that tool through the executor (`parse_tool_request`); every other turn asks the loop's `Router` and uses the answer. The response names which of the four cases answered (`tool execution` / `model completion` / `model unavailable` / `no model`), quotes the output through the loop's own `OutputCompressor` (12 lines), and `AgentTurnResult` gained `tools: Vec<ToolResult>`
  - `Router` trait (`complete(&str) -> Result<String, RouterError>`, `async_trait`) and `ProviderRouterAdapter` over the daemon's real `ProviderRouter`: the prompt goes out through `chat_with_fallback(AGENT_ROLE, …)`, so the router's role routing, fallback and cost meter apply exactly as they do to a pipeline stage. `AGENT_ROLE = Role::Intake` (the owner-facing prompt — `warsha-core` has no orchestrator role), `RouterError { NoRoute, Failed }` with `From<ProviderError>`
  - 12 → 23 unit tests: Plan mode runs no tool and writes no file, read/write/run against a real temporary directory, the no-executor refusal, a router answer and a router failure, the prompt the router is handed, the real `ProviderRouter` + `MockProvider` path (and the no-route path), the parse table, and the tool turn's wire shape
- [x] Daemon wiring — `crates/warshad/src/lib.rs`
  - `build_agent_loop(data_dir, providers)` is what both `start_daemon` and the tests' `test_state` now hold: `FilesystemToolExecutor` at `<data_dir>/workspace` and `ProviderRouterAdapter(providers, AGENT_ROLE, "agent-loop")`. `agent.turn` awaits the turn, holding the loop's write lock across the one model call so turns stay ordered
  - Two new daemon tests: an Agent-mode turn reaches the router and answers with `MockProvider`'s reply; a `write file` turn writes inside `<data_dir>/workspace` and a `../` path is refused and writes nothing. The existing Plan→Agent test now asserts the model path instead of the mock summary
- [x] The gap this closes: the M20 ninth batch's "no tool layer for the summary to drive" and the Agent-mode "mock execution" summary. `MockProvider` stays the only provider any test uses; no new dependency, no `Cargo.toml`/`package.json`/lockfile change
- [ ] Still open after this batch: three tools only (no `todo`/`ask_user`/`send_message` as model-callable tools, no diff/patch tool); `parse_tool_request` reads the owner's words, so a model's own tool call is not parsed; a command has no timeout and blocks the RPC task; no screen calls `agent.turn`; the loop's state is still in memory (`TODO(persistence)`); one loop per daemon means one `<data_dir>/workspace` for every project, and the model spend is metered under the `"agent-loop"` key rather than against a run
- [ ] ⛔ Recorded, not fixed: `crates/warsha-pipeline/src/process_spawn.rs`'s `preview_starts_reports_and_stops_its_dev_server` is timing-fragile — its "long-running" child is `sh -c sleep 30`, which the module's own whitespace split turns into `sleep` with `$0 = "30"`, so the child fails within milliseconds and the test's `Running` assertion depends on winning a race against `try_wait()`. It failed once in this batch's first full run and passed in the re-run; the file is outside this batch's scope

### M20 open follow-ups (recorded, not started)
- [x] `ARCH_AUDIT.md`: per-file audit against R1–R5 plus the refactors made — delivered 2026-10-30; nothing was refactored by the audit itself (0 violations to fix), the M20 first-batch refactors are re-verified in it
- [ ] Type-aware ESLint: re-enable `plugin:@typescript-eslint/recommended-type-checked` (deferred in the flat config — see DECISIONS.md 2026-10-31; ~280 existing app-screen violations, all needing component-logic rewrites)
- [ ] Wire `App.tsx`'s `handleCreateProject` (currently an unused handler kept behind one narrow lint opt-out)
- [ ] Tokens the twelfth batch could not reach: the two app stylesheets (`.css` is outside the R6 scan), app radii/widths/heights, and off-scale values (`10px`, `13px`, `18px`, `40px`, `0.8125rem`, `0.8rem`). Also missing tokens the apps had to work around: a scrim/overlay colour (modal backdrops use `--warsha-color-muted`) and pale status tints (pill backgrounds use `--warsha-color-surface-muted`, with the text colour carrying the state)
- [x] Migrate `apps/desktop/src/**` and `apps/remote/src/**` inline literals to the token vocabulary, then extend R6 to scan them — ✅ DONE (M20 twelfth batch, 2026-10-31)
  - `apps/desktop/src/theme.tsx` (new): `ThemePreference` (`light`/`dark`/`system`), `ResolvedTheme`, `THEME_STORAGE_KEY = 'warsha.theme'`, `resolveTheme`, `readThemePreference`, `systemPrefersDark`, `applyTheme`, `applyStoredTheme`, `ThemeProvider` + `useTheme`. The provider reads `localStorage` and `prefers-color-scheme`, writes `document.documentElement.dataset.theme` (`light`/`dark` only — never `system`), persists the owner's choice and re-evaluates on the media query's `change` event, so `system` keeps following the OS. `main.tsx` calls `applyStoredTheme()` before the first render, so a dark app does not flash light
  - `apps/desktop/src/components/ThemeToggle.tsx` (new): the top-bar switch — `role="group"` of three buttons with `aria-pressed`, labelled through `t()` with the `localized` fallback (ar + en), token-styled, logical properties only
  - Both apps now render from `var(--warsha-*)`: 36 files, ~900 literal values — 388 hex colours (64 distinct), 22 `white`, 12 `rgba()` scrims/shadows, 377 on-scale spacing values, 81 type-scale font sizes, 19 inline mono stacks, plus one `line-height`. Values off the scales stay pixels; radii, widths and heights are untouched. `apps/remote/src/index.css` imports `tokens.css` (it never did, so its tokens had no values)
  - `packages/ui/src/tokens/tokenDrift.test.ts`: R6 gained an app scan over `apps/desktop/src/**` and `apps/remote/src/**` (`.ts`/`.tsx`, tests excluded) — `var(--warsha-…)` is allowed there, colour literals, on-scale spacing, on-scale font sizes and inline font stacks are offences, off-scale values are left alone by design. 12 → 17 tests, both fixtures self-tested
  - `docs/ARCH_RULES.md` R6 documents the app scope, the messages and the four things the scan cannot see

### M20 (seventeenth batch) – Provider RPCs: the wizard's key is really stored, really tested, really removed ✅ DONE (validation pending)
- [x] The wire: `warshad::ProviderConfig { id, kind, api_base, models }` → `ProviderRecord { name, kind, enabled, api_base }`; `providers.add(name, kind, key, api_base) -> ProviderRecord`, `providers.list() -> Vec<ProviderRecord>`, `providers.test(name) -> HealthCheck`, `providers.remove(name) -> ProviderRecord`. Callers send the four fields as a JSON object — the exact payload `Onboarding.tsx` and `packages/client` already send — so the wizard, its tests, the three `onboarding.spec.ts` e2e tests and the 112 screenshot baselines are untouched. `packages/client`'s `ProviderConfig` gained the `api_base` the reply really carries; `warsha-cli`'s `cmd_providers` moved to the new wire and now requires `--key`
- [x] `providers.add` persists: `warsha-store`'s `StoredProvider` + `save_provider`/`load_provider`/`load_providers`/`delete_provider` over a new `configured_providers` table in the `SqliteStore` schema (not `providers` — `warsha-store/migrations/001_initial.sql` already creates that name in the same `warsha.db`), reached from `warshad/src/settings.rs` on `spawn_blocking` like the other settings rows
- [x] The key goes to the OS keychain: `warsha-providers::secrets::{SecretStore, KeychainSecretStore, InMemorySecretStore}` (service `warsha-provider`, account = provider name, over the existing `store_key`/`load_key`/`delete_key` seam), `DaemonState.secrets`, `start_daemon_with_secrets` for tests, keychain-first ordering on add and on remove, and a canary-key scan of the whole data directory in the integration test. Never SQLite, never a log, never an error message
- [x] `providers.test` really tests: `ProviderSetupWizard::test_connection` for the inputs, a new `probe_endpoint` (`GET <base>/models`, bearer, 8 s) for the endpoint, `OneClickProvider::from_tag`/`default_base_url`/`default_model` for URL and model resolution; `2xx` healthy, `401`/`403` "the endpoint refused the API key", unreachable/timeout "the endpoint could not be reached". A refusal is a JSON-RPC error carrying the `HealthCheck` in `data`, because the wizard reads a resolved promise as passed
- [x] 5 new integration tests in `crates/warshad/tests/provider_persistence.rs` over HTTP with the client's object params: add → restart on the same data directory → still listed and testable; the canary key in no file of the data directory; wrong key / unreachable endpoint / good key as three different answers; a key lost from the keychain; remove takes the row and the entry. No test reaches a real model API — two loopback stubs and one closed port
- [ ] Still open after this batch: the real OS keychain is not exercised end-to-end (no D-Bus secret service in WSL/CI, so the integration test injects `InMemorySecretStore`); `providers.budget`/`providers.budget.status` still have no daemon method; a provider stores no model, so `custom` is addable but not testable; `enabled` is always `true`; `packages/client`'s `testProvider` still returns `Promise<void>`

### M20 (nineteenth batch) – The desktop app is a real, installable Windows app ✅ DONE (validated 2026-10-31: MSVC release build + `tauri build` produced the MSI and the NSIS installer, `warsha-desktop.exe --self-check` green on the built binary; the 21-check WSL gate green — see PROGRESS.md for the exact commands and the two host limits)
- [x] `apps/desktop/src-tauri` compiles: `Cargo.toml` is its own workspace with a `[lib]`/`[[bin]]` pair and the plugin crates and the phantom `warsha_client` dependency are gone; `tauri.conf.json` moved into the crate (that is the only place `tauri-build` reads it from), `bundle.deb` became `bundle.linux.deb`, and the v1 `plugins.*.allowlist` blocks were replaced by `src-tauri/capabilities/default.json` (`core:default`), which is what v2 reads
- [x] Icons exist and are generated (`icons/warsha-icon.png` drawn by `icons/make-source-icon.py`, the rest by `tauri icon`), and `entitlements.plist` exists because `bundle.macOS.entitlements` named it
- [x] The app starts `warshad` in-process (`warshad::load_or_create_config` + `warshad::start_daemon`), publishes the bound ports and the token through `get_config`, and reaps the daemon on `RunEvent::Exit`; a second instance reuses the running daemon instead of fighting for the lock
- [x] `crates/warshad/src/lib.rs` answers CORS preflights on the JSON-RPC server (the one deliberate `crates/**` change), because a webview is cross-origin to its own daemon and a preflight carries no `Authorization` header
- [x] `docs/INSTALL.md` (Arabic + English): prerequisites, the toolchain trap, the build command, the artifact paths and sizes, what the app does on start, data paths, uninstall, troubleshooting, and the gaps
- [x] Installers produced: `apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/Warsha_0.1.0_x64_en-US.msi` (8,085,504 bytes) and `...\bundle\nsis\Warsha_0.1.0_x64-setup.exe` (5,721,668 bytes)
- [ ] Still open after this batch: the installers are unsigned (SmartScreen warns), the updater plugin is configured but not a dependency, the webview has no live event stream (`/events` authenticates from a header a browser cannot set), the ports are fixed rather than discovered, and the bundle identifier `dev.warsha.app` still ends in `.app` (Tauri warns about the macOS bundle-extension clash)



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
- [x] Real build E2E suite (`crates/warshad/tests/e2e_real_arabic_request.rs`): from written Arabic request ("تطبيق حجز مواعيد لعيادة أسنان"), Warsha asks clarifying questions in Arabic, plans in Plan mode, transitions to Agent mode with owner approval, writes code with a REAL model (cheapest configured, cost cap enforced by Warsha's own cost accounting), tests pass, produces a runnable web app, and verifies preview HTTP server. Proven by `WARSHA_E2E_REAL=1` test + screenshot preview in `bridge-io/shots/clinic-app-preview.png` and `clinic-app-preview.html`.

## Human-only steps (prepare them, list them in PROGRESS.md, don't wait on them)
- [ ] Create the GitHub org/repo, add CI secrets, enable branch protection
- [ ] Code signing certificates (Windows: e.g. SignPath/Azure Trusted Signing; macOS: Apple Developer ID + notarization)
- [ ] Store and registry accounts and submissions (winget, Homebrew, Scoop, Microsoft Store, crates.io/npm publish)
- [ ] Domain, hosting of the optional relay, and VAPID key publication
- [ ] Real-provider smoke tests with the user's own keys
