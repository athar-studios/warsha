# PROGRESS.md — Warsha Build Log

## Session Start: 2026-10-28

### Current Milestone: v0.1.0 ready — M0-M19 all validated (final bridge run 2026-10-29T20:50:53, exit=0, 0 failures)

#### M0 — DONE ✅ (validated 2026-10-28T22:38:39, exit=0)

Bridge run 14 is the acceptance evidence. All 14 checks PASS:

| Check | Result |
|---|---|
| `cargo fmt --all --check` | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS |
| `cargo test --workspace` | PASS — 50 tests (core 8, git 13, store 6, remote 4, providers 4, pipeline 4, backends 2, relay 1, cli 1, warshad 1) |
| `pnpm install` / `-r typecheck` / `-r build` / `-r test` | PASS — 40 tests (client 12, i18n 12, ui 8, desktop 4, remote 4) |
| `actionlint .github/workflows/ci.yml` | PASS |

Total: 90 tests, 0 failures, 0 ignored. `RESULT: M0 validation PASSED — all checks green.`

#### M1 — DONE ✅ (validated 2026-10-29T08:28:01, exit=0)

Bridge run 16 is the acceptance evidence. All 14 checks PASS with M1 complete:

- `warshad` single-instance lock via `fs2` advisory locking (`flock` on Unix, `LockFileEx` on Windows)
- Config at `<config_dir>/warsha/config.toml` with 0600 permissions on Unix
- Bearer token auth on all HTTP routes except `/health`
- WebSocket `/events` endpoint streams `Event` JSON frames with 30s ping
- JSON-RPC served at root (no `/rpc` suffix) on port 8766
- CLI defaults to `http://127.0.0.1:8766`, reads token from config.toml, supports `--token` override
- Store uses `config.data_dir` for restart survival
- `GateA`/`GateB` added to `Stage` enum per BUILD_PROMPT §6
- **New:** `start_daemon` / `DaemonHandle` split — testable daemon lifecycle with OS-chosen ports
- **New:** RPC authentication via tower middleware (`RpcAuthLayer`) — bearer token required on all JSON-RPC calls
- **New:** Three integration tests in `crates/warshad/tests/m1_daemon.rs`:
  - `restart_survives_with_state_intact` — project/run/events persist across restart
  - `unauthenticated_calls_are_rejected` — /health allowed, /events + RPC reject unauthenticated
  - `second_instance_is_locked_out` — advisory lock prevents second instance on same data_dir

The defects that had to be cleared to get here, in the order the bridge exposed them:

The defects that had to be cleared to get here, in the order the bridge exposed them:

| # | Defect | Root cause | Fix |
|---|---|---|---|
| 1 | `jsonrpsee` feature resolve error | `proc_macros` is not a `jsonrpsee` feature in 0.26 | `macros` |
| 2 | `E0252 TokenUsage defined multiple times` | `warsha_core::*` glob plus a redundant `use` and two duplicate `pub use` re-exports | single glob import |
| 3 | `no method named split for WebSocket` | axum 0.7.9 has no inherent `split`; `WebSocket` is `Stream + Sink` | `use futures::{SinkExt, StreamExt}` + new `futures` dep |
| 4 | `useless_conversion` on `Message::Binary(vec.into())` | axum 0.7.9's `Binary` holds `Vec<u8>` (verified at `axum-0.7.9/src/extract/ws.rs:570`) | pass `vec` directly |
| 5 | unclosed delimiter in `warsha-providers` | a dropped `}` for the `for` loop during the `TokenUsage` cleanup | brace restored |
| 6 | 17 × `E0195` on every RPC method | jsonrpsee 0.26 generates `#[async_trait] pub trait WarshaApiServer`, so a plain `async fn` impl cannot match it | `#[async_trait]` on the impl block |
| 7 | `ServerHandle` is not a future | `start()` is synchronous in 0.26 | `let handle = server.start(..)` then `handle.stopped().await` in a task |
| 8 | `Option<&Path>` vs `Option<&PathBuf>`, and `E0716` temporary dropped | `PathBuf`-typed param and `unwrap_or(&config_dir.join(..))` | `Option<&Path>` + named `default_path` binding |
| 9 | no `map_err` on `keyring::Entry` | keyring 1.2's `Entry::new` is infallible — it returns `Entry` | drop the `?` |
| 10 | `suspicious_open_options` | `create(true)` with no `truncate` | `.truncate(false)` with a comment on lock semantics |
| 11 | 16 × `no method named request` | `ClientT` trait not in scope | `use jsonrpsee::core::client::ClientT` |
| 12 | 4 × `ToRpcParams` not implemented for `()` | `()` has no impl | `rpc_params![]` |
| 13 | 53 × `ToRpcParams`/`E0308` across every call site | `request<R, Params>` takes the **return type first**; `request::<_, X>` left `R` inferred and put `X` in the Params slot | `request::<X, _>(..)` at all 16 sites |
| 14 | 21 × `clippy::result_large_err` | `warshad::DaemonError` aggregates six crate error enums and crosses the 128-byte `Err` threshold | `Daemon(#[source] Box<warshad::DaemonError>)` + manual `From` impl |
| 15 | `getByText` found multiple elements | `t('app.name')` renders in both header and dashboard title | `getAllByText('ورشة')` with `toHaveLength(2)` |

#### Decisions Made
- License: **PolyForm Noncommercial 1.0.0** (owner decision 2026-10-28, overrides BUILD_PROMPT.md §1). Never revert.
- Workspace structure: Follow BUILD_PROMPT.md §4 exactly
- Goose integration: Pinned git tag in Cargo.toml (commented placeholder), fallback to goosed sidecar
- i18n: Arabic-first with ICU MessageFormat, RTL-aware CSS
- Desktop UI: two modes behind one toggle (Simple = Grok Bot/openbot.run, Advanced = ZadLoop) — M13, wireframes in `docs/UI.md`
- Roadmap extended to M16: discovery interview, skills, MCP + scout, desktop UI modes, marketing loop, agent safety/quality layer, dependency/routine/automation/self-update automation
- Workspace lints are declared but inert (no crate opts in with `[lints] workspace = true`); deliberately deferred, see DECISIONS.md
- `CliError::Daemon` carries `#[source] Box<DaemonError>` — boxing keeps the variant pointer-sized while preserving the error chain

#### M1 – Daemon core + state store ✅ DONE
Acceptance: integration tests create a project, append events, survive a daemon restart with state intact, and reject unauthenticated calls. All ACs met via `crates/warshad/tests/m1_daemon.rs` (3 tests: restart survival, unauthenticated rejection, second-instance lockout).

#### M2 – Provider layer ✅ DONE (validated 2026-10-29T09:39:08, all 14 checks green)
Bridge run 17 is the acceptance evidence. All 14 checks PASS with M2 complete:

- **OpenAI-compatible adapter** (`OpenAIProvider`) — supports OpenAI, Azure, DeepSeek, OpenRouter, custom endpoints; Bearer token auth; streaming via SSE; model pricing for cost accounting
- **Anthropic adapter** (`AnthropicProvider`) — supports Claude 3.5 Sonnet/Haiku/Opus; `x-api-key` header; streaming; model pricing
- **Ollama adapter** (`OllamaProvider`) — auto-detects local Ollama at `http://localhost:11434`, `http://127.0.0.1:11434`, or `OLLAMA_HOST` env var; lists models via `/api/tags`; streaming; zero cost
- **Keychain credentials** — `load_key`/`store_key` helpers use `CredentialsRef::Keychain` (service="warsha-provider") or `EnvVar`; no plaintext secrets in config
- **Provider factory** — `create_provider(&ProviderConfig, keyring_service)` instantiates the correct adapter from `ProviderKind`
- **Cost meter** — `cost_of(model, usage)` on each adapter computes cost from `ModelPricing` (input/output per 1M tokens in cents)
- **Router & fallback** — `ProviderRouter` with `chat_with_fallback(role, project_id, request)` tries providers by priority, falls back on `RateLimited`/`Other(5xx)`/`Timeout`
- **Budget enforcement** — `set_budget(project_id, cents)`, `record_cost(project_id, cost)`, `budget_exceeded(project_id)` — test with canary key verifies no secrets in logs

#### M3 – Pipeline engine + gates ✅ DONE (validated 2026-10-29T11:22:01, all 14 checks green)
Bridge run 18 is the acceptance evidence. All 14 checks PASS with M3 complete:

- **Role prompts as versioned files** — 12 prompt templates in `crates/warsha-pipeline/src/prompts/` (Intake, Researcher, PM, Designer, Architect, Coder, Reviewer, QA, Security, Release, Marketer, Feedback) loaded at runtime via `prompts.rs`
- **Artifact generation into `factory/`** — `PipelineEngine::upsert_artifact()` writes markdown with frontmatter to `<project_dir>/factory/<name>.md`; `Store::write_artifact()` handles filesystem persistence
- **Gate state machine** — `GateState::Pending | Approved | Rejected | ChangesRequested` with device tracking; `approve_gate()`, `reject_gate()`, `request_changes()` methods in `PipelineEngine`
- **Stage execution** — `advance_stage()` executes role's agent step: fetches prompt, calls `ProviderRouter::chat_with_fallback`, parses JSON output, creates artifact, emits event, records cost
- **End-to-end test** — `crates/warsha-pipeline/tests/m3_e2e.rs` runs sample idea through Gate C with mock provider, verifies artifacts exist in factory/, rejecting Gate B returns to PrdSpec
- **6 pipeline tests pass** — `test_pipeline_start_run`, `test_gate_approval`, `test_gate_rejection`, `test_gate_b_blocks_advance_to_design`, plus prompt loading tests

#### M4 – CLI (`warsha`) ✅ DONE (validated 2026-10-29T11:43:54, all 14 checks green)
Bridge run 19 is the acceptance evidence. All 14 checks PASS with M4 complete:

- **Commands implemented** — `init`, `new "<idea>"`, `run`, `status`, `logs -f`, `gates`, `approve <gate>`, `reject <gate> --reason`, `providers add|list|test|remove`, `roles set`, `budget set`, `doctor`, `pair`, `devices list|revoke`
- **Output formats** — `--json` flag for scripting, human-readable with i18n support
- **Config management** — Reads/writes `config.toml` with project settings, provider configs, role routing, budgets
- **Daemon integration** — Uses `WarshaClient` for HTTP + WebSocket communication via JSON-RPC
- **Doctor command** — Checks toolchain (git, docker, node, pnpm, rustc, cargo) and AI CLIs (Claude Code, Codex, Gemini, Cursor, OpenHands)
- **RPC methods added** — `providers.remove`, `roles.list`, `roles.set`, `budget.show`, `budget.set` in `warshad`

#### M5 – Desktop app (Tauri 2) ✅ DONE (validated 2026-10-29T12:52:29, all 14 checks green)
Bridge run 20 is the acceptance evidence. All 14 checks PASS with M5 complete:

- **Tauri 2 app structure** — `apps/desktop/` with `src-tauri/` (Rust backend), `src/` (React/TypeScript frontend), `tauri.conf.json` (window config, permissions, bundle settings)
- **All 9 screens implemented**:
  - **Onboarding** — Language selection (ar/en), provider setup, GitHub auth with mock QR pairing
  - **Projects board** — Kanban columns = stages (Idea → Gate A → Research → PRD Spec → Gate B → Design → Plan Tasks → Code → Review/QA/Security → Gate C → Release → Gate D → Launch Drafts → Feedback)
  - **Run view** — Live event stream (WebSocket), diffs, costs
  - **Gates inbox** — Approve/reject with device confirmation
  - **Artifact viewer/editor** — Markdown with syntax highlighting
  - **Providers & roles settings** — Add/test/remove providers, set role routing
  - **Budgets** — Per-project budget with spend tracking
  - **Devices** — List paired devices, revoke
- **Sidecar** — Spawns `warshad` as sidecar process, manages lifecycle via Tauri commands
- **i18n** — Arabic-first with ICU MessageFormat, RTL-aware CSS (logical properties), full message catalog
- **TypeScript types** — Added `gate_a`, `gate_b` to Stage type, `RoleRoutingConfig` for role routing

#### M6 – Remote PWA + secure pairing ✅ DONE (validated 2026-10-29T13:05:38, all 14 checks green)
Bridge run 21 is the acceptance evidence. All 14 checks PASS with M6 complete:

- **Crypto package** — `@warsha/crypto` with X25519 key exchange, ChaCha20-Poly1305 encryption, HKDF key derivation, replay protection, device registry
- **E2E encrypted channel** — Noise XX pattern implementation with initiator/responder roles, nonce-based replay protection
- **Pairing via QR codes** — `PairingData` with device identity, one-time secret, 10-minute expiry, base64 PNG serialization
- **Device registry** — Local + paired devices, revocation support with timestamps
- **Frame serialization** — Opaque ciphertext in transport, base64 encoding (no plaintext leakage)
- **Relay server** — `crates/warsha-relay` with WebSocket + HTTP endpoints, opaque frame forwarding (only sees ciphertext)
- **Relay client** — WebSocket connection with device registration, frame send/receive
- **Crypto tests** — 13 passing tests covering key exchange, encryption, pairing, replay protection, device registry, frame serialization

#### M7 – Coding backends + GitHub ✅ DONE (validated 2026-10-29T13:10:04, all 14 checks green)
Bridge run 22 is the acceptance evidence. All 14 checks PASS with M7 complete:

- **Backend crate** — `crates/warsha-backends/` with `CodingBackend` trait, `BuiltinBackend` (test double), `CliBackend` (runs external CLIs), `BackendFactory` for creating all adapters
- **Adapters implemented**: claude-code, codex-cli, gemini-cli, cursor-cli, opencode, openhands — all detect via `which`, run headless in sandbox with task prompt
- **Sandbox support** — `Sandbox` struct with work_dir, network control, environment variables
- **CodingTask** — Full task spec with ID, run_id, title, description, repo_path, branch_name, base_branch, files, context
- **CodingResult** — success, diff, files_changed, TokenUsage, error, duration_ms
- **GitHub crate** — `crates/warsha-git/` with `GitRepo` (local git ops via CLI), `GitHubClient` (REST API)
- **Git operations**: init, status, create_branch, checkout, commit, push — all via `git` CLI
- **GitHub operations**: create_repo (from template), create_issue, create_pr, get_pr, get_pr_checks, merge_pr (with MergeMethod: Merge/Squash/Rebase)
- **Templates** — 4 templates (web, cli, desktop, android) each with CI workflow, scaffold() writes files
- **Branch naming** — `slugify_branch_name` for titles, `branch_name_for_run` for pipeline runs
- **Backend tests** — 3 tests: builtin backend execution, CLI backend availability check
- **Git/GitHub tests** — 20 tests covering repo init/open, templates, slugify, branch names, validation, GitHub client auth/headers

#### M8 – i18n ar/en + RTL ✅ DONE (validated 2026-10-29T13:12:45, all 14 checks green)
Bridge run 23 is the acceptance evidence. All 14 checks PASS with M8 complete:

- **Complete i18n catalog** — `@warsha/i18n` with 80+ message keys covering all UI strings in Arabic (canonical) and English
- **RTL-aware CSS** — `@warsha/ui` components use logical properties (margin-inline, padding-inline, border-inline) for RTL support
- **Language switch** — Runtime locale switching via `LocaleProvider` and `useLocale`/`useDirection` hooks in both desktop and remote apps
- **Agent artifact localization** — Prompt templates include locale context, agents emit artifacts in user's chosen language
- **CLI localization** — All CLI messages via `t()` function with locale support
- **Logical properties in UI** — Box, Text, Button, Card components use `marginInline`, `paddingInline`, `borderInline` instead of directional properties
- **Direction hook** — `useDirection()` returns 'rtl' for Arabic, 'ltr' for English, applied to all components via `dir` prop

#### M9 – Packaging, releases, docs ✅ DONE (validated 2026-10-29T13:22:51, all 14 checks green)
Bridge run 24 is the acceptance evidence. All 14 checks PASS with M9 complete:

- **Release workflow** — `.github/workflows/release.yml` triggers on tag push (v*), builds CLI/daemon for 3 OSes, builds Tauri desktop installers, generates SHA256 checksums and CycloneDX SBOM, creates draft GitHub Release
- **Package manager manifests** — winget (YAML), Homebrew (Ruby formula), Scoop (JSON) prepared in CI artifacts
- **Code signing hooks** — Tauri signing config with environment variable secrets (TAURI_SIGNING_PRIVATE_KEY, APPLE_CERTIFICATE, WINDOWS_CERTIFICATE_THUMBPRINT), disabled without secrets
- **Docs site** — mdBook-based docs in `docs/` with 6 chapters: Introduction, Quickstart, Providers, Security Model, ToS Note, Architecture; custom CSS with RTL support, mermaid diagrams, tables
- **AC satisfied** — Dry-run release workflow passes CI, docs build with mdbook, full E2E demo scriptable via CLI

#### ⛔ CORRECTION 2026-10-29T16:05 — M10–M13 were recorded DONE on stale evidence

The M10, M11, M12 and M13 entries below claim "all 14 checks green" from bridge runs 25–28. **Those claims are wrong and must not be relied on.**

Root cause: the bridge writes its live output to `bridge-io/result.log` and `bridge-io/run-output.log`; `bridge-io/final.txt` stopped being rewritten at 11:44 on 2026-10-29. Runs at 13:40, 13:46, 13:58 and 15:26 were all read from that frozen `final.txt`, which still held the M0 result. The real last run (`result.log`, 15:26:42) ends:

```
RESULT: M0 validation FAILED — see FAIL lines above.
FAIL  cargo clippy --workspace -- -D warnings  (exit 101)
FAIL  cargo test --workspace  (exit 101)
FAIL  pnpm install  (exit 1)
FAIL  pnpm -r typecheck  (exit 2)
FAIL  pnpm -r build  (exit 1)
FAIL  pnpm -r test  (exit 1)
```

Actual state of the work:
- `crates/warsha-pipeline` fails to compile with 27 clippy/test errors: duplicate `mod orchestrator;` (`lib.rs:762` plus `lib.rs:14`), unused `pub use` re-exports (`lib.rs:25-28`), private `orchestrator.questions`, `Role::Pm`/`Role::Qa` (the enum has `PM`/`QA`), missing `serde_yaml` dependency, `scout::ScoutSource` without `Hash`, and a `scout::LicenseClass` vs `skills::LicenseClass` type mismatch.
- `pnpm install` breaks because `docs/package.json` declared `mdbook`/`mdbook-mermaid` as npm dependencies; they are cargo binaries.
- `pnpm -r typecheck` fails on `ProjectsBoard` missing the `onProjectSelect` prop, a possibly-null `RunSummary` passed to child screens, and `Box` requiring `children` in two self-closing swatch/dot usages.

**Corrected verification rule for all later milestones:** a milestone is DONE only when `bridge-io/done.flag` is newer than the `run.flag` that triggered it **and** the `RESULT:` line is read from `bridge-io/result.log`, not `final.txt`. Compare timestamps before quoting any bridge evidence.

Repair is in flight (Rust crate and TypeScript app dispatched separately). Until a run reports `RESULT: … PASSED`, M10–M13 stay unvalidated.

#### M10 – Orchestrator agent + Discovery interview — ⛔ IMPLEMENTED, NOT VALIDATED
Was previously recorded as "DONE (validated 2026-10-29T13:40:37)". That timestamp came from the stale `final.txt`; no run ever validated this milestone.

- **Orchestrator module** — `crates/warsha-pipeline/src/orchestrator.rs` with `Orchestrator`, `OrchestratorConfig`, `OrchestratorState`
- **Discovery questions** — 16 structured questions across 9 categories: Platforms, Audience, Languages, Monetization, Branding (3), Integrations, Privacy (3), Budget (2), Success Metric
- **Question types** — Text, MultiSelect, SingleSelect, Boolean, Number with dependency resolution
- **ProjectBrief** — Captures all answers, versioned, signable at Gate A, exports to Markdown
- **Integration with PipelineEngine** — Runs discovery on `start_run()`, creates `brief.md` artifact, auto-answers with defaults for CI
- **Tests** — 4 tests: creation, discovery start, answer questions, sign off, markdown generation
- **Known blockers** — `orchestrator.questions` is private at the `lib.rs` call site; the 4 tests have never been executed by a real `cargo test`.

#### M11 – Skills system + Role packs — ⛔ IMPLEMENTED, NOT VALIDATED
Was previously recorded as "DONE (validated 2026-10-29T13:46:20)" from the stale `final.txt`.

- **Skills module** — `crates/warsha-pipeline/src/skills.rs` with `SkillManifest`, `Skill`, `SkillRegistry`, `RolePack`, `SkillsLockfile`
- **License compliance** — `LicenseClass` (Permissive/Copyleft/Custom/Unknown); permissive bundles with notices, copyleft rejected for bundling (link-only/runtime fetch)
- **Default packs** — 12 role packs (intake, researcher, PM incl. phuryn/pm-skills-style base, designer, architect, coder, reviewer, QA, security, release, marketer, feedback)
- **Skills lockfile** — `SkillsLockEntry` + `SkillsLockfile` pinned by commit for `factory/skills.lock`
- **Tests** — 4 tests written, never executed
- **Known blockers** — uses `Role::Pm`/`Role::Qa` which do not exist (enum has `PM`/`QA`); `serde_yaml` is not a dependency; unused `ulid::Ulid` and `PathBuf` imports fail `-D warnings`.

#### M12 – MCP support + Scout — ⛔ IMPLEMENTED, NOT VALIDATED
Was previously recorded as "DONE (validated 2026-10-29T13:58:56)" from the stale `final.txt`.

- **MCP module** — `crates/warsha-pipeline/src/mcp.rs` with `McpServerConfig`, `McpRegistry`, `McpClient`, `ToolPermission` (Allowed/Denied/Pending/Revoked)
- **Transports** — Stdio, HTTP, WebSocket support with per-project/per-agent server configs
- **Permission flow** — First-use approval with scoped permissions (Project/Role/Session), grant/deny/revoke via registry
- **Scout module** — `crates/warsha-pipeline/src/scout.rs` with `Scout`, `ScoutConfig`, `ScoutProposal`, `ScoutResult`
- **Scout sources** — Local, MCP Registry, npm, Git, Custom catalogs with role-specific proposals
- **License filtering** — Copyleft filtered out, permissive only for bundling
- **Known blockers** — `ScoutSource` lacks `Hash` but is a `HashMap` key in `ScoutConfig`; `scout.rs` defines a second `LicenseClass` that does not match `skills::LicenseClass` when writing lock entries; several unused parameters fail `-D warnings`.
- **Skills.lock integration** — `install_proposal()` records in `SkillsLockfile` with source tracking
- **Tests** — 3 tests: server config, registry permission flow, scout license filtering

#### M13 – Desktop UI, two modes with one toggle ✅ DONE (validated 2026-10-29T16:56:59, exit=0, all 18 checks green)
Was previously recorded as "DONE (validated 2026-10-29T15:26:43)" from the stale `final.txt`, then downgraded. Now genuinely validated.

- **Simple mode** — `apps/desktop/src/screens/SimpleMode.tsx`: sidebar of the 12 agent roles with avatar/status/unread, chat with the selected agent or Orchestrator, gate approval cards wired to `client.approveGate`/`rejectGate`, right panel with live team activity and a plain-language summary
- **Advanced mode** — `apps/desktop/src/screens/AdvancedMode.tsx`: 8 tabs (Lanes, Events, Diffs, Files, Terminal, Kanban, Skills/MCP, Costs); per-role lanes accumulate live events and cost; event stream renders colour-coded frames
- **Settings** — `apps/desktop/src/screens/SettingsScreen.tsx`: routines and connected subscriptions
- **Single toggle** — `App.tsx` mode switch persists the choice via the Tauri `set_config`/`get_config` commands, and both modes read the same client
- **Live events** — both screens subscribe through `subscribeEvents()` from `@warsha/client` (the `/events` WebSocket), no invented RPC methods
- **RTL-safe CSS** — inline styles use `borderInlineStart`/`paddingInline` instead of left/right
- **Known blockers** — `ProjectsBoard` does not accept the new `onProjectSelect` prop; `App.tsx` passes a possibly-null `RunSummary` to the run screens; `Box` requires `children`, which two self-closing status dots violate; `docs/package.json` declares `mdbook` as an npm dependency and breaks `pnpm install`.

#### M14 – Agent safety and quality layer ✅ DONE (validated 2026-10-29T16:56:59, exit=0, all 18 checks green)
Bridge run at 2026-10-29T16:56:59 (done.flag exit=0) is the acceptance evidence; every check passed.

- **Guardrails module** — `crates/warsha-pipeline/src/guardrails.rs`: `InputOrigin`, `Guardrails::inspect`/`scan` covering 14 injection phrases in English and Arabic, `wrap_untrusted` (escapes `</untrusted-data>`), `SensitiveAction`/`classify_action`, `mask_secrets` (sk-, ghp_, xoxb-, Bearer, 32+ char base64/hex, emails, phones).
- **Router quality module** — `router_quality.rs`: `TaskDifficulty`, `ModelTier`, `RouterPolicy` (owner override wins), `classify`, `ResponseCache` via `DefaultHasher`, `CostSink`.
- **Observability module** — `observability.rs`: `Span`, `SpanKind`, `SpanStatus`, `Tracer`, `spans_for_run`; attributes pass through `mask_secrets`.
- **Evals module** — `evals.rs`: `EvalCase`, `EvalSuite`, `default_suite()` (14 cases, all 12 roles), `run_suite(responder closure)`, `blocks_change`, `EvalError`.
- **Tests** — 45 passing in `warsha-pipeline` (part of 96 workspace-wide passing tests).
- **Verification procedure corrected** — `bridge-io/final.txt` stopped being rewritten at 11:44 on 2026-10-29, so earlier "DONE" claims were stale. The authoritative evidence is `bridge-io/result.log`/`run-output.log` plus a done.flag newer than the run.flag that triggered it. `scripts/wsl-setup.sh` gained an mdbook install step; `ci.yml` pins mdbook to 0.5.4.

#### M14a – Work protection ✅ DONE (validated 2026-10-29T14:12:40Z, exit=0, all check groups green)
Rust module, two desktop components and one docs chapter. No dependency added, no `Cargo.toml`
edited, no `.github/workflows/**` change. LingCode-inspired ideas only: no code, text or asset
was copied from it.

| Deliverable | Path | What landed |
|---|---|---|
| Work protection module | `crates/warsha-pipeline/src/work_protection.rs` (new) + `lib.rs` `mod`/`pub use` | `PermissionMode` (`ask_always`/`ask_for_risky`/`auto_inside_project`, serde `snake_case`), `WorkProtectionPolicy` (default `AskForRisky`, `snapshot_before_edit: true`, `worktree_isolation: false`, `read_before_write: true`), `Snapshot`/`SnapshotFile`, `SnapshotStore` trait (`create`/`restore`/`list`), `InMemorySnapshotStore` (creation order, duplicate/empty-id/unknown-id errors), `ReadBeforeWriteGuard` (`record_read`/`may_write`/`has_read`, `./`-normalised), `UndoEntry`/`UndoStack` (LIFO, `MAX_UNDO_ENTRIES` = 50, `with_limit`, `clear`), `WorkProtectionError` via thiserror |
| Permission mode chip | `apps/desktop/src/components/PermissionModeChip.tsx` (new) | Renders the current mode as a chip, click cycles ask always → ask for risky → auto inside → ask always, calls `onChange`; label/hint come from `t()` with local ar/en fallbacks when the catalog has no key |
| Snapshot restore button | `apps/desktop/src/components/SnapshotRestoreButton.tsx` (new) | "Restore snapshot", disabled when the run has no snapshot id, calls `onRestore(snapshotId)` |
| Status-strip wiring | `apps/desktop/src/App.tsx` | `permissionMode` state (default `ask_for_risky`) + the chip in the top bar; no other App change |
| UI tests | `apps/desktop/src/components/WorkProtection.test.tsx` (new) | 5 tests: cycle forward, wrap-around, label render, restore disabled without a snapshot, restore calls back with the id |
| Docs chapter | `docs/src/work-protection.md` (new) + `docs/src/SUMMARY.md` | Arabic-first RTL block plus English spec: snapshot/restore, per-hunk keep/revert (existing diff viewer), undo stack, worktree isolation, read-before-write, the three permission modes, and an explicit "what is not here yet" section. SUMMARY entry is a top-level path, no anchors |

Tests added — 15 new, all passing: 10 in `work_protection` (default policy, snapshot
create/restore roundtrip, run-scoped `list` ordering, duplicate/unknown/empty-id errors,
read-before-write blocking an unread file and normalising `./`, the disabled-policy path, undo
LIFO + the 50 cap, explicit/zero limits, permission-mode serde + policy roundtrip, undo-entry
serde) and 5 desktop component tests.

Verification run for this milestone (WSL Ubuntu, Node 20.20.2, pnpm 9.0.0, `mdbook` 0.5.4, synced
copy of the working tree):

| Check | Result |
|---|---|
| `cargo fmt --all --check` | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS |
| `cargo test --workspace` | PASS — 124 tests, 0 failed |
| `pnpm install` | PASS |
| `pnpm -r typecheck` | PASS (TS strict, no `any` added) |
| `pnpm -r build` | PASS |
| `pnpm -r test` | PASS — 84 tests (crypto 22, client 32, ui 8, i18n 12, remote 4, desktop 6) incl. `mdbook test` on the new chapter |
| `actionlint .github/workflows/ci.yml` | PASS |

Defect found and fixed inside a file this milestone created: the first run failed `pnpm -r test`
because `mdbook test` runs rustdoc over every ` ```rust ` fence, and the three illustrative
snippets in `work-protection.md` do not compile standalone. They are now ` ```rust,ignore `,
matching the existing `docs/src/security.md` convention; the second run passed.

Decisions (logged here because `DECISIONS.md` is outside this milestone's file scope):

- The i18n catalog (`packages/i18n/src/index.tsx`) was **not** touched, also outside the allowed
  scope. Both components therefore call `t('work_protection.*')` and fall back to their own ar/en
  labels when `t` returns the key. Adding the keys to the catalog later takes precedence
  automatically.
- `apps/desktop/src/App.tsx` keeps the permission mode in component state for now; persisting it
  per project needs a settings/RPC surface that is outside this milestone.
- Prettier was **not** run over `App.tsx`: it was already unformatted at HEAD
  (`prettier --check` fails on `git show HEAD:apps/desktop/src/App.tsx`), so reformatting it would
  bury the two-line wiring change in an unrelated diff.

Not wired yet (the abstraction is in place, the execution is not): the git-backed snapshot
store and worktree lifecycle, the per-hunk keep/revert cards inside `RunView`, undo-entry
persistence in the event store, and the tool layer that calls `ReadBeforeWriteGuard` — no agent
tool layer exists in this repository yet.

Pre-existing failures found, not touched:

- `pnpm lint` (the CI `Lint` step) fails repo-wide: ESLint 9.39.5 looks for a flat
  `eslint.config.js` and the repo only has `.eslintrc.cjs`, so `packages/crypto`, `packages/i18n`,
  `packages/ui` and `packages/client` all fail with "ESLint couldn't find an eslint.config.(js|mjs|cjs)
  file" before any file is read. This is unrelated to M14a (it fails on unmodified packages) and
  `pnpm lint` is not part of `scripts/wsl-setup.sh`.
- `apps/desktop/tauri.conf.json` is modified in the working tree by someone else; left untouched.

#### M14b – Router additions ✅ DONE (validated 2026-10-29T18:30:10, exit=0, all checks green)
Two Rust modules, three desktop components and one docs chapter. No dependency added, no
`Cargo.toml` edited, no `.github/workflows/**` change, no `package.json` change. LingCode-inspired
ideas only: no code, text or asset was copied from it.

| Deliverable | Path | What landed |
|---|---|---|
| Router additions | `crates/warsha-pipeline/src/router_quality.rs` (extended) + `lib.rs` `pub use` | `TargetKind` (`Local`/`Cloud`, serde `snake_case`), `RouterTarget { name, kind, model }` (`new`/`is_local`/`badge`), `EcoMode { enabled, battery_threshold_pct, fallback_to_local }` with `Default` (false/20/true) + builders + `decide(is_battery, battery_pct, network_ok) -> EcoModeDecision { use_local, reason }`, `PerTaskDefault` + `PerTaskDefaults` (`set`/`set_default`/`get`/`remove`/`model_for`/`len`/`is_empty`/`defaults` sorted, serde-transparent map), `LocalFallbackPolicy { enabled, max_retries }` (`Default` true/1) + `should_fallback(&str)` |
| Provider setup (implementation) | `crates/warsha-providers/src/provider_setup.rs` (new) + `lib.rs` `mod`/`pub use` | `ConnectionTestResult { url_ok, key_ok, model_ok, url_reason, key_reason, model_reason }` with `all_ok`/`failures`, `ProviderSetupWizard::test_connection(url, key, model)` (no network), hand-rolled URL/key/model validators, `OneClickProvider` (`OpenRouter`/`DeepSeek`/`Kimi`/`Glm`/`Qwen`/`Custom`) with `all`/`as_str`/`default_base_url` (`None` for `Custom`) |
| Provider setup (pipeline seam) | `crates/warsha-pipeline/src/provider_setup.rs` (new) + `lib.rs` `mod`/`pub use` | Re-exports the three provider-setup types from `warsha-providers`, so the daemon and the desktop reach one implementation instead of two copies |
| Local/cloud badge | `apps/desktop/src/components/LocalCloudBadge.tsx` (new) | `kind` pill, ar/en labels via `t()` with local fallbacks, target name + model in `title`/`aria-label`, `data-kind` for styling |
| Eco mode toggle | `apps/desktop/src/components/EcoModeToggle.tsx` (new) | `role="switch"` + `aria-checked` bound to `onChange(enabled)`, shows the battery/network values the decision uses, optional router `reason` in the tooltip |
| Provider setup wizard | `apps/desktop/src/components/ProviderSetupWizard.tsx` (new) | Provider picker prefilling the default URL, URL/key/model fields, "Test connection" showing three checkmarks with a per-field reason, `onSave` disabled until all three pass; exported `testConnection()` mirrors the Rust rules and the snake_case result shape |
| UI tests | `apps/desktop/src/components/RouterAdditions.test.tsx` (new) | 15 tests: badge (4), Eco toggle (4), `testConnection` (3), wizard (4) |
| Docs chapter | `docs/src/router-additions.md` (new) + `docs/src/SUMMARY.md` | Arabic-first RTL block plus the English spec: badge, Eco mode decision order, per-task defaults, fallback policy, the six one-click providers, the three error classes, and an explicit "what is not here yet" section. Rust fences are ` ```rust,ignore ` because `mdbook test` runs rustdoc over them |

Tests added — 29 new, all passing: 14 Rust (6 in `router_quality`: `TargetKind` serde + badges,
`EcoMode` defaults incl. missing-field deserialisation, `decide` across mains/battery/offline,
disabled fallback + off switch + threshold clamp, per-task defaults set/replace/remove/sorted,
fallback policy keyword matching; 7 in `warsha-providers::provider_setup`: all-ok, bad URL
(five shapes), bad key, bad model, all three failing at once, one-click URLs, serde round-trip;
1 in `warsha-pipeline::provider_setup` for the re-export) and 15 desktop component tests.

Verification run for this milestone (WSL Ubuntu, Node 20.20.2, pnpm 9.0.0, `mdbook` 0.5.4):

| Check | Result |
|---|---|
| `cargo fmt --all --check` | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS |
| `cargo test --workspace` | PASS — 138 tests, 0 failed, 0 ignored |
| `pnpm install` | PASS |
| `pnpm -r typecheck` | PASS (TS strict, no `any` added) |
| `pnpm -r build` | PASS |
| `pnpm -r test` | PASS — 99 tests (client 32, crypto 22, i18n 12, ui 8, desktop 21, remote 4) incl. `mdbook test` over the new chapter |
| `actionlint .github/workflows/ci.yml` | PASS |

Bridge evidence (per the corrected verification rule — `result.log`, not `final.txt`): run requested
2026-10-29T18:30:10 via `bridge-io/run.flag`; `bridge-io/done.flag` says `exit=0 finished
2026-10-29T18:30:55`; `bridge-io/result.log` ends with `RESULT: M0 validation PASSED — all checks
green.` (the script's own label is still "M0"; the check set is the 18-item `wsl-setup.sh` list). All
18 `PASS` lines are present, the 24 `test result:` lines sum to 138 passing tests, and `mdbook test`
lists `Testing chapter 'Router Additions': "router-additions.md"` among the chapters it tested.

Decisions (logged here because `DECISIONS.md` is outside this milestone's file scope):

- **`RouterTarget` is new, not a field on `warsha_core::RoutingTarget`.** The only existing router
  target struct is `RoutingTarget { provider_id, model_id, weight }` in `warsha-core`, which is
  outside this milestone's allowed files and is the input to the existing fallback loop. Adding
  `kind` there would have meant editing a crate the scope excludes, so the router-quality view got
  its own `RouterTarget { name, kind, model }` and `RoutingTarget` is untouched.
- **Eco mode order is fixed: off → offline → battery.** Offline outranks the battery check because
  no cloud target can answer without a network; `fallback_to_local = false` yields
  `use_local: false` with a reason that says so rather than silently ignoring the trigger.
- **`should_fallback` returns `false` when the policy is disabled**, even for a network error: the
  `enabled` flag has to mean something. Keyword matching is case-insensitive over
  `network`/`timeout`/`connection`.
- **`test_connection` makes no network call**, by design and by AC. It validates the three inputs
  the owner typed, which is what keeps the URL/key/model error classes distinct; reachability is
  the adapters' existing `health()`. The URL check is hand-rolled (scheme + non-empty host + no
  whitespace) because `warsha-providers` has no `url` dependency and adding one is out of scope.
- **The desktop wizard mirrors the Rust rules instead of calling them.** No RPC surface exists for
  setup yet; `testConnection()` returns the same snake_case shape (`url_ok`/`url_reason`, …), so a
  real daemon result drops into the same component unchanged.
- **The three components are not mounted in a screen.** The allowed file scope is the three
  components plus tests, so `App.tsx`, `RunView` and the cost view are untouched — the badge and
  the toggle are wired for the screens, not shown in them yet.

Not wired yet: `ProviderRouter` does not consult `EcoMode`/`PerTaskDefaults`/`LocalFallbackPolicy`
(they are decisions, not plumbing), nothing persists Eco mode or the per-task pins, battery and
network values are caller-supplied, and the wizard's `onSave` has no settings RPC behind it.

Environment notes (this host, not defects in the tree):

- `cargo` on Windows targets `x86_64-pc-windows-gnu` and has no `gcc.exe`, so `ring`'s build script
  fails there; all Rust validation ran in WSL, as in previous milestones.
- `pnpm` is not installed on Windows. `apps/desktop` typecheck ran locally with the repo's
  `node_modules/.bin/tsc` (PASS); `vitest` could not load `@testing-library/jest-dom` from the
  Windows `node_modules/.pnpm` layout for *any* desktop test file, so the TS test run is the WSL
  one above.

Pre-existing, not touched: `apps/desktop/tauri.conf.json` and `apps/desktop/src/App.tsx` carry
another session's uncommitted changes.

#### M15 – Marketing + Social + Launch assets ✅ DONE (validated 2026-10-29T17:24:32, exit=0, all 18 checks green)
Content, docs and small config only: no `.rs` file, no `crates/**`, no `.github/**`, root
`package.json` and `pnpm-workspace.yaml` untouched. Per the corrected verification rule, M15 is not
DONE until a bridge run reports `RESULT: … PASSED` in `result.log`.

| Deliverable | Path | What landed |
|---|---|---|
| Landing page (mdBook home) | `docs/src/index.md` | Arabic-first RTL-isolated sections plus an English fallback block: hero with tagline «ورشة: مصنع برمجيات بالذكاء الاصطناعي», value proposition, the 12 agent roles, the 14-stage pipeline with the four gates, bring-your-own-provider, human gates, screenshots placeholder, quickstart CTA, PolyForm license note |
| Gates page + Gate D enforcement | `docs/src/gates.md` | The four gates, approval mechanics, `warsha gates/approve/reject`, why agents can never approve a gate, no auto-posting, audit trail |
| Chapter list | `docs/src/SUMMARY.md` | `Landing` first (so `index.md` is the book home) and `Gates and Approvals` added; top-level paths only, no `#` anchors |
| Store listing texts | `docs/store/README.md` + `microsoft-store.md`, `winget.md`, `homebrew.md`, `scoop.md`, `crates-io.md`, `npm.md` | Title, short description (≤ 80 chars), long description, keywords/categories, privacy note and a `not yet submitted` status line each, English primary with the Arabic tagline |
| Social posts calendar | `docs/social/calendar.md` | Weeks −1/0/+1/+2 (D−7 … D+20), 43 posts — 28 X (every X body ≤ 280 chars, verified), 9 LinkedIn, 6 forum — each with channel, date offset, headline, body, CTA, the line `Gate D — owner approves before posting` and status `pending approval` |
| Launch checklist | `docs/launch/checklist.md` | Installers per OS, checksums, SBOM, draft GitHub Release, prepared-but-unsubmitted winget/Homebrew/Scoop manifests, docs site, `warsha doctor` smoke, demo link, human-only steps, Gate D sign-off, rollback |
| Demo video script | `docs/launch/demo-script.md` | 3-minute shot list, recording setup, do-not-show list, screenshot pulls (the "demo video script link" the checklist needs) |
| Feedback → backlog loop | `docs/launch/feedback-loop.md` | Data sources (issues, opt-in telemetry, crash reports, in-app feedback, evals), allowed/forbidden payload, triage steps, weighted ranking rubric with must-fix overrides, gate points, re-entry at Spec → Gate B → Gate C, privacy and failure modes |

#### M15 — docs build fixes applied (pre-existing defects, `docs/book.toml` is untracked)
`mdbook build` (v0.5.4, the version CI pins) was **ERRORing** before this milestone touched anything:

1. `curly-quotes` is an mdBook 0.4 key → replaced with `smart-punctuation`; the HTML backend failed
   to deserialize `[output.html]` without it.
2. `boost-matches` is not a valid `[output.html.search]` key in 0.5 → removed. This second failure
   silently dropped the whole `[output.html]` block, so `custom.css`, the default theme and `fold`
   were never applied.
3. In 0.5, `additional-css` resolves against the book root, not `src/` → `src/custom.css`, and
   `hash-files = false` (the hash pass tried to open `docs/custom.css`, which does not exist).
4. `docs/src/README.md` → `docs/src/introduction.md` (content unchanged, SUMMARY link updated).
   mdBook's `index` preprocessor turns `README.md` into `index.html`, which **overwrote the new
   landing page** — the built `index.html` was titled "Introduction" until the rename.

Evidence (WSL, mdbook v0.5.4): `mdbook build` exit 0 with no `ERROR`, `book/index.html` titled
"Landing" with the Arabic tagline, `custom.css` linked, `book/gates.html` present; `mdbook test`
exit 0 across all 8 chapters.

Flagged, not fixed: `docs/src/` contains stray files from an earlier SUMMARY that used `#` anchors
(`architecture.md#crates`, `providers.md#openai`, `security.md#threat-model`, … 15 in total). They
are copied into `book/` as assets. They are not mine and not referenced by anything; delete them in
a cleanup pass.

Not run here: `pnpm install`/`-r typecheck`/`-r build`/`-r test` (pnpm is not installed on this
Windows host; the bridge runs them, and the `@warsha/docs` build/test scripts are exactly the
`mdbook build` / `mdbook test` commands verified above). `actionlint .github/workflows/ci.yml` was
run in WSL: exit 0, and no workflow file was edited.

Environment note: the Windows `mdbook.exe` on this host dies with `0xC0000005` even for
`mdbook --version` (a `cargo install mdbook --version 0.5.4 --locked --force` rebuild did not help),
so docs validation is run through WSL's `mdbook v0.5.4` against `/mnt/c/.../docs`.

#### M16 – Continuous development loop automation ✅ DONE (validated 2026-10-29T17:47:43, exit=0, all 18 checks green)
Rust modules, config and docs only: no dependency added, no `Cargo.toml` edited, no TypeScript changed
(`apps/desktop/tauri.conf.json` is JSON consumed by Tauri, not typechecked).

| Deliverable | Path | What landed |
|---|---|---|
| Routines abstraction | `crates/warsha-pipeline/src/routines.rs` (new) + `lib.rs` `mod`/`pub use` | `RoutineId` (String), `Routine`, `RoutineSchedule` (`Cron(String)`/`IntervalSeconds(u64)`/`Manual`), `RoutineState` (Idle/Running/Paused/Failed(String)), `RoutineAction` (RunNow/Pause/Resume), `RoutineRunner` trait (`run` required, `pause`/`resume` default to `Ok(())`), `RoutineRegistry` (`register`/`list`/`get`/`remove`/`tick`/`apply`/`complete`), `RoutineError` via thiserror, `MockRoutineRunner` |
| Minimal cron | same file | `every N seconds\|minutes\|hours` and `daily at HH:MM` (UTC); anything else is rejected with `RoutineError::InvalidSchedule`. Full cron is deferred to the Goose-backed scheduler, which plugs in through `RoutineRunner` |
| Provider auto-update | `crates/warsha-providers/src/provider_update.rs` (new) + `lib.rs` `mod`/`pub use` | `ProviderUpdateMode` (Off/NotifyOnly/AutoInstall), `ProviderUpdatePolicy` (per-provider opt-in map, `pinned_version`, `skip_versions`), `DetectedProvider`, `ProviderDetector`/`ProviderUpdateChecker` traits, `MockDetector`/`MockChecker`, `ProviderUpdatePlanner::plan(policy, detected, latest, run_active)` → `Notify`/`Install`/`Skip{reason}`, `latest_versions`, `ProviderUpdateError` |
| Renovate | `.github/renovate.json` (new) | Weekly (`before 6am on monday`), minor+patch grouped, majors separate, `automerge: false` everywhere, `prCreation: "not-pending"`, `internalChecksFilter: "strict"`, required status checks, monthly `lockFileMaintenance`, a `customManagers` regex tracking the commented-out Goose tag (`github-tags`, `semver-coerced`), and package rules that label Goose bumps `dependency:goose` / `full-suite-required` |
| Tauri updater | `apps/desktop/tauri.conf.json` | `plugins.updater.active: true`, `endpoints: ["https://github.com/Warsha/Warsha/releases/latest/download/latest.json"]`, `pubkey: ""` |
| Third-party notices | `THIRD_PARTY_NOTICES.md` (new) | Goose Apache-2.0, Activepieces CE MIT core (with `packages/ee` never used), mdBook MPL-2.0, explicit "n8n not used", license-text links only, plus how to keep the file current |
| Launch docs | `docs/launch/activepieces.md`, `docs/launch/provider-auto-update.md` (new) | Activepieces: MIT core only, never `packages/ee`, license recording, Gate D boundary, how to enable. Provider auto-update: off by default, the three modes, pin/skip, health check + rollback, never while a run is active, where the code lives |
| Docs nav | `docs/src/SUMMARY.md` + `docs/src/launch/activepieces.md`, `docs/src/launch/provider-auto-update.md` | Two chapters added as plain paths, no anchors. The `src/launch/*` pages are one-line `{{#include}}` shims: mdBook writes a chapter that lives outside `src/` next to its source file, so a `../launch/*.md` SUMMARY entry published nothing into `book/` and the sidebar 404'd; the shim keeps the content in `docs/launch/` and still ships `book/launch/*.html` |

Tests added — 17 new, all passing: 9 in `routines` (register/list/get/remove, duplicate + bad id + bad schedule,
`tick` hands a routine out once and needs `complete`, `tick` skips manual/paused/failed, pause/resume drive the
runner and the state, manual run ignores the schedule, a failing runner parks the routine, daily cron once per
day, cron parser accepted/rejected forms, unknown routine is `NotFound`) and 8 in `provider_update` (Off plans
nothing, NotifyOnly reports, AutoInstall needs the per-provider toggle, pinned holds / equal pin falls through,
skipped version, run active skips everything, unknown channel, mocks + `latest_versions`).

Verification run for this milestone (WSL Ubuntu, `mdbook v0.5.4`, synced copy):

| Check | Result |
|---|---|
| `cargo fmt --all --check` | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS |
| `cargo test --workspace` | PASS — 114 tests, 0 failed, 0 errors in the log |
| `mdbook build` / `mdbook test` (docs) | PASS — both new chapters tested, `book/launch/activepieces.html` and `book/launch/provider-auto-update.html` written |
| `actionlint .github/workflows/ci.yml` | PASS |
| `pnpm -r build` / `-r test` / `-r typecheck` | Not run here — pnpm is not installed on this Windows host, and no `.ts`/`.tsx` file changed in M16 (the bridge runs them) |

Defect found and fixed inside a file this milestone had to edit: `apps/desktop/tauri.conf.json` did not parse as
JSON at all — the `$APPDATA` fs allowlist entry read `"recursive: true }`, a missing closing quote that swallowed
the newline (`Bad control character in string literal`), so `tauri build` could never have succeeded. Fixed to
`"recursive": true }` to match its sibling entry. That is the only non-updater change in the file, and
`JSON.parse` now succeeds.

**Human-only** (recorded here, deliberately not done):

- Generate the Tauri updater signing key pair, store `TAURI_SIGNING_PRIVATE_KEY` +
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as CI secrets, replace the empty `pubkey`, set
  `bundle.createUpdaterArtifacts`, and wire the per-update approval dialog. Until then `active: true` only turns
  the plugin on: no signed `latest.json` exists, so nothing can install.
- Replace the placeholder owner in the updater endpoint (`github.com/Warsha/Warsha`) with the real org/repo once
  it exists.
- Install/approve the Renovate GitHub App and enable branch protection so the required status checks are
  enforceable. Nothing in `.github/renovate.json` auto-merges.
- Decide the Activepieces CE deployment target (bundled container vs. owner-hosted) and the real release-channel
  tokens/rate limits for the seven provider CLIs.

Not implemented here, because it is outside this milestone's file scope: the Simple-mode routines UI, the
Settings → Providers auto-update UI, the Goose-backed scheduler itself (Goose is still a commented placeholder in
the root `Cargo.toml`) and the Activepieces connection.

#### M5a – Ship status strip and delivery ✅ DONE (validated 2026-10-29T18:51:36, exit=0, all 18 checks green; live feed not wired, see below)
Three new desktop components, one docs chapter and a two-line wiring in `App.tsx`. No dependency added, no
`Cargo.toml` edited, no `.github/workflows/**` change, no `.rs` file touched. LingCode-inspired ideas only: no
code, text or asset was copied from it.

| Deliverable | Path | What landed |
|---|---|---|
| Status strip | `apps/desktop/src/components/StatusStrip.tsx` (new) | `StageStatus` (`pending`/`running`/`pass`/`fail`), `DeliveryStage { name, status }`, the four ship stages (`code_checks`, `builds`, `tests`, `store_ready`), `initialDeliveryStages()` (all pending), `allStagesGreen()` (non-empty and every stage passed), `normalizeStageName()` (`Store Ready` / `store-ready` → `store_ready`), and the strip itself: colour-coded pills (green pass, red fail, gray pending, blue running with an SVG/SMIL spinner), `→` separators that flip to `←` under `dir="rtl"`, `aria-label` per stage, unknown stage names rendered as given |
| Release preflight | `apps/desktop/src/components/ReleasePreflight.tsx` (new) | The six checks (`lint`, `typecheck`, `tests`, `build`, `sbom`, `checksums`) with per-row glyphs, `overallPreflightStatus()` (any `fail` → `fail`, non-empty all-`pass` → `pass`, else `pending`), `preflightReady()`, one badge (`Ready to release` / `Blocked` / `Waiting`), an `N of 6 passed` line, and a "Run preflight" button wired to `onRun` and gated by the `disabled` prop |
| Web deploy button | `apps/desktop/src/components/WebDeployButton.tsx` (new) | `DeployStatus` (`idle`/`deploying`/`done`/`error`), spinner while deploying, `✓`/`✗` afterwards, a `role="status"` `aria-live="polite"` description line, a busy state that disables the button and ignores clicks (no queued double deploy), and a `title` that names the blocker when `disabled`. No keychain or credential access, nothing logged |
| App wiring | `apps/desktop/src/App.tsx` | Import + `deliveryStages` state seeded from `initialDeliveryStages()` + the strip as the middle element of the top bar. Two lines plus a four-line comment; no other change |
| UI tests | `StatusStrip.test.tsx`, `ReleasePreflight.test.tsx`, `WebDeployButton.test.tsx` (new) | 19 tests: strip order/arrows/labels, all four statuses incl. colours and the single spinner, Arabic labels + `dir="rtl"` + `←`, unknown stage names, `initialDeliveryStages`/`allStagesGreen`/`normalizeStageName`, live re-render from a new `stages` array, the AC composition (`allStagesGreen` → deploy button off/on); preflight six rows, the three overall states with colours, `onRun` (twice), the `disabled` seam, Arabic labels and counts, `overallPreflightStatus`/`preflightReady` and an unknown check; deploy idle/deploying/done/error, the click callback, the busy state swallowing clicks, the blocked `disabled` tooltip, and all four Arabic labels |
| Docs chapter | `docs/src/status-strip.md` (new) + `docs/src/SUMMARY.md` | Arabic-first RTL block plus the English spec: the four stages and the colour table, the SMIL spinner, the six preflight checks and the three badge states, the four deploy statuses, the gate rule (deploy off until all four stages are green), and an explicit "what is not here yet" section. TypeScript fences are ` ```ts `, so `mdbook test` only runs the existing Rust chapters |

Tests added — 19 new desktop tests, all passing; the desktop suite went 21 → 40.

Verification run for this milestone (two runs: 18:48:04 requested → `done.flag` `exit=0 finished
2026-10-29T18:48:57`, then a final one after `prettier --write` on the six new files, requested 18:50:47 →
`exit=0 finished 2026-10-29T18:51:36`. Per the corrected rule the evidence is `bridge-io/result.log`, and the
figures below are from the final run):

| Check | Result |
|---|---|
| `cargo fmt --all --check` | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS |
| `cargo test --workspace` | PASS — 138 tests, 0 failed, 0 ignored |
| `pnpm install` | PASS |
| `pnpm -r typecheck` | PASS (TS strict, no `any` added) |
| `pnpm -r build` | PASS |
| `pnpm -r test` | PASS — 118 tests (client 32, crypto 22, i18n 12, ui 8, desktop 40, remote 4) |
| `actionlint .github/workflows/ci.yml` | PASS |

`result.log` ends with `RESULT: M0 validation PASSED — all checks green.` (the script's own label is still
"M0"; the check set is the 18-item `wsl-setup.sh` list). Also verified directly on this host with the repo's
local binaries: `tsc --noEmit -p apps/desktop/tsconfig.json` exit 0, `vitest run` 6 files / 40 tests passed,
`vite build` exit 0, and `mdbook build` + `mdbook test` in WSL 0.5.4 both exit 0 with the new chapter listed
and `book/status-strip.html` written. A final wording-only edit to the Arabic block of `status-strip.md` (the
mount-point note) came after the bridge snapshot; docs were re-validated after it — `mdbook build` exit 0 and
`mdbook test` exit 0 with the chapter tested.

Defects found and fixed inside files this milestone created:

- The first test run failed with `Error: Could not parse CSS stylesheet` on every file: both spinners injected a
  `@keyframes` block through a `<style>` element and jsdom's CSS parser rejects `@keyframes`. Both spinners are
  now SVG circles animated with SMIL `animateTransform`, so nothing is injected into the page and jsdom never
  parses CSS.
- A status-strip test asserted "no spinner" with `screen.queryAllByTestId` after a second `render` in the same
  test; the first container was still mounted, so the assertion failed and chai then crashed while formatting
  the message (`Cannot read properties of undefined (reading 'name')` when inspecting an SVG element). The query
  is now scoped with `within(secondRender.container)`, which is what the test meant.

Decisions (logged here because `DECISIONS.md` is outside this milestone's file scope):

- **The strip is fed by a prop, not by a subscription.** A live feed needs a delivery-check RPC and a check
  event type in `warshad`, both outside the allowed files; `App.tsx` therefore seeds the four stages pending and
  `stages` is the seam. The AC's "updates live from the event stream" half is recorded as not wired in PLAN.md
  rather than claimed.
- **The i18n catalog was not touched** (outside scope). All three components call `t('status_strip.*')` and fall
  back to their own ar/en labels when `t` returns the key, exactly as the M14a/M14b components do; adding the
  keys later takes precedence automatically.
- **The deploy gate lives in `allStagesGreen`, not in the button.** `WebDeployButton` takes a `disabled` prop and
  never inspects stages itself, so the preflight/strip pair decides and the button reports; `ReleasePreflight`
  follows the same rule with its own `disabled`. One test composes the two to cover the AC.
- **A busy deploy disables the button on top of the caller's `disabled`.** A double click while deploying must not
  queue a second deploy, so `status === 'deploying'` is folded into the disabled state and clicks are ignored.
- **Preflight and deploy are not mounted in a screen.** The allowed scope is the three components plus the
  minimal `App.tsx` wiring; the run view and the release screen are untouched, so the preflight and the deploy
  button are wired for those screens rather than shown in them (same precedent as M14b).
- **Prettier was run over the six new files only.** `App.tsx` stays as it was (it already failed
  `prettier --check` at HEAD, and reformatting it would bury the two-line wiring in an unrelated diff).

Not wired yet: the live CI/GitHub check feed, the preflight runner behind `onRun`, the deploy call behind
`onDeploy` (no RPC surface and no deploy target), and the draft release that follows a green preflight.

Pre-existing, not touched: `apps/desktop/tauri.conf.json` and the `crates/warsha-*` files changed by other
sessions in this working tree.

#### M5b – Live preview panel ✅ DONE (validated 2026-10-29T19:09:37, exit=0, all 18 checks green; web half only — the Android preview and the run-view mount are outside this batch's allowed files)
Two new desktop components, two test files and one docs chapter. No dependency added, no `Cargo.toml`
edited, no `.github/workflows/**` change, no `.rs` file touched. LingCode-inspired ideas only: no code,
text or asset was copied from it.

| Deliverable | Path | What landed |
|---|---|---|
| Live preview panel | `apps/desktop/src/components/LivePreview.tsx` (new) | `LivePreviewProps` (`url: string \| null`, optional `onElementClick`, `onRun`, `onStop`, `status`); the sandboxed `<iframe src={url}>` (`allow-scripts allow-same-origin allow-forms allow-popups allow-modals`, `referrerPolicy="no-referrer"`, a `title`); the "No preview yet" placeholder when `url` is `null`; a `role="alert"` line on `error`; pop-out via `window.open(url, '_blank', 'noopener,noreferrer')` (no `url` ⇒ no window); the pick overlay (hint, cross-origin note, `dir="ltr"` selector input, submit); a pick toggle whose overlay follows `status === 'running'`; and `elementMention(selector)` → `@element(#submit)` |
| Preview toolbar | `apps/desktop/src/components/PreviewToolbar.tsx` (new) | `PreviewStatus` (`idle`/`running`/`stopped`/`error`), `PreviewAction`, Run/Stop/Pop out/Pick element buttons with icons (`▶`/`■`/`↗`/`⌖`), `role="toolbar"` + `aria-label`, a per-action `title` that says what it does or why it is off, `aria-pressed` + `data-picking` on the pick toggle, and one exported `previewToolbarDisabled(status)` table that owns every disabled rule |
| UI tests | `LivePreview.test.tsx`, `PreviewToolbar.test.tsx` (new) | 16 tests (10 + 6): placeholder vs frame (src, title, sandbox, referrer), run/stop callbacks, pop-out through a mocked `window.open` plus the no-`url` case, the pick flow (empty submit ignored, trim, callback, field cleared, toggle closes), no picking outside `running`, a missing `onElementClick`, the error line, Arabic labels + `dir="rtl"` + the LTR selector input, `elementMention`; toolbar order/icons/labels, the disabled rules per status, callback forwarding, the `aria-pressed` flip and the whole `previewToolbarDisabled` table |
| Docs chapter | `docs/src/live-preview.md` (new) + `docs/src/SUMMARY.md` | Arabic-first RTL block plus the English spec: the two prop shapes, the status/disabled table, the pop-out flags, why a cross-origin iframe cannot report clicks, the documented `postMessage` bridge contract (`{ type: 'warsha:preview-pick', selector }`) with its three parent-side rules, the sandbox/referrer posture, the RTL rules, and an explicit "what is not here yet" section. Fences are `ts`/`js`, so `mdbook test` runs no new fence |

Tests added — 16 new desktop tests, all passing; the desktop suite went 40 → 56.

Verification run for this milestone (WSL Ubuntu, Node 20.20.2, pnpm 9.0.0, `mdbook` 0.5.4). Three bridge runs were
needed to make the evidence match the final tree: the first was requested 2026-10-29T19:04:18 (`done.flag`
`exit=0 finished 19:05:18`) and passed, but a dead-code edit to `PreviewToolbar.tsx` landed after that snapshot; the
second (19:06:08 → `exit=0 finished 19:07:02`) also passed every check, and a comment-only edit to
`LivePreview.tsx` came after it; the third was requested 19:08:31 and is the run quoted below (`done.flag`
`exit=0 finished 2026-10-29T19:09:37`). Per the corrected rule the evidence is `bridge-io/result.log`:

| Check | Result |
|---|---|
| `cargo fmt --all --check` | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS |
| `cargo test --workspace` | PASS — 138 tests, 0 failed, 0 ignored |
| `pnpm install` | PASS |
| `pnpm -r typecheck` | PASS (TS strict, no `any` added) |
| `pnpm -r build` | PASS |
| `pnpm -r test` | PASS — 134 tests (client 32, crypto 22, i18n 12, ui 8, desktop 56, remote 4), incl. `mdbook build` + `mdbook test`, which lists `Testing chapter 'Live Preview': "live-preview.md"` |
| `actionlint .github/workflows/ci.yml` | PASS |

`result.log` ends with `RESULT: M0 validation PASSED — all checks green.` (the script's own label is still "M0"),
and it holds 18 `PASS` lines — the layout sanity checks, the toolchain installs and the eight validation commands —
with no `FAIL` line. The desktop suite reports 8 files / 56 tests with
`src/components/LivePreview.test.tsx (10 tests)` and `src/components/PreviewToolbar.test.tsx (6 tests)` among them.

Also verified directly on this Windows host with the repo's own `node_modules` binaries (no `pnpm` here):
`tsc --noEmit -p apps/desktop/tsconfig.json` exit 0, `vitest run` in `apps/desktop` 8 files / 56 tests passed,
`vitest run src/components` 7 files / 55 tests passed, `vite build` exit 0 (72 modules), and `prettier --check`
clean on the four new files after `prettier --write`.

Not run here: `eslint` on the two new files. The failure is the repo-wide pre-existing defect M14a recorded —
ESLint 9 looks for `eslint.config.js` and the repo has `.eslintrc.cjs`, so it stops before reading any file; with
`ESLINT_USE_FLAT_CONFIG=false` it runs but the `import` resolver cannot load under the pnpm layout and it reports
`Unable to resolve path to module` for every import. Verified on an untouched file (`StatusStrip.tsx`) with the
same result plus one real pre-existing rule violation, so neither the resolver errors nor the CI `Lint` step are
caused by this milestone. `pnpm lint` is not part of `wsl-setup.sh` either, which is why the bridge reports green.

Decisions (logged here because `DECISIONS.md` is outside this milestone's file scope):

- **The panel is not mounted in a screen.** The allowed file scope is the two components, their tests and the
  docs chapter, so `RunView`/`App.tsx` are untouched and `url`/`status` are the caller's to supply (same
  precedent as M14a/M14b/M5a). The AC half "preview starts from the run view" is recorded as not wired in
  PLAN.md rather than claimed.
- **Pop-out is gated on `status`, not on `url`.** The spec's `PreviewToolbar` props carry no `url`, so the
  toolbar's rule is "there is a preview to open" = `running` or `stopped`; `LivePreview` adds the `if (!url)
  return` guard, so a caller that sets `status` without a `url` still opens nothing. `previewToolbarDisabled`
  exports the table so the caller and the tests read one source.
- **The pick toggle only exists while running**, and the overlay disappears on its own when the status leaves
  `running`: a stopped preview has no document to point at, and leaving the input on screen would invite a
  pick that cannot land anywhere.
- **Submitting a selector keeps the overlay open.** Pointing at three elements in a row is the common case, and
  an empty submit is ignored instead of clearing the toggle. Only the toggle closes it.
- **`window.open(url, '_blank', 'noopener,noreferrer')` rather than the bare `window.open(url)`** the spec
  suggested: the previewed page is agent-generated and must not get `window.opener` back into the desktop app,
  and the preview URL should not travel as a referrer. The test asserts the exact three-argument call.
- **`elementMention(selector)` is exported here, not in the composer.** The AC wants one structured `@element`
  mention; keeping the template in the panel's module means the composer imports it instead of copying the
  string format.
- **The i18n catalog was not touched** (outside scope). Both components call `t('live_preview.*')` and fall
  back to their own ar/en labels when `t` returns the key, exactly as the M14a/M14b/M5a components do.
- **The frame is sandboxed and sends no referrer.** Cross-origin previews of agent-written code must not be
  able to navigate the desktop app away or reach its DOM; `allow-same-origin` stays because dev servers need
  their own storage.

Not wired yet: the dev-server process manager behind `onRun`/`onStop` (no preview RPC in `warshad`), the
`postMessage` listener that would remove the paste step, the Android emulator/QR half of M5b, a live status
feed, and the run-view mount.

Pre-existing, not touched: `pnpm lint` fails repo-wide (ESLint 9 config lookup, recorded in M14a); the desktop
suite prints an `act(...)` warning from `apps/desktop/src/App.tsx`; `apps/desktop/tauri.conf.json` and the
`crates/warsha-*` files carry other sessions' uncommitted changes.

#### M6a – Continue on server ✅ DONE (validated 2026-10-29T19:29:18, exit=0, all 18 checks green; lifecycle + review/apply only — no transport, see below)
One Rust module, two desktop components, two test files and one docs chapter. No dependency added,
no `Cargo.toml` edited, no `.github/workflows/**` change, no `package.json` change. LingCode-inspired
ideas only: no code, text or asset was copied from it.

| Deliverable | Path | What landed |
|---|---|---|
| Handoff module | `crates/warsha-pipeline/src/handoff.rs` (new) + `lib.rs` `mod`/`pub use` | `HandoffState` (`Idle`/`Preparing`/`HandedOff { remote_run_id, remote_url }`/`Applying`/`Applied`/`Failed(String)`, serde adjacently tagged `state`+`detail`) with `label()`/`remote()`/`failure()`, `HandoffManager` (`begin`/`handed_off`/`begin_apply`/`finish_apply`/`fail`/`reset`, illegal steps rejected), `HandoffFile` (`new`/`is_intact`), `HandoffBundle` (`paths`/`file`/`is_empty`), `ApplyOptions { owner_wins, selected }`, `ApplyResult { applied, conflicts, backups, resolved }` (`is_empty`/`has_conflicts`/`unresolved`/`requires_gate`), `Conflict { path, local_checksum, remote_checksum }`, `HandoffError` via thiserror, `content_checksum` (FNV-1a 64), `backup_bundle_name` |
| Hand off dialog | `apps/desktop/src/components/HandoffDialog.tsx` (new) | `HandoffPhase` union mirroring `HandoffState::label()`, `isRemoteUrl` (http/https + host, no whitespace), `canHandOff`, `handoffStatusText`, a `role="dialog"` `aria-modal` panel with the URL input (`dir="ltr"`, `aria-invalid`, hint that turns into the error), the "Hand off to remote" button (off while `preparing`/`applying` or the URL is unusable), a `role="status"` phase line with a glyph, a `role="alert"` failure line, and the remote run id + URL once handed off |
| Review & apply panel | `apps/desktop/src/components/ReviewApplyPanel.tsx` (new) | One row per changed file: checkbox, path (`dir="ltr"`), `new`/`conflict` badges, per-file diff from `diffLines` (prefix/suffix trim → context/removed/added, capped at `MAX_DIFF_LINES` with an "N more lines" note); files that apply cleanly start selected and a conflict starts unchecked; "Apply all" / "Apply selected" (in file order), select-all, the backup notice naming `backupName` + `runId`, and a policy line for owner-wins vs remote-wins |
| UI tests | `HandoffDialog.test.tsx`, `ReviewApplyPanel.test.tsx` (new) | 17 tests (8 + 9): closed → nothing, open → labelled dialog; the URL gate (`warsha.example.com`, `ftp://`, `http://`, spaces) and the trimmed hand-off call; blocked submit; the handed-off status with `dir="ltr"` run id; the button locked while preparing/applying; the failure alert and its retryable button; Arabic labels + `dir="rtl"` + `isRemoteUrl`/`canHandOff`/`handoffStatusText`; the file list with per-file diff kinds, new-file and conflict badges; Apply all / Apply selected ordering; select-all; the conflict rule and backup notice; `disabled` and the empty list; Arabic + LTR paths/diffs; `diffLines` edge cases and the `MAX_DIFF_LINES` cut |
| Docs chapter | `docs/src/continue-on-server.md` (new) + `docs/src/SUMMARY.md` | Arabic-first RTL block plus the English spec: the state machine and its serialized tag, bundle/checksum rules, the per-file apply table, owner-wins vs remote-wins, `requires_gate`, the two components, RTL, and an explicit "what is not here yet" section. Rust fences are ` ```rust,ignore ` because `mdbook test` runs rustdoc over them |

Tests added — 28 new, all passing: 11 in `handoff` (bundle creation + checksums incl. empty content,
apply without conflicts, apply with an owner-wins conflict, apply with a remote-wins conflict, a
tampered checksum refusing the whole bundle, an empty bundle, `selected` paths, malformed bundles
(duplicate/empty path, missing run id), the full state machine, illegal transitions + failure/retry,
serde for state/bundle/result) and 17 desktop component tests. Workspace totals: Rust 138 → 149,
desktop 56 → 73.

Verification runs for this milestone (two: the code was requested 2026-10-29T19:25:57 → `done.flag`
`exit=0 finished 2026-10-29T19:26:49`, and the final one after the `PLAN.md`/`PROGRESS.md` edits was
requested 19:28:40 → `done.flag` `exit=0 finished 2026-10-29T19:29:18`; the figures below are from the
final run. Per the corrected rule the evidence is `bridge-io/result.log`):

| Check | Result |
|---|---|
| `cargo fmt --all --check` | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS |
| `cargo test --workspace` | PASS — 149 tests, 0 failed, 0 ignored |
| `pnpm install` | PASS |
| `pnpm -r typecheck` | PASS (TS strict, no `any` added) |
| `pnpm -r build` | PASS |
| `pnpm -r test` | PASS — 151 tests (client 32, crypto 22, i18n 12, ui 8, desktop 73, remote 4), incl. `mdbook build` + `mdbook test`, which lists `Testing chapter 'Continue on Server': "continue-on-server.md"` |
| `actionlint .github/workflows/ci.yml` | PASS |

`result.log` ends with `RESULT: M0 validation PASSED — all checks green.` (the script's own label is
still "M0") and holds 18 `PASS` lines with no `FAIL` line. Also verified directly before the run:
`installed vitest run` over `apps/desktop` 10 files / 73 tests, `tsc --noEmit -p
apps/desktop/tsconfig.json` exit 0, `prettier --write` clean on the four new files, and
`mdbook build` + `mdbook test` in WSL 0.5.4 both exit 0 with the new chapter tested and
`book/continue-on-server.html` written.

Decisions (logged here because `DECISIONS.md` is outside this milestone's file scope):

- **`HandoffFile.checksum` is the checksum of the remote content, so "checksum mismatch" is an
  integrity error, not the conflict test.** Conflict detection compares the *local* content's
  checksum with the bundled one: same ⇒ already applied, absent ⇒ new file, different ⇒ a
  `Conflict` with both checksums recorded. The alternative reading (checksum = the local base at
  handoff time) would have made the six required tests overlap and left `local_checksum` in
  `Conflict` meaningless.
- **`ApplyResult` gained a `resolved` field** beyond the spec's `applied`/`conflicts`/`backups`.
  "Recorded as conflict-resolved" needs somewhere to live, and adding a flag to `Conflict` would
  have changed its specified three-field shape.
- **The checksum is FNV-1a 64, hand-rolled.** `warsha-pipeline` has no digest crate and the
  milestone adds no dependency; the value guards against a truncated or re-assembled payload, while
  confidentiality and authentication stay the M6 E2E channel's job. The docs say so.
- **`create_bundle` is infallible and validation lives in `apply_bundle`.** A remote run that
  produced no files still needs its lifecycle, and a bundle is captured as the caller describes it;
  apply is the one place that refuses a missing run id, an empty path or a repeated path.
- **The whole bundle is refused on one bad checksum** instead of applying the intact files: a
  half-written working tree is worse than a refused bundle.
- **Owner-wins settles the conflict, remote-wins leaves it for a gate.**
  `requires_gate()` is `!unresolved().is_empty()`, which is exactly the AC's "surfaced as a gate,
  not silently overwritten"; an owner-wins conflict is still listed in `conflicts` (and in
  `resolved`), so nothing is dropped quietly.
- **`ApplyOptions.selected` exists because the UI has "Apply selected".** `None` applies the bundle,
  `Some(paths)` applies those, and the output stays in bundle order so a UI list and a Rust result
  cannot disagree about ordering. Matching normalises a leading `./`, the same rule
  `work_protection` uses.
- **The dialog disables the button, it does not validate on submit.** `isRemoteUrl` is one exported
  predicate used by the button state, the hint and `canHandOff`, so there is one URL rule rather
  than three; `failed` keeps the button enabled because a retry is the point of that state.
- **The panel starts a conflict unchecked.** A conflict is a decision, so it must not ride along
  with "Apply selected" by default; everything else starts selected because that is the common case.
- **`diffLines` is a prefix/suffix trim, not an LCS.** The run view keeps the real diff viewer and
  M14a's decision (no second diff engine) still holds; a review panel needs to show *what changed in
  this file*, which the trim does, and `MAX_DIFF_LINES` bounds a generated 5000-line file.
- **The i18n catalog was not touched** (outside scope). Both components call
  `t('continue_on_server.*')` and fall back to their own ar/en labels when `t` returns the key,
  exactly as the M14a/M14b/M5a/M5b components do.
- **The components are not mounted in a screen.** The allowed file scope is the two components,
  their tests and the docs chapter, so `App.tsx`, `RunView` and the PWA are untouched (same
  precedent as M14a/M14b/M5a/M5b).

Not wired yet: the handoff RPC in `warshad` (so `onHandOff(url)` and `onApply(paths)` are seams and
`phase` is the caller's), the event stream that would carry the remote run back, the file writer and
the backup archive behind `backup_bundle_name`, the gate event for `requires_gate()`, and the phone
half of M6a (PWA chat + gate decisions for a handed-off run).

Pre-existing, not touched: `pnpm lint` fails repo-wide (ESLint 9 config lookup, recorded in M14a);
`apps/desktop/tauri.conf.json` and the other `crates/warsha-*` files carry other sessions'
uncommitted changes.

#### M8b – Simple mode UI spec + Routines + Settings → Providers ✅ DONE (validated 2026-10-29T19:44:19, exit=0, all check groups green)
Two screens, two rows, one docs chapter. No dependency added, no `Cargo.toml`, no `package.json`, no
`.github/workflows/**`, no `.rs` file. The two screens M16 recorded as "outside this milestone's file
scope" (Simple-mode routines, Settings → Providers auto-update) are the ones this batch builds.
LingCode-inspired ideas only: no code, text or asset was copied from it.

| Deliverable | Path | What landed |
|---|---|---|
| UI spec | `docs/UI.md` §4 (new section) | The M8b layout contract: three panes (sidebar | chat | live preview) as one flex row mirrored by `dir`, the chat-first sidebar (New chat, search, projects, today's chats, plan badge), the top bar (project name, type pill, device status, primary Run, secondary Publish), the three-part reply format (collapsible "What I did" → plain-language result → "How it behaves", no code dumps), the one rounded composer (`+`, `@`, mic, model picker, permission chip), light/dark with the single accent `#FFD60A` on `#0E0E0E`, IBM Plex Sans Arabic-style UI font, mono only for steps/logs and verbatim tokens, Advanced mode unchanged. Arabic RTL block plus the English spec, in the chapter's existing style |
| Docs shim + nav | `docs/src/UI.md` (new), `docs/src/SUMMARY.md` | `{{#include ../UI.md}}` shim because the content lives at the repo-level `docs/UI.md` and mdBook only publishes chapters under `src/` (same mechanism as `docs/src/launch/*.md`); SUMMARY gained `- [Desktop UI](UI.md)`, a top-level path with no anchor |
| Routines screen | `apps/desktop/src/screens/Routines.tsx` (new) | `RoutinesProps { routines, onRun, onPause, onResume }`, header with the count pill, one `RoutineRow` per routine, empty state that says what a routine is, `section[aria-label]` + `dir` from `useDirection()` |
| Routine row | `apps/desktop/src/components/RoutineRow.tsx` (new) | `RoutineState` (`idle`/`running`/`paused`/`failed`), `Routine`, `routineActions(state)` (`idle`→`['run']`, `running`→`['pause']`, `paused`→`['resume','run']`, `failed`→`['run']`), name, mono schedule pinned `dir="ltr"`, plain-language description, accent state badge |
| Settings → Providers | `apps/desktop/src/screens/SettingsProviders.tsx` (new) | `SettingsProvidersProps { providers, onModeChange, onToggle, onPinVersion }`, header with the "off by default" note, one `ProviderRow` per provider, empty state |
| Provider row | `apps/desktop/src/components/ProviderRow.tsx` (new) | `ProviderMode` (`off`/`notify`/`auto`), `ProviderEntry { name, mode, pinnedVersion?, enabled }`, `providerModes` (safest first), enabled checkbox, mode selector, mono pinned-version input (`dir="ltr"`, empty = latest), "Test connection" behind the optional `onTest` seam — no key read, no socket opened |
| UI tests | `apps/desktop/src/components/RoutineRow.test.tsx`, `ProviderRow.test.tsx`, `apps/desktop/src/screens/Routines.test.tsx`, `SettingsProviders.test.tsx` (all new) | 27 tests: 7 row/row, 5 screen/8 screen |

Tests added — 27 new, all passing: `routineActions` table, name/schedule/description render, state
badge, Run→`onRun(id)`, Pause while running (and no Run button), Resume + Run when paused, Arabic
`dir="rtl"` with the schedule still `dir="ltr"` (7 in `RoutineRow`); header + count, empty state, one
row per routine with its schedule, per-row action routing, Arabic header/count/direction (5 in
`Routines`); row content, the three mode options in order, mode change, toggle, typed pin, "Test
connection", Arabic labels with an LTR pin field (7 in `ProviderRow`); header + note, one row per
provider, empty state, mode/toggle/pin routed with the provider name, a stateful harness proving the
controlled contract, Arabic header/note/direction (8 in `SettingsProviders`).

Verification run for this milestone (Windows host, Node 26.8.1, pnpm 9.0.0 run through `node
<…>/pnpm.cjs` because `pnpm` is not on this host's PATH, `mdbook` 0.5.4 and `actionlint` in WSL
Ubuntu):

| Check | Result |
|---|---|
| `pnpm -r typecheck` | PASS — 7 packages, exit 0 (TS strict, no `any`) |
| `pnpm -r --filter '!@warsha/docs' build` | PASS — desktop 72 modules, remote 55 modules |
| `pnpm -r --filter '!@warsha/docs' test` | PASS — desktop 14 files / 100 tests (incl. the 27 new), client, crypto, i18n, ui, remote |
| `mdbook build` + `mdbook test` (WSL, 0.5.4) | PASS — 0 `ERROR`, 0 `FAILED`, 16 chapters tested incl. `Desktop UI`, `book/UI.html` written (52 KB) |
| `actionlint .github/workflows/ci.yml` (WSL) | PASS — exit 0, no workflow file touched |
| `prettier --check` on the new files | PASS after one `--write`; the four source files and `docs/UI.md` are clean (12 untouched screens still fail, as at HEAD) |
| `cargo fmt` / `clippy` / `test` | Not run — no `.rs` file changed; the Rust tree is untouched by this batch |

Defects found and fixed inside files this milestone had to touch:

1. **The include shim path was one level off.** `docs/src/UI.md` first said
   `{{#include ../../UI.md}}`, which resolves to `Warsha/UI.md` (two levels above `docs/src` is the
   repo root, not `docs`), and `mdbook build` printed `ERROR Error updating "{{#include
   ../../UI.md}}", Could not read file for link`. Corrected to `../UI.md`.
2. **`docs/UI.md` had never been through `mdbook test`.** Its two M13 wireframes were unlabelled
   fences, so rustdoc tried to compile the box-drawing diagrams and `mdbook test` reported two
   `FAILED` cases the moment the chapter was published. Both are now ` ```text `, so rustdoc no longer
   tries to compile a box-drawing diagram; `mdbook test` is green.
3. **i18n key collision.** The new screens first called `t('providers.title')` and
   `t('providers.test')` with fallbacks, but the catalog already defines those keys for the older
   settings screen ("Provider Settings", "Test"), and `t()` prefers a catalog message over the key,
   so the rendered header and button were silently wrong (caught by the failing tests, not by
   reading). Both screens moved to a `simple.*` namespace with no existing entries.

Decisions (logged here because `DECISIONS.md` is outside this milestone's file scope):

- **`docs/UI.md` already existed** (the M13 wireframe chapter, tracked and unmodified). It was
  extended with a new §4 rather than replaced. Where the two disagree the new section wins, and it
  says so: the right pane is the live preview (team panel as its second tab) and the sidebar is
  chat-first (the M13 agent list becomes the New-chat picker). That keeps M13's "what is the team
  doing" panel reachable while matching the M8b three-pane spec.
- **The `simple.*` key prefix, not `routines.*`/`providers.*`.** The catalog's existing
  `providers.title`/`providers.test` would have overridden the fallbacks; a free prefix keeps the
  old settings screen intact and still lets a later catalog entry win.
- **`routineActions(state)` is one exported pure function**, so a row shows only what its state
  allows: Pause never appears next to a routine that is not running, and `paused` offers both
  Resume and Run now (a routine can be resumed *or* fired once). The row renders from that table,
  so the tests and the UI cannot disagree.
- **Both rows are fully controlled.** `mode`, `enabled` and `pinnedVersion` come from props and
  every edit calls back out (`onModeChange`, `onToggle`, `onPinVersion`); the screens add the
  provider name. No component keeps a copy, so there is one source of truth and a later RPC result
  drops in unchanged. An empty `pinnedVersion` means "follow the latest release".
- **"Test connection" is a seam, not a network call.** `onTest?` is optional and the row does
  nothing else; the structured `ConnectionTestResult` from M14b's `provider_setup` is what a caller
  renders. No key is read, nothing is logged.
- **The accent pill is the running state.** `#FFD60A` with `#0E0E0E` ink is the one accent surface
  the spec allows, and it is also the most useful signal in the list; idle/paused/failed use
  neutral/amber/red pills, and every badge carries text as well as colour.

Not wired yet: neither screen is mounted (`App.tsx` and the settings router are outside the allowed
files, same precedent as M14a/M14b/M5a/M5b/M5c), so `Routines`/`SettingsProviders` render wherever a
caller places them; nothing calls `RoutineRegistry` or `ProviderUpdatePlanner`, Goose is still a
commented placeholder in the root `Cargo.toml`, and the composer/preview/top-bar paragraphs in
`docs/UI.md` are spec, not new components.

Pre-existing, not touched: `pnpm lint` still fails repo-wide — `pnpm -r run lint` cannot find `pnpm`
on this host's PATH, and running ESLint 9 directly reports only its config/resolver breakage
(`ESLintRCWarning`, `typescript with invalid interface loaded as resolver`, `Unable to resolve path
to module '@warsha/i18n'`) on unmodified files such as `StatusStrip.tsx` too; `.eslintrc.cjs` defines
no hardcoded-UI-string rule at all, so that AC is satisfied by inspection (every string goes through
`t()` with an ar/en fallback) rather than by a passing lint. `mdbook` on Windows dies with
`0xC0000005` for any command (so `pnpm -r test` fails at the docs package on this host), and it is not
installed in this WSL image — it was installed there for this run. `apps/desktop/tauri.conf.json`,
`apps/desktop/src/App.tsx` and the other `crates/warsha-*` files carry other sessions' uncommitted
changes.

#### M15a – Website and launch ✅ DONE (validated 2026-10-29T19:56:42, exit=0, all 18 checks green)
Three Markdown files (one new chapter, one new launch page) plus the landing-page extension and one
SUMMARY line. No dependency added, no `Cargo.toml`, no `package.json`, no `.github/workflows/**`, no
`.rs`/`.ts` file. LingCode-inspired ideas only: no code, text or asset was copied from it.

| Deliverable | Path | What landed |
|---|---|---|
| Landing page — demo video | `docs/src/index.md` | "الفيديو التعريفي" / "Demo video": an explicit `text`-fenced placeholder frame naming the five beats, the pointer to `docs/launch/demo-video.md` (shot list) and `docs/launch/demo-script.md` (setup, do-not-show, post-production), a sentence saying the video is not recorded yet and the placeholder is not a dead player, and a commented-out `<iframe>` (`loading="lazy"`, `allowfullscreen`) that issues no request until the owner uncomments it after Gate D |
| Landing page — segments | `docs/src/index.md` | "لمن ورشة … ولمن ليست" / "Who it is for / who it is not for": five "fits you" and six "does not fit you" statements that name the real limits (Gate D is not a setting, no hosted service on our keys, PolyForm Noncommercial, no 1.0 release tag, no support team/SLA), plus the explicit line that there are no testimonials because nobody has used Warsha yet |
| Landing page — metrics | `docs/src/index.md` | "لا أرقام مزيفة" / "No fake metrics": a five-row claims table (12 agents, 14 stages, 4 gates, 3 operating systems, 6 preflight checks) with the file each number is read from, the list of deliberate absences (user/download/star counts, store ratings, testimonials, un-reproducible performance tables), and the rule that an untraceable number is not published |
| Public changelog | `docs/src/changelog.md` (new) | Arabic RTL block (why the entries are placeholders, the four-section table, the honesty rules) plus the English page: prefix → section mapping, the `git log --no-merges --pretty='%h %s'` command the entries are drawn from, **Unreleased** with Added / Changed / Fixed / Removed, cover-to-cover entries tagged M0–M19 (M17–M19 written as *planned*, past tense only where the code exists today), and a closing "Not in this page" section that refuses fake entries for the unbuilt milestones |
| Demo video shot list | `docs/launch/demo-video.md` (new) | The 3:00 landing-page cut: non-negotiables table (mock provider — `warshad` registers `MockProvider` as `mock` — Arabic first, clean machine, real numbers only, no testimonials, real recorded spend), five beats with timecodes (0:00 install → 0:20 add provider → 0:45 new project → 1:15 approve Gates A/B/C → 2:25 final repository → 2:55 close), each with the exact commands, what is on screen, ar/en caption text and a do-not list; references [demo-script.md](docs/launch/demo-script.md) for setup, the do-not-show list and post-production |
| Numeric-claims checklist | `docs/launch/demo-video.md` | "Numeric claims check (before Gate D)": a `grep -RnoE` over `docs/src/*.md` + `docs/store` + `docs/social` + `docs/launch`, the claims table mapping each surviving number to its measurement, and the rule that an invented user/download/star count, testimonial, rating or benchmark is a **blocker** at Gate D rather than a wording problem |
| Nav | `docs/src/SUMMARY.md` | `- [Changelog](changelog.md)` after `Continue on Server`, a top-level path with no anchor |

No tests were added: the change is Markdown only, so the suites are unchanged (149 Rust, 178
package tests). `mdbook test` picks the new chapter up on its own and lists
`Testing chapter 'Changelog': "changelog.md"`.

Verification runs for this milestone (two: the content run was requested 2026-10-29T19:53:59 →
`done.flag` `exit=0 finished 2026-10-29T19:54:48`, and the final one after the `PLAN.md`/`PROGRESS.md`
edits was requested 2026-10-29T19:56:02 → `done.flag` `exit=0 finished 2026-10-29T19:56:42`; the
figures below are from the final run. Per the corrected rule the evidence is `bridge-io/result.log`,
not `final.txt`):

| Check | Result |
|---|---|
| `cargo fmt --all --check` | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS |
| `cargo test --workspace` | PASS — 149 tests, 0 failed, 0 ignored |
| `pnpm install` | PASS |
| `pnpm -r typecheck` | PASS |
| `pnpm -r build` | PASS |
| `pnpm -r test` | PASS — 178 tests (client 32, crypto 22, i18n 12, ui 8, desktop 100, remote 4), incl. `mdbook build` + `mdbook test` over 17 chapters with `Changelog` among them |
| `actionlint .github/workflows/ci.yml` | PASS |

`result.log` ends with `RESULT: M0 validation PASSED — all checks green.` (the script's own label is
still "M0") and holds 18 `PASS` lines with no `FAIL` line. Also verified directly on this host before
the bridge run, in WSL `mdbook v0.5.4` against the live tree: `mdbook build` exit 0 with no `ERROR`
line and `book/changelog.html` (40 KB) written, `mdbook test` exit 0, `book/index.html` carrying the
three new sections and the commented `<iframe>` still inside its comment (nothing loads), and
`actionlint .github/workflows/ci.yml` exit 0 with no workflow file touched.

Defect found and fixed inside a file this milestone created: the first `docs/src/index.md` edit wrapped
the future `<iframe>` in stray `<>` / `</>` markers (not HTML, and mdBook passes them straight through
to the page). Removed; the embed now sits in a plain HTML comment.

Decisions (logged here because `DECISIONS.md` is outside this milestone's file scope):

- **The changelog is curated, not auto-generated, and says so.** No release tag exists, so there is no
  commit range to generate from; the page carries the command it is built from and states that a
  reviewer can check any line against `git log`. Claiming a bot generates it would be the first fake
  thing on the page.
- **M17–M19 get *planned* entries, not past-tense ones.** The task asked for placeholders for M0–M19;
  writing "added crash reports" for an unbuilt milestone would be a fabricated changelog. They sit in
  `Added` with the word *planned* and are repeated under "Not in this page".
- **No number in the new sections lacks a source.** 12/14/4/3/6 are all read from the repository, and
  even the mock provider is cited by file (`crates/warshad/src/lib.rs`) rather than by an env var this
  repo does not have — the first draft invented `WARSHA_MOCK_PROVIDER=1` and was corrected.
- **The numeric-claims check is a checklist, not a lint.** The AC allows either; adding a script and a
  CI step means `scripts/**` and `.github/workflows/**`, both outside the allowed files. The command is
  therefore runnable by a reviewer and the enforceable version is recorded as follow-up.
- **The `<iframe>` stays commented out.** A live player pointed at `VIDEO_ID` would be a dead embed
  claiming a video exists; a comment both reserves the layout and documents the exact markup (lazy,
  fullscreen, 16:9) the owner will uncomment behind Gate D.
- **The demo-video page is not a published chapter.** Its source lives in `docs/launch/`, and publishing
  it needs an `{{#include}}` shim under `docs/src/launch/` plus a SUMMARY line — a second SUMMARY entry
  this milestone's scope does not cover. It is referenced by path from the landing page, exactly as
  `docs/launch/checklist.md` already is, and `docs/launch/*.md` are reachable in the repository.

Not done, outside this milestone's allowed files (recorded, not claimed):

- The reverse link the PLAN AC asks for — `docs/launch/demo-script.md` pointing at
  `docs/launch/demo-video.md` — needs one line in `demo-script.md`, which this batch may not edit; the
  reference currently runs `demo-video.md` → `demo-script.md`.
- The "linked from store texts" half of the changelog item: `docs/store/*.md` are outside the scope.
- A CI-enforced numeric-claims lint (script + workflow step) rather than the review checklist.
- The video itself: no recording, no poster frame, no unlisted upload exists. Everything shipped here is
  the placeholder, the shot list and the review rule.

Pre-existing, not touched: `pnpm lint` still fails repo-wide (ESLint 9 config lookup, recorded in
M14a); `apps/desktop/tauri.conf.json`, `apps/desktop/src/App.tsx`, `crates/warsha-pipeline/src/lib.rs`,
`crates/warsha-pipeline/src/router_quality.rs`, `crates/warsha-providers/src/lib.rs`, `docs/UI.md` and
the untracked component/screen/module files carry other sessions' uncommitted changes.

#### M17 – Post-launch care ✅ DONE (validated 2026-10-29T20:12:37, exit=0, all 18 checks green; stores, screens and docs only — no collector, no store client, no push, no RPC, see below)
One Rust module, two desktop screens, two test files and one docs chapter. No dependency added, no
`Cargo.toml` edited, no `package.json` change, no `.github/workflows/**` change, no i18n catalog
entry. LingCode-inspired ideas only: no code, text or asset was copied from it.

| Deliverable | Path | What landed |
|---|---|---|
| Post-launch module | `crates/warsha-pipeline/src/post_launch.rs` (new) + `lib.rs` `mod`/`pub use` | `CrashReport { id, run_id, message, stack_trace: Option<String>, occurred_at, sent }` (`new`/`with_stack_trace`/`has_stack_trace`), `CrashReportStore` (`record`/`list`/`mark_sent`), `InMemoryCrashReportStore` (arrival order, duplicate + blank ids/messages rejected, idempotent `mark_sent`, `len`/`is_empty`/`unsent_count`); `StoreReview { id, store, rating, body, author, received_at }` (`new`/`rating_is_known`), `StoreReviewStore` (`record`/`list`/`list_by_store`), `InMemoryStoreReviewStore`, `MIN_RATING`/`MAX_RATING`; `DailySummary { date, runs_completed, total_cost_cents, error_count, new_feedback_count, suggested_next_steps }` with `is_quiet(max_cost_cents)`, `DailySummaryBuilder` (`build` = Arabic, `new(SummaryLanguage).summarize(…)`, `language()`), `SummaryLanguage` (`Arabic`/`English`, `as_str`); `PlainLanguageChangeRequest { id, description, created_at, status }` (`new`/`transition`), `ChangeRequestStatus` (`Pending`/`InProgress`/`Done`/`Rejected`, `as_str`/`is_open`/`can_transition_to`), `ChangeRequestStore` (`record`/`list`/`set_status`), `InMemoryChangeRequestStore` (`len`/`is_empty`/`open`); `PostLaunchError` via thiserror |
| Crash reports screen | `apps/desktop/src/screens/CrashReports.tsx` (new) | `CrashReport` (camelCase twin of the Rust record), header with the count pill, the opt-in note, the empty state, and one row per report: message, `YYYY-MM-DD HH:MM UTC` time (`formatCrashTime`, UTC + padded, `—` for a negative or non-numeric value), a `sent`/`not sent` badge on the accent colour while unsent, and the stack trace in a scrolling `dir="ltr"` `<pre>` when the owner allowed it |
| Store reviews screen | `apps/desktop/src/screens/StoreReviews.tsx` (new) | `StoreReview`, header with the count pill, the store-tagging note, the empty state, and one row per review: five stars with `role="img"` + `aria-label` ("4 of 5" / "4 من 5"), the store tag (mono, `dir="ltr"`), the body and the author; `clampRating`/`ratingIsKnown`/`ratingStars`/`ratingLabel` exported so the row, the label and the tests read one table; a rating outside `1..=5` renders clamped stars **and** a red "Rating out of range" line |
| UI tests | `CrashReports.test.tsx`, `StoreReviews.test.tsx` (new) | 10 tests (5 + 5): rows with message/time/status, the empty states, the opt-in note, the LTR stack trace (present vs absent), `formatCrashTime` incl. the invalid paths, Arabic labels + `dir="rtl"` with LTR timestamps; reviews with stars/body/author/store, the clamped out-of-range rating and its flag, the whole helper table, Arabic labels + RTL section with LTR stars and store tags |
| Docs chapter | `docs/src/post-launch-care.md` (new) + `docs/src/SUMMARY.md` | Arabic-first RTL block plus the English spec: the four stores and their errors, the no-PII payload, why `rating` is never clamped in Rust, the summary's fixed step order and its Arabic default, the status table with `done` terminal, the two screens, the RTL rules, and an explicit "what is not here yet" section. Rust fences are ` ```rust,ignore ` because `mdbook test` runs rustdoc over them |

Tests added — 25 new, all passing: 15 in `post_launch` (crash list order, duplicate/blank refusal,
`mark_sent` idempotence + unknown id, crash serde incl. a record without `stack_trace`, review
filtering by store, duplicate/blank refusal, an out-of-range rating kept and flagged, the summary's
numbers and Arabic steps, the never-empty list + `is_quiet` with and without a ceiling, the language
switch, the request flow to `done`, the illegal-transition refusals, the store's duplicate/blank
refusal, snake_case serde and the error message) and 10 desktop screen tests. Workspace totals:
Rust 149 → 164, desktop 100 → 110.

Verification runs for this milestone (two: the code was requested 2026-10-29T20:08:45 → `done.flag`
`exit=0 finished 2026-10-29T20:09:53`, and the final one after the `PLAN.md`/`PROGRESS.md` edits was
requested 20:11:25 → `done.flag` `exit=0 finished 2026-10-29T20:12:37`; the figures below are from the
final run. Per the corrected rule the evidence is `bridge-io/result.log`, not `final.txt`):

| Check | Result |
|---|---|
| `cargo fmt --all --check` | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS |
| `cargo test --workspace` | PASS — 164 tests, 0 failed, 0 ignored |
| `pnpm install` | PASS |
| `pnpm -r typecheck` | PASS (TS strict, no `any` added) |
| `pnpm -r build` | PASS |
| `pnpm -r test` | PASS — 188 tests (client 32, crypto 22, i18n 12, ui 8, desktop 110, remote 4), incl. `mdbook build` + `mdbook test`, which lists `Testing chapter 'Post-launch Care': "post-launch-care.md"` |
| `actionlint .github/workflows/ci.yml` | PASS |

`result.log` ends with `RESULT: M0 validation PASSED — all checks green.` (the script's own label is
still "M0") and holds 18 `PASS` lines with no `FAIL` line. The only edits after that run are the
timestamps and the run log in `PLAN.md` and `PROGRESS.md` themselves, which no check reads (they are
not book chapters, not compiled and not typed). Also verified directly on this Windows host
before the bridge run, because `pnpm` is not installed here and the Rust build needs WSL: `tsc
--noEmit` in `apps/desktop` exit 0, `vitest run` in `apps/desktop` 16 files / 110 tests passed,
`vite build` exit 0 (72 modules), `prettier --check` clean on the four new TypeScript files, and in
WSL (`cargo` with `CARGO_TARGET_DIR=/root/warsha/target`) `cargo fmt --all --check` exit 0,
`cargo clippy --workspace --all-targets -- -D warnings` exit 0, `cargo test --workspace` 164 passed,
`mdbook build` exit 0 with no `ERROR` line, `mdbook test` exit 0 with the new chapter tested, and
`actionlint .github/workflows/ci.yml` exit 0.

Defects found and fixed inside files this milestone created:

- `clippy::match_like_matches_macro` on `ChangeRequestStatus::can_transition_to`: the first version
  spelled the whole table as `match … => true / _ => false`. It is now `matches!` over the same three
  arms, so the compiler sees the table instead of a boolean fold.
- Both formatters rewrote the new files on contact: `cargo fmt -p warsha-pipeline` reflowed
  `post_launch.rs` (10 hunks) and `prettier --write` rewrote three of the four new TypeScript files
  (`CrashReports.test.tsx`, `StoreReviews.tsx`, `StoreReviews.test.tsx`). `tsc`, `vitest` and
  `cargo test` were re-run after both, so the quoted figures are post-format.

Decisions (logged here because `DECISIONS.md` is outside this milestone's file scope):

- **`rating` is stored exactly as the store reported it.** Clamping in Rust would hide a broken feed
  behind plausible numbers; `rating_is_known()` answers the question instead, and the desktop draws
  clamped stars *plus* a red out-of-range line, so the reader sees both the value and the anomaly.
- **`DailySummaryBuilder` has both `build` and `summarize`.** The milestone specified
  `DailySummaryBuilder::build(date, runs, costs, errors, feedback)` and the surface is Arabic-first,
  so `build` is the Arabic associated function; a language needed a receiver, hence
  `new(language).summarize(…)` rather than a fifth argument that would have changed the specified
  signature.
- **The suggested steps are ordered errors → empty day → feedback → zero-cost day → gate reminder,
  and the list is never empty.** A summary with zero steps has nothing to open, and the last line
  (the gates inbox) is true every day, so it is the one that always survives; the order is tested.
- **`done` is terminal and `rejected` can be reopened.** The AC's "never auto-publishes" needs a
  state that cannot be walked back by an agent, and five tests cover the refusals plus the fact that a
  refused step leaves the stored request untouched.
- **The screens are read-only.** Neither takes a button: the milestone lists what each one shows, and
  a "Send"/"Route to feedback" button behind no RPC would be a control that does nothing. The seams
  the ingestion job and the collector need (`unsent_count`, `list_by_store`, `open`) live in Rust.
- **`formatCrashTime` is UTC and hand-formatted instead of `toLocaleString`.** "19:56" without a zone
  is a different crash in every timezone, and a test must not depend on the host's clock; `—` covers
  the negative/non-numeric cases instead of `Invalid Date`.
- **The stars are `role="img"` with a spoken label.** Five glyphs read out one by one is noise; the
  `aria-label` ("4 of 5" / "4 من 5") is the rating, and the stars stay `dir="ltr"` so the sequence
  cannot mirror inside an RTL row.
- **The i18n catalog was not touched** (outside scope). Both screens call `t('post_launch.*')` and
  fall back to their own ar/en labels when `t` returns the key, exactly as the M14a/M14b/M5a/M5b/M8b
  screens do.
- **The two screens are not mounted in a screen.** The allowed file scope is the two screens, their
  tests and the chapter, so `App.tsx` and the settings router do not render them (same precedent as
  M14a/M14b/M5a/M5b/M6a/M8b).

Not wired yet: the GlitchTip/Sentry collector behind `mark_sent` (no HTTP client, no opt-in toggle, no
kill switch flag), the store-review ingestion job behind `list_by_store`, the Web Push delivery of the
daily summary and its deep link into the run, the `post_launch.*` RPC that would open a run from a
`PlainLanguageChangeRequest`, and the mount points for both screens.

Pre-existing, not touched: `pnpm lint` still fails repo-wide (ESLint 9 config lookup, recorded in
M14a); `mdbook` on Windows dies with `0xC0000005` for every command, so the docs were built in WSL
0.5.4; `apps/desktop/tauri.conf.json`, `apps/desktop/src/App.tsx`,
`crates/warsha-pipeline/src/router_quality.rs`, `crates/warsha-providers/src/lib.rs`, `docs/UI.md`,
`docs/src/index.md` and the untracked component/screen/module files carry other sessions' uncommitted
changes. `crates/warsha-pipeline/src/lib.rs` already carried one of those changes; this milestone only
added `mod post_launch;` and the `pub use` block above the existing lines.

#### M18 – Agent workflow and context ✅ DONE (validated 2026-10-29T20:30, all check groups green; module + three components + chapter only — no agent loop, no RPC, no attachment resolution, no prompt caching, no cost-view wiring, see below)
One Rust module, three desktop components, three test files and one docs chapter. No
dependency added, no `Cargo.toml` edited, no `package.json` change, no
`.github/workflows/**` change, no i18n catalog entry. LingCode-inspired ideas only: no code,
text or asset was copied from it.

| Deliverable | Path | What landed |
|---|---|---|
| Agent workflow module | `crates/warsha-pipeline/src/agent_workflow.rs` (new) + `lib.rs` `mod`/`pub use` | `AgentMode` (`Plan`/`Agent`, serde `snake_case`, `Plan` is `Default`, `as_str`/`can_edit`), `ModeTransition { from, to, approved_by, approved_at }` (`is_owner_approved`), `ModeManager { current, history }` (`request_transition`/`last_transition`/`can_edit`), `TodoStatus` (`Pending`/`InProgress`/`Done`/`Cancelled`, `as_str`/`is_open`), `TodoItem`, `TodoList` (`add`/`update`/`remove`/`list_pending`/`get`/`len`/`is_empty`/`is_complete`), `AskUserRequest`, `AskUserQueue` (`enqueue`/`answer`/`pending`/`blocking`/`blocks_run`/`answered_count`/`len`/`is_empty`), `Message`, `MessageBus` (`send`/`read`/`unread_count`/`unread_for`/`messages`/`get`/`len`/`is_empty`), `MentionKind` (`ALL`/`as_str`/`prefix`/`from_name`), `Mention` (`rendered`), `MentionParser::parse`, `SlashCommand` (`bare_name`), `SlashCommandRegistry` (`register`/`lookup`/`list`/`matching`/`len`/`is_empty`), `ContextCompactor` (`compact`/`estimate_tokens`), `CompressedOutput` (`is_compressed`/`saved_lines`), `OutputCompressor::compress`, `CHARS_PER_TOKEN`, `AgentWorkflowError` via thiserror |
| Plan/Agent badge | `apps/desktop/src/components/PlanModeBadge.tsx` (new) | `AgentMode` union, indigo Plan pill / `#FFD60A` Agent pill, `aria-pressed`, a `title` + `aria-label` that states the approval rule, `nextAgentMode(mode)` exported, click → `onToggle(next)`; the badge asks, the caller grants |
| Mention picker | `apps/desktop/src/components/MentionPicker.tsx` (new) | `mentionKinds`/`MentionKind`, one row per kind with an LTR-isolated `@kind` token and a localized label, `filterMentionKinds(query)` (prefix, optional `@`, case-insensitive), `onSelect(kind)`, empty state |
| Slash command picker | `apps/desktop/src/components/SlashCommandPicker.tsx` (new) | `SlashCommandItem`, `filterSlashCommands(commands, query)` (prefix, optional `/`, case-insensitive, sorted by bare name), name in mono `dir="ltr"` + description, `onSelect(name)`, empty state |
| UI tests | `PlanModeBadge.test.tsx`, `MentionPicker.test.tsx`, `SlashCommandPicker.test.tsx` (new) | 17 tests (5 + 6 + 6) |
| Docs chapter | `docs/src/agent-workflow.md` (new) + `docs/src/SUMMARY.md` | Arabic-first RTL block plus the English spec: the transition table, the three rules of `request_transition`, todos, `ask_user`/`send_message`, the six mention kinds and every parser rule, slash commands and their autocomplete rule, the three compaction stages with the quarter reserved for the marker, the compressor's ceilings, RTL, and an explicit "what is not here yet" section. Rust fences are ` ```rust,ignore ` because `mdbook test` runs rustdoc over them |

Tests added — 45 new, all passing: 28 in `agent_workflow` (approval required / recorded / back to
Plan / same-mode refusal, snake_case wire shape, todo add-update-remove + refusals, `list_pending`
over the four statuses, `ask_user` answer-once + blank refusals, blocking vs non-blocking,
`send_message` unread/read/idempotence + blank refusal, the six mention kinds, addresses and unknown
kinds, colon form + dedupe, kind serde, slash register/lookup/list, autocomplete filter, name
refusals, compaction fits / summarizes / drops the marker / never splits the newest, token estimate,
and the compressor's fits / head-tail / tiny-and-zero ceilings / empty input) and 17 desktop
component tests. Workspace totals: Rust 164 → 192, desktop 110 → 127.

Verification run for this milestone (Rust + docs + actionlint in WSL Ubuntu against a fresh `rsync`
of the live tree at `/root/warsha-m18` with `CARGO_TARGET_DIR=/root/warsha/target`; TypeScript on
this Windows host with the repo's own `node_modules/.bin`, because `pnpm` is not installed here):

| Check | Result |
|---|---|
| `cargo fmt --all --check` | PASS — exit 0, empty diff |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS — exit 0, no warning |
| `cargo test --workspace` | PASS — 192 passed, 0 failed, 0 ignored |
| `tsc --noEmit` (desktop + crypto + client + i18n + ui + remote) | PASS — exit 0 for all six |
| `vitest run` (desktop) | PASS — 19 files / 127 tests |
| `vitest run` (crypto, client, i18n, ui, remote) | PASS — 22 / 32 / 12 / 8 / 4 |
| `vite build` (desktop, remote) | PASS — exit 0, both bundles written |
| `mdbook build` + `mdbook test` (WSL, 0.5.4) | PASS — both exit 0, no `ERROR`, `Testing chapter 'Agent Workflow and Context': "agent-workflow.md"` |
| `actionlint .github/workflows/ci.yml` (WSL) | PASS — exit 0, no workflow file touched |
| `prettier --write`/`--check` on the six new TS files and the chapter | PASS — four unchanged, `SlashCommandPicker.test.tsx` and the chapter reflowed, re-verified after |
| `pnpm install` and `pnpm -r` typecheck/build/test | Not run — `pnpm` is not on this host's PATH; the same commands were run through the repo's `node_modules/.bin` equivalents above, and no `package.json`/lockfile changed |

Every check passed on its **first** run except the three assertions listed below, which were fixed
before the quoted figures were taken. Nothing is committed and nothing is pushed.

Defects found and fixed inside files this milestone created:

- `SlashCommandPicker` first sorted with `localeCompare` over the **full** name, so `/review` came
  before `/refactor` (`/` sorts below letters) and a slash-less fixture name landed last. Three
  tests failed on exactly that. `filterSlashCommands` now sorts by the bare name, which is the word
  the user reads, and the fixture uses the normalised `/refactor`; a separate assertion keeps the
  "a name without a slash still matches and comes back unchanged" contract.
- The same test's `toHaveAttribute('dir')` on a `<button>` asserted an attribute the component never
  sets (the direction is on the container). Replaced with the container's `aria-label`, which is the
  claim the test actually wanted.
- Self-review before the first `cargo` run: `request_transition` had an empty `if` branch for the
  approval case (a clippy smell) and one test compared a `bool` to `false`
  (`clippy::bool_assert_comparison`). Both were rewritten before the first run, so neither ever
  appeared in a check log.

Decisions (logged here because `DECISIONS.md` is outside this milestone's file scope):

- **`request_transition` refuses the same mode.** Without that, `history` fills with no-op switches
  and stops being an audit trail of what changed. Plan → Agent with a blank approver is
  `ApprovalRequired` and leaves `current`/`history` untouched; Agent → Plan is always allowed
  because the read-only direction cannot cost the owner anything, which is what makes the badge's
  one-click switch back honest.
- **The badge passes the next mode and never applies it.** `onToggle(nextAgentMode(mode))` keeps
  the approval in the caller (an approval card, the gates inbox); a component that flipped its own
  mode would be the thing granting edit rights, which is exactly what the AC forbids.
- **`list_pending` means the run's remaining work, not the literal `Pending` status.** An
  in-progress item still needs work, and one rule (`TodoStatus::is_open`) is shared by the list,
  `is_complete` and the UI instead of three near-copies. `Cancelled` stays distinct from `Done`:
  dropping a task and finishing it are different facts.
- **A blank answer is refused, not accepted as "nothing".** Accepting `"   "` would unblock the
  run with no information — the `ask_user` version of a silent default. Answering twice is also
  refused, so the queue cannot be rewritten after the fact.
- **`Message::read` is idempotent; every other `Bus`/`Queue` write is not.** Reading an already-read
  message is what a resent event stream does, and failing it would turn delivery into an error;
  sending a duplicate id or answering twice is a real bug and stays a refusal.
- **The mention parser is a hand-rolled scan with seven stated rules** (kind set, colon form,
  single-token target, trailing-punctuation trim, bare `@codebase`, `@` must begin a token,
  duplicates folded). `dev@example.com` staying an address is the reason for the "must begin a
  token" rule; a path with a space in it is the documented non-support, because a whitespace-delimited
  target keeps `@file a.rs and also b.rs` from swallowing the sentence.
- **The compactor reserves a quarter of the budget for its own marker** and never splits a single
  message. Without the reserve the summary line would evict the messages it exists to represent;
  without "never split", a zero budget would have to drop the newest message and hand the model an
  empty context.
- **The summary is a marker, not a model-written summary.** No provider call is made, so compaction
  costs zero tokens and is deterministic — and the docs say so rather than implying a model
  summarised the history.
- **The compressor's ceiling is a line count, not a byte count.** One very long line (a stack frame,
  a JSON blob) is still one useful fact, and a byte ceiling would cut it in half. Head + tail because
  the first lines say what was attempted and the last ones say what failed.
- **The TypeScript filter mirrors the Rust rule instead of calling it.** There is no RPC for the
  registry yet, so `filterSlashCommands`/`filterMentionKinds` implement the same prefix rule the
  daemon does; when an `agent_workflow.*` RPC lands, its names drop into the same components.
- **The i18n catalog was not touched** (outside scope). All three components call
  `t('agent_workflow.*')` and fall back to their own ar/en labels when `t` returns the key, exactly
  as the M14a/M14b/M5a/M5b/M8b/M17 components do. The prefix is free in the catalog, so a later
  entry takes precedence automatically.
- **`Message` is exported at the crate root under its spec name.** Checked first: no other crate or
  module in this workspace declares a `Message` (`warsha-core`, `warsha-providers`
  `ChatMessage`/`MessageRole`), so no rename or alias was needed.

Not wired yet: the agent loop that would call any of these types (there is no tool layer in this
repository), the `agent_workflow.*` RPC that would persist the mode/todos/queue/bus in `warshad` and
push them to the desktop, the attachment resolution behind `Mention` (file contents, folder walks,
codebase overview), the skill source that would fill `SlashCommandRegistry` from `skills.rs`, provider
prompt caching, the cost view that would read `saved_tokens_estimate`, and the mount points for the
three components (`App.tsx`, `RunView` and the composer are outside the allowed files).

Pre-existing, not touched: `pnpm lint` still fails repo-wide (ESLint 9 config lookup, recorded in
M14a); `mdbook` on Windows dies with `0xC0000005` for every command, so the docs were built in WSL
0.5.4; `apps/desktop/src/App.tsx` prints the `act(...)` warning its own test already produced at
HEAD. `apps/desktop/tauri.conf.json`, `apps/desktop/src/App.tsx`,
`crates/warsha-pipeline/src/lib.rs`, `crates/warsha-pipeline/src/router_quality.rs`,
`crates/warsha-providers/src/lib.rs`, `docs/UI.md`, `docs/src/index.md` and the untracked
component/screen/module files carry other sessions' uncommitted changes. `crates/warsha-pipeline/src/lib.rs`
already carried one of those changes; this milestone only added `mod agent_workflow;` and the `pub use`
block above the existing lines.

#### M19 – Backend kit ✅ DONE (validated 2026-10-29T20:48:09, exit=0, all 18 checks green; definition layer, panel and chapter only — no MCP transport, no backend client, no export file, no fresh-instance round trip, see below)
One Rust module, one desktop component, one test file and one docs chapter. No dependency added,
no `Cargo.toml` edited, no `package.json` change, no `.github/workflows/**` change, no i18n
catalog entry. LingCode-inspired ideas only: no code, text or asset was copied from it.

| Deliverable | Path | What landed |
|---|---|---|
| Backend kit module | `crates/warsha-pipeline/src/backend_kit.rs` (new) + `lib.rs` `mod`/`pub use` | `BackendKind` (`PocketBase`/`Supabase`, serde `snake_case`, `all`/`as_str`/`display_name`, `PocketBase` is `Default`), `BackendFeature` (`Auth`/`PostgresRls`/`Storage`/`Push`/`Functions`, `all`/`as_str`), `BackendConfig { kind, url, project_name, enabled_features }` (`new`/`with_feature`/`has_feature`/`feature_list`, the list kept in `BackendFeature::all` order), `ColumnDef` (`new`), `TableDef` (`new`/`has_column`), `RlsOperation` (`as_sql`/`as_str`), `RlsPolicy` (`new`), `ExportBundle { sql_dump, storage_archive_path }` (`has_schema`/`has_storage`), `PaymentsGate` (`new`/`is_enabled`/`enable`/`disable`/`summary`), `BackendKit` (`new`/`config`/`table`/`features`/`is_empty`/`add_table`/`add_rls_policy`/`add_storage_bucket`/`add_function`/`export`/`storage_archive_path`), `BackendKitError` via thiserror, `is_safe_identifier`/`is_safe_column_type` |
| Backend kit panel | `apps/desktop/src/components/BackendKitPanel.tsx` (new) | `BackendKind`/`BackendFeature` unions, `BackendTable`/`BackendColumn`/`PaymentsGateStatus`, `backendKinds`/`allBackendFeatures`, the kind selector as a `role="radiogroup"` of two `role="radio"` buttons with `aria-checked`, five service checkboxes in `BackendFeature::all` order, one row per table (name and columns in mono `dir="ltr"`, `nullable` spelled out), the empty state, **Export** disabled with no tables and a `title` saying why, and the payments chip showing the approver and the timestamp or "off — owner approval required". `paymentsGateEnabled`/`canExport`/`paymentsGateText` are exported so the panel, its `title` and the tests read one table |
| UI tests | `apps/desktop/src/components/BackendKitPanel.test.tsx` (new) | 10 tests: the two kinds in order with `aria-checked`, the kind callback, all five services with both toggle directions, the table rows with their columns and the empty state, export on/off with its `title`, the gate shut and open, Arabic labels + `dir="rtl"` with the URL and the identifiers still LTR, and the three helpers (the gate needing an approver **and** a timestamp, `canExport`, the localized gate line) |
| Docs chapter | `docs/src/backend-kit.md` (new) + `docs/src/SUMMARY.md` | Arabic-first RTL block plus the English spec: the type table, what every `add_*` refuses and the two rules that matter (the column-type screen, the table must exist before its policy), the export order with a real dump example, why the project name and the URL are comment-screened, the archive-path rule, the payments-gate table with `is_enabled`'s three-part test, the panel's rules, RTL, and an explicit "what is not here yet" section. Rust fences are ` ```rust,ignore ` and the SQL one is ` ```sql `, so `mdbook test` compiles no new fence |

Tests added — 26 new, all passing: 16 in `backend_kit` (config creation and the sorted feature list,
`add_table` with its four refusals and the duplicate, `add_rls_policy` requiring a table + its three
refusals, buckets, functions, the export's `CREATE TABLE` + RLS statements and their order, the empty
export, the project name that tries to end the comment, the gate's approval rule, the gate's
enable/close path, kind/feature/operation serde, the kit's serde round trip, and the
identifier/type/slug/comment screens) and 10 desktop component tests. Suite totals: `warsha-pipeline`
126 → 142, desktop 127 → 137.

Verification runs for this milestone — three bridge runs, the figures below from the last one (the
bridge is `scripts/wsl-bridge.ps1` → `scripts/wsl-setup.sh` in WSL Ubuntu as root; TypeScript was
also checked on this Windows host with the repo's own `node_modules/.bin`, because `pnpm` is not
installed here):

| Check | Result |
|---|---|
| `cargo fmt --all --check` | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS |
| `cargo test --workspace` | PASS — 208 passed, 0 failed, 0 ignored (142 of them in `warsha-pipeline`) |
| `pnpm install` | PASS |
| `pnpm -r typecheck` | PASS (TS strict, no `any` added) |
| `pnpm -r build` | PASS |
| `pnpm -r test` | PASS — 215 tests (desktop 137, client 32, crypto 22, i18n 12, ui 8, remote 4), incl. `mdbook build` + `mdbook test`, which lists `Testing chapter 'Backend Kit': "backend-kit.md"` |
| `actionlint .github/workflows/ci.yml` | PASS |

`bridge-io/result.log` ends with `RESULT: M0 validation PASSED — all checks green.` (the script's own
label is still "M0") and holds 18 `PASS` lines with no `FAIL` line. Also verified directly before that
run: `tsc --noEmit` in `apps/desktop` exit 0, `vitest run` in `apps/desktop` 20 files / 137 tests
passed, `vite build` exit 0 (72 modules), `prettier --check` clean on the two new TypeScript files,
and in WSL `mdbook build` + `mdbook test` exit 0 with `book/backend-kit.html` (36 KB) written.

The first bridge run of this milestone **failed**, and the reason matters for later runs: it was
requested 2026-10-29T20:41:12 and finished `exit=1` at 20:42:16 with the single
`FAIL  cargo fmt --check  (exit 1)` — a diff in `crates/warsha-pipeline/src/lib.rs:35`, the new
`pub use crate::backend_kit::{…}` block. The same command **passed** minutes earlier when run
interactively as the WSL user, because that user's `rustfmt` and the bridge's `rustfmt 1.10.0-stable`
fill the last line differently: a 99-character line one of them accepts and the other splits. The
tree was re-formatted with the bridge's own toolchain (`wsl -d Ubuntu -u root -- cargo fmt --all`),
`cargo fmt --all --check` then exited 0, and `git diff --numstat` confirmed the formatter touched no
other Rust file. The second run (requested 20:44:00, `done.flag` `exit=0 finished
2026-10-29T20:44:51`) was green on all 18 checks; the third (requested 20:47:15, `exit=0 finished
2026-10-29T20:48:09`) is the one quoted above and carries this milestone's documentation and test-count
corrections. The only edits after it are the timestamps and this run log in `PLAN.md` and `PROGRESS.md`,
which no check reads.

Defects found and fixed inside files this milestone created:

- The chapter's SQL example selected on `published = true` while the example table declared no
  `published` column; the column was added so the dump in the docs is one a reviewer could apply.
- `prettier --check docs/src/backend-kit.md` warned (table padding); `prettier --write` reflowed it and
  the re-check is clean. Two existing chapters (`post-launch-care.md`, `status-strip.md`) still fail
  that check at HEAD, so this is tidiness, not a CI gate.
- Self-review before the first execution found four things that never reached a check log: a test
  asserted `!is_safe_identifier("posts")` (backwards — `posts` is the accepted case), a manual
  `impl Default for BackendKind` that `clippy::derivable_impls` would have flagged, an `assert_eq!`
  comparing a `bool` to `true`, and two `getByText` calls in the Arabic test that queried the
  section's `aria-label` (an attribute, not text) plus one `expect(...).toBeInTheDocument;` with no
  call. All four were fixed before the first `cargo`/`vitest` run.

Decisions (logged here because `DECISIONS.md` is outside this milestone's file scope):

- **`add_rls_policy` requires the table to exist first.** The alternative (allow a policy for a table
  added later) would let creation order and dump order disagree, and the dump would emit
  `CREATE POLICY … ON "posts"` for a table it never created. Enforcing it makes ordering a rule of the
  type rather than a convention the caller has to remember.
- **Everything an agent writes is screened before it can become SQL.** Names must match
  `[A-Za-z_][A-Za-z0-9_]*`, column types may only contain ASCII letters, digits, spaces and
  `_ ( ) , [ ] .`, a policy expression must be one non-empty expression with no `;`, and the project
  name and URL are run through a comment screen so a newline cannot end the `--` header and turn the
  rest of a project name into a statement. Identifiers are quoted as well, doubling an embedded `"` —
  the screen is the rule, the quoting is the belt.
- **`storage_archive_path` follows the buckets, not the `Storage` feature flag.** A bucket that
  exists has data to pack; if the owner later turns the Storage toggle off, dropping the archive from
  the export would silently lose it. The feature list records what the backend offers, the buckets
  record what the project uses.
- **`add_table` takes a `TableDef` and `add_rls_policy` an `RlsPolicy`**, while buckets and functions
  take names: the structs are the storage shape, so a caller cannot add a table with fields the kit
  never stores, and a name has nothing to get wrong.
- **`is_enabled()` is the flag *and* the approval record.** `enabled` is a public field because the
  PLAN specifies it, so the honest reading of "approved" has to be recomputed: setting the field by
  hand leaves `is_enabled()` false, and one test pins exactly that. There is no auto-enable path.
- **A second approval is `PaymentsAlreadyEnabled`, not a silent overwrite.** The gate records who
  opened it and when; accepting a second `enable` would rewrite the audit fact the gate exists for.
  `disable()` clears the record so a deliberate re-approval is still possible.
- **The dump lists buckets and functions as comments instead of inventing DDL.** Neither PocketBase
  nor Supabase creates buckets or functions with `CREATE TABLE`-style SQL, so a fake statement would
  be worse than a header that names them; the archive and the function sources stay the caller's to
  produce, and the chapter says so.
- **`export()` writes nothing.** Packing `<slug>-storage.tar.gz`, writing `schema.sql` and replaying
  the dump into a fresh instance need a file writer and a backend client that do not exist here; the
  bundle is the honest half.
- **The panel is controlled and not mounted.** The allowed file scope is the component plus its tests,
  so `App.tsx` and the settings router are untouched and `kind`/`features`/`tables`/`payments` come
  from the caller (same precedent as M14a/M14b/M5a/M5b/M6a/M8b/M17/M18).
- **Export is disabled with no tables.** A dump with no schema is the header comment alone, so the
  button reports nothing to do rather than producing a file that says nothing; the `title` names the
  reason and `canExport()` is the one rule the button, its `title` and the tests share.
- **The i18n catalog was not touched** (outside scope). The panel calls `t('backend_kit.*')` and falls
  back to its own ar/en labels when `t` returns the key, exactly as the M14a/M14b/M5a/M5b/M8b/M17/M18
  components do. The prefix is free in the catalog, so a later entry takes precedence automatically.

Not wired yet: the MCP transport and the backend client that would call `add_table`/`add_rls_policy`
from the backend's own MCP server (PLAN.md M19's "no bespoke backend client" half), writing
`schema.sql` and packing the storage archive, replaying the dump into a fresh instance (so the AC's
round trip is unproven), reachability of `BackendConfig::url`, a `warsha backend …` CLI surface and a
`backend_kit.*` RPC (both outside the allowed files), and the panel's mount point.

Pre-existing, not touched: `pnpm lint` still fails repo-wide (ESLint 9 config lookup, recorded in
M14a); `mdbook` on Windows dies with `0xC0000005` for every command, so the docs were built in WSL
0.5.4; `apps/desktop/src/App.tsx` prints the `act(...)` warning its own test already produced at HEAD.
`apps/desktop/tauri.conf.json`, `apps/desktop/src/App.tsx`, `crates/warsha-pipeline/src/lib.rs`,
`crates/warsha-pipeline/src/router_quality.rs`, `crates/warsha-providers/src/lib.rs`, `docs/UI.md`,
`docs/src/index.md` and the untracked component/screen/module files carry other sessions' uncommitted
changes. `crates/warsha-pipeline/src/lib.rs` already carried one of those changes; this milestone only
added `mod backend_kit;` and the `pub use` block above the existing lines (the one line the bridge's
`rustfmt` re-wrapped).

#### Blocked (Local Only — Requires Windows Host Execution)
- **WSL2 validation runs outside the agent sandbox** — the bridge script (`scripts/wsl-bridge.ps1`) must be running on the Windows host; it rsyncs the repo to `/root/warsha` and runs `scripts/wsl-setup.sh`.
- Full validation log lives at `/root/warsha/wsl-validation.log` inside WSL (readable with `wsl -d Ubuntu -u root`).

#### Team structure (Agent Teams)
- **rust-coder** — owns `crates/**` + root `Cargo.toml`
- **web-coder** — owns `apps/**`, `packages/**`, `pnpm-workspace.yaml`, `package.json`, `tsconfig.json`, `vitest.config.ts`
- **debugger** — read-only on code; writes only `docs/VALIDATION_NOTES.md`; maps every bridge FAIL to file + root cause + exact fix
- Only the lead validates, through the bridge. No member runs a shell, formatter, cargo, pnpm, or tests.
- Nobody commits, pushes, or reverts the working tree.

---

## Human-only steps (from BUILD_PROMPT.md §9)
- [ ] Create the GitHub org/repo, add CI secrets, enable branch protection
- [ ] Code signing certificates (Windows: e.g. SignPath/Azure Trusted Signing; macOS: Apple Developer ID + notarization)
- [ ] Store and registry accounts and submissions (winget, Homebrew, Scoop, Microsoft Store, crates.io/npm publish)
- [ ] Domain, hosting of the optional relay, and VAPID key publication
- [ ] Real-provider smoke tests with the user's own keys

## Additional HUMAN TODO (Local Toolchain)
- [ ] Keep `scripts/wsl-bridge.ps1` running on the Windows host while the build session is active (it is the only validation path; agents cannot execute WSL commands)
- [ ] Approve GitHub App installation for Renovate once the repo exists (M16)
- [ ] Configure Tauri updater signing keys and store them as CI secrets (M16)
- [ ] Confirm the Activepieces CE deployment target (bundled vs. user-hosted) — M16 landed the license review and docs only; the connection is not wired yet
- [ ] Provide API keys for real-provider smoke tests when M2 reaches live verification
## v0.1.0 ready
All milestones M0–M16 are implemented and validated. Last bridge run 2026-10-29T17:47:43 exited 0 with all 18 checks green (cargo fmt/clippy/test, pnpm install/typecheck/build/test, actionlint). See PLAN.md for per-milestone evidence. Human-only steps remain listed above.
## Plan update 2026-10-29 — LingCode-inspired ideas (ideas only)
PLAN.md and DECISIONS.md updated with 11 ideas adopted from LingCode's public site (ideas only; no branding/assets/text/code copied). New milestones M17 (Post-launch care), M18 (Agent workflow and context), M19 (Backend kit); subsections M14a (work protection), M14b (router additions), M5a (status strip/delivery), M5b (live preview), M6a (continue on server), M8b (Simple mode UI spec), M15a (website and launch). Definition of Done extended to M10-M19. License remains PolyForm Noncommercial 1.0.0. No code changes; CI unaffected.
