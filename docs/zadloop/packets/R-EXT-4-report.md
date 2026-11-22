# R-EXT-4 report — Streamable HTTP MCP (X3)

**Status: DONE, with one recorded deviation (a test outside the packet's allowed list had to
move) and one named red gate (the pipeline's `process_spawn::k5_repair` tracing test is flaky
and red at the base).** `McpTransport::Http` is dialled: `mcp.connect` with an `http` config
runs the Streamable HTTP handshake over an injected `McpHttpClient`, `mcp.call` reaches
`tools/call` under the same permission table as stdio, and a manager with no client injected
keeps today's recorded-only behaviour. No new RPC method, no new wire field, no new crate, no
`Cargo.lock` change, no credential, no WebSocket dialling.

- **Branch:** `zl-rext4-http` (isolated worktree `/home/moe/Downloads/Warsha-rext4`).
- **Base:** `1b9bc69` on `repair/dev-csp-f474776` (the merge that froze this packet).
- **Commits:**

| Commit | What |
|---|---|
| `6917e85` | `feat(pipeline): Streamable HTTP MCP transport behind an injected client (R-EXT-4)` — `mcp_http.rs` (trait + types + pure `SseDecoder`), the manager's dial path, session bookkeeping, the two extracted parsers, T1–T7 |
| `de466bd` | `feat(warshad): dial Streamable HTTP MCP servers with a policy-bounded client (R-EXT-4)` — `src/mcp_http.rs`, the startup injection, the `docs/DAEMON.md` row, T8–T12 |
| `8fb7a07` | `feat(ui): add an HTTP server from the Connections form, and stop calling it recorded (R-EXT-4)` — transport picker + url field, the `recorded` rule, one new ar+en key |
| `85d10b7` | `test(warshad): move the recorded http assertion onto the transport nothing dials (R-EXT-4)` — `tests/security_identity.rs` and one doc comment in `src/tests/mod.rs` (the deviation, below) |
| *(this file + `DECISIONS.md` + `PROGRESS.md`)* | `docs(zadloop): R-EXT-4 report and decisions` |

## What shipped

**The seam (`crates/warsha-pipeline/src/mcp_http.rs`, 358 lines).** `McpHttpClient` is two
methods — `post(url, McpHttpRequest) -> Result<McpHttpReply, McpHttpError>` and
`close(url, session_id)` — exactly the shape the packet froze. `McpHttpRequest` carries the
body, the `id` the reply must match (`None` for a notification), the session id, the negotiated
revision and the bound; `McpHttpReply` carries the matched message and any `Mcp-Session-Id` the
server sent; `McpHttpError` distinguishes `Unavailable` / `Status { code, reason }` /
`SessionExpired` / `Timeout` / `Oversize` / `Protocol`. `HTTP_PROTOCOL_VERSION` is `"2025-06-18"`
(the stdio handshake keeps `"2024-11-05"`, untouched).

**`SseDecoder` is pure and total.** `push(&[u8]) -> Vec<SseEvent>`: `\r\n`, `\n` and a lone
`\r` all end a line; a blank line dispatches; `data:` lines join with `\n`; one leading space
after the colon is stripped; `:` comments and unknown fields are ignored; a block with no
`data:` line is not an event (and its `event:`/`id:` do not leak into the next one); `event:`
and `id:` are kept on the event. Lines are decoded only once terminated, so a chunk that ends
mid-line or mid-multibyte-character waits for the rest — nine unit tests pin exactly those
cases, one of them byte-at-a-time Arabic.

**The manager.** `InMemoryMcpManager::with_http_client(Arc<dyn McpHttpClient>)` is the whole
opt-in. `dials(&self, &McpServerConfig)` is the new predicate (stdio always, http if a client
was injected, websocket never) and replaces `config.is_wired()` at the three call sites;
`is_wired` itself is unchanged in name and answer, with a doc explaining why it stays the
static predicate. `connect_with` for a dialled `http` config runs the same three steps stdio
runs (`initialize` → `notifications/initialized` → `tools/list`), pushes **one** row at the end
(`Connected`, no process id, the server's tool names and definitions) or one `Error(reason)`
row, and closes any session it opened before the failure. `call_tool_with_timeout` posts
`tools/call` inside the session and maps the answer through the same parser stdio uses.
`send` refuses with `RawFramesStdio` — an HTTP server has no raw seam. `disconnect` sends the
best-effort `DELETE`, logs a refusal, and completes the local disconnect regardless.
`cancel_reason` (`SessionExpired`) is reported, never repaired: nothing re-initializes behind
the owner's back.

**The client (`crates/warshad/src/mcp_http.rs`, 375 lines).** `ReqwestMcpHttp::new(ProcessPolicy)`
builds a `reqwest::Client` whose redirect policy is the daemon's — the cap first (3), then the
same `ProcessPolicy::check_transport_url` the first request went through, so a server cannot
bounce the daemon from TLS onto a plain-http host it would never have dialled. Per request:
`Accept: application/json, text/event-stream`, `Content-Type: application/json`,
`User-Agent: warsha/<version>`, and — once `initialize` answered — `Mcp-Session-Id` and
`MCP-Protocol-Version`. A JSON body is capped at 2 MiB, an event stream at 8 MiB, both counted
while reading (a declared `Content-Length` past the cap is refused before the body is read).
`401`/`403` → `Status { code, "the server requires authorization, which this version does not
support" }`; `404` on a sessioned request → `SessionExpired`; other non-2xx → `Status` with a
≤200-character reason taken from a ≤1 KiB prefix of the body. SSE replies are decoded by the
pipeline's `SseDecoder` and matched by `id`, so a notification event arriving first does not
confuse the answer.

**Startup (`crates/warshad/src/startup.rs`, 9 lines).** The manager is now
`InMemoryMcpManager::new(processes).with_http_client(Arc::new(ReqwestMcpHttp::new(ProcessPolicy::from_config(&config.allowed_commands, &config.data_dir))?))`,
right where `start_daemon_with_provider_factory` already builds the daemon's spawner. Nothing
else in that file changed.

**UI.** The add form gained the two transports the revision defines (no WebSocket option), and
an HTTP submission is exactly `{ name, transport: { kind: 'http', url }, command: null, args: [] }`.
The url is validated client-side as a **hint only** (`https` anywhere, plain `http` only on
`localhost`/`127.0.0.0/8`/`[::1]`), the field is `dir="ltr"`, and the daemon's own refusal —
a 401 included — is what the banner shows. The row's "recorded, not connected" note is now
`websocket`-only, plus an `http` row that is still `disconnected` with no tools: a connected or
failed HTTP server no longer claims nothing dials an address the daemon just dialled. One new
ar+en key (`settings.connections.add.url`, carrying the rule) and two updated ones
(`add.title`, `add.stdio_only`); everything else was reused.

## Gates (final tree, each command run as written)

| Gate | Result |
|---|---|
| `cargo fmt --all --check` | **0** |
| `cargo clippy --workspace --all-targets -- -D warnings` | **0** |
| `cargo test -p warsha-pipeline --all-targets` | **0** — 546 passed / 0 failed / 7 ignored across 6 targets: lib 508 (7 ignored) and the 5 integration targets 6+4+**14 new**+1+13 (see the flake note) |
| `cargo test -p warshad --all-targets` | **0** — lib 252 passed / 4 ignored (13 of them the new `mcp_http` module) + 19 integration targets, `security_identity` included |
| `cargo test --workspace --all-targets` | **0** — **1,129 passed, 0 failed, 0 `test result: FAILED`** |
| `node scripts/check-wire-contract.mjs` + `--self-test` | **11 checks, 0 violations**; self-test "11 checks fire, clean fixture is clean in both modes" — **unchanged from base** |
| `node scripts/check-arch.mjs` + `--self-test` | **5 rules, 0 violations**; self-test 5 rules fire — R2 (pipeline holds no `reqwest`) holds |
| `node scripts/check-engineering-policy.mjs` + `--self-test` | **8 checks, 0 failures**; self-test 8 checks fire |
| `cargo deny check` | **0** — `advisories ok, bans ok, licenses ok, sources ok` |
| `pnpm --filter @warsha/client test` | **0** — 193 tests, `wire-contract.test.ts` included |
| `pnpm --filter warsha-desktop test -- ConnectionsSection` | **0** — 17 tests (13 at base + 4 new) |
| `pnpm -r typecheck && pnpm -r lint` | **0** (one pre-existing `react-hooks/exhaustive-deps` warning in `inbox/index.tsx`, untouched) |
| `pnpm --filter @warsha/i18n test` | **0** — 58 tests, ar/en key parity passes with the new key |
| `pnpm --filter warsha-desktop test -- src/v3/actions` | **0** — 12 tests (the action registry is unchanged: the transport picker is a form field, not an action) |
| `node scripts/check-ds-v3.mjs apps/desktop/src/v3/pages/settings/sections/ConnectionsSection.tsx` | **0** — 0 violations |
| `git grep -n "reqwest" -- crates/warsha-pipeline/Cargo.toml` | prints **nothing** (exit 1) |
| `git diff --stat 32b8764 -- Cargo.toml Cargo.lock scripts crates/warshad/src/auth.rs crates/warshad/src/wave2.rs` | **empty** |

**Two `pnpm` filter names were the planner's guess.** `@warsha/client` is correct;
`@warsha/desktop` is **`warsha-desktop`** in `apps/desktop/package.json` — that is the name used
above. `@warsha/i18n` exists and is the catalog package.

**Named red gate (pre-existing, not mine).**
`process_spawn::k5_repair::stderr_secret_spawned_child_redacts_sentinel_from_ring_and_tracing`
fails when run alone on the **untouched base** (`cargo test -p warsha-pipeline --lib
process_spawn::k5_repair` at `1b9bc69`: 9 passed, 1 failed, `panicked at
crates/warsha-pipeline/src/process_spawn.rs:3139: tracing event must contain masked output: `).
It also failed once on this branch in a full-suite run and passed on the final two, so it is
order/timing dependent. `process_spawn.rs` is outside this packet and was not touched.

## Live-vs-fixture proof

No internet, and no fixture file either: every proof is a **real HTTP server on a real loopback
socket** driven by the real `reqwest` client.

- `crates/warshad/src/tests/mcp_http.rs` binds `127.0.0.1:0` per test (the kernel picks the
  port) and serves an axum app that reads the request headers and body **as the server sees
  them**. `a_json_server_completes_the_handshake_and_a_call` and
  `an_sse_server_completes_the_handshake_and_a_call` complete the full path through the
  manager; the server's transcript proves the wire: methods in order
  (`initialize`, `notifications/initialized`, `tools/list`, `tools/call`), no `Mcp-Session-Id`
  on the first and the issued id on all three later requests, `MCP-Protocol-Version:
  2025-06-18` on all three later requests, and `id: null` on the notification.
- `an_sse_server_completes_the_handshake_and_a_call`'s server sends an unrelated
  `notifications/message` event **before** the reply, so the id-matching is proved rather than
  assumed.
- `no_credential_leaves_the_process` reads `authorization`, `cookie` and every header **name**
  off the wire: none beyond `accept`, `content-type`, `host`, `mcp-session-id`,
  `mcp-protocol-version`, `user-agent` and `content-length` ever arrives.
- The refusals are proved on hosts that cannot resolve (`http://mcp.example/mcp`) so a message
  about `loopback` is evidence the check ran *before* a socket: `a_plain_http_host_off_loopback_is_refused_before_a_socket`
  also proves the same refusal fires on a **redirect target** (a loopback server answering
  `302 → http://mcp.example/mcp`), with the server's own transcript showing exactly one request
  — the redirect was never followed.
- Pipeline-side, `crates/warsha-pipeline/tests/mcp_http.rs` uses a `FakeHttp` client that
  implements the public trait, so the pipeline half is proved with **no socket at all** — which
  is the point of the injection.

## Session-expiry proof

`a_session_is_required_echoed_expired_and_deleted` (daemon, real loopback server) and
`an_expired_session_turns_the_connection_into_an_error` (pipeline, scripted client) both pin the
same three facts: a request without the session is `400` at the server (so the echo on the
successful calls is load-bearing, not an accommodating handler); a `404` on a sessioned request
becomes `McpTransportError::SessionExpired`, the row's status becomes
`Error("… session expired …")`, and the server's transcript shows **no second `initialize`** —
four requests, one handshake, one refused call; and `disconnect` sends the `DELETE` once, with
the session, while a refusing `DELETE` (`405`, tested directly) leaves the local disconnect
done.

## Design-point confirmations

1. **X3 = Streamable HTTP only.** `McpTransport::WebSocket` is never dialled:
   `a_websocket_config_is_still_recorded_and_raw_frames_are_stdin_only` asserts the server
   transcript is empty with a client injected, the row is `disconnected`, and `send` refuses
   with `NotWired`.
2. **`npx` untouched.** `wave2.rs`, `CommandPolicy` and `auth.rs` are byte-identical to the base
   (`git diff --stat 32b8764 -- …` empty); no registry→config flow was added.
3. **No new RPC method, no new wire field.** Wire gate 11 checks / 0 violations, same as base;
   `packages/client/src/index.ts` changed only in the comment the packet allows.
4. **No new crate, no `Cargo.lock` change.** `grep reqwest crates/warsha-pipeline/Cargo.toml` is
   empty; `Cargo.lock` is unchanged; `cargo deny check` is clean on the same graph.
5. **R2 boundaries.** The trait and the SSE parser live in the pipeline; the only `reqwest` use
   is `warshad/src/mcp_http.rs`; `check-arch.mjs` 5 rules / 0 violations.
6. **No credential, no cookie, no OAuth.** `no_credential_leaves_the_process` and
   `a_401_is_reported_and_not_solved` (nothing retried, the message names authorization).
7. **Expiry is reported, not repaired.** Above.
8. **Best-effort `DELETE`.** Above, plus `a_refused_delete_is_still_a_closed_session` (a `405`).
9. **Default stays recorded.** `without_a_client_an_http_config_is_recorded_and_not_dialled`
   (pipeline) and `mcp_connect_records_an_http_transport_without_dialling_it` (through the
   RPCs, whose test state injects no client) both still pass unchanged in behaviour.
10. **Stdio is unchanged.** The two parsers were extracted (`parse_tools_list`,
    `parse_tool_result`) and are now shared; every pre-existing stdio test — handshake, timeout,
    silent server, error server, exit, cleanup, env, re-connect — passes with no edit.
11. **UI.** The exact config shape is asserted in `adds an HTTP server: the config carries the
    url and no command`; the hint is a hint (`refuses an HTTP url the daemon would not dial,
    without calling it` asserts no RPC was made); the daemon's refusal stays verbatim; RTL copy
    renders.

## Discriminations (`target/discrimination/R-EXT-4/`)

Reverse-patched on the final tree and restored (`git diff` empty after each), so each run is the
same test against the same code with one behaviour removed:

| Artifact | What it shows |
|---|---|
| `red-pipeline-without-the-dial-guard.txt` | `connect_with` back on `config.is_wired()` → **11 of 14 fail**; the 3 that pass are exactly the ones asserting the recorded default |
| `after-pipeline-green.txt` | 14/14 |
| `red-daemon-without-the-expiry-mapping.txt` | the `404`-on-session branch disabled → `a_session_is_required_echoed_expired_and_deleted` **fails**, 12 pass |
| `after-daemon-green.txt` | 13/13 |
| `red-ui-with-the-old-recorded-rule.txt` | `recorded = transport.kind !== 'stdio'` → **2 fail** / 15 pass |
| `after-ui-green.txt` | 17/17 |

The packet asked for ≥ 2; three are saved. They are behavioural reds, not compile reds — on
`32b8764` these tests cannot even build, because `warsha_pipeline::mcp_http` does not exist
there.

## Deviation, recorded (one file outside the allowed list)

`crates/warshad/tests/security_identity.rs:476` asserted that `mcp.connect` with
`https://mcp.example/mcp` is **recorded** ("a remote transport is bounded to a secure or loopback
endpoint"). With R-EXT-4 the daemon dials an `http` config, so that call now fails on DNS — the
test encoded the behaviour this packet deliberately ends, and the packet's own gate
(`cargo test -p warshad --all-targets`) cannot be green with it as written. The secure-url half
of the rule moved onto a `web_socket` config (`wss://mcp.example/ws`): the policy is the same
function and nothing dials a websocket, so the rule is still asserted, with no network. The
plain-`http` refusal above it is untouched. This is the **only** edit outside the packet's
allowed files, it weakens nothing, and it is called out here so it can be accepted or reverted
by the reviewer. `crates/warshad/src/tests/mod.rs` also gained a five-line doc comment on
`mcp_connect_records_an_http_transport_without_dialling_it` saying why it still holds (that test
state injects no client) — same file family, no behaviour change.

## Open items (not done here, by design)

- **Remote credentials** (bearer/OAuth): a `401` is reported and never solved. This is the
  packet's own out-of-scope item; it needs the keychain design.
- **`mcp.disconnect`'s `docs/DAEMON.md` row** still says "Stops the named server's child and
  drops the connection row" — for an `http` server it now also sends the `DELETE`. The packet
  allowed the `mcp.connect` row only, so the row was left alone rather than edited out of scope.
- **SSRF hardening** (an owner-chosen `https` host resolving to a private address) is unchanged
  from the recorded-only surface and is not narrowed here; recorded in `DECISIONS.md`.
- **`GET` stream, WebSocket, resumability (`Last-Event-ID`)**: the parser keeps `id:`, nothing
  consumes it yet.
- **`McpStatus::Connecting`** still never appears on the wire (unchanged): the row is pushed
  once, at the end, exactly as stdio does.
