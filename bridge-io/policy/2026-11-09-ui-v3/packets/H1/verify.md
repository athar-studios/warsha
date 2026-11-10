# Packet H1 Verification — run 2026-11-09-ui-v3

- Role: VERIFIER (independent of implementer and reviewer; reviewer's governing verdict after repair = APPROVE)
- Base: `4c65ead4f46cf97eecffd73149a57056e505568c` · reviewed HEAD: `9d7d7c911d49c7618348538c36e0af3f552a77e1`
- Worktrees: Windows `warsha-wt/v3/h1` (clean), capture scratch `/root/h1-scratch` (branch `scratch/h1-verify` at `4c65ead`, `merge --no-ff 9d7d7c9` → `8faa734`, clean; never pushed, never on a run branch)
- Gates verbatim from `packets/H1/gates.md`; executed 2026-11-09 ~15:26–15:55Z
- `/root/warsha-visual` never checked out (still 221 dirty)

## Per-gate results

| id | verdict | exit | log |
| --- | --- | --- | --- |
| H1.1 `check-wire-contract.mjs` | **pass** | 0 | `gates/H1.1.log` |
| H1.2 `check-wire-contract.mjs --self-test` | **pass** | 0 | `gates/H1.2.log` |
| H1.3 `pnpm --filter warsha-desktop test` | **pass** | 0 | `gates/H1.3.log` |
| H1.4 `pnpm --filter warsha-remote test` | **pass** | 0 | `gates/H1.4.log` |
| H1.5 `pnpm -r typecheck` + `check-arch.mjs` | **pass** | 0 | `gates/H1.5.log` |
| H1.6 no object-wrapped stub left in `harness.ts` | **pass** | 1 (expected) | `gates/H1.6.log` |
| H1.7 contract test covers the five RPCs | **pass** | 0 (count 8 ≥ 5) | `gates/H1.7.log` |
| H1.8 `export async function rpcCalls` | **pass** | 0 | `gates/H1.8.log` |
| H1.9 scope allowlist | **pass** | 0 | `gates/H1.9.log` |
| H1.deps no dependency added/bumped | **pass** | 1 (expected) | `gates/H1.deps.log` |
| H1.snap `pw-gate snapshots $BASE HEAD -` | **pass** | 0 | `gates/H1.snap.log` |
| H1.pw scratch-merge full suite vs `named/H1.txt` | **FAIL** | 1 | `gates/H1.pw.pw-gate.log` (+ `H1.pw.json`, `H1.pw.log`) |

### Evidence detail (log bodies)

- **H1.1** — `wire: 10 checks, 0 violations`, `GATE_EXIT=0`.
- **H1.2** — 34 self-test assertions detected, `wire self-test: 10 checks fire, clean fixture is clean in both modes`, `GATE_EXIT=0`.
- **H1.3** — `Test Files 51 passed (51)`, `Tests 474 passed (474)`, `EXIT=0`; 474 ≥ `468 + 6 = 474`.
- **H1.4** — `Test Files 16 passed (16)`, `Tests 221 passed (221)`, `EXIT=0`; 221 ≥ 221.
- **H1.5** — `TYPECHECK_EXIT=0`, `arch: 5 rules, 0 violations`, `ARCH_EXIT=0`.
- **H1.6** — grep for `crashes|reviews:` / `result: {path|summary:` in `apps/desktop/e2e/harness.ts` matches nothing (`GREP_EXIT=1`) → gate exit **1** as required.
- **H1.7** — `harness.contract.test.ts` present, `count=8 ≥ 5` → `GATE_EXIT=0`.
- **H1.8** — `harness.ts:1910 export async function rpcCalls(...)` → `GATE_EXIT=0`.
- **H1.9** — changed files = the four allow-listed (`apps/desktop/e2e/harness.ts`, `apps/desktop/src/harness.contract.test.ts`, `apps/remote/e2e/harness.ts`, `scripts/check-wire-contract.mjs`); outside empty → `GATE_EXIT=0`.
- **H1.deps** — manifest diff body empty, PIPESTATUS `1,1` → exit **1** as required.
- **H1.snap** — `snapshot_changes=0 outside=0`, `GATE_EXIT=0`.

## H1.pw (the failing gate)

- Scratch merge `8faa734`, install OK, port guard free, `CI=true`, workers 2, no `--update-snapshots`, single invocation, stderr log empty.
- **stats: 884 listed, expected 835, unexpected 49, flaky 0, skipped 0** (953.9 s). desktop 793 listed / 744 passed / 49 failed; remote 91/91/0.
- **pw-gate: exit 1 — `unexpected=49 outside=1`.**
- **Outside `named/H1.txt` (the defect):** `desktop › flows.spec.ts › the mode group moves focus with the arrows and presses with Enter: 1440x900 en`.
  - Error body from `H1.pw.json`: `Error: Target page, context or browser has been closed` — no assertion/layout/visual diff.
  - **Supplementary classification (not a gate):** a focused single-spec re-run of the same four variants in the same scratch tree passed 4/4 (`gates/H1.pw.flake-check.log`, exit 0), so this is a **teardown/browser-close flake, not a product assertion failure**. The recorded gate run still stands as FAIL — I did not re-run the gate, narrow it, or change any named set.
- **Inside `named/H1.txt` (48, allowed):** `crash-reports` screens.visual 12, `store-reviews` screens.visual 12, `store-reviews` dense states 12, `crash-reports` dense states 12 = 48 — exactly the baseline drift RH1 refreshes under the owner's word after C1. (`backend-kit` had no failures.)

## Classification

- Product failures: none identified — the one outside failure is a browser-close flake with no assertion, and it passes on focused re-run.
- Gate result nevertheless: **H1.pw FAIL (exit 1, outside=1)** per the frozen rule (verdict from the recorded run only).
- Environment/permission blockers: none.
- Harness quirks: flake documented above; WSL exit markers read from script-written `.exit` files.

## Uncovered scope

- The 48 in-named visual drifts are intentionally not refreshed (RH1, owner stop OD-U1).
- `backend-kit` named cases: none failed, so that subset is unexercised beyond zero failures.
- No Rust gate in H1 (covered by G0/V1); no v3 specs exist yet.

## Blockers / repair items for the orchestrator

1. **H1.pw FAIL** — one outside failure (`flows.spec.ts` mode-group focus, 1440x900 en) classified as a browser-close flake by focused re-run (4/4 pass). Decide: accept as flake-isolation evidence, or require a clean full-suite re-run before C1/RH1. Nothing was refreshed by me.
2. RH1 baseline refresh remains owner-stopped (OD-U1) and was not run.
