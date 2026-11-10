# Worker prompt — W3 · Design System v2 in `packages/ui` (tokens, R6 v2, compounds, README) — Wave A

You are the IMPLEMENTER for packet W3 of run `2026-11-08-design-and-remediation` in the Warsha repo
(main checkout `C:/Users/Dragonfly/Downloads/Warsha`). A separate reviewer and verifier judge your work
against the frozen gates below; you must not edit, weaken or reinterpret them. Never ask questions:
decide, record the decision in your report, continue.

**Hard constraint — pixel-neutral.** Visual baselines are `maxDiffPixelRatio: 0`. Every token you add
must either be new (unused by the apps) or replace a value with the *identical* computed value. No
snapshot file may change. If a fix can only be made by changing pixels, do not make it — list it in
your report under "Phase B".

## 0. Read first
`AGENTS.md`; `ENGINEERING_POLICY.md` (§1 Phase 3, §5, §6); **`docs/designs/DESIGN_SYSTEM_V2.md`
§2.3, §4 (all), §5, §6, §7** — it is the spec, with exact names and values; `docs/ARCH_RULES.md` R6;
`packages/ui/src/tokens/*`, `packages/ui/src/compounds/{internal.ts,ModelPicker.tsx,SettingsScopeSentence.tsx,FastModeToggle.tsx,Composer.tsx}`;
run state `C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/state.json`.

## 1. Worktree and branch (Git Bash)
```bash
cd C:/Users/Dragonfly/Downloads/Warsha
git worktree add ../warsha-wt/w3 -b run/2026-11-08/w3-ui-v2 run/2026-11-08/integration
cd ../warsha-wt/w3
BASE=$(git rev-parse HEAD); echo "BASE=$BASE"
pnpm install --frozen-lockfile
pnpm --filter @warsha/ui test   # baseline: 8 files / 151 passed — record it
```

## 2. Scope
allowed_files: `packages/ui/src/**`, `packages/ui/.storybook/**`, `packages/ui/README.md`.

out_of_scope: `apps/**` (W5 migrates the apps — you only *measure* them), `packages/ui/package.json`
and any dependency or lockfile change, `docs/**` (W2 documents R6), snapshots, `.github/**`,
`PLAN.md`/`PROGRESS.md`/`DECISIONS.md`.

## 3. Steps
1. **Colours** (`colors.ts` + `tokens.css` both theme blocks): add `scrim`, `successTint`,
   `warningTint`, `errorTint`, `accentTint` with exactly the DS v2 §4.2 values
   (light `#fafafa8c #f1f7f3 #fbf5f0 #fbf2f1 #fffdf0`; dark `#0e0e0e8c #1b271d #2a2418 #2e1d1c #2e2a16`).
   Extend `contrast.test.ts`: the hex parser accepts `#rrggbbaa` (composite over `bg`); assert in both
   themes ink-on-own-tint ≥ 4.5 (`success`/`warning`/`error`; `accentTint` with `signalText`'s target),
   `text` on every tint ≥ 4.5, scrim alpha strictly between 0 and 1.
2. **Lines** — new `tokens/lines.ts` (`lineTokens`, `lineVar(name)`, `lineVarName`) with the 8 tokens
   of §4.3, declared in **both** theme blocks with identical text (cascade rule §4.1). Rewrite
   `compounds/internal.ts` `RULE_BORDER`, `EDGE_BORDER`, `SIGNAL_EDGE`, `QUIET_EDGE`, `INSCRIBE` to
   `lineVar(…)` (same computed value).
3. **Elevation and layers** — new `tokens/elevation.ts`: `elevation-plate`, `elevation-lift` (both
   theme blocks) and the 8 layers of §4.4 (light block only, unitless) with `layer(name)` helper.
   `Composer.tsx` `zIndex: 2` → `layer('raised')`; `ModelPicker.tsx` `zIndex: 50` → `layer('popover')`;
   `fontWeight: 600` → `fontWeight('semibold')`.
4. **Spacing half-steps** — `SPACING_STEPS` gains `0.5, 1.5, 2.5`; `spacingVarName` maps `.` → `-`
   (`--warsha-space-0-5: 2px`, `-1-5: 6px`, `-2-5: 10px`); `space(1.5)`/`space(2.5)` now return tokens.
   Do **not** add 2/6/10px to R6's zero-tolerance app spacing list (they are ratchet-counted, step 7).
   Any `tokens.test.ts` assertion pinned to the 13-step scale is updated to the 16-step scale — a
   planned spec change (cite DS v2 §4.5 in the test comment), never a loosening of another assertion.
5. **Sizes and typography** — `sizes.ts`: the 23 layout tokens of §4.5 with the exact values;
   `typography.ts`: `--warsha-tracking-code: 0.2em` (one tracking token; update the `tokens.test.ts`
   "no tracking token" assertion to "exactly one tracking token, `code`" — a planned spec change, cite
   DS v2 §2.3 in the test comment). New `tokens/breakpoints.ts` (`narrow 360, tablet 768, desktop 1024,
   wide 1440`, `maxWidth(bp) = bp − 1`), TS only, explicitly exempt from CSS parity. Export every new
   module from `tokens/index.ts`.
6. **R6 package rules** (`tokenDrift.test.ts`): R6.7 unitless `fontWeight: <digits>` / `zIndex: <digits>`
   in package UI files; R6.8 add `compounds/internal.ts` to the package scan and accept raw colours only
   in blocks whose selector list is exactly `:root, [data-theme='light']` or `[data-theme='dark']`
   (closes `:root :focus-visible`); R6.P parity covers `lines.ts` and `elevation.ts`. Each new rule gets a
   planted-violation fixture that must fire and stays clean on the clean fixture.
7. **R6 app ratchet** — R6.9: scan `apps/desktop/src/**` and `apps/remote/src/**` `.ts/.tsx/.css`
   (tests and comments excluded); every `px`/`rem`/`em` length is an offence except inside an `@media`
   prelude whose value ∈ {359, 767, 768, 1023, 1024, 1440}px. R6.10: a literal `var()` fallback
   (`var(--warsha-…, <literal>)`) is an offence. Count offences (one per literal occurrence) at `$BASE`,
   set `const APP_LENGTH_BUDGET = <that count>;` and implement exactly:
   ```ts
   const envBudget = Number(process.env.WARSHA_R6_APP_LENGTH_BUDGET);
   const budget = Number.isFinite(envBudget) ? Math.min(APP_LENGTH_BUDGET, envBudget) : APP_LENGTH_BUDGET;
   expect(offences.length, offences.join('\n')).toBeLessThanOrEqual(budget);
   ```
   Record the count, and the full offence list, in your report — the reviewer reproduces it at `$BASE`.
   Planted + clean fixtures for R6.9 and R6.10 (including the `@media` exemption and a
   non-breakpoint `@media` value that must fire).
8. **Compounds, pixel-neutral only** —
   - `ModelPicker`: move the `keydown` listener from `document` to the component (trigger + listbox),
     return focus to the trigger on Escape/selection/outside-close; add optional `autoLabel` and
     `autoDescription` props defaulting to today's English strings ("Auto", "Uses the role routing
     configured in settings"); keep DOM/test ids unchanged.
   - `SettingsScopeSentence`: optional `globalLabel`, `projectLabel(name)`, `globalHint`, `projectHint`
     props defaulting to today's English; the emoji gets `aria-hidden="true"`.
   - Story titles `Compounds/FastModeToggle|ModelPicker|SettingsScopeSentence` → `Bench/…`.
   - Tests (new file `src/components/compounds.v2.test.tsx` or extend the existing three): FastModeToggle
     (tier cycle order, accessible label = "label — hint"), ModelPicker (open/close, arrow wrap, Enter
     selects, Escape closes **and focus returns to the trigger**, keydown outside the picker is ignored,
     custom `autoLabel` renders), SettingsScopeSentence (default + custom labels, emoji `aria-hidden`).
9. **Stories** — `Tokens.stories.tsx` shows the new families (tints with their ink, scrim over a plate,
   lines, layers table, half-steps, layout sizes) in both themes and directions.
10. **`packages/ui/README.md`** — rewrite per DS v2 §7 (Overview, Interface incl. all 23 compounds and
    every token module/helper, Invariants incl. R6.1–R6.10 summary and the cascade rule, Side Effects,
    Verification incl. `WARSHA_R6_APP_LENGTH_BUDGET`).
11. Small Conventional Commits (`feat(ui): …`, `test(ui): …`, `docs(ui): …`). Do not push.

## 4. Frozen verification gates
Each gate is one command; expected result in the comment above it. Gates G3.8/G3.9 run on the Linux
capture host (`/root/warsha-visual` checkout of this branch, pinned fonts) by the verifier.
```bash
# G3.S scope — expect output: 0
git diff --name-only $BASE..HEAD | grep -vE '^packages/ui/(src/|\.storybook/|README\.md$)' | wc -l
# G3.1 / G3.2 — expect exit 0 each
pnpm --filter @warsha/ui typecheck
pnpm --filter @warsha/ui lint
# G3.3 — expect exit 0 and "Tests  N passed" with N >= 170, 0 failed
pnpm --filter @warsha/ui test
# G3.4 — expect exit 0
pnpm --filter @warsha/ui build-storybook
# G3.5 — expect exit 0 (apps still compile against the changed package)
pnpm -r typecheck
# G3.6 / G3.7 — expect exit 0 with >= 443 and >= 221 passed, 0 failed
pnpm --filter warsha-desktop test
pnpm --filter warsha-remote test
# G3.8 (Linux capture host) — expect 793 passed, 0 failed, equal to the G0 baseline
pnpm exec playwright test --project=desktop --reporter=line
# G3.9 (Linux capture host) — expect 91 passed, 0 failed
pnpm exec playwright test --project=remote --reporter=line
# G3.10 no snapshot touched — expect output: 0
git status --porcelain -- '*-snapshots/*' | wc -l
# G3.A / G3.P / G3.W — expect exit 0 each
node scripts/check-arch.mjs
node scripts/check-engineering-policy.mjs
node scripts/check-wire-contract.mjs
```
Reviewer check R3.1 (not a command you run): `APP_LENGTH_BUDGET` equals the offence count the reviewer
measures with your scanner at `$BASE`.

## 5. Report and stop
Write `C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W3/report.md`:
BASE, HEAD, `git diff --stat $BASE..HEAD`, `APP_LENGTH_BUDGET` + the offence list, decisions, Phase B
items you deliberately did not do, your own gate run with exit codes (not evidence), open issues.
Out-of-scope need → stop with a blocker `{kind: out-of-scope, reason, needs}`. No edits to
`PLAN.md`/`PROGRESS.md`/`DECISIONS.md`; no merge; no push.
