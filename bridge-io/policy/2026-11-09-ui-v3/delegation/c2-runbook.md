# C2 + verify queue runbook — run 2026-11-09-ui-v3 (orchestrator)

## Capture-host serialization (ONE Playwright invocation globally)
Order: (1) RH1 post-refresh full re-run → (2) F3.7.pw → (3) E0.3 + E0.pw → (4) U1.pw. Never overlap; ports 5173/5174.
Each `.pw` runs on a SCRATCH merge of the packet onto the current integration tip (fresh detached worktree on WSL, never
`/root/warsha-visual`; fetch the tip from `/mnt/c/.../Warsha`; `CI=true`; JSON to `EV/gates/<id>.json`; pw-gate failures vs
the packet's named set: F3/U1/E0 → `named/EMPTY.txt`, F4 → n/a). No `--update-snapshots` outside the RH1 fenced refresh.

## Packet verifies (independent verifier = Test engineer member, `team-task delegate` one per Turn)
- **F4** (base lint fix; head = its commit): F4.1 `pnpm --filter warsha-desktop lint` exit 0 · F4.2 `pnpm --filter warsha-desktop test` exit 0 · F4.3 scope = only `apps/desktop/src/harness.contract.test.ts` · F4.4 deps · F4.5 snap. Windows-only.
- **F3** (flake warm-up; head `738aba6`): F3.1 `pnpm -r typecheck` · F3.2 `pnpm --filter warsha-desktop lint` (needs F4 merged or the F4 file is the only failure) · F3.3 `pnpm --filter warsha-desktop test` · F3.4 scope = `apps/desktop/e2e/support/global-setup.ts` + root `playwright.config.ts` · F3.5 deps · F3.6 snap · F3.7.pw capture.
- **U1** (27 composites): U1.1 ui tests ≥ base+30 · U1.2 build-storybook + typecheck + ui lint · U1.3 check-ds-v3 · U1.4 the 27 composites each .tsx/.test/.stories · U1.5 ModelPicker has no hardcoded model list · U1.6 scope · U1.deps · U1.snap · U1.pw.
- **E0** (e2e support): E0.1 desktop typecheck (tsconfig.e2e) · E0.2 the four support exports · E0.3 capture smoke · E0.4 scope · E0.deps · E0.snap · E0.pw.

## C2 merges (integration worktree, after RH1's snapshots-only commit)
Order: **F4 → F3 → U1 → E0** (micro base-defect fixes first, then the planner's U1 → E0). Each `--no-ff`; guards after
every merge: `node scripts/check-arch.mjs && node scripts/check-engineering-policy.mjs && node scripts/check-wire-contract.mjs`
(wire 10 checks). Conflicts are the later packet's repair item. Then the C2 acceptance: full Playwright 0 failures on the
tip (visible UI unchanged: U1 = library composites, E0 = test support, F3/F4 = config/test fixes) — `pw-gate counts <listed> 0`.
Fold C2 (state + checkpoint + PROGRESS/DECISIONS), then dispatch Wave C per `wave-c-session-plan.md` on the C2 tip.

## Risks
- Long sessions die near ~28 min (platform) → short briefs, incremental commits, salvage (commit what compiles) first.
- `pnpm -r lint` at the C1 tip fails until F4 merges — do not blame other packets for it.
- Keep capture exclusivity; RH1's post-refresh re-run is the long pole (~15 min).
