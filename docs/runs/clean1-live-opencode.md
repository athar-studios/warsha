# CLEAN-1 live OpenCode proof (2026-11-26)

## Verdict: core live-code/build proof PASS; full acceptance NOT MET

A real installed `/home/moe/.opencode/bin/opencode` v2.4.1 wrote all four implementation modules during real Warsha swarm run `01M8AJSFN4QXGAVSRTPZXCDY4A`. Warsha committed and merged those files onto `warsha/run-01M8AJSFN4QXGAVSRTPZXCDY4A`. Exact `git show` module bytes, without assistant repairs, compiled and passed `cargo test --offline` (one integration test). This is not a fake backend, fixture backend, scripted backend, or model API test.

Full requested evidence/spec acceptance remains **FAIL/incomplete**, not an unqualified PASS:

- Swarm consumes `CodingResult` but does not persist its `files_changed` or `diff` fields (`crates/warsha-pipeline/src/swarm_runtime.rs`, backend execution at line 657). RPC/store cannot supply those fields after this run. The per-lane `files-changed.txt` and `diff.patch` below are explicitly reconstructed from Warsha's lane commits, **not** the original backend result. No assertion that the original captured result equals the reconstruction is made.
- OpenCode wrote scratch harness files under `/tmp/opencode` (engine used `/tmp/opencode/feecheck`). Project commits contain only the assigned lane files, but the SPEC's literal rule that a lane writes nowhere outside its one path was not met. The harness's project-path confinement did not prevent external scratch writes. No assistant fixed or removed those files.
- Requested models are supported by private config changes and successful `opencode reload`, not a persisted model identity: OpenCode's private `session_v2.model` was null. This is a provenance limitation, not evidence of a different model.

No further model calls were made after three attempts. No credentials or host OpenCode config were read, printed, or copied. Only a newly generated private RPC transport token was used inside the isolated setup; it is not included here. The historical SPEC-only execution hold was superseded by the owner's explicit live authorization.

## Attempts

Each attempt is a fresh real project/run, with four parallel lanes. Planning and review roles use the local `fake` provider; coding resolves through supported `WARSHA_CODING_BACKEND=opencode` to `BackendFactory::opencode` / `opencode run`. No `WARSHA_CODING_BACKEND_FIXTURE` was set. The daemon inherited a deliberately empty environment, then explicit HOME/XDG/PATH/backend variables.

| Attempt | Requested keyless model | Run ID | Outcome |
| --- | --- | --- | --- |
| 1 | `opencode/deepseek-v4.1-flash-free` | `01M8AJPJJ6X62J0YRDM05APS8R` | Four failed lanes; `provider.free-limit`, HTTP 429, no files |
| 2 | `opencode/nemotron-3.5-super-vl-free` | `01M8AJR9B0AN4XY8B8ZRJ3HH40` | Four failed lanes; same free-limit 429, no files |
| 3 | `opencode/flint-40b-free` | `01M8AJSFN4QXGAVSRTPZXCDY4A` | Four succeeded lanes, merged; offline test passed |

Setup-only failures before model execution: invalid `approval_mode='never'` (correct value `never_ask`), then empty `roles.list` mistaken for an inventory, causing `No provider routed for role: Intake` in run `01M8AJM7S00BX8A9NBED39AV48`. Routing all explicit Role variants fixed setup. A concurrent `budget.set` caused a version-conflict warning; the corrected driver uses only `runs.start`'s budget. These are not hidden model retries.

## Durable evidence

Evidence directory: [clean1-live-opencode-evidence](clean1-live-opencode-evidence/). It includes all twelve subtask IDs/statuses, selected real OpenCode write/edit/error JSON events, per-lane commit diffs/stats, raw `git show` output, untracked-status observation, sequential follow-up bytes, and check logs. Full raw local logs and store remain at `/tmp/warsha-clean1-live`; they are not durable across host cleanup.

| Lane | Subtask ID (attempt 3) | Reconstructed changed paths | Lines added |
| --- | --- | --- | --- |
| scaffold | `01M8AJSGQHF9RTPJJKQ0EJ6GMZ` | `src/scaffold.rs` | 7 |
| domain | `01M8AJSGQH9RT88HQAGV4MQP5X` | `src/domain.rs` | 10 |
| engine | `01M8AJSGQH4VYN8839BR6C42JN` | `src/engine.rs` | 15 |
| provider | `01M8AJSGQH8KZXSV19YZ4GMT9E` | `src/provider.rs` | 3 |

Aggregate diff stat: **4 files changed, 35 insertions(+)**. No other project files landed. All four paths were observed as `?? src/<lane>.rs` while OpenCode was still running, before Warsha committed. Backend capture happens after CLI completion and before Warsha commit; the exact capture-time status was not separately instrumented. Consequently “untracked observed before capture/commit” is proven; precise capture-time status is inferred, not independently recorded. First two attempts have no successful `CodingResult`, so their original fields are absent, not asserted empty.

The raw outputs of `git show warsha/run-<id>:<path>` are in each attempt directory as `git-show-<lane>.rs.txt` (including fatal missing-path output for failed attempts). Reproduce for the successful branch:

```sh
RUN=01M8AJSFN4QXGAVSRTPZXCDY4A
WT=/tmp/warsha-clean1-live/data/worktrees/run-$RUN
for path in src/scaffold.rs src/domain.rs src/engine.rs src/provider.rs; do
  git -C "$WT" show "warsha/run-$RUN:$path"
done
```

The final module hashes are recorded in [module-sha256.json](clean1-live-opencode-evidence/module-sha256.json). OpenCode initially generated an invalid `i128::from(u128)` conversion, then itself replaced it with a cast before finishing. No assistant changed those model bytes. An OpenCode scratch-test expectation was also corrected by OpenCode, not the assistant.

## Exact authorship and offline assembly

OpenCode owns **every byte** of the four `src/{scaffold,domain,engine,provider}.rs` files in attempt 3's raw git-show output. The assistant owns **every byte** of `Cargo.toml`, `src/lib.rs`, and `tests/proof.rs` in [sequential](clean1-live-opencode-evidence/sequential/), written only after all four lanes completed. This sequential work is expressly allowed by SPEC sections 2 and 3. Cargo generated the lockfile and target artifacts. No dependency, extra module, or model-generated test was substituted into the proof.

This replay performs no API calls and needs no original daemon:

```sh
# Run from the clean1-live worktree root.
EVIDENCE="$PWD/docs/runs/clean1-live-opencode-evidence"
ASSEMBLY=$(mktemp -d /tmp/warsha-proofcalc-replay.XXXXXX)
mkdir -p "$ASSEMBLY/src" "$ASSEMBLY/tests"
for lane in scaffold domain engine provider; do
  cp "$EVIDENCE/attempt3/git-show-$lane.rs.txt" "$ASSEMBLY/src/$lane.rs"
done
cp "$EVIDENCE/sequential/Cargo.toml" "$ASSEMBLY/Cargo.toml"
cp "$EVIDENCE/sequential/src/lib.rs" "$ASSEMBLY/src/lib.rs"
cp "$EVIDENCE/sequential/tests/proof.rs" "$ASSEMBLY/tests/proof.rs"
(cd "$ASSEMBLY" && cargo test --offline) > /tmp/proofcalc-replay.log 2>&1
```

Original exact command: `cargo test --offline > /tmp/warsha-clean1-live/proofcalc-cargo-test.log 2>&1`, working directory `/tmp/warsha-clean1-live/proofcalc`. Exit 0. Output: `test four_public_contracts ... ok`; `1 passed; 0 failed`. Unit/doc suites each contain 0 tests; the integration suite actually executed one. Full output is [proofcalc-cargo-test.log](clean1-live-opencode-evidence/proofcalc-cargo-test.log).

## Live command sequence (requires fresh owner authorization to repeat API use)

The minimal production change only enriches the fake planning provider's four task descriptions with enough plain-word proofcalc contract detail for a real coder. Titles retain whole words scaffold/domain/engine/provider and disjoint `files:` markers. The daemon and all build artifacts were isolated under `/tmp/warsha-clean1-live`; no existing project repository was reused. `projects.create` with null `repo_path` creates a real git project, and Warsha creates the run branch/worktrees.

The exact corrected RPC walk is [walk.py](clean1-live-opencode-evidence/walk.py). It routes all thirteen roles to fake, creates the project, enables swarm with max 4, starts with budget 50000, approves Gate A/B, advances synchronously, then records run/subtasks/worktree/events at Gate C. It does not approve release or publish. This sequence recreates the environment (choose free ports after inspection, change the driver's constant too if occupied):

```sh
ss -ltn # 39765, 39766, 39767 were free for this run
BASE=/tmp/warsha-clean1-live
mkdir -p "$BASE/home/.config/opencode"
CARGO_TARGET_DIR="$BASE/target" CARGO_INCREMENTAL=0 cargo build -p warshad > "$BASE/build.log" 2>&1
python3 - <<'PY'
from pathlib import Path
import secrets
b=Path('/tmp/warsha-clean1-live')
p=b/'config.toml'
p.write_text('data_dir = "'+str(b/'data')+'"\nsocket_path = "'+str(b/'warshad.sock')+'"\nhttp_port = 39765\nws_port = 39766\nbind_host = "127.0.0.1"\nremote_bind = false\nauth_token = "'+secrets.token_hex(32)+'"\nallowed_origins = []\n')
p.chmod(0o600)
(b/'home/.config/opencode/opencode.json').write_text('{"$schema":"https://opencode.ai/config.json","model":"opencode/flint-40b-free","permission":"allow"}\n')
PY
# All opencode commands use ONLY this private environment, not ~/.config/opencode.
private_opencode() {
  env -i HOME="$BASE/home" XDG_CONFIG_HOME="$BASE/home/.config" \
    XDG_DATA_HOME="$BASE/home/.local/share" XDG_CACHE_HOME="$BASE/home/.cache" \
    PATH=/home/moe/.opencode/bin:/home/moe/.cargo/bin:/usr/local/bin:/usr/bin:/bin opencode "$@"
}
private_opencode service set port 39767
# The default managed service port was occupied by another session; never stop it.
# After each model change: private_opencode reload (both changes exited 0).
env -i HOME="$BASE/home" XDG_CONFIG_HOME="$BASE/home/.config" \
  XDG_DATA_HOME="$BASE/home/.local/share" XDG_CACHE_HOME="$BASE/home/.cache" \
  PATH=/home/moe/.opencode/bin:/home/moe/.cargo/bin:/usr/local/bin:/usr/bin:/bin \
  WARSHA_E2E_REAL=1 WARSHA_CODING_BACKEND=opencode \
  "$BASE/target/debug/warshad" --foreground --config "$BASE/config.toml" \
  --socket "$BASE/warshad.sock" --bind-host 127.0.0.1 \
  --http-port 39765 --ws-port 39766 > "$BASE/daemon.log" 2>&1 &
DAEMON_PID=$!
cp docs/runs/clean1-live-opencode-evidence/walk.py "$BASE/walk.py"
python3 "$BASE/walk.py" > "$BASE/walk-live.log" 2>&1
# Stop only DAEMON_PID launched above, never a pre-existing daemon.
kill "$DAEMON_PID"
```

Do not rerun over the preserved evidence directory without archiving it. No automatic suite invokes this driver. `WARSHA_E2E_REAL=1` selects real project initialization rather than the unit-test project fixture; it does not choose the coding backend.

## Verification and limits

- `cargo fmt --all -- --check`: exit 0.
- `CARGO_TARGET_DIR=/tmp/warsha-clean1-live/target CARGO_INCREMENTAL=0 cargo clippy -p warsha-backends -p warsha-pipeline -p warshad --all-targets -- -D warnings > /tmp/live-clippy.log 2>&1`: exit 0.
- `node scripts/check-engineering-policy.mjs`: 8 checks, 0 failures.
- `cargo test -p warsha-providers --lib fake::tests::plan_tasks_carry_disjoint_proofcalc_contracts -- --exact`: **1 passed**, not zero.
- `cargo test -p warsha-providers --lib fake::tests`: passed (mock-only).
- `cargo test -p warshad --lib tests::clean1_swarm::clean1_swarm_four_lanes_materialize_real_files -- --exact`: **1 passed**.
- `cargo test -p warshad --lib tests::clean1_swarm::clean1_swarm_four_lanes_scripted_backend_derives_files -- --exact`: **1 passed**. These regressions are mock-only and are not the live proof.

Rust checks/tests used `CARGO_TARGET_DIR=/tmp/warsha-clean1-live/target` and `CARGO_INCREMENTAL=0` to avoid shared artifacts. Full workspace tests were not run. Reviewer/verifier roles were capacity-merged in this delegated session; no independent review is claimed. No push, tag, publish, merge, unrelated cleanup, host config change, or other-worktree edit. Follow-up required for full acceptance: persist backend capture fields as receipts, and enforce/assess external scratch confinement before another authorized live proof.
