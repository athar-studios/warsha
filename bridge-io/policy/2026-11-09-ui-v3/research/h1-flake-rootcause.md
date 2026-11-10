# h1-flake-rootcause — `flows.spec.ts › the mode group moves focus with the arrows and presses with Enter` dies with `browser closed`

READ-ONLY investigation, run `2026-11-09-ui-v3`, no code/snapshot/gate changes made. All findings below
come from the preserved artifacts in `$EV/gates/*.json`, the H1 worktree diff, the Playwright 1.49.1
sources in `node_modules`, and `PROGRESS.md`/`REPORT_TO_PLANNER.md` records.

---

## 1. Root cause, with the evidence that proves it

### 1.1 What the error actually is (error-context excerpts)

Every failure entry is identical in shape — one error, empty stack, no attachments, no stdout/stderr,
`retry: 0` (config has `retries: 0`):

```
H1.pw.json   | the mode group moves focus with the arrows and presses with Enter: 1440x900 en
             | status=failed  worker=1  duration=1375  start=2026-11-09T15:33:09.903Z (t+23.4s)
  "error": { "message": "Error: Target page, context or browser has been closed",
             "stack":    "Error: Target page, context or browser has been closed" }
  "attachments": []
H1b.pw.json  | ... 390x844 ar  worker=1 duration=1825 start=15:55:38.927Z (t+3.6s)   — same message
H1.flake-isolate-2.json | ... 390x844 en worker=0 duration=1378 start=15:53:01.134Z — same message
R0.final.json (BASE 4c65ead) | ... 390x844 en worker=0 duration=1155 start=11:40:29.021Z — same message
```

Gate verdicts: `H1.pw.pw-gate.log` = `unexpected=49 outside=1 / OUTSIDE desktop › flows.spec.ts › the
mode group ...` (H1b the same for 390x844 ar); `H1c.pw.pw-gate.log` = `unexpected=48 outside=0`.

In Playwright 1.49.1 this message is the **no-cause `TargetClosedError`** — `client/errors.js:35-38`:
`super(cause || 'Target page, context or browser has been closed')`. It is constructed with **no
cause** from exactly three situations:

- `client/page.js:142` — the page **Crash** event: `this.once(Events.Page.Crash, () => ... new TargetClosedError())` — a renderer/tab crash;
- `client/browserType.js:152` — the **browser pipe closed** (browser process gone): `connection.close(reason || closeError)` with an empty reason;
- `client/page.js:397` — close with an empty reason.

So the artifacts prove: **the browser/page target was destroyed mid-test (crash or process death), not
a failed wait, not a timeout (1375–1825 ms vs 15 s expect / 120 s test timeouts), not an assertion.**
They do **not** distinguish renderer-crash from browser-process-death — `trace: 'off'`, `video: 'off'`,
no screenshot-on-failure, `H1.pw.log` is 0 bytes, results carry `stdout: [], stderr: []`. Nothing on
disk names OOM vs crash vs disconnect (see §3).

### 1.2 It is NOT H1-induced — the identical failure exists on base and in the B4 era

A grep of **every** `*.json` under `$EV` finds this error in **exactly four files, four results, all of
them the mode-group case**:

| run | tree | when (UTC) | case | verdict |
|---|---|---|---|---|
| `R0.final.json` | **base 4c65ead** | 11:40:29 (t+8.0s) | 390x844 en | 883/1 — outside the named set at the time |
| `H1.pw.json` | H1 | 15:33:09 (t+23.4s) | 1440x900 en | outside=1 |
| `H1b.pw.json` | H1 | 15:55:38 (t+3.6s) | 390x844 ar | outside=1 |
| `H1.flake-isolate-2.json` | H1 (flows only) | 15:53:01 (t+8.8s) | 390x844 en | 29/1 |

Corroborating records:

- `PROGRESS.md:45-49` (R0 closed): "Attempt 1 gave 883/1 (`flows.spec.ts` mode-group 390x844 en,
  **'browser has been closed'**) … so it is the **documented concurrency flow-closure flake**."
- `PROGRESS.md:5326-5333` (B4, 2026-11-03): mode-group 390x844 en **and** 1440x900 ar failed with
  `Target page, context or browser has been closed` "(browser/page closure during parallel startup,
  12:14–12:18 UTC, **while lanes ran concurrent chromium**)"; serial re-runs 6/6 + 4/4 pass;
  disposition "concurrency startup flake — no product change made".
- `REPORT_TO_PLANNER.md:37`: "flows.spec.ts mode-group: rare `browser closed` flake under full-suite
  load (**base and packet scratch alike**)".
- `AUDIT.md:4`: "attempt 1 = 883/1 flake (… browser-closed, isolated 30/30 twice)".

So `state.json`/`checkpoints 048-049`'s note "base+U0/U2/V1 scratch all 884/0 => **likely
H1-induced**" is **contradicted by the preserved artifacts**: base's *first* frozen-gate attempt failed
the same way (the 884/0 was attempt 2, `R0b.final.json`).

**Tally of every full-suite run on disk** (`gates/all-json-modegroup.txt`): base distinct full runs
1/4 failed (G0 and R0.pre are the same 07:58 run under two names; R0.pre2 pass, R0.final **fail**,
R0b.final pass); F1.6 pass; U0/U2/V1 0/3; H1 2/3. Fisher exact two-tailed for 1/4 vs 2/3
**p ≈ 0.46 — the rate difference is small-sample noise**, not evidence of a packet effect.
Isolated flows runs: base 0/8 mode-group instances; H1 1/20 (isolate-2).

**Why H1 cannot be the mechanism (file:line, from `git diff 4c65ead..9d7d7c9`):**

1. **The new per-call recording is Node-side only.** `report.rpcCalls.push({ method, params })` sits
   inside the `page.route('**/rpc', ...)` handler (`apps/desktop/e2e/harness.ts:1942` handler opened,
   `:1965` push), fed from a plain `WeakMap<Page, ...>` on the Node side (`:1905`, wiring `:1933-1938`,
   read helper `:1911-1913`). There is **no `exposeFunction`, no `exposeBinding`, no `page.evaluate`
   per RPC** — the candidate "per-call page.evaluate overhead" does not exist. Grep of the harness
   finds **zero** `page.close()`, `context.close()`, `browser.close()`, `unroute` — no teardown/close
   path was added or exists.
2. **H1's changed stubs are not on this case's journey.** The case opens `simple` with scenario
   `default` (`fixtures: {}`, `apps/desktop/e2e/harness.ts:2136-2142`) and switches to AdvancedMode,
   whose data path is `runs.list, budget.show, agent.state, runs.events` + the `/events` socket
   (`apps/desktop/src/screens/AdvancedMode.tsx:23-24`) — none of which H1 touched. H1 changed only
   `postlaunch.crashes/reviews` → bare arrays, `backend.export`/`handoff.create`/`handoff.apply`/
   `files.read` shapes, and the `empty`/two named scenario fixtures. `apps/remote/e2e/harness.ts`
   (runs.subscribe) affects only the `remote` project.
3. **No slowdown was introduced.** Failing durations on H1 are indistinguishable from passing
   durations on every tree (§1.3) — a slower journey would show as longer durations or timeouts.

### 1.3 Where in the test it dies: the mode-switch tail (duration forensics)

Failing duration vs same-variant **passing** durations:

```
390x844 en:  R0.final FAIL 1155 | R0b PASS 1160 | U0 PASS 1256 | H1c PASS 1517
390x844 en:  isolate-2 FAIL 1378 | isolate-1 PASS 1387
1440x900 en: H1      FAIL 1375 | H1c PASS 1368 | H1b PASS 1422
390x844 ar:  H1b     FAIL 1825 | H1  PASS 1899 | isolate-1 PASS 1979
```

Every failure lands within ~0–75 ms of when a passing run *completes* — i.e. at the **very end of the
test**: flows.spec.ts:100 `press('Enter')` → `:101 expect(.bench-advanced toBeVisible)` →
`:103-106 expect.poll(readConfigWrites)` (`harness.ts:1853`, a `page.evaluate`). The page-open phase
(`openScreen`, `harness.ts:2038-2135`, ~2/3 of the duration) is never where it dies. If deaths were
uniform over the test body, most would strike during the open phase; 4/4 strike the tail.

### 1.4 Why THIS case, 6 of 6 times

All historic incidents (B4 ×2, R0.final, H1.pw, H1b, isolate-2) are this case. It is the **only test
in the suite that performs a live simple→advanced mode switch**: `SimpleMode` unmounts (its
`/events` subscription tears down, `SimpleMode.tsx:622`) while `AdvancedMode` mounts (fresh
`runs.events`/`agent.state` RPCs + a fresh `/events` socket, `AdvancedMode.tsx:783`) — every other
flows case mounts one bench once; the visual `advanced` cases mount it *fresh* via
`config: { app_mode: 'advanced' }`, never live. The switch is also the single heaviest lazy operation
in the run's first ~25 s (where all four mode-group instances sit, structurally — that is why all
failures are "early", not because t<25 s is intrinsically cursed). Two contributing facts, both
consistent with a **load-sensitive chromium death concentrated in the switch window**: full-suite runs
stress the host (2 CPU / 11 GB per `PROGRESS.md:5101`, `workers: 2` because CI is set —
`playwright.config.ts` `workers: process.env.CI ? 2 : 3`), and even the lone isolate failure ran
2 workers back-to-back (isolate-2 started 0.8 s after isolate-1 ended).

**Disproved misread — worker churn is NOT browser-death evidence.** Playwright 1.49.1 *retires the
worker after any failing test*: `playwright/lib/runner/dispatcher.js:103` —
`if (result.didFail) void worker.stop(true)`. This fully explains the one-test workers (all failing
`crash-reports`/`store-reviews` screenshot cases), the w1→w2 replacement after each mode-group
failure, and why clean runs (R0b/U0/U2/V1) have exactly 4 workers and 0 singletons. Do not read
worker replacement as "the browser died".

**Also addressed:**
- *Teardown/close race*: no close-path exists in harness or test (grep) — refuted.
- *Fixture change slowing the journey*: refuted (§1.2.3 — durations flat).
- *Per-RPC recording overhead*: refuted (§1.2.1 — Node-side push, no page round-trip).
- *Pure memory pressure on "the biggest page"*: incomplete — `crash-reports`/`store-reviews` carry
  larger DOMs and only ever fail on pixels, never crash; resource pressure is best read as the
  *sensitivity* factor, with the switch window as the *vulnerability*.

## 2. Minimal stabilisation proposal (weakens no test, no gate)

**Honest classification: neither test-side nor harness-side.** The test's waits are healthy (no
timeout ever; waits cannot defend against a dead target) and the harness has no overhead or close path
to remove. The mechanism is environmental — a chromium target death in the switch window under
parallel load — so the fix belongs in **how the suite runs** (config/process), in this order:

1. **Primary — warm the suite before parallelism (`playwright.config.ts` + one new global-setup
   file, e.g. `apps/e2e-support/global-setup.ts`).** Add `globalSetup` that (a) probes
   `http://localhost:5173` / `:5174` (both `webServer`s are up by then; probe, don't assume order),
   (b) launches **one** chromium and loads `/?screen=simple` and `/?screen=advanced` to full
   render **sequentially**, then closes it. This moves the cold Vite transform of *both* bench module
   graphs and the first-chromium launch off the parallel window, and pre-compiles the AdvancedMode
   graph so the live switch does no lazy compile. Tests, thresholds, named sets, retries (`0`) and
   gate semantics untouched.
2. **Process rule (zero code) — capture-host exclusivity during `.pw` runs**: no other lane runs
   Playwright/chromium-heavy work while a full-suite gate is running (extends the run's existing
   "capture serialized" intent; this is the disposition B4's own evidence pointed at — "while lanes
   ran concurrent chromium"). Record it where the fix packet is allowed to write process notes.
3. **Fallback if 1+2 still flake — run `.pw` gates with `--workers=1`** (the gate command lines in
   `HANDOVER.md` gates/steps). Same tests, same assertions, same named set; halves peak memory and
   eliminates parallel startup entirely (matches every serial result: B4 10/10, base 60/60 isolate).
   Cost ≈ 2× wall time (~16 min → ~32 min + Wave C growth) — the price to state openly.

**Explicitly NOT proposed:**
- `retries: 1` — Playwright would report the flake as `flaky` (stats.unexpected unchanged → pw-gate
  `outside=0`), i.e. it **masks the failure and softens the gate** → forbidden by the brief.
- Reverting the `rpcCalls` log — mechanism refuted (§1.2.1) and `H1.8` gate requires the export.
- Any edit to the case's assertions or to `named/H1.txt`.

**Optional targeted repro for the fix packet (instrumentation, not exploration):** fresh scratch
checkout (NEVER `/root/warsha-visual`), never `--update-snapshots`, one full-suite run (the failure
needs suite load), capturing chromium's own stderr for once:

```
DEBUG=pw:browser pnpm exec playwright test --project=desktop --project=remote \
  --reporter=json > "$EV/gates/<name>.json" 2> "$EV/gates/<name>.browser.log"
# after a failure: dmesg -T | grep -iE 'oom|killed process'   (WSL capture host, root)
```

`pw:browser` prints browser/renderer process lines (crash vs disconnect vs launch failure);
`dmesg` separates host OOM-kill from chromium-internal crash. That run finally names the
renderer-crash-vs-browser-death question §1.1 cannot.

## 3. Confidence and what stays unknown

- **High** — not H1-induced: identical failure on base (`R0.final.json`) and in the B4 era; the H1
  diff contains no close path and does not intersect the case's journey; rate difference not
  significant (p≈0.46). This overturns only the *state.json note*, not any gate or verdict (H1c's
  outside=0 stands on its own).
- **High** — the target was destroyed (crash/disconnect/close, no-cause class), at the mode-switch
  tail: 4/4 failing durations ≈ same-variant passing durations; error is a protocol-death, not a wait.
- **Medium** — load/contention sensitivity and the case's unique exposure (live switch): supported by
  B4's disposition, the full-vs-isolate rates, and 6/6 case-exclusivity, but not isolable to a single
  sub-mechanism from artifacts.
- **Unknown** — renderer crash vs browser-process death vs (less likely) a context close: all three
  serialize to this identical message; trace/video/browser-stderr were all off, so it is unrecoverable
  from the current evidence — only the instrumented repro in §2 can name it.
- **Unknown** — what else was on the capture host at 15:32 / 15:52 / 15:55 (no per-minute lane log);
  whether the H1-tree rate is genuinely higher at all (p≈0.46 says likely not).
- **Unknown** — host arch discrepancy in the docs (HANDOVER "Linux x86_64 capture host" vs
  `PROGRESS.md:5101` "Ubuntu aarch64, 2 CPU, 11 GB"); does not change the findings.

## 4. Blockers

- Exact-death naming (crash vs OOM vs disconnect) is blocked by missing instrumentation
  (`trace/video off`, no browser logs, 0-byte `H1.pw.log`) — unblockable only by the §2 repro.
- This packet made **no** edits outside this file (read-only scope): `PROGRESS.md`/`DECISIONS.md`
  board updates and the fix itself are for the follow-up packet.
- For the repro: WSL capture host (root), fresh scratch checkout only, never `/root/warsha-visual`
  (221 dirty files), never `--update-snapshots`.
