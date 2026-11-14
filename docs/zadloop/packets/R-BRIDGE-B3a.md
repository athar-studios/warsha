# R-BRIDGE-B3a — MCP approval path, daemon side (G3, X1b pulled forward, KEEL K6)

Status: design + packet spec (Planner lane, read-only research). Base: `1a785c7`
(`repair/dev-csp-f474776` lineage). Depends on KEEL K6 (permission table, landed).
Blocks B3b (desktop approval UI + client). Licence wording: "free and source-available".
Every `file:line` below was read on `1a785c7`; the Coder re-verifies each before relying on it.

## Why

KEEL K6 made the permission table real: `ToolPermission::{Allow,Ask,Deny}`, a missing row is
`Ask`, and `ask`/`deny` never reach the transport (`mcp_permission.rs:3-6`, `:17-27`, `:144-155`;
call site `agent_loop.rs:626-631`, `:725-743`). What K6 did **not** build is the way out of
`Ask`. Measured on the base:

1. **The only answer is a CLI command.** The question the loop queues says "Grant it with
   mcp.permissions.set {…}" (`agent_loop.rs:727-731`). An owner clicking in the desktop cannot
   follow that, and the text instructs a person to hand-write JSON.
2. **A permanent `allow` is the only grant.** `mcp.permissions.set` (`lib.rs:3375-3403`) writes a
   store row (`:3389-3393`) and the in-memory table (`:3394-3396`). There is no "just this once".
   Owners facing only "always" will either always-allow or never use the tool.
3. **The question is asked at most once, ever.** The id is `mcp-permission-{server}-{tool}`
   (`agent_loop.rs:727`); `AskUserQueue::enqueue` refuses a duplicate id, answered or not
   (`agent_workflow.rs:609-611`), and `finish_turn` discards that error (`agent_loop.rs:490-492`,
   `let _ =`). After the first question, every later ask for the same tool is silent.
4. **Nothing consumes the blocking contract.** `blocks_run()` (`agent_workflow.rs:654-656`) is
   read only by tests (`agent_loop.rs:1849,1855`; `agent_workflow.rs:1311-1326`). No RPC lists
   pending questions or answers one; `agent.state` (`lib.rs:3147-3187`) carries mode, approvals
   and todos only.
5. **The loop does not know its run.** `AgentLoop` has no run id (struct `agent_loop.rs:239-278`),
   so a grant "for this run" has nothing to bind to. Per-run loops are built at `lib.rs:2161-2168`
   through `build_agent_loop_in` (`lib.rs:5256-5287`).
6. **Arguments are not shown at all**, so even a working Approve button would approve blind.
   `AgentTool::summary` deliberately omits them (`agent_tools.rs:75-91`).

## Goal

A daemon-only change (no UI, no client) that gives the owner a complete, fail-closed approval
path for an agent-initiated MCP call. Settled decisions (each is acceptance-tested below):

### D1. How an owner answers a pending MCP question outside a turn

Two new RPCs on the existing `mcp.*` family, both `with_extensions` and both with a row in
`METHOD_POLICIES` (`auth.rs:265`, MCP rows at `:575-611`):

| Method | Params | Reply | Policy / tier |
| --- | --- | --- | --- |
| `mcp.approvals.list` | — | `McpApproval[]` = `{ id, run_id, server, tool, role, summary, requested_at }` | **Owner / Standard** |
| `mcp.approvals.allow_once` | `id: string` | `McpApprovalAnswer` = `{ id, run_id, server, tool, role, granted_by, expires_at }` | **Owner / Spend** |

Rationale, with evidence:

- **Owner, not Session.** The permission table is "the daemon's own security setting, so only the
  owner reads or writes it; a paired device must not be able to grant itself a tool"
  (`auth.rs:600-602`; rows `:603-611` are Owner). A one-shot grant is a permission write with a
  shorter life; it gets the same gate. `mcp.call` (`:596-599`) and `mcp.connect` (`:575-579`) are
  likewise Owner/Spend. A paired phone cannot approve (open question O3).
- **Spend for the write, Standard for the read.** `mcp.permissions.set` is Spend (`:608-611`) and
  `mcp.permissions.list` is Standard (`:603-606`); mirroring them keeps the ceilings coherent
  (Spend = 20/min burst 60, `auth.rs:876-878`; Standard = 240/min burst 1200, `:880-882`). A
  flood of grants is a flood of tool authorisations, which is what the Spend ceiling is for. Not
  `Auth`: that tier is the gate-decision path for `Session` actors (`auth.rs:539-547`).
- **Outside a turn.** `RunAgentSessions::run_turn` holds the per-run loop mutex for the whole turn
  (`agent_sessions.rs:132-141`); an answer RPC that took that lock would wait out a running turn.
  So pending approvals live in a **separate, shared, synchronous registry** (`McpApprovals`, D2),
  held as `Arc` by both the loop and `DaemonState` (new field next to `mcp_permissions`,
  `lib.rs:371`). The answer RPC never touches the loop lock. The loop mirrors resolutions into its
  own `AskUserQueue` at the start of its next turn (`prepare_turn`, `agent_loop.rs:429`, runs under
  the lock): drain resolved entries for its run and call `ask_queue.answer(id, …)`
  (`agent_workflow.rs:617-638`).
- **The agent does not suspend.** The turn that hits `Ask` still ends with a failed tool result
  (as today, `agent_loop.rs:725-739`); the owner answers whenever; the agent's next call is checked
  again. This is deliberate: a suspended turn would pin the run's loop mutex and the daemon has no
  await-an-answer plumbing (open question O2).
- **The approver is the authenticated device**, never a param: reuse `gate_approver`
  (`lib.rs:1741-1763`) exactly as `agent_switch` does (`lib.rs:1796-1798`).
- **Question ids become unique.** Replace `mcp-permission-{server}-{tool}` (`agent_loop.rs:727`)
  with `mcp-approval-{ulid}` (`ulid` is already a `warsha-pipeline` dependency,
  `Cargo.toml` line 18 of the crate). The registry de-duplicates *pending* asks for the same
  `(run, server, tool, role, args)` (a retrying agent must not spawn one question per attempt) and
  caps pending entries per run at `MAX_PENDING_PER_RUN = 32`; beyond the cap the call fails
  closed with the normal approval-required result and **no new entry** (bounded memory).

### D2. Allow-once: a single-use, in-memory, fail-closed grant

A new `McpApprovals` registry (new file `crates/warsha-pipeline/src/mcp_approval.rs`, re-exported
from `lib.rs` beside `mcp_permission`, `lib.rs:37,45`) holds two std-`Mutex`-guarded maps, same
poison-tolerant style as `StaticPermissions` (`mcp_permission.rs:84-86,109-112`):

- **pending**: `id -> PendingApproval { run_id, server, tool, role, args (serde_json::Value),
  summary, requested_at }`.
- **grants**: `GrantKey { run_id, server, tool, role }` -> `Grant { args, expires_at: Instant }`.
  One grant per key (a second `allow_once` for the same key replaces, never stacks).

Rules:

1. **Bound to run + server + tool + role.** `GrantKey` carries all four. The role is always
   `MCP_AGENT_ROLE` (`mcp_permission.rs:14`) because that is the only role an agent call is
   checked under (`agent_loop.rs:630`); the key still carries it so a future role cannot borrow
   another's grant (same property the table test asserts, `mcp_permission.rs:231-250`).
2. **Also bound to the exact arguments** (stricter than the four-key minimum; open question O1).
   The grant stores the canonical `serde_json::Value` the owner was shown a summary of, compared
   by equality at take time. Without it, the owner approves `write {path: a.txt}` and the agent's
   retry runs `write {path: ~/.ssh/authorized_keys}`. The value stays in memory only: no `Debug`
   derive on `Grant`/`PendingApproval` (a manual `Debug` prints keys, never values), never
   serialised, never logged, never put in an event.
3. **Consumed by exactly the next matching call.** `take(run, server, tool, role, &args) -> bool`
   removes the grant under the lock and returns whether it was present, unexpired and
   argument-equal. It is consulted **only when the table says `Ask`**, at the exact point
   `agent_loop.rs:725` handles `Ask`: `take == true` -> proceed to `mcp.call_tool` as the `Allow`
   arm does (`:634-723`); `false` -> queue the question as today. The grant is spent *before* the
   transport call, so a failed or timed-out call still spends it (fail closed; the agent re-asks).
   A non-matching call (different args/tool/run) neither consumes nor sees the grant.
4. **Never an allow row.** `allow_once` touches neither `store.set_mcp_permission`
   (`lib.rs:3389`) nor `StaticPermissions::set` (`lib.rs:3394`). `McpApprovals` has no store
   handle. `mcp.permissions.list` (`lib.rs:3352-3372`) therefore never shows it, and
   `load_mcp_permissions` (`lib.rs:5206`) has no row for it after a restart.
5. **Gone after a restart.** Registry is process memory; a run's loop and its queue do not
   outlive the process either (`agent_sessions.rs:145-151`). `StaticPermissions::load_from`
   already falls back to `Ask` on a read error (`mcp_permission.rs:135-141`), so the restart
   state is: no rows beyond the store's, no grants, no pending entries -> `Ask`.
6. **Deny and `Allow` always win over a grant.** The grant is not consulted on `Allow` (row
   decides) or `Deny` (`agent_loop.rs:740-743` runs first, grant untouched).
7. **TTL.** A grant expires `MCP_ONCE_GRANT_TTL = 600 s` after issue (monotonic `Instant`);
   expired grants are swept on every registry call. A grant left unspent is not a standing
   authority (open question O4).
8. **Purged on every way the situation changes:**
   - any `mcp.permissions.set` for a key (including the wildcard `tool = "*"`, which purges every
     grant of that server) — any permission value, because even `ask` means "the owner re-decided";
   - `runs.cancel` for that run (`lib.rs:3750-3760`) and `agent_sessions.remove`
     (`agent_sessions.rs:110-118`) -> `purge_run(run_id)`;
   - restart (process memory).

### D3. Allow-always and deny go through the existing `mcp.permissions.set`

No new RPC, no new params, no change to its auth row (`auth.rs:608-611`, Owner/Spend) or its
write-then-memory order (`lib.rs:3387-3396`). Added, after the successful write:

- `McpApprovals::resolve_by_row(server, tool, role, permission)`: for `allow`/`deny`, every
  pending entry the row now decides (exact tool, or all of the server's for `"*"`) is resolved and
  leaves `mcp.approvals.list`; for `ask` pending entries stay. Then `purge_grants(server, tool,
  role)` (D2.8).
- The next call is judged by the table (`agent_loop.rs:626-631`), which is read per call, not
  cached — so **a revoke (`set … deny`, or `set … ask`) on an allow-always row takes effect on the
  very next call**, with no restart and no reload. `StaticPermissions::check_permission` is a
  synchronous read of the live map (`mcp_permission.rs:144-155`).

The resolved entry's queue mirror is answered at the next `prepare_turn` with the text `allow` /
`deny` / `allow_once by <device>` (the existing queue refuses a blank answer,
`agent_workflow.rs:631-635`, so the mirror always carries a word).

### D4. What the agent sees on deny: a `ToolError` in the turn

Add two variants to `ToolError` (`agent_tools.rs:141-183`; its own doc says its values "surface
to the agent as failed tool results", `:20`):

- `McpDenied { server, tool }` -> `#[error("denied by MCP permission {server}::{tool}")]`
- `McpApprovalRequired { server, tool }` -> `#[error("approval required: {server}::{tool} is ask by default")]`

The loop builds the failed result from the error: `ToolResult::failed(call, err.to_string())`.
Both strings are **byte-identical** to the current literals (`agent_loop.rs:733-735,741-742`) so
the existing assertions (`agent_loop.rs:2252,2262`) keep passing unchanged. The agent therefore
sees a failed tool result in the turn on deny (row `deny`, or a `deny` set after a question),
never a silent no-op, and the result never says *who* or *why* beyond the row. An answered
`allow_once` that is consumed shows as an ordinary successful call. The transport is not reached
on deny (acceptance T1).

### D5. The argument summary: built by the daemon, redacted, bounded

The loop (pipeline crate) cannot see the daemon's scrubber (`warshad/src/state.rs`), so add a
seam in `mcp_approval.rs`:

```rust
pub trait ArgumentSummarizer: Send + Sync {
    fn summarize(&self, tool: &str, arguments: &serde_json::Value,
                 input_schema: Option<&serde_json::Value>) -> String;
}
```

`McpApprovals::new(summarizer)`; the default (`None` wired / test default) is a
`KeysOnlySummarizer` that prints key names and `[hidden]` — no value is ever shown unless the
daemon's summarizer is present (fail closed, mirroring `AskEverything`,
`mcp_permission.rs:157-165`). The daemon implementation lives in the new file
`crates/warshad/src/mcp_approvals.rs`, built **by the daemon** and reusing its own redaction:

- **Redaction (any one hit -> `[REDACTED]`, value not shown):** (a) object key in
  `SECRET_KEY_NAMES` (`state.rs:12-21`, case-insensitive as `scrub_value` does, `:38-40`);
  (b) property marked secret in the tool's schema — `"writeOnly": true` or `"format": "password"`
  on `input_schema.properties.<key>` (`McpTool.input_schema`, `mcp.rs:124-128`; the connection
  already carries `tool_definitions`, `mcp_transport.rs:269`, the loop already reads them at
  `agent_loop.rs:588`); (c) a string value that `redact_string` flags (`state.rs:53-57`: auth
  token, `sk-…`, `Bearer …`) — make that function `pub(crate)`; (d) a string passed through
  `warsha_core::mask_secrets` (`redaction.rs:34-36`, URL `?key=`/`token=` params). Applies at every
  depth before any truncation.
- **Bounds:** top-level keys sorted; at most 12 keys shown (`… +N more keys`); a string value cut
  at 80 chars on a char boundary with `…`; a nested object/array shown as `{N keys}` / `[N items]`
  (depth 1 only, never recursed into for display); the whole summary hard-capped at 400 chars
  (`…`). Control characters and newlines in values are neutralised by rendering each value with
  `serde_json::to_string` (escapes them) — a value containing `\n Approve? yes` cannot forge
  question text.
- **Never in the event stream or logs:** the summary is computed once, stored in `PendingApproval`
  and `AskUserRequest.question`, returned by `mcp.approvals.list`; the raw `args` are held only
  inside the registry for D2.2 equality. No `tracing` call anywhere in the new code takes `args`,
  `summary` or the question. Events written by the daemon (below) carry `server`, `tool`, `role`,
  `question_id`, `granted_by` only.
- **Honest limit:** a secret that is not key-named, not schema-marked and not token-shaped cannot
  be recognised by any redactor. The test asserts the *marked* ones; the packet does not claim
  more (open question O8).

### D6. The question text stops instructing a CLI command

New text (English constant, no RPC name, no JSON):

> `The agent wants to run {server}::{tool} (role {role}) with: {summary}. Allow once, always allow, or deny?`

Question text carries no `mcp.permissions.set` (acceptance T9 asserts its absence). The existing
test that asserts the old wording (`agent_loop.rs:2267-2268`,
`assert!(question.question.contains("mcp.permissions.set"))`) is replaced by the inverse assertion
plus the summary assertion; that is a required test change, not a weakening, and the Coder lists
it in the report. The text is not an i18n string: it is daemon output the agent loop already
composes in English (`:727-731`); localised rendering of the structured `McpApproval` fields is
B3b's. The `mcp.call` RPC's refusal message (`lib.rs:3339-3343`, asserted at `:13036`) addresses a
programmatic owner caller and stays unchanged (open question O6).

### Audit trail

`mcp.approvals.allow_once` appends one event with the same shape as the followup path
(`lib.rs:3838-3858`): `kind: EventKind::ToolCall`, `stage = run.current_stage` (via
`store.get_run`, `warsha-store/src/lib.rs:412`), `payload = {action: "mcp_allow_once", server,
tool, role, question_id}`, `device_id = Some(granted_by)`. The event bus scrubs payloads on the
way out anyway (`lib.rs:6086-6096`; `get_events` `:2272-2282`), but the payload is clean by
construction. A failed `append_event` fails the RPC and **no grant is issued** (record first, as
`agent_switch` does, `lib.rs:1773-1777`).

## Allowed files (the Coder packet owns exactly these)

- `crates/warsha-pipeline/src/mcp_approval.rs` (new): `McpApprovals`, `PendingApproval`, `Grant`,
  `ArgumentSummarizer`, `KeysOnlySummarizer`, constants, unit tests.
- `crates/warsha-pipeline/src/mcp_permission.rs`: only if a shared constant/doc line is needed
  (no behaviour change to `ToolPermission` or `StaticPermissions`).
- `crates/warsha-pipeline/src/agent_loop.rs`: `run_id` + `approvals` fields and builders
  (`with_run_id`, `with_mcp_approvals`), the `Ask` arm (`:725-739`), the deny arm (`:740-743`),
  `prepare_turn` mirror drain, `PreparedTurn` field, the question text; its `mcp_permission` test
  module (`:2164-…`).
- `crates/warsha-pipeline/src/agent_tools.rs`: the two `ToolError` variants + a test.
- `crates/warsha-pipeline/src/lib.rs`: `mod mcp_approval;` + re-exports.
- `crates/warshad/src/mcp_approvals.rs` (new): the daemon `ArgumentSummarizer`, the two RPC
  reply structs, helper to build the audit event, unit tests.
- `crates/warshad/src/lib.rs`: `mod mcp_approvals;`, the two `#[method]` declarations next to
  `:873-883`, handlers next to `:3352-3403`, the `DaemonState.mcp_approvals` field (`:371`) and
  **both** struct literals (`:6057-6059`, `:7545-7547`), `build_agent_loop_in` wiring
  (`:5256-5287`, call sites `:2161`, `:5244`, `:7670`), the `set_mcp_permission` hook, the
  `runs.cancel` purge (`:3750-3760`), and the daemon tests. `lib.rs` is contended: the Coder
  rebases on the live tip and touches only these hunks.
- `crates/warshad/src/auth.rs`: two `METHOD_POLICIES` rows (after `:611`).
- `crates/warshad/src/auth_tests.rs`: the Owner list (`:100-113`) and tier assertions for both
  methods.
- `crates/warshad/src/state.rs`: `redact_string` -> `pub(crate)` only.
- `crates/warshad/tests/security_identity.rs`: a paired device is refused both methods (extend the
  owner-only table around `:328-336`).
- `docs/DAEMON.md`: rows for `mcp.approvals.list`, `mcp.approvals.allow_once` (the file has no
  `mcp.*` rows today). The shared checkout carries an uncommitted foreign edit to this file (one
  line); the Coder works in its own worktree from the base and must not copy that change.
- `docs/zadloop/packets/R-BRIDGE-B3a-report.md` (the Coder's report; new).

**Deliberately absent:** `packages/client/src/index.ts`, `apps/desktop/e2e/harness.ts`. The wire
checker compares client<->daemon (W1), harness<->daemon (W2) and client->harness (W9); a daemon
method the client never calls adds no violation (the client carries no `mcp.*` call today). B3b
adds the client wrappers and harness stubs together so W9 stays satisfied.

## Out of scope

Any UI, client, i18n or harness change (B3b); suspending a turn mid-call (O2); phone/paired-device
approval (O3); persisting grants or pending entries; a "revoke this unspent grant" RPC (revoking
is `mcp.permissions.set`, or waiting out the TTL — a purge RPC is a possible B3b ask); changing
`mcp.call`'s behaviour; changing `ToolPermission` semantics or the store schema; i18n of the
daemon question text; the owner's own `agent.turn_run` reply, which echoes raw call arguments
(`agent_tools.rs:59-67` serialised in `ToolResult.tool`) to the Owner-only caller (`auth.rs:528`)
— noted as a residual, not fixed here (O8).

## Steps

1. `mcp_approval.rs`: registry, grant key/value, TTL, per-run cap, dedupe, `take`, `purge_*`,
   `resolve_by_row`, `drain_resolved(run_id)`, manual `Debug` (keys only). Unit tests for each
   rule in D2 using a manual clock-free TTL seam (`take_at(now)`).
2. `agent_tools.rs`: the two `ToolError` variants.
3. `agent_loop.rs`: wire `run_id` + registry; `Ask` arm = `take` then call, else register pending
   (summary via the seam) + enqueue question with unique id; deny arm via `ToolError`; mirror drain
   in `prepare_turn`. A loop with no `run_id` or no registry never consumes a grant (fail closed).
4. `warshad/src/mcp_approvals.rs`: summarizer + reply structs + audit-event builder.
5. `lib.rs` + `auth.rs` + `auth_tests.rs` + `state.rs`: RPCs, rows, state field (both literals),
   `set_mcp_permission` hook, `runs.cancel` purge, `build_agent_loop_in` takes the registry and the
   run id (call at `:2161` passes `run.id`; the daemon-wide loop at `:5244` passes none).
6. Daemon tests (T4–T10) and `security_identity.rs` rows.
7. `docs/DAEMON.md` rows; the report with every command's output.
8. Discrimination: with the `take` call deleted T2 must fail; with the `Deny` arm moved below the
   grant check T1 must fail; with the redaction call removed T7 must fail. Save the three failing
   outputs under `target/` and quote them.

## Acceptance (frozen; exact commands)

Behavioural tests (names are the filter the Coder uses; the counting transport is the
`RecordingMcp` shape already at `agent_loop.rs:2167-2230` / `lib.rs:12886-12925`, counting
`call_tool` invocations):

| # | Test (module `mcp_approval` in the named crate) | Proves |
| --- | --- | --- |
| T1 | `warsha-pipeline`: `denied_call_reaches_the_transport_zero_times` | Deny row -> counter 0; result is the `ToolError::McpDenied` string; a live `allow_once` grant for the same key does **not** override it |
| T2 | `warsha-pipeline`: `allow_once_reaches_the_transport_exactly_once_then_asks_again` | Ask + one grant -> counter 1; the **second identical call** -> counter still 1, a *new* pending question exists (unique id), result is `approval required` |
| T3 | `warsha-pipeline`: `a_revoke_takes_effect_on_the_next_call` | Allow row -> call (counter 1); `set` Deny -> next call (counter still 1, denied); also: an unspent grant + `set` for the key -> next call asks (counter unchanged) |
| T4 | `warsha-pipeline`: `a_grant_is_bound_to_run_server_tool_role_and_arguments` | each of the five differing fields -> not consumed, counter 0, grant still present for the matching call |
| T5 | `warsha-pipeline`: `grant_expires_and_pending_is_capped_and_deduped` | TTL via `take_at`; 33rd pending refused with no entry; identical retry reuses one id |
| T6 | `warshad`: `allow_once_rpc_is_owner_only_and_never_writes_a_row` | paired -> `-32002` (FORBIDDEN, `auth.rs:1415`); owner -> grant; `mcp.permissions.list` shows no row; store `load_mcp_permissions` empty; events carry `mcp_allow_once` with no args |
| T7 | `warshad`: `no_secret_argument_value_reaches_question_events_list_or_logs` | call with `{"api_key":"SECRET-1","note":"Bearer SECRET-2","password":"SECRET-3","path":"a.txt"}` plus a schema-marked `writeOnly` property `{"blob":"SECRET-4"}`; assert no `SECRET-` substring in: the queued question text, `mcp.approvals.list` JSON, `get_events` and `events.sync` output, and a captured `tracing` buffer (`tracing_subscriber::fmt().with_writer(<Arc<Mutex<Vec<u8>>>>)` installed with `set_default` for the duration of a current-thread runtime test); `path` **does** appear (the summary is useful, not blanked) |
| T8 | `warshad`: `summary_is_bounded_and_cannot_forge_a_question` | 10 kB string + 200 keys -> summary <= 400 chars; a value containing `\nApprove? yes` renders escaped on one line |
| T9 | `warsha-pipeline`: `question_text_does_not_instruct_a_cli_command` | question contains `{server}::{tool}` and the summary; does not contain `mcp.permissions.set` |
| T10 | `warshad`: `grants_and_pending_do_not_survive_a_restart` | issue a grant; build a fresh state over the same data dir; call -> asks, counter 0 |
| T11 | `warshad`: `allow_always_and_deny_resolve_pending_through_permissions_set` | `set allow` -> pending gone, next call counter 1 with no grant; `set deny` -> pending gone, next call 0 |

Commands (run from the worktree root; each must exit 0 and the Coder quotes the tail):

```
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test -p warsha-pipeline mcp_approval
cargo test -p warsha-pipeline mcp_permission
cargo test -p warshad mcp_approval
cargo test -p warshad --test security_identity
cargo test --workspace --all-targets
node scripts/check-wire-contract.mjs --self-test && node scripts/check-wire-contract.mjs
node scripts/check-engineering-policy.mjs --self-test && node scripts/check-engineering-policy.mjs
node scripts/check-arch.mjs --self-test && node scripts/check-arch.mjs
```

Expected tails: `wire: 11 checks, 0 violations` (measured on the base:
`wire: 11 checks, 0 violations`; self-test `11 checks fire, clean fixture is clean in both
modes`), `policy: 8 checks, 0 failures`, `arch: 5 rules, 0 violations`. A passed count below the
last recorded baseline is a finding. The in-crate "every method has a policy, every policy names a
method" test (`lib.rs` ~`:12960` region) stays green with the two new rows.

Review gate: an independent Reviewer pass (never the Coder, never edits) with **no open HIGH**
finding before B3b starts; the Reviewer is asked specifically about: grant consumption races,
the argument-binding decision (O1), every path that could print `args`, and the purge triggers.

## Constraints

- Fail closed everywhere: a missing registry, a missing run id, a poisoned lock, an unknown
  question id, an expired grant, an unavailable summarizer -> `Ask` / refuse, never `Allow`.
- No `unwrap()`/`expect()` in non-test code; poisoned locks recover with `into_inner` as
  `mcp_permission.rs:110-112` does. `thiserror` for errors.
- No secret in logs, events, question text or the report; test secrets are obviously fake
  literals (`SECRET-n`) so gitleaks stays quiet.
- No network calls to real model APIs; mock/recording transports only.
- Do not weaken a test: the only edited existing assertion is the CLI-wording one (D6), replaced by
  its inverse.
- Small Conventional Commits on a `zl-b3a-*` branch from the then-current merge tip; implementer
  never authors gates; reviewer separate; verifier separate; no push/PR/tag by the agent.
- `crates/warshad/src/lib.rs` is contended: rebase before the first edit; if a foreign change
  overlaps a hunk above, stop and report the overlap.

## Done

T1–T11 pass with the three discrimination failures quoted; every command above exits 0 with its
tail quoted; both `METHOD_POLICIES` rows and the `auth_tests.rs`/`security_identity.rs` assertions
land; the question text contains no CLI instruction; `docs/DAEMON.md` has the two rows; the
Reviewer reports no open HIGH; the report lists every edited existing test.

## Open questions (Planner recommendation for each)

- **O1 — bind the grant to the arguments?** The brief names run/server/tool/role. Recommendation:
  **also bind the exact arguments** (this spec does). It is the difference between "approve what I
  was shown" and "approve any call to the tool this run"; cost is one extra re-ask when the agent
  changes arguments. If the PM wants the four-key form, delete D2.2 and T4's argument case; nothing
  else changes.
- **O2 — suspend the turn vs. re-ask next turn?** Recommendation: **re-ask next turn** (this
  spec). Suspending needs the run's loop mutex (`agent_sessions.rs:137-141`) released while
  waiting, a wake-up channel, and cancellation on `runs.cancel`; the benefit is only that the agent
  need not retry. Revisit after B3b shows how owners actually answer.
- **O3 — may a paired phone approve?** Recommendation: **no for B3a** (Owner-only, matching
  `auth.rs:600-611`). If wanted later it is a policy-row change (`Session`/`Auth`) plus the same
  `gate_approver` identity rule; it deserves its own threat review.
- **O4 — grant TTL.** Recommendation: **600 s**, constant `MCP_ONCE_GRANT_TTL`; shorter risks
  expiring while the owner reads, longer leaves an unspent standing authority.
- **O5 — `ToolError` variants vs. keeping string literals.** Recommendation: **variants** (D4):
  the brief asks for a `ToolError`, the strings stay byte-identical so no test churn.
- **O6 — `mcp.call` RPC message still tells the caller to use `mcp.permissions.set`**
  (`lib.rs:3339-3343`). Recommendation: **leave it**: it answers a programmatic Owner call that
  has no approval queue; D6 is about the agent's question.
- **O7 — daemon-wide loop (`lib.rs:5244`) has no run id.** Recommendation: it never consumes a
  grant and never registers pending entries (its `agent.turn` is retired, `lib.rs:3077-3092`), so
  it stays at plain `Ask` as today.
- **O8 — residuals.** (a) A secret not key-named, schema-marked or token-shaped cannot be
  redacted by any filter; B3b's UI should label the summary "redacted preview". (b) The Owner's
  `agent.turn_run` reply echoes the raw call arguments (`ToolResult.tool`); not an
  approval-path leak (Owner-only) but a thing the security audit should see.
