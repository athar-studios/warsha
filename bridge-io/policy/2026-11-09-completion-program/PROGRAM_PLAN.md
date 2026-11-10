# Program plan — Warsha completion (UI v3 → security → extensions → self-hosting → final verification)

Planner: Claude Opus 5.5 (planner only — never implements this plan). Written 2026-11-09 ~19:30Z against `dev` =
`ba90e71` and run `2026-11-09-ui-v3` at `state.json` seq 48 (phase implement, Wave A). Owner request (2026-11-09):
add **MCP, WebMCP, Plugins (connections) and the Skills system** to the remaining work, and run until Warsha is complete
and verified by design, code, function, system and security tests, with the code cleaned and updated.

Execution prompt for the orchestrator: [`MASTER_PROMPT.md`](MASTER_PROMPT.md). Governing rules: `AGENTS.md`,
`ENGINEERING_POLICY.md`, `SECURITY.md`, `docs/ARCH_RULES.md`. Task tracking follows the repository's own system (one
evidence directory, `state.json` and `PACKETS.md` per run, `PLAN.md` section per run) — not `tasks/todo.md`.

---

## 1. Audit — what exists today (planner-verified in the code)

| Area | Exists | Missing / wrong | Evidence |
|---|---|---|---|
| **MCP client** | stdio transport with a real handshake (`initialize` → `notifications/initialized` → `tools/list`) and `tools/call` with timeout; daemon RPCs `mcp.connect/disconnect/list/send/call`; the agent loop can call MCP tools | **HTTP and WebSocket transports are recorded, not connected.** No `resources/*` or `prompts/*`. No UI client for `mcp.*` (left out of v3). No Warsha-as-MCP-server | `crates/warsha-pipeline/src/mcp_transport.rs:33,502,599`; `crates/warshad/src/lib.rs:1432-1447`; `docs/designs/UI_V3_PLAN.md:46,280` |
| **MCP tool approval** (M12 claims "approval per tool on first use") | a permission model (`Pending/Approved/Denied`, `check_permission`) | **Not enforced on the agent path:** `AgentTool::CallTool` finds any connected server that advertises the tool and calls it with no permission check | `crates/warsha-pipeline/src/agent_loop.rs:450-487`; model unused at `crates/warsha-pipeline/src/mcp.rs:158-268` |
| **Plugins (connections)** | `plugins.list/install/toggle/configure/remove`; seven bundled packs (GitHub, Slack, filesystem, git, memory, sequential-thinking, …); tokens stored in the keychain as references; enabling a plugin spawns its MCP server | **Unpinned supply chain:** bundled packs run `npx <package>` with no version, so the newest package is fetched at run time (`npx` is on the allow-list). **Secrets never reach the server:** `McpServerConfig` has no `env` field, so a GitHub/Slack pack cannot authenticate. Enable/disable **swallows connect errors** (`let _ =`; R1 owns this fix). No connection test, status or per-tool permission UI | `crates/warsha-core/src/plugin.rs:64`; `crates/warshad/src/auth.rs:915`; `crates/warsha-pipeline/src/mcp_transport.rs:120-160`; `crates/warshad/src/lib.rs:4239,4243,4280` |
| **Skills** | `SkillDefinition` with `content`, twelve bundled skills with source and licence; `skills.list/import/toggle/delete`; `load_skill_from_dir` with a copyleft check; slash-command registry | **A skill's instructions never reach the model:** the agent turn adds one line, `skill: <name> — <description>`; the SKILL.md body is stored and not sent. No `factory/skills.lock` written; no pin/hash on imports; the composer still offers its own placeholder list; `skills.import` does not fetch URLs (correct, but the UI must say so) | `crates/warsha-pipeline/src/agent_loop.rs:946`; `crates/warsha-core/src/skill.rs:14-37`; `crates/warshad/src/wave2.rs:357`; `PLAN.md:271-275` |
| **Skill/MCP scout** (M12 ✅) | proposal types, licence classes | **Mock data in production code:** `// In real implementation, query https://registry.modelcontextprotocol.io — Return mock proposals`, every proposal `version: "latest"`, `license: "MIT"` | `crates/warsha-pipeline/src/scout.rs:220-245` |
| **Harnesses (workflows)** | `harness.list/get/import/select/delete`; v3 Settings page planned | — (UI v3 U5 covers it) | `docs/designs/UI_V3_PLAN.md:213` |
| **WebMCP** | nothing | everything — zero references in code or docs | `grep -ri webmcp` = 0 hits |
| **Backend kit via MCP** (M19 DoD) | definition layer, export | not joined to MCP; nothing dials a backend | `PLAN.md:292-293` |
| **Agent `RunCommand`** | runs a program in the working dir | **no allow-list, shells allowed** (P7 deferred) | `crates/warsha-pipeline/src/agent_tools.rs:370` |
| **Existing-repo projects** | `repo_path` column, `update_project` in the store | `projects.create` always stores `repo_path: None`; no RPC sets it | `crates/warshad/src/lib.rs:2404` |

**WebMCP status (external, re-verify at intake):** an experimental W3C Web Machine Learning CG draft. Pages register tools
with `registerTool(...)` on `document.modelContext` (earlier drafts and some shipping builds use `navigator.modelContext`);
`provideContext()`/`clearContext()` were dropped from the draft in 2026; Chrome exposes it through an origin trial. Treat
it as unstable: feature-detect both entry points, keep it behind a setting that is off by default, and never depend on it
for a core flow.

---

## 2. Architecture decisions (binding for the program)

1. **One extension model.** A *plugin* (shown as «اتصال» / "connection" in the UI) is a pinned manifest that may carry MCP
   servers, skills, a config schema, required secrets (as references) and the permissions it asks for. Skills can also be
   installed alone. Everything installed is recorded in `factory/skills.lock` (id, kind, source, exact version or commit,
   content hash, licence class, permissions, installed_at, approved_by = owner).
2. **Approval is enforced at the call site, not at install.** Every MCP tool call from an agent passes a permission check
   keyed `server::tool::role` with three states: allow, ask, deny. *Ask* creates an inbox item for the owner and returns
   "awaiting approval" to the agent; nothing reaches the transport until the owner allows. Default for new tools: ask.
   Gate approval itself is never exposed as an MCP or WebMCP tool (`SECURITY.md`: agents never approve gates).
3. **Pinned or refused.** An MCP server launch must name an exact version (`pkg@x.y.z`) or a local path with a recorded
   hash; unpinned manifests are refused at install. Launches go through the daemon's process allow-list (first
   `split_command` token).
4. **Scoped secrets.** A server's child process gets a cleared environment plus only the variables its manifest names,
   resolved from the keychain at spawn. Values never appear in logs, traces, `state.json` or evidence.
5. **Progressive skill disclosure.** The agent always sees the index of enabled skills (name and description); invoking
   a skill (slash command or router choice) injects its SKILL.md body into that turn's prompt.
6. **Network seams, never mocks in production.** The scout's registry client sits behind a trait; tests use recorded
   fixtures; production either reaches the registry or reports "catalog unavailable". No "In real implementation" stubs
   remain in non-test code.
7. **WebMCP derives from the actions registry.** WebMCP tools are generated from the v3 `actions` registry for an explicit
   safe list, execute through `useAction` (same capability check and confirm dialog), and are unregistered (AbortSignal)
   on route change or sign-out. Off by default.
8. **Warsha as an MCP server** (`warsha mcp serve`, stdio) exposes read tools and "start run"; gate decisions stay human.
9. **Tests never touch real model APIs or real registries** (mock provider, fixtures, loopback servers). A real-model run
   happens only behind the owner's `WARSHA_E2E_REAL=1` opt-in.

---

## 3. Dependency graph

```
R0  UI v3 run (finish: Wave A → C1 → U1/E0 → C2 → U3–U6 → C3 → U7 → C-final, v0.3.0)
 │
 ├── R1 SEC  dependency & supply-chain security (renovate advisories, cargo deny, pnpm audit, gitleaks)
 │     │
 │     └── R2 EXT  extensions
 │            X0 contract + lockfile ──┬── X1 MCP approval enforcement ── X1b approval inbox + UI
 │                                     ├── X2 MCP spawn hardening (pin, allow-list, scoped secrets)
 │                                     │      └── X3 MCP Streamable HTTP transport
 │                                     ├── X6 Skills real (store, lock, body to model, slash cmds)
 │                                     └── X5 Scout truth (registry seam + fixtures)
 │            X1b + X2 + X3 ── X4 Connections UI (status, test, tools, permissions, revoke)
 │            X2 + X6 ── X7 Plugins as bundles (install/configure/remove round trip)
 │            X1 ── X8 Warsha MCP server
 │            X4 + U-actions registry ── X9 WebMCP in Warsha's own UI (flagged)
 │            X6 ── X10 WebMCP-ready skill/template for generated apps
 │            X7 ── X11 Backend kit through MCP (PocketBase/Supabase pack)
 │
 └── R3 SH  self-hosting: SH1 attach repo + per-run worktree · SH2 = P7 RunCommand policy + scoped env
            · SH3 coding-CLI backend (Claude Code / Codex headless) · SH4 Gate C → local branch + diff + gates
            (+ optional draft PR via warsha-git on owner approval) · SH5 pilot vs orchestrator, same gates
              │
              └── R4 FIN  cleanup + full verification matrix + install on owner PC + final report
```

Order is strict between runs (R0 → R1 → R2 → R3 → R4). Inside a run, packets on different branches of the graph run in
parallel in their own worktrees; merges follow the arrows.

---

## 4. Runs and packets

Sizes: S = 1–2 files, M = 3–5 files. No packet may be L or larger: split it before dispatch. Every packet's exact gate
commands are frozen by the **run planner role** (never the implementer) in that run's `state.json` before implementation.
The standing gate set below applies to every packet in addition to its own gates.

**Standing gates (every packet, at the reviewed commit):**
`cargo fmt --all -- --check` · `cargo clippy --workspace --all-targets -- -D warnings` ·
`cargo test --workspace --no-fail-fast` · `pnpm -r typecheck` · `pnpm -r lint` · `pnpm -r test` · `pnpm format:check` ·
`node scripts/check-arch.mjs` · `node scripts/check-wire-contract.mjs` · `pnpm policy` · no new test skip/ignore ·
snapshot changes only inside a fenced, authorised refresh.

### R0 — finish run 2026-11-09-ui-v3 (already planned)
Follow `bridge-io/policy/2026-11-09-ui-v3/PLANNER_RESPONSE.md` §2 exactly: close H1 and R1 → C1 → U1, E0 → C2 →
U3–U6 → C3 → U7 → C-final (bump to **0.3.0**, JAVA_HOME for GC.14, GC.1–GC.17 green) → non-force push of `main` →
installer → install on the owner PC → `--self-check` → run report. Then promote the run's gate tools
(`actions-gate.mjs`, `i18n-gate.mjs`, `contrast.mjs`, `pw-gate.mjs`, `versions.mjs`, `planner-simplicity.spec.ts`)
into `scripts/` (packet **R0.T**, S) so later runs and CI reuse them.

### R1 — SEC: dependency and supply-chain security (target 0.3.1)
| Packet | Does | Acceptance | Gates (beyond standing) | Size |
|---|---|---|---|---|
| S1a | runtime crates: tokio, tracing-subscriber, anyhow, chrono, rand (renovate advisories) | advisories for these crates gone; no behaviour change | `cargo deny check advisories` shows none of these; full Rust suite green | M |
| S1b | crypto/transport: ring, snow (pairing/relay crypto) | advisories gone; pairing tests and crypto vectors unchanged | `cargo deny check advisories`; `cargo test -p warsha-relay -p warsha-remote` | M |
| S1c | data/git: sqlx, gix | advisories gone; store migrations and git tests green | `cargo deny check advisories`; `cargo test -p warsha-store -p warsha-git` | M |
| S1d | tauri (desktop shell) | advisory gone; desktop builds and self-checks | `cargo deny check advisories`; desktop `tauri build`; `--self-check` 11/11 | M |
| S2 | JS dependencies | no high/critical in production deps | `pnpm audit --prod --audit-level high` exit 0 | S |
| S3 | secret and licence sweep | full-history secret scan clean; licence policy clean | `gitleaks detect --config .gitleaks.toml` (full history) exit 0; `cargo deny check licenses bans sources` exit 0; `THIRD_PARTY_NOTICES.md` current | S |

Checkpoint R1: `cargo deny check` exit 0 (all four sections) · `pnpm audit --prod --audit-level high` exit 0 · full
Playwright via pw-gate `outside=0` · installer builds.

### R2 — EXT: MCP, plugins (connections), skills, WebMCP (target 0.4.0)
| Packet | Does | Acceptance (≤ 3) | Verification | Deps | Likely files | Size |
|---|---|---|---|---|---|---|
| **X0** contract | extension manifest types (plugin = servers + skills + config schema + secret refs + permissions), `factory/skills.lock` format and reader/writer, wire types in `packages/client` | manifest round-trips; lock written atomically and re-read identically; wire contract check covers the new types | unit tests (core + client); `check-wire-contract.mjs` | R1 | `crates/warsha-core/src/plugin.rs`, new `crates/warsha-core/src/lockfile.rs`, `packages/client/src/*` | M |
| **X1** MCP approval enforcement | agent `CallTool` checks `server::tool::role` permission before the transport; ask/deny/allow persisted in SQLite; revoke | a denied or un-approved tool never reaches the transport (mock manager counts 0 calls); allowed tool is called once; revocation takes effect on the next call | Rust tests in `agent_loop`/`mcp`; store migration test | X0 | `agent_loop.rs`, `mcp.rs`, `warsha-store` | M |
| **X1b** approval inbox | "ask" creates an inbox item; RPCs `mcp.permissions.list/set`; v3 inbox shows tool, server, role, arguments summary; owner allows once/always/denies | inbox item appears for an "ask" call; allow-once runs exactly one call; deny returns a `ToolError` the agent sees | Rust RPC tests; client tests; e2e per new action (actions-gate) | X1, R0 | `warshad/src/lib.rs`, client, v3 inbox components, i18n ar/en | M |
| **X2** spawn hardening | refuse unpinned launches; route MCP spawns through the process allow-list; `env` on `McpServerConfig`, cleared child env + manifest-named secrets from the keychain; surface connect errors | unpinned manifest refused with a clear error; a test server echoing its env shows only the scoped vars; no secret value in logs/traces (redaction test) | Rust tests with a loopback stdio test server; redaction test | X0 | `mcp_transport.rs`, `process_spawn.rs`, `warshad/src/lib.rs`, `plugin.rs` (pin bundled packs) | M |
| **X3** Streamable HTTP | connect HTTP MCP servers (https, or http only on loopback), bearer token from the keychain, timeouts; WebSocket stays recorded-only unless trivial | handshake + `tools/list` + `tools/call` against a local test HTTP server; plain http to a non-loopback host refused | Rust tests against an in-process server; no real network | X2 | `mcp_transport.rs` (+ new module if > 1 600 lines) | M |
| **X4** Connections UI | v3 Settings › الاتصالات: status (connected / failed / needs secret), Test connection, tools list, per-tool permission per role, revoke, last error | every control registered and e2e-proven; Arabic-only on `ar`; contrast and simplicity gates pass | actions-gate, i18n-gate, contrast, planner-simplicity, Playwright via pw-gate | X1b, X2, X3 | v3 settings page, hooks, i18n | M |
| **X5** scout truth | registry client behind a trait for the official MCP Registry API; proposals carry real version and licence; unknown licence → link-only; install only on approval writes the lock | no mock data or "In real implementation" left in `scout.rs`; fixture-based tests for list/search/licence mapping; offline → "catalog unavailable" state | Rust tests with recorded fixtures; grep gate (run from a script file): `git grep -nE "In real implementation|mock proposals" -- crates ":!**/tests/**"` prints nothing | X0 | `scout.rs`, new `registry_client.rs` | M |
| **X6** skills real | skill store loads bundled and imported SKILL.md folders, pins by commit/hash, licence check, writes the lock; the invoked skill's body is injected into the turn prompt; composer slash commands come from the store | mock provider captures the prompt and finds the SKILL.md body after `/skill`; a disabled skill is absent from the index; a copyleft skill is refused for bundling | Rust tests (agent_loop + skills); client + composer tests; e2e for slash command | X0 | `skills.rs`, `agent_loop.rs`, `warshad/src/lib.rs`, v3 composer | M |
| **X7** plugins as bundles | `plugins.install` accepts a pinned bundle manifest; shows a permission summary for approval; configure stores secrets in the keychain; remove disconnects servers, removes skills and the lock entry | install → configure → test → toggle → remove round trip leaves no row, no lock entry, no running process | Rust RPC round-trip test; e2e for the UI flow | X2, X6 | `warshad/src/lib.rs`, `wave2.rs`, v3 settings | M |
| **X8** Warsha MCP server | `warsha mcp serve` (stdio): read tools (projects, runs, run status, pending gates) + start run (owner token, capability-checked); never gate decisions | Warsha's own MCP client completes handshake, `tools/list`, `tools/call` against the server binary; no tool named or behaving as a gate approval | Rust integration test (loopback); CLI test | X1 | `crates/warsha-cli/src/*` (new `mcp_serve.rs`) | M |
| **X9** WebMCP (Warsha UI) | in v3 desktop and remote PWA: feature-detect `document.modelContext ?? navigator.modelContext`; register tools generated from the actions registry for a safe list (read status, navigate, start run with confirm, send follow-up); execute through `useAction`; unregister on route change/sign-out; Settings toggle, off by default | with a fake `modelContext`, enabling the setting registers exactly the safe-list tools and disabling removes them; a tool call runs the same action path (rpcCalls log) and confirms where the action confirms; gate/delete/secret actions are never registered | vitest with a fake modelContext; Playwright with an injected shim; actions-gate extended so every WebMCP tool maps to a registered action | X4, R0 | new `apps/desktop/src/v3/webmcp/*`, `apps/remote/src/webmcp/*`, settings, i18n | M |
| **X10** WebMCP for generated apps | bundled skill + harness option "agent-ready web app": projects Warsha builds expose their own actions through WebMCP (template + test) | the template's test registers its tools against a fake modelContext; the skill passes the licence and lock checks | template tests; skills tests | X6 | `templates/*`, bundled skill folder | S |
| **X11** backend kit via MCP | join `BackendKit` to a pinned PocketBase (or Supabase) MCP pack so the agent creates tables/policies through tool calls | with a loopback fake backend MCP server, a kit produces the expected tool calls in order; approval rules apply | Rust tests (loopback) | X7 | `backend_kit.rs`, plugin manifest | M |

Checkpoints R2: **after X1+X2** (security core: approval enforced, pinned, scoped secrets — run the security reviewer
role on the diff) · **after X5+X6** (no mocks; skills reach the model) · **after X9** (design gates on new pages) ·
run C-final: integration gates + full Playwright pw-gate `outside=0` + installer.

### R3 — SH: self-hosting (target 0.5.0)
| Packet | Does | Acceptance | Size |
|---|---|---|---|
| SH1 | `projects.attach` (or `repo_path` on create): must be a git repo with a clean tree; each run works in its own `git worktree` + branch under the data dir, never in the owner's checkout | attaching a dirty or non-git path is refused; a run's writes land only in its worktree; removing the run removes the worktree | M |
| SH2 (= P7) | `RunCommand` through the process allow-list on the first `split_command` token; `sh/bash/cmd/powershell/pwsh` refused unless allow-listed; cleared env | refused / allowed / shell-refused tests; refusal is a `ToolError` the agent sees | S |
| SH3 | coding-CLI backend: Claude Code / Codex headless as the coder role, as subprocesses with their own login (Warsha never reads their tokens), inside the run worktree, with budget/timeouts | a fake CLI binary on PATH receives the brief and its output becomes the coder stage result; no token file is read by Warsha | M |
| SH4 | Gate C output = local branch + diff + gate results; optional draft PR through `warsha-git` only after the owner approves Gate C | approving Gate C produces the branch and the evidence; rejecting leaves nothing behind | M |
| SH5 | pilot: one small fenced packet given to Warsha and to the orchestrator with the same frozen gates | the comparison is recorded; widen only on parity (owner decides) | S |

### R4 — FIN: cleanup and full verification (target 1.0.0-rc, draft only)
| Packet | Does |
|---|---|
| FIN1 code cleanup | remove dead code and superseded models (e.g. the unused `McpRegistry` once X1 lands), stale feature flags, unused exports; zero `unwrap()` in non-test Rust; zero production stubs/mocks (grep gate) |
| FIN2 docs truth | regenerate README "Verified today" from gate logs; PLAN.md checkboxes and the M10–M19 Definition of Done lines each either checked with evidence or marked out of scope with an owner decision; SECURITY.md threat model updated for MCP, plugins, skills, WebMCP and the MCP server; `docs/UI.md`, `DESIGN_SYSTEM_V3.md`, `UI_V3_PLAN.md` match the shipped UI |
| FIN3 hygiene | delete local branches and worktrees already merged into `main` (list them first in evidence); never delete remote branches; keep unmerged ones and list them |
| FIN4 verification matrix | run §5 in full on the integrated tree; every row green or recorded as owner-only uncovered |
| FIN5 install and report | non-force push of `main`; build installers; install on the owner PC; `--self-check`; a mock-provider greenfield project end to end in the installed app; final program report |

Acceptance for FIN1–FIN5 is the matching rows of the §5 matrix, each with its gate log in the run's evidence dir.

---

## 5. Verification matrix (the program's Definition of Done)

| Dimension | Gate | Pass condition |
|---|---|---|
| **Design** | `contrast.mjs --check-css`, check-ds-v3 lint, `planner-simplicity.spec.ts`, visual baselines, `screens.a11y` | all pass; axe 0 violations on every v3 screen in ar and en, light and dark; RTL logical properties only |
| **Code** | standing gates + `scripts/check-versions.mjs` + i18n-gate + no-unwrap check + production-stub grep | all exit 0; no `unwrap()` outside tests; no "mock"/"In real implementation"/`todo!()` in non-test code |
| **Functions** | `cargo test --workspace`, `pnpm -r test`, actions-gate (every control → registered action → served RPC → e2e), full Playwright via pw-gate, CLI smoke, MCP loopback tests | 0 failed; pw-gate `outside=0`; actions-gate 0 unregistered and 0 dead controls |
| **System** | installers build; install on the owner PC; `warsha-desktop.exe --self-check`; daemon + CLI + desktop + remote PWA paired; mock-provider greenfield run to Gate D in the installed app; APK built and `apksigner verify`; `docker run` of the image | every step logged with output; real-model run only if the owner opts in with `WARSHA_E2E_REAL=1` (else recorded as uncovered) |
| **Security** | `cargo deny check`, `pnpm audit --prod --audit-level high`, `gitleaks detect` (full history), MCP approval/pin/secret-scope tests, redaction tests, process allow-list tests (preview, MCP spawn, RunCommand), WebMCP safe-list test, independent security review (a security-reviewer agent, separate from the implementer) of the extension and self-hosting surfaces | all exit 0; review has no open high/critical finding |
| **Release truth** | versions aligned; release bundle staged as **draft**; nothing tagged or published | `check-versions` exit 0; no tag, no GitHub release, no store submission |

**Out of this program (owner-only, recorded, never faked):** Authenticode/Apple signing, Tauri updater keys, GitHub
environment protection, tagging and publishing releases, store submissions, the hosted end-to-end encrypted relay (M6),
crash collector / store reviews / push (M17) — each listed in the final report with what it needs.

---

## 6. Owner decisions (defaults the orchestrator applies; the owner may change any line before starting)

| Id | Question | Default |
|---|---|---|
| OD-P1 | Pre-authorise merging each fully verified run into `dev` and a non-force push of `main` after each run's C-final is green | **yes** (owner request 2026-11-09: do not stop until complete) |
| OD-P2 | OAuth 2.1 for remote MCP servers | **defer** — bearer token from the keychain only |
| OD-P3 | WebMCP in Warsha's UI | **build, off by default** |
| OD-P4 | Branch/worktree cleanup scope | **local branches already merged into `main` only** |
| OD-P5 | Real-model E2E | **not run** unless the owner sets `WARSHA_E2E_REAL=1` with a budget cap |
| OD-P6 | Versions | R0 0.3.0 · R1 0.3.1 · R2 0.4.0 · R3 0.5.0 · R4 1.0.0-rc (draft only) |
| OD-P7 | Coding CLI for SH3 | **Claude Code headless first, Codex second** |

---

## 7. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Worker sessions hit the 150-turn ceiling (seen on H1, U2, R1) | High | packets ≤ M; one area per session; commit after every step; fixed continuation brief; split instead of retrying |
| Flaky e2e under full-suite load (`flows.spec.ts` mode group) | Med | stabilise before Wave C; never widen named sets to hide it; three-attempt record only for a proven environment flake |
| WebMCP spec churn | Med | feature-detect both entry points; flag off by default; tests use a fake `modelContext`; re-verify the draft at R2 intake |
| MCP supply chain (npm packages run as processes) | High | pin + hash, allow-list, cleared env, approval at call site, security review at the X1+X2 checkpoint |
| Dependency upgrades break builds (tauri, sqlx) | Med | one crate group per packet; revert the packet, not the run, on failure |
| Self-hosting agent damages the owner's checkout | High | SH1 worktree-only writes + SH2 allow-list before SH3 ever runs on the Warsha repo; pilot on a fenced packet |
| Report drift (claims ahead of evidence, as in the UI v3 draft report) | Med | reports generated from `state.json` and gate logs only; "verified on branch" ≠ "merged" |

---

## 8. Task index (tracked per run in `state.json` / `PACKETS.md`)

- [ ] R0 finish UI v3 (H1, R1 → C1 → U1, E0 → C2 → U3–U6 → C3 → U7 → C-final → push → install) · R0.T gate tools to `scripts/`
- [ ] Checkpoint R0: 0.3.0 installed on the owner PC, main pushed
- [ ] R1 S1a · S1b · S1c · S1d · S2 · S3
- [ ] Checkpoint R1: deny/audit/gitleaks clean
- [ ] R2 X0 → X1, X2, X5, X6 → X1b, X3 → X4, X7, X8 → X9, X10, X11
- [ ] Checkpoints R2: security core (X1+X2) · no mocks + skills reach model (X5+X6) · design (X9) · C-final
- [ ] R3 SH1 · SH2 · SH3 · SH4 · SH5
- [ ] Checkpoint R3: pilot comparison recorded
- [ ] R4 FIN1 · FIN2 · FIN3 · FIN4 · FIN5
- [ ] Checkpoint complete: §5 matrix green, final report, owner acceptance
