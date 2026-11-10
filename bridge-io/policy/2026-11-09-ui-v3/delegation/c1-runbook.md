# C1 + RH1 execution runbook — run 2026-11-09-ui-v3 (orchestrator)

PRECONDITION: R1 re-review APPROVE (packets/R1/review-repair.md) AND R1 verification all green (acceptance.json R1.1–R1.10, R1.deps = pass).
Pre-merge acceptance audit (orchestrator, 2026-11-09T21:16Z): the five verified packets are fully green in acceptance.json —
F2 6/6, V1 14/14, U0 14/14, U2 14/14, H1 12/12; zero non-pass verdicts. Their merges at C1 are evidence-backed.
Integration worktree: C:/Users/Dragonfly/Downloads/warsha-wt/v3/integration — verified clean, on run/2026-11-09-ui-v3/integration @ 4c65ead.
Rehearsal (delegation/c1-rehearsal.md): all six legs conflict-free at the heads below; guards green (arch 5/0, policy 8/0, wire 10/0). Re-run the R1 leg only if its head moved.

## C1 merges (git merge --no-ff, in the integration worktree; guards after EVERY merge)
Order + heads:
1. F2  a3d24a949e44951dbfc2671f62b1477f4d7ec276
2. R1  7fec7a04d91fc3ba9fd6ddc2cb963d12e0d03c62  (confirm approved head from review-repair.md)
3. V1  017ffb9d98f63181ec73d9b00a8b81df1e0b29dc
4. U0  bae6c0bbb056dccffc78f561b572bb21398a8db3
5. U2  fc8f06656a1b665913b0aeeecb19cb8278775bb6
6. H1  9d7d7c911d49c7618348538c36e0af3f552a77e1
Guards after each: `node scripts/check-arch.mjs && node scripts/check-engineering-policy.mjs && node scripts/check-wire-contract.mjs`.
Wire expectation: 9 checks before the H1 merge; **10 checks** from H1 onward (W10 lands with H1). Any guard failure = STOP, repair item.
Commit message pattern: `chore(integration): C1 merge <P>`.

## RH1 fenced refresh (OD-U1 pre-authorised — NO owner stop; pack kept for acceptance)
named/H1.txt = crash-reports, store-reviews, backend-kit (the v2 screens H1 made daemon-true). Cause line: "H1 harness truth changed these v2 renders; pixel drift only expected".
Capture host = WSL Ubuntu root. Invocation prefix:
`MSYS_NO_PATHCONV=1 wsl -d Ubuntu -u root -- bash -lc "export PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; <cmd>"`
NEVER checkout/reset/stash/clean /root/warsha-visual (221 dirty). Fetch the C1 tip from /mnt/c/Users/Dragonfly/Downloads/Warsha into its object store; fresh detached worktree per run; pnpm install --frozen-lockfile; port-guard 5173/5174; CI=true; JSON redirect + .done markers; never pipe through tail; never --update-snapshots except Rx step 5. ONE Playwright invocation at a time globally.

Rx steps (HANDOVER):
1. Full run → gates/RH1.pre.json.
2. `node tools/pw-gate.mjs failures gates/RH1.pre.json named/H1.txt` MUST exit 0; else STOP (failure returns to H1 as repair; nothing refreshed).
3. Copy each failing case's expected/actual/diff PNGs → od-visual/RH1/ + INDEX.md (case → packet step).
4. OD-U1 pre-authorised → proceed without stopping.
5. `pnpm exec playwright test --project=desktop --project=remote --last-failed --update-snapshots`.
6. Copy refreshed PNGs into the integration worktree; `git add -- '*-snapshots/*'` ONLY; commit `test(e2e): refresh the H1 baselines (owner OD-U1, RH1)`.
7. `node tools/pw-gate.mjs snapshots <tip before 6> HEAD named/H1.snap.txt` exit 0; else revert and STOP.
8. Full re-run: `pw-gate counts … <listed> 0` exit 0 AND `git status --porcelain -- '*-snapshots*'` empty.
9. Record plan.refreshes RH1 → done in state.json + checkpoint; fold PROGRESS.md/DECISIONS.md/PLAN.md at the C1 checkpoint.

## After C1+RH1
Integration tip = the new base for Wave B. Dispatch U1 (composites) + E0 (e2e v3 support) in parallel, base = C1 tip (PACKETS.md COMMON + section + gates.md verbatim). P7 stays deferred (OD-B4). C2 merges U1 → E0; Playwright stays 0 failures.
Flake stabilisation (tracked H1 finding) must land before Wave C — see research/h1-flake-rootcause.md when it arrives.