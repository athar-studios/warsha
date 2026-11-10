# Executive summary — UI v3 planning (2026-11-09)

Planner: Claude Opus 5.5 (governance + design documents only). Code audits: two read-only Haiku subagents (control
inventory of Simple/Advanced/RunView/shell; screen + daemon capability map), on top of the four audits of the same day
(`../2026-11-09-phase-b-visual-wave/EXECUTIVE_SUMMARY.md`, still valid for the Rust, harness and release findings).
Every high-severity claim used here was re-checked by the planner in the file.

## The owner's verdict, confirmed with numbers
- **137 controls** traced: 27 RPC · 55 visible state · 22 navigation · **15 dead state · 8 no-op · 10 fake**.
- Static scan of `apps/desktop/src` with the planner's `actions-gate` parser: 177 interactive element sites,
  **45 hard-coded model/workflow names**.
- Verified in the file: the Simple chat «أرسل» shows a canned reply after a 1 s timer (`SimpleMode.tsx:754-766`); the
  chosen model never reaches `startRun(project.id, brief)` (`SimpleMode.tsx:692`).
- Gates inbox decisions are local only — the daemon never hears them (`GatesInbox.tsx:240`).
- Six screens (Budgets, Devices, Roles, Providers, Artifacts, Run) are reachable only by deep link.
- The daemon serves capabilities the UI never uses: `agent.*` (a real chat), `runmode.*`, `preferences.*`,
  `preview.start/stop`.

## What the plan delivers
- **Design system v3 «حِرفة»** (`docs/designs/DESIGN_SYSTEM_V3.md`): five binding principles, a warm-paper palette with
  the Warsha logo yellow `#FFD400` as the one primary (a fill with dark ink, 12.2:1; dark gold `#7A5C00` for links and
  indicators on light) and orange reserved for "waiting on you" — **50 contrast pairs measured, all pass AA in light and
  dark** — IBM Plex Sans Arabic, 4-based space, two densities, 46 in-house icons, 19 primitives, 27 composites.
- **UI v3 plan** (`docs/designs/UI_V3_PLAN.md`): 8 page areas, about 125 named actions each mapped to a served RPC, a
  route or a visible state; the 14 daemon stages folded into 5 plain stages; features without daemon support are left
  out, not faked.
- **Visual reference** (`docs/designs/v3-preview.html`): Home, Project, Workbench, Settings and the system itself, both
  themes; its CSS matches the measured palette (`contrast.mjs --check-css` passes on it).
- **Machine-checked promises**: `actions-gate` (12/12 self-test), `i18n-gate` (8/8), `planner-simplicity.spec.ts`
  (≤ 10 actions above the fold, ≤ 1 primary, one composer, no Latin UI text in Arabic), `pw-gate` fences.

## The run
13 packets (P7 and U7 conditional), 154 frozen gates, 6 fenced refreshes, cutover only on the owner's word, a local
draft bundle at the end. Owner decisions in `OWNER_DECISIONS.md`; **OD-U0 (approve the spec) is a hard stop**.
