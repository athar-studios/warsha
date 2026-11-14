# R-BRIDGE-B4a — v3 becomes the default (Coder report)

Status: **implemented, tests and docs committed, T9 green; two gates are red for reasons that
predate this packet and one acceptance claim cannot be met inside the packet's file list.** The
flip itself is small and proven; see [Repair items](#repair-items-the-packet-asks-for) and
[Deviations and verification limits](#deviations-and-verification-limits) before reading the
counts as a verdict.

Branch `zl-b4a-default` in the worktree `.agents/worktrees/zl-b4a-default`, based on `4986000`
(`repair/dev-csp-f474776`, B3b merged). Nothing was pushed, no PR was opened, `PROGRESS.md`,
`DECISIONS.md` and the packet/spec are untouched (the task forbids them; `AGENTS.md` asks for a
`PROGRESS.md` update before stopping — the task wins, and this report is the substitute).

## Precondition check (U3/U6)

`bridge-io/policy/2026-11-09-ui-v3/state.json` is at seq 122 (2026-11-10) and records
`branch_heads.U3 = 35c9298`, `branch_heads.U6 = bfed29e` with no C3 merge evidence. Checked
against this base instead of trusting the stale file:

| Ref                             | Object | Ancestor of `4986000` |
| ------------------------------- | ------ | --------------------- |
| `35c9298` (U3 head)             | commit | yes                   |
| `bd33b2a` (U3 inbox, 6/6 areas) | commit | yes                   |
| `bfed29e` (U6 head)             | commit | yes                   |
| `c2e1d1e` (U6 complete)         | commit | yes                   |
| `153690b` (U4 merged)           | commit | yes                   |

So the U3 and U6 surfaces are already in the base: the frame, onboarding, home, projects,
project and inbox pages render under `?ui=v3`, and the remote PWA is on v3. The flip in this
packet touches only the _start_ decision, so no U3/U6 surface can break _because of_ it, and none
did: the v3 suite's only non-baseline failures (three cases, in [Repair items](#repair-items-the-packet-asks-for))
fail identically on the base commit. They are filed, not redesigned.

## Commits

| Commit       | Contents                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| `21bfc78`    | `feat(desktop): start on v3, keep v2 behind ?ui=v2` — `apps/desktop/src/main.tsx`, `apps/desktop/src/main.test.tsx` |
| `a66fdef`    | `docs(ui): v3 is the default, v2 behind ?ui=v2` — `docs/UI.md`, `docs/designs/UI_V3_PLAN.md`                        |
| `df72c20`    | `docs(r-bridge-b4a): the Coder report` — this file                                                                  |
| `style(b4a)` | the formatting commit on top of the report: prettier on the new test and this file, nothing else                    |

`git diff 4986000 HEAD --stat`: 5 files, +428 −30. No Rust, no v2 component, no stored-config
semantics beyond the default, no dependency, no config change.

## The flip

`main.tsx` now decides in this order:

| Start condition                                  | What happens                                                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `?ui=v2`                                         | v2, decided before the first paint; `get_config` is not even asked, so a stored `v3` cannot override the address |
| `?ui=v3`                                         | v3 (kept: old bookmarks and the existing v3 e2e suite open it)                                                   |
| nothing in the address, stored `ui_version = v2` | v2 — the owner's own choice is kept                                                                              |
| nothing in the address, anything else            | v3                                                                                                               |
| nothing in the address, `get_config` rejects     | v3                                                                                                               |

`useV3` starts from the address (`requestedUi() !== 'v2'`), so a clean start renders v3 on the
first frame; the effect only reads `ui_version` when the address is silent, and only a `'v2'`
answer moves it. The mount is guarded on `#root` so the test document can mount `<Root />`
itself; the shipped entry point is unchanged (`index.html` has `#root`).

## Start-condition tests

`apps/desktop/src/main.test.tsx` — four cases, each named for its condition; `./App` and
`./v3/app/V3App` are replaced by two markers, so each assertion is about which shell the start
chose and nothing about what that shell renders.

| #   | Test                                                      | Condition                                                    |
| --- | --------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | `a clean start lands on v3`                               | no address, `get_config` answers `''`                        |
| 2   | `a get_config failure lands on v3`                        | `invoke('get_config')` rejects                               |
| 3   | `?ui=v2 lands on v2, even when the stored choice says v3` | address says v2, stored says v3, `invoke` must not be called |
| 4   | `a stored v2 lands on v2, while an unset one lands on v3` | stored `v2` → v2, stored `''` → v3                           |

## Discrimination

The new tests were run against the base commit (`/tmp/zl-b4a-base`, a detached worktree at
`4986000`) with **only** the testability seam applied — `export function Root` and the guarded
mount, no behaviour change — because a bare base checkout has no `Root` export and the file would
fail to import (that would prove nothing):

```
$ git show 4986000:apps/desktop/src/main.tsx  # + export Root / guarded mount only
$ pnpm exec vitest run src/main.test.tsx       # base behaviour
   × main: the v3 cutover start conditions > a clean start lands on v3
   × ... > a get_config failure lands on v3
   × ... > ?ui=v2 lands on v2, even when the stored choice says v3
       → expected "spy" to not be called at all, but actually been called 1 times
   × ... > a stored v2 lands on v2, while an unset one lands on v3
 Test Files  1 failed (1)
      Tests  4 failed (4)
```

```
$ pnpm exec vitest run src/main.test.tsx       # this branch
 ✓ src/main.test.tsx (4 tests) 142ms
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

4/4 fail on the old default, 4/4 pass on the new code.

## Commands and counts

### T9 — `pnpm lint && pnpm typecheck && pnpm -r test && pnpm build`

Exit **0** (`/tmp/b4a-t9.log`). Vitest counts, all above the `state.json` baselines:

| Workspace        | Tests                                                          |
| ---------------- | -------------------------------------------------------------- |
| `@warsha/crypto` | 22                                                             |
| `@warsha/i18n`   | 58                                                             |
| `@warsha/client` | 172                                                            |
| `@warsha/ui`     | 373                                                            |
| `warsha-desktop` | **772** (768 before this packet + the 4 start-condition tests) |
| `warsha-remote`  | 221                                                            |

One pre-existing warning, no errors: `apps/desktop/src/v3/pages/inbox/index.tsx:376`
`react-hooks/exhaustive-deps` (B3b code; untouched here).

### T10 — action/i18n checks

Not 0, and **not because of this packet**: the same command on the base commit prints the same
four violations (B4a touches no v3 source and no catalog).

```
$ node …/tools/actions-gate.mjs "$PWD"
A1 apps/desktop/src/v3/pages/inbox/index.tsx:646 <Button> has no literal data-action="page.verb"
A1 apps/desktop/src/v3/pages/inbox/index.tsx:659 <Button> has no literal data-action="page.verb"
A6 registered id "bench.evidence.file.open" has no e2e case under apps/desktop/e2e/v3/
actions: 149 registered, 149 used, 3 violations            exit 1
$ node …/tools/i18n-gate.mjs "$PWD"
I4 ar "bench.evidence.command_placeholder" contains Latin text: pnpm -r test
i18n-v3: 746 keys, 1 violations                            exit 1
```

Run on `4986000` (`/tmp/zl-b4a-base`): `3 violations` and `1 violations`, identical lines.

### T1–T8 — quoted, not re-run

B4a touches no Rust and no wire shape, so per the packet they are quoted from
`docs/zadloop/packets/R-BRIDGE-B3a-report.md` §Commands (last green run at `318ea44`, whose
parent `6c8d108` is in this history; B3b added no Rust):

- `cargo fmt --all --check` → no output, exit 0
- `cargo clippy --workspace --all-targets -- -D warnings` → exit 0
- `cargo test --workspace --all-targets` → `39 targets, 1038 passed, 0 failed`, exit 0
- `node scripts/check-wire-contract.mjs` → `wire: 11 checks, 0 violations`, exit 0
- `node scripts/check-engineering-policy.mjs` → `policy: 8 checks, 0 failures`, exit 0
- `node scripts/check-arch.mjs` → `arch: 5 rules, 0 violations`, exit 0

### Full v3 e2e suite (desktop)

```
$ pnpm exec playwright test apps/desktop/e2e/v3 --project=desktop --workers=4   # new code
  321 passed, 377 failed (14.5m)  exit 1
```

Failure classes (from `/tmp/b4a-v3.log`): **368** `A snapshot doesn't exist … writing actual`
(the v3 visual baselines are **not in this base** — commit `4034031`, an ancestor, dropped the
provisional U4/U5 genesis baselines), **9** timeouts, **2** viewport-fit. The three non-baseline
cases are in [Repair items](#repair-items-the-packet-asks-for); every one of the 368 baseline
failures is the missing-baseline class, not a comparison.

### Full v2 e2e suite (desktop) — before and after

The six v2 specs (`flows`, `layout`, `onboarding`, `screens.a11y`, `screens.visual`, `states`,
793 cases), same command and host, IBM Plex installed for both runs:

```
$ playwright test apps/desktop/e2e/{flows,layout,onboarding,screens.a11y,screens.visual,states}.spec.ts \
      --project=desktop --workers=8        # base 4986000
  233 passed, 560 failed (9.7m)  exit 1
  560 = 464 screenshot pixel diffs + 96 "not drawn with the design's fonts"
```

```
$ …                                              # this branch, same command --workers=10
  793 failed, 0 passed            exit 1
  all 793 = "Timeout 15000ms exceeded … waiting for locator" at harness.ts:2229
```

That is the flip measured end to end: every v2 case now boots v3, waits 15 s for its v2 selector
and fails. It is **not** a regression in behaviour the packet froze — it is the missing `?ui=v2`
pin in the v2 harness (repair item 1). Note the base row is itself red: see deviation 2.

### Full v3 e2e suite (remote PWA)

```
$ pnpm exec playwright test --project=remote --workers=4        # this branch
  91 failed, 0 passed             exit 1
  86 × page.addStyleTag: Refused to connect to 'http://127.0.0.1:8799/rpc' … Content Security Policy
   4 × page.addScriptTag: Refused to execute inline script … "script-src 'self'"
   1 × the link never became a session
$ pnpm exec playwright test apps/remote/e2e/flows.spec.ts --project=remote --workers=1   # base 4986000
  7 failed, 0 passed — the same addStyleTag/CSP error
```

Pre-existing on the CSP base branch: the remote harness injects inline style/script and dials
`127.0.0.1:8799`, which the shipped CSP does not allow. Not caused by the flip (the remote app
never reads `ui_version`), and not repairable in this packet's file list.

### Captures (`target/captures/b4a/`)

The same start route, both UIs, 1280×800, `en`, light, daemon stubs from the two harnesses; the
temporary capture spec is not committed (kept as `target/captures/cutover.cap.spec.txt`).

| File                       | Taken on                             | Shows                                                              |
| -------------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| `before-root-v2.png`       | base `4986000`, `/?screen=simple`    | the M13 v2 shell — what the window used to open on                 |
| `after-root-v3.png`        | this branch, bare `/` (no `?ui=`)    | the v3 shell — the new default                                     |
| `after-root-v2-escape.png` | this branch, `/?ui=v2&screen=simple` | the v2 shell, byte-identical to `before-root-v2.png` (`cmp` clean) |

`after-root-v3.png` was captured after `page.goto('/')` returned and `main[data-ready="true"]` —
an attribute only the v3 frame sets — became visible, so it is the _default_ start, not the
`?ui=v3` address. The two v2 captures being byte-identical is the evidence that the escape still
reaches exactly the old shell.

## Repair items (the packet asks for)

1. **`apps/desktop/e2e/harness.ts` must pin `?ui=v2`** (owner of B4a/B4b, not fixable inside the
   allowed file list). `openScreen` builds `search = options.search ?? screen.search ??
?screen=<id>` and `page.goto('/' + search)`; no v2 spec passes `ui=`, so after the flip every
   v2 case boots v3 and waits 15 s for a v2 selector. Measured below. The minimal repair is one
   place — `openScreen`'s URL builder should carry `ui=v2` when the search has no `ui=`;
   `support/global-setup.ts` goes through the same function, so it is covered.
2. **v3 visual baselines are absent from this base** (`4034031` dropped them). Every v3
   `@visual` case therefore fails with "A snapshot doesn't exist … writing actual" (and writes
   untracked PNGs). That is a base-state issue, not a B4a one: `frame.spec.ts` on the base
   commit gives the same 24 failures / 18 passes for the same reason.
3. **v3 frame, project-switcher open, 390×844 (U3):** the document is 2 px wider than the
   viewport (`frame.spec.ts:311`, `en light` and `en dark`), so the page scrolls sideways.
4. **v3 project, empty state (U3):** all six `project empty` visual cases time out waiting for
   the empty state to be visible (`project.spec.ts:462`).
5. **v3 inbox, "ignores all-pending future gates for runs at other stages per Amendment §5.5-b"
   (`inbox.spec.ts:44`)** — behavioural test, `toHaveCount` times out.
6. **Remote PWA e2e vs the shipped CSP (CSP branch / U6):** 86 cases die on
   `page.addStyleTag` (connect to `127.0.0.1:8799` refused by `connect-src`), 4 on
   `page.addScriptTag` (`script-src 'self'`), 1 on "the link never became a session".

Items 3–5 were re-run isolated, new code vs base, same command
(`--grep "project-switcher-open 390x844|project empty|all-pending future gates" --workers=1`):
**11 failed / 3 passed on both trees, with the identical messages** — they predate this packet
and belong to U3 (frame, project) and the inbox spec. Item 6 reproduces at base too. None was
touched: the packet says file, do not redesign.

## Deviations and verification limits

1. **No deviation from the allowed file list.** Touched: `apps/desktop/src/main.tsx`,
   `apps/desktop/src/main.test.tsx`, `docs/UI.md`, `docs/designs/UI_V3_PLAN.md`, this report.
   `target/` holds the captures and the capture spec (both git-ignored); the v3 snapshot
   directories are untracked output of the v3 run and were not committed.
2. **The v2 suite cannot be green on this host, before or after the flip.** At the base commit
   it is 233 passed / 560 failed: 464 pixel diffs against baselines captured on the WSL capture
   host and 96 "not drawn with the design's fonts" audits. IBM Plex was installed for this run
   (user and `/usr/local/share/fonts/warsha-capture`, the path the repo's script uses) and the
   audit probe then passed, but the rasterization still differs (e.g. `backend-kit 1440x900 en
light`: 10 305 px, ratio 0.01). `playwright.config.ts` records this exact constraint. So
   "full v2 suite green" is not verifiable here, and the packet's own precondition — a green v2
   suite as the regression fence — cannot be demonstrated on this host at all.
3. **No new devDependency and no config change** were needed for the flip or for the tests
   (`@testing-library/*` and `vitest` were already devDependencies of `apps/desktop`).
4. **The flip moves a stored-defaults decision to first paint.** For an owner whose stored
   `ui_version` is `v2`, v3 paints for one effect tick before the stored answer moves it to v2 —
   the mirror image of what the old code did for a stored `v3`. `?ui=v2` has no such tick
   (decided before paint). Recorded, not "fixed" with a blank first frame, which would change the
   clean-start behaviour the packet freezes.
5. **T10 is red on the base commit too** (four violations in v3 inbox/bench code this packet may
   not edit). Quoted above; the owning packets are B3b (inbox buttons) and U4 (bench evidence
   action + its Arabic placeholder).
