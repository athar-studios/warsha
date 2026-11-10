# W6 · Independent code review — Rust pipeline hardening

- Run: `2026-11-08-design-and-remediation` · Packet: W6 · Wave A
- Role: reviewer (Phase 4, separate from implementer and verifier). No implementation or gate was edited.
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/w6` · branch `run/2026-11-08/w6-pipeline-hardening`
- Reviewed range: `0772d502002562505c6438ae712abca7a7328d84..a9edd90e92521c2c84da0b586f7191e5d52f45a5`
  (BASE = `0772d50…`, HEAD = `a9edd90…`, HEAD is the branch tip; tree clean — `git status --porcelain` empty)
- Patch exported: `bridge-io/policy/2026-11-08-design-and-remediation/diff/W6/0001..0003-*.patch`
- Report reviewed as a claim only: `packets/W6/report.md`.

## 1. Verified diff stat

```
 crates/warsha-pipeline/src/agent_loop.rs    | 209 +++++++++++++++++++++-
 crates/warsha-pipeline/src/agent_tools.rs   | 261 +++++++++++++++++++++++++++-
 crates/warsha-pipeline/src/process_spawn.rs | 143 ++++++++++++++-
 3 files changed, 595 insertions(+), 18 deletions(-)
```

Matches the claim exactly (201+/8−, 258+/3−, 136+/7−). `git diff --name-status` lists only those three paths as `M`.

## 2. Scope — G6.S

```
git diff --name-only 0772d50..a9edd90 \
  | grep -vE '^crates/warsha-pipeline/src/(process_spawn|agent_tools|agent_loop)\.rs$' | wc -l
→ 0
```

No `Cargo.toml`, no `Cargo.lock`, no other crate, no `.github/**`, no `PLAN.md`/`PROGRESS.md`/`DECISIONS.md`,
no `*-snapshots/**`. Each of the three commits touches exactly one file (`git show --stat`):

| Commit | Subject | Files |
| --- | --- | --- |
| `44658b8` | `fix(pipeline): make split_command quote-aware and quote the preview probe path` | `process_spawn.rs` |
| `ef7471d` | `feat(pipeline): add opt-in read-before-write guard to FilesystemToolExecutor` | `agent_tools.rs` |
| `a9edd90` | `feat(pipeline): attach @file mention content to the agent model prompt` | `agent_loop.rs` |

## 3. Findings

### Blocker

None.

### Major

None.

### Minor

**M1 — the guard ships unwired, and the shipped policy default is the opposite.**
`FilesystemToolExecutor::new` leaves `read_guard: None` (`agent_tools.rs:204-205`, `225-230`) and the daemon
builds exactly that (`crates/warshad/src/lib.rs:4865`), while `WorkProtectionPolicy::default()` sets
`read_before_write: true` (`crates/warsha-pipeline/src/work_protection.rs:73`). So the product's own default
policy is not honoured in the daemon, and the capability is inert there. If it is wired as-is, a brand-new file
cannot be written because it can never have been read (the report's D-W6-4 / open issue 3). This is not a gate
violation — the frozen brief mandates `default None` (behaviour unchanged) and puts `crates/warshad/**` out of
scope — but it must become a tracked follow-up with a product decision, not a note in a report.

**M2 — the daemon's process policy now judges a different program than the pipeline starts.**
`LivePreviewManager::start` splits command lines quote-aware (`process_spawn.rs:710-716`), but
`warshad::start_preview` still derives the program it hands to the command policy from a whitespace split and
documents the invariant as "the program the pipeline will start, which is its first word (audit H-05)"
(`crates/warshad/src/lib.rs:3480-3485`). With a quoted program path the two tokens differ (`"C:/Program` vs
`C:/Program Files/x/node.exe`). I checked the failure direction: quotes are **not** in the daemon's
metacharacter set (`crates/warshad/src/auth.rs:972`), so the check falls through to the allowlist comparison of
the raw first token (`auth.rs:1034-1044`) and a quoted program path is refused (fail-closed) — there is no
policy bypass. The impact is a capability/contract mismatch plus a now-false comment in an out-of-scope file.
The brief already logs this ("`start_preview` … still splits on whitespace — logged follow-up"); the follow-up
must be scheduled before any caller relies on quoted preview commands.

**M3 — stale doc on `probe_line`.**
`process_spawn.rs:951` still says "`LivePreviewManager::start` splits a whitespace-only command line". The
splitter is now quote-aware and `probe_line_for`'s own doc was updated (`process_spawn.rs:986-993`); this one
was missed.

### Nit

**N1 — dead `if let` after a proven `Some`.** `chars.peek()` is matched on `Some('"') | Some('\\')`, then
`if let Some(escaped) = chars.next()` (`process_spawn.rs:751-756`); the `if let` can never take the `None`
branch. Behaviour is correct; a direct `next()` with a comment reads better.

**N2 — the unterminated-quote message interpolates the quote bare.** `#[error("unterminated {quote} quote in
command")]` renders `unterminated " quote in command` (`process_spawn.rs:246`). Quoting the character (e.g.
`` `{quote}` ``) reads better.

**N3 — coverage gaps for behaviours this packet asserts but no test pins.** (a) A *failed* read must not
record a read (missing file → a later write is still refused); (b) an escaping path under enforcement returns
the same refusal as the read/write would and touches nothing (D-W6-2); (c) `""` yields a real empty token while
`""`-only input is not `EmptyCommand`; (d) the `attached:` line still lists a *file* mention — the current
assertion `contains("@file notes.md")` (`agent_loop.rs:1839`) is also satisfied by the content block header.
Tests: `agent_tools.rs:719-872`, `process_spawn.rs:1372-1430`, `agent_loop.rs:1825-1845`. The brief's required
minimum (3 + 3 + 3, with the named cases) is met; these are additions, not misses.

**N4 — `@file "path with spaces"` cannot attach.** `MentionParser` trims only *trailing* quote characters
(`agent_workflow.rs:300-308`), so the leading `"` stays in `target` and the read fails; the parser's own doc
advises "quote the path" (`agent_workflow.rs:251-253`). Pre-existing parser behaviour in an out-of-scope file,
but the new attachment path makes it visible — worth a follow-up.

**N5 — file content enters the model prompt without the untrusted envelope.** `model_prompt` appends the
compressed text verbatim (`agent_loop.rs:927-944`); `guardrails::wrap_untrusted` exists but is not used, matching
the existing tool-output injection (`agent_loop.rs:606-613`). No regression; hardening idea only.

**N6 — `PLAN.md` M18's note that mentions are not read is now stale.** Docs packet's property; recorded by the
report as open issue 4.

### Correctness detail (what I checked and why it holds)

**(a) Quote-aware `split_command` — coherent.** `split_quoted` (`process_spawn.rs:723-770`) implements exactly
the brief's grammar: whitespace separates; `'…'` literal; `"…"` groups honouring only `\"`/`\\` (any other
backslash, including a Windows separator, stays literal); adjacent quoted/unquoted parts join; `in_token`
preserves `""` as a real empty token; unterminated either quote → the new `ProcessError::UnterminatedQuote`
(`process_spawn.rs:245-250`, via `thiserror`); empty/whitespace-only still → `EmptyCommand`
(`process_spawn.rs:710-714`). `ProcessError` derives only `Debug, Error` (`process_spawn.rs:194-195`), is not
serialised, and has no exhaustive downstream match (`mcp_transport.rs:839-842` uses `matches!`), so the new
variant cannot break a caller. The only caller is `LivePreviewManager::start` (`process_spawn.rs:811`); the
pre-existing tests (`split_command_keeps_the_program_and_its_arguments:1360-1370`,
`read_stdout_reports_…:1295-1322` via `probe_line()`) are untouched and pass — I ran them.
Behaviour note (accepted): a bare `'` inside a word now opens a quote (`don't` → `UnterminatedQuote`), which is
the shell-like reading of "adjacent parts join" and is documented.

**(b) `probe_line_for` — correct.** `format!("\"{}\" --exact {test} --ignored --nocapture", exe.display())`
(`process_spawn.rs:990-993`); single backslashes in the exe path survive because they precede non-quote
characters; `probe_line()` (`:971-973`) is unchanged and still splits through the new tokenizer. The two probe
tests remain `#[ignore = "a child process, not a test"]` and unchanged.

**(c) Read-before-write guard — correct, opt-in, default off.** `read_guard: Option<Arc<Mutex<…>>>` defaults to
`None` (`agent_tools.rs:204-205`, `225-230`); `with_read_before_write(true|false)` installs a fresh enforcing
guard / removes it (`:237-244`). `execute` refuses a `WriteFile` *before* any filesystem call and returns
`ToolResult::failed` with `read-before-write: {path} must be read before it is written` (`:396-409`), so an unread
write writes nothing (asserted by test and by the absence check). A *successful* `ReadFile` records the read
(`:427-434`); a failed read returns earlier and records nothing. Both calls share `guard_key`, i.e.
`resolve(path)` plus `.`-component normalisation (`:278-285`), so `notes.md` / `./notes.md` agree, and an
escaping path is refused with the same message the write itself would produce. A poisoned mutex becomes a failed
result (`:289-298`, `:302-312`, `:407`), never a panic. `PartialEq` is manual (`:208-215`) and compares
`working_dir` plus `read_guard.is_some()` — enforcement state, not guard identity; `Eq` is re-stated at `:217`.
I verified no pre-existing code compares executors (`FilesystemToolExecutor` appears only in the re-export
`lib.rs:57`, tests, and local variables in `warshad/src/lib.rs:4865` and `warshad/tests/e2e_real_arabic_request.rs:1113`),
so the derive replacement changes nothing that compiled before, and default behaviour is unchanged.

**(d) `@file` mentions — correct.** `attach_file_mentions` (`agent_loop.rs:666-695`) reads only
`MentionKind::File` through `self.tool_executor`, compresses with
`OutputCompressor::compress(&result.output, MAX_TOOL_OUTPUT_LINES)` (`MAX_TOOL_OUTPUT_LINES = 12`,
`agent_loop.rs:66`), and never propagates an error. `model_prompt` (`:906-949`) still emits the `attached:` line
for every mention (`:923-926`), then one block per read file (header, compressed lines, `(N of M lines shown)`,
`:929-936`) and one flattened line per failed read (`,:937-942`). Call site is the router branch
(`:623-624`); with the default `NoToolExecutor` a file mention becomes the "could not attach" note instead of
aborting the turn. The stale doc ("reading it is the caller's job") is fixed (`:755-758`), and the independently
stale `run command` comparison ("exactly like the daemon's `process.spawn`") is removed correctly — that bullet
now truthfully says the tool request splits on whitespace (`:749-750`, `parse_tool_request` `:802`).
`CompressedOutput` is public and its `text`/`compressed_lines`/`original_lines` fields are used correctly
(`agent_workflow.rs:1021-1027`, `1066-1117`): 200 lines at 12 → `(12 of 200 lines shown)`, 189 omitted, head 5 /
tail 6. Reading through the executor also means an enforced guard records the mention as read — pinned
end-to-end by `a_file_mention_is_recorded_as_read_for_the_guard`.

## 4. R6.1 — no new `unwrap()`/`expect(` in non-test code

**PASS.**

- Added lines containing `unwrap(` / `expect(` / `panic!` / `unreachable!` / `todo!` / `unimplemented!`: **17**
  (16 × `expect(`, 1 × deliberate `panic!("poison the guard")` in a spawned thread that a test asserts on).
  **Zero** `unwrap(` added.
- Every one is inside `#[cfg(test)]`: `process_spawn.rs` module starts at 938, all hits ≥ 991;
  `agent_tools.rs` starts at 439, all hits ≥ 491; `agent_loop.rs` starts at 994, all hits ≥ 1021.
- The three files contain no `unwrap(` at all at HEAD (only `unwrap_or`, which does not panic).
- Non-test additions use `?`, `map_err`, `if let`, and `let Some(…) = … else`.
- No `#[allow(…)]`, no `unsafe`, no `todo!()`/`unimplemented!()` anywhere in the diff.

## 5. Test quality — verdict: sound

- **18 new tests, all present and passing** (5 `process_spawn` + 8 `agent_tools` + 5 `agent_loop`), matching the
  claim and the added `fn` count. They are not tautologies: the four new splitter tests fail on the old
  `split_whitespace` implementation; the guard tests assert both the refusal *and* that the file stays absent;
  the compression test pins the exact `(12 of 200 lines shown)` plus head/tail survival and middle loss; the
  equality test pins guard-identity independence (`enforced == enforced` across two separately-built guards,
  `plain != enforced`); the last mention test is an end-to-end read→guard→write proof.
- **No existing test was deleted, renamed, skipped, ignored, narrowed, or weakened.** The 18 removed lines are
  the old splitter body, three doc comments, the import list, the old derive, the old `match outcome` arms, the
  `model_prompt` signature and its single call. No assertion line was removed anywhere.
- **No new `#[ignore]` / `#[should_panic]` / `todo!()` stand-in.** `git grep '#\[ignore'` returns the same 7
  entries at BASE and HEAD: `process_spawn.rs` 896/913 → 961/978 (the two probe child-process tests, shifted only
  by the insertion above them) and 5 in `mcp_transport.rs`. The 7 ignored tests listed by the lib run are exactly
  those, i.e. pre-existing.
- Known gaps are listed as N3; they are additions beyond the brief's required cases, not weakened coverage.
- One new test deliberately panics in a spawned thread to poison the mutex and asserts the join error; that is the
  correct way to exercise the poisoning path and it does not fail the harness.

## 6. Secrets, mock provider, network

No secret, key, token, or credential appears in the diff; fixtures are `notes.md` / `big.log` in
`fresh_tempdir()`. No secret store or keychain code is touched. The new agent-loop tests drive `FixedRouter`
only; no real model endpoint is called (AGENTS.md: mock provider in tests). `@file` reads are local filesystem
reads confined to the executor's `working_dir`. No network.

## 7. Policy hygiene

Three small Conventional Commits (`fix(pipeline):`, `feat(pipeline):`), one file each, no merge commits in the
range (`git log --merges … | wc -l` → 0). No upstream is configured for the branch and no remote ref for it
exists (`git for-each-ref refs/remotes`), so nothing was pushed. No publish/release/post of any kind.

## 8. Commands I ran (my own evidence; the verifier still owns the gates)

| Command | Result |
| --- | --- |
| `git diff --name-only BASE..HEAD \| grep -vE … \| wc -l` | `0` |
| `git status --porcelain` | empty; `HEAD = a9edd90` |
| `git log --merges BASE..HEAD` | 0 |
| `git for-each-ref refs/remotes` | no W6 ref; no upstream |
| `cargo fmt --all --check` | exit 0 |
| `cargo test -p warsha-pipeline --lib` | **341 passed, 0 failed, 7 ignored** (29.56 s) |
| `cargo test -p warsha-pipeline --lib -- --list` | 348 listed; every one of the 18 new names present |
| `cargo test -p warsha-pipeline --lib -- --list --ignored` | exactly the 7 pre-existing probes |
| `cargo clippy --workspace --all-targets -- -D warnings` | exit 0 (warm cache, 0.59 s) |
| `cargo clippy -p warsha-pipeline --all-targets -- -D warnings` (isolated fresh target dir) | exit 0, full recompile 51.40 s |
| `node scripts/check-arch.mjs` | `arch: 5 rules, 0 violations` |
| `node scripts/check-engineering-policy.mjs` | `policy: 8 checks, 0 failures` |
| `node scripts/check-wire-contract.mjs` | `wire: 8 checks, 0 violations` |
| R6.1 grep over added lines | 17 hits, all inside `#[cfg(test)]` |
| `git format-patch BASE..HEAD -o …/diff/W6` | 3 patches, 826 lines |

**Not run by me (verifier's gates):** G6.3's integration targets (`cargo test -p warsha-pipeline --all-targets`,
claimed 352) and G6.4 (`cargo test --workspace --all-targets`, claimed 743). My lib run is the target that
contains every changed line.

## 9. Verdict

**APPROVE.**

No blocker and no major finding against the frozen gates: scope is exactly the three allowed files, all four
changes are correct and behave as the brief specifies, R6.1 passes, the test suite is strengthened without any
existing test being touched, and the commit/push hygiene is clean. M1 and M2 are real, out-of-scope follow-ups
(the guard's wiring and the daemon's whitespace policy split); they must be tracked as follow-up work with an
owner/product decision before the quoting change or the guard is relied on through `preview.start` and the
daemon. M3 and N1–N6 are polish and optional test hardening. Nothing here requires a repair iteration.
