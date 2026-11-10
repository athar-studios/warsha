# W2 verification — canonical docs (docs only)

- Commit: `e71567a499c435711899643bc676a004ac81eaa2` (`docs(verify): record the G0 baseline truth and the open OD1 remote decision`), BASE `406240a5eebf07b7e627859fccce2ef564946c91`.
- Verify worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/verify-w2`, detached HEAD, `git status --porcelain` empty before and after the gate run. Implementer worktree `warsha-wt/w2` untouched.
- Scope of diff vs BASE: 15 files, all inside the packet's `allowed_files`.
- Logs: `gates/<gate-id>.log` (gate id, exact frozen command, commit, UTC timestamp, exit code, raw output).

## Gates (frozen text from `packets/W2/prompt.md` §4, run verbatim)

| Gate | Verdict | Exit | Expected | Measured |
|---|---|---|---|---|
| G2.S scope vs BASE | PASS | 0 | 0 | `0` out-of-scope files |
| G2.1 `mdbook build docs` | PASS | 0 | 0 | `HTML book written to ...\verify-w2\docs\book` |
| G2.2 stale-phrase grep | PASS | 1 | 1 | no match (empty output) |
| G2.3 present-token loop | PASS | 0 | 0 | 19/19 tokens found |
| G2.4 R6 test count | PASS | 0 | 0 | `35 true` |
| G2.5 wire check count | PASS | 0 | 0 | `9 checks` |
| G2.6 SITEMAP/SUMMARY/SKILL | PASS | 0 | 0 | all tokens found |
| G2.A `check-arch.mjs` | PASS | 0 | 0 | `arch: 5 rules, 0 violations` |
| G2.P `check-engineering-policy.mjs` | PASS | 0 | 0 | `policy: 8 checks, 0 failures` |
| G2.W `check-wire-contract.mjs` | PASS | 0 | 0 | `wire: 9 checks, 0 violations` |

- G2.4 derives **N = 35** (`^\s*it\(` in `packages/ui/src/tokens/tokenDrift.test.ts`) and `docs/ARCH_RULES.md` contains ``tokenDrift.test.ts` (35 tests)`` → `35 true`.
- G2.5 greps `docs/ARCH_RULES.md` for the exact string **`9 checks`**, taken from `node scripts/check-wire-contract.mjs | grep -oE '[0-9]+ checks' | head -1`.

## Truth spot-check (independent, not gate-derived)

Claim checked against the recorded baseline log `gates/G0.verifier-baseline.log` (`summary: 8 failed, 785 passed (793 listed)` desktop; `summary: 40 failed, 51 passed (91 listed)` remote) and against packet commit `e71567a` (introduced by `git log -S'blocked on **OWNER DECISION OD1**'` = `e71567a`):

- `docs/VERIFY.md:71-103` §1.3 "E2E baseline truth — G0 is not all-green": table row Desktop `793 / 785 / 8` and Remote `91 / 51 / 40`; states G0 verdict is `fail`, is a baseline truth record not a green gate, names the 8 `settings` axe failures, says W8 fixed them (793/0 at G8.4/G3.8/G4.9, snapshot_writes 0), and states "The **40 remote failures remain OPEN** and are blocked on **OWNER DECISION OD1**", with the correct cause (stale `bench.visual` baselines, 12+8+20=40) and the rule that no document may imply the remote suite is green.
- `docs/designs/SITEMAP.md:27-32` repeats it honestly: "Those are **listed** totals, not a green baseline: G0 recorded desktop 793 listed / 785 passed / 8 failed ... and remote 91 / 51 / **40 failed** ... open under owner decision OD1."

Numbers match the recorded G0 log exactly; no changed doc presents the remote suite as green. Note (not a verdict): `_agents/skills/warsha_elephant/SKILL.md:15-17` lists per-spec totals (remote 91 = 84 + 7) without restating the OD1 caveat, and planner-owned `docs/designs/DESIGN_SYSTEM_V2.md:521` (untouched by W2) still says "793 · 91 passed" — pre-existing and outside this packet's scope.

## Findings

No gate failed, no expected condition was weakened, no out-of-scope file changed, and the headline truth claim is accurate. Residual risk is confined to the two documented caveats above, which belong to the planner/OD1 track, not to W2.

**Overall verdict: PASS**
