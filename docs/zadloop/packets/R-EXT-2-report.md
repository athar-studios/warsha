# R-EXT-2 report — the agent-tool round trip and `run_finished`

**Status: DONE**, with two documented deviations (an async observer method, and T8 exercised on the store's bus
rather than through a socket) and one lane constraint (the e2e gate ran on port 5273 because a parallel lane held
5173). Every gate in the packet's GradingGate is green on the final tree; the discrimination artifacts are under
`target/discrimination/r-ext-2/`. StageCompleted is still unemitted, sound cues are not rewired, and the plugin
round trip was not built (R-EXT-2b renumber left to the plan).

- **Branch:** `zl-rext2-agent-tool` (cut from the base the lane was given; isolated worktree
  `../Warsha-rext2`).
- **Base:** `8fc58db` on `repair/dev-csp-f474776` (the packet's `e65074a` is its parent line; `8fc58db` is the
  base this lane was told to use, and `e65074a` is an ancestor).
- **Commits** (all on the branch):

| Commit | What |
|---|---|
| `22ca650` | `feat(core): add the run_finished event kind` — the variant, its serde round trip, and the proof that every existing kind's wire name is unchanged (T7) |
| `5182905` | `feat(pipeline): record agent MCP calls and a run's end` — `mcp_observer.rs` (phase, event, trait + its own tests), the loop's emit sites, `run_finished` at the three terminal CAS sites |
| `5523d36` | `feat(warshad): write agent MCP calls and one run_finished per run` — `mcp_call_events.rs` (the store recorder), the injection at `runs.start`, the cancelling device, and T1–T6/T8 |
| `87992a9` | `feat(desktop): show the agent's MCP calls and the run's end` — client decoders + tests, Terminal tab, project page, ar/en keys, the harness fixture and three e2e cases |
| `cbf627e` | `docs(daemon): document event kinds and the run_finished downgrade hazard` — `DAEMON.md` §4 and the `DECISIONS.md` entry |
| `9d6ec69` | `docs(zadloop): R-EXT-2 report` — this file |
| `d6e567e` | `style(client,desktop): keep the new lines Prettier-clean` — the phase union, the stream ternary, the decoder probe |
| `ed97291` | `refactor(i18n): name the five call phases events.tool_call.phase.*` — the packet's key family, values unchanged |

21 files changed (`+2,088 / −40`): 12 Rust files/tests, 9 TS/i18n/e2e, 2 docs. No `docs/zadloop/packets` file other
than this report was touched, and `PROGRESS.md` was left alone (the work order excludes it).

## What shipped

**A1 — the call is on the run's stream.** `warsha-pipeline/src/mcp_observer.rs` defines `McpCallPhase`
(`requested`, `approval_required`, `denied`, `succeeded`, `failed`), `McpCallEvent { phase, server, tool,
question_id }` and the `McpCallObserver` seam. `AgentLoop` gained `mcp_observer` and `with_mcp_observer`; the
`PreparedTurn` carries it, exactly as it carries the approvals registry. Emit sites: `Requested` once the target
server is resolved and before the permission row is read; `Denied` on the deny arm; `ApprovalRequired` with the
queued question id; `Succeeded`/`Failed` from the single `call_mcp_tool` result (so an `Allow` row and a spent
`allow_once` grant take the same path); `Failed` when no server advertises the tool or no manager is wired.
`warshad/src/mcp_call_events.rs` implements the seam over the store: it reads the run's `current_stage`, writes the
existing `EventKind::ToolCall` with `{action: mcp_call, phase, server, tool, role, question_id?}`, and logs a failed
append instead of failing the call. No argument, result or summary crosses the seam — the payload builder is one
private function, so nothing else can add a field (T4).

**A2 — one `run_finished` per run.** `warsha_core::EventKind::RunFinished` (wire name `run_finished`, last variant).
`run_finished_event(run_id, stage, status, device_id)` builds `{"status": "completed"|"failed"|"cancelled"}` with
`role: None`. The three sites are the three places a run can become terminal, and each writes inside the same guard
as the status:

| Ending | Site | Guard |
|---|---|---|
| `completed` | `warsha-pipeline/src/lib.rs`, `advance_to_next_gate_locked` Feedback arm | inside `if latest.status == RunStatus::Running` after `update_run_cas` |
| `failed` | `record_stage_failure` | `else if !is_unrouted && !was_terminal` on the successful `update_run_cas` |
| `cancelled` | `cancel_run_with_device` | `if !was_terminal` after the CAS loop breaks, `device_id` = the authenticated session's |

`Paused` is not terminal and writes nothing. A repeated `runs.cancel` and a second `runs.advance` on a finished run
write nothing either, because they read the terminal status before their own CAS.

**A3/A4 — the ends reach the surfaces.** `runs.cancel` now passes `actor.device_id()` (never a parameter) through
`cancel_run_with_device`; `cancel_run` keeps its old signature for system cancels. `DAEMON.md` §4 gains an
"Event kinds and payload shapes" table that states, first line, that **no gate covers event shapes**, plus the
five phases and the no-arguments rule; `DECISIONS.md` logs the downgrade hazard.

**B — the desktop.** `packages/client` exports `RUN_FINISHED_KIND`, `decodeRunFinished` (null for any other kind and
for an unknown status — never a default) and `decodeMcpCall` (null for an `allow_once` answer, which is also a
`tool_call`). `TerminalTab` renders one `<li data-phase=…>` per call with `dir="ltr"` on the server and tool tokens,
the phase label from the catalog, the "answer it in the Inbox" hint on the asking phase only, and one
`bench-terminal-run-finished` line with `data-status`. Its existing transcript filter is kept: a `tool_call` that is
not an MCP call (the `allow_once` answer) still lands in the transcript. The project page renders the ending with
the status-specific key and still filters `tool_call` out of simple mode. `EVENT_KIND_TO_KEY` gained `run_finished`;
ar and en carry `events.run_finished[.completed|.failed|.cancelled]`, `events.tool_call.phase.*` ×5 and
`events.tool_call.answer_inbox`.

## Gates (final tree)

| Gate | Command | Result |
|---|---|---|
| fmt | `cargo fmt --all --check` | **exit 0** |
| clippy | `cargo clippy --workspace --all-targets -- -D warnings` | **exit 0**, no warnings |
| Rust tests | `cargo test --workspace --all-targets` | **exit 0 — 39 suites, 1,068 passed, 0 failed, 12 ignored** |
| event stream (real socket) | `cargo test -p warshad --test events_ws_live` | **exit 0 — 2 passed** |
| deny | `cargo deny check` | **exit 0** — advisories/bans/licenses/sources ok (one pre-existing ignored advisory on the Linux tauri graph) |
| wire | `node scripts/check-wire-contract.mjs` | **exit 0 — 11 checks, 0 violations** |
| wire self-test | `node scripts/check-wire-contract.mjs --self-test` | **exit 0 — 11 checks fire, clean fixture clean (shipped + strict)** |
| arch | `node scripts/check-arch.mjs` | **exit 0 — 5 rules, 0 violations** |
| arch self-test | `node scripts/check-arch.mjs --self-test` | **exit 0 — 5 rules fire, clean fixture clean** |
| policy | `node scripts/check-engineering-policy.mjs` | **exit 0 — 8 checks, 0 failures** |
| lint | `pnpm lint` | **exit 0** — 0 errors; 1 pre-existing warning (`pages/inbox/index.tsx:360`), untouched by this packet |
| typecheck | `pnpm typecheck` | **exit 0** (7 projects, incl. `tsconfig.e2e.json`) |
| TS unit | `pnpm -r test` | **exit 0** — client **193** (2 files; R-EXT-1 baseline 186, +7), desktop **819** (93 files; baseline 815, +4), every other package unchanged |
| build | `pnpm build` | **exit 0** |
| e2e | `pnpm exec playwright test --project=desktop apps/desktop/e2e/v3 --grep-invert "@visual" --workers=3` | **exit 0 — 301 passed** (R-EXT-1 baseline 298, +3) |
| ds-v3 | `node scripts/check-ds-v3.mjs apps/desktop/src/v3 packages/ui/src/v3 apps/remote/src` | **exit 0 — 0 violations** |
| i18n | `node bridge-io/.../tools/i18n-gate.mjs "$PWD"` | **exit 0 — 796 keys, 0 violations** (10 new × 2 catalogs) |
| actions | `node bridge-io/.../tools/actions-gate.mjs "$PWD"` | **exit 0 — 158 registered, 158 used, 0 violations** |
| contrast | `node bridge-io/.../tools/contrast.mjs --check-css packages/ui/src/v3/tokens/tokens.css` | **exit 0 — fails 0** (no token added; the new line uses `--w-success`/`--w-danger`) |
| stub grep | `git grep -nE "In real implementation\|mock proposals\|MockRoutineRunner::new" -- crates ":!**/tests/**"` | **prints 9 lines, all pre-existing** — see Findings; the packet's new code adds none |

**e2e deviation (named, not waived):** the parallel R-UI-6 lane held `localhost:5173` with its own Vite server
(`pid 680920`, `/home/moe/Downloads/Warsha/.agents/worktrees/zl-rui6-filebase`), so `playwright.config.ts` refused to
start (`Error: http://localhost:5173 is already used`) and its `globalSetup` hardcodes 5173/5174. The suite ran,
unchanged cases and unchanged assertions, through a **temporary untracked config** that moved the desktop server to
5273 (same project, same `testDir`, same `--grep-invert "@visual"`, `--workers=3`); both temp files
(`playwright.rext2.config.ts`, `apps/desktop/e2e/support/global-setup.rext2.ts`) were deleted before the commits, and
`git status` shows no trace of them. `playwright.config.ts` was not modified. The three new cases also passed on
5173 earlier, before the other lane took the port.

## Proof: `run_finished` is emitted once, from the CAS site

- **CAS site:** `crates/warsha-pipeline/src/lib.rs` — the Feedback arm appends after `self.store.update_run_cas(&latest,
  latest_v).await?` and inside the same `if latest.status == RunStatus::Running`; `record_stage_failure` appends in the
  `else` of its CAS; `cancel_run_with_device` captures `was_terminal` from the same read it CASes and appends only when
  it was not already terminal.
- **Tests:** `a_completed_run_has_one_finished_event` (advance to completion, then advance again → exactly one
  `{"status":"completed"}` at `Stage::Feedback`, `role: None`, `device_id: None`);
  `a_cancelled_run_has_one_finished_event_naming_the_device` (two cancels by two devices → one
  `{"status":"cancelled"}` carrying the first device); `a_paused_run_writes_none_and_a_failed_stage_writes_one`
  (an unrouted role pauses and writes none; a provider that refuses a stage fails it and writes one
  `{"status":"failed"}`).
- **Discrimination:** moving that append *outside* its guard makes `a_completed_run_has_one_finished_event` fail with
  two endings — `target/discrimination/r-ext-2/02-run-finished-outside-cas-T6-red.txt` (restored:
  `03-restored-green.txt`).

## Proof: the observer lifecycle writes no duplicate and can lose nothing

- One phase per event, in call order: the ask turn records `requested, approval_required`; the answered turn records
  `requested, succeeded`; the whole life is asserted as the exact list
  `[requested, approval_required, requested, succeeded]` in store order (T2), with `mcp.count() == 0` before the grant
  and `== 1` after it.
- `deny` records `[requested, denied]` with zero transport calls; a refusing transport records `[requested, failed]`
  (T3). A loop with no observer records nothing and still asks (T5) — the daemon-wide loop is unchanged by
  construction (`build_agent_loop` never attaches one).
- The recorder is awaited, not fired-and-forgotten, which is why the order is the store's `seq` order.
- Discrimination: removing the `Requested` emit at the call site turns T1/T2/T3/T4 red (4 failed) —
  `target/discrimination/r-ext-2/01-revert-a1-emit-T1-T2-red.txt` (restored: `03-restored-green.txt`).

## Design points

- **OD-EXT2-a (observer, not a store in the loop):** confirmed. `warsha-pipeline` gained no store dependency; the
  daemon implements the trait. 20+ existing `AgentLoop::new`-based tests compile unchanged.
- **OD-EXT2-b (one kind with a `status` payload):** confirmed. One variant, three payload values, client decodes.
- **OD-EXT2-c (fold `StageCompleted` in?):** not done, as ruled. The variant is declared
  (`warsha-core/src/lib.rs:277`) and constructed nowhere: `git grep EventKind::StageCompleted -- crates` finds only the
  name test this packet added, and `git grep "kind: EventKind::"` finds no producer for it.
- **No exhaustive matches break:** `cargo check/clippy --workspace --all-targets` is green, which is the proof that no
  `match` over `EventKind` went non-exhaustive. `warsha-store` reads kinds by name (serde), never by discriminant, so
  the appended variant changes no stored value; a spot check of every `EventKind::` use in `crates` shows comparisons
  and constructions only, no `match` arms over the whole enum.
- **Event kinds are client strings:** `export type EventKind = string` (`packages/client/src/index.ts:375`) is
  untouched, and `check-wire-contract.mjs` W1–W11 compare JSON-RPC method names, policy rows, param names, harness
  stubs and CSP — grepping it for `kind`/`Event`/`events` finds only the method-name mapping `getRunLogs:
  'runs.events'`. That is why the wire gate stays 11/0 and why `DAEMON.md` carries the shape note instead.
- **Privacy:** the only payload the new code builds is `{action, phase, server, tool, role, question_id?}`; T4 asserts
  the exact sorted key set per phase and that no `SECRET-1..4` appears anywhere in the run's event log, and the client
  decoder's return value has four fields, none of them an argument.

## Deviations, limits, findings

1. **`McpCallObserver::record` is `async fn` (via `async_trait`), not `fn`.** The packet names a sync signature; the
   only implementation that matters appends to an async store, and a sync seam could only spawn, which would lose the
   `seq` ordering T2 asserts. The trait still returns `()` and an implementation's failure is logged, never raised into
   the call. Everything else about the seam is the packet's.
2. **The observer is attached at `runs.start` (`crates/warshad/src/lib.rs`), not inside `runtime.rs`.** `runtime.rs`
   builds loops from seams and has no store and no run id; `runs.start` is the one place that has both, and it is the
   line right after the per-run builder the packet points at. `lib.rs`'s other edits are this injection and the
   `runs.cancel` device line — nothing else in that file moved.
3. **T8 uses the store's bus, not a WebSocket.** `crates/warshad/tests/events_ws_live.rs` is outside this packet's
   allow-list, so T8 subscribes to `Store::subscribe_events()` — the bus the packet itself cites as the one `/events`
   subscribes through — and asserts the frames a socket would receive. The real socket path is separately green
   (`events_ws_live`, 2 passed).
4. **The bench Terminal keeps its transcript and adds a call list beside it.** The MCP calls are drawn as their own
   list (that is where `dir="ltr"` on the server/tool tokens lives) rather than as transcript strings, because
   `Transcript` takes `content: string` and a token inside a string cannot carry a direction. The transcript's filter
   is otherwise unchanged, so the `allow_once` answer still shows there.
5. **`PROGRESS.md` was not updated** — the work order excludes it (only this report and the `DECISIONS` note are
   allowed). AGENTS.md's "update PROGRESS before you stop" is superseded for this lane; the next packet's dispatch
   should fold this report in.
6. **Pre-existing: the stub grep prints 9 lines.** All are `MockRoutineRunner::new()` inside the `#[cfg(test)] mod
   tests` of `crates/warsha-pipeline/src/routines.rs` (module starts at line 579; the lines are 761+). The gate's path
   filter excludes `**/tests/**` directories but not inline test modules, and the file is byte-identical to the base
   (`git show 8fc58db:crates/warsha-pipeline/src/routines.rs` prints the same 9). Nothing this packet added appears in
   the output.
7. **Pre-existing: `pnpm lint` reports one warning** (`apps/desktop/src/v3/pages/inbox/index.tsx:360`,
   `react-hooks/exhaustive-deps`); that file is untouched and exit code is 0.
8. **Prettier is not a repo-wide gate.** `pnpm format:check` is not in the packet's gates and is not clean at the
   base (`PLAN.md`, `PROGRESS.md` and dozens of untouched sources drift from `.prettierrc`); the files this packet
   touched drift by the same pre-existing amount as their base versions (e.g. `e2e/harness.ts` 106 lines before and
   after, `client/src/index.test.ts` 69 before and after), and every line this packet added is itself conformant —
   `TerminalTab.tsx` went from 108 drifting lines at the base to 7, which is why `d6e567e` exists.
9. **Not run:** the `@visual` suite (baselines need the capture host, per R-UI-4's finding), the `remote` project
   (R-UI-6's lane owns `apps/remote`), and any real provider or network path — every test used the mock provider and an
   in-process MCP transport.

## Out of scope, confirmed untouched

- `EventKind::StageCompleted` is still declared and never emitted.
- Sound cues / inbox rewiring are not done (the event is now there for a later packet to consume).
- The plugin bundle round trip is not built; `R-UI-RUN-PLAN.md` row 7 still needs its R-EXT-2b renumber, and this lane
  did not edit the plan.
- `apps/remote` build config and `main.tsx` (R-UI-6's files) were not opened, and `packages/client`/`harness.ts`
  overlap with that lane was checked before editing: it touches neither.
