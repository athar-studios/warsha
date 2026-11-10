# Packet U1 Verification — run 2026-11-09-ui-v3 (light-gate split)

- Role: VERIFIER (independent of implementer Coder and reviewer debugger; review-repair verdict APPROVE read).
- Base: `128b59c08cbf5ddbe4de002528a50f451ea74296` · reviewed HEAD: `1762caa972f1bca55721dc17ed8794125db61bc2`.
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/u1` — tracked tree clean before and after the runs; only pre-existing untracked `packages/ui/storybook-static/` (build output, excluded from git-diff scope gates by design).
- Host: Windows native (Git Bash). Scripts: `gates/u1-scripts/U1.{1,3,4,5,6,deps,snap}.sh` (frozen checks verbatim from `packets/U1/gates.md`); raw output → `gates/U1.<id>.log`.
- Executed 2026-11-10 05:25:07Z–05:27:17Z (UTC timestamps in `acceptance.json`). The WSL capture host and CPU were busy with another packet's full Playwright run — only the LIGHT gates were run by this verifier; the two expensive gates are recorded as DEFERRED below (explicit split per brief).

## Per-gate results

| id | verdict | ran / DEFERRED | exit | log |
| --- | --- | --- | --- | --- |
| U1.1 `pnpm --filter @warsha/ui test` | **pass** | RAN | 0 | `gates/U1.1.log` |
| U1.2 `build-storybook && pnpm -r typecheck && ui lint` | not-run | **DEFERRED** (build-storybook part heavy; typecheck+lint parts covered by other verifies — see note) | — | — (pre-existing `gates/U1.2.log` is the implementer's own measurement, not verifier evidence) |
| U1.3 `node scripts/check-ds-v3.mjs packages/ui/src/v3` | **pass** | RAN | 0 | `gates/U1.3.log` |
| U1.4 27 composites × (.tsx, .test.tsx, .stories.tsx) | **pass** | RAN | 0 | `gates/U1.4.log` |
| U1.5 forbidden-string grep in `ModelPicker.tsx` | **pass** | RAN | 1 (expected: absent) | `gates/U1.5.log` |
| U1.6 scope allowlist `git diff $BASE..HEAD` | **pass** | RAN | 0 | `gates/U1.6.log` |
| U1.deps dependency ratchet | **pass** | RAN | 1 (expected: no dep added/bumped) | `gates/U1.deps.log` |
| U1.snap `pw-gate.mjs snapshots $BASE HEAD -` | **pass** | RAN | 0 | `gates/U1.snap.log` |
| U1.pw full Playwright (capture lane) | pass (recorded by CAPTURE lane, not this verifier) | **DEFERRED from this verifier's run** — completed concurrently by the capture lane; see note | 0 | `gates/U1.pw.pw-gate.log` (+ `U1.pw.json`, `U1.pw.meta`, `U1.pw.exit`, `U1.pw.done`) |

**Split explicitly recorded:** this verifier ran 7 light gates (U1.1, U1.3, U1.4, U1.5, U1.6, U1.deps, U1.snap), all pass. DEFERRED from this verifier: U1.2's `build-storybook` part and U1.pw (capture lane). Neither deferred gate is marked pass *by this verifier* — U1.2 stays `not-run` in `acceptance.json`; U1.pw carries a capture-lane attribution note.

### Evidence detail (log bodies)

- **U1.1** — `Test Files 58 passed (58)`, `Tests 373 passed (373)`, duration 48.06s, `EXIT=0`. 373 ≥ `base_counts.@warsha/ui (181) + 30 = 211`; matches the expected ~373/58.
- **U1.3** — `check-ds-v3: 0 violations in packages/ui/src/v3`, `EXIT=0`.
- **U1.4** — frozen 27-name loop exited 0; `components=27 test_files=27 story_files=27` (81 triad files) — the 27-count confirmed.
- **U1.5** — `matches=0`, `EXIT=1` as required (no `DeepSeek|GPT-4o|Claude 3.5|fleet-worktrees|autonomous-factory` in `ModelPicker.tsx`).
- **U1.6** — `outside_scope_files=0`, `EXIT=0`. `git diff --name-only 128b59c..1762caa` = 83 files, all inside `packages/ui/src/v3/composites/**` (82) + `packages/ui/src/v3/index.ts`; `packages/ui/README.md` allowed but unchanged.
- **U1.deps** — `added_dep_lines=0`, pipeline produced no output, `EXIT=1` as required (manifest diff empty).
- **U1.snap** — `snapshot_changes=0 outside=0`, `EXIT=0`.
- **U1.pw (capture lane, not run by me)** — scratch merge `cd1a129` over integration tip `04ae669` with `u1=1762caa`; `install_ok`, `ports_free`, scratch dirty=0, no `--update-snapshots` in the meta; `playwright_exit=0`; stats **884 expected / 0 unexpected / 0 flaky / 0 skipped** (~1005s); `pw-gate failures … named/EMPTY.txt` → `unexpected=0 outside=0`, exit 0. Recorded in `acceptance.json` by the capture lane at `2026-11-10T05:20:00Z`.
- **U1.2** — not run by this verifier. Per brief, its `pnpm -r typecheck` + `@warsha/ui lint` parts are already covered by other packet verifies (`U0.3` = `pnpm -r typecheck && pnpm --filter @warsha/ui lint` pass; `F3.1`/`F2.3`/`U2.2` typecheck pass; reviewer warm measurement `pnpm -r typecheck` exit 0 at this head in `review-repair.md`). The `build-storybook` part defers to a later quiet window.

## Uncovered

- **U1.2 `build-storybook`** — not executed anywhere by a verifier (the `gates/U1.2.log` on disk predates this verification and is the implementer's own run; not acceptance evidence). Storybook may still fail to build against the repaired composites (F1 barrel export / F2–F4 edits) until this gate runs.
- No Rust gate and no `cargo test` in U1 (covered by other packets).
- Visual/behavioural judgement of the 27 composites beyond unit tests, DS lint and the v2 e2e suite — no v3-specific behavioural specs yet (U3–U5 scope).
- Snapshot rendering of the new composites is covered only indirectly (U1.snap = no snapshot file changed; U1.pw = v2 suite green on the merged tree).

## Blockers

None. 7/7 light gates run by this verifier **pass** (two with expected exit 1). Deferred: U1.2 build-storybook, U1.pw (capture lane — completed concurrently by that lane with green evidence, attributed in `acceptance.json`, not claimed by this verifier).

## Concurrency note

The capture lane wrote the U1.pw `pass` entry into `acceptance.json` while this verifier's light gates were running; this verifier re-read and preserved it, replacing only the note with an accurate capture-lane attribution. No gate verdict, log, test, snapshot, `state.json`, `PLAN.md`, `PROGRESS.md` or `DECISIONS.md` was edited; nothing was committed.
