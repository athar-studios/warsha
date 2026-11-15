# R-EXT-3 — MCP registry client for the Scout (X5): live catalog, fixtures, honest "unavailable" · after R-EXT-2

Status: spec frozen. Base: `db5b8ab` (repair/dev-csp-f474776, R-UI-6 + R-EXT-2 merged). Planner lane. Pattern:
R-BRIDGE-B5 / R-EXT-2. Licence wording: "free and source-available".
**Rust: yes, additive. New RPC method: no. New wire method: no. UI: none. Dials an MCP server: no.**

## Scope verdict (read first)

The brief reads X5 as "a registry of *recorded* MCP servers (HTTP/WebSocket configs that are listable but not
diallable)". **That reading has nothing to build.** It is already complete after R-EXT-1:

- `mcp.connect` records an `Http`/`WebSocket` config (`warshad/src/lib.rs:1434-1470`: policy check of the URL, then
  `state.mcp.connect(config)` which records without dialling; `mcp_transport.rs:37-38,153-167`, `is_wired`).
- `mcp.list` returns it `disconnected`, no tools (`lib.rs:1482`); `mcp.disconnect` drops it (`lib.rs:1473`).
- The Connections screen shows "Recorded, not connected: nothing dials this address yet." in place of tools and
  never an empty-tools success state (R-EXT-1 report l.115). The add form offers stdio only, deliberately.
- Adding an "add HTTP config" form is *not* registry work: it would let the owner record rows that still do nothing.
  It is R-EXT-4's scope (a form that can be tested end to end only once dialling exists), and the screen already
  needs no change for it (R-EXT-1 report l.166). **Fold that into R-EXT-4. No R-EXT-3 work is invented for it.**

**But `R-UI-RUN-PLAN.md` row 8 / §0 means something else by X5, and that is real, open work:** "X5 scout truth —
`ProductionScoutRegistryClient` returns `CatalogUnavailable`" (`scout.rs:129-148`). X5 is the **Scout's registry
client** (browse the public MCP registry), not a registry of recorded servers. This packet builds that, and
only that. If the owner truly wants the first reading, close this packet as "folded into R-EXT-4" and discard the rest.

## Why (measured at db5b8ab)

- **The Scout's MCP/npm source is a stub by construction.** `ProductionScoutRegistryClient::fetch_proposals`
  (`warsha-pipeline/src/scout.rs:132-146`) ignores everything and returns `CatalogUnavailable`. `Scout::new` wires
  it (l.160). Two tests pin that (`scout.rs:445`, `status_truth.rs:329`). The trait seam `ScoutRegistryClient`
  (l.117) and the injectable `Scout::with_client` (l.164) already exist; a `FixtureRegistryClient` test double
  exists (l.428).
- **Nothing outside the pipeline calls the Scout.** `grep Scout crates/warshad crates/warsha-cli` finds no use;
  `warsha-pipeline/src/lib.rs:164` only re-exports it. So no RPC, no UI and no run path reaches the catalog today.
  This packet therefore does **not** add a consumer (that is a later packet); it makes the client true and proven.
- **A reachable, usable API exists.** Probed at db5b8ab time: `GET https://registry.modelcontextprotocol.io/v0/
  servers?limit=100&version=latest` → HTTP 200, `{"servers":[{"server":{name,description,version,title?,
  websiteUrl?,repository?,remotes?,packages?},"_meta":{…}}],"metadata":{"nextCursor","count"}}`. Of 100 rows: 94 have
  `remotes` (all 96 remotes are `type:"streamable-http"`), 10 have `packages` (all `registryType:"npm"`), **only 2
  mention a licence at all**. Without `version=latest` the list repeats old versions of one server
  (`isLatest:false` rows seen). Cursor paging via `metadata.nextCursor`.
- **Mapping facts the code must respect.** `ScoutProposal` needs `license`/`license_class`; the registry almost never
  supplies one, so the honest class is `Unknown` (the enum's own comment: "treat as Custom", `skills.rs:38`).
  `Scout::scout_for_role` keeps `Permissive|Custom|Unknown` when `require_license_check` (l.201-208), so an
  Unknown proposal is shown, never silently approved (`auto_approve_permissive` is false by default).
- **HTTP-client placement is open decision D-EXT-1.** `reqwest` is in `warshad` (`Cargo.toml:49`) and
  `warsha-providers`, not `warsha-pipeline`; R2 forbids pipeline→warshad (`ARCH_RULES.md:68`). The plan says the
  client choice is "made once", here, before R-EXT-4 (row 9).
- **Gate wording to satisfy** (plan §3): fixtures for list/search/licence mapping; offline → "catalog
  unavailable"; `git grep -nE "In real implementation|mock proposals|MockRoutineRunner::new" -- crates ":!**/tests/**"`
  prints nothing. Measured at db5b8ab: the third alternative matches `routines.rs:761+` — but those lines are inside
  `#[cfg(test)] mod tests` (not `tests/` paths), so the gate as written **already prints matches**. Step 1 records the
  exact output; this packet does not edit `routines.rs`, and reports the gate-wording defect (restrict to non-test code
  or `:!**/routines.rs`) instead of fixing it. See Out of scope.

## Goal

1. `Scout::new(ScoutConfig::default())` can return real proposals from the MCP registry when the network is up, and
   still returns `CatalogUnavailable` (explicit, not an empty list) when it is not.
2. Registry rows map to `ScoutProposal` deterministically and **without invented facts** (licence `Unknown`,
   no `Permissive` guess, no role guess beyond the requested role).
3. Proven offline with a recorded fixture and against an in-process HTTP server; no real network in tests.

## Frozen design

**Placement (D-EXT-1 default applied):** trait in `warsha-pipeline`, `reqwest` implementation in `warshad`.

- `warsha-pipeline/src/scout.rs` (or new `scout_registry.rs`, `mod` + `pub use`): 
  - `trait RegistryHttp: Send + Sync { async fn get_json(&self, url: &str) -> Result<serde_json::Value, ScoutError>; }`
    (a GET returning parsed JSON; maps transport failure to `ScoutError::CatalogUnavailable`, never `Ok(empty)`).
  - `struct McpRegistryClient { http: Arc<dyn RegistryHttp> }` implementing `ScoutRegistryClient`. For
    `ScoutSource::McpRegistry` only: URL = `{catalog_url or default}/v0/servers?limit=100&version=latest`, follow
    `metadata.nextCursor` up to **3 pages** (constant, tested), then stop. Any other source → `CatalogUnavailable`
    exactly as today (npm/git/custom remain unavailable; named in Out of scope).
  - `pub fn map_registry_page(value: &Value, role: Role, now: &str) -> Result<Vec<ScoutProposal>>` — pure, fixture
    tested. Mapping: `id = "mcp-registry:" + server.name + "@" + version`; `source = McpRegistry`;
    `source_url = websiteUrl | repository.url | the registry URL`; `name = title | name`; `version`; `description`
    (truncate to 500 chars at a char boundary); `license = "unknown"`, `license_class = Unknown` unless the row
    carries an SPDX string we recognise (reuse the existing classifier if one exists in `skills.rs`; if not, the
    Unknown rule stands — **do not add a new SPDX table here**); `target_role = role`; `provides = ["mcp-server"]`;
    `required_permissions = ["network"]` iff `remotes` non-empty; `metadata` carries `remotes` (type+url only) and
    `packages` (registryType, identifier, version only) as JSON — **descriptive, never executed or recorded as a
    config by this packet**. A row missing `name` or `version` is skipped and counted, not defaulted; an unparsable
    page is `Serialization`, not an empty success.
  - `status_truth.rs:329` and `scout.rs:445` tests keep passing unchanged: `Scout::new` still defaults to
    `ProductionScoutRegistryClient` (unavailable) — the real client is opted in via `Scout::with_client`. This keeps
    the pipeline free of any network default and the two truth tests honest. (Whether the daemon opts in belongs to
    the packet that adds a consumer.)
- `warshad/src/registry_http.rs` (new): `ReqwestRegistryHttp` implementing `RegistryHttp`. Rules: URL checked by the
  same `process_policy().check_transport_url` as `mcp.connect` (TLS anywhere; plain http only loopback — this is what
  lets the in-process test server work and refuses LAN http); 10 s timeout; response body capped at 2 MiB;
  redirects limited to 3 and re-checked; `User-Agent: warsha/<version>`; non-2xx, timeout, DNS failure, oversize →
  `CatalogUnavailable(<short reason>)`; no credentials, cookies or headers beyond UA/Accept.
- **No recording, no dialling:** a proposal's `remotes` are data. Nothing here calls `mcp.connect`, `McpManager`, or
  adds a Connections row. Turning a proposal into a recorded/real server is a later, owner-approved flow (R-EXT-4+).

**Wire verdict:** no method, params or policy row change; `wire: 11 checks, 0 violations` unchanged (verify by
running). `check-arch`: `reqwest` stays out of `warsha-pipeline`'s `Cargo.toml`; new code uses `serde_json`,
`async_trait` already present. Add a DECISIONS.md entry for D-EXT-1's resolution (placement) and the Unknown-licence rule.

## Tests (each must fail on db5b8ab, pass after; save before/after under `target/discrimination/R-EXT-3/`)

- T1 `map_registry_page` on the recorded fixture `crates/warsha-pipeline/tests/fixtures/mcp_registry_page.json` (a
  trimmed real response, ≥ 1 row with remotes only, 1 with npm package, 1 with neither, 1 missing `version`):
  exact ids, `license_class == Unknown`, `required_permissions` rule, skipped-row count, 500-char truncation on a
  multibyte (Arabic) description.
- T2 search/list: `McpRegistryClient` over a fake `RegistryHttp` serving two pages → concatenated in order; stops at 3
  pages even if `nextCursor` keeps coming; URL contains `version=latest`.
- T3 offline: fake `RegistryHttp` erroring → `fetch_proposals` is `Err(CatalogUnavailable)`, **never `Ok(vec![])`**;
  `Scout::with_client(..).scout_for_role` surfaces it. Non-`McpRegistry` source → `CatalogUnavailable`.
- T4 licence gate: with `require_license_check`, an `Unknown` proposal passes the filter and is not auto-approved;
  a fixture row carrying a copyleft SPDX (if the classifier recognises it) is dropped.
- T5 (warshad) `ReqwestRegistryHttp` against an in-process loopback HTTP server: 200 JSON ok; 500 → unavailable;
  body over 2 MiB → unavailable; `http://` non-loopback host refused before any socket; redirect to non-loopback
  http refused.
- T6 existing `scout.rs:445` and `status_truth.rs:329` pass **unchanged** (no edit to those tests).

## Allowed files

- `crates/warsha-pipeline/src/scout.rs` (+ optional new `scout_registry.rs`, `mod`/`pub use` lines in `lib.rs`)
- `crates/warsha-pipeline/tests/fixtures/mcp_registry_page.json` (new), `crates/warsha-pipeline/tests/scout_registry.rs` (new)
- `crates/warshad/src/registry_http.rs` (new), `crates/warshad/src/lib.rs` (one `mod` line only),
  `crates/warshad/src/tests/` (T5 only)
- `DECISIONS.md`, `PROGRESS.md`, `docs/zadloop/packets/R-EXT-3-report.md` (new)

## Out of scope

**Making HTTP/WebSocket MCP real (R-EXT-4/X3)**; recording or connecting a registry remote; any "add HTTP server"
form or edit of `ConnectionsSection.tsx` / client wrappers (folded into R-EXT-4, see verdict); a daemon RPC, UI, or
run path that calls the Scout; npm/git/custom sources (stay `CatalogUnavailable`); install/lock of proposals
(`install_proposal` untouched); a new SPDX table; editing `routines.rs` or the `MockRoutineRunner` hits (report the
gate-wording defect); reqwest in `warsha-pipeline`; auth to the registry; caching/persistence; X7/X9; baselines;
changing any `check-*` tool.

## Constraints

- Rust stable; no `unwrap()`/`expect()` outside tests; errors via `thiserror`/`anyhow`; `cargo fmt`; clippy `-D warnings`.
- No real network in tests (loopback server or fakes only); the live probe is a manual step-1 observation, not a test.
- Never log URLs with query secrets (none exist); no secrets are read or sent.
- Server-supplied text (description/title) is data: bounded, never interpolated into a command or shell.
- Offline/failed must be an error, never an empty success. Unknown stays Unknown.
- Small Conventional Commits; self-review the diff; do not touch another lane's dirty files.

## Steps

1. Re-verify at the worktree base: `git grep -n "ProductionScoutRegistryClient" -- crates`; record the output of the
   `git grep -nE "In real implementation|mock proposals|MockRoutineRunner::new" -- crates ":!**/tests/**"` gate
   (expected: non-empty, all in `routines.rs` test module) and one live `curl` of the registry URL; refresh the
   fixture from it (trim, keep Arabic-description row synthetic and labelled).
2. Write T1–T4 first (red on base), then the mapper and `McpRegistryClient`.
3. Add `ReqwestRegistryHttp` + T5.
4. DECISIONS.md (D-EXT-1 resolved; Unknown licence), PROGRESS.md, report with discrimination artifacts (≥ 2) and the
   gate-wording finding.

## Gates (exact commands)

```
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test -p warsha-pipeline --all-targets
cargo test -p warshad --all-targets
cargo test --workspace --all-targets
node scripts/check-wire-contract.mjs && node scripts/check-wire-contract.mjs --self-test
node scripts/check-arch.mjs && node scripts/check-arch.mjs --self-test
node scripts/check-engineering-policy.mjs && node scripts/check-engineering-policy.mjs --self-test
cargo deny check
git grep -n "reqwest" -- crates/warsha-pipeline/Cargo.toml     # must print nothing
git grep -nE "In real implementation|mock proposals" -- crates ":!**/tests/**"   # must print nothing
```

Any gate not run is named in the report, not called passed.
