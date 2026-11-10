# W5 review — apps adopt DS v2 + live Routines/BackendKit

- Worktree `C:/Users/Dragonfly/Downloads/warsha-wt/w5`, branch `run/2026-11-08/w5-apps-adoption`
- Range **BASE `406240a`..HEAD `10a1819`** (5 commits)
- Verified diff stat (mine): **45 files changed, +815 / −188** — matches `packets/W5/report.md`.
- Reviewer did not edit implementation, did not run `--update-snapshots`, did not push.

## 1. Scope — PASS

`git diff --name-only 406240a..HEAD` lists 45 paths, all inside
`apps/desktop/src/**`, `apps/desktop/real-acceptance.cjs`, `apps/remote/src/**`,
`packages/i18n/src/**`. Zero paths under `packages/ui/**`, `packages/client/**`,
`apps/desktop/e2e/**`, `*-snapshots/*`, `pnpm-lock.yaml`, `.github/**`, or
PLAN/PROGRESS/DECISIONS. No lockfile or snapshot change.

## 2. Ratchet zero — MEANINGFUL (verified, not vacuous)

- Ran `WARSHA_R6_APP_LENGTH_BUDGET=0 pnpm --filter @warsha/ui test` at HEAD: **exit 0**,
  9 files / **181 tests passed**.
- The budget is applied as `Math.min(APP_LENGTH_BUDGET, envBudget)`
  (`packages/ui/src/tokens/tokenDrift.test.ts:1017-1019`), so `0` really tightens to zero and
  the assertion `expect(offences.length).toBeLessThanOrEqual(budget)` (line 1020) fails on any
  offence.
- The scan is genuine: `appRatchetFiles()` walks `apps/desktop/src` and `apps/remote/src`
  (lines 918-940) and the guard test at 1022-1027 requires both `index.css` files and forbids
  test files from counting, so the rule cannot pass by scanning nothing.
- Can it fail? Yes, proven by code I read, not only by the report: in-suite planted probes at
  `tokenDrift.test.ts:1030-1041` (`16px`/`0.875rem`/`0.2em` → 3 offences; tokens → 0) and
  `1043-1058` (non-breakpoint prelude fires). I relied on those plus the report's out-of-suite
  probe (`__ratchet-probe.ts` → exit 1, deleted → exit 0), which the scanner corroborates.
- Note (not a blocker): the pinned `APP_LENGTH_BUDGET` is still 145 (`:1008`); the zero is only
  enforced under the env var. INT-2 is scheduled to pin it to 0 (`:1003-1007`).

## 3. Pixel neutrality (D1) — PASS on every substitution checked

Token values read from `packages/ui/src/tokens/tokens.css` (single root block; the dark block at
238-282 redefines only colours, so all sizes resolve identically in both themes).

| Literal replaced | Token | Resolved value |
| --- | --- | --- |
| `maxInlineSize: '900px'` (`SettingsScreen.tsx:164`) | `--warsha-size-plate-max` | `900px` (tokens.css:139) |
| `max-inline-size: 1100px` (`apps/remote/src/index.css:496`) | `--warsha-size-content-max` | `1100px` (:141) |
| `max-inline-size: 1400px` (`apps/desktop/src/index.css:595`) | `--warsha-size-content-wide` | `1400px` (:142) |
| `flex: '1 1 12rem'` (`SettingsScreen.tsx:519`) | `--warsha-size-field-min` | `12rem` (:151) |
| `border: '1px solid var(--warsha-bench-rule)'` (many) | `--warsha-line-rule` | `--warsha-size-rule` solid `--warsha-bench-rule`; rule=`1px` (:116), bench-rule=`#e5e7eb` light / `#2e2e2e` dark (:74/:265) — identical both themes |
| `border: '1px solid var(--warsha-bench-edge)'` / `…size-rule,1px) solid var(--warsha-color-border-strong)` | `--warsha-line-edge` | `1px` solid `--warsha-bench-edge` = `#d1d5db` / `#404040` (:75/:266) |
| `borderInlineStart: '3px solid var(--warsha-color-error)'` | `--warsha-line-band-fail` | `--warsha-size-edge`=`3px` (:117) solid error — width and colour preserved |
| `letterSpacing: '0.2em'` (`Devices.tsx:495` region) | `--warsha-tracking-code` | `0.2em` (:210) |
| `min(360px, …)` / `min(60vh,520px)` / `min(240px,70vw)` / `min(48vh,420px)` | popover / popover-block / strip-item / sheet-block | `360px` / `520px` / `240px` / `420px` (:157-160) |
| `480px`, `420px`, `400px`, `160px`, `320px`, `26rem`, `32rem`, `34rem`, `9rem`, `13rem`, `15rem`, `7rem`, `140px`, `100vh - 80px` | notice, form-narrow, pane, qr, preview-min, wizard, dialog, dialog-wide, measure-compact, picker, picker-wide, label-col, input-min, bench-offset | each token is the exact literal (`:130-162`) |

- RTL/logical sites were the target, not a casualty: `borderBlockEnd`/`borderInlineEnd`/
  `borderInlineStart` keep the same logical property and only the shorthand value moved
  (`SettingsScreen.tsx:215,272,509`, `RunView.tsx:486`). `flex`/`maxWidth` (`RunView.tsx:470-472`)
  and both QR axes (`Devices.tsx`) were already literal-identical at BASE.
- `borderInlineStartWidth: 'var(--warsha-size-inscribe, 4px)'` → no fallback: token is declared
  `2px` (`:117`) in both themes, so the value is unchanged; the only spot where fallback text
  and token differ.
- `HandoffDialog` scrim `color-mix(muted 55%)` → `--warsha-color-scrim` is a declared,
  spec-sanctioned colour change (D-W5-5) on a backdrop no screenshot captures open; disclosed,
  not claimed bit-identical.
- No snapshot file is in the diff, so the 308/252 baselines cannot have been rewritten here.

## 4. W8 invariant — INTACT

`apps/desktop/src/screens/SettingsScreen.tsx:323` still renders
`{label('connectors.desc')}` as plain text, and `:325-326` still gates the Ledger on
`integrations.length > 0 && (<Ledger …`)`. The only edits to that file are four line/shorthand
and two size substitutions in style objects (lines 164, 204, 215, 272, 509, 519). No structural
revert.

## 5. Report honesty — PASS with one wording nit

- G5.11 is presented as **blocked on OD1** in the gate table ("blocked on OD1 … not attempted")
  and again in Open issues 1; I found no sentence claiming the remote suite green or G5.11
  satisfied. Consistent with the 40 stale remote baselines.
- G5.10 is explicitly "not run here … orchestrator", expected 793/0 — correctly not claimed as
  the packet's own evidence. The pixel-neutrality claim therefore rests on the orchestrator's
  capture run plus the token values above.
- Desktop count, re-run by me: `pnpm --filter warsha-desktop test` → **exit 0, 50 files,
  464/464 tests passed** (≥ the required 451). Matches the report's 446 → 464.
- No test deleted or weakened: the single `- it(...)` line in the diff is a rename in
  `apps/remote/src/styles.test.ts:71-74`, and its assertion was strengthened from
  `/max-inline-size:\s*1100px/` to `/max-inline-size:\s*var\(--warsha-size-content-max\)/`.
  19 new `it(`/`test(` blocks; no `.skip`, `.only`, or `.todo` added.
- No `any` added in the diff.
- User-visible text: the 11 new strings exist in both `ar` and `en`
  (`packages/i18n/src/index.tsx:572-577, 600-604, 1758-1763, 1785-1789`); no new English JSX
  literal or quoted sentence in `App.tsx` / `routines.ts` / `backendKit.ts`. The export-disabled
  reasons are catalog keys (`backend.export.no_run`, `backend.export.unavailable`).

### Minor (non-blocking)

- M1 `packets/W5/report.md` G5.7 §1 says the pre-migration assertion read
  "expected 145 to be less than or equal to 0"; the constant is 145 and the count at BASE was
  145, so the sentence is ambiguous about which number 145 is. Harmless but could mislead.
- M2 (see §2) the pinned budget stays 145 until INT-2; the zero is env-gated, as the report states.
- M3 `HandoffDialog` scrim is a genuine colour delta (D-W5-5); accepted because it is outside
  every captured state, but it is the one non-bit-identical substitution.

VERDICT: APPROVE

## RE-REVIEW after repair iteration 2 (OD4 resolved)

Range `406240a`..HEAD `77a02c1`; repair = single commit `77a02c1` on approved `10a1819`.

**Scope — PASS.** `git show --name-only 77a02c1` = `apps/desktop/src/screens/GatesInbox.tsx`,
`apps/desktop/src/screens/GatesInbox.test.tsx` only (2 files, +7/−3). The frozen spec is untouched:
`git diff 406240a..HEAD --name-only | grep -c states.spec.ts` → **0**.

**1. Ratchet zero is genuine, not vacuous.** `WARSHA_R6_APP_LENGTH_BUDGET=0 pnpm --filter @warsha/ui test`
→ exit 0 (181 passed / 9 files). `tokenDrift.test.ts:1013` counts `appRatchetFiles()`;
`:183-199` walks `APP_DIRECTORIES = ['apps/desktop/src','apps/remote/src']` (`:97`) and `:1029`
asserts both `index.css` files are in the set, so the scan cannot pass by scanning nothing.
Budget is `Math.min(145, env)` (`:1017-1019`) — env can only tighten. `:1030` proves the scanner
fires on a planted `16px`/`0.875rem`/`0.2em`.

**2. Emitted text still satisfies the frozen regex.** `sizeTokens.edge === '3px'`
(`packages/ui/src/tokens/sizes.ts:23`), so the template yields exactly
`3px solid var(--warsha-bench-edge)` (GatesInbox.tsx:65-67, :528) matching
`states.spec.ts:132` `/border-inline-start:\s*3px solid var\(--warsha-bench-edge\)/`.
The number still comes from the token layer, not a magic literal.

**3. Unit test remains meaningful.** `GatesInbox.test.tsx:182-183` now asserts the plate edge
token *and* `/^3px solid /` on the same inline style — strictly stronger than the old
`--warsha-line-band` check, not a tautology (it reads rendered output, not the constant).
No test deleted or skipped in the packet; the one `it(` touched elsewhere is a rename
(`apps/remote/src/styles.test.ts:74`, "1100px" → "content-max"), still present.

**4. Hygiene — PASS.** `pnpm --filter warsha-desktop test` exit 0, **464 passed** (50 files, ≥451).
`git status --porcelain -- '*-snapshots/*' | wc -l` → `0`. No `any` added; no dependency,
lockfile, `.github` or snapshot change; no user-visible string added (inline style only); nothing
pushed.

**Findings:** none new. M1–M3 from iteration 1 stand as before.

VERDICT: APPROVE
