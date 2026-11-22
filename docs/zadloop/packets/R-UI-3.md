# R-UI-3 — polish before pixels: D3 Arabic type scale, D2 sound cue, D1 micro-interactions

Status: spec frozen. Base: `eabcecb` (R-UI-2 merged) on `repair/dev-csp-f474776`. Depends on R-UI-1 (v3 floor green) and
R-UI-2. Must land **before** R-UI-4 (genesis baselines): D3 moves existing pixels, D1 adds visible states. UI only —
**no Rust, no wire, no new RPC method, no v2 file, no baselines**. Gate tool path
`<TOOLS>` = `/home/moe/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3/tools` (git-ignored, absent from worktrees —
call by absolute path; do not copy into the repo, do not edit). Requirement source: REVIEW §5.x table rows D1–D3
(`bridge-io/policy/2026-11-10-principal-review/REVIEW.md:352-354`) and the type finding at `REVIEW.md:186-187`;
`R-UI-RUN-PLAN.md` §3 outline.

## Why (measured on `eabcecb`, 2026-11-15)

| # | Fact | Evidence |
|---|---|---|
| W1 | `text-sm` is 14px / 22px = **1.571**, below the §2.2 rule "Arabic body line-height is never below 1.6". Only `text-md` (26/16 = 1.625) meets it; `text-lg` is 28/18 = 1.556 (see W2). Advanced density defaults to `text-sm` (`--w-table-text-size/--w-table-line-height`, `tokens.css:179-180`). | `packages/ui/src/v3/tokens/type.ts:15-33`; `tokens.css:36-50` |
| W2 | Ratios today: xs 18/12 = 1.50, sm 1.571, md 1.625, lg 28/18 = **1.556**, xl 32/22 = **1.455**, 2xl 40/28 = **1.43**, 3xl 48/36 = **1.33**. Titles (xl–3xl) are tight for vocalised two-line Arabic. | `type.ts` |
| W3 | Sizes and line heights are **px** strings in TS and `tokens.css`; they ignore the user's root font size. `tokens.test.ts:72-78` asserts the TS value text appears in the CSS (so TS stays the source). | `type.ts`, `tokens.css:36-50`, `tokens.test.ts:67-82` |
| W4 | 31 inline `lineHeight: 'var(--w-line-height-*)'` consumers in `packages/ui/src/v3` + `apps/desktop/src/v3` (grep `lineHeight`); remote reads it at `apps/remote/src/index.css:38-39` and `styles.test.ts:55`. Consumers use the variable, so a token-only change re-flows them all — that is the pixel move baselines must see. | grep |
| W5 | `dir="auto"` on user text is partial: present on bench Assistant/Plan, Frame switcher, Inbox:616, many `<bdi dir="auto">`; **absent** from `Composer` (the user's own prompt box), `TextField`, `DecisionCard` (0 `dir=` matches each). | grep `dir=` in `packages/ui/src/v3/{composites,primitives}` |
| W6 | `prefers-reduced-motion` only sets `--w-dur-fast/--w-dur/--w-dur-slow` to 0ms (`tokens.css:183-190`; `tokens.test.ts:132`). The three looping animations use **literal** durations and are unaffected: `Spinner.tsx:50` (`w-spin 0.8s`), `Skeleton.tsx:42` (`w-pulse 1.5s`), `ProgressBar.tsx:66` (`w-progress-indeterminate 1.5s`). | files cited |
| W7 | **Those three `@keyframes` are defined nowhere** (`grep "w-spin\|w-pulse\|w-progress-indeterminate"` hits only the three `animation:` lines — no CSS, no crates). The v3 spinner, skeleton shimmer and indeterminate bar do not move today. | grep over `packages apps crates` |
| W8 | Motion today = colour/opacity/transform transitions at `--w-dur-fast` on 20 files; **no press state** (`Button.tsx` has no `:active`/pressed style; inline styles cannot express it), **no Sheet enter/exit** (`Sheet.tsx` returns `null` when closed and mounts with no transition), Stepper has a `background-color var(--w-dur)` transition only (`Stepper.tsx:122`). | grep `transition`, `Sheet.tsx:111-150` |
| W9 | **No sound code**: no `AudioContext`/`new Audio` in `apps/desktop/src`; no audio asset is tracked (`git ls-files | grep -c "\.wav\|\.mp3\|\.ogg"` → 0). | grep |
| W10 | The only app-level "decision waiting" number is `Frame.tsx:144` `totalWaiting` → `inboxCount`, computed in an effect keyed on `[client, projectsResult.data]` (`Frame.tsx:107-168`): it refreshes only when the project list changes, **not** on events. Run events exist per run (`data/useRunEvents.ts`, `subscribeRun`); `EventKind` has `stage_started/stage_completed/gate_decision/…` but **no `run_finished` kind** (`crates/warsha-core/src/lib.rs:275-288`). Terminal state is `RunSummary.status ∈ completed|cancelled|failed` (`Frame.tsx:128-131`). | files cited |
| W11 | The preferences RPC stores **decaying taste signals** (`SignalKind` = approve/reject/change_request/edit; `score` = decayed weighted sum, `preferences.rs:15-20,65-74`). A boolean device setting does not fit it: its score decays toward 0. `GeneralSection` already works around this for the budget with a `localStorage` fallback (`GeneralSection.tsx:22-34,107-115`). | files cited |

## Goal

Arabic text meets the 1.6 line-height rule at every body size and has room for vocalised titles; sizes follow the user's
root font size; user-typed text picks its own direction; there are exactly two optional sound cues (OFF by default, one
Settings switch, never the only signal); press, Sheet and Stepper have small motion that is fully static under
`prefers-reduced-motion`, and the three looping animations exist and obey it.

## Design (frozen decisions; defaults applied — the PM may strike any before dispatch)

### D3 — type scale
- **D3-a (rem + unitless, TS stays source of truth).** `fontSizes` become rem (`xs 0.75rem · sm 0.875rem · md 1rem ·
  lg 1.125rem · xl 1.375rem · 2xl 1.75rem · 3xl 2.25rem`; same pixel sizes at the default 16px root). `lineHeights`
  become **unitless ratios**: `xs 1.6 · sm 1.65 · md 1.6 · lg 1.6 · xl 1.55 · 2xl 1.5 · 3xl 1.4`.
  Result at 16px root: xs 19.2 · sm 23.1 · md 25.6 · lg 28.8 · xl 34.1 · 2xl 42 · 3xl 50.4 px. Every body step
  (xs–lg) ≥ 1.6; titles 1.4–1.55 chosen so a two-line vocalised sample clears the diacritic stack (verified by D3-d, not
  by taste). `tokens.css` mirrors TS exactly (`tokens.test.ts` keeps proving it); no px left in `--w-font-size-*` /
  `--w-line-height-*`.
- **D3-b (consumers).** No consumer edit is expected: they read the variables, and unitless `line-height` inherits as a
  ratio. `--w-table-line-height` stays `var(--w-line-height-sm|md)`. Control heights (44/32) are separate tokens and do
  not change; if any fixed-height control now clips its label, that is a **STOP-and-report** (do not shrink the text
  back, do not add an exemption).
- **D3-c (direction).** Add `dir="auto"` to the user-text inputs of `Composer` (textarea) and `TextField` (input /
  textarea) and to `DecisionCard` user-supplied text spans (title/summary that originate from user/agent text), via a
  prop-less default (not opt-in) so every call site gets it. Do not add it to labels from catalogs. IDs/paths/URLs/code
  keep `<bdi>`/`.w-ltr` (§2.6 — unchanged).
- **D3-d (vocalised check, proof not opinion).** A unit test renders `Card` title, `DecisionCard` title,
  `SettingsSection` title and the page-title class with a two-line fully vocalised string
  (e.g. «إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ وَلِكُلِّ امْرِئٍ مَا نَوَى») inside a 240px container and asserts, from computed
  style, `lineHeight ÷ fontSize ≥ 1.4` for xl–3xl and `≥ 1.6` for xs–lg; the **visual** check of the same sample is a
  documented screenshot in the report (not a baseline, not committed under `*-snapshots`).
- **D3-e (docs).** `docs/designs/DESIGN_SYSTEM_V3.md` §2.2 table is rewritten to the rem/ratio values above and states the
  px equivalents at 16px root.

### D2 — sound cue
- **D2-a (what).** Exactly two cues: `decision-waiting` and `run-finished`. Synthesised with the Web Audio API
  (`AudioContext` + one short `OscillatorNode` envelope each: waiting = two-note rise ~180ms, finished = single soft
  note ~140ms, gain ≤ 0.12). **No audio asset, no new dependency.** Created lazily on the first cue only after the
  switch is on (autoplay-policy safe: `resume()` inside the first user-gesture-free path is attempted and failure is
  swallowed — a cue is best-effort).
- **D2-b (setting).** One switch in Settings › General (`GeneralSection.tsx`), action id `settings.sound-cues.set`
  (`effect: 'state'`, registry in `actions/registry/settings.ts`), i18n keys `settings.general.sound` and
  `settings.general.sound.desc` in **ar and en**. Default **OFF**. A first-time user hears nothing, ever, until they
  switch it on.
- **D2-c (storage — deviation from the outline, root-caused W11).** The outline said "stored through the existing
  preferences RPC". That RPC decays signals (W11), so a boolean would silently turn itself off. Default applied:
  **device-scoped `localStorage` key `warsha.sound_cues` (`'on'`/absent), exactly like theme/mode**
  (`ThemeContext.tsx:20,54`, `DensityContext.tsx`), and the Settings scope chip reads `settings.scope.device` (already
  used by General). **No daemon write, no RPC.** If the PM insists on the RPC, that is a separate decision that needs a
  non-decaying key/value method — out of scope here; do not abuse `recordPreference`.
- **D2-d (never the only signal).** Every cue is paired with a signal that already exists and is unchanged: the Frame
  inbox badge/count (`inboxCount`) for a waiting decision, the run status chip / `completed` state for a finished run.
  No new visual is added *for* the cue and none is removed *because* of it. A test asserts the sound hook is a pure
  observer (renders nothing, mutates no state of the observed pages).
- **D2-e (where it hooks — see gap G1).** `apps/desktop/src/v3/app/useSoundCues.ts` (+ `SoundCuesContext` or a plain hook
  mounted once in `V3App.tsx`/`Frame.tsx`) takes two inputs and plays a cue only on a **rising edge, never on first
  load**: (1) `inboxCount` increasing (the existing `Frame.tsx:144` number); (2) a run in `runsByProject` transitioning
  non-terminal → `completed`. It never polls, never calls a new RPC, and dedupes by `runId`/count so a re-render or
  reconnect cannot repeat a cue.
- **D2-f (reduced motion ≠ sound).** `prefers-reduced-motion` does not change sound; the switch is the only control.

### D1 — micro-interactions
- **D1-a (keyframes exist).** Define in `tokens.css` the three missing keyframes — `w-spin`, `w-pulse`,
  `w-progress-indeterminate` (translate along the **inline** axis; mirrored under `[dir="rtl"]`, no `left/right`) — and
  make the three components reference them (their `animation:` strings stay; add CSS only).
- **D1-b (reduced motion for loops).** Under `@media (prefers-reduced-motion: reduce)` in `tokens.css`: `.w-spinner`,
  skeleton and indeterminate bar get `animation: none`; the spinner shows as a static ring **with its text label** (the
  §2.4 rule: no infinite spinner without text), skeleton as a static sunken block, indeterminate bar as a static
  partially filled bar. The existing duration collapse stays.
- **D1-c (press).** `.w-button:active:not(:disabled)` → `transform: scale(0.98)` over `--w-dur-fast`; disabled/loading
  buttons do not scale. Implemented as a class rule in `tokens.css` (inline styles cannot express `:active`); the
  same rule covers `IconButton`/`Segmented` item if they share `.w-button`; otherwise only `Button` (state which).
- **D1-d (Sheet).** `Sheet` enters with a one-shot inline-axis slide + scrim fade over `--w-dur-slow`
  (`@keyframes w-sheet-in`, direction from `side` and mirrored by `[dir="rtl"]` via the `w-sheet--start|end` class it
  already emits); **no exit animation** (the component unmounts when `open=false`; adding exit means a state machine —
  not worth the risk before baselines). Focus trap and `Escape` behaviour (`Sheet.tsx:60-107`) are not touched.
- **D1-e (Stepper advance).** When a stage's `state` changes to `done`, its marker runs a one-shot `w-step-done`
  (scale 0.85→1 + the existing background transition) over `--w-dur`; implemented by a `data-state` attribute on the
  marker and a CSS rule, no React state. No animation on first render.
- **D1-f (the guard).** Every motion above reads `--w-dur-*`/`--w-ease` or sits inside a rule that
  `prefers-reduced-motion: reduce` overrides to `animation: none; transform: none`. A unit test fails if any new
  `animation`/`transform` rule in `tokens.css` lacks a reduced-motion counterpart.

## Allowed files (narrow)

Tokens/docs: `packages/ui/src/v3/tokens/{type.ts,tokens.css,tokens.test.ts}`, `docs/designs/DESIGN_SYSTEM_V3.md` (§2.2
and §2.4 only). UI: `packages/ui/src/v3/primitives/{Button,Spinner,Skeleton,ProgressBar,TextField}.tsx` (+ tests; only
if the file exists under that name — `TextField` may live in `composites/`; use whichever file `git grep -l "export.*TextField"`
returns) and `composites/{Composer,DecisionCard,Sheet,Stepper}.tsx` (+ tests, stories only if a story asserts the
changed value). Desktop: `apps/desktop/src/v3/app/{useSoundCues.ts,useSoundCues.test.ts,soundCues.ts,soundCues.test.ts,
V3App.tsx,V3App.test.tsx}`, `apps/desktop/src/v3/pages/frame/Frame.tsx` (hook mount / input wiring only),
`apps/desktop/src/v3/pages/settings/sections/GeneralSection.tsx` (+ its test), `apps/desktop/src/v3/actions/registry/settings.ts`,
`packages/i18n/src/v3/{ar,en}/settings.ts`, `apps/remote/src/styles.test.ts` **only if** it breaks on the new ratio (it asserts
`var(--w-line-height-lg)`, which still holds — expect no edit), e2e: one new file `apps/desktop/e2e/v3/polish.spec.ts` and
the minimum edits to `apps/desktop/e2e/v3/settings.spec.ts` for the new switch; report `docs/zadloop/packets/R-UI-3-report.md`.
Anything else (including a one-line fix elsewhere) is a stop-and-report.

## Out of scope

R-UI-4 (any `*-snapshots/**`, baselines, `--update-snapshots`, remote e2e CSP repair); the remote PWA beyond inheriting
the token change; Rust/wire/daemon (incl. a non-decaying settings RPC, a `run_finished` event kind, polling or event
push for the Frame); B4b, B6, Stage B / `lib.rs`; v2 files (`apps/desktop/src/screens/**`, `apps/desktop/e2e/harness.ts`,
`packages/ui/src/tokens/**`); colours/contrast values; new dependencies; new audio assets; exit animations; page
transitions.

## Constraints

Isolated worktree, branch `zl-rui3-*`; implementer never authors gates; separate reviewer/verifier; small Conventional
Commits; self-review every diff; mock provider only. Strict TS, **no `any`** (cast through `unknown` + guards for
`AudioContext`/`webkitAudioContext`), ESLint + Prettier clean, no new lint warning. **UI strings only through the i18n
catalogs, ar + en both** (the two new keys; Arabic text must contain no Latin, `i18n-gate` I4). **Logical CSS only**
(`inline-*`/`block-*`; `check-ds-v3` bans `left/right`, px literals in media queries, raw hex). **Sound OFF by default
(D2)**; **reduced motion respected (D1)**. No baselines created or touched (`git ls-tree` under `*-snapshots` stays empty;
the fence in Step 7 proves it). `scripts/check-ds-v3.mjs`, the gate tools and the harness are not edited.

## Root-cause gaps (STOP-and-report rules; named, not guessed)

- **G1 — "run finished" and live "decision waiting" source.** Not root-caused to a single hook: `inboxCount` refreshes
  only on project-list change (W10) and there is no run-finished event kind. **Rule:** implement D2-e on the signals that
  exist (`inboxCount` rising edge; `runsByProject` status transition seen on any refresh the pages already do, plus
  `useRunEvents` on the open bench run: a `stage_completed` for the last pipeline stage with run status `completed`).
  Step 1 must produce, in the report, a table "cue → exact signal → file:line → when it fires". If a cue can fire only by
  adding polling, a new subscription, a new RPC or a Rust change, **stop**: ship that cue's pure function + tests and
  wire only the cue that has a signal; report the gap. Do not add a timer to make it fire.
- **G2 — Web Audio availability in the Tauri webview.** `AudioContext` is expected in WebKitGTK/WebView2/WKWebView but not
  measured here. The cue must be a no-op (no throw, no log spam) when it is missing; the report says "not audibly verified"
  unless a human or a real webview run heard it (jsdom/Playwright cannot).
- **G3 — fixed-height controls vs the new ratios.** If any control clips or overflows after D3 (item D3-b), stop and list it.
- **G4 — Sheet/Stepper hook points.** If `Sheet`'s `side` class or `Stepper`'s marker cannot carry the CSS state hook
  without a behavioural change, stop and report that item; the others still ship.

## Steps

1. Read-through + G1 table (no edits). 2. D3: `type.ts`, `tokens.css`, `tokens.test.ts`, vocalised test (D3-d), design doc.
3. D3-c `dir="auto"` + tests. 4. D1: keyframes, reduced-motion rules, press, Sheet, Stepper + the guard test (D1-f).
5. D2: `soundCues.ts` (pure, injectable `AudioContext` factory), `useSoundCues.ts`, mount, Settings switch, registry id,
ar+en keys, tests. 6. e2e `polish.spec.ts` + settings spec edit. 7. Full Acceptance; report. Commit per step.

## Acceptance (frozen)

- **T1** type tokens: `fontSizes` all `rem`; `lineHeights` unitless; every step xs–lg ≥ 1.6, xl ≥ 1.55, 2xl ≥ 1.5, 3xl ≥ 1.4;
  `tokens.css` equals TS; no `px` in `--w-font-size-*`/`--w-line-height-*`.
- **T2** the vocalised two-line sample passes D3-d for Card/DecisionCard/SettingsSection/page title.
- **T3** `Composer`, `TextField`, `DecisionCard` user text render `dir="auto"`; catalog labels do not.
- **T4** sound: with default storage no `AudioContext` is constructed and no cue fires on any rising edge; with
  `warsha.sound_cues=on` a rising `inboxCount` plays `decision-waiting` once, a non-terminal→`completed` transition plays
  `run-finished` once; first load plays nothing; the same count twice plays once; missing `AudioContext` → no throw.
- **T5** Settings: the switch is present in ar and en, defaults unchecked, toggling writes/removes `warsha.sound_cues`,
  registered as `settings.sound-cues.set`, no RPC call is made (client mock sees none).
- **T6** motion: keyframes `w-spin`, `w-pulse`, `w-progress-indeterminate`, `w-sheet-in`, `w-step-done` exist in `tokens.css`;
  each animated rule has a `prefers-reduced-motion: reduce` counterpart (D1-f guard test); press rule excludes disabled.
- **E1** e2e (non-visual): with `emulateMedia({ reducedMotion: 'reduce' })` the computed `animation-name` of spinner,
  skeleton and indeterminate bar is `none` and `getAnimations()` is empty after opening a Sheet and advancing a Stepper;
  with `no-preference` the Sheet has a running `w-sheet-in` animation; in `ar` and `en` the Settings switch exists and
  starts off; no `@visual` case is added or changed.
- **Gates** (run from the worktree root; `<TOOLS>` as above):
  - `pnpm lint` → 0; `pnpm typecheck` → 0; `pnpm -r test` → 0 failed, no package count below R-UI-2's report
    (client 174, i18n 58, ui 373, crypto 22, remote 221, desktop 777; the counts must **rise** for ui/desktop/i18n)
  - `pnpm --filter @warsha/ui lint && pnpm --filter @warsha/ui typecheck && pnpm --filter @warsha/ui test`;
    `pnpm --filter @warsha/desktop lint && ... typecheck && ... test`; `pnpm --filter @warsha/i18n test`
    (the touched packages, named separately so a failure is attributable)
  - `node <TOOLS>/actions-gate.mjs "$PWD"` → 0 (R-UI-2: 151 registered/151 used; now **152/152**, one new id) and
    `node <TOOLS>/actions-gate.mjs --self-test` → 0
  - `node <TOOLS>/i18n-gate.mjs "$PWD"` → 0 (R-UI-2: 746 keys; now **748**, 0 violations) and `--self-test` → 0
  - `node scripts/check-ds-v3.mjs apps/desktop/src/v3 packages/ui/src/v3 apps/remote/src` → 0 violations
  - `node <TOOLS>/contrast.mjs --check-css packages/ui/src/v3/tokens/tokens.css` → 0 (colours are untouched — this proves it)
  - `pnpm exec playwright test --project=desktop apps/desktop/e2e/v3 --grep-invert "@visual"` → 0 failed, passed ≥ 286
    (R-UI-2) plus the new cases
  - `node scripts/check-wire-contract.mjs`, `node scripts/check-arch.mjs`, `node scripts/check-engineering-policy.mjs`
    unchanged/green (no Rust or wire touched; run once as regression)
  - Fence: `git diff --stat eabcecb..HEAD` lists only Allowed files; `git diff --name-only eabcecb..HEAD | grep -c "snapshots/"`
    → 0; `git diff --name-only eabcecb..HEAD | grep -E "\.rs$|Cargo|screens/|harness\.ts"` prints nothing.
- **D1 Discrimination** (artifacts under `target/discrimination/`): revert `md` to `1.5` → T1 fails; drop the
  `prefers-reduced-motion` block for the keyframes → D1-f guard and E1 fail; make the default storage `on` → T4/T5 fail;
  remove `dir="auto"` from `Composer` → T3 fails.
- Report states, per G1–G4, what was found; "not audibly verified" for sound unless it was heard; and that no baseline exists
  yet (R-UI-4 will capture the new type/motion states).
