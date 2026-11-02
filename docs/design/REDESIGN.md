# Warsha redesign — B1 locked direction: **Bench & Signal** (طاولة العمل والإشارة)

Status: **LOCKED** by task B1 (2026-11-02). This document is the single redesign direction for the
Warsha desktop and remote UIs. It is grounded in `bridge-io/skills/DESIGN_BRIEF.md` (B0 original
synthesis), `bridge-io/skills/LOCKFILE.md` (license boundary), `bridge-io/audit/inventory.md`,
`bridge-io/audit/hardcoded.md`, `bridge-io/audit/a11y.md` (AUDIT-1), `packages/ui/src/tokens/tokens.css`,
`docs/ARCHITECTURE.md`, `docs/UI.md` and the screens under `apps/desktop/src`.

Companion artifacts:

- Mockups: `bridge-io/mock/01-simple-workbench.html` … `06-settings-providers.html`, shared layer
  `bridge-io/mock/warsha-mock.css`, runtime `bridge-io/mock/mock-runtime.js`.
- Screenshots: `bridge-io/shots/redesign/` — 48 PNGs = 6 mockups × {ar, en} × {light, dark} ×
  {1440×900, 390×844}, captured by `bridge-io/mock/capture.mjs` (Playwright + host Chrome).
- Decision record: one appended section in `DECISIONS.md` (B1).

Nothing in this document changes product code. It specifies what the implementation batches should build.

---

## 1. The chosen direction and why

**One visual idea, grounded in Warsha's own model:** Warsha (ورشة) means *workshop*. The interface is
the **supervisor's bench** in that workshop — a flat, ruled work surface where work is fastened down,
not a pile of floating cards. On that bench there is exactly one **signal colour**, the Warsha yellow,
and it behaves like a machine signal lamp:

> **A lit lamp means "this needs the owner's hand."** Pending gates, the lane that is waiting on a
> decision, the primary action of the current screen — these are lit. Everything else is neutral
> plate, hairline rule and machine-grey text. Yellow is never decoration, never a background wash,
> never a gradient.

Consequences that make the direction concrete and testable:

1. **Panels are plates, not cards.** Surfaces are separated by 1px rules (`--warsha-bench-rule`) and
   two recess levels (`bg` → `surface` → `surface-muted` as `--warsha-bench-plate`). Radii stay at the
   token scale `sm/md` (4/6px); `xl` (12px) is reserved for dialogs. No interchangeable rounded-card
   grids, no decorative shadows; `shadow(md)` appears only on the gate card, the one object that must
   interrupt the transcript.
2. **Ledgers, not lists.** Agents, gates, projects, providers and routines render as ruled ledger rows
   on a recessed plate: one row, one lamp, one name, one state word. The selected row gets a 3px
   signal edge on its inline-start side (mirrored automatically by logical properties).
3. **Machine data is mono.** Run ids, costs, token counts, timestamps, diffs and terminal output use
   `--warsha-font-mono` with tabular numerals. Prose and labels use `--warsha-font-sans`. The split is
   semantic: *who speaks* is sans, *what the machines did* is mono.
4. **Decisions get stamps.** An approved/rejected gate leaves a pressed-metal stamp (2px currentColor
   border, slight rotation, mirrored per direction) — a physical record, never colour alone.
5. **The brand mark is a hex nut** in signal yellow with a plate-coloured bore — the workshop's one
   logo gesture, reused as the favicon/topbar mark and as the empty-state ghost.
6. **Dark theme is the night shift**, not an inversion: same lamp semantics, independently tuned
   values (already the case in `tokens.css`: `accent-strong` flips from `#8a6a00` to `#ffd60a` so the
   signal stays AA-readable as text on both plates).

### Why this direction wins for Warsha

- It is **grounded in the product's own nouns** (ورشة/workshop, gates, lanes, supervised runs), so the
  metaphor teaches the model instead of decorating it.
- It makes **supervision legible at a glance**: an owner scanning the bench sees lit lamps = their
  queue. That is Warsha's core job (supervised AI work), which generic dashboards bury.
- It is **cheap to keep honest**: one signal colour + neutral plates means contrast, dark mode and
  reduced motion are token-level properties, matching the existing `tokenDrift` gate (R6).
- It is **Arabic-first by construction**: ruled horizontal ledgers and inline-start rails mirror
  perfectly with logical properties; there is no left-handed artwork to flip.

### Rejected alternatives (summary; full record in `DECISIONS.md` B1 section)

| Alternative | Why rejected |
| --- | --- |
| Chat-first messenger (bubbles everywhere) | Gates and budgets become chat decorations; approval affordances lose permanence; the approvals strip must survive scroll, which bubbles cannot guarantee. |
| Mission-control glass dashboard (floating cards, gradients, glows) | Interchangeable with any SaaS; shadows/glows fight WCAG AA on both plates; Arabic prose measure collapses inside small cards. |
| Terminal/IDE clone | Hostile to the Simple-mode owner, who is the primary user; Advanced mode already owns the terminal surface where it earns its place. |
| Landing-page aesthetic (hero, feature grid) | Warsha is a workbench, not a brochure; the brief explicitly forbids defaulting to showcase layouts. |

---

## 2. Target users and jobs

| User | Job to be done | Bench answer |
| --- | --- | --- |
| **Owner-supervisor** (Arabic-first, non-developer or part-time dev) | "Tell me what the team did, what it costs, and what is waiting on me — in plain Arabic — and let me approve or stop it in one tap." | Simple workbench: chat with the Orchestrator, team panel in plain language, gate cards with three actions, instrument strip with budget meter. |
| **Reviewing developer** | "Prove the run is reproducible: every tool call, diff, test result and cost, filterable, exportable." | Advanced workbench: lanes, task board, unfiltered event stream, files/diff/terminal panes. |
| **Mobile checker** (remote PWA / phone glance) | "Is anything waiting on me? Approve or defer in under ten seconds on a 390px screen." | Narrow layout: agent strip, gate card inline, sticky composer, instrument strip reduced to daemon + budget. |

Non-goals: free-form agent marketplaces, social features, theming beyond light/dark owner choice.

---

## 3. Information architecture — Simple first, Advanced by disclosure

Simple mode is the **primary** workflow. Advanced mode discloses the same daemon state deeper; it never
changes the pipeline, gates or data model, and switching mid-run preserves project, run, tab, filter
and scroll position (existing behaviour in `docs/UI.md`, retained).

**Disclosure ladder** (each rung adds detail; nothing is removed):

| Rung | Simple shows | Advanced adds |
| --- | --- | --- |
| 1 | Team as people: name, one-word role, one of four states (`idle / thinking / working / waiting on you`) | Lanes: role + model id + lane number + live cost |
| 2 | Chat transcript with the selected agent; approvals inline and repeated in a strip | Full event/tool stream with ms timestamps and tree glyphs; filter chips (`all/tools/errors/costs/gates`; a filter never hides gate events) |
| 3 | One-paragraph team summary + activity feed in plain language | Task board (`done/running/todo`), file tree, diffs, terminal dock |
| 4 | Budget as one meter + `$spent / $cap` | Cost KPIs, per-role breakdown, cost per run |
| 5 | Settings subset: language, providers, routines, subscriptions | Roles routing, budgets per project, devices, crash reports, backend kit |

Rule: **no JSON, tool names, token counts or diffs in Simple mode**; **no plain-language summary
hidden in Advanced mode** (the summary paragraph survives as the stream's header context).

---

## 4. Navigation

- **Topbar** (56px): brand mark + name (`app.name` / `app.brand`), contextual project/run id (mono,
  `translate="no"`), mode switch (`Simple ●──○ Advanced`, `role="group"`, pressed state), gate bell
  with count badge (the badge is a lit lamp: signal on ink), settings icon. On <768px the topbar wraps
  and the project id hides.
- **Instrument strip** (36px, recessed): daemon lamp + word, run id, stage, active counts, budget
  meter + percent. Progressive disclosure on <768px keeps only daemon + budget (`.hide-narrow`).
- **Start rail** (inline-start; right in RTL, left in LTR — no mirrored code path): agents ledger in
  Simple, lanes + task board in Advanced, inbox ledgers on gates/settings screens. 264px at ≥1024px;
  becomes a horizontal agent strip or stacks above main below 1024px.
- **End panel** (300px, ≥1024px, Simple only): team summary, team cards, activity. Folds away below
  1024px; its summary line survives in the mobile agent strip.
- **Settings tab strip**: the six settings screens (`settings`, `settings-providers`, `routines`,
  `crash-reports`, `store-reviews`, `backend-kit`) share one horizontally scrollable `role="tablist"`.
- **Back behaviour**: every pushed screen keeps a back control at inline-start (`run.back`,
  `common.back`); back returns to the documented parent (`run → projects`, `gates → run`, …per
  `App.tsx` fallbacks). Deep-linkable state: `screen`, `project`, `run`, `tab`, `filter`,
  `expanded lane/gate` — the architecture already models these as `Screen` state; the redesign asks
  for them to be serialized in the remote PWA URL and restored on desktop launch where supported.

---

## 5. Screen list mapped to the AUDIT-1 inventory

All 16 screens from `bridge-io/audit/inventory.md` §1 keep their route keys and map onto bench regions:

| Screen (`App.tsx` key) | Redesign surface | Bench regions used | Mock |
| --- | --- | --- | --- |
| `onboarding` | Guided bench setup: language → provider → key → test → first project (existing 5 steps) | Centered single column, instrument strip hidden, step ledger on inline-start at ≥768px | — (existing shots cover; restyle only) |
| `projects` | Projects ledger: ruled rows, stage chips, budget meter, needs-you lamp; new-project plate inline (no modal on mobile); archive empty state | Main ledger + inline form plate | 03 |
| `run` | Run view: stage pipeline plate, error card (provider refusal), event summary, cost KPIs, artifacts ledger, skeleton while refreshing | Main stacked plates; offline banner above | 05 |
| `simple` | Simple workbench (primary) | Start rail agents + chat + gate cards + handoff strip + sticky composer + end panel | 01 |
| `advanced` | Advanced workbench | Lanes rail + task board, event stream with filters, files/diff/terminal panes, terminal dock | 02 |
| `gates` | Gates inbox ledger + selected-gate detail: artifacts, checks, diff, decision bar with notes, device record, stamps | Start rail ledger + detail + sticky decision bar | 04 |
| `artifacts` | Artifact ledger + viewer plate (export/preview/edit per artifact kind) | Start rail ledger + main viewer | 05 (artifacts plate) |
| `providers` / `settings-providers` | Providers ledger: health lamp + latency, keychain badge, probe error with next action; add-provider form with inline validation | Main ledger + form plate | 06 |
| `roles` | Roles routing table as ledger rows (provider/model/weight), edit inline | Main ledger | — (pattern from 06) |
| `budgets` | Budget ledger per project: meter, remaining, set-budget plate | Main ledger + form plate | 05 (KPI pattern) |
| `devices` | Paired devices ledger: online lamp, last seen, QR plate for pairing, revoke | Main ledger + QR plate | — (pattern from 06) |
| `settings` | Preferences plate: language segmented control, theme segmented control (owner choice, no `prefers-color-scheme`), eco mode switch; subscriptions ledger | Two-column plates | 06 |
| `routines` | Routines ledger: schedule (mono), pause/resume, run now | Ledger inside settings tabs | 06 |
| `crash-reports` | Crash ledger: mono ids, copy stack, share | Ledger inside settings tabs | — (pattern) |
| `store-reviews` | Reviews ledger with accessible star graphics (`role="img"` + text score) | Ledger inside settings tabs | — (pattern) |
| `backend-kit` | Backend radiogroup plate + feature checkboxes | Form plate inside settings tabs | — (pattern) |

Screens without a dedicated mock inherit the **ledger/plate/lamp** patterns verbatim; that is the
point of locking one direction.

---

## 6. Component inventory mapped to `@warsha/ui`

Existing primitives (`packages/ui/src/components.tsx`) stay the only styling entry points: `Box`
(logical spacing), `Text` (type scale), `Button` (`primary/secondary/ghost` × `sm/md/lg`), `Card`
(dialog-level surface only). New compounds are added to `@warsha/ui` as **explicit parts with shared
context**, not boolean prop accumulation (per DESIGN_BRIEF §React composition):

| New component | Built from | Notes |
| --- | --- | --- |
| `Lamp` | `Box` | `state: idle/working/waiting/ok/fail`; renders dot + mandatory text child; `working` breathes only under `prefers-reduced-motion: no-preference` |
| `ModeSwitch` | `Button` | Two pressed buttons in a `role="group"` plate; persists per user |
| `StatusStrip` + `StatusStrip.Item` | `Box`, `Text`, `Lamp`, `Meter` | Compound; items declare `hideNarrow` |
| `RailRow` | `Button`, `Lamp`, `Text` | Ledger row; `aria-current` draws the signal edge |
| `Ledger` + `Ledger.Row` | `Box` | Ruled list container |
| `GateCard` | `Card`, `Button`, `Lamp` | Inline approval; actions map 1:1 to gate state machine (`approve / reject(reason) / changes_requested(notes)`) |
| `Stamp` | `Text` | Decision record; `tone: ok/fail` |
| `Meter` | `Box` | Track + fill + numeric readout child; fill tone by threshold, never alone |
| `Chip` | `Button`/`Box` | Filter/stage/meta; `on` = inverted ink; `lit` = signal |
| `DiffView` + `DiffView.Line` | `Box` | Gutter glyph (+/−) **and** tone; horizontal scroll inside, never page scroll |
| `StreamLine` | `Text` | Mono timestamp + event; gate events keep a signal wash |
| `TerminalDock` | `Box`, `Button` | Output `role="log"` + command input with label |
| `Composer` | `Box`, `Button` | Sticky at inline-end edge of the chat column; Enter sends, Shift+Enter newline |
| `Segmented` | `Button` | Language/theme/eco choices; `aria-pressed` |
| `EmptyState` | `Box`, `Text`, `Button` | Ghost nut mark + one next action |
| `Skeleton` | `Box` | Shimmer under no-preference only; paired `role="status"` text |

Composition rules: `GateCard` owns its gate id and exposes `onDecision`; callers own content via
children; no component reads locale strings itself — labels arrive as children or i18n-resolved props
from the screen (keeps `@warsha/ui` catalog-free).

---

## 7. States

Every state appears in at least one mock; behaviour rules are product-wide:

| State | Where demonstrated | Rule |
| --- | --- | --- |
| Loading | 01 thinking dots + PM "writing spec"; 05 artifacts skeleton + `role="status"` text; 06 probe pending dots | Skeletons shimmer only under no-preference; a text alternative is always in the a11y tree; long loads name what is waited for |
| Empty | 03 archive empty state; 02 task board `todo` rows; (existing: projects/providers empties) | One useful next step as a real button, never a dead illustration |
| Error | 06 provider probe 401 with "Update key" primary; 05 provider refusal card naming lane impact and zero cost; 06 invalid key field with `aria-invalid` + `aria-describedby` | Error names problem **and** next action; inline near the field; failed gate RPC keeps the card and shows the error inline |
| Offline | 05 offline banner: last-saved time, auto-reconnect note, Retry now | Banner sits above the bench, `role="status"`; work already queued is never implied lost |
| Permission | 01 gate card; 04 decision bar + supervised chip; device record line | Approval is the lit lamp; decisions record acting device; notes required for reject/changes |
| Success | 06 healthy probe lamp + latency; 04 gate-A stamp; 02 `14 passed ✓`; 05 artifacts ready chip | Success is quiet: lamp + word + mono evidence; no confetti, no modal |

---

## 8. Motion and reduced motion

- Durations/easings come only from motion tokens (`fast 120ms / normal 180ms / slow 240ms`, two
  curves). `tokens.css` already collapses them to `0ms` under `prefers-reduced-motion: reduce`; the
  redesign adds **no** JS motion and **no** component-level media query.
- Permitted motion: lamp breathe (state change), skeleton shimmer (loading), panel/lane disclosure
  translate+opacity on user action, stamp press (transform). All interruptible, transform/opacity only.
- Forbidden: entrance animations on load, parallax, auto-scrolling marquees, animated gradients,
  anything on the instrument strip except lamp state.
- The capture harness runs with `reducedMotion: 'reduce'`, so screenshots show the zero-motion truth.

---

## 9. Accessibility targets (WCAG 2.1 AA)

- **Contrast** (measured pairs, both themes): `text/bg` 17.0/17.7; `text-muted/surface` 4.83/7.11;
  `accent-ink/accent` 13.67. Fixes mandated by AUDIT-1: focus ring uses `--warsha-color-accent-strong`
  on light (5.03:1 vs `bg`) and `--warsha-color-accent` on dark — never bare accent on light
  (1.35:1 fail); `--warsha-color-muted` is **demoted to non-text use only** (rules, lamp idle,
  placeholder-adjacent glyphs) — body/label text uses `text-muted` at worst.
- **Focus**: single global `:focus-visible` = 2px solid `--warsha-focus-ring` + 2px offset; sticky
  composer and decision bars reserve padding so a focused element is never obscured; dialogs
  (Handoff, new-project, pair-device) gain focus trap + Escape + focus restore (AUDIT-1 §4.2 gap).
- **Keyboard**: every interaction reachable; deprecated `onKeyPress` replaced by `onKeyDown`
  (Enter/Escape); tablists use roving tabindex; terminal input is a labelled field, not a raw trap.
- **Targets**: 44×44 CSS px minimum for all interactive elements (`Button md`, `RailRow`, `chip`
  buttons and `btn sm` grow to 44 under `pointer: coarse`); 8px separation via ledger padding.
- **Not colour alone**: lamp + word + glyph everywhere (✓/✗//☑//☐ in mono), diff gutter glyphs,
  stamps with text, meters with numeric readouts.
- **RTL**: full mirroring via logical properties only (`padding-inline`, `margin-inline`,
  `inset-inline-start`, `border-inline-start`, `border-start-*`); verified in screenshots, not assumed.
- **Live regions**: event stream `aria-live="polite"` batched; deploy/handoff status keep existing
  `role="status"`/`role="alert"`; loading skeletons announce via `role="status"` text.

---

## 10. Breakpoints

| Width | Bench behaviour |
| --- | --- |
| 320 | Single column; rails become horizontal strips; ledger rows collapse to two lines (name+state / meta); decision bars stack actions full-width |
| 390 | Primary phone target: agent strip, sticky composer, instrument strip reduced (daemon + budget), tabs scroll horizontally |
| 768 | Two columns where a rail exists (rail 224px); forms go side-by-side; topbar stops wrapping |
| 1024 | Full bench: start rail 264px; Simple gains end panel 300px; Advanced splits stream/panes |
| 1440 | Reference desktop: content max-width 1100px for ledgers/forms (prose measure), workbench columns fluid between rails |

Overflow gate: `capture.mjs` asserts `documentElement.scrollWidth ≤ innerWidth` at 390 and 1440 for
all 48 combinations; current run reports clean.

---

## 11. Arabic typography, numerals, mixed direction

- Family: `--warsha-font-sans` (IBM Plex Sans Arabic first) for UI and prose; `--warsha-font-mono`
  (IBM Plex Mono) for machine data. Two families, clear roles, no third.
- Line height: RTL body text uses `--warsha-line-height-relaxed` (1.75); LTR body 1.5; headings
  `snug` (1.35) both directions (mock CSS enforces via `html[dir='rtl'] body`).
- Measure: prose capped at 68ch (`msg .bubble`), ledgers truncate with `title`/detail view for the
  full value; long Arabic strings tested (gate summaries, provider errors).
- Numerals: **Western Arabic digits (0–9) with `font-variant-numeric: tabular-nums`** for all machine
  data (costs, timestamps, counts, percentages) in both locales — comparisons must align; dates and
  relative times formatted via `Intl` with the active locale. Arabic-Indic digits are used only where
  a human count reads as prose (e.g. "المبرمج ٢" lane nickname), never in tables.
- Mixed direction: identifiers (`prj_9f3a`, `spec.md`, `cargo test`, endpoints) carry `translate="no"`
  and mono; run names are **locale-shaped** (AR `أطلس-7b1c` / EN `atlas-7b1c`) so bidi never scrambles
  a mono line — mock 03 demonstrates the failure and the fix; embedded LTR fragments sit in isolated
  spans, never bare in an Arabic sentence.
- Scale: xs 12 / sm 14 / md 16 / lg 18 / xl 20 / 2xl 24 / 3xl 30 from tokens; Arabic headings use
  `bold` (700), labels `medium` (500); letter-spacing only on xs uppercase-style rail heads in EN.

---

## 12. Token strategy

- **Raw colour literals live only in `packages/ui/src/tokens/`** (rule R6, enforced by
  `tokenDrift.test.ts`). The mock layer repeats the token block verbatim in `warsha-mock.css`
  (`:root`/`[data-theme='dark']`) so mockups exercise the real values without touching product code.
- The redesign introduces **semantic aliases, no new raw colours**:

| Alias | Resolves to | Meaning |
| --- | --- | --- |
| `--warsha-signal` / `-ink` / `-text` | `accent` / `accent-ink` / `accent-strong` | the lamp: needs the owner's hand; `-text` is the AA-safe yellow-as-text per theme |
| `--warsha-bench-plate` | `surface-muted` | recessed rails, instrument beds, terminal dock |
| `--warsha-bench-rule` | `border` | hairline fasteners between plates |
| `--warsha-bench-edge` | `border-strong` | structural edges, meter tracks, control borders |
| `--warsha-lamp-idle/working/waiting/ok/fail` | `muted` / `accent-strong`(light)·`accent`(dark) / `accent` / `success` / `error` | the four+1 agent/run states |
| `--warsha-diff-add-bg` | `surface-muted` | added-line wash (glyph carries meaning) |
| `--warsha-focus-ring` | `accent-strong`(light) / `accent`(dark) | the AUDIT-1 focus fix |

- Spacing/radius/type/shadow/motion: existing scales only; new components may not invent steps.
- Implementation batches must extend `tokens.css` + the TS token modules together (drift test) and
  keep `color-scheme` per theme; **no `prefers-color-scheme` query** (owner choice, per tokens.css).

---

## 13. i18n mapping for the mocks

Mock literals are demo content but every string maps to a catalog key (existing) or a proposed key
(new). Screens must resolve via `t()`; the mocks carry `data-i18n` attributes as the mapping record.

Existing keys used (sample): `app.name`, `app.brand`, `app.simpleMode`*, `app.advancedMode`*,
`gate.approve/reject/request_changes`, `gates.*`, `run.*`, `projects.*`, `providers.*`,
`onboarding.provider_hint.*`, `onboarding.key_hint`, `settings.routines`, `nav.*`, `common.*`.
(`*` = present in the app fallbacks per AUDIT-1 §3.3; the redesign removes the `|| 'literal'`
fallbacks and relies on the catalog.)

Proposed new keys (for the implementation batch, ar+en together):
`simple.handoffs_title`, `simple.owner`, `simple.thinking`, `advanced.filter_all/tools/errors/costs/gates`,
`advanced.lane_cost`, `bench.daemon_online`, `bench.daemon_offline`, `bench.budget_used`,
`bench.stage_label`, `gate.device_record`, `settings.theme`, `settings.theme_light/dark/auto`,
`settings.eco`, `archive.title`, `archive.empty_title`, `archive.empty_desc`, `errors.provider_unauthorized`,
`errors.provider_unauthorized_hint`, `run.stop`, `routine.pause/resume/run_now`.

Rule restated: **no hard-coded product strings** — the 391 Arabic literals and 198 fallback sites
counted in AUDIT-1 are migration work for the implementation batches, tracked against this document's
screen map.

---

## 14. Verification performed (B1)

- `node bridge-io/mock/capture.mjs` → 48 PNGs in `bridge-io/shots/redesign/`
  (`<mock>-<1440x900|390x844>-<ar|en>-<light|dark>.png`), Playwright + host Chrome
  (`C:/Program Files/Google/Chrome/Application/chrome.exe`), `deviceScaleFactor 1`,
  `reducedMotion: 'reduce'`, locales `ar-EG` / `en-US`.
- Overflow gate: `scrollWidth ≤ innerWidth` asserted per combination; final run clean at 390 and 1440.
- Visual critique performed on: 01 ar-dark 1440, 01 en-light 390, 02 en-dark 1440, 03 en-light 1440,
  04 ar-light 1440, 05 ar-dark 390, 06 en-dark 390 — mirroring, lamp semantics, stamps, diff gutters,
  sticky composer and narrow disclosure all confirmed in pixels.
- Capture-host caveats (reported, not hidden): the Playwright-managed Chromium on this host is
  incomplete (`chromium-1148/chrome-win/` ships `chrome.dll` without `chrome.exe`), so the harness
  pins the installed stable Chrome; `IBM Plex Sans Arabic` is not installed on the capture host, so
  screenshots render through the token stack's fallbacks (Segoe UI/Noto) — shaping and mirroring are
  therefore verified, final font metrics are not.

---

## 15. Implementation handoff checklist

1. Extend tokens (aliases table §12) with drift-test coverage; fix focus ring + demote `muted` (§9).
2. Build `@warsha/ui` compounds (§6) token-only, catalog-free, logical-property-only.
3. Migrate screens in §5 order: `simple`, `gates`, `advanced`, `run`, `projects`, settings family;
   delete every `t(...) || 'literal'` and `locale === 'ar' ? … : …` site touched (AUDIT-1 §3.3).
4. Add dialog focus trap/Escape/restore; replace `onKeyPress`; roving tabindex on tablists.
5. Re-run the visual suite at ar/en × light/dark × 320/390/768/1024/1440 with the overflow gate;
   compare against `bridge-io/shots/redesign/` as the direction reference, not as baselines.
