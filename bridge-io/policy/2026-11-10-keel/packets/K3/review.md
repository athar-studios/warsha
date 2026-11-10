# Packet K3 Review — No Silent Fakes (independent reviewer)

- Run: `2026-11-10-keel` · Packet: K3 · Role: REVIEWER (worktree read-only)
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/keel/k3` (branch `run/2026-11-10-keel/k3-no-fakes`)
- Base `e6b3e6d` → Head `bc157e1` (commits 4836e87, 0d2be25, 63ac0d1, 6b416b9, 77d9d10, a714994, bc157e1)
- EV: `C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-10-keel`
- Review date: 2026-11-10

## Verdict: **REQUEST-CHANGES** (one blocking finding: F1, the K3.2 tool is vacuous)

All six review points are substantively TRUE in the code (verified by direct reading), and K3.1/K3.3/K3.4/K3.5/`cargo fmt --check` pass exactly as frozen. The single blocker is that `tools/k3-mock-scan.sh` (K3.2) scans **zero files** — it passes for any tree, so the gate proves nothing. In an "no silent fakes" packet a check that silently checks nothing must not be approved. Fix is confined to the EV tool script; no product-code change required.

## Judgment (6 review points)

### (1) Unrouted role no longer silently uses FakeProvider — PASS
`crates/warsha-pipeline/src/lib.rs` `dispatch_chat` (l.772-803): routed role → `ProviderRouter::chat_with_fallback`;
`WARSHA_LLM_API_KEY` present (and provider not `fake`) → real `OpenAIProvider`; explicit `WARSHA_LLM_PROVIDER=fake` →
`FakeProvider`; otherwise `Err(PipelineError::NoProviderRouted(role))` — no fabricated answer. Unrouted stage failures go
through `record_stage_failure` → `RunStatus::Paused` + `EventKind::Error` `"action": "provider_required"` (l.837-890).
Typed variant `NoProviderRouted(Role)` at l.197-198. No other production `FakeProvider` use answers an unrouted role.

### (2) Production MockRoutineRunner removed (UnavailableRoutineRunner), tests may stub — PASS (code), gate tool broken (F1)
`UnavailableRoutineRunner` is production (`routines.rs` l.173-195; explicit `RoutineError::Runner("routine runner
unavailable…")` refusal); daemon startup wires it at `crates/warshad/src/lib.rs` l.5581 (well before the first
`#[cfg(test)]` at l.6894). `MockRoutineRunner` exists only inside `#[cfg(test)] mod tests` (`routines.rs` l.578+,
first use l.586). Warshad e2e tests moved to `UnavailableRoutineRunner::new()`. Independent scan: `MockRoutineRunner`
has zero occurrences in `crates/*/src` outside `routines.rs`.

### (3) Scout behind registry trait returning CatalogUnavailable honestly; fixtures in tests; no mock prose — PASS
`scout.rs`: `trait ScoutRegistryClient` (l.117); `ProductionScoutRegistryClient` (l.129-147) always returns
`Err(ScoutError::CatalogUnavailable("catalog unavailable for {source:?} at endpoint …"))`; production `Scout` (l.160)
holds it; all four remote sources route through `fetch_proposals` (McpRegistry l.257, Npm l.269, Git l.281, Custom
l.293). `FixtureRegistryClient` only under `#[cfg(test)]` (l.338+). Case-insensitive scan for `in real implementation`
/ `mock proposal` over `crates/warsha-pipeline/src` + `crates/warshad/src`: zero hits (skills.rs l.276 comment cleaned
in 6b416b9). No `todo!`/`unimplemented!`/`#[ignore]` stand-ins in the changed files.

### (4) Health probes real capabilities — PASS
`DaemonState::probe_capabilities` (`warshad/src/lib.rs` l.1199-1233): `daemon` = `store.list_projects()` succeeds;
`providers` = `settings.load_providers()` has an enabled provider OR `role_routings` non-empty; `keychain` =
`secrets.load("__warsha_health_probe__")` operational check (platform-unavailable `Auth` errors → false).
`HealthResponse.capabilities: HealthCapabilities` (l.1754-1766); both `WarshaApi::health` (l.2422) and HTTP
`health_handler` (l.5272) call it. Not a constant.

### (5) status_truth / provider_truth tests discriminate — PASS
`crates/warsha-pipeline/src/status_truth.rs` — 6 tests: typed `NoProviderRouted`; `Paused` + `provider_required`
event; explicit-fake gating; unrouted followup with zero artifacts; `UnavailableRoutineRunner` refusal; production
scout `CatalogUnavailable`. `crates/warshad/src/lib.rs` `mod provider_truth` (l.9596) — 4 tests: unrouted stage →
explicit error + zero artifacts; unrouted followup → explicit error; routed provider succeeds + artifacts; resume
clean once routed. Positive and negative cases assert concrete errors/statuses/artifacts.

### (6) Scope = pipeline + warshad lib/wave2 (+ skills.rs comment), no deps — PASS
`git diff --name-only e6b3e6d..bc157e1` = 11 files, all inside `crates/warsha-pipeline/**` (lib, routines,
run_integrity [test module only], scout, skills [1-line comment], status_truth [new], tests/fake_e2e, tests/
harness_skills_wiring) and `crates/warshad/src/lib.rs` + its two e2e test files. Zero `Cargo.toml`/`Cargo.lock`
changes (deps untouched). `wave2.rs` unchanged (allowed, not required). Note: `tools/scope.sh` has no K3 case yet
(exits 2); scope judged from the file list directly.

## Measurements (verbatim key output)

| Gate | Command | Result | Verdict |
|---|---|---|---|
| K3.1 (amended) | `git grep -n -E 'In real implementation\|mock proposals' -- crates/warsha-pipeline crates/warshad ':(exclude)**/tests/**'` | no output; `K3.1 exit=1` | PASS (expect exit 1, no output) |
| K3.2 | `bash tools/k3-mock-scan.sh` (from EV) | `no production MockRoutineRunner` / `K3.2 exit=0` | PASS as written, **but vacuous — see F1** |
| K3.3 | `cargo test -p warsha-pipeline --lib status_truth::` | `test result: ok. 6 passed; 0 failed; … 369 filtered out` / `K3.3 exit=0` | PASS (N=6 ≥ 4) |
| K3.4 | `cargo test -p warshad --lib provider_truth::` | `test result: ok. 4 passed; 0 failed; … 115 filtered out` / `K3.4 exit=0` | PASS (N=4 ≥ 3) |
| K3.5 | `cargo test -p warshad --lib health_reports_probed_capabilities -- --exact` | `test health_reports_probed_capabilities ... ok` / `test result: ok. 1 passed; 0 failed` / `K3.5 exit=0` | PASS |
| STD.1 | `cargo fmt --all -- --check` | `fmt exit=0`, no output | PASS |

Non-vacuousness controls (why K3.2 is F1):
- `git grep -l '' -- 'crates/warsha-pipeline' | wc -l` → **48 files** (plain dir works)
- `git grep -l '' -- 'crates/*/src' | wc -l` → **0 files** (the tool's pathspec — even `:(glob)` magic → 0)
- With a working pathspec (`crates/warsha-pipeline/src`): **12** raw `MockRoutineRunner` hits, **all 12** survive the
  tool's line filters (all inside `#[cfg(test)]` at `routines.rs` l.578+, first hit l.586) → the tool would
  **false-fail** if only the pathspec were fixed.

## Findings

- **F1 (BLOCKING): K3.2 tool scans zero files.** `tools/k3-mock-scan.sh` line 5 uses pathspec `'crates/*/src'`,
  which matches 0 files (proven above; control plain dir = 48), so `hits` is always empty and the tool prints
  `no production MockRoutineRunner` for ANY tree — a silent fake check inside the no-fakes packet. Secondary defect:
  the `grep -vE "#\[cfg\(test\)\]|mod tests"` filter only drops lines literally containing those markers, so a fixed
  pathspec would false-fail on the 12 legitimate cfg(test) hits. Required fix (tool only): use literal pathspecs
  (`crates/warsha-pipeline/src crates/warshad/src`) and make the test-region exclusion block-aware (e.g., drop each
  file's hits from its first `#[cfg(test)]` line onward); gate must then still exit 0 with
  `no production MockRoutineRunner`. Underlying condition itself is TRUE (verified independently — point 2).
- **F2 (non-blocking): `tools/scope.sh` has no K3 case** (exits 2 for K3); scope verified manually instead. Extend
  the wrapper (base `e6b3e6d`, head `bc157e1`, allowlist = pipeline + warshad lib/tests) so the scope gate can run.
- **F3 (non-blocking): stale comment** at `warshad/src/lib.rs` l.5486-5489: "unrouted pipeline stages already answer
  through it inside the pipeline's dispatch" — post-K3 that is only true under explicit `WARSHA_LLM_PROVIDER=fake`.
  Reword to match the new honest behavior.
- **F4 (observation, out of packet):** production daemon startup registers `MockProvider` ("Register mock provider
  for testing", l.5480-5486) — pre-existing at base `e6b3e6d` (l.5425), untouched by K3, not covered by any K3 gate;
  it only answers when explicitly routed, so no silent use. Flag for a later packet if desired.

## Blockers

1. **F1** — fix `EV/tools/k3-mock-scan.sh` (pathspec + cfg(test)-aware filtering), re-run `bash tools/k3-mock-scan.sh`
   → exit 0 with `no production MockRoutineRunner` while actually scanning the two K3 crates' `src` trees.
   No product-code change needed; K3.1/K3.3/K3.4/K3.5/fmt already green.
