# Wave B dispatch — ready text (run 2026-11-09-ui-v3)

Dispatch ONLY after RH1 folds done (planner order: C1 → RH1 → Wave B). Base = the post-RH1 integration tip
(expected `128b59c` or the snapshots-only commit on top; fill `<BASE>` at dispatch). Run U1 and E0 in PARALLEL
(distinct worktrees/branches, disjoint files). P7 stays deferred (OD-B4).

## U1 — design-system composites (27, DS v3 §3.2)
Worktree `C:/Users/Dragonfly/Downloads/warsha-wt/v3/u1`, branch `run/2026-11-09-ui-v3/u1-ds-composites`, base `<BASE>`.
Prompt: IMPLEMENTER of packet U1, run 2026-11-09-ui-v3. Read EV/PACKETS.md COMMON + the U1 section + EV/packets/U1/gates.md
VERBATIM (EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3); AGENTS.md; ENGINEERING_POLICY Phase 3.
Build the 27 composites in packages/ui/src/v3/composites (each .tsx + .test.tsx + .stories.tsx) from U0 primitives/tokens only;
honour the dependent contracts in the U1 section (Composer, ModelPicker data-driven, DecisionCard, Toast, Dialog/Sheet,
DataTable). Allowed files exactly: packages/ui/src/v3/composites/**, packages/ui/src/v3/index.ts (exports), packages/ui/README.md.
Frozen gates U1.1–U1.6 + deps + snap + pw (verifier runs pw). TS strict, no any, tokens only, logical CSS. Commit per composite group.
Do NOT run build-storybook until the composites are in (then U1.2). Do NOT run .pw (capture host). Report packets/U1/report.md.
Platform note: many small files — commit incrementally; if the session nears its limit, the last commit is the salvage point.
Final answer <250 words: commits, per-composite status, measured U1.1–U1.6, uncovered, blockers.

## E0 — e2e v3 support
Worktree `C:/Users/Dragonfly/Downloads/warsha-wt/v3/e0`, branch `run/2026-11-09-ui-v3/e0-e2e-v3-support`, base `<BASE>`.
Prompt: IMPLEMENTER of packet E0, run 2026-11-09-ui-v3. Read EV/PACKETS.md COMMON + the E0 section + EV/packets/E0/gates.md
VERBATIM; AGENTS.md; ENGINEERING_POLICY Phase 3.
Build apps/desktop/e2e/v3/support (openV3, act, expectRpc, rpcCalls re-export per the E0 section) + apps/desktop/e2e/v3/smoke.spec.ts
(every route of routes.ts boots in ar and en with main[data-ready="true"]). Allowed files exactly: apps/desktop/e2e/v3/support/**,
apps/desktop/e2e/v3/smoke.spec.ts. Frozen gates E0.1–E0.4 + deps + snap + pw (verifier runs pw; E0.3 is capture). TS strict, no any.
Commit incrementally. Report packets/E0/report.md. Final answer <250 words: commits, what changed, measured E0.1–E0.2 (E0.3 is
capture — do NOT run it), uncovered, blockers.

## Process rule (both)
Capture-host exclusivity during .pw runs — the verifier serialises. Implementers never run Playwright full suites, never
--update-snapshots, never touch snapshots/named sets/gates, never add deps.
