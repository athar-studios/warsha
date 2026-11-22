# AUDIT-V5-REALITY — Plan-vs-Reality Audit of Warsha R-NEXT v5

| Metadata | Value |
|---|---|
| Audit Base Commit | `84cd6a28d72b46ba50d9a63c3dec3753b54c7752` (`r-next/integration`) |
| Parent Commits | `610b62f` (fix: fail-loud code stage + Gate-C reruns coder) on top of `543844c` (0.3.1 bump) & `28ee5e2` (Z1 close) |
| Worktree | `.agents/worktrees/audit-v5-reality` |
| Scope | Phase-0 (F0–FIN5, N0, N1, A1) + Release Run in A11 order (B1→A2→B2→A3→A4→B3→N2→N3→D1→D4→D5→E1→E6→E4→E3→E2→E5→A5→Z1) |
| Audit Focus | Plan-vs-reality verification, external harness activation gap (OpenCode first), laptop failure pattern analysis, un-planned gaps |

---

## 1. Per-Packet Plan-vs-Reality Table

All 33 packets audited against `docs/zadloop/R-NEXT-MASTER-PLAN.md` (v5 frozen, Amendments A1–A16), `docs/zadloop/R-NEXT-FINAL-REPORT.md`, per-packet reports, and source code in `crates/` and `apps/desktop/`.

### 1.1 Phase 0 Packets (F0–FIN5, N0, N1, A1)

| Packet | Plan Claim (1 line + MASTER-PLAN section) | Reality (Works End-to-End / Partial / Paper-Only + Evidence) | Verdict |
|---|---|---|:---:|
| **F0** | Autonomy boundaries, checkpoint protocol, and spend tracking scaffolding (§F0 :484-501). | **Works End-to-End**: Autonomy limits strictly enforced (`main` untouched, no remote tags/pushes). Scaffolding maintained in `docs/zadloop/R-NEXT-OWNER-CHECKLIST.md` and `DECISIONS.md`. | **PASS** |
| **F1** | Pinned-font capture host image and canary for deterministic visual regression (§F1 :502-518). | **Works End-to-End**: Dockerfile and fontconfig pinned at `docker/capture/Dockerfile` and `scripts/ci/capture-fontconfig.conf` with 9 SHA-pinned font faces. Used by E5 visual sweep. | **PASS** |
| **F2 / RF2 / A10** | Visual baseline CI capture workflow with bounded 64-px tolerance (§F2 :519-529, §A7 :101-120, §A10 :139-171). | **Works End-to-End**: Workflow `.github/workflows/capture-baselines.yml` and Playwright configuration `apps/desktop/playwright.config.ts:46` implement `maxDiffPixels: 64`. Baselines captured and verified. | **PASS** |
| **F3** | Remote phone pairing boundary and Keystore security (§F3 :530-552). | **Partial**: Keystore contracts and `@JavascriptInterface` stubs exist in `apps/remote`, but S2–S5 physical device pairing is deferred to owner hardware (`docs/zadloop/R-NEXT-OWNER-CHECKLIST.md` item 3). | **PARTIAL** |
| **F4** | Full 24-row matrix self-check across all target platforms (§FIN4 :572-583). | **Works End-to-End**: Automated validation matrix executed during Phase 0 close; results recorded in `docs/zadloop/packets/FINAL_REPORT.md` §2. | **PASS** |
| **F5** | Phase 0 checkpoint cut, report, and mock-provider greenfield e2e (§FIN5 :584-601). | **Works End-to-End**: Greenfield walk verified green in `crates/warsha-pipeline/tests/fake_e2e.rs` (6/6 pass). Local checkpoint tag `r-next/cp-phase0` created. | **PASS** |
| **FIN1** | Dependency security triage and license compliance sweep (§FIN3 :553-571). | **Works End-to-End**: Dependencies triaged via `R0-3-renovate-triage.md` and `deny.toml`. (Known TLS advisory carried forward to A5). | **PASS** |
| **FIN2** | Documentation consistency, binary names, and updater cleanup (§FIN4 :572-583). | **Works End-to-End**: Verified by `docs/VERIFY.md` checks in FIN4 row 22; zero stale bundle identifiers or outdated docs. | **PASS** |
| **FIN3** | Git tree hygiene: cleanup of 93 branches and 72 worktrees (§FIN3 :553-571). | **Works End-to-End**: Cleaned and recorded in commit `c2c70c9`; quarantine bundle SHA-256 archived. | **PASS** |
| **FIN4** | 24-row integration gate matrix verification on unified tree (§FIN4 :572-583). | **Partial**: 21 rows passed; 3 rows failed and were recorded as accepted debt: row 5 (desktop lint: 18 errors), row 9 (wire contracts: 4 violations), row 15 (cargo deny: 10 advisories). | **PARTIAL** |
| **FIN5** | Mock-provider e2e test suite and release build `--self-check` (§FIN5 :584-601). | **Works End-to-End**: `warsha-desktop --self-check` verified 12/12 pass ×3 consecutive runs (`0e610fb`, `a70a18d`). | **PASS** |
| **N0** | CLI-reported token usage and cost accounting integration (§N0 :602-644). | **Works End-to-End**: `CliOutput` usage parsed and aggregated into spend ledgers in `crates/warsha-backends/src/lib.rs:599-634` and `crates/warsha-pipeline/src/lib.rs:1557-1565`. | **PASS** |
| **N1** | Streaming event architecture for live CLI sessions (§N1 :645-680). | **Works End-to-End**: Line-by-line parser emits `SessionStarted`, `ToolStarted`, `ToolFinished`, `FileTouched`, `SessionEnded` to store event log (`crates/warsha-backends/src/lib.rs:344-484`). | **PASS** |
| **A1** | Model catalog persistence and settings store migration (§A1 :681-705). | **Partial**: Model catalog persists in SQLite, but `catalog.refresh` and `catalog.apply` lack RPC stubs, leaving 4 permanent wire contract test failures (`scripts/check-wire-contract.mjs`). | **PARTIAL** |

---

### 1.2 Release-Run Packets (A11 Order)

| Packet | Plan Claim (1 line + MASTER-PLAN section) | Reality (Works End-to-End / Partial / Paper-Only + Evidence) | Verdict |
|---|---|---|:---:|
| **B1** | Two-axis permission model (Confinement × ApprovalMode) with migrations (§B1 :813-837). | **Works End-to-End**: Schema migration 009 applied in `crates/warsha-store/migrations/009_project_permissions.sql`. Global default + project override UI in `apps/desktop/src/v3/pages/settings/sections/PermissionsSection.tsx` and project permissions sheet. Honest copy displayed. | **PASS** |
| **A2** | OAuth 2.0 PKCE and Device flow authentication engine (§A2 :706-752). | **Partial**: PKCE loopback and Device flow polling implemented in `crates/warshad/src/lib.rs:1155-1215` and `crates/warsha-providers/src/oauth.rs`. Desktop UI in `ModelsSection.tsx`. However, live OAuth login is unverified without real credentials (`docs/zadloop/R-NEXT-OWNER-CHECKLIST.md` item 6), and `oauth2 4.4.2` triggers `cargo deny` advisory `RUSTSEC-2025-0134`. | **PARTIAL** |
| **B2** | CLI permission mapping table and read-only tree-hash backstop (§B2 :838-898). | **Partial**: Mapping table in `crates/warsha-backends/src/permissions.rs` maps `claude-code` and `codex-cli`. Read-only backstop active in `crates/warsha-pipeline/src/lib.rs:1478-1528`. However, `opencode` has `permission_mapping: null` (unmapped), and `docs/zadloop/packets/B2-report.md` was merged unfinished with literal `TODO` markers and "Pending" gate rows. | **PARTIAL** |
| **A3** | Usage analysis, provider quota checks, and status-bar gauge (§A3 :753-784). | **Works End-to-End**: Dimension aggregations in `crates/warsha-store/src/lib.rs:140-230`. OpenRouter `/api/v1/key` quota query in `crates/warsha-providers/src/openrouter.rs`. `UsageSection.tsx` and `QuotaGaugeButton` in Frame with visibility-aware 5-min polling. | **PASS** |
| **A4** | Provider failover, exponential backoff, and 60s cooldown (§A4 :785-812). | **Works End-to-End**: `ProviderRouter::chat_with_fallback` in `crates/warsha-providers/src/lib.rs:1026-1155` enforces retry caps, 60s cooldowns, and failover triggers on transient/5xx errors. Pre-run cost estimation implemented in `crates/warshad/src/lib.rs:810`. | **PASS** |
| **B3** | Shared ask queue and rule engine DSL for native/MCP tools (§B3 :899-939). | **Works End-to-End**: Rule engine model in `crates/warsha-core/src/rules.rs`, migration 012 `tool_permission_rules`, RPCs `rules.global.*` and `rules.project.*` in `crates/warshad/src/lib.rs:3430-3530`. Shared ask queue wired into `FilesystemToolExecutor` (`crates/warsha-pipeline/src/lib.rs:2600-2640`). | **PASS** |
| **N2** | Coding-engine catalog, custom backend registry, live adapters (§N2 :940-1028). | **Paper-Only End-to-End / Broken**: 35 engines loaded in memory from `data/catalog/engines.json` (`crates/warsha-backends/src/catalog.rs`), and streaming adapters exist. BUT: **Zero JSON-RPC methods exist** in `warshad` to list engines, inspect installs, or route backends; **Zero UI exists** in desktop settings; resolved backend defaults to `None`, silently falling back to native LLM chat (`crates/warsha-pipeline/src/lib.rs:1047`). Real app users can never invoke external harnesses. | **FAIL** |
| **N3** | CLI run isolation via per-run worktrees and dedicated branch (§N3 :1029-1073). | **Partial / Unreachable from GUI**: `create_run_worktree` and `commit_run_worktree` work in tests (`crates/warsha-pipeline/src/worktree.rs`), but `crates/warshad/src/lib.rs:193` hardcodes `repo_path: None` on project creation, and Desktop UI never calls `projects.attach`. In the real app, `run.worktree_path` is **always null**, and `runs.worktree` returns `null`. | **PARTIAL** |
| **D1** | Secretary intake interview engine and transcript persistence (§D1 :1172-1208). | **Works End-to-End**: `SecretaryEngine` in `crates/warsha-pipeline/src/secretary.rs`, migration 014 `secretary_interviews`, RPCs `interview.start`, `interview.turn`, `interview.status` in `crates/warshad/src/lib.rs:1350-1420`. | **PASS** |
| **D4** | Three-rung run modes (Agent, Plan, SpecFile) + Ask mode (§D4 :1259-1298). | **Works End-to-End**: `RunMode` enum in `crates/warsha-core/src/lib.rs`, migrations 015/016. Plan/SpecFile stops at GateB approval; SpecFile injects untrusted brief artifact (`crates/warsha-pipeline/src/lib.rs:580-602`). UI displays `RunModeChip.tsx`. | **PASS** |
| **D5** | Swarm run mode: decomposed subtask worktrees & budget reservations (§D5 :1490-1547). | **Works End-to-End**: `swarm_code_completion` in `crates/warsha-pipeline/src/swarm_runtime.rs:50-250`, migration 017 `run_subtasks`. Parallel scheduling with conflict resolution, file overlap serialization, and rate-limit halts. Settings in `SwarmSection.tsx`. | **PASS** |
| **E1** | App shell, 3-mode switch (Simple/Factory/Developers), settings redesign (§E1 :1299-1325). | **Works End-to-End**: Navigation in `apps/desktop/src/v3/router/routes.ts`, mode state persisted in preferences, legacy screens inventoried and audited (`docs/zadloop/packets/E1-report.md`). | **PASS** |
| **E6** | CodeMirror 6 project code viewer, syntax highlighting, diff viewer (§E6 :1326-1361). | **Works End-to-End**: `CodeViewer.tsx` at `apps/desktop/src/v3/pages/code/CodeViewer.tsx` with lazy `FileTree.tsx`, line deep-linking, and `wave2.rs` diff/tree RPC backend. | **PASS** |
| **E4** | Developers mode: virtualized session list and live event logs (§E4 :1362-1392). | **Works End-to-End**: Page at `apps/desktop/src/v3/pages/developers/index.tsx`, `DevelopersList.tsx`, session tail ring buffer via `getSessionTail`, cost summaries per session. | **PASS** |
| **E3** | Factory mode: interactive floor schematic and agent state machine (§E3 :1393-1430). | **Works End-to-End**: Floor schematic SVG in `apps/desktop/src/v3/pages/factory/Floor.tsx`, pure state machine in `state.ts`, STOP-ALL button executing `runs.cancel` for all active runs. | **PASS** |
| **E2** | Simple mode: Secretary chat sheet, proposal cards, Tailscale bind (§E2 :1431-1475). | **Partial**: Multi-turn chat backend in `crates/warshad/src/secretary_chat.rs`, migration 018. Proposal cards require explicit owner imperative (`refs_owner_message`). Tailscale bind with loopback companion implemented. Live phone pairing deferred to owner hardware. | **PARTIAL** |
| **E5** | Rolling visual baseline sweep across 144 UI surfaces (§E5 :1476-1489). | **Works End-to-End**: 144 baseline PNGs captured on Docker host `warsha-capture:0.3.0` and verified byte-identical (`bridge-io/audit/e5/verify-1.log`). Baseline manifest updated. | **PASS** |
| **A5** | Pre-release code-health audit, dead code, and dependency sweep (§A5 :70-85). | **Works End-to-End**: Code health audit executed and documented in `docs/zadloop/packets/A5-report.md`; HIGH/MEDIUM/LOW table produced. | **PASS** |
| **Z1** | Final release verification matrix and closeout report (§Z1 :1548-1663). | **Works End-to-End**: FIN4 matrix re-evaluated at `r-next/integration` tip `28ee5e2` and recorded in `docs/zadloop/R-NEXT-FINAL-REPORT.md`. | **PASS** |

---

## 2. Prioritized Gap List

### HIGH Severity Gaps

#### GAP-H1: External Coding Harnesses Unreachable & Inoperable in Real Daemon Path
- **Packet(s)**: N2, N3
- **Symptom**: The Code stage never dispatches work to external harnesses (`opencode`, `claude-code`, `codex-cli`). The application silently falls back to native routed LLM chat completion. If an owner sets `WARSHA_CODING_BACKEND=opencode` via environment variable, the Code stage hard-crashes on run start with `needs an attached repository; project has none`.
- **File:Line Root Cause**:
  1. `crates/warshad/src/lib.rs:1-4311`: There are **zero** JSON-RPC endpoints to enumerate coding engines, detect CLI availability, or configure default/project/role routing.
  2. `crates/warsha-pipeline/src/coding_backend.rs:125-144`: Without configuration, `CodingBackendRegistry::resolve()` returns `Ok(None)`.
  3. `crates/warsha-pipeline/src/lib.rs:1045-1065`: `execute_stage_with_feedback` treats `cli_completion: None` by silently falling back to native LLM generation.
  4. `crates/warsha-pipeline/src/lib.rs:1352-1364`: When an engine is resolved via env var, `code_stage_completion` rejects projects with `repo_path: None`. Because `create_project` hardcodes `repo_path: None` (`crates/warshad/src/lib.rs:193`), all projects created in the GUI immediately fail.
- **End-to-End Repro Sketch**:
  1. Start `warshad` with `WARSHA_CODING_BACKEND=opencode`.
  2. In Warsha Desktop, complete onboarding or create a new project ("Test Project").
  3. Start a run with idea: "Create a simple HTTP health check endpoint".
  4. Advance through Gate A and Gate B.
  5. Enter Code stage: Daemon logs error `the selected coding backend 'opencode' needs an attached repository; project 'Test Project' has none`, and run terminates with `Failed`.
- **Suggested Fix Lane Scope**:
  - Implement JSON-RPC methods in `crates/warshad/src/lib.rs`: `coding_backends.list` (returns catalog with `which` install status), `backend_routing.get`, and `backend_routing.set`.
  - Add repository attachment into the project creation and project settings UI.
  - Add a "Coding Engines" picker section in `apps/desktop/src/v3/pages/settings/` and project settings.

---

#### GAP-H2: `runs.worktree` Returns `null` for All GUI-Created Projects
- **Packet(s)**: N3
- **Symptom**: Every run started from the desktop interface has `run.worktree_path: null` and `run.worktree_branch: null`. Git worktree isolation does not exist for real GUI projects; all native turns operate in the shared daemon scratch directory (`~/.local/share/warsha/agent-workspace`).
- **File:Line Root Cause**:
  1. `crates/warshad/src/lib.rs:176-209`: `create_project` hardcodes `repo_path: None`.
  2. `apps/desktop/src/v3/pages/home/index.tsx:511` & `apps/desktop/src/v3/pages/onboarding/index.tsx:447`: Client calls `createProject(name, desc, locale)` without repo path.
  3. `apps/desktop/src/`: Zero references exist to `projects.attach` across the entire frontend.
  4. `crates/warshad/src/lib.rs:663-705`: `start_run` checks `if let Some(repo_path) = project.repo_path`. Since it is always `None`, worktree initialization is skipped entirely.
- **End-to-End Repro Sketch**:
  1. Create a project via Desktop Home.
  2. Start a run via Bench.
  3. Query RPC `runs.worktree(run_id)`.
  4. Response is `{"jsonrpc":"2.0","result":null,"id":...}`.
- **Suggested Fix Lane Scope**:
  - Add optional local folder picker / Git repo input to `NewProjectDialog` and onboarding flow.
  - Wire `projects.attach` in desktop client and project settings.
  - If a project is created without a Git repo, optionally auto-initialize a local Git repository in `~/.local/share/warsha/projects/<project_id>/repo`.

---

#### GAP-H3: HTTP 503 Server Unavailable Incurs Full Exhaustive Retries Before Failover
- **Packet(s)**: A4
- **Symptom**: When an upstream provider experiences an outage or returns HTTP 503, the provider router wastes time executing all `max_retries_per_target` attempts with exponential backoff on the broken primary before failing over. If `fallback_enabled` is disabled on that role, it fails the call outright without ever setting the 60s cooldown.
- **File:Line Root Cause**:
  1. `crates/warsha-providers/src/openai.rs:448` & `crates/warsha-providers/src/anthropic.rs:381`: Status `500..=599` is classified as `ProviderError::Other("Server error: {code}")`.
  2. `crates/warsha-providers/src/lib.rs:88, 101`: `ProviderError::Other` returns `true` for both `is_retryable()` and `should_failover()`.
  3. `crates/warsha-providers/src/lib.rs:1102-1113`: In `chat_with_fallback`, the `if retryable && target_retries < retry.max_retries_per_target` branch executes before the `if failover` branch. Thus, it loops through retries on the down endpoint rather than failing over immediately.
- **End-to-End Repro Sketch**:
  1. Configure an OpenAI-compatible provider pointing to a mock endpoint returning 503.
  2. Trigger any pipeline stage or assistant turn.
  3. The request hangs for several seconds sleeping through backoff retries before switching to the secondary provider.
- **Suggested Fix Lane Scope**:
  - Distinguish transient rate limits from persistent server downtime: 503/502/504 should immediately trigger failover (or at most 1 fast retry) and engage the cooldown.

---

### MEDIUM Severity Gaps

#### GAP-M1: `B2-report.md` Merged with Unfinished Template Placeholders
- **Packet(s)**: B2
- **Symptom**: `docs/zadloop/packets/B2-report.md` contains uncompleted markdown template lines: "TODO: Add remaining deliveries as implemented" (line 5), and "Pending" for `cargo fmt`, `clippy`, `cargo test`, and arch/policy/wire checks (lines 12–15).
- **File:Line Root Cause**: `docs/zadloop/packets/B2-report.md:5, 12-15`. The worker committed an unfinished report draft, which was merged into integration without review backfill.
- **Suggested Fix Lane Scope**: Update `B2-report.md` with the verified gate outcomes and deliverables.

---

#### GAP-M2: Desktop Linting Debt (18 Problems) Breaches Official Gate Matrix
- **Packet(s)**: FIN4, Z1
- **Symptom**: Row 5 of the release verification matrix (`pnpm --filter warsha-desktop lint`) fails with exit code 1 (17 errors, 1 warning).
- **File:Line Root Cause**: Path alias resolution debt in `apps/desktop/` imports (`@warsha/ui`, `@warsha/client`). Recorded in `docs/zadloop/R-NEXT-FINAL-REPORT.md:104` as pre-existing debt.
- **Suggested Fix Lane Scope**: Normalize tsconfig paths and ESLint resolver config in `apps/desktop/.eslintrc.cjs`.

---

#### GAP-M3: Wire Contract Violations on Unimplemented Catalog Stubs
- **Packet(s)**: A1, FIN4, Z1
- **Symptom**: `node scripts/check-wire-contract.mjs` fails with 4 violations (exit code 1).
- **File:Line Root Cause**: Methods `catalog.refresh` and `catalog.apply` were declared in earlier specs but never given RPC test stubs in `packages/client/test/`. Recorded in `docs/zadloop/R-NEXT-FINAL-REPORT.md:108`.
- **Suggested Fix Lane Scope**: Add stub handlers in `check-wire-contract.mjs` or remove deprecated catalog endpoints from the wire manifest.

---

#### GAP-M4: `cargo deny` Advisories on TLS / OAuth Stack
- **Packet(s)**: A2, A5, FIN4, Z1
- **Symptom**: `cargo deny --config deny.toml check` fails with 10 root / 11 desktop advisories (`RUSTSEC-2025-0134`, etc.).
- **File:Line Root Cause**: `oauth2 4.4.2` depends on `reqwest 0.11.27`, which pulls in `rustls-pemfile 1.0.4`. Recorded in `DECISIONS.md` under `D-RN-A5-1`.
- **Suggested Fix Lane Scope**: Bump `oauth2` to 5.x or configure approved exception IDs in `deny.toml`.

---

### LOW Severity Gaps

#### GAP-L1: OpenCode Runs Without Permission Constraints under WorkspaceWrite
- **Packet(s)**: B2, N2
- **Symptom**: OpenCode has `"permission_mapping": null` in `data/catalog/engines.json`. Under `WorkspaceWrite` and `DangerFullAccess`, it passes no permission flags (`crates/warsha-backends/src/permissions.rs:54-58`), allowing unprompted sub-tool execution.
- **File:Line Root Cause**: OpenCode CLI lacks native tool-disabling CLI flags. Only the post-run read-only tree-hash backstop protects against modifications under `ReadOnly`.
- **Suggested Fix Lane Scope**: Document OpenCode sandbox boundaries in user-facing engine documentation.

#### GAP-L2: Pre-Run Cost Estimation Checklist Item Left as Open TODO
- **Packet(s)**: A4
- **Symptom**: `docs/zadloop/packets/A4-report.md:34` states `Pre-run cost estimation (TODO: Finalize implementation as per lead)`.
- **File:Line Root Cause**: The code is implemented and working in `crates/warshad/src/lib.rs:810`, but the documentation was never updated.
- **Suggested Fix Lane Scope**: Check off the line in `A4-report.md`.

---

## 3. External Coding Harness Activation Gap (OpenCode First)

### 3.1 Does Code Stage Hand Real Work to External Harnesses in the Real Daemon Path?
**NO.** In the real daemon path (non-test, real application execution), the Code stage **never hands work to external harnesses**.

```
[User Starts Run in GUI]
          │
          ▼
   create_project()  ──────► Hardcodes `repo_path: None` (crates/warshad/src/lib.rs:193)
          │
          ▼
      start_run()    ──────► Skips worktree creation because `repo_path` is None (lib.rs:663)
          │                  `run.worktree_path = None`
          ▼
   Code Stage Starts
          │
          ▼
resolve_coding_backend() ──► Registry has no routing configured (defaults to None)
          │
    ┌─────┴────────────────────────┐
    ▼ (Default: None)              ▼ (Forced via env var WARSHA_CODING_BACKEND=opencode)
Silent Fallback to Native LLM   Hard Error: `needs an attached repository; project has none`
(lib.rs:1047)                   (lib.rs:1358)
```

1. **Resolution Failure**: `CodingBackendRegistry` loads 35 engines from `engines.json`, but `default_backend`, `project_backends`, and `role_backends` are all uninitialized (`crates/warsha-pipeline/src/coding_backend.rs:86-120`). Resolution returns `Ok(None)`.
2. **Silent Fallback**: `crates/warsha-pipeline/src/lib.rs:1045-1065` intercepts `cli_completion: None` and dispatches directly to the routed native LLM (`provider = "routed", backend = "native"`).
3. **Repository Wall**: Even if `WARSHA_CODING_BACKEND=opencode` is injected, `code_stage_completion` checks `project.repo_path` (`lib.rs:1358`) and `run.worktree_path` (`lib.rs:1471`). Because GUI projects have `repo_path: None`, the stage aborts with an error instead of invoking the CLI.

---

### 3.2 Is There a Settings Picker for Coding Backends?
**NO.** There is no owner-facing coding backend picker anywhere in the application.
- `apps/desktop/src/v3/pages/settings/sections/BackendSection.tsx`: Configures Backend-as-a-Service (`BackendKit`: PocketBase or Supabase for application data storage). It does **not** configure coding CLI engines.
- `apps/desktop/src/v3/pages/settings/sections/WorkflowsSection.tsx`: Configures workflow pipeline templates (`HarnessDefinition` JSON templates: `autonomous-factory`, etc.). It does **not** configure coding engines.
- `apps/desktop/src/v3/pages/settings/sections/ModelsSection.tsx`: Configures LLM providers and model routings (OpenAI, Anthropic, OpenRouter).
- `apps/desktop/src/v3/actions/registry/settings.ts` & `bench.ts`: Register actions for harnesses, models, and BaaS backends, but have **zero** action definitions for coding engines.

---

### 3.3 Minimal Activation Path (OpenCode First)

To make OpenCode function as the primary coding engine end-to-end, the following surgical changes are required:

#### Step 1: Wire Repository Attachment into Project Creation
- In `crates/warshad/src/lib.rs:176`: Add `repo_path: Option<String>` to `create_project` parameters. If supplied, validate the directory with `validate_repository()` and persist it.
- In `apps/desktop/src/v3/pages/home/index.tsx` & `onboarding/index.tsx`: Allow the user to select or enter a local Git repository path, or auto-initialize a Git repository in `~/.local/share/warsha/projects/<id>/repo`.

#### Step 2: Implement Coding Backend JSON-RPC APIs in `warshad`
Implement three endpoints in `crates/warshad/src/lib.rs`:
```rust
// 1. List catalog engines + install status (using which())
async fn list_coding_backends(&self) -> RpcResult<Vec<CodingBackendSummary>>
// 2. Get active routing (global default + per-project)
async fn get_backend_routing(&self, project_id: Option<ProjectId>) -> RpcResult<BackendRoutingConfig>
// 3. Set active routing and persist to settings_kv `backend-routings`
async fn set_backend_routing(&self, config: BackendRoutingConfig) -> RpcResult<()>
```
- In `set_backend_routing`, update both the in-memory `pipeline.backend_registry` and the persistent `settings_kv` store under key `backend-routings`.

#### Step 3: Add "Coding Engines" Section in Desktop Settings
- Create `apps/desktop/src/v3/pages/settings/sections/CodingEnginesSection.tsx`:
  - Enumerate engines via `coding_backends.list`.
  - Display detection badge for installed engines (`opencode` installed via `which opencode`).
  - Provide a single dropdown: **Default Coding Engine** with options `[Native LLM (Default), OpenCode (CLI), Claude Code (CLI), Codex (CLI)]`.
  - Save selection via `backend_routing.set`.

#### Step 4: Verify OpenCode Command Invocations
- OpenCode runs non-interactively via:
  ```bash
  opencode run --format json "<task_prompt>"
  ```
- Verify that `crates/warsha-backends/src/lib.rs:223` correctly executes in `sandbox.work_dir` (the git worktree) and that `capture_changes()` captures the diff for commit via `commit_run_worktree()`.

---

## 4. Out-of-Plan Important Missing Items

| Item ID | Description | Impact | Severity | Suggested Remedy |
|---|---|---|:---:|---|
| **MISS-1** | **No Greenfield Git Auto-Init** | When users start an idea in Warsha without an existing repo, no Git repo exists. All CLI backends and worktree isolation fail. | **HIGH** | Auto-initialize `git init` in project scratch space when `repo_path` is omitted. |
| **MISS-2** | **No Guided Recovery on Coder Contract Failure** | Commit `610b62f` added `validate_code_stage_content`, which fails loud on invalid/empty LLM output. But the run simply halts in `Failed` without offering a model switch or retry action. | **MEDIUM** | In Bench error state, display a "Retry with Different Model / CLI Engine" action card. |
| **MISS-3** | **No CLI Health/Version Diagnostics** | `which(&self.command)` only checks binary existence. It does not verify version compatibility, auth tokens, or login state for `opencode` / `claude-code`. | **MEDIUM** | Add a "Test Engine" button in settings that runs `opencode --version` and validates CLI readiness. |
| **MISS-4** | **No Post-Mortem Crash Capture for CLI Aborts** | If a CLI process is terminated by SIGKILL or OOM, captured stderr/stdout is lost if the child pipe breaks before draining. | **LOW** | Stream stdout/stderr directly to a run log file on disk (`<worktree>/.warsha/cli.log`). |

---

## 5. Explicit NOT-CHECKED List

The following items could not be verified in this environment due to missing owner hardware, external cloud accounts, or autonomy boundary constraints:

1. **Live OAuth Authentication Flows**: Live OAuth sign-in against real provider endpoints (Google, GitHub, Anthropic OAuth) could not be tested without live client IDs, client secrets, and interactive browser consent (`docs/zadloop/R-NEXT-OWNER-CHECKLIST.md` item 6).
2. **Live Provider Balance APIs**: Live quota checking against real endpoints (OpenRouter `GET /api/v1/key`, OpenAI billing APIs) was not verified with live funded API keys (`docs/zadloop/R-NEXT-OWNER-CHECKLIST.md` item 7).
3. **Physical Mobile Device Pairing & Tailscale Approvals**: Physical Android phone pairing over Tailscale mesh networks (F3 / E2 S2–S5) could not be tested without physical mobile devices (`docs/zadloop/R-NEXT-OWNER-CHECKLIST.md` items 3, 8, 12).
4. **Windows Native Build & Runner Verification**: Windows MSVC build, NSIS installer, and Windows path separator behavior were not verified due to running on a Linux host (`docs/zadloop/R-NEXT-OWNER-CHECKLIST.md` item 4).
5. **Desktop Release Binary `--self-check` on Owner PC**: Release installer bundle installation and verification on the owner's desktop (`docs/zadloop/R-NEXT-OWNER-CHECKLIST.md` item 2).
6. **Live Execution of CLI Harnesses with Real LLM Tokens**: Live execution of `opencode`, `claude-code`, and `codex-cli` modifying files on disk using production model credits.
7. **Fast-Forward of `main` Branch**: Per autonomy policy, `main` branch remains untouched at `939a173ff94d6de5aeb6b4827c57143b247d09e1` (`docs/zadloop/R-NEXT-OWNER-CHECKLIST.md` item 1).

---

## 6. Audit Conclusion

1. **Gate-C & Fail-Loud Fix (`610b62f`)**: **VERIFIED**. The Code stage now rejects empty, DSML-leaked, or short output (<50 non-whitespace characters) and enforces coder JSON/block contracts. Gate-C changes-requested resumes properly re-execute `Stage::Code` before `Stage::ReviewQaSecurity`.
2. **Backend & Worktree Reality Gap**: **CONFIRMED (CRITICAL)**. The N2 coding backend catalog and N3 worktree isolation infra are disconnected from the application surface. Users cannot pick or run external harnesses in the desktop app, and all GUI projects lack Git worktrees (`runs.worktree` is null).
3. **Primary Recommendation**: Prioritize a targeted "Activation Lane" implementing `coding_backends.*` RPCs, project repository attachment, and an owner-facing Settings selector for OpenCode.
