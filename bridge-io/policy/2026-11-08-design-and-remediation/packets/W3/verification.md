# Independent verification — packet W3 (Design System v2 in `packages/ui`)

Run: `2026-11-08-design-and-remediation` · Packet: W3 · Verifier: independent (not implementer, not reviewer)
Verified commit: `0f829731273d722ae21f25e26a54767bc852fe56` — "docs(ui): re-record the ratchet's base as the post-W8 integration tip"
Branch: `run/2026-11-08/w3-ui-v2` (head resolves to the verified commit) · Base: `5abe5ef` ("merge: W8 G0 truth repair", confirmed ancestor of HEAD; the first W3 commit sits directly on it — 7 commits in `5abe5ef..HEAD`)
Verification worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/verify-w3` (fresh `git worktree add --detach` at the verified commit; the packet worktree `warsha-wt/w3` was not touched)
Environment: Windows host, node v26.8.1, pnpm 9.0.0, `pnpm install --frozen-lockfile` clean (lockfile untouched)
Gate window: 2026-11-08T10:23:24Z – 10:26:30Z (12 worktree gates)

## Overall verdict — 12/12 worktree gates PASS; packet NOT fully green because G3.9 is unsatisfiable pending OD1

All 12 worktree gates produce exactly the frozen expected result at the verified commit: **12 at expectation, 0 deviations, 0 failures**. G3.8 is accepted on orchestrator evidence (desktop 793 passed / 0 failed / exit 0 / 0 snapshot writes at this exact commit) and is not independently re-run here. **G3.9 (remote 91 passed / 0 failed) was not run and cannot pass: 40 remote visual baselines are stale product images awaiting owner decision OD1.** Therefore W3 as a whole cannot be called fully green: 13 of the 14 frozen gates are satisfied and 1 is blocked on an owner decision, not on W3 code.

## Gate results

Each gate has its own raw log under `bridge-io/policy/2026-11-08-design-and-remediation/gates/` with gate id, exact command, commit, UTC timestamp, raw output and the real exit code. Commands are verbatim from [prompt.md](file:///C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W3/prompt.md) §4.

| Gate | Verdict | Exit code | Measured value |
|---|---|---|---|
| G3.S scope vs BASE `5abe5ef` | **pass** | 0 | `0` — 24 changed files, every one under `packages/ui/src/`, `packages/ui/.storybook/` or `packages/ui/README.md` |
| G3.1 `@warsha/ui` typecheck | **pass** | 0 | `tsc --noEmit` + `tsc --noEmit -p tsconfig.storybook.json` clean |
| G3.2 `@warsha/ui` lint | **pass** | 0 | eslint clean |
| G3.3 `@warsha/ui` test | **pass** | 0 | **181 passed** (9 files), 0 failed — floor ≥ 170 |
| G3.4 `@warsha/ui` build-storybook | **pass** | 0 | Storybook preview built (8.08 s) into `packages/ui/storybook-static/` |
| G3.5 `pnpm -r typecheck` | **pass** | 0 | crypto, client, i18n, ui, remote, desktop all Done |
| G3.6 `warsha-desktop` test | **pass** | 0 | **446 passed** (47 files), 0 failed — floor ≥ 443 (and ≥ 221) |
| G3.7 `warsha-remote` test | **pass** | 0 | **221 passed** (16 files), 0 failed — floor ≥ 221 |
| G3.10 no snapshot touched | **pass** | 0 | `0` — run **after** G3.3/G3.6/G3.7 |
| G3.A `check-arch.mjs` | **pass** | 0 | `arch: 5 rules, 0 violations` |
| G3.P `check-engineering-policy.mjs` | **pass** | 0 | `policy: 8 checks, 0 failures` |
| G3.W `check-wire-contract.mjs` | **pass** | 0 | `wire: 8 checks, 0 violations` (frozen expectation is exit 0 only; this base predates W4's W9 check) |
| G3.8 desktop Playwright (Linux capture host) | **pass-by-orchestrator** | 0 | **793 passed / 0 failed**, 0 snapshot writes, `head_after` = verified commit |
| G3.9 remote Playwright (Linux capture host) | **blocked-on-OD1** | not run | frozen expectation 91 passed / 0 failed; G0 measured 51 passed / 40 failed |

Count for the worktree gates: **12 gates, 12 at the frozen expectation, 0 deviations.**

## Scope and isolation

- Worktree was detached at `0f82973…` and **clean** before the first gate (`git status --porcelain` = 0 lines). The only post-run artefact is the untracked `packages/ui/storybook-static/` directory produced by G3.4; it matches no `*-snapshots/*` path and does not affect G3.10.
- No implementation file, gate, test, snapshot, dependency, lockfile or `PLAN.md`/`PROGRESS.md`/`DECISIONS.md` was edited. No `--update-snapshots` was ever passed. Nothing was pushed or merged.
- G3.10 was deliberately executed last so that any snapshot write by the three test suites would be visible; it is 0.

## G3.8 — accepted on orchestrator evidence (not re-run)

The orchestrator ran the Linux desktop gate at the same commit; the log is [gates/G3.8.log](file:///C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/gates/G3.8.log):

- header `commit: 0f829731273d722ae21f25e26a54767bc852fe56`, WSL Ubuntu x86_64, `node=v20.20.2`, `pnpm=9.0.0`, worktree `/root/verify-G3.8`;
- `[desktop exit code: 0]`, `793 passed (14.5m)`;
- post-run integrity: `snapshot_writes: 0`, `dirty_after: 0`, `head_after: 0f829731273d722ae21f25e26a54767bc852fe56`.

Attempt 1 recorded 792 passed / 1 failed (`flows.spec.ts:81`, 390x844 ar flow-closure) and is preserved at [gates/G3.8.attempt-01-1flowflake.log](file:///C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/gates/G3.8.attempt-01-1flowflake.log); the spec then passed 30/30 twice in isolation before the full green re-run. Per instruction I did not run Playwright and did not overwrite `G3.8.log`.

**Limit:** G3.8 is verified as *evidence consistency*, not by independent re-execution. The log is internally consistent (commit, exit 0, 793/0, zero snapshot writes, unchanged HEAD).

## G3.9 — blocked on OD1, never executed

Frozen expectation: `pnpm exec playwright test --project=remote --reporter=line` → 91 passed / 0 failed. G0 measured **51 passed / 40 failed**: the 40 failures are `apps/remote/e2e/bench.visual.spec.ts-snapshots/**-remote-linux.png` for screens needs-you (20), run (12), projects (8), last refreshed at `ddb8074` on aarch64, with selective failures that disprove host raster noise (recorded as OD1, `2026-11-08T02:01:27Z`, in `state.json`; `orchestrator_action: NOT performed`, no snapshot touched).

Refreshing those baselines is a Phase B action requiring an owner-named set under `DESIGN_SYSTEM_V2.md` §9 and is explicitly out of every packet's scope. G3.9 is therefore **blocked on OD1**, not failed and not a W3 defect. It was not run, and no snapshot was written.

## Consistency with implementer report and reviewer

- Measured worktree values match `report.md` exactly: 181 ui / 446 desktop / 221 remote, scope 0, snapshots 0, arch/policy 8-check and wire 8-check output.
- The reviewer returned **APPROVE** ([review.md](file:///C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W3/review.md) §9), and my independent re-measurement agrees with the numbers it relied on.

## What I did not verify

- G3.8 was not independently re-executed (no Playwright on this host; orchestrator result accepted as instructed).
- G3.9 cannot be verified at all until OD1 resolves the 40 stale remote baselines.
- Reviewer check R3.1 (`APP_LENGTH_BUDGET` equals the offence count measured at `$BASE`) is outside this verification assignment and was not re-derived.
- No visual/pixel observation was made on this host; pixel neutrality rests on G3.10 = 0 and the G3.8 snapshot-write count of 0.

## Reproduction

```bash
cd C:/Users/Dragonfly/Downloads/Warsha
git worktree add --detach C:/Users/Dragonfly/Downloads/warsha-wt/verify-w3 0f829731273d722ae21f25e26a54767bc852fe56
cd C:/Users/Dragonfly/Downloads/warsha-wt/verify-w3
pnpm install --frozen-lockfile
git diff --name-only 5abe5ef..HEAD | grep -vE '^packages/ui/(src/|\.storybook/|README\.md$)' | wc -l   # 0
pnpm --filter @warsha/ui typecheck && pnpm --filter @warsha/ui lint
pnpm --filter @warsha/ui test        # 181 passed
pnpm --filter @warsha/ui build-storybook
pnpm -r typecheck
pnpm --filter warsha-desktop test    # 446 passed
pnpm --filter warsha-remote test     # 221 passed
git status --porcelain -- '*-snapshots/*' | wc -l   # 0
node scripts/check-arch.mjs && node scripts/check-engineering-policy.mjs && node scripts/check-wire-contract.mjs
```
