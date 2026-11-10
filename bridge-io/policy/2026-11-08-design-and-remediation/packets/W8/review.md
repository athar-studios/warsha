# W8 — independent code review (re-review at the reviewed head)

- Run: `2026-11-08-design-and-remediation`
- Packet: W8 (prerequisite for the frozen 793/0 gates)
- Role: independent code reviewer (`ENGINEERING_POLICY.md` §1 Phase 4); not implementer, not verifier
- Worktree reviewed: `C:/Users/Dragonfly/Downloads/warsha-wt/w8` (never modified)
- Branch: `run/2026-11-08/w8-g0-a11y-repair`
- **BASE: `0772d502002562505c6438ae712abca7a7328d84`**
- **HEAD: `0b8a7e89f987c1ffb6415110238e91514cd4aa9f`** (`git rev-parse HEAD`)
- Commits: `024d8a4` `fix(desktop): take the connectors description out of the ledger list` ·
  `0b8a7e8` `test(desktop): guard the settings ledger's list-item structure`
- Worktree at review time: clean — `git status --porcelain` 0 lines before and after my commands

Re-review note: a prior `review.md` existed at this same reviewed head with verdict APPROVE. This
pass re-derives every claim independently from the diff and from commands I ran; no implementation,
test, gate or snapshot file was edited by me. Evidence is gitignored (`.gitignore:74`).

## Diff — the +8/−1 claim is verified

`git diff --stat BASE..HEAD`:

```
 apps/desktop/src/screens/SettingsScreen.tsx        | 255 +++++++++++----------
 .../screens/SettingsScreenIntegrations.test.tsx    |  47 ++++
 2 files changed, 178 insertions(+), 124 deletions(-)
```

`git diff --numstat BASE..HEAD`:

```
131     124     apps/desktop/src/screens/SettingsScreen.tsx
47      0       apps/desktop/src/screens/SettingsScreenIntegrations.test.tsx
```

My `git diff -w --numstat BASE..HEAD`:

```
8       1       apps/desktop/src/screens/SettingsScreen.tsx
47      0       apps/desktop/src/screens/SettingsScreenIntegrations.test.tsx
```

So the semantic source change is **exactly +8/−1** and the test change is **+47/−0**, as claimed.
Stronger than `-w`: I stripped only *leading* whitespace from both revisions and diffed
(`git show BASE:file | sed 's/^[[:space:]]*//'` vs the same at HEAD). The result is exactly two
hunks containing only the fragment `<>`, its 3-line rationale comment, the
`{integrations.length > 0 && (` guard, the re-opened `<Ledger>`, and the matching `</>` / `)}`.
Nothing is hidden inside the whitespace churn: no string, attribute, conditional, text node or
style object changed. The full diff has exactly **one** hunk (`@@ -315,138 +315,145 @@`), so all
123 added / 123 deleted lines are leading indentation in the live branch.

## Findings

### Blockers

None.

### Major

None.

### Minor

- **M1 — Prettier drift is pre-existing, not introduced.** `prettier --check` fails on both touched
  files at HEAD, but the same check fails on both files at BASE (verified via
  `prettier --check --stdin-filepath` on the BASE blobs), and `.github/workflows/ci.yml` never runs
  `format:check`. No new formatting obligation is broken; no action.
- **M2 — the empty-state test uses a document-wide `<ul>` query**
  (`apps/desktop/src/screens/SettingsScreenIntegrations.test.tsx:154`). This is deliberately strict
  for the defect class and is correct today (the screen renders no other list); it would become
  brittle only if an unrelated list were added to this screen later. Acceptable, no action.
- **M3 — the fallback test guards a branch that was never defective**
  (`SettingsScreenIntegrations.test.tsx:168-173`). Defense in depth for the `SUBSCRIPTIONS` ledger,
  not a tautology; harmless.

### Nits

- **N1** — the 3-line JSX comment (`apps/desktop/src/screens/SettingsScreen.tsx:319-321`) records
  the non-obvious axe invariant behind the structure; it matches this file's heavily-documented
  style. Acceptable.
- **N2** — indentation asymmetry: the fallback branch keeps its old depth
  (`SettingsScreen.tsx:274-316`) while the live branch moved one level deeper (`:318-456`).
  Formatting-only, pre-existing style, no runtime effect.
- **N3** — the helper's `within(ledger).getAllByRole('listitem')`
  (`SettingsScreenIntegrations.test.tsx:137`) counts nested list items too; no nested list exists,
  so the invariant is exact today.

### Informational

- The report's D-W8-3 corrections are accurate: `.warsha-ledger` is at
  `packages/ui/src/tokens/tokens.css:293` with `scrollbar-gutter: stable` at `:295`; the
  `listIntegrations` effect is `SettingsScreen.tsx:79-93` with the state write at `:85`.
- The prompt cites `screens.a11y.spec.ts:48`; the test is at `screens.a11y.spec.ts:44` at this
  head. Immaterial to the review.
- `state.json` already records `status: merged-at-C0`, `review_verdict: APPROVE`,
  `verification_verdict: PASS`, `linux_gate: G8.4 PASS`, `merge_commit: 5abe5ef`, and
  `remotes/origin/integration` points at that merge. That merge/push is an orchestrator C0 action,
  outside the reviewed diff and not attributable to W8 implementation.

## 1. Scope — PASS

- `git diff --name-only BASE..HEAD | grep -vE '^apps/desktop/src/screens/SettingsScreen(Integrations\.test)?\.tsx$' | wc -l`
  → **0** (G8.S).
- `git diff --name-status` lists exactly:
  `M apps/desktop/src/screens/SettingsScreen.tsx` and
  `M apps/desktop/src/screens/SettingsScreenIntegrations.test.tsx`. No dependency, lockfile,
  `.github/**`, `*-snapshots/**`, `packages/ui/**`, `apps/remote/**` or plan/progress/decision file.
- `git status --porcelain -- '*-snapshots/*' | wc -l` → **0** (G8.5); `git ls-files -m -- '*-snapshots/*'`
  → 0.
- Test-file provenance: at BASE the file is tracked, **127 lines, 6 tests**. HEAD's first 127 lines
  are **byte-identical** to BASE (`cmp` of `git show BASE:…` against `head -127` of HEAD → identical).
  The test diff is append-only `@@ -125,3 +125,50 @@` (+47/−0). HEAD has 9 tests; no
  `skip`/`only`/`todo`/`failing`, no deleted or weakened assertion.

## 2. The defect is actually removed — PASS

Confirmed at BASE: `SettingsScreen.tsx:317-321` took the live branch when `integrations` was `[]`
and rendered `<Ledger>` at `:318` whose direct child at `:319` was `<Text>` — a block `<span>`
(`packages/ui/src/components.tsx:132-145`), never an `<li>`. `Ledger` is a `<ul role="list">`
(`packages/ui/src/compounds/Ledger.tsx:179-195`, row `<li>` at `:128`). The e2e stub answers
`integrations.list` with `{ ok: true, result: [] }` (`apps/desktop/e2e/harness.ts:1232-1234`), so
`integrations` settles to `[]` (`SettingsScreen.tsx:79-93`) and the empty `ul` held only the
`span` — exactly axe `aria-required-children [critical]`.

At HEAD:

- Empty catalogue: `SettingsScreen.tsx:322-324` renders the description as a direct child of the
  `Panel` body, and `:325` gates the `<Ledger>` (`:326`) behind `integrations.length > 0`. With
  `[]`, **no list element is rendered at all** (verified by the new test at
  `SettingsScreenIntegrations.test.tsx:148-156`).
- Populated catalogue: the `map` inside the ledger returns only `Ledger.Row` elements, whose root
  element is `<li>` (`Ledger.tsx:128`); the description is outside the list. The populated test
  (`SettingsScreenIntegrations.test.tsx:158-166`) pins both facts.
- Fallback (`integrations === null`): `SettingsScreen.tsx:274-316` is untouched (outside the single
  hunk) and renders the four `SUBSCRIPTIONS` rows as `<li>` children.

**D-W8-1 judgment: correct.** At BASE the description painted in the empty state because it lived
inside the live-branch `<Ledger>` and that branch renders whenever `integrations !== null`,
including `[]`. Gating the description together with the Ledger would have deleted visible text and
moved pixels; keeping it unconditional while gating only the `<ul>` is the behavior-preserving
choice.

## 3. Pixel neutrality — PASS (static proof)

- **Empty state (what the a11y cases and the settings visual baselines exercise).** `Panel`'s body
  is a plain block `div` with padding and no flex/gap (`packages/ui/src/compounds/Panel.tsx:77`).
  BASE DOM: `div > ul > span`; HEAD DOM: `div > span`. The `ul` is a zero box:
  `margin: 0; padding: 0; listStyle: none; minInlineSize: 0` and `backgroundColor: 'transparent'`
  (`Ledger.tsx:183-190`), with `borderBlockStart` overridden to `none` at the call site
  (`SettingsScreen.tsx:326`; same override at BASE `:318`), and no markers. Its border box therefore
  coincides with its content box and with the block `span` it wrapped; removing it removes no paint
  and no space. The `span` keeps the same block formatting context (the body's), the same containing
  block width, the same `dir={dir}`, and the same style object
  (`paddingInline`, `paddingBlockStart`, muted colour) — identical position, width and height.
- **Populated state.** BASE: `ul > [span, li…]`; HEAD: `span`, then `ul > [li…]`. The `ul` has zero
  block margin/padding/border-top, so the first row's block-start equals the description's
  margin-box end in both layouts; row width equals the body content width in both; the `ul` paints
  nothing. No pixel moves.
- **`integrations === null` / SUBSCRIPTIONS branch.** Byte-identical: the only hunk begins at
  BASE `:315` / HEAD `:315`; the fallback branch (BASE/HEAD `:274-316`) is untouched, so its DOM,
  styles and four-row geometry cannot change. Unit test 3 pins its structure.
- **CSS audit.** The only stylesheet rule naming the ledger is
  `packages/ui/src/tokens/tokens.css:291-296` (`.warsha-ledger { scrollbar-gutter: stable }`).
  That property applies to scroll containers only, and **no `overflow` declaration applies to
  `.warsha-ledger`/`ul` anywhere** (`.warsha-ledger` appears in exactly one CSS rule; no `ul`
  selector exists in any `*.css` in the worktree; `apps/desktop/src/index.css`'s `overflow` rules
  target `.bench`, `.bench-main`, `.bench-stream`, rails and the skip link only). There is also no
  `[role=list]`, `:first-child`, `:last-child`, `:nth-child` or `:empty` rule that could react to
  the removed wrapper. The UA `ul` defaults (block margins, padding-inline-start, markers) are all
  overridden by the inline styles above.

**Explicit judgment: zero pixels can move in the empty state, the populated state, or the
`integrations === null` fallback branch.** I believe the 308-case desktop visual suite and the
252-case states suite can pass unchanged with zero snapshot writes; the states suite does not
cover the settings screen at all (`STATE_CASES`, `apps/desktop/e2e/states.spec.ts:146+`, has no
`settings` entry — 21 cases × 3 viewports × 2 locales × 2 themes = 252), so it is immune by
construction, and the 12 settings visual cases (3 viewports × 2 locales × 2 themes,
`apps/desktop/e2e/screens.visual.spec.ts-snapshots/settings-*-desktop-linux.png`) rest on the
zero-box argument above. **G8.4 (`793 passed / 0 failed` on the Linux capture host) would prove
this empirically**: the 8 formerly failing settings axe cases green in the same run as every
visual and state comparison still matching its baseline. A recorded log exists
(`gates/G8.4.log`: commit `0b8a7e8`, `793 passed`, `[desktop exit code: 0]`, `snapshot_writes: 0`,
`head_after: 0b8a7e8`), but I did not produce it and do not present it as my own evidence.

## 4. Test quality — PASS

The three new tests guard the invariant structurally rather than snapshotting implementation details:

- Empty catalogue (`SettingsScreenIntegrations.test.tsx:148-156`): description still rendered;
  `queryAllByRole('list')` length 0; no `<ul>` in the document; description not inside a list.
- Populated (`:158-166`): every direct child of the named list is an `<li>`; listitem count equals
  child count; the description is not contained by the list.
- Fallback (`:168-173`): the same structural contract on the four-row subscriptions ledger.

Not tautological: against the unfixed source the two live-branch tests fail exactly as axe fails —
`expected [ <ul role="list" …>…(1)</ul> ] to have a length of +0 but got 1` and
`expected [ <li …>, …(1) ] to have a length of 3 but got 2` — while the fallback test passes
(`gates/w8-red.log`; `gates/w8-green.log` shows 9/9 green). I verified the logs' content and the
assertion logic; I did not re-run the red state myself because that requires editing the
implementation, which my role forbids. Re-introducing the defect (description inside the `ul`, or
always rendering the empty `<ul>`) fails these tests. The layering is correct: jsdom asserts the
DOM structure axe measures, while the real axe run stays G8.4 on the Linux host (D-W8-4 — axe-core
is not an `apps/desktop` dependency, and adding one would be out of scope).

## 5. Rules — PASS

- TypeScript strict: `pnpm -r typecheck` exit 0 (7/7 projects), including `apps/desktop` and its
  e2e tsconfig.
- ESLint: `pnpm -r lint` exit 0. No `any`, `@ts-ignore`, `@ts-expect-error` or `eslint-disable` in
  added lines (grep over the added diff: no matches).
- i18n: the moved description still calls `label('connectors.desc')` (`SettingsScreen.tsx:323`),
  the list keeps `label('connectors.title')` (`:326`); both keys exist in Arabic and English
  (`packages/i18n/src/index.tsx:861-862` and `:2016-2017`). No new hardcoded UI string; new
  literals exist only in test names/fixtures.
- RTL-safe: no CSS added; the moved `Text` keeps logical `paddingInline`/`paddingBlockStart` and
  `dir={dir}` (`SettingsScreen.tsx:322`), and the new structure uses no physical side.
- No dependency, lockfile, `.github/**` or `*-snapshots/**` change (name-status above). No
  `--update-snapshots`; G8.5 = 0.
- No push/merge by the implementer: the W8 branch exists only locally (no remote-tracking W8
  branch); the `5abe5ef` merge on `integration` / `origin/integration` is the orchestrator's
  recorded `merged-at-C0` action.
- Conventional Commits: `fix(desktop): …` and `test(desktop): …`.

## 6. Secrets — PASS

No secret, token, key, password or credential is added anywhere in the diff. The touched lines
mention `token`/`password` only as form-field wiring; test fixtures use fake values that already
existed at BASE (`xoxb-live-token`, `sk-secret-value`). No keychain or log surface changed.

## What I verified with commands

`git rev-parse HEAD` (0b8a7e8) · `git status --porcelain` (0 lines, before and after) ·
`git log --oneline BASE..HEAD` (2 commits) · full `--stat` (+178/−124) · `--numstat` (131/124,
47/0) · `-w --numstat` (8/1, 47/0) · leading-whitespace-only normalization diff (exactly the
intended additions) · hunk count (1) · G8.S (0) · G8.5 (0) · BASE test file 127 lines / 6 tests ·
`cmp` of BASE test file vs HEAD first 127 lines (identical) · skip/only/todo grep (none) ·
targeted `vitest run src/screens/SettingsScreenIntegrations.test.tsx` (9/9 passed) ·
`pnpm --filter warsha-desktop test` (**47 files / 446 tests passed, 0 failed, exit 0**) ·
`pnpm -r typecheck` (exit 0) · `pnpm -r lint` (exit 0) · `node scripts/check-arch.mjs`
(5 rules, 0 violations) · `node scripts/check-engineering-policy.mjs` (8 checks, 0 failures) ·
`node scripts/check-wire-contract.mjs` (8 checks, 0 violations) · `prettier --check` at HEAD and
BASE (both fail — pre-existing) · CSS greps for `.warsha-ledger`, `ul` selectors, `overflow`,
`[role=list]`, structural pseudo-classes · e2e audit: stub `harness.ts:1232-1234`, settings screen
entry `harness.ts:342`, `STATE_CASES` has no settings (`states.spec.ts:146+`), 12 settings visual
baselines · `git format-patch BASE..HEAD -o diff/W8` (2 patches, exit 0).

## What I could not verify

- **G8.4** — `pnpm exec playwright test --project=desktop --reporter=line` at 793/0 is a
  Linux-capture-host gate; I am on Windows and did not run it. I read the run's
  `gates/G8.4.log` (793 passed, exit 0, 0 snapshot writes, head `0b8a7e8`) but did not produce that
  log; the Linux verifier owns the gate.
- I did not run the 308 visual or 252 states cases myself; my pixel-neutrality conclusion is a
  static code/CSS argument to be confirmed by G8.4.
- I did not re-run the red state of the new tests (would require editing the implementation); I
  verified the recorded red log and the assertion logic instead.

## Final verdict

**APPROVE**
