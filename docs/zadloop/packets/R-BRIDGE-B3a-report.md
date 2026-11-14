# R-BRIDGE-B3a — daemon-side MCP approval (Coder report)

Status: **done**, all acceptance commands exit 0, discrimination proven, no open
HIGH on the Coder's side. One review round (M1) is folded in below and is
**uncommitted**: the three commits named under [Commits](#commits) are the
implementation, and the M1 change set sits in the working tree for the PM. Branch `zl-b3a-implementation` in the worktree
`/home/moe/Downloads/zl-b3a-worktree`, based on `7376b7b` (`repair/dev-csp-f474776`).
Nothing was pushed, no PR was opened, `PROGRESS.md`/`DECISIONS.md` were not
touched (the task forbids them; `AGENTS.md` asks for a `PROGRESS.md` update
before stopping — the task wins, and this note is the substitute).

## Commits

| Commit | Contents |
| --- | --- |
| `6c8d108` | `feat(pipeline): mcp approval registry, allow_once grants and the loop's ask/deny path` — `mcp_approval.rs`, `ToolError` variants, the loop's run id / registry / ask / deny / mirror wiring, the warshad RPC surface, `auth.rs` rows, `state.rs`, `DAEMON.md` |
| `318ea44` | `test(warshad): daemon-side approval acceptance tests T6-T11` — the daemon tests, the T8 rename, the log-capture field widening |

`git diff 7376b7b --stat`: 13 files, +3014 −121.

## Files

New: `crates/warsha-pipeline/src/mcp_approval.rs` (1286 lines incl. 26 unit
tests), `crates/warshad/src/mcp_approvals.rs` (376 lines incl. 7 unit tests).

Changed: `crates/warsha-pipeline/src/{agent_loop,agent_tools,lib}.rs`,
`crates/warshad/src/{lib,auth,auth_tests,state}.rs`,
`crates/warshad/tests/{security_identity,e2e_real_arabic_request,e2e_request_to_artifact}.rs`,
`docs/DAEMON.md`.

## Acceptance tests

| # | Test | Where |
| --- | --- | --- |
| T1 | `denied_call_reaches_the_transport_zero_times` | `agent_loop::tests::mcp_approval` |
| T2 | `allow_once_reaches_the_transport_exactly_once_then_asks_again` | same |
| T3 | `a_revoke_takes_effect_on_the_next_call` | same |
| T4 | `a_grant_is_bound_to_run_server_tool_role_and_arguments` | same |
| T5 | `grant_expires_and_pending_is_capped_and_deduped` | `mcp_approval::tests` |
| T6 | `allow_once_rpc_is_owner_only_and_never_writes_a_row` | `tests::mcp_approval` (warshad lib) |
| T7 | `no_secret_argument_value_reaches_question_events_list_or_logs` | same |
| T8 | `summary_is_bounded_and_cannot_forge_a_question` | `mcp_approvals::tests` (warshad lib) |
| T9 | `question_text_does_not_instruct_a_cli_command` | `agent_loop::tests::mcp_approval` |
| T10 | `grants_and_pending_do_not_survive_a_restart` | `tests::mcp_approval` (warshad lib) |
| T11 | `allow_always_and_deny_resolve_pending_through_permissions_set` | same |
| T12 | `a_completed_run_and_a_stale_ask_leave_nothing_behind` | same (M1 review round) |

Supporting tests: 26 in `mcp_approval::tests` (grants, TTL, cap, dedupe,
`resolve_by_row`, `purge_run`, the `*` wildcard row, Debug rendering
keys-only), 7 in `mcp_approvals::tests` (redaction by key name, by schema
`writeOnly`, by token shape, nested values named not entered, bounded summary,
reply wall clock), one in `agent_tools` for the byte-identical error strings.

## Commands (exact, from the worktree root; every one exit 0)

```
$ cargo fmt --all --check
(no output, exit 0)

$ cargo clippy --workspace --all-targets -- -D warnings
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 12.77s
exit 0

$ cargo test -p warsha-pipeline mcp_approval
test result: ok. 26 passed; 0 failed; 0 ignored; 0 measured; 470 filtered out
exit 0

$ cargo test -p warsha-pipeline mcp_permission
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 486 filtered out
exit 0

$ cargo test -p warshad mcp_approval
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 201 filtered out
exit 0

$ cargo test -p warshad --test security_identity
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
exit 0

$ cargo test --workspace --all-targets
39 targets, 1038 passed, 0 failed
exit 0

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

## Discrimination (the tests are load-bearing)

All five artifacts are under `target/discrimination/` (patches + captured
failing runs + a README that lists the exact commands). Each patch is applied to
the working tree, the named test is run, the patch is reverted.

1. **`take` deleted** — `1-take-deleted.patch`: `mcp_take_once` returns `false`
   instead of consulting the registry.
   `cargo test -p warsha-pipeline --lib allow_once_reaches_the_transport`
   → exit 101:
   `assertion left == right failed: the granted call did not run exactly once`
   `left: 0`, `right: 1` (T2).
2. **`Deny` below the grant check** — `2-deny-below-grant.patch`: a `_ if
   mcp_take_once(..)` arm is hoisted above the `Deny` arm.
   `cargo test -p warsha-pipeline --lib denied_call_reaches_the_transport_zero_times`
   → exit 101:
   `assertion left == right failed: a denied call reached the transport`
   `left: 1`, `right: 0` (T1).
3. **Redaction removed** — `3-redaction-removed.patch`:
   `DaemonSummarizer::must_redact` always answers `false`.
   `cargo test -p warshad --lib no_secret_argument_value` → exit 101:
   `SECRET-2 reached the queued question: The agent wants to run test_srv::echo
   (role agent) with: api_key: [REDACTED], note: "Bearer SECRET-2", password:
   [REDACTED], path: "a.txt". Allow once, always allow, or deny?` (T7).
4. **Terminal advance purges nothing** — `4-advance-purge-removed.patch`: the
   `purge_run` call in `runs.advance` is deleted (M1).
   `cargo test -p warshad --lib a_completed_run_and_a_stale_ask` → exit 101:
   `assertion left == right failed: a completed run left a pending question
   behind`, `left: 1`, `right: 0` (T12).
5. **Pending horizon removed** — `5-pending-ttl-removed.patch`:
   `sweep_expired_pending` keeps every unresolved entry (M1).
   `cargo test -p warshad --lib a_completed_run_and_a_stale_ask` → exit 101:
   `a question past PENDING_TTL is still waiting: [PendingApprovalView { id:
   "mcp-approval-01M7CPWQGEEB33SEN376TNCEM6", run_id: "run-that-died", server:
   "test_srv", tool: "echo", role: "agent", summary: "msg: [hidden]", ... }]`
   (T12).

## Edited existing tests

- `crates/warsha-pipeline/src/agent_loop.rs`,
  `mcp_permission::ask_queues_one_question_never_reaches_the_transport`: the
  one assertion the packet allows to change. It asserted the question text tells
  the owner to run a CLI (`mcp.permissions.set`); it now asserts the opposite —
  the question names the call and shows the redacted arguments, and does **not**
  contain `mcp.permissions.set` (D6). The test's other two assertions (one
  question queued, transport counter 0) are unchanged.
- `crates/warshad/src/auth_tests.rs`: `mcp.approvals.list` and
  `mcp.approvals.allow_once` added to the Owner-only sweep, plus four assertions
  on the tiers (list Standard ≠ allow_once Spend, allow_once Spend = the
  `mcp.permissions.set` tier).
- `crates/warshad/tests/security_identity.rs`: the two new methods added to the
  paired-device `-32002` list.
- `crates/warshad/src/lib.rs` (test helper `MessageVisitor`, shared by the log
  shape tests): now records every field of a tracing event, not only `message`,
  so T7 can see a value logged in a structured field. Message-only assertions
  are unaffected (a field is appended after the message).
- `crates/warshad/tests/e2e_real_arabic_request.rs` and
  `e2e_request_to_artifact.rs`: one line each, `mcp_approvals:
  Arc::new(McpApprovals::default())`, because `DaemonState` grew the field (see
  Delta 2).

## Deltas from the packet (each deliberate, each visible)

1. **`agent_sessions.remove` is not wired (D2.8).** The packet's step 5 lists
   `runs.cancel` only, and `agent_sessions.rs` is not in the allowed-file list;
   the daemon never calls `remove` from `lib.rs`, so there is no hook reachable
   from the files I may touch. `purge_run` is wired at `runs.cancel` and, since
   the M1 review round, at `runs.advance` whenever the returned run is terminal
   (`Completed`/`Failed`/`Cancelled`), which is the path a run actually finishes
   by. What is left is a run whose process dies mid-flight; that residue is
   bounded in time — grants by `MCP_ONCE_GRANT_TTL` (10 min), questions by
   `PENDING_TTL` (24 h) — and a grant can only be spent by a loop carrying that
   run id, which no longer exists. T10 proves a restart starts clean, T12 proves
   the terminal advance and the horizon.
2. **Two `DaemonState` literals outside the allowed list.** Adding the
   `mcp_approvals` field makes the two e2e tests' literals fail to compile; one
   line each (`McpApprovals::default()`) is the minimum to keep the workspace
   green. Reported rather than silently absorbed.
3. **`build_agent_loop_in` keeps eight positional arguments** with
   `#[allow(clippy::too_many_arguments)]` and a doc comment explaining why the
   MCP triple plus the run id stay together — the repository's existing pattern
   (`process_spawn.rs:552`). `clippy -D warnings` requires one of the two, and a
   struct would have renamed a seam the packet names explicitly.
4. **The summarizer is injected through a trait,** not called from the pipeline:
   `warsha-pipeline` cannot reach the daemon's scrubber (`state::redact_string`
   is now `pub(crate)`), so `ArgumentSummarizer` is the seam and
   `KeysOnlySummarizer` (values hidden) is the fail-closed default.
5. **T7's log capture is process-wide.** A thread-local subscriber loses the
   `warshad` callsites: tracing caches per callsite whether it is ever enabled,
   and a callsite another parallel test reached first is frozen as "never". The
   capture is therefore installed once as the global default (memory writer, no
   stdout) and the test asserts only on lines carrying `mcp.approvals`. Verified
   stable across three consecutive full-suite runs (208 passed each then; 209
   after the M1 round adds T12).
6. **`agent_turn_run` was not given a new question-text surface.** The queued
   question is read in T7 by building a loop with `build_agent_loop_in` — the
   same builder `runs.start` uses — sharing the state's registry and the run id;
   the registry de-duplicates the ask, so the test reads exactly the id and
   summary the answer resolves.

## M1 correction (review round, uncommitted)

The review found that unresolved pendings had no horizon and that a run
finishing through `runs.advance` purged nothing, so residue was capped per run
(32) but not per process, and `mcp.approvals.list` grew with it. Fixed inside
the files already allowed, nothing else changed:

1. **`runs.advance` purges a terminal run.** The handler now mirrors the
   `runs.cancel` hook: after the pipeline returns, a run whose status is
   `Completed`, `Failed` or `Cancelled` gets `purge_run(&run.id.0.to_string())`
   (`crates/warshad/src/lib.rs`, `advance_run`). A run that finished has no next
   call, so its open question and any unspent grant are dead weight.
2. **A pending entry has a horizon.** `PENDING_TTL = 24 h` in
   `crates/warsha-pipeline/src/mcp_approval.rs`; `PendingApproval` carries
   `requested_at_instant` (the monotonic instant, beside the RFC-3339 string the
   wire shows), and `sweep_expired_pending` drops an unresolved entry once
   `now - requested_at_instant >= PENDING_TTL` — resolved entries keep their
   10-minute bookkeeping window. The sweep runs in every registry path that
   already swept, plus the read path that exposes growth: `take_at` and
   `has_grant` (every agent call passes through one of them; each takes the
   pending lock only after releasing the grants lock, so no ordering can
   deadlock), `register_pending` (a retry a day later is a new question, not a
   dedupe onto an invisible entry), `allow_once_at`, `pending()` and
   `pending_len()` (so the list stops growing too). The comparison saturates, so
   an explicit earlier clock keeps the entry instead of panicking.
3. **One test, as asked:** T12
   `a_completed_run_and_a_stale_ask_leave_nothing_behind` proves both halves — a
   run with one answered ask (live grant) and one open ask, advanced from
   `Feedback` to `Completed`, leaves no question in `mcp.approvals.list`, no
   pending entry and no grant; and a question registered under a dead run id is
   swept by the take path once past `PENDING_TTL` while one inside the horizon
   survives. No other test was added or changed in this round.

Discrimination for the correction (both under `target/discrimination/`, patches
and captured runs, listed in the table there): deleting the advance purge fails
T12 with `a completed run left a pending question behind` (`left: 1`,
`right: 0`); restoring `None => true` in the sweep fails T12 with `a question
past PENDING_TTL is still waiting: [PendingApprovalView { ... run_id:
"run-that-died" ... }]`.

Re-ran the full command list after the change; every one exits 0:
`cargo fmt --all --check` (no output), `cargo clippy --workspace --all-targets
-- -D warnings` (`Finished dev profile`), `cargo test -p warsha-pipeline
mcp_approval` (26 passed), `cargo test -p warsha-pipeline mcp_permission` (10
passed), `cargo test -p warshad mcp_approval` (12 passed), `cargo test -p
warshad --test security_identity` (5 passed), `cargo test --workspace
--all-targets` (39 targets, 1038 passed, 0 failed), `wire: 11 checks, 0
violations`, `policy: 8 checks, 0 failures`, `arch: 5 rules, 0 violations` (each
with its `--self-test` also exit 0). `AGENTS.md` asks for a `PROGRESS.md` update
before stopping and the task forbids it; this section is the record.

## Residuals (for B3b and the security audit)

- A secret that is neither key-named, nor schema-marked, nor token-shaped cannot
  be redacted by any filter (O8a); B3b's UI should label the summary "redacted
  preview".
- `mcp.call`'s own message still points a programmatic owner at
  `mcp.permissions.set` (O6) — left as the packet recommends.
- The daemon-wide loop has no run id (O7) and therefore never consumes a grant:
  it asks, exactly as before.
- `agent.turn_run` still echoes the raw call arguments in its `ToolResult`
  (O8b) — Owner-only, not an approval-path leak, and unchanged by this packet.
- A paired device's `mcp.approvals.list` refusal and its `-32002` code are
  asserted in both the unit test (T6) and the `security_identity` sweep.
