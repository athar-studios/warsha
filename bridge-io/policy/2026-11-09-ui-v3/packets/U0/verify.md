# Packet U0 Verification — run 2026-11-09-ui-v3

- Role: VERIFIER (independent of implementer and reviewer)
- Base: `4c65ead4f46cf97eecffd73149a57056e505568c` · reviewed HEAD: `bae6c0bbb056dccffc78f561b572bb21398a8db3`
- Worktrees: Windows `warsha-wt/v3/u0` (tracked tree clean; only untracked item `packages/ui/storybook-static/` — build output from U0.2, left uncommitted, excluded from the git-diff scope gates by design), capture scratch `/root/u0-scratch` (branch `scratch/u0-verify` at `4c65ead`, `merge --no-ff bae6c0b` → `1aeea250`, clean; never pushed, never on a run branch)
- Gates verbatim from `packets/U0/gates.md`; executed 2026-11-09 ~18:23–14:55Z (UTC record times in acceptance.json)
- `/root/warsha-visual` never checked out (still 221 dirty)

## Per-gate results

| id | verdict | exit | log |
| --- | --- | --- | --- |
| U0.1 `pnpm --filter @warsha/ui test` | **pass** | 0 | `gates/U0.1.log` |
| U0.2 `build-storybook` | **pass** | 0 | `gates/U0.2.log` |
| U0.3 `pnpm -r typecheck` + ui lint | **pass** | 0 | `gates/U0.3.log` |
| U0.4 `check-ds-v3.mjs` + `--self-test` | **pass** | 0 | `gates/U0.4.log` |
| U0.5 `contrast.mjs --check-css tokens.css` | **pass** | 0 | `gates/U0.5.log` |
| U0.6 19 primitives × (`.tsx`, `.test.tsx`, `.stories.tsx`) | **pass** | 0 | `gates/U0.6.log` |
| U0.7 icon exports count | **pass** | 0 (46 ≥ 44) | `gates/U0.7.log` |
| U0.8 `data-variant` + IBM Plex Sans Arabic | **pass** | 0 | `gates/U0.8.log` |
| U0.9 `package.json` exports `./v3` | **pass** | 0 | `gates/U0.9.log` |
| U0.10 v2 untouched under `packages/ui/src` | **pass** | 0 | `gates/U0.10.log` |
| U0.11 scope allowlist | **pass** | 0 | `gates/U0.11.log` |
| U0.deps no dependency added/bumped | **pass** | 1 (expected) | `gates/U0.deps.log` |
| U0.snap `pw-gate snapshots $BASE HEAD -` | **pass** | 0 | `gates/U0.snap.log` |
| U0.pw scratch-merge full suite (capture) | **pass** | 0 | `gates/U0.pw.pw-gate.log` (+ `U0.pw.json`, `U0.pw.log`) |

### Evidence detail (log bodies)

- **U0.1** — `Test Files 31 passed (31)`, `Tests 309 passed (309)`, `EXIT=0`; 309 ≥ `181 + 40 = 221`.
- **U0.2** — storybook built: `Preview built (13 s)`, output `packages/ui/storybook-static`, `EXIT=0`.
- **U0.3** — `TYPECHECK_EXIT=0`, `LINT_EXIT=0`, no `error TS`/lint problem lines.
- **U0.4** — `check-ds-v3: 0 violations in packages/ui/src/v3`; self-test `all checks passed cleanly` (5 rules), `GATE_EXIT=0`.
- **U0.5** — all pairs `ok`, `fails 0`, `GATE_EXIT=0`.
- **U0.6** — `triple ok` for all 19 listed components, `GATE_EXIT=0`.
- **U0.7** — `icon_exports=46` ≥ 44, `GATE_EXIT=0`.
- **U0.8** — `GREP1=0` (`data-variant`), `GREP2=0` (font family in tokens), `GATE_EXIT=0`.
- **U0.9** — `exports['./v3']` present, `GATE_EXIT=0`.
- **U0.10** — 81 changed files under `packages/ui/src`, all under `src/v3/`; outside list empty → `GATE_EXIT=0`.
- **U0.11** — full change set = `packages/ui/src/v3/**`, `packages/ui/package.json`, `packages/ui/README.md`, `scripts/check-ds-v3.mjs` (+ `pnpm-lock.yaml` untouched); outside allowlist empty → `GATE_EXIT=0`. (`THIRD_PARTY_NOTICES.md` not changed — no upstream material copied.)
- **U0.deps** — manifest diff = 2 added lines in `packages/ui/package.json` (the `./v3` export map, not a dependency); PIPESTATUS `1,1,1`, no added dep lines → pipeline exit **1** as required.
- **U0.snap** — `snapshot_changes=0 outside=0`, `GATE_EXIT=0`.
- **U0.pw** — scratch merge `1aeea250`, install OK, port guard free, `CI=true`, workers 2, no `--update-snapshots`, one invocation. **stats: 884 listed, expected 884, unexpected 0, flaky 0, skipped 0** (1662.1 s); **pw-gate vs `named/EMPTY.txt`: `unexpected=0 outside=0`, exit 0**. Scratch `*--snapshots*` status empty; scratch tree clean (0); Playwright process exit **0**.

## Classification

- Product failures: none — v2 suites and every behavioural spec 100% green on the merged tree.
- Environment/permission blockers: none.
- Harness quirks: none affecting verdicts — WSL exit markers read from script-written `.exit` files (never `$?` inside `-lc` strings); every verdict backed by a log body on disk.

## Uncovered scope

- No Rust gate and no `cargo test` in U0 (covered by G0/V1 gates).
- `storybook-static/` is build output only: not committed, not linted, not gated beyond U0.2's exit 0.
- Visual/behavioural coverage of the new v3 primitives outside the v2 e2e suite (no v3 specs exist yet) is deferred to the v3 packets (U3–U5) — U0 only proves they build, test, lint and are exportable.
- `THIRD_PARTY_NOTICES.md` unchanged: fonts are referenced by stack name only (OD-U2 = C, no font download).

## Blockers

None. All 14 gates **pass**.
