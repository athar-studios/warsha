# Updated report to the planner/designer (Claude) — run 2026-11-09-ui-v3

Status: DRAFT — final tallies to be filled at C-final. Written for the planner (Claude Opus 5.5, author of
PLAN.md «Run 2026-11-09 — UI v3», DESIGN_SYSTEM_V3.md, UI_V3_PLAN.md) and the designer.

## 1. What was asked (owner, 2026-11-09)
Rebuild the Warsha UI from a clean slate on Design System v3 «حِرفة» (yellow primary #FFD400 with dark ink; orange only
for “waiting on you”; IBM Plex stack), Simple mode that is simple, Advanced Workbench where every control works,
every page/action registered and proven by e2e, daemon-truth harness, Rust/release truth fixes, a local draft bundle
— and, added at 16:44Z: finish, **push to main**, **install the final version on the owner's PC**, and this report.

## 2. What shipped (to be finalised at C-final)
- **Design system v3** (U0): tokens both themes, 46 icons, 19 primitives, 309 ui tests, contrast 50/0.
- **App infrastructure** (U2): router/V3App, actions registry + useAction + capabilities, 21 data hooks (four-state
  tests), run-events reconnect/resync, 14→5 stage map + event copy, v3 catalogs ar/en, ?ui=v3 flag, startup rules.
  584 desktop tests (+116 over base).
- **Harness truth + RPC log** (H1): daemon-true stubs (bare arrays / string paths / encoded ApplyResult), remote
  runs.subscribe snake_case, rpcCalls, contract test, wire W10 (10 checks, 0 violations). One environmental
  browser-close flake documented with three frozen-gate attempts (see EV/gates/H1*).
- **Rust hardening** (R1): settings unwraps, RPC/DB error surfacing, quote-aware preview policy, event-driven timing
  tests, bootstrap token to stderr. 756 passed / 0 failed / 10 ignored (repair may add tests).
- **Release truth** (V1): every version 0.2.1 (versionCode 201), check-versions tool, Docker label, APK stale-dist
  guard, keystore ignores, release.yml tag/permission hardening, DAEMON.md 14 stages/providers truth.
- **F1** (owner scoped waiver): two v2 mobile-providers defects fixed (390px Ledger collapse; Arabic label out of the
  mono probe) → R0 baselines refreshed (58, owner word).
- **F2** (planner-capacity micro-packet): pre-existing client test lint unblocked the workspace lint gate.
- **Waves B/C** (U1 composites, E0 e2e support, U3–U6 pages/PWA), **U7 cutover** (owner authorised), **C-final**:
  to be recorded here with gate tallies, bundle contents and the push/install result.

## 3. Decisions & deviations (see DECISIONS.md for the full log)
- OD-U0 spec approved by utterance; OD-F1 scoped waiver (two defects only); OD-U1 pre-authorised for the remaining
  refreshes; OD-U3 yes (v3 becomes the only UI); OD-B3 0.3.0; OD-B4 defer (P7 not dispatched); OD-B6 no.
- 150-turn session ceiling repeatedly hit by Coder subagents → salvage + continuation pattern; nothing discarded.
- One write-up correction: U0 report claim about workspace lint (fixed by F2) reworded; governing re-review APPROVE.

## 4. Risks / uncovered (honest list)
- `flows.spec.ts` mode-group: rare `browser closed` flake under full-suite load (base and packet scratch alike);
  all attempts preserved; H1.pw resolved per the three-attempt record above.
- U2.4 actions-gate is vacuous until the UI packets (U3/U4) wire real actions — by design.
- Environment: apksigner needs java (absent at inventory) → GC.14 may be recorded uncovered; docker only on
  Windows (GC.17 there); actionlint 1.7.12/Win vs 1.7.7/WSL.
- Human-only: Authenticode/Apple signing, Tauri updater keys, GitHub environment protection, release tagging and
  GitHub publication (NOT requested; release stays draft).

## 5. Next actions for the planner/designer
- Re-read DESIGN_SYSTEM_V3/UI_V3_PLAN against the shipped v3 (U7 deleted v2); adjust plan wording where reality
  diverged (packet F1/F2 additions, flake notes).
- For the next design pass: the four advisories from U2 review (persisted ui_version, capability flags, banner
  literal, deferred gate proof) and the shared latent v2 patterns that were left unfixed by design (only the two F1
  defects were waived).
