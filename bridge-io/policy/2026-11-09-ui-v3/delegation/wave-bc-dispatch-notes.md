# Dispatch notes — Waves B and C (orchestrator-level rules beyond PACKETS.md)

## Wave B (U1, E0) — base = C1 tip
- U1 builds only on merged U0 primitives/tokens; E0 on merged H1 (rpcCalls) + U2 (routes/data-ready contract).
- Playwright must stay at 0 failures after C2 (nothing visible changed yet): any v2 failure outside the packet's
  named set is a repair item, never a fence edit.

## Wave C (U3, U4, U5, U6) — base = C2 tip
- **Rebase rule (HANDOVER):** if a sibling merges first, U4 and U5 rebase onto the new integration tip; merge
  conflicts are THEIR repair items (back through review, max 3). Never rewrite already-merged commits.
- **Genesis baselines:** area specs carry `@visual` cases (1280x800 and 390x844 x ar/en x light/dark). Implementers
  NEVER commit PNGs and never run --update-snapshots. At verify, CI=true makes missing baselines fail; those
  failures must lie inside the packet's named set (U3/U4/U5/U6.txt) for the .pw gate; the fenced RUx refresh after
  each merge writes the genesis baselines (owner review-each stop per refresh, pack via make-refresh-index.mjs).
- U3: verify in crates/warsha-pipeline whether gate approval continues the run by itself; register
  project.gate.approve / inbox.gate.approve with or without runs.advance accordingly and state it in report.md.
  home.start order: projects.create, budget.set, runs.start.
- U4: assistant is real on agent.turn/plan_mode/approve_mode/state; terminal read-only; no fake replies.
- U5: every destructive action through a Dialog; API keys type=password, never logged/URL/snapshot.
- U6: keep behaviour/routes/test ids (remote-screen-*, remote-nav, remote-pair-submit); remote flows 7/7; remove
  Google Fonts links from apps/remote/index.html.
- RH1 (after C1, before Wave B dispatch per HANDOVER order C1 then RH1): named/H1.txt = crash-reports,
  store-reviews, backend-kit — the screens whose stubs H1 made daemon-true. Cause line for the pack:
  "H1 harness truth changed these v2 renders; pixel drift only expected". Owner review-each stop applies.

## Cross-wave
- One capture Playwright invocation at a time globally (ports 5173/5174); verifiers serialize.
- implementer != reviewer != verifier per packet; role briefs in delegation/wave-a/ carry the checklists.
- Repairs max 3 then blocked; gates/named sets/snapshots untouchable by implementers and reviewers.