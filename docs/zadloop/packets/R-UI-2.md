# R-UI-2 — run-ending controls become reachable (REVIEW §5.5 amendment 1, finish)

Status: spec frozen. Base: R-UI-1's merge tip. Depends on R-UI-1 (clean gates). Open decision D-UI2-1 has a
**default applied** below; the PM may strike it before dispatch.

## Why

K1 (gate integrity) and K2 (run-state integrity, `runs.resume`, change-request loop) are merged, so
`gates.changes` and `gates.reject` are safe to expose. The v3 controls exist and are registered with
`capability: 'runs.resume'` (`actions/registry/bench.ts:13-14`, `project.*`, `inbox.*`), and three duplicated helpers
read that key (`pages/bench/helpers.ts:133-142` `hasGateResumeCapability`, `pages/inbox/index.tsx:189`,
`pages/project/index.tsx:211` `isRunEndingEnabled`). But the only capability source, `detectCapabilities`
(`actions/capabilities.ts`), returns a fixed object without that key and the daemon's `HealthCapabilities` is
`{daemon, providers, keychain}` (`api.rs:587`). In production the controls never render; only the test back doors
`window.__ENABLE_RESUME__` / `__WARSHA_RUN_ENDING_ENABLED__` turn them on.

## Goal

The daemon honestly advertises that run-ending controls are supported; the UI reads one capability from one place;
the Bench, Project and Inbox controls (request changes, reject, and the cancel confirm that shares the key)
appear exactly when the daemon says so and never otherwise; the window back doors are removed.

## Design (frozen; D-UI2-1 default)

- **D1 (wire, additive, optional):** `HealthCapabilities` gains `run_controls: bool`, `#[serde(default)]` so older
  clients/daemons interoperate. `packages/client` `health()` decodes it as optional (missing → `false`).
- **D2 (honest probe, not a constant):** `AppState::probe_capabilities` sets `run_controls` from a real check that the
  store has the run-version (CAS) column — the K2 migration is applied — **and** `daemon` is true. A constant
  `true` is refused (K3 forbade constant health; this is the same class).
- **D3 (UI single source):** `Capabilities` gains `runControls: boolean` (default `false`); `detectCapabilities`
  maps `health.capabilities.run_controls`. The three duplicated helpers collapse into one exported
  `canEndRuns(capabilities)` in `apps/desktop/src/v3/actions/capabilities.ts` that reads `runControls` only.
  Registry entries keep their `capability` string but the string is now `'runControls'` (registry gate reads the
  `Capabilities` field), so a grep for `runs.resume` in `apps/desktop/src` returns nothing outside the i18n/test
  names it legitimately appears in.
- **D4 (back doors out):** delete `__ENABLE_RESUME__` and `__WARSHA_RUN_ENDING_ENABLED__` from production code;
  e2e enables the controls by serving `capabilities.run_controls: true` from the `health` fixture
  (`openV3(..., { fixtures: { health: ... } })`), which is the daemon-true path.
- **D5 (no engine fiction):** the controls still call only `gates.changes` / `gates.reject` / `runs.cancel` that
  exist; no new RPC method, no new Rust method.

## Allowed files

Rust (additive only, two files): `crates/warshad/src/api.rs` (the struct), `crates/warshad/src/state.rs`
(`probe_capabilities`), and the existing test `crates/warshad/src/tests/health_reports_probed_capabilities.rs`
(extend, do not weaken). `packages/client/src/index.ts` + `index.test.ts` (health decode). Desktop:
`apps/desktop/src/v3/actions/capabilities.ts` (+`capabilities.test.ts`), `actions/registry/{bench,inbox,project}.ts`
(capability string only), `pages/bench/helpers.ts`, `pages/inbox/index.tsx`, `pages/project/index.tsx` (helper
replacement only), their tests, `apps/desktop/e2e/v3/{bench,inbox,project}.spec.ts`, `apps/desktop/e2e/harness.ts`
**only** the `health` stub's capabilities object if the stub hard-codes it (v2 harness: additive field, report it),
`docs/DAEMON.md` (health row), report `docs/zadloop/packets/R-UI-2-report.md`.

## Out of scope

Any other `HealthCapabilities` field change; moving lib.rs code (Stage B parked); new RPC methods; changing K1/K2
behaviour; the remote PWA (it has its own gate plate); baselines; v2 files; B4b, B6.

## Constraints

Isolated worktree, branch `zl-rui2-*`; implementer never authors gates; separate reviewer/verifier; small commits;
mock provider only; no `unwrap()` in non-test Rust; ar+en only (no new strings expected — if a control label is
missing, add to both catalogs); logical CSS. A wire change requires `check-wire-contract.mjs` to pass with the new
field in `DAEMON.md`.

## Steps

1. Rust: field + probe + test (T1–T3). 2. Client decode + tests. 3. `Capabilities.runControls`, `canEndRuns`,
   registry strings, replace the three helpers, delete back doors. 4. e2e: controls absent with `run_controls:false`,
   present with `true`. 5. Full Acceptance; report.

## Acceptance (frozen)

- T1 `health_reports_run_controls_from_a_real_probe`: migrated store → `run_controls == true`.
- T2 `health_reports_no_run_controls_without_the_version_column`: a store without the column → `false`
  (constructed by the test; if the migration cannot be absent in-process, the probe must take an injectable
  `RunControlsProbe` and the test injects `false` — state which in the report).
- T3 old payload without the field deserialises with `run_controls == false` (serde default).
- C1 client: `health()` decodes the field; missing → `false`; wrong type → decode error naming the field.
- U1 unit: `canEndRuns` true only when `runControls === true`; Inbox/Project/Bench render no
  `inbox.gate.changes.send|reject.confirm`, `project.gate.changes.*|reject.*`, `bench.gate.changes.send|reject.confirm`
  with the default capabilities and render them when `runControls` is true.
- E1 e2e: existing journeys that asserted "hidden by default" still pass; new cases enable via the `health` fixture,
  not via `window` globals. `git grep -n "__ENABLE_RESUME__\|__WARSHA_RUN_ENDING_ENABLED__" -- apps packages` prints nothing.
- Gates: `cargo fmt --all --check` 0; `cargo clippy --workspace --all-targets -- -D warnings` 0;
  `cargo test -p warshad --all-targets` (count ≥ 298 passed, 0 failed) and `cargo test --workspace --all-targets` 0
  failed; `node scripts/check-wire-contract.mjs` 11/0 + `--self-test`; `node scripts/check-arch.mjs` 5/0 + `--self-test`;
  `node scripts/check-engineering-policy.mjs` 8/0 + `--self-test`; `pnpm lint`; `pnpm typecheck`; `pnpm -r test` (no
  count below R-UI-1's report); `<TOOLS>/actions-gate.mjs "$PWD"` 0; `<TOOLS>/i18n-gate.mjs "$PWD"` 0;
  `pnpm exec playwright test --project=desktop apps/desktop/e2e/v3 --grep-invert "@visual"` 0 failed (passed ≥ R-UI-1's).
- D1 Discrimination: T1 fails if the probe is replaced by `true`; the capability-gated e2e fails if the registry
  capability string is reverted; artifacts under `target/discrimination/`.
- Remember: `crates/warshad/src/lib.rs` is not edited (`git diff --stat` shows `api.rs`, `state.rs`, tests only on the
  Rust side).
