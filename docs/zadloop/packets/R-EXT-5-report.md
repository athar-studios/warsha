# R-EXT-5 report — X9a WebMCP: four navigation tools behind an off-by-default device switch

**Status: DONE, with one narrowed acceptance line recorded below (E2 `gates.*`) and no unrun code gate.** The four
tools are registered only while the owner's device switch is on; with it off, `registerTool` is never called (T4 and
E1 assert zero calls, not "few tools"). Every gate in the packet was run on the final tree; the ones this lane could
not run are named at the end.

- **Branch:** `zl-rext5-webmcp` (isolated worktree `/home/moe/Downloads/Warsha-rext5`).
- **Base:** `cd94f53` on `repair/dev-csp-f474776` — **two commits newer than the packet's `68a8d5d`**, both
  pre-existing fixes this lane did not touch (see *Step-1 actuals*).
- **Commits:** listed under *Commits* below; nothing else is on the branch.

## Commits

| Commit | What |
|---|---|
| `2e21c22` — `feat(desktop): WebMCP platform edge, safe list, device switch and bridge (R-EXT-5 X9a)` | `webmcp/{modelContext,safeList,setting}.ts`, `WebMcpBridge.tsx`, their four test files (T1–T9, 26 cases), and the one-element mount in `V3App.tsx` |
| `03adca3` — `feat(desktop): browser-assistant switch in Settings › General (R-EXT-5 X9a)` | `settings.webmcp.set` registry entry, the three ar+en catalog keys, the `GeneralSection` row and the five T10 cases |
| `09a6cb2` — `test(e2e): prove the four navigation tools behind the switch (R-EXT-5 X9a)` | `apps/desktop/e2e/v3/webmcp.spec.ts` (E1–E4) with the `page.addInitScript` shim |
| this commit — `docs: record the X9a boundary, the X9 split and the availability limit (R-EXT-5)` | `SECURITY.md` paragraph, `DECISIONS.md` D-EXT5, `PROGRESS.md` row, this report |

## What is there now

**`apps/desktop/src/v3/webmcp/modelContext.ts`.** `ModelContextTool` / `ModelContextLike` — a structural slice of the
registration API, no dependency, no `any`, `unknown` + guard at the boundary (the `soundCues.ts` shape).
`detectModelContext(doc?, nav?)` is `document.modelContext ?? navigator.modelContext` and returns null unless
`registerTool` is a function; the two scopes are parameters so a test can pass fakes and default to the real globals.
The module names no provider-side member.

**`apps/desktop/src/v3/webmcp/safeList.ts`.** `WEBMCP_SAFE_ACTION_IDS` is the four ids — `frame.inbox.open`,
`frame.settings.open`, `frame.project.new`, `home.projects.all` — and `buildToolSpecs(actions)` derives everything
else from the registry: the route comes from the entry (never a literal), the name is
`'warsha-' + id.replaceAll('.', '-')`, and the description is one fixed English sentence built from the route
("Show the Warsha page at /inbox in this window. Changes no data."). It throws on an unknown id, on any entry that
is not `effect: 'nav'`, on an entry carrying `rpc` or `capability`, on a route that is not an absolute parameterless
path (`#main`, `/p/:id`), and on a route whose `matchRoute` area is `onboarding`.

**`apps/desktop/src/v3/webmcp/setting.ts`.** `warsha.webmcp` in `localStorage`, `'on'` or absent, blocked storage
means off, in-tab `warsha:webmcp` event plus the cross-tab `storage` event — copied in shape from the sound-cue
switch (W11: a boolean does not belong in the decaying preferences store; no daemon flag, no preferences write, no
migration).

**`apps/desktop/src/v3/webmcp/WebMcpBridge.tsx`.** Renders nothing. One effect keyed on
`(enabled, inOnboarding, context)`: registers the four in order with **one** `AbortController`, cleanup aborts it,
a refusal aborts and stays silent (no toast, no `console.*`, no retry until the key changes), a route change that
stays off onboarding does not re-register. `execute` rejects when the signal is aborted or the switch is off, else
calls the router through a ref and returns `{ content: [{ type: 'text', text: 'Opened ' + route }] }` — no RPC, no
`invoke`, no client. `navigate` is the same function the Frame's own handlers call (`Frame.tsx:224-237`).

**Mount.** `<WebMcpBridge />` is the first child of `<RouterProvider>` in `V3App.tsx`; nothing else in that file
changed.

**Setting row.** `GeneralSection.tsx` renders one hand-rolled `role="switch"` row after the sound-cue row
(`data-action="settings.webmcp.set"`, `data-testid="general-webmcp"`), shown when `mode === 'advanced'` **or** the
switch is on, with the `settings.general.webmcp.unavailable` line only when it is on and `detectModelContext()` is
null. Logical CSS properties, tokens only. Three catalog keys in `packages/i18n/src/v3/{ar,en}/settings.ts`;
the Arabic label and description carry no Latin word (I4-safe).

## Step-1 re-verification (measured at `cd94f53`, before any change)

| Check | Packet expected | Measured at `cd94f53` |
|---|---|---|
| greenfield grep (`webmcp\|mcpb\|modelContext\|registerTool\|provideContext`) | only package names | only `@modelcontextprotocol/…` package names + the registry URL (18+12 matches, none of them a WebMCP surface) |
| `actions-gate` | 158 / 158 / 1 | **159 registered, 159 used, 0 violations** — the A1 residue is already fixed by `4a69888` |
| `i18n-gate` | 797 keys / 2 | **797 keys, 0 violations** — the two I4 keys are already reworded by `4a69888` |
| `check-ds-v3` | 0 | 0 violations |
| `check-wire-contract` | 11 / 0 | wire: 11 checks, 0 violations |
| `pnpm --filter warsha-desktop test` | 93 files / 823 tests | **93 files / 823 passed** |
| v3 non-visual Playwright (`--project=desktop apps/desktop/e2e/v3 --grep-invert "@visual"`) | not measured by the planner | **301 passed, 0 failed** (measured in a clean `cd94f53` worktree for this report) |
| WebMCP `README.md` re-read | `registerTool(tool, { signal })` | unchanged: `document.modelContext.registerTool(tool, { signal })`, unregistration by aborting the signal, `NotAllowedError` when the `tools` permission is off |

`4a69888` (registered `settings.connections.transport.pick`, reworded the two Arabic Connections keys) is the
difference; nothing in `ConnectionsSection*` or those keys was touched by this lane.

## Gates (final tree)

| Gate (exact command) | Exit | Result |
|---|---|---|
| `git diff --name-only cd94f53 \| grep -E '\.rs$\|Cargo\|package\.json\|pnpm-lock\|^apps/remote/\|^packages/client/\|harness\.ts'` | 1 | **printed nothing** (grep exits 1 when it matches nothing) |
| `pnpm lint` | 0 | 0 errors; 1 pre-existing `react-hooks/exhaustive-deps` warning (`pages/inbox/index.tsx:360`, untouched) |
| `pnpm typecheck` | 0 | 7 workspaces, incl. `apps/desktop` `tsconfig.e2e.json` |
| `pnpm --filter warsha-desktop test -- src/v3/webmcp` | 0 | 4 files, **26 passed** |
| `pnpm --filter warsha-desktop test -- GeneralSection` | 0 | **9 passed** (4 pre-existing + 5 T10) |
| `pnpm --filter warsha-desktop test` | 0 | **97 files, 854 passed, 0 failed** (base 93/823; +4 files / +31 tests) |
| `pnpm --filter @warsha/i18n test` | 0 | 2 files, **58 passed** |
| `node scripts/check-ds-v3.mjs apps/desktop/src/v3 packages/ui/src/v3 apps/remote/src` | 0 | `0 violations` |
| `node "$TOOLS/actions-gate.mjs" "$PWD"` | 0 | **160 registered, 160 used, 0 violations** (base 159/159/0 + the one `settings.webmcp.set`) |
| `node "$TOOLS/i18n-gate.mjs" "$PWD"` | 0 | **800 keys, 0 violations** (base 797/0 + the three keys) |
| `node "$TOOLS/contrast.mjs" --check-css packages/ui/src/v3/tokens/tokens.css` | 0 | `css checked … fails 0` |
| `node scripts/check-wire-contract.mjs` | 0 | `wire: 11 checks, 0 violations` |
| `node scripts/check-engineering-policy.mjs` | 0 | `policy: 8 checks, 0 failures` |
| `pnpm exec playwright test --project=desktop apps/desktop/e2e/v3/webmcp.spec.ts` | 0 | **4 passed** (E1–E4) |
| `pnpm exec playwright test --project=desktop apps/desktop/e2e/v3 --grep-invert "@visual"` | 0 | **305 passed, 0 failed** (step-1 301/0 + the four new cases) |
| `git grep -n -E "provideContext\|clearContext\|modelContextTesting\|exposedTo" -- apps packages` | 1 | **printed nothing** |
| `git status --short apps/desktop/e2e/v3/planner-simplicity.spec.ts` | 0 | **printed nothing** |
| `planner-simplicity` (copy from `$TOOLS`, run, delete) | 0 | copied with the recorded sha256 `061c6b34…`, **6 passed**, deleted; `git status --short` for the path prints nothing afterwards |

`TOOLS=/home/moe/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3/tools`; the four tool hashes still match the
packet (`actions-gate fe23098a…`, `i18n-gate 987337f3…`, `contrast c3366d33…`, `planner-simplicity 061c6b34…`).

## Tests

| Case | What it proves | Result |
|---|---|---|
| T1 | `document.modelContext` wins, falls back to `navigator.modelContext`, neither → null, an object without a function `registerTool` → null | pass (4) |
| T2 | `buildToolSpecs(ALL_ACTIONS)` returns exactly the four names and routes, each id registered, `effect: 'nav'`, no `rpc`, no `capability`; the description is the route sentence | pass (3) |
| T3 | throws for an `rpc` action, a `state` action, an rpc/capability on a nav entry, `/p/:id`, `#main`, `/onboarding`, an unknown id; no safe id matches the deny regex | pass (6) |
| T4 | fresh storage → `readWebMcpEnabled()` false and **0** `registerTool` calls with a context present | pass |
| T5 | on → exactly the four live tools, each with an `AbortSignal`, `readOnlyHint: true`, `{type:'object', properties:{}}` | pass |
| T6 | off → 0 live tools; on again → 4, and the first round's signals are aborted | pass |
| T7 | `/inbox` → `/projects` keeps the same four with **no second registration round**; `/onboarding` → 0; back to `/` → 4; unmount → 0 | pass (2) |
| T8 | `warsha-frame-inbox-open` → pathname `/inbox`, hash `#/inbox`, text `Opened /inbox`, a recording client saw **no** method called; a held tool rejects after switch-off and does not navigate | pass (2) |
| T9 | the third `registerTool` rejects with `NotAllowedError` → 0 live tools, nothing thrown, no toast, the first two aborted | pass |
| T10 | absent in simple mode while off; present in advanced, `aria-checked="false"`, click writes `'on'` with no RPC; present in simple once on; the unavailable line only when on and no context; ar + en names | pass (5) |
| E1 | `/` with the shim and the setting untouched → **no** `registerTool` call at all | pass |
| E2 | switch on → the four names; `warsha-frame-inbox-open` → `#/inbox`; no decision, run control or removal method (see the note below) | pass |
| E3 | switch off → 0 tools | pass |
| E4 | Arabic (`dir="rtl"`) renders the switch by its Arabic name, `aria-checked="false"` | pass |

## Discrimination artifacts (`target/discrimination/R-EXT-5/`, git-ignored; reverse-patch, run, restore, `git diff` empty)

| Artifact | Patch | Measured | Restored |
|---|---|---|---|
| `a-default-on.tests.log` | `readWebMcpEnabled` returns `!== 'off'` | **6 failed / 20 passed**: T4 (the off-by-default case), T6, T8's second half, the storage-key case and two `setting.ts` cases | `git diff --stat` empty |
| `a-default-on.e1.log` | same | **E1 fails**: the shim recorded all four names on a fresh load | `git diff --stat` empty |
| `b-no-signal.tests.log` | `registerTool(tool, { signal: new AbortController().signal })` — the cleanup signal no longer reaches the browser | **4 failed / 22 passed**: T6, T7 (both), T9 — nothing is removed when the switch goes off or on unmount | `git diff --stat` empty |
| `c-home-start.tests.log` | `'home.start'` appended to `WEBMCP_SAFE_ACTION_IDS` | **3 failed / 14 passed**: all three T2 cases (the fourth tool is an `rpc` action, so `buildToolSpecs` refuses and the names/test list differ) | `git diff --stat` empty |
| `availability-chromium131.txt` | none — measurement | Playwright Chromium **131.0.6778.33**, `http://localhost:5173` (secure context): `'modelContext' in document: false`, `'modelContext' in navigator: false`; with the switch on the row renders "No browser assistant is available in this window." | n/a |

**Deviation recorded on (c):** the packet predicted "T2/**T3** fail". Measured: T2 fails (3 cases) and T3 stays green,
because T3's deny regex (`/gate|approve|reject|delete|remove|revoke|cancel|secret|provider|device|budget|run\.|…/`)
has no `start` term, so `home.start` passes the word test — the failure lands where the list is compared to the
registry instead, which is the stronger check.

## Deviation and finding: E2's "no `gates.*`" line

E2 as frozen says `rpcCalls` contains no `gates.*`. Measured on the first run: landing on `/inbox` makes the Inbox
page's own reads — **10 × `gates.list`** and nothing else — exactly what a human click on Inbox makes
(`apps/desktop/src/v3/pages/inbox/index.tsx` loads gates per run). A navigation tool cannot land on the gates inbox
without that page reading its gates, so the literal assertion can only be satisfied by not using the Inbox.

The case keeps the security property and adds a stronger one: `forbiddenMethod` allows only `gates.list` and refuses
every other `gates.*` (approve/reject/changes/evidence), `runs.start`/`followup`/`cancel`, and any `.remove`/
`.delete`; then the tool is run a **second** time from the settled Inbox and `rpcCalls` is asserted to be unchanged
(`expect((await rpcCalls(page)).length).toBe(settledCalls)`) — proving the tool itself adds no RPC at all, which is
what the packet's acceptance line ("a tool call … causes no RPC call") asks for. The unit-level half is T8: the
bridge is mounted under a recording client and no method is called.

## Availability statement — where WebMCP was and was not observed

- **Observed absent (measured):** Playwright Chromium **131.0.6778.33**, headless shell, on
  `http://localhost:5173` (a secure context): `document` has no `modelContext`, `navigator` has none. The switch
  renders in advanced mode, and with it on the Settings row says "No browser assistant is available in this
  window." (`target/discrimination/R-EXT-5/availability-chromium131.txt`). That browser predates the shipped
  origin trial, so this is not evidence about a current Chrome.
- **Not observed at all:** any **Tauri webview** — WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux —
  and any current Chrome/Edge with the origin trial or a built-in agent (ChatGPT Desktop, Brave Leo). No Tauri build
  was run in this lane and no agent shell is installed here, so *whether those expose `modelContext` is unverified*.
  The packet's expectation stands unrefuted: in the installed app today the switch is on and the UI says "not
  available in this window"; the feature is reachable when the same UI runs in a supporting browser
  (`pnpm --filter warsha-desktop dev`, `http://localhost:5173`).
- **Tested against:** a fake `modelContext` in vitest (T1–T9) and a `page.addInitScript` shim in Playwright (E1–E4),
  both recording `registerTool`, honouring the signal and able to refuse — no real browser agent was involved in any
  green result. The shim lives in the spec; `harness.ts` and `e2e/v3/support/**` are untouched.

## X9b — folded, not built

The whole of the plan's X9 row beyond X9a: tools for `rpc` or `state` actions (start a run with confirm, send a
follow-up), read-status tools or **any** tool whose result carries project/run/gate/file/settings data, an action
dispatcher (one place that can run a registered action outside its page), the remote PWA
(`apps/remote/src/webmcp/*`), parameterised routes, the declarative `<form>` API, `exposedTo`/iframes, origin-trial
tokens and `Permissions-Policy` headers. X9b is unscheduled and needs, first, a dispatcher design and an owner
decision on what an agent may read or start (`DECISIONS.md` D-EXT5, packet OD-EXT5-a).

## Gates not run, and why

- **Rust** — `cargo fmt`, `cargo clippy -D warnings`, `cargo test`: not run. No `.rs`, `Cargo.toml` or `Cargo.lock`
  file is in the diff, which the first gate line proves (`grep` printed nothing).
- **`pnpm build`** — not run (no build-shape change; `tsc --noEmit` is part of `pnpm typecheck` and passed).
- **`playwright --project=remote`** and the remote suite: not run, nothing under `apps/remote/` changed.
- **`@visual` cases / baselines** — excluded by the gate's own `--grep-invert "@visual"`; v3 has no tracked
  snapshots and no capture was attempted on this host.
- **`cargo deny`, `check-arch`, `check-versions`** — not run (Rust/dependency/version surfaces untouched).
- **Android / emulator (Athar_GPlay, Pixel)** — not applicable: no `apps/mobile` change in this packet, and the
  `R-UI-6c` lane owns that file.
- **Real browser-agent invocation** — see the availability statement: unverified, and not claimed.

## Notes for the reviewer

- The four commits follow the packet's split. Commit 1 (module + mount) and commit 2 (registry entry + row) are not
  each independently `actions-gate` green in the A6 sense — the new `settings.webmcp.set` id has no e2e reference
  until commit 3. The **final tree** is 160/160/0 and that is what the gate ran on; the packet's own step order
  (module+tests / setting row+i18n+registry / e2e / docs) has the same property.
- `safeList.ts` imports `matchRoute` from `../router/Router` (that is where it lives; `router/routes.ts` exports the
  route table only). No router file was edited.
- Formatting: the four new `webmcp/*` files are Prettier-clean. `actions/registry/settings.ts`,
  `GeneralSection.tsx`, both `settings.ts` catalogs and `SECURITY.md` were **already** Prettier-dirty at `cd94f53`
  and were not reformatted (added lines only), which is the recorded base drift, not this packet's.
