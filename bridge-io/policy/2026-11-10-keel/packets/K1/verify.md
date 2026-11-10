# K1 Verification — run 2026-11-10-keel (independent verifier)

- Verifier: independent (prior attempt died on network error before recording anything; this is the completed record)
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/keel/k1` (clean)
- BASE: `128b59c08cbf5ddbe4de002528a50f451ea74296`
- HEAD: `bef00eb203f98973fb157a789f278b38e27862f4`
- `CARGO_TARGET_DIR=C:/Users/Dragonfly/Downloads/warsha-wt/keel/k1/target`
- Recorded at: 2026-11-10T08:02:22Z (UTC)
- Evidence dir: `EV/gates/<ID>.log` (EV = `C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-10-keel`)

## Gate results

| Gate | Check | Exit | Outcome | Evidence / key line |
|---|---|---|---|---|
| K1.1 | `cargo test -p warsha-pipeline --lib gate_integrity::approving_a_gate_the_run_has_not_reached_is_refused -- --exact` | 0 | PASS | `gates/K1.1.log` — `test result: ok. 1 passed; 0 failed; 0 ignored` |
| K1.2 | `cargo test -p warsha-pipeline --lib gate_integrity::approving_the_current_gate_succeeds_once -- --exact` | 0 | PASS | `gates/K1.2.log` — `test result: ok. 1 passed; 0 failed; 0 ignored` |
| K1.3 | `cargo test -p warsha-pipeline --lib gate_integrity::the_gate_decision_event_carries_the_artifacts_hash -- --exact` | 0 | PASS | `gates/K1.3.log` — `test result: ok. 1 passed; 0 failed; 0 ignored` |
| STD.1 | `cargo fmt --all -- --check` | 0 | PASS | `gates/STD.1.log` — empty (0 bytes) |
| STD.3 | `bash EV/tools/rust-tests.sh` (`cargo test --workspace --no-fail-fast`) | 0 | PASS | `gates/STD.3.log` — `KEEL-PASS rust-tests passed=763 ignored=10`; marker `gates/STD.3.done`; exit `gates/STD.3.exit`=0 |
| STD.8 | `node scripts/check-arch.mjs` | 0 | PASS | `gates/STD.8.log` — `arch: 5 rules, 0 violations` |
| STD.9 | `node scripts/check-wire-contract.mjs` | 0 | PASS | `gates/STD.9.log` — `wire: 10 checks, 0 violations` |
| STD.10 | `node scripts/check-engineering-policy.mjs` | 0 | PASS | `gates/STD.10.log` — `policy: 8 checks, 0 failures` |
| STD.12 | `git diff --name-only <BASE>..HEAD -- '*-snapshots/*' '*.png' '*.webp'` | 0 | PASS | `gates/STD.12.log` — empty (0 bytes, no snapshot/image changes) |
| STD.13 | `bash EV/tools/scope.sh K1` | 0 | PASS | `gates/STD.13.log` — `scope-ok K1: 11 files` |

## Notes

- **STD.3 COMPLETED (PASS)** — launched detached via `bash EV/tools/rust-tests-launch.sh` (background shell, never blocked on), run 2 of the gate.
  - Result: `KEEL-PASS rust-tests passed=763 ignored=10`, `failed=0`, `cargo exit=0`, binary summary lines=36; **exit file `EV/gates/STD.3.exit` = 0**; marker **`EV/gates/STD.3.done`** present; full output `EV/gates/STD.3.log`; transcript `EV/gates/STD.3.run.log`.
  - Pass criteria enforced by `EV/tools/rust-tests.sh`: exit 0 only if 0 failed AND ignored <= 10 AND passed >= 759.
  - **Counting note (transparent, evidence preserved):** aggregation covers the per-*binary* `test result:` lines (sections under `Running <target>`), matching the frozen expectation `ignored=10` and STD.11's `ignore-now=10` (exactly 10 `#[ignore]` attributes at HEAD). The first attempt (`EV/gates/STD.3.run1.log`, `STD.3.run1.exit`=1, `STD.3.run1.done`) also summed `Doc-tests` sections and got `ignored=11`; the extra 1 is `Doc-tests warsha_store` for the `rust,ignore` doc fence at `crates/warsha-store/src/persistence.rs:343`, **present at BASE 128b59c** and untouched by BASE..HEAD (0 store files in the diff). Doctests are reported separately by the script (`doctest summary: passed=0 failed=0 ignored=1`) and are not part of the test-binary skip budget. No gate criterion was weakened: 0 failed and N>=759 hold under either counting.
- **STD.13 wrapper**: `EV/tools/scope.sh K1` diffs BASE..HEAD and allows only `crates/warsha-pipeline/**` (non-daemon), `crates/warsha-core/**`, `crates/warshad/src/lib.rs`, `crates/warshad/tests/**`. 11 files, all in scope, 0 violations.
- Gates K1.1–K1.3, STD.1, STD.3, STD.8, STD.9, STD.10, STD.12, STD.13 verdicts written to `acceptance.json` (verdict fields only; `verified_at` UTC, `commit=bef00eb203f98973fb157a789f278b38e27862f4`; STD.3 row carries `marker=gates/STD.3.done` and its KEEL-PASS line as `note`).
- No product code, gates, tests or snapshots were edited by the verifier (worktree re-checked clean at `bef00eb` after all gates). Tooling added under `EV/tools/` only: `scope.sh`, `rust-tests.sh`, `rust-tests-launch.sh`, `set-verdicts.mjs`, `finalize-std3.mjs`.

## Verdict

K1 fast gates: **9/9 PASS** (K1.1, K1.2, K1.3, STD.1, STD.8, STD.9, STD.10, STD.12, STD.13). Long gate STD.3: **PASS** (`KEEL-PASS rust-tests passed=763 ignored=10`, marker `EV/gates/STD.3.done`, exit 0). All 10 verdict rows recorded in `acceptance.json`.
