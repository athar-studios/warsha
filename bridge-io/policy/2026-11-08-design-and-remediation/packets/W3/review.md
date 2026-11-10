# Review — W3 · Design System v2 in `packages/ui` (tokens, R6 v2, compounds, README)

- Run: `2026-11-08-design-and-remediation`
- Packet: W3 (Wave A)
- Reviewer role: independent reviewer (ENGINEERING_POLICY §1 Phase 4) — not the implementer, not the verifier
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/w3`, branch `run/2026-11-08/w3-ui-v2`
- **BASE: `5abe5ef9cb4b107467155f8fb8bf61f086394ba4`** (integration tip after W8 merged)
- **HEAD: `0f829731273d722ae21f25e26a54767bc852fe56`** (confirmed with `git rev-parse HEAD`)
- The packet `report.md` was treated as a claim. Every number below was re-measured.

## 1. Verified diff identity

`git diff --stat 5abe5ef..HEAD` → **24 files changed, 1638 insertions(+), 161 deletions(−)**, every path under
`packages/ui/**`:

```
packages/ui/README.md                                  | 154 +++-
packages/ui/src/components.tsx                         |   7 +-
packages/ui/src/components/Tokens.stories.tsx          | 270 +++-
packages/ui/src/components/compounds.test.tsx          |  10 +-
packages/ui/src/components/compounds.v2.test.tsx       | 238 +++  (new)
packages/ui/src/compounds/Composer.tsx                 |   4 +-
packages/ui/src/compounds/FastModeToggle.stories.tsx   |   2 +-
packages/ui/src/compounds/ModelPicker.stories.tsx      |   2 +-
packages/ui/src/compounds/ModelPicker.tsx              | 119 +-
packages/ui/src/compounds/SettingsScopeSentence.stories.tsx | 2 +-
packages/ui/src/compounds/SettingsScopeSentence.tsx    |  37 +-
packages/ui/src/compounds/internal.ts                  |  19 +-
packages/ui/src/tokens/breakpoints.ts                  |  43 +  (new)
packages/ui/src/tokens/colors.ts                       |  14 +
packages/ui/src/tokens/contrast.test.ts                |  75 +-
packages/ui/src/tokens/elevation.ts                    |  71 +  (new)
packages/ui/src/tokens/index.ts                        |   8 +-
packages/ui/src/tokens/lines.ts                        |  45 +  (new)
packages/ui/src/tokens/sizes.ts                        |  82 +-
packages/ui/src/tokens/spacing.ts                      |  16 +-
packages/ui/src/tokens/tokenDrift.test.ts              | 333 +-
packages/ui/src/tokens/tokens.css                      |  91 +-
packages/ui/src/tokens/tokens.test.ts                  |  122 +-
packages/ui/src/tokens/typography.ts                   |  27 +-
```

7 commits, **0 merge commits**, all Conventional (`feat(ui):`, `test(ui):`, `docs(ui):`). The rebase onto
`5abe5ef` is coherent: a single clean diff, no duplicated hunks, each new custom property declared exactly once
per theme block (`--warsha-line-rule:` at `packages/ui/src/tokens/tokens.css:94` and `:276`; `--warsha-color-scrim:`
at `:51` and `:248`), no stale pre-rebase content.

## 2. Scope — PASS

- Gate **G3.S = 0** (`git diff --name-only 5abe5ef..HEAD | grep -vE '^packages/ui/(src/|\.storybook/|README\.md$)' | wc -l`).
- Nothing outside `packages/ui/src/**`, `packages/ui/README.md` changed. No `apps/**`, no `packages/ui/package.json`,
  no `pnpm-lock.yaml`, no `.github/**`, no `*-snapshots/**`, no `PLAN.md`/`PROGRESS.md`/`DECISIONS.md`
  (`git diff --name-only` filtered on those paths = 0).
- Worktree clean at HEAD (`git status --porcelain` = 0 lines).

## 3. Pixel neutrality (D1) — judgment: **NEUTRAL**

No change in this diff can move a rendered pixel in any state the desktop (308/308) or remote (252/252) suites
cover. `git diff --name-only 5abe5ef..HEAD -- apps` is empty; no snapshot file is touched
(`git status --porcelain -- '*-snapshots/*'` = 0).

**Consumed tokens — all computed-identical:**

| Consumption | New value | Previous value | Verdict |
| --- | --- | --- | --- |
| `RULE_BORDER`/`EDGE_BORDER`/`SIGNAL_EDGE`/`QUIET_EDGE`/`INSCRIBE` → `lineVar(…)` at `packages/ui/src/compounds/internal.ts:60,63,73,76,79` | `var(--warsha-line-*)`, declared `tokens.css:94-101` (light) and `:276-283` (dark, identical text) | `1px`/`3px`/`2px` + the same size/alias tokens; `currentColor` resolves at use site in both forms | identical |
| `Composer` `zIndex: layer('raised')` at `packages/ui/src/compounds/Composer.tsx:123` | `--warsha-layer-raised: 2` (`tokens.css:106`) | `2` | identical |
| `ModelPicker` `zIndex: layer('popover')` at `packages/ui/src/compounds/ModelPicker.tsx:205` | `--warsha-layer-popover: 50` (`tokens.css:107`) | `50` | identical |
| `ModelPicker` `fontWeight('semibold')` at `ModelPicker.tsx:251` | `--warsha-font-weight-semibold: 600` (`tokens.css:207`) | `600` | identical |
| `Button` `sm`/`md` `paddingBlock` at `packages/ui/src/components.tsx:49-50` via `space(1.5)`/`space(2.5)` | `--warsha-space-1-5: 6px` / `--warsha-space-2-5: 10px` (`tokens.css:166,170`) | `6px` / `10px` (off-scale branch) | identical; `lg`'s 14px still computes (`components.tsx:51`) |
| `SettingsScopeSentence` defaults at `packages/ui/src/compounds/SettingsScopeSentence.tsx:40-43` | `'All projects'`, `Current project: ${name}`, `'This setting applies to all projects.'`, `'This setting applies to the selected project only.'` | the exact literals removed in the same diff | byte-identical |
| `ModelPicker` defaults at `ModelPicker.tsx:71-72` | `'Auto'`, `'Uses the role routing configured in settings'` | the exact literals removed | byte-identical |
| `SettingsScopeSentence` emoji `aria-hidden="true"` (`SettingsScopeSentence.tsx:67,74`) | ARIA-only attribute | — | no rendering change |

**New but inert in the product** (no app/component consumer; consumed only by `Tokens.stories.tsx`, which is not
part of the visual baseline set): `scrim` and the four tints (`packages/ui/src/tokens/colors.ts:68-77`;
`tokens.css:51-55,248-252`), elevation (`tokens/elevation.ts:12`), the 23 layout sizes
(`tokens/sizes.ts:68+`), breakpoints (`tokens/breakpoints.ts:10`), tracking (`tokens/typography.ts`),
`line-fail`/`line-band`/`line-bandFail`, and layers other than `raised`/`popover`. Story titles
(`Compounds/…` → `Bench/…`) are Storybook-only.

**Event-path changes are not render-path changes.** Scoping `keydown` from `document` to the component root
(`ModelPicker.tsx:123,162`) and returning focus to the trigger (`ModelPicker.tsx:100-104,114,138,143,228`) only run
on input; the DOM, test ids, classes and inline styles are unchanged. Both apps define focus rings only on
`:focus-visible` (`apps/desktop/src/index.css:75`, `apps/remote/src/index.css:75`), so a pointer-driven focus
restore draws nothing. The one theoretically new ring state is a keyboard-initiated close (Escape/Enter); no
covered screenshot exercises that state, and the orchestrator's proven post-W8 capture (793 passed / 0 failed,
**zero snapshot writes**) corroborates that no covered pixel moved.

Residual pixel risk found by reading the diff: **none**.

## 4. R6 v2 / the ratchet (D3) — verdict: **CORRECT**

- **R6.7** — `UNITLESS_WEIGHT_OR_LAYER` at `packages/ui/src/tokens/tokenDrift.test.ts:234`; planted
  `fontWeight: 600` and `zIndex: 50` fixtures fire, the helper-only fixture stays clean
  (`tokenDrift.test.ts` "catches a planted violation of every rule" / "accepts a component that only uses helpers").
- **R6.8** — `compounds/internal.ts` is in the scan set (`componentSources()`, `tokenDrift.test.ts:139-151`);
  raw colours are exempted only in the exact selector list `RAW_COLOUR_SELECTORS` (`tokenDrift.test.ts:492`),
  whitespace-normalised; the planted `:root :focus-visible` fixture fires and the clean theme-block fixture is
  clean. I independently confirmed `tokens.css` declares **0** raw colours outside the two theme blocks.
- **R6.9** — `APP_LENGTH` (`tokenDrift.test.ts:945`), `scanAppLengths` (`:968`), `@media` prelude exemption set
  derived from `breakpoints.ts`; fixtures prove the six breakpoint values are exempt, a non-breakpoint prelude
  fires, a declaration *inside* an exempt prelude still fires, and a `rem` prelude fires.
- **R6.10** — `VAR_FALLBACK` (`tokenDrift.test.ts:951`); a literal fallback is one offence, a nested `var()`
  fallback is accepted, and a fallback's own length is not double-counted.
- **R6.P extended** — lines and elevations must be declared in **both** theme blocks with identical text, layers
  are light-only and unitless, `breakpoints.ts` is pinned absent from the CSS, and the CSS name set must equal the
  TS name set exactly.
- **Budget is honest and is not zero.** `APP_LENGTH_BUDGET = 145` (`tokenDrift.test.ts:1008`), documented as
  142 R6.9 lengths + 3 R6.10 fallbacks. I re-measured it by running the ratchet with
  `WARSHA_R6_APP_LENGTH_BUDGET=0`: **`expected 145 to be less than or equal to 0`**. Because `apps/**` is
  unchanged in this packet, the same 145 holds at BASE `5abe5ef`; the preserved `packets/W3/ratchet-base.txt`
  independently recorded `RATCHET_COUNT=145`.
- **The ratchet cannot be loosened.** `tokenDrift.test.ts:1018`:
  `Number.isFinite(envBudget) ? Math.min(APP_LENGTH_BUDGET, envBudget) : APP_LENGTH_BUDGET`.
  An env value above 145 clamps to 145; `NaN`/unset falls back to 145; an empty value becomes 0 (tightens only).
  No code path raises the budget, and the constant is not 0 (INT-2 is a later orchestrator step).
- **G3.3 satisfied:** `pnpm --filter @warsha/ui test` → **9 files, 181 passed, 0 failed** (≥ 170).

Token values match DS v2 exactly (cross-checked against `docs/designs/DESIGN_SYSTEM_V2.md` §4.2–§4.5): tint/scrim
hexes, the 8 line shorthands, the 2 elevations + 8 layers, the 3 half-steps, the 23 layout sizes (name by name),
the 4 breakpoints and `maxWidth(bp) = bp − 1`, and `--warsha-tracking-code: 0.2em`.

## 5. Test quality — verdict: **GOOD**

- Count: **151 passed / 8 files at BASE → 181 passed / 9 files at HEAD** (+30). The added file is
  `packages/ui/src/components/compounds.v2.test.tsx` (11 tests).
- **No test deleted.** `compounds.test.tsx` has 58 `it(` at BASE and 58 at HEAD. In `tokenDrift.test.ts` the one
  removed `it` title is a **rename** ("keeps every raw colour inside the two theme blocks (REDESIGN §12)" →
  "…two exact theme blocks (REDESIGN §12, R6.8)"), and the rule got a planted-violation fixture it did not have.
- **No skip/only/todo/xit/xdescribe** in added lines (grep = 0). No assertion weakened:
  - 4 compound assertions moved from substring to **exact** line-token equality
    (`compounds.test.tsx:252,391,393,993`); the composition they used to cover is pinned in
    `tokens.test.ts` and `tokenDrift.test.ts` (line token values + both-theme parity).
  - The obsolete `expect(fontSizeVarName('md')).not.toContain('tracking')` was replaced by stronger exact pins
    (`trackingTokenNames === ['code']`, `trackingTokens.code === '0.2em'`, helper + var-name values) — the
    planned §2.3 spec change.
  - `SPACING_STEPS` 13 → 16 is the planned §4.5 spec change; the test adds the 16-step pin
    (`tokens.test.ts:109`) and the half-step name/value assertions, and keeps the off-scale `space(3.5)` case.
  - Contrast: no assertion removed; the hex parser gained `#rrggbbaa` compositing plus scrim-alpha and
    tint-opacity tests; 8 new AA pairs.
- The 3 new compound groups pin real behaviour, not snapshots: tier cycle order + accessible name
  "label — hint" (`compounds.v2.test.tsx:31`), ModelPicker open/Escape/focus-return, arrow wrap, Enter
  select + focus-return, outside-click close + focus-return, **keydown outside is ignored** (`:87-171`), custom
  `autoLabel` vs English default, and SettingsScopeSentence default/custom labels and `aria-hidden` glyphs (`:214`).
- No threshold was raised to make a gate pass.

## 6. Rules (AGENTS.md) — PASS

- TS strict, **no `any`** in added lines (the only `any` hits are prose in comments); `tsc --noEmit` and
  `tsc -p tsconfig.storybook.json` pass, ESLint passes.
- **RTL-safe:** 0 physical `left`/`right`/`margin-left`/`padding-left`/`border-left`-family properties in added
  lines; new styling uses logical properties; new tokens are direction-agnostic.
- **D9 catalog-free:** no i18n/locale/catalog import anywhere in `packages/ui/src`; the optional label props
  default to the exact English literals they replace (verified against the removed lines), so Phase B can pass
  catalog strings without a rewrite.
- No dependency/lockfile/`.github`/snapshot change; no `PLAN.md`/`PROGRESS.md`/`DECISIONS.md` edit; no secrets;
  no real model API calls (all new tests are jsdom/React Testing Library).
- Conventional Commits only; no merge, no push, no publish.

## 7. Findings

**Blockers: none.**
**Major: none.**

**Minor (non-blocking; follow-ups, not W3 repair items):**

1. `packages/ui/src/tokens/tokenDrift.test.ts:440-463` — `parseCssBlocks` returns only top-level rules, so a raw
   colour declared **inside an `@media` block** in `tokens.css` would not be flagged by R6.8. This is the same
   loophole class R6.8 exists to close. Not currently violated (0 raw colours outside the two theme blocks,
   verified), and the frozen rule text only specifies the selector-list check. Suggest scanning nested blocks in
   a later wave.
2. `packages/ui/src/tokens/tokenDrift.test.ts:234` — the R6.7 regex matches only non-negative integer literals, so
   `fontWeight: '600'` (string form) or `zIndex: -1` would pass. Not present in the package today.
3. `packages/ui/src/compounds/ModelPicker.tsx:114` — the outside-`mousedown` close focuses the trigger
   unconditionally; in a real browser the default mousedown action can then move focus to the clicked element, and
   the call can steal focus from an input the user just clicked. jsdom proves the handler runs, not the browser
   ordering. Acknowledged in the packet report; behaviour, not pixels. Consider focusing only when the picker
   held focus.

**Nits:**

4. `tokenDrift.test.ts:~547-551` — `lightBlock`/`darkBlock` are found with `selector.includes(':root')` /
   `includes("[data-theme='dark']")`. Safe today (R6.8 uses exact matching; the focus rule declares no custom
   properties), but a descendant selector that declared a token would be mistaken for "the" theme block.
5. `packages/ui/src/components/Tokens.stories.tsx` writes raw `var(--warsha-…)` strings and a raw radius string.
   Stories are outside the R6 literal scan, so this is a consistency nit only.
6. `ModelPicker.tsx:103` — `closePicker` restores focus via `document.getElementById(triggerId)` because `Button`
   does not forward refs. Works and is tested; ref forwarding would be cleaner.
7. Report Appendix A lists 145 offences but 144 distinct message lines (one line carries two `1px` literals); the
   report explains this, and the count matches my measurement.

## 8. What I verified with commands

| Check | Command | Result |
| --- | --- | --- |
| Identity | `git rev-parse HEAD`, `git log --oneline 5abe5ef..HEAD` | `0f82973…`; 7 commits, 0 merges |
| Diff stat | `git diff --stat 5abe5ef..HEAD` | 24 files, +1638/−161 |
| G3.S | scope grep (above) | **0** |
| G3.1 | `pnpm --filter @warsha/ui typecheck` | exit **0** |
| G3.2 | `pnpm --filter @warsha/ui lint` | exit **0** |
| G3.3 | `pnpm --filter @warsha/ui test` | **181 passed / 9 files, 0 failed** |
| G3.5 | `pnpm -r typecheck` | exit **0** (desktop + remote + ui) |
| G3.A / G3.P / G3.W | `node scripts/check-arch.mjs` / `check-engineering-policy.mjs` / `check-wire-contract.mjs` | exit **0** each |
| G3.10 | `git status --porcelain -- '*-snapshots/*'` | **0**; worktree clean |
| R3.1 | ratchet probe `WARSHA_R6_APP_LENGTH_BUDGET=0 … -t "holds the live app length count"` | **145** offences (matches `APP_LENGTH_BUDGET`) |

**Not verified by me (by design):** G3.4 `build-storybook` (stories are type-checked via
`tsconfig.storybook.json`; the verifier runs the build), G3.6/G3.7 app unit suites (verifier), and the
capture-host gates **G3.8 (desktop 793/0)** and **G3.9 (remote 91/0)** — I did not run Playwright and never
passed `--update-snapshots`. G3.9 remains the known owner decision (OD1: 40 stale remote product baselines).

## 9. Verdict

**APPROVE**

The packet is in scope, pixel-neutral by construction (every consumed token resolves to the identical computed
value; every new token is inert until W5), implements R6.7–R6.10 and R6.P per DS v2 §4.6 with planted and clean
fixtures, holds an honest `APP_LENGTH_BUDGET = 145` that can only tighten, and raises the package suite from 151
to 181 tests without deleting, skipping or weakening any existing assertion. The three minors are defence-in-depth
and browser-behaviour follow-ups, none of which invalidates a frozen gate.
