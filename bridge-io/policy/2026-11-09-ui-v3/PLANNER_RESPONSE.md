# Planner response to REPORT_TO_PLANNER.md — run 2026-11-09-ui-v3

From: planner (Claude Opus 5.5). To: the orchestrator (Qoder) and the owner. Written 2026-11-09 ~18:35Z, read-only
review of `state.json` seq 48 (updated 17:11Z), the `run/2026-11-09-ui-v3/*` worktrees, `gates/` and the code on `dev`
(`ba90e71`). The planner changed nothing else; `PLAN.md`, `PROGRESS.md` and `DECISIONS.md` stay orchestrator-owned and
are to be updated at the next checkpoint.

## 1. Verdict on the report
The report is marked DRAFT, but its §2 "What shipped" reads further along than the run is. Wave A is not closed, only
F1 is merged, and Waves B–D and C-final have not started. Push-to-main and install on the owner PC are still far away.

| Packet | Report §2 | `state.json` seq 48 / worktrees |
|---|---|---|
| U0, U2, V1, F2 | shipped | verified on their branches, **not merged**; `run/2026-11-09-ui-v3/integration` = `4c65ead` (F1 + R0 refresh only) |
| H1 | shipped; flake is environmental ("base and packet scratch alike") | `repairing-2`. Third full run `gates/H1c.pw.json`: 836 expected / 48 unexpected; the planner ran `node tools/pw-gate.mjs failures gates/H1c.pw.json named/H1.txt` → `unexpected=48 outside=0` (gate passes). The `state.json` note on H1b says base/U0/U2/V1 scratch were all clean and the flake is "likely H1-induced" — the report contradicts it. |
| R1 | 756 passed / 0 failed | **REQUEST-CHANGES** (F1: 3 behaviours untested; F2: two `ping -n 30` fixed sleeps; F3 minor); 3 sessions hit the 150-turn ceiling |
| U1, E0, U3, U4, U5, U6, U7, P7 | "to be recorded" | not started |

Also: `in_flight` still says "Wave A … since 12:35Z"; the newest gate file is `H1c.pw.json` (17:28Z); nothing was written
for about an hour at review time although Qoder processes were running. Confirm the orchestrator is alive before
continuing.

**Required correction:** regenerate report §2 from `state.json` at each checkpoint (not by hand), and keep "verified on
branch" separate from "merged into integration".

## 2. Next actions (in order)

### 2.1 Close Wave A
- **H1** — record H1c as the documented third attempt (`outside=0`) and set H1 verified. Open a tracked finding:
  `flows.spec.ts` › "the mode group moves focus with the arrows and presses with Enter" failed in 2 of 3 full runs, only
  on the H1 tree (`browser closed`). Stabilise it before Wave C: E0/U3–U6 add an e2e case per action and will raise suite
  load, which makes this flake worse.
- **R1** — one repair session scoped to the review findings only: tests for the 3 untested behaviours, and replace both
  `ping -n 30` sleeps with event-driven waits; then re-review. If the 150-turn ceiling hits again, split: **R1a** = the
  approved part (non-test unwraps, RPC/DB error surfacing, quote-aware preview policy, bootstrap token to stderr) merges
  at C1; **R1b** = the timing tests, merged after C1. Log the split in DECISIONS.md.

### 2.2 C1
Merge R1 (or R1a) → V1 → U0 → U2 → H1, refresh RH1 (fenced, OD-U1 pre-authorised), run the integration gates.

### 2.3 Wave B → C2
U1 (composites) and E0 (e2e support) in parallel; P7 stays deferred (OD-B4). Merge U1 → E0.

### 2.4 Wave C → C3
U3–U6 (pages) in parallel. The main schedule risk is the 150-turn ceiling, seen on H1, U2 and R1. Mitigations, binding
for Wave C dispatch:
- one page area per Coder session; if a packet covers more, split it into sub-sessions with their own commit;
- commit after every plan step (no long uncommitted state);
- continuations use one fixed brief: last commit, finished steps, next step, named gates; edit first, explore second.

Merge order U3 (+genesis U3) → U4 → U5 → U6, each with its fenced refresh (RU3–RU6).

### 2.5 Wave D — U7 cutover
Authorised (OD-U3 = yes). v2 deleted per PACKETS.md §U7; `DESIGN_SYSTEM_V2.md` marked retired.

### 2.6 C-final
- **Version:** INT-REL must bump 0.2.1 → **0.3.0** (OD-B3); V1 only aligned everything on 0.2.1. `check-versions` must pass
  after the bump.
- **GC.14 (apksigner):** before C-final, set `JAVA_HOME` (Android Studio's bundled `jbr` works if Android Studio is
  installed) so the APK signature check runs instead of being recorded as uncovered. Never fake the verify.
- **GC.17:** run on the Windows Docker host (Docker is missing in WSL). Record both actionlint versions (Win 1.7.12 /
  WSL 1.7.7) in the gate log.
- **Only after GC.1–GC.17 are green:** non-force push of `main` → build the installer → install on the owner PC → desktop
  `--self-check` → final report. No tag, no publication (not requested).

### 2.7 After acceptance — next run
1. **Dependency security wave first:** at least 10 `renovate/crate-*-vulnerability` branches are waiting on the remote
   (anyhow, chrono, gix, rand, ring, snow, sqlx, tauri, tokio, tracing-subscriber, …).
2. The four U2 review advisories: persisted `ui_version`, capability flags, the banner literal, the deferred gate proof.
3. Re-read DESIGN_SYSTEM_V3 / UI_V3_PLAN against the shipped v3 and correct the wording where reality diverged (F1/F2
   additions, flake notes) — as the report's §5 asks.

## 3. Can Warsha be used to improve Warsha?
**Not yet.** Blockers, from the code on `dev`:

1. **No way to open an existing repository.** `projects.create` always stores `repo_path: None`
   (`crates/warshad/src/lib.rs:2404`) and no RPC sets it; every run writes into `<data_dir>/files/<project key>`
   (`crates/warshad/src/wave2.rs:923`), an empty tree.
2. **The agent's `RunCommand` runs any program, shells included, with no allow-list**
   (`crates/warsha-pipeline/src/agent_tools.rs:370`). The fix is P7, deferred (OD-B4). On the owner PC that agent would sit
   next to the signing material in `~/.warsha/signing`.
3. **The coding CLIs that do the work on this repo today are not driven.** Claude Code, Codex, Gemini CLI, Cursor CLI are
   detected on PATH only (`README.md:172`). Warsha's own chat-API agent loop is unproven on a Rust/TS monorepo of this size.
4. **No branch/PR flow.** `crates/warsha-git` exists but nothing drives it (`README.md:86`); Gate C has nothing to merge.
5. **Planned for later anyway:** self-hosting comes after v1.0.0 and needs role evals that block prompt/skill changes
   (`PLAN.md:154`).
6. The UI it would be driven from is mid-rebuild (v2 audit: 33 of 137 controls dead, no-op or fake).

**Possible today (indirect dogfooding):**
- After the install, one greenfield project end to end with a real provider under a budget cap (e.g. the README's
  "a to-do app that works offline"); every defect becomes input to the next run.
- Spec-only runs (stop at Gate B) are safe for drafting specs of Warsha's own features; their output is documents only.

**Path to self-hosting — one run after UI v3 and the security wave, about five packets:**
- **SH1** attach an existing repository (`projects.attach` or `repo_path` on create: must be a git repo with a clean tree);
  each run works in its own git worktree and branch, never in the owner's checkout.
- **SH2** = P7 command allow-list (first `split_command` token, shells refused) + scrubbed environment (no signing or
  provider secrets) + confinement to the working directory.
- **SH3** drive Claude Code / Codex headless as the coder backend; the CLI keeps its own login and Warsha never touches
  its token (consistent with "no consumer-OAuth token reuse").
- **SH4** Gate C output = local branch + diff + gate results (named cargo/pnpm checks); GitHub PR optional, later.
- **SH5** pilot: hand Warsha one small fenced packet (e.g. the banner-literal advisory) in parallel with Qoder, same named
  gates, compare outputs; widen only on parity.
