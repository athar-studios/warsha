# PROPOSAL — packet F1 «v2-mobile-providers-truth» (option A; NOT dispatched, NOT approved)

Status: **PROPOSAL**. Exists only to cost owner option A from the seq-6 blocker. Dispatch requires the owner's
explicit approval of the scoped waiver («v2 code untouched until U7» lifted for exactly the two defects below).
Gates authored here in planner capacity; the implementer never sees them before dispatch and never edits them.
Allowed-files list is completed from the Researcher's read-only pinpointing before dispatch; nothing else changes.

## Why
R0's fenced update refreshed 54/58 baselines, but `providers 390x844` (ar/en × light/dark) stay red on two soft
assertions that pre-exist at RUN_BASE (G0.json and gates/R0.update.log agree):
1. `auditLayout` emptyBoxes — the connection-status span («لم يُختبر بعد» / “not tested yet”) holds text at 0×63 / 0×54;
2. `auditUsedFonts` — the `[data-warsha-font-probe="mono"]` box holds the Arabic label «العنوان الافتراضي لهذا النوع»
   at mobile width; IBM Plex Mono has no Arabic glyphs, so it draws with DejaVu Sans Mono.
Both are v0.2.1 v2 defects. Without a fix, every Wave A `.pw` gate and GC.7 are unsatisfiable while v2 exists.

## Scope (waiver boundary)
- Allowed (confirmed paths, Researcher 2026-11-09): `apps/desktop/src/index.css` and
  `apps/desktop/src/screens/ProvidersSettings.tsx`. Nothing else in v2; no design change above 767px; no i18n key
  changes; no v3 work; no snapshots; no helper/gate edits; no dependencies.
- Fix spelling (Researcher's minimal proposal, to be confirmed by the implementer against the live files):
  1. Zero-width status box — root cause `Ledger.tsx:91-92` (content `flex:'1', minInlineSize:0`) vs `:167`
     (actions `flex:'none'`); at 390px the actions consume the row and the `Lamp` text span
     (`ProvidersSettings.tsx:293` → `Ledger.Row` `:603`, `Lamp.tsx:113` `minInlineSize:0`) collapses to 0;
     `index.css:205 overflow-x:clip` only hides the overflow. Minimal scoped fix: inside
     `@media (max-width:767px)` add `.providers-settings .warsha-ledger-row { flex-direction:column;
     row-gap:var(--warsha-space-1); }` so the content owns the row width and the actions sit below it.
     (The shared-Ledger alternative is rejected: wider baseline blast radius.)
  2. Arabic in the mono probe — the probe attribute is added by the auditor (`fonts.ts:164`), not the product; the
     element is the endpoint-title span `ProvidersSettings.tsx:607-619` when `api_base=null` (`:618`), the longest
     mono-led text so it wins the probe. At 768/1440 the mixed Plex+DejaVu set passes (`fonts.ts:225`,
     `bridge-io/audit/visual.md:56-59`); at 390 the wrap leaves DejaVu alone. Minimal fix: render that label with the
     sans Arabic stack (`var(--warsha-font-sans)` or `machineSkin`, `internal.ts:143-150`) with `dir` and
     `translate="yes"` when `api_base` is absent; keep mono/LTR/`translate="no"` for real URLs.
  The fixes give the text a real box and take Arabic out of mono — they never hide text or touch the audits
  (`layout.ts:272-291`, `fonts.ts:145-168,222-254`).
- Seen but left alone (shared latent patterns, green at G0; record in the F1 report, do not fix here):
  Lamp-in-Ledger-with-actions at CrashReports:115, HarnessesSettings:352, PluginsSettings:346, SkillsSettings:344,
  ProjectsBoard:358, SettingsScreen:305/309; Arabic-in-mono at HarnessesSettings:402, ModelsSettings:593/602,
  PluginsSettings:360/364, SkillsSettings:358/361, AdvancedMode:1350, Routines:75-88.
- Researcher uncertainty (carried): no browser run was made; the wider-width pass mechanism is inferred from the
  audit contract and logs. F1.7 + the R0 full re-run are the proof after the fix.
- Branch `run/2026-11-09-ui-v3/f1-v2-mobile-providers`, worktree `C:/Users/Dragonfly/Downloads/warsha-wt/v3/f1`,
  base = integration tip at dispatch. Roles: implementer ≠ reviewer ≠ verifier, assigned at dispatch.

## Frozen gates (upon approval)
- F1.1 `pnpm --filter warsha-desktop test` — exit 0, N ≥ base_counts.warsha-desktop.
- F1.2 `pnpm -r typecheck && pnpm --filter warsha-desktop lint` — exit 0.
- F1.3 scope: `test -z "$(git diff --name-only $BASE..HEAD | grep -vE '^(apps/desktop/src/index\.css|apps/desktop/src/screens/ProvidersSettings\.tsx)$')"` — exit 0.
- F1.4 deps gate (standard regex) — exit 1.
- F1.5 `node "$EV/tools"/pw-gate.mjs snapshots $BASE HEAD -` — exit 0, snapshot_changes=0.
- F1.6 capture: full `--project=desktop --project=remote` JSON run; `pw-gate failures` vs the existing frozen
  `named/R0.txt` — exit 0. At F1 verify time the 54 drift cases are still red (R0 re-runs only after F1 merges), so
  the fence must cover all 58; the four fixed cases fail on pixel drift alone, which F1.7 then proves.
- F1.7 defect proof on F1.6's JSON: `node "$EV/proposals/f17-check.mjs" <F1.6 json>` — selects the four cases with
  the validated selector `proposals/named-F1.txt` pattern (checked against G0.json: inside=4, outside=54 — it matches
  exactly `providers 390x844` ar/en × light/dark); passes only if every their error is screenshot-pixel drift and none
  is a layout/font audit error. Controls run: negative on G0.json → exit 1 (`cases=4 defect-errors=10`,
  `proposals/f17.negative-control.log`); positive on a pixel-drift-only fixture → exit 0
  (`proposals/f17.positive-control.log`). This proves the two defects are actually fixed, not merely fenced.
- Repair loop: max 3, back through review; no gate edits.

## Sequence after approval
C0.5: merge F1 (`--no-ff`) + post-merge guards → re-run R0 Rx from step 5 (the update now refreshes all 58 including
the four fixed renders) → snapshots-only commit → `named/R0.snap.txt` fence → full re-run `pw-gate counts … 0` →
record refresh done → **Wave A dispatches**. Option B (v2 frozen, four carried as known-red until U7) remains the
alternative; it requires a planner/owner re-plan of the named sets and only stays coherent if U7 is later approved.

## Rehearsal evidence (OD4 precedent; scratch, NEVER merged)
Scratch branch `scratch/od-f1-rehearsal`, commit `227e0d1725993c1703706d9e5db65f734eaecbb7` = integration tip +
exactly the two proposed edits (Coder-implemented, orchestrator-reviewed diff: CSS rule inside the existing
≤767px block; TSX conditional keeps mono/LTR/translate=no for real URLs, sans+dir+translate=yes for the default
label). Capture host at that commit, `--grep providers` (29 expected / 24 unexpected / 0 flaky, 59s):
- `gates/F1.rehearsal.f17.log`: **f17 cases=4 defect-errors=0, exit 0** — both defects gone.
- `gates/F1.rehearsal.pw-gate.log`: **unexpected=24 outside=0, exit 0** — every remaining failure inside named/R0.txt.
- failure kinds across the 24: **pixels only** (0 layout, 0 fonts) — the residual red is baseline drift that the
  post-merge R0 refresh resolves; 29 behavioural/other providers cases passed; zero snapshot writes.
Logs: `gates/F1.rehearsal.json`, `.log`, `.install.log`, `.f17.log`, `.pw-gate.log`. The scratch branch and its
commit are labelled PROPOSAL/UNMERGED and are not part of any run branch; F1 itself will be implemented, reviewed
and verified separately if the owner approves option A.