# F3 verification — run 2026-11-09-ui-v3 (verifier: independent Test engineer)

- EV: `C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3`
- Reviewer verdict: APPROVE (`packets/F3/review.md`)
- Packet head: `738aba6022c058e17eb81d7258977af653ab67a7` (`run/2026-11-09-ui-v3/f3-flake-warmup`, 2 commits / 2 files)
- **Integration tip at verify time: `7894d63c521d73d1e7d5c702200377d424f0031d`** (`chore(integration): C2 merge F4`)
- **Scratch-merge provenance (never merged into the f3 branch):**
  - Windows scratch worktree `C:/Users/Dragonfly/Downloads/warsha-wt/v3/f3-verify` created detached at `7894d63`,
    then `git merge --no-ff 738aba6 -m "scratch: F3 verify"` → scratch HEAD
    **`b70d772676885a53d269a100942ca951a72529ab`** (2 files, +63/−0); `pnpm install --frozen-lockfile` exit 0
    (`gates/F3.install.log`). Gates F3.1–F3.6 ran in this worktree with BASE=`7894d63`, HEAD=`b70d772`.
  - Capture-host scratch (F3.7.pw): fresh detached worktree `/root/warsha-f3v` in the WSL object store at the
    tip, scratch merge of `q/f3` there → scratch HEAD `1127257b144bb0be9193ff6cbde49805ed847d5a` (see
    `gates/F3.7.meta`). `/root/warsha-visual` was only fetched from (never checkout/reset/stash/clean).
- Gates run verbatim from `packets/F3/gates.md` (F3.4 as amended at planner capacity 2026-11-10T03:08Z —
  root `playwright.config.ts` + `apps/desktop/e2e/support/global-setup.ts`); raw output in `gates/<id>.log`.
- After this verification finished (F3.7.pw end 04:56:19Z), the orchestrator advanced
  `run/2026-11-09-ui-v3/integration` 7894d63 → `04ae669 chore(integration): C2 merge F3` at 04:57:05Z —
  not this verifier's action; all gates above were run against BASE `7894d63` as briefed.

## F4 dependency note (why a scratch merge)

F3.2 `pnpm --filter warsha-desktop lint` depends on packet F4's verified base-defect fix
(`29b0433`, import/order in `apps/desktop/src/harness.contract.test.ts`), which is in the integration tip
`7894d63` but NOT in the f3 branch (base `128b59c`). Per the orchestrator brief, F3 was therefore verified on a
**scratch merge of F3 onto `7894d63`** — the f3 branch itself was never merged into, and no run branch was moved.

## Per-gate table

| gate | check (abbrev.) | verdict | exit | log |
| --- | --- | --- | --- | --- |
| F3.1 | `pnpm -r typecheck` | **PASS** (7/8 workspace projects Done, incl. desktop `tsc --noEmit` + `tsconfig.e2e.json`) | 0 | `gates/F3.1.log` |
| F3.2 | `pnpm --filter warsha-desktop lint` | **PASS** (eslint clean on scratch merge incl. F4 fix) | 0 | `gates/F3.2.log` |
| F3.3 | `pnpm --filter warsha-desktop test` | **PASS** (`Test Files 79 passed (79)`, `Tests 590 passed (590)`), first attempt | 0 | `gates/F3.3.log` |
| F3.4 | diff names limited to root `playwright.config.ts` + `apps/desktop/e2e/support/global-setup.ts` (amended scope) | **PASS** (exactly those 2 files; no outside paths) | 0 | `gates/F3.4.log` |
| F3.5 | deps gate (standard regex) vs `$BASE..HEAD` | **PASS** (grep no-match = no dep added/bumped) | 1 | `gates/F3.5.log` |
| F3.6 | pw-gate.mjs snapshots `7894d63 b70d772 -` | **PASS** (`snapshot_changes=0 outside=0`) | 0 | `gates/F3.6.log` |
| F3.7.pw | scratch merge on the capture host; `CI=true playwright test --project=desktop --project=remote --reporter=json` → pw-gate failures vs `named/EMPTY.txt` | **PASS** (attempt 1: `playwright_exit=0`, **884 listed / 884 expected / 0 unexpected / 0 flaky / 0 skipped**, pw-gate `unexpected=0 outside=0` exit 0) | 0 | `gates/F3.7.pw-gate.log` (`gates/F3.7.json`, `gates/F3.7.meta`) |

**F3.7.pw details (attempt 1, no retry needed):** run 04:41:55Z → 04:56:19Z (~14.4 min) in `/root/warsha-f3v`
at scratch HEAD `1127257b144bb0be9193ff6cbde49805ed847d5a` (F3 `738aba6` merged onto tip `7894d63`);
`pnpm install --frozen-lockfile` exit 0; ports 5173/5174 free before the run (host exclusive — one Playwright,
Windows side held only by `wslrelay.exe` for this run's own dev servers); `retries` stayed 0 (no test/threshold/
named-set/gate change); no `--update-snapshots`; capture scratch tree `git status --porcelain` empty
(`dirty_snapshots=0`). `named/EMPTY.txt` = pixel-neutral packet (any failure would be a blocker — none occurred).

## acceptance.json note

Verdict fields only for `F3.1`–`F3.6` and `F3.7.pw` were set in `EV/acceptance.json`; `check`/`expect` and
every other packet's rows are untouched. `commit` on each row is the packet head `738aba6…` (the reviewed
commit under verification); the scratch-merge commits (`b70d772…` Windows, `1127257b…` capture) are recorded
in the `note` fields and in this file.

## Uncovered scope

- Windows gates ran on the **scratch merge**, not on the bare f3 head — required by the F4 lint dependency
  (recorded above); the f3 branch itself is unchanged (`738aba6`).
- No Rust/cargo gates in this packet (none frozen for F3); WSL capture host used only for F3.7.pw.
- F3.1/F3.2/F3.3 were not re-run on the bare `128b59c` base (out of scope; F3.2 would fail there by design —
  the F4 base defect).

## Blockers

- none
