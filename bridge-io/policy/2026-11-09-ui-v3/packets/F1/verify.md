# Packet F1 Verification — run 2026-11-09-ui-v3

- Role: VERIFIER (independent of implementer and reviewer)
- Base: `ba90e713b2731870a7df3c1791bcbfe98e330717` · reviewed HEAD: `fbc6351478fd5e97d07883d5b0df89aeeec6f9cb`
- Packet worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/f1` (clean at HEAD before and after the run; no product file edited)
- Gates executed verbatim from `packets/F1/gates.md`; `EV = bridge-io/policy/2026-11-09-ui-v3`
- Executed: 2026-11-09 (UTC), windows gates 10:44–11:06Z, capture run 10:47–11:04Z

## Per-gate results

| id | verdict | exit | command (host) | log |
| --- | --- | --- | --- | --- |
| F1.1 | **pass** | 0 | `pnpm --filter warsha-desktop test` (any) | `gates/F1.1.log` |
| F1.2 | **pass** | 0 | `pnpm -r typecheck && pnpm --filter warsha-desktop lint` (any) | `gates/F1.2.log` |
| F1.3 | **pass** | 0 | `test -z "$(git diff --name-only $BASE..HEAD \| grep -vE '^(apps/desktop/src/index\.css\|apps/desktop/src/screens/ProvidersSettings\.tsx)$')"` (any) | `gates/F1.3.log` |
| F1.4 | **pass** | 1 (expected) | manifest diff pipeline: added-dep grep, version keys excluded (any) | `gates/F1.4.log` |
| F1.5 | **pass** | 0 | `node tools/pw-gate.mjs snapshots $BASE HEAD -` (any) | `gates/F1.5.log` |
| F1.6 | **pass** | 0 (pw-gate) | scratch merge + `playwright test --project=desktop --project=remote --reporter=json`, then `pw-gate failures … named/R0.txt` (capture) | `gates/F1.6.pw-gate.log` (+ `F1.6.json`, `F1.6.log`) |
| F1.7 | **pass** | 0 | `node tools/f17-check.mjs gates/F1.6.json` (any) | `gates/F1.7.log` |

### Gate evidence detail

- **F1.1** — `Test Files 50 passed (50)`, `Tests 468 passed (468)`, `EXIT=0`; 468 ≥ `base_counts.warsha-desktop = 468`.
- **F1.2** — `TYPECHECK_EXIT=0`, `LINT_EXIT=0`.
- **F1.3** — changed files vs base are exactly `apps/desktop/src/index.css` and `apps/desktop/src/screens/ProvidersSettings.tsx`; `F1_3_EXIT=0`.
- **F1.4** — the manifest diff body is empty (no `package.json`/`Cargo.toml` touched at all), pipeline exit **1** as the gate requires.
- **F1.5** — `snapshot_changes=0 outside=0`, exit 0.
- **F1.6** — scratch merge only: WSL `/root/warsha-visual` fetched (never checked out; still 221 dirty entries), fresh worktree `/root/warsha-f1-scratch` on new branch `scratch/f1-verify` at `ba90e71`, `merge --no-ff fbc6351` → `1ff806a` (2 files, +32/−13). That branch is local to the capture clone: never pushed, never on a run branch. `pnpm install --frozen-lockfile` exit 0; port guard clean before start; `CI=true`, `--workers=2`, one invocation, no `--update-snapshots`.
  - **stats**: 884 listed, **expected 826, unexpected 58, flaky 0, skipped 0**, duration 1013.1 s — identical shape to G0 (826/58), i.e. no new failures introduced by the packet.
  - **pw-gate**: exit **0**, `unexpected=58 outside=0` → every failure is inside `named/R0.txt` (the v0.2.1 onboarding/providers drift).
  - Playwright process exit was **1** (58 visual diffs), which is expected; the authority is the JSON stats + pw-gate log, per the brief.
  - snapshot writes: `git status --porcelain -- '*-snapshots*'` in the scratch tree = **empty**; whole scratch tree clean (0 entries).
- **F1.7** — `f17: cases=4 defect-errors=0`, exit 0: the two fixed renders (`providers 390x844` ar/en × light/dark) show only screenshot-pixel drift, no layout/font-audit defect errors.

## Classification of findings

- No product failures.
- No environment blocker: native Windows tests and the WSL capture run both completed (no `0xC0000142`, no port conflict, capture stderr log empty).
- **Harness quirk (disclosed, no gate affected):** my first F1.6 pw-gate invocation passed `"$EV/…"` paths inside a single WSL `-lc` string; the shell-variable expansion was mangled, so that attempt never ran (`No such file or directory`) and wrote no log. I re-ran it from a script file with literal paths; `gates/F1.6.pw-gate.log` and its recorded exit code come from that authoritative run. No gate, named set, snapshot or state file was edited.
- One rejected-write attempt on `acceptance.json` was not made; all seven verdict writes succeeded in a single call (check/expect fields untouched).

## Uncovered scope

- Pixel-level baseline refresh (R0) — out of verifier scope, not run; the 58 drift cases remain expected failures until the owner's OD-U1 refresh.
- No v3 (`?ui=v3`) code exists at this commit, so v3 suites are not part of F1.6.
- Non-screenshot visual quality (colour, spacing) beyond the f17 defect predicates is not assessed by these gates.
- `F1.6` tested a scratch merge commit (`1ff806a`) in the capture clone; acceptance entries record the reviewed commit `fbc6351`, which is the packet's head.

## Blockers

None. All seven gates **pass**.
