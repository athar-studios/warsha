# R-EXT-1 report — Connections, the three MCP calls the daemon already served

**Status: DONE.** Every gate in the packet is green on the final tree. The lane's red results were all one class —
a `main[data-ready="true"]` wait losing under load: two full e2e runs at default parallelism each dropped a few
unrelated cases (both re-run alone and green; the accepted run is 298/298 at `--workers=3`), and one desktop unit
test of mine was timing-sensitive by its own construction and was fixed, not waved through. Findings, deviations
and limits are at the end.

- **Branch:** `zl-rext1-connections` (the branch the lane was told to cut: `zl-rext1-*`, not the packet's
  `r-ext-1-*`; the base and the isolation are the packet's).
- **Base:** `e435a8a` on `repair/dev-csp-f474776` (`d8dc8d3`, the packet's "before" tree, is an ancestor).
- **Commits** (all on the branch, nothing else in it):

| Commit | What |
|---|---|
| `5d22a11` | `feat(client): wrap mcp.list, mcp.connect and mcp.disconnect (R-EXT-1)` — types + four decoders + three methods, 12 tests |
| `ec8f454` | `test(e2e): stub mcp.list, mcp.connect and mcp.disconnect in the harness` — `RPC_METHODS` + three stub cases + the launch-check helpers |
| `f128b08` | `feat(desktop): Connections settings section for MCP servers (R-EXT-1)` — section, 6 registry actions, 40 keys × 2 catalogs, nav, 13 component tests, nav-count 13 → 14 |
| `ae13583` | `test(e2e): prove every Connections action against the stub daemon (R-EXT-1)` — 7 `@non-visual` cases |
| `b25b82f` | `docs(daemon): name the mcp.list, mcp.connect and mcp.disconnect rows (R-EXT-1)` — the three rows + the wrapper note; a test-stability fix |
| `35efe6c` | `style(i18n,e2e): keep the new catalog lines and launcher helper Prettier-clean` |

16 files, `+1884 / −5` against the base. No Rust file in the diff.

## What is there now

**Client (`packages/client/src/index.ts`).** `mcpList()` → `rpc('mcp.list')` decoded into `McpConnection[]`;
`mcpConnect(config)` → `rpc('mcp.connect', { config })`; `mcpDisconnect(name)` → `rpc('mcp.disconnect', { name })`.
`decodeMcpStatus` normalises both arrivals of `McpStatus` — the unit variants as strings and `Error(String)` as
`{ error: "…" }` — and refuses an unknown status instead of defaulting to `disconnected`. `decodeMcpConnection`
reads `tool_definitions` and falls back to the bare `tools` names (description `''`) when the daemon sent none.
`WarshaMcpConnectionsApi` is a separate interface; `WarshaClient` implements it beside the three it already had.
No `mcp.send`/`mcp.call` wrapper.

**Harness (`apps/desktop/e2e/harness.ts`).** Three methods in `RPC_METHODS`, and stubs that refuse what the daemon
refuses: a missing `config`, a config with no `name`, a stdio config with no program, and an unpinned launcher
package (`npx pkg` without `pkg@x.y.z`) — the last in the daemon's own words, from `wave2::require_pinned_launch`.
`mcp.list` defaults to `[]` and is overridable through `fixtures`; `mcp.disconnect` requires `name`.

**Screen (`apps/desktop/src/v3/pages/settings/sections/ConnectionsSection.tsx`).** New `SettingsSectionId`
`'connections'` (advanced, scope daemon) before `mcp`; the `mcp` permission section is untouched (OD-EXT1-b).
A row per server: name (`bdi dir="ltr"`), transport pill, status `StatusPill`, the daemon's error message when
`error`, the command or the url (`bdi dir="ltr"`), `process_id` **not** shown, and the tools behind an
`aria-expanded` toggle. Per tool a permission selector whose stored value comes from
`mcpPermissionsList` for the role **the reply names** (`agentRole`), else its `defaultPermission`; writing goes to
`mcpPermissionsSet(server, tool, agentRole, permission)`. Add form: name, command, args (space-split, shown as
typed), stdio only. Disconnect is open → confirm. "Test connection" is **Refresh status**, which re-runs
`mcp.list`; the note beside it says refresh never tests, because the daemon has no probe method and this packet
adds none.

**Registry.** `settings.connections.{refresh (mcp.list), add (mcp.connect), disconnect.open (state),
disconnect.confirm (mcp.disconnect), tool.permission (mcp.permissions.set), tools.toggle (state)}`.

## Gates (final tree)

| Gate | Command | Exit | Result |
|---|---|---|---|
| lint | `pnpm lint` | 0 | 0 errors, 1 pre-existing `react-hooks/exhaustive-deps` warning (`inbox/index.tsx:360`, untouched) |
| typecheck | `pnpm typecheck` | 0 | incl. `tsconfig.e2e.json` |
| build | `pnpm build` | 0 | |
| unit | `pnpm -r test` | 0 | client 186 · crypto 22 · i18n 58 · ui 383 · remote 221 · desktop 815 = **1685**, 0 failed |
| wire | `node scripts/check-wire-contract.mjs` | 0 | **wire: 11 checks, 0 violations** |
| wire self-test | `node scripts/check-wire-contract.mjs --self-test` | 0 | 11 checks fire; clean fixture clean in both modes |
| arch | `node scripts/check-arch.mjs` | 0 | 5 rules, 0 violations |
| policy | `node scripts/check-engineering-policy.mjs` | 0 | 8 checks, 0 failures |
| design system | `node scripts/check-ds-v3.mjs apps/desktop/src/v3 packages/ui/src/v3 apps/remote/src` | 0 | 0 violations |
| contrast | `node $TOOLS/contrast.mjs --check-css packages/ui/src/v3/tokens/tokens.css` | 0 | fails 0 |
| i18n | `node $TOOLS/i18n-gate.mjs "$PWD"` | 0 | **786 keys, 0 violations** (I2/I4/I6 hold with the 40 new keys in both catalogs) |
| actions | `node $TOOLS/actions-gate.mjs "$PWD"` | 0 | **158 registered, 158 used, 0 violations** (A1/A4/A5/A6/A7) |
| e2e | `pnpm exec playwright test --project=desktop apps/desktop/e2e/v3 --grep-invert "@visual" --workers=3` | 0 | **298 passed, 0 failed** in 8.2m (291 cases this packet does not touch + its 7) |
| planner-simplicity | spec copied into `apps/desktop/e2e/v3/`, run, deleted | 0 | 6 passed; `git status` shows it absent |

`$TOOLS` = `/home/moe/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3/tools` — absolute, from the main checkout,
since `bridge-io/` is not in a worktree. Rust gates (`cargo fmt/clippy/test`) were not re-run: the diff has no `.rs`
file (`git diff --stat e435a8a..HEAD -- '*.rs'` is empty), so they cannot have moved.

Unit counts against the R-UI-4 baselines: client 174 → 186 (+12), desktop 802 → 815 (+13), every other package
exactly its baseline.

## Wire contract — 11 checks, W1–W11

All eleven satisfied at 0 violations. The three that this packet could have broken, and how they were shown to be
live rather than merely silent:

- **W9 (client method with no harness stub)** — `mcp.list`, `mcp.connect`, `mcp.disconnect` are new client methods,
  and the harness had no stub for any. Discrimination below: with the harness reverted to `d8dc8d3` the gate reports
  exactly three W9 violations; with the stubs in place, none.
- **W2 (harness method not registered)** — the three names added to `RPC_METHODS` are daemon methods, so no W2.
- **W8 (param-name drift)** — `mcp.connect` sends `{ config }` and `mcp.disconnect` sends `{ name }`, the daemon's
  own bound names (`crates/warshad/src/api.rs:265-284`); the tests assert those keys and nothing beside them.
- **W1/W7** — no client method names a method the daemon does not serve, and every required argument is sent.

## Discrimination (new tests fail on the old tree, pass on the new)

Evidence is saved under `target/discrimination/r-ext-1/{before,after}/` (gitignored, `target/` is).

| What | Before (base `d8dc8d3` source, new tests) | After (this branch) |
|---|---|---|
| wire gate, client new + harness old | `wire: 11 checks, 3 violation(s)`, exit 1 — three W9 lines naming the three methods | `11 checks, 0 violations`, exit 0 |
| `pnpm --filter @warsha/client test` | 12 failed / 174: `client.mcpList is not a function`, `decodeMcpConnection is not a function`, … | 186 passed, exit 0 |
| `ConnectionsSection.test.tsx` | suite fails to load: `Failed to resolve import "./ConnectionsSection"` | 13 passed, exit 0 |
| `connections.spec.ts` "shows a failed server…" | fails: `[data-testid="mcp-connection-row-flaky"]` not found (15 s) | 1 passed, exit 0 |
| `i18n-gate` with one key renamed in `en` only | 2 violations (I2 names the key in both catalogs) — the 40 new keys are parsed, not skipped | 0 violations |
| `actions-gate` with a registry id nothing uses | A4 fires by id (seen while the Select-based control hid its `data-action`) | 0 violations |

## Design points confirmed

- **`disconnected` is `idle`, not `waiting` or `failed`.** The packet said "done/waiting/failed mapping as in
  `PERMISSION_VIEW`"; the row uses `done`/`running`/`idle`/`failed`. A recorded http server and a stdio server that
  was never started are both `disconnected` and neither is a fault, so `failed` would lie; `waiting` shows the "needs
  you" ring, which is also wrong. `RoutinesSection`'s `mapRoutineState` set the precedent (`idle`). `error` is
  `failed`. This is the one place I read the packet's wording as a default rather than a literal.
- **No probe, and the label says so.** "Refresh status" re-runs `mcp.list`; the `refresh_note` under it reads
  "Refresh re-reads the server list; it never tests." The word "test" appears only inside that denial.
- **http/websocket are recorded, not connected (R-EXT-4 makes them real).** They are not offered in the add form
  (stdio only), and a server whose transport is a url shows "Recorded, not connected: nothing dials this address
  yet." where its tools would be — never an empty-tools success state.
- **Refusal text is the daemon's.** `mcpConnect` rejections render verbatim in a danger `Banner`; the stub's
  unpinned-package message is `wave2::require_pinned_launch`'s sentence, so the e2e case and the screen agree with
  the daemon. One difference worth knowing: the stub refuses as `-32602` (the packet's class) while the live daemon
  answers `POLICY_REFUSED`/`-32005` (`crates/warshad/src/auth.rs:1434`). Both surface as the same banner because the
  screen renders the message, not the code; the stub documents the difference in its doc comment.
- **The role is never in the screen.** The permission write uses `agentRole` from `mcp.permissions.list`; the e2e
  fixture answers `reviewer` (not the daemon's usual `agent`), so a hard-coded role would fail the case. `role_note`
  names the role to the user so the stored rule is not a mystery.
- **`process_id` stays hidden**, per the packet. A pid is daemon state, not a setting.
- **Tool permission is the repo's segmented radiogroup**, the language/theme pattern, not a `<select>`: a native
  select carries no `data-action` the actions gate can see (A4 refused it), and three words read faster than a
  dropdown. Each button is `role="radio"` with `aria-checked`, inside a `role="radiogroup"` labelled with the tool.
- **Args are split on whitespace as typed**, and the hint says so; nothing is quoted or shell-parsed. A server that
  needs a quoted argument is a screen bug, not a silent one.
- **CSS is logical and token-only.** Four row classes added to `settings.css` (`.v3-settings-stack`,
  `.v3-settings-row-detail`, `.v3-settings-add-form`, `.v3-settings-add-fields`): `gap`, `padding-inline`, `border`,
  no colour literal, no physical property. RTL was measured, not assumed: the `@a11y` case asserts `html[dir=rtl]`
  and that the server name and command stay `bdi dir="ltr"` inside it.
- **Nav count.** `Settings.test.tsx` asserted 13 sections; `'connections'` makes it 14, in that file (the packet's
  one permitted edit) and in `settings.spec.ts`'s navigation journey. `settings.spec.ts`'s `SECTIONS` array was
  **not** extended: it feeds `@visual` cases whose baselines do not exist on this host, and this lane may not create
  them. The Connections cases live in their own `@non-visual` file.

## Deviations, limits, findings

1. **`PROGRESS.md` and `DECISIONS.md` are not touched**, though `AGENTS.md` asks for both. The lane's instructions
   forbid `docs/zadloop/packets` and PROGRESS, and the report file named by the packet is this one. The design
   decisions that would have gone to `DECISIONS.md` are the "Design points confirmed" list above.
2. **Branch name** is `zl-rext1-connections`, per the lane's instruction, not the packet's `r-ext-1-*`.
3. **Two `@visual`-lane consequences, both deliberate:** no snapshot was captured or updated (this host is not
   capture-grade — R-UI-4's finding stands), and the Connections section therefore has no pixel baseline. Its
   layout is gated by the `@non-visual` cases, `check-ds-v3` and the RTL/axe/keyboard case instead.
4. **Full-suite e2e failures are load-only, and the gate was run until it was clean.** The first two full runs
   were at Playwright's default parallelism (8 workers) on a machine that was also running this lane's other
   commands, and each lost a different handful of cases to the *same* wait: `openV3`'s
   `main[data-ready="true"]` (`apps/desktop/e2e/v3/support/index.ts:176`). Run 1: one case
   (`settings.spec.ts:1041 › … (en, light)`), 297/298. Run 2: three cases in `bench.spec.ts`'s "Journeys &
   Amendments", 295/298. The failing cases were then run alone and pass (the a11y case: 4/4 in 2.2 min, exit 0), and
   the full run at `--workers=3` is **298/298, exit 0, 8.2m**. This is the saturated-host class R-UI-4 recorded
   (its finding 3, a desktop unit test); the assertion waits for the whole screen to report ready, so it is the
   first thing to give way when the machine is busy. Nothing in this packet is in those three bench cases or in the
   Settings a11y loop's `SECTIONS` list.
5. **One real test bug of mine, found and fixed:** `ConnectionsSection.test.tsx` waited for the section's root, which
   exists while the loading skeletons do, so "renders all four statuses" failed in the full `pnpm -r test` run and
   passed alone. It now waits for the add form's `data-testid="mcp-connection-add"` (rendered only after both reads
   answer). Three consecutive runs and the full suite are green.
6. **Nothing was reverted from anyone else's work.** The worktree was cut from `e435a8a`; R-UI-5's
   `scripts/android-smoke.sh` and its report were never opened or written.
7. **For R-EXT-4:** the screen already distinguishes "recorded" from "connected" and renders `connecting`, so making
   http/websocket dial needs the daemon side only — no screen change is implied by this packet's shape.

## Files changed

`packages/client/src/index.ts`, `packages/client/src/index.test.ts`, `apps/desktop/e2e/harness.ts`,
`apps/desktop/e2e/v3/settings.spec.ts`, `apps/desktop/e2e/v3/connections.spec.ts` (new),
`apps/desktop/src/v3/actions/registry/settings.ts`,
`apps/desktop/src/v3/pages/settings/{types.ts,index.tsx,SettingsNav.tsx,settings.css,Settings.test.tsx}`,
`apps/desktop/src/v3/pages/settings/sections/ConnectionsSection.tsx` (new) + `ConnectionsSection.test.tsx` (new),
`packages/i18n/src/v3/{ar,en}/settings.ts`, `docs/DAEMON.md`, this report.
