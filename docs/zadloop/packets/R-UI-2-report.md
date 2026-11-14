# R-UI-2 report — run-ending controls become reachable

Branch `zl-rui2-run-controls` in the isolated worktree `.agents/worktrees/zl-rui2-runcontrols`, based on
`cb6c5f1` (`repair/dev-csp-f474776`, R-UI-1 merged). Coder lane. The gate tools under
`bridge-io/policy/2026-11-09-ui-v3/tools` were called by absolute path and not edited. The open decision
D-UI2-1 was applied (it was not struck before dispatch). `PROGRESS.md`, `DECISIONS.md` and the packets
directory were not touched, per the packet's allowed list; every decision this run made is recorded below.

## Commits

| #   | Commit    | Subject                                                                          |
| --- | --------- | -------------------------------------------------------------------------------- |
| 1   | `e957c7e` | `feat(health): probe and advertise the run-ending controls`                       |
| 2   | `a880165` | `feat(client): decode health capabilities.run_controls`                           |
| 3   | `47f356e` | `feat(v3): gate the run-ending controls on one probed capability`                 |
| 4   | `8650e9c` | `docs(daemon): record health capabilities.run_controls`                           |
| 5   | `654903e` | `refactor(health): read the run-version column in the probe, not around it`       |

The working tree is clean at settle time; all gates below were run on this committed content.

## Per-design-point result

**D1 — wire, additive, optional (done).** `HealthCapabilities` gains `run_controls: bool` with
`#[serde(default)]` (`crates/warshad/src/api.rs`), so an old payload decodes as `false` and an old client
ignores the field. `packages/client` `health()` now *decodes* the reply instead of passing it through
(it previously returned the raw RPC result): `capabilities.run_controls` reads as
`capabilities.runControls`, missing → `false`, present-but-not-a-boolean → a decode error naming
`health.capabilities.run_controls`. `docs/DAEMON.md` records the field in the `health` row plus a
paragraph on what it means.

**D2 — honest probe, not a constant (done).** `DaemonState::probe_capabilities` sets
`run_controls = daemon && self.store_has_run_versions().await`. `store_has_run_versions` is a real read of
the live schema: `get_run_version(RunId::new())` selects the K2 column for a freshly minted, certainly
unstored id, so `RunNotFound` proves the column resolved and any database error (no such column) reports
the controls as unsupported; an unreachable store is already covered by the `daemon` term. Nothing is
hardcoded and `run_controls` short-circuits on `daemon`.

**D3 — UI single source (done).** `Capabilities` gains `runControls: boolean` (required, `false` in
`DEFAULT_CAPABILITIES`), `detectCapabilities` maps it from `health`, and the one exported
`canEndRuns(capabilities)` in `apps/desktop/src/v3/actions/capabilities.ts` reads `runControls` and
nothing else. The three duplicated helpers are gone: `hasGateResumeCapability` deleted from
`pages/bench/helpers.ts`, `isRunEndingEnabled` deleted from `pages/inbox/index.tsx` and
`pages/project/index.tsx`. The two registry entries in `actions/registry/bench.ts` now carry
`capability: 'runControls'`; `git grep -n "runs\.resume" -- apps packages` prints nothing.

**D4 — back doors out (done).** `__ENABLE_RESUME__` and `__WARSHA_RUN_ENDING_ENABLED__` no longer exist in
`apps` or `packages` (`git grep -n "__ENABLE_RESUME__\|__WARSHA_RUN_ENDING_ENABLED__" -- apps packages`
prints nothing). The e2e cases that used them now serve
`fixtures: { health: { result: { …, capabilities: { …, run_controls: true } } } }` through
`openV3(..., { fixtures })`, which is the daemon-true path, and each of the three specs gained a case
asserting the controls are absent when the daemon answers `run_controls: false`.

**D5 — no engine fiction (done).** The controls still call only `gates.changes`, `gates.reject` and
`runs.cancel`. No new RPC method, no new Rust method on the API trait; `crates/warshad/src/lib.rs` is
untouched (`git diff --stat -- crates/warshad/src/lib.rs` is empty).

## Acceptance

### Rust

| Gate                                                             | Result                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `cargo fmt --all --check`                                        | 0                                                                         |
| `cargo clippy --workspace --all-targets -- -D warnings`          | 0                                                                         |
| `cargo test -p warshad --all-targets`                            | 0 — 302 passed, 0 failed (the packet's floor is ≥ 298)                    |
| `cargo test --workspace --all-targets`                           | 0 — 1055 passed, 0 failed                                                 |

- **T1 `health_reports_run_controls_from_a_real_probe`** — the daemon opened by `test_state` migrated
  `003_run_version.sql`, so `rpc.health` answers `run_controls == true`; the case also pins that the read
  is a *lookup miss* (`RunNotFound`), not a schema error.
- **T2 `health_reports_no_run_controls_without_the_version_column`** — the pre-K2 schema is built for
  real, not injected: the test drops the column (`sqlx::query("ALTER TABLE runs DROP COLUMN version")` on
  the store's own pool, after the migrator has run) and re-reads the same daemon through the same default
  probe; `run_controls` is `false` while `daemon`, `providers` and `keychain` are byte-identical to the
  supported reading. **The packet's fallback (an injectable `RunControlsProbe` with an injected `false`)
  is therefore not used.** Two consequences worth stating: `crates/warshad/Cargo.toml` gains `sqlx` as a
  **dev**-dependency (test-only, for that one `DROP COLUMN`; `Cargo.lock` gains one edge) — a file outside
  the packet's allowed list, reported here as the packet asks for adjacent edits; and an earlier draft of
  this change did use the injectable seam, so commit `654903e` is the version that replaced it.
- **T3 `health_decodes_an_old_payload_with_run_controls_defaulting_to_false`** — `{"daemon":…,
  "providers":…, "keychain":…}` deserialises with `run_controls == false`, and the current daemon states
  the field on the way out (round-trips equal).
- **Extra, `health_reports_no_run_controls_when_the_store_cannot_answer`** — a closed pool (unreachable
  store, real probe, default path) reports `daemon == false` and `run_controls == false`.

### TypeScript

| Gate                                                         | Result                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| `pnpm lint`                                                  | 0 — 0 errors, 1 pre-existing warning (`inbox/index.tsx:360` `exhaustive-deps`, untouched line) |
| `pnpm typecheck`                                             | 0 — all 7 projects                                        |
| `pnpm -r test`                                               | 0 — client 174, i18n 58, ui 373, crypto 22, remote 221, desktop 777 |
| `led actions-gate.mjs "$PWD"`                                | 0 — 151 registered, 151 used, 0 violations (R-UI-1's counts) |
| `led i18n-gate.mjs "$PWD"`                                   | 0 — 746 keys, 0 violations (no new strings were needed)   |
| `node scripts/check-wire-contract.mjs` + `--self-test`       | 0 — 11 checks, 0 violations; self-test 11/11 fire         |
| `node scripts/check-arch.mjs` + `--self-test`                | 0 — 5 rules, 0 violations; self-test 5/5 fire             |
| `node scripts/check-engineering-policy.mjs` + `--self-test`  | 0 — 8 checks, 0 failures; self-test 8/8 fire              |
| `pnpm exec playwright test --project=desktop apps/desktop/e2e/v3 --grep-invert "@visual"` | 0 — 286 passed, 0 failed (R-UI-1: 283; +3 new absent-control cases) |

No count is below R-UI-1's report (`pnpm -r test`: desktop 772 → 777, client 172 → 174; e2e 283 → 286).
No test was weakened: the deleted assertions were the ones for functions this packet deletes
(`isRunEndingEnabled`, the `window` flag), and `canEndRuns` is covered in
`apps/desktop/src/v3/actions/capabilities.test.ts` (7 cases in that file) plus the presence/absence
render cases in the Inbox, Project and Bench suites.

### U1 and C1, concretely

- U1: `canEndRuns` is true only for `runControls === true` (`null`, `undefined`, `{}`, `DEFAULT_CAPABILITIES`,
  `{ runControls: false }` are all false; a full-capability object with `runControls: false` is also false,
  so no other field leaks into the answer). Inbox, Project and Bench assert the absence of
  `data-action="inbox.gate.changes.send"`/`"inbox.gate.reject.confirm"`,
  `project.gate.changes.open|send`/`project.gate.reject.open|confirm`, and
  `bench.gate.changes.send`/`"bench.gate.reject.confirm"` under the default capabilities and their presence
  when `health` advertises `runControls: true` — the capability is driven through the mock client's
  `health`, not through a `window` flag.
- C1: `health()` decodes `run_controls`; missing → `false`; `run_controls: "yes"` → rejection whose message
  names `health.capabilities.run_controls` (`packages/client/src/index.test.ts`).

### Discrimination (`target/discrimination/`)

| Artifact                              | Mutant                                                         | Expected / observed                                        |
| ------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| `D1a-capability-constant-true.log`    | `run_controls = true` in `probe_capabilities`                   | T2 and the closed-pool case fail — 2 failed, 3 passed      |
| `D1b-probe-constant-false.log`        | `store_has_run_versions` → `false`                             | T1 fails (plus the existing probe test and T2) — 3 failed  |
| `D1c-probe-constant-true.log`         | `store_has_run_versions` → `true`                              | T2 fails — 1 failed, 4 passed                              |
| `D2-canEndRuns-legacy-key.log`        | `canEndRuns` reads the old `'runs.resume'` key                  | 10 capability-gated e2e cases fail across the three specs  |
| `D2-restored.log`                     | restored                                                       | the same 10 pass                                           |

`D1c` is the discrimination this packet names ("T1 fails if the probe is replaced by `true`"): with the
real-schema T2 it is caught, which is why the injectable-seam fallback was dropped.

## What did not reproduce

1. **"the registry gate reads the `Capabilities` field" / "the capability-gated e2e fails if the registry
   capability string is reverted" (D1 Discrimination, §D3).** No gate and no runtime code reads a registry
   entry's `capability` string: `apps/desktop/src/v3/actions/types.ts` declares `capability?: string`,
   `bridge-io/policy/2026-11-09-ui-v3/tools/actions-gate.mjs` has no `capabilit*` token at all (it checks
   action ids, usage, `data-action` literals and e2e coverage), and nothing else in `scripts/` or
   `apps/desktop/src` consumes the field (`PreviewTab`/`AdvancedComposer` read `capabilities.preview` /
   `capabilities.harnesses` directly). Reverting `'runControls'` → `'runs.resume'` in `registry/bench.ts`
   is therefore a no-op at runtime and cannot fail an e2e case. The strings are still updated as D3
   requires. The behavioural equivalent *was* discriminated: `D2-canEndRuns-legacy-key.log` shows the
   enabled e2e cases failing when `canEndRuns` reads the old key.
2. **The v2 harness health stub needed no change.** The packet allows a `harness.ts` edit "only if the
   stub hard-codes it"; it does not — `apps/desktop/e2e/harness.ts:1556-1557` answers `health` with
   `{ status: 'ok', version: '0.2.0' }` and no `capabilities` object, so the field arrives only through a
   case's `fixtures`, which is exactly the daemon-true path D4 wants. `harness.ts` is untouched.
3. **`packages/client` `health()` decoded nothing before this packet.** D1 reads as if the field were
   merely typed; in this tree the method returned the raw RPC result, so "decodes it as optional" needed a
   real decoder (and the C1 wrong-type case needed a strict boolean read, since `wave2Boolean` falls back
   silently).

## Files touched beyond the packet's allowed list

Each is a mechanical consequence of the frozen design; none changes behaviour beyond the packet.

| File                                                        | Why                                                                                     |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `apps/desktop/src/v3/pages/bench/components/BenchDecisionCard.tsx` | the only consumer of the deleted `hasGateResumeCapability`; import and call swapped for `canEndRuns` (2 lines) |
| `crates/warshad/Cargo.toml`, `Cargo.lock`                    | `sqlx` as a **dev**-dependency for T2's real `DROP COLUMN` (3 lines + 1 lock edge)        |
| `apps/desktop/src/v3/app/startup.test.ts`                    | client mock now states the decoded health shape (`capabilities: { runControls: false }`), 2 mocks |
| `apps/desktop/src/v3/pages/home/Home.test.tsx`               | `initialCapabilities` literal gains `runControls: false` (1 line)                        |
| `apps/desktop/src/v3/pages/settings/Settings.test.tsx`       | same (1 line)                                                                            |

## Notes and limits

- **Intermittent failure, reported as observed.** Three full `pnpm -r test` runs were made. Two of them
  failed 1 and 2 cases in `apps/desktop/src/v3/pages/project/Project.test.tsx`
  (`renders loading, empty, and error states honestly with retry`, and once also
  `shows ONE decision card …`), both pre-existing timing cases whose multi-render `waitFor` chains run
  beside the other packages' suites; the message is a `waitFor` miss, not a capability assertion. The same
  file passes standalone (10/10), under a 2-core `taskset` pin (10/10), and the final full run is green
  (777 desktop, 0 failed); a baseline `pnpm -r test` on `cb6c5f1` was green in one run (772). I did not
  loosen either test.
- **Prettier.** `pnpm exec prettier --check` reports the same 15 files at `cb6c5f1` and at this branch
  head; no file that was clean became dirty. For the four where prettier's reflow intersects lines this
  packet touched (`registry/bench.ts`, `docs/DAEMON.md`, `project.spec.ts`, `bench.test.tsx`) the reflow is
  whole-file long-line/ table-padding drift that predates the change (verified by diffing `prettier
  <file>` against each file at the base commit), so the added lines follow the file's existing style rather
  than reformatting lines this packet does not own. Repo-wide `format:check` is not green on the base tree
  and was not made green here.
- **Playwright** ran without `--update-snapshots`; no baseline was written. The new e2e cases are
  functional (`data-action` presence/absence), not visual.
- **Process note.** The first three Rust edits were written into the shared checkout by mistake; they were
  copied into the worktree and the shared checkout was restored to `HEAD` for exactly those three files
  after diffing them to confirm they contained only my edits. The shared checkout is clean
  (`git status --porcelain` empty) and otherwise untouched by this run; the worktree is the only place work
  was committed.
