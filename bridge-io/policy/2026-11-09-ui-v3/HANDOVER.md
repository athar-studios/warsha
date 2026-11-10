# Qoder prompt — orchestrate run `2026-11-09-ui-v3` (new UI + design system v3 + the audit fixes + build)

You are the ORCHESTRATOR of run `2026-11-09-ui-v3` in the Warsha repo at `C:/Users/Dragonfly/Downloads/Warsha`. The
planner phase is finished (`state.json` seq 2, phase `plan`, 154 frozen gates, 13 packets). You dispatch implementers,
reviewers and verifiers, run the checkpoints and the fenced baseline refreshes, and stop at "ready for acceptance". You
never implement a packet, never author or edit a gate, never approve acceptance. Never ask the owner anything except
where this prompt says STOP; otherwise decide, record it in `state.json`, continue.

This run **supersedes** `2026-11-09-phase-b-visual-wave` (do not execute that one): its DS-v2 visual packets are dropped
because the owner asked for a new design from a clean slate; its other packets continue here (P2→H1, P3→R1, P4→V1, P7).

`EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3` (gitignored) · `T=$EV/tools` — planner-owned:
`actions-gate.mjs` (every control works), `i18n-gate.mjs` (Arabic is Arabic), `contrast.mjs --check-css` (palette = spec),
`planner-simplicity.spec.ts` (Simple is simple), `pw-gate.mjs` (fenced baselines), `versions.mjs`, `build-plan.mjs`
(the single source of every gate — never run it). Each tool has `--self-test` (except contrast/versions/the spec).

## Where things stand (verify, do not trust)
- `dev` holds the planner commit (PLAN.md section "Run 2026-11-09 — UI v3"); `main`/`origin` = `c1bcf4f` (v0.2.1,
  untagged); `v0.2.0` is published.
- The current UI audit (EXECUTIVE_SUMMARY.md): 137 controls, 33 dead (15 dead state, 8 no-op, 10 fake); the Simple
  chat reply is a timer fixture; model choices never reach `runs.start`; inbox decisions never reach the daemon.
- The committed v2 `crash-reports` baselines show the error "The daemon did not answer the crash list" (harness drift).

## Read before acting
`AGENTS.md`; `ENGINEERING_POLICY.md` (binding, all of it); `docs/designs/DESIGN_SYSTEM_V3.md`;
`docs/designs/UI_V3_PLAN.md`; `$EV/EXECUTIVE_SUMMARY.md`; `$EV/OWNER_DECISIONS.md`; `$EV/state.json`; `$EV/PACKETS.md`;
`PLAN.md` "Run 2026-11-09 — UI v3"; `DECISIONS.md` 2026-11-09 entries.

## Hosts
**Windows host** (this checkout): unit tests, cargo, `windows`/`any` gates, the bundle. **Linux x86_64 capture host**
(IBM Plex via `scripts/ci/install-capture-fonts.sh`, fontconfig pin `scripts/ci/capture-fontconfig.conf`): every
`capture` gate, every Playwright run whose screenshots count, every refresh. Same commit on both hosts, always.

## Step 0 — owner answers (STOP conditions)
1. `git -C C:/Users/Dragonfly/Downloads/Warsha show dev:PLAN.md | grep -q "Run 2026-11-09 — UI v3"` else STOP
   "planner commit missing on dev". `RUN_BASE=$(git rev-parse dev)`.
2. Read `OWNER_DECISIONS.md`. **OD-U0 must be `yes`, else STOP** and tell the owner the spec is not approved. Blanks
   take the defaults (OD-U1 `review-each`, OD-U2 `C`, OD-U3 `ask-at-U7`, OD-B3 `0.3.0`, OD-B4 `defer`, OD-B6 `no`).
   Write answers, `base.planner_commit`, `roles.orchestrator` into `state.json`; seq 3; `checkpoints/003-plan.json`.
3. Self-tests: `node $T/pw-gate.mjs --self-test` (7 ok), `node $T/actions-gate.mjs --self-test` (12 ok),
   `node $T/i18n-gate.mjs --self-test` (8 ok), `node $T/contrast.mjs` ("fails 0"). Any failure → STOP (tools damaged).
4. `git branch run/2026-11-09-ui-v3/integration $RUN_BASE`.
5. OD-B6 = `yes` only: remove worktrees of branches merged into `dev` (`git worktree remove`, never `--force` on a dirty
   one), delete merged branches except `dev`/`main`; log each. Otherwise list them.

## Step 1 — G0 (verifier role) at RUN_BASE
Windows, detached worktree `C:/Users/Dragonfly/Downloads/warsha-wt/v3/g0`: `pnpm install --frozen-lockfile`;
`pnpm -r test` (record "Tests N passed" for @warsha/ui, @warsha/client, @warsha/crypto, @warsha/i18n, warsha-remote,
warsha-desktop; `warsha-desktop_v3` = 0); `cargo test --workspace --all-targets` (passed, ignored); `check-arch`,
`check-engineering-policy`, `check-wire-contract` (expect `wire: 9 checks`); `node $T/versions.mjs .` (expect exit 1,
recorded truth). Capture host: `pnpm exec playwright test --project=desktop --project=remote --reporter=json >
$EV/gates/G0.json` (884 listed at plan time), then `node $T/pw-gate.mjs failures $EV/gates/G0.json $EV/named/R0.txt`.
All green → skip R0. Exit 0 with failures → refresh **R0**. Exit 1 → STOP: blocker with the list.

## Refresh procedure Rx (orchestrator, capture host, integration tip right after a merge)
1. Full run → `$EV/gates/Rx.pre.json`; 2. `node $T/pw-gate.mjs failures Rx.pre.json $EV/named/<set>.txt` must exit 0,
else STOP (the failure returns to the packet as a repair item; nothing is refreshed). 3. Copy each failing case's
expected/actual/diff PNGs (for genesis cases: the actual) into `$EV/od-visual/Rx/` + `INDEX.md` (case → packet step).
4. OD-U1 = `review-each` → STOP for the owner's "refresh Rx". 5. `pnpm exec playwright test --project=desktop
--project=remote --last-failed --update-snapshots`. 6. `git add -- '*-snapshots/*'` only; commit
`test(e2e): refresh the <set> baselines (owner OD-U1, Rx)`. 7. `node $T/pw-gate.mjs snapshots <tip before 6> HEAD
$EV/named/<set>.snap.txt` exit 0, else revert and STOP. 8. Full re-run: `pw-gate counts … <listed> 0` exit 0 and
`git status --porcelain -- '*-snapshots*'` empty. Record in `state.json` → `plan.refreshes`.

## Per packet
- Dispatch: record `base_commit` and measured `base_counts`; hand the implementer **PACKETS.md COMMON + its section +
  `packets/<P>/gates.md`** verbatim with `<branch>`, `<base>`, `<wt>` from `state.json`. One implementer, one worktree.
- **Review** (neither implementer nor verifier): full diff at one commit; scope; AGENTS.md; the v3 reject-on-sight
  list in PACKETS.md COMMON; i18n ar+en; secrets; test quality. → `packets/<P>/review.md`; patch via
  `git format-patch $BASE..HEAD -o $EV/diff/<P>/`.
- **Verify** (a third agent): every gate of `packets/<P>/gates.md` exactly as written, with `EV`, `BASE`, `GATE` set;
  raw output → `$EV/gates/<id>.log`; verdict, exit code, commit, UTC time, log path → `acceptance.json`. `capture`
  gates on the capture host; `.pw` gates on a scratch merge of the packet onto the current integration tip (never
  committed). The `simplicity` gate copies the planner spec in and removes it afterwards — it is never committed.
- **Repair**: failed gate or REQUEST-CHANGES → same implementer → review again. Max 3; then `blocked` with the reason.
  Never edit, skip, narrow or re-word a gate.
- Every transition: rewrite `state.json` (seq + 1, phase, updated_at) + append `checkpoints/<seq>-<phase>.json`.

## Waves and checkpoints (`git merge --no-ff <branch>` into `run/2026-11-09-ui-v3/integration`)
1. **Wave A** (parallel): U0, U2, H1, R1, V1.
2. **C1**: merge R1 → V1 → U0 → U2 → H1, then **RH1** (`named/H1.txt`). After every merge: `check-arch`,
   `check-engineering-policy`, `check-wire-contract` (10 checks from H1 on) on the tip.
3. **Wave B** (parallel): U1, E0 — and P7 only if OD-B4 = `approve`.
4. **C2**: merge U1 → E0 → (P7). Playwright must stay at 0 failures (nothing visible changed yet).
5. **Wave C** (parallel): U3, U4, U5, U6. U4 and U5 rebase onto the tip if a sibling merged first (conflicts are their
   repair items).
6. **C3**: merge U3 then **RU3** (genesis, `named/U3.txt`) → U4 then **RU4** → U5 then **RU5** → U6 then **RU6**.
7. **Wave D**: U7 — only if OD-U3 = `yes`; if `ask-at-U7`, STOP and ask the owner now. **C4**: merge U7.
8. **C-final**: INT-REL `node scripts/check-versions.mjs --set <OD-B3>` + commit
   `chore(release): set every component to <version>`; run **GC.1–GC.17**; build the local draft bundle
   `dist/release/v<version>/` like v0.2.0 (NSIS + MSI, signed APK from owner-scoped signing material — missing →
   out-of-scope blocker, never faked — Docker tarball, CycloneDX SBOMs with the pinned `cargo-cyclonedx 0.5.9`,
   `checksums.sha256`, ar+en notes); nothing installed, pushed, tagged or uploaded. Write `verdict.json`; fold every
   `packets/<P>/report.md` into one PROGRESS.md entry, decisions into DECISIONS.md, tick PLAN.md (only you, only here).
   Report **"ready for acceptance"** with the gate tally, the `od-visual/` packs, the integration tip and
   `git merge-base --is-ancestor dev run/2026-11-09-ui-v3/integration`.

## Non-negotiables
implementer ≠ reviewer ≠ verifier; no implementer touches `*-snapshots/**`; refreshes only in Rx, fenced, per OD-U1; no
dependency change except OD-U2 = A in U0; v2 code untouched until U7; no secret anywhere in evidence; no real model API
in gates; a claim without a gate log is not done; nothing published, tagged, force-pushed or posted.

## Resume without chat
Latest `checkpoints/<seq>-*.json` + `state.json` + `acceptance.json`. A dead session's step is re-run and the gap recorded.
