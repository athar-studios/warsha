# Warsha Design System v3 — «حِرفة» (Hirfa)

Status: **spec, approved by the owner before any implementation** (run `2026-11-09-ui-v3`, `OWNER_DECISIONS.md`
OD-U0). Planner: Claude Opus 5.5, 2026-11-09. Companion documents: `docs/designs/UI_V3_PLAN.md` (every page and
every action), `docs/designs/v3-preview.html` (static visual reference, not product code).

**This is a clean slate.** It does not extend DESIGN_SYSTEM_V2 ("Bench & Signal"). The v2 tokens, compounds and
screens stay untouched while v3 is built beside them, and are deleted at cutover (packet U8). Nothing in v3 aliases
a v2 name.

---

## 0. Why a new system

The owner's verdict on the shipped UI (2026-11-09, screenshot of Simple mode): *Simple mode is not simple, and in
Advanced mode the options do nothing when clicked.* The audit agrees:

- Simple mode puts **≈40 interactive elements** on the first screen: a 12-role team rail, seven workflow presets
  named in English jargon (`fleet-worktrees`, `graph-gated`…), four hard-coded model pills that are not the owner's
  configured models, four budget pills, a launch button, a nine-stage strip, an activity panel and a **second**
  composer with its own model picker. Two ways to start, two model selectors, no clear first step.
- Several controls change state that never reaches the daemon or render hard-coded lists (see `UI_V3_PLAN.md` §1).
- The project is labelled with a raw UUID; three "not reported yet" items fill the status strip; the accent yellow
  fills every selected pill, so nothing reads as *the* action.

v3 answers with five rules that every component and page must obey.

## 1. Principles (binding)

1. **One screen, one question.** Every page answers one question ("what do we build?", "what does this project need
   from me?", "what is the team doing?"). Anything that does not serve it moves to Advanced or Settings.
2. **Every control works — or does not exist.** A control is rendered only when its action is registered, wired to a
   real effect (RPC, navigation or visible state) and its capability is available. No placeholder buttons, no
   hard-coded model or workflow lists, no "coming soon". (Machine-checked: `actions-gate.mjs`, §7.)
3. **Plain Arabic first.** Simple mode speaks the owner's language: no English UI words, no internal names
   (harness, stage ids, role ids). Technical names appear only in Advanced mode, and as data (model ids, URLs, code).
4. **Calm until you are needed.** One primary colour for the one main action and the current selection. The
   attention colour (amber) means exactly one thing: *something is waiting for your decision*.
5. **Same data, more detail.** Advanced is not a second app. It shows the same project with more panels, denser
   rows and every knob. Switching modes never loses context.

## 2. Foundations

### 2.1 Colour — semantic tokens (CSS `--w-*`, TS `color.*`)

Values measured with `bridge-io/policy/2026-11-09-ui-v3/tools/contrast.mjs` (WCAG 2.x relative luminance);
**all 48 pairs pass** (text ≥ 4.5:1, UI boundaries and focus ≥ 3:1).

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `bg` | `#F6F4EF` | `#131210` | app background (warm paper / warm night) |
| `surface` | `#FFFFFF` | `#1B1A17` | cards, panels, inputs |
| `sunken` | `#EFECE5` | `#24221E` | wells, code, table stripes, hover on surface |
| `line` | `#E2DDD3` | `#33302A` | dividers, card borders (decorative) |
| `line-strong` | `#8C877C` | `#7D776C` | input borders, control outlines (≥ 3:1) |
| `text` | `#1B1A17` | `#F1EEE7` | body and headings (15.8 / 16.2 : 1 on bg) |
| `text-muted` | `#5F5B53` | `#B3AEA3` | secondary text (6.2 / 8.5 : 1 on bg) |
| `text-faint` | `#7A756B` | `#948F84` | placeholders, meta (≥ 4.5 on surface) |
| `primary` | `#0B6E5A` | `#3DBE9C` | the one main action, selection, links' underline |
| `primary-hover` | `#095C4B` | `#56CFAE` | hover/pressed of `primary` |
| `on-primary` | `#FFFFFF` | `#062A21` | text on `primary` (6.2 / 6.7 : 1) |
| `primary-soft` | `#E1F1EC` | `#163A31` | selected row/chip background |
| `primary-text` | `#0A5E4D` | `#5FD3B2` | links and selected text on any surface |
| `attention` | `#8A5300` | `#F3B54A` | **waiting on the owner** — text/icon |
| `attention-soft` | `#FFF1D6` | `#3A2B10` | decision cards, inbox badge background |
| `success` / `success-soft` | `#1B6B39` / `#E4F3E8` | `#5CC98A` / `#15301F` | done, passed |
| `danger` / `danger-soft` | `#A8261D` / `#FCE9E7` | `#F07A70` / `#3A1714` | failed, destructive |
| `info` / `info-soft` | `#1F55A0` / `#E7EFFA` | `#7DB0F5` / `#152842` | running, neutral notices |
| `focus` | `#0B6E5A` | `#5FD3B2` | focus ring (≥ 5.6 : 1 on bg) |
| `scrim` | `#1B1A1766` | `#000000A3` | behind dialogs and sheets |

Rules:
- **One `primary` button per view.** Secondary actions use `secondary` or `ghost` buttons. A composer's send button
  is `primary` only where the composer *is* the page's main action (Home); elsewhere (the Project dock, the
  Workbench) it is `secondary`, so a pending decision's «موافق» stays the only primary. `Button` renders
  `data-variant` so this is testable.
- **`attention` is reserved** for gates and anything that blocks on the owner. Running work is `info`, never amber.
- **Never colour alone**: every status has an icon and a word.
- The brand yellow hexagon (`#FFD400`) appears **only in the logo mark**, never as a UI fill.
- Themes: `light`, `dark`, `system` (default). No accent picker.

### 2.2 Typography

- **UI family: IBM Plex Sans Arabic** (OFL-1.1; covers Arabic and Latin) — weights 400, 500, 600, 700.
  **Code/IDs: IBM Plex Mono** 400, 500. Both are vendored as `woff2` in `packages/ui/src/v3/fonts/` with `@font-face`
  (`local()` first, `font-display: swap`); the Google Fonts links leave both `index.html` files (offline Tauri app;
  matches the Linux capture host's pinned Plex). `THIRD_PARTY_NOTICES.md` gets the OFL row.
- Scale (size / line-height, px):

| Token | Size / LH | Weight | Use |
| --- | --- | --- | --- |
| `text-xs` | 12 / 18 | 500 | meta, badges |
| `text-sm` | 14 / 22 | 400 | secondary text, dense tables (Advanced) |
| `text-md` | 16 / 26 | 400 | body (Simple default) |
| `text-lg` | 18 / 28 | 500 | card titles, composer input |
| `text-xl` | 22 / 32 | 600 | page section titles |
| `text-2xl` | 28 / 40 | 700 | page titles |
| `text-3xl` | 36 / 48 | 700 | Home greeting only |

- Arabic body line-height is never below 1.6. No letter-spacing on Arabic. Mono gets `tracking-code` 0.01em only.
- **Digits:** Western digits (0–9) for money, counts, versions and IDs in both languages (matches code, logs and
  provider dashboards). Dates via `Intl.DateTimeFormat(locale, { numberingSystem: 'latn' })`.

### 2.3 Space, size, radius

- Space (4-based): `space-1` 4 · `2` 8 · `3` 12 · `4` 16 · `5` 20 · `6` 24 · `7` 32 · `8` 40 · `9` 48 · `10` 64.
- Radius: `radius-sm` 6 (inputs, buttons) · `radius-md` 10 (cards) · `radius-lg` 14 (sheets, dialogs) ·
  `radius-xl` 20 (Home composer) · `radius-full` (pills, avatars).
- Control height by density: **comfortable** (Simple) 44 · **compact** (Advanced) 32. Minimum target 24 × 24 (WCAG 2.2),
  44 × 44 in comfortable.
- Content widths: `content-narrow` 720 (Simple pages) · `content` 1120 · `content-wide` 1440 (Workbench) ·
  `nav-width` 264 · `rail-width` 300.
- Breakpoints: `sm` 640 · `md` 960 · `lg` 1280 · `xl` 1600. Below `md` every two-column layout stacks.

### 2.4 Elevation, layers, motion

- Shadows: `shadow-1` (cards on hover, menus) · `shadow-2` (popovers) · `shadow-overlay` (dialogs, sheets). Flat by
  default: cards use `line`, not shadow.
- Layers (z-index tokens): `base` 0 · `sticky` 10 · `dropdown` 100 · `overlay` 900 · `modal` 1000 · `toast` 1100.
- Motion: `dur-fast` 120ms (hover, press) · `dur` 200ms (open/close) · `dur-slow` 320ms (sheet) ·
  `ease` `cubic-bezier(.2,.8,.2,1)`. `prefers-reduced-motion: reduce` sets every duration to 0. Progress uses a
  determinate bar or a static stepper — no infinite spinners longer than 10 s without text.

### 2.5 Icons

An in-house set of 24 px, 1.75 stroke, rounded-join SVG icons in `packages/ui/src/v3/icons/` (no new dependency):
`home, inbox, settings, plus, send, stop, pause, play, check, x, alert, info, clock, sparkle, user, users, cpu,
folder, file, code, diff, terminal, eye, link, external, copy, search, filter, chevron, arrow, more, sun, moon,
globe, key, plug, calendar, wallet, phone, refresh, trash, edit, download, upload, lock, git-branch`.
Directional icons (`chevron`, `arrow`, `send`, `external`) mirror in RTL via `[dir=rtl] .w-icon--mirror`.

### 2.6 RTL and BiDi

- Logical properties only (`margin-inline-start`, `inset-inline-end`, `border-start-start-radius`…); the R-lint
  bans `left/right/margin-left/padding-right/text-align: left` in `packages/ui/src/v3` and `apps/*/src/v3`.
- User-typed text: `dir="auto"`. IDs, model ids, URLs, file paths, code, money with `$`: wrapped in `<bdi>` or
  `.w-ltr` (`direction: ltr; unicode-bidi: isolate`).
- Layout mirrors fully: in Arabic the navigation rail sits on the right, the primary button sits at the inline-end
  of a button row (left in RTL), progress runs right→left.

## 3. Components (`packages/ui/src/v3/`, exported as `@warsha/ui/v3`)

Every component: typed props (no `any`), forwards `data-action`, `data-testid`, `aria-*` to its DOM root; renders
all states below; has a story and a test file; uses tokens only (no hex, no px literal outside `tokens/`).

### 3.1 Primitives

| Component | Variants / props | States & a11y |
| --- | --- | --- |
| `Button` | `primary`, `secondary`, `ghost`, `danger`; `size` sm/md/lg; `icon`, `iconEnd`; `loading` | hover, active, focus-visible ring, disabled (`aria-disabled` + reason tooltip), loading (spinner + keeps width, `aria-busy`) |
| `IconButton` | same variants; **`label` required** (becomes `aria-label` + tooltip) | as Button |
| `Link` | inline / standalone; `external` adds icon + `rel` | visited not styled |
| `TextField` | label (required, visible), hint, error, prefix/suffix (e.g. `$`), `type` | error has `aria-invalid` + message id |
| `TextArea` | autosize (min/max rows), counter optional | Enter submits only where the owner of the field says so |
| `Select` | native-backed, label required | keyboard native |
| `Combobox` | async options, search, empty/loading/error rows | `role=combobox`, listbox, active descendant |
| `Checkbox`, `Radio`, `Switch` | label required | `Switch` uses `role=switch` |
| `Segmented` | 2–4 options, single choice | `role=radiogroup`, arrows move, Space selects |
| `Tabs` | `line` (Workbench), `pill` (filters) | roving tabindex, arrows, Home/End, `aria-controls` |
| `Tooltip` | text only | on hover + focus, 400ms delay, Esc closes |
| `Badge` | neutral / count | count caps at `99+` |
| `StatusPill` | `idle`, `running`, `waiting` (attention), `done`, `failed`, `paused` | icon + word, never colour alone |
| `RoleMark` | 12 agent roles, Arabic name + icon | decorative icon `aria-hidden` |
| `Spinner`, `Skeleton`, `ProgressBar` | — | `role=progressbar` with value when known |
| `Kbd`, `Divider`, `VisuallyHidden` | — | — |

### 3.2 Composites

| Component | Purpose | Contract |
| --- | --- | --- |
| `AppFrame` | top bar + optional side nav + main | landmarks: `header`, `nav`, `main`; skip link first |
| `TopBar` | logo, project switcher, mode switch, inbox, settings | inbox shows count badge in `attention` |
| `ProjectSwitcher` | name + status, search, "new project" | never shows a raw UUID (falls back to «مشروع بلا اسم») |
| `SideNav` | sections with icons, active state | `aria-current="page"` |
| `Card`, `ListRow` | content containers | clickable card = one `<a>`/button, no nested buttons |
| `EmptyState` | icon, one sentence, one action | every list has one |
| `Banner` | info / success / attention / danger; optional action | `role=status` or `alert` (danger) |
| `Toast` | transient result of an action | auto-dismiss 5s except errors; "retry" for failed RPCs |
| `Dialog`, `Sheet` | confirmation; side panel | focus trap, Esc, return focus, `layer-modal`, scrim |
| `Menu` | overflow actions | `role=menu`, arrows, typeahead |
| `Stepper` | the 5 plain stages (Simple) / 14 detailed (Advanced) | current = `primary`, waiting = `attention`, done = `success`, failed = `danger` |
| `DecisionCard` | a gate: question, plain rationale, consequences, Approve / Request changes / Reject | the only amber card; Request changes opens a required text field |
| `Composer` | `simple` (textarea + one send) / `advanced` (+ workflow, model, budget, mode, mentions, slash) | Enter sends, Shift+Enter new line; disabled + reason when no provider |
| `ModelPicker` | **data-driven** from configured models/routing; shows provider in Arabic, id as LTR data | no hard-coded list; empty → "add a model" action |
| `BudgetField` | presets come from settings, custom amount | `$` prefix isolated LTR |
| `ActivityFeed` | event stream in plain sentences (Simple) or raw (Advanced) | live region polite, grouped by stage |
| `PreviewCard` | start/stop/open live preview | only when `preview.*` is available |
| `CodeView`, `DiffView`, `Transcript` | read-only code, diff, terminal transcript | mono, LTR, line numbers, copy |
| `DataTable` | sortable dense table (Advanced, settings) | header `scope`, row actions in a `Menu` |
| `SettingsSection` | title, description, scope sentence, content | one per settings page section |
| `CopyField`, `KeyValue`, `QrCode` (pairing) | — | copy gives a toast |

## 4. Patterns

### 4.1 The action contract (how "every control works" is enforced)
- Every interactive element carries `data-action="<page>.<verb>"` (e.g. `home.start`, `project.gate.approve`).
- Every id is registered once in `apps/desktop/src/v3/actions/registry.ts`:
  `{ id, labelKey, effect: 'rpc' | 'nav' | 'state', rpc?: string[], route?: string, capability?: string }`.
- RPC actions run through `useAction(id)` → `{ run, pending, error }`: the button shows `loading`, a failure shows a
  `Toast` with the daemon's message (secret-redacted) and a retry. No `() => {}`, no `console.log` handlers.
- `capability` comes from the daemon (`health` + the method table); a control whose capability is missing is **not
  rendered** (and its page explains what to set up, e.g. "add a provider first").
- Every registered id has at least one e2e case in `apps/desktop/e2e/v3/` that clicks it and asserts its effect
  (RPC recorded by the harness, route reached, or visible state).

### 4.2 Data views
Every data view renders exactly one of: `loading` (skeleton shaped like the content) · `empty` (EmptyState with the
next action) · `error` (Banner with retry) · `ready`. No view shows "not reported yet" filler.

### 4.3 Plain language map (Simple mode)
The daemon's detailed stages fold into **five** owner-facing stages: **الفكرة → الخطة → البناء → الفحص → التسليم**
(mapping table in `UI_V3_PLAN.md` §4). Gates are «قرار ينتظرك», never "Gate B".

### 4.4 Copy
Arabic: short, direct, second person, verbs first («ابدأ»، «وافِق»، «اطلب تعديلًا»). One idea per sentence. Numbers
in Western digits. English UI: sentence case, same meaning. Both catalogs carry the same keys; Arabic values contain no
Latin words except proper data and the allow-list (`MCP`, `API`, `GitHub`, `URL`, `JSON`).

### 4.5 Destructive and costly actions
Delete, cancel run, reject gate, remove provider, revoke device → `Dialog` that names the object and the consequence.
Starting a run shows the budget limit in the button's helper text.

## 5. Density and modes
`data-density="comfortable"` (Simple) / `"compact"` (Advanced) on `AppFrame` switches control heights, row padding
and `text-md`→`text-sm` for tables. The mode switch changes density and reveals panels; routes are shared.

## 6. Accessibility
WCAG 2.2 AA. Focus ring 2px `focus` + 2px offset on every focusable element. Landmarks and a skip link on every page.
Arabic accessible names. Axe-clean on every page in both languages and themes (e2e). Keyboard path for every action.

## 7. Delivery and verification
- Tokens: `packages/ui/src/v3/tokens/*.ts` → `tokens.css` (`--w-*`), both themes, parity test TS↔CSS.
- `contrast.test.ts` asserts every pair of §2.1 at the listed minimum (copy of the planner's table).
- Lint (`scripts/check-ds-v3.mjs`): no hex colour, no px/rem literal, no physical direction property outside
  `packages/ui/src/v3/tokens/`; no import of v2 DS from v3 code.
- Planner-owned gates (`bridge-io/policy/2026-11-09-ui-v3/tools/`): `actions-gate.mjs` (no unregistered interactive
  element, no unused id, every RPC exists in client and daemon, every id covered by e2e), `i18n-gate.mjs` (ar/en key
  parity, no Latin words in Arabic values), `contrast.mjs`, `pw-gate.mjs` (fenced visual baselines).
- A dev-only gallery route `#/ds` renders every component in every state; it is the visual baseline of the system.

## 8. What v3 deliberately drops
Accent picker; the seven English workflow presets and four model pills in Simple mode; the 12-role rail on the home
screen (Advanced → «الفريق» tab); the status strip of "not reported yet"; raw UUIDs as labels; a second composer on
the same screen; v2's `Bench & Signal` metaphors (lamps, stamps, quiet bands).
