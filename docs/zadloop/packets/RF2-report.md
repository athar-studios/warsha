# RF2-report: Baseline capture (visual v3) — CI route

**Goal:** Unblock F2 visual baselines via CI capture (Amendment A7, owner instruction 2026-11-15).
**Status:** Delivered with one blocked gate (§0.6) — capture leg green, verify leg blocked by a rasterizer nondeterminism the plan forbids us to tolerate away.
**Workflow:** `.github/workflows/capture-baselines.yml`
**Branch:** `r-next/rf2-ci-capture` (push exception authorized by A7; main never touched)

## Delivered

1. **CI capture workflow** (`.github/workflows/capture-baselines.yml`): builds the F1 pinned-font capture image (`docker/capture/Dockerfile` + `warsha-capture:0.3.0`), runs the R-UI-4 Part A protocol — canary, desktop v3 genesis (8 spec files, `--grep @visual --update-snapshots`), pw-genesis defect fence, desktop verify, remote bench genesis+verify, pw-gate counts 416/0 and 84/0 — and uploads the `v3-baselines` artifact (416 desktop + 84 remote PNGs + JSON reports).
2. **Gate tools committed** (`scripts/ci/pw-gate.mjs`, `scripts/ci/pw-genesis.mjs`, mode 100755, both `--self-test` green): recovered from git history 253105d because `bridge-io/` is gitignored (.gitignore:73-74).
3. **416 verified v3 baselines** captured in CI inside the pinned image (artifact of run 43773883755, byte-compared). Desktop genesis leg: 416 written, `pw-genesis defective=0`; desktop verify leg in one container session: **416 passed / 0 failed** (run 43773883755).
4. **Two committed-gate repairs carried by RF2** (a blocked gate on the current tree would have stalled F2/§0.6; both logged in DECISIONS.md, both reversible product/harness fixes, no tolerance weakened):
   - **D-RN-RF2-3** — `apps/desktop/e2e/support/fonts.ts`: the canvas metrics cross-check ran on the app page, where `@fontsource` `@font-face` rules for IBM Plex send `measureText` through the webfont path; an unloaded unicode-range subset made the mono width coincide with the unknown-family width (240 == 240) and 16 remote audit cases flagged "IBM Plex Mono not installed" while CDP proved the page draws real Plex glyphs (per-char widths varied; `latinMono=110 ≠ latinNone=100`). Probe now runs on an isolated `about:blank` page in the same context; the CDP element probes still verify the app page itself. Check meaning unchanged.
   - **D-RN-RF2-4** — `packages/ui/src/v3/tokens/{tokens.css,color.ts}`: light-theme `--w-text-faint` #7A756B measured **3.92:1** on `--w-danger-soft` (remote run feed timestamps; axe wcag2aa color-contrast, 6 findings, RunScreen.tsx:424-436). Raised to #6B665C: 4.88 on danger-soft, 4.84–5.71 on every other light background, still a step below muted #5F5B53; dark theme untouched. `contrast.test.ts` 50/50, ui 383/383, ui+desktop tsc clean.
   - **Dockerfile libpango/libcairo** — CI builds the image fresh from the Dockerfile; the trimmed apt list (F1-era, built incrementally) was missing `libpango-1.0-0` + `libcairo2`, so headless_shell failed the font-probe (`rc=127`). Added both; local build verified.
5. **Truthful run log** (all on warsha-dev, run links in the table below).

## CI runs (workflow `Baseline capture (RF2)`)

| Run | Head | Result | Note |
|---|---|---|---|
| 43759694805 | d8781c9 | failure | JSON report ENOENT — config pins reporter output to `bridge-io/audit/visual-playwright.json`; `PLAYWRIGHT_JSON_OUTPUT_NAME` never materializes. Genesis itself green (416 written). |
| 43760485096 | eab3586 | failure | Docker build: missing libpango-1.0-0 + libcairo2 (fixed in eab3586's predecessor). |
| 43762745709 | 426938d | failure | Desktop verify 415/1 — first sighting of the LCD-fringe flip (below). |
| 43773883755 | 85d0689 | **desktop leg green** | One-container session: genesis 416 defective=0, verify **416/0**. Remote leg failed on 22 audit findings (16 fonts.ts + 6 axe) → fixed by a5830f7. |
| 43779839959 | a5830f7 | failure | Desktop verify 415/1 — same fringe class, now inside ONE container (see below). |

Earlier runs 43750253701–43752538005 were the worker's `ci.yml` detour (workflow_dispatch requires the file on the default branch; A7 forbids touching main) — wrong workflow, no baselines possible; superseded by D-RN-RF2-1 (push-trigger on the authorized branch).

## Blocked gate (§0.6): exact 416/0 verify is unsatisfiable across page loads

**Finding.** After a CI genesis capture, a verify pass fails 1–3 cases at random with 3–14 px differences: the LCD subpixel fringe of a horizontal rule's right end (x980 @1280w; x370 @390w) flickers with subpixel phase **per page load** — deltas 55–69 per channel, above playwright's `threshold: 0.05` (~12.75/255) but far below F1's canary tolerance (δ≤13, ≤64 px). `pw-genesis defective=0` in every run: this is not a product defect.

**Evidence (3 experiments, 260+ measured verify passes):**
- 100 fresh-container verify runs vs CI genesis baselines: 0F ×8, 1F ×~30, 2F ×~38, 3F ×~22, 4–5F ×2; **never two consecutive all-green runs**.
- Run 5 (a5830f7) ran genesis+verify in ONE container session (D-RN-RF2-2) and still failed 415/1 — the fringe flips per page load, not per container.
- Round 2 (100 runs vs run-5 baselines, fresh containers): 0F ×12, 1F ×~40, 2F ×~33, 3F ×~10, 4F ×4, 5F ×1; two consecutive greens occurred once, never three. P(3 consecutive greens) ≈ 0.2%.

**Why this blocks the A7 proof.** A7 requires 3 consecutive green capture runs with the exact `pw-gate counts 416 0` gate. At ~12% all-green probability per pass that proof is a lottery (~0.2%), and the only ways to make it deterministic are forbidden: raising `max-failed` or the screenshot threshold = weakening a gate (A7 §"never weaken"), F1-style decoded-pixel tolerance in the desktop suite = product/test change outside RF2's file scope.

**Fail-closed path taken (§0.4 → §0.6):** RF2 is recorded as delivered-with-blocked-gate. The capture leg (genesis + defect fence + artifact) is green and the 416 baselines are good; the verify leg is recorded here and in the owner checklist as blocked pending an owner decision: (i) accept an F1-style decoded-pixel tolerance for the desktop suite (owner call — it is a committed-gate change), or (ii) accept a one-container capture+verify session as the FIN4 @visual protocol (already implemented in the workflow; run 4's desktop leg proves it can go 416/0).

**What this unblocks anyway:** F2's deliverable (416 CI-captured baselines + non-visual v3 suite green) is complete; FIN4's @visual rows can be recorded against run 43773883755's green one-container verify, with the blocked-gate finding attached.

## Cost

Public repository, GitHub-hosted minutes free. Worker + PM local runs used the prebuilt `warsha-capture:rf2-test` image; no paid API spend attributable to RF2 beyond the delegation attempt (Coder lane, 1 attempt, no corrections spent).

## Decisions

- **D-RN-RF2-1** — push-trigger instead of workflow_dispatch (dispatch API needs the file on main; main is forbidden).
- **D-RN-RF2-2** — genesis+verify share one container session; header documents the 100-run experiment; gates unchanged.
- **D-RN-RF2-3** — fonts.ts isolated-page probe (above).
- **D-RN-RF2-4** — light-theme `--w-text-faint` #7A756B → #6B665C (above).

## Addendum — A10 resolution (2026-11-16)

Amendment 3 / A10 (owner decision, m03702) resolved this packet's blocked gate with option (i):
the `@visual` comparison adopts the F1 canary's decoded-pixel budget — `maxDiffPixels: 64` with
`threshold: 0.05` unchanged (`playwright.config.ts`, commits 9fb28ad + 0ecb65e; `maxDiffPixelRatio`
must stay unset — the comparator takes `min(maxDiffPixels, w·h·ratio)`, so a ratio of 0 zeroes the
budget). Recorded as D-RN-RF2-5.

Proof, in order:
1. **100-pass experiment (step 3a): 100/100 green.** inbox.spec.ts (32 cases) vs the run-6 CI
   genesis baselines, fresh container per pass, tolerance on: 32 passed in every pass (100
   sequential passes, 47–60 s each). Extended to the full 416 desktop cases: 3 fresh-container
   passes over all 8 v3 specs (216 + 104 + 96 per pass) — 416 passed in every pass.
2. **A7 proof (step b): 3 consecutive green workflow runs, both legs** — 43833136416 (1cd7518),
   43837753064 (7bd8fae), 43842194783 (5784a37). Run 3's artifact gate reports: desktop genesis
   416/0, desktop verify 416/0, remote genesis 84/0, remote verify 84/0 (flaky 0 everywhere).
   Desktop baselines in the artifact are byte-identical to the committed set (cmp, 416/416).
3. **Merge + close (step c):** the A10 branch carries the config change, the amendment text, and
   fresh CI-captured remote baselines (9a225ac). Discovery: the remote snapshots on the
   integration line were still the stale 1019506 vintage (structural drift vs the current remote
   app — 164195 px beyond threshold on gates-320x568-ar-light), never replaced by the F2 merge
   (88b41ba committed desktop-only despite its message). The fresh 84 are what all three green
   runs verified against.
