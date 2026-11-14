# P-H1 graph map — Phase 0 (dependency graph for splitting `crates/warshad/src/lib.rs`)

Status: **Phase 0 deliverable, awaiting PM spot-check.** No code moved, no source or test touched.
Base: `78f8d55` (`repair/dev-csp-f474776`). Subject: `crates/warshad/src/lib.rs`, **15,684 lines**.
Spec: `docs/zadloop/packets/P-H1-GRAPH.md` (frozen) + `docs/zadloop/packets/R-ENGINE-audit.md` §2.2/§2.4.

This map supersedes `R-ENGINE-audit.md` §2.1 (drawn at 13,451 lines). §2.2 target layout and §2.4
invariants still stand, with three adjustments recorded in §5/§8.

## 0. How this map was built (hard rule 5)

`lib.rs` was never read wholesale. Every number below comes from two throwaway scripts (reproduced
in Appendix B) run against the file:

1. **Inventory pass** — brace/string/comment-aware scan writing every depth-0 item plus every
   depth-1 `fn` inside `impl` blocks, with start/end lines.
2. **Graph pass** — per-item identifier scan resolved against the inventory; `self.x(` / `Self::x(`
   counted as method edges; same-named methods on foreign types (`store.list_projects()` etc.)
   dropped by receiver filtering (see §3).

Evidence the map is faithful to the file:

| check | result |
|---|---|
| top-level items inventoried | **186** (172 named items + 14 `use`/`mod` declarations), 97 of the RPC methods inside one `impl` |
| graph nodes / edges | 275 nodes (incl. 97 RPC methods + 11 test modules), 916 edges |
| inventory self-check | for all 177 `fn`/`struct`/`enum`/`trait`/`impl`/`const`/`static`/`type`/`mod` items the reported start line really carries that keyword + name — **0 mismatches** |
| region coverage | the 19 regions partition lines 1–15,684 exactly: **Σ = 15,684** (no gap, no overlap) |

Only targeted ranges were opened while writing: the 1–112 header, the audit §2, and single-line
boundary probes listed in §1.

## 1. Region inventory

19 regions. `lines` = every line of the region including the blank/attribute/banner lines between
its items; the regions sum to the whole file.

| # | region | lines | items | private | target module (§2.2 + adjustments) | out | in |
|---|---|---|---|---|---|---|---|
| 0 | `facade` | 89 | 1 | 0 | `lib.rs` | 0 | 0 |
| 1 | `shared-consts` | 16 | 3 | 3 | `lib.rs` (shared leaf consts) | 0 | 9 |
| 2 | `api` | 748 | 15 | 4 | `api.rs` | 0 | 50 |
| 3 | `skills` | 276 | 10 | 10 | `skills.rs` (adjustment A1) | 0 | 9 |
| 4 | `auth-layer` | 226 | 13 | 13 | `auth.rs` (exists) | 2 | 20 |
| 5 | `state` | 276 | 6 | 2 | `state.rs` (exists) | 5 | 46 |
| 6 | `events-socket` | 336 | 10 | 10 | `events.rs` (exists) | 7 | 1 |
| 7 | `http` | 644 | 21 | 18 | `http.rs` | 13 | 14 |
| 8 | `runtime` | 388 | 20 | 19 | `runtime.rs` (adjustment A2) | 14 | 29 |
| 9 | `rpc-core` | 767 | 15 | 13 | `rpc/mod.rs` | 15 | **462** |
| 10 | `startup` | 866 | 18 | 14 | `startup.rs` | 19 | 13 |
| 11 | `rpc-gates` | 88 | 4 | 0 | `rpc/gates.rs` ⚠ | 10 | 22 |
| 12 | `rpc-processes` | 157 | 12 | 0 | `rpc/processes.rs` ⚠ | 30 | 43 |
| 13 | `rpc-mcp` | 252 | 9 | 0 | `rpc/mcp.rs` ⚠ | 35 | 38 |
| 14 | `rpc-settings` | 162 | 9 | 0 | `rpc/settings.rs` (adjustment A3) ⚠ | 24 | 11 |
| 15 | `rpc-plugins` | 602 | 14 | 0 | `rpc/plugins.rs` ⚠ | 83 | 28 |
| 16 | `rpc-providers` | 1,031 | 32 | 0 | `rpc/providers.rs` ⚠ | 140 | 89 |
| 17 | `rpc-runs` | 578 | 16 | 0 | `rpc/runs.rs` ⚠ | 33 | 93 |
| 18 | `tests` | 8,182 | 11 | 1 | `tests/` (one file per `mod`) | 547 | 0 |

`items` counts depth-0 items, except the six `rpc-*` rows where it counts the RPC methods inside the
shared impl block. `out`/`in` = reference occurrences emitted to / received from *other* regions
(§3). ⚠ = blocked by finding **F1**: these six regions are method subsets of one
`impl WarshaApiServer for WarshaRpc` block (1953–4838) and cannot become separate files by pure moves.

Line ranges per region (first–last item), for the PM spot-check:

```text
facade         1–88      header: use / mod / pub use / type Result
shared-consts  5189–5203 HANDOFF_DIR, ACTIVE_HARNESS_GLOBAL_KEY, LOCAL_POCKETBASE_URL
api            603–1349  WarshaApi trait (97 methods) + 15 DTOs
skills         4913–5187 BUILTIN_SKILL_COMMANDS … catalog_from_registry
auth-layer     99–325    RpcAuthLayer / RpcAuthService / tower Layer+Service / bearer+subprotocol helpers
state          327–601    AppState, DaemonState, paired_device_is_active, impl DaemonState, McpPermissionRow(s)
events-socket  7167–7501  events_handler … handle_events_socket
http           5730–5984 + 6779–7165   health_handler … http_app, auth_handler_inner … static assets
runtime        5278–5293 + 5359–5728   build_agent_loop(_in), AgentLoopSnapshot, seed_role_routings,
                          register_configured_providers, routing_* / store_*
rpc-core       90–97 + 1351–1950 + 4840–4911 + 5295–5357   provider_refusal, WarshaRpc + impl WarshaRpc,
                          now_epoch_secs, rpc_* constructors, refuse_a_permission_governed_frame,
                          DaemonPermissionStore
startup        5205–5276 + 5980–6777   default_backend_kit, seed_*, start_daemon* trio, run_daemon,
                          config/env/secret-file helpers
rpc-* (6)      1953–4838 ⊂ one impl block (see F1)
tests          7503–15684 mod tests + 9 sibling test modules
```

Per-item ranges for all 186 items + 97 methods: **Appendix A**.

## 2. Coupling matrix

Weight = number of reference occurrences, source item → target item, counted per item and summed
per region pair. Intra-region edges are excluded (they cost nothing at split time). Trait
*declarations* are excluded (`WarshaApi` names its 97 methods; that is a wire contract, not a
dependency), and same-named foreign methods are filtered (§3).

```text
from \ to             auth      state        api   rpc-core     skills    startup    runtime       http     events       runs      gates  providers      procs        mcp    plugins   settings      tests
auth-layer               .          2          .          .          .          .          .          .          .          .          .          .          .          .          .          .          .
state                    .          .          3          1          .          .          .          1          .          .          .          .          .          .          .          .          .
api                      .          .          .          .          .          .          .          .          .          .          .          .          .          .          .          .          .
rpc-core                 .          3          2          .          2          2          6          .          .          .          .          .          .          .          .          .          .
skills                   .          .          .          .          .          .          .          .          .          .          .          .          .          .          .          .          .
startup                  1          1          .          2          .          .          6          8          .          .          .          .          .          .          .          .          .
runtime                  .          .         10          4          .          .          .          .          .          .          .          .          .          .          .          .          .
http                     6          4          1          .          .          1          .          .          1          .          .          .          .          .          .          .          .
events-socket            1          6          .          .          .          .          .          .          .          .          .          .          .          .          .          .          .
rpc-runs                 .          .          .         30          .          1          2          .          .          .          .          .          .          .          .          .          .
rpc-gates                .          .          2          8          .          .          .          .          .          .          .          .          .          .          .          .          .
rpc-providers            .          .         16        109          .          .          7          1          .          .          .          .          .          .          .          .          .
rpc-processes            .          .          .         30          .          .          .          .          .          .          .          .          .          .          .          .          .
rpc-mcp                  .          5          .         30          .          .          .          .          .          .          .          .          .          .          .          .          .
rpc-plugins              .          .          .         83          .          .          .          .          .          .          .          .          .          .          .          .          .
rpc-settings             .          .          .         24          .          .          .          .          .          .          .          .          .          .          .          .          .
tests                   12         25         16        141          7          9          8          4          .         93         22         89         43         38         28         11          .
```

Reading it:

- **`rpc-core` is the hub** (462 in, 15 out). `rpc_error` alone carries 124 references,
  `authorize` 95, `provider_refusal` 13, `rpc_policy_refused` 12, `rpc_invalid_params` 10.
- **`api` and `skills` are pure sinks** (0 out): the trait + DTOs and the skill-registry helpers
  reference nothing outside themselves. They are the only true leaves.
- **The six RPC sections never reference each other** (zero pairwise edges). Their out-edges go to
  `rpc-core` (30/83/109/30/35/24), plus `api` (16 from providers, 2 from gates), `state` (5 from mcp),
  and `rpc-providers → {runtime 7, http 1}`.
- **`tests` is 52 % of the file** (8,182 / 15,684) and points into all 16 code regions; it holds 115
  `WarshaRpc::new` constructions and 93 calls into `rpc-runs` methods made *through the trait* (so
  those tests survive any relocation of the impl).
- Distinct foreign items a region must import (import-surface size, drives seam cost):
  `rpc-providers` 98, `rpc-plugins` 50, `rpc-runs` 26, `rpc-processes` 25, `rpc-mcp` 23,
  `rpc-settings` 21, `startup` 17, `http` 12, `rpc-core` 11, `runtime` 9, `rpc-gates` 9,
  `events-socket` 5, `state` 4, `auth-layer` 2, `tests` 160.

**Top edges (item → item, cross-region):**

| refs | from | to |
|---|---|---|
| 80 | `mod tests` (alone) | `WarshaRpc` (rpc-core) — 115 `WarshaRpc::new` calls across all test mods |
| 21 | `tests` | `WarshaRpc::agent_turn_run` (rpc-providers) |
| 13 | `tests` | `start_run` (rpc-runs), `active_skill_catalog` (rpc-core) |
| 12 | `tests` | `create_project` (rpc-runs) |
| 11 | `tests` | `DaemonState`, `get_run`, `install_plugin`/`toggle_plugin` |
| 7 | `add_provider`, `followup_run`, `toggle_plugin`, `connect_integration` | `rpc_error` / `provider_refusal` |
| 4 | `start_daemon_with_provider_factory` | `http::pairing_origin` |

## 3. Weight definition and noise control

- An edge exists when item *A*'s body (comments and string literals stripped) contains an
  identifier that the inventory resolves to exactly one item *B*. Weight = occurrence count.
- Ambiguous names (`from`, `set_mcp_permission`) are not resolved; they contribute nothing.
- A name preceded by a `.` is only counted when the receiver is `self`/`Self` or matches
  `*rpc*|server|api|daemon|handle` (the daemon handle in tests). Without this filter,
  `store.list_projects()`, `registry.list_skills()`, `router.set_budget()` invented ~40 phantom
  edges — e.g. `state → rpc-runs`, which does not exist.
- Residual risk: a genuine call through a differently-named receiver would be missed. For the
  ordering decisions below only edges ≥ 2 matter, and every edge ≥ 8 was checked against the file.
- `in` for RPC sections is inflated by test calls made through the trait; those tests depend on
  `api` + `rpc/mod.rs` (struct construction), not on the section file itself.

## 4. Existing modules: what they already hold, what is still inline

| module | lines | already holds | `lib.rs` still holds inline |
|---|---|---|---|
| `auth.rs` | 1,602 | `Actor`/`ActorRole`, `Sessions`, `Policy`/`Tier`/`MethodPolicy` + `METHOD_POLICIES` (265–822), `RateLimitConfig`/`QuotaConfig`/`RateGovernor`, `ProcessPolicy` + `DEFAULT_ALLOWED_COMMANDS`/`DENIED_ENV_KEYS`, path-security helpers, `rpc_codes`, `RpcExtensions`, `session_extensions`/`owner_session`/`anonymous_session`, `DaemonError`, 2 test mods | the whole tower layer: `RpcAuthLayer`, `RpcAuthService`, `Layer`/`Service` impls, `APP_ORIGINS`, `origin_allowed`, `bearer_token`, `subprotocol_token`, `EVENTS_*`/`TOKEN_SUBPROTOCOL_PREFIX`, `rpc_refusal`, `retry_after_header` → **`auth-layer`, 226 lines** |
| `events.rs` | 232 | `EVENT_REPLAY_CAPACITY`, `SequencedEventFrame`, `RunStreamSync`, `StreamSync`, `EventSequencer` + impls | the socket layer: `events_handler`, `EventStreamParams`, `last_event_id_header`, `parse_run_id`, `send_frame`, `control_frame`, `SocketCommand(+Params)`, `handle_socket_command`, `handle_events_socket` → **`events-socket`, 336 lines** |
| `providers.rs` | 591 | `AdapterKind`+`adapter_kind`, `keychain_credentials`, `ProviderFactory` + keychain/mock factories, `DeferredProvider`, `RemovedProvider`, tests | the whole provider/agent/harness/skill RPC surface (32 methods, 1,031 lines), plus `provider_endpoint`/`provider_model`/`non_empty` and the `ProviderRecord`/`Health*` DTOs (in `api`/`rpc-core`) |
| `settings.rs` | 1,039 | `SettingsError`, `SettingsStore` + 48 methods, document read/write, `SettingsProvider` impl, tests | the 9 RPC methods that drive it (`list_run_modes`…`revoke_pairing`) → **`rpc-settings`, 162 lines** |
| `state.rs` | 363 | scrubbing (`scrub_event_payload`, `scrub_value`, `redact_string`, `contains_sk_token`, `contains_bearer`), `windows_firewall_command`, `DaemonConfig`+`Default`, `DaemonHandle`+`Debug`/`Drop`, `DaemonArgs` | `DaemonState` (165 lines), `paired_device_is_active`, `impl DaemonState` (3 methods), `McpPermissionRow`/`McpPermissionsReply`, `AppState` → **`state`, 276 lines** |
| `mcp_approvals.rs` | 376 | `McpApproval`, `McpApprovalAnswer`, `allow_once_event`, `DaemonSummarizer` + `ArgumentSummarizer`, `printable_key`/`is_secret_key`, tests | 9 MCP RPC methods (`connect_mcp`…`allow_once_mcp_approval`) → **`rpc-mcp`, 252 lines** |
| `wave2.rs` | 1,404 | harness/skill/plugin/integration import+parse helpers, `MIME_TYPES`, project-file tree walking (`safe_join`, `list_tree`, `read_text`), `seed_bundled_records`, `slug` | 14 plugin/integration/custom-model/project-file RPC methods → **`rpc-plugins`, 602 lines** |
| `lock.rs` | 131 | `acquire_lock`, `LockFile` (not in the packet's list; already extracted) | — |

`DaemonState` and the `WarshaApi` trait and the `WarshaRpc`/`WarshaApiServer` impls are indeed still
inline, as the packet predicted.

## 5. Findings that change the plan

**F1 — the six `rpc/*.rs` modules cannot be produced by pure moves.** All 97 RPC methods live in a
single `impl WarshaApiServer for WarshaRpc { … }` block (1953–4838, 2,887 lines); the trait side is a
single `#[rpc(server)] pub trait WarshaApi` (603–1167, 97 `#[method(name = …)]`). Rust forbids two
impl blocks of the same trait for the same type, so `rpc/runs.rs`, `gates.rs`, `providers.rs`,
`processes.rs`, `mcp.rs`, `plugins.rs` as *files of trait-impl methods* would each need their own
`impl WarshaApiServer for WarshaRpc`, which will not compile (E0119). Options, none of them a pure
move:

- **F1-a (pure moves only):** keep the trait impl whole as one module (`rpc/impl_server.rs`,
  2,887 lines) and extract everything around it. `lib.rs` still ends ≈ 90 lines; the largest
  remaining file is 2,887 lines instead of 15,684.
- **F1-b (separate packet):** convert each section into an inherent `impl WarshaRpc { … }` in its
  own file and leave a set of `impl WarshaApiServer` methods that delegate one line each. That is a
  mechanical but *code-adding* transform — it violates hard rule 1 as written and needs a PM
  decision plus a review rule ("delegation bodies only, no logic").
- The rest of §2.2 (`state.rs`, `api.rs`, `events.rs`, `http.rs`, `startup.rs`, `tests/`) is
  unaffected and stays move-only.

**F2 — `rpc-core` is a gravity well, not a module.** 462 incoming references, 8 distinct source
regions, 74 distinct foreign items pulled in by `rpc-providers` alone. It must be extracted *before*
any RPC section, never in parallel, and its `pub(crate)` surface (13 private items, 29 cross-region
referenced items) is the single largest seam in the split.

**F3 — `tests` is the real second half of the job.** 8,182 lines (52 %), 547 out-references to 16
regions, 160 distinct foreign items, and 115 `WarshaRpc::new` constructions. It can only move after
every code module, and it is the reason most private items need `pub(crate)` (`tests`-only
dependencies: just 1 — the rest are also used by production code).

**F4 — 173 private items are referenced across regions.** Every one needs `pub(crate)` at extraction
time (visibility only, no behaviour). Reviewers should expect seam lines in every step; the
move-shaped diff test in hard rule 4 should be read as
`deletions(lib.rs) − additions(new file) = seam lines` and the seam set should be *only*
`mod`/`use`/`pub(crate)`.

**F5 — `runtime` ↔ `rpc-core` is a 2-cycle** (`runtime → rpc-core` 4 refs via
`WarshaRpc::backend_kit`; `rpc-core → runtime` 6 refs via `build_agent_loop`, `seed_role_routings`,
`seed_agent_snapshot`, `AgentLoopSnapshot`, `MOCK_PROVIDER_ID`). Extract `runtime` first and accept a
2-line path fix in `rpc/mod.rs` later (or move `backend_kit`, 1406–1428, into `runtime.rs` to break
it outright — a Phase-1 judgement call, recorded here).

**F6 — the audit §2.1 map is stale in three places**, all now covered: `e1_language_wiring`
(14237–14486), `e2_legacy_retired` (14872–14960) and `e8_wiring` (15280–15684) did not exist in it,
and `mod tests` now ends at 13,187 with `health_reports_probed_capabilities` at 13,189.

## 6. Extraction order (topological, leaves first; `runs` last)

Order = ascending reference surface, respecting the edges above (`api`/`skills` are the only
out-degree-0 regions), with `tests` last and the trait impl untouched (F1-a default).

**Stage A — pure moves, do now (10 steps):**

| step | region | lines | out/in | target | pub(crate) adds | notes |
|---|---|---|---|---|---|---|
| A0 | `shared-consts` | 16 | 0/9 | `lib.rs` | 3 | trivially shared; stays as facade leaf consts |
| A1 | `api` | 748 | 0/50 | `api.rs` | 6 | true leaf; carries the entire wire contract (97 methods + 15 DTOs) |
| A2 | `skills` | 276 | 0/9 | `skills.rs` | 4 | true leaf; only `rpc/providers`, `tests` + 1 startup ref read it |
| A3 | `auth-layer` | 226 | 2/20 | `auth.rs` | 11 | appends to existing `auth.rs`; only dependency is `state::DaemonState` |
| A4 | `state` | 276 | 5/46 | `state.rs` | 1 | appends to existing `state.rs`; needs `api::HealthCapabilities`, `rpc_core::now_epoch_secs` |
| A5 | `events-socket` | 336 | 7/1 | `events.rs` | 1 | appends to existing `events.rs`; reads `state` + `auth-layer` |
| A6 | `http` | 644 | 13/14 | `http.rs` | 5 | after auth/state/events; `startup` reads `http::pairing_origin` (4) and `REMOTE_ASSETS_DIR_ENV` |
| A7 | `runtime` | 388 | 14/29 | `runtime.rs` | 15 | after `api`; breaks the `rpc-core` cycle (F5) |
| A8 | `rpc-core` | 767 | 15/462 | `rpc/mod.rs` | 29 | **sequential, never parallel**; needs `runtime`, `skills`, `startup`, `state`, `api` already moved |
| A9 | `startup` | 866 | 19/13 | `startup.rs` | 3 | last code move; depends on 7 regions |
| A10 | `tests` | 8,182 | 547/0 | `tests/` | — | after every code move; split by test module (§6.1) |

**Stage B — blocked on F1 decision (6 steps, all sequential):**
`rpc-gates` (88) → `rpc-processes` (157) → `rpc-mcp` (252) → `rpc-settings` (162) →
`rpc-plugins` (602) → `rpc-providers` (1,031) → `rpc-runs` (578) **last** (E2/E3/E5 wiring,
largest test blast radius: 93 test references).

Per-step gates are the packet's fast gates: `cargo fmt --check`, `cargo clippy -p warshad`,
`cargo test -p warshad`. A step whose diff contains anything other than moved lines +
`mod`/`use`/`pub(crate)` stops and comes back to the PM (hard rules 1–2).

### 6.1 Test-module split map (Stage A10 / B follow-up)

| test module | lines | subjects |
|---|---|---|
| `mod tests` | 7503–13187 (5,685; 87 `#[test]`, 6 nested mods: `runs_resume` 10729–10952, `runs_start_budget` 10954–11015, `runs_followup` 11017–11146, `provider_truth` 11148–11367, `spawn_hardening` 11695–12445, `mcp_approval` 12536–13186) | harness/policy/gates/process+MCP/preview/routines/CSP |
| `health_reports_probed_capabilities` | 13189–13288 | health probe |
| `test_util` | 13290–13294 | stub helpers (the 80 `test_util::` refs from `mod tests`) |
| `pair_repair` | 13296–13927 | event stream after revocation |
| `origin_guard` | 13929–14012 | CORS origin gating |
| `e3_wiring` | 14014–14235 | repository/worktree wiring at `runs.start` |
| `e1_language_wiring` | 14237–14486 | project language plumbing |
| `e2_wiring` | 14488–14870 | `runs.start` budget/discovery pinning |
| `e2_legacy_retired` | 14872–14960 | per-run migration refusal |
| `e5_wiring` | 14962–15279 | gate preview evidence |
| `e8_wiring` | 15280–15684 | agent loop end-to-end |

## 7. Parallel groups

Parallel-safe means: no edge in either direction **and** disjoint source ranges, so two worktrees
cannot both need the same moved item. Every merge still re-runs the fast gates (packet §Phase 1).

| group | members | why safe | hazard |
|---|---|---|---|
| **P1** | `api` (A1) + `skills` (A2) | both out-degree 0, zero edges between them | both append to the `lib.rs` header (`mod`/`pub use`); merge one at a time, expect one header conflict line |
| **P2** | `auth-layer` (A3) + `events-socket` (A5) | `auth-layer → state` only; `events-socket → state` (6) + `auth-layer` (1) — the single 1-ref edge is a type mention, resolvable after either merge | run P2 after A4 (`state`) or take the 1-line fix |
| **P3** | `http` (A6) + `runtime` (A7) | no edges either way (`http → {auth, state, api, events, startup}`, `runtime → {api, rpc-core}`) | both depend on `api`; run after A1 |
| **P4** | `rpc-gates` + `rpc-processes` + `rpc-mcp` + `rpc-settings` | zero pairwise edges, disjoint method ranges, smallest sections | **only** after F1 is decided; all four rewrite the same impl block, so they are *not* safe under F1-a |
| **P5** | `rpc-plugins` + `rpc-providers` | zero edges either way | same F1 caveat; `providers` is a 98-item import surface, so merge `plugins` first |
| **serial** | `state`, `rpc-core`, `startup`, `tests`, `rpc-runs` | hub / max fan-in / max fan-out | never parallel, never reordered past their dependencies |

## 8. Decisions for the PM (Stage B cannot start without #1)

1. **F1**: accept F1-a (trait impl stays one 2,887-line module; Stage A proceeds now) or approve
   F1-b (delegating trait impl — not move-shaped, needs its own packet + review rule). Recommended:
   **F1-a now, F1-b as a follow-up packet**, because F1-a already takes `lib.rs` from 15,684 to ~90
   lines and no module above 1,031 lines except the impl.
2. **Adjustments A1/A2/A3** to §2.2: add `skills.rs` (skill-registry helpers, out-degree 0),
   `runtime.rs` (agent-loop construction + role routing), and `rpc/settings.rs` (run modes,
   backends, preferences, pairings — 9 methods §2.2 has no home for). Alternative if the PM prefers
   literal §2.2: fold `skills` into `rpc/providers.rs`, `runtime` into `rpc/mod.rs` + `startup.rs`,
   and `rpc-settings` into `rpc/processes.rs`; same file count, but `rpc/mod.rs` grows past 1,100
   lines and `rpc/providers.rs` past 1,300.
3. **Seam budget**: approve that each Phase-1 commit may add `pub(crate)` (173 items total, ~29 in
   `rpc-core` alone) — otherwise Stage A stalls at A3.

## Appendix A — item inventory with current line ranges

Generated by script (no manual line numbers). `len` = lines including attached attributes/docs.

### Region by region

| region | lines total | top-level items | private | target module |
|---|---|---|---|---|
| `facade` | 89 | 1 | 0 | lib.rs (facade) |
| `shared-consts` | 16 | 3 | 3 | lib.rs (facade, shared consts) |
| `api` | 748 | 15 | 4 | api.rs |
| `skills` | 276 | 10 | 10 | skills.rs (proposed; §2.2 folds into rpc/providers.rs) |
| `auth-layer` | 226 | 13 | 13 | auth.rs |
| `state` | 276 | 6 | 2 | state.rs |
| `events-socket` | 336 | 10 | 10 | events.rs |
| `http` | 644 | 21 | 18 | http.rs |
| `runtime` | 388 | 20 | 19 | runtime.rs (proposed; §2.2 folds into rpc/mod.rs + startup.rs) |
| `rpc-core` | 767 | 15 | 13 | rpc/mod.rs |
| `startup` | 866 | 18 | 14 | startup.rs |
| `rpc-gates` | 88 | 0 | 0 | rpc/gates.rs * |
| `rpc-processes` | 157 | 0 | 0 | rpc/processes.rs * |
| `rpc-mcp` | 252 | 0 | 0 | rpc/mcp.rs * |
| `rpc-settings` | 162 | 0 | 0 | rpc/settings.rs * |
| `rpc-plugins` | 602 | 0 | 0 | rpc/plugins.rs * |
| `rpc-providers` | 1031 | 0 | 0 | rpc/providers.rs * |
| `rpc-runs` | 578 | 0 | 0 | rpc/runs.rs * |
| `tests` | 8182 | 11 | 1 | tests/ (one file per mod) |

### Item inventory (current line ranges)


#### `facade` — 89 lines → lib.rs (facade)

| lines | len | item |
|---|---|---|
| 88–88 | 1 | type `Result` |

#### `shared-consts` — 16 lines → lib.rs (facade, shared consts)

| lines | len | item |
|---|---|---|
| 5189–5190 | 2 | const `HANDOFF_DIR` |
| 5192–5200 | 9 | const `ACTIVE_HARNESS_GLOBAL_KEY` |
| 5202–5203 | 2 | const `LOCAL_POCKETBASE_URL` |

#### `api` — 748 lines → api.rs

| lines | len | item |
|---|---|---|
| 603–1167 | 565 | trait `WarshaApi` |
| 1169–1175 | 7 | struct `HealthCapabilities` |
| 1177–1184 | 8 | struct `HealthResponse` |
| 1186–1209 | 24 | struct `ProviderRecord` |
| 1211–1220 | 10 | impl `impl From<StoredProvider> for ProviderRecord` |
| 1222–1234 | 13 | fn `provider_endpoint` |
| 1236–1243 | 8 | fn `provider_model` |
| 1245–1251 | 7 | fn `non_empty` |
| 1253–1260 | 8 | struct `RoleRoutingConfig` |
| 1262–1267 | 6 | struct `RoutingTargetConfig` |
| 1269–1276 | 8 | struct `BudgetStatus` |
| 1278–1292 | 15 | struct `GateSummary` |
| 1294–1314 | 21 | enum `GateSummaryState` |
| 1316–1327 | 12 | impl `impl From<GateState> for GateSummaryState` |
| 1329–1349 | 21 | struct `AgentState` |

#### `skills` — 276 lines → skills.rs (proposed; §2.2 folds into rpc/providers.rs)

| lines | len | item |
|---|---|---|
| 4913–4931 | 19 | const `BUILTIN_SKILL_COMMANDS` |
| 4933–4940 | 8 | const `SKILLS_LOCK_FILE` |
| 4942–4975 | 34 | fn `role_pack_skills` |
| 4977–4992 | 16 | fn `daemon_role_packs` |
| 4994–5018 | 25 | fn `skill_pin` |
| 5020–5038 | 19 | fn `license_class_of` |
| 5040–5071 | 32 | fn `installed_skill` |
| 5073–5094 | 22 | fn `installed_skill_registry` |
| 5096–5140 | 45 | fn `verified_skill_registry` |
| 5142–5187 | 46 | fn `catalog_from_registry` |

#### `auth-layer` — 226 lines → auth.rs

| lines | len | item |
|---|---|---|
| 101–120 | 20 | struct `RpcAuthLayer` |
| 122–131 | 10 | impl `impl <S> Layer<S> for RpcAuthLayer` |
| 133–136 | 4 | const `APP_ORIGINS` |
| 138–141 | 4 | fn `origin_allowed` |
| 143–149 | 7 | struct `RpcAuthService` |
| 151–162 | 12 | fn `bearer_token` |
| 164–169 | 6 | const `EVENTS_PATH` |
| 171–176 | 6 | const `TOKEN_SUBPROTOCOL_PREFIX` |
| 178–184 | 7 | const `EVENTS_SUBPROTOCOL` |
| 186–210 | 25 | fn `subprotocol_token` |
| 212–230 | 19 | fn `rpc_refusal` |
| 232–240 | 9 | fn `retry_after_header` |
| 242–325 | 84 | impl `impl <S, B> tower::Service<HttpRequest<B>> for RpcAuthService<S>` |

#### `state` — 276 lines → state.rs

| lines | len | item |
|---|---|---|
| 327–328 | 2 | type `AppState` |
| 330–494 | 165 | struct `DaemonState` |
| 496–512 | 17 | fn `paired_device_is_active` |
| 514–577 | 64 | impl `impl DaemonState` |
| 579–590 | 12 | struct `McpPermissionRow` |
| 592–601 | 10 | struct `McpPermissionsReply` |

#### `events-socket` — 336 lines → events.rs

| lines | len | item |
|---|---|---|
| 7167–7198 | 32 | fn `events_handler` |
| 7200–7209 | 10 | struct `EventStreamParams` |
| 7211–7219 | 9 | fn `last_event_id_header` |
| 7221–7228 | 8 | fn `parse_run_id` |
| 7230–7238 | 9 | fn `send_frame` |
| 7240–7275 | 36 | fn `control_frame` |
| 7277–7285 | 9 | struct `SocketCommand` |
| 7287–7293 | 7 | struct `SocketCommandParams` |
| 7295–7351 | 57 | fn `handle_socket_command` |
| 7353–7501 | 149 | fn `handle_events_socket` |

#### `http` — 644 lines → http.rs

| lines | len | item |
|---|---|---|
| 5730–5744 | 15 | fn `health_handler` |
| 5746–5762 | 17 | fn `resolve_bind_host` |
| 5764–5767 | 4 | fn `is_wildcard` |
| 5769–5795 | 27 | fn `advertised_host_spelling` |
| 5797–5840 | 44 | fn `pairing_origin` |
| 5842–5865 | 24 | fn `origin_is_loopback` |
| 5867–5892 | 26 | const `REMOTE_CSP` |
| 5894–5978 | 85 | fn `http_app` |
| 5980–5984 | 5 | fn `start_daemon` |
| 6779–6869 | 91 | fn `auth_handler_inner` |
| 6871–6895 | 25 | fn `http_refusal` |
| 6899–6901 | 3 | const `REMOTE_ASSETS_DIR_ENV` |
| 6903–6916 | 14 | fn `is_reserved_static_path` |
| 6918–7022 | 105 | fn `static_asset_handler` |
| 7024–7047 | 24 | fn `serve_static_file` |
| 7049–7055 | 7 | fn `static_not_found` |
| 7057–7063 | 7 | fn `static_bad_request` |
| 7065–7095 | 31 | fn `percent_decode_path` |
| 7097–7127 | 31 | fn `static_content_type` |
| 7129–7148 | 20 | fn `static_cache_control` |
| 7150–7165 | 16 | fn `looks_hashed_file_name` |

#### `runtime` — 388 lines → runtime.rs (proposed; §2.2 folds into rpc/mod.rs + startup.rs)

| lines | len | item |
|---|---|---|
| 5278–5286 | 9 | const `AGENT_WORKSPACE_DIR` |
| 5288–5293 | 6 | const `AGENT_METER_KEY` |
| 5359–5380 | 22 | fn `build_agent_loop` |
| 5382–5431 | 50 | fn `build_agent_loop_in` |
| 5433–5434 | 2 | const `ROLE_ROUTINGS_DOCUMENT` |
| 5436–5437 | 2 | const `AGENT_LOOP_DOCUMENT` |
| 5439–5443 | 5 | const `MOCK_PROVIDER_ID` |
| 5445–5463 | 19 | struct `AgentLoopSnapshot` |
| 5465–5489 | 25 | impl `impl AgentLoopSnapshot` |
| 5491–5528 | 38 | fn `seed_role_routings` |
| 5530–5549 | 20 | fn `seed_agent_snapshot` |
| 5551–5586 | 36 | fn `register_configured_providers` |
| 5588–5610 | 23 | fn `apply_role_routings` |
| 5612–5616 | 5 | fn `role_from_name` |
| 5618–5624 | 7 | fn `role_name` |
| 5626–5649 | 24 | fn `routing_key` |
| 5651–5672 | 22 | fn `routing_for` |
| 5674–5690 | 17 | fn `routing_config` |
| 5692–5712 | 21 | fn `store_role_routings` |
| 5714–5728 | 15 | fn `store_agent_snapshot` |

#### `rpc-core` — 767 lines → rpc/mod.rs

| lines | len | item |
|---|---|---|
| 90–97 | 8 | fn `provider_refusal` |
| 1351–1355 | 5 | struct `WarshaRpc` |
| 1357–1938 | 582 | impl `impl WarshaRpc` |
| 1940–1950 | 11 | fn `now_epoch_secs` |
| 1954–1968 | 15 | fn `health` (RPC method) |
| 4840–4848 | 9 | fn `rpc_invalid_params` |
| 4850–4856 | 7 | fn `rpc_error` |
| 4858–4861 | 4 | fn `rpc_unauthenticated` |
| 4863–4866 | 4 | fn `rpc_forbidden` |
| 4868–4875 | 8 | fn `rpc_identity_mismatch` |
| 4877–4885 | 9 | fn `rpc_rate_limited` |
| 4887–4890 | 4 | fn `rpc_policy_refused` |
| 4892–4911 | 20 | fn `refuse_a_permission_governed_frame` |
| 5295–5311 | 17 | struct `DaemonPermissionStore` |
| 5313–5357 | 45 | impl `impl warsha_pipeline::McpPermissionStore for DaemonPermissionStore` |

#### `startup` — 866 lines → startup.rs

| lines | len | item |
|---|---|---|
| 5205–5211 | 7 | fn `default_backend_kit` |
| 5213–5224 | 12 | fn `project_ids` |
| 5226–5242 | 17 | fn `seed_run_modes` |
| 5244–5256 | 13 | fn `seed_backend_kits` |
| 5258–5271 | 14 | fn `seed_preferences` |
| 5273–5276 | 4 | fn `seed_pairings` |
| 5986–6004 | 19 | fn `start_daemon_with_secrets` |
| 6006–6426 | 421 | fn `start_daemon_with_provider_factory` |
| 6428–6451 | 24 | fn `apply_cli_overrides` |
| 6453–6497 | 45 | fn `run_daemon` |
| 6499–6526 | 28 | fn `wait_for_shutdown_signal` |
| 6528–6636 | 109 | fn `restrict_file_to_owner` |
| 6638–6672 | 35 | fn `write_private_file` |
| 6674–6721 | 48 | fn `load_or_create_config` |
| 6723–6755 | 33 | fn `apply_env_overrides` |
| 6757–6764 | 8 | fn `env_string` |
| 6766–6769 | 4 | fn `env_port` |
| 6771–6777 | 7 | fn `get_github_token` |

#### `rpc-gates` — 88 lines → rpc/gates.rs *

| lines | len | item |
|---|---|---|
| 2308–2322 | 15 | fn `approve_gate` (RPC method) |
| 2324–2339 | 16 | fn `reject_gate` (RPC method) |
| 2341–2356 | 16 | fn `request_changes` (RPC method) |
| 2358–2394 | 37 | fn `list_gates` (RPC method) |

#### `rpc-processes` — 157 lines → rpc/processes.rs *

| lines | len | item |
|---|---|---|
| 3201–3225 | 25 | fn `spawn_process` (RPC method) |
| 3227–3234 | 8 | fn `stop_process` (RPC method) |
| 3236–3243 | 8 | fn `process_status` (RPC method) |
| 3245–3257 | 13 | fn `list_processes` (RPC method) |
| 3511–3532 | 22 | fn `start_preview` (RPC method) |
| 3534–3541 | 8 | fn `stop_preview` (RPC method) |
| 3543–3554 | 12 | fn `preview_status` (RPC method) |
| 3718–3722 | 5 | fn `list_routines` (RPC method) |
| 3724–3728 | 5 | fn `get_routine` (RPC method) |
| 3730–3742 | 13 | fn `run_routine_now` (RPC method) |
| 3744–3756 | 13 | fn `pause_routine` (RPC method) |
| 3758–3770 | 13 | fn `resume_routine` (RPC method) |

#### `rpc-mcp` — 252 lines → rpc/mcp.rs *

| lines | len | item |
|---|---|---|
| 3259–3296 | 38 | fn `connect_mcp` (RPC method) |
| 3298–3305 | 8 | fn `disconnect_mcp` (RPC method) |
| 3307–3310 | 4 | fn `list_mcp` (RPC method) |
| 3312–3330 | 19 | fn `send_mcp` (RPC method) |
| 3332–3373 | 42 | fn `call_mcp` (RPC method) |
| 3375–3396 | 22 | fn `list_mcp_permissions` (RPC method) |
| 3398–3433 | 36 | fn `set_mcp_permission` (RPC method) |
| 3435–3452 | 18 | fn `list_mcp_approvals` (RPC method) |
| 3454–3509 | 56 | fn `allow_once_mcp_approval` (RPC method) |

#### `rpc-settings` — 162 lines → rpc/settings.rs *

| lines | len | item |
|---|---|---|
| 3556–3567 | 12 | fn `list_run_modes` (RPC method) |
| 3569–3591 | 23 | fn `set_run_mode` (RPC method) |
| 3593–3611 | 19 | fn `get_backend` (RPC method) |
| 3613–3622 | 10 | fn `set_backend` (RPC method) |
| 3624–3635 | 12 | fn `list_preferences` (RPC method) |
| 3637–3678 | 42 | fn `record_preference` (RPC method) |
| 3680–3683 | 4 | fn `list_pairings` (RPC method) |
| 3685–3700 | 16 | fn `create_pairing` (RPC method) |
| 3702–3716 | 15 | fn `revoke_pairing` (RPC method) |

#### `rpc-plugins` — 602 lines → rpc/plugins.rs *

| lines | len | item |
|---|---|---|
| 4238–4251 | 14 | fn `list_plugins` (RPC method) |
| 4253–4289 | 37 | fn `install_plugin` (RPC method) |
| 4291–4394 | 104 | fn `toggle_plugin` (RPC method) |
| 4396–4468 | 73 | fn `configure_plugin` (RPC method) |
| 4470–4489 | 20 | fn `remove_plugin` (RPC method) |
| 4491–4516 | 26 | fn `list_custom_models` (RPC method) |
| 4518–4561 | 44 | fn `add_custom_model` (RPC method) |
| 4563–4576 | 14 | fn `remove_custom_model` (RPC method) |
| 4578–4581 | 4 | fn `list_integrations` (RPC method) |
| 4583–4692 | 110 | fn `connect_integration` (RPC method) |
| 4694–4726 | 33 | fn `disconnect_integration` (RPC method) |
| 4728–4806 | 79 | fn `test_integration` (RPC method) |
| 4808–4824 | 17 | fn `list_project_files` (RPC method) |
| 4826–4837 | 12 | fn `read_project_file` (RPC method) |

#### `rpc-providers` — 1031 lines → rpc/providers.rs *

| lines | len | item |
|---|---|---|
| 2396–2405 | 10 | fn `list_providers` (RPC method) |
| 2407–2508 | 102 | fn `add_provider` (RPC method) |
| 2510–2572 | 63 | fn `test_provider` (RPC method) |
| 2574–2591 | 18 | fn `check_provider_models` (RPC method) |
| 2593–2599 | 7 | fn `list_devices` (RPC method) |
| 2601–2651 | 51 | fn `pair_device` (RPC method) |
| 2653–2718 | 66 | fn `start_pairing` (RPC method) |
| 2720–2736 | 17 | fn `revoke_device` (RPC method) |
| 2738–2813 | 76 | fn `remove_provider` (RPC method) |
| 2815–2828 | 14 | fn `list_roles` (RPC method) |
| 2830–2910 | 81 | fn `set_role` (RPC method) |
| 2912–2934 | 23 | fn `show_budget` (RPC method) |
| 2936–2958 | 23 | fn `set_budget` (RPC method) |
| 2960–2981 | 22 | fn `export_backend` (RPC method) |
| 2983–3004 | 22 | fn `create_handoff` (RPC method) |
| 3006–3045 | 40 | fn `apply_handoff` (RPC method) |
| 3047–3066 | 20 | fn `list_crash_reports` (RPC method) |
| 3068–3081 | 14 | fn `list_store_reviews` (RPC method) |
| 3083–3106 | 24 | fn `agent_turn` (RPC method) |
| 3108–3129 | 22 | fn `agent_turn_run` (RPC method) |
| 3131–3149 | 19 | fn `approve_agent_mode` (RPC method) |
| 3151–3163 | 13 | fn `return_agent_to_plan` (RPC method) |
| 3165–3199 | 35 | fn `agent_state` (RPC method) |
| 4012–4035 | 24 | fn `list_harnesses` (RPC method) |
| 4037–4049 | 13 | fn `get_harness` (RPC method) |
| 4051–4076 | 26 | fn `import_harness` (RPC method) |
| 4078–4104 | 27 | fn `select_harness` (RPC method) |
| 4106–4145 | 40 | fn `delete_harness` (RPC method) |
| 4147–4160 | 14 | fn `list_skills` (RPC method) |
| 4162–4190 | 29 | fn `import_skill` (RPC method) |
| 4192–4225 | 34 | fn `toggle_skill` (RPC method) |
| 4227–4236 | 10 | fn `delete_skill` (RPC method) |

#### `rpc-runs` — 578 lines → rpc/runs.rs *

| lines | len | item |
|---|---|---|
| 1970–1977 | 8 | fn `list_projects` (RPC method) |
| 1979–2003 | 25 | fn `create_project` (RPC method) |
| 2005–2012 | 8 | fn `get_project` (RPC method) |
| 2014–2068 | 55 | fn `attach_project` (RPC method) |
| 2070–2202 | 133 | fn `start_run` (RPC method) |
| 2204–2211 | 8 | fn `run_worktree` (RPC method) |
| 2213–2272 | 60 | fn `gate_evidence` (RPC method) |
| 2274–2281 | 8 | fn `get_run` (RPC method) |
| 2283–2290 | 8 | fn `list_runs` (RPC method) |
| 2292–2306 | 15 | fn `get_events` (RPC method) |
| 3772–3794 | 23 | fn `subscribe_run` (RPC method) |
| 3796–3862 | 67 | fn `advance_run` (RPC method) |
| 3864–3883 | 20 | fn `cancel_run` (RPC method) |
| 3885–3892 | 8 | fn `resume_run` (RPC method) |
| 3894–3983 | 90 | fn `followup_run` (RPC method) |
| 3985–3995 | 11 | fn `list_run_artifacts` (RPC method) |

#### `tests` — 8182 lines → tests/ (one file per mod)

| lines | len | item |
|---|---|---|
| 7503–13187 | 5685 | mod `tests` |
| 13189–13288 | 100 | fn `health_reports_probed_capabilities` |
| 13290–13294 | 5 | mod `test_util` |
| 13296–13927 | 632 | mod `pair_repair` |
| 13929–14012 | 84 | mod `origin_guard` |
| 14014–14235 | 222 | mod `e3_wiring` |
| 14237–14486 | 250 | mod `e1_language_wiring` |
| 14488–14870 | 383 | mod `e2_wiring` |
| 14872–14960 | 89 | mod `e2_legacy_retired` |
| 14962–15279 | 318 | mod `e5_wiring` |
| 15280–15684 | 405 | mod `e8_wiring` |

### Per-region import surface (distinct foreign items referenced)

| region | refs out | distinct foreign items | distinct foreign regions |
|---|---|---|---|
| `facade` | 0 | 0 | 0 |
| `shared-consts` | 0 | 0 | 0 |
| `api` | 0 | 0 | 0 |
| `skills` | 0 | 0 | 0 |
| `auth-layer` | 2 | 2 | 1 |
| `state` | 5 | 4 | 3 |
| `events-socket` | 7 | 5 | 2 |
| `http` | 13 | 12 | 5 |
| `runtime` | 14 | 9 | 2 |
| `rpc-core` | 15 | 11 | 5 |
| `startup` | 19 | 17 | 6 |
| `rpc-gates` | 10 | 9 | 2 |
| `rpc-processes` | 30 | 25 | 1 |
| `rpc-mcp` | 35 | 23 | 2 |
| `rpc-settings` | 24 | 21 | 1 |
| `rpc-plugins` | 83 | 50 | 1 |
| `rpc-providers` | 140 | 98 | 5 |
| `rpc-runs` | 33 | 26 | 3 |
| `tests` | 547 | 160 | 16 |

## Appendix B — reproduction (scripts used; not committed)

Run from the repo root; both scripts are read-only. `inventory` writes `/tmp/inv.json`,
`graph` consumes it and writes the edge list; the region table above comes from mapping each item's
start line into the ranges listed in §1.

```python
# inventory: depth-0 items + depth-1 fns of impl blocks, with current line ranges
import re, json
PATH = "crates/warshad/src/lib.rs"
raw = open(PATH).read().split("\n")

def strip(lines):                      # blank out //, /* */ and string/char literals
    out, block = [], False
    for line in lines:
        s, i, ins = [], 0, False
        while i < len(line):
            if block:
                j = line.find("*/", i)
                if j < 0: i = len(line); break
                block, i = False, j + 2; continue
            c = line[i]
            if ins:
                i += 2 if c == "\\" else 1
                if c == '"': ins = False
                continue
            if line.startswith("//", i): break
            if line.startswith("/*", i): block, i = True, i + 2; continue
            if c == '"': ins, i = True, i + 1; continue
            if c == "'" and re.match(r"'(?:\\.|[^\\'])'", line[i:]):
                i += re.match(r"'(?:\\.|[^\\'])'", line[i:]).end(); continue
            s.append(c); i += 1
        out.append("".join(s))
    return out

clean = strip(raw)
depth, d = [], 0
for cl in clean:
    depth.append(d); d += cl.count("{") - cl.count("}")
ITEM = re.compile(r"^(?:pub(?:\s*\([^)]*\))?\s+)?(?:(?:async|unsafe|const|extern|default)\s+)*"
                  r"(fn|struct|enum|trait|impl|mod|use|const|static|type|macro_rules!)\b")
FN = re.compile(r"^\s*(?:pub\s+)?(?:(?:async|unsafe|const)\s+)*fn\s+([A-Za-z0-9_]+)")
items, i = [], 0
while i < len(clean):
    if depth[i] or not ITEM.match(clean[i].strip()):
        i += 1; continue
    start = i                                    # attach #[..] / /// cluster above
    while start and raw[start-1].strip().startswith(("///", "#[", "//!")): start -= 1
    bd, j, end = 0, i, None
    while j < len(clean):
        bd += clean[j].count("{") - clean[j].count("}")
        if bd == 0 and clean[j].rstrip().endswith((";", "}")): end = j; break
        j += 1
    items.append({"line": start + 1, "end": end + 1,
                  "kw": ITEM.match(clean[i].strip()).group(1), "methods": []})
    i = (end or i) + 1
```

```python
# graph: item -> item edges; drop same-named foreign receivers, count self./Self:: calls
TOK = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
for node in nodes:                               # body of each item / method
    body = "\n".join(clean[node.start-1:node.end])
    for m in TOK.finditer(body):
        tgt = unique_index.get(m.group(0))       # names defined exactly once at depth 0
        if not tgt: continue
        before = body[:m.start()].rstrip()
        if before.endswith("."):                 # store.list_projects() is not our list_projects
            recv = re.search(r"(\w+)$", before[:-1].rstrip())
            if same_named_foreign(recv, tgt): continue
        edges[(src, tgt)] += 1
```

Region assignment and the matrix are the ranges in §1 applied to `items[].line`; the 97 RPC methods
are the depth-1 `fn`s of the block at 1953–4838, grouped by name per §1/§6.

Verification that the ranges are real (spot-check, run from the repo root):

```bash
for r in 603:1167 4913:5187 99:325 330:601 5730:5984 5359:5728 1351:1950 5980:6777 7167:7501 1953:4838; do
  sed -n "${r%:*},${r#*:}p" crates/warshad/src/lib.rs | head -1
done
```
