# E0 verification — run 2026-11-09-ui-v3 (independent verifier, read-only)

- EV: `C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3`
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/e0` (host windows; tree clean before and after the runs)
- BASE: `128b59c08cbf5ddbe4de002528a50f451ea74296`
- HEAD used: `bcb5c7a8290a2827cdc20e63832c4fb8960efc58` (actual worktree HEAD, matches `packets/E0/review.md`)
  - Discrepancy: the brief / `state.json` `head_commit` `bcb5c7ac5579f1ea8974a62193b2a26563339046` is **not a git object** in either
    the worktree or the main repo (`git cat-file -t` fails). Gates were run at the real reviewed commit above; the stale hash is
    recorded here as an observation, not a gate failure.
- Gates verbatim from `packets/E0/gates.md` (decoded byte-exact; direct file reads are hook-intercepted). Grep-style gates run from
  script files in `gates/e0-scripts/` (E0.2.sh, E0.4.sh, E0.deps.sh); raw stdout in `gates/E0.<id>.log`; exit markers in
  `gates/E0.<id>.exit`.
- Review prerequisite: `packets/E0/review.md` = **APPROVE** (independent reviewer, read).
- **No Playwright was started** — WSL capture host busy with another packet's full run; E0.3 / E0.pw deferred to the capture lane.

## Per-gate table

| gate | host | ran? | check (abbrev.) | verdict | exit | log |
| --- | --- | --- | --- | --- | --- | --- |
| E0.1 | any | **RAN** | `pnpm --filter warsha-desktop typecheck` | **PASS** (tsc --noEmit + tsconfig.e2e.json, no diagnostics) | 0 | `gates/E0.1.log` |
| E0.2 | any | **RAN** | `cat apps/desktop/e2e/v3/support/*.ts \| grep -cE "export (async )?function (openV3\|act\|expectRpc\|rpcCalls)\b"` | **PASS** (printed `4`) | 0 | `gates/E0.2.log` |
| E0.3 | capture | **DEFERRED** | playwright v3/smoke.spec.ts + pw-gate failures | not run (see Uncovered) | — | — |
| E0.4 | any | **RAN** | `test -z "$(git diff --name-only $BASE..HEAD \| grep -vE '^apps/desktop/e2e/v3/(support/\|smoke\.spec\.ts$)')"` | **PASS** (empty outside-set diff) | 0 | `gates/E0.4.log` |
| E0.deps | any | **RAN** | deps regex over `git diff $BASE..HEAD` manifests | **PASS** (exit 1 = no dependency added or bumped; log empty) | 1 | `gates/E0.deps.log` |
| E0.snap | any | **RAN** | `node "$EV/tools/pw-gate.mjs" snapshots $BASE HEAD -` (literal `HEAD`) | **PASS** (`snapshot_changes=0 outside=0`) | 0 | `gates/E0.snap.log` |
| E0.pw | capture | **DEFERRED** | full playwright desktop+remote + pw-gate failures | not run (see Uncovered) | — | — |

**5/5 run gates PASS; 2 capture gates DEFERRED.** No repair items from the run gates.

## Uncovered scope (deferred capture gates)

- **E0.3** — the v3 smoke spec has never executed under Playwright. `apps/desktop/e2e/v3/smoke.spec.ts` and `support/` are
  typecheck-verified and export-complete only; runtime behaviour (openV3 boot, `main[data-ready]` wait, 14 ar/en route tests) is
  unproven until the capture run.
- **E0.pw** — no full-suite evidence (v2 suites + behavioural specs 100% green, failures inside `named/EMPTY.txt`, packet merged on
  the integration tip in a scratch checkout) exists for E0.
- Both are recorded `verdict: not-run` in `acceptance.json` with a `DEFERRED to the capture lane` note; they must **not** be marked
  pass until the serialized WSL capture run executes them.
- Consequence: E0 cannot be treated as fully verified for the C2 merge decision on the strength of this verify — the capture gates
  remain open.

## Blockers

- None for the five Windows gates (all green first attempt; worktree stayed clean).
- Environment notes (non-blocking): (a) the brief/`state.json` HEAD hash `bcb5c7ac…9046` does not exist as an object — real HEAD
  `bcb5c7a8…efc58` used and recorded; (b) capture host busy — E0.3/E0.pw deferred by instruction, awaiting the serialized capture
  run; (c) `gates/E0.4.log` and `gates/E0.deps.log` are empty by design (negative gates; exit markers carry the verdict).

## Capture gates E0.3 + E0.pw — serialized WSL capture run (independent capture verifier, 2026-11-10)

All rows above stand; this section appends only the two deferred capture gates.

- **Host**: WSL Ubuntu root, free and exclusive (verified before start: no playwright/vite/pnpm processes, ports
  5173/5174 clear). `PATH=/root/.nvm/versions/node/v20.20.2/bin:…` exported first (node v20.20.2, pnpm 9.0.0,
  Playwright 1.49.1 from the frozen lockfile).
- **Launch mechanics**: plain `wsl.exe … &`/`setsid` detach is killed by the interop job object when `wsl.exe` exits
  (probe: `setsid sleep 45` gone within 2 s), so both gates ran as systemd transient units
  (`systemd-run --unit=e03gate|e0pwgate`, scripts `gates/e0-scripts/E0.3.sh`, `E0.pw.sh`) with self-written
  `.done`/`.exit` markers; no output piped through tail; no `--update-snapshots` anywhere. Git-Bash MSYS path
  conversion had to be disabled (`MSYS_NO_PATHCONV=1`) or `/mnt/c/...` arguments never reach WSL.
- **Refspec note**: the brief's abbreviated `+82430c9:refs/remotes/q/tip` is rejected by fetch ("couldn't find remote
  ref"); fetched by full 40-hex `82430c901375bb4986b5c6103ac5ef05e1925f21` (same precedent as `U1.pw.sh`); the e0
  branch by the instructed branch ref. Verified `tip=82430c9…`, `e0=bcb5c7a8…efc58`.
- **Scratch merge** (never into the E0 branch): fresh detached worktree `/root/warsha-e0v` at q/tip; `git merge --no-ff`
  of the E0 head → `merged_head=4e7b94b7d070bdea6d60a4f033ef9748ad24bdd5` (2 files, +259: `apps/desktop/e2e/v3/
  smoke.spec.ts`, `apps/desktop/e2e/v3/support/index.ts`); `pnpm install --frozen-lockfile` OK
  (`gates/E0.3.install.log`); port-guard free before each run. `/root/warsha-visual` never checked out/reset/stashed/
  cleaned — still `beae601 [dev]`, 221 dirty files before and after; only `git fetch` + `worktree add` were used.

### Results

| gate | run (UTC) | playwright exit | listed / expected | unexpected | pw-gate (vs named/EMPTY.txt) | pw-gate exit | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E0.3 | 07:35:21→07:35:35Z | 1 | **0** (of 14 expected: 7 routes × ar/en) | 0 | `unexpected=0 outside=0` — **VACUOUS** (suites=0) | 0 | **FAIL** |
| E0.pw | 07:55:54→07:56:03Z | 1 | **0** (v2 ≈884 + 14 smoke never loaded) | 0 | `unexpected=0 outside=0` — **VACUOUS** (suites=0) | 0 | **FAIL** |

- **Root cause (identical, deterministic in both runs)**: collection dies with
  `SyntaxError: Named export 'useT' not found. The requested module '@warsha/i18n/v3' is a CommonJS module, …`
  raised while loading `apps/desktop/e2e/v3/smoke.spec.ts` (import chain `../../src/v3/router/routes` → page
  components → `@warsha/i18n/v3`). E0.3 then adds `Error: No tests found.`; E0.pw's whole collection aborts
  (`suites=0`, `errors=1`), so **the v2 suites did not run either** — this run gives no evidence for or against
  their state. The chain is E0-only: no other e2e file imports app source (the one `@warsha/client` e2e import is
  type-only).
- **Why the gate is fail despite pw-gate exit 0**: pw-gate judges only cases present in the JSON; with `suites=[]`
  it printed `unexpected=0 outside=0` vacuously (0 of the expected 14 / 0 of ≈898 listed). The gates' expects
  (14 smoke tests booting; full-suite green) are not met → `verdict: fail` for both.
- **Second unchanged attempt**: not used — both runs produced the same module-load SyntaxError, i.e. a
  deterministic defect, not a load-sensitive flake (the one permitted retry would not change anything).
- **acceptance.json**: E0.3 and E0.pw recorded `verdict=fail`, `exit_code=1`, `commit=bcb5c7a8290a2827cdc20e63832c4fb8960efc58`
  (the E0 head), `timestamp` = each run's end UTC, `log=gates/E0.3.pw-gate.log` / `gates/E0.pw.pw-gate.log`
  (verdict fields only; on arrival both entries already read `fail`/`1` with a `CORRECTED … Repair dispatched` note
  and null commit/log — this run filled commit/timestamp/log, note left untouched).
- **Artifacts**: `gates/E0.3.{meta,done,exit,json,err,pw-gate.log,install.log,dirty,script.err}`,
  `gates/E0.pw.{meta,done,exit,json,err,pw-gate.log,dirty,script.err}`, scripts `gates/e0-scripts/E0.3.sh`,
  `gates/e0-scripts/E0.pw.sh`. Both worktrees left in place (`/root/warsha-e0v` at `4e7b94b`); tree clean after
  both runs (`.dirty` empty); units inactive and ports free afterwards.

## Blockers (capture run)

- **E0.3 and E0.pw both FAIL**: the packet's smoke spec does not execute under the frozen command, and its load
  error aborts the full-suite run too. E0 is not verified for C2 on these gates; repair belongs to the implementer
  (ENGINEERING_POLICY Phase 6) — this verifier changed no code.
