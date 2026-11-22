# R-EXT-3 report — the Scout's MCP registry client

**Status: DONE.** The Scout can now read the public MCP registry through a `RegistryHttp` seam that the
pipeline owns and the daemon implements over `reqwest`, maps rows to `ScoutProposal`s without inventing a
licence or a permission, and answers an explicit `CatalogUnavailable` when the network is not there — never
an empty list. No RPC, no UI, no dialling, no recording. Every gate in the packet's Gates section was run on
the final tree and is green; the packet's grep gate as *written* still prints its 9 pre-existing
`routines.rs` test-module matches (defect recorded below, `routines.rs` untouched).

- **Branch:** `zl-rext3-registry` (isolated worktree `/home/moe/Downloads/Warsha-rext3`).
- **Base:** `af66ff0` on `repair/dev-csp-f474776` (the merge that froze this packet).
- **Commits:**

| Commit | What |
|---|---|
| `0f43a9e` | `feat(pipeline): read the MCP registry through a RegistryHttp seam (R-EXT-3)` — the trait, the paged client, the pure mapper, the recorded fixture, T1–T4 |
| `492c0a8` | `feat(warshad): add the reqwest RegistryHttp for the scout registry client (R-EXT-3)` — `registry_http.rs`, the `reqwest` dependency promotion, T5 |
| *(this file)* | `docs(zadloop): R-EXT-3 report and decisions` — this report and the `DECISIONS.md` entry |

8 files, `+1,475 / −1`: 4 new Rust files/tests, 1 new fixture, 2 one-line module declarations, 1 manifest
line. `docs/zadloop/packets` was touched only for this report; `PROGRESS.md` was left alone (the work order
excludes it); `routines.rs`, `scout.rs`, `status_truth.rs`, `auth.rs` and everything under `apps/` are
byte-identical to the base (`git diff af66ff0 -- <path>` is empty).

## What shipped

**The seam (`warsha-pipeline/src/scout_registry.rs`).** `RegistryHttp` is one method —
`async fn get_json(&self, url: &str) -> Result<Value, ScoutError>` — and its contract is the packet's: a
transport failure, a non-2xx answer and an oversize body are the implementor's `CatalogUnavailable`, never
`Ok` with an empty page. `McpRegistryClient::new(Arc<dyn RegistryHttp>)` is the `ScoutRegistryClient`:
for `ScoutSource::McpRegistry` it walks `{catalog_url or default}/v0/servers?limit=100&version=latest`,
following `metadata.nextCursor` for **at most 3 pages** (`MAX_REGISTRY_PAGES`, a tested constant), then
stops; for every other source it returns `CatalogUnavailable` without touching the transport (npm/git/custom
stay unimplemented, as the packet requires). The cursor is percent-encoded (`:` and `/` appear in real
cursors) with no new dependency.

**The mapper.** `map_registry_page(value, role, now)` keeps the packet's frozen signature;
`map_registry_page_counted` is the same function plus the skipped-row count the packet's tests ask for (a
`Vec`-returning signature cannot carry a count, so the count is not invented into the proposals). Mapping,
one fact per field: `id = "mcp-registry:" + server.name + "@" + version`; `source = McpRegistry`;
`source_url = websiteUrl | repository.url | the registry base`; `name = title | name`; `version`;
`description` cut to **500 characters** (`chars().take(500)`); `license = "unknown"`, `license_class =
Unknown`; `target_role = role`; `provides = ["mcp-server"]`; `required_permissions = ["network"]` iff the
row has a `remotes` array; `metadata` carries `remotes` (type+url only — a remote's headers are dropped) and
`packages` (registryType, identifier, version only — no transport, no args). A row without a `name` or a
`version` is skipped **and counted**, never defaulted; a page that does not parse is `Serialization`.

**The HTTP client (`warshad/src/registry_http.rs`).** `ReqwestRegistryHttp` applies the daemon's own
transport rules: the URL passes the same `ProcessPolicy::check_transport_url` `mcp.connect` uses (TLS
anywhere, plain `http`/`ws` on loopback only) **before a socket exists**; every redirect is re-checked
against that policy and the chain is capped at 3; the request times out at 10 s; the body is capped at 2 MiB
(declared length refused before reading, chunk count while reading); exactly two headers leave the process —
`User-Agent: warsha/<version>` and `Accept: application/json` — with no credential, cookie or auth. Failures
become `CatalogUnavailable(<short reason from the error chain>)`; a 200 body that is not JSON is
`Serialization`.

**Nothing is wired.** `Scout::new` still installs `ProductionScoutRegistryClient`, so the pipeline has no
network default and the two truth tests (`scout.rs:445`, `status_truth.rs:329`) pass unedited — T6 is
proved by an empty diff, not by a claim. The daemon has no route, state or RPC that reaches
`ReqwestRegistryHttp`; a proposal's `remotes` are data and nothing calls `mcp.connect`.

## Gates (exact commands, final tree)

| Command | Exit | Result |
|---|---|---|
| `cargo fmt --all --check` | 0 | clean |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | clean (see deviation 2 for the one shape this forced) |
| `cargo test -p warsha-pipeline --all-targets` | 0 | 523 passed, 0 failed, 7 ignored (13 new in `tests/scout_registry.rs`) |
| `cargo test -p warshad --all-targets` | 0 | 319 passed, 0 failed, 5 ignored (8 new in `src/tests/registry_http.rs`) — rerun, see below |
| `cargo test --workspace --all-targets` | 0 | 1,089 passed, 0 failed, 12 ignored across 40 suites |
| `node scripts/check-wire-contract.mjs` | 0 | `wire: 11 checks, 0 violations` |
| `node scripts/check-wire-contract.mjs --self-test` | 0 | `11 checks fire, clean fixture is clean in both modes` |
| `node scripts/check-arch.mjs` | 0 | `arch: 5 rules, 0 violations` |
| `node scripts/check-arch.mjs --self-test` | 0 | `5 rules fire, clean fixture is clean` |
| `node scripts/check-engineering-policy.mjs` | 0 | `policy: 8 checks, 0 failures` |
| `node scripts/check-engineering-policy.mjs --self-test` | 0 | `8 checks fire, clean fixture is clean` |
| `cargo deny check` | 0 | `advisories ok, bans ok, licenses ok, sources ok` |
| `git grep -n "reqwest" -- crates/warsha-pipeline/Cargo.toml` | 1 | no match — the pipeline has no HTTP client |
| `git grep -nE "In real implementation\|mock proposals" -- crates ":!**/tests/**"` | 1 | no match |

**One flake, named.** The first `cargo test -p warshad --all-targets` run failed one test:
`security_rate_limits::the_http_listener_answers_429_with_a_retry_after`, after 362 s in that suite. It
passes alone (0.92 s, 1/1), the suite passes 9/9 on rerun (4.49 s), and the full workspace gate is green.
The diff adds no listener, route, state, auth or rate-limit code and has no wiring at all, so this is
contention in the host, not the change; the first run's log is kept under
`target/discrimination/R-EXT-3/`.

**The packet's grep gate as written still prints.** `git grep -nE "In real implementation|mock
proposals|MockRoutineRunner::new" -- crates ":!**/tests/**"` exits 0 with **9 matches**, all in
`crates/warsha-pipeline/src/routines.rs` (lines 761, 789, 825, 845, 927, 944, 984, 1013, 1057) inside its
`#[cfg(test)] mod tests` — the `":!**/tests/**"` pathspec excludes `tests/` directories, not test modules
in `src/`. That is the packet's own recorded wording defect; per its instruction the gate was **not** fixed
and `routines.rs` was **not** edited. The defect-free form (the packet's other two alternatives) prints
nothing and is the row above.

## Discrimination (`target/discrimination/R-EXT-3/`)

Before/after, as the packet asks: T1–T4 fail to compile on the base (`error[E0432]: unresolved import
warsha_pipeline::scout_registry`, saved as `t1-t4-before.txt`) and pass 13/13 after (`t1-t4-after.txt`);
T5 fails to compile against a module skeleton missing the client (`t5-before.txt`, `no
ReqwestRegistryHttp in registry_http`) and passes 8/8 after (`t5-after.txt`). Four behavioural mutations
were also run, each restored to the identical sha256:

| Mutation | Kill |
|---|---|
| A: a failed `get_json` breaks the page loop instead of propagating (`Ok(vec![])` for an unreachable catalog) | 2 failed — `an_offline_registry_is_an_error_and_never_an_empty_list`, `the_scout_surfaces_the_offline_error_instead_of_an_empty_catalog` |
| B: the mapper guesses `MIT`/`Permissive` | 2 failed — `fixture_rows_map_to_exact_ids_with_unknown_licence_and_network_only_rules`, `unknown_proposals_pass_the_licence_gate_and_are_never_auto_approved` |
| C: truncation by bytes (`&text[..500]`) instead of characters | 1 failed — the Arabic fixture row panics mid-character |
| D: the client skips the pre-send `check_transport_url` | 1 failed — `a_plain_http_host_off_loopback_is_refused_before_any_request` (the message became a DNS failure, not a policy refusal) |

## Live probe (manual step 1, not a test)

`curl "https://registry.modelcontextprotocol.io/v0/servers?limit=100&version=latest"` on 2026-11-15 →
**HTTP/2 200**, 76,688 bytes, `metadata = {nextCursor:
"ai.agenticaffiliate/affiliate-networks-mcp:0.19.0", count: 100}`. Of the 100 rows: **94** carry `remotes`
(96 remotes, every one `streamable-http`), **10** carry `packages` (every one `npm`), **0** carry neither,
**0** carry a structured licence field. The packet's "only 2 mention a licence at all" is measured here as
2 rows whose *prose* matches `licen*` — `agency.ottobot/contractor-license-changes` and
`agency.ottobot/licensed-house-painters`, both business-licence servers — so no row supplies a software
licence. Rows also carry `icons` and a server-level `_meta`, which the mapper ignores. Evidence:
`live-probe-headers.txt`, `live-probe-summary.txt`. The fixture is trimmed from this response (2 verbatim
rows) plus 3 synthetic, labelled rows (one with neither endpoint, one missing `version`, one Arabic
description of 535 chars / 983 bytes).

## Offline-error proof

`OfflineRegistryHttp` answers `Err(CatalogUnavailable("registry.modelcontextprotocol.io: connect error"))`;
`McpRegistryClient::fetch_proposals` returns that error with the transport's own reason intact, and
`Scout::with_client` over a **registry-only** config surfaces the same `CatalogUnavailable` instead of an
empty catalog. The other three sources return `CatalogUnavailable` **with the URL log empty**, so a source
this packet does not implement cannot reach the network either. Mutation A above is the negative proof that
the assertions bite.

## Design-point confirmations

- **D-EXT-1 (placement) resolved as the plan's default**: trait + pure mapper in `warsha-pipeline`, `reqwest`
  implementation in `warshad`; `crates/warsha-pipeline/Cargo.toml` has no HTTP client (grep gate above);
  `check-arch` R2 stays green. Logged in `DECISIONS.md`.
- **Unknown licence rule**: every mapped row is `unknown`/`Unknown`; the classifier the packet hoped to
  reuse does not exist (`skills::parse_license_class` maps a `license_class` *scalar* and is private), and no
  SPDX table was added. `require_license_check` keeps `Unknown` and `auto_approve_permissive` is false, so an
  unknown proposal is shown and never approved silently; a Copyleft proposal is still dropped (T4).
- **No new RPC, no new wire method, no UI, no dialling, no recording**: `wire: 11 checks, 0 violations`;
  `apps/` untouched; nothing in `warshad` calls `mcp.connect` from this code; `ConnectionsSection.tsx` and
  the client wrappers untouched; the packet's "add HTTP config" reading stays folded into R-EXT-4.
- **Bounded server text**: description capped at 500 characters at a char boundary, never interpolated into
  a command; only the skipped-row *count* is logged, never the row.
- **No secrets**: two headers out, no credentials read, nothing logged that could carry one.

## Deviations (each deliberate, each small)

1. **`crates/warshad/Cargo.toml` was edited** (not in the packet's allowed-files list, but unavoidable):
   the packet read `reqwest` as a normal `warshad` dependency at `Cargo.toml:49`; at this base line 49 is in
   **`[dev-dependencies]`**. It is promoted to `[dependencies]` as `reqwest = { workspace = true }` and
   removed from dev-dependencies. No version was added and `Cargo.lock` is unchanged — the workspace pin
   (`0.12`, `json`/`rustls-tls`/`stream`) already served five crates.
2. **`pub mod registry_http;`** rather than `mod registry_http;` (still exactly one added mod line):
   with no consumer yet, a private module is dead code and `clippy -D warnings` fails the workspace. Making
   the client reachable is what the packet's "the daemon opts in later" implies; the doc comment says so.
3. **T5's file lives in `crates/warshad/src/tests/registry_http.rs`** as the packet allows, declared from
   `registry_http.rs` with `#[cfg(test)] #[path = "tests/registry_http.rs"] mod tests;` — that keeps
   `lib.rs` at one added mod line instead of two.
4. **`PROGRESS.md` untouched** although the packet lists it: the dispatch instruction for this lane excludes
   it. The `DECISIONS.md` entry (which the packet requires) is in this branch.
5. **The skipped-row count needed a second signature**: `map_registry_page` keeps the packet's exact
   signature; `map_registry_page_counted` returns `(Vec<ScoutProposal>, usize)` and the wrapper delegates.

## Verification limits

- The 10 s request timeout is set on the `reqwest` client builder but is **not** exercised by a timed test —
  a slow-server test would cost 10 s of suite time, and there is no injectable clock. Read, not measured.
- No end-to-end path: by design nothing in the daemon or the UI calls the client, so "real proposals reach a
  screen or a run" is unverifiable in this packet (it is the consumer packet's work).
- The live probe is a manual observation on this host on 2026-11-15; the fixture, not the network, is what
  the tests read.
- The `warshad` flake above is reported, not explained: it did not reproduce in three later runs.
