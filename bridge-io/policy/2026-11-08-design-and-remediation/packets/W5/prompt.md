# Worker prompt — W5 · apps adopt Design System v2 + live Routines/BackendKit wiring (Wave B)

You are the IMPLEMENTER for packet W5 of run `2026-11-08-design-and-remediation` in the Warsha repo
(main checkout `C:/Users/Dragonfly/Downloads/Warsha`). A separate reviewer and verifier judge your work
against the frozen gates below; you must not edit, weaken or reinterpret them. Never ask questions:
decide, record the decision in your report, continue.

**Hard constraint — pixel-neutral.** Every literal you replace must resolve to the identical computed
value; no test id, ARIA role/label or landmark may change; no snapshot may change. Anything that would
change pixels (tints in pills, Arabic strings for ModelPicker/SettingsScopeSentence, `Tabs`/`Composer`
adoption) is Phase B — list it in your report, do not do it.

## 0. Read first
`AGENTS.md`; `ENGINEERING_POLICY.md` (§1 Phase 3, §5, §6); **`docs/designs/DESIGN_SYSTEM_V2.md` §4.3,
§4.4, §4.5 (the migration tables), §8.3, §9**; `packages/ui/src/tokens/` as merged by W3;
`packages/client/src/index.ts` as merged by W4 (`listRoutines`, `runRoutineNow`, `pauseRoutine`,
`resumeRoutine`, `getBackendKit`, `setBackendKit`, `exportBackend`); `apps/desktop/src/App.tsx`
(`TODO(M20 wiring)` at `535`, `538`, `541`, `575`; state at `343`, `347-350`; renders at `741-746`,
`803-811`); `screens/Routines.tsx`, `components/RoutineRow.tsx`, `components/BackendKitPanel.tsx`;
`App.test.tsx` (fetch stub helpers `rpcResponse`/`lastRpcCall` at `142-157`); run state
`C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/state.json`.

## 1. Worktree and branch (Git Bash) — Wave B: start only after checkpoint C1
```bash
cd C:/Users/Dragonfly/Downloads/Warsha
git worktree add ../warsha-wt/w5 -b run/2026-11-08/w5-apps-adoption run/2026-11-08/integration
cd ../warsha-wt/w5
BASE=$(git rev-parse HEAD); echo "BASE=$BASE"
# Precondition (W3 + W4 merged) — both must print OK, otherwise stop: out-of-scope blocker "C1 not reached"
grep -q -- '--warsha-line-rule' packages/ui/src/tokens/tokens.css && echo OK-W3
grep -q 'listRoutines' packages/client/src/index.ts && echo OK-W4
pnpm install --frozen-lockfile
pnpm --filter warsha-desktop test   # baseline >= 443 passed — record it
```

## 2. Scope
allowed_files: `apps/desktop/src/**`, `apps/desktop/real-acceptance.cjs`, `apps/remote/src/**`,
`packages/i18n/src/**`.

out_of_scope: `packages/ui/**` (including `tokenDrift.test.ts` — the ratchet is W3's gate; INT-2 sets
its constant), `packages/client/**`, `apps/desktop/e2e/**` and every `*-snapshots/**`,
`apps/desktop/src-tauri/**`, `crates/**`, dependencies, `docs/**`, `.github/**`,
`PLAN.md`/`PROGRESS.md`/`DECISIONS.md`.

## 3. Steps
1. **Routines live** (`App.tsx`):
   - A pure adapter `toRoutineRow(r: Routine): RoutineRowData` in a new `apps/desktop/src/routines.ts`:
     `schedule` → display string (`cron` → the cron expression, mono; `intervalSeconds` → i18n
     `routine.every_seconds` with the count; `'manual'` → i18n `routine.manual`); `state` `{failed}` →
     `'failed'` (keep the reason for the row's title/tooltip). Unit-test every variant.
   - Replace `const [routines] = useState<Routine[]>([])` with state + setter; load with
     `client.listRoutines()` when the routines screen mounts; `onRun`/`onPause`/`onResume` call
     `runRoutineNow`/`pauseRoutine`/`resumeRoutine` and replace that row with the returned routine;
     a failure shows an i18n error `Banner` and keeps the list. An empty list renders exactly as today.
2. **BackendKitPanel live**:
   - When a run is selected, `getBackendKit(runId)`; `null` keeps today's local defaults (so the
     no-run render is unchanged); a kit sets kind/features/tables from it.
   - `onKindChange`/`onToggleFeature` update local state and `setBackendKit(runId, kit)` when a run is
     selected (errors → inline i18n error, local state kept).
   - `onExport`: `exportBackend(runId, outputDir)` only when a run is selected **and** an output
     directory is derivable from data the app already has (inspect the project/run records); otherwise
     the export control is disabled with an i18n reason. Do not add a file-dialog plugin or dependency.
   - Remove the four `TODO(M20 wiring)` markers in `App.tsx` (other files' markers are follow-ups —
     leave them).
3. **`apps/desktop/real-acceptance.cjs:36`** → `daemon_ws_url: 'ws://127.0.0.1:8765'` (the `/events`
   listener on `http_port`; `apps/desktop/src/daemon.ts:12-13`, `src-tauri/src/lib.rs:253`). Line 35
   (`daemon_url` 8766, JSON-RPC) stays.
4. **Token migration** — apply DS v2 §4.3 (lines), §4.5 (layout sizes, `bench-offset` in `calc`,
   `space-0-5`, `tracking-code`) across `apps/desktop/src/**` and `apps/remote/src/**` including
   `index.css`; `@media` preludes keep their literals (breakpoint set). Pixel-identical only.
   Also: drop the `var()` literal fallbacks in `ErrorBoundary.tsx:113,115,167`; drop the inline
   visually-hidden style at `ModelsSettings.tsx:470` (the element keeps `className="sr-only"`); you MAY
   replace `zIndex` literals with the layer token of the identical value (§4.4).
5. **Scrim** — `HandoffDialog.tsx:187` and `GateBell.tsx:166` backdrops →
   `var(--warsha-color-scrim)` (neither is captured open by any screenshot spec).
6. **i18n** — every new string as a key in both `ar` and `en` catalogs in `packages/i18n/src/`
   (`routine.every_seconds`, `routine.manual`, `routine.error_*`, `backend.error_*`,
   `backend.export_unavailable`, …); Arabic written as Arabic, RTL-safe.
7. **Tests** in `apps/desktop/src/` (≥ 8 new): adapter variants; App lists routines on mount; run/pause/
   resume send the right method + `{id}` and replace the row; error banner on failure; backend get with
   a run, `null` keeps defaults, set on kind change, export disabled without an output dir.
8. Small Conventional Commits (`feat(desktop): …`, `refactor(desktop|remote): tokens …`,
   `fix(acceptance): …`, `feat(i18n): …`). Do not push.

## 4. Frozen verification gates
Each gate is one command; expected result in the comment above it. G5.10/G5.11 run on the Linux
capture host.
```bash
# G5.S scope — expect output: 0
git diff --name-only $BASE..HEAD | grep -vE '^(apps/desktop/src/|apps/desktop/real-acceptance\.cjs$|apps/remote/src/|packages/i18n/src/)' | wc -l
# G5.1 — expect exit 0 and >= 451 passed, 0 failed
pnpm --filter warsha-desktop test
# G5.2 / G5.3 — expect exit 0 with >= 221 and >= 52 passed, 0 failed
pnpm --filter warsha-remote test
pnpm --filter @warsha/i18n test
# G5.4 / G5.5 / G5.6 — expect exit 0 each
pnpm -r typecheck
pnpm -r lint
pnpm -r build
# G5.7 ratchet at zero — expect exit 0
WARSHA_R6_APP_LENGTH_BUDGET=0 pnpm --filter @warsha/ui test
# G5.8 — expect exit 1 (no match)
grep -n 'TODO(M20 wiring)' apps/desktop/src/App.tsx
# G5.9 — expect exit 0
grep -q "daemon_ws_url: 'ws://127.0.0.1:8765'" apps/desktop/real-acceptance.cjs
# G5.10 (Linux capture host) — expect 793 passed, 0 failed, equal to G0
pnpm exec playwright test --project=desktop --reporter=line
# G5.11 (Linux capture host) — expect 91 passed, 0 failed
pnpm exec playwright test --project=remote --reporter=line
# G5.12 no snapshot touched — expect output: 0
git status --porcelain -- '*-snapshots/*' | wc -l
# G5.A / G5.P / G5.W — expect exit 0 each
node scripts/check-arch.mjs
node scripts/check-engineering-policy.mjs
node scripts/check-wire-contract.mjs
```

## 5. Report and stop
Write `C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W5/report.md`:
BASE, HEAD, `git diff --stat $BASE..HEAD`, the literal → token mapping you applied (file:line → token),
decisions (incl. the export output-dir source), Phase B items deliberately not done, your own gate run
with exit codes (not evidence), open issues. Out-of-scope need → stop with a blocker
`{kind: out-of-scope, reason, needs}`. No edits to `PLAN.md`/`PROGRESS.md`/`DECISIONS.md`; no merge;
no push.
