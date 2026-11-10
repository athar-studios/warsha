# Independent verification — packet W1 (README truth, docs only)

Run: `2026-11-08-design-and-remediation` · Packet: W1 · Verifier: independent (not implementer, not reviewer)
Verified commit: `6d9728f52eb096199c4ace208435c8b8927e5140` — "docs(readme): name the default WARSHA_LLM_* base URL"
Branch: `run/2026-11-08/w1-readme-truth` (head resolves to the verified commit) · Base: `0772d502002562505c6438ae712abca7a7328d84` (confirmed ancestor of HEAD)
Verification worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/verify-w1` (fresh `git worktree add --detach` at the verified commit; packet worktree `warsha-wt/w1` untouched)
Gate window: 2026-11-08T09:09:00Z – 09:12:25Z

## Overall verdict — PASS

All 13 frozen gates from [prompt.md](file:///C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W1/prompt.md) §4 produce exactly the frozen expected result at the verified commit. The two independent truth spot-checks confirm the README text against recorded evidence and source code; no false or all-green baseline claim was found. The diff is confined to the nine allowed README files.

## Gate results

Every gate has its own log under `bridge-io/policy/2026-11-08-design-and-remediation/packets/W1/gates/` with gate id, exact command, cwd, commit, UTC timestamp, raw output and the real exit code. Commands were taken verbatim from the frozen prompt; loops were run as frozen.

| Gate | Verdict | Exit code | Measured value |
|---|---|---|---|
| G1.S scope | **pass** | 0 | `0` — no file outside the nine allowed READMEs changed in `0772d50..HEAD` |
| G1.1 no service-worker denial | **pass** | 1 (expected) | no match in `README.md` / `README.ar.md` |
| G1.2 no "Planned:" prefix | **pass** | 1 (expected) | no match in either README |
| G1.3 roadmap rows | **pass** | 0 | M10–M20 + `Wave 2` rows found in both `README.md` and `README.ar.md` |
| G1.4 26 pipeline modules | **pass** | 0 | all 26 module names in backticks present in `crates/warsha-pipeline/README.md` |
| G1.5 remote stub truth | **pass** | 0 | `process_handshake` + stub/not-implemented wording present |
| G1.6 templates | **pass** | 0 | `ProjectTemplate` + web/cli/desktop/android present |
| G1.7 stale git dependency claim | **pass** | 1 (expected) | "The pipeline asks this crate" absent from `crates/warsha-git/README.md` |
| G1.8 desktop specs | **pass** | 0 | `flows.spec.ts`, `real-acceptance.cjs`, `188` present |
| G1.9 remote composition | **pass** | 0 | `registerShellWorker` and `RemoteProvider` present |
| G1.A architecture | **pass** | 0 | `arch: 5 rules, 0 violations` |
| G1.P engineering policy | **pass** | 0 | `policy: 8 checks, 0 failures` |
| G1.W wire contract | **pass** | 0 | `wire: 8 checks, 0 violations` |

Count: 13 gates, 13 at the frozen expectation, 0 deviations.

## Independent truth spot-check

### 1. G0 baseline honesty — `apps/desktop/README.md`

Claim under test ([apps/desktop/README.md:48-56](file:///C:/Users/Dragonfly/Downloads/warsha-wt/verify-w1/apps/desktop/README.md#L48)): the G0 baseline measured at `0772d50` on the Linux capture host recorded **785 passed / 8 failed** for desktop (793 listed), the eight failures are all `screens.a11y.spec.ts:44` on the `settings` screen at 390x844 and 1440x900 × ar/en × light/dark (so a11y came back 180 of 188), every other desktop spec was green, and G0's verdict is `fail`.

Measured against [G0.log](file:///C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/gates/G0.log) and [acceptance.json](file:///C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/acceptance.json):

| Fact | README / G0 expectation | Evidence |
|---|---|---|
| Recorded commit | `0772d50` | `G0.log:8` `commit : 0772d502002562505c6438ae712abca7a7328d84`; capture host WSL Ubuntu (`G0.log:12`) |
| Desktop totals | 793 listed / 785 passed / 8 failed | `G0.log:30` `8 failed, 785 passed, 0 skipped (793 listed)`; `acceptance.json:22-24` |
| Which eight failed | a11y `settings`, two viewports × two locales × two themes | the eight failed-case lines in `G0.log` are exactly `screens.a11y.spec.ts:44:9 … settings` at 390x844 ar light/dark, en light/dark and 1440x900 ar light/dark, en light/dark |
| a11y spec | 188 listed / 180 passed / 8 failed | `acceptance.json:29-31` |
| Other desktop specs | states 252/252, visual 308/308, flows 30/30, layout 12/12, onboarding 3/3 | `acceptance.json` per-spec block (all `failed: 0`) |
| G0 verdict | `fail`, open item | `acceptance.json:12` `"verdict": "fail"`; `baseline_note`: "not an all-green run" |
| Remote totals | 91 listed / 51 passed / 40 failed | `G0.log:36` `40 failed, 51 passed, 0 skipped (91 listed)`; `acceptance.json:61-63`; also stated honestly in [apps/remote/README.md:76-78](file:///C:/Users/Dragonfly/Downloads/warsha-wt/verify-w1/apps/remote/README.md#L76) |

No all-green claim exists in any of the nine READMEs: a scan for `all[- ]green|793 passed|91 passed|everything passes` matched nothing (log `gates/SPOTCHECK.log`). The only root-README mention of `785` (`README.md:17`) is a count of Playwright cases, not a pass claim.

**Result: CONFIRMED.** The README states the baseline honestly and matches the recorded evidence line for line.

### 2. All 26 pipeline modules listed — `crates/warsha-pipeline/README.md`

Claim under test ([crates/warsha-pipeline/README.md:12-77](file:///C:/Users/Dragonfly/Downloads/warsha-wt/verify-w1/crates/warsha-pipeline/README.md#L12)): `src/lib.rs:18-50` declares 26 modules — 23 private, 3 public — plus test-only `test_util`, and every one is listed one line per module.

Measured against [crates/warsha-pipeline/src/lib.rs:18-50](file:///C:/Users/Dragonfly/Downloads/warsha-wt/verify-w1/crates/warsha-pipeline/src/lib.rs#L18):

| Fact | Measured |
|---|---|
| Module declarations in `lib.rs` | 26 (`grep -cE '^(pub )?mod [a-z_]+;'` → `26`): 23 `mod`, 3 `pub mod` (`mcp`, `mcp_transport`, `settings`), plus `#[cfg(test)] pub(crate) mod test_util` at `:47-49` |
| README module bullets | 27 = 26 modules + `test_util` |
| Set difference (lib.rs vs README) | only `test_util` — every declared module is listed, and the README lists nothing that is not declared |
| Header-doc fidelity (spot-read) | `guardrails`, `mcp_transport`, `orchestrator`, `work_protection`, `handoff` — README lines match each module's own `//!` header |

**Result: CONFIRMED.** The count, the private/public split and the full list are accurate; the module descriptions sampled are faithful to the source headers.

## Scope and diff

`git diff --stat 0772d50..HEAD` (in the verification worktree):

```
 README.ar.md                     |  31 ++++++++++--
 README.md                        |  43 ++++++++++++----
 apps/desktop/README.md           |  63 +++++++++++++++++++----
 apps/remote/README.md            |  77 ++++++++++++++++++++++------
 crates/warsha-git/README.md      |  48 ++++++++++++++----
 crates/warsha-pipeline/README.md | 106 ++++++++++++++++++++++++++++++++-------
 crates/warsha-remote/README.md   |  71 ++++++++++++++++++++++----
 packages/crypto/README.md        |  63 ++++++++++++++++++-----
 templates/README.md              |  44 ++++++++++++----
 9 files changed, 447 insertions(+), 99 deletions(-)
```

All nine changed files are inside the packet's allowed_files; G1.S measured `0` out-of-scope files. `git status --porcelain` in the verification worktree was empty after every gate (0 entries) — the gates wrote nothing into the verified tree.

## Limitations

- Docs-only packet: no build or install was needed; the three node gates are self-contained repo scripts. Node v26.8.1 on Git Bash (Windows); no pnpm install ran.
- The Playwright suites were not re-run — they are not W1 gates. Baseline truth was checked against the recorded G0 evidence, as instructed.
- Verification is limited to the frozen gates plus the two spot-checks above; no other README claim was independently re-derived.
- No edits were made to the implementation, gates, `PLAN.md`/`PROGRESS.md`/`DECISIONS.md`, dependencies, lockfiles or snapshots; nothing was pushed, merged or published.

## Log index

All under [packets/W1/gates/](file:///C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W1/gates):

[G1.S.log](file:///C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W1/gates/G1.S.log) ·
[G1.1.log](file:///C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W1/gates/G1.1.log) ·
[G1.2.log](file:///C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W1/gates/G1.2.log) ·
[G1.3.log](file:///C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W1/gates/G1.3.log) ·
[G1.4.log](file:///C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W1/gates/G1.4.log) ·
[G1.5.log](file:///C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W1/gates/G1.5.log) ·
[G1.6.log](file:///C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W1/gates/G1.6.log) ·
[G1.7.log](file:///C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W1/gates/G1.7.log) ·
[G1.8.log](file:///C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W1/gates/G1.8.log) ·
[G1.9.log](file:///C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W1/gates/G1.9.log) ·
[G1.A.log](file:///C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W1/gates/G1.A.log) ·
[G1.P.log](file:///C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W1/gates/G1.P.log) ·
[G1.W.log](file:///C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W1/gates/G1.W.log) ·
[SPOTCHECK.log](file:///C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W1/gates/SPOTCHECK.log)
