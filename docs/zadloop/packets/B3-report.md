# B3 Report — Ask-queue and rules for native tools

Packet: B3 (Rule Engine) · Branch: `r-next/b3-rule-engine` · Base: `d25435d` (integration after A4)

## Deliveries

1. **Rule model** (`crates/warsha-core/src/rules.rs`): `RuleAction{Deny,Ask,Allow}`,
   `ToolPattern` (`*` = any, trailing-`*` = prefix wildcard, else exact),
   `ToolRules{deny,ask,allow}` with `evaluate()` in deny→ask→allow order (`None` =
   fall through to the approval-axis default). The worker's `Rule`/`RuleStoreError`
   types are kept.
2. **Rule store**: `InMemoryRuleStore` — global lists + per-project overrides
   (`set_global`/`set_project`, empty clears the override; `evaluate_in_project`).
   Precedence: a **global deny always wins**; the project's rules next (deny→ask→allow);
   global ask/allow next; no match → fall through to the axis default.
   Six unit tests cover exact/prefix/any matching and the precedence rules.
3. **Persistence** (migration `012_tool_rules.sql`): `tool_permission_rules`
   (`scope` = `global` | project id, PK; `rules_json`; `updated_at`), with
   `save_tool_rules`/`load_tool_rules`/`clear_tool_rules` on the settings repo and
   the migration ledger extended to `[1,2,3,4,6,7,8,9,10,11,12]`.
4. **Rules RPC** (`rules.global.get/set`, `rules.project.get/set`): `ToolRulesReply`
   `{deny,ask,allow}`; project set validates the id (UUID) and the project exists —
   a typo'd id fails named, never silently writes an orphan row. Policy rows:
   gets Session/Standard, sets Owner/Standard (`every_registered_method_has_a_policy`
   green).
5. **Allowlist comes first (spec order)**: `CommandPolicy::check_command` evaluates
   the command allowlist **before** any rule. A deny rule can refuse an allowlisted
   program; an ask rule inside the allowlist returns `InvalidCommand` ("rule engine
   requires approval"); a rule can never widen the allowlist (the worker's original
   ordering let a rule `Allow` admit an un-allowlisted command — fixed during review).
6. **One shared ask-queue for native asks**: `FilesystemToolExecutor` carries the
   run's `McpApprovals` + run id (`with_mcp_approvals`, now **wired** from
   `build_agent_loop_in` — the worker left the seam dead). Under ask-always (or
   ask-for-risky + risky), a native `RunCommand` refusal registers a pending entry on
   the same queue MCP and bridge asks use (`server="native"`, `tool="run_command"`,
   role `agent`, the exact command as arguments, a summary naming the command). Queue
   refusal = refuse closed. Two new tests: the ask reaches the queue with the run
   bound; a daemon-wide loop (no run id) never registers.
7. **Approval bridge** (`crates/warsha-cli/src/permission_bridge.rs`, from B2,
   wired to the same queue): stdin line loop → `permissions.ask` → poll
   `permissions.decision` (500 ms) → one-line decision `{"allow": bool}`; unanswered
   past 30 min denies (fail closed). Bridge acceptance tests in
   `warsha-cli/tests/permission_bridge.rs`.
8. **Syntax doc**: `docs/zadloop/packets/B3-rules-syntax.md` documents the supported
   subset (exact / trailing-`*` prefix / `*`), corrected for the implemented
   semantics (the worker's draft overclaimed; the implementation now matches it).

## Spec notes

- **Rule syntax VERIFY**: Claude Code's published syntax is `Tool` /
  `Tool(pattern)`; the implemented subset is the three flat lists with the same
  pattern grammar. Documented in the syntax doc; no policy-engine dependency.
- **Allow-once TTL**: the existing `MCP_ONCE_GRANT_TTL` (10 min) and
  exact-argument binding are unchanged and apply to native asks via the same
  grants map (`take` matches canonical args).
- **Unattended runs**: the bridge denies after its own 30-minute cap; native asks
  fail closed at refusal time (the run continues); pending entries expire after
  `PENDING_TTL` (24 h) in the registry. Queue entries leave `blocks_run()` driven
  by the run's own queue; an unregistered ask never blocks.

## Gates (this worktree @ cc5c88e)

| Gate | Result |
| --- | --- |
| `cargo fmt --check` | clean |
| `cargo clippy -p warsha-core -p warsha-pipeline -p warshad -p warsha-store --all-targets -- -D warnings` | 0 warnings |
| `cargo test -p warsha-core --lib rules` | 6/6 |
| `cargo test -p warsha-pipeline` | 517/0 lib (+7 ignored) + all integration suites 0 failed; protection tests now 8/8 |
| `cargo test -p warshad --lib` | 252/0 (4 ignored) |
| `cargo test -p warsha-store --lib` | 26/0 (+ migration ledger suites green) |
| `cargo test -p warsha-cli` | 7 suites 0 failed (bridge tests included) |
| wire contract | 11 checks / 4 violations — all pre-existing A1 debt (`catalog.refresh`/`catalog.apply`), unchanged by B3 |

## Deviations

- The rule editor UI in project settings is **not** in this packet: the desktop
  settings surface is owned by the E-series packet (E1 settings work); the RPC +
  store contract is complete so the editor is a UI-only follow-up. Logged as
  D-RN-B3-001.
- The owner-checklist item "rule editor in project settings" moves to the E2/E-series
  pass, which owns the project-settings UI.

## Fleet decisions

- D-RN-B3-001: rule editor UI deferred to the E-series (UI-owning packets).
- D-RN-B3-002: rule model + `RuleStore` trait live in `warsha-core` (no upward
  dependency edges; the daemon and the pipeline both see them).
- Worker attempt `9c7e15d4` delivered the initial seam (36-line rule model, dead
  queue seam, inverted allowlist order); PM completed the store, RPC, persistence,
  precedence order, and the native-ask wiring.
