# Worker briefs — run `2026-11-09-phase-b-visual-wave`

The orchestrator hands each implementer **COMMON + its own section + `packets/<P>/gates.md`**, verbatim.
`EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-phase-b-visual-wave`.

---

## COMMON (every packet)

You are the IMPLEMENTER of one packet of run `2026-11-09-phase-b-visual-wave` in the Warsha repo
(`C:/Users/Dragonfly/Downloads/Warsha`). A separate reviewer and verifier judge your work against the frozen
gates in `packets/<P>/gates.md`; you must not edit, weaken, skip or reinterpret them. Never ask questions: decide,
record the decision in your report, continue.

**Read first:** `AGENTS.md`; `ENGINEERING_POLICY.md` §1 (Phase 3), §5, §6; `docs/designs/DESIGN_SYSTEM_V2.md`
§4, §8, §9; your section below; your `gates.md`.

**Worktree (Git Bash)** — the orchestrator gives you `<branch>`, `<base>` and `<wt>` from `state.json`:
```bash
cd C:/Users/Dragonfly/Downloads/Warsha
git worktree add <wt> -b <branch> <base>
cd <wt>
BASE=$(git rev-parse HEAD); echo "BASE=$BASE"     # must equal <base>
pnpm install --frozen-lockfile                    # TS packets
# Rust packets: export CARGO_TARGET_DIR=<wt>/target   (never share the main checkout's target dir)
```

**Always:** stay inside your allowed files; read a file before you edit it; TS strict, no `any`, no `@ts-ignore`;
Rust: no `unwrap()`/`expect()` in non-test code, errors via `thiserror`/`anyhow`, `cargo fmt` + `clippy -D warnings`;
every user-visible string through `packages/i18n` (ar + en, same keys), logical CSS properties only, no px/rem/em
literal in app code (the R6.9 ratchet is at **0**); tests with every change; small Conventional Commits.

**Never:** touch any `*-snapshots/**` file or run `--update-snapshots`; edit `PLAN.md`/`PROGRESS.md`/`DECISIONS.md`;
add or bump a dependency; push, merge, tag or publish; call a real model API (mock provider only); write a secret
anywhere; add `#[ignore]`, `.skip`, `todo!()` or weaken an assertion; change a `data-testid`, ARIA role/name or
landmark that an e2e spec uses (grep `apps/*/e2e` before renaming anything).

**Out-of-scope blocker:** if the work needs a file outside your allowed list, a credential, or a product decision,
stop, write it in your report as `BLOCKER (out-of-scope): <reason> — needs <what>`, and end. Do not widen scope.

**Report:** write `$EV/packets/<P>/report.md`: base and head commits, what changed per step, every decision you took
(one line + alternative rejected), the unit counts you measured, and anything you saw but left alone.

---

## P1 — `packages/ui`: tints, accent/opacity fixes, `SettingsLayout` (Wave A)

1. **Status tints.** `compounds/Chip.tsx` (status variants at ~80-93) fills `success`/`warning`/`error` pills with
   `colorVar('successTint'|'warningTint'|'errorTint')` (tokens exist: `tokens/colors.ts:73-77`, `tokens.css:52-55`,
   `:249-252`) and keeps the status ink for text and rule. `lit`/accent stays reserved for "waiting on the owner".
   `Lamp` stays a solid dot. Add a contrast assertion per status (ink on its tint ≥ 4.5:1, both themes) if
   `contrast.test.ts` does not already prove it.
2. **No accent fill outside waiting.** `ModelPicker.tsx:237-243` (selected option) and `SettingsScopeSentence.tsx:59-60`
   (global pill) stop using `accent`/`accentInk`. Use a neutral selected treatment built from existing tokens
   (e.g. `surfaceMuted` + a `line` token on the inline-start edge, `text` ink) and keep `aria-selected`/state
   attributes unchanged. Record the treatment you chose.
3. **No opacity on text.** `ModelPicker.tsx:264` and `SettingsScopeSentence.tsx:81` → `colorVar('textMuted')`.
4. **`SettingsLayout` compound.** New `compounds/SettingsLayout.tsx`: props `title: string`, `titleId?: string`,
   `scope?: ReactNode` (slot for `SettingsScopeSentence`), `width?: 'plate' | 'ledger'` (caps at
   `size-plate-max` / `ledger-max`), `actions?: ReactNode`, `children`. Renders `<section aria-labelledby>` with an
   `<h2>`; logical properties and tokens only. Export from `src/index.ts`; add a story and a test file
   (`SettingsLayout.test.tsx`: heading level, labelled region, scope slot, width cap, RTL-safe).
5. Keep the English **default** props of `ModelPicker`/`SettingsScopeSentence` — P6 removes them after the apps pass
   catalog strings. Update `packages/ui/README.md` (tints, SettingsLayout).

## P2 — e2e harness truth + Wave-2 screens + wire check W10 (Wave A)

Ground truth for every shape is the daemon (`crates/warshad/src/lib.rs`) and `crates/warsha-core`, never the client.
1. **Desktop stub shapes** in `apps/desktop/e2e/harness.ts` (`rpcResult`, ~1554-1607) — today they make the client
   throw, so the committed `crash-reports` baselines show "The daemon did not answer the crash list":
   - `postlaunch.crashes` → a bare array of crash reports exactly as the daemon serialises them (`lib.rs:3235-3252`);
   - `postlaunch.reviews` → a bare array (`lib.rs:3255-3266`);
   - `backend.export` → a bare string path (`lib.rs:3149-3167`); `handoff.create` → a bare string (`lib.rs:3172-3190`);
   - `handoff.apply` → the JSON-encoded **string** of `ApplyResult` (`crates/warsha-pipeline/src/handoff.rs:258-272`:
     `applied`, `conflicts[{path, local_checksum, remote_checksum}]`, `backups`, `resolved`, optional `backup_dir`).
   Keep realistic, non-empty fixtures so the screens render their ready state.
2. **`runs.subscribe`** fixture (`apps/remote/e2e/harness.ts` ~199-218): its `run` object uses the daemon's
   snake_case (`project_id`, `current_stage`, `created_at` — `warsha-core/src/lib.rs:223`), not camelCase.
3. **Four Wave-2 screens** — add `harnesses`, `skills`, `plugins`, `models` to `SCREENS` (`apps/desktop/e2e/harness.ts`
   ~348-480) mirroring the `settings` entry (same viewports/locales/themes, same assertion style, RPCs they dial).
   Their baselines do not exist yet: that is expected; R1 creates them. Never commit a PNG.
4. **Contract test** `apps/desktop/src/harness.contract.test.ts`: feed the `rpcResult` stub of each of the five
   methods above through the real `WarshaClient` method (fake transport) and assert it decodes; add one negative case
   proving an object-wrapped list is rejected. If importing the harness into vitest is impossible, record why and
   put the same assertions in `scripts/check-wire-contract.mjs` instead — the gate counts method names in the test file.
5. **W10** in `scripts/check-wire-contract.mjs`: every RPC the remote app dials (`apps/remote/src/bench.tsx` `BenchApi`)
   resolves to a stub reachable from `apps/remote/e2e/harness.ts`; extend `--self-test` with a planted violation.
   The summary line must read `wire: 10 checks, 0 violations`.

## P3 — Rust error hygiene and test timing (Wave A)

1. Non-test `unwrap()` at `crates/warsha-pipeline/src/settings.rs:131` and `:316` → propagate with the module's error type.
2. Silently dropped errors in `crates/warshad/src/lib.rs`: `pairings.revoke` (`:2913`) and `pairings.create` (`:2831`)
   must surface failure as an RPC error (decide and test whether revoking an unknown device is an error or idempotent);
   plugin enable/disable must not report success when `mcp.connect`/`disconnect` fails (`:4239`, `:4243`, `:4280`);
   `get_active_harness(..).ok().flatten()` (`:3948`, `:3974`, `:4002`, `:4066`) must not turn a DB error into the default
   harness; `wave2.rs:614-617` (and `:322`, `:861`) must not turn a corrupt JSON row into empty args/env — return an
   error naming the row. One test per behaviour.
3. Preview policy (`lib.rs:3476-3485`) judges `command.split_whitespace().next()` while the spawn uses the quote-aware
   `split_command` (`warsha-pipeline/src/process_spawn.rs:710`, `:811`): judge the same first token the spawn uses, fix
   the stale comment, test an allow-listed quoted path with spaces (allowed) and a non-allow-listed one (refused).
4. Timing-fragile tests: `lib.rs:7998`, `:8042` (`sleep 30`), `warshad/tests/child_reaping.rs:68` (`sleep 120`),
   `process_spawn.rs:967/983/1025`, `mcp_transport.rs:1083/1167/1559`, `agent_loop.rs:1157/1166`, `routines.rs:1025-1029`,
   `tests/events_stream_sync.rs:198`. Replace long sleeps with a child that blocks until killed (e.g. reads stdin) and
   fixed sleeps with poll-until-deadline helpers. Same assertions; no test removed or ignored.
5. Do **not** change `RunCommand` behaviour in `agent_tools.rs` — that is P7 and only with the owner's OD-B4.

## P4 — release truth: one version, honest docs, safer workflow (Wave A)

1. Align every version field to the Rust workspace version **0.2.1**: root `package.json`, `apps/remote`,
   `packages/{ui,client,i18n,crypto}`; `apps/mobile/android/app/build.gradle` `versionName "0.2.1"`, `versionCode 201`
   (rule: `major*10000 + minor*100 + patch`); `docker/compose.yml` image tag. Check with `node $EV/tools/versions.mjs`.
2. `scripts/check-versions.mjs` (repo tool): same coverage as the planner tool, plus `--expect <v>`, `--set <v>` (rewrites
   every field above, `Cargo.toml` `[workspace.package]`, `apps/desktop/src-tauri/{Cargo.toml,tauri.conf.json}`,
   `apps/desktop/package.json`, versionCode, and refreshes `Cargo.lock` workspace entries offline) and `--self-test`
   (planted mismatch). Add `"versions": "node scripts/check-versions.mjs"` to root `package.json` scripts.
3. `docker/Dockerfile`: `ARG WARSHA_VERSION` + `LABEL org.opencontainers.image.version=$WARSHA_VERSION`.
4. `build.gradle` asset sync (`:118-156`): always build `apps/remote` before syncing (today it rebuilds only when
   `dist/index.html` is missing, so a stale `dist` ships); keep the `Sync` semantics, `**/*.map` exclusion and the loud failure.
5. Root `.gitignore`: `*.jks`, `*.keystore`, `*.p12`, `keystore.properties`.
6. `.github/workflows/release.yml`: an early step fails when `${GITHUB_REF_NAME#v}` ≠ `node scripts/check-versions.mjs`
   output (use `--expect`); move `contents|packages|id-token: write` from workflow level (`:19-22`) to the jobs that need
   them (drop `packages: write` if nothing publishes packages). `draft: true` stays. Fix the stale comment at
   `desktop-bundle.yml:18` (`createUpdaterArtifacts` is false).
7. `apps/mobile/README.md`: remove the contradiction at `:124` (`840513`) and the stale "Build date"; present the v0.2.0
   APK facts (842,981 B, SHA-256 `6a468185…e2700ef`) as the v0.2.0 record and say C4 re-records them.

## P5a — desktop structure: Tabs, Composer, wiring (Wave B, base = integration after C1)

Precondition (else blocker "C1 not reached"): `grep -q SettingsLayout packages/ui/src/index.ts` and
`node scripts/check-wire-contract.mjs | grep -q "10 checks"`.
1. **`Tabs`** (`packages/ui/src/compounds/Tabs.tsx`; remote already uses it at `apps/remote/src/screens/SettingsScreen.tsx:91`)
   replaces the hand-built tablists in `AdvancedMode.tsx:1279-1299` (handler ~946), `App.tsx:698-718` (handler ~676) and
   `RunView.tsx:411-432` (handler ~192). Same tab order, labels, panel ids and test ids; delete the custom key handlers.
   No source line (comments included) may keep the literal `role="tablist"` in these three files.
2. **`Composer`** (`compounds/Composer.tsx`) replaces the hand-built form at `SimpleMode.tsx:1480`; keep MentionPicker,
   SlashCommandPicker (helpers `:328-362`), Queue/Steer, PermissionModeChip, ModelPicker, FastModeToggle, budget caps and
   the launch sequence (`selectHarness` best-effort, then `startRun`). The a11y case "the composer: Shift+Enter breaks
   the line, Enter sends it" and the flows spec must stay green.
3. **ModelPicker strings**: `SimpleMode.tsx:1573` and `AdvancedMode.tsx:1658` pass `autoLabel`/`autoDescription` from
   `composer.model_picker.*` (keys exist, ar + en); the `'Custom'` literal near `SimpleMode.tsx:1580` goes to the catalog.
4. **Stale wiring**: `RunView.tsx:227`, `:232` → `client.startPreview`/`stopPreview` (exist) with an i18n error banner;
   `ArtifactViewer.tsx:63` → `client.getRunArtifacts(runId)` instead of its fixture (loading/empty/error states).
   Leave `AdvancedMode.tsx:1766`/`:1775` (no RPC exists yet).
5. **Startup**: a failing `listRuns` inside `startupTarget` (`App.tsx:224`) must not send an onboarded owner to
   onboarding (`App.tsx:396-399`); show the shell with an i18n error banner. Test it.

## P5b — settings screens adopt `SettingsLayout` (Wave B, base = integration after C1; rebase after P5a merges)

Precondition: same as P5a.
1. **`SettingsLayout`** becomes the root of `SettingsScreen.tsx:160`, `ProvidersSettings.tsx:302`, `SettingsProviders.tsx:133`,
   `ModelsSettings.tsx:267`, `HarnessesSettings.tsx:173`, `SkillsSettings.tsx:163`, `PluginsSettings.tsx:188`,
   `CrashReports.tsx:187`, `StoreReviews.tsx:217`, `Routines.tsx:39`; decide and record whether `BackendKitPanel.tsx:225`
   adopts it. Keep test ids and headings' text.
2. **Scope strings**: the six `SettingsScopeSentence` callers (`SettingsScreen:194`, `SkillsSettings:209`,
   `ProvidersSettings:350`, `PluginsSettings:234`, `ModelsSettings:313`, `HarnessesSettings:219`) pass `globalLabel`,
   `projectLabel`, `globalHint`, `projectHint` from `settings.scope.*` (keys exist, ar + en).
3. **No opacity**: `ModelsSettings.tsx:477`, `ReviewApplyPanel.tsx:384`, `WebDeployButton.tsx:75` → `textMuted`; a disabled
   control says so with `disabled`/`aria-disabled`, not with opacity.
4. `HandoffDialog.tsx:188` `zIndex: 50` → the `layer-modal` token (`tokens/elevation.ts:44`).

## P6 — remove the English defaults (Wave C, base = integration after C2)

`ModelPicker.tsx:71-72` and `SettingsScopeSentence.tsx:40-43` lose their default values; the props become required.
Update `compounds.v2.test.tsx` (~190, 198-208) and the two stories to pass explicit strings. `pnpm -r typecheck` proves
every caller already passes them. Pixel-neutral: zero Playwright failures.

## P7 — agent `RunCommand` policy (Wave B; dispatch ONLY if OD-B4 = `approve`)

`FilesystemToolExecutor::run_command` (`agent_tools.rs:370`) spawns any program the model names. Route it through the
same process allow-list `warshad` uses for preview/`process.spawn`, judged on the first `split_command` token; refuse
`sh`, `bash`, `cmd`, `powershell`, `pwsh` unless the allow-list names them; the refusal is a `ToolError` the agent sees.
Wire the policy into `build_agent_loop` (`warshad/src/lib.rs:4868`). Tests: one refused, one allowed, one shell refused.
