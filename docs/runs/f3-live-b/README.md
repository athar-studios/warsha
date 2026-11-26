# F3 live OpenCode proof — Attempt B (2026-11-26)

## Verdict: PASS (core proof + capture proof); external scratch write noted

A real installed `/home/moe/.opencode/bin/opencode` (`opencode v2.4.1`) running `opencode/big-pickle` wrote all four `proofcalc` implementation modules (`src/scaffold.rs`, `src/domain.rs`, `src/engine.rs`, `src/provider.rs`) in parallel inside a single complete Warsha swarm run (`01M8AW3M2D30WSNFQ94ECHM0Z4`) driven via `warshad` RPC from `idea` through `gate_a`, `gate_b`, `gate_c`, `gate_d` to `feedback` (`completed`). No fake, fixture, or scripted coding backend was used, and no production code in this worktree was modified.

What this proves:

- Live `opencode/big-pickle` via `WARSHA_CODING_BACKEND=opencode` (`max_parallel_agents=4`, planning/review roles routed to `fake`) succeeded on the first attempt for all four lanes with zero HTTP 429 retries.
- Each of the four persisted `swarm_coding_result` events in [events.json](events.json) (extracted in [swarm-coding-results.json](swarm-coding-results.json)) carries `success: true`, `backend: "opencode"`, non-empty `files_changed` naming only that lane's assigned file, and the full unified `diff` (`diff_truncated: false`).
- All four lane branches merged onto `warsha/run-01M8AW3M2D30WSNFQ94ECHM0Z4` (`f297d67`, see [run-branch-log.txt](run-branch-log.txt)). Exact `git show warsha/run-01M8AW3M2D30WSNFQ94ECHM0Z4:src/<lane>.rs` bytes (saved under [git-show](git-show/), SHA-256 in [module-sha256.txt](module-sha256.txt)), combined with assistant-authored [Cargo.toml](sequential/Cargo.toml), [src/lib.rs](sequential/src/lib.rs), and [tests/proof.rs](sequential/tests/proof.rs) (allowed as sequential follow-ups per [SPEC.md](../../proof-project/SPEC.md) §§2–3) in an isolated temp crate, compiled and passed `cargo test --offline` (`1 passed; 0 failed`, [cargo-test.log](cargo-test.log)).

What this did NOT prove / provenance limits:

- **External scratch writes (`SPEC §3` strict path rule):** Although each lane's `write` tool targeted only its assigned file inside its subtask worktree, OpenCode invoked shell commands that wrote scratch verification files outside the worktree (and one lane ran `rustup toolchain install stable --profile minimal`, populating `/home/moe/tools/f3-live-b/home/.rustup`). Specifically, per [opencode-writes-and-tmp.txt](opencode-writes-and-tmp.txt) and [opencode-tool-calls.txt](opencode-tool-calls.txt):
  - `engine` (`01M8AW3QPACZ6B7W2ZKC33M8PX`) wrote `/tmp/opencode/engine_check.rs` and compiled `/tmp/opencode/engine_check` (`rustc` test binary).
  - `scaffold` (`01M8AW3QPAARKEXJ62GHP9SZXG`) attempted `rustc ... -o /tmp/opencode/scaffold-tests` (failed before `rustup` finished; no binary created by it).
  - `provider` (`01M8AW3QPAPVEE52XCW3AGE61V`) attempted `rustc ... -o /tmp/opencode/provider.rlib` (failed before `rustup` finished).
  - Other `/tmp/opencode` files (`libdomain.rlib`, `money_main.rs`, `money_check`, `libprovider.rlib`, `probe_required.rs`, `scaffold_check/*`) appeared during the same minute window (`06:49`–`06:51`) and did not come from Attempt B's OpenCode sessions (no matching shell commands in Attempt B's `opencode.db`), indicating parallel activity from Attempt A sharing `/tmp/opencode`.
- **Model identity provenance:** Warsha's persisted events do not record the upstream LLM model name. Model identity (`providerID: "opencode"`, `id: "big-pickle"`) is established from the isolated config `/home/moe/tools/f3-live-b/home/.config/opencode/opencode.json` and the `session_message` rows in `/home/moe/tools/f3-live-b/home/.local/share/opencode/opencode.db` across all four lane sessions (`ses_dea3e1b78f...`, `ses_dea3e192ef...`, `ses_dea3e1557f...`, `ses_dea3e14dbf...`); `session_v2.model` column itself was `NULL`.
- **Non-coding roles:** All non-coding pipeline roles (`intake`, `researcher`, `pm`, `designer`, `architect`, `reviewer`, `qa`, `security`, `release`, `marketer`, `feedback`, `secretary`) used `fake/warsha-fake-v1`; gates A–D were approved programmatically via [walk.py](walk.py).

## Run & model summary

- **Worktree / base commit:** `r-next/f3-live-b` at `6ca306e`
- **Daemon isolation:** `/home/moe/tools/f3-live-b/` (`CARGO_TARGET_DIR=/home/moe/tools/f3-live-b/target`, `warshad` HTTP `19210` / RPC `19211`, private OpenCode service port `19217`)
- **Run ID:** `01M8AW3M2D30WSNFQ94ECHM0Z4` (final stage `feedback`, status `completed`)
- **Run branch HEAD:** `warsha/run-01M8AW3M2D30WSNFQ94ECHM0Z4` @ `f297d67`
- **Coding backend / model:** `opencode` (`opencode v2.4.1`) / `opencode/big-pickle` (0 retries, 0 429s)

| Lane | Subtask ID | OpenCode Session | `files_changed` | Module SHA-256 |
| --- | --- | --- | --- | --- |
| `scaffold` | `01M8AW3QPAARKEXJ62GHP9SZXG` | `01M8AW3QTP0Y9GZWQAAG0Z461P` | `["src/scaffold.rs"]` | `80f5891946690af4a9d913d893562205605f3c7e0082c5469ecfde1f9e9af698` |
| `domain` | `01M8AW3QPA9B1R63Q2E0E0G6YH` | `01M8AW3QTY22W9BMYMJ9CNEJM2` | `["src/domain.rs"]` | `846442bfeb2a21249e50577b26fea406a0355eab7f534257dcba825aa52c9437` |
| `engine` | `01M8AW3QPACZ6B7W2ZKC33M8PX` | `01M8AW3QV2TC47425BEYVZJ5SW` | `["src/engine.rs"]` | `96ecab69e748b808e34172a84da95ce41431a5a1af628701460dfead8df8cc74` |
| `provider` | `01M8AW3QPAPVEE52XCW3AGE61V` | `01M8AW3QV1AGNN8755BZVFS0F1` | `["src/provider.rs"]` | `3ca8afaa43a997f68ed4f7606333d0db9198b434790e769156b388628bb1ce49` |

## Artifacts in this directory

- [walk.py](walk.py), [walk-live.log](walk-live.log), [stage-trace.json](stage-trace.json), [daemon.log](daemon.log), [build.log](build.log)
- [run-final.json](run-final.json), [subtasks.json](subtasks.json), [worktree.json](worktree.json), [events.json](events.json), [swarm-coding-results.json](swarm-coding-results.json)
- [run-branch-log.txt](run-branch-log.txt), [git-show](git-show/), [module-sha256.txt](module-sha256.txt)
- [opencode-tool-calls.txt](opencode-tool-calls.txt), [opencode-writes-and-tmp.txt](opencode-writes-and-tmp.txt)
- [sequential](sequential/) (`Cargo.toml`, `src/lib.rs`, `tests/proof.rs` authored by the driver/assistant after run completion) and [cargo-test.log](cargo-test.log)
