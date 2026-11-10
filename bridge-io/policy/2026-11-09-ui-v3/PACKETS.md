# Worker briefs — run `2026-11-09-ui-v3`

The orchestrator hands each implementer **COMMON + its own section + `packets/<P>/gates.md`**, verbatim.
`EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3`. Contract documents:
`docs/designs/DESIGN_SYSTEM_V3.md` (the system), `docs/designs/UI_V3_PLAN.md` (every page and action id),
`docs/designs/v3-preview.html` (look and feel reference — match its spirit, its tokens exactly).

---

## COMMON (every packet)

You are the IMPLEMENTER of one packet of run `2026-11-09-ui-v3` in the Warsha repo
(`C:/Users/Dragonfly/Downloads/Warsha`). A separate reviewer and verifier judge your work against the frozen gates in
`packets/<P>/gates.md`; you must not edit, weaken, skip or reinterpret them. Never ask questions: decide, record the
decision in your report, continue.

**Read first:** `AGENTS.md`; `ENGINEERING_POLICY.md` §1 (Phase 3), §5, §6; `docs/designs/DESIGN_SYSTEM_V3.md`;
`docs/designs/UI_V3_PLAN.md`; your section; your `gates.md`.

**Worktree (Git Bash)** — the orchestrator gives you `<branch>`, `<base>`, `<wt>` from `state.json`:
```bash
cd C:/Users/Dragonfly/Downloads/Warsha
git worktree add <wt> -b <branch> <base>
cd <wt> && BASE=$(git rev-parse HEAD) && echo "BASE=$BASE"   # must equal <base>
pnpm install --frozen-lockfile                                # TS packets
# Rust packets: export CARGO_TARGET_DIR=<wt>/target
```

**Always:** stay inside your allowed files; read a file before editing it; TS strict, no `any`, no `@ts-ignore`; Rust:
no `unwrap()`/`expect()` outside tests, `thiserror`/`anyhow`, `cargo fmt`, `clippy -D warnings`; every user-visible
string through the catalogs (ar + en, same keys; v3 strings in `packages/i18n/src/v3/{ar,en}/<area>.ts`, one
`'key': 'value',` per line); logical CSS only; v3 code uses tokens only (no hex, no px/rem literal, no physical
direction); tests with every change; small Conventional Commits.

**The v3 rules that reviewers reject on sight:** a clickable element without a literal `data-action="area.verb"`; an
action id missing from `actions/registry/<area>.ts`; a handler that only sets state nobody reads, logs, or waits on a
timer to fake a result; a hard-coded model, workflow, role roster or reply; English words in an Arabic string; more than
one `primary` button in a view; a page without loading/empty/error states; a control for a feature the daemon does not
serve (UI_V3_PLAN §6) — leave it out instead.

**Never:** touch `*-snapshots/**` or run `--update-snapshots`; edit `PLAN.md`/`PROGRESS.md`/`DECISIONS.md`; add or bump a
dependency (sole exception: U0 with OD-U2 = A); change v2 code before U7; push, merge, tag or publish; call a real model
API; write a secret anywhere; add `skip`/`#[ignore]`/`todo!()` or weaken an assertion.

**Out-of-scope blocker:** a needed file outside your list, a credential, or a product decision → stop, write
`BLOCKER (out-of-scope): <reason> — needs <what>` in your report, end. Never widen scope.

**Report:** `$EV/packets/<P>/report.md`: base/head commits, what changed per step, every decision (one line +
alternative rejected), measured unit counts, anything seen but left alone.

---

## U0 — design-system foundation (`packages/ui/src/v3/`) — Wave A
1. **Tokens** `v3/tokens/{color,type,space,radius,elevation,motion,layout}.ts` and `v3/tokens/tokens.css`: every value of
   DS v3 §2.1–2.4 under the `--w-*` names, light in `:root`, dark in `:root[data-theme="dark"]` and in
   `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }`; `[data-density="compact"]` switches
   control height 44 → 32 and table text md → sm. A parity test proves TS = CSS. `contrast.test.ts` asserts every pair of
   §2.1 at its minimum (the gate also checks the CSS against the measured palette).
2. **Fonts** per OD-U2 (`state.json` → `owner_decisions`): A — add the two `@fontsource` packages, pinned exact, import
   400/500/600/700 and mono 400/500 in `v3/fonts/index.ts`, OFL row in `THIRD_PARTY_NOTICES.md`; B — `woff2` files in
   `v3/fonts/` with `SOURCES.md` (URL + SHA-256) and `@font-face` (`local()` first, `font-display: swap`), OFL row;
   C — no files, font stack `"IBM Plex Sans Arabic", "Segoe UI", "Noto Sans Arabic", Tahoma, system-ui, sans-serif`
   (mono: `"IBM Plex Mono", Consolas, ui-monospace, monospace`).
3. **Icons** `v3/icons/icons.tsx`: the 46 names of §2.5 as `export const Icon<Name>` (24 viewBox, `currentColor`,
   stroke 1.75, `aria-hidden` unless `label` is given, `mirror` prop for directional icons).
4. **Primitives** `v3/primitives/<Name>.tsx` + `.test.tsx` + `.stories.tsx` (title `v3/Primitives/<Name>`) for the 19 of
   §3.1. All forward `data-action`, `data-testid`, `aria-*`; `Button` renders `data-variant`, supports `loading`
   (`aria-busy`, keeps width) and `disabledReason` (`aria-disabled` + Tooltip); `IconButton` requires `label`.
5. `v3/index.ts` exports everything; `packages/ui/package.json` `exports["./v3"]` (same style as the existing `"."`).
6. `scripts/check-ds-v3.mjs <paths…>` + `--self-test`: fails on hex colours, px/rem/em literals, physical direction
   properties (`left`, `right`, `margin-left`, `padding-right`, `text-align: left|right`, …), numeric `zIndex`, and
   `!important` in `.ts/.tsx/.css` under the given paths, except `packages/ui/src/v3/tokens/**`.
7. `packages/ui/README.md`: a v3 section (how to import `@warsha/ui/v3`, the five principles, token names).

## U2 — v3 app infrastructure (`apps/desktop/src/v3/`) — Wave A
1. `app/V3App.tsx` with providers (client, capabilities, i18n v3, theme, density) rendering
   `<Frame>{route page}</Frame>`; `pages/frame/Frame.tsx` is a **placeholder** (U3 replaces it). `main` gets
   `data-ready="true"` when the page's primary data reached `ready` or `empty` (the e2e contract).
2. `router/`: in-house hash router (no dependency); `routes.ts` declares `/onboarding`, `/`, `/projects`,
   `/p/:projectId`, `/p/:projectId/r/:runId/:tab`, `/inbox`, `/settings/:section`, each pointing at
   `pages/<area>/index.tsx` placeholders (a heading only — no interactive element).
3. `actions/registry/{frame,onboarding,home,projects,project,inbox,bench,settings}.ts`, each exporting a typed empty
   `readonly ActionDef[]` (`{ id, labelKey, effect: 'rpc'|'nav'|'state', rpc?: string[], route?: string,
   capability?: string }`, one `id: '…'` literal per entry); `actions/index.ts` merges them and throws on duplicates in
   dev/test; `useAction(id, fn)` → `{ run, pending, error }`, failures go to a `notify()` port (`app/toast.ts`) that
   U3's Frame connects to the Toast composite; `capabilities.ts` (`daemon` from `health`, `provider` = at least one
   provider tested OK, plus one flag per optional feature).
4. `data/`: the 21 hooks of UI_V3_PLAN §5 (`useProjects … useHealth`, `useFiles`, `useAgent`), each returning
   `{ status: 'loading'|'empty'|'error'|'ready', data, reload }`, each with a test of all four states.
   `useRunEvents`: `runs.subscribe` with `since_seq`, resync on `resync_required`/gap, reconnect with backoff,
   unsubscribe on unmount — tested.
5. `copy/stages.ts` (the 14 → 5 map and the four gate questions of UI_V3_PLAN §4) and `copy/events.ts`
   (every `EventKind` → a catalog key), with tests.
6. `packages/i18n/src/v3/{ar,en}/{common,frame,onboarding,home,projects,project,inbox,bench,settings}.ts`
   (a few seed keys each, same keys both sides), `index.ts`, `useT()` with `{name}` interpolation, locale from the
   existing `warsha.locale` key; `packages/i18n/package.json` `exports["./v3"]`.
7. `main.tsx`: render `V3App` when `?ui=v3` or shell config `ui_version === 'v3'`; otherwise today's App — the default
   does not change, and every v2 suite stays green.
8. `app/startup.ts` decides the first route: `/onboarding` **only** when the shell config `onboarding_complete` is unset;
   otherwise `/` (or the last project). A daemon or list failure at startup shows the Frame with a danger Banner and a
   retry — never onboarding (v2 bug: a failing `listRuns` at `App.tsx:224` sent an onboarded owner back to onboarding,
   `App.tsx:396-399`). `startup.test.ts` covers the three cases.

## H1 — e2e harness truth + RPC log (Wave A)
Ground truth is the daemon (`crates/warshad/src/lib.rs`, `crates/warsha-core`), never the client.
1. Desktop stubs in `apps/desktop/e2e/harness.ts` (`rpcResult`, ~1554-1607): `postlaunch.crashes`/`postlaunch.reviews` →
   bare arrays exactly as the daemon serialises them (`lib.rs:3235-3266`); `backend.export`, `handoff.create` → bare
   string paths (`lib.rs:3149-3190`); `handoff.apply` → the JSON-encoded **string** of `ApplyResult`
   (`warsha-pipeline/src/handoff.rs:258-272`). Keep non-empty, realistic fixtures.
2. `runs.subscribe` fixture (`apps/remote/e2e/harness.ts` ~199-218): the `run` object in the daemon's snake_case.
3. **RPC call log**: every stubbed call is recorded (method, params, order); export
   `async function rpcCalls(page): Promise<{ method: string; params: unknown }[]>` from `harness.ts`.
4. `apps/desktop/src/harness.contract.test.ts`: feed each of the five stubs through the real `WarshaClient` method
   (fake transport) and assert it decodes; one negative case (an object-wrapped list is rejected).
5. Wire check **W10** in `scripts/check-wire-contract.mjs`: every RPC the remote `BenchApi` dials has a stub reachable
   from `apps/remote/e2e/harness.ts`; `--self-test` plants a violation; summary `wire: 10 checks, 0 violations`.

## R1 — Rust error hygiene and test timing (Wave A)
1. `crates/warsha-pipeline/src/settings.rs:131`, `:316` — non-test `unwrap()` → propagate.
2. `crates/warshad/src/lib.rs`: `pairings.revoke` (`:2913`) / `pairings.create` (`:2831`) surface failure as RPC errors
   (decide and test whether revoking an unknown device is an error or idempotent); plugin enable/disable never reports
   success when `mcp.connect`/`disconnect` fails (`:4239`, `:4243`, `:4280`); `get_active_harness(..).ok().flatten()`
   (`:3948`, `:3974`, `:4002`, `:4066`) never turns a DB error into the default harness; `wave2.rs:614-617` (and `:322`,
   `:861`) return an error naming the corrupt row. One test per behaviour.
3. Preview policy (`lib.rs:3476-3485`) judges the same first token as the quote-aware `split_command`
   (`process_spawn.rs:710`, `:811`); fix the stale comment; test an allow-listed quoted path with spaces and a refused one.
4. Timing-fragile tests (`lib.rs:7998`, `:8042`; `tests/child_reaping.rs:68`; `process_spawn.rs:967/983/1025`;
   `mcp_transport.rs:1083/1167/1559`; `agent_loop.rs:1157/1166`; `routines.rs:1025-1029`;
   `tests/events_stream_sync.rs:198`): children that block until killed, poll-until-deadline helpers; same assertions.
5. Do not change `RunCommand` (that is P7).
6. `lib.rs:5878-5885` prints `BOOTSTRAP_ADMIN_TOKEN` through `info!` (behind `WARSHA_PRINT_BOOTSTRAP_TOKEN=1`), so it can
   reach a log file or collector — against AGENTS.md. Keep the opt-in for headless operators, but write the line directly
   to stderr (not through `tracing`), and add a test that a captured tracing subscriber never sees the token.

## V1 — release truth (Wave A)
1. Every version field → the Rust workspace version **0.2.1**: root `package.json`, `apps/remote`,
   `packages/{ui,client,i18n,crypto}`; `apps/mobile/android/app/build.gradle` `versionName "0.2.1"`, `versionCode 201`
   (`major*10000 + minor*100 + patch`); `docker/compose.yml` tag.
2. `scripts/check-versions.mjs` with `--expect <v>`, `--set <v>` (all fields above + `Cargo.toml` `[workspace.package]`,
   `apps/desktop/src-tauri/{Cargo.toml,tauri.conf.json}`, `apps/desktop/package.json`, versionCode, `Cargo.lock`
   workspace entries offline) and `--self-test`; root script `"versions"`.
3. `docker/Dockerfile`: `ARG WARSHA_VERSION` + `LABEL org.opencontainers.image.version=$WARSHA_VERSION`.
4. `build.gradle` asset sync (`:118-156`): always build `apps/remote` before syncing; keep `Sync`, `**/*.map` exclusion,
   loud failure.
5. Root `.gitignore`: `*.jks`, `*.keystore`, `*.p12`, `keystore.properties`.
6. `release.yml`: fail early when `${GITHUB_REF_NAME#v}` ≠ `check-versions --expect`; move `contents|packages|id-token:
   write` to the jobs that need them (drop `packages: write` if unused); keep `draft: true`. Fix the stale comment at
   `desktop-bundle.yml:18`.
7. `apps/mobile/README.md`: remove the `840513` contradiction (`:124`) and the stale build date; keep the v0.2.0 APK
   facts as a dated record.
8. `docs/DAEMON.md:166-174` is stale: list all 14 `Stage` values from `crates/warsha-core/src/lib.rs:74-89` (including
   `gate_a`, `gate_b`), remove "no `gate_a`/`gate_b` stage", and remove "`providers.list` returns an empty vector …" —
   providers are real since the provider RPC batch; describe what the handlers do today (read them, do not guess).

## U1 — design-system composites (`packages/ui/src/v3/composites/`) — Wave B (after U0 merges)
The 27 composites of DS v3 §3.2, each `<Name>.tsx` + `.test.tsx` + `.stories.tsx` (`v3/Composites/<Name>`), built only
from U0 primitives and tokens. Contracts that pages depend on:
- `Composer` — `variant: 'simple'|'advanced'`, controlled value, `onSubmit`, Enter sends / Shift+Enter breaks,
  `submitVariant` (`primary` on Home, `secondary` elsewhere), `disabledReason`; the advanced slot takes extra controls.
- `ModelPicker` — `options: { id, label, providerLabel }[]` from the caller; empty → an `onAddModel` action; no list inside.
- `DecisionCard` — `question`, `rationale`, `consequences[]`, `onApprove`, `onRequestChanges(text)` (required text),
  `onReject(reason)` (Dialog); the only orange (`attention`) card; its Approve is the view's single yellow primary.
- `Button` `primary` = the logo yellow fill with dark ink; never yellow text or thin yellow lines on the light theme
  (selected tabs, current step, links and focus use `primary-text`), never yellow on selected pills/chips/rows.
- `Stepper` — `stages: { key, label, state: 'done'|'current'|'waiting'|'failed'|'todo' }[]`, `size: 'simple'|'detailed'`.
- `Toast` — `ToastProvider` + `useToast()`; errors persist with a retry callback.
- `Dialog`/`Sheet` — focus trap, Esc, return focus, `layer-modal`, scrim token.
- `DataTable` — sortable headers with `aria-sort`, row Menu, compact density.

## E0 — e2e v3 support (`apps/desktop/e2e/v3/support/`) — Wave B (after H1 and U2 merge)
- `openV3(page, route, { lang = 'ar', theme = 'light', mode = 'simple' })`: sets `warsha.locale`, `warsha.theme`, the
  shell config `app_mode` the same way the v2 harness does, opens `/?ui=v3#<route>`, waits for `main[data-ready="true"]`.
- `act(page, id, { nth? })` clicks `[data-action="<id>"]`; `expectRpc(page, method, params?)` polls `rpcCalls` (re-exported
  from `harness.ts`) until the call appears.
- `smoke.spec.ts`: every route of `routes.ts` boots in ar and en with `main[data-ready="true"]`.

## U3 — Simple pages: frame, onboarding, home, projects, project, inbox — Wave C
Build UI_V3_PLAN §3.0–§3.5 exactly, look per `v3-preview.html`. Register every listed action id in its area file
(add `*.open` helpers if needed; drop an id only when the daemon lacks the method, and say so). `pages/frame/Frame.tsx`
replaces the placeholder: TopBar, inbox count from `gates.list`, ProjectSwitcher with names, ToastProvider wired to
U2's `notify()`. Verify in `crates/warsha-pipeline` whether approving a gate continues the run by itself; register
`project.gate.approve`/`inbox.gate.approve` with or without `runs.advance` accordingly and state it in the report.
`home.start` calls `projects.create`, `budget.set`, `runs.start` in that order.
**Each area spec** `apps/desktop/e2e/v3/<area>.spec.ts` contains: the journeys; one test per action id that clicks it and
asserts its effect (`expectRpc`, URL, or visible state); axe + keyboard per page in ar/en × light/dark (`@a11y` in the
title); screenshots per page state × 1280×800 and 390×844 × ar/en × light/dark with **`@visual` in the title**
(the genesis baselines; never commit a PNG).

## U4 — Workbench (Advanced) — Wave C
UI_V3_PLAN §3.6: rail, header with run controls, 14-stage strip, the ten tabs, the advanced composer. «المساعد» is a real
chat on `agent.turn` / `agent.plan_mode` / `agent.approve_mode` / `agent.state` (Plan ↔ Agent; the owner's click is the
approval); no fake replies. «الطرفية» is read-only. Spec rules as U3 (area `bench`).

## U5 — Settings — Wave C
UI_V3_PLAN §3.7: SideNav and the twelve sections; Simple mode shows four plus «إعدادات متقدّمة». Every destructive action
goes through a Dialog. API keys: `type="password"`, never logged, never in a URL or test snapshot. Spec rules as U3
(area `settings`).

## U6 — Remote PWA on v3 — Wave C (after U1 merges)
Rebuild `apps/remote/src` screens (Needs you, Projects, Run, Gates, Settings, pairing) on `@warsha/ui/v3` with the same
rules (one primary, plain Arabic, no fake data, every control wired). Keep behaviour, routes and the test ids
`remote-screen-*`, `remote-nav`, `remote-pair-submit`; remote flows 7/7. Remove the Google Fonts links from
`apps/remote/index.html`.

## U7 — cutover — Wave D (only after OD-U3 = yes)
Make v3 the default and only UI: `main.tsx` renders `V3App`; delete `apps/desktop/src/screens/**`, the v2 components and
`App.tsx`, the v2 design system in `packages/ui/src` (keep `src/v3/**` and an `index.ts` that re-exports v3), the six v2
desktop specs and their snapshot dirs, the v2 `SCREENS` list in `harness.ts`, v2-only e2e helpers, and the Google Fonts
links in `apps/desktop/index.html`. Retarget `scripts/check-arch.mjs` R6 at the v3 paths without weakening any rule. Mark
`DESIGN_SYSTEM_V2.md` retired (status line), add DS v3 + UI v3 to `docs/designs/SITEMAP.md`, rewrite `docs/UI.md` for v3.

## P7 — agent `RunCommand` policy — Wave B (only if OD-B4 = approve)
Route `FilesystemToolExecutor::run_command` (`agent_tools.rs:370`) through the process allow-list `warshad` uses for
preview/`process.spawn`, judged on the first `split_command` token; refuse `sh`, `bash`, `cmd`, `powershell`, `pwsh` unless
allow-listed; the refusal is a `ToolError` the agent sees; wire it in `build_agent_loop` (`warshad/src/lib.rs:4868`).
Tests: refused, allowed, shell refused.
