# Master prompt v2 — fix and finish Warsha after the principal review (paste this into Qoder)

You are the orchestrator for the Warsha repository at `C:\Users\Dragonfly\Downloads\Warsha` (branch `dev`). A
principal review on 2026-11-10 found that the product's engine does not yet build software and that several safety
and integrity defects must be fixed before it does. Your job is to carry out every fix and update that review
requires, in the order below, and to keep the UI v3 run going while you do. You orchestrate; you never hold the
planner, implementer, reviewer and verifier roles on the same packet.

This prompt **amends** `bridge-io/policy/2026-11-09-completion-program/MASTER_PROMPT.md`. Where the two differ, this
one wins. Everything that prompt says under "never" still holds.

## 0. Read first, in this order

1. `AGENTS.md`, `ENGINEERING_POLICY.md`, `SECURITY.md`, `docs/ARCH_RULES.md` — binding; the stricter rule wins.
2. `bridge-io/policy/2026-11-10-principal-review/REVIEW.md` — the findings (§2), the truth-vs-claims matrix (§3),
   the debt register (§4) and the plan of record v2 (§5). Every packet below cites it; the file and line evidence is
   there.
3. `bridge-io/policy/2026-11-09-ui-v3/state.json` (latest seq) and that run's `PACKETS.md` — the run in flight.
4. `bridge-io/policy/2026-11-09-completion-program/PROGRAM_PLAN.md` — standing gates (§4), verification matrix (§5),
   owner decisions OD-P1…OD-P7 (§6). Its run order is replaced by §2 below.
5. `PLAN.md` ("Amendment 2026-11-10"), `DECISIONS.md` (the two 2026-11-10 review entries), `PROGRESS.md`.

Resume strictly from `state.json` and the evidence on disk, never from chat memory. Line numbers in this prompt were
read on `dev` = `ba90e71`; re-locate by symbol if a file has moved.

## 1. What the review found (the reason for every packet)

- Each pipeline stage is one model call saved as a text artifact. No stage writes files, runs tests or produces a
  diff. The coding backends are detected and never invoked.
- "Request changes", "reject" and "budget exceeded" pause a run and nothing resumes it. Gates can be approved before
  the run reaches them. Run updates are unserialised whole-row writes, so two `runs.advance` calls corrupt a run and
  a cancel can be overwritten.
- `agent.turn` runs verbs the owner types, or makes one model call without the transcript; one instance serves the
  whole daemon.
- An unrouted role is answered by `FakeProvider` silently. The routine scheduler runs `MockRoutineRunner`. The scout
  returns mock proposals.
- `RunCommand` has no allow-list, timeout or kill and inherits the daemon environment. MCP children inherit it too
  and get none of their own secrets. `plugins.toggle` bypasses the process allow-list. No MCP call checks a
  permission. Bundled packs are unpinned.
- All enabled skill bodies are prepended to every stage prompt, unscoped.
- The v3 pages are placeholders; no font ships; both `index.html` files call Google Fonts.

## 2. The order of work

```
R0   UI v3 (in flight) + FNT + four amendments            → 0.3.0     apps/, packages/
KEEL K1–K9 + S1–S3, in parallel with R0                   → 0.3.1     crates/ (base: the UI v3 integration tip)
ENGINE  H1 → E1 → E2 → E3 → E4 → E5 → E8 (+ E6, E7, T1–T3) → 0.4.0
EXT  X3 · X1b/X4 · X5 · X7 · X8 · X9 · D1–D3 · RC1        → 0.5.0
FIN  FIN1–FIN5                                            → 1.0.0-rc (draft only)
```

R2 and R3 of the old program swap: the engine comes before extension breadth. X10 and X11 move after 1.0.

**No-stop rule (unchanged):** repair within the bounded loop; when a packet blocks, record it and move to every
packet that does not depend on it; salvage dead worker sessions; never ask the owner mid-run — decide, log in
`DECISIONS.md`, continue. Stop only at the Definition of Done (§8) or when every remaining item is owner-only.

## 3. R0 — keep running UI v3, with these changes

Do not disturb frozen gates. At the run's next planning point its planner role records the following and adds the
new packets the way F3 and F4 were added.

1. **FNT — bundle the fonts (owner decision 2026-11-10: OD-U2 = A). Land it before RU3.** Size S.
   - Set `owner_decisions.OD-U2 = "A"` in `state.json`, citing `DECISIONS.md` 2026-11-10.
   - Add `@fontsource/ibm-plex-sans-arabic` and `@fontsource/ibm-plex-mono`, exactly pinned, to
     `packages/ui/package.json`; update `pnpm-lock.yaml`.
   - New `packages/ui/src/v3/fonts.css` importing weights 400/500/600/700 (Sans Arabic) and 400/500 (Mono); export it
     as `@warsha/ui/v3/fonts.css` in `packages/ui/package.json`.
   - Import it **only on the v3 path** until U7. The v2 stack also names IBM Plex first
     (`packages/ui/src/tokens/tokens.css:189-191`), so a global import would change v2 pixels.
   - Delete the Google Fonts `<link>` lines in `apps/desktop/index.html:7-9` and `apps/remote/index.html:12-14`.
   - Add an OFL-1.1 row per family to `THIRD_PARTY_NOTICES.md`; correct `docs/designs/DESIGN_SYSTEM_V3.md` §2.2 and
     the header of `packages/ui/src/v3/tokens/type.ts`.
   - Gates: with every non-loopback request aborted, the v3 gallery reports IBM Plex Sans Arabic loaded from a
     bundled URL; `git grep -n "fonts.googleapis\|fonts.gstatic" -- apps packages` prints nothing (run it from a
     script file); the desktop build output contains the `woff2` files; the v2 fence stays at pw-gate `outside=0`;
     `pnpm audit --prod --audit-level high` exit 0.
2. **No control that ends a run.** The registry entries for `*.gate.changes.*` and `*.gate.reject.*` (areas
   `project`, `inbox`, `bench`) declare `capability: 'runs.resume'`. They stay hidden until the daemon serves that
   method (packet K2b).
3. **Count only the decision that is waiting.** Inbox, badge and Home banner count a gate only when it is `pending`
   **and** equals the run's `current_stage`.
4. **No fixtures for engine output.** «ما أُنجز» (preview, code link, tests) and the Workbench tabs الملفات،
   التغييرات، المعاينة render from capabilities; without them they show an EmptyState.
5. **T1 — mode-switch soak**, added after U3: `apps/desktop/e2e/v3/mode-soak.spec.ts` switches Simple ↔ Advanced 50
   times on one project and must pass 20 consecutive full-suite runs with no "target closed". F3's warm-up lands as
   already planned; it is not a substitute.

## 4. KEEL — run `2026-11-10-keel` (start now, in parallel with R0)

**Intake.** Evidence dir `bridge-io/policy/2026-11-10-keel/`. Base commit: the current tip of
`run/2026-11-09-ui-v3/integration` (it carries the R1 Rust hygiene; do not base on `dev`). Integration branch
`run/2026-11-10-keel/integration`. Scope: `crates/**`, plus `PLAN.md`, `README.md`, `README.ar.md`, `SECURITY.md` for
K8. Out of scope: `apps/**`, `packages/**` except wire types in `packages/client` that a packet names.

**Plan.** The run's planner role turns each row into a brief in `PACKETS.md` and freezes one gate command per
acceptance line, plus the standing gates of `PROGRAM_PLAN.md` §4. Packets that touch `crates/warshad/src/lib.rs`
merge **serially**: K1 → K2a → K2b → K2c → K3 → K4 → K5a → K5b → K6. K7, K8, K9 and S1–S3 run beside them.

| Id | Size | Does | Files | Acceptance (freeze as gate commands) |
|---|---|---|---|---|
| **K1** gate integrity | S | `approve_gate`, `reject_gate`, `request_changes` require `status == Running` and `current_stage == stage`. The decision event carries a SHA-256 over the run's artifacts at decision time. | `crates/warsha-pipeline/src/lib.rs` (the three functions at ~1019–1181) | Approving Gate D on a run at `idea` is refused; approving the current gate succeeds once; the event payload has `artifacts_sha256`. |
| **K2a** serialised run state | M | One async mutex per `RunId` around every mutation. A `version` column; `update_run` becomes compare-and-swap and a lost race is a typed error, never a silent overwrite. Cancel is re-read after every await in `advance_stage` / `execute_stage` and is never overwritten. | `crates/warsha-store/src/lib.rs` (`update_run` ~356–372) + a new migration; `crates/warsha-pipeline/src/lib.rs` (~344–398, 740–813); `crates/warshad/src/lib.rs` (`advance_run`, `cancel_run` ~3756–3840) | Two concurrent `runs.advance` calls make the mock provider see each stage exactly once; a cancel issued during a held provider call leaves `Cancelled` and no later artifact. |
| **K2b** resume and the change loop | M | New RPC `runs.resume` (policy Owner, tier Spend) with its wire type in `packages/client`. `gates.changes` re-runs the stage(s) that produced the gate's artifacts with the owner's notes in the prompt, then sets the gate back to `Pending`. `gates.reject` ends the run deliberately (terminal, labelled `gate_rejected`); the owner restarts with `runs.start`. A budget-paused run resumes after `budget.set` raises the cap. Record these semantics in `DECISIONS.md` and correct `docs/designs/UI_V3_PLAN.md` §4. | `crates/warsha-pipeline/src/lib.rs` (~581–617, 1072–1181); `crates/warshad/src/lib.rs` (trait + handler); `crates/warshad/src/auth.rs` (policy row); `packages/client/src/index.ts` | Change request → the next prompt contains the notes → gate `Pending` → approvable; budget pause → `budget.set` → `runs.resume` → the run continues; `check-wire-contract.mjs` covers `runs.resume`. |
| **K2c** restart recovery | S | On start-up, every run found `Running` is marked interrupted with an event; `runs.resume` re-executes the interrupted stage instead of skipping it. | `crates/warshad/src/lib.rs` (start-up path); `crates/warsha-pipeline/src/lib.rs` | A test that drops the daemon mid-stage and restarts finds the run interrupted, and resume produces that stage's artifact. |
| **K3** no silent fakes | M | `dispatch_chat`: an unrouted role is a typed error; the run is blocked with an event the UI can turn into "add a provider"; zero artifacts. `FakeProvider` answers only when explicitly routed or under `cfg(test)`. The `WARSHA_LLM_API_KEY` path needs an explicit developer flag. Replace `MockRoutineRunner` in the start path with a real runner, or report routines unavailable. `health` reports probed capabilities, not a constant. The scout returns "catalog unavailable" instead of mock proposals. | `crates/warsha-pipeline/src/lib.rs` (~640–667); `crates/warshad/src/lib.rs` (~2371–2378, ~5479–5480); `crates/warsha-pipeline/src/scout.rs` (~194–276) | Fresh daemon with no provider: `runs.advance` returns the typed error and writes nothing. Grep gate from a script file — `git grep -nE "In real implementation|mock proposals|MockRoutineRunner::new" -- crates ":!**/tests/**"` — prints nothing outside `cfg(test)`. Existing offline tests still pass by routing the mock explicitly. |
| **K4** command policy | M | `RunCommand` goes through `ProcessPolicy::check_command` on its first token; shells (`sh`, `bash`, `cmd`, `powershell`, `pwsh`) are refused unless allow-listed. `env_clear()` then a minimal fixed environment. `tokio::process` with `kill_on_drop(true)`, a 120 s default timeout and a 1 MiB output cap. `ToolExecutor::execute` becomes async, and the agent write-lock is not held while a tool runs. | `crates/warsha-pipeline/src/agent_tools.rs` (trait ~174–177, `run_command` ~370–404); `crates/warsha-pipeline/src/agent_loop.rs` (~599–616); `crates/warshad/src/lib.rs` (`agent_turn` ~3281–3292, `build_agent_loop` ~4859–4878) | Refused / allowed / shell-refused tests; a child printing its environment shows none of the daemon's variables; a sleeping child is killed at the timeout and no process remains; `agent.state` answers while a command is running. |
| **K5a** one config, clean spawn | M | Delete the duplicate `McpServerConfig`; the surviving type has `env`. `command_for` calls `env_clear()`. Manifest-named secrets are resolved from the keychain at spawn and passed only to that child. Child `stderr` is captured and redacted, not inherited. The MCP response timeout is per-server configuration (default 30 s). | `crates/warsha-pipeline/src/mcp.rs` (~45–60); `crates/warsha-pipeline/src/mcp_transport.rs` (~57, 116–126, 755–793); `crates/warsha-pipeline/src/process_spawn.rs` (~332–343) | A loopback stdio server that echoes its environment shows only the manifest-named variables; a redaction test over captured `stderr`; no secret value in any log or trace. |
| **K5b** plugins through policy | M | `plugins.install`, `plugins.toggle` and `plugins.configure` call `check_command` before anything is stored or spawned. Connect and disconnect errors are returned, never dropped (`let _ =`). Bundled packs are pinned `pkg@x.y.z` and seeded **disabled**; an unpinned manifest is refused at install. | `crates/warshad/src/lib.rs` (~4178–4285); `crates/warshad/src/wave2.rs` (manifest parsing, seeding); `crates/warsha-core/src/plugin.rs` (~64–66, 91–297) | A manifest whose command is off the allow-list is refused at install and at toggle; an unpinned manifest is refused; a failing connect surfaces as an RPC error; a fresh daemon lists every bundled pack disabled. |
| **K6** MCP permission at the call site | M | A permission keyed `server::tool::role` with allow / ask / deny, persisted in SQLite, default ask. Enforced in the agent path **and** in the `mcp.call` RPC before anything reaches the transport. Revocation applies on the next call. | `crates/warsha-pipeline/src/agent_loop.rs` (~439–490); `crates/warsha-pipeline/src/mcp.rs` (~158–268); `crates/warshad/src/lib.rs` (`call_mcp` ~3457–3469); `crates/warsha-store` (migration) | A denied or un-approved tool reaches the mock manager zero times; an allowed tool once; after revocation, zero again. |
| **K7** crypto truth | S | Delete `DeviceIdentity::verify_signature` (returns `true`), the no-op `process_handshake`, and the no-op `RelayClient::connect` / `send_frame` / `receive_frames`, with anything only they use. Nothing calls them. | `crates/warsha-remote/src/lib.rs` (~113–116, ~588–752) | No non-test function returns a constant for a verification; `cargo test -p warsha-remote -p warsha-relay` green. |
| **K8** status truth | M | Re-label M10–M19 in `PLAN.md` from REVIEW §3 (REAL / PARTIAL / TYPES / STUB / ABSENT). Make the README "works today" lists match. Add the MCP, plugin, skill and `RunCommand` trust boundaries to `SECURITY.md`. Append corrected records for the 2026-11-08 `acceptance.json` entries whose verdict and note disagree (G3.9, G5.11) — append, never rewrite. | `PLAN.md` (~145–320); `README.md`; `README.ar.md`; `SECURITY.md`; `bridge-io/policy/2026-11-08-design-and-remediation/` (append only) | No "✅ DONE" header whose own sub-lines say "not implemented" or "not wired"; a script listing every `pass` verdict with a non-zero exit code or a "NOT RUN" note prints none after the corrections. |
| **K9** panic and CLI hygiene | S | Remove the three non-test `unwrap()`; the budget percentage survives a zero budget. `warsha … --follow` subscribes to the event socket or the flag is removed. The CLI reads its device id from config. | `crates/warsha-cli/src/lib.rs` (~530, 555, 695, 1038); `crates/warsha-pipeline/src/settings.rs` (~131, 316) | A no-unwrap check over non-test Rust prints nothing; a zero-budget project prints without panicking; `--follow` shows a mock run's events or is absent from `--help`. |
| **S1a–S1d, S2, S3** | as planned | Dependency and supply-chain security exactly as `PROGRAM_PLAN.md` §4 R1 and `completion-program/research/r1-sec-intake.md`. | — | `cargo deny check` exit 0; `pnpm audit --prod --audit-level high` exit 0; `gitleaks detect` exit 0. |

**Checkpoints.** After K1 + K2a–c: run-integrity review. After K4 + K5a + K5b + K6: an independent **security**
reviewer reads the combined diff; no open high or critical finding. Run C-final: standing gates, full Rust suite,
full Playwright through pw-gate `outside=0`, installer builds. Then merge to `dev` and push `main` non-force (OD-P1).
If R0's integration branch is still open, also merge KEEL into it so 0.3.0 ships with the gate controls enabled.

## 5. ENGINE — run `<date>-engine` (after KEEL; target 0.4.0)

Re-verify at intake, from official documentation, the headless invocation of Claude Code and Codex and the
tool-calling request shapes of each provider adapter; record what you found.

| Id | Size | Does | Files | Acceptance |
|---|---|---|---|---|
| **H1.1–H1.8** daemon split | S each, serial | Mechanical moves only: `warshad/src/lib.rs` → `rpc/{runs_gates,agent,mcp_process_preview,extensions,providers_roles,devices,settings}.rs`, `bootstrap.rs`, `lock.rs`; tests move with their area. One area per packet. | `crates/warshad/src/lib.rs` → new modules | No file over 1,600 lines in `crates/warshad/src`; the policy table, wire contract and Rust test count are unchanged after each packet. |
| **E1a** run executor | M | Runs execute as background jobs with a cancellation token under the K2a lock. `runs.advance` returns at once; progress and completion flow on the event bus. | new `crates/warsha-pipeline/src/run_executor.rs`; `crates/warsha-pipeline/src/lib.rs`; `crates/warshad/src/rpc/runs_gates.rs` | `runs.advance` answers in under 200 ms while the mock provider is held open; events arrive in order; cancel stops the job. |
| **E1b** streaming, abort, budget | M | Provider calls stream and are aborted on cancel. A stage is refused before it starts when its estimate exceeds the remaining budget; spend is enforced during the call. Stage requests carry a user message, not a lone system message. | `crates/warsha-providers/src/{lib,openai,anthropic,ollama}.rs`; `crates/warsha-pipeline/src/lib.rs` (~508–617) | The mock observes the dropped request on cancel; a stage whose estimate exceeds the budget does not call the provider. |
| **E1c** real discovery, real language | M | The discovery interview asks its questions through the `ask_user` queue and the inbox and waits; no auto-answers. `{{language}}` comes from the project. | `crates/warsha-pipeline/src/lib.rs` (~292–309, ~1001–1007); `crates/warsha-pipeline/src/orchestrator.rs` | A run waits at discovery until answers arrive; an Arabic project's prompts carry `ar`; no `"To be determined"` default in non-test code. |
| **E2a** tool-calling in the provider layer | M | `ChatRequest` gains tool definitions; responses carry tool calls; adapters for OpenAI-compatible, Anthropic, Ollama and the mock. | `crates/warsha-providers/src/{lib,openai,anthropic,ollama,fake}.rs` | Adapter tests against recorded fixtures: a tool call round-trips in each. |
| **E2b** the loop | M | Model → tool call → K6 permission → K4 execution → result → model, bounded by a step cap and the budget. The transcript is sent every turn and compacted to the model's real context window using provider usage. The owner-typed verbs remain as a shortcut. | `crates/warsha-pipeline/src/agent_loop.rs` (`run_turn`, `execute_turn`, `model_prompt`) | A scripted three-step tool sequence runs to completion; turn two's request contains turn one; a looping model stops at the step cap. |
| **E2c** one loop per run | M | `agent.turn` takes a run id; state and spend are per run and metered to the project; the global instance is removed. Wire types and client updated. | `crates/warshad/src/rpc/agent.rs`; `crates/warshad/src/lib.rs` (`DaemonState`); `packages/client/src/index.ts` | Two runs keep separate transcripts and todos; `check-wire-contract.mjs` green. |
| **E3a** attach or create a repository | M | `projects.attach` accepts only a git repository with a clean tree; otherwise a project gets a fresh repository under the data directory. `repo_path` is stored. | `crates/warshad/src/rpc/runs_gates.rs` (`create_project`); `crates/warsha-git/src/lib.rs`; `packages/client/src/index.ts` | A dirty or non-git path is refused; a new project has a repository with an initial commit. |
| **E3b** a worktree per run | M | Each run works in its own `git worktree` and branch under the data directory, never in the owner's checkout; removing the run removes it. The tool executor is rooted there. | `crates/warsha-git/src/lib.rs`; `crates/warsha-pipeline/src/agent_tools.rs` (~202–230); `crates/warsha-pipeline/src/run_executor.rs` | A run's writes land only in its worktree; the owner's checkout is byte-identical before and after. |
| **E3c** the Code stage writes files | M | The Code stage is an E2b loop that writes through tools; snapshots are git-backed and restorable. | `crates/warsha-pipeline/src/lib.rs` (Code stage); `crates/warsha-pipeline/src/work_protection.rs` | With the mock scripted to write two files, both exist in the worktree; restore returns a file to its snapshot. |
| **E4** coding-CLI backend | M | Claude Code first, Codex second, headless, as the coder role inside the run worktree, on their own login (Warsha reads no token file), with timeout and budget. The `--version` stub is replaced; `state.backends` is routed. | `crates/warsha-backends/src/lib.rs` (`execute` ~166–200); `crates/warshad/src/lib.rs` (`backends`); Code stage | A fake CLI on `PATH` receives the brief and its output becomes the stage result; no token file is opened. |
| **E5** Gate C shows something | M | `gates.list` at Gate C returns a diff against the base, the test command's verdict and a preview handle. Approval produces a local branch; a draft PR only after approval. Rejection leaves nothing behind. | `crates/warsha-pipeline/src/lib.rs` (review stage, gate payload); `crates/warsha-git/src/lib.rs`; `packages/client/src/index.ts` | Gate C payload has a non-empty diff and a test verdict; approving creates the branch; rejecting leaves no branch. |
| **E6** skills, scoped | M | Per-role packs choose which bodies a stage receives, under a token cap, placed **after** the role prompt as delimited reference material. `agent.turn` receives a body only when the skill is invoked. `factory/skills.lock` records source, pin and hash. A real frontmatter parser. | `crates/warsha-pipeline/src/lib.rs` (~463–489); `crates/warsha-pipeline/src/agent_loop.rs` (~945–947); `crates/warsha-pipeline/src/skills.rs` (~272–289); new `crates/warsha-core/src/lockfile.rs` | A stage prompt contains only its role pack's skills, under the cap, after the role prompt; `/skill` puts the body in that turn; the lock round-trips. |
| **E7** one store | M | One SQLite library for runs and settings; pragmas set once; the artifact write and the row update cannot diverge; in-memory stores are persisted or removed together with their screens. | `crates/warsha-store/src/lib.rs`; `crates/warsha-store/src/persistence.rs`; `crates/warshad/src/lib.rs` (`DaemonState`) | One SQLite library in `cargo tree`; a kill between artifact write and row update leaves a consistent run. |
| **T2** Windows smoke capture | S | A Windows job renders a small v3 smoke set with only the bundled font. | `playwright.config.ts`; `.github/workflows/` | Linux and Windows smoke baselines agree within the threshold. |
| **T3** mobile floor | S | One launch-and-pair smoke test for the Android shell. | `apps/mobile/` | The test runs in CI. |
| **E8** pilot | S | One small fenced packet given to Warsha and to you under the same frozen gates. | evidence only | The comparison is recorded; widening is the owner's decision. |

As E3–E5 land, the v3 capabilities turn on and the Project page and Workbench tabs fill with real data. Each such UI
change is its own small packet with an actions-gate e2e case.

**Security checkpoint** after E2b + E3b + E4: a security reviewer confirms that no path from a model's tool call
reaches a process, a file outside the worktree, or an MCP tool without K4, the path screen and K6.

## 6. EXT — run `<date>-ext` (target 0.5.0), then FIN

Packets as defined in `PROGRAM_PLAN.md` §4 R2, minus what KEEL and ENGINE already delivered:

- **X3** Streamable HTTP transport. **X1b / X4** approval inbox items for "ask" and the Connections page. **X5** the
  registry client behind a trait with recorded fixtures. **X7** plugins as pinned bundles (round trip leaves
  nothing behind). **X8** `warsha mcp serve`. **X9** WebMCP in Warsha's own UI, off by default.
- **D1** micro-interactions on the v3 motion tokens, all zero under `prefers-reduced-motion`.
- **D2** sound cues for two events only — a decision is waiting, a run finished — off by default, one setting,
  never the only signal.
- **D3** type-scale repair in `packages/ui/src/v3/tokens/type.ts` and `DESIGN_SYSTEM_V3.md` §2.2: Arabic line-height
  ≥ 1.6 at `text-sm`, titles checked with vocalised two-line samples, `rem` sizes, direction inherited from
  `<html dir>` with `dir="auto"` on user text. This changes pixels: fenced refresh only.
- **RC1** the remote channel: implement the Noise handshake for real, or state in `SECURITY.md` that remote access
  is LAN or TLS only.

Then **FIN1–FIN5** exactly as `PROGRAM_PLAN.md` §4 R4. After 1.0, recorded and not scheduled: X10, X11, eco mode, the
post-launch collector, the hosted relay.

## 7. Authority and procedure

- **Owner decisions in force:** OD-P1…OD-P7 of the program plan; the UI v3 run's recorded answers, with **OD-U2 now
  A**; OD-R1 (KEEL in 0.3.1), OD-R2 (ENGINE before extensions), OD-R3 (bundled packs seeded disabled), OD-R4 (X10
  and X11 after 1.0), OD-R5 (bundle the fonts — decided by the owner), OD-R6 (delete the crypto stubs).
- **Per-run procedure:** intake → plan (a planner role that never implements that run freezes the gates) → implement
  (one worktree and branch per packet, packets ≤ M) → review (a separate reviewer; a security reviewer at the named
  checkpoints) → verify (a separate verifier runs the frozen gates at the reviewed commit; verdicts from gate logs
  only) → bounded repair → merge in the stated order → run C-final → `dev` → non-force push of `main`.
- **Worker discipline:** one subsystem per session; commit after every step; the fixed continuation brief; grep and
  negative-control gates run from script files; reports generated from `state.json` and gate logs.
- **Never:** force-push; tag or publish; post anything; approve a product gate as an agent; put a secret anywhere
  but the keychain; call a real model API or registry in tests; edit a frozen gate; skip, ignore or narrow a test;
  refresh snapshots outside a fenced refresh; write in the shared checkout.

## 8. Definition of done

The verification matrix of `PROGRAM_PLAN.md` §5, plus these rows:

| Dimension | Gate | Pass condition |
|---|---|---|
| Run integrity | concurrent-advance, cancel-during-stage, change-loop, restart-recovery tests | each stage executes exactly once; cancel is final; a change request loops; an interrupted run resumes |
| Gate integrity | out-of-order approval test | refused; decisions carry an artifact hash |
| Truth | production-stub grep; no-unwrap check; verdict/exit-code script | all print nothing |
| Engine | scripted tool loop; worktree isolation; fake coding CLI; Gate C payload | a mock-provider project reaches Gate C with files on disk, a diff and a test verdict |
| Fonts | offline font-load check; Google Fonts grep; Windows smoke capture | bundled Plex loads with the network blocked; no Google request; Linux and Windows agree |

## 9. Start now

1. Read §0. Confirm the UI v3 run is alive and resume it from its latest `state.json` seq.
2. At its next planning point, record §3 (FNT, the three rules, T1). FNT must be merged before RU3 starts.
3. Open run `2026-11-10-keel` (§4) from the UI v3 integration tip and dispatch K1, K7, K8, K9 and S1–S3 at once; the
   serial chain follows K1.
4. When KEEL's C-final is green: merge, push, then open ENGINE (§5), then EXT and FIN (§6).

## 10. Reporting

At every checkpoint: `state.json`, `checkpoints/<seq>-<phase>.json`, gate logs, and a short `PROGRESS.md` entry. At
each run's end: `REPORT.md` generated from `state.json` and `acceptance.json`. At the end:
`bridge-io/policy/2026-11-10-principal-review/FINAL_REPORT.md` with the §8 matrix and each row's gate log, versions,
commits merged and pushed, the install result on the owner's PC, every decision you took, every owner-only item
still open, and any packet left blocked with its reason. A claim with no artifact behind it counts as not done.
