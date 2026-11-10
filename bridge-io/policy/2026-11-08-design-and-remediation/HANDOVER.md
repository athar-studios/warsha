# Handover prompt — orchestrate run `2026-11-08-design-and-remediation` (for Qoder or zadloop)

You are the ORCHESTRATOR continuing run `2026-11-08-design-and-remediation` in the Warsha repo at
`C:/Users/Dragonfly/Downloads/Warsha` (branch `dev`). The planner phase is finished; you take the run
from **phase `plan` (seq 2)** through dispatch, review, verification and integration. You do not
implement packets yourself and you never approve acceptance — the owner (human) does.

## Where the planner stopped (verifiable on disk)
- Planner commit **`0772d502002562505c6438ae712abca7a7328d84`** on `dev`
  (`docs(plan): specify Design System v2 and split the post-Qoder remediation into W1–W7`): adds
  `docs/designs/DESIGN_SYSTEM_V2.md` (+ SITEMAP row), the `PLAN.md` section "Run 2026-11-08", the
  `DECISIONS.md` entry D1–D10 and the `PROGRESS.md` planner entry.
- Branch **`run/2026-11-08/integration`** points at that commit — the base for every packet.
- Evidence dir (gitignored) **`bridge-io/policy/2026-11-08-design-and-remediation/`**:
  `state.json` (schema `warsha-run/v1`, phase `plan`, seq 2, 7 packets, 99 frozen gates),
  `checkpoints/001-intake.json`, `checkpoints/002-plan.json`, `acceptance.json` (every gate
  `not-run`), `packets/W1..W7/prompt.md` (copy-paste worker prompts), this file.
- No packet has started. No gate has run. Nothing is merged.

## Read before acting
`AGENTS.md`, `ENGINEERING_POLICY.md` (binding: lifecycle §1, roles §2, state §3, evidence §4,
failures §5, secrets §6), `state.json`, `PLAN.md` "Run 2026-11-08", `docs/designs/DESIGN_SYSTEM_V2.md`
§9 (pixel-neutral rule), `DECISIONS.md` 2026-11-08 D1–D10.

## Your job, in order
1. **G0 baseline (verifier role, Linux capture host).** Check out `run/2026-11-08/integration` on the
   capture host (pinned IBM Plex via `scripts/ci/install-capture-fonts.sh`, the fontconfig pin), run
   `pnpm exec playwright test --project=desktop --reporter=line` and `--project=remote`, save raw
   output to `gates/G0.log`, record passed/failed per spec in `acceptance.json`. Listed counts: desktop
   793 (a11y 188, states 252, visual 308, flows 30, layout 12, onboarding 3), remote 91. If the
   result is not all-green, record it as the baseline truth (do not "fix" it in this run) and flag the
   a11y 180-vs-188 discrepancy to the owner.
2. **Dispatch Wave A in parallel**: W1, W3, W4, W6, W7 — hand each worker model its
   `packets/WN/prompt.md` verbatim. One worker per packet; record each assignment in
   `state.json` → `plan.packets[i].roles.implementer`. Each worker creates its own worktree from
   `run/2026-11-08/integration` (the command is in its prompt). W7 uses the owner-scoped signing
   material only; if it is missing, W7 is `blocked` (out-of-scope), not faked.
3. **Per packet, when the worker reports** (`packets/WN/report.md`):
   - **Review** (a reviewer agent different from the implementer): full diff at one commit
     (`git -C ../warsha-wt/wN diff $BASE..HEAD`), scope against `allowed_files`, `AGENTS.md`
     rules, i18n/RTL, architecture boundaries, secret hygiene, test quality, the reviewer checks named
     in the prompt (R3.1 ratchet count, R6.1 no new `unwrap`). Findings → `review.md`; save the patch
     with `git format-patch` under `diff/WN/`.
   - **Verify** (a verifier different from both): run that packet's gates exactly as written in
     `state.json`, in the packet worktree at the reviewed commit; raw output to `gates/<id>.log`;
     verdict, exit code, timestamp and commit into `acceptance.json`. Linux-host gates run on the
     capture host against the same commit.
   - **Repair**: any failed gate or finding → back to the same implementer, then review again (never
     verification only). Max 3 iterations (`repair.max_repair_iterations`); at exhaustion mark the
     packet `blocked` with the reason. Never edit, skip, narrow or re-word a gate; never update
     snapshots.
   - On every phase transition: rewrite `state.json` (seq + 1, `phase`, `updated_at`) and append an
     immutable copy `checkpoints/<seq>-<phase>.json`.
4. **C1**: when W3 and W4 (and any of W1/W6/W7) are green and the **owner approves**, merge each into
   `run/2026-11-08/integration` with `git merge --no-ff run/2026-11-08/wN-<slug>`; re-run
   `node scripts/check-arch.mjs`, `check-engineering-policy.mjs`, `check-wire-contract.mjs` on the
   integration tip; checkpoint.
5. **Dispatch Wave B in parallel**: W2 and W5 (their prompts verify the C1 precondition themselves).
   Same review/verify/repair loop.
6. **C2 + INT-2**: owner-approved merges of W2 and W5; then on the integration branch change exactly
   `const APP_LENGTH_BUDGET = <N>;` → `0` in `packages/ui/src/tokens/tokenDrift.test.ts`
   (`test(ui): tighten the R6.9 app-length ratchet to zero`), and run gate `INT-2`.
7. **C3**: run integration gates `GC.1`–`GC.12` on the integration tip (Windows host + Linux capture
   host); write `verdict.json`; fold every `packets/WN/report.md` into **one** `PROGRESS.md` entry and
   their decisions into `DECISIONS.md`, tick the `PLAN.md` "Run 2026-11-08" checklist — these three
   files are edited only by you, only at checkpoints. Then report "ready for acceptance" to the owner.
   Merging the integration branch into `dev` happens only on the owner's explicit approval.

## Non-negotiables
- Roles are separate per packet (implementer ≠ reviewer ≠ verifier); a forced merge of roles is
  written into `state.json` and shown to the owner, never claimed as independent.
- Workers never edit `PLAN.md`/`PROGRESS.md`/`DECISIONS.md`, never update `*-snapshots/**`, never
  change dependencies, never push, never merge.
- No secrets in any state, checkpoint, log, diff or report; no real model API calls in gates.
- A claim without a gate log is not done. Prose summaries (including worker reports) are not evidence.
- Nothing is published, released, force-pushed or posted.

## After this run
Phase B (visual wave, the owner names the baseline set) and Phase C (IBM Plex vendoring, OFL-1.1
notice) are specified in `DESIGN_SYSTEM_V2.md` §9; logged follow-ups are at the end of `PLAN.md`
"Run 2026-11-08". Plan them as a new run with its own `run_id`.
