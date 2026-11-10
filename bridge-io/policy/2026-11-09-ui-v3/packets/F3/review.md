# Packet F3 review (micro-packet, flake warm-up)

Run: `2026-11-09-ui-v3` | Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/f3`
Base `128b59c08cbf5ddbe4de002528a50f451ea74296` → head `738aba6` (2 commits / 2 files)
Reviewer: independent, read-only (this file is the only write)

## VERDICT: APPROVE

(with one orchestrator-side finding on a stale frozen-gate path — see F-1; not an implementation defect)

## Delta (git diff 128b59c..738aba6)

- `apps/desktop/e2e/support/global-setup.ts` (new, +62): probes both dev-server ports, one chromium,
  sequential warm-up of simple then advanced, close in `finally`.
- `playwright.config.ts` (root, +1): `globalSetup: './apps/desktop/e2e/support/global-setup.ts'`.
- `git status --porcelain` empty (clean); `--stat`: `2 files changed, 63 insertions(+)`, 0 deletions.

## Per-point judgement

1. **Helper behaviour — PASS.**
   - Both ports probed until answered: `Promise.all([probeUrl('http://localhost:5173'), probeUrl('http://localhost:5174')])`,
     each `probeUrl` loops until `fetch` succeeds (`res.ok || res.status < 500`) or throws after
     `timeoutMs = 60_000` (250 ms interval) — probes both concurrently, assumes no order (matches
     research §2.1 "probe, don't assume order").
   - ONE chromium: single `chromium.launch()`, one context/page; both screens warmed on that page.
   - Sequential full render: `await openScreen(... screen: 'simple' ...)` then
     `await openScreen(... screen: 'advanced' ...)` — `openScreen` (apps/desktop/e2e/harness.ts:2038)
     waits for the `ready` selector before returning, so "full render" is enforced.
   - Ready selectors real: `.simple-mode` (SimpleMode.tsx), `.bench-advanced` (AdvancedMode.tsx),
     `[data-ready]` (v3/pages/frame/Frame.tsx:19).
   - Close: `try { … context.close() } finally { await browser.close() }` — browser always closed.
   - Robust timeouts: 60 s probe budget with explicit throw message; `openScreen` uses harness waits
     with configured/default timeouts.
   - TS strict: `tsconfig.json`/`apps/desktop/tsconfig.json` `strict: true`; options used
     (`screen/viewport/locale/theme/origin/ready`) all exist on `OpenScreenOptions` (harness.ts:823);
     no `any`; `_config: FullConfig` typed. File is covered by `tsconfig.e2e.json`
     (`files: ["e2e/harness.ts"]`, `include: ["e2e"]`) → desktop `typecheck` runs
     `tsc --noEmit && tsc --noEmit -p tsconfig.e2e.json`.

2. **Root config change — PASS.** Diff hunk is exactly one added line at
   `playwright.config.ts:125`: `globalSetup: './apps/desktop/e2e/support/global-setup.ts'`.
   `retries: 0` (line 130), `workers: CI?2:3` (129), `timeout: 120_000` (132), `expect.timeout`
   (137), `projects` (164) and per-project timeouts (181/189) all unchanged — the whole diff is
   +1/-0 on this file.

3. **Scope — PASS.** Exactly 2 files, both in the packet's allowed set; no test/assertion,
   `named/*.txt`, snapshot, gate, or dependency edits (63 insertions, 0 deletions, no lockfile change).

4. **Measurement** — `pnpm -r typecheck` run in the worktree: **exit 0** (all 7 workspace projects
   Done, including `apps/desktop` = `tsc --noEmit && tsc --noEmit -p tsconfig.e2e.json`, which covers
   the new `e2e/support/global-setup.ts`).

## Findings

- **F-1 (blocker for gate F3.4, orchestrator-side — NOT the implementer):** frozen gates.md lists the
  allowed config as `apps/desktop/playwright.config.ts`, which **does not exist** in the tree; the only
  Playwright config is the root `playwright.config.ts` (research §2.1 itself says the root config +
  a support helper). F3.4's `grep -vE` allowlist therefore does not match the root config line and the
  gate would exit 1 on a correct implementation. F3.4's regex must be corrected to
  `^(playwright\.config\.ts|apps/desktop/e2e/support/global-setup\.ts)$` by the orchestrator — gates are
  frozen and outside reviewer/implementer write scope. The reviewer brief (point 2) and the delta both
  confirm the ROOT config is the intended target.
- Non-blocking note: `probeUrl` treats any status < 500 as "answered" (404 counts) — deliberate and fine
  for "server is up" probing; both `webServer` URLs in config are :5173/:5174, matching the helper.
- Not measured here by mandate: F3.2 lint, F3.3 test, F3.5 deps, F3.6 snapshots, F3.7.pw — other
  packets'/orchestrator's gates; Playwright NOT run by this reviewer.

## Verification

- Scope/scope-cleanliness: `git status --porcelain` → empty; `git diff --stat 128b59c..738aba6` →
  `2 files changed, 63 insertions(+)`.
- `pnpm -r typecheck` (worktree `C:/Users/Dragonfly/Downloads/warsha-wt/v3/f3`):
  **exit code 0**. Verbatim tail:

```
Scope: 7 of 8 workspace projects
packages/client typecheck$ tsc --noEmit
packages/i18n typecheck$ tsc --noEmit
packages/crypto typecheck$ tsc --noEmit
packages/ui typecheck$ tsc --noEmit && tsc --noEmit -p tsconfig.storybook.json
packages/crypto typecheck: Done
packages/client typecheck: Done
packages/i18n typecheck: Done
packages/ui typecheck: Done
apps/desktop typecheck$ tsc --noEmit && tsc --noEmit -p tsconfig.e2e.json
apps/remote typecheck$ tsc --noEmit
apps/remote typecheck: Done
apps/desktop typecheck: Done
```

### Update — final

Verdict stands: **APPROVE**. Typecheck exit 0; points 1–3 PASS; no implementation blockers.
Only action item is F-1 (orchestrator corrects frozen F3.4 regex path: root `playwright.config.ts`,
not the non-existent `apps/desktop/playwright.config.ts`).
