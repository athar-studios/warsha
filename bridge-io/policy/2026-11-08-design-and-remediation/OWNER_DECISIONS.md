# Owner decision package — run `2026-11-08-design-and-remediation`

**Status: READY FOR ACCEPTANCE.** All 8 packets are merged, C3 is swept, and every gate that does not
depend on an owner decision is green. Two decisions and one signature remain. Nothing was merged to
`dev`, nothing was published, and no frozen gate was ever edited.

- Integration branch `run/2026-11-08/integration` = **`282bcd6`** (69 commits ahead of `dev`)
- `dev` = `642ae95`, **untouched by this run**, checkout clean
- **Merging integration into `dev` is a FAST-FORWARD** — verified: `dev` is an ancestor of integration,
  so a merge cannot conflict. Zero snapshot files are in the delta.
- Evidence: `state.json` (seq 57, `phase: ready-for-acceptance`), `verdict.json`, `acceptance.json`
  (all 108 gates carry a verdict), 48 checkpoints, 112 gate logs, `COMPLETION_AUDIT.md`.

## Gate tally — 108/108 have a verdict

| Verdict | Count | Which |
| --- | --- | --- |
| **pass** | **102** | every packet gate, plus GC.1–GC.9 and GC.11 |
| fail | 1 | **G0** — the *recorded baseline truth* at the planner commit, not a defect |
| blocked (owner) | 3 | **G3.9**, **G5.11** (both OD1), **G7.6** (OD2) |
| partial | 2 | **GC.10** (desktop pass, remote half OD1), **GC.12** (only G7.6 missing) |

## What is proven, with logs

| Claim | Evidence |
| --- | --- |
| Desktop visual contract intact after **all eight packets + INT-2** | `G8.4`, `G3.8`, `G4.9`, `G5.10` and `GC.10desk` each measured **793 passed / 0 failed / exit 0 / 0 snapshot writes** on the Linux x86_64 capture host |
| Android APK rebuilds and signs **on the integrated tree** | 842,981 B, `apksigner` Verifies, scheme v2, RSA-4096, **0 source maps inside**, `G7.5` grep exit 0 |
| The ratchet is a true zero, not vacuous | 181 passed at `APP_LENGTH_BUDGET = 0`; the reviewer confirmed `Math.min(145, env)`, that both app roots are scanned, and that a planted `16px` fails |
| Rust workspace | `clippy -D warnings` clean; 743 passed / 0 failed / 36 suites |
| Unit floors | ui 181/170 · client 148/140 · i18n 52/52 · desktop 464/451 · remote 221/221 |
| No secrets | gitleaks: **no leaks**, 120 commits / ~50 MB; the key pasted into chat never entered any revision |
| Snapshot discipline | **0** snapshot files touched anywhere in the run |

## OD1 — the 40 stale remote baselines (blocks GC.10 remote, G3.9, G5.11)

Those 40 failures are **not** regressions from this run. They were already in the recorded G0 baseline
at the planner commit (remote 91 listed / 51 passed / 40 failed) because the baselines were last
refreshed at `ddb8074` on an aarch64 host, before `b3dc490` added visible create-project / start-run /
run-control panels. The selectivity proves it is not raster noise: gates 20/20, settings 8/8 and flows
7/7 pass while run 12/12, projects 8/8 and needs-you 20/36 fail. A rehearsal proved **W5 adds none** of
them (remote = 51/40, identical to G0).

**Decision D1 reserves a baseline refresh to you**: Phase B runs with an owner-named set. Every packet
lists `**/*-snapshots/**` as out of scope, and I touched none.

**What I need:** name the set (the 40 `bench.visual.spec.ts` cases for needs-you, run and projects), or
accept the run with those three gates recorded as a known deviation.

## OD2 — `G7.6` cannot pass as written

The frozen gate greps `packets/W7` for the four credential field names and expects exit 1. That
directory contains `prompt.md`, whose own gate-definition line carries those exact tokens, so the
pattern always matches. Verified: the frozen command exits 0 and the **only** matching file is
`prompt.md`; excluding it exits 1 — i.e. no implementer evidence contains a secret.

**Options:** add `--exclude=prompt.md`; move the brief out of the scanned directory in a future run; or
record the intent-check result as the verdict. I did none of them.

## OD3 — informational only

`G7.3` names the Unix `apksigner`; Windows ships only `apksigner.bat`, which the brief sanctions and
which was used successfully. No action needed.

## Withdrawn decisions

- **OD4** (the `G5.7` vs `G5.10` conflict) — **resolved, no decision needed.** The quiet band now reads
  its width from `sizeTokens`, so the emitted inline style is exactly `3px solid var(--warsha-bench-edge)`
  (the frozen assertion matches) while the source holds no px literal (the ratchet counts nothing).
  `states.spec.ts` is byte-identical. Measured: 793/0 with 0 snapshot writes.
- **OD5** (APK rebuild) — **done.** Rebuilt on the integrated tree and its hash re-recorded.

## Your next steps

1. Read `verdict.json`. Optionally resolve OD1 / OD2.
2. Accept the run.
3. On `dev`: `git merge --ff-only run/2026-11-08/integration` — a fast-forward, no conflicts possible.

## Known nits

- `apps/mobile/README.md` still carries the previous "Build date" line next to the refreshed hash/size.
- The design-system shim pins `#include` ranges (1:75 / 77:103 / 104:); a shifted diagram in the
  planner-owned file now fails loudly in `mdbook test` (verified), but stays silent in `mdbook build`.

## Where the findings live after the merge

Everything detailed sits under `bridge-io/policy/2026-11-08-design-and-remediation/`, which is **gitignored**,
so it will not travel when this branch merges to `dev`. The open findings were therefore also committed into
the repository itself at `282bcd6`: `DECISIONS.md` carries the 40 stale baselines and the three gates blocked
on them, the `G7.6` self-reference, the inert read-before-write guard and why naive wiring is a trap, and the
`runs.subscribe` harness gap that must precede any baseline refresh. `PROGRESS.md` and `PLAN.md` carry the
per-packet outcomes and the plan state.

## Evidence integrity

The evidence set was audited mechanically rather than assumed: 108 gates all carry a verdict, 106 of them
resolve to a real non-empty log, the only two without a log are `G3.9` and `G5.11` (blocked on OD1, never run,
and no log is claimed for them), the tally agrees between `acceptance.json` and `verdict.json`, all 57
checkpoints are monotonic, and 301 text artifacts were scanned for secrets with none found. Ten `G7.*` verdicts
originally cited logs that did not exist and were all re-derived; two harness faults that produced false
failures (`ANDROID_HOME` unset, an escaped `cut` argument) are recorded inside the logs rather than hidden.
## Resume without chat

`state.json` seq 57 (`phase: ready-for-acceptance`) plus the latest file in `checkpoints/`. Every gate in
`acceptance.json` carries a verdict, an exit code, a commit and a log path.
## OD6 — NEW, non-blocking: the read-before-write guard is inert in the shipped product

Every gate in this run passes, so this does not block acceptance. It is surfaced because a code review
filed it as a minor and this run closes: the guard exists, is documented as opt-in, and is never enabled,
while the policy that describes it defaults to on.

| Fact | Where |
| --- | --- |
| The executor is built with the guard **off** | `crates/warsha-pipeline/src/agent_tools.rs:228` |
| The only way to enable it, called by nobody | `agent_tools.rs:238` (`with_read_before_write`) |
| The policy default says **on** | `crates/warsha-pipeline/src/work_protection.rs:73` |
| The daemon reads neither | `crates/warshad/src/lib.rs` contains no reference to either |

**The trap:** wiring it as written would make it impossible to create a new file, because a file that does
not exist can never have been read first. Any fix must exempt creation.

**Question for you:** should an agent be required to read a file before overwriting it, and should creating
a new file be exempt? Options: (a) wire it from the policy *and* exempt creation; (b) change the policy
default to false so behaviour and policy agree, and track wiring as a feature; (c) leave as-is and document
that it is opt-in and unused.

It spans two crates — `agent_tools.rs` (W6) and `warshad` (no packet owner) — so it cannot be a repair
inside any existing packet, and it changes shipped agent behaviour, which is your call.
