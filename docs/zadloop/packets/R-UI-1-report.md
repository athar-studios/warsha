# R-UI-1 report — v3 floor repair

Branch `zl-rui1-floor` in the isolated worktree `.agents/worktrees/zl-rui1-floor`, based on `667675d`
(`repair/dev-csp-f474776`, which contains the packet's `6550bb9`). Coder lane; the gate tools under
`bridge-io/policy/2026-11-09-ui-v3/tools` were called by absolute path and not edited
(`actions-gate.mjs` sha256 `fe23098a…`, `i18n-gate.mjs` sha256 `987337f3…`, both matching the packet).

## Commits

| #   | Commit    | Subject                                                                        |
| --- | --------- | ------------------------------------------------------------------------------ |
| 1   | `09d55e4` | `fix(v3-inbox): rename the MCP answer ids to the gate's hyphen form`           |
| 2   | `bd7bbfc` | `test(v3-inbox): assert the all-pending rows by row id`                        |
| 3   | `83f7fb8` | `test(v3-bench): cover bench.evidence.file.open from the evidence card`        |
| 4   | `9cf2316` | `fix(i18n): Arabic wording for the bench command placeholder`                  |
| 5   | `f5fa8b4` | `test(v3-project): drive the empty state from the daemon's not-found error`    |
| 6   | `97c8c94` | `fix(v3-frame): keep the open project switcher inside the viewport`            |
| 7   | `1418d9a` | `refactor(v3): drive the narrow layout from data-narrow, not a px media query` |

## Per-item result

Every item reproduced on the worktree before it was fixed; none was reported as unable to reproduce.

1. **MCP action ids (reproduced, fixed).** Baseline `actions-gate` printed both A1 lines
   (`inbox/index.tsx:646`, `:659`) plus A6 for `bench.evidence.file.open` — 3 violations, exit 0
   (the tool prints and exits 0 on violations; the violation count is the signal). Renamed to
   `inbox.mcp.allow-once` / `allow-always` in the registry (`id:` only — the `labelKey`s stay the
   underscore keys), the two `useAction` calls, the two `data-action` literals, the unit-test name and
   the three e2e references. The gate now reads **151 registered, 151 used, 0 violations**: +2 over the
   packet's 149 because the two renamed ids now satisfy the id regex (the packet anticipated the count
   moving as long as registered == used).
2. **`bench.evidence.file.open` (reproduced, fixed).** A6 named it with no e2e case. Added one case in
   `bench.spec.ts` that collects evidence at `run-gate-c` (harness `gates.evidence` fixture only, no
   daemon), asserts the two file rows, acts the id and expects the Files tab URL. A6 is gone.
3. **Arabic placeholder (reproduced, fixed).** `i18n-gate` printed I4 for `pnpm -r test` in
   `ar/bench.ts:131`; replaced with «اكتب أمر اختبار المشروع», `en` keeps the literal example. Now
   **746 keys, 0 violations**.
4. **Inbox all-pending (reproduced, fixed by tightening).** The case failed "Received 2, expected 1".
   The product is right: `run-gate-c` sits at `gate_c`, a gate stage, so its pending row is a real ask.
   The expectation now asserts exactly `inbox-row-proj-store-run-gate-a-gate_a` and
   `inbox-row-proj-ui-run-gate-c-gate_c`, a total of 2, and the absence of run-code, run-research and
   run-review **by row id**. Not weakened — D1 shows it fails if the finder matches any pending gate.
5. **Project empty (reproduced, fixed).** E2 baseline 0/8. The `empty` state sent
   `{'projects.get': {result: null}}`, which the harness answers with `PROJECTS[0]`, so `project-empty`
   never appeared. The spec now sends `{'projects.get': {error: 'project not found: missing'}}`, which
   is what the daemon answers for an unknown id and what `useProject` maps to the empty state.
   `harness.ts` (v2) untouched. E2 → 8/8.
6. **Switcher overflow (reproduced first, fixed).** E3 baseline 6 passed / 2 failed, both
   `390x844 en light|dark`, "the document is 2px wider than the 390px viewport". Measured in the page:
   the trigger's inline-start sits at x=128, the menu's floor `--w-nav-width` is 264, so its right edge
   landed at 392. Arabic passed because RTL anchors the menu on the other edge. A selector cannot ask
   an ancestor for its viewport offset, so `FrameProjectSwitcher` measures its container on open
   (direction-aware) and lets both the token floor and the `100vw` ceiling yield to the room left by
   the page gutter. No px literal is written: the room is a computed number. E3 → 8/8, and the menu is
   still 264px wherever there is room (desktop measurements unchanged).
7. **Narrow layout (not blocked; fixed with no behavioural change).** `bench.css:70` and
   `settings.css:309` held `@media (max-width: 767px)`. `BenchPage` already asked
   `useNarrowViewport`; both roots now carry `data-narrow={narrow ? 'true' : 'false'}` and the blocks
   select on it. Settings imports the same hook (`pages/bench/useNarrowViewport.ts` — the one place the
   decision is made) so paint and rendering cannot disagree. The same 768 floor and the same rules are
   used; nothing about which width flips was changed. Two properties inside the moved blocks were also
   written logically (`min-height` → `min-block-size`, `min-width` → `min-inline-size`). The two
   literals are gone rather than exempted; `scripts/check-ds-v3.mjs` was not edited.

## Acceptance — commands, exit codes, counts

Run from the worktree root; `<TOOLS>` = `/home/moe/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3/tools`.

| Gate | Command                                                                                                                                                                                                                                                                                                  | Exit | Result                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------- |
| A1   | `node <TOOLS>/actions-gate.mjs "$PWD"`                                                                                                                                                                                                                                                                   | 0    | `actions: 151 registered, 151 used, 0 violations` (base 3)                                                        |
| A2   | `node <TOOLS>/i18n-gate.mjs "$PWD"`                                                                                                                                                                                                                                                                      | 0    | `i18n-v3: 746 keys, 0 violations` (base 1)                                                                        |
| A3   | `node <TOOLS>/actions-gate.mjs --self-test`                                                                                                                                                                                                                                                              | 0    | every check `ok`                                                                                                  |
| A3   | `node <TOOLS>/i18n-gate.mjs --self-test`                                                                                                                                                                                                                                                                 | 0    | every check `ok`                                                                                                  |
| A4   | `node <TOOLS>/contrast.mjs --check-css packages/ui/src/v3/tokens/tokens.css`                                                                                                                                                                                                                             | 0    | `fails 0`                                                                                                         |
| A5   | `node scripts/check-ds-v3.mjs apps/desktop/src/v3 packages/ui/src/v3 apps/remote/src`                                                                                                                                                                                                                    | 0    | `0 violations` (base 2)                                                                                           |
| E1   | `pnpm exec playwright test --project=desktop apps/desktop/e2e/v3 --grep-invert "@visual" --workers=3`                                                                                                                                                                                                    | 0    | **283 passed, 0 failed** (base 281/1)                                                                             |
| E2   | `pnpm exec playwright test --project=desktop apps/desktop/e2e/v3/project.spec.ts --grep "project empty" --ignore-snapshots`                                                                                                                                                                              | 0    | **8 passed** (base 0/8)                                                                                           |
| E3   | `pnpm exec playwright test --project=desktop apps/desktop/e2e/v3/frame.spec.ts --grep "project-switcher-open" --ignore-snapshots`                                                                                                                                                                        | 0    | **8 passed**, `390x844` ar/en light/dark (base 2 fail)                                                            |
| U1   | `pnpm lint`                                                                                                                                                                                                                                                                                              | 0    | 1 warning, 0 errors — `inbox/index.tsx:376` `react-hooks/exhaustive-deps`, pre-existing and not on a changed line |
| U1   | `pnpm typecheck`                                                                                                                                                                                                                                                                                         | 0    | 7 projects (desktop runs `tsc` and `tsc -p tsconfig.e2e.json`)                                                    |
| U1   | `pnpm -r test`                                                                                                                                                                                                                                                                                           | 0    | desktop 772, client 172, remote 221, ui 373, i18n 58, crypto 22 — none below base                                 |
| G1   | `node scripts/check-wire-contract.mjs`                                                                                                                                                                                                                                                                   | 0    | `wire: 11 checks, 0 violations`                                                                                   |
| G1   | `node scripts/check-arch.mjs`                                                                                                                                                                                                                                                                            | 0    | `arch: 5 rules, 0 violations`                                                                                     |
| G1   | `node scripts/check-engineering-policy.mjs`                                                                                                                                                                                                                                                              | 0    | `policy: 8 checks, 0 failures`                                                                                    |
| V1   | `git diff --stat 6550bb9..HEAD -- apps/desktop/src/screens apps/desktop/e2e/harness.ts apps/desktop/e2e/screens.visual.spec.ts apps/desktop/e2e/states.spec.ts apps/desktop/e2e/screens.a11y.spec.ts apps/desktop/e2e/flows.spec.ts apps/desktop/e2e/layout.spec.ts apps/desktop/e2e/onboarding.spec.ts` | 0    | no output — the v2 fence holds                                                                                    |
| V1   | `git diff --name-only 6550bb9..HEAD \| grep -c "snapshots"`                                                                                                                                                                                                                                              | 0    | `0`                                                                                                               |

E1 is **283**, not the packet's projected 282: the base had 282 cases (281 passed + 1 failed), so the
added bench case makes 283 and all of them pass. `failed` is 0 and `passed` is ≥ 282 as required.

## D1 — discrimination artifacts (`target/discrimination/`)

| Item | Artifact                                | What it shows                                                                                                                                                                                                                                                                                                  |
| ---- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `item1-underscore-reverted.log`         | With `inbox.mcp.allow-once` reverted to `allow_once` in the registry and `data-action`, `actions-gate` exits 1 with `A1 apps/desktop/src/v3/pages/inbox/index.tsx:646 <Button> has no literal data-action="page.verb"` and `150 registered, 150 used, 1 violations`. Restored → 151/151, 0 violations, exit 0. |
| 4    | `item4-any-pending-gate.log`            | With `findPendingGateAtCurrentStage` changed to `gates.find((g) => g.state.state === 'pending')`, the tightened inbox case fails (`1 failed`, the `run-gate-c` row is absent because the finder returns `gate_a` for every run). Restored → E1 green.                                                          |
| 5    | `item5-empty-without-error-fixture.log` | With the `empty` fixture reverted to `{result: null}`, E2 fails every case waiting for `project-empty` (`1 failed` per artifact excerpt, `project-empty` never appears). Restored → 8/8.                                                                                                                       |

## Out of scope — untouched

No v2 file (`src/screens/**`, `e2e/harness.ts`, `screens.visual.spec.ts`, `states.spec.ts`,
`screens.a11y.spec.ts`, `flows.spec.ts`, `layout.spec.ts`, `onboarding.spec.ts`), no Rust, no wire, no
`runs.resume`, no type scale / sound / motion, no remote PWA CSP work, no B4b/B6/Stage B. No
`*-snapshots` path was created and no PNG was left behind: every visual run used `--ignore-snapshots`,
and `git status --untracked-files=all` shows no `.png`. `docs/zadloop/packets` and `PROGRESS.md` were
not modified; this report is the only doc change.

## Notes and limits

- `pnpm exec prettier --check` reports drift on the base tree itself (untouched files such as
  `packages/i18n/src/v3/en/bench.ts` and `apps/desktop/src/v3/pages/home/home.css` fail it too). Every
  line this packet added is prettier-clean — verified by diffing `prettier <file>` against each changed
  file: the only residue is pre-existing wrap drift outside the edits. The repo-wide `format:check` was
  not run to completion, and I did not reformat files I was not allowed to own.
- Playwright was run against `--ignore-snapshots` only (`--update-snapshots` never invoked). The three
  pre-existing `*-snapshots` directories under `apps/desktop`/`apps/remote` belong to v2/remote specs;
  none was written to.
- Gates are quoted from real runs on the committed tree (`97c8c94`…`1418d9a`); E1/E2/E3 ran on exactly
  this content, and the working tree is clean at settle time.
