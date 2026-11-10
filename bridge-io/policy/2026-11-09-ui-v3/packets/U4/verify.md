# U4 verification (Advanced Workbench) — run 2026-11-09-ui-v3

- Verifier: Windows gates only (WSL capture host NOT touched).
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/u4` (clean before run).
- BASE = `6025715d881f80454286e35ed803d08f801a8c6c`, HEAD = `4300d93f5dff2ea791b2056a7451cddf2c878e9a` (commit `4300d93`).
- All gate commands run verbatim from `packets/U4/gates.md`; raw output in `EV/gates/U4.<id>.log`.
- Recorded: 2026-11-10T12:25:04Z.

| gate | verdict | exit | log | notes |
| --- | --- | --- | --- | --- |
| U4.1 | pass | 0 | `gates/U4.1.log` | `pnpm --filter warsha-desktop test`: **Tests 625 passed (625)**, 80 test files — >= 620 (and >= base 468 + 30) |
| U4.2 | pass | 0 | `gates/U4.2.log` | `pnpm -r typecheck` OK; `pnpm --filter warsha-desktop lint` OK; `check-ds-v3: 0 violations in apps/desktop/src/v3` |
| U4.3 | pass | 0 | `gates/U4.3.log` | `i18n-v3: 221 keys, 0 violations` |
| U4.4 | pass | 0 | `gates/U4.4.log` | `actions: 31 registered, 31 used, 0 violations` |
| U4.5 | pass | 0 | `gates/U4.5.log` | bench area files exist: `pages/bench/`, `actions/registry/bench.ts`, `i18n/src/v3/{ar,en}/bench.ts`, `e2e/v3/bench.spec.ts` |
| U4.7 | pass | 0 | `gates/U4.7.log` | diff BASE..HEAD (25 files) entirely inside the allowed bench paths |
| U4.deps | pass | 1 | `gates/U4.deps.log` | expected exit 1 — no dependency added or bumped (manifest diff empty) |
| U4.snap | pass | 0 | `gates/U4.snap.log` | `snapshot_changes=0 outside=0` |

## Deferred (not run)

**U4.6 and U4.pw (capture lane) are DEFERRED to the capture lane — NOT RUN in this verification.** They require the Playwright capture host (`host=capture`); this verifier ran Windows gates only and did not touch the WSL capture host, which is owned by another verifier. Both remain `verdict=not-run` in `acceptance.json`.
