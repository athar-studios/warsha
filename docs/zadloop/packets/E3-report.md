# E3 Report — Factory mode

## Status
- Delivered in this packet (PM in-tree after the worker attempt budget was exhausted; worker
  scaffolding — routes/actions/i18n wiring, registry ids, first state.ts — was kept where sound).
- Floor schematic (`apps/desktop/src/v3/pages/factory/Floor.tsx`): SVG + CSS only (no canvas, no
  game engine). Stations = stages: planning table → code benches → review bench → gates checkpoint
  → shipping dock; break area for idlers. Movement by `transform`/`opacity` transitions; a marker
  sits on the station of its latest stage event; `handing_off` markers sit at the mid-point between
  the source and target stations; idle markers sit in the break area with an idle-duration label.
  Waiting-on-owner markers carry a "needs you" badge at the gates checkpoint.
- State machine (`state.ts`, pure): `idle | working | handing_off | waiting_on_owner | done`
  derived from N1 session events. `handing_off` is entered ONLY when an event payload names both
  sessions (`handoff_from` + `handoff_to`) — one-sided mentions move nobody (plan rule). Keys are
  `payload.session` when a backend reports one, else `runId:role` (daemon events carry no
  session_id — decided, mirrors E4). 7 unit tests (`state.test.tsx`).
- Page (`index.tsx`): project → active runs → `runs.subscribe` event streams → reduce; STOP-ALL
  (owner's corner) = `runs.cancel` per active run not already stopped; agent panel figures come
  from the same event stream E4 derives from (cost sum, current action, role, model when a backend
  reports one, last file touched from tool payloads, link to the run's code route for the E6
  viewer); swarm runs show one banner per run with subtask counts (D5 `runs.subtasks`).
- Accessibility/perf: list view one keypress away (`L`, plus a button) announced via `aria-live`;
  reduced-motion (`prefers-reduced-motion`) drops every transition and the idle tick; hidden tab
  cancels the rAF idle loop (no animation work off-screen — the 10 s rAF-zero acceptance is covered
  by the `hidden tab stops the idle tick` test); 32 concurrent agents laid out in slot grids.
- e2e (`apps/desktop/e2e/v3/factory.spec.ts`): `openV3` cases for `factory.stop.all` (asserts the
  `runs.cancel` RPC), `factory.view.toggle`, `factory.agent.view`.
- i18n: `factory.*` keys in `packages/i18n/src/v3/{en,ar}/factory.ts` (36 keys each, ar Latin-free,
  placeholder parity). i18n-gate 938/0.

## Skipped Audits
- Pixel skin: skipped (no CC0/MIT-verified asset set was provided; schematic floor only, per plan).

## STOP-ALL Semantics
- Iterates active runs and calls `runs.cancel` once per run; already-stopped runs are skipped;
  failures surface in an error banner; the completed/paused distinction is the run status list.

## State Machine Fixtures
| Initial State | Event | Resulting State |
| :--- | :--- | :--- |
| idle | AgentStep | working |
| working | GateDecision(pending) | waiting_on_owner |
| waiting_on_owner | RunFinished | done |
| idle | dual-session handoff payload | handing_off (target keyed by handoff_to) |
| any | one-sided handoff mention | unchanged |
| idle | CostRecorded | idle (cost accumulates) |

## Repairs this packet made outside its own scope (recorded, PM-owned)
- `apps/desktop/package.json`: E6 (commit ff18271) pinned CodeMirror packages to versions that do
  not exist upstream (`@codemirror/search@6.6.1` was never published — registry top is 6.7.x),
  while committing a lockfile resolved from caret specifiers. `pnpm install --frozen-lockfile`
  failed repo-wide since E6. Repair: package.json now carries the lockfile's caret specifiers;
  `pnpm install --frozen-lockfile` is green again. (E6 lineage debt, fixed here because E3 is the
  first packet to need a fresh install.)

## Gates (this tree @ commit)
desktop 890/890 (101 files) · client 194/194 · ui 383/383 · i18n-gate 938/0 · wire 4 pre-existing
(catalog.refresh/apply) · arch 5/0 · policy 8/0 · actions 170/177/19 (all pre-existing; E3 adds
none) · ds-v3 43 (baseline, none from factory) · gitleaks clean · tsc 0 errors.
Rust untouched by E3 (desktop-only packet); workspace cargo gates run at merge on integration.
