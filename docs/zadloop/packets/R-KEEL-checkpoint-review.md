# R-KEEL checkpoint — independent security review of K4 + K5 + K6 (Reviewer lane)

- Tree: worktree at `4e974db`, branch `zl-keel-checkpoint`, clean at the start of this pass
- Reviewer: Reviewer lane (independent of the K4/K5/K6 authors), **read-only**: no product code, test or config
  was edited; the only write of this pass is this file. No fixes were applied, even where a HIGH was found —
  the PM dispatches repairs.
- Method: the *code* was read as the judge, not the prior labels. `COMPLETION_STATUS.md:8,17,21` records
  K4/K5/K6 as `DONE` with APPROVE labels and, in the same table, records that the independent reviews were
  `BLOCKED` (broken delegation channel). Those labels are claims; every row below is a `file:line` reading of
  the enforcement path, and where a claim was checkable on this host it was checked.
- Verdict: **CHECKPOINT FAIL** — two open HIGH findings (rows 1 and 2). No fix applied.

## Audit table

Ordered K4 → K5 → K6 → CSP/ACL. "HIGH" per the checkpoint rule: a real bypass, or an unenforced check, in a
production path. A test that does not prove its property is at most MEDIUM.

| # | file:line | severity | issue | proposed minimal fix |
|---|---|---|---|---|
| 1 | `crates/warsha-pipeline/src/gate_evidence.rs:168-209` (`run_tests`), reached from `crates/warshad/src/lib.rs:2826-2847` | **HIGH** | `gates.evidence` runs the owner-named program through a bare `tokio::process::Command` (`:175-183`) with **no `env_clear()`, no `MINIMAL_CHILD_ENV` floor, no `process_group(0)`**, and on timeout only returns `Timeout` (`:208`) so `kill_on_drop` ends the direct child with no explicit reap and no group signal. The child is the project's own test command — i.e. code the agent authored in the run worktree — so it inherits whatever the daemon process was launched with (owner shell exports, `AWS_*`/`GITHUB_TOKEN`-style variables, `WARSHA_*` behaviour overrides) and a forked test runner survives the timeout. K4's env-clear and kill-the-whole-child properties hold only at the `CommandPolicy` site; this second execution path enforces just the allow-list. Qualifier: the handler is wire-reachable by any owner-credentialed client but has no in-repo UI/CLI caller yet (`grep` over `apps/`, `packages/`: none). | Route gate evidence through the K4 policy: `CommandPolicy::from_config(...).execute(&program, &args, &work_dir)` (or export a small `execute_captured` that reuses `command_for`'s env floor + `process_group(0)` + group kill/reap), and delete the private spawn in `run_tests`. |
| 2 | `crates/warshad/src/lib.rs:3823-3857` (`connect_mcp`), against the stated intent at `:2236-2251` (`check_plugin_launch`) | **HIGH** | `mcp.connect` never calls `wave2::require_pinned_launch`. The Stdio arm checks only `policy.check_command(command)` (`:3839`), and `npx` is in the default allow-list (`crates/warshad/src/auth.rs:986`), so `{"transport":"stdio","command":"npx","args":["@modelcontextprotocol/server-github"]}` spawns an **unpinned** MCP child through `McpManager::connect` → `spawn` → `command_for` (`crates/warsha-pipeline/src/mcp_transport.rs:912-928`, `crates/warsha-pipeline/src/process_spawn.rs:411-435`). The pin grammar exists and is two-sided (`crates/warshad/src/wave2.rs:765-873`, tests `wave2_k5_tests.rs:11-50`) but is wired only into `plugins.install`/`toggle`/`configure` (`lib.rs:4691`, `:4734`, `:4803`). `check_plugin_launch`'s own docstring claims `mcp.connect` is held to "does it name a pinned release" — the code contradicts its comment. Owner-tiered (`auth.rs:566-569`), no in-repo UI caller yet, but it is a declared production launch path and the packet's rule is absolute ("MCP children launch only from PINNED packages"). | `wave2::require_pinned_launch(command, &config.args).map_err(rpc_policy_refused)?` in the Stdio arm of `connect_mcp` (one line, same as `check_plugin_launch`), plus the negative test: `mcp.connect` with `npx @scope/server` → `POLICY_REFUSED`, pinned variant connects. |
| 3 | `crates/warsha-pipeline/src/command_policy.rs:76,327-334` | MEDIUM | The "no shell metacharacters" rule is applied to the **program token only**, so an allow-listed *tool* whose own arguments interpret code still reaches a shell. Verified on this host: `git -c 'alias.k4probe=!echo shell-reached' k4probe` → `shell-reached`, exit 0. `node -e …`/`npm run …` do the same by design (that is what the allow-list admits), but the refusal text at `:149` promises "only a program and its arguments may run", which is not what the gate enforces. | Either narrow `git`'s admitted argument grammar (refuse `-c`, `--exec-path`, `-c core.pager=`-shaped args) or state the boundary where it belongs: `SECURITY.md`/K8 trust-boundary text says an allow-listed toolchain may execute arbitrary code with its own arguments, and the allow-list bounds *which programs*, not what they run. |
| 4 | `crates/warsha-pipeline/src/process_spawn.rs:826-850` (`restart`) | MEDIUM | `restart` re-spawns the stored command with **no policy re-check**; the allow-list is applied only by the RPC edges (`lib.rs:3780`, `:3839`, `:3968-3971`). A configuration narrowed after a spawn leaves a path that re-launches a program the daemon would now refuse, and `ProcessManager` itself holds no policy. | Re-check `check_command` inside `restart` (needs the policy handed to the manager), or have the daemon refuse a restart of a row whose program no longer passes. |
| 5 | `crates/warshad/src/lib.rs:2264-2289` (`resolved_plugin_env`) | MEDIUM | `${secrets:<account>}` is resolved against **any** keychain account; nothing binds the account to the pack. A manifest can name `plugin:other-pack:TOKEN` or a provider/integration account, and `split_plugin_env` preserves such a reference verbatim (`crates/warshad/src/wave2.rs:912-918`). The child-env scoping itself is correct (only named variables, floor underneath); the *namespace* of what may be named is unbounded. | Require the reference to equal `plugin:{definition.id}:{KEY}` (i.e. `plugin_env_account(definition.id, key)`) and refuse any other account in `resolved_plugin_env`. |
| 6 | `crates/warshad/src/lib.rs:3874-3901` (`send_mcp`, `call_mcp`) | MEDIUM | Both reach the transport with only the Owner authorization: `call_mcp` dispatches straight to `McpManager::call_tool` (`:3895-3899`) with **no `(server, tool, role)` consultation**, and `send_mcp` writes an arbitrary frame (`:3879-3884`), so a hand-built `tools/call` frame bypasses the table entirely (`mcp_transport.rs:1039-1081`). K6's "no path reaches the transport without the check" therefore holds for the *agent role* only. Not rated HIGH because both methods are `Policy::Owner` (`auth.rs:574-585`) and the owner is the same principal that writes the table via `mcp.permissions.set` — no privilege boundary is crossed today. | Consult the table in `call_mcp` (role `MCP_AGENT_ROLE`, or a distinct `rpc` role) before dispatch, and refuse `mcp.send` payloads whose `method` is `tools/call`. |
| 7 | `crates/warsha-pipeline/src/agent_loop.rs:2300-2315` (`auto_discovery_checks_the_resolved_server`) | MEDIUM | Does not prove the property it names. It asserts only `!turn.tools[0].success` and `mcp.calls().is_empty()`; the `Ask` arm satisfies both. Delete the resolved-name check, or check a blank/client-supplied name instead, and the call falls to `Ask` — the test still passes. It also never asserts `ask_queue.is_empty()`, so `Ask` and `Deny` are indistinguishable here. The distinguishing assertion (`output.contains("denied by MCP permission")`) is exactly what the sibling test has (`:2244`). | Add `assert!(turn.tools[0].output.contains("denied by MCP permission"))` and `assert!(agent_loop.ask_queue.is_empty())`. |
| 8 | `crates/warshad/src/lib.rs:6323` vs `apps/remote/index.html:44-46` vs `apps/desktop/src-tauri/tauri.conf.json:31` | MEDIUM | The three CSP strings do **not** match, though `apps/remote/index.html:34-45` says they "read the same": `object-src 'none'` and `base-uri 'self'` appear **only** in `tauri.conf.json`. The daemon middleware and the remote meta fall back to `default-src 'self'` for both directives, i.e. same-origin plugin content is permitted rather than none. `frame-ancestors 'none'` is present in all three; `'unsafe-inline'`/`'unsafe-eval'` are absent from `script-src` in all three (see the confirmation section below). | Append `object-src 'none'; base-uri 'self';` to the daemon string and the remote meta, and keep one canonical string quoted in the docs so the three cannot drift again. |
| 9 | `crates/warshad/src/lib.rs:6321-6337`, layered at `:6358` | MEDIUM | No test asserts the CSP response headers. Removing `.layer(csp_middleware)`, or any of the three header inserts, leaves the suite green — the delta's whole point is unverified by test. | One HTTP test against `/health` (and one static asset) asserting `Content-Security-Policy` equals the canonical string plus `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY`. |
| 10 | `crates/warsha-pipeline/src/command_policy.rs:346-352` | LOW | The allow-list accepts any token whose **basename** matches an entry, so `/tmp/whatever/npm` and `./git` pass (the latter is asserted as correct at `:710-713`). Mitigated: the executor's only write tool writes content and cannot set an executable bit (`crates/warsha-pipeline/src/agent_tools.rs:410-433`), and `node`/`npm` already admit arbitrary project code by design. | Accept a bare program name, plus a path only when it lies inside `working_dir`; otherwise document the basename rule as intentional. |
| 11 | `crates/warsha-pipeline/src/command_policy.rs:277-283`; `crates/warsha-pipeline/src/agent_tools.rs:284` | LOW | `CommandPolicy::deny_all` has no caller anywhere, and `FilesystemToolExecutor::new` silently installs the *permissive* default list if nobody overrides. Today the daemon overrides it in exactly one place (`lib.rs:5503-5506`); a future executor built elsewhere would be default-allowed rather than fail-closed. | Remove `deny_all` or use it as the `new` default and require an explicit allow-list; assert in a test that a daemon-built executor is not default-allowed. |
| 12 | `crates/warshad/src/auth.rs:972-1116` | LOW | The daemon keeps a second, independent allow-list (`ProcessPolicy`) whose rules differ from `CommandPolicy`: no `SHELL_COMMANDS` branch (shells are refused only by absence from the list, `:972-975`) and any rooted path resolving inside `data_dir` is admitted unlisted (`:1101-1102`). Two implementations of one rule can disagree, and K4's test named `agent_command_execution_obeys_daemon_allowed_commands_policy` (`lib.rs:10807-10882`) actually exercises the **pipeline** policy, not this one. | Add the shell branch to `ProcessPolicy`; either share one list/one grammar or add a test that the two refuse the same inputs. |
| 13 | `crates/warsha-pipeline/src/agent_loop.rs:2266-2283` (`allow_calls_the_transport_exactly_once`) | LOW | Vacuous with respect to the check: with the permission lookup deleted, one dispatch of the same server/tool/args still satisfies every assertion. (The sibling `deny`/`ask` tests and the warshad end-to-end test are not vacuous, so the property is covered elsewhere.) | Use a source that records lookups, or pair it with a deny-first case in the same table. |
| 14 | `crates/warsha-pipeline/src/mcp.rs:272-278,416-443` | LOW | A second `ToolPermission` (`Pending`/`Allowed`/`Denied`/`Revoked`, default `Pending`, keyed by `role as i32`) lives in `McpRegistry` and is enforced in `McpClient::call_tool`. `McpClient` has no production constructor (only `mcp.rs:620`), so the live gate is the `mcp_permission` table — but two models with the same name invite the wrong one being wired later. | Delete the `McpClient` table, or mark the type `#[deprecated]`/`#[cfg(test)]` so it cannot be wired by mistake. |
| 15 | `crates/warshad/src/lib.rs:6323` | LOW | `script-src 'self' data: blob:` re-admits inline-shaped script despite the absence of `'unsafe-inline'`: a document that can construct a `blob:`/`data:` URL can execute script from it. | Drop `data:` and `blob:` from `script-src` (they are not needed there for the bundled fonts or styles). |
| 16 | `crates/warshad/src/lib.rs:4737-4764`, `:4806-4831` | LOW | `toggle`/`configure` persist `enabled` (and the new environment) **before** connecting; a failed connect is surfaced to the caller (good) but leaves a row marked enabled with no process, and nothing re-derives that state until the next toggle. | Persist after a successful connect, or roll back on failure. |
| 17 | `crates/warsha-pipeline/src/mcp_transport.rs:958-974` | LOW | A failed handshake's cleanup `stop` error is `tracing::warn!` only (the handshake error is still returned), so a child that survives the stop is reported nowhere. | Fold the stop failure into the returned error text. |
| 18 | `crates/warshad/src/lib.rs:6542-6640`, call at `:6655`; `docs/src/security.md:58-61`; `SECURITY.md:87-89` | LOW | `restrict_file_to_owner` is correctly wired — it runs on the temporary file **before** `write_all` and the result is renamed into place, with an explicit single-owner DACL and `PROTECTED_DACL_SECURITY_INFORMATION` (not a NULL DACL), which matches the documented intent. Residual: no test exercises it on any platform, and two security docs still state that Windows inherits the profile directory's ACL, which is now stale. | Add a `#[cfg(windows)]` test asserting a second principal is denied (or record the untested status explicitly) and update the two doc lines. |

## Per-packet verdicts

**K4 — `RunCommand` policy: NOT MET (one HIGH, row 1).** On the `RunCommand` path the enforcement is real and
in the right place: `FilesystemToolExecutor::run_command` (`agent_tools.rs:437-447`) can only reach a spawn
through `CommandPolicy::execute`, which re-checks `check_program` *inside* the same function before
`Command::new` (`command_policy.rs:379-406`), so there is no "check here, spawn there" gap; a refusal becomes a
failed tool result and no process exists (`agent_tools.rs:479-482`). `env_clear()` + the fixed floor +
`kill_on_drop` + `process_group(0)` + group `SIGKILL` + explicit `wait()` are all present
(`:392-401`, `:458-480`). The wiring is the configured list, not the default (`lib.rs:5503-5506`,
`6075-6102`, `2773-2780`). The tests prove the properties rather than the happy path:
`a_child_that_prints_its_environment_sees_none_of_the_daemons_variables` (`:807-871`) plants five daemon
variables and asserts absence **and** the presence of the floor; `the_child_inherits_the_daemons_path_but_no_secret`
(`:875-927`, in `command_policy.rs` — the brief lists it under `process_spawn.rs`) asserts PATH equality to the
daemon's own and canary absence in the same output; `a_sleeping_child_is_killed_at_the_timeout_and_no_process_remains`
(`:938-975`) checks OS-level liveness of the pid, not just the error variant; and
`a_timed_out_command_takes_its_descendants_with_it` (`:983-1010`) proves the group kill with a recorded
grandchild pid. The HIGH is that the *engine's other execution path* — Gate C evidence — was never given that
treatment, and K4's own text is absolute ("every command the agent/engine runs", "the child environment is
CLEARED"). Secondary MEDIUM/LOW: arg-level shell reach through allow-listed tools (row 3), no re-check on
restart (row 4), the basename rule (row 10), `deny_all` unused (row 11), and the second allow-list (row 12).

**K5 — MCP spawn hardening: NOT MET (one HIGH, row 2).** Three of the four properties are enforced on the
paths that implement them. Environment scoping is genuine: `McpLaunchOptions` is daemon-side only
(`mcp_transport.rs:180-211`), `command_for` does `env_clear()` → floor → trusted `PATH` → the caller's named
variables minus `DENIED_CHILD_ENV_KEYS`/`DYLD_*` (`process_spawn.rs:411-435`), raw manifest values go to the
keychain and the row keeps a `${secrets:…}` reference (`wave2.rs:912-918`, `lib.rs:2214-2232`), and
`${env:…}`/`${config:…}` are refused rather than resolved (`lib.rs:2275-2282`). `plugins.install`,
`plugins.toggle` (enable only) and `plugins.configure` all pass `check_plugin_launch`
(`lib.rs:2244-2255`, call sites `:4691`, `:4734`, `:4803`), which applies the allow-list **and** the pin
grammar; a fresh daemon seeds every bundled pack disabled. Errors surface: spawn → `ProcessSpawn` →
`McpTransportError::Spawn` → RPC error (`mcp_transport.rs:928-941`, `lib.rs:4757-4764`, `:4824-4831`), and
`toggle_plugin_returns_an_rpc_error_when_mcp_connect_fails` (`:9916`) covers it. The tests are two-sided and
not vacuous in the places that matter: `install_refuses_an_unpinned_package_launch` (`:11144-11184`) refuses
the unpinned form **and** installs the pinned one **and** asserts no row was left behind;
`a_launch_gets_only_the_named_keychain_secret` (`:11274-11340`) proves the keychain value reaches the child,
the row holds a reference not the material, and a daemon-only variable does not reach it; the
`pin_grammar_*` / `transport_bypass_*` families (`wave2_k5_tests.rs:11-85`) cover ranges, wildcards, `latest`,
`--package` forms and a non-stdio manifest carrying a command. What is missing is the fourth launch path:
`mcp.connect` launches a stdio child with the allow-list only, so the pin rule is unenforced there (row 2), and
the keychain account it resolves is caller-chosen rather than pack-scoped (row 5).

**K6 — MCP permission at the call site: MET, with two MEDIUM reservations.** The agent path is correct: the
check sits in the same function as the dispatch, on the **resolved** server name and the same `tool` argument
that is then dispatched (`agent_loop.rs:584-591`, `:626-637`), defaults to `Ask` when no source is wired
(`:630-632`), and the `Ask`/`Deny` arms return before the transport is touched (`:725-743`). Resolution is
`(server, tool, role)` → `(server, "*", role)` → `Ask` (`mcp_permission.rs:144-155`), so a role cannot borrow
another role's allow (test `:237-256`), exact beats the wildcard, unknown strings parse to `Ask` and the RPC
path refuses them outright (`parse_strict`, `:53-62`; `lib.rs:3930-3936`), the store has a `CHECK` constraint
(`migrations/004_mcp_permissions.sql:10`), and a failed table load leaves everything `Ask`
(`mcp_permission.rs:136-141`, test `:288-311`). `set` writes the store before memory so a failed write cannot
grant in the running loop (`lib.rs:3938-3952`). Tests that do prove their property: `deny_never_reaches_the_transport`
(`:2227-2245`, message + no call + empty queue), `ask_queues_one_question_and_never_reaches_the_transport`
(`:2247-2264`), `a_loop_with_no_source_asks` (`:2285-2298`), and the end-to-end
`default_ask_blocks_the_agent_and_allow_lets_it_through` (`lib.rs:11856-11890`) whose **first half** is the
discriminating one. Tests that do not: `auto_discovery_checks_the_resolved_server` (row 7, MEDIUM) and
`allow_calls_the_transport_exactly_once` (row 13, LOW). The MEDIUM reservation beyond the test is that two
Owner-tiered wire methods reach the transport without consulting the table (row 6) — an invariant gap, not a
principal escalation, so it does not gate the checkpoint on its own. `a_paired_device_is_refused_both_permission_rpcs`
(`lib.rs:11892-11917`) is genuine: it seeds an active pairing and asserts `FORBIDDEN` on both `list` and `set`.

## CSP / ACL delta — confirmation

- **No `'unsafe-inline'`/`'unsafe-eval'` in `script-src`: confirmed** in all three surfaces —
  `tauri.conf.json:31` `script-src 'self' data: blob:`; `apps/remote/index.html:46` the same;
  `crates/warshad/src/lib.rs:6323` the same. `'unsafe-inline'` appears only in `style-src`, with the
  Vite-HMR justification written at `lib.rs:6314-6320` and `index.html:39-42`.
- **`frame-ancestors 'none'`: confirmed** in all three, plus `X-Frame-Options: DENY` from the middleware
  (`lib.rs:6331-6336`) — which is the half a meta tag cannot enforce, as `index.html:42-43` says.
- **`object-src 'none'`: partial — mismatch (row 8).** Present only in `tauri.conf.json:31`
  (with `base-uri 'self'`). Absent from the daemon middleware and the remote meta, where `object-src`
  falls back to `default-src 'self'` rather than `'none'`. Since the daemon string is documented as the
  mirror of the remote meta and of the webview policy, this is a delta, not a design choice that is written
  down anywhere.
- **The middleware is actually `.layer()`ed: confirmed** — `lib.rs:6355-6360`, `csp_middleware` wraps the router
  (static fallback included) inside `auth_middleware`, before `cors`. `nosniff` and `X-Frame-Options` are set
  in the same `map_response`. Caveat: no test asserts any of it (row 9).
- **The ACL call is wired into `write_private_file`: confirmed** — `lib.rs:6639-6666`, with
  `restrict_file_to_owner(&temporary)` at `:6655` *before* `write_all`, an explicit
  `ACCESS_ALLOWED_ACE` for the process owner's SID, and `PROTECTED_DACL_SECURITY_INFORMATION` so the parent
  directory cannot widen it (`:6542-6640`, DACL built at `:6605-6622`). It is the documented intent ("the ACL is written
  before the content", `:6530-6537`) and it deliberately avoids a NULL DACL. Two residuals: it is untested on
  any platform, and `docs/src/security.md:58-61` / `SECURITY.md:87-89` still describe Windows as
  ACL-inherited — stale after this delta. Windows-only code; this host cannot execute it (row 18).

## What was and was not verified here

- Read in full or in the cited ranges: `command_policy.rs`, `gate_evidence.rs`, the `RunCommand` chain in
  `agent_tools.rs`/`agent_loop.rs`, `process_spawn.rs` (spawn/env/restart), `mcp_transport.rs`
  (connect/handshake/env), `mcp_permission.rs`, the `wave2` pin grammar and its tests, and the daemon handlers
  and tests for `mcp.connect`/`mcp.send`/`mcp.call`/`mcp.permissions.*`/`plugins.*`/`process.spawn`/
  `gates.evidence`, plus `auth.rs`'s method table and `ProcessPolicy`.
- One claim was executed on this host rather than argued: `git -c 'alias.k4probe=!echo shell-reached' k4probe`
  printed `shell-reached` (exit 0), which is the evidence for row 3. No secret, token, SID or ACL dump was
  printed or collected anywhere in this pass.
- Run, with the result: `cargo test --offline -p warsha-pipeline --lib -- command_policy mcp_permission` →
  `test result: ok. 21 passed; 0 failed; 0 ignored` (2.01s), covering every K4 `command_policy::*` test and
  every `agent_loop::tests::mcp_permission::*` / `mcp_permission::tests::*` test named in the brief. Passing
  tests are what row 7 and row 13 are *about*: they pass, and the properties they name are still not proven,
  which is why they are MEDIUM/LOW rather than absent.
- Not run: the Windows ACL path (no Windows host), and no network call was made — the test build was
  `--offline`, so no dependency fetch and no provider call. Where a row's severity depends on *what a test
  asserts*, the assertion text is quoted rather than described.
- Pre-existing and out of scope: the daemon reads no provider key or bearer token from its own environment in
  production (`grep` over non-test code finds only `WARSHA_LLM_PROVIDER` and `WARSHA_PRINT_BOOTSTRAP_TOKEN`),
  so row 1's impact is bounded by what the *launching* environment carries; and every child runs as the owner,
  so env clearing is a shallow control against an allow-listed toolchain that can read `config.toml` by path
  anyway. Both belong in the K8 trust-boundaries text, not in a K4 repair.

## Disposition

Repair dispatch (Coder lane) for the two HIGH rows — both are one-line-shaped at the call site:
`require_pinned_launch` in `connect_mcp`'s Stdio arm, and gate evidence through `CommandPolicy`. The MEDIUM
rows are worth folding into the same dispatch (they are tests and call-site invariants, not redesigns): the
resolved-server assertion, the `call_mcp`/`send_mcp` consultation, the CSP string parity plus one header test,
and the pack-scoped keychain account. Then a closure re-review at the repair commit before the checkpoint is
called again; I did not change product code, so this review stands as the audit of `4e974db`.
