# W8 — independent verification (G0 truth repair, a11y)

**Run:** `2026-11-08-design-and-remediation` · packet **W8** · verifier role (not implementer, not reviewer).
**Verdict: PASS** — all 8 worktree gates executed at the reviewed head pass with exit code 0 and meet their thresholds.

## Subject

| | |
|---|---|
| Commit verified | `0b8a7e89f987c1ffb6415110238e91514cd4aa9f` — `test(desktop): guard the settings ledger's list-item structure` |
| Base | `0772d502002562505c6438ae712abca7a7328d84` |
| Verification worktree | `C:/Users/Dragonfly/Downloads/warsha-wt/verify-w8` (detached at the verified commit) |
| `git rev-parse HEAD` in worktree | `0b8a7e89f987c1ffb6415110238e91514cd4aa9f` (exact match) |
| Environment | node v26.8.1 · pnpm 9.0.0 · `pnpm install --frozen-lockfile` exit 0 |
| Working tree at run time | clean — `git status --porcelain` empty before and after the gate runs, so every result is attributable to the commit alone |
| Diff BASE..HEAD | 2 files, +178 / −124 — `apps/desktop/src/screens/SettingsScreen.tsx` (+131/−124 net hunk churn, mostly re-indentation of the ledger block) and `apps/desktop/src/screens/SettingsScreenIntegrations.test.tsx` (new, 47 lines) |
| Gate window (UTC) | 2026-11-08T08:53:50Z → 2026-11-08T08:56:08Z |

The packet worktree `C:/Users/Dragonfly/Downloads/warsha-wt/w8` was not entered. No implementation file, gate, snapshot, plan/progress/decision file, dependency or lockfile was modified by this verification; the only files written are the logs below and this file.

## Gate results (8 worktree gates)

| Gate | Command | Verdict | Exit | Measured |
|---|---|---|---|---|
| **G8.S** | `git diff --name-only 0772d50..0b8a7e8 \| grep -vE '^apps/desktop/src/screens/SettingsScreen(Integrations\.test)?\.tsx$' \| wc -l` | **pass** | 0 | **0** out-of-scope files (only the two allowed files changed) |
| **G8.1** | `pnpm --filter warsha-desktop test` | **pass** | 0 | **47 / 47 test files passed; 446 tests passed, 0 failed** (threshold ≥ 444; baseline 443, +3 from the new test file) |
| **G8.2** | `pnpm -r typecheck` | **pass** | 0 | 7 workspace projects, all `Done`, 0 errors |
| **G8.3** | `pnpm -r lint` | **pass** | 0 | 7 workspace projects, all `Done`, 0 errors |
| **G8.5** | `git status --porcelain -- '*-snapshots/*' \| wc -l` | **pass** | 0 | **0** modified/untracked snapshot files |
| **G8.A** | `node scripts/check-arch.mjs` | **pass** | 0 | `arch: 5 rules, 0 violations` |
| **G8.P** | `node scripts/check-engineering-policy.mjs` | **pass** | 0 | `policy: 8 checks, 0 failures` |
| **G8.W** | `node scripts/check-wire-contract.mjs` | **pass** | 0 | `wire: 8 checks, 0 violations` |

### G8.4 — out of scope for this verifier (not run by me)

G8.4 (`pnpm exec playwright test --project=desktop --reporter=line`, expect **793 passed / 0 failed**, and simultaneously the pixel-neutral proof: the 8 formerly failing `screens.a11y.spec.ts:48 settings` cases are green while all 308 visual cases are unmoved) is a **linux-capture-host** gate. The orchestrator runs it separately on the WSL capture host against this same commit and records it; a `gates/G8.4.log` was in progress at the moment this file was written (≈553/793, no final summary line yet). I did not run Playwright, produced no part of that log, and did not pass `--update-snapshots`.

## Exact raw vitest summary (G8.1)

```
 Test Files  47 passed (47)
      Tests  446 passed (446)
   Start at  12:53:52
   Duration  72.19s (transform 11.43s, setup 170.91s, collect 74.40s, tests 83.04s, environment 319.45s, prepare 35.59s)

# exit_code: 0
```

No failing or skipped test appears anywhere in the log; the run is clean.

## Observations (no verdict impact)

- The G8.S scope count is exactly 0 and the changed-file list is exactly the two allowed paths — the packet's `allowed_files`. No e2e harness, snapshot, `packages/ui/**`, or doc file moved.
- The `SettingsScreen.tsx` diff is the minimal shape the packet prescribed: the `<Text>` description is lifted out of `<Ledger>` and the `<Ledger>` is rendered only under `integrations.length > 0`; the large line churn is re-indentation from the added conditional wrapper, not behavioural rewriting. Structure of the connectors branch is preserved otherwise.
- G8.1 at 446 (≥ 444) confirms the new `SettingsScreenIntegrations.test.tsx` runs and no existing test was lost.

## Logs (one per gate, raw output + real exit code)

All under `C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/gates/`:

`G8.S.log` · `G8.1.log` · `G8.2.log` · `G8.3.log` · `G8.5.log` · `G8.A.log` · `G8.P.log` · `G8.W.log`
(`G8.4.log` in the same directory belongs to the orchestrator's Linux run, not to this verification.)

## Not verified by me

- **G8.4** — the end-to-end a11y/visual proof, on the Linux capture host; orchestrator-owned. Consequently I cannot assert the 793/0 desktop e2e result, nor the 308/308 visual invariance, from my own evidence.
- No manual/product-level UI exercise was performed; my evidence is exactly the eight gate runs above.
- I did not re-audit the packet's root-cause narrative beyond reading the diff and the gate outcomes; code acceptance is the reviewer's recorded decision.

**Overall verdict for the 8 worktree gates: PASS.**
