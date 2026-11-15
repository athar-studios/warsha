# R-EXT-5 — WebMCP (X9a): four navigation tools behind an off-by-default device switch · after R-EXT-4

Status: spec frozen. Base: `68a8d5d` (repair/dev-csp-f474776, R-EXT-4 merged). Planner lane. Pattern: R-BRIDGE-B5 /
R-EXT-1 / R-EXT-4. Licence wording: "free and source-available".
**Rust: no. New RPC method: no. New wire field: no. New dependency: no. Desktop v3 only. Registers tools with a
browser agent: yes — four read-only navigation tools, only while the owner's switch is on.**

## Scope verdict (read first)

**BUILD, narrowed to X9a. The rest of the plan's X9 row is FOLDED into a later, design-first X9b.** X9 is greenfield:
there is no WebMCP code, manifest, extension, or page-facing tool surface anywhere in the tree. The plan's X9 row
(PROGRAM_PLAN §4: desktop + remote PWA, "read status, navigate, start run with confirm, send follow-up", execute
through `useAction`, unregister on route change/sign-out) is size M and rests on four things this tree does not have.
Each is measured in *Why*; the consequence is:

| Part of the plan's X9 row | Verdict | Reason (measured at `68a8d5d`) |
|---|---|---|
| Feature-detect, off-by-default setting, safe list derived from the actions registry, AbortSignal unregister, fake-`modelContext` tests, Playwright shim | **build (X9a)** | all footholds exist: registry with static routes, router, the sound-cue device-switch pattern |
| Navigate tools | **build (X9a)** — four tools | registry entries with `effect: 'nav'` and a parameterless `route` |
| "start run with confirm", "send follow-up" | **fold → X9b** | the registry is metadata only; the handlers are closures inside page components, so there is nothing a tool can call. `home.start` has no confirm step to reuse. Both spend the owner's budget |
| "read status" | **fold → X9b** | needs a decision on what project/run data may be handed to a browser agent; no registry entry describes a read |
| Remote PWA (`apps/remote/src/webmcp/*`) | **fold → X9b** | the remote app has no actions registry, and it is normally served over plain http on the LAN, where `modelContext` (`[SecureContext]`) does not exist |
| "unregister on sign-out" | **not applicable on desktop** | desktop v3 has no sign-out; X9a unregisters on switch-off, on entering onboarding, and on unmount |
| "actions-gate extended" | **replaced** | the gate tool is planner-owned and git-ignored; the same rule ships as an in-tree vitest test |

X9b is not scheduled by this packet. It needs, first, a design pass for an action dispatcher (one place that can run a
registered action outside its page) and an owner decision on what an outside agent may read or start.

## Why (measured at 68a8d5d)

- **Greenfield.** `git grep -n -i -E 'webmcp|mcpb|modelContext|registerTool|provideContext' 68a8d5d -- apps packages
  crates` matches only `@modelcontextprotocol/…` package names and the registry URL. The word WebMCP appears in
  `PLAN.md:13,31`, `COMPLETION_CHECKLIST.md:18`, `DECISIONS.md:1613` (OD-P3 "build WebMCP off by default"),
  `PROGRESS.md:260` and `R-UI-RUN-PLAN.md` only. No browser extension, no manifest entry, no `Permissions-Policy`
  header anywhere (`git grep -n -i "permissions-policy" -- crates apps packages` empty).
- **The registry is the foothold, and it is metadata only.** `apps/desktop/src/v3/actions/types.ts`: `ActionDef { id,
  labelKey, effect: 'rpc'|'nav'|'state', rpc?, route?, capability? }`. 158 ids across 8 files
  (`actions/registry/*.ts`). `getAction` and `ALL_ACTIONS` have **zero** consumers outside `actions/index.ts`.
  `useAction(id, fn)` (`actions/index.ts:53`) wraps a function the *caller* passes: 91 call sites, each a closure
  inside a page (e.g. `pages/bench/index.tsx:161` `bench.run.start`). So "generate a tool from the registry and execute
  it through `useAction`" has no handler to call for any `rpc` action.
- **Navigation is the one effect the registry fully describes.** Entries with `effect: 'nav'` and a static `route`:
  `frame.inbox.open` `/inbox`, `frame.settings.open` `/settings/general`, `frame.project.new` `/`,
  `home.projects.all` `/projects`, `home.defaults.models.open` `/settings/models`, plus duplicates of the same routes
  (`home.inbox.review`, `bench.project.new`, `projects.new`, `onboarding.later`), one onboarding entry
  (`home.provider.add` `/onboarding`), one fragment (`frame.skip-to-main` `#main`) and parameterised ones (`/p/:id`).
  The router is local: `useNavigate()` (`router/Router.tsx:130`) sets `window.location.hash`; `ROUTES`
  (`router/routes.ts:46`) lists 7 paths. The Frame's own handlers call `navigate('/inbox')` directly
  (`pages/frame/Frame.tsx:224-237`), not through `useAction`.
- **No confirm to reuse, no sign-out on desktop.** `grep -n -i confirm apps/desktop/src/v3/pages/home/index.tsx` is
  empty (`home.start` is registered with `projects.create`, `budget.set`, `runs.start` and runs them at once). `grep -rn -i -E "sign.?out|logout|unpair|forget"
  apps/desktop/src/v3` (non-test) is empty; the only session teardown is `apps/remote/src/session.ts:405`
  `clearStoredSession`.
- **Remote has nothing to derive from and usually no API.** `grep -rn -E "useAction|actions/registry|data-action"
  apps/remote/src` → 1 line. `SECURITY.md:124` "There is no TLS in the daemon"; the remote PWA reaches the daemon over
  http on a private address (`apps/remote/src/session.ts:178` `isPrivateCleartextHost`). The draft's IDL is
  `[SecureContext, SameObject] readonly attribute ModelContext modelContext`.
- **The device-switch pattern exists (R-UI-3 D2).** `apps/desktop/src/v3/app/soundCues.ts`: `SOUND_CUES_STORAGE_KEY =
  'warsha.sound_cues'`, `'on'` or absent, `read…/write…/subscribe…Enabled`, an in-tab event because `storage` fires
  only in other tabs. `useSoundCues` is mounted at `Frame.tsx:172`; the switch is in `GeneralSection.tsx:325-380`
  (`role="switch"`, `data-action="settings.sound-cues.set"`), registered `effect: 'state'`
  (`actions/registry/settings.ts:13`). `GeneralSection` already reads `mode` from `useDensity()` (l.42).
- **Where a router-aware observer can mount.** `app/V3App.tsx:57-66`: `<RouterProvider>` → `<Frame>` → `<RouteOutlet/>`.
  `V3AppInner` itself is outside the router, so the mount is a child of `RouterProvider`.
- **Runtime reach is narrow — say so, do not hide it.** The desktop app is a Tauri webview (`src-tauri/tauri.conf.json`;
  Linux `libwebkit2gtk-4.1-0`). External facts re-read for this packet (`webmachinelearning/webmcp` `README.md` and
  `implementation-status.md`): entry point `document.modelContext`; `registerTool(tool, { signal })`, unregistration
  only by aborting the signal; rejects with `NotAllowedError` when the `tools` permission is off; origin trial in
  Chrome 149 and Edge 150, ChatGPT Desktop, Brave Leo from 1.102.2; Firefox and Safari have standards-position issues
  only. **Unverified:** whether any Tauri webview (WebView2, WKWebView, WebKitGTK) exposes `modelContext`. Expected
  result in the installed app today: the switch is on and the UI says "not available in this window". The feature is
  reachable when the same UI runs in a supporting browser (`pnpm --filter warsha-desktop dev`, `http://localhost:5173`).
- **Gate tools are not in git (F3).** `bridge-io/` is ignored (`.gitignore:74`); the frozen tools exist only at
  `/home/moe/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3/tools/`. sha256: `actions-gate.mjs fe23098a…`,
  `i18n-gate.mjs 987337f3…`, `contrast.mjs c3366d33…`, `planner-simplicity.spec.ts 061c6b34…` (unchanged since the
  run plan).
- **The base is not at zero on two gates — pre-existing, from R-EXT-4 `8fb7a07`, not this packet's to fix:**
  `actions-gate` → `actions: 158 registered, 158 used, 1 violations` (`A1 …/ConnectionsSection.tsx:542 <button> has
  no literal data-action`); `i18n-gate` → `i18n-v3: 797 keys, 2 violations` (I4 Latin text in
  `settings.connections.add.stdio_only` and `settings.connections.add.url`). Other base numbers: `check-ds-v3` 0;
  `check-wire-contract` `wire: 11 checks, 0 violations`; `pnpm --filter warsha-desktop test` 93 files / 823 tests
  pass. Tracked v3 desktop snapshots: 0 (the 84 tracked files are `apps/remote/e2e/bench.visual.spec.ts-snapshots`).
  **Not measured by this lane:** the v3 Playwright suite, `pnpm lint`, `pnpm typecheck`, any Rust gate.
- **`i18n-gate` I4 constrains the copy.** Arabic values may contain no Latin word outside `MCP API GitHub URL JSON QR
  PWA Git Ollama`. "WebMCP" is not on the list, so the Arabic label must be plain Arabic.

## Goal

1. A device switch, **off by default**. With it off Warsha never calls `registerTool`.
2. With it on, and a `modelContext` present, Warsha registers **exactly four** read-only navigation tools derived
   from the actions registry, and removes them when the switch goes off, when the app enters onboarding, and on unmount.
3. A tool call moves the window to its route through the same router function the UI uses, and makes no RPC call of
   its own.
4. No gate, delete, secret, spend, or `rpc`-effect action can be registered: the safe list is checked against the
   registry by a test.
5. When no `modelContext` exists, or registration is refused, nothing throws and the switch row says so.

## Frozen design

### Module `apps/desktop/src/v3/webmcp/` (new, four files + tests)

`modelContext.ts` — the platform edge. A structural slice of the API, no dependency, no `any` (`unknown` + guards, as
`soundCues.ts` does for Web Audio):

```ts
export interface ModelContextTool {
  name: string; description: string;
  inputSchema: { type: 'object'; properties: Record<string, never> };
  annotations: { readOnlyHint: true };
  execute: () => Promise<{ content: { type: 'text'; text: string }[] }>;
}
export interface ModelContextLike {
  registerTool(tool: ModelContextTool, options: { signal: AbortSignal }): Promise<void>;
}
/** `document.modelContext ?? navigator.modelContext`; null unless `registerTool` is a function. */
export function detectModelContext(doc?: unknown, nav?: unknown): ModelContextLike | null;
```

Never reference `provideContext`, `clearContext`, `modelContextTesting`, `getTools`, `executeTool`, or `exposedTo`.

`safeList.ts` — the only list, and the derivation:

```ts
export const WEBMCP_SAFE_ACTION_IDS = [
  'frame.inbox.open', 'frame.settings.open', 'frame.project.new', 'home.projects.all',
] as const;
export interface WebMcpToolSpec { name: string; actionId: string; route: string; description: string }
/** Throws if an id is unknown, not `effect: 'nav'`, has `rpc` or `capability`, or its route is not a
 *  parameterless path matched by `matchRoute` to an area other than `onboarding`. */
export function buildToolSpecs(actions: readonly ActionDef[]): WebMcpToolSpec[];
```

- `name` = `'warsha-' + id.replaceAll('.', '-')` → `warsha-frame-inbox-open`, `warsha-frame-settings-open`,
  `warsha-frame-project-new`, `warsha-home-projects-all`.
- `route` comes from the registry entry, never from a literal in this module.
- `description` is agent-facing protocol text, not UI copy: a fixed English sentence built from the route, e.g.
  `Show the Warsha page at /inbox in this window. Changes no data.` No project names, counts, or any page data.
- The list stays four entries. Adding an id is a packet change, not an implementation choice.

`setting.ts` — `WEBMCP_STORAGE_KEY = 'warsha.webmcp'`; `readWebMcpEnabled`, `writeWebMcpEnabled`,
`subscribeWebMcpEnabled`, copied in shape from `soundCues.ts` l.60-105 (`'on'` or absent; storage blocked → off;
in-tab event `warsha:webmcp` plus the `storage` event). Device-scoped: no RPC, no preferences write.

`WebMcpBridge.tsx` — `export function WebMcpBridge(props: { modelContext?: ModelContextLike | null }): null`. The
prop is the test seam; default is `detectModelContext(document, navigator)`. One effect, keyed on
`(enabled, inOnboarding, modelContext)` where `inOnboarding = area === 'onboarding' || area === null`:

- `!enabled`, `inOnboarding`, or no `modelContext` → register nothing.
- otherwise create **one** `AbortController`, `await registerTool(tool, { signal })` for each spec in order; the effect
  cleanup calls `controller.abort()`. A change between two non-onboarding routes does **not** re-register (the key is
  unchanged), so no duplicate-name rejection and no tool churn.
- any rejection (`NotAllowedError`, duplicate name, anything) → `controller.abort()` (removes those already
  registered), no toast, no `console.*`, no retry until the key changes.
- `execute`: if the signal is aborted or `readWebMcpEnabled()` is false → reject with an `Error`; else
  `navigate(spec.route)` (from `useNavigate()`, read through a ref so the tool object stays stable) and resolve
  `{ content: [{ type: 'text', text: 'Opened ' + spec.route }] }`. No RPC, no `invoke`, no `client` use.

Deviation from PROGRAM_PLAN §2.7 ("execute through `useAction`"), recorded in DECISIONS: navigation has no `useAction`
handler in the UI either (`Frame.tsx:224-237`); the tool calls the router function those handlers call.

### Mount — `apps/desktop/src/v3/app/V3App.tsx` (import + one element)

`<WebMcpBridge />` as the first child of `<RouterProvider>`, before `<Frame>`. Nothing else in the file changes.

### Setting row — `GeneralSection.tsx`, registry, catalogs

- Registry: `{ id: 'settings.webmcp.set', labelKey: 'settings.general.webmcp', effect: 'state' }` after
  `settings.sound-cues.set`.
- `GeneralSection.tsx`: one `role="switch"` row after the sound-cue row, same markup pattern,
  `data-action="settings.webmcp.set"`, `data-testid="general-webmcp"`. Rendered when `mode === 'advanced'` **or** the
  setting is on (a live switch is never hidden). Below the description, when the setting is on and
  `detectModelContext()` is null, one status line (`settings.general.webmcp.unavailable`). Logical CSS properties,
  tokens only.
- Catalogs `packages/i18n/src/v3/{ar,en}/settings.ts`, exactly three keys in both: `settings.general.webmcp`,
  `settings.general.webmcp.desc`, `settings.general.webmcp.unavailable`. English may name WebMCP; Arabic is real,
  plain Arabic with no Latin word (I4). The description must say: off by default, lets an assistant built into the
  browser open Warsha's pages, cannot approve, start, change or delete anything.

### Truth in docs

`SECURITY.md`, under "Trust boundaries": one short paragraph — what is exposed (four navigation tools), to whom (a
browser-integrated agent in the same window), only while the device switch is on, that tool results carry no project
data, and that gate decisions are never exposed. `DECISIONS.md`: the X9a/X9b split and the `useAction` deviation.

### Wire and arch impact: none (prove it)

No `.rs`, no `packages/client` change, no harness `RPC_METHODS` change, no `package.json` / `pnpm-lock.yaml` change.
`node scripts/check-wire-contract.mjs` stays `wire: 11 checks, 0 violations`.

## Tests (each must fail on 68a8d5d and pass after; ≥ 2 discrimination artifacts under `target/discrimination/R-EXT-5/`)

Vitest, `apps/desktop/src/v3/webmcp/*.test.ts(x)`, with a fake `modelContext` (records `registerTool` calls, drops a
tool when its signal aborts, can be told to reject):

- T1 detection: `document.modelContext` wins; falls back to `navigator.modelContext`; neither → null; an object
  without a function `registerTool` → null.
- T2 safe list: `buildToolSpecs(ALL_ACTIONS)` returns exactly the four names and routes above; every id is in
  `ALL_ACTIONS`, `effect === 'nav'`, no `rpc`, no `capability`.
- T3 deny: `buildToolSpecs` throws for an `rpc` action, a `state` action, `/p/:id`, `#main`, `/onboarding`, and an
  unknown id; and no id in the safe list matches `/gate|approve|reject|delete|remove|revoke|cancel|secret|provider|
  device|budget|run\.|followup|mcp|plugin|skill/`.
- T4 off by default: fresh storage → `readWebMcpEnabled()` false; `<WebMcpBridge>` mounted with a fake context →
  **0** `registerTool` calls.
- T5 on: setting on → exactly four live tools, each registered with an `AbortSignal`, `annotations.readOnlyHint ===
  true`, empty-object input schema.
- T6 off again: `writeWebMcpEnabled(false)` → 0 live tools; on → four again, no rejection.
- T7 route scope: `/inbox` → `/projects` leaves the same four (no second `registerTool` round); → `/onboarding` → 0
  live; back to `/` → four. Unmount → 0.
- T8 execute: calling `warsha-frame-inbox-open` → router pathname `/inbox`, result text `Opened /inbox`; the client
  spy saw no call caused by the tool; calling a tool object after switch-off rejects and does not navigate.
- T9 refusal: fake rejects the third `registerTool` with `NotAllowedError` → 0 live tools, nothing thrown, no toast.
- T10 `GeneralSection`: row absent in simple mode with the setting off; present in advanced mode, `aria-checked=
  "false"`; click writes `'on'`; present in simple mode once on; unavailable line shown only when on and no context;
  ar and en labels render; no RPC call.

Playwright, new `apps/desktop/e2e/v3/webmcp.spec.ts` (non-visual, no snapshots). The shim is installed by
`page.addInitScript` **inside the spec** (defines `document.modelContext` with a recording `registerTool` that honours
the signal); `harness.ts` is not edited:

- E1 load `/` with the shim, setting untouched → shim holds 0 tools.
- E2 `/settings/general` in advanced mode → click `[data-action="settings.webmcp.set"]` → shim holds exactly the four
  names; run `warsha-frame-inbox-open` from `page.evaluate` → URL hash `#/inbox`; `rpcCalls` contains no
  `gates.*`, `runs.start`, `runs.followup`, `runs.cancel`, or `*.remove`/`*.delete` method.
- E3 switch off → 0 tools. E4 Arabic (`dir="rtl"`) renders the switch by its Arabic name.

Discrimination (reverse-patch, record failing output, restore, `git diff` empty): (a) default the setting to on → T4
and E1 fail; (b) drop `{ signal }` from `registerTool` → T6/T7 fail; (c) add `home.start` to the safe list → T2/T3 fail.

## Allowed files

- `apps/desktop/src/v3/webmcp/{modelContext,safeList,setting}.ts`, `WebMcpBridge.tsx`, and their `*.test.ts(x)` (new)
- `apps/desktop/src/v3/app/V3App.tsx` (import + the one element)
- `apps/desktop/src/v3/pages/settings/sections/GeneralSection.tsx`, `GeneralSection.test.tsx`
- `apps/desktop/src/v3/actions/registry/settings.ts` (the one entry)
- `packages/i18n/src/v3/{ar,en}/settings.ts` (the three keys)
- `apps/desktop/e2e/v3/webmcp.spec.ts` (new)
- `SECURITY.md` (the one paragraph), `DECISIONS.md`, `PROGRESS.md`, `docs/zadloop/packets/R-EXT-5-report.md` (new)

**Not allowed** — needing one is a stop-and-report: any `.rs` or `Cargo.*`; `packages/client/**`; `apps/remote/**`;
`apps/desktop/e2e/harness.ts` and `e2e/v3/support/**`; `apps/desktop/src/v3/actions/{index,types,capabilities}.ts`
and every other registry file; `router/**`; `pages/frame/**`; `ConnectionsSection*`; `src-tauri/**` (CSP included);
`index.html`; any `package.json` or `pnpm-lock.yaml`; `scripts/check-*`; anything under `bridge-io/`; any snapshot
directory.

## Out of scope

X9b in full: tools for `rpc` or `state` actions (start run, follow-up, anything that spends or writes), read-status
tools or any tool whose result carries project, run, gate, file, or settings data, an action dispatcher, the remote
PWA, parameterised routes. Also: `webmcp-types` or any new dependency; the declarative (`<form>`) API; `exposedTo`,
iframes, `getTools`/`executeTool` (Warsha is a provider, not an in-page agent); origin-trial tokens, `Permissions-
Policy` headers, CSP edits; making a Tauri webview expose `modelContext`; X10 (template for generated apps); X8
changes; fixing the two base gate residues (`ConnectionsSection.tsx:542` A1, the two I4 keys) — report them, another
packet owns them; baselines.

## Constraints

- Off by default, on every device, after every upgrade: absent storage key = off. No migration, no daemon flag.
- With the setting off there are zero `registerTool` calls — proven by T4 and E1, not assumed.
- Tool text and results never contain user data, tokens, paths, or daemon addresses. Nothing is logged.
- TS strict, no `any`, no `console.*`; UI strings only through the ar+en catalogs; logical CSS properties; tokens only.
- Never weaken or delete an existing test. Do not edit gate tools; `planner-simplicity.spec.ts` is copied in for its
  run and deleted before commit.
- Small Conventional Commits on a branch from `68a8d5d` (module+tests / setting row+i18n+registry / e2e / docs);
  self-review each diff; other lanes' changes are left alone; update PROGRESS.md. No push, tag, or publish.

## Steps

1. Re-verify at the worktree base and record the output: the greenfield grep from *Why*; `actions-gate` and
   `i18n-gate` base lines (expect 158/158/1 and 797/2); `pnpm --filter warsha-desktop test` count; the v3 non-visual
   Playwright pass/fail count (this lane did not measure it). Re-read the WebMCP `README.md`; if `registerTool` or the
   signal option changed shape, stop and report.
2. Write T1–T9 red, then `modelContext.ts`, `safeList.ts`, `setting.ts`, `WebMcpBridge.tsx`.
3. Mount in `V3App.tsx`; registry entry; catalogs; `GeneralSection` row; T10.
4. `webmcp.spec.ts` (E1–E4).
5. Discrimination artifacts; `SECURITY.md` paragraph; DECISIONS/PROGRESS; report with: gate results against the
   step-1 numbers, the availability statement (which runtimes were actually tried, which are unverified), the X9b
   fold list, and every gate not run.

## Gates (exact commands; repo root; `TOOLS=/home/moe/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3/tools`)

```
git diff --name-only 68a8d5d | grep -E '\.rs$|Cargo|package\.json|pnpm-lock|^apps/remote/|^packages/client/|harness\.ts'   # must print nothing
pnpm lint
pnpm typecheck
pnpm --filter warsha-desktop test -- src/v3/webmcp
pnpm --filter warsha-desktop test -- GeneralSection
pnpm --filter warsha-desktop test                       # ≥ 823 passed, 0 failed
pnpm --filter @warsha/i18n test
node scripts/check-ds-v3.mjs apps/desktop/src/v3 packages/ui/src/v3 apps/remote/src        # 0 violations
node "$TOOLS/actions-gate.mjs" "$PWD"     # 159 registered, 159 used; violations = the step-1 list, nothing new
node "$TOOLS/i18n-gate.mjs" "$PWD"        # 800 keys; violations = the step-1 list, nothing new
node "$TOOLS/contrast.mjs" --check-css packages/ui/src/v3/tokens/tokens.css                # 0
node scripts/check-wire-contract.mjs                    # wire: 11 checks, 0 violations
node scripts/check-engineering-policy.mjs
pnpm exec playwright test --project=desktop apps/desktop/e2e/v3/webmcp.spec.ts
pnpm exec playwright test --project=desktop apps/desktop/e2e/v3 --grep-invert "@visual"    # failed ≤ step-1 count, passed ≥ step-1 + new
git grep -n -E "provideContext|clearContext|modelContextTesting|exposedTo" -- apps packages   # must print nothing
git status --short apps/desktop/e2e/v3/planner-simplicity.spec.ts                          # must print nothing
```

`planner-simplicity`: copy from `$TOOLS` into `apps/desktop/e2e/v3/`, run it with the desktop project, delete it.
Rust gates are not run (no Rust touched; the first gate line proves it). Any gate not run is named in the report, not
called passed.

## Acceptance

- With a fake `modelContext`: setting off → 0 tools; on → exactly the four safe-list tools; off → 0; onboarding → 0.
- A tool call changes the route through the router and causes no RPC call.
- The safe-list test fails if any non-navigation, gated, spending, or parameterised action is added.
- `actions-gate` and `i18n-gate` report no violation that is not already on the step-1 list.
- The report states where WebMCP was and was not observed to be available, and lists X9b as unbuilt.

## Open points (defaults applied; owner/PM may strike)

- **OD-EXT5-a** — X9 split. Default: ship X9a, leave X9b unscheduled until a dispatcher design and an owner decision
  on agent-readable data exist. Alternative rejected: build the full row now (needs a refactor of 91 call sites or a
  second, parallel implementation of run start — the kind of duplicate path K-series removed).
- **OD-EXT5-b** — where the switch lives. Default: Settings › General, shown in advanced mode or when on. Alternative:
  the Connections section (rejected: that section is daemon-scoped; this switch is per device).
- **OD-EXT5-c** — fifth tool `home.defaults.models.open` (`/settings/models`). Default: not included; four distinct
  top-level destinations are enough to prove the mechanism.
