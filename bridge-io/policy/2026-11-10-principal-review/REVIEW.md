# Warsha (ورشة) — principal review and plan of record v2

Reviewer: Claude Fable 5.2 (planner role only — implements nothing in this plan). Written 2026-11-10 ~03:00Z.
Mechanical extraction: five Haiku subagents (code smells, RPC cross-map, security excerpts, UI/i18n inventory, test
and gate ledger). Every finding marked **verified** below was re-read by the reviewer in the source.

**Basis.** `dev` = `ba90e71` (what the owner has installed) and the UI v3 integration tip `128b59c`
(`warsha-wt/v3/integration`, C1 merged). Where the two differ it is said.

**What this review is not.** Nothing was built or run: no `cargo test`, no Vitest, no Playwright. Test counts are
quoted from the run evidence, not re-measured. Not audited: `warsha-relay`, the mobile shell, the remote PWA code,
CI workflows, guardrails/evals/tracing wiring, `wave2::parse_plugin_manifest`.

**Live-run notice.** The UI v3 orchestrator was active while this was written (`2026-11-09-ui-v3/state.json` seq 60,
updated 02:47Z; RH1 re-launched 02:38Z). This review therefore **does not rewrite** `PROGRAM_PLAN.md`; §5 is an
amendment that takes effect at the boundaries it names.

---

## 0. Verdict

Warsha today is a well-defended daemon and a rigorous delivery process wrapped around an engine that does not yet do
the product's job. Each pipeline stage is one model call whose text is saved as an artifact; no stage writes files,
runs a test or produces a diff. The coding backends are detected at start-up and never invoked. The "agent loop"
runs commands the owner types and otherwise makes one stateless model call. A rejected gate, a change request and an
exhausted budget each stop a run for good. The UI v3 specification is sound and none of its pages exist yet.

The security defects named in the brief are real. They are hard to reach today only because the agent is not
autonomous; each becomes critical the day a real tool loop lands. So the order of work has to change: integrity and
safety first, then the engine, then extension breadth — and v3 pages must be built against engine capabilities, not
fixtures.

---

## 1. Executive scorecard

| Dimension | Score | Basis |
|---|---|---|
| **Architecture** | **4 / 10** | Sound daemon shell (auth table, single-instance lock, child reaping, event bus with resync). The core is a linear prompt relay with no concurrency model for run state, a global singleton agent, two SQLite stacks on one file, and an 8,904-line `warshad/src/lib.rs`. |
| **Security** | **4 / 10** | Strong perimeter: 88/88 RPC methods carry a policy and a rate tier, provider keys sit behind the keychain seam, gate decisions require a verified device. Unfenced interior: `RunCommand` runs any program with the daemon's environment, MCP children inherit that environment, bundled packs are unpinned, the process allow-list is bypassed through `plugins.toggle`, no MCP call checks a permission, and gates can be approved before the run reaches them. |
| **Design / UX** | **4 / 10** (spec 7 · shipped 3) | The «حِرفة» v3 spec has the right rules (one question per screen, every control works or does not exist, plain Arabic). What the owner runs is v2: a canned chat reply, a Simple run that never advances, four "pending" decisions from the first second. v3 pages are 12-line placeholders. |
| **Engineering hygiene** | **6 / 10** | Zero TypeScript `any`, three non-test `unwrap()`, 1101/1101 i18n key parity, zero physical-direction CSS, 759 cargo tests, ~1,090 Vitest cases, 884 Playwright cases, evidence-first policy. Held down by status labels that mean "types exist" (M10–M19 "✅ DONE"), stubs in production paths, and process weight (609 KB `PROGRESS.md`, 15 worktrees, sessions dying mid-packet). |

### First failure point under load

**Two overlapping `runs.advance` calls on one run** — no load beyond that is needed. *(verified)*

- `runs.advance` executes the whole model walk inline in the RPC handler (`crates/warshad/src/lib.rs:3756-3768`);
  there is no per-run lock and the client sets no timeout (`packages/client/src/index.ts:1441`).
- Every run mutation is read → modify in memory → whole-row `UPDATE` with no version check
  (`crates/warsha-store/src/lib.rs:356-372`).
- `advance_stage` moves `current_stage` and persists it **before** the model call
  (`crates/warsha-pipeline/src/lib.rs:371-393`). A second caller (double click, desktop + phone, a retry) reads the
  moved pointer, starts the *next* stage without the previous stage's artifact, and whichever finishes last
  overwrites the other's row: an artifact is lost, spend is mis-counted, and the stage pointer can move backwards.
- The same race defeats cancellation: `runs.cancel` writes `Cancelled`, the in-flight stage finishes and writes back
  `Running` (`lib.rs:393`, `791-795`). The HTTP call to the provider is never aborted.

Second in line: `agent.turn` holds the one global agent write-lock across a blocking `Command::output()` with no
timeout (`crates/warshad/src/lib.rs:3288-3291`, `crates/warsha-pipeline/src/agent_tools.rs:378-381`). One hung
program freezes every agent turn and pins a runtime worker thread.

---

## 2. Day-0 critique

### 2.1 Top five architectural flaws

**A1 — The engine is a prompt relay, not a build system.** *(verified)*
`execute_stage` sends one request per stage: a single **system** message, `max_tokens: 4000`, no streaming; the reply
becomes an artifact named after the stage (`crates/warsha-pipeline/src/lib.rs:401-561`). The Code stage is therefore
one ≤4,000-token completion stored as text.
- Coding backends are collected into `DaemonState.backends` and never read
  (`crates/warshad/src/lib.rs:1030`, `6902`); `CodingBackend::execute` runs `<cli> --version` and discards the task
  (`crates/warsha-backends/src/lib.rs:186-193`).
- Turning model output into files exists only in a test harness
  (`crates/warshad/tests/e2e_real_arabic_request.rs:1231-1270`).
- The discovery interview is auto-answered with `"To be determined"`, `["Web"]`, `"Free"`, `false`, `10000`
  (`crates/warsha-pipeline/src/lib.rs:292-309`).
- Every stage prompt is told `{{language}}` = `"en"` (`lib.rs:1007`) — in an Arabic-first product.
- An unrouted role is answered by `FakeProvider` with no notice to the owner (`lib.rs:640-667`): a mis-configured
  role produces canned text that looks like work and can be approved at a gate.

**A2 — Run state has no concurrency or lifecycle model.** *(verified)*
Beyond the race in §1:
- Nothing in production code sets a run back to `Running` or a gate back to `Pending`. "Request changes", "Reject"
  and "budget exceeded" each set `Paused` (`lib.rs:597`, `1103`, `1159`) and `advance_stage` then refuses the run
  (`lib.rs:347-352`). There is no `runs.resume`.
- `approve_gate`, `reject_gate` and `request_changes` check that the gate is `Pending`, not that the run is **at**
  it (`lib.rs:1035-1041`). All four gates are `Pending` from `start_run` (`lib.rs:269-273`), so Gate D can be
  approved before any artifact exists, and the walk then passes straight through it (`lib.rs:756-764`).
- No start-up recovery: a daemon that dies mid-stage leaves the run `Running` at a stage with no artifact; the next
  advance skips that stage.
- The budget is checked after the call that exceeded it (`lib.rs:581-617`).

**A3 — The "agent loop" is not an agent.** *(verified)*
- Tools run only when the **owner's text** starts with `read file`, `write file`, `run command`, `call tool`
  (`crates/warsha-pipeline/src/agent_loop.rs:727-856`). The model cannot call a tool.
- Any other turn is one model call whose prompt omits the transcript: `model_prompt` builds from the instruction,
  the current input and attachments only (`agent_loop.rs:912-949`); `self.context` is written and compacted but
  never sent (`agent_loop.rs:376-378`). The 512-"token" budget (`:57`) governs text no model reads.
- Answers are capped at 1,024 tokens, folded to 12 lines and joined into one (`agent_loop.rs:82`, `627-634`).
- One instance serves the whole daemon — no project or run scope (`crates/warshad/src/lib.rs:1062`, `4859-4878`;
  `agent.turn(input: String)` at `:1402-1403`).
- No shipped screen calls `agent.turn` (RPC cross-map, list B).

**A4 — Trust is enforced at the RPC edge and nowhere inside.** *(verified unless noted)*
- `RunCommand`: direct spawn, no allow-list, inherited environment, no timeout, no output cap, no kill
  (`crates/warsha-pipeline/src/agent_tools.rs:370-404`). The daemon already has an allow-list
  (`process_policy().check_command`, `crates/warshad/src/lib.rs:3402-3408`) and this path does not use it.
- **Allow-list bypass:** `plugins.install` stores a manifest's `command` with no policy check
  (`lib.rs:4178-4197`), and `plugins.toggle` / `plugins.configure` hand it straight to the MCP manager
  (`lib.rs:4234-4239`, `4275-4280`), skipping the check that `mcp.connect` performs. Connect errors are dropped
  (`let _ =` at `:4239`, `:4243`, `:4280`).
- MCP children inherit the daemon's environment — `command_for` never clears it
  (`crates/warsha-pipeline/src/process_spawn.rs:332-343`) — and receive none of their own: the spawn passes an empty
  map (`crates/warsha-pipeline/src/mcp_transport.rs:778`) because the transport's `McpServerConfig` has no `env`
  field (`mcp_transport.rs:116-126`; a second type of the same name in `mcp.rs:45-60` has one). A GitHub pack cannot
  authenticate, yet it can read whatever the daemon's environment holds (for example `WARSHA_LLM_API_KEY`,
  `lib.rs:652`). Child `stderr` is inherited, so it reaches the daemon log unredacted (`process_spawn.rs:341`).
- Seven bundled packs launch bare `npx <package>` / `uvx strix-mcp`: no version, no hash
  (`crates/warsha-core/src/plugin.rs:64-66`, `91-295`). Five are seeded `enabled: true`.
- No MCP call checks a permission: neither the agent path (`agent_loop.rs:450-490`) nor the `mcp.call` RPC
  (`lib.rs:3457-3469`). The model in `mcp.rs:158-268` is unused. Tool calls time out at a fixed 5 s
  (`mcp_transport.rs:57`).
- Every enabled skill's full body is concatenated **ahead of** every stage's role prompt
  (`crates/warsha-pipeline/src/lib.rs:463-489`): imported skill text gets system-prompt authority over all twelve
  roles, unscoped and unbudgeted. (The earlier audit said skill bodies never reach the model. That is true only of
  `agent.turn`, which sends name and description — `agent_loop.rs:945-947`.)
- Remote channel: `verify_signature` returns `true` (`crates/warsha-remote/src/lib.rs:113-116`, no callers);
  `process_handshake` returns `Ok(false)` (`:656-659`); `RelayClient::connect` returns `Ok(())` (`:715-719`). The
  end-to-end encrypted channel is types and a `snow` builder. *(client half verified; relay not audited)*

**A5 — Structure that will not survive the next phase.** *(verified)*
- `crates/warshad/src/lib.rs` is 8,904 lines: the RPC trait, all 88 handlers, bootstrap, the lock and the tests
  (from `:6782`). Every daemon packet collides in it.
- Two SQLite stacks open the same `warsha.db`: an `sqlx` pool (`crates/warsha-store/src/lib.rs:211-215`) and a
  `rusqlite` connection (`crates/warsha-store/src/persistence.rs:367-369`; opened at `warshad/src/lib.rs:6842-6848`).
  WAL and `busy_timeout` are set on one of them. This is also why S1c has to move two libraries in lock-step.
- State is split across SQLite rows, settings documents and in-memory stores that vanish on restart: crash reports,
  store reviews, preferences, pairings (`warshad/src/lib.rs:1040-1099`). The routine scheduler is built with
  `MockRoutineRunner` in the production start path (`lib.rs:5479-5480`).
- Artifacts are written to disk and the run row updated in separate, non-atomic steps
  (`crates/warsha-pipeline/src/lib.rs:558-561`).

### 2.2 Top five product / UX flaws

**U1 — Simple mode is not crippled; it is inert.** *(verified on `dev`)*
- A run started from Simple mode stays at `idea`: `runs.start` creates it and returns
  (`crates/warshad/src/lib.rs:2424-2436`), and only Advanced calls `runs.advance`
  (`apps/desktop/src/screens/AdvancedMode.tsx:927`).
- The chat answer is a fixture on a one-second timer (`apps/desktop/src/screens/SimpleMode.tsx:754-766`).
- Against the bar set by Grok or OpenBot — type something, something real happens — Simple mode fails at the first
  message. The v3 Home (one composer, one yellow button, ≤ 10 actions) is the right answer and is not built.

**U2 — Gates are the core interaction and the weakest one.**
- "Request changes" and "Reject" end the run (A2). A human-in-the-loop product has no loop.
- All four gates show as pending from the start; the bell counts them (`apps/desktop/src/App.tsx:920`), and they can
  be approved out of order.
- Gate C asks «هل ندمج التغييرات؟» with nothing to look at: no diff, no test result, no preview exists to show.
- An approval records who and when, not **what** — it is not bound to the artifact version it approved.
- The cost cap is a post-hoc pause with no resume and no estimate before a stage starts.
- The v3 `DecisionCard` (question, plain rationale, consequences) is the right shape. Shipped on today's daemon, its
  «اطلب تعديلًا» button would be a control that kills the run — a direct breach of v3 principle 2.

**U3 — Two modes are specified as one app and built as two.**
- v2 keeps separate screens and data paths for Simple and Advanced; the live switch between them is where Chromium's
  target dies in about 46 % of full-suite runs (`2026-11-09-ui-v3/state.json:116`). That was classed as a load flake
  and answered with a warm-up (packet F3). A coin-flip crash at one specific user action deserves a product root
  cause; v3 should carry a mode-switch soak test rather than inherit a warm-up.
- Advanced does not yet approach Cursor or ZadLoop: files are read-only, the terminal is a transcript, per-hunk
  keep/revert is specified but absent, and 30 of 88 daemon methods have no screen (12 have no client at all —
  `mcp.*`, `process.*`, `pairing.*`; 18 have a client wrapper and no caller, among them `agent.turn`, `preview.*`,
  `runmode.*`, `preferences.*`).

**U4 — Arabic-first is rule-compliant, not yet typographically authentic.**
- No font ships (OD-U2 = C; `packages/ui/src/v3/tokens/type.ts` on `128b59c`). A Windows owner sees Segoe UI; the
  847 committed baselines were captured on a Linux host with IBM Plex installed (`PROGRESS.md:6354-6356`). The
  visual gate verifies a rendering the owner never sees. `DESIGN_SYSTEM_V3.md` §2.2 still says the fonts are
  vendored.
- Both `index.html` files (desktop and remote, on `dev` and on `128b59c`) still request Noto Sans Arabic and Inter
  from Google Fonts (`apps/desktop/index.html:7-9`, `apps/remote/index.html:12-14`). The desktop CSP blocks that
  request (`style-src 'self'`, `tauri.conf.json:31`), so it is dead weight there; the remote PWA has no CSP, so the
  owner's phone contacts Google on every load of a local-first product.
- **Owner decision 2026-11-10: bundle the fonts (OD-U2 = A).** Packet FNT, §5.5.
- The type scale breaks its own rule. "Arabic body line-height is never below 1.6" holds only for `text-md`
  (16/26). Advanced density defaults to `text-sm` 14/22 = 1.57; titles sit at 1.33–1.45 — tight for vocalised
  Arabic (the system's own name, «حِرفة», carries a kasra). Sizes are fixed `px`, so OS text scaling is ignored.
- Direction is stamped, not inherited: 821 `dir=` attributes across 45 desktop files. That is mirroring by
  attribute, and it leaves no clean place for `dir="auto"` on user-typed text.
- The agents are told to write English (A1), and four error-boundary strings are bilingual in both catalogs.
- To keep: 1101/1101 key parity, zero interpolation mismatches, zero physical-direction CSS, zero hard-coded
  strings, the five-stage plain-language map, Western digits as a deliberate choice.

**U5 — The interface inventories capability instead of guiding an outcome, and shows fiction where the engine is
missing.**
- v2 Simple puts about 40 controls on the first screen; of 137 traced controls, 15 were dead state, 8 no-ops and 10
  fake (`UI_V3_PLAN.md` §1).
- Settings lists surfaces whose backing is not real: routines run a test double, crash reports and store reviews are
  in-memory, five plugin packs read "enabled" while nothing is running (they connect only on toggle, and failures
  are swallowed).
- v3's capability rule fixes this only if capabilities are honest. `health` returns a constant `"healthy"`
  (`crates/warshad/src/lib.rs:2371-2378`); capabilities must come from probes.

### 2.3 What is good and must be kept

- The RPC authorisation table: 88 methods, each with a policy and a rate tier (`crates/warshad/src/auth.rs:244-723`).
- The single-instance lock: advisory, never deleted, pid mirrored for diagnostics (`warshad/src/lib.rs:5953-6065`);
  SIGTERM handling and a child sweep on every exit path (`:5800-5835`, `:717-745`).
- Provider errors scrubbed before logging; `verified_actor` under every gate decision; the keychain seam; the path
  screen in `FilesystemToolExecutor::resolve` (`agent_tools.rs:257-274`); read-before-write on by default.
- i18n and RTL discipline; contrast-tested tokens; wire-contract and architecture checks.
- The evidence-first policy — and the v3 principles, which are the right product constitution.

---

## 3. Truth vs claims matrix

Status key: **REAL** works end to end · **PARTIAL** works on one path · **TYPES** data model and unit tests only ·
**STUB** returns a constant or a mock · **ABSENT**.

| # | Claim (source) | What executes today | Evidence | Status |
|---|---|---|---|---|
| 1 | Pipeline "writes code … tests pass … produces a runnable web app" (`PLAN.md:674`, the one checked DoD line) | One text artifact per stage. The test harness itself splits `--- FILE:` blocks and writes the files; the "screenshot" comes from a function that takes only a width and a height — it is drawn, not captured. | `warsha-pipeline/src/lib.rs:401-561`; `warshad/tests/e2e_real_arabic_request.rs:1231-1270`, `963-968`, `1472-1473` | **STUB** (product) |
| 2 | M7 "Coding backends + GitHub ✅" | Backends detected; never invoked; `execute` runs `--version`. `projects.create` always stores `repo_path: None`. | `warshad/src/lib.rs:1030`, `6902`, `2404`; `warsha-backends/src/lib.rs:186-193` | **STUB** |
| 3 | M10 "Discovery interview … until the idea is locked ✅" | Required questions auto-answered with defaults. | `warsha-pipeline/src/lib.rs:292-309` | **STUB** |
| 4 | M11 "Skills pinned by commit and licence-checked" · DoD "recorded in `factory/skills.lock`" | No lock file is written. All enabled bodies are injected into every stage; `agent.turn` gets name + description. Frontmatter parser marked "simplified". | `lib.rs:463-489`; `agent_loop.rs:945-947`; `skills.rs:276` | **PARTIAL** |
| 5 | M12 "MCP … approval per tool on first use, scoped permissions and revocation ✅" | stdio only; HTTP/WebSocket recorded, not connected; permission model unused on both call paths. | `mcp_transport.rs:164-166`, `755-766`; `agent_loop.rs:450-490`; `warshad/src/lib.rs:3457-3469` | **PARTIAL** (transport) / **TYPES** (approval) |
| 6 | M12 "Scout: search MCP Registry … install only on approval ✅" | Four "In real implementation" stubs returning mock proposals. | `scout.rs:194`, `220`, `255`, `276` | **STUB** |
| 7 | M13 "Simple mode: chat with the selected bot or Orchestrator ✅" | Canned reply; a Simple run never advances. The mode toggle itself works. | `SimpleMode.tsx:754-766`, `692`; `AdvancedMode.tsx:927` | **STUB** (chat) / **REAL** (toggle) |
| 8 | M13 "cards for approvals (Approve/Reject at each gate) ✅" | Simple mode calls `gates.*`; the Gates inbox screen starts from `placeholderGates()`. Reject and change requests end the run. | `SimpleMode.tsx:780-793`; `GatesInbox.tsx:100`, `218`; `lib.rs:1103`, `1159` | **PARTIAL** |
| 9 | M14a "Worktree isolation · snapshot restore · per-hunk keep/revert ✅" | A policy flag, an in-memory snapshot store, a spec. PLAN's own sub-lines say "not implemented yet" under the checked boxes. | `PLAN.md:174-180` | **TYPES** |
| 10 | M14b "Eco mode · local fallback ✅" | Types and a toggle component; no daemon method (v3 renders nothing for it). | `PLAN.md:191-196`; `UI_V3_PLAN.md` §6 | **TYPES** |
| 11 | M16 "Routines … manageable in Simple mode ✅" | Scheduler built with `MockRoutineRunner` in the production start path. | `warshad/src/lib.rs:5479-5480` | **STUB** |
| 12 | M17 "Post-launch care: crash reports, store reviews ✅" | In-memory stores, no collector. | `warshad/src/lib.rs:1043-1046` | **STUB** |
| 13 | M18 "Plan → Agent mode, todos, mentions, slash commands, compaction ✅" | The mechanisms exist around a loop no model drives; compaction governs text never sent. | `agent_loop.rs:353-388`, `912-949` | **PARTIAL** |
| 14 | M19 "Backend kit via MCP ✅" | Definition and export; tool names mirrored into the kit; nothing dials a backend. | `agent_loop.rs:533-562` | **TYPES** |
| 15 | M6 / DoD "remote traffic is E2E encrypted" | Handshake and relay client are stubs; signature check returns `true`. Pairing tokens and constant-time comparison are real. | `warsha-remote/src/lib.rs:113-116`, `656-659`, `715-719` | **STUB** (channel) |
| 16 | H-05 "process allow-list bounds every spawn" | True for `process.spawn`, `mcp.connect`, `preview.start`. Bypassed by `plugins.toggle` / `configure` and by `RunCommand`. | `warshad/src/lib.rs:3402-3408` vs `4234-4239`, `4275-4280`; `agent_tools.rs:378` | **PARTIAL** |
| 17 | "Never mocks in production" (`PROGRAM_PLAN.md` §2.6) | `FakeProvider` fallback, `MockRoutineRunner`, scout mocks, 12 "In real implementation" comments in five non-test files. | extraction T1 | **not yet true** |
| 18 | "UI v3 … IN PROGRESS" (`PLAN.md:604`) | `dev` has no v3 code (40/40 desktop files import v2). On `128b59c`: 61 primitive files, tokens, app infrastructure, eight 12-line placeholder pages. U1/E0 implementing; U3–U7 and GC.1–GC.17 not run. | `git ls-tree 128b59c`; `state.json` packet statuses | **REAL** (foundation) / **ABSENT** (pages) |
| 19 | Daemon lifecycle: lock, signals, child reaping | Works as described; no run recovery on restart. | `warshad/src/lib.rs:5800-5835`, `5953-6065` | **REAL** (process) / **ABSENT** (runs) |
| 20 | RPC auth, rate limits, gate actor verification | 88/88 methods policed; decisions require a verified device. | `auth.rs:244-723`; `lib.rs:210`, `1025` | **REAL** |

**Reading the matrix.** The "✅ DONE (validated …)" headers on M10–M19 were all stamped on 2026-10-29 — M10 to M14
at the same second — and mean "types and unit tests exist". The unchecked Definition-of-Done lines at `PLAN.md:657-673` are
the honest status. Planning on the headers is how a UI was built over capabilities that were not there.

---

## 4. Technical-debt and safety register

| Category | Finding | Where | Severity |
|---|---|---|---|
| **Gate integrity** | Gates approvable before the run reaches them; decision not bound to artifact version | `warsha-pipeline/src/lib.rs:1019-1181` | P0 |
| **Run integrity** | Unserialised whole-row updates; cancel overwritten; stage pointer can regress; no restart recovery; Paused is terminal | `warsha-store/src/lib.rs:356-372`; `warsha-pipeline/src/lib.rs:344-398`, `740-813` | P0 |
| **Truthfulness** | Silent `FakeProvider` for unrouted roles; `MockRoutineRunner` in production; scout mocks; constant `health` | `lib.rs:640-667`; `warshad/src/lib.rs:5479-5480`, `2371-2378`; `scout.rs:194-276` | P0 |
| **Command execution** | `RunCommand`: no allow-list, inherited env, no timeout, no output cap, no kill, blocking inside an async lock | `agent_tools.rs:370-404`; `warshad/src/lib.rs:3288-3291` | P0 |
| **Allow-list bypass** | `plugins.install` → `plugins.toggle` spawns a manifest's command without `check_command` | `warshad/src/lib.rs:4178-4285` | P0 |
| **Credential leakage** | MCP and `RunCommand` children inherit the daemon environment; child `stderr` inherited into daemon logs; follow-up prompt and reply stored verbatim in the event payload (confirm it passes redaction) | `process_spawn.rs:332-343`; `mcp_transport.rs:778`; `warsha-pipeline/src/lib.rs:872-876` | P0 / P1 |
| **Supply chain** | 6 × bare `npx <pkg>`, 1 × `uvx strix-mcp`; no version, no hash; 5 seeded enabled. Without `--yes`, `npx` will likely stall on its install prompt against a piped stdin and surface as a 5 s handshake timeout (inference, not tested) | `warsha-core/src/plugin.rs:64-66`, `91-295` | P0 |
| **Missing authorisation** | No MCP permission check on `agent` path or `mcp.call` | `agent_loop.rs:450-490`; `warshad/src/lib.rs:3457-3469` | P0 |
| **Prompt-injection surface** | All skill bodies prepended to every role prompt, unscoped and unbudgeted | `warsha-pipeline/src/lib.rs:463-489` | P1 |
| **Crypto stubs** | `verify_signature → true`; handshake and relay client no-ops (no callers today) | `warsha-remote/src/lib.rs:113-116`, `656-659`, `715-719` | P0 (delete or implement) |
| **Panic risk** | 3 non-test `unwrap()`: `budget_cents.unwrap()` used as a divisor (also divides by zero on a 0 budget); 2 × `serde_json::to_string(..).unwrap()` on static data. 0 `expect`, 0 `todo!`, 0 `unimplemented!` | `warsha-cli/src/lib.rs:695`; `warsha-pipeline/src/settings.rs:131`, `316` | P1 |
| **Production stubs** | 12 "In real implementation": backends `:188`; remote `:114`, `:186`, `:657`, `:716`; cli `:530`, `:555`; scout × 4; skills `:276`. CLI `--follow` prints "WebSocket not implemented" (`warsha-cli/src/lib.rs:1038`) | extraction T1 | P0–P1 |
| **UI stubs (v2)** | 7 × `TODO(M20 wiring)`; `placeholderGates()`; Simple chat fixture | `RunView.tsx:227-237`; `AdvancedMode.tsx:1766-1775`; `GatesInbox.tsx:100`; `SimpleMode.tsx:754` | removed by U7 |
| **Dead surface** | 30 of 88 RPC methods unreachable from any screen; 12 with no client | extraction T2 | P1 (v3 wires or removes) |
| **TypeScript** | 0 `any`, 0 `@ts-ignore` / `@ts-expect-error` | extraction T1 | clean |
| **Structure** | 8,904-line `warshad/src/lib.rs`; two same-named `McpServerConfig`; two SQLite stacks on one file; in-memory stores | §2.1 A5 | P1 |
| **Test debt** | Mode-switch target death p ≈ 0.46 under full-suite load; 4 `providers` baselines at 390×844 red on a v2 product defect; 0 tests in `apps/mobile`; no v3 e2e yet; the 10 `#[ignore]` are child-process helpers (legitimate) | `state.json:116`, `:645` | P1 |
| **Evidence debt** | `acceptance.json` (2026-11-08 run) carries verdict `pass` on G3.9 and G5.11 whose notes say "NOT RUN"; F1.4 and F2.5 are `pass` with `exit_code 1`; `PARK.md` says seq 56 while state is at 60 | extraction T5 | P1 |

---

## 5. Overhauled plan of record (v2)

### 5.1 What changes against `PROGRAM_PLAN.md`

| Topic | Program plan (2026-11-09) | Plan of record v2 | Why |
|---|---|---|---|
| Order of runs | R0 UI → R1 deps → R2 extensions → R3 self-hosting → R4 final | R0 UI **∥ KEEL (P0)** → **ENGINE (P1)** → extensions (P2) → final | Extensions extend an agent that does not exist yet; the engine is the product. |
| Security core | X1/X2 inside R2; `RunCommand` policy (SH2) inside R3 | Pulled into **KEEL**, now | They are cheap, and the engine must never run without them. |
| Integrity | not planned | **K1** gate integrity, **K2** run-state integrity | Found in this review. |
| Truth | FIN2 at the very end | **K8** now | Later planning must not rest on false "DONE" labels. |
| Skills (X6) | "inject the body" | **scope** the bodies | Bodies already reach every stage, unscoped — the defect is the opposite one. |
| WebMCP, Warsha-as-MCP-server, backend kit via MCP (X8–X11) | pre-1.0, R2 | P2; X10/X11 after 1.0 | Breadth before the core loop works. |
| Versions | 0.3.0 · 0.3.1 · 0.4.0 EXT · 0.5.0 SH · 1.0.0-rc | 0.3.0 UI v3 · **0.3.1 KEEL + deps** · **0.4.0 ENGINE** · 0.5.0 extensions · 1.0.0-rc | Follows the new order. |

R0 continues unchanged under its own frozen gates, with the three amendments in §5.5. KEEL touches `crates/` only
and branches from the integration tip `128b59c` (R1 hygiene already changed 391 lines of `warshad/src/lib.rs`
there), so it can run beside Wave B/C, which touch `apps/` and `packages/`.

### 5.2 P0 — KEEL: blockers, fix immediately (target 0.3.1)

Standing gates of `PROGRAM_PLAN.md` §4 apply to every packet. Sizes follow that plan (S = 1–2 files, M = 3–5).
**Merge order is serial for packets touching `crates/warshad/src/lib.rs`:** K1 → K2 → K3 → K4 → K5 → K6.

| Id | Does | Exact file targets | Acceptance (machine-checkable) | Maps to |
|---|---|---|---|---|
| **K1** gate integrity | A gate decision requires `run.status == Running` and `run.current_stage == stage`; the decision event records a hash of the artifacts being approved | `crates/warsha-pipeline/src/lib.rs:1019-1181` | Approving Gate D on a run at `idea` is refused; approving the current gate succeeds once; the event carries `artifacts_sha256` | new |
| **K2** run-state integrity | Per-run async mutex in the engine; `version` column with compare-and-swap updates; cancel re-checked after every await and never overwritten; `runs.resume`; a change request re-opens the gate and re-runs the producing stage with the notes; runs found `Running` at start-up are marked interrupted and resumable | `crates/warsha-store/src/lib.rs:356-372` + a new migration; `crates/warsha-pipeline/src/lib.rs:344-398`, `740-813`, `1072-1181`; `crates/warshad/src/lib.rs:3756-3840` | Two concurrent advances execute each stage exactly once (provider call counter); cancel during a stage leaves `Cancelled` and no later artifact; change request → notes appear in the re-run prompt → gate `Pending` again; a budget-paused run resumes after `budget.set` | new |
| **K3** no silent fakes | Unrouted role → typed error, run blocked, with an event the UI turns into "add a provider". `FakeProvider` only when explicitly routed or under `cfg(test)`. Env-key path behind an explicit dev flag. Real routine runner, or routines reported unavailable. `health` reports probed capabilities. Scout returns "catalog unavailable" | `crates/warsha-pipeline/src/lib.rs:640-667`; `crates/warshad/src/lib.rs:2371-2378`, `5479-5480`; `crates/warsha-pipeline/src/scout.rs:194-276` | Fresh daemon, no provider: `runs.advance` returns the typed error and writes zero artifacts; grep gate `git grep -nE "In real implementation\|mock proposals\|MockRoutineRunner::new" -- crates ":!**/tests/**"` prints nothing outside `cfg(test)` | X5 (reduced), FIN1 (part) |
| **K4** command policy | `RunCommand` through `ProcessPolicy::check_command`; shells refused unless allow-listed; `env_clear()` plus a minimal fixed environment; `tokio::process` with `kill_on_drop`, 120 s default timeout, 1 MiB output cap; agent lock not held across execution | `crates/warsha-pipeline/src/agent_tools.rs:174-177`, `370-404`; `crates/warsha-pipeline/src/agent_loop.rs:599-616`; `crates/warshad/src/lib.rs:3281-3292`, `4859-4878` | Refused / allowed / shell-refused tests; a child that prints its environment shows none of the daemon's variables; a sleeping child is killed at the timeout and no process remains; a second `agent.state` call answers while a command runs | SH2 / P7 |
| **K5** spawn hardening | One `McpServerConfig` (delete the duplicate), with `env`; `env_clear()` in `command_for`; manifest-named secrets resolved from the keychain at spawn; `stderr` captured and redacted; **`plugins.install` / `toggle` / `configure` go through `check_command`**; connect errors returned, not dropped; bundled packs pinned `pkg@x.y.z` and seeded **disabled**; unpinned manifests refused; MCP timeout configurable per server | `crates/warsha-core/src/plugin.rs:64-66`, `91-297`; `crates/warsha-pipeline/src/mcp.rs:45-60`; `crates/warsha-pipeline/src/mcp_transport.rs:57`, `116-126`, `755-793`; `crates/warsha-pipeline/src/process_spawn.rs:332-343`; `crates/warshad/src/lib.rs:4178-4285` | A loopback stdio server echoing its environment shows only manifest-named variables; a manifest whose command is off the allow-list is refused at install and at toggle; an unpinned manifest is refused; a failed connect surfaces as an RPC error; redaction test on captured `stderr` | X2 |
| **K6** MCP permission at the call site | `server::tool::role` → allow / ask / deny, persisted; enforced on the agent path **and** on the `mcp.call` RPC; default ask | `crates/warsha-pipeline/src/agent_loop.rs:439-490`; `crates/warsha-pipeline/src/mcp.rs:158-268`; `crates/warshad/src/lib.rs:3457-3469`; `crates/warsha-store` migration | A denied or un-approved tool reaches the transport zero times (mock manager counter); allowed is called once; revocation applies on the next call | X1 |
| **K7** crypto truth | Delete `verify_signature` and the no-op handshake / relay client, or implement them. Deleting is the default: nothing calls them and the hosted relay is owner-only | `crates/warsha-remote/src/lib.rs:113-116`, `588-752` | No function in non-test code returns a constant for a verification; `cargo test -p warsha-remote -p warsha-relay` green | new |
| **K8** status truth | Re-label M10–M19 in `PLAN.md` from the §3 matrix (REAL / PARTIAL / TYPES / STUB / ABSENT); the README "works today" list matches; fix the `acceptance.json` verdict/note mismatches by appending corrected records (evidence stays immutable) | `PLAN.md:145-320`; `README.md`; `README.ar.md`; `bridge-io/policy/2026-11-08-design-and-remediation/` (append only) | No "✅ DONE" header whose own sub-lines say "not implemented" / "not wired"; a script lists every `pass` verdict with `exit_code != 0` or a "NOT RUN" note and prints none | FIN2 (pulled forward) |
| **K9** panic and CLI hygiene | Remove the three non-test `unwrap()` (the budget percentage must also survive a zero budget); CLI `--follow` subscribes to the event socket or the flag is removed; the CLI reads its device id from config instead of minting one | `crates/warsha-cli/src/lib.rs:530`, `555`, `695`, `1038`; `crates/warsha-pipeline/src/settings.rs:131`, `316` | A no-unwrap check over non-test Rust prints nothing; a zero-budget project prints a percentage line without panicking; `--follow` shows a mock run's events or is absent from `--help` | FIN1 (part) |

Dependency security (S1a–S1d, S2, S3 of the program plan) rides in the same release, unchanged.
**Checkpoint KEEL:** an independent security review of K4 + K5 + K6 with no open high finding · `cargo deny check`
exit 0 · full Rust suite green.

### 5.3 P1 — core capabilities (before 1.0.0)

**ENGINE (target 0.4.0)**

| Id | Does | Exact file targets | Acceptance | Maps to |
|---|---|---|---|---|
| **H1** daemon split | Mechanical, no behaviour change: `warshad/src/lib.rs` → `rpc/<area>.rs` (runs, gates, agent, mcp, plugins, providers, settings), `bootstrap.rs`, `lock.rs`; tests move with their area | `crates/warshad/src/lib.rs` → new modules | No file over 1,600 lines in `crates/warshad/src`; `check-wire-contract.mjs` and the Rust suite unchanged | FIN1 (pulled forward) — do first, it unblocks parallel work |
| **E1** run executor | Runs execute as background jobs with a cancellation token; `runs.advance` returns at once and progress flows on the event bus; streaming provider calls aborted on cancel; budget estimated before a stage and enforced during it; a real discovery interview through the `ask_user` queue; `{{language}}` taken from the project | `crates/warsha-pipeline/src/lib.rs:252-341`, `401-620`, `926-1010`; new `crates/warsha-pipeline/src/run_executor.rs`; `crates/warsha-providers/src/{lib,openai,anthropic}.rs` | `runs.advance` answers in < 200 ms with the mock provider held open; cancel aborts the in-flight call (mock observes the drop); an Arabic project's prompts carry `ar`; a run waits for discovery answers | new |
| **E2** real agent loop | Provider tool-calling (`ChatRequest.tools`, tool-call results); loop model → tool call → K6 permission → K4 execution → result → model, bounded by steps and budget; the transcript is sent and compacted to the model's real window using provider usage; one loop per run, metered to its project | `crates/warsha-pipeline/src/agent_loop.rs` (rewrite of `353-653`, `912-949`); `crates/warsha-providers/src/lib.rs` (request types); `crates/warshad/src/lib.rs:1062`, `1402-1403`, `4859-4878` | Mock provider scripts a three-step tool sequence and the loop runs it; turn two's prompt contains turn one; two runs keep separate transcripts; a step cap stops a looping model | SH3 prerequisite |
| **E3** workspace | `projects.attach` (a clean git repository) or a fresh repository per project; every run works in its own `git worktree` and branch under the data directory; the Code stage writes files through tools; git-backed snapshots | `crates/warshad/src/lib.rs:2389-2404`; `crates/warsha-git/src/lib.rs`; `crates/warsha-pipeline/src/work_protection.rs`; `crates/warsha-pipeline/src/agent_tools.rs:202-230` | Attaching a dirty or non-git path is refused; a run's writes land only in its worktree; removing the run removes the worktree; restore returns a file to its snapshot | SH1 |
| **E4** coding-CLI backend | Claude Code, then Codex, headless as the coder role inside the run worktree, on their own login, with budget and timeout; the stub at `:186-193` replaced; `state.backends` routed | `crates/warsha-backends/src/lib.rs:166-200`; `crates/warshad/src/lib.rs:1030`, `6902`; `crates/warsha-pipeline/src/lib.rs` (Code stage) | A fake CLI on `PATH` receives the brief and its output becomes the Code stage result; Warsha reads no token file | SH3 |
| **E5** Gate C that shows something | Gate C carries a diff against the base, the test command's result, and a preview handle; approval produces a local branch; a draft PR only after approval | `crates/warsha-pipeline/src/lib.rs` (review stage, gate payload); `crates/warsha-git/src/lib.rs`; `crates/warshad/src/lib.rs` (`gates.list` payload) | `gates.list` at Gate C returns a non-empty diff and a test verdict; rejecting leaves no branch | SH4 |
| **E6** skills, scoped | Per-role packs decide which bodies a stage gets; a token cap per stage; the body is sent to `agent.turn` only when the skill is invoked; `factory/skills.lock` with source, pin and hash; skill text enters as delimited reference material after the role prompt, not ahead of it | `crates/warsha-pipeline/src/lib.rs:463-489`; `crates/warsha-pipeline/src/agent_loop.rs:945-947`; `crates/warsha-pipeline/src/skills.rs:272-289`; new `crates/warsha-core/src/lockfile.rs` | A stage prompt contains only its role pack's skills, under the cap, after the role prompt; `/skill` puts the body in that turn; the lock round-trips | X0 + X6 (redefined) |
| **E7** one store | One SQLite stack for runs and settings; pragmas set once; artifact write and row update in one transaction-shaped step; in-memory stores persisted or removed with their screens | `crates/warsha-store/src/lib.rs:194-232`; `crates/warsha-store/src/persistence.rs:360-380`; `crates/warshad/src/lib.rs:1040-1099`, `6842-6848` | One SQLite library in `cargo tree`; kill −9 between artifact write and row update leaves a consistent run | S1c (simplified) |
| **E8** pilot | One small fenced packet given to Warsha and to the orchestrator under the same frozen gates | evidence only | Comparison recorded; widening is the owner's call | SH5 |

**UI v3 (R0 as planned — Waves B, C, D — with the amendments in §5.5).** v3 pages bind to engine capabilities as
they land: the Project page's diff, tests and preview cards render only when E5 and `preview.*` report available.

**Tests**

| Id | Does | Targets | Acceptance |
|---|---|---|---|
| **T1** mode-switch root cause | Find why Chromium's target dies at the live Simple → Advanced switch; fix in product, or record why v2 is left as is until U7. v3 gets a soak test: 50 consecutive mode switches | `apps/desktop/e2e/flows.spec.ts`; `apps/desktop/src/screens/AdvancedMode.tsx`; new `apps/desktop/e2e/v3/mode-soak.spec.ts` | 20 consecutive full-suite runs with zero "target closed" and no retries; soak green |
| **T2** baselines the owner sees | After FNT (§5.5) bundles the fonts: one Windows capture job for a small v3 smoke set, so the Linux capture host and the owner's machine are proven to render the same glyphs | `playwright.config.ts`; `.github/workflows/` (a Windows job) | Linux and Windows smoke baselines agree within threshold with only the bundled font |
| **T3** mobile floor | A smoke test for the Android shell | `apps/mobile/` | One launch-and-pair test in CI |

### 5.4 P2 — refinement and polish (0.5.0 → 1.0.0-rc)

| Id | Does | Targets | Maps to |
|---|---|---|---|
| **X3** | Streamable HTTP MCP transport (https, or http on loopback only), bearer token from the keychain | `crates/warsha-pipeline/src/mcp_transport.rs` | X3 |
| **X1b / X4** | Approval inbox items for "ask" calls; Connections page: status, test, tools, per-tool permission, revoke, last error | `crates/warshad/src/rpc/mcp.rs` (after H1); `apps/desktop/src/v3/pages/settings/` | X1b, X4 |
| **X5** | Registry client behind a trait with recorded fixtures (K3 leaves an honest "unavailable" until then) | `crates/warsha-pipeline/src/scout.rs`; new `registry_client.rs` | X5 |
| **X7** | Plugins as pinned bundles: install → configure → test → toggle → remove leaves nothing behind | `crates/warshad/src/rpc/plugins.rs`; `crates/warshad/src/wave2.rs` | X7 |
| **X9** | WebMCP in Warsha's own UI behind a setting, off by default, tools generated from the actions registry for a safe list | `apps/desktop/src/v3/webmcp/`; `apps/remote/src/webmcp/` | X9 |
| **X8** | `warsha mcp serve` (read tools and "start run"; never gate decisions) | `crates/warsha-cli/src/mcp_serve.rs` | X8 |
| **D1** | Micro-interactions on the v3 motion tokens (press, sheet, stepper advance), all zeroed under `prefers-reduced-motion` | `packages/ui/src/v3/tokens/motion.ts`; composites | new |
| **D2** | Sound cues for exactly two events — a decision is waiting, a run finished — off by default, one setting, never the only signal | `apps/desktop/src/v3/app/`; Settings › عام; i18n ar/en | new |
| **D3** | Type scale repair: Arabic line-height ≥ 1.6 at `text-sm`; titles checked with vocalised two-line samples; `rem` sizes; direction inherited from `<html dir>` with `dir="auto"` on user text | `packages/ui/src/v3/tokens/type.ts`; `docs/designs/DESIGN_SYSTEM_V3.md` §2.2 | new |
| **RC1** | Remote channel: implement the Noise handshake for real, or state in `SECURITY.md` that remote is LAN / TLS only | `crates/warsha-remote/src/lib.rs`; `SECURITY.md` | M6 remainder |
| **FIN** | FIN1 dead code, FIN3 branch and worktree hygiene, FIN4 verification matrix, FIN5 draft installers, owner-PC install, final report. Draft only — nothing tagged or published | as `PROGRAM_PLAN.md` §4 R4 | R4 |

**After 1.0 (recorded, not scheduled):** X10 WebMCP template for generated apps; X11 backend kit through MCP; eco
mode; post-launch collector; hosted relay.

### 5.5 Amendments to the running UI v3 run (R0)

These change no frozen gate. Each is a note for the planner role of that run to adopt at its next planning point.

1. **Do not ship a control that ends a run.** `project.gate.changes.send`, `project.gate.reject.confirm` and their
   inbox and bench twins must not reach a release before K2 lands. Wave C may build them; C-final for 0.3.0 either
   includes K1 + K2 or the run records the dependency and hides those controls by capability.
2. **Count only the decision that is actually waiting.** Inbox and badge count the gate at the run's
   `current_stage`, not every `Pending` gate (`apps/desktop/src/App.tsx:920` is the v2 form of the bug).
3. **No engine fiction in Wave C.** «ما أُنجز» (preview, code link, tests summary) and the Workbench tabs الملفات،
   التغييرات، المعاينة render from capabilities. Until E3–E5 they show an EmptyState, never a fixture.
4. **Packet FNT — bundle the v3 fonts (owner decision 2026-11-10, OD-U2 = A), before RU3.** Size S. Two exactly
   pinned packages, `@fontsource/ibm-plex-sans-arabic` (400, 500, 600, 700) and `@fontsource/ibm-plex-mono`
   (400, 500), in `packages/ui/package.json` + `pnpm-lock.yaml`; one `packages/ui/src/v3/fonts.css` exported as
   `@warsha/ui/v3/fonts.css`; imported only on the v3 path until U7 (the v2 stack also names IBM Plex first, so a
   global import would change v2 pixels); the Google Fonts links removed from both `index.html` files; an OFL-1.1
   row per family in `THIRD_PARTY_NOTICES.md`; `DESIGN_SYSTEM_V3.md` §2.2 and the `type.ts` header corrected.
   Acceptance: with every non-loopback request aborted, the v3 gallery reports IBM Plex Sans Arabic loaded from a
   bundled URL; `git grep -n "fonts.googleapis\|fonts.gstatic" -- apps packages` prints nothing; the desktop build
   output contains the `woff2` files; the v2 fence stays at pw-gate `outside=0`. No v3 baseline exists yet, so
   nothing is refreshed.

For amendment 1 the mechanism is the existing capability rule: the registry entries for `*.gate.changes.*` and
`*.gate.reject.*` declare `capability: 'runs.resume'`, so they appear the day the daemon serves that method (K2b).

### 5.6 Sequence

```
now ──► R0 UI v3: RH1 → C2 → FNT → Wave C → C3 → U7 → C-final (0.3.0)    apps/ + packages/
   └──► KEEL: K1 → K2 → K3 → K4 → K5 → K6 · K7 · K8 · K9 (+ S1–S3) (0.3.1)  crates/ from 128b59c
              │  K1 + K2 must be merged before any release that ships the gate controls
              ▼
        ENGINE: H1 → E1 → E2 ─┬─ E3 → E4 → E5 → E8                (0.4.0)
                              └─ E6 · E7 · T1 · T2 · T3
              ▼
        P2: X3 · X1b/X4 · X5 · X7 · X8 · X9 · D1–D3 · RC1         (0.5.0)
              ▼
        FIN1–FIN5 (1.0.0-rc, draft only)
```

### 5.7 Decisions applied (the owner may strike any line)

| Id | Decision | Default applied |
|---|---|---|
| OD-R1 | Add KEEL (K1–K8) to the security run and release it as 0.3.1 | **yes** — integrity and safety |
| OD-R2 | Build ENGINE before the extension breadth (swap of R2 and R3) | **yes** — planner default |
| OD-R3 | Seed bundled plugin packs disabled | **yes** — they are not running at boot today, so nothing is lost |
| OD-R4 | Move X10 and X11 after 1.0; keep X8 and X9 in P2 | **yes** |
| OD-R5 | Bundle IBM Plex (OD-U2: C → A) before the RU3–RU6 genesis baselines are captured | **yes — decided by the owner, 2026-11-10** ("Yes, bundle it"); packet FNT, §5.5 |
| OD-R6 | K7: delete the unused crypto stubs rather than implement them now | **delete** |

---

## 6. Evidence appendix

**Extraction totals (Haiku, on `dev` = `ba90e71`)**

- Rust, non-test code: 3 `unwrap()`, 0 `expect`, 0 `todo!` / `unimplemented!` / `panic!`. 12 "In real
  implementation" comments. 7 `TODO(M20 wiring)` in v2 screens. TypeScript: 0 `any`, 0 `@ts-ignore`.
- RPC: 88 methods registered, 88 policy entries. 72 distinct names called by `packages/client`; 12 methods with no
  client (`process.*`, `mcp.*`, `pairing.*`); 18 with a wrapper and no screen.
- i18n: catalogs are inline in `packages/i18n/src/index.tsx` (no `ar.json` / `en.json`): 1101 keys each, 0 missing
  either way, 0 interpolation mismatches, 15 identical values (10 proper data, 4 bilingual error strings, 1
  language name). Physical-direction CSS: 0. Tailwind: not used. `dir=` attributes: 821 in 45 desktop files.
- Tests as claimed in run evidence: cargo 759 passed / 10 ignored / 0 failed at `7fec7a0`; Vitest ui 181, client
  149, crypto 22, i18n 52, remote 221, desktop 468, mobile 0 (branches claim ui 309 and desktop 584 with v3);
  Playwright 884 cases from 8 spec files, 847 baseline images. No `skip`, `fixme` or `only`.
- UI v3 run at seq 60: H1, R1, V1, U0, U2, F1, F2 merged; F3 in review; F4, U1, E0 implementing; U3–U7, RU3–RU6
  and GC.1–GC.17 not run.

**Not verified (stated so nobody plans on it):** whether `parse_plugin_manifest` validates commands; the `npx`
prompt behaviour (inferred); `warsha-relay` internals; whether guardrails, evals or tracing are wired into any
path; how the remote PWA drives gates; CI workflow contents. The Haiku reports themselves are in the session
transcript, not in this directory.
