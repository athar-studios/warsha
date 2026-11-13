# R-KEEL CP2 closure — independent re-review of the last open checkpoint HIGH (Reviewer lane)

- Tree: worktree at `a5f69c2` (branch `zl-keel-cp2-closure`), clean at the start of this pass; CP2 is
  `eb00ced` (fix) + `a03b6ee` (test), merged at `a5f69c2`.
- Lane: Reviewer, **read-only** — no product code, test or config was edited; the only write of this pass is
  this file. Findings are reported, not repaired. `PROGRESS.md` was left untouched for the same reason (it is
  outside this pass's write scope); the handoff below is for the PM to fold in.
- Baseline: my own two prior packets — `R-KEEL-checkpoint-review.md` (CHECKPOINT FAIL, 2 HIGHs) and
  `R-KEEL-checkpoint-closure.md` (HIGH 2 CLOSED; HIGH 1's `run_tests` half closed, `git_capped` half open).
  This pass judges **only** that last open row: Gate C evidence's `git_capped` spawning an agent-steerable
  program with the daemon environment, no timeout and no group kill.
- Scope of change: `git diff a4e0451..a5f69c2 --stat` is **one file**, `crates/warsha-pipeline/src/gate_evidence.rs`
  (+113/−26). Nothing in `warshad`, `command_policy.rs`, `process_spawn.rs` or `wave2.rs` moved, so the fixes
  this review judged closed in CP1 are structurally untouched (re-read, not assumed).
- Method: read the diff, then the current `git_capped`, then the code it now reaches
  (`CommandPolicy::from_config`/`execute`/`execute_with_pid`/`read_stream_capped`/`cap_combined`), then the
  single production call site and its arguments, then ran the three proving test filters, then executed four
  bounded probes in `/tmp` scratch repositories and one `/tmp` scratch Rust binary to test the premises the
  fix rests on.

**Verdict: the last HIGH is CLOSED.** Both evidence git calls now run under the hardened policy with the
repo-config hook vectors neutralised, and nothing bare spawns in the evidence path. The checkpoint condition
is met. One new **MEDIUM (functional, not a security bypass)** regression found in the same change is
recorded below — it does not reopen the HIGH, and it must be dispatched separately.

## Verdict row

| HIGH (from `R-KEEL-checkpoint-review.md` row 1 / `R-KEEL-checkpoint-closure.md`) | CP2 claim | Verdict | Load-bearing evidence |
|---|---|---|---|
| Gate C evidence's `git_capped` spawns with the daemon environment, no timeout, no group kill; `git diff`/`git status` execute programs named by repository config the agent writes | both calls through `CommandPolicy::from_config(&["git"])…execute` with `-c core.fsmonitor=` and `diff --no-ext-diff` | **CLOSED** | `gate_evidence.rs:150-197` — policy built locally at `:157-159`, argv assembled at `:169-179`, `execute` at `:181-184`; the only two entry points are `:126` (`["diff", base]`) and `:127` (`["status","--porcelain"]`); `command_policy.rs:391-401` (kill_on_drop, env_clear, floor, daemon PATH, `process_group(0)`) and `:458-481` (group `SIGKILL` + reap) apply unchanged; no production `Command::new`/`tokio::process::Command` remains in the module |

## (a) Both git invocations go through the policy; no bare spawn remains

`git_capped` no longer builds a `Command` at all. It constructs a policy (`:157-159`), assembles the argv
(`:169-179`), and calls `policy.execute("git", &argv, work_dir)` (`:181-184`). Its two callers are the two
evidence calls, adjacent and unconditional, both before `run_tests`:

- `gate_evidence.rs:126` → `git_capped(work_dir, &["diff", base])`
- `gate_evidence.rs:127` → `git_capped(work_dir, &["status", "--porcelain"])`

The full evidence path is therefore `collect_gate_evidence_with_timeout` → `git_capped` ×2 → `policy.execute`
→ `execute_with_pid` → `cmd.spawn()`, plus `run_tests` → the caller's policy → the same `execute`. There is
one execution seam in the module now, and it is the hardened one.

`grep -n "tokio::process::Command\|process::Command\|Command::new" crates/warsha-pipeline/src/gate_evidence.rs`
returns four hits — `:264`, `:500`, `:540`, `:572` — and all four are inside `mod e5` (which starts at `:251`):
`git_repo`'s `git init/config/add/commit` fixture, the `kill -0` liveness poll of the grandchild test, and the
new test's `git config` + control `git diff`. **Production code (`:1-250`) contains no `Command::new` of any
kind.** The `use std::process::Stdio` that the bare spawn needed was moved into the test module (`:254`).

## (b) What `CommandPolicy::execute` guarantees, and that it still applies

`execute` (`command_policy.rs:362-370`) delegates to `execute_with_pid` (`:373-482`), unchanged by CP2 and
re-read in full this pass:

- allow-list re-check **inside** the spawning function: `check_program` at `:384`, `cmd.spawn()` at `:406`;
- `kill_on_drop(true)` `:391`, `env_clear()` `:392`, the fixed `MINIMAL_CHILD_ENV` floor `:393-395`
  (`PATH`/`LANG`/`LC_ALL`/`TERM=dumb`/`NO_COLOR` on Unix, `:106-112`), then `PATH` replaced by the daemon's
  own `child_path()` `:397`;
- `process_group(0)` on Unix `:400-401`; on timeout `kill_process_group(pid)` `:467` (`kill -KILL -- -<pid>`,
  `:594-601`), then `start_kill()` + an awaited `wait()` `:469-470`, so the group is signalled and the direct
  child reaped;
- `kill_on_drop` + `cmd.stdin(Stdio::null())`, stdout/stderr piped `:402-404`.

The two things the fix adds on top are the ones this row needed: a wall clock (`GATE_EVIDENCE_TIMEOUT`,
10 min, per call — `:158`) and the group semantics, so the `core.fsmonitor` hook that sleeps no longer hangs
the RPC. A git timeout now surfaces as `GateEvidenceError::Io` (`:181-184`, `TimedOut` is folded into `Io`
here) instead of a hang; that is a wire-text change only, still `-32000` from the handler
(`crates/warshad/src/lib.rs:2846-2848`).

## (c) Argv construction — no injection, no shell

- The policy program is the literal `"git"` (`:182`). `resolve_program_and_args` (`command_policy.rs:508-528`)
  with a non-empty arg list re-parses only the program token (`:519-522`), so `argv` reaches `cmd.args()`
  (`:389`) **verbatim as separate arguments** — no `split_command` re-tokenisation of the argument list, no
  shell, no quoting.
- `argv` is `["-c", "core.fsmonitor=", "-C", <work_dir>, <subcommand>, ("--no-ext-diff" if diff),
  …rest]` (`:169-179`). Every element except `<work_dir>` and `<base>` is a literal written in this module.
  `-c` (a global option) correctly precedes the subcommand; `--no-ext-diff` (a `git diff` option) correctly
  follows it — I re-checked git's grammar on this host (`git --no-ext-diff diff` is an unknown global option;
  `git diff --no-ext-diff` is accepted), and the new test exercises the accepted form end to end.
- `work_dir` is a `&Path` passed **twice**: as one argv element to `-C` (`:172-173`) and as `current_dir`
  (`:390`). It is not shell-joined, cannot start an option (`-C` consumes the next token unconditionally),
  and a non-unicode path is refused rather than lossily converted (`:166-168`).
- The subcommand and `rest` come from the module's own fixed call sites — confirmed by reading them: the only
  production caller of `collect_gate_evidence` is `crates/warshad/src/lib.rs:2846`, which passes the literal
  `"HEAD"` as `base` and the owner's `program`/`args` for the test command only. So the only externally
  influenced git element is `base`, and it is validated at `gate_evidence.rs:104-109` (non-empty, no leading
  `-`, no control characters) — a pre-existing check, still in force.

## (d) The dedicated policy neither depends on the owner allow-list nor widens anything

`CommandPolicy::from_config(&["git".to_string()])` (`:157`) is built from a hard-coded one-element slice, not
from `self.state.config.allowed_commands`; and `from_config` with a non-empty slice uses exactly that slice —
the permissive `DEFAULT_ALLOWED_COMMANDS` substitution happens only for an empty list
(`command_policy.rs:256-268`). So a narrowed owner policy that omits `git` cannot break Gate C, which was the
CP1 review's second care point. The policy object is a local of `git_capped`, used once at `:181` and dropped;
it cannot leak to any other caller, and no other call site can reach it.

The owner's policy is still the one that judges the **test command** (`crates/warshad/src/lib.rs:2842-2845`
then `run_tests` at `gate_evidence.rs:207-211`) — unchanged, and correctly so.

Two honest notes, neither a widening: an owner who deliberately removed `git` from the allow-list to stop
agent git usage still gets git *during evidence collection* (intended — evidence integrity is not an
owner-configurable choice), and the 10-minute bound now applies per git call, so one evidence request can
spend up to ~30 minutes (two git calls + the test command) before failing. `GATE_EVIDENCE_TIMEOUT`'s doc
(`:18-19`) still says it bounds "a Gate C test command" only.

## (e) The new test, judged honestly

`repo_config_hooks_do_not_run_during_evidence_collection` (`gate_evidence.rs:525-584`), `#[cfg(unix)]` like
its siblings. It writes a marker-touching `hook.sh`, installs it as **both** `diff.external` and
`core.fsmonitor` in the repo (`:539-546`) — i.e. exactly the two vectors I measured in the CP1 pass — changes
a tracked file, collects real evidence, and asserts in this order:

1. `!marker.exists()` (`:555-558`) — no configured program ran during collection;
2. the real diff is still there: `-base` and `+changed` present, `files_changed` contains `base.txt`
   (`:559-564`) — so a "neutralisation" that collected nothing (or errored into an empty diff) fails;
3. **control** (`:566-583`): a plain `git -c core.fsmonitor= diff HEAD` in the same repository, which must
   make the marker appear, asserted `success` first and then `marker.exists()`.

Is the blocking assertion non-vacuous? **Yes, for the vector the control exercises.** The control is the
fixed argv minus exactly one flag (`--no-ext-diff`), run in the same repo, after assertion 1, and it fails
loudly if the marker does not appear — so a machine where the hook is inert turns this test red rather than
green. That is the right shape: it proves the vector is live *now*, not that the test once saw it.

The half that is honestly weaker: the control deliberately disables `core.fsmonitor` (the comment at
`:566-571` explains why — its trigger needs index-extension state and is not deterministic everywhere), so
the test does not by itself prove the `status` side is discriminating. I measured that side separately on this
host: a plain `git status --porcelain` with `core.fsmonitor` set to a script **runs it** (twice), and
`git -c core.fsmonitor= -C . status --porcelain` does **not**. So on this host the `!marker.exists()`
assertion would catch a missing `-c core.fsmonitor=`. On a host where fsmonitor does not fire for `status`
the assertion is silent-but-passing; the test says so rather than pretending otherwise. Grade: adequate —
discriminating for the external-diff vector by construction, and for the fsmonitor vector by measurement.

Gap worth naming: no test covers a diff (or status list) **larger than the 64 KiB cap** — which is exactly
where the regression below lives.

## (f) The two adjacent items from the last review

- **Combined-cap doc now matches the code — fixed.** `GATE_EVIDENCE_CAPTURE_BYTES`'s doc reads "The most
  bytes kept combined from stdout and stderr" (`gate_evidence.rs:16`), which matches `cap_combined`
  (`command_policy.rs:604-616`) and `CommandOutput::truncated`'s doc (`:209-210`). Residual R1 is closed.
- **The env test is two-sided — fixed.** `the_evidence_child_sees_none_of_the_daemons_variables`
  (`:422-467`) keeps the four canary variables and the eight absence assertions (`:446-461`) and now also
  asserts `evidence.tests.success`, `!stdout.is_empty()`, `stdout.contains("PATH=")` and
  `stdout.contains("TERM=dumb")` (`:463-466`). A child that printed nothing now fails the test. The
  pre-existing process-global-env flake risk (no `ENV_TEST_LOCK`, unlike the `command_policy` sibling) is
  unchanged; it was a MEDIUM-grade test note, not a row.
- Unchanged and re-verified as such: the `TRUNCATION_MARKER` is still the module's own (`:21`, `:192-195`), no
  `"1 MiB"` marker can reach Gate C evidence, and `TestRun`/`GateEvidence` wire shapes are byte-identical
  (`:44-74`). `cap_string` is gone with no remaining reference (`grep cap_string` → none).

## New finding from this pass (report only — no fix applied)

| # | file:line | severity | finding |
|---|---|---|---|
| N1 | `crates/warsha-pipeline/src/command_policy.rs:562-583` (reader), consumed by `gate_evidence.rs:181-191` and `:207-211` | **MEDIUM (functional regression, no security impact)** | The capture cap is enforced by **closing the child's pipe** when it is reached (`read_stream_capped` reads `cap` bytes, probes one more, returns; the handle is dropped), not by draining and discarding. A producer that keeps writing therefore gets `SIGPIPE`/`EPIPE` and dies. For `git_capped` a non-zero status is a hard error (`gate_evidence.rs:185-191`), so **any evidence diff larger than 64 KiB makes the whole `gates.evidence` call fail** with `-32000` and no diff, no file list and no test result. Measured: a 70 075-byte diff → `git` exit `-13` (SIGPIPE) with the fixed argv and a reader that caps at 65 536 + 1. Before CP2 the same call used `.output()` (read to EOF) and `cap_string`, so it returned a truncated diff successfully — this half is new. The `run_tests` half is **older (CP1)** and was missed in my CP1 review: the same reader kills a chatty test command, so a *passing* command that prints more than 64 KiB on a stream is recorded as `success: false` with `truncated: true`. Measured with a `/tmp` scratch Rust binary: exit `101`, `failed printing to stdout: Broken pipe`. `a_chatty_test_is_capped` does not catch either: its `yes | head -c 200000` exits 0 because the shell's own pipeline absorbs the signal. Minimal fix shape for the PM's dispatch (not applied): keep draining (and discarding) the stream after the cap instead of dropping it, so `truncated` is reported without killing the producer; or, for the git call, treat a truncation-induced `SIGPIPE` death as success with `truncated = true`. The second alternative for `git` alone leaves the test-command half open. |

Smaller notes (LOW, no verdict effect): `GATE_EVIDENCE_TIMEOUT`'s doc still describes a test-command bound
only (`gate_evidence.rs:18-19`), while it now also bounds each git call; `git_capped` reports a killed
child as `"git diff HEAD failed in <dir>"` (`:186-190`), which hides the real cause (timeout or SIGPIPE) in
the RPC text; and `git_capped`'s new `(text, truncated)` contract has no reader — both call sites discard the
flag (`:126-127`), so the `TRUNCATION_MARKER` branch at `:192-195` is reachable only when stderr (not stdout)
was capped.

## Test runs on this host (`--offline`, no network)

| command | result |
|---|---|
| `cargo test --offline -p warsha-pipeline gate_evidence` | `test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 435 filtered out` (0.54 s), exit 0 — one more than the 9 of my CP1 pass: the new test. Integration binaries matched 0 tests (`fake_e2e` 6, `harness_skills_wiring` 4, `real_llm_failure` 1 filtered) |
| `cargo test --offline -p warsha-pipeline repo_config_hooks` | `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 444 filtered out` (0.03 s), exit 0 — `gate_evidence::e5::repo_config_hooks_do_not_run_during_evidence_collection ... ok` |
| `cargo test --offline -p warsha-pipeline --lib` | `test result: ok. 438 passed; 0 failed; 7 ignored; 0 measured; 0 filtered out` (30.09 s), exit 0 |

Nothing failed on my run. The one gap that matters: **every test above passes while N1 is live**, because no
test produces a capped diff — the same lesson as my CP1 pass, that the tests are not the verdict.

## What was executed, and what was not

Executed, all in `/tmp` scratch directories removed afterwards, nothing in the project touched:

1. `core.fsmonitor` vector, plain vs fixed shape — a script installed as `core.fsmonitor` **ran** (twice) for
   a plain `git status --porcelain`, and did **not** run for `git -c core.fsmonitor= -C . status --porcelain`.
   Confirms both the fix and that the new test's `status` half is discriminating on this host.
2. `diff.external` — covered by the committed test's control, which I ran (see the test table).
3. **Residual repo-config vectors of the same family, still live** with the fixed argv, both named by a
   `.gitattributes` the agent can write: `diff.<driver>.textconv` ran under
   `git -c core.fsmonitor= -C . diff --no-ext-diff HEAD` (suppressed by adding `--no-textconv`), and
   `filter.<driver>.clean` ran for the same call. Neither re-opens the HIGH: both programs now run with the
   cleared environment, the fixed floor, their own process group and the 10-minute bound — the same posture
   as the agent-authored test command that Gate C runs by design in the same function — so they grant no
   capability the agent does not already have there. Recommendation for the follow-up dispatch, not a fix
   here: add `--no-textconv` to the `diff` argv (one flag, same grammar position as `--no-ext-diff`) and put
   the sentence "Gate C evidence executes repository content by design; the environment is cleared, the wall
   clock bounded" in the K8 trust-boundaries text instead of the current claim that repository configuration is
   neutralised (`gate_evidence.rs:151-156`), which is stronger than what the two flags achieve.
4. The cap-by-closing-pipe behaviour behind N1: a real 70 075-byte diff through the fixed argv with a ledger
   reader capping at 65 536 + 1 (git exit `-13`), and a scratch Rust child printing ~200 KiB (exit `101`,
   `Broken pipe`).

Not executed: the `gates.evidence` RPC end to end against a daemon (needs a running daemon and a Gate C run;
the load-bearing mechanics — git's exit status when the reader closes, and the `!output.success` branch at
`gate_evidence.rs:185-191` — were measured and read directly instead), and N1 through `collect_gate_evidence`
itself (I may not add a test; the reader/child mechanics and the one-line status check are what it hinges on).
No secret value appears in this file: variables are named, values never. Nothing was pushed, published or
released, and no fix was applied — the PM dispatches.

## Disposition / handoff

- **Last HIGH: CLOSED** at `a5f69c2`. No further work on it.
- Dispatch (Coder lane, not done here): **N1** — do not kill a capped producer; report truncation instead.
  It is one reader change plus a test that a diff over the cap is still collected truncated, and it also
  repairs the CP1-era test-command half.
- Optional in the same dispatch: add `--no-textconv` to the `diff` argv; fold the residual repo-content
  vectors into K8's trust-boundaries text; correct `GATE_EVIDENCE_TIMEOUT`'s doc and `git_capped`'s error
  text; assert something about `git_capped`'s unused `truncated` return or drop it.
- HIGH 2 (`mcp.connect` pinning) remains closed; `warshad` is untouched by CP2, so nothing there needs
  re-judging.
- I changed no product code, so this review stands as the closure judgment of `a5f69c2`. The MEDIUM backlog
  of the original checkpoint review is unchanged and still queued for R-SEC.

CHECKPOINT PASS (no open HIGH)
