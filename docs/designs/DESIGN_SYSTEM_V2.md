# Warsha Design System v2 — Bench & Signal, completed · نظام التصميم v2

Status: **Draft for implementation** (run `2026-11-08-design-and-remediation`, planner phase). It
extends the locked direction in [`../design/REDESIGN.md`](../design/REDESIGN.md) (B1, 2026-11-02),
which stays canonical for the *direction*. This document is canonical for the **contracts**: the
token vocabulary, the R6 rules that police it, the primitive and compound APIs, the screen
architecture, and the order in which the apps adopt all of it.

Packets that implement it: **W3** (`packages/ui`), **W5** (`apps/desktop`, `apps/remote`,
`packages/i18n`). W1/W2 only document it. Measured baselines and the packet DAG live in `PLAN.md`
("Run 2026-11-08") and `bridge-io/policy/2026-11-08-design-and-remediation/state.json`.

---

## 0. Overview, problem, goals

**Overview.** Warsha (ورشة, *workshop*) is an Arabic-first supervisor's bench for AI software work:
an owner watches a team of agents move a run through gates and puts their hand on the work only when
a lamp lights. B1 locked that direction and M20's batches built it: 14 colours, 14 aliases, 21 sizes,
4 primitives, 23 compounds, R6, 25 story files, both apps on `var(--warsha-*)`.

**Problem.** The system is ~85% closed and the last 15% is where it leaks:

| Gap | Evidence (`f7b8583`) |
| --- | --- |
| No scrim, no status tints | `HandoffDialog.tsx:187` mixes `muted` 55%, `GateBell.tsx:166` mixes `bg` 55% — two scrims; pills fake tints with `surface-muted` |
| ~170 raw lengths left in the apps, none policed | ~75 `1px solid var(--warsha-bench-*)` borders, 11 `3px` edges, ~20 distinct layout widths, `calc(100vh - 80px)` ×8, and both `index.css` files (R6 never reads `.css`) |
| R6 blind spots | `compounds/internal.ts` unscanned (its header says otherwise); `:root :focus-visible` passes the raw-colour block check; unitless `zIndex`/`fontWeight` invisible |
| Three compounds break the package rules | `ModelPicker`, `SettingsScopeSentence` hard-code English, paint `accent` where nothing waits on the owner, use story title `Compounds/…`; `ModelPicker` listens on `document` and drops focus on close; none of the three has a test |
| The type story is untrue at runtime | No app loads IBM Plex: both `index.html` load Noto Sans Arabic + Inter from Google Fonts; Plex renders only where installed (the CI capture host installs it) |
| Settings have no shared frame | `App.tsx:656` `settingsScreen()` wraps 9 of 11 settings screens; `Budgets`/`Devices` are standalone; every screen builds its own root |

**Goals.** (G1) One vocabulary for every length, line, layer and surface the apps draw. (G2) R6
proves it, with a ratchet the apps can be driven to zero against. (G3) Every compound has a written
contract, a story and a test. (G4) All of it lands **pixel-neutral**: the 793 desktop + 91 remote
Playwright cases stay green with zero snapshot writes (§9).

**Non-goals.** New colours beyond the five derived ones in §4.2; a third typeface; motion beyond §8
of REDESIGN; theming beyond light/dark owner choice; any change a screenshot can see in this run
(that is Phase B, §9).

**CUJs.** (1) The owner opens Simple mode at 390px in Arabic, sees one lit lamp, approves a gate in
two taps. (2) A reviewing developer opens Advanced mode at 1440px in English dark, filters the stream
to gates, opens a diff. (3) A contributor adds a settings row and cannot ship a raw `16px`, a hex, or
an English string without a red test.

---

## 1. Direction — Bench & Signal, elevated

### 1.1 Design plan (the compact token system)

**Palette** — six named values; everything else is derived or neutral:

| Name | Value | Role |
| --- | --- | --- |
| Signal | `#FFD60A` | the lamp — lit only when the owner's hand is needed |
| Night plate / Signal ink | `#0E0E0E` | dark-theme ground; the ink on a lit lamp (13.67:1) |
| Gold-as-text | `#8A6A00` | the signal as foreground or mark on the day plate (5.03:1 on `#FAFAFA`) |
| Day plate | `#FAFAFA` (bg) / `#FFFFFF` (surface) | light-theme ground and raised plate |
| Recess | `#F3F4F6` light · `#1F1F1F` dark | rails, instrument beds, terminal dock |
| Machine grey | `#4B5563` light · `#A3A3A3` dark | secondary text, never below 4.5:1 |

**Type** — two families, two jobs, no third:

- **IBM Plex Sans Arabic** (`--warsha-font-sans`): who speaks — prose, labels, buttons, Arabic and
  English alike. `letter-spacing: normal` always (Arabic is a joined script; tracking breaks it).
- **IBM Plex Mono** (`--warsha-font-mono`, `tabular-nums`): what the machines did — ids, costs,
  tokens, timestamps, paths, diffs, terminal lines. Always `dir="ltr" translate="no"
  unicode-bidi: isolate`.

**Layout concept** — a ruled bench, inline-start rail, one work column, an end panel only where
Simple mode earns it. Content aligns to the inline-start edge in both directions; nothing centres
except the onboarding column and empty states.

```
1440 · Simple (RTL shown; LTR is the exact mirror)
┌────────────────────────────────────────────────────────────────────────────┐
│ ⬡ ورشة   prj_9f3a        [بسيط ●──○ متقدم]          🔔 1   ⚙            │ topbar 56
├────────────────────────────────────────────────────────────────────────────┤
│ ● daemon   run 01M6…  stage Code   3 active      ▓▓▓▓░░ $4.10 / $10      │ strip 36 (recess)
├──────────────┬─────────────────────────────────────────────┬───────────────┤
│ end panel 300│ work column (prose ≤ 68ch)                  │ rail 264      │
│ team summary │ ┌ mission brief ─────────────────────────┐  │ ▌● المنسق     │ ← 3px signal edge
│ activity     │ │ harness · model · budget pills         │  │  ○ المبرمج ٢   │   on aria-current
│ artifacts    │ └────────────────────────────────────────┘  │  ○ المراجع     │
│ receipt      │ pipeline ─●─●─●─◉─○─○─○─○─○ (9 stages)      │               │
│              │ ┌ GATE B ▬▬▬▬ (lift shadow, signal band) ┐  │               │
│              │ │ rationale · safety line · ✓ ✗ ✎        │  │               │
│              │ └────────────────────────────────────────┘  │               │
│              │ [ composer — sticky at block-end ]          │               │
└──────────────┴─────────────────────────────────────────────┴───────────────┘

390 · Simple
┌───────────────────────────┐
│ ⬡ ورشة  [بسيط●○]  🔔1  ⚙ │
│ ● daemon   ▓▓▓░ $4.10     │  strip reduced to daemon + budget
│ ◀ ●المنسق ○المبرمج ○…  ▶ │  rail → horizontal agent strip
│ GATE B … ✓ ✗ ✎ (stacked)  │
│ transcript …              │
│ [ composer ]              │  sticky, 44px targets
└───────────────────────────┘
```

**Principles.**

1. **A lit lamp is a queue item.** Yellow appears only where the owner must act: pending gates, the
   waiting lane, the screen's one primary action. Never decoration, never a wash except
   `signal-wash` on gate lines and the current stage.
2. **Plates, not cards.** Surfaces are separated by 1px rules and two recess levels. One shadow
   (`elevation-lift`) exists, for the gate card and dialogs — the two things allowed to interrupt.
3. **Decisions leave stamps.** Approve/reject is a pressed-metal stamp (2px `currentColor`
   inscribe, −2° rotation mirrored per direction) with a word — a physical record, never colour alone.
4. **Night shift, not inversion.** Dark is independently tuned; `signal-text`, `lamp-working` and
   `focus-ring` are the only aliases that change target between themes.
5. **Machines speak mono, people speak sans.** The split is semantic and enforced by
   `machineSkin()` (§2).

### 1.2 Review against generic defaults

The brief pins a near-black plate with a single bright accent, hairline rules, and mono for machine
labels — three traits that also appear in templated UI. They stay because each is load-bearing for
*this* subject, and the generic versions are explicitly refused:

| Generic default | Why it stays / what is refused |
| --- | --- |
| Near-black + one acid accent | Stays: the accent is a **lamp with a state machine** (idle/working/waiting/ok/fail), not a brand splash. Refused: the light theme is the **day shift** and the default, and on it the signal becomes gold-as-text `#8A6A00` — no acid-on-white. |
| Hairline broadsheet rules | Stays: rules are **fasteners** between plates on a workbench. Refused: no dense newspaper columns — one work column capped at 68ch. |
| Mono small labels | Stays only for machine data. Refused: no mono eyebrows, no tracked ALL-CAPS labels (the single tracking token is for pairing codes, §2.3), no `A · B · C` meta strings in new UI, no `→` appended to buttons. |
| SaaS card kit | Refused outright: no rounded-card grids, one radius per hierarchy level (`sm/md` plates, `xl` dialogs), no gradients. |

What makes Warsha recognisable is the **lamp-as-queue rule + the stamp + the hex-nut mark**, spent in
one place each; everything around them is quiet.

---

## 2. Bilingual craft and BiDi

### 2.1 The sans/mono split (code, not convention)

`packages/ui/src/compounds/internal.ts` owns it:

- `slotText(node)` — flattens a React slot to the text that will render.
- `carriesJoinedScript(node)` — true when the slot contains Arabic code points.
- `machineSkin(node)` / `machineSkinSmall(node)` — returns `MACHINE` (mono + `tabular-nums`), **or**
  sans + `tabular-nums` + `letterSpacing: 'normal'` when the slot holds Arabic. A machine-data slot
  that happens to carry an Arabic run name never renders in a Latin mono face.

Rule: every compound slot typed as machine data (`Stream.Line time`, `Ledger.Row meta`,
`StatusStrip.Item machine`, `Meter` readout, `Chip` meta) goes through `machineSkin`. App code that
renders machine data outside a compound uses `<Text translate="no" dir="ltr">` + `var(--warsha-font-mono)`.

### 2.2 Isolation

Identifiers (`prj_9f3a`, `spec.md`, `cargo test`, URLs, hex, amounts) carry `dir="ltr"
translate="no"` and `unicode-bidi: isolate` and are never bare inside an Arabic sentence. Run names
are locale-shaped (AR `أطلس-7b1c`, EN `atlas-7b1c`).

### 2.3 Numerals, line height, measure, tracking

- Western digits + `tabular-nums` for all machine data in both locales; dates/relative times through
  `Intl` with the active locale; Arabic-Indic digits only where a count reads as prose.
- Line height: RTL body `relaxed` (1.75), LTR body `base` (1.5), headings `snug` (1.35).
- Prose measure: `--warsha-size-measure` (68ch).
- Tracking: **one** token, `--warsha-tracking-code: 0.2em`, for mono pairing/verification codes only
  (today `Devices.tsx:495`). Never on sans, never on Arabic. `tokens.test.ts`'s "no tracking token"
  assertion becomes "exactly one tracking token, `code`" (W3).

### 2.4 Receipt honesty

The Simple-mode verification receipt shows `verificationSeal` — FNV-1a over `runId:projectId`, a
**bench-local integrity mark**, not a signature (`DECISIONS.md` 2026-11-06). UI copy and docs say
"integrity mark" / "علامة سلامة"; the word "cryptographic" is forbidden for it until `warshad` exposes a
signing RPC.

---

## 3. Logical CSS and the parity matrix

**Physical properties: 0 today** in `apps/desktop/src`, `apps/remote/src`, `packages/ui/src` (only a
comment and the planted test fixtures match). Enforced by ESLint `LOGICAL_PROPERTY`
(`eslint.config.js`, apps) and R6.3 (`packages/ui`). Use `padding-inline`, `margin-block`,
`inset-inline-start`, `border-inline-start`, `text-align: start`. Directional glyphs (chevrons,
arrows) mirror via `[dir='rtl']` transforms; keyboard arrows mirror via `arrowStep(e, rtl)`.

**Parity matrix** — every state is proven in pixels, not assumed:

| Axis | Values | Covered by |
| --- | --- | --- |
| Locale × direction | `ar`/RTL, `en`/LTR | every suite |
| Theme | light, dark | states, visual, a11y, flows (themes case) |
| Viewport | 320×568, 390×844, 768×1024, 1024×768, 1440×900 | visual (77 screen×viewport pairs ×2×2 = 308), states (21 screens × 3 viewports ×2×2 = 252), a11y (23 screens × {390, 1440} ×2×2 + 4 = 188), layout (5 viewports) |
| Remote | 390, 768, 1440 | `apps/remote/e2e/bench.visual.spec.ts` (84) + `flows.spec.ts` (7) |
| Overflow | `scrollWidth ≤ innerWidth` | `layout.spec.ts` |

---

## 4. Token system v2

### 4.1 Families (existing → v2)

| Module | Existing | v2 additions (W3) | Theme blocks |
| --- | --- | --- | --- |
| `colors.ts` | 14 roles | `scrim`, `successTint`, `warningTint`, `errorTint`, `accentTint` | both |
| `aliases.ts` | 14 (signal ×4, bench ×3, lamp ×5, diff, focus) | — | both |
| `lines.ts` (new) | — | 8 border shorthands (§4.3) | **both** (they reference themed vars) |
| `elevation.ts` (new) | — | `plate`, `lift` + 8 layers (§4.4) | elevation both; layers light block only |
| `spacing.ts` | 13 steps 0…64 | half-steps `0.5` (2px), `1.5` (6px), `2.5` (10px) | light |
| `sizes.ts` | 21 | layout family (§4.5) | light |
| `typography.ts` | 2 families, 7 sizes, 4 lh, 4 weights | `tracking-code` | light |
| `radius.ts`, `shadow.ts`, `motion.ts` | unchanged | — | light (+ reduced-motion zeroing) |
| `breakpoints.ts` (new, TS only) | — | `narrow 360`, `tablet 768`, `desktop 1024`, `wide 1440` (+ `max(bp) = bp − 1`) | not in CSS (media queries cannot read custom properties) |

Rules that do not change: tokens live only in `packages/ui/src/tokens/`; TS and `tokens.css` declare
the same names with the same values per theme (R6 parity); no `prefers-color-scheme` in
`tokens.css` (the apps' `theme.tsx` resolves `system` and writes `data-theme`).

**Cascade rule for composite tokens.** Any token whose value references a themed custom property
(aliases, lines, elevation, scrim) is declared in **both** `:root, [data-theme='light']` and
`[data-theme='dark']`, with identical text. A custom property is substituted where it is declared; a
token declared only on `:root` would freeze the light colours into a dark subtree themed on an inner
element (Storybook's decorator does exactly that).

### 4.2 New colours — derived, contrast-proven

Tints are the status colour mixed over `surface`: **6% light, 10% dark**, stored as opaque hex so
`contrast.test.ts` can measure them. Scrim is `bg` at 55% alpha — the value `GateBell.tsx:166` uses
today — so the bench **frosts** on the day shift and **dims** on the night shift.

| CSS name | Light | Dark | Ink on it (contrast light / dark) |
| --- | --- | --- | --- |
| `--warsha-color-success-tint` | `#f1f7f3` | `#1b271d` | `success` 4.68 / 6.10 |
| `--warsha-color-warning-tint` | `#fbf5f0` | `#2a2418` | `warning` 4.64 / 6.10 |
| `--warsha-color-error-tint` | `#fbf2f1` | `#2e1d1c` | `error` 5.97 / 4.79 |
| `--warsha-color-accent-tint` | `#fffdf0` | `#2e2a16` | `signal-text` 4.96 / 10.20 |
| `--warsha-color-scrim` | `#fafafa8c` | `#0e0e0e8c` | non-text; alpha 0x8c = 0.549 |

Contract (W3 tests): ink on its own tint ≥ 4.5:1 in both themes; `text` on every tint ≥ 4.5:1; the
contrast helper accepts `#rrggbbaa` and composites over `bg` before measuring; scrim alpha ∈ (0, 1).
`accent-tint` is a lamp surface: it may appear only where `signal-wash` would, when an opaque fill is
required (a sticky row over scrolled content). Adoption of tints is **Phase B** (§9) — pills change
pixels.

### 4.3 Lines (`lines.ts`, CSS `--warsha-line-*`)

| Token | Value | Replaces in apps |
| --- | --- | --- |
| `line-rule` | `var(--warsha-size-rule) solid var(--warsha-bench-rule)` | `'1px solid var(--warsha-bench-rule)'` (~54) |
| `line-edge` | `var(--warsha-size-rule) solid var(--warsha-bench-edge)` | `'1px solid var(--warsha-bench-edge)'` (~17) |
| `line-fail` | `var(--warsha-size-rule) solid var(--warsha-color-error)` | `'1px solid var(--warsha-color-error)'` |
| `line-signal` | `var(--warsha-size-edge) solid var(--warsha-signal-text)` | `'3px solid var(--warsha-signal-text)'`; `internal.ts` `SIGNAL_EDGE` |
| `line-quiet` | `var(--warsha-size-edge) solid transparent` | `'3px solid transparent'`; `QUIET_EDGE` |
| `line-band` | `var(--warsha-size-edge) solid var(--warsha-bench-edge)` | `QUIET_BAND`, `'3px solid var(--warsha-bench-edge)'` |
| `line-band-fail` | `var(--warsha-size-edge) solid var(--warsha-color-error)` | `'3px solid var(--warsha-color-error)'` (×3) |
| `line-inscribe` | `var(--warsha-size-inscribe) solid currentColor` | `INSCRIBE` (stamp) |

`internal.ts` `RULE_BORDER`/`EDGE_BORDER`/`SIGNAL_EDGE`/`QUIET_EDGE`/`INSCRIBE` become
`lineVar('rule')` … so the package and the apps share one source.

### 4.4 Elevation and layers (`elevation.ts`)

| Token | Value | Use |
| --- | --- | --- |
| `--warsha-elevation-plate` | `var(--warsha-shadow-none)` | every plate |
| `--warsha-elevation-lift` | `var(--warsha-shadow-md)` | gate card, dialogs — nothing else |
| `--warsha-layer-raised` | `2` | `Composer` sticky bar |
| `--warsha-layer-popover` | `50` | `ModelPicker` listbox |
| `--warsha-layer-sticky` | `90` | remote sticky composer (`remote/index.css:240`) |
| `--warsha-layer-chrome` | `100` | topbars (`desktop/index.css:128`, `remote/index.css:118`) |
| `--warsha-layer-scrim` | `140` | `GateBell` overlay |
| `--warsha-layer-sheet` | `150` | `desktop/index.css:332` popover sheet |
| `--warsha-layer-banner` | `200` | offline/alert banners (`desktop/index.css:252`, `remote/index.css:214`) |
| `--warsha-layer-modal` | `1000` | `Devices`/`ProjectsBoard` dialogs |

Values are today's, so stacking is unchanged. `HandoffDialog` uses `50` for a modal — a known
inconsistency, normalised to `layer-modal` in Phase B (it changes stacking, not pixels, but is out of
this run's scope). Layers are unitless and R6.7 polices them in `packages/ui` only.

### 4.5 Spacing half-steps and the layout size family

Spacing: `SPACING_STEPS` gains `0.5`, `1.5`, `2.5`; `spacingVarName()` maps `.` → `-`
(`--warsha-space-0-5: 2px`, `--warsha-space-1-5: 6px`, `--warsha-space-2-5: 10px`). `Button` sizes
(`space(1.5)`/`space(2.5)`) now resolve to tokens with the same pixels. The **zero-tolerance** app
spacing list in R6 stays the eight B1 values; half-steps are counted by the R6.9 ratchet only (so
`RolesSettings.tsx:415 paddingBlock: '2px'` does not turn W3 red).

Layout sizes (`sizes.ts`, CSS `--warsha-size-*`), each pixel-identical to the literal it replaces:

| Token | Value | Sites at `f7b8583` |
| --- | --- | --- |
| `bench-offset` | `80px` | `calc(100vh - 80px)` ×8 (ArtifactViewer, Budgets, Devices, GatesInbox, ProjectsBoard, ProvidersSettings, RolesSettings, RunView) → `calc(100vh - var(--warsha-size-bench-offset))` |
| `plate-max` | `900px` | settings plates ×7 (Devices:262, Harnesses:178, Models:237, Plugins:193, Providers:236, Settings:164, Skills:168) |
| `ledger-max` | `1000px` | Budgets:184, RolesSettings:189 |
| `content-max` | `1100px` | `desktop/index.css:211`, `remote/index.css:498` (REDESIGN §10) |
| `content-wide` | `1400px` | `desktop/index.css:597` |
| `dialog` | `32rem` | HandoffDialog:204 (`min(var(--warsha-size-dialog), 100%)`), Onboarding:316 |
| `dialog-wide` | `34rem` | Onboarding:412, 483, 554, 672 |
| `notice` | `480px` | ErrorBoundary:109, ProjectsBoard:559 |
| `form-narrow` | `420px` | Devices:426 |
| `wizard` | `26rem` | ProviderSetupWizard:213 |
| `qr` | `160px` | Devices:480–481 |
| `preview-min` | `320px` | LivePreview:172, 189, 205; ArtifactViewer:382 |
| `pane` | `400px` | RunView:478 (flex basis), 479, 582 |
| `field-min` | `12rem` | LivePreview:283, RolesSettings:265, 291, SettingsScreen:512 (`flex: 1 1 var(…)`) |
| `label-col` | `7rem` | RolesSettings:315 |
| `measure-compact` | `9rem` | SimpleMode:1344 (grid min), ProviderRow:187, CrashReports:144 |
| `picker` | `13rem` | MentionPicker:125 |
| `picker-wide` | `15rem` | SlashCommandPicker:130 |
| `input-min` | `140px` | PluginsSettings:402, 419 |
| `popover` | `360px` | `desktop/index.css:333` (`min(var(…), calc(100vw - 2 * var(--warsha-space-4)))`) |
| `popover-block` | `520px` | `desktop/index.css:402` |
| `sheet-block` | `420px` | `remote/index.css:389` |
| `strip-item` | `240px` | `desktop/index.css:463` |

Also pixel-neutral cleanups W5 applies: `ModelsSettings.tsx:470` drops its inline visually-hidden
style (the element already has `className="sr-only"`); `ErrorBoundary.tsx:113,115,167` drop the
literal `var()` fallbacks (the tokens are always defined; the `4px` fallback even disagreed with the
2px `size-inscribe`).

**Breakpoints** (`breakpoints.ts`): CSS `@media` preludes keep literals, restricted to the set
`359, 767, 768, 1023, 1024, 1440` px (= `narrow−1, tablet−1, tablet, desktop−1, desktop, wide`). JS
`matchMedia` callers import `breakpoints.ts`.

### 4.6 R6 v2 — the rule set (`tokenDrift.test.ts`)

| Id | Scope | Forbids / checks | Status |
| --- | --- | --- | --- |
| R6.1 | `packages/ui` UI files | colour literal | existing |
| R6.2 | same | length literal (px/rem/em/pt/vh/vw) | existing |
| R6.3 | same | physical direction property | existing |
| R6.4 | same | inline font stack | existing |
| R6.5 | same | raw `--warsha-` name | existing |
| R6.6 | same | `cssVar(` call | existing |
| R6.7 | same | unitless `fontWeight: <n>` / `zIndex: <n>` (use `fontWeight()` / `layer()`) | **new** |
| R6.8 | scope fix | scan `compounds/internal.ts`; raw colours allowed only in blocks whose selector list is exactly `:root, [data-theme='light']` or `[data-theme='dark']` (closes `:root :focus-visible`) | **new** |
| R6.9 | `apps/{desktop,remote}/src/**/*.{ts,tsx,css}` minus tests/comments | **app length ratchet**: every `px`/`rem`/`em` length is an offence except inside an `@media` prelude whose value is in the breakpoint set; live count ≤ `APP_LENGTH_BUDGET` | **new** |
| R6.10 | same app scope | literal `var()` fallback (`var(--warsha-x, 4px)`) | **new** |
| R6.P | `tokens.css` ↔ all TS modules | exact name set + per-theme values; now includes `lines.ts`, `elevation.ts`; `breakpoints.ts` explicitly exempt from CSS parity | extended |
| R6.S | stories | every exported PascalCase component has a story | existing |

**Ratchet mechanics (frozen):**

```ts
// tokenDrift.test.ts — written by W3, value measured at W3's base and recorded in W3's report
const APP_LENGTH_BUDGET = <N measured at base>;
const envBudget = Number(process.env.WARSHA_R6_APP_LENGTH_BUDGET);
const budget = Number.isFinite(envBudget) ? Math.min(APP_LENGTH_BUDGET, envBudget) : APP_LENGTH_BUDGET;
expect(offences.length).toBeLessThanOrEqual(budget); // the env can only tighten
```

W5's gate runs with `WARSHA_R6_APP_LENGTH_BUDGET=0`. Integration step INT-2 sets the constant to `0`.
Every new rule ships with a planted-violation fixture that must fire and a clean fixture that must
stay clean (mirroring `check-arch --self-test`).

---

## 5. Primitive contracts (`components.tsx`)

| Primitive | Contract | A11y | RTL |
| --- | --- | --- | --- |
| `Box` | `p`/`m` in 4px units → `paddingInline`/`marginInline` via `space()`; `style`, `className`, `dir`, `onClick`, `data-*` | `div`; an `onClick` Box must be replaced by `Button` (Phase B lint) | logical only |
| `Text` | `size` `xs…xl`, `weight` `normal/medium/bold`, `inline`, `translate`, `dir`, `data-*` | `span`, block unless `inline` | inherits `dir`; machine data passes `dir="ltr" translate="no"` |
| `Button` | `variant` `primary` (signal + ink) / `secondary` (recess + text) / `ghost`; `size` `sm/md/lg` (padding-block `space-1-5`/`space-2-5`/14px); all button attributes | native button; `.warsha-control` gives 32px floor, 44px under `pointer: coarse`; focus = global ring | label-first, icon at inline-end |
| `Card` | dialog-level surface only: `surface`, `radius-xl`, `elevation-lift`, `space-4` | — | — |

`primary` is a lit lamp: **at most one per screen region**.

---

## 6. Compound contracts (23 families)

Every compound: token-only styling, catalog-free (every word arrives as a prop or child), logical
properties only, one story file under the `Bench/` title, a behaviour test in
`components/compounds.test.tsx` / `keyboard.test.tsx` / `machine.test.tsx` or its own file.

| Compound | Props (essential) | ARIA / keyboard | RTL | Story · test | v2 action |
| --- | --- | --- | --- | --- | --- |
| Banner | children, `tone` info/offline/error, `action` | `alert`+assertive on error, else `status`+polite; glyph `aria-hidden` | — | ✓ · C | — |
| Chip / ChipMeta | children, `tone` default/ok/fail/lit, `selected`, `onPress`, `glyph` | button + `aria-pressed` when pressable | — | ✓ · C,K | — |
| Composer | `onSend`, `label`, `sendLabel`, value API, `busy`, `keepDraft` | labelled field; Enter sends, Shift+Enter newline, IME-safe, Esc clears | sticky at block-end | ✓ · C,K | `zIndex` → `layer('raised')` |
| DiffView + Line | `label`; Line `kind` add/del/context/meta, numbers | `region` + label, focusable scroller; lines `dir=ltr translate=no`; gutter glyph + tone | gutter stays LTR | ✓ · C | — |
| EmptyState | `title`, `description`, `action` | ghost nut `aria-hidden`; one real next action | — | ✓ · C | — |
| FastModeToggle | `tier`, `onChange`, `label`, `hint` | label "label — hint"; click cycles | — | ✓ · **none** | add test (cycle order, label) |
| Field | children, `label`, `id`, `hint`, `error`, `required` | `label for`, error `role=alert`, derived `aria-invalid/-describedby/-required` | — | ✓ · C | — |
| GateCard | `gateId`, `title`, `state`, `onDecision(d,{gateId,note})`, `labels`, `busy`, `error`, `device`, `meta` | reason step autofocus, Esc cancels, focus returns to opener; notes required for reject/changes | stamp rotation mirrors | ✓ · C,K | `elevation-lift`, `line-signal` band |
| Lamp | children (required), `state` ×5, `size`, `glyph`, `bare` | dot + glyph `aria-hidden`; word always present | — | ✓ · C | — |
| Ledger + Row | `label`, `recessed`; Row `selected`, `onSelect`, `meta`, `actions`, `state` | `ul role=list`; row button `aria-current` | signal edge at inline-start | ✓ · C,K,M | lines via `lineVar` |
| Meter | readout child, `value`, `max`, `label`, `tone`, `warnAt`, `criticalAt` | `role=meter` + valuemin/max/now; readout always visible | fill grows from inline-start | ✓ · C,M | — |
| ModeSwitch | `mode`, `onModeChange`, labels | `group` + `aria-pressed`; arrows (mirrored)/Home/End | ✓ | ✓ · C,K | — |
| ModelPicker | `selectedId`, `options`, `onChange`, `label`, `ariaLabel`, default-option props | trigger `haspopup=listbox`, `expanded`, `controls`; listbox `activedescendant` | — | ✓ · **none** | keydown scoped to the component (not `document`); focus returns to trigger on close; `layer('popover')`; `fontWeight('semibold')`; new optional `autoLabel`/`autoDescription` defaulting to today's English; story → `Bench/ModelPicker`; tests |
| Panel | children, `title`, `actions`, `recessed`, `prose`, `label` | `section aria-label` | — | ✓ · C | lines via `lineVar` |
| RailRow / RailHead / Rail | children, `sublabel`, `meta`, `leading`, `selected`, `onSelect` | `aria-current`; `Rail` = `nav` | signal edge inline-start | ✓ · C,K,M | — |
| Segmented | `options`, `value`, `onChange`, `label`, `size` | `group` + `aria-pressed`; arrows/Home/End | ✓ | ✓ · C,K | — |
| SettingsScopeSentence | `project`, `className`, `dir` | — | — | ✓ · **none** | emoji `aria-hidden`; new optional `globalLabel`/`projectLabel`/`globalHint`/`projectHint` defaulting to today's English; story → `Bench/…`; tests |
| Skeleton | `label` (required), `lines`, `variant`, `quiet` | bars hidden; `status` + polite text | — | ✓ · C | — |
| Stamp | children, `tone` ok/fail, `glyph` | glyph hidden; word required | −2° / +2° per dir | ✓ · C | `line-inscribe` |
| StatusStrip + Item | `label`; Item `hideNarrow`, `machine` | `role=status`, focusable scroller | — | ✓ · C,M | — |
| Stream + Line | `label`; Line `time`, `kind`, `lane` | `role=log` + polite; time `dir=ltr` | — | ✓ · C,M | — |
| Tabs + Tab | `label`; Tab `selected`, `onSelect`, `panelId`, `badge`; `tabPanelProps` | roving tabindex, arrows mirrored, manual activation | ✓ | ✓ · C,K | apps adopt in Phase B |
| TerminalDock + TerminalLine | `output`, `commandLabel`, `submitLabel`, `onCommand`, `busy` | output `role=log`; labelled input `dir=ltr`; Enter submits, Esc clears | input stays LTR | ✓ · C,K | read-only in Advanced (no `onCommand`) |

C = `compounds.test.tsx`, K = `keyboard.test.tsx`, M = `machine.test.tsx`. Visible fixes to
`ModelPicker`/`SettingsScopeSentence` (Arabic strings, no `accent` fill for a non-waiting state,
`opacity` → `text-muted`) are Phase B — each changes captured pixels.

---

## 7. `packages/ui/README.md` (rewritten by W3)

Keep the repo's README contract shape (Overview, Interface, Invariants, Side Effects, Verification)
and document the real surface:

1. **Overview** — Bench & Signal in three sentences; links to REDESIGN and this document.
2. **Interface** — `src/index.ts` barrel; `components.tsx` (Box, Text, Button, Card); `compounds/`
   (the 23 families as a table: name → one-line job → story file); `compounds/internal.ts` (the
   machine-skin and keyboard helpers); `tokens/` (every module with its exported helpers:
   `colorVar`, `aliasVar`, `lineVar`, `elevationVar`, `layer`, `space`, `size`, `radius`, `shadow`,
   `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `duration`, `easing`, `breakpoints`) and
   `tokens.css` (how apps consume `var(--warsha-*)`); `storySupport.tsx`; `.storybook/`.
3. **Invariants** — lamp rule; catalog-free; logical-only; never colour alone; machine data mono; the
   composite-token cascade rule (§4.1); R6.1–R6.10 summary with a pointer to `docs/ARCH_RULES.md`.
4. **Side Effects** — none (presentational); `tokens.css` sets the global focus ring and the
   reduced-motion zeroing.
5. **Verification** — `pnpm --filter @warsha/ui test | typecheck | lint | build-storybook`, and the
   ratchet env (`WARSHA_R6_APP_LENGTH_BUDGET`).

---

## 8. Screen architecture

### 8.1 Simple mode — the Hard Bench (`apps/desktop/src/screens/SimpleMode.tsx`)

Regions (REDESIGN §4): `nav.simple-rail` (team `RailRow`s, inline-start) · main column · `.simple-side`
end panel (≥1024 only).

- **Mission Briefing Composer** — brief textarea; seven harness preset pills (`HARNESS_PRESETS`),
  four model pills (`FACTORY_MODELS`) beside `ModelPicker` + `FastModeToggle`; budget caps
  `$5/$10/$25/$50` + custom (`BUDGET_CAPS_USD`); `MentionPicker` (`@file`…), `SlashCommandPicker`
  (`/` commands); Queue, Steer and Permission-mode controls (`PermissionModeChip`). Launch =
  `selectHarness` (best-effort) then `startRun`. The composer `<form>` is still hand-built; adopting
  `Composer` is Phase B.
- **Nine-stage pipeline strip** — Intake → Research → Architecture → Code → Review → QA → Security →
  Release → Feedback (`FACTORY_STAGES`); the daemon's 14-stage walk folds onto it via
  `factoryStageIndex`. Current stage uses `signal-wash`; done stages a lamp `ok`.
- **Gate cards** — `GateCard` with rationale + automatic safety line; the only `elevation-lift` in
  the column; decisions leave `Stamp`s.
- **Artifact shelf** — `getRunArtifacts`, classified by `artifactKindOf` (file/test/diff/pr/build).
- **Verification receipt** (`data-testid="verification-receipt"`) — run id, project id, harness,
  pass/fail/pending, tokens + USD folded from the event socket, duration, and the integrity mark
  (§2.4).

### 8.2 Advanced mode — the Complex Workbench (`AdvancedMode.tsx`)

`.bench-advanced` → `.bench-rail` (lanes + task board) + `.bench-panes` behind a hand-built tablist
(`advanced-tabs`, Phase B → `Tabs`) with nine `Panel` panes: board, code, plan, stream, files, diff,
terminal, costs, ship.

- **WorkspaceTree** — lazy `files.tree` per expanded folder; `files.read` on open into the Code pane.
- **Context pills** — active harness, enabled skills, enabled plugins (`skills.list`,
  `plugins.list`, `harness.list`).
- **Run-control bar** — `advanceRun`, `cancelRun`, `followupRun`, placed beside a **read-only**
  `TerminalDock` (no `onCommand`; the terminal is a transcript).
- **Subagent swarm** (`.bench-swarm`) — a supervisory matrix of the 12 roles (`SWARM_ROLES`: intake,
  researcher, pm, designer, architect, coder, reviewer, qa, security, release, marketer, feedback):
  lamp + model id + lane cost per row; read, not operated (the lane filter owns the buttons).

### 8.3 Settings and operations

All settings screens render inside `App.tsx` `settingsScreen()` (one `role="tablist"` strip + one
`tabpanel`) except `Budgets` and `Devices`, which stand alone. Each screen is a ledger on a plate
capped at `size-plate-max` (or `ledger-max`), with `SettingsScopeSentence` where scope matters.

| Screen | Data path | Live RPC wiring | Owner |
| --- | --- | --- | --- |
| HarnessesSettings | `listHarnesses`, `selectHarness`, `importHarness` | wired | — |
| SkillsSettings | `listSkills`, `toggleSkill`, `importSkill` | wired | — |
| PluginsSettings | `listPlugins`, `installPlugin`, `togglePlugin`, `configurePlugin` | wired | — |
| ModelsSettings | `listCustomModels`, `addCustomModel`, `removeCustomModel`, `listRoleRoutings` | wired | — |
| SettingsProviders | `listProviders`, `addProvider`, `testProvider`, `removeProvider` | wired | — |
| CrashReports | `postlaunch.crashes` | wired (harness stub shape drifts — Phase B) | — |
| StoreReviews | `postlaunch.reviews` | wired (same) | — |
| Budgets | `getProjectBudget`, `setProjectBudget` | wired | — |
| Devices | `listDevices`, `startPairing`, `removeDevice` | wired | — |
| **Routines** | `routines.list/run_now/pause/resume` | **`TODO(M20 wiring)` → W5** (client wrappers from W4) | W4 → W5 |
| **BackendKitPanel** | `backend.get/set/export` | **`TODO(M20 wiring)` → W5** | W4 → W5 |

Phase B: a shared `SettingsLayout` compound (plate + title + scope sentence + ledger) replacing the
per-screen roots, and the four Wave-2 screens (`harnesses`, `skills`, `plugins`, `models`) added to the
e2e `SCREENS` list with owner-named new baselines.

### 8.4 Remote (`apps/remote`)

`bench.tsx` is data, not layout: `RemoteProvider`/`useRemote`, `stageQueue`, `gateWaitsOnOwner`. The
UI is `screens/{NeedsYou,Projects,Run,Gates,Settings}Screen.tsx`, `chrome.tsx`, `GatePlate.tsx`,
`pairing.tsx`, built from `Panel`, `Ledger`, `Lamp`, `Banner`, `Skeleton`, `Tabs`, `Segmented`,
`StatusStrip`. The phone job is "is anything waiting on me?" in under ten seconds at 390px:
NeedsYou first, the gate plate inline, sticky composer at `layer-sticky`. The PWA registers
`dist/sw.js` (`registerShellWorker`, production only); it requests no push permission.

---

## 9. Adoption ladder

| Phase | Constraint | Contents |
| --- | --- | --- |
| **A — this run** (W3, W5) | **pixel-neutral**: 793 desktop + 91 remote cases green, zero snapshot writes | §4 tokens + R6 v2; `internal.ts` on line tokens; Button on half-steps; ModelPicker focus/keydown/layer; optional label props; story titles; 3 new compound tests; README; W5 migration table (§4.3, §4.5); fallbacks dropped; scrim adopted in `HandoffDialog` + `GateBell` (neither is captured open); Routines + BackendKit wiring |
| **B — visual wave** (next run; the owner names the baseline set, captured on the Linux host) | baselines refreshed only for the named set | tints in status pills; Arabic strings for ModelPicker/SettingsScopeSentence and removal of the English defaults; no `accent` fill on non-waiting states; `opacity` → `text-muted`; `Tabs` replaces the two hand-built tablists; `Composer` adoption; `SettingsLayout`; 4 Wave-2 screens in `SCREENS`; harness stub shapes made daemon-true (`postlaunch.*`, `backend.export`, `handoff.*`); `HandoffDialog` → `layer-modal` |
| **C — type delivery** (owner license decision) | `THIRD_PARTY_NOTICES.md` row + baselines | vendor IBM Plex Sans Arabic + IBM Plex Mono (OFL-1.1) as `woff2` in `packages/ui`, `@font-face` with `local()` first; remove the Google Fonts links from both `index.html` (also an offline/privacy win for a Tauri app) |

---

## 10. Verification

| What | Command | Expected |
| --- | --- | --- |
| Token parity, R6 v2, contrast | `pnpm --filter @warsha/ui test` | exit 0, ≥ 170 passed |
| Ratchet at zero (after W5) | `WARSHA_R6_APP_LENGTH_BUDGET=0 pnpm --filter @warsha/ui test` | exit 0 |
| Stories build | `pnpm --filter @warsha/ui build-storybook` | exit 0 |
| Types across consumers | `pnpm -r typecheck` | exit 0 |
| Desktop / remote units | `pnpm --filter warsha-desktop test` · `pnpm --filter warsha-remote test` | ≥ 443 (≥ 451 after W5) · ≥ 221 |
| Pixel neutrality (Linux capture host) | `pnpm exec playwright test --project=desktop` · `--project=remote` | 793 · 91 passed, equal to the G0 baseline, no file under `*-snapshots/` changed |
| Architecture | `node scripts/check-arch.mjs` | exit 0 |

**Alternatives considered.** (a) Snap off-scale values to the nearest token — rejected: changes
pixels against a `maxDiffPixelRatio: 0` contract. (b) Express tints as `color-mix()` aliases —
rejected: `contrast.test.ts` cannot measure them, and the owner asked for `--warsha-color-*` names.
(c) Leave app lengths unpoliced (B1's "off-scale stays a pixel") — rejected: that is how 170
literals accumulated; the ratchet keeps the B1 tolerance only until W5 reaches zero. (d) Rebuild the
compounds as a new package — rejected: the contracts are sound; the defects are local.
