# Packet F1 Review: v2-mobile-providers-truth (run 2026-11-09-ui-v3)

- Role: independent REVIEWER (implementer, verifier, reviewer all distinct)
- Base: `ba90e713b2731870a7df3c1791bcbfe98e330717` → Head: `fbc6351478fd5e97d07883d5b0df89aeeec6f9cb`
- Full diff read: `git -C C:/Users/Dragonfly/Downloads/warsha-wt/v3/f1 diff ba90e71..fbc6351` (2 files, +32/−13)

## Findings

### 1. Scope conformance — PASS
- Exactly two commits-worth of change, one commit `fbc6351` ("fix(desktop): fix mobile providers ledger wrap and default endpoint font (F1)"), touching only the OD-F1 allowed files: `apps/desktop/src/index.css` (+5) and `apps/desktop/src/screens/ProvidersSettings.tsx` (+27/−13). Matches gate F1.3's file allow-list.
- CSS rule sits inside the existing `@media (max-width: 767px)` block (index.css:439, rule at :466, block closes :471 before the `/* 768 … */` media at :473). No rule added at any width ≥768px.
- No helper (`apps/desktop/e2e/**`), audit, gate, snapshot, i18n, package/manifest, or shared-Ledger (`packages/ui/src/compounds/Ledger.tsx`) edit. `git diff --name-only` = the two files only.

### 2. The two fixes, contract-checked — PASS
- **Defect 1 (zero-width status span at 390px):** `.providers-settings .warsha-ledger-row { flex-direction: column; row-gap: var(--warsha-space-1); }` gives the content box full row width below 768px (actions stack below via the existing flex layout), so the Lamp status span (`minInlineSize: 0`) is no longer squeezed to 0px by `flex: none` actions. Text is given a real box; nothing is `display:none`, `visibility:hidden`, clipped, or removed — a grep for hiding constructs in the diff found none. Selector is scoped to `.providers-settings`, so other Ledger screens (the latent-pattern list in the proposal) are untouched. `--warsha-space-1` (4px) is a real token (`packages/ui/src/tokens/tokens.css:165`).
- **Defect 2 (Arabic default-URL label inside mono probe):** the endpoint span now branches on `provider.api_base`: real URLs keep mono + `dir="ltr"` + `translate="no"` + `unicodeBidi: isolate` unchanged; the absent-case default label `providers.endpoint.default` renders with `var(--warsha-font-sans)` (stack leads with `IBM Plex Sans Arabic`, tokens.css:189) + `dir={dir}` + `translate="yes"`. This moves Arabic out of the mono stack without touching the auditors: `layout.ts:272-291` (emptyBoxes) and `fonts.ts:145-168,222-254` (probe marking + platform-font verdict) are byte-identical to base. The mono probe now simply finds no Arabic mono run to mis-mark (mono-role `null` is an accepted "absent" outcome, fonts.ts:197-211; only a sans-role null is a problem), and the sans probe expects `IBM Plex Sans Arabic`, which carries Arabic glyphs. No audit is weakened, no assertion removed, no probe attribute manipulated by product code.
- `dir` is in scope (`ProvidersSettings.tsx:74`, `useDirection()`), `translate="yes"` is valid React/TSX (precedent: `translate="no"` used across BenchTopbar/BackendKitPanel), i18n key `providers.endpoint.default` exists in both catalogs (ar/en, `packages/i18n/src/index.tsx:667,1901`) and was not modified.

### 3. AGENTS.md rules — PASS
- Logical/direction-safe CSS only (`flex-direction`, `row-gap`, no left/right/margin physicals). All values via design tokens (`--warsha-space-1`, `--warsha-font-sans`, `--warsha-font-size-xs`, `--warsha-color-text`).
- i18n catalogs untouched; UI string still fetched via `label()`. No `any`, no `unwrap`, no test `.skip`/`.only`, no dependency changes (F1.4 pattern: no manifest lines in diff). Conventional commit message.

### 4. Correctness & test quality — PASS (units claim consistent)
- Report claims 468 `warsha-desktop` tests = `state.json` base count `warsha-desktop: 468`; diff adds/removes no test file, so no test was skipped or weakened — the suite must grow-or-hold via F1.1 at verification (N ≥ base), which is the correct gate placement. Report records F1.1–F1.5 as run and correctly leaves F1.6/F1.7 (capture host) to the verifier.
- Proposal Rehearsal corroboration (scratch, unmerged): `f17 cases=4 defect-errors=0`, pw-gate `unexpected=24 outside=0`, failure kinds pixels-only — exactly the "defects gone, residual drift fenced by named/R0.txt" outcome this diff is supposed to produce; it also exercises widths ≥768, covering the width-independent TSX branch.

### 5. report.md vs diff — PASS
- `EV/packets/F1/report.md` exists; head/base commits, worktree, branch, both file paths, +32/−13 counts, the CSS snippet, and the conditional-span description all match the actual diff verbatim in substance. "Seen but left alone" section reproduces the proposal's latent-pattern list (recorded, not fixed — correct per waiver). No claim of F1.6/F1.7 is made.

## Nits (non-blocking)
- The TSX font branch is width-independent, i.e. the default label now renders sans at ≥768px too. This matches the proposal's own fix spelling (no width gating prescribed for fix 2) and the rehearsal passed at wide widths, so it is inside the waiver reading of "no design change above 767px" (layout/CSS); noted for verifier attention at F1.6.

FINAL verdict: APPROVE
