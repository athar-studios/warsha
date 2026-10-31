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

## 2026-10-29 — Verification evidence: bridge writes result.log, not final.txt
- **Decision**: Milestone acceptance is judged only from `bridge-io/result.log` (and `run-output.log`) plus a `done.flag` whose timestamp is strictly newer than the `run.flag` that triggered the run. `bridge-io/final.txt` is no longer consulted; it stopped being rewritten at 11:44 on 2026-10-29 and had been misleading every run since.
- **Alternatives**: Keep trusting `final.txt`; regenerate it inside the bridge script
- **Reason**: The M10–M13 "all 14 checks green" claims were read from that frozen file and were wrong — the real last run failed cargo clippy/test, pnpm install/typecheck/build/test. Rather than patch the bridge, the record is corrected (PLAN.md/PROGRESS.md) and the validation procedure is documented here so the same mistake is not repeated.

## 2026-10-30 — M16 routines: in-house abstraction behind a runner trait, minimal cron
- **Decision**: Goose is still only a commented-out placeholder in the root `Cargo.toml`, so `warsha-pipeline` gets an in-house `RoutineRegistry` plus a `RoutineRunner` trait instead of a scheduler. Everything that decides *when* something runs lives in `routines.rs`: `RoutineSchedule` (`Cron(String)`, `IntervalSeconds`, `Manual`), `RoutineState`, `RoutineAction`, and a minimal cron parser limited to `every N seconds|minutes|hours` and `daily at HH:MM` (UTC). Any other cron expression is rejected.
- **Semantics fixed here**: `tick(now)` marks a due routine `Running` and stamps `last_run_unix`, and only `complete()` returns it to `Idle` (or `Failed`), so two schedulers can never both run the same routine; a `Failed` routine is never due until `Resume`/`RunNow`; pausing a non-idle routine and resuming a non-paused one are refused instead of silently ignored; a never-run *interval* routine is due on the first tick, while a never-run *daily* routine waits for its wall-clock time.
- **Alternatives**: pull Goose in now and bind to its recipe scheduler; write a full cron engine; ship no routine support in M16.
- **Reason**: The owner's rule is "routines run on Goose's scheduler", but adding Goose in this milestone would add a dependency and force an API decision the repo is not ready for. The trait is the seam: a Goose-backed runner implements `RoutineRunner` and drives `tick`, and nothing else in the module changes. Full cron is deferred there rather than duplicated here.

## 2026-10-30 — M16 provider auto-update: explicit opt-in, string pin matching, run-active veto
- **Decision**: `ProviderUpdatePolicy.providers` is opt-in per provider — a provider missing from the map counts as disabled, even in `AutoInstall`. Pin/skip comparisons are equality on the version string with surrounding whitespace and a leading `v` ignored (no ordering: the release channel says what "latest" is). `run_active` is a flag on `plan()` that turns every action into `Skip { reason: RunActive }`, except that an `Off` policy still plans nothing at all. A provider whose release channel fails is reported as `Skip { reason: UnknownVersion }` rather than aborting the whole pass.
- **Alternatives**: default providers to enabled once `AutoInstall` is picked; semver ordering locally; leave the run-active check to the caller.
- **Reason**: Silently replacing a binary the owner relies on is worse than staying stale, so consent is per provider and defaults to no. The run-active veto belongs in the planner so no caller can forget it.

## 2026-10-30 — M16 Renovate, updater endpoint, and docs navigation
- **Decision**: `.github/renovate.json` sets `automerge: false` everywhere (Goose patches included), `prCreation: "not-pending"`, `internalChecksFilter: "strict"` and lists the CI checks it waits for. Goose's commented-out tag is tracked by a `customType: "regex"` manager with the `github-tags` datasource, and Goose major/minor bumps get `full-suite-required` plus a 3-day release age.
- **Decision**: `plugins.updater.endpoints` points at `https://github.com/Warsha/Warsha/releases/latest/download/latest.json` — the placeholder owner already used in `release.yml` and `book.toml` — instead of a literal `<owner>` token, which is not a parseable URL and would break `tauri build`. `pubkey` stays `""` until signing keys exist, and `bundle.createUpdaterArtifacts` is not enabled yet.
- **Decision**: `docs/src/launch/*.md` are one-line `{{#include}}` shims for `docs/launch/*.md`. mdBook writes a chapter that lives outside `src/` next to its source file, so a `../launch/*.md` SUMMARY entry builds "successfully" while publishing nothing into `book/` (its sidebar links 404). The shim keeps one source of truth under `docs/launch/` and still produces `book/launch/*.html`.
- **Reason**: All three keep the build green while leaving the human-controlled parts (the Renovate app, signing keys, the Activepieces CE deployment) explicitly undone and recorded in `PROGRESS.md`.

## 2026-10-29 — mdbook pinned to 0.5.4
- **Decision**: `docs/book.toml` uses the mdbook 0.5 config layout (`[build] build-dir`), and both `.github/workflows/ci.yml` and `scripts/wsl-setup.sh` install `mdbook --version 0.5.4 --locked` (mdbook-mermaid unpinned in CI, which is fine since it is only a preprocessor). An unpinned install would eventually yield 0.5.x+ and turn a green docs build red with no code change.
- **Alternatives**: Pin to 0.4.x and keep the older config layout; leave the install unpinned
- **Reason**: The worker's build proof showed 0.5.4 is what the unpinned install now produces, and 0.4.52 no longer accepts this book.toml. Pinning makes the two environments (CI and the WSL bridge) deterministic and keeps them identical.

## 2026-10-29 — LingCode-inspired ideas (ideas only)

- **Decision**: Adopt a set of product ideas inspired by LingCode's public website, recorded as Warsha milestones/extensions. **Ideas only** — no branding, assets, text, or code from LingCode is copied. All additions keep the PolyForm Noncommercial 1.0.0 license and Arabic-first/RTL requirements.
- **Ideas adopted**: work protection (snapshot/restore, per-hunk keep/revert, AI undo stack, worktree isolation, read-before-write, permission modes); agent workflow (Plan to Agent, todo/ask_user/send_message, mentions, skills as slash commands, context compaction, output compression); router additions (local-vs-cloud badge, Eco mode, per-task defaults, local fallback, one-click provider setup with structured "Test connection"); continue-on-server handoff with Review and apply; ship status strip plus release preflight plus one-button web deploy; live preview panel; Simple mode UI spec in docs/UI.md; website/launch honesty (real demo video, honest segments, public changelog, no fake metrics); M17 post-launch care (crash reports via self-hosted GlitchTip, store reviews, daily Arabic summary push, plain-language change requests); M18 agent workflow and context; M19 backend kit (PocketBase preferred, Supabase alternative, via MCP, payments behind a gate).
- **Open-source tools preferred over building from scratch**: git worktree for isolation; existing diff viewer for hunk cards; PocketBase (MIT) or Supabase for the backend kit; GlitchTip (self-hosted, Sentry-compatible) for crash reports; fastlane-style tooling for release preflight; RTK considered for output compression (license to be verified before use; fallback is head/tail truncation plus token counting). New milestones numbered M17, M18, M19 after M16; M14a/M14b, M5a/M5b, M6a, M8b, M15a are subsections of existing milestones.
- **Alternatives**: build these features from scratch; copy LingCode's implementation
- **Reason**: Owner's request to enrich the plan with proven UX patterns while staying license-clean and Arabic-first. Building from scratch is rejected where a mature OSS tool exists; copying is rejected outright.
## 2026-10-31 — M20: the ring order puts `warsha-backends` beside `warsha-pipeline`
- **Decision**: `docs/ARCH_RULES.md` R3 defines the ring as `core < store < providers/git/remote < pipeline/backends < warshad/cli/relay`, i.e. `warsha-backends` and `warsha-pipeline` share tier 3, and R2 additionally forbids `warsha-pipeline` from naming `warshad`, `warsha-cli`, `warsha-relay` **or `warsha-backends`**.
- **Alternatives**: Use the PLAN.md sketch literally (`… < providers/git/backends/remote < pipeline < daemons`), which puts backends below the pipeline.
- **Reason**: `crates/warsha-backends/Cargo.toml` declares `warsha-pipeline = { path = "../warsha-pipeline" }` today (coding backends implement pipeline traits). Under the literal sketch that declared edge is an upward edge, so `pnpm arch` would be red on a clean tree — and clearing it means either editing a crate manifest (forbidden by this brief) or inverting the trait design. Same-tier placement plus an explicit `R2` on the reverse edge enforces the intent the sketch was reaching for (the pipeline must never know about a backend) without a document-driven manifest edit. When backends move below the pipeline later, tightening R3 is a one-line change to the tier map in `scripts/check-arch.mjs`.

## 2026-10-31 — M20: type-aware ESLint is deferred, everything else from `.eslintrc.cjs` is kept
- **Decision**: The new `eslint.config.js` (ESLint 9 flat config, CommonJS because the root `package.json` has no `"type": "module"`) carries `eslint:recommended`, `@typescript-eslint/recommended`, `@typescript-eslint/eslint-recommended`, `react/recommended`, `react/jsx-runtime`, `react-hooks/recommended`, `import/recommended`, `import/typescript` and `prettier` — plus `no-explicit-any: error`, `no-unused-vars` with `argsIgnorePattern: ^_`, and `import/order` verbatim. The one preset **not** carried over is `plugin:@typescript-eslint/recommended-type-checked`. A rule-by-rule gap is therefore explicit rather than silent.
- **Alternatives**: Enable it and clear the fallout now.
- **Reason**: The old config never actually ran at HEAD — ESLint 9 looked for `eslint.config.js`, could not find it, and failed before reading a file, so none of its rules were ever enforced. Turning the type-checked preset on today produces ~280 violations across `apps/desktop/src`, measured rule by rule: `require-await` 19, `no-unnecessary-type-assertion` 21, `no-floating-promises` 15, `no-unsafe-argument` 15, `no-misused-promises` 14, `no-unsafe-assignment` 6, `no-unsafe-member-access` 5. Every one needs component logic rewritten (adding `await`, changing a handler's shape, typing a client response), which the brief excludes ("do NOT touch apps/**/src/** component behaviour"). It is tracked as a PLAN.md M20 follow-up so the gap is not rediscovered as a surprise.

## 2026-10-31 — M20: import resolution uses the bundled Node resolver, not `eslint-import-resolver-typescript`
- **Decision**: `import/resolver` is `{ node: { extensions: ['.ts', '.tsx', '.cts', '.mts', …] } }`, which is what the old `settings['import/resolver'] = { typescript: true, node: true }` actually degraded to once the TypeScript resolver module was absent.
- **Alternatives**: Add `eslint-import-resolver-typescript` to `package.json`.
- **Reason**: The package is genuinely absent from the install; the brief says not to add a dependency without checking first, and to prefer a rule set that does not need it. `import/no-unresolved` still runs, and the TypeScript compiler (`pnpm -r typecheck`, already in CI) is what resolves `@warsha/*` workspace paths authoritatively. Adding the resolver later is a one-line change with no rule changes.

## 2026-10-31 — M20: the `providers.*` wire is the desktop client's shape, not the daemon's
- **Decision**: The Rust DTO moves to what `@warsha/client` and the first-run wizard already send and read. `crates/warshad/src/lib.rs` replaces `ProviderConfig { id, kind, api_base, models }` with `ProviderRecord { name, kind, enabled, api_base }` (`api_base` skipped when absent), and the four methods become:
  - `providers.list() -> Vec<ProviderRecord>`
  - `providers.add(name, kind, key, api_base) -> ProviderRecord`
  - `providers.test(name) -> HealthCheck`
  - `providers.remove(name) -> ProviderRecord`
  Callers send `{ name, kind, key, api_base }` as a JSON object; jsonrpsee's named-params support maps an object's keys onto flat parameter names, so the client's existing payload *is* the wire.
- **Alternatives**: (a) keep `id` and `models` and change `packages/client/src/index.ts` plus `Onboarding.tsx` to match; (b) accept a nested `config` object the client would have to construct; (c) keep returning `()` from add and remove.
- **Reason**: The wizard, its unit tests, the three `onboarding.spec.ts` e2e tests and 112 screenshot baselines are fixed evidence of the intended wire, and the brief forbids redesigning the wizard. `name` is already the app's identity for a provider — it is what `test` and `remove` take and what the wizard's add form collects — so a second `id` would be two names to keep in step; hence no `id`. `models` was a list nothing sent and nothing read, so the model is derived instead (below). Returning the stored record rather than `()` costs nothing and gives the caller the row as persisted.

## 2026-10-31 — M20: a refused `providers.test` is a JSON-RPC error carrying its `HealthCheck`
- **Decision**: `providers.test` reports a failure as a JSON-RPC **error** whose message is the reason and whose `data` is the `HealthCheck { healthy: false, latency_ms, error }` the method declares — not as a successful `{ healthy: false }` result. The healthy answer is the ordinary `Ok(HealthCheck { healthy: true, latency_ms: Some(..), error: None })`.
- **Alternatives**: return `Ok(HealthCheck { healthy: false, .. })` and let the client inspect the flag.
- **Reason**: `Onboarding.tsx` reads a *resolved* `providers.test` as a passing test and a *rejected* one as `refused`, showing the daemon's message; `packages/client`'s `rpc()` throws `RPC error {code}: {message}` on an error object, and `e2e/harness.ts` models exactly that (`code: -32001`, message `provider <name> refused the API key`). An unhealthy *result* would therefore render as a green step for a provider that cannot be reached. The `HealthCheck` still travels, so a caller that wants the structured answer reads it from `error.data`.

## 2026-10-31 — M20: the model a connection test uses is derived from the provider's kind
- **Decision**: `providers.add` has no `model` parameter, so `providers.test` derives the model from the provider's `kind` through a new `OneClickProvider::default_model()` — OpenRouter `openai/gpt-4o-mini`, DeepSeek `deepseek-chat`, Kimi `moonshot-v1-8k`, GLM `glm-4`, Qwen `qwen-plus`, and **none** for `custom`. A kind with no default model makes `test_connection`'s model check fail, and the refusal says `Enter the model id.` URL resolution follows the same rule: the owner's `api_base` when supplied, else the kind's `default_base_url()`, and `providers.add` **refuses** (rather than guessing) when a kind has neither. `OneClickProvider::from_tag` is added to read a tag back, case- and separator-insensitively and without prefix guessing.
- **Alternatives**: store a model with the provider; skip the model check in `providers.test`; invent a placeholder model id for `custom`.
- **Reason**: These are the vendors' published ids for their flagship text model, so the check is about a real model rather than about a string being non-empty. `custom` is by definition an endpoint the owner chose, and the honest answer for it is "name your model" instead of a guess that would pass a check while naming nothing. The ids live beside the base URLs they belong to, in `crates/warsha-providers/src/provider_setup.rs`, so a vendor renaming a model is a one-line change in one place.

## 2026-10-31 — M20: provider keys go to the keychain through a `SecretStore` seam the daemon can be handed
- **Decision**: `crates/warsha-providers/src/secrets.rs` adds `trait SecretStore { store, load, delete }` with two implementations: `KeychainSecretStore`, delegating to the existing `store_key`/`load_key`/`delete_key` seam in `openai.rs` under service `warsha-provider` and **the provider's name as the account** (so two providers cannot collide on one entry), and `InMemorySecretStore` for tests. `DaemonState` gains `secrets: Arc<dyn SecretStore>`; `start_daemon` keeps its signature and passes the keychain, and a new `start_daemon_with_secrets(config, store)` lets a test inject another store. `openai.rs` gains `delete_key`. In both `providers.add` and `providers.remove` **the keychain call comes first and a failure stops the operation.**
- **Alternatives**: (a) call `keyring` directly from the RPCs; (b) let `warsha-store` hold the key encrypted; (c) fall back to a file when the platform has no secret service.
- **Reason**: Measured, not assumed — a temporary `keyring` probe in the WSL container failed with `PlatformFailure: org.freedesktop.secrets was not provided by any .service files`. A daemon that only speaks `keyring` therefore cannot be integration-tested in CI or WSL at all, and the brief requires an integration test that adds a provider, restarts the daemon and tests the connection. The trait is the seam: production code has exactly one implementation and no branch, tests get a store with the same contract, and there is **no plaintext fallback** anywhere. Order matters both ways: an add whose key could not be stored must not leave a row that every later `providers.test` would refuse, and a remove whose key could not be deleted must not leave an orphan entry under an account nothing can reach again.

## 2026-10-31 — M20: the configured providers' table is `configured_providers`, and the reachability probe lives in `warsha-providers`
- **Decision**: The synchronous settings schema (`crates/warsha-store/src/persistence.rs`) creates `configured_providers (name PRIMARY KEY, kind, api_base, enabled, created_at)`, not `providers`. The HTTP reachability probe is a free function `probe_endpoint(base_url, api_key) -> HealthCheck` in `crates/warsha-providers/src/provider_setup.rs`, doing one `GET <base_url>/models` with the key as a bearer token under an 8-second timeout.
- **Alternatives**: name the table `providers`; put the probe in `warshad`; extend `warsha-store/migrations/001_initial.sql`.
- **Reason**: That migration already creates a `providers` table (id/name/kind/models/credentials/enabled/priority/…), and `warsha-store`'s async `sqlx` migrator runs over the *same* `warsha.db` as the settings store, immediately after it — a second `providers` table made every daemon start fail with `table providers already exists`. A distinct name is what keeps one file's two schemas apart. The probe is in `warsha-providers` because `reqwest` and the setup wizard are already there: `warshad` does not depend on `reqwest`, and the provider layer is the right ring for a call to a provider's endpoint. `GET /models` is the cheapest authenticated request every OpenAI-compatible endpoint answers, and 401/403 is reported as "the endpoint refused the API key", so a mistyped key is never reported as a dead endpoint — the failure mode the old `{ healthy: true, latency_ms: 10 }` stub had.

## 2026-10-31 — M20: nothing a `providers.*` call writes, logs or returns contains an API key
- **Decision**: The key travels on `providers.add` only, is written only to the `SecretStore`, and appears nowhere else: no `providers.*` reply field, no log line, no error message. `probe_endpoint` builds its own error strings instead of using `reqwest`'s `Display` (which embeds the URL), because a base URL can carry a token in its query string and an error message is the string that reliably ends up in a log. The integration test proves the negative by scanning every byte of every file in the daemon's data directory for the canary key while asserting those same bytes *do* contain the provider's row.
- **Alternatives**: log the request URL at debug level; include the key's first characters in a refusal to help the owner spot a typo.
- **Reason**: A key that reaches a log is a key that has to be rotated, and a partial key is still a key. The proof is a whole-file scan rather than a column check because a secret that leaked into a column nobody queries is still a secret on disk.

## 2026-10-31 — M20: `warsha-cli providers add` now requires `--key`
- **Decision**: `cmd_providers` moves to the new wire, and `providers add --id <name> --kind <kind>` without `--key` is refused with "the key is stored in the OS keychain" instead of printing "use keychain for credentials" and adding a provider with no credentials.
- **Alternatives**: keep `--key` optional and add the provider with an empty secret.
- **Reason**: The old message promised a keychain flow that did not exist, and `providers.add` now refuses an empty key for the same reason: a provider whose key is missing is one every `providers.test` refuses, so recording it as configured is recording a half-finished setup. The CLI flag stays `--id` rather than being renamed to `--name` so that whatever a user has already typed keeps working.

## 2026-10-31 — M22: the desktop shell starts `warshad` in its own process, not as a sidecar
- **Decision**: `apps/desktop/src-tauri` starts the daemon through the library entry point the `warshad` binary itself calls — `warshad::load_or_create_config(None)` then `warshad::start_daemon(config)` — inside the Tauri process. Ports are the ones `config.toml` names (8765/8766 by default) with the OS-chosen fallback described below; the token is the config file's own 32-byte random token. On `RunEvent::Exit` the shell calls `DaemonHandle::shutdown()`.
- **Alternatives**: (a) `bundle.externalBin` sidecar driven by `tauri-plugin-shell`; (b) spawn `warshad.exe` from the resource directory with `std::process::Command`; (c) keep the stub's v1-style `plugins.shell.allowlist` block.
- **Reason**: The library path is the only one that hands the shell the bound ports (`DaemonHandle::rpc_port()`/`http_port()`) and the real shutdown (`shutdown()` stops the RPC server, aborts the HTTP task, kills and waits for every child the daemon spawned, and releases the data-directory lock). A spawned copy would need those ports parsed out of its stdout or fixed by convention, a second lifecycle to supervise, and a bundled executable whose path differs between `tauri dev` and an installed build — all to reach a daemon this process could have started. Reading the same `config.toml` the CLI reads also means the app and `warsha` share one data directory and one token instead of two half-configurations.
- **Consequences**: (1) A second launch finds the lock held, reports the configured endpoint anyway, and uses the daemon the first instance owns (`owned: false` in `DaemonEndpoint`), so two windows do not fight over one database and the loser does not shut down the winner's daemon. (2) If the configured ports are taken by an unrelated program, the shell retries once with OS-chosen ports rather than refusing to start. (3) Closing the window now exits the app: the previous stub hid the window, and with no tray icon there was no way back to it.

## 2026-10-31 — M22: the daemon's endpoint reaches the webview through the `get_config` key-value surface
- **Decision**: `get_config` answers three shell-owned keys from the live daemon — `daemon_url` (`http://127.0.0.1:<rpc port>`), `daemon_ws_url` (`ws://127.0.0.1:<http port>`) and `daemon_token` — and `set_config` refuses those three so a stray write cannot point the app at an endpoint that is not there. Every other key still persists to `<data dir>/desktop.json` (`onboarding_complete`, `app_mode`).
- **Alternatives**: a dedicated `daemon_endpoint` command; a Tauri startup event the webview subscribes to; writing the pair into `localStorage` from Rust.
- **Reason**: The frontend already invokes exactly two Tauri commands, `get_config` and `set_config` (`apps/desktop/src/App.tsx`), and the Playwright harness already stubs `__TAURI_INTERNALS__.invoke` generically over a config map (`apps/desktop/e2e/harness.ts`) — so a config key needs no new command, no new capability, no harness change and no event subscription to outlive the window. The daemon is started synchronously *before* the window is created, so the webview's first read cannot race the ports. In a browser there is no shell, those keys answer empty, and `App.tsx` falls back to the two development constants the harness stubs — which is why the 56 stored baselines are unchanged.

## 2026-10-31 — M22: the JSON-RPC server answers CORS preflights (`crates/warshad/src/lib.rs`)
- **Decision**: `start_daemon` parses `config.allowed_origins` once and puts a `tower_http::cors::CorsLayer` *outside* `RpcAuthLayer` on the JSON-RPC server (the same pair of layers the axum server already had); the desktop shell adds the webview's origins (`http://tauri.localhost`, `https://tauri.localhost`, `tauri://localhost`, `http://localhost:5173`) to `DaemonConfig.allowed_origins`.
- **Alternatives**: leave the daemon alone and have the webview reach the daemon through Tauri IPC; run the webview with `--disable-web-security`; add a CORS proxy inside the shell.
- **Reason**: This is a deliberate change in `crates/**`, and it is the one the desktop app genuinely needs: the webview is served from `http://tauri.localhost`, so every RPC call it makes is cross-origin and carries `Content-Type: application/json`, which a browser must preflight. A preflight carries no `Authorization` header, so with the auth layer outermost the preflight was answered `{"error":"unauthorized"}` and the real POST was never sent — the installed app could not have reached its own daemon. Before the change the JSON-RPC server had no CORS layer at all (only `/health` and `/events` did); the CLI and the integration tests send no `Origin`, see no CORS headers, and are unaffected. Verified: `warsha-desktop.exe --self-check` fails on the preflight line without the layer and passes with it.
- **Not changed**: `/events` still authenticates from the `Authorization` header only, which a browser cannot set on a WebSocket handshake, so the webview's live event feed does not work — recorded in `PROGRESS.md` rather than widened into this batch.

## 2026-10-31 — M22: `tauri.conf.json` lives in `src-tauri/`, and the icons are generated, not shipped
- **Decision**: The config moved from `apps/desktop/tauri.conf.json` to `apps/desktop/src-tauri/tauri.conf.json`, and the icon set in `src-tauri/icons/` is generated by `tauri icon` from `icons/warsha-icon.png`, which `icons/make-source-icon.py` draws (a hex nut in the design system's accent on the dark plate). `src-tauri/entitlements.plist` now exists, because `bundle.macOS.entitlements` named it.
- **Alternatives**: pass `--config apps/desktop/tauri.conf.json` to every command; commit a downloaded PNG with no provenance; drop the macOS entitlements key.
- **Reason**: `tauri-build` reads the config from the crate directory only, so a plain `cargo build` in `src-tauri` failed with `unable to read Tauri config file ... because entity not found` while the file sat one directory up, and the release workflow already uploads from `apps/desktop/src-tauri/target/**/bundle/**`. The same pass fixed the v1 leftovers that made `tauri build` fail on `unknown field 'deb'`: `bundle.deb` is `bundle.linux.deb` in the v2 schema, and the `plugins.<name>.allowlist` blocks are v1 ACL syntax that v2 ignores — permissions belong in `src-tauri/capabilities/default.json`, which grants `core:default` and nothing else because the app uses no plugin.

## 2026-10-31 — M22: no Tauri plugin crate is a dependency, and `tauri-plugin-updater` is still not wired
- **Decision**: `apps/desktop/src-tauri/Cargo.toml` declares `tauri` (with `macos-private-api`, which `app.macOSPrivateApi` compiles against), `serde`, `serde_json`, `anyhow` and `warshad` — and no plugin. The `plugins.updater` block stays in `tauri.conf.json` with the pubkey a previous batch added, but the `tauri-plugin-updater` crate is not a dependency, so it is inert.
- **Alternatives**: keep the six plugin crates the stub declared (`shell`, `process`, `fs`, `dialog`, `http`, `clipboard-manager`, `os`, `updater`) and grant each one a capability.
- **Reason**: `apps/desktop/src` imports `@tauri-apps/api/core` and nothing else: it reaches the daemon over loopback HTTP/WebSocket and the shell through `invoke`, so every plugin dependency would have been an ACL entry and a compiled artifact for no call. The updater is the one that would matter, and turning it on needs what M16 already recorded as human-only work (a signing key and a published signed `latest.json`); adding the crate without those would only add a startup check against an endpoint that answers 404.

## 2026-10-31 — M22: `--self-check` is how the installer is verified on a host that cannot show a window
- **Decision**: `warsha-desktop.exe --self-check [--data-dir <path>]` starts the daemon exactly as the window does, then asserts and prints: an authorized JSON-RPC call answers, a wrong token is refused, and the webview's CORS preflight is answered — then stops the daemon and reports whether the lock was released.
- **Alternatives**: rely on the visual suite (it stubs the shell and never starts a daemon); rely on the daemon's own integration tests (they never load `src-tauri`); require a human to open the window.
- **Reason**: On the Windows host this batch was built on, a webview cannot be created at all — `tao`/`wry` fail with `Access is denied (os error 5)` and the app panics in Tauri's setup — and the file sandbox denies the app binary any file write outside the workspace, so `%APPDATA%\warsha` was never created. Neither is a property of the app, but together they make "the window opened" unobservable here. `--self-check` exercises the part that is not a GUI, on the real release binary, in about two seconds, and is also the answer to "the installer starts but nothing works" support cases.

## 2026-10-31 — DoD Real-Model E2E Test Suite (`e2e_real_arabic_request.rs`)
- **Decision**: Added `crates/warshad/tests/e2e_real_arabic_request.rs` covering the Definition of Done requirement: "Real build: from one written Arabic request ("تطبيق حجز مواعيد لعيادة أسنان"), Warsha asks clarifying questions, plans, writes code with a REAL model (cheapest configured, cost cap enforced by Warsha's own cost accounting), tests pass, and produces a runnable web app. Proven by WARSHA_E2E_REAL=1 test + screenshots of the generated app."
- **Execution Modes**:
  1. **Standard `cargo test` (`WARSHA_E2E_REAL != "1"` or unset)**: runs completely offline using `MockProvider` at fractions of a cent, tracking cost through Warsha's own `ProviderRouter::cost_of` and `get_spent`, strictly adhering to the repository rule "No network calls to real model APIs in tests".
  2. **Real-Model Run (`WARSHA_E2E_REAL=1`)**: discovers the real provider API key from `WARSHA_REAL_PROVIDER_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `SecretStore`. Registers the real provider with the cheapest configured model (`gpt-4o-mini` for OpenAI-compatible, `claude-3-5-haiku-20241022` for Anthropic). If `WARSHA_E2E_REAL=1` is passed without any configured key, the test fails immediately with an explicit, actionable error message.
- **Workflow Steps Proven**:
  1. Intake stage: Warsha poses an Arabic clarifying question (`"ما هي ساعات عمل العيادة وما هي التخصصات الطبية المتوفرة لحجز المواعيد؟"`), blocking the run until the owner provides details (`"ساعات العمل من 9 صباحاً إلى 9 مساءً، والتخصصات: طب أسنان عام، تقويم الأسنان، وجراحة وزراعة الأسنان."`).
  2. Plan stage: Plan mode turn runs, read-only mode verified, owner approves transition to Agent mode, Gate A approved via RPC.
  3. Stages progression: Walk through Gate A -> Research -> PRD Spec -> Gate B (approved) -> Design -> Plan Tasks -> Code -> Review/QA.
  4. Cost accounting: Cost calculation via `ProviderRouter::cost_of`, budget cap set via `set_budget(project_id, 500)` ($5.00), spent tracked via `get_spent`, and budget cap enforcement proven (attempting calls when budget is exceeded fails with `ProviderError::BudgetExceeded`).
  5. Code generation & verification: Generates self-contained Rust web application `dental-clinic-app` with domain logic in `src/lib.rs`, HTTP server in `src/main.rs`, integration tests in `tests/clinic_tests.rs`, and RTL HTML5/CSS/JS frontend in `static/`.
  6. Subprocess execution: `cargo test --offline` inside generated project passes (4 tests passed: 3 unit + 1 integration), and `cargo build --offline` builds the binary.
  7. Web app preview & HTTP verification: Spawns the web server binary on an ephemeral port (`--port 0 --once`), fetches `http://127.0.0.1:{port}/`, verifies HTTP 200 OK, `Content-Type: text/html`, and Arabic clinic content.
  8. Preview artifacts & screenshots: Writes HTML preview to `bridge-io/shots/clinic-app-preview.html` and renders a full 800x600 preview screenshot PNG to `bridge-io/shots/clinic-app-preview.png` using a zero-dependency standard PNG encoder.

