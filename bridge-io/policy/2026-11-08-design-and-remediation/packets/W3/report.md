# W3 — Design System v2 in `packages/ui` (tokens, R6 v2, compounds, README)

Run `2026-11-08-design-and-remediation` · packet W3 · Wave A
Branch `run/2026-11-08/w3-ui-v2` · worktree `C:/Users/Dragonfly/Downloads/warsha-wt/w3`
Implementer: this session, resumed after the 02:40Z host interruption that killed the first W3 worker.

## Identity

- **BASE**: `5abe5ef9cb4b107467155f8fb8bf61f086394ba4` — `run/2026-11-08/integration` after W8 merged
  (re-recorded per the orchestrator; the packet prompt's original base was
  `0772d502002562505c6438ae712abca7a7328d84`).
- **HEAD**: `0f829731273d722ae21f25e26a54767bc852fe56`
- **Rebase**: clean. Six commits were replayed from the preserved branch onto `5abe5ef`; one follow-up
  commit re-records the measured base. No conflicts; nothing outside `packages/ui/**` touched.
- **Install**: not needed — `0772d50..5abe5ef` changed no `package.json` or lockfile.
- **Tree**: clean at HEAD (`git diff --stat HEAD` empty, 0 untracked files).

`git diff --stat $BASE..HEAD` — 24 files, +1638/−161, every path under `packages/ui/**`:

```
 packages/ui/README.md                              | 154 +++++++++-
 packages/ui/src/components.tsx                     |   7 +-
 packages/ui/src/components/Tokens.stories.tsx      | 270 ++++++++++++++++-
 packages/ui/src/components/compounds.test.tsx      |  10 +-
 packages/ui/src/components/compounds.v2.test.tsx   | 238 +++++++++++++++
 packages/ui/src/compounds/Composer.tsx             |   4 +-
 .../ui/src/compounds/FastModeToggle.stories.tsx    |   2 +-
 .../ui/src/compounds/ModelPicker.stories.tsx       |   2 +-
 .../ui/src/compounds/ModelPicker.tsx               | 119 ++++----
 .../compounds/SettingsScopeSentence.stories.tsx    |   2 +-
 .../ui/src/compounds/SettingsScopeSentence.tsx     |  37 ++-
 packages/ui/src/compounds/internal.ts              |  19 +-
 packages/ui/src/tokens/breakpoints.ts              |  43 +++
 packages/ui/src/tokens/colors.ts                   |  14 +
 packages/ui/src/tokens/contrast.test.ts            |  75 ++++-
 packages/ui/src/tokens/elevation.ts                |  71 +++++
 packages/ui/src/tokens/index.ts                    |   8 +-
 packages/ui/src/tokens/lines.ts                    |  45 +++
 packages/ui/src/tokens/sizes.ts                    |  82 +++++
 packages/ui/src/tokens/spacing.ts                  |  16 +-
 packages/ui/src/tokens/tokenDrift.test.ts          | 333 +++++++++++++++++++--
 packages/ui/src/tokens/tokens.css                  |  91 +++++-
 packages/ui/src/tokens/tokens.test.ts              | 129 +++++++-
 packages/ui/src/tokens/typography.ts               |  28 +-
 24 files changed, 1638 insertions(+), 161 deletions(-)
```

Commits on the branch (`$BASE..HEAD`):

| Hash | Message |
|---|---|
| `2482208` | feat(ui): add DS v2 token families, R6 v2 rules and the app length ratchet (preserved from the interrupted session) |
| `2318f06` | feat(ui): add catalog-ready scope labels and move the lagging stories to Bench/ |
| `8355475` | test(ui): prove the FastModeToggle, ModelPicker and SettingsScopeSentence contracts |
| `46266b1` | feat(ui): export the layout size family and show every DS v2 token family in stories |
| `1c54cf8` | docs(ui): rewrite the package README for Design System v2 |
| `34a7343` | test(ui): prove ModelPicker returns focus to the trigger on an outside close |
| `0f82973` | docs(ui): re-record the ratchet's base as the post-W8 integration tip |

## Steps vs brief

| Step | Status | What landed |
|---|---|---|
| 1 Colours | done | `colors.ts` and both `tokens.css` theme blocks gain `scrim` (`#fafafa8c`/`#0e0e0e8c`) and `successTint`/`warningTint`/`errorTint`/`accentTint` with the §4.2 values. `contrast.test.ts` parses `#rrggbbaa`, composites the scrim over `bg`, asserts ink-on-own-tint ≥ 4.5 (success/warning/error; `signalText` on `accentTint`), body `text` on every tint ≥ 4.5, and scrim alpha strictly in (0, 1). |
| 2 Lines | done | New `tokens/lines.ts`: the 8 shorthands with `lineVar`/`lineVarName`, declared identically in both theme blocks. `internal.ts` `RULE_BORDER`/`EDGE_BORDER`/`SIGNAL_EDGE`/`QUIET_EDGE`/`INSCRIBE` are now `lineVar(...)`; computed values unchanged. |
| 3 Elevation/layers | done | New `tokens/elevation.ts`: `elevation-plate`/`elevation-lift` in both blocks, the 8 layers in the light block only, `elevationVar`/`layer` helpers. `Composer` `zIndex: 2` → `layer('raised')`; `ModelPicker` `zIndex: 50` → `layer('popover')`, `fontWeight: 600` → `fontWeight('semibold')`. |
| 4 Spacing half-steps | done | `SPACING_STEPS` is the 16-step scale; `spacingVarName` maps `.`→`-`; `tokens.css` declares `--warsha-space-0-5: 2px`, `-1-5: 6px`, `-2-5: 10px`; `space(0.5/1.5/2.5)` return tokens. The zero-tolerance app spacing list is untouched (half-steps are ratchet-counted only). `tokens.test.ts` moved to the 16-step scale and to "exactly one tracking token, `code`", each with a DS v2 citation. |
| 5 Sizes/typography/breakpoints | done | `sizes.ts` gains the 23 layout tokens plus `layoutSizeNames`; `typography.ts` gains `--warsha-tracking-code: 0.2em`; new `breakpoints.ts` (`narrow 360`, `tablet 768`, `desktop 1024`, `wide 1440`, `maxWidth = bp − 1`, `MEDIA_PRELUDE_PX`), TS only. All re-exported from `tokens/index.ts`. |
| 6 R6 package rules | done | R6.7 unitless `fontWeight`/`zIndex`; R6.8 scans `compounds/internal.ts` and allows raw colours only in the two exact theme selectors (closes `:root :focus-visible`); R6.P parity covers `lines.ts`/`elevation.ts`. Each rule has a planted-violation fixture that fires and a clean fixture that stays clean. |
| 7 R6 app ratchet | done | R6.9/R6.10 scanners over `apps/{desktop,remote}/src/**/*.{ts,tsx,css}` (tests and comments excluded, `@media` prelude exemption set), `APP_LENGTH_BUDGET = 145` with the frozen `Math.min` env mechanics, planted + clean fixtures including a non-breakpoint `@media` value that must fire. |
| 8 Compounds | done | `ModelPicker`: keydown moved from `document` to the component root (trigger + listbox); Escape, selection and outside-close return focus to the trigger; optional `autoLabel`/`autoDescription` defaulting to today's English; DOM/test ids unchanged. `SettingsScopeSentence`: optional `globalLabel`/`projectLabel(name)`/`globalHint`/`projectHint` with today's English defaults; emoji `aria-hidden="true"`. Story titles `Compounds/*` → `Bench/*`. New `components/compounds.v2.test.tsx` (11 tests). |
| 9 Stories | done | `Tokens.stories.tsx` gains `Tints`, `Scrim`, `Lines`, `Layers`, `HalfSteps`, `LayoutSizes`, each through `FourCorners` (ar/en × light/dark). `Spacing` names half-steps with a dash; `Sizes` stays the bench facts and the layout family has its own story. |
| 10 README | done | Rewritten per DS v2 §7: Overview, Interface (primitives, all 23 compound families with story files, every token module and helper), Invariants (lamp rule, catalog-free, logical-only, machine data, cascade rule, R6.1–R6.10), Side Effects, Verification incl. `WARSHA_R6_APP_LENGTH_BUDGET`. |
| 11 Commits | done | Seven small Conventional Commits; nothing pushed, nothing merged. |

## Decisions

**DW3-1 — `APP_LENGTH_BUDGET = 145`, measured, never 0.** The count is 142 R6.9 lengths plus 3 R6.10
literal `var()` fallbacks. It was measured twice, by two independent implementations, at both the new
BASE `5abe5ef` and the original `0772d50`, and is identical at all four measurements:

1. the committed scanner, run with the env at zero so the failure prints the live count:
   `WARSHA_R6_APP_LENGTH_BUDGET=0 pnpm --filter @warsha/ui exec vitest run src/tokens/tokenDrift.test.ts -t "holds the live app length count"`
   → `expected 145 to be less than or equal to 0`;
2. a separate reimplementation of the §4.6 rules (comments stripped, `@media` prelude values in
   `{359, 767, 768, 1023, 1024, 1440}` blanked, `px`/`rem`/`em` counted, literal `var()` fallbacks
   counted) run over `git archive <base> apps/desktop/src apps/remote/src` (70 files) →
   `R6.9_LENGTHS 142`, `R6.10_FALLBACKS 3`, `TOTAL 145`.

The preserved session's `packets/W3/ratchet-base.txt` independently recorded `RATCHET_COUNT=145`, so
three measurements agree. INT-2 sets the constant to `0` after W5; W5's G5.7 runs with the env at 0.
The full list is Appendix A.

**DW3-2 — counting rule for a length inside a fallback.** A length inside a literal `var()` fallback
is counted once, as the R6.10 offence; the fallback is the defect and its `4px` is part of it, not a
second decision. This is documented in `scanAppLengths`. `ModelsSettings.tsx:470` has two `1px`
literals on one line, so its identical message appears twice and the 145 offences yield 144 distinct
message lines.

**DW3-3 — ModelPicker opening state.** Opening the picker highlights the selected option (v1
behaviour, index 1 with `Auto` at 0). The new tests assert from that state; ArrowUp at the top and
ArrowDown at the bottom wrap. Tab closes without trapping focus.

**DW3-4 — an outside-close test beyond the brief's list.** The brief enumerated Escape/Enter focus
return but not the outside-close path; the component implements all three, so the test file proves all
three.

**DW3-5 — SettingsScopeSentence defaults are byte-identical to today's English.** `projectLabel` is a
function of the project name; no catalog import (D9, catalog-free). The emoji become
`aria-hidden="true"`, so the accessible text is unchanged apart from no longer reading a glyph twice.

**DW3-6 — story titles.** `FastModeToggle`, `ModelPicker` and `SettingsScopeSentence` move from
`Compounds/` to `Bench/`, the group every other compound already uses (DS v2 §6).

**DW3-7 — `layoutSizeNames` export.** `sizes.ts` exports the 23 layout names as a typed
`satisfies readonly SizeTokenName[]` list so the story, the README and W5 can name the family without
duplicating it. The `Sizes` story filters them out (a 1400px cap is not a control height) and
`LayoutSizes` renders the family as inline-size bars.

**DW3-8 — the Spacing story's half-step names.** It previously built `var(--warsha-space-${step})`,
which would be wrong for `0.5` (the token is `--warsha-space-0-5`); it now uses `spacingVarName`.
This was a latent story bug, not a rendered-product change.

**DW3-9 — the four changed assertions in `compounds.test.tsx` are stricter, not weaker.** The
preserved commit replaced substring checks (`toContain('var(--warsha-size-inscribe) solid')`) with the
exact line token (`toBe('var(--warsha-line-inscribe)')`). The composition those substrings covered is
still pinned, in `tokenDrift.test.ts` (`lineTokens.inscribe` is `var(--warsha-size-inscribe) solid
currentColor`, and both theme blocks must declare it identically). This is the planned DS v2 §4.3
spec change.

**DW3-10 — GateCard's band spelling left alone.** It still writes
`` `${size('edge')} solid ${aliasVar('signalText')}` ``, whose computed value is exactly
`--warsha-line-signal`. §6's GateCard contract (`elevation-lift`, `line-signal` band) is satisfied at
the computed level; rewriting the spelling was outside the frozen step list and would only add churn.

**DW3-11 — R6.8 exemption is exact.** Raw colours are allowed only in blocks whose selector list is
exactly `:root, [data-theme='light']` or `[data-theme='dark']` after whitespace normalisation; the
planted `:root :focus-visible` fixture proves a selector that merely contains `:root` is scanned.

**DW3-12 — breakpoints are TS-only.** `breakpoints.ts` is exempt from CSS parity by design (a media
query cannot read a custom property); a test pins that no `--warsha-breakpoint-*` is declared.

**DW3-13 — Button's comment, not its metrics.** DS v2 published 0.5/1.5/2.5, so `sm`/`md` block
paddings now resolve to `--warsha-space-1-5`/`-2-5` with the same 6px/10px; `lg`'s 14px stays an
off-scale computed value. The comment now says so; no pixel moved.

**DW3-14 — rebase and base re-recording.** The branch was rebased from `0772d50` onto `5abe5ef`
(W8's settings-screen repair). The rebase was clean; the R6.9 count is identical at both bases, so
`APP_LENGTH_BUDGET` stays 145 and only the cited measurement commit changed (commit `0f82973`).

**DW3-15 — desktop unit count rose 443 → 446 for a reason outside W3.** W8 added three guarding tests
in `apps/desktop/src/screens/`; no W3 file is involved, and G3.6's floor (≥ 443) still holds.

## Gates

All twelve worktree gates were re-run after the rebase, at HEAD `0f82973` with
`BASE = 5abe5ef9cb4b107467155f8fb8bf61f086394ba4`. Real exit codes and counts follow.

| Gate | Frozen command | Result |
|---|---|---|
| G3.S | `git diff --name-only $BASE..HEAD \| grep -vE '^packages/ui/(src/\|\.storybook/\|README\.md$)' \| wc -l` | output **0** |
| G3.1 | `pnpm --filter @warsha/ui typecheck` | exit **0** |
| G3.2 | `pnpm --filter @warsha/ui lint` | exit **0** |
| G3.3 | `pnpm --filter @warsha/ui test` | exit **0** — 9 files, **181 passed**, 0 failed (≥ 170) |
| G3.4 | `pnpm --filter @warsha/ui build-storybook` | exit **0** (build output `packages/ui/storybook-static/` is untracked and was removed afterwards; the gate recreates it) |
| G3.5 | `pnpm -r typecheck` | exit **0** — crypto, client, i18n, ui, remote, desktop all Done |
| G3.6 | `pnpm --filter warsha-desktop test` | exit **0** — 47 files, **446 passed**, 0 failed (≥ 443; W8 added 3) |
| G3.7 | `pnpm --filter warsha-remote test` | exit **0** — 16 files, **221 passed**, 0 failed (≥ 221) |
| G3.10 | `git status --porcelain -- '*-snapshots/*' \| wc -l` | output **0** |
| G3.A | `node scripts/check-arch.mjs` | exit **0** — `arch: 5 rules, 0 violations` |
| G3.P | `node scripts/check-engineering-policy.mjs` | exit **0** — `policy: 8 checks, 0 failures` |
| G3.W | `node scripts/check-wire-contract.mjs` | exit **0** — `wire: 8 checks, 0 violations` |

An identical sweep at the pre-rebase base `0772d50` was also green (181 ui / 443 desktop / 221 remote);
only the post-rebase run above is offered as this packet's evidence.

**G3.8 and G3.9 were NOT run.** Both are `linux-capture-host` gates and cannot be executed from this
Windows worktree: G3.8 is `pnpm exec playwright test --project=desktop --reporter=line` (expects 793
passed / 0 failed) and G3.9 is `--project=remote` (expects 91 / 0). The verifier runs them on the
capture host. Per the orchestrator, G8.4 at the W8 commit measured the desktop suite green
(793 passed, 0 failed, 0 snapshot writes) — that is the orchestrator's measurement, not mine. G3.9's
remote 91/0 is a known owner decision: 40 remote baselines are stale product images (OD1), and no
snapshot was touched by this packet.

Reviewer check R3.1: reproduce the offence count at `$BASE` with the scanner in
`packages/ui/src/tokens/tokenDrift.test.ts`; it is 145 (Appendix A).

## Observations and open issues

**Pixel neutrality (D1).** `git diff --name-only $BASE..HEAD -- apps` is empty: no app file changed.
Every component-visible change is computed-identical: the five `internal.ts` borders now read
`var(--warsha-line-*)`, whose values are the same size + alias shorthands; `Composer`/`ModelPicker`
`zIndex` and `fontWeight` resolve to the same `2`/`50`/`600`; the half-step tokens are the same
2px/6px/10px; `SettingsScopeSentence`'s added attributes are ARIA-only and its default strings are
byte-identical; `ModelPicker`'s added props default to today's strings. Zero snapshot files changed
(G3.10 = 0), and no `--update-snapshots` was ever passed.

**Not run / not mine.** G3.8 and G3.9 are capture-host gates (above). The 8 settings-screen axe
failures belong to W8 and are fixed on this base; the 40 remote baseline diffs are the owner decision
OD1. `docs/ARCH_RULES.md`'s R6 wording is W2's deliverable — the package README points at it and does
not restate it as canonical.

**ModelPicker focus mechanics.** `closePicker` restores focus with
`document.getElementById(triggerId)?.focus()` because `Button` does not forward refs. It works (and
the tests prove it), but a future refactor should forward a ref rather than query the document. The
DOM and every `data-testid` are unchanged.

**Outside-close focus in a real browser.** The `mousedown` handler closes the picker and focuses the
trigger, as the brief requires. A real browser's default mousedown action can then move focus to
whatever was clicked, after the handler; jsdom cannot prove that ordering, and the visual suites do
not assert focus. This is a behaviour note for the capture-host review, not a pixel risk.

**R6.9 counts `matchMedia` literals.** A `px` string passed to `matchMedia` in app code is outside an
`@media` prelude, so it is an offence by the frozen rule; W5 should import `breakpoints.ts` instead.
The ratchet deliberately counts these rather than exempting them.

**Half-step token substitution.** `space(0.5)`/`space(1.5)`/`space(2.5)` now return
`var(--warsha-space-0-5)` etc. instead of the computed `2px`/`6px`/`10px`. No app or package test
asserted the computed string, and every suite is green; `space(3.5)` (14px) still computes.

**Wire check prints 8 checks.** G3.W requires exit 0 only; W4's new W9 check is what raises the count
to 9 on the integration branch.

**Deliberately left for Phase B (each changes captured pixels).** Tint adoption in status pills; Arabic
strings for `ModelPicker`/`SettingsScopeSentence` and removal of the English defaults (the props now
exist); removing the `accent` fill on non-waiting states; `opacity` → `text-muted`; `Tabs`, `Composer`
and `SettingsLayout` adoption; the four Wave-2 screens in `SCREENS`; daemon-true harness stub shapes;
`HandoffDialog` → `layer-modal`.

**Untouched by design.** `apps/**`, `**/*-snapshots/**`, `PLAN.md`/`PROGRESS.md`/`DECISIONS.md`,
`package.json`/lockfiles, `.github/**`, and every other packet's files.

**Blocker: none.**

## Appendix A — full R6.9/R6.10 offence list at BASE (145 offences)

Measured at `5abe5ef` (identical at `0772d50`) with the scanner in `tokenDrift.test.ts` and reproduced
by an independent implementation. One line per literal occurrence; `ModelsSettings.tsx:470` appears
twice because that line carries two `1px` literals.

```
R6: apps/desktop/src/components/BackendKitPanel.tsx:71 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/BackendKitPanel.tsx:101 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/BackendKitPanel.tsx:271 hardcoded length `3px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/BackendKitPanel.tsx:272 hardcoded length `3px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/BackendKitPanel.tsx:336 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/EcoModeToggle.tsx:80 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/ErrorBoundary.tsx:109 hardcoded length `480px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/ErrorBoundary.tsx:113 literal var() fallback `var(--warsha-size-rule, 1px)` (the token is always defined; drop the fallback, R6.10)
R6: apps/desktop/src/components/ErrorBoundary.tsx:115 literal var() fallback `var(--warsha-size-inscribe, 4px)` (the token is always defined; drop the fallback, R6.10)
R6: apps/desktop/src/components/ErrorBoundary.tsx:167 literal var() fallback `var(--warsha-size-rule, 1px)` (the token is always defined; drop the fallback, R6.10)
R6: apps/desktop/src/components/HandoffDialog.tsx:204 hardcoded length `32rem` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/HandoffDialog.tsx:209 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/HandoffDialog.tsx:275 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/HandoffDialog.tsx:276 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/HandoffDialog.tsx:343 hardcoded length `3px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/LivePreview.tsx:111 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/LivePreview.tsx:126 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/LivePreview.tsx:172 hardcoded length `320px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/LivePreview.tsx:174 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/LivePreview.tsx:189 hardcoded length `320px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/LivePreview.tsx:205 hardcoded length `320px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/LivePreview.tsx:247 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/LivePreview.tsx:283 hardcoded length `12rem` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/LivePreview.tsx:315 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/LivePreview.tsx:352 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/LivePreview.tsx:353 hardcoded length `3px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/MentionPicker.tsx:125 hardcoded length `13rem` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/MentionPicker.tsx:128 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/MentionPicker.tsx:175 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/PreviewToolbar.tsx:151 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/ProviderRow.tsx:41 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/ProviderRow.tsx:92 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/ProviderRow.tsx:187 hardcoded length `9rem` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/ProviderSetupWizard.tsx:213 hardcoded length `26rem` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/RoutineRow.tsx:107 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/SlashCommandPicker.tsx:130 hardcoded length `15rem` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/SlashCommandPicker.tsx:133 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/SlashCommandPicker.tsx:190 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/components/ThemeToggle.tsx:56 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/index.css:211 hardcoded length `1100px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/index.css:333 hardcoded length `360px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/index.css:402 hardcoded length `520px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/index.css:463 hardcoded length `240px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/index.css:597 hardcoded length `1400px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/AdvancedMode.tsx:1421 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/AdvancedMode.tsx:1635 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/AdvancedMode.tsx:1828 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/ArtifactViewer.tsx:185 hardcoded length `80px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/ArtifactViewer.tsx:198 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/ArtifactViewer.tsx:206 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/ArtifactViewer.tsx:382 hardcoded length `320px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/ArtifactViewer.tsx:385 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/ArtifactViewer.tsx:426 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/Budgets.tsx:183 hardcoded length `80px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/Budgets.tsx:184 hardcoded length `1000px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/CrashReports.tsx:144 hardcoded length `9rem` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/Devices.tsx:261 hardcoded length `80px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/Devices.tsx:262 hardcoded length `900px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/Devices.tsx:426 hardcoded length `420px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/Devices.tsx:432 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/Devices.tsx:467 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/Devices.tsx:480 hardcoded length `160px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/Devices.tsx:481 hardcoded length `160px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/Devices.tsx:495 hardcoded length `0.2em` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/GatesInbox.tsx:65 hardcoded length `3px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/GatesInbox.tsx:321 hardcoded length `80px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/GatesInbox.tsx:340 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/GatesInbox.tsx:348 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/GatesInbox.tsx:525 hardcoded length `3px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/HarnessesSettings.tsx:178 hardcoded length `900px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/ModelsSettings.tsx:237 hardcoded length `900px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/ModelsSettings.tsx:470 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/ModelsSettings.tsx:470 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/Onboarding.tsx:286 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/Onboarding.tsx:287 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/Onboarding.tsx:291 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/Onboarding.tsx:316 hardcoded length `32rem` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/Onboarding.tsx:412 hardcoded length `34rem` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/Onboarding.tsx:483 hardcoded length `34rem` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/Onboarding.tsx:554 hardcoded length `34rem` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/Onboarding.tsx:609 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/Onboarding.tsx:672 hardcoded length `34rem` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/PluginsSettings.tsx:193 hardcoded length `900px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/PluginsSettings.tsx:402 hardcoded length `140px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/PluginsSettings.tsx:419 hardcoded length `140px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/ProjectsBoard.tsx:384 hardcoded length `80px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/ProjectsBoard.tsx:460 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/ProjectsBoard.tsx:499 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/ProjectsBoard.tsx:559 hardcoded length `480px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/ProjectsBoard.tsx:565 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/ProvidersSettings.tsx:235 hardcoded length `80px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/ProvidersSettings.tsx:236 hardcoded length `900px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/ProvidersSettings.tsx:512 hardcoded length `3px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/RolesSettings.tsx:188 hardcoded length `80px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/RolesSettings.tsx:189 hardcoded length `1000px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/RolesSettings.tsx:258 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/RolesSettings.tsx:265 hardcoded length `12rem` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/RolesSettings.tsx:291 hardcoded length `12rem` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/RolesSettings.tsx:315 hardcoded length `7rem` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/RolesSettings.tsx:412 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/RolesSettings.tsx:415 hardcoded length `2px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/Routines.tsx:81 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/Routines.tsx:101 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/Routines.tsx:121 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/RunView.tsx:314 hardcoded length `80px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/RunView.tsx:330 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/RunView.tsx:422 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/RunView.tsx:451 hardcoded length `3px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/RunView.tsx:452 hardcoded length `3px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/RunView.tsx:478 hardcoded length `400px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/RunView.tsx:479 hardcoded length `400px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/RunView.tsx:480 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/RunView.tsx:487 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/RunView.tsx:577 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/RunView.tsx:582 hardcoded length `400px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SettingsProviders.tsx:182 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SettingsScreen.tsx:164 hardcoded length `900px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SettingsScreen.tsx:204 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SettingsScreen.tsx:215 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SettingsScreen.tsx:272 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SettingsScreen.tsx:502 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SettingsScreen.tsx:512 hardcoded length `12rem` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SimpleMode.tsx:389 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SimpleMode.tsx:406 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SimpleMode.tsx:912 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SimpleMode.tsx:920 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SimpleMode.tsx:952 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SimpleMode.tsx:1036 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SimpleMode.tsx:1136 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SimpleMode.tsx:1167 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SimpleMode.tsx:1287 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SimpleMode.tsx:1327 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SimpleMode.tsx:1344 hardcoded length `9rem` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SimpleMode.tsx:1362 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SimpleMode.tsx:1388 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SimpleMode.tsx:1498 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SimpleMode.tsx:1556 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SimpleMode.tsx:1622 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SimpleMode.tsx:1630 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SimpleMode.tsx:1691 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SimpleMode.tsx:1758 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SimpleMode.tsx:1878 hardcoded length `1px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/desktop/src/screens/SkillsSettings.tsx:168 hardcoded length `900px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/remote/src/index.css:389 hardcoded length `420px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
R6: apps/remote/src/index.css:498 hardcoded length `1100px` (use a --warsha-size-* / --warsha-space-* token, R6.9)
```

