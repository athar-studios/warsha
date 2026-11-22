# R-UI-1 — v3 floor repair (make the v3 gates green before any baseline)

Status: spec frozen. Base: `6550bb9` (or the PM's current tip containing it). Depends on nothing. UI/e2e only —
**no Rust, no wire, no v2 file**. Gate tool path `<TOOLS>` = `/home/moe/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3/tools`
(git-ignored, absent from worktrees — call by that absolute path; do not copy into the repo, do not edit).

## Why

Measured on the base (2026-11-15): `actions-gate` 3 violations, `i18n-gate` 1, `check-ds-v3` 2, v3 non-visual
Playwright 281 pass / 1 fail, plus 12 `@visual` cases failing for non-snapshot reasons. A genesis capture over a red
floor froze 8 broken renders once already (`pw-genesis.mjs` header). Each item below was root-caused:

| # | Symptom (measured) | Root cause | Fix site |
|---|---|---|---|
| 1 | `A1 inbox/index.tsx:646` and `:659` "no literal data-action" | the gate's id regex `[a-z0-9-]+(\.[a-z0-9-]+)+` rejects underscores: `inbox.mcp.allow_once` / `inbox.mcp.allow_always` | rename ids to `inbox.mcp.allow-once` / `inbox.mcp.allow-always` in `actions/registry/inbox.ts`, `pages/inbox/index.tsx` (`useAction` calls + `data-action`), `Inbox.test.tsx:498`, `e2e/v3/inbox.spec.ts:276,299,300`. i18n **keys** (`inbox.mcp.allow_once`…) are not action ids — leave them. `inbox.mcp.deny` is fine. |
| 2 | `A6 bench.evidence.file.open` has no e2e case | B2 registered it without a spec reference | add one case in `e2e/v3/bench.spec.ts` that opens the Evidence card with a file row and acts `bench.evidence.file.open` (harness fixture only; no real daemon) |
| 3 | `I4 ar bench.evidence.command_placeholder contains Latin text: pnpm -r test` | Arabic catalog holds a Latin command | `packages/i18n/src/v3/ar/bench.ts:131` → Arabic wording («اكتب أمر اختبار المشروع»); keep the English example in `en`. Do not edit the gate or its allow-list. |
| 4 | `inbox.spec.ts:44` "ignores all-pending future gates" fails: Received 2 rows, expected 1 | **test defect, product is right.** Harness `RUNS` has `run-gate-c` (proj-ui, stage `gate_c`) and the fixture makes every gate `pending`, so run-gate-c *legitimately* waits at its current gate. Product `findPendingGateAtCurrentStage` is correct (unit tests pass). | fix the expectation: exactly the rows for `run-gate-a` and `run-gate-c`, and **no** row for `run-code`/`run-research`/`run-review` (stage ≠ a gate stage). Assert by `data-testid="inbox-row-*"` ids, not count alone. |
| 5 | 8× `project empty` visual cases time out waiting for `project-empty` | harness `projects.get` answers `PROJECTS[0]` for unknown ids (`harness.ts:1429`), the daemon answers `-32000 "project not found: <id>"` which `useProject` maps to the empty state | in `e2e/v3/project.spec.ts` the `empty` state passes `fixtures: {'projects.get': {error: 'project not found: missing'}}` (spec-side). Do **not** edit `harness.ts` (v2 shared). |
| 6 | 2× `frame project-switcher-open 390x844 en light/dark`: "document is 2px wider than the 390px viewport" | product CSS: the open switcher overflows 2 px at phone width | fix in `pages/frame/frame.css` / `FrameProjectSwitcher.tsx` using logical properties and tokens; the page must not scroll sideways (`viewportFitIsClean`) in ar and en |
| 7 | `check-ds-v3`: `@media (max-width: 767px)` px literal at `bench.css:70`, `settings.css:309` | CSS media queries cannot take custom properties | drive the narrow layout from the existing `useNarrowViewport` hook via a `data-narrow` attribute on the root and select on `[data-narrow="true"]` (bench already has the hook; settings gets the same). If this cannot be done without a behavioural change, **stop and report** — do not edit `scripts/check-ds-v3.mjs` and do not add an exemption. |

## Allowed files

`apps/desktop/src/v3/actions/registry/{inbox,bench}.ts` (ids only), `apps/desktop/src/v3/pages/inbox/index.tsx`,
`.../Inbox.test.tsx`, `apps/desktop/src/v3/pages/frame/{frame.css,FrameProjectSwitcher.tsx,Frame.test.tsx}`,
`apps/desktop/src/v3/pages/bench/{bench.css,index.tsx}` + `.../useNarrowViewport.ts` (item 7 only),
`apps/desktop/src/v3/pages/settings/{settings.css,index.tsx}` (item 7 only),
`apps/desktop/e2e/v3/{inbox,project,bench,frame}.spec.ts`, `packages/i18n/src/v3/ar/bench.ts`, plus the packet report
`docs/zadloop/packets/R-UI-1-report.md`. Nothing else.

## Out of scope (do not touch)

Every v2 file (`apps/desktop/src/screens/**`, `apps/desktop/e2e/harness.ts`, `screens.visual.spec.ts`,
`states.spec.ts`); any `*-snapshots/**` (no baselines exist and none may be created — see Steps 6); Rust; wire;
`runs.resume` capability (R-UI-2); type scale / sound / motion (R-UI-3); the remote PWA e2e CSP failures (R-UI-4);
B4b, B6, Stage B.

## Constraints

Isolated `git worktree`, branch `zl-rui1-*` from the base; implementer never authors gates; reviewer and verifier
are separate roles; small Conventional Commits; no force push/tag/publish; mock provider only; no secrets; no test
weakening (item 4 *tightens* the assertion). UI strings only via the ar+en catalogs; logical CSS properties; no
`any`; ESLint/Prettier clean. If an `--ignore-snapshots` run writes PNGs they are untracked output — delete them
before committing (`git status` must show no `*-snapshots` path).

## Steps

1. Items 1–3 (gate hygiene) → run `actions-gate`, `i18n-gate`.
2. Item 4 (inbox spec), item 5 (project empty fixture).
3. Item 6 (switcher overflow) — reproduce first with the Acceptance E3 command, then fix.
4. Item 7 (narrow layout without px literals); if blocked, report and leave the two literals.
5. Run the full Acceptance list; write the report with counts and the discrimination artifacts.
6. Never run `--update-snapshots`; use `--ignore-snapshots` for the visual-case acceptance.

## Acceptance (frozen)

Run from the worktree root unless noted; `<TOOLS>` as above.

- A1 `node <TOOLS>/actions-gate.mjs "$PWD"` → `actions: 149 registered, 149 used, 0 violations`, exit 0 (base: 3).
  (Count 149 may change by the renamed ids staying registered; the violation count must be 0 and registered == used.)
- A2 `node <TOOLS>/i18n-gate.mjs "$PWD"` → `0 violations`, exit 0 (base: 1, 746 keys).
- A3 `node <TOOLS>/actions-gate.mjs --self-test` and `node <TOOLS>/i18n-gate.mjs --self-test` exit 0 (tools unchanged:
  sha256 `fe23098a…` / `987337f3…`).
- A4 `node <TOOLS>/contrast.mjs --check-css packages/ui/src/v3/tokens/tokens.css` → `fails 0`, exit 0.
- A5 `node scripts/check-ds-v3.mjs apps/desktop/src/v3 packages/ui/src/v3 apps/remote/src` exit 0 (base: exit 1,
  2 literals), unless item 7 was reported as blocked (then it must print exactly those 2 lines and nothing new).
- E1 `pnpm exec playwright test --project=desktop apps/desktop/e2e/v3 --grep-invert "@visual" --workers=3` →
  **282 passed, 0 failed** (base 281/1; the added bench case makes 282, +1 if item 2 adds one case — report the real
  number, `failed` must be 0 and `passed` ≥ 282).
- E2 `pnpm exec playwright test --project=desktop apps/desktop/e2e/v3/project.spec.ts --grep "project empty" --ignore-snapshots`
  → 8 passed (base 0/8).
- E3 `pnpm exec playwright test --project=desktop apps/desktop/e2e/v3/frame.spec.ts --grep "project-switcher-open" --ignore-snapshots`
  → all passed incl. `390x844` ar/en light/dark (base: 2 en cases fail on `viewport fit`).
- U1 `pnpm lint` 0; `pnpm typecheck` 0; `pnpm -r test` 0 with desktop ≥ 772, client 172, remote 221, ui 373, i18n 58,
  crypto 22 (no count below base).
- G1 `node scripts/check-wire-contract.mjs` 11/0; `node scripts/check-arch.mjs` 5/0; `node scripts/check-engineering-policy.mjs`
  8/0 (nothing here touches them; quoted from a run is acceptable, a run is better).
- V1 v2 fence: `git diff --stat 6550bb9..HEAD -- apps/desktop/src/screens apps/desktop/e2e/harness.ts apps/desktop/e2e/screens.visual.spec.ts apps/desktop/e2e/states.spec.ts apps/desktop/e2e/screens.a11y.spec.ts apps/desktop/e2e/flows.spec.ts apps/desktop/e2e/layout.spec.ts apps/desktop/e2e/onboarding.spec.ts` prints nothing;
  `git diff --name-only 6550bb9..HEAD | grep -c "snapshots"` prints `0`.
- D1 Discrimination (artifacts under `target/discrimination/`): item 4 — the tightened inbox test fails if
  `findPendingGateAtCurrentStage` is changed to match any pending gate; item 5 — the `empty` case fails without the
  error fixture; item 1 — `actions-gate` fails again if one id is reverted to an underscore.
- Report lists every command with its exit code and counts; anything not run is named as not run.
