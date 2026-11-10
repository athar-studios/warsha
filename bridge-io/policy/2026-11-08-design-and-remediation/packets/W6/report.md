# W6 · Rust pipeline hardening — implementer report

Packet: W6 (`process_spawn.rs`, `agent_tools.rs`, `agent_loop.rs`) · Run `2026-11-08-design-and-remediation` · Wave A

## Identity

- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/w6` · branch `run/2026-11-08/w6-pipeline-hardening`
- BASE: `0772d502002562505c6438ae712abca7a7328d84` (= `run/2026-11-08/integration`)
- HEAD: `a9edd90e92521c2c84da0b586f7191e5d52f45a5`
- `CARGO_TARGET_DIR`: `C:/Users/Dragonfly/Downloads/warsha-wt/target-w6` (decision D6)
- Tree at report time: no diff against HEAD, no untracked files (`git diff --stat HEAD` empty, `git ls-files -o --exclude-standard` empty)

```
$ git diff --stat 0772d50..HEAD
 crates/warsha-pipeline/src/agent_loop.rs    | 209 +++++++++++++++++++++-
 crates/warsha-pipeline/src/agent_tools.rs   | 261 +++++++++++++++++++++++++++-
 crates/warsha-pipeline/src/process_spawn.rs | 143 ++++++++++++++-
 3 files changed, 595 insertions(+), 18 deletions(-)
```

Commits (all by the pre-interruption session; see Resume note):

| Commit | Subject |
| --- | --- |
| `44658b889f57682ea82dfe0f2d23172637b122e8` | `fix(pipeline): make split_command quote-aware and quote the preview probe path` |
| `ef7471d3d169aa6d6f28d1e0d2bbf06f649719f5` | `feat(pipeline): add opt-in read-before-write guard to FilesystemToolExecutor` |
| `a9edd90e92521c2c84da0b586f7191e5d52f45a5` | `feat(pipeline): attach @file mention content to the agent model prompt` |

## Resume note

This session resumed the packet after a host-level interruption killed the original worker at ~02:40Z.
The three commits above were already on disk. This session read the full `0772d50..HEAD` diff, verified
each of the brief's four steps against it, ran all nine gates, and made **no code edits** — HEAD and the
working tree are exactly as the lost session left them. Nothing was redone and no repair iteration was
needed (all gates green on the first run).

## Steps vs. brief

1. **Quote-aware `split_command`** — done. Signature unchanged; `ProcessError::UnterminatedQuote { quote }`
   added via `thiserror`; empty/whitespace-only input still `EmptyCommand`; existing callers
   (`LivePreviewManager::start`, the three pre-existing tests) untouched and passing. 5 new tests.
2. **`probe_line_for`** — done: `format!("\"{}\" --exact {test} --ignored --nocapture", exe.display())`;
   `probe_line()` unchanged and still splits through the new tokenizer in its test.
3. **Read-before-write in `FilesystemToolExecutor`** — done: `read_guard: Option<Arc<Mutex<ReadBeforeWriteGuard>>>`
   (default `None`), `pub fn with_read_before_write(mut self, enforce: bool) -> Self`, successful
   `ReadFile` records the read, unread `WriteFile` returns a failed `ToolResult` and writes nothing,
   poisoned mutex → failed `ToolResult`, derived `PartialEq`/`Eq` replaced by a manual impl comparing
   `working_dir` + enforcement state (`Debug`/`Clone` kept). 8 new tests.
4. **`@file` mentions** — done: `attach_file_mentions` reads each `MentionKind::File` target through
   `self.tool_executor`, compresses with `OutputCompressor::compress(&output, MAX_TOOL_OUTPUT_LINES)`
   (`MAX_TOOL_OUTPUT_LINES = 12`), and `model_prompt` appends one block per file; a failed read becomes a
   one-line note and the turn continues; non-file mentions keep the `attached:` line; the stale doc
   comment ("reading it is the caller's job") is updated. 5 new tests.

Net new tests: **18** (5 + 8 + 5), all mock-provider only (`FixedRouter`, `fresh_tempdir`), no network.

## Decisions

- **D-W6-1 quoting grammar.** Whitespace separates tokens. `'…'` is fully literal (no escapes). `"…"`
  groups, honouring only `\"` and `\\`; a backslash before any other character — including Windows path
  separators — stays literal, so `"C:\Program Files\x\node.exe"` survives. Adjacent quoted/unquoted parts
  join into one token (`a"b c"d` → `ab cd`). `""` is a real empty token. Unterminated quote →
  `UnterminatedQuote { quote }`; whitespace-only input → `EmptyCommand`.
- **D-W6-2 guard path normalisation.** Both `record_read` and `may_write` use `guard_key(path)`:
  `resolve(path)` (rejects blank, absolute, drive-prefixed and `..` paths) followed by
  `components().collect()` (drops `.`), rendered with `display()`. So `notes.md` and `./notes.md` are the
  same key, and an escaping path is refused before any file is touched with the same message the
  read/write itself would give.
- **D-W6-3 poisoned mutex.** Lock poisoning becomes `ToolResult::failed(…, "the read-before-write guard
  is poisoned")`; no `unwrap`/`expect` in non-test code.
- **D-W6-4 enforcement scope.** Under enforcement, a write to a path never successfully read is refused
  even if the file does not exist yet — this is `ReadBeforeWriteGuard::may_write` semantics and what the
  brief's "refuses an unread write and leaves the file absent" test asserts. Consequence: creating a
  brand-new file needs a prior successful read (see Open issues 3).
- **D-W6-5 prompt block format.** Per read file: `@file <path>:` line, then the compressed text lines,
  then `(N of M lines shown)`. Per failed read: one line `could not attach @file <path>: <reason>` with
  embedded newlines flattened to spaces. The `attached: …` line still lists every mention, file or not.
- **D-W6-6 attachment call site.** `attach_file_mentions` runs in the router branch at the brief's call
  site (`agent_loop.rs:623-624`). With the default `NoToolExecutor`, a file mention yields the
  "could not attach" note instead of aborting — consistent with "never abort the turn".
- **D-W6-7 `probe_line_for`.** Quoted exactly as the brief specifies; `probe_line()` untouched.
- **D-W6-8 doc truth.** Removed "exactly like the daemon's `process.spawn`" from the `run command` doc
  bullet: the daemon splitter is now quote-aware while `parse_tool_request` still splits on whitespace,
  so the old comparison would now be false.

## Gate run (implementer's own run — not the verifier's evidence)

Run in the worktree with `CARGO_TARGET_DIR=C:/Users/Dragonfly/Downloads/warsha-wt/target-w6`; raw logs in
`C:/Users/Dragonfly/Downloads/warsha-wt/w6-scratch/G6.*.log`. No test was skipped, deleted, ignored or
narrowed; no gate command was modified.

| Gate | Exit | Result |
| --- | --- | --- |
| G6.S scope | 0 | output `0` (only the three allowed files in `0772d50..HEAD`) |
| G6.1 `cargo fmt --all --check` | 0 | clean |
| G6.2 `cargo clippy --workspace --all-targets -- -D warnings` | 0 | no warnings, no errors |
| G6.3 `cargo test -p warsha-pipeline --all-targets` | 0 | **352 passed, 0 failed, 7 ignored** (lib 341/0/7 + 6 + 4 + 1) — floor 350 met |
| G6.4 `cargo test --workspace --all-targets` | 0 | **743 passed, 0 failed, 10 ignored** (36 `test result:` lines, all `ok`) — floor 734 met |
| G6.5 `with_read_before_write` + `OutputCompressor::compress` greps | 0 | both present |
| G6.A `node scripts/check-arch.mjs` | 0 | `arch: 5 rules, 0 violations` |
| G6.P `node scripts/check-engineering-policy.mjs` | 0 | `policy: 8 checks, 0 failures` |
| G6.W `node scripts/check-wire-contract.mjs` | 0 | `wire: 8 checks, 0 violations` |

Baseline: 341 listed in `warsha-pipeline` at BASE (the brief's baseline command); the 18 new tests bring
the listed total to 359 (348 lib incl. 7 pre-existing ignored child-process probes + 11 other targets).
The 7 ignored pipeline tests are pre-existing `…_probe` binaries ("a child process, not a test") — none
added by this packet. No `sleep 30` timing test flaked; no rerun was needed.

All 18 new tests passed, verified by name in the G6.3 log: 5 × `split_command_*`, 8 × executor guard
tests, 5 × mention tests.

## R6.1 — no new `unwrap()`/`expect(` in non-test code

**PASS.** Every `unwrap()`/`expect(` on an added line sits after the first `#[cfg(test)]` line of its file:

- `process_spawn.rs` — test module starts at line 938; added `expect(` at 1376, 1385, 1398, 1404, 1415
- `agent_tools.rs` — test module starts at line 439; added `expect(` at 758, 772, 780, 803, 851, 856
- `agent_loop.rs` — test module starts at line 994; added `expect(` at 1828, 1851, 1907, 1913, 1931

No `unwrap()` was added anywhere. Non-test code uses `map_err`, `?`, and `if let`.

## Open issues

1. **`warshad::start_preview` still splits on whitespace** (`crates/warshad/src/lib.rs:3485`) — explicitly
   out of scope per the brief; logged follow-up.
2. **Doubled backslashes inside double quotes collapse** by grammar design (`\\` → `\`). Not a problem for
   cargo's single-backslash `current_exe()` paths; documented in `split_quoted`'s doc comment.
3. **New-file creation is refused under enforcement** (D-W6-4): a nonexistent file cannot have been read,
   so `may_write` is false. Matches the brief and the guard's documented semantics; flag for product
   consideration if brand-new files should be exempt.
4. **Doc-comment truth in `PLAN.md`** — the M18 note that mentions are not read is now stale, but
   `PLAN.md` is out of scope (docs packets own it).
