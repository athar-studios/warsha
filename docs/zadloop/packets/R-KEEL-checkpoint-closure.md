# R-KEEL CP1 closure — independent re-review of the two checkpoint HIGHs (Reviewer lane)

- Tree: worktree at `d120477` (branch `zl-keel-cp1-closure`), clean at the start of this pass.
- Lane: Reviewer, **read-only** — no product code, test or config was edited; the only write of this pass is
  this file. Findings are reported, not repaired. `PROGRESS.md` was deliberately left untouched for the same
  reason (it is outside this pass's write scope); the PM should fold the handoff below into it.
- Scope: **only** the two HIGH rows of `R-KEEL-checkpoint-review.md` (rows 1 and 2) and the closure question.
  The MEDIUM/LOW backlog of that review is not re-litigated here; it stays queued for R-SEC.
- Method: read the diff `a94ea19..d120477` (two files, +207/−59: `gate_evidence.rs`, `warshad/src/lib.rs`),
  then read the code the diff now reaches (`CommandPolicy::execute`/command_for, `require_pinned_launch`,
  `ProcessManager::spawn`), then ran the three proving test filters, and executed two bounded probes in
  `/tmp` scratch repositories to test the one premise that decided the HIGH 1 verdict.
- Verdict: **CHECKPOINT FAIL** — one HIGH still open. HIGH 2 is closed; HIGH 1 is closed for `run_tests`
  and **open for the second spawn in the same Gate C path** (`git_capped`). The fix matches the repair that
  was proposed, exactly — the *proposal* was under-scoped, not the fix.

## Verdicts at a glance

| HIGH | Claimed fix | Verdict | Load-bearing evidence |
|---|---|---|---|
| 1 — Gate C evidence spawns with the daemon environment, no group kill | `run_tests` → `policy.with_timeout(..).with_output_cap(64 KiB).execute(..)`; daemon passes its policy; two new tests; `a_chatty_test_is_capped` restored | **NOT CLOSED** (`run_tests` half closed; `git_capped` half open) | `gate_evidence.rs:179-183` is now the policy path, but `gate_evidence.rs:151-169` still spawns with no `env_clear`, no timeout, no process group — and the program git runs there is steered by repository config the agent writes |
| 2 — `mcp.connect` launches unpinned packages | `require_pinned_launch` after `check_command` in the Stdio arm | **CLOSED** | `lib.rs:3840-3841`, same values reach the spawn (`mcp_transport.rs:915-931`), HTTP/WS and `plugins.*` untouched, negative test refuses before spawn |

## HIGH 1 — Gate C evidence execution: NOT CLOSED

### (a) The `run_tests` path really goes through the policy — confirmed

`run_tests` no longer builds a `Command` at all. It clones the caller's policy, applies the Gate C deadline
and the 64 KiB cap, and executes (`crates/warsha-pipeline/src/gate_evidence.rs:179-183`). The guarantees
therefore come from one place, `CommandPolicy::execute` → `execute_with_pid`
(`crates/warsha-pipeline/src/command_policy.rs:362-483`):

- allow-list re-check **inside** the same function that spawns: `check_program` at `:384`, `cmd.spawn()` at
  `:406` — no "check here, spawn there" gap;
- `kill_on_drop(true)` `:391`, `env_clear()` `:392`, the fixed `MINIMAL_CHILD_ENV` floor `:393-395`, `PATH`
  replaced by the daemon's own `:397` — so no inherited variable survives except `PATH`;
- `process_group(0)` on Unix `:400-401`, and on timeout `SIGKILL` to the group `:465-468`
  (`kill_process_group`, `:594-601`), then `start_kill()` + an awaited `wait()` `:469-470` — the group is
  signalled and the direct child is reaped.

Capture cap: `with_output_cap(GATE_EVIDENCE_CAPTURE_BYTES)` (`gate_evidence.rs:182`) is honoured by the
per-stream readers (`command_policy.rs:423-424`, `read_stream_capped` `:562-583`) and by `cap_combined`
(`:604-616`). **The 64 KiB is now the combined stdout+stderr budget, not per stream** — see residual R1.

Truncation marker: `run_tests` appends the evidence module's own `TRUNCATION_MARKER`
(`gate_evidence.rs:22`, placed at `:187-204`, `"\n…[truncated]"`). The literal `"1 MiB"` marker lives only in
`CommandOutput::format_text` (`command_policy.rs:215-233`, text at `:223`), which this path never calls — so
**no "1 MiB" marker can reach Gate C evidence**. The earlier concern does not materialise. `TestRun`'s wire
shape is unchanged (eight fields, `gate_evidence.rs:46-64`, populated at `:205-214`).
`GateEvidenceError::Timeout` is preserved via the `TimedOut` arm (`:216-218`); every other policy error
becomes `Io` (`:219`), which is why the caller's pre-check below still matters for the wire code.

### (b) The other spawn in the same path is **not** out of scope — the claimed reading does not hold

The brief asks me to confirm that `git_capped` is "daemon-authored fixed-argv git, not agent-authored" and
therefore outside the HIGH. The first half is true of the **argv** and false of the **program git runs**, so
the conclusion does not follow.

What the code does: `git_capped` (`crates/warsha-pipeline/src/gate_evidence.rs:151-169`) is a bare
`tokio::process::Command::new("git")` (`:152`) with `.stdin(null)`, stdout piped, stderr dropped — **no
`env_clear()`, no `MINIMAL_CHILD_ENV` floor, no `process_group(0)`, no timeout, no group kill**. It runs
twice in every evidence collection, before `run_tests` (`:127-128` vs `:135`). So every sentence of the
original HIGH applies to it verbatim: daemon environment, unbounded wall clock, no group semantics.

Why fixed argv does not save it: `git diff` executes the external diff named by repository configuration
(`diff.external`), and `git status` runs the `core.fsmonitor` hook — configuration, not argv, and it is
*repository* configuration, i.e. a file in the tree the agent is working in. Measured on this host
(git 2.53.0, scratch repos under `/tmp`, nothing in the project touched):

| probe | result |
|---|---|
| `git config diff.external '<probe>'` then `git diff HEAD` | the configured program **ran** (`EXT-DIFF-RAN`) |
| `git config core.fsmonitor '<probe>'` then `git status --porcelain` | the configured program **ran** (`FSMON-RAN`; `git diff` runs it too, via the index refresh) |
| linked worktree (`git worktree add` — the daemon's shape), `git config diff.external …` run **inside the worktree**, then `git -C <worktree> diff HEAD` | the configured program **ran** (`PROBE-WT-EXTERNAL-DIFF-REACHED`); the value landed in the shared config, exactly as `git -C` reads it |

The agent can write that configuration, and the daemon runs gate evidence in the same directory:
`RunCommand` executes under the command policy in the executor's working directory
(`crates/warsha-pipeline/src/agent_tools.rs:437-447`), which is the run's own worktree
(`crates/warshad/src/lib.rs:5482-5484` doc, `:5506`); `git` is in `DEFAULT_ALLOWED_COMMANDS`
(`command_policy.rs:48`); `gates.evidence` collects git output in that same worktree (`lib.rs:2826-2835`,
`:2846`). So the program that ends up running under the daemon's environment is named by the agent, not by
the daemon.

Impact of the inheritance, bounded to what this host can show: `WARSHA_AUTH_TOKEN` is read from the
environment as the daemon's bearer token (`crates/warshad/src/lib.rs:6746`), so a container/operator deploy
that supplies the token that way hands the owner credential to an agent-named child; a desktop daemon
launched from a shell hands over the owner's shell exports — the `AWS_*`/`GITHUB_TOKEN`-class material the
original HIGH named. The no-timeout half is also live: a `core.fsmonitor` that sleeps hangs the RPC, since
`GATE_EVIDENCE_TIMEOUT` bounds only `run_tests`.

Minimal fix for the PM's dispatch (**not applied**): collect both git commands through the same policy seam
and close the program-selection vector — `git -c core.fsmonitor= -C <work_dir> diff --no-ext-diff <base>` and
`git -c core.fsmonitor= -C <work_dir> status --porcelain`, via `execute`. I verified the two flag forms on
this host: `diff --no-ext-diff HEAD` suppresses the external diff, `-c core.fsmonitor= status --porcelain`
suppresses the hook, and together neither program runs. Two care points for whoever implements it: the flags
must sit **after** the subcommand (`git --no-ext-diff diff` is rejected as an unknown global option — I hit
that), and these daemon-authored calls need their own `CommandPolicy::from_config(&["git".into()])` rather
than the owner's `RunCommand` allow-list, or a narrowed allow-list that omits `git` would break Gate C
evidence.

### (c) The allow-list still runs at the caller — and is now checked twice (benign)

`lib.rs:2842-2845` builds `CommandPolicy::from_config(&self.state.config.allowed_commands)` and refuses with
`-32005` before the call, so nothing was relocated or skipped. `execute` additionally re-checks the
*resolved* first token (`command_policy.rs:384`). That is a redundant second check with the same policy
object — not a skip and not a different rule: the caller judges the raw wire `program`, the policy judges the
resolved first token, and where those differ (a `program` that carries its own arguments) the caller's check
is the stricter one and refuses first. Wire behaviour is unchanged: a refused program is `-32005`, an
in-path refusal `-32000`.

### (d) The three tests, judged

- `the_evidence_child_sees_none_of_the_daemons_variables` (`gate_evidence.rs:404-446`) — **one-sided**. It
  plants four daemon variables and asserts their names and values are absent from the captured stdout. It
  never asserts `evidence.tests.success`, that stdout is non-empty, or that the floor is present
  (`PATH=`, `TERM=dumb`). A child that printed nothing — a failed spawn, a changed capture path, `env` not
  found — satisfies every assertion. It passes today for the right reason (I ran it, see below), and the
  property *is* proven two-sided by the sibling it mirrors,
  `command_policy::a_child_that_prints_its_environment_sees_none_of_the_daemons_variables`
  (`command_policy.rs:807-871`), which asserts absence **and** the floor's presence and the daemon `PATH`.
  Grade: MEDIUM-grade test weakness, not a reason to hold the row. Secondary: both tests mutate
  process-global environment; the `command_policy` one serialises on `ENV_TEST_LOCK` (`:619`, `:809`) and
  this one does not — a parallel-suite flake risk, not a security one.
- `a_child_that_spawns_a_grandchild_and_hangs_is_group_killed_at_timeout` (`:448-497`) — **discriminating**.
  The shell records its background child's pid, the deadline is 500 ms, and OS-level liveness (`kill -0`) of
  the grandchild is polled for up to 5 s. Against the pre-fix code (bare `Command` + `kill_on_drop`) the
  direct child dies and the 30-second grandchild survives, so the test would fail; the group kill is the only
  thing that makes it pass. Honest and two-sided for what it names.
- `a_chatty_test_is_capped` (`:305-320`) — byte-for-byte the version introduced in `d1cce2b`: I diffed the
  test text at `d1cce2b`, `4e974db` and `a94ea19` and no commit in this tree ever weakened it, so "restored
  verbatim" holds as far as committed history can show. It asserts `truncated`, `len <= cap + marker` and
  `ends_with(marker)` on stdout only — single-sided, but not vacuous.

Residual R1 (outside the two-HIGH scope, no effect on the verdict): `GATE_EVIDENCE_CAPTURE_BYTES`'s doc still
says "The most bytes kept from **each of** stdout and stderr" (`gate_evidence.rs:17`) while `cap_combined`
now enforces it as the **combined** budget (`command_policy.rs:603-616`). Evidence output can shrink from
128 KiB (64+64) to 64 KiB total, and a noisy stdout now silently costs the reviewer stderr detail. Decide
once: pass `cap * 2` to `with_output_cap`, or correct the constant's doc and `TestRun::truncated`'s doc
(`gate_evidence.rs:62`) to say "combined".

## HIGH 2 — `mcp.connect` launch pinning: CLOSED

- **(a) Same values reach the spawn; no TOCTOU.** `config` arrives by value; the Stdio arm reads
  `config.command` and `&config.args` for the allow-list and the pin rule (`lib.rs:3835-3841`) and the same
  `config` is then moved into `self.state.mcp.connect(config)` (`:3855-3858`). The transport trims that same
  `command` and hands that same `&config.args` to the process manager (`mcp_transport.rs:915-931`), and the
  manager builds `Command::new(program)` from it verbatim (`process_spawn.rs:729-742` via `command_for`,
  `:411-435`). Nothing between the check and the spawn re-reads the store, re-splits the command, or
  substitutes a program; `require_pinned_launch` trims/lowercases the same token the spawn trims
  (`wave2.rs:765-783`), and no shell is involved anywhere on the path.
- **(b) HTTP/WS arms unchanged and still transport-checked.** The whole `warshad/src/lib.rs` hunk set is:
  the comment (`:3827-3831`), the one added line (`:3841`), and the new test. `check_transport_url`
  (`:3846-3849`) is untouched.
- **(c) `plugins.*` unchanged, no duplication or divergence.** `check_plugin_launch` (`:2244-2256`) still
  applies allow-list + pin grammar + env-name check, and all three call sites still run it before their
  connect (`:4693` install → `:4760`, `:4736` toggle → `:4778`, `:4805` configure → `:4827`).
  `wave2.rs` is untouched by the diff, so there is one pin rule, not two.
- **(d) The new test** (`:9094-9138`): case (a) is a genuine negative — the configured policy allows both
  `npx` and the probe program, so the pin rule is the only thing that can refuse; it asserts
  `POLICY_REFUSED` **and** the `unpinned package \`pkg\`` text, and the refusal precedes any spawn. Case (b)
  is honest but partial: the probe is the test binary itself (`probe_command`, `:9020-9031`), not a package
  launcher, so it proves the rule does not over-block a non-launcher launch and that the handshake still
  works — it does not exercise a *pinned* launcher end to end, which offline it cannot. The pinned side of
  the grammar is covered two-sided by `wave2_tests.rs:137-161`. One shape to record so a later refactor does
  not create the gap: `require_pinned_launch` classifies the raw `command` token, so a launcher carrying its
  own arguments inside the command string (`"npx -y pkg"` with empty `args`) is not recognised as a launcher.
  It is **not** a bypass today, because the spawn uses that string verbatim as the program
  (`Command::new("npx -y pkg")` → ENOENT) while `check_command` splits it only for the allow-list — but a
  future "split the command line at spawn" change would turn it into one.

## Test runs on this host (`--offline`, no network)

| command | result |
|---|---|
| `cargo test --offline -p warsha-pipeline gate_evidence` | `test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 435 filtered out` (0.52 s), exit 0 |
| `cargo test --offline -p warshad mcp_connect_requires_pinned_stdio_launch` | `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 165 filtered out` (0.42 s), exit 0 |
| `cargo test --offline -p warsha-pipeline command_policy` | `test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 433 filtered out` (2.01 s), exit 0 |

Both new tests appear as `... ok` in the logs, and `a_chatty_test_is_capped` / the two new gate-evidence
tests are among the nine. Nothing failed on my run. Not run: the full `-p warsha-pipeline` and `-p warshad`
suites (only the filtered selections; both crates did compile in these runs), the Windows-only paths (no
Windows host), and anything needing the network. The point worth stating plainly: **HIGH 1's still-open row
passes its own tests and all of the suites above** — the tests are not the verdict here.

## What was executed, and what was not

- Executed: the three test filters above; the two `/tmp` git probes (config-steered external diff and
  fsmonitor, plain repo and linked worktree, plus the two mitigation flags) and the `diff --no-ext-diff`
  placement check. The probes wrote only to their own scratch directories, which were removed.
- Not executed: the end-to-end `gates.evidence` RPC against a daemon with a poisoned config (that needs a
  running daemon and a Gate C run; the load-bearing fact — that git runs the configured program — was
  measured directly instead), and the Windows ACL/`process_group` paths.
- No secret value appears in this file: variables are named, values never. Nothing was pushed, published or
  released.

## Disposition / handoff

- HIGH 2: closed at `6120d4c`; nothing further needed.
- HIGH 1: dispatch one change — route both `git_capped` calls through `CommandPolicy::execute` under a
  daemon-owned `git` policy, with `-c core.fsmonitor=` and `diff --no-ext-diff` — plus R1's cap/doc decision,
  plus the two missing assertions in the env test if that row is picked up with it. Scope chosen by the PM;
  no fix applied here.
- I changed no product code, so this review stands as the closure judgment of `d120477`.

CHECKPOINT FAIL — one open HIGH: Gate C evidence still starts an agent-steerable program with the daemon's environment, no timeout and no group kill (`crates/warsha-pipeline/src/gate_evidence.rs:151-169`, `git diff`/`git status` executing repository-config-named programs), while the `run_tests` half of HIGH 1 and all of HIGH 2 are genuinely fixed and tested.
