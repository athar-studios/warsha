# U5 verification (Settings, 12 sections) — run 2026-11-09-ui-v3 (post-repair capture gates)

- Verifier: independent CAPTURE-gate verifier (U5.6 + U5.pw only), read-only.
- EV: `C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3`
- Reviewed commit under verification: **`7d4ceb9d589c23a139117ad98a977ff3a073ad9a`** (U5 repair head; the packet
  gates at `ad58a66` were already judged fail and repaired per `packets/U5/report.md`).
- Integration tip (brief): `6025715d881f80454286e35ed803d08f801a8c6c`.
- Scratch merge (never pushed, no run branch moved): fetch of both refs into `/root/warsha-visual`'s object store
  (fetch-only; its 221-dirty tree never checked out/reset), fresh detached worktree **`/root/warsha-u5v2`**,
  `git merge --no-ff 7d4ceb9` onto `6025715` → scratch HEAD **`d6d77c8ec45b32ba849418ad4dc5626090d4ed9b`**
  (parents verified `head^1=6025715`, `head^2=7d4ceb9`), `pnpm install --frozen-lockfile` exit 0.
- Capture host: WSL Ubuntu root; one Playwright lane — `pgrep -fc playwright` = 0 before start (host free),
  ports 5173/5174 free pre-run (port guard in each script); `CI=true`; never `--update-snapshots`;
  detached runs with self-written `.done`/`.exit` markers, no piped tails.
- Scripts: `gates/u5-scripts/U5.6b.sh`, `gates/u5-scripts/U5.pwb.sh` (fresh files; the pre-repair
  `U5.6.sh`/`U5.pw.sh` untouched). Frozen gate text: `packets/U5/gates.md`.

## Gate U5.6 (post-repair run "U5.6b") — PASS

- Command (verbatim): `CI=true pnpm exec playwright test --project=desktop v3/settings.spec.ts --grep-invert @visual --reporter=json > "$EV/gates/U5.6b.json"` then
  `node "$EV/tools/pw-gate.mjs" failures "$EV/gates/U5.6b.json" "$EV/named/EMPTY.txt"` and
  `node "$EV/tools/pw-gate.mjs" counts "$EV/gates/U5.6b.json" 60 9999`.
- Result: **`playwright_exit=0`, `pwgate_exit=0`, `counts_exit=0`** — pw-gate vs `named/EMPTY.txt`:
  **`unexpected=0 outside=0`** (exit 0, non-empty JSON); stats **`expected=71 skipped=0 unexpected=0 flaky=0`**
  (**71 ≥ 60**; composition exactly 13 journeys + 54 action cases + 4 `@a11y`, all `expected`).
  A 0-spec/error JSON would have failed both the counts gate and readability — not the case (81,077-byte report).
- Window: start `2026-11-10T16:29:57Z` → end `2026-11-10T16:31:29Z` (test duration 84.2 s).
- Logs: `gates/U5.6b.json`, `gates/U5.6b.pw-gate.log`, `gates/U5.6b.counts.log`, `gates/U5.6b.meta`,
  `gates/U5.6b.exit` (0), `gates/U5.6b.done`, `gates/U5.6b.err` (0 bytes), `gates/U5.6b.script.err` (0 bytes),
  `gates/U5.6b.install.log`, `gates/U5.6b.dirty` (empty — scratch tree clean after run).

## Gate U5.pw (post-repair run "U5.pwb") — PASS (genesis-visual carve-out; count = 120)

- Command (verbatim): `CI=true pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/U5.pwb.json"` then
  `node "$EV/tools/pw-gate.mjs" failures "$EV/gates/U5.pwb.json" "$EV/named/EMPTY.txt"` (→ `gates/U5.pwb.pw-gate.log`),
  `node "$EV/tools/pw-gate.mjs" failures "$EV/gates/U5.pwb.json" "$EV/named/U5.txt"` (→ `gates/U5.pwb.pw-gate-u5.log`, the frozen gate)
  and `node "$EV/tools/pw-gate.mjs" counts "$EV/gates/U5.pwb.json" 800 9999` (→ `gates/U5.pwb.counts.log`).
- Result: **`playwright_exit=1`, `pwgate_u5_exit=0` (frozen gate), `counts_exit=0`** — stats
  **`expected=969 skipped=0 unexpected=120 flaky=0`** (**969 ≥ 800**), 1,089 cases listed.
  - pw-gate vs **`named/U5.txt`**: `unexpected=120 outside=0`, **exit 0** — every failure inside the frozen named set.
  - pw-gate vs **`named/EMPTY.txt`**: `unexpected=120 outside=120`, exit 1 — **all 120 outside cases are `@visual`
    settings baselines and every one is inside `named/U5.txt`** → **genesis-expected, NOT a defect; count = 120**.
  - Failure class verified in the JSON: error text is `A snapshot doesn't exist at …/settings.spec.ts-snapshots/…, writing actual`
    (missing baseline, not a pixel mismatch); **non-visual failures = 0** (v2 suites + every behavioural spec 100% green;
    non-visual settings journeys/actions/a11y all `expected`). All 120 belong to `settings.spec.ts`; no other spec failed.
  - Genesis context: U5's `@visual` cases have **zero committed baselines** (packet gate `U5.snap` = `snapshot_changes=0`);
    the 120 PNGs Playwright wrote are **untracked files inside the disposable scratch worktree** (`/root/warsha-u5v2`,
    `git status` shows only `?? …/settings.spec.ts-snapshots/`) — never committed, no run branch touched,
    no `--update-snapshots` passed (Playwright's own "writing actual" on first sight of a missing baseline; the frozen
    `named/U5.txt` regex `^desktop › (settings)\.spec\.ts › .*@visual` covers exactly these).
- Window: start `2026-11-10T16:37:41Z` → end `2026-11-10T17:01:30Z` (~23.8 min, duration 1,426.9 s).
- Flakes: none — attempt 1 judged as-is; the permitted second unchanged attempt was **not needed**.
- Logs: `gates/U5.pwb.json` (1.8 MB), `gates/U5.pwb.pw-gate.log`, `gates/U5.pwb.pw-gate-u5.log`,
  `gates/U5.pwb.counts.log`, `gates/U5.pwb.meta`, `gates/U5.pwb.exit` (1 — Playwright's own exit from the
  genesis visual failures), `gates/U5.pwb.done`, `gates/U5.pwb.err` (0 bytes), `gates/U5.pwb.script.err` (0 bytes),
  `gates/U5.pwb.dirty` (only the untracked snapshots dir), breakdown `gates/u5-scripts/U5.pwb-evidence.txt`.

## Verdicts (recorded in acceptance.json, 2026-11-10 UTC)

| gate | verdict | exit | commit | timestamp (UTC) | log |
| --- | --- | --- | --- | --- | --- |
| U5.6 | **pass** | 0 | `7d4ceb9d589c23a139117ad98a977ff3a073ad9a` | 2026-11-10T16:31:29Z | `gates/U5.6b.pw-gate.log` |
| U5.pw | **pass** | 0 | `7d4ceb9d589c23a139117ad98a977ff3a073ad9a` | 2026-11-10T17:01:30Z | `gates/U5.pwb.pw-gate-u5.log` |

- U5.6: `expected=71` (≥ 60) / `unexpected=0` / pw-gate vs EMPTY `unexpected=0 outside=0` exit 0.
- U5.pw: `expected=969` (≥ 800) / frozen pw-gate vs `named/U5.txt` `outside=0` exit 0 / non-visual failures 0;
  `named/EMPTY.txt` shows `outside=120`, **all genesis `@visual`** (see carve-out above).
- Scratch merge provenance (both gates): `/root/warsha-u5v2` HEAD `d6d77c8ec45b32ba849418ad4dc5626090d4ed9b`
  (`6025715` + `7d4ceb9 --no-ff`, parents verified in `U5.pwb.meta`); `/root/warsha-visual` fetch-only
  (221-dirty tree untouched); host free before start (`pgrep -fc playwright` = 0), ports 5173/5174 free pre-run,
  one Playwright lane throughout; `pnpm install --frozen-lockfile` exit 0.

## acceptance.json note

Verdict rows for `U5.6` and `U5.pw` only were updated by this verification (verdict, exit_code, full
`7d4ceb9…` commit, UTC timestamp, log path, evidence note); every other row and every `check`/`expect`
field is untouched (179 gates, JSON re-validated).

## Blockers

- none

