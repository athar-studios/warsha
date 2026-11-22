# R-UI-3 — implementation report

Branch `zl-rui3-polish`, worktree `.agents/worktrees/zl-rui3-polish`, cut from `ed8a816` (`docs(packets): frozen
R-UI-3`), which is a child of the packet's base `eabcecb`. Coder lane; no gate was authored or edited here.

## Commits (chronological)

| Commit | What |
|---|---|
| `8f3fa35` | `feat(ui): rem type scale and unitless line heights` — D3-a/D3-e (type.ts, tokens.css, parity + floor tests, §2.2 table) |
| `83f7320` | `feat(ui): let user text pick its own direction` — D3-c (Composer, TextField, DecisionCard + tests) |
| `1bea8d0` | `feat(ui): define the loops, press, sheet and stepper motion` — D1-a…D1-f |
| `578999e` | `feat(desktop): add optional sound cues behind one Settings switch` — D2-a…D2-e, registry id, ar/en keys, Settings switch + tests, `settings.spec.ts` edit |
| `b956fc5` | `fix(ui): stop the motion comment from closing itself` — repair + guard (see "Findings") |
| `437f4ca` | `test(ui): write the narrow column on a token` |
| `956e119` | `test: cover the page-title ratio in the vocalised check` — D3-d/T2 split (see below) |
| `2b726f2` | `style(ui): keep the new motion selectors and doc table prettier-clean` |
| `297d5e8` | `test(e2e): assert the polish states in a browser` — E1 |
| this commit | `docs(packets): report R-UI-3` |

## Gates (run from the worktree root)

| Command | Exit | Result |
|---|---|---|
| `pnpm lint` | 0 | 1 warning, pre-existing (`apps/desktop/src/v3/pages/inbox/index.tsx:360`, file untouched) |
| `pnpm typecheck` | 0 | |
| `pnpm -r test` | 0 | client 174 · i18n 58 · ui **383** (R-UI-2: 373) · crypto 22 · remote 221 · desktop **802** (R-UI-2: 777) |
| `pnpm --filter @warsha/ui lint` | 0 | |
| `pnpm --filter @warsha/ui typecheck` | 0 | |
| `pnpm --filter @warsha/ui test` | 0 | 58 files, 383 tests |
| `pnpm --filter warsha-desktop lint` | 0 | same single pre-existing warning |
| `pnpm --filter warsha-desktop typecheck` | 0 | `tsc --noEmit` + `tsc --noEmit -p tsconfig.e2e.json` |
| `pnpm --filter warsha-desktop test` | 0 | 92 files, 802 tests |
| `pnpm --filter @warsha/i18n test` | 0 | 58 tests (includes "identical keys across Arabic and English catalogs") |
| `node <TOOLS>/actions-gate.mjs "$PWD"` | 0 | **152 registered / 152 used**, 0 violations |
| `node <TOOLS>/actions-gate.mjs --self-test` | 0 | |
| `node <TOOLS>/i18n-gate.mjs "$PWD"` | 0 | **748 keys**, 0 violations (R-UI-2: 746) |
| `node <TOOLS>/i18n-gate.mjs --self-test` | 0 | |
| `node scripts/check-ds-v3.mjs apps/desktop/src/v3 packages/ui/src/v3 apps/remote/src` | 0 | 0 violations |
| `node <TOOLS>/contrast.mjs --check-css packages/ui/src/v3/tokens/tokens.css` | 0 | `fails 0` (colours untouched) |
| `pnpm exec playwright test --project=desktop apps/desktop/e2e/v3 --grep-invert "@visual"` | 0 | **291 passed**, 0 failed (R-UI-2: 286 + 5 new) |
| `node scripts/check-wire-contract.mjs` | 0 | 11 checks, 0 violations |
| `node scripts/check-arch.mjs` | 0 | 5 rules, 0 violations |
| `node scripts/check-engineering-policy.mjs` | 0 | 8 checks, 0 failures |

Fence (`eabcecb..HEAD`): 26 files — this report, plus 25 that are all in the packet's allowed list, plus
`docs/zadloop/packets/R-UI-3.md`, which is the frozen packet itself, committed at `ed8a816` (the branch base), not an
edit. `snapshots/` count **0**; no `.rs`,
`Cargo`, `screens/` or `harness.ts`.

`packages/i18n` test count is unchanged at 58: the only i18n files the packet allows are the two catalog files, so the
key growth is evidenced by `i18n-gate` (748, 0 violations) and the package's ar/en parity test, not by a new test.

## Per design point

**D3-a** `fontSizes` are rem, `lineHeights` unitless (`type.ts`), `tokens.css` mirrors them; `tokens.test.ts` still
proves parity and adds the §2.2 floors (xs–lg ≥ 1.6, xl ≥ 1.55, 2xl ≥ 1.5, 3xl ≥ 1.4) and "no px left in
`--w-font-size-*`/`--w-line-height-*`".

**D3-b** No consumer edit was needed — they read the variables. G3 (fixed-height clipping) was checked and **not
triggered**: control heights are separate tokens, and the e2e viewport-fit audits in the v3 suite pass unchanged.

**D3-c** `dir="auto"` is a prop-less default on the `Composer` textarea, on `TextField` (before `{...rest}`, so a
caller that needs `dir` still wins) and on `DecisionCard`'s user/agent text (`h2`, `p`, consequence `li`, and both
`TextArea` calls). Tests assert catalog labels carry no `dir`.

**D3-d / T2** Split across two packages, deliberately: `DecisionCard.test.tsx` renders a two-line fully vocalised
sample (`إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ وَلِكُلِّ امْرِئٍ مَا نَوَى`) in a 240px `dir="rtl"` column for `Card`,
`DecisionCard`, `SettingsSection` **and the page-title ratio** (3xl), asserting the ratio from the token table because
jsdom resolves no `var()`. `V3App.test.tsx` closes the loop on the real class: the Projects page renders
`h1.v3-projects-title`, and that class's rule in `projects.css` still names `--w-font-size-3xl`/`--w-line-height-3xl`
(asserted from the stylesheet text — jsdom has no layout engine and vitest loads no CSS).

**D3-e** `DESIGN_SYSTEM_V3.md` §2.2 rewritten to rem/ratio with an "At 16px root" column; §2.4 gained the motion rules.

**D2-a** `soundCues.ts`: two cues only, synthesised from `AudioContext` oscillators — `decision-waiting` is a two-note
rise (`523.25 → 783.99 Hz`, 0.09 s/note), `run-finished` a single note (`659.25 Hz`, 0.14 s), gains 0.12 / 0.10, all on
`--w`-free literal envelopes. The context is created lazily inside `playSoundCue`, and `resume()`/`start()` failures are
swallowed. No asset, no dependency.

**D2-b** One switch in Settings › General, action `settings.sound-cues.set` (`effect: 'state'`, registered), labels
`settings.general.sound` + `.desc` in ar and en, default **off**. See "Findings" for why the control is a hand-rolled
`role="switch"` button rather than the v3 `Switch` composite.

**D2-c** Device-scoped `localStorage['warsha.sound_cues'] = 'on'` (absent = off), never the preferences RPC. A test
asserts `recordPreference` is never called and `listPreferences` is not re-dialled by a toggle.

**D2-d** The cues are pure observers: the hook renders nothing, mutates neither input, and adds no visual. The Frame
inbox badge and run status chip are unchanged.

**D2-e** `useSoundCues({ inboxCount, runsByProject })` mounted once in `Frame.tsx`; rising edge only, never on first load,
deduped by count/`runId` through successive snapshots.

**D2-f** `prefers-reduced-motion` does not touch sound; the switch is the only control.

### G1 — cue → exact signal → file:line → when it fires

| Cue | Signal | Where | Fires when |
|---|---|---|---|
| `decision-waiting` | `inboxCount` (sum of pending gates at the current stage over every non-terminal run) | `apps/desktop/src/v3/pages/frame/Frame.tsx:124,145,158`; state `:87`, set together with the runs map `:157`; produced by the load effect whose deps are `[client, projectsResult.data]` (`:167`) | only when that effect re-runs — i.e. the project list changes (mount, project added/removed) or the app reloads. Nothing polls. |
| `run-finished` | a run's `status` going non-terminal → `completed` between two successive snapshots of `runsByProject` | same map, built from `client.listRuns` (`Frame.tsx:130`), set at `:157`, observed by `useSoundCues.ts:39` (`nextCues`) | same moments as above. A run that finishes while the window sits idle is **not** observed. |

Gap, reported not papered over: observing mid-session arrivals needs a subscription, a poll, a new RPC or a Rust
`run_finished` `EventKind` — all out of scope — so none was added. The bench path (`useRunEvents` on the open run) is
unreachable because `apps/desktop/src/v3/pages/bench/index.tsx` is not an allowed file. Both cues therefore ship with
their pure function + tests and with the two signals that exist; `nextCues` is edge-only, so the wiring cannot repeat a
cue on re-render or reconnect.

**G2 — Web Audio in the Tauri webview: not audibly verified.** No human or real-webview run heard the cues
(jsdom/Playwright cannot). What is proven: a missing or throwing `AudioContext` is a silent no-op (`playSoundCue`
returns `false`), and the envelopes/durations/gains are asserted against a fake context in `soundCues.test.ts`.

**G3 — not triggered** (see D3-b).

**G4 — one item to report.** `Sheet` carries its `side` class already (`Sheet.tsx:133`) and its scrim is a separate
element, so D1-d needed CSS only. `Stepper`'s marker could carry `data-state` without behaviour change
(`Stepper.tsx:118`). The deviation is D1-e's "no animation on first render": CSS cannot tell a first render from a state
change, so a stage that is already `done` when the screen mounts plays `w-step-done` once. Removing that would need
React state, which the frozen decision excludes. It is a 280ms scale-in on an already-complete marker, and it is
neutralised under `prefers-reduced-motion`.

**D1-b interpretation.** "the spinner shows as a static ring **with its text label**": the v3 `Spinner` has no painted
label — its accessible name comes from `aria-label` — so under reduce it is a static ring that keeps its accessible
name. Painting a visible label would have changed every loading button in the app, which is out of this packet.

## Findings

1. **A comment in `tokens.css` was swallowing the stylesheet.** The first D1 motion comment contained
   `--w-dur-*/--w-ease`; the `*/` closed the comment and postcss refused the file, so the dev server served
   `tokens.css` unparsed — the sheet and stepper rules silently did not exist. Every jsdom test passed, because they
   strip comments before asserting. Fixed in `b956fc5`, which also adds a well-formedness guard to `tokens.test.ts`
   (comments close exactly once, braces balance). The e2e suite is what caught it.
2. **The settings switch is hand-rolled.** `actions-gate` A1/A4 read the literal `data-action` off the interactive
   element; the v3 `Switch` composite owns its own internal button, so a `data-action` passed to it is invisible to the
   gate (measured: 152 registered / 151 used). `GeneralSection` already hand-rolls its two radiogroups for the same
   reason, so the switch follows that precedent: a `role="switch"` button with `aria-checked`, `aria-labelledby` pointing
   at the catalog title, and tokens only (no px, no `left/right` — the thumb moves by `justify-content`).
3. **One-line follow-ups outside the allowed list** (reported, not edited): `packages/ui/src/v3/primitives/TextArea.tsx`
   is a user-text field with no `dir="auto"` (D3-c names `TextField` and `Composer`; `TextArea` is a distinct primitive),
   and `apps/desktop/src/v3/pages/home/index.tsx` has the user's idea input. Both would benefit from the same default.
4. **Prettier.** Base `tokens.css`, `DESIGN_SYSTEM_V3.md`, `Frame.tsx`, `GeneralSection.tsx`, `settings.spec.ts`,
   `registry/settings.ts`, the ar/en catalogs, `DecisionCard.tsx`, `TextField.tsx` and `V3App.test.tsx` are not
   prettier-formatted at `eabcecb`. Rather than reformat out-of-scope lines, the new lines were made prettier-clean and
   `prettier --diff` on added lines is empty (`tokens.css` selectors and the §2.2 table were normalised in `2b726f2`);
   the remaining drift is exactly the pre-existing drift.

## Discrimination (artifacts in `target/discrimination/`, git-ignored)

| Mutation | Expected failure | Observed |
|---|---|---|
| `lineHeights.md` `1.6 → 1.5` | T1 + D3-d | `rui3-disc1-md-1.5.txt`: 3 tests fail — TS↔CSS parity, the 1.6 floor, and "Card title (md, ratio 1.5) clears 1.6" |
| drop `.w-spinner svg` from the reduce list | D1-f guard + E1 | `rui3-disc2-no-reduce-spinner.txt`: guard fails (".w-spinner svg has an inline loop but no reduced-motion counterpart"); `rui3-disc2b-e1-no-reduce-spinner.txt`: E1 spinner case fails, `animation-name` received `"w-spin"` |
| default storage `on` | T4 + T5 | `rui3-disc3-default-on.txt`: 7 tests fail across soundCues/useSoundCues/GeneralSection |
| remove `dir="auto"` from `Composer` | T3 | `rui3-disc4-no-dir-auto-composer.txt`: 1 test fails |

Vocalised sample evidence: `target/discrimination/rui3-d3d-vocalised.png` (rendered from the real `tokens.css`, 240px
column, `dir="rtl"`, `@2x`; produced by `target/discrimination/shot.mjs`). Measured in Chromium at the 16px root —
card/settings title 16 / 25.6 (1.60), `DecisionCard` title 22 / 34.1 (1.55), page title 36 / 50.4 (1.40); each column
reports `clipped: no` (`scrollHeight` vs `clientHeight`). The same sheet also renders the three loops and they run
(`w-spin`, `w-pulse`, `w-progress-indeterminate`).

## Not verified / limits

- Sound was **not audibly verified** (G2). Autoplay policy in a real webview, and whether the two-note rise reads as
  "waiting" to a human, are unmeasured.
- The cues are edge-driven off a load that only re-runs when the project list changes (G1): no cue for work that lands
  while the window is idle. That gap needs a subscription or a Rust event kind, both out of scope.
- Baselines: none created or touched. The new switch and the new leading **will** move `/settings/general` and every
  surface that uses the tokens; that is R-UI-4's job, and no `@visual` case was added or changed here.
- The indeterminate-bar half of E1 uses a probe element: no screen renders an indeterminate `ProgressBar` today
  (`CostTab` always passes `value`), so the case asserts that the stylesheet's reduce rule beats an element's inline
  `animation` — the part no unit test can see.
