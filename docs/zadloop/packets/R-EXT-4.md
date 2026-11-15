# R-EXT-4 — Streamable HTTP MCP (X3): make recorded HTTP configs diallable · after R-EXT-3

Status: spec frozen. Base: `32b8764` (repair/dev-csp-f474776, R-EXT-3 + R-UI-7 merged). Planner lane. Pattern:
R-BRIDGE-B5 / R-EXT-2 / R-EXT-3. Licence wording: "free and source-available".
**Rust: yes (pipeline + warshad). New RPC method: no (proved below). New wire field: no. UI: narrow (Connections add
form + one copy line). Dials a remote MCP server: yes — Streamable HTTP only.**

## Scope verdict (read first)

- **X3 = Streamable HTTP only.** `McpTransport::Http` becomes real. `McpTransport::WebSocket` **stays recorded, not
  dialled** (the MCP spec defines only stdio and Streamable HTTP; a WebSocket transport is a custom one nobody in the
  registry publishes).
- **npm / `npx`-spawned servers are NOT part of X3.** Reasons, all measured at `32b8764`:
  1. They already work. stdio is real end to end: `connect_mcp` (`warshad/src/lib.rs:1434`) → `check_command` →
     `wave2::require_pinned_launch` (`wave2.rs:765`, launchers `npx pnpm yarn bun bunx npm uvx pipx`, line 754 —
     `npx pkg` without `pkg@x.y.z` is refused) → `InMemoryMcpManager` spawn + handshake. `npx` is in
     `DEFAULT_ALLOWED_COMMANDS` (`auth.rs:1017`).
  2. A registry row's `packages[]` (R-EXT-3: 10 of 100 rows, all `registryType:"npm"`) is **descriptive metadata**
     (`scout_registry` carries `registryType`/`identifier`/`version` and nothing runs it). Turning a row into a stdio
     config means: pick a pinned version, supply `runtimeArguments`/`environmentVariables`, owner approval, and the
     pinned-launch policy. That is a *proposal-install flow*, not a transport, and it is the same later flow that
     converts a `remotes[]` row into an HTTP config. It is owned by a later packet, not this one.
  3. Putting `npx` here would need a new spawn path or a policy relaxation (unpinned `latest` is what most registry
     rows give). X3 must not touch `wave2`/`CommandPolicy`; the pinned-launch policy stays exactly as is.
  Registry reality that justifies HTTP-first: 94 of 100 sampled rows have `remotes` (all `streamable-http`), 10 have
  npm packages (R-EXT-3 Why).

## Why (measured at 32b8764)

- **HTTP is recorded-only today.** `McpServerConfig::is_wired()` is `matches!(transport, Stdio)`
  (`mcp_transport.rs:174`). `InMemoryMcpManager::connect_with` (l.~677) pushes `Disconnected`, no tools, no process id,
  and returns `Ok` for any non-stdio config; `send`/`call_tool_with_timeout` refuse with `NotWired`
  (l.~515, ~828). The module doc (l.37-40) and `docs/DAEMON.md:235` state it. The test
  `connect_http_is_recorded_and_not_dialled` (l.~1495) pins it.
- **No HTTP client in the pipeline.** `crates/warsha-pipeline/Cargo.toml` has no `reqwest`; `reqwest = { version =
  "0.12", features = ["json","rustls-tls","stream"] }` is a workspace dep (`Cargo.toml:56`) used by `warshad`
  (`Cargo.toml:41`, R-EXT-3 `registry_http.rs`), providers, cli, git, relay. R2 (`ARCH_RULES.md:64`) forbids
  pipeline → warshad.
- **The `stream` feature is already on, so reqwest suffices.** Streamable HTTP needs POST with a JSON body, request
  headers, response headers (`Mcp-Session-Id`), status codes (202/404/405), and a *streamed* body for
  `text/event-stream`. `reqwest` gives all of it with `Response::bytes_stream()`/`chunk()` (the same chunk loop
  `registry_http.rs:165` already caps). `futures` is a warshad dep. **No new crate and no `Cargo.lock` change.** The one
  thing reqwest does not give is an SSE parser: it is ~60 lines of pure code and is written in the pipeline (no
  `eventsource` crate; `cargo deny` stays untouched).
- **The injection pattern exists twice; use it.** R-EXT-2's observer: trait `McpCallObserver` lives in the pipeline
  (`mcp_observer.rs`), the store-backed impl `StoreMcpCallObserver` lives in `warshad/src/mcp_call_events.rs`, and
  `warshad` attaches it with `AgentLoop::with_mcp_observer(Arc<dyn …>)` (`agent_loop.rs:410`; wired at
  `warshad/src/lib.rs:365`). R-EXT-3: `RegistryHttp` trait in `warsha-pipeline::scout_registry`, `ReqwestRegistryHttp`
  in `warshad/src/registry_http.rs`, same `ProcessPolicy::check_transport_url` check and 2 MiB / 10 s / 3-redirect
  limits (`registry_http.rs:41-47`). X3 copies the shape: builder method on the manager, default = nothing injected.
- **Where the manager is built.** Production: `startup.rs:260` `Arc::new(InMemoryMcpManager::new(processes.clone()))`.
  Tests: `warshad/src/tests/mod.rs:158` and `:5157`. A manager with **no** HTTP client injected keeps today's
  recorded-only behaviour for `Http` — so pipeline-only tests and every existing test that records an HTTP config stay
  true, and there is no network default in the pipeline.
- **The daemon already guards the URL.** `connect_mcp` runs `ProcessPolicy::check_transport_url` (`auth.rs:1181`: TLS
  anywhere, plain `http` only loopback) before `state.mcp.connect`. `mcp.connect` is Owner/Spend (`auth.rs:576`).
  Dialling therefore adds no new reachable surface beyond "owner-chosen https host", which the config already allowed
  to be *recorded*. The dialler must re-apply the same check on every redirect (as `registry_http.rs:82` does).
- **The client already decodes it.** `McpConnection`/`McpStatus` are unchanged in shape; `packages/client` decodes
  `process_id` as nullable (`index.ts:1748`), so an HTTP connection that is `connected` with `process_id: null` is
  representable. `ConnectionsSection.tsx:234` however treats **every** non-stdio row as "recorded, not connected"
  when it has no tools — wrong once HTTP is live (a connected HTTP server with zero tools would claim "nothing dials
  this address yet"). That one line is in scope.

## What dialling Streamable HTTP needs (spec 2025-06-18, transports)

1. Single endpoint URL; **every** JSON-RPC message is a fresh `POST` with `Accept: application/json, text/event-stream`
   and `Content-Type: application/json`.
2. A *request* is answered with `Content-Type: application/json` (one object) **or** `text/event-stream` (SSE: events
   whose `data:` lines are JSON-RPC messages; the reply is the one whose `id` matches; other messages — notifications,
   server→client requests — are ignored in this packet). The client must support both.
3. A *notification* (`notifications/initialized`) is answered `202 Accepted`, no body.
4. `initialize` reply may carry `Mcp-Session-Id`; if present it is sent on every later request. After `initialize`
   every request carries `MCP-Protocol-Version: <negotiated version>`.
5. `404` on a request with a session id = session expired → connection goes `Error`; no silent re-initialize.
6. `disconnect` sends `DELETE` with the session id (server may answer `405`; both fine, best effort, never blocks the
   local disconnect).
7. Not needed now: the optional `GET` listening stream, resumability (`Last-Event-ID`), server→client requests,
   OAuth. Named in Out of scope.

## Goal

1. `mcp.connect` with `{ transport: { kind: "http", url } }` against a Streamable HTTP server performs
   `initialize` → `notifications/initialized` → `tools/list` and reports `connected` with its tools in `mcp.list`;
   `mcp.call` / agent-loop `call_tool` reach `tools/call` over HTTP under the same permission table as stdio.
2. Every failure (refused policy, DNS, non-2xx, 401, timeout, oversize, bad JSON, session expiry) is an `Error`
   status with a reason — never `connected`, never an empty success.
3. With no dialler injected, behaviour is exactly today's (recorded, `Disconnected`).
4. WebSocket and stdio behaviour unchanged. Proven against an in-process loopback server; no real network in tests.

## Frozen design

### Pipeline (`warsha-pipeline`), no reqwest

New module `mcp_http.rs` (`pub mod` in `lib.rs`; re-export the trait and types):

```rust
#[async_trait]
pub trait McpHttpClient: Send + Sync {
    /// POST one JSON-RPC message. For a request, returns the reply whose id matches `expect_id`
    /// (decoded from a JSON body or from the SSE stream). For a notification (`expect_id = None`)
    /// returns `Ok(HttpReply { message: None, .. })` on 2xx.
    async fn post(&self, url: &str, req: McpHttpRequest) -> Result<McpHttpReply, McpHttpError>;
    /// Best-effort session teardown (`DELETE`). 405/404 are `Ok`.
    async fn close(&self, url: &str, session_id: &str) -> Result<(), McpHttpError>;
}
pub struct McpHttpRequest { pub body: Value, pub expect_id: Option<Value>,
                            pub session_id: Option<String>, pub protocol_version: Option<String>,
                            pub timeout: Duration }
pub struct McpHttpReply { pub message: Option<Value>, pub session_id: Option<String> }
pub enum McpHttpError { Unavailable(String), Status { code: u16, reason: String },
                        SessionExpired, Timeout, Oversize, Protocol(String) }   // thiserror
```

Plus a **pure** `SseDecoder` (`push(&[u8]) -> Vec<SseEvent>`; handles `\n`/`\r\n`, multi-line `data:`, comments,
`event:`/`id:` fields, a chunk split mid-line and mid-UTF-8 sequence) so SSE parsing is tested without a socket.

`InMemoryMcpManager`:
- field `http: Option<Arc<dyn McpHttpClient>>`; builder `with_http_client(self, Arc<dyn McpHttpClient>) -> Self`.
- dialling becomes a manager-level question: stdio always; `Http` iff `self.http.is_some()`; `WebSocket` never.
  `McpServerConfig::is_wired()` stays the *static* "stdio" predicate (making it `Stdio | Http` would lie when no client
  is injected); add a private `fn dials(&self, &McpServerConfig) -> bool` and use it at the three call sites
  (`connect_with`, `send`, `call_tool_with_timeout`); update their doc comments. `is_wired` stays `pub` and unrenamed
  (UI note and DAEMON.md refer to it; no wire/client churn).
- `connect_with` for a dialled `Http`: record `Connecting`-equivalent only internally (the connection row is pushed
  once, at the end, as stdio does); run the same three-step handshake over `post` (reuse the tool-parsing code by
  extracting the `tools/list` result parser from `handshake` into a shared helper — a refactor with identical stdio
  behaviour, covered by the existing stdio tests). `initialize` carries `protocolVersion: "2025-06-18"`
  (`HTTP_PROTOCOL_VERSION`, new const; stdio keeps `MCP_PROTOCOL_VERSION`); the negotiated `protocolVersion` from the
  reply and `Mcp-Session-Id` are kept in a new `http_sessions: Mutex<HashMap<String, HttpSession>>` (url, session id,
  protocol version) beside `launches`. Success → `Connected`, `process_id: None`, tools filled. Failure → row pushed as
  `Error(reason)` and the error returned (same shape as the stdio failure path, l.~1015-1040; no process to stop,
  best-effort `close` if a session id was issued).
- `call_tool_with_timeout` for HTTP: same `tools/call` frame, via `post`, timeout = per-server `response_timeout`
  (default 30 s); result parsing shared with stdio. `SessionExpired` → status `Error("session expired")`.
- `send` (raw seam) for HTTP: refuses with `NotWired`-style error naming "raw frames are stdio-only" — the raw seam
  stays a stdio feature (permission-table bypass risk is already handled in `send_mcp`; do not widen it). Test pins it.
- `disconnect` for HTTP: `close` best-effort (failure logged via `tracing::warn!`, never returned), clear session,
  `Disconnected`, tools cleared, tombstone semantics as today.
- `list`: HTTP rows are reported as stored (no process to observe); the status was set by connect/call.

### Daemon (`warshad`)

- New `src/mcp_http.rs`: `ReqwestMcpHttp { policy: Arc<ProcessPolicy>, client: reqwest::Client }` implementing
  `McpHttpClient`. Rules (same family as `registry_http.rs`, copy its builder, do not share code unless trivial):
  every URL and every redirect re-checked with `check_transport_url`; ≤ 3 redirects; connect+total timeout =
  `req.timeout`; **per-message cap 2 MiB** and SSE stream cap 8 MiB total, counted while streaming (oversize →
  `Oversize`); headers sent: `Accept`, `Content-Type`, `User-Agent: warsha/<ver>`, `Mcp-Session-Id`,
  `MCP-Protocol-Version` — **no cookies, no `Authorization`, no daemon env/token** (daemon bearer/pairing secrets must
  never leave); `401/403` → `Status` with a reason that says "server requires authorization, which this version does
  not support"; `404` with a session id → `SessionExpired`; non-2xx → `Status{code, short reason ≤ 200 chars}`; a 2xx
  request reply that is neither JSON nor SSE, or an SSE stream that ends without the matching id → `Protocol`.
  Server text is data: bounded, never interpolated into a command.
- `startup.rs:260`: `InMemoryMcpManager::new(processes.clone()).with_http_client(Arc::new(ReqwestMcpHttp::new(policy)?))`.
  `warshad/src/lib.rs`: one `mod` line (+ `pub use` if the test harness needs it).
- `connect_mcp` (`lib.rs:1434-1470`): the policy match is unchanged (URL still checked first); only its trailing
  comment ("succeeds without connecting") is corrected for `Http`; `WebSocket` keeps it. Handler body otherwise
  untouched.

### Wire-gate impact: none (prove it)

- No `#[method]` added/renamed; `mcp.connect` params stay `config: McpServerConfig`; `McpServerConfig`,
  `McpTransport`, `McpConnection`, `McpStatus` serde shapes unchanged (the `http` variant and nullable `process_id`
  already exist and are already decoded, `packages/client/src/index.ts:1701-1748`, covered by
  `index.test.ts:2909`). No `METHOD_POLICIES` row change (`mcp.connect` Owner/Spend already).
- Observable change is **behavioural only**: `mcp.connect` for `http` now blocks up to the handshake timeout and can
  return `-32000` with a reason; previously always `null`.
- Proof obligation (step 1 and gates): `node scripts/check-wire-contract.mjs` still prints
  `wire: 11 checks, 0 violations`, and `git diff 32b8764 -- scripts packages/client/src/index.ts` shows only an
  optional comment edit (`index.ts:1553`, "R-EXT-4 makes http real"). If any gate reports a new violation the packet
  **stops and names the method** rather than editing the checker.
- `check-arch`: `reqwest` stays out of `warsha-pipeline/Cargo.toml` (R2); new pipeline module uses only existing deps
  (`serde_json`, `async_trait`, `thiserror`, `tokio`).

### UI (narrow)

- `ConnectionsSection.tsx:234`: `recorded` = `transport.kind === 'websocket' || (transport.kind === 'http' &&
  status is disconnected with no tools)`; a connected/error HTTP row uses the normal empty/error copy. i18n: reuse
  existing keys; add at most one ar+en key (e.g. "needs authorization — not supported yet") only if the daemon reason
  needs a client-side hint. Add-form: offer an "HTTP server (URL)" option producing
  `{ name, transport: { kind:'http', url }, command: null, args: [] }`; `https://` or loopback `http://` validated
  client-side as a hint only (daemon is authoritative). No WebSocket option. Logical CSS properties, `dir="auto"`/
  `<bdi dir="ltr">` for the URL.
- Component tests: connected HTTP row with 0 tools does **not** show `not_wired`; websocket row still does; form
  submits the exact config above; daemon refusal is displayed, not swallowed.

## Tests (each must fail on 32b8764 and pass after; save before/after under `target/discrimination/R-EXT-4/`, ≥ 2)

Pipeline (`warsha-pipeline/tests/mcp_http.rs` + unit tests in the new module), using a fake `McpHttpClient`:
- T1 `SseDecoder`: CRLF, multi-line data, comments, id/event fields, split mid-line and mid-multibyte (Arabic) chunk.
- T2 handshake: fake replies `initialize` (with session id + version), `202`, `tools/list` → `Connected`,
  `process_id None`, tool names/definitions identical in shape to the stdio result; the fake asserts the session id
  and `MCP-Protocol-Version` are sent on calls 2 and 3 and *not* on call 1.
- T3 `call_tool` over HTTP: permission-agnostic transport call returns the parsed `McpToolResult`; `isError` mapped as
  stdio does; `SessionExpired` → `Error` status; timeout → `Timeout`.
- T4 failure rows: `initialize` 401 → `Error("…authorization…")` row and `Err`, never `Connected`; `tools/list`
  missing `tools` → `Protocol`; best-effort `close` called iff a session id was issued.
- T5 `disconnect`: `close` called once; its failure is swallowed; tools cleared; reconnect under the same name works.
- T6 no injected client: `connect_http_is_recorded_and_not_dialled` **unchanged and still passing**; WebSocket
  with a client injected is still recorded; `send` on HTTP refused.
- T7 stdio regression: the existing stdio handshake/timeout/exit tests pass unchanged after the helper extraction.

Daemon (`warshad`, in-process loopback axum server — axum is already a dep; no real network):
- T8 JSON mode: server answers `application/json`; SSE mode: server answers `text/event-stream` with an
  unrelated notification event first, then the matching reply; both complete `initialize`+`tools/list`+`tools/call`.
- T9 session: server issues `Mcp-Session-Id`, rejects (400) a later request without it; `404` after expiry →
  `SessionExpired`; `DELETE` received on disconnect.
- T10 limits: > 2 MiB JSON → `Oversize`; endless SSE → `Oversize`/timeout, connection left `Error`; slow server →
  `Timeout`.
- T11 policy: `http://` non-loopback host refused before any socket (through `mcp.connect` → `-32005`, and directly in
  `ReqwestMcpHttp`); redirect to non-loopback `http` refused; the request the server saw carries no `Authorization`/
  `Cookie` header.
- T12 end-to-end through `RpcImpl`: `mcp.connect` (http, loopback) → `mcp.list` shows `connected` with tools →
  `mcp.call` allowed after `mcp.permissions.set`, `Ask` refused exactly as for stdio → `mcp.disconnect`.
  (Matches the PROGRAM_PLAN X3 row: handshake + `tools/list` + `tools/call` against an in-process HTTP server; plain
  http to a non-loopback host refused.)
- UI: the component tests above, plus `packages/client` tests unchanged and green.

## Allowed files

- `crates/warsha-pipeline/src/mcp_http.rs` (new), `crates/warsha-pipeline/src/mcp_transport.rs`,
  `crates/warsha-pipeline/src/lib.rs` (`mod`/`pub use` lines only), `crates/warsha-pipeline/tests/mcp_http.rs` (new)
- `crates/warshad/src/mcp_http.rs` (new), `crates/warshad/src/startup.rs` (the one construction line),
  `crates/warshad/src/lib.rs` (`mod` line + the `connect_mcp` comment only), `crates/warshad/src/tests/` (T8–T12 only)
- `apps/desktop/src/v3/pages/settings/sections/ConnectionsSection.tsx` + `ConnectionsSection.test.tsx`,
  `packages/i18n/src/v3/{ar,en}/*` (only the key(s) named above), `packages/client/src/index.ts` (comment at l.1553 only)
- `docs/DAEMON.md` (the `mcp.connect` row, l.235 only), `DECISIONS.md`, `PROGRESS.md`,
  `docs/zadloop/packets/R-EXT-4-report.md` (new)

`Cargo.toml`, `Cargo.lock`, any `Cargo.toml` dependency line, `scripts/check-*`, `ARCH_RULES.md`, `auth.rs`
(`METHOD_POLICIES`, `check_transport_url`), `wave2.rs`, `CommandPolicy` — **not allowed**; needing one is a stop-and-
report.

## Out of scope

npx/npm/pip/uvx servers from registry rows and any proposal→config conversion (the verdict above; later packet,
owner-approved); the WebSocket transport; the optional `GET` listening stream, resumability/`Last-Event-ID`,
server→client requests (sampling/elicitation/roots), server notifications (`tools/list_changed` refresh); OAuth /
bearer headers / API-key headers for remote servers (a 401 is reported, not solved — that needs the keychain
design); the legacy 2024-11-05 HTTP+SSE transport and fallback; automatic reconnect or re-initialize; scout/registry
wiring into the daemon or UI; any new RPC method; **R-UI-7b bridge work** (the app-assets/bridge follow-up from
R-UI-7) and any `apps/desktop` file other than `ConnectionsSection*`; editing `wave2`/`CommandPolicy`; a shared HTTP
crate refactor with `registry_http.rs`; SSRF hardening beyond the existing `check_transport_url` + redirect re-check
(an owner-chosen https host resolving to a private address is the existing, accepted `mcp.connect` surface — record
it in the report as a known limit); baselines.

## Constraints

- Rust stable; no `unwrap()`/`expect()` outside tests; errors via `thiserror`/`anyhow`; `cargo fmt`; clippy `-D warnings`.
- No real network in tests (loopback server or fakes). Never send the daemon token, pairing material, cookies or
  `Authorization`; never log request bodies, URLs' query strings, or session ids (log the host only).
- A failed or never-dialled HTTP connection is never `connected`; an HTTP server with 0 tools is not reported as
  "recorded". Offline = error, not empty success.
- Stdio behaviour is byte-for-byte unchanged; the extraction of shared parsing must not alter any existing stdio test.
- UI: strings via ar+en catalogs only, logical CSS properties, no `any`.
- Small Conventional Commits (pipeline / daemon / ui separately); self-review each diff; do not touch another lane's
  dirty files; update PROGRESS.md; DECISIONS.md entry: "X3 = Streamable HTTP only; npx stays stdio + pinned; HTTP
  client injected, reqwest in warshad" (resolves D-EXT-1 for MCP dialling).

## Steps

1. Re-verify at the worktree base and record outputs: `git grep -n "is_wired" -- crates` (expect mcp_transport.rs
   l.174/~515/~677/~828 + test + warshad comment), `git grep -n "reqwest" -- crates/warsha-pipeline/Cargo.toml` (empty),
   `node scripts/check-wire-contract.mjs` (11 checks, 0 violations), and the current `ConnectionsSection` test count.
2. Write T1–T7 red on base, then `mcp_http.rs` (trait, types, `SseDecoder`) and the manager changes; pipeline gates.
3. Write T8–T12 red, then `ReqwestMcpHttp` + startup injection; daemon gates.
4. UI change + component tests; DAEMON.md row; i18n parity check.
5. Discrimination artifacts, DECISIONS/PROGRESS, report with: the wire-gate result, the known-limits list (no auth,
   no GET stream, private-address https), and any gate not run.

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
pnpm --filter @warsha/client test
pnpm --filter @warsha/desktop test -- ConnectionsSection
pnpm -r typecheck && pnpm -r lint
git grep -n "reqwest" -- crates/warsha-pipeline/Cargo.toml        # must print nothing
git diff --stat 32b8764 -- Cargo.toml Cargo.lock scripts crates/warshad/src/auth.rs crates/warshad/src/wave2.rs   # must be empty
```

If a `pnpm` filter name differs, use the package's actual name from its `package.json` and say so in the report.
Any gate not run is named in the report, not called passed.
