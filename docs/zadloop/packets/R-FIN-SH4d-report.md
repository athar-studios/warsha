# R-FIN-SH4d — `create_pr` draft support (Coder report)

Status: **implemented; T1–T3 green, T4 discrimination proven, every gate recorded with
its exit code.** Nothing was pushed, no PR was opened, no tag or release was made.

Branch `zl-fin-sh4d-draft` in the worktree `.agents/worktrees/zl-fin-sh4d-draft`, based on
`2b5c8b7` (the `repair/dev-csp-f474776` tip the task pinned). The packet, `PROGRESS.md` and
`DECISIONS.md` were **not touched** — the task reserves them for the PM at merge, which is the
one place this run departs from `AGENTS.md`'s "update `PROGRESS.md` before you stop"; this
report is the substitute and the task's instruction wins.

**Base note.** The packet header names `988a6c4`; the task pinned `2b5c8b7`. The delta is
`PROGRESS.md` + the two frozen packets (3 files, docs only, `git diff --stat 988a6c4 2b5c8b7`),
so no measured input can have moved — and it did not: every measurement in the packet was
re-taken at `2b5c8b7` before any code changed (see [Baselines](#baselines-recorded-before-any-code-change)).

## Commits

| Commit                                   | Contents                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `1a7559d`                                | `feat(git): let create_pr open a draft pull request` — `PrDraft` + `is_draft`, `CreatePrBody.draft`, `PullRequest.draft`, `create_pr`'s seventh parameter (`crates/warsha-git/src/lib.rs`) |
| `f6487d3`                                | `test(git): prove create_pr's draft mode on a loopback stub` — the new `crates/warsha-git/tests/create_pr_draft.rs` (T1–T3) |
| `d396dee`                                | `docs(git): name the draft mode in the warsha-git README` — the interface list plus the stale consumer line numbers |
| (this commit)                            | `docs(r-fin-sh4d): the Coder report` — this file                                                              |

`git diff 2b5c8b7 --stat`: **3 files, +345 −5** — `crates/warsha-git/src/lib.rs` (+41),
`crates/warsha-git/tests/create_pr_draft.rs` (new, 295), `crates/warsha-git/README.md`
(+14 −5). No `Cargo.toml`, no `Cargo.lock`, no `crates/warshad`, no `crates/warsha-pipeline`,
no TS/UI, no wire file, no packet, no `PROGRESS.md`/`DECISIONS.md`.

## Baselines recorded before any code change

Raw log: `target/discrimination/baseline-sh4d.txt`, `baseline-tests.log`. Each line is the
packet's own measurement, re-run at `2b5c8b7`:

| Packet claim                                | Measured at `2b5c8b7`                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| no `draft` anywhere in the crate            | `grep -rn draft crates/warsha-git/` → 0 hits, exit 1                          |
| `create_pr` has zero callers                | `grep -rn "create_pr("` → the definition at `src/lib.rs:474` only (plus packet/audit prose); no call site |
| no `PullRequest` struct literal exists      | `grep -rn "PullRequest {"` → the definition at `src/lib.rs:304` only          |
| `warshad` stores `.github`, never reads it  | `grep -rn "\.github\b" crates/warshad/src` → 0 hits, exit 1                   |
| no mock-HTTP crate in the workspace         | `grep -E 'wiremock\|mockito\|httpmock' Cargo.lock` → 0 hits, exit 1           |
| no `crates/warsha-git/tests/` directory     | `ls` → does not exist                                                         |
| dev-dependencies are `tempfile` only        | `sed -n '/dev-dependencies/,$p' crates/warsha-git/Cargo.toml` → `tempfile`    |
| the 13-test baseline                        | `cargo test -p warsha-git --all-targets` → **13 passed / 0 failed**, exit 0    |

## What landed (D1–D6)

- **D1** `pub enum PrDraft { #[default] Ready, Draft }` beside `MergeMethod`, deriving
  `Debug, Clone, Copy, PartialEq, Eq, Default`, with `pub fn is_draft(self) -> bool`.
  `create_pr` takes it as its seventh, last parameter. Typed rather than a bare `bool`, per the
  packet's convention argument (`MergeMethod` is the crate's model for a two-valued PR option).
- **D2** `CreatePrBody` gains `draft: bool`, always serialized (no `skip_serializing_if`), set
  from `draft.is_draft()`, so a ready PR sends `"draft": false` — the field's *value* is what
  T2 asserts, not its absence.
- **D3** `PullRequest` gains `pub draft: bool` with `#[serde(default)]`, so `create_pr`,
  `get_pr` and `merge_pr` all report draft status and pre-draft payloads still decode.
- **D4** **Untouched.** No new `GitError` variant, no branch added to `execute`, no change to
  `authorized`. A 422/403 draft refusal arrives as `GitError::GitHub` exactly as any other
  validation failure, which is what T3 pins.
- **D5** `crates/warsha-git/tests/create_pr_draft.rs`: a hand-rolled one-request stub on
  `tokio::net::TcpListener` bound to `127.0.0.1:0`. It reads the request line, headers and
  `Content-Length` body, records them, then answers `Content-Type: application/json` +
  `Content-Length` + `Connection: close`. Client: `GitHubClient::new("test-token")
  .with_api_base(format!("http://{addr}"))`. No mock-HTTP crate, no manifest change.
- **D6** `README.md:16-18` names the draft mode; `:8-12`'s stale consumer line numbers are
  replaced with the measured ones (`state.rs:381`, `startup.rs:23`, `state.rs:402`,
  `startup.rs:240`/`:361`, `get_github_token` at `startup.rs:929`).

## Acceptance tests

| #   | Test                                                     | Proves                                                                                      |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| T1  | `draft_pr_sends_draft_true_and_parses_it_back`            | `POST /repos/acme/widget/pulls` with `"draft": true`, `title`/`head`/`base` unchanged, `authorization: Bearer test-token`; a 201 carrying `"draft": true` returns `PullRequest { number: 7, draft: true }` |
| T2  | `ready_pr_sends_draft_false_and_defaults_a_missing_field` | `"draft": false` is *present*; a 201 that omits `draft` still decodes with `pr.draft == false` (`serde(default)`), and `PrDraft::default() == Ready` |
| T3  | `draft_refusal_keeps_the_github_error_shape`              | 422 → `Err(GitError::GitHub(msg))`, `msg` starts with `GitHub returned HTTP 422: ` and contains `Draft pull requests are not supported`; the token does not appear in `msg`; the request did carry `draft: true` |

The crate went from 13 tests to 16, nothing removed, nothing ignored, no assertion narrowed.

## Discrimination (T4): mutations under `target/discrimination/`

Patches, logs and a `README.md` index live there (untracked — `target/` is gitignored, exactly
as step 6 asks). Every mutant was run with `cargo test -p warsha-git --test create_pr_draft`
and reverted with `cp lib.rs.orig crates/warsha-git/src/lib.rs`; sha256
`ecbf7178…` matched `1a7559d` and `git diff --quiet` exited 0 between mutants, with
`git status --porcelain` empty afterwards. No `git checkout --` / `reset` was used.

1. **`draft` removed from `CreatePrBody`** (`1-draft-field-removed-from-body.patch`) → exit 101:
   T1 fails on the **sent-field** assertion, `assertion left == right failed`, `left: Null`,
   `right: Bool(true)` (T2 and T3 go red with it).
2. **`PullRequest.draft` removed** (`2-pullrequest-draft-field-removed.patch`) → exit 101 at
   compile: `error[E0609]: no field draft on type PullRequest`, `error: could not compile
   warsha-git (test "create_pr_draft")`. Red, but as a compile error, because the test names
   the field — so the field's existence is proven load-bearing but the *assertion* is not
   reached.
3. **`PullRequest.draft` kept but bound to the wrong wire key** (`rename = "is_draft"`,
   `3-pullrequest-draft-wrong-wire-key.patch`) → exit 101 with **exactly one** test red: T1
   `panicked … the server's draft status must survive the round trip`. This is mutant 2's
   assertion-level half: with the field present, the parse assertion alone is what
   discriminates, which is what the packet's "removing `PullRequest.draft` makes T1 fail on the
   parse assertion" is after.
4. **`is_draft()` hardcoded to `false`** (`4-is-draft-hardcoded-false.patch`) → exit 101:
   T1 and T3 fail on the sent-field assertion (`left: Bool(false)`, `right: Bool(true)`); T2
   stays green, which is correct — it already expects `false`.

Real code green after restore: `cargo test -p warsha-git --all-targets` → 16 passed / 0 failed,
exit 0 (`target/discrimination/gate-warsha-git-tests.log`).

## Gates

These are the **implementer's own runs** — the packet reserves the gate verdict for a separate
verifier, so treat these as pre-check evidence, not the acceptance decision. Run from the
worktree root at `d396dee` + restore, logs in `target/discrimination/`:

| Command                                                 | Exit | Observed                                                  |
| ------------------------------------------------------- | ---- | --------------------------------------------------------- |
| `cargo fmt --all --check`                               | 0    | no output                                                 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0    | `Finished` (see Deviation 1 for the one lint it needed)   |
| `cargo test -p warsha-git --all-targets`                | 0    | **13 + 3 = 16 passed / 0 failed** (13 baseline + 3 new)   |
| `cargo test --workspace --all-targets`                  | 0    | 42 targets, **1131 passed / 0 failed**, 12 ignored (all pre-existing) |
| `node scripts/check-arch.mjs`                           | 0    | `arch: 5 rules, 0 violations`                             |
| `node scripts/check-arch.mjs --self-test`               | 0    | `5 rules fire, clean fixture is clean`                    |
| `node scripts/check-wire-contract.mjs`                  | 0    | `wire: 11 checks, 0 violations`                           |
| `node scripts/check-wire-contract.mjs --self-test`      | 0    | `11 checks fire, clean fixture is clean in both modes`    |
| `node scripts/check-engineering-policy.mjs`             | 0    | `policy: 8 checks, 0 failures`                            |
| `node scripts/check-engineering-policy.mjs --self-test` | 0    | `8 checks fire, clean fixture is clean`                   |

The expected counts the packet quotes (5/0, 11/0, 8/0) are reproduced. No pnpm, desktop or e2e
gate applies (no TS touched); that is **quoted from the R-FIN-audit matrix, not re-run here** —
this worktree carries no `node_modules` and nothing in the diff can move a JS suite.

## Deviations from the packet

1. **`#[allow(clippy::too_many_arguments)]` on `create_pr`.** D1's seventh parameter makes eight
   with `&self`, one over clippy's default threshold of seven; without the attribute the gate
   `cargo clippy --workspace --all-targets -- -D warnings` **fails** (observed before the
   attribute: `error: this function has too many arguments (8/7)`, `could not compile
   warsha-git`, exit 101). D1 rejects an options struct and the parameter list *is* the frozen
   design, so the choices were a scoped allow inside the allowed file or stopping the packet as
   an out-of-scope blocker over a lint threshold. I took the allow, with the reasoning written
   into the doc comment, and wrote it here rather than quietly. Precedent in the workspace:
   `crates/warsha-pipeline/src/process_spawn.rs:565`, `crates/warshad/src/runtime.rs:91`. The
   gate command is unedited and **nothing else is suppressed anywhere in the diff** — the
   reviewer should still judge this one, and if it is unacceptable the alternative is a new
   packet with a different parameter shape, not an edit to this one.
2. **T4's second mutation is recorded twice** (mutants 2 and 3 above). Removing `PullRequest.draft`
   literally cannot reach an assertion — the test stops compiling — so the literal mutant is
   logged as the compile-red pair and an assertion-level twin (same field, wrong wire key) is
   logged beside it. Two artifacts, one claim; no test was narrowed to make either work.

## Findings left unfixed (outside this packet's allowed regions)

1. **The README's `lib.rs` line references are now shifted by this packet's own insertion** —
   `+41` lines after `:251`, `+30` before it. Stale now: `:24` `src/lib.rs:409` → 439;
   `:19-23` `:629` → 670 and `:950-1049` → 991-1090; `web :952` → 993, `cli :971` → 1012,
   `desktop :986` → 1027, `android :1004` → 1045, `all() :1023` → 1064, `by_name() :1028` →
   1069, `scaffold() :1033` → 1074; `:37` `authorized :572-577` → 613-618; `:36`
   `is_relative_file_path :653` → 694. Left alone because D6 scopes this packet's README edit
   to `:16-18` plus `:8-12`, and widening it would be exactly the scope creep the packet
   forbids. One doc pass (the packet already assigns stale doc line numbers to FIN2) should
   apply these together.
2. **Pre-existing, not caused by this packet:** `README.md:40` cites `get_github_token` at
   `crates/warshad/src/lib.rs:6062`; measured at `crates/warshad/src/startup.rs:929`. The
   `:8-12` rewrite in this packet now names `:929` in the same file, which makes the `:40`
   citation the odd one out — reported rather than fixed, same reason as above.

## Verification limits

- **Role.** The gates above were run by the implementer, which the packet reserves for a
  separate verifier. They are evidence for the verifier to re-run, not a verdict, and no role
  was merged or silently claimed.
- **Artifact location.** The discrimination patches/logs and gate logs live under
  `target/discrimination/` (comment-free of secrets, but gitignored, so **not in the commits**).
  The commands and the exact observed lines are quoted in this report so it stands on its own.
- **No real GitHub call anywhere.** T1–T3 speak only to `127.0.0.1:0`; `draft`'s semantics come
  from the GitHub REST documentation the packet recorded, not from a live response. The
  availability constraint behind T3 (draft PRs unsupported on some plans/private repos) is
  therefore modelled, not reproduced.
- **Out of scope, unchanged:** no SH4 call site, no RPC/UI, no PR-to-draft conversion, no
  `maintainer_can_modify`/`head_repo`, no retry behaviour, and `DaemonState.github` is still
  stored and never read.
