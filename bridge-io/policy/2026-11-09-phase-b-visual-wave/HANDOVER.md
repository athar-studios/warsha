> **SUPERSEDED** by `../2026-11-09-ui-v3/HANDOVER.md` — do not execute this prompt (see SUPERSEDED.md).

# Qoder prompt — orchestrate run `2026-11-09-phase-b-visual-wave` (Phase B + build finalisation)

You are the ORCHESTRATOR of run `2026-11-09-phase-b-visual-wave` in the Warsha repo at
`C:/Users/Dragonfly/Downloads/Warsha`. The planner phase is finished (`state.json` seq 2, phase `plan`, 94 frozen
gates). You dispatch implementers, reviewers and verifiers, run the checkpoints and the baseline refreshes, and you
stop at "ready for acceptance". You never implement a packet, never author or edit a gate, never approve acceptance.
Never ask the owner a question except where this prompt says STOP; otherwise decide, record it in `state.json`, continue.

`EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-phase-b-visual-wave` (gitignored evidence dir)
`T=$EV/tools` — planner-owned gate tools: `pw-gate.mjs` (failures / counts / snapshots, `--self-test`),
`versions.mjs` (version drift), `build-plan.mjs` (the single source of every gate — do not run it again).

## Where things stand (verify, do not trust)
- `dev` = `main` = `origin/main` = `c1bcf4f` (v0.2.1 commit, **untagged**); `v0.2.0` is published at `4d76e69`.
- Run `2026-11-08-design-and-remediation` is **accepted** (DECISIONS.md 2026-11-09); OD1, OD2 and OD6 are implemented
  — the read-before-write guard is wired with creation exempt. Do not redo any of it.
- `35c9362` (v0.2.1) changed Onboarding, ProvidersSettings and SettingsProviders and recorded **no Playwright run**.
- The committed `crash-reports` baselines show the error "The daemon did not answer the crash list": five desktop
  stubs return shapes the daemon never returns (P2 fixes the harness; R1 refreshes those cases).

## Read before acting
`AGENTS.md`; `ENGINEERING_POLICY.md` (all of it — binding); `$EV/EXECUTIVE_SUMMARY.md`; `$EV/OWNER_DECISIONS.md`;
`$EV/state.json`; `$EV/PACKETS.md`; `PLAN.md` section "Run 2026-11-09"; `DECISIONS.md` 2026-11-09 entries;
`docs/designs/DESIGN_SYSTEM_V2.md` §9.

## Hosts
- **Windows host** (this checkout): unit tests, cargo, gates marked `windows`/`any`, the bundle build (C4).
- **Linux x86_64 capture host** (the one used for run 2026-11-08; IBM Plex installed with
  `scripts/ci/install-capture-fonts.sh`, fontconfig pin `scripts/ci/capture-fontconfig.conf`): every gate marked
  `capture`, every Playwright run whose screenshots count, every refresh. Same commit on both hosts, always.

## Step 0 — intake of the owner's answers (STOP if the plan is not committed)
1. `git -C C:/Users/Dragonfly/Downloads/Warsha log -1 --format=%H dev` and `grep -q "Run 2026-11-09" PLAN.md` on that
   commit. If the PLAN section is absent: STOP — "planner commit missing on dev".
2. Read `OWNER_DECISIONS.md`; blank answers take the stated defaults (OD-B1 `review-each`, OD-B3 `0.3.0`, OD-B4
   `defer`, OD-B5 `defer`, OD-B6 `no`). Write them, the planner commit (`base.planner_commit`) and your identity
   (`roles.orchestrator`) into `state.json`; seq 3, phase `plan`; checkpoint `checkpoints/003-plan.json`.
3. `node $T/pw-gate.mjs --self-test` must print 7 `ok` lines — the gate tool is intact.
4. `git branch run/2026-11-09/integration <planner commit>`; `RUN_BASE=<planner commit>`.
5. OD-B6 = `yes` only: remove linked worktrees whose branch is merged into `dev` (`git worktree remove`, never
   `--force` on a dirty one) and delete merged branches except `dev`/`main`; log every removal. Otherwise list them.

## Step 1 — G0 baseline (verifier role) at `RUN_BASE`
Windows host, in a detached worktree `C:/Users/Dragonfly/Downloads/warsha-wt/pb/g0`:
`pnpm install --frozen-lockfile`; `pnpm -r test` (record "Tests N passed" per package: ui, client, crypto, i18n,
warsha-remote, warsha-desktop); `cargo test --workspace --all-targets` (sum passed, sum ignored);
`node scripts/check-arch.mjs`, `check-engineering-policy.mjs`, `check-wire-contract.mjs` (expect `wire: 9 checks`);
`node $T/versions.mjs .` (expect exit 1, "NOT aligned" — that is the recorded truth).
Capture host: `pnpm exec playwright test --project=desktop --project=remote --reporter=json > $EV/gates/G0.json`
(listed 884 = 793 + 91 at plan time). Then `node $T/pw-gate.mjs failures $EV/gates/G0.json $EV/named/R0.txt`.
Write everything to `gates/G0.log`, the counts to `state.json` → `baseline.counts`, the verdict to `acceptance.json`.
- G0 all green → skip R0.
- Failures and `pw-gate` exit 0 → run **R0** (procedure below) with `named/R0.txt` / `named/R0.snap.txt`.
- `pw-gate` exit 1 (a failure outside R0, or any behavioural failure) → STOP: blocker to the owner, with the list.

## Refresh procedure Rn (orchestrator, capture host, on the integration tip right after a merge)
1. `pnpm exec playwright test --project=desktop --project=remote --reporter=json > $EV/gates/Rn.pre.json`
2. `node $T/pw-gate.mjs failures $EV/gates/Rn.pre.json $EV/named/<set>.txt` → must exit 0, else STOP (regression:
   the failure goes back to the packet's implementer as a repair item; nothing is refreshed).
3. Copy every failing case's `*-expected.png`, `*-actual.png`, `*-diff.png` from `test-results/` into
   `$EV/od-visual/Rn/` with an `INDEX.md` (case → packet step that explains it). A case you cannot explain → STOP.
4. OD-B1 = `review-each` → STOP and wait for the owner's "refresh Rn" in chat. `pre-authorised` → continue.
5. `pnpm exec playwright test --project=desktop --project=remote --last-failed --update-snapshots`
6. `git add -- '*-snapshots/*'` only; commit `test(e2e): refresh the <Pn> named baselines (owner OD-B1, Rn)`.
7. `node $T/pw-gate.mjs snapshots <tip before step 6> HEAD $EV/named/<set>.snap.txt` → exit 0, else revert the commit, STOP.
8. Full re-run → `node $T/pw-gate.mjs counts $EV/gates/Rn.post.json <listed> 0` exit 0, and
   `git status --porcelain -- '*-snapshots*'` prints nothing (zero writes). Record Rn in `state.json` → `plan.refreshes`.

## Step 2 — Wave A (parallel): P1, P2, P3, P4
For each packet: record `base_commit` (= integration tip after G0/R0) and measured `base_counts`; create the
assignment in `state.json`; hand the implementer **`PACKETS.md` COMMON + its section + `packets/<P>/gates.md`**
verbatim, plus `<branch>`, `<base>`, `<wt>` from `state.json`. One implementer per packet, one worktree per packet.

## Per packet, when `packets/<P>/report.md` arrives
- **Review** (an agent that is neither the implementer nor the verifier): full diff `git -C <wt> diff $BASE..HEAD`
  at one commit; scope vs `allowed`; AGENTS.md; i18n ar+en parity; logical CSS; arch boundaries; secrets; test quality
  (no weakened assertion, no `skip`/`#[ignore]`); the packet's own constraints in PACKETS.md. → `packets/<P>/review.md`
  (APPROVE / REQUEST-CHANGES), patch saved with `git format-patch $BASE..HEAD -o $EV/diff/<P>/`.
- **Verify** (a third agent): every gate in `packets/<P>/gates.md` exactly as written, in `<wt>` at the reviewed
  commit, with `EV`, `BASE`, `GATE` set. Raw output → `$EV/gates/<gate id>.log`; verdict, exit code, commit, UTC
  timestamp and log path → `acceptance.json`. `capture` gates run on the capture host at the same commit; the `.pw`
  gate runs on a scratch merge of the packet onto the current integration tip (never committed).
- **Repair**: a failed gate or a REQUEST-CHANGES goes back to the same implementer, then review again (never
  verification alone). Max 3 iterations; then the packet is `blocked` with its reason. Never edit, skip, narrow or
  re-word a gate; never update a snapshot outside an Rn step.
- Every phase transition: rewrite `state.json` (seq + 1, `phase`, `updated_at`) and append
  `checkpoints/<seq>-<phase>.json`. Seq is monotonic; a gap stays visible.

## Step 3 — C1: merges in this order, each `git merge --no-ff <branch>` on `run/2026-11-09/integration`
`P3` → `P4` → `P2` then **R1** (`named/P2.txt`) → `P1` then **R2** (`named/P1.txt`). After each merge re-run
`node scripts/check-arch.mjs`, `check-engineering-policy.mjs`, `check-wire-contract.mjs` on the tip (expect 10 checks
from P2 on). P3/P4 merges must leave Playwright at 0 failures (`named/EMPTY.txt`). Checkpoint C1.

## Step 4 — Wave B (parallel): P5a, P5b — and P7 only if OD-B4 = `approve`
Base = integration tip after C1. P5b rebases onto the tip after P5a merges; a conflict is P5b's repair item.

## Step 5 — C2: `P5a` then **R3** (`named/P5a.txt`) → `P5b` then **R4** (`named/P5b.txt`) → `P7` (if any, 0 failures)

## Step 6 — Wave C: P6 (base = tip after C2) → C3 merge; Playwright must stay at 0 failures (pixel-neutral)

## Step 7 — C4: finalise the build (still no publish)
1. **INT-REL**: on the integration tip, `node scripts/check-versions.mjs --set <OD-B3>` (P4's tool), commit
   `chore(release): set every component to <OD-B3>`; `RELEASE=<OD-B3>`.
2. Run **GC.1–GC.15** (`acceptance.json`, packet `C4`) at that tip, Windows + capture host as marked.
3. Build the **local draft bundle** `dist/release/v$RELEASE/` exactly like v0.2.0 (see PROGRESS.md "Post-acceptance
   delivery"): NSIS + MSI (`tauri build`), signed APK (signing material scoped from `~/.warsha/signing/` or
   `WARSHA_KEYSTORE_*` — if absent, the APK step is an out-of-scope blocker, never faked), Docker image tarball tagged
   `warsha:$RELEASE`, CycloneDX SBOMs with the pinned `cargo-cyclonedx 0.5.9`, `checksums.sha256`, release notes
   (ar + en). Record every hash and size in `apps/mobile/README.md` via a docs commit. Nothing is installed on the
   owner's PC; nothing is pushed, tagged or uploaded.
4. Write `verdict.json`; fold every `packets/<P>/report.md` into **one** PROGRESS.md entry and their decisions into
   DECISIONS.md, tick the PLAN.md "Run 2026-11-09" checklist (only you edit these three files, only here).
5. Report **"ready for acceptance"** with: the gate tally, the five `od-visual/R*` packs, the integration tip, and
   the fast-forward check `git merge-base --is-ancestor dev run/2026-11-09/integration`.
   Merging into `dev`/`main`, tagging `v$RELEASE`, pushing and publishing happen only on the owner's explicit word.

## Non-negotiables
- implementer ≠ reviewer ≠ verifier per packet; a forced merge of roles is written into `state.json` and shown to the owner.
- No implementer touches `*-snapshots/**`; refreshes happen only in Rn, only for fenced cases, only per OD-B1.
- No dependency change; no secret in any state, checkpoint, log, diff or report; no real model API in any gate.
- A claim without a gate log is not done; a worker's prose is not evidence; an exit code is read from the log body.
- Nothing is published, released, tagged, force-pushed or posted.

## Resume without chat
Latest `checkpoints/<seq>-*.json` + `state.json` + `acceptance.json`. Every gate carries verdict, exit code, commit,
timestamp and log path. If a session dies mid-step, the next one re-runs that step and records the gap.
