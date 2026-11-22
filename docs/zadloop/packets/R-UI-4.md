# R-UI-4 — genesis baselines for v3 (RU3–RU6) + remote PWA harness repair

Status: spec frozen. Base: `0ac5994` (R-UI-3 merged) on `repair/dev-csp-f474776`. Depends on R-UI-1/2/3 (merged: floor
green, controls reachable, pixels final). Specs and harness fixtures only — **no product code, no baseline PNG is
committed by an agent**. Gate tools: `TOOLS=bridge-io/policy/2026-11-09-ui-v3/tools`.

**Capture verdict (measured 2026-11-15): capture is NOT possible on this host, and CI cannot capture. Part A
(baselines) is STOP-gated on a named capture host (§Unblock). Part B (remote harness CSP repair) is host-independent
and runs now.** Do not specify or attempt a capture here "to see what happens".

## Why (measured at `0ac5994`)

- v3 has **0** `*-snapshots` directories (`git ls-files apps/desktop/e2e/v3 | grep -c snapshots` → 0). The only
  committed baselines are v2/remote: `screens.visual.spec.ts-snapshots` 308, `states.spec.ts-snapshots` 455,
  `apps/remote/e2e/bench.visual.spec.ts-snapshots` 84 (all Linux, captured on the WSL host).
- `@visual` in `apps/desktop/e2e/v3/*.spec.ts`: 98 `test(...)` declarations over 8 files (bench 4, frame 3, home 3, inbox
  3, onboarding 3, project 3, projects 3, settings 5 + parametrised loops), which `playwright test --list --grep @visual
  --project=desktop apps/desktop/e2e/v3` expands to **416 cases**: bench 96, frame 24, home 40, inbox 32, onboarding
  32, project 40, projects 32, settings 120. Every one of them has no baseline, so every one fails today with
  "snapshot doesn't exist" (the intended genesis signal). Non-visual v3: 291 passed (R-UI-2 report).
- **Host drift.** B4a measured the v2 suite on this host at base `4986000`: **233 passed / 560 failed** (464 pixel
  diffs, 96 font audits), and after installing IBM Plex into `/usr/local/share/fonts/warsha-capture` still 10 305 px
  diff on `backend-kit 1440x900 en light` (R-BRIDGE-B4a-report, deviation 2). Re-checked now: the nine Plex faces are
  present (`fc-match "IBM Plex Sans Arabic"` → `IBMPlexSansArabic-Regular.ttf`, `fc-list | grep -ci "IBM Plex"` → 18)
  and the repo pin exists (`scripts/ci/capture-fontconfig.conf`, loaded by `playwright.config.ts` via
  `FONTCONFIG_FILE`) — yet rasterisation is still not the WSL host's. Fonts present ≠ capture-grade: the host's
  FreeType/Chromium build, not the family list, is what differs. Baselines made here would be wrong forever.
- **CI cannot capture.** CI billing is failed (PROGRESS 2026-11-13: "job was not started because recent account
  payments have failed"); `ci.yml` has the pinned-font + pinned-fontconfig steps and runs `pnpm visual`, but no job
  starts. No capture job writes artifacts either (compare-only).
- **Remote e2e is red for a harness reason, not a product reason.** `apps/remote/e2e/harness.ts` pins
  `REMOTE_DAEMON_URL = 'http://127.0.0.1:8799'` while the shipped CSP in `apps/remote/index.html` allows
  `connect-src 'self' http://127.0.0.1:8765 ws://127.0.0.1:8766 http://localhost:8765 ws://localhost:8766`.
  B4a measured 86 cases dying on `Refused to connect to 'http://127.0.0.1:8799/rpc' … Content Security Policy`
  (surfacing at `page.addStyleTag`), 7/7 of `flows.spec.ts` included. Remote has 84 visual + 7 flow cases; its 84
  baselines **already exist**, so remote is a *compare* (and, only if R-UI-1..3 moved remote pixels — they did not touch
  `apps/remote` — a refresh), not a genesis.

## Goal

1. **Part B (now):** remote PWA e2e runs without CSP refusals — `apps/remote/e2e/flows.spec.ts` 7 passed and the 84
   remote visual cases fail only on pixel/font reasons when run on a non-capture host (never on CSP), the product CSP
   unchanged.
2. **Part A (when a capture host exists):** v3 baselines for all 416 desktop cases (RU3–RU6 = the Projects/Home/Frame,
   Inbox, Project/Bench, Settings/Onboarding waves) exist under `apps/desktop/e2e/v3/*.spec.ts-snapshots/`, captured
   once, fenced, verified by a plain second run, and **staged for the owner** (OD-U1 review-each).

## Frozen capture protocol (Part A)

### Capture-host requirements (all must be proven; any miss = STOP)

1. Linux, the same chromium as `@playwright/test` 1.49.1 (`pnpm exec playwright install --with-deps chromium`).
2. `bash scripts/ci/install-capture-fonts.sh` exit 0 (pinned google/fonts commit, SHA-256 per face; it refuses to
   continue unless `fc-match` resolves the faces from those files) and `FONTCONFIG_FILE` pin from
   `scripts/ci/capture-fontconfig.conf` active (config default; never set `WARSHA_CAPTURE_FONTCONFIG_FILE`).
3. **Canary — host is capture-grade only if it reproduces committed baselines.** Before any `--update-snapshots`:
   `pnpm exec playwright test --project=remote apps/remote/e2e/bench.visual.spec.ts --workers=3` (after Part B) must
   report **84 passed / 0 failed**; and `pnpm exec playwright test --project=desktop apps/desktop/e2e/screens.visual.spec.ts`
   must report 0 pixel failures. A host that fails the canary (this host does: 233/560) is not a capture host. This
   canary is the objective test of "pinned host"; the v3 baselines inherit the WSL host's rasterisation by construction.
4. Clean tree, `git status --short` empty; run in a worktree off the packet base.

### Order (each step gates the next)

1. `pnpm install --frozen-lockfile`; `pnpm lint && pnpm typecheck && pnpm -r test` exit 0.
2. Host canary (above) green.
3. Genesis capture, **desktop v3 only**, one project, in a fixed order that matches the waves, `--workers=3` (CI value):
   `pnpm exec playwright test --project=desktop apps/desktop/e2e/v3 --grep "@visual" --update-snapshots
   --reporter=json > /tmp/r-ui-4/genesis.json` and the run must **exit 0**. (Never `pnpm visual:update`: it also
   rewrites v2 and remote baselines, which the fence forbids.) Suites in order RU3 `projects,home,frame` → RU4 `inbox`
   → RU5 `project,bench` → RU6 `settings,onboarding`; each wave may be a separate `--update-snapshots` invocation but
   every invocation exits 0 and its JSON is checked.
4. Defect fence **before any PNG is copied or staged**: `node $TOOLS/pw-genesis.mjs check /tmp/r-ui-4/genesis.json`
   → `defective=0`. Any case failing for a reason other than a missing snapshot (layout, clipping, font audit, a11y,
   `auditViewportFit`) is a product/test defect: stop, report, do not freeze it (the 2026-11-10 0px-wide Workbench
   renders were frozen exactly that way).
5. Fence: `node $TOOLS/pw-gate.mjs snapshots <base> <head> allow.txt` where `allow.txt` lists only
   `apps/desktop/e2e/v3/*.spec.ts-snapshots/*`. Exit 0 = no other baseline (v2, remote) moved.
6. Second plain run, **zero** `--update-snapshots`: `pnpm exec playwright test --project=desktop apps/desktop/e2e/v3
   --grep "@visual" --workers=3 --reporter=json > /tmp/r-ui-4/verify.json`; `node $TOOLS/pw-gate.mjs counts
   /tmp/r-ui-4/verify.json 416 0` exit 0 (416 passed, 0 failed).
7. Non-visual v3 still green: `pnpm exec playwright test --project=desktop apps/desktop/e2e/v3 --grep-invert "@visual"
   --workers=3` → 291 passed, 0 failed.
8. Stage, do not commit: `git add apps/desktop/e2e/v3/*.spec.ts-snapshots`; stop at "baselines staged". The owner
   reviews each wave (OD-U1) and commits.

### Per-surface acceptance

| Surface | Cases | Acceptance |
|---|---|---|
| RU3 projects / home / frame | 32 / 40 / 24 | all genesis-only, then verify pass |
| RU4 inbox | 32 | same |
| RU5 project / bench | 40 / 96 | same; bench `bench-gate-waiting-*` and `bench-error-*` included |
| RU6 settings / onboarding | 120 / 32 | same |
| Desktop total | 416 | 416 genesis, then 416 passed / 0 failed |
| Remote PWA | 84 visual + 7 flows | **no genesis**: 84 existing baselines + 7 flows pass on the capture host after Part B; unchanged PNGs (the fence rejects any remote PNG diff) |

Each of the 8 spec files carries two viewports × ar/en × light/dark; a baseline set missing any variant fails step 6.

### Unblock condition (STOP rule)

Part A may start only when **one** of these is true, named by the owner in writing:

- **(U-a)** CI billing restored *and* a capture-only workflow (`workflow_dispatch`, uploads
  `apps/desktop/e2e/v3/*.spec.ts-snapshots` as an artifact; **a workflow file is outside this packet's allowed files**
  — a separate owner-approved packet adds it) *and* the runner passes the canary; or
- **(U-b)** the original WSL capture host (the one that made the 847 committed baselines) is available to the owner
  and passes the canary; or
- **(U-c)** the owner accepts a different pinned host after it passes the canary (the canary is the acceptance).

Until then: Part A status = `STOPPED — capture host`, owner stop. The packet report records the canary result
actually measured. This host (fonts present, 233/560 on v2) fails U-c today. No agent substitutes "capture here, fix
later": wrong baselines would turn the whole 416-case suite into a false green.

## Part B — remote harness repair (runs now, any host)

Files: `apps/remote/e2e/harness.ts` (and `flows.spec.ts` only if a literal URL must follow the constant).
Two acceptable, equivalent repairs; implementer picks one and records it:

- **B-1 (preferred):** set `REMOTE_DAEMON_URL` to a value the shipped CSP already allows (`http://127.0.0.1:8765`)
  and keep the harness `page.route`/`routeWebSocket` fixtures answering that origin. No CSP change, no bypass.
- **B-2:** create the test context with Playwright `bypassCSP: true` in the harness only. Use only if B-1 breaks a flow
  that must dial 8799; note it removes CSP as a tested property for e2e, and say so in the report.

Never edit `apps/remote/index.html`, the `REMOTE_CSP` const, or loosen `connect-src`. Replace `addStyleTag` with an
`addInitScript` that injects the same animation-off rule via `document.addEventListener('DOMContentLoaded', …)`
**only if** an inline-style CSP error remains after B-1 (`style-src` already has `'unsafe-inline'`, so it should not).
Discrimination: on the base, `flows.spec.ts` fails 7/7 with the CSP message; after, 7/7 pass.

## Allowed files

- `apps/remote/e2e/harness.ts`, `apps/remote/e2e/flows.spec.ts` (URL literal only)
- `apps/desktop/e2e/v3/*.spec.ts` and `apps/desktop/e2e/v3/support/*` — **only** a fixture/selector repair for a defect
  that pw-genesis exposes (listed in the report, minimal; not a way to make a case pass)
- Baselines: `apps/desktop/e2e/v3/*.spec.ts-snapshots/**` (Part A only; staged, never committed by the agent)
- `docs/zadloop/packets/R-UI-4-report.md`

## Out of scope

Product CSS/TS/Rust; `apps/remote/index.html` or the CSP; `playwright.config.ts` tolerances (`maxDiffPixelRatio 0`,
`threshold 0.05`); `.github/workflows/*` (U-a is a separate packet); v2 and remote baselines; the gate tools under
`bridge-io/policy/**/tools` (planner-owned); B4b v2 deletion, B6, Stage B; R-UI-5 (T3 Android, T2 Windows).

## Constraints

- No baseline PNG committed; no capture on a host that fails the canary; no `--update-snapshots` without a green
  `pw-genesis` plan, and no copying before `defective=0`.
- Do not weaken a test, widen a tolerance or add `fixme`/`skip` to reach green. A defective case is reported.
- Small Conventional Commits on a `zl-rui4-*` branch from `0ac5994`; implementer never authors gates; reviewer and
  verifier separate; no push/tag/publish.
- UI strings stay i18n ar+en (no UI text is touched); mock provider only.

## Steps

1. Part B: reproduce on base — `pnpm exec playwright test --project=remote apps/remote/e2e/flows.spec.ts --workers=1`
   → 7 failed with the CSP message (save output).
2. Apply B-1 (or B-2); rerun → 7 passed; run `bench.visual.spec.ts` on this host: failures allowed **only** as
   pixel diffs/font audits, **zero** `Content Security Policy` messages (`grep -c "Content Security Policy"` → 0).
3. Run the Part A host check (canary). If it fails: write the report with the measured numbers, set Part A
   `STOPPED — capture host`, name U-a/U-b/U-c, end. Nothing is captured.
4. If it passes: Part A order 1–8 above; report counts per wave, the `pw-genesis` and `pw-gate` lines verbatim.

## Gates (exact commands; `TOOLS=bridge-io/policy/2026-11-09-ui-v3/tools`)

```
pnpm lint && pnpm typecheck && pnpm -r test                                         # 0
pnpm exec playwright test --project=remote apps/remote/e2e/flows.spec.ts --workers=1 # 7 passed, 0 CSP messages
node $TOOLS/pw-genesis.mjs --self-test                                              # 0 (tool sanity)
node $TOOLS/pw-genesis.mjs check /tmp/r-ui-4/genesis.json                           # defective=0 (Part A, before copying)
node $TOOLS/pw-gate.mjs snapshots <base> <head> allow.txt                           # 0 (only v3 snapshot dirs moved)
node $TOOLS/pw-gate.mjs counts /tmp/r-ui-4/verify.json 416 0                        # 0 (plain second run)
pnpm exec playwright test --project=desktop apps/desktop/e2e/v3 --grep-invert "@visual" --workers=3  # 291 passed
node scripts/check-ds-v3.mjs apps/desktop/src/v3 packages/ui/src/v3 apps/remote/src # 0 violations
node $TOOLS/i18n-gate.mjs "$PWD"                                                    # 0
node $TOOLS/actions-gate.mjs "$PWD"                                                 # 0
git diff --name-only 0ac5994 HEAD | grep -vE '^(apps/remote/e2e/|apps/desktop/e2e/v3/|docs/zadloop/packets/R-UI-4)' # prints nothing
```

Part-B-only completion (capture host absent) requires only: lint/typecheck/test, the remote flows line, the three
gate tools at 0, and the diff-scope line; the pw-genesis/pw-gate snapshot/counts lines are then "not run — STOPPED,
capture host" in the report, never "passed".
