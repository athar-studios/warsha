# Packet U2 Verification — run 2026-11-09-ui-v3

- Role: VERIFIER (independent of implementer and reviewer)
- Base: `4c65ead4f46cf97eecffd73149a57056e505568c` · reviewed HEAD: `fc8f06656a1b665913b0aeeecb19cb8278775bb6`
- Worktrees: Windows `warsha-wt/v3/u2` (clean), capture scratch `/root/u2-scratch` (branch `scratch/u2-verify` at `4c65ead`, `merge --no-ff fc8f066` → `4677e5c`, clean; never pushed, never on a run branch)
- Gates verbatim from `packets/U2/gates.md`; executed 2026-11-09 ~15:00–15:23Z
- `/root/warsha-visual` never checked out (still 221 dirty)

## Per-gate results

| id | verdict | exit | log |
| --- | --- | --- | --- |
| U2.1 `pnpm --filter warsha-desktop test` | **pass** | 0 | `gates/U2.1.log` |
| U2.2 `pnpm -r typecheck` + desktop lint | **pass** | 0 | `gates/U2.2.log` |
| U2.3 `i18n-gate.mjs .` | **pass** | 0 | `gates/U2.3.log` |
| U2.4 `actions-gate.mjs .` | **pass** | 0 | `gates/U2.4.log` |
| U2.5 8 frames × registry/ar/en/pages | **pass** | 0 | `gates/U2.5.log` |
| U2.6 14 daemon stages in `copy/stages.ts` | **pass** | 0 | `gates/U2.6.log` |
| U2.7 20 data hooks + tests | **pass** | 0 | `gates/U2.7.log` |
| U2.8 `reconnect|resync` in useRunEvents tests | **pass** | 0 | `gates/U2.8.log` |
| U2.9 `?ui=v3` flag; no v2 imports in v3 | **pass** | 0 | `gates/U2.9.log` |
| U2.10 scope allowlist | **pass** | 0 | `gates/U2.10.log` |
| U2.11 `app/startup.ts` + ≥3 tests | **pass** | 0 (count 4) | `gates/U2.11.log` |
| U2.deps no dependency added/bumped | **pass** | 1 (expected) | `gates/U2.deps.log` |
| U2.snap `pw-gate snapshots $BASE HEAD -` | **pass** | 0 | `gates/U2.snap.log` |
| U2.pw scratch-merge full suite (capture) | **pass** | 0 | `gates/U2.pw.pw-gate.log` (+ `U2.pw.json`, `U2.pw.log`) |

### Evidence detail (log bodies)

- **U2.1** — `Test Files 78 passed (78)`, `Tests 584 passed (584)`, `EXIT=0`; 584 ≥ `468 + 25 = 493`.
- **U2.2** — `TYPECHECK_EXIT=0`, `LINT_EXIT=0`, no `error TS`/lint problem lines.
- **U2.3** — `i18n-v3: 55 keys, 0 violations`, `GATE_EXIT=0`.
- **U2.4** — `actions: 0 registered, 0 used, 0 violations`, `GATE_EXIT=0`. **Read literally:** U2 ships `.ts` infrastructure only, so the gate scanned zero `v3/**/*.tsx` files — a vacuous pass by the frozen rule (exit 0), not proof that actions are wired; the interactive `.tsx` pages and their `data-action` wiring belong to U3/U4 and will be judged by A1–A7 there.
- **U2.5** — `quadruple ok` for frame, onboarding, home, projects, project, inbox, bench, settings → `GATE_EXIT=0`.
- **U2.6** — all 14 stages mapped → `ALL_14_MAPPED GATE_EXIT=0`.
- **U2.7** — 20 hooks each with `hook+test ok` → `GATE_EXIT=0`.
- **U2.8** — match: `apps/desktop/src/v3/data/useRunEvents.test.ts` (reconnect/resync) → `GATE_EXIT=0`.
- **U2.9** — flag lines in `main.tsx` (:24, :28, :36, :43); v2-import grep inside `src/v3` finds nothing (`GREP2=1`) → `GATE_EXIT=0`.
- **U2.10** — change set limited to `apps/desktop/src/v3/**`, `apps/desktop/src/main.tsx`, `packages/i18n/src/v3/**`, `packages/i18n/package.json`; outside list empty → `GATE_EXIT=0`.
- **U2.11** — `startup.ts` present; `count=4 ≥ 3` → `GATE_EXIT=0`.
- **U2.deps** — manifest diff = +10 lines in `packages/i18n/package.json` (the `./v3` export map); no added dependency lines, PIPESTATUS `1,1` → exit **1** as required.
- **U2.snap** — `snapshot_changes=0 outside=0`, `GATE_EXIT=0`.
- **U2.pw** — scratch merge `4677e5c`, install OK, port guard free, `CI=true`, workers 2, no `--update-snapshots`, one invocation. **stats: 884 listed, expected 884, unexpected 0, flaky 0, skipped 0** (1068.1 s); **pw-gate vs `named/EMPTY.txt`: `unexpected=0 outside=0`, exit 0**. Scratch `*--snapshots*` status empty; scratch tree clean (0); Playwright process exit **0** — v2 still the default and unchanged.

## Classification

- Product failures: none.
- Environment/permission blockers: none.
- Harness quirks: none affecting verdicts — WSL exit markers read from script-written `.exit` files; every verdict backed by a log body on disk.

## Uncovered scope

- U2.4 is vacuous at this commit (no `v3/*.tsx` yet) — the real actions-gate proof is deferred to the UI packets (U3/U4) by design.
- No Rust gate in U2 (covered by G0/V1); no v3 e2e specs exist yet (v3 behaviour covered from U3 on).
- Runtime daemon behaviour (reconnect/resync against a live daemon) is proven only at unit level here.

## Blockers

None. All 14 gates **pass**.
