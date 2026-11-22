# R-BRIDGE-B5 — per-run preview (Coder report)

Status: **implemented, tests and docs committed, T1–T6 green, both named
discriminations proven** (plus a third for the sweep). Every acceptance command
exits 0; see [Commands](#commands-and-counts) for the exact output.

Branch `zl-b5-per-run-preview` in the worktree
`.agents/worktrees/zl-b5-per-run-preview`, based on `121cf87`
(`repair/dev-csp-f474776`, the B5 spec tip). Nothing was pushed, no PR was opened,
`PROGRESS.md`/`DECISIONS.md` were not touched (the task forbids them; `AGENTS.md`
asks for a `PROGRESS.md` update before stopping — the task wins, and this report is
the substitute). One fresh worktree was created for the packet, and the base
checkout was left untouched.

## Commits

| Commit        | Contents                                                                                                                                                                                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e022ed0`     | `feat(pipeline): a preview records the run that owns it` — `process_spawn.rs` (`PreviewEntry.run_id`, `RunLiveness`, `start(.., Option<&str>)`, `stop_run`, run-scoped `status`, lazy sweep, `ProcessError::PreviewOwnedByRun`) and its `#[cfg(test)]` module, `warsha-pipeline/src/lib.rs` re-export |
| `663cb0b`     | `feat(warshad): stop a run's preview when the run ends` — the terminal `runs.advance` arm and `runs.cancel` hooks, `preview.start`/`preview.status` run context, `StoreRunLiveness`, `gates.evidence` read, the five daemon acceptance tests                                                          |
| `2f7dde5`     | `docs(daemon): preview rows and per-run preview ownership` — `docs/DAEMON.md`                                                                                                                                                                                                                         |
| (this commit) | `docs(r-bridge-b5): the Coder report` — this file                                                                                                                                                                                                                                                     |

`git diff 121cf87 --stat`: **4 files, +1082 −32** —
`crates/warsha-pipeline/src/{lib,process_spawn}.rs`,
`crates/warshad/src/lib.rs`, `docs/DAEMON.md`. No client, no UI, no harness, no
wire file, no test weakening, and the two MCP hook lines are byte-identical to
B3a's (the preview calls are added beside them, not folded into them).

## What landed

| Decision                 | Where it lives                                                                                                                                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 keying                | `PreviewEntry.run_id: Option<String>`; keying is still the project string. `LivePreview` (the wire DTO) is unchanged, so ownership never reaches a client                                                                                                                                                           |
| D2 stop on close         | `LivePreviewManager::stop_run(&run_id) -> usize` stops and drops every entry the run owns; called from the terminal `runs.advance` arm and from `runs.cancel`. Infallible by type, so no run close can fail on it; a kill that errors is logged (`tracing::warn`) and the entry is dropped anyway                   |
| D3 no steal + lazy sweep | `start` takes `Option<&str>`; a live server owned by another live run is `PreviewOwnedByRun { project, owner, run_id }`; entries whose owner is not live are stopped and dropped before the ownership check, on `start` and on `status`. Liveness is injected (`RunLiveness`), the daemon answers it from the store |
| D4 status scoping        | `status(&project, Option<&str> run_id)`: in a run context, another live run's server is `PreviewNotFound`; with no run context the project's server answers. `preview.status` keeps its wire shape (no new method, OD-B2)                                                                                           |
| D5 restart               | Previews stay in the manager's memory only; `restart_starts_clean` proves a rebuilt manager has no entries and starts fresh                                                                                                                                                                                         |

The manager judges owners through `RunLiveness`, which the daemon implements as
`StoreRunLiveness` (`crates/warshad/src/lib.rs`): a run the store still has and
that is not `Completed`/`Failed`/`Cancelled` is live; an unreadable, missing or
unparseable run is not, so its preview is swept rather than blocking the project
forever. A manager built without an oracle (`LivePreviewManager::new`, which is
what the two e2e test harnesses build) cannot prove an owner dead, so it treats
every owner as live and keeps the no-steal rule.

## Acceptance tests

| #   | Test                                      | Where                  |
| --- | ----------------------------------------- | ---------------------- |
| T1  | `second_run_never_inherits_a_live_server` | `warshad` `tests`      |
| T2  | `terminal_advance_stops_the_owned_server` | `warshad` `tests`      |
| T3  | `cancel_stops_the_owned_server`           | `warshad` `tests`      |
| T4  | `dead_run_entry_swept_lazily`             | `warshad` `tests`      |
| T5  | `stop_failure_never_fails_run_close`      | `process_spawn::tests` |
| T6  | `restart_starts_clean`                    | `process_spawn::tests` |

T1–T4 run through the real RPCs, the real store and a real child process (the
test binary's `preview_probe`): T1 starts run A, starts the project's preview,
starts run B and proves the second `preview.start` is refused with both run ids in
the message and that A's server is still A's; T2 moves the run to `Feedback` and
advances it to `Completed`; T3 cancels it; T4 writes `Cancelled` into the run row
directly (no hook, the crash a restart hands over) and then proves the next status
sweeps the abandoned server and the next run starts clean with a different process
id.

T5 is the poisoned path itself, at the only layer that can be poisoned today: a
stub `ProcessManager` whose `stop` always errors, so `stop_run` is proven to
attempt the kill, swallow the failure and drop the entry. The daemon's half of the
same claim is `a_run_closes_even_when_its_server_is_already_down`: a run is
cancelled after its server has already gone, and `runs.cancel` still answers with
the cancelled run — see [Deviations](#deviations-from-the-packet) 4 for why
poisoning `stop` through `DaemonState` is not available.

Supporting pipeline tests (all new): `a_live_server_owned_by_another_live_run_is_not_a_newcomers_to_take`,
`stop_run_stops_the_servers_the_run_owns_and_only_those`,
`status_in_a_run_context_reports_only_that_runs_server`,
`a_manager_with_no_run_source_never_lets_a_newcomer_take_a_server`,
`a_dead_runs_entry_is_swept_instead_of_blocking_the_next_run`,
`a_start_without_a_run_is_still_one_preview_per_project`. Every pre-existing
preview test kept its assertions and only gained the new argument (`None`), which
is the unowned case they already described.

13 new tests in total (8 pipeline, 5 daemon); the workspace went from 1038 to 1051
passing with nothing removed.

## Commands and counts

Run from the worktree root at `2f7dde5`, every one exit 0:

```
$ cargo fmt --all --check
(no output, exit 0)

$ cargo clippy --workspace --all-targets -- -D warnings
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 3.98s
exit 0

$ cargo test --workspace --all-targets
39 targets, 1051 passed, 0 failed, 12 ignored
exit 0

$ cargo test -p warsha-pipeline --lib process_spawn::tests
test result: ok. 37 passed; 0 failed; 2 ignored; 0 measured; 465 filtered out
exit 0

$ cargo test -p warshad --lib second_run_never_inherits_a_live_server
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 217 filtered out
$ cargo test -p warshad --lib terminal_advance_stops_the_owned_server
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 217 filtered out
$ cargo test -p warshad --lib cancel_stops_the_owned_server
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 217 filtered out
$ cargo test -p warshad --lib dead_run_entry_swept_lazily
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 217 filtered out
$ cargo test -p warshad --lib a_run_closes_even_when_its_server_is_already_down
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 217 filtered out
exit 0 (each)

$ node scripts/check-wire-contract.mjs --self-test && node scripts/check-wire-contract.mjs
wire self-test: 11 checks fire, clean fixture is clean in both modes
wire: 11 checks, 0 violations
exit 0

$ node scripts/check-engineering-policy.mjs --self-test && node scripts/check-engineering-policy.mjs
policy self-test: 8 checks fire, clean fixture is clean
policy: 8 checks, 0 failures
exit 0

$ node scripts/check-arch.mjs --self-test && node scripts/check-arch.mjs
arch self-test: 5 rules fire, clean fixture is clean
arch: 5 rules, 0 violations
exit 0
```

The 12 ignored tests are the pre-existing ignored ones (the MCP/preview child
probes and the `#[ignore]`d E8 pilot); none is skipped by this packet.

Desktop unit suites — **quoted, not run here**: this worktree carries no
`node_modules` and the packet touches no desktop, client, UI or JS file, so the
last recorded run stands unchanged (R-BRIDGE-B4a, same Rust base
`repair/dev-csp-f474776`): `warsha-desktop` 772, `@warsha/ui` 373,
`@warsha/client` 172, `warsha-remote` 221, `@warsha/i18n` 58,
`@warsha/crypto` 22 — `pnpm lint && pnpm typecheck && pnpm -r test && pnpm build`
exit 0 at that commit. Nothing in this diff can move them.

## Discrimination (under `target/discrimination/`)

`target/discrimination/README.md` lists each patch, its exact command and the
captured run; every patch was reverted with `git apply -R` and
`git status --porcelain` was empty between them.

1. **Advance hook removed** — `1-advance-hook-removed.patch` deletes the
   `previews.stop_run(..)` line from the terminal `runs.advance` arm.
   `cargo test -p warshad --lib terminal_advance_stops_the_owned_server` → exit
   101: `assertion left == right failed: the run's server outlived the run`,
   `left: Running`, `right: Stopped` (T2).
2. **Liveness check removed** — `2-liveness-check-removed.patch` makes
   `StoreRunLiveness::is_live` answer `false` for everything, so the manager can
   no longer tell a live owner from a finished one.
   `cargo test -p warshad --lib second_run_never_inherits_a_live_server` → exit
   101: `run B cannot take the server run A owns: LivePreview { project_id:
"e05080dc-…", process_id: "proc-2", … }` — the takeover was _served_, which is
   exactly what D3 forbids (T1).
3. **Lazy sweep removed** (extra, same removal from the read side) —
   `3-lazy-sweep-removed.patch` drops `sweep_dead` from `status`.
   `cargo test -p warshad --lib dead_run_entry_swept_lazily` → exit 101:
   `a dead run's preview still answered` (T4).

## Deviations from the packet

1. **The run context is derived, not carried (D4 under a frozen wire).** The wire
   has no run id on `preview.start`/`preview.status` and OD-B2 forbids adding one,
   so the daemon reads the context from the store: `WarshaRpc::live_run_id` is the
   project's newest run that has not finished. That is the run a server started now
   is registered under and the run a status call answers for. `live_run_id` is a
   private inherent method beside the preview RPC bodies, not a new RPC method.
2. **One new type and two construction lines outside the hook sites.** The
   pipeline must not learn about a store, so liveness is injected:
   `RunLiveness` (pipeline) + `StoreRunLiveness` (warshad) and
   `LivePreviewManager::new(..).with_run_liveness(..)` at the production state
   builder and at `tests::test_state`. `LivePreviewManager::new` keeps its
   signature, which is why the two `crates/warshad/tests/e2e_*` harnesses (outside
   the allowed list) needed no edit.
3. **A third RPC body was touched: `gates.evidence`.** Its preview read now passes
   the run id (D4's "in a run context it reports the run's server"), so a reviewer
   is never shown another live run's server. It is a read, inside an RPC body, and
   no evidence assertion changed.
4. **T5 is proven in two halves.** `DaemonState` has no processes seam — the
   preview manager's `ProcessManager` is built inside `test_state` — so a
   daemon-level _poisoned_ stop cannot be injected without either a 33-field
   `DaemonState` literal or a new parameter on `test_state_with_seams` (which five
   unrelated tests call). The poisoned path is therefore the pipeline test, and
   the daemon half proves the close answers when the server is already gone.
   `stop_run` returning `usize` rather than `Result` is what makes "never fails the
   run close" structural rather than a code path a test has to reach.
5. **`ProcessError` gained a variant.** `PreviewOwnedByRun { project, owner,
run_id }` is the typed refusal D3 asks for; it reaches the client as `-32000`
   with both run ids in the message, the same mapping every other preview failure
   uses.
6. **Three discrimination artifacts instead of two**, the third (sweep removed →
   T4) added because artifact 2's removal breaks the refusal, and the read-side
   sweep is the same rule's other half.

## Residuals

- With **two live runs on one project**, project-scoped `preview.status` answers in
  the newer run's context, so the older run's server reads as `PreviewNotFound`
  until it dies with that run. That is D4 taken literally ("the calling run's
  server"); a client that wants the older run's server can only ask with that run
  id, which the frozen wire cannot carry — the manager API already accepts it.
- A run that dies without its close leaves its child alive until the next
  `start`/`status` on the project sweeps it (or the daemon's `kill_all` at exit).
  That is D3's lazy rule, not a new leak, but it does mean a crashed run's dev
  server can keep its port for as long as nobody touches that project.
- `preview.list` (`LivePreviewManager::list`) still reports dead-run entries until
  a `start`/`status` for that project sweeps them: the packet scopes the sweep to
  those two calls, so `list` was left alone.
- Previews remain in-memory only (D5, T10 precedent for MCP grants): a restart
  starts clean and forgets the children it started, which is the known PLAN.md
  half reaped by `process.kill_all` on the daemon's exit path.
