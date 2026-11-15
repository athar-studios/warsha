# R-EXT-1 — Connections: client MCP wrappers and the Connections screen (X4) · after R-UI-4B

Status: spec frozen. Base: `d8dc8d3` (repair/dev-csp-f474776). Planner lane. Pattern: R-BRIDGE-B3b
(`R-BRIDGE-B3b.md`). Licence wording: "free and source-available". **No Rust. No new RPC method.**

## Why (measured at d8dc8d3)

- The daemon already serves `mcp.connect` (`crates/warshad/src/api.rs:275`, Owner/Spend, `auth.rs:576`),
  `mcp.disconnect` (`api.rs:281`, Owner/Standard, `auth.rs:581`) and `mcp.list` (`api.rs:284`, Session/Standard,
  `auth.rs:586`). `mcp.list` returns `McpConnection` rows (`warsha-pipeline/src/mcp_transport.rs:253`):
  `config{name,transport{kind:stdio|http|websocket,url?},command,args}`, `status`, `process_id`, `tools: string[]`,
  `tool_definitions[{name,description,input_schema,annotations}]`.
- `packages/client/src/index.ts` has **no** wrapper for these three (`grep "mcp\."` hits only `mcp.approvals.*` and
  `mcp.permissions.*`, lines 1438-1700). A screen cannot show a server, its tools or its error.
- `apps/desktop/e2e/harness.ts` `RPC_METHODS` (l.120-145) lists no `mcp.list|connect|disconnect`; per W9 a client
  method without a stub fails the wire gate, and per `harness.ts` an unstubbed method fails the e2e case.
- `docs/DAEMON.md` documents `mcp.approvals.*` / `mcp.permissions.*` (l.179-182, 196-202) and **not** the three.
- No Connections screen: `SETTINGS_SECTIONS` (`pages/settings/types.ts`) has `mcp` = `McpPermissionsSection`
  (permission rows only). Nothing lists servers, status, tools or errors; `sections/` has no `ConnectionsSection`.
- Serde shape trap: `McpStatus` is externally tagged snake_case — unit variants arrive as strings
  `"connected" | "connecting" | "disconnected"`, `Error(String)` arrives as `{ "error": "<message>" }`. A decoder that
  only reads strings turns every failed server into a decode error.
- Honesty facts the screen must not hide: `Http`/`WebSocket` configs are *recorded, not dialled* — `mcp.list`
  reports them `disconnected` with no tools (`mcp_transport.rs:38`, `lib.rs` connect_mcp comment); X3 (R-EXT-4) makes
  HTTP real later. stdio launches must be pinned (`wave2::require_pinned_launch`, `pkg@x.y.z`) and pass the
  process policy; refusals surface as RPC errors.

## Goal

Settings → Connections: list configured MCP servers with status (connected / connecting / disconnected /
error + message), transport, tools; add a stdio server, disconnect one, refresh status, and set the per-tool
permission through the existing `mcp.permissions.*`. Client wrappers + decoders, harness stubs, registry entries,
ar+en strings, tests, DAEMON.md rows.

## Frozen design

**Wire verdict: no new method, no changed shape.** All three methods exist in `api.rs`, `lib.rs`, and
`METHOD_POLICIES`. Wire-contract gate impact (R7, `check-wire-contract.mjs`): the client newly *sends* three names →
W1 (daemon registers: satisfied), W9 (harness stub required: **must add**), W2 (stubs ⊂ daemon: satisfied),
W7/W8 (param count/names: `mcp.connect` binds `config`; `mcp.disconnect` binds `name`; `mcp.list` none — use exactly
those keys). W3–W6 and arch gate (`check-arch.mjs`) untouched: no Rust, no new crate edges. Expected: `wire: 11
checks, 0 violations`. If W7/W8 report a name mismatch, fix the client call, never the checker.

**Client (`packages/client/src/index.ts`)** — new interface `WarshaMcpConnectionsApi`, implemented by
`WarshaClient`, mirroring `WarshaMcpApi` (decoders via `wiringObject/wiringString/wiringArray`, errors via
`WIRING_RESULT_ERROR`):

- `mcpList(): Promise<McpConnection[]>` → `rpc('mcp.list')`.
- `mcpConnect(config: McpServerConfig): Promise<void>` → `rpc('mcp.connect', { config })` (snake_case body:
  `name, transport:{kind:'stdio'}, command, args`; `McpServerConfig` UI type camelCase-free because the daemon's
  fields are single words).
- `mcpDisconnect(name: string): Promise<void>` → `rpc('mcp.disconnect', { name })`.
- Types `McpConnection`, `McpServerConfig`, `McpTransport`, `McpStatus` (`{kind:'connected'|'connecting'|
  'disconnected'} | {kind:'error'; message}` — the decoder normalises string and `{error}` forms),
  `McpToolInfo {name, description, readOnly?, destructive?}` (from `tool_definitions`, falling back to `tools`
  names when definitions are empty). Unknown status → decoder error, not a default.
- No `mcp.send`/`mcp.call` wrapper (out of scope, raw seam).

**Screen** — new `sections/ConnectionsSection.tsx`, new `SettingsSectionId` `'connections'` (advanced, scope daemon),
placed before `mcp`; the existing `mcp` section (permission table + revoke) is **unchanged**. Row-list pattern of
`McpPermissionsSection.tsx`/`DevicesSection.tsx`, not a `<table>`. Per server row: name, transport pill, status
`StatusPill` (done/waiting/failed mapping as in `PERMISSION_VIEW`), last error text when `error`, `process_id` hidden,
tool list (expandable); per tool a permission selector (allow/ask/deny; value from `mcpPermissionsList` rows for role
`agentRole`, else `defaultPermission`) writing `mcpPermissionsSet(server, tool, agentRole, permission)` — the role
comes from the daemon's reply, never hard-coded. Add form: name, command, args (space-split, shown as typed), stdio
only; Http/WebSocket are not offered (recorded-not-dialled; X3). Disconnect needs the open→confirm pattern of
`settings.device.revoke.*`. "Test connection" = **Refresh status** (re-run `mcp.list`); the daemon has no probe
method and this packet adds none — the label and desc say "refresh", never "test passed". A `disconnected` server
with zero tools shows the "not connected yet" note, not an empty-tools success state. Daemon refusals (unpinned
package, policy, duplicate name) render verbatim in a `Banner`; `useDataReady` contract as in `McpPermissionsSection`.

**Registry (`actions/registry/settings.ts`)**, each with e2e proof (actions-gate A6):
`settings.connections.refresh` (rpc `mcp.list`), `settings.connections.add` (rpc `mcp.connect`),
`settings.connections.disconnect.open` (state), `settings.connections.disconnect.confirm` (rpc `mcp.disconnect`),
`settings.connections.tool.permission` (rpc `mcp.permissions.set`), `settings.connections.tools.toggle` (state).

**Harness (`apps/desktop/e2e/harness.ts`)**: add `mcp.connect`, `mcp.disconnect`, `mcp.list` to `RPC_METHODS`
(alphabetical, before `mcp.permissions.*`) and stubs: `mcp.list` default `[]` overridable through `fixtures`;
`mcp.connect` checks `config` present and that `config.name` is non-empty, rejects unpinned `npx` commands with
`-32602`-class refusal; `mcp.disconnect` checks `name`. Fixtures supply connected / error `{error:"…"}` / http
disconnected rows.

## Allowed files

- `packages/client/src/index.ts`, `packages/client/src/index.test.ts`
- `apps/desktop/e2e/harness.ts`, `apps/desktop/e2e/v3/settings.spec.ts` (or new `connections.spec.ts` in that dir)
- `apps/desktop/src/v3/actions/registry/settings.ts`
- `apps/desktop/src/v3/pages/settings/{types.ts,index.tsx,SettingsNav.tsx,settings.css}` (row classes only),
  new `sections/ConnectionsSection.tsx` + `ConnectionsSection.test.tsx`, `Settings.test.tsx` only if a nav-count
  assertion exists
- `packages/i18n/src/v3/{ar,en}/settings.ts`
- `docs/DAEMON.md` (rows for the three methods + client wrapper names), `docs/zadloop/packets/R-EXT-1-report.md`
- `scripts/check-wire-contract.mjs` **only** if it demands a row; expected: not touched.

## Out of scope

Any Rust, new RPC method, probe/test method, HTTP/WebSocket dialling (R-EXT-4/X3), registry browse (R-EXT-3/X5),
plugin round trip (R-EXT-2), editing server config in place, env/secret fields, `mcp.send`/`mcp.call` UI, changing
`ToolPermission` semantics, the existing `mcp` permissions section, Inbox, baselines/snapshots (none refreshed),
gate tools and `check-ds-v3.mjs` (not edited).

## Constraints

- UI strings only via catalogs: every new key in **both** `ar` and `en` `settings.ts`, same key set (i18n-gate);
  Arabic is real copy, not a copy of English; LTR tokens (command, args, URL, tool names) rendered `dir="ltr"`
  inside an RTL row; `dir="auto"` on server-supplied text (error message, tool description).
- RTL-safe CSS: logical properties only; tokens only (check-ds-v3 → 0); no new colours (contrast gate).
- No `any`, strict TS; decoders reject missing/mistyped fields with the method name in the error.
- Server-supplied text (error, descriptions) rendered as text, never HTML; no secrets are entered or shown here.
- Every control reachable by keyboard, has an accessible name from a catalog key.
- Never weaken or delete an existing test; new tests must fail on `d8dc8d3` and pass on the new code (save before/after
  output under `target/discrimination/r-ext-1/`).
- Small Conventional Commits on an `r-ext-1-*` branch from the merge tip; implementer does not edit gate tools;
  reviewer/verifier separate. No force push, tag, publish; mock provider only.
- `client/src/index.ts` and `harness.ts` are shared files: one lane at a time.

## Steps

1. Client types + decoders + 3 methods; unit tests: list decodes all four statuses incl. `{error:"x"}`; unknown status,
   missing `config.name`, non-array reply each throw naming `mcp.list`; connect sends exactly `{config}`; disconnect
   sends exactly `{name}` (param-name assertion, as W8).
2. Harness: methods + stubs + fixtures. Run `node scripts/check-wire-contract.mjs` → 11/0 (W9 proof).
3. Registry entries, i18n ar+en keys (`settings.section.connections[.desc]`, status, transport, add form, refresh,
   disconnect confirm, not-wired note, permission labels reuse `settings.mcp.permission.*`).
4. `ConnectionsSection.tsx` + nav registration; component tests: each status renders, error text shown, tool
   permission change calls `mcpPermissionsSet` with the reply's `agentRole`, disconnect needs confirm, refusal banner.
5. E2E (`@non-visual`, no snapshots): add stdio server → row appears connected with tools; error fixture shows
   message; set a tool permission; disconnect via confirm; refresh. Each registered action exercised.
6. DAEMON.md rows; discrimination run; report.

## Gates (exact; run from repo root; `TOOLS=bridge-io/policy/2026-11-09-ui-v3/tools`)

Rust — none touched; prove it: `git diff --name-only d8dc8d3 | grep -E '\.rs$|Cargo' ` prints nothing. The Rust gates
are quoted from base, not re-run: `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
`cargo test --workspace --all-targets`, `node scripts/check-arch.mjs` (+`--self-test`),
`node scripts/check-engineering-policy.mjs` — plus run the two cheap ones that watch this diff:
- `node scripts/check-wire-contract.mjs` → `wire: 11 checks, 0 violations`, exit 0; `--self-test` exit 0.
- `node scripts/check-arch.mjs` exit 0.

TypeScript:
- `pnpm lint` 0; `pnpm typecheck` 0; `pnpm -r test` 0 (counts ≥ baseline from R-UI-4 report, plus new tests);
  `pnpm build` 0.
- `node scripts/check-ds-v3.mjs apps/desktop/src/v3 packages/ui/src/v3 apps/remote/src` → 0 violations.
- `node $TOOLS/i18n-gate.mjs "$PWD"` 0; `node $TOOLS/actions-gate.mjs "$PWD"` 0 (A6: every new action e2e-proven);
  `node $TOOLS/contrast.mjs --check-css packages/ui/src/v3/tokens/tokens.css` 0.

E2E:
- `pnpm exec playwright test --project=desktop apps/desktop/e2e/v3 --grep-invert "@visual"` → 0 failed,
  passed ≥ R-UI-3 baseline (286) + new cases; the Connections cases named in the report.
- `planner-simplicity`: copy from `$TOOLS` into `apps/desktop/e2e/v3/`, run, **delete before commit**; confirm
  `git status` shows it absent.

## Acceptance

- Three client methods exist; wire gate 11/0 with W1/W9 satisfied; no `.rs` in the diff.
- Connections section shows status/error/tools per server and drives add/disconnect/refresh/permission via real
  method names through the harness; every registered action e2e-proven.
- ar and en catalogs complete; RTL render verified in e2e (`dir=rtl` case).
- Report states: Rust gates not re-run (no Rust touched), HTTP/WebSocket rows shown as "recorded, not connected".

## Open points (defaults applied)

- OD-EXT1-a: "test connection" has no daemon probe → default Refresh status; a real probe would be a new method and a
  separate Rust packet with the wire/arch gates.
- OD-EXT1-b: a new `connections` section rather than extending `mcp`, to leave B3b's section and tests untouched.
