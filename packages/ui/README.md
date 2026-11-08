# @warsha/ui

## Overview

Bench & Signal, completed: the design system for the desktop app, the remote PWA and anything else
that renders Warsha. It exports the four primitives every screen is built from, the 23 compound
families the bench is made of, and the token layer (`--warsha-*`) both themes are drawn from — so a
screen never re-invents a lamp, a ledger row or a hairline.

The direction is [REDESIGN.md](../../docs/design/REDESIGN.md) (B1, locked); the contracts — token
vocabulary, the R6 rules that police it, the compound APIs and the adoption order — are
[DESIGN_SYSTEM_V2.md](../../docs/designs/DESIGN_SYSTEM_V2.md) (DS v2). This package implements DS v2
in one pixel-neutral wave: baselines are `maxDiffPixelRatio: 0`, so a token here either replaces a
value with the identical computed one or is new and unused by the apps.

## Interface

### Entry points

- `src/index.ts` — the public barrel: primitives, compounds, tokens.
- `src/components.tsx` — the four primitives: `Box` (4px-unit `p`/`m` on logical sides), `Text`
  (block by default, `inline` opt-in, machine data via `translate`/`dir`), `Button` (primary =
  signal with ink, secondary = recess, ghost; `sm`/`md`/`lg`; 32px floor, 44px under `pointer:
  coarse`), `Card` (the dialog-level surface: `surface`, `radius-xl`, lift shadow).
- `src/compounds/` — one file per family, re-exported by `src/compounds/index.ts`.
- `src/tokens/` — one file per token family, re-exported by `src/tokens/index.ts`; `tokens.css` is
  the CSS half.
- `src/storySupport.tsx` — the story frame: `Bench` (one directed, themed plate), `FourCorners` (the
  same story in ar/light, ar/dark, en/light, en/dark), `DemoRow`, `DemoStack`, `DemoCaption`.
- `.storybook/` — `preview.ts` imports `tokens.css` once and provides the Direction (RTL default) and
  Theme globes; every story is reviewed through them.

### The 23 compound families

Every compound is token-only, catalog-free (every word arrives as a prop or a child), logical-only,
and has one story under `Bench/`. `C` = `components/compounds.test.tsx`, `K` = `keyboard.test.tsx`,
`M` = `machine.test.tsx`, `2` = `compounds.v2.test.tsx`.

| Family | Job | Story file | Tests |
| --- | --- | --- | --- |
| Banner | Inline message with a tone (info/offline/error) and at most one action | `components/Banner.stories.tsx` | C |
| Chip / ChipMeta | Pressable status chip (`aria-pressed`) and its machine-readable meta | `components/Chip.stories.tsx` | C, K |
| Composer | The bench's message field: Enter sends, Shift+Enter newlines, IME-safe, Esc clears, sticky at block-end | `components/Composer.stories.tsx` | C, K |
| DiffView + Line | A labelled diff region; add/del/context/meta lines stay LTR with a gutter glyph | `components/DiffView.stories.tsx` | C |
| EmptyState | A plate with a ghost hex nut, a title, a description and one real next action | `components/EmptyState.stories.tsx` | C |
| FastModeToggle | The composer's speed chip; a click cycles thorough → balanced → fast, name is "label — hint" | `compounds/FastModeToggle.stories.tsx` | 2 |
| Field | A labelled control with hint, `role=alert` error and derived `aria-invalid/-describedby/-required` | `components/Field.stories.tsx` | C |
| GateCard | The one interruption: gate rationale, the safety line, and a decision with a required reason | `components/GateCard.stories.tsx` | C, K |
| Lamp | A state lamp (idle/working/waiting/ok/fail) that always carries its word | `components/Lamp.stories.tsx` | C |
| Ledger + Row | A `ul role=list` of rows; selection is `aria-current` plus a signal edge at inline-start | `components/Ledger.stories.tsx` | C, K, M |
| Meter | A labelled meter with a visible readout and tone thresholds | `components/Meter.stories.tsx` | C, M |
| ModeSwitch | Simple/advanced mode group with `aria-pressed` and mirrored arrows | `components/ModeSwitch.stories.tsx` | C, K |
| ModelPicker | The composer's model selector: a trigger plus a listbox, keydown scoped to the component, focus back to the trigger on close | `compounds/ModelPicker.stories.tsx` | 2 |
| Panel | A titled plate section (`section aria-label`) | `components/Panel.stories.tsx` | C |
| Rail / RailHead / RailRow | The inline-start navigation rail (`nav`), rows marked `aria-current` | `components/Rail.stories.tsx` | C, K, M |
| Segmented | A segmented control with `aria-pressed` and mirrored arrows/Home/End | `components/Segmented.stories.tsx` | C, K |
| SettingsScopeSentence | "All projects" vs "Current project: …" with a hint; labels are props with today's English defaults | `compounds/SettingsScopeSentence.stories.tsx` | 2 |
| Skeleton | A labelled loading placeholder (`status`, polite text, bars hidden) | `components/Skeleton.stories.tsx` | C |
| Stamp | The pressed-metal decision stamp (ok/fail), mirrored rotation per direction | `components/Stamp.stories.tsx` | C |
| StatusStrip + Item | The instrument strip (`role=status`), machine items in mono | `components/StatusStrip.stories.tsx` | C, M |
| Stream + Line | The event log (`role=log`), times LTR, lanes as a state channel | `components/Stream.stories.tsx` | C, M |
| Tabs + Tab | A tablist with roving tabindex, mirrored arrows and manual activation | `components/Tabs.stories.tsx` | C, K |
| TerminalDock + TerminalLine | A terminal transcript/command dock; output is a log, input stays LTR | `components/Terminal.stories.tsx` | C, K |

`src/compounds/internal.ts` owns what the compounds share and exports what an app must resolve the
same way: `slotText` / `carriesJoinedScript` / `machineSkin` / `machineSkinSmall` (the sans/mono rule),
plus `cx` and the shared skins. It is scanned by R6.8 like any other compound source.

### The token layer (`src/tokens/`)

Every module exports its record, its name list, a `*VarName` helper (the bare custom property) and a
typed helper (the `var()` reference). Components use the helpers; apps use the custom properties.

| Module | What it holds | Helpers |
| --- | --- | --- |
| `colors.ts` | 19 colour roles for both themes — incl. DS v2's `scrim` (`#fafafa8c`/`#0e0e0e8c`) and the four status tints | `colorVar`, `colorVarName`, `colorValue`, `colorPalette`, `colorTokenNames`, `THEME_ATTRIBUTE` |
| `aliases.ts` | The semantic layer: signal ×4, bench ×3, lamp ×5, diff, focus | `aliasVar`, `aliasVarName`, `aliasValue`, `aliasResolvesTo`, `aliasTokenNames` |
| `lines.ts` | The 8 border shorthands of §4.3 (`rule`, `edge`, `fail`, `signal`, `quiet`, `band`, `bandFail`, `inscribe`) | `lineVar`, `lineVarName`, `lineTokenNames` |
| `elevation.ts` | `plate`/`lift` plus the 8 stacking layers at today's z-index values | `elevationVar`, `elevationVarName`, `layer`, `layerVarName`, both name lists |
| `spacing.ts` | The 16-step 4px rhythm, including half-steps `0.5`/`1.5`/`2.5` (names use a dash: `--warsha-space-1-5`) | `space`, `spaceVar`, `spacingVarName`, `spacingTokens`, `SPACING_STEPS`, `isSpacingStep` |
| `sizes.ts` | 21 bench facts (`touch` 44px, `inscribe` 2px, rail, measure…) plus the 23-token layout family (§4.5) | `size`, `sizeVarName`, `sizeTokenNames`, `layoutSizeNames` |
| `typography.ts` | 2 families, 7 sizes, 4 line heights, 4 weights, and the one tracking token `code` (0.2em, mono codes only) | `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `tracking` (+ `*VarName`) |
| `radius.ts`, `shadow.ts`, `motion.ts` | Unchanged from B1: radii, shadows, loop durations and easings | `radius`, `shadow`, `duration`, `easing` (+ `*VarName`) |
| `breakpoints.ts` | `narrow 360`, `tablet 768`, `desktop 1024`, `wide 1440`, `maxWidth(bp) = bp − 1`, and the `@media` exemption set. **TS only** — a media query cannot read a custom property | `breakpoints`, `breakpointNames`, `maxWidth`, `MEDIA_PRELUDE_PX` |
| `tokens.css` | The CSS half: `:root, [data-theme='light']` and `[data-theme='dark']` declare the same names with the same values | — |
| `vars.ts` | The prefix and the two primitives the helpers are built from | `cssVar`, `kebabCase` (token-internal) |

Apps consume `var(--warsha-*)` directly (they have no typed helpers) and import
`@warsha/ui/tokens/tokens.css` once. `tokens.css` never uses `prefers-color-scheme`: the apps'
`theme.tsx` resolves `system` and writes `data-theme`.

## Invariants

- **The lamp rule.** `signal`/`signalText` appear only where the owner must act — pending gates, the
  waiting lane, the screen's one primary action — never as decoration. `Button variant="primary"`
  is a lit lamp: at most one per screen region.
- **Never colour alone.** A lamp renders its word, a stamp its glyph, a meter its readout, a diff its
  gutter mark, a selected row `aria-current`. The contrast gate proves the ink.
- **Catalog-free.** No word is hard-coded in the package: labels, hints and titles arrive as props
  or children. `ModelPicker`'s `autoLabel`/`autoDescription` and `SettingsScopeSentence`'s
  `globalLabel`/`projectLabel`/`globalHint`/`projectHint` default to today's English so the apps
  render unchanged; the catalog adoption is Phase B (DS v2 §9, `DECISIONS.md` D9).
- **Logical-only.** `padding-inline`, `margin-block`, `inset-inline-start`, `border-inline-start`,
  `text-align: start` — a physical property breaks Arabic, so R6.3 fails it.
- **Machine data is mono.** Ids, paths, costs and timestamps go through `machineSkin` (or
  `font-mono` + `dir="ltr" translate="no"`), and an Arabic run inside a machine slot drops to sans
  rather than rendering in a Latin mono face.
- **The cascade rule for composite tokens.** A token whose value references a themed custom property
  (aliases, lines, elevation) is declared in *both* theme blocks with identical text: a custom
  property is substituted where it is declared, so declaring it on `:root` only would freeze the
  light colours into a dark subtree themed on an inner element (Storybook's decorator does exactly
  that). `tokenDrift.test.ts` enforces it.
- **R6, the literal ban** (`docs/ARCH_RULES.md` R6; enforced by `src/tokens/tokenDrift.test.ts`):
  - R6.1 no colour literal · R6.2 no length literal · R6.3 no physical direction property ·
    R6.4 no inline font stack · R6.5 no raw `--warsha-` name · R6.6 no `cssVar(` outside the token
    directory;
  - R6.7 no unitless `fontWeight: <n>` / `zIndex: <n>` in the package — name
    `fontWeight('semibold')` / `layer('popover')`;
  - R6.8 `compounds/internal.ts` is scanned, and a raw colour in `tokens.css` is allowed only inside
    a block whose selector list is exactly `:root, [data-theme='light']` or `[data-theme='dark']`
    (so `:root :focus-visible` cannot smuggle one);
  - R6.9 the **app length ratchet**: every `px`/`rem`/`em` length in `apps/{desktop,remote}/src/**`
    `.ts/.tsx/.css` (tests and comments excluded) is an offence, except inside an `@media` prelude
    whose value is one of `359, 767, 768, 1023, 1024, 1440`px. The live count may not exceed
    `APP_LENGTH_BUDGET`, measured at this packet's base (`5abe5ef`, the integration tip after W8
    merged; identical at the original `0772d50` base): **145** offences — 142 lengths plus 3 literal
    `var()` fallbacks. W5 drives the apps to zero; the integration step INT-2 sets the constant to
    `0`;
  - R6.10 a literal `var()` fallback (`var(--warsha-x, 4px)`) is an offence — the token is always
    defined;
  - R6.P parity: every TS token module and `tokens.css` declare exactly the same names with the same
    per-theme values (`breakpoints.ts` is exempt by design); R6.S every exported component has a
    story.
  - Each rule carries a planted-violation fixture (and a clean one) in `tokenDrift.test.ts`: a rule
    that silently matches nothing proves nothing.
- **No business logic.** The package is presentational; apps own data, RPC and i18n.

## Side Effects

Rendering is the only side effect. The single global import, `tokens.css`, also sets the app-wide
`:focus-visible` ring (the `focusRing` alias, so the theme decides which accent is visible) and zeroes
the three permitted loops under `prefers-reduced-motion: reduce`. Nothing here performs I/O, reads a
catalog or calls a network.

## Verification

- Units, token parity and R6: `pnpm --filter @warsha/ui test` — expect ≥ 170 passed, 0 failed.
- The ratchet can only tighten:
  `WARSHA_R6_APP_LENGTH_BUDGET=<n> pnpm --filter @warsha/ui test` — the env budget is
  `Math.min(APP_LENGTH_BUDGET, n)`, so `=0` is how W5 proves the apps reached zero.
- Types: `pnpm --filter @warsha/ui typecheck` (both the package and the story tsconfig).
- Lint: `pnpm --filter @warsha/ui lint`.
- Stories: `pnpm --filter @warsha/ui build-storybook`.
- Consumers still compile: `pnpm -r typecheck`; pixel neutrality is proven on the Linux capture host
  (`pnpm exec playwright test --project=desktop|remote`), never on Windows.
