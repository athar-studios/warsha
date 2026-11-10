# PARK MANIFEST — Warsha completion program (2026-11-10T02:22Z, orchestrator turn budget exhausted)

Status: **NOT complete.** R0 is mid-flight; R1–R4 have not started. Resume strictly from the run evidence + this file.
Authoritative state: `bridge-io/policy/2026-11-09-ui-v3/state.json` (seq 56) + `checkpoints/`. Program plan:
`bridge-io/policy/2026-11-09-completion-program/PROGRAM_PLAN.md`. Records: `PROGRESS.md`, `DECISIONS.md`, `PLAN.md`.

## Landed and evidenced (do not redo)
- **Wave A closed.** H1 verified (third attempt `H1c.pw.json`, outside=0, folded into acceptance.json). R1 repaired
  (`52fdd1f` F1 tests, `ee0fd1f` F2 stdin-block, `7fec7a0` F3 100ms revert), re-review v2 **APPROVE**
  (`packets/R1/review-repair.md`), verified 759 passed / 10 ignored / 0 failed; all 11 R1 gates pass in acceptance.json.
  F2/V1/U0/U2 verified earlier (all-pass audit 6+14+14+14+12 gates).
- **C1 merged** in `warsha-wt/v3/integration`: F2 → R1 → V1 → U0 → U2 → H1, conflict-free; guards green after every merge
  (arch 5/0, policy 8/0, wire 9/0 then 10/0). **C1 tip `128b59c08cbf5ddbe4de002528a50f451ea74296`**, tree clean.
- **Research integrated:** `completion-program/research/r1-sec-intake.md` (R1: sole advisory libsqlite3-sys
  RUSTSEC-2026-0459 → S1c coordinated sqlx 0.9 + rusqlite 0.41; S2/S3 already green), `r2-external-facts.md`
  (WebMCP `document.modelContext` + AbortSignal unregister, provideContext dropped; Registry has NO licence field →
  X5 link-only default), `ui-v3/research/h1-flake-rootcause.md` (flake = pre-existing load-sensitive chromium target death
  at the live simple→advanced switch, NOT H1-induced; fix = warm-up globalSetup, no retry/gate change).
- **GC.14 environment resolved:** `JAVA_HOME=C:/Program Files/Android/Android Studio/jbr` → apksigner 0.9 exit 0
  (`delegation/cfinal-gc14-java.md`). GC.17 must run on the Windows Docker host.
- **Ready artifacts:** `delegation/c1-runbook.md`, `c1-rehearsal.md` (conflict-free), `rh1-prerun.sh` (ran),
  `rh1-refresh.sh` (ready), `wave-b-dispatch.md`, `wave-c-session-plan.md`, `r1-verify-brief.md`.

## In flight at park time (background notifications will arrive; salvage if killed)
1. **RH1 pre-run — FAILED on host lifecycle (02:26Z), RE-RUN on resume.** The background WSL task was killed when the
   orchestrator session paused: playwright process gone, `RH1.pre.json` 0 bytes, no `.done`; 2 orphan chromes cleaned,
   ports free (chrome=0, ports=0). **No RH1 verdict exists.** Re-run `delegation/rh1-prerun.sh` (idempotent: re-fetch
   `128b59c`, fresh `/root/warsha-rh1`, install, full suite → `gates/RH1.pre.json` + `.done`), then the pw-gate/refresh chain.
2. **F3** flake warm-up — **PARTIAL (seq 58):** helper `apps/desktop/e2e/support/global-setup.ts` committed `ff337d5`;
   `globalSetup` wiring was blocked because the Playwright config is at the ROOT `playwright.config.ts` (frozen path
   assumption wrong — scope amended at planner capacity to allow the root config). A continuation is dispatched to wire it.
   **F3.2 lint found a BASE defect** → micro-packet **F4** (fix 2 ESLint `import/order` errors in
   `apps/desktop/src/harness.contract.test.ts`, H1's file; H1 had no lint gate) dispatched. `pnpm -r lint` MUST be green
   before C2/GC.3. F3 must land before Wave C.
3. **U1** composites implementer (worktree `u1`, branch `run/2026-11-09-ui-v3/u1-ds-composites`, base `128b59c`). Check the
   worktree and notification; salvage = commit what compiles, then a short continuation brief.
4. **E0** e2e v3 support implementer (worktree `e0`, branch `run/2026-11-09-ui-v3/e0-e2e-v3-support`, base `128b59c`). Same check.
5. **F4** + **F3 continuation** (both dispatched 02:31Z after the F3 result; worktrees `f4` and `f3`).

## Exact next steps (resume order)
1. If `gates/RH1.pre.done` exists: read `RH1.pre.meta` + `.json`; run
   `node tools/pw-gate.mjs failures gates/RH1.pre.json named/H1.txt` — must exit 0 (else the failure is a repair item for
   H1; nothing refreshed). On exit 0: run `delegation/rh1-refresh.sh` on WSL (fenced `--last-failed --update-snapshots`,
   copies changed snapshots into `warsha-wt/v3/integration`), then in the integration worktree
   `git add -- '*-snapshots/*'` + commit `test(e2e): refresh the H1 baselines (owner OD-U1, RH1)`;
   `node tools/pw-gate.mjs snapshots 128b59c..HEAD named/H1.snap.txt` exit 0; full re-run in `/root/warsha-rh1`
   (`pw-gate counts <listed> 0`); fold RH1 done in state + PROGRESS. Keep the od-visual pack for acceptance.
2. Collect F3/U1/E0 (they notify; each worktree self-salvages — commit what compiles if a session died). Then review
   (debugger, separate) → verify (Test engineer member via `team-task delegate`, one per Turn; `.pw` gates need the capture
   host exclusively) → repair loop. F3 must land before Wave C.
3. **C2**: merge U1 → E0 (+F3) into the integration branch, guards after each; Playwright 0 failures (nothing visible changes).
4. **Wave C**: dispatch U3/U4/U5/U6 per `delegation/wave-c-session-plan.md` (one area per Coder session; commit per area;
   fixed continuation briefs). Merge U3 (+RU3 genesis) → U4 (+RU4) → U5 (+RU5) → U6 (+RU6), fenced (OD-U1 pre-authorised).
5. **U7** cutover (OD-U3 = yes) → C4. **C-final**: `node scripts/check-versions.mjs --set 0.3.0` + commit; GC.1–GC.17
   (JAVA_HOME above for GC.14; Docker on Windows for GC.17); local draft bundle; **non-force push of `main`** (OD-P1);
   installer → install on the owner PC → `--self-check` → run REPORT.md from state + gate logs. No tag, no publication.
6. **R0.T** (promote the run gate tools into `scripts/`), then **R1 SEC** (S1c substantive), **R2 EXT** (X0–X11),
   **R3 SH** (SH1–SH5; re-dispatch the failed headless-CLI research or verify the facts in `completion-program/research/`),
   **R4 FIN** (FIN1–FIN5 + FINAL_REPORT.md). Each run: evidence dir, state.json `warsha-run/v1`, planner-frozen gates,
   implementer ≠ reviewer ≠ verifier, bounded repair, C-final, merge to `dev`, non-force push of `main`.

## Risks / process lessons
- Long subagent sessions die near ~28–60 min (platform errors) → short incremental scopes, write deliverables
  incrementally, run long cargo/Playwright via background + `.done/.exit` markers; salvage the worktree first.
- One Playwright invocation at a time globally (ports 5173/5174); capture host = WSL root; never checkout/reset/stash/clean
  `/root/warsha-visual`; ensure `matches` reads the log body, never an echo.
- `create_team_task` is whole-team; single-member delegation = `team-task delegate --target-member-id <rosterMemberId>`
  (Test engineer `0057a9c2-5f28-4ae6-982e-dc6cad4c6177`), one request per target per Turn, then finish the Turn.
- Never loosen a gate/test; frozen gate commands are not edited (this is why F3 avoids `--workers=1`).
- Owner-only items (signing, updater keys, tagging/publishing, store submissions, hosted relay, crash collector) stay
  reported, never faked.

## UPDATE 2026-11-10T03:20Z (state seq 66) — supersedes the in-flight list above

- **C1 tip `128b59c`** (guards green). **RH1 pre-run attempt 3** launched DETACHED 03:17:40Z (install_ok, suite running);
  Monitor watches `gates/RH1.pre.done`. Attempt 2 died when the orchestrator's cleanup `pkill -f warsha-rh1` matched live
  vite/worker cmdlines — **never kill anything matching the run while it lives**. No RH1 verdict exists yet.
- **F3** reviewed **APPROVE** (`packets/F3/review.md`; helper + ROOT `playwright.config.ts`; F3.4 amended to the root path).
  Needs verify: F3.1–F3.6 (Windows) + **F3.7.pw** (capture, scratch merge onto the post-RH1 tip).
- **F4** verify **4/5**: F4.1/3/4/5 PASS; **F4.2 FAIL** on ONE load-sensitive 5s timeout (ModelsSettings; single-file
  rerun 8/8). Plan: re-run F4.2 UNCHANGED under host exclusivity (R0 second-unchanged-attempt precedent); if it fails
  again → repair. No test/threshold change (forbidden).
- **E0** reviewed **APPROVE** (`packets/E0/review.md`; 4 exports, 14 smoke). Needs verify: E0.1/E0.2/E0.4 (Windows) +
  **E0.3 + E0.pw** (capture).
- **U1** implementation salvaged: commits `95571c8 c9ef04a 99048c9 eabb536 4d08b51` + orchestrator salvage `6d7a062`
  (27/27 composites with tests+stories; `pnpm --filter @warsha/ui test` exit 0). A continuation is running the remaining
  gates (U1.2 storybook/typecheck/lint, U1.3 ds-v3, U1.5 no hardcoded models) + `packets/U1/report.md`; then review +
  verify (U1.pw capture).
- **Then C2** in `warsha-wt/v3/integration`: F4 → F3 → U1 → E0 (`--no-ff`, guards after each, wire 10/0) → full Playwright
  0 on the tip → fold C2 → **Wave C** per `delegation/wave-c-session-plan.md`.
- Capture-host rule (hard-learned): ONE Playwright lane, and **no heavy concurrent Windows builds** (storybook/tsc) while a
  `.pw` run is live on this 2-CPU host; a starved run is slow but must be left alone.

## UPDATE 2026-11-10T04:40Z (state seq 77) — OWNER PLAN v2 IN FORCE; supersedes the run order above

- **Plan of record v2** (`bridge-io/policy/2026-11-10-principal-review/HANDOVER.md`, owner-sanctioned; DECISIONS 2026-11-10):
  **R0 UI v3 continues unchanged** ∥ **KEEL (0.3.1)** → **ENGINE (0.4.0)** → **P2 extensions (0.5.0)** → **FIN (1.0.0-rc)**.
  KEEL absorbs X1/X2/`RunCommand` (K4); ENGINE absorbs SH1/SH3/SH4 (E3/E4/E5). R0's next planning point must adopt the three
  REVIEW §5.5 amendments (no release ships a run-ending control; inbox/badge count only the current-stage gate; no fixtures
  for diff/tests/preview in Wave C).
- **R0 state:** C1 GREEN at `d598ad6` (RH1 done: 48 baselines refreshed fenced, `outside=0`; post-run 884/884; pw-gate 0).
  F4 COMPLETE 5/5 and **merged** (`7894d63`; F4.2 second unchanged attempt 79 files/590 passed). **F3 verify running**
  (Windows gates green so far; F3.7.pw capture in flight on the WSL host). **U1 APPROVE** after repair (`1762caa`; 373
  tests, ds-v3 0) — verification queued (Windows + U1.pw after the capture lane). **E0 APPROVE** (`bcb5c7a`) — Windows
  verify running, E0.3/E0.pw deferred to the capture lane.
- **Capture-lane queue (strict):** F3.7.pw → U1.pw → E0.3/E0.pw. After those verdicts: C2 merges F3 → U1 → E0 (guards after
  each) → C2 acceptance (full Playwright 0) → **Wave C** (U3–U6 per `wave-c-session-plan.md`, with the §5.5 amendments) →
  U7 → C-final 0.3.0 (GC.1–17, bundle, non-force push `main`, install, self-check) → R0.T.
- **KEEL:** planner role dispatched (Plan agent) to freeze K1–K8 + S1a–S1d/S2/S3 gates into
  `bridge-io/policy/2026-11-10-keel/` (state.json + PACKETS.md + acceptance.json), base `128b59c`, crates/ only (+PLAN/README
  for K8); merge order K1→K2→K3→K4→K5→K6 for lib.rs packets; checkpoint = security review of K4+K5+K6. On the plan's
  arrival: review it, then dispatch K1 (and S1c's sqlx/rusqlite bump) in its own worktree per packet.
- **Environment caveat:** the Team member delegation channel was DENIED in a resumed session (`host_operation_unavailable`);
  verification ran via independent debugger Agents with the role substitution recorded in `state.json`. If the channel is
  restored, prefer the Test engineer member.

## UPDATE 2026-11-10T05:02Z (state seq 80) — C2 in progress; KEEL started

- **R0:** integration tip **`04ae669`** = C1 (`d598ad6`) + F4 (`7894d63`) + F3 (`04ae669`), guards green after each.
  F4 5/5 (F4.2 second unchanged attempt), F3 7/7 (`F3.7.pw` unexpected=0 outside=0; recorded by the orchestrator from the
  verifier-produced JSON because that turn ended before filling the row). **U1.pw capture running** (scratch merge of U1
  `1762caa` over `04ae669`); U1 light verify + E0 Windows verify dispatched (slow, results pending; storybook + E0.3/E0.pw
  still deferred). Next: U1 → E0 merges → C2 acceptance (full Playwright 0) → Wave C (amendments) → U7 → C-final.
- **KEEL:** artifacts persisted by the orchestrator from the planner delivery —
  `bridge-io/policy/2026-11-10-keel/{state.json, acceptance.json, PACKETS.md}` (planner had no write tool). Gates frozen:
  STD.1–STD.13 + K1.*–K8.* + S1a/b/c/d.* + S2.* + S3.* + CP.1–CP.4. **K1 (gate integrity) and S1c (sqlx 0.9 + rusqlite
  0.41 → libsqlite3-sys ≥0.39) implementers running** in `warsha-wt/keel/{k1,s1c}`; merge order K1→K2→K3→K4→K5→K6 for
  lib.rs packets; security checkpoint on K4+K5+K6; release 0.3.1 only after K1+K2 merge.
- **Process guard:** a `tools/*.sh` set is expected by the frozen STD gates (rust-tests, no-new-skip, scope, k3-mock-scan,
  k8-*, s1a-versions, s3-notices) — the first KEEL verifier must create them from the gate definitions if absent (the
  planner listed them as tooling to be written; they are not yet on disk).

## UPDATE 2026-11-10T10:01Z (ui-v3 seq 93 / keel seq 9) — C2 complete; Wave C + KEEL in flight

- **R0:** C2 COMPLETE — integration tip **`6025715`** = C1 (`d598ad6`) + F4 (`7894d63`) + F3 (`04ae669`) + U1 (`82430c9`)
  + E0 (`6025715`), guards green after each. F4 5/5; F3 7/7 (F3.7.pw outside=0); U1 7/7 (U1.2 storybook completed by the
  orchestrator; U1.pw outside=0); E0 7/7 (E0.3 **non-vacuous 14/14** after the `fcd7ae5` module-load repair; E0.pw
  expected=898 unexpected=0).
- **Wave C in flight (base 6025715, amendments §5.5 applied):**
  - U3: frame DONE `4677774` (TopBar/current-stage inbox count/Toast; 602 desktop tests; 9/9 frame actions; no run-ending
    controls). Onboarding in progress (`3ec96c9`). Remaining: home, projects, project, inbox.
  - U4: bench implemented `7227d74` + 35 tests `2449b07` + action/dialog fixes `8420fae`; report pending.
  - U5: 3 commits `5e5b88f/1a2cc31/d6cb4fa` (catalogs, all actions, SideNav+primary sections); session hit the 150-turn
    ceiling; 5 untracked section files FAIL typecheck → left uncommitted (no broken commit); a continuation fixes and
    finishes the twelve sections + `settings.spec.ts`.
  - U6: slice 1 DONE (`52f0694` pairing+fonts, `6e25909` NeedsYou, `bfed29e` Projects; 221 tests); slice 2a (GatePlate,
    Gates, Run) in flight; slice 2b (Settings, chrome, labels, App, index.css, styles.test.ts — the 11 known ds-v3
    violations live there) still to do.
- **KEEL:** integration tip **`ced5e30`** (K1 merged; 10/10 gates, STD.3 763 passed/10 ignored). **K2 implemented
  `ffb2caf`** (CAS/migration 003, per-run lock, real cancel, runs.resume + auth row + recovery, change-request loop;
  K2.1-5 green); review REQUEST-CHANGES with **F1 MEDIUM: `runs.followup` unlocked non-CAS update** → repair in flight.
  **S1c BLOCKED out-of-scope** (sqlx-sqlite 0.9 caps libsqlite3-sys <0.38 vs rusqlite 0.41's ^0.39; CP.2 stays red until
  upstream or an owner risk acceptance).
- **Next:** finish Wave C → review+verify each packet → C3 (U3 +RU3 genesis → U4 +RU4 → U5 +RU5 → U6 +RU6, capture
  serialized) → U7 → C-final 0.3.0; KEEL: K2 re-review→verify→merge, then K3→K6 serial, K7, K8, S1a/S1b/S1d/S2/S3, the
  K4+K5+K6 security checkpoint, release 0.3.1 (after K1+K2 merge).

## UPDATE 2026-11-10T17:03Z (ui-v3 seq 111 / keel seq 13)

- **U5 FULLY verified** at `7d4ceb9`: Windows 8/8 (U5.1 **626** ≥620; U5.7 amended at planner capacity to allow the e2e
  support file carrying the root-cause fix — the e2e `invoke` stub refused daemon config-key queries, leaving the client
  null → zero RPCs; NOT missing harness stubs); U5.6 **71/71** non-vacuous; U5.pw expected=969, unexpected=120 ALL inside
  `named/U5.txt` (genesis @visual) → outside=0. Ready for C3 merge in order.
- **U4**: Windows 8/8 (625 tests); capture U4.6/U4.pw dispatched (host free).
- **U3**: 4/6 areas done (frame/onboarding/home/projects, head 8ebf52c); project retry-3 running (2 prior bare platform
  fails); inbox pending.
- **U6**: slice-1 + 2a done (head 0309af5); 2b (Settings/chrome/labels/App/index.css/styles.test.ts) pending.
- **KEEL**: K1+K2 merged → integration tip **`e6b3e6d`** (K2 STD.3 KEEL-PASS 763/10; the K1+K2 release gate for run-ending
  controls satisfied). K3 (no silent fakes) implementing (head 0d2be25). S1c blocked upstream (documented).
