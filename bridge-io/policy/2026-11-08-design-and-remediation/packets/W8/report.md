# W8 — G0 truth repair: settings-screen list semantics (pixel-neutral)

- Run: `2026-11-08-design-and-remediation`
- Packet: W8 (wave A-prerequisite)
- Branch: `run/2026-11-08/w8-g0-a11y-repair`
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/w8`
- BASE: `0772d502002562505c6438ae712abca7a7328d84` (`run/2026-11-08/integration`)
- HEAD: `0b8a7e89f987c1ffb6415110238e91514cd4aa9f`
- Commits (2):
  - `024d8a4` fix(desktop): take the connectors description out of the ledger list
  - `0b8a7e8` test(desktop): guard the settings ledger's list-item structure

This is the restarted session. The lost session had made zero commits and zero edits; at restart
`git log 0772d50..HEAD` was empty and `git diff --stat HEAD` was clean. Before each commit the
single-writer check (`git log 0772d50..HEAD`, `git diff --stat HEAD`, `git ls-files -m/-o`) showed
only my own two files; no foreign commits or edits appeared at any point.

## Diff

```
 apps/desktop/src/screens/SettingsScreen.tsx        | 255 +++++++++++----------
 .../screens/SettingsScreenIntegrations.test.tsx    |  47 ++++
 2 files changed, 178 insertions(+), 124 deletions(-)
```

The 255/124 line count on `SettingsScreen.tsx` is almost entirely re-indentation: the live-branch
map body moved one JSX level deeper when it was wrapped in the new conditional. The semantic diff is
`git diff -w`: **+8/−1** — the guard and the fragment open/close. No other file changed (G8.S = 0).

## Root cause — re-verified at BASE

Every citation held, with two corrections recorded below.

- `SettingsScreen.tsx:318` rendered `<Ledger label={label('connectors.title')}>` whose direct child
  at `:319` was `<Text size="xs">` — a `<span>`, not an `<li>`.
- `Ledger` is `<ul role="list">` (`packages/ui/src/compounds/Ledger.tsx:179-180`); `Text` is
  `<span style="display:block">` (`packages/ui/src/components.tsx:132-138`).
- The e2e stub answers `integrations.list` with `{ ok: true, result: [] }`
  (`apps/desktop/e2e/harness.ts:1232-1234`), so `integrations` settles to `[]`, not `null`
  (`SettingsScreen.tsx:82-89`), taking the live branch at `:318`; `integrations.map` yields zero rows,
  so the `ul` contains only the `span` and has no `listitem` child.
- Trigger: `08d61af` added `integrations.list` to the stub (8 insertions in `harness.ts` only); the
  markup defect is older.

## The fix

`SettingsScreen.tsx` live branch (`integrations !== null`):

- The description `<Text>` moved OUT of `<Ledger>` to be the first child of the `Panel` body.
- `<Ledger>` renders only when `integrations.length > 0`.

So the empty catalogue draws **no list element at all** (not an announced empty list), and the
populated list's only direct children are `Ledger.Row`'s `<li>` elements. Rejected alternatives were
not used: no `<li>` around the description, no empty `ul`.

## Decisions

1. **D-W8-1 — description stays unconditional; only the Ledger is gated.** The brief's instruction
   is "move the Text out, render the Ledger only when `integrations.length > 0`". Gating the
   description too would have deleted visible text in the empty state and moved pixels. The
   description therefore renders whenever `integrations !== null`, exactly as before; only the `<ul>`
   disappears.
2. **D-W8-2 — the new test file already existed at BASE.** The brief called
   `SettingsScreenIntegrations.test.tsx` "new", but it is tracked at BASE (127 lines, 6 tests, added
   in `9b2a57e`). I extended it append-only: helper + a new `describe` with 3 tests. All 6 existing
   tests are byte-identical and still pass; nothing was weakened, deleted or skipped. Creating a
   second file at the same allowed path was impossible anyway.
3. **D-W8-3 — citation corrections.**
   - `tokens.css:291` is the start of the shared scrollbar-gutter rule; `.warsha-ledger` is on
     `:293` and `scrollbar-gutter: stable` on `:295`. Same rule, no effect on the fix.
   - The `listIntegrations` effect is `SettingsScreen.tsx:79-93` (state write at `:85`); the brief's
     `83-85` points into it. No effect.
4. **D-W8-4 — the invariant is guarded structurally, not with axe-core.** `axe-core` is not a
   dependency of `apps/desktop` (it is a root devDependency used by the Playwright harness); adding
   it to the package would touch dependencies, which is out of scope. jsdom also has no layout, so
   the unit test asserts the exact structure `aria-required-children` measures: zero lists in the
   empty state, and every direct child of a rendered list is a `listitem` (plus the description is
   not a descendant of any list). The real axe run stays G8.4 on the Linux host.

## Tests added (`SettingsScreenIntegrations.test.tsx`)

- `renders no list at all when the daemon reports zero integrations` — `[]` → description still
  rendered, `queryAllByRole('list')` length 0, no `<ul>` in the document, description not inside a
  list.
- `gives the populated ledger only list-item children, with the description outside it` — 2 rows →
  every direct child of the `ul` is an `li`/`listitem`, description is not contained by the list.
- `gives the fallback subscriptions ledger only list-item children` — daemon rejects → the 4 local
  rows satisfy the same structural contract.

Red/green evidence (same test file, source temporarily restored to BASE, then the fix put back):

- Against unfixed source: the two live-branch tests **fail** exactly as the axe rule fails —
  `expected [ <ul role="list">…(1)</ul> ] to have a length of +0 but got 1` (empty list announced) and
  `expected [ <li>, …(1) ] to have a length of 3 but got 2` (3 children, 2 listitems: the span was a
  child of the `ul`). The 6 pre-existing tests and the fallback test pass.
- Against the fix: 9/9 pass. Logs: `packets/W8/gates/w8-red.log`, `w8-green.log`.

## Gate results (my own runs, at HEAD `0b8a7e8`; the verifier reruns these)

| Gate | Command | Result |
| --- | --- | --- |
| G8.S | `git diff --name-only $BASE..HEAD \| grep -vE '^apps/desktop/src/screens/SettingsScreen(Integrations\.test)?\.tsx$' \| wc -l` | **0** (exit 0) |
| G8.1 | `pnpm --filter warsha-desktop test` | **exit 0 — 446 passed (47 files), 0 failed** (BASE 443 + 3 new) |
| G8.2 | `pnpm -r typecheck` | **exit 0** (7/7 projects Done) |
| G8.3 | `pnpm -r lint` | **exit 0** (7/7 projects Done) |
| G8.4 | `pnpm exec playwright test --project=desktop --reporter=line` | **NOT RUN — linux-capture-host gate; pending the Linux verifier** |
| G8.5 | `git status --porcelain -- '*-snapshots/*' \| wc -l` | **0** (exit 0); supplements `git ls-files -m -- '*-snapshots/*'` = 0, untracked = 0 |
| G8.A | `node scripts/check-arch.mjs` | **exit 0** — `arch: 5 rules, 0 violations` |
| G8.P | `node scripts/check-engineering-policy.mjs` | **exit 0** — `policy: 8 checks, 0 failures` |
| G8.W | `node scripts/check-wire-contract.mjs` | **exit 0** — `wire: 8 checks, 0 violations` |

Raw logs: `packets/W8/gates/` (`w8-g81.log`, `w8-g82.log`, `w8-g83.log`, `w8-g8a.log`, `w8-g8p.log`,
`w8-g8w.log`). G8.S/G8.5 are command outputs reproduced above (0).

### G8.4 is pending — what it will prove, and why it should pass

G8.4 cannot be run on this Windows host and must not be. Its 793/0 result is simultaneously proof
that the 8 `settings` a11y cases are fixed and that the 308 visual cases did not move. Static
pixel-neutrality argument, verified against the code at BASE:

- `Panel`'s body is a plain block `div` with padding and no flex/gap (`Panel.tsx:77`), so its
  children stack in normal flow in DOM order: before = `ul`>`span`; after = `span`, then `ul`.
- The `ul` is a zero box: `margin: 0; padding: 0; listStyle: none` (`Ledger.tsx:183-190`), the screen
  overrides `borderBlockStart: 'none'` (`SettingsScreen.tsx:326`), and `recessed` is false so its
  background is `transparent`. A block `ul` with no margin/padding/border has the same border box as
  its block `span` child, so the span keeps its width (body width) and vertical position.
- The `ul`'s UA defaults (`margin-block`, `padding-inline-start`, markers) are all overridden by the
  inline `margin/padding/listStyle` declarations; no stylesheet in `apps/desktop/src` or
  `packages/ui/src` targets `ul` at all (verified by grep), so no other rule can add geometry.
- `scrollbar-gutter: stable` (`.warsha-ledger`, `tokens.css:293-295`) only applies to scroll
  containers; nothing sets `overflow` on `.warsha-ledger` or on `ul` anywhere (verified), so it is
  inert and the `ul` cannot reserve gutter space in the empty state.
- Populated state: the `span` previously preceded the rows inside the `ul`; now it precedes the `ul`.
  With zero padding/border/margin on the `ul`, the rows start at the same y and the span keeps the
  same width, so no pixel moves. Empty state: the only visible box is the description `span`, whose
  box is unchanged; the removed `ul` had zero height and zero visible paint.

## What I could not do

- **G8.4** (`pnpm exec playwright test --project=desktop`, expect 793/0) — Linux capture host only;
  not run here, by instruction. Pending the Linux verifier. No snapshot was written or edited
  (`--update-snapshots` never used; G8.5 = 0).
- No visual or a11y verdict is claimed from this host; the unit evidence above is structural only.

## Open issues

- None blocking. G8.4 remains the only open gate, owned by the Linux verifier.
- Note for the verifier: the worktree was clean at HEAD; `SettingsScreen.tsx`'s large diff is
  re-indentation — review with `git diff -w 0772d50..0b8a7e8` for the semantic change.
