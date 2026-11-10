# Worker prompt — W6 · Rust pipeline hardening (`process_spawn`, `agent_tools`, `agent_loop`) — Wave A

You are the IMPLEMENTER for packet W6 of run `2026-11-08-design-and-remediation` in the Warsha repo
(main checkout `C:/Users/Dragonfly/Downloads/Warsha`). A separate reviewer and verifier judge your work
against the frozen gates below; you must not edit, weaken or reinterpret them. Never ask questions:
decide, record the decision in your report, continue.

## 0. Read first
`AGENTS.md` (stable toolchain, `cargo fmt`, `clippy -D warnings`, **no `unwrap()` in non-test code**,
errors via `thiserror`/`anyhow`, no real model API calls in tests); `ENGINEERING_POLICY.md` (§1 Phase 3,
§5, §6); `crates/warsha-pipeline/src/{process_spawn.rs,agent_tools.rs,agent_loop.rs,work_protection.rs,agent_workflow.rs,lib.rs}`;
run state `C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/state.json`.

## 1. Worktree and branch (Git Bash)
```bash
cd C:/Users/Dragonfly/Downloads/Warsha
git worktree add ../warsha-wt/w6 -b run/2026-11-08/w6-pipeline-hardening run/2026-11-08/integration
cd ../warsha-wt/w6
BASE=$(git rev-parse HEAD); echo "BASE=$BASE"
export CARGO_TARGET_DIR=C:/Users/Dragonfly/Downloads/warsha-wt/target-w6
cargo test -p warsha-pipeline --all-targets -- --list 2>/dev/null | grep -c ': test$'   # baseline 341 — record it
```

## 2. Scope
allowed_files: `crates/warsha-pipeline/src/process_spawn.rs`, `crates/warsha-pipeline/src/agent_tools.rs`,
`crates/warsha-pipeline/src/agent_loop.rs`.

out_of_scope: `work_protection.rs` (use its API as is), `agent_workflow.rs`, `lib.rs` (no new
re-exports), `crates/warshad/**` (its `start_preview` at `lib.rs:3485` still splits on whitespace —
logged follow-up), any `Cargo.toml`/`Cargo.lock`, the timing-fragile `sleep 30` tests (leave them),
`PLAN.md`/`PROGRESS.md`/`DECISIONS.md`.

## 3. Steps
1. **Quote-aware `split_command`** (`process_spawn.rs:701-705`, today `split_whitespace`). Same
   signature `pub fn split_command(command: &str) -> Result<(String, Vec<String>), ProcessError>`.
   Rules: whitespace separates arguments; `'…'` is literal; `"…"` groups with `\"` and `\\` escapes;
   adjacent quoted/unquoted parts join (`a"b c"d` → `ab cd`); an unterminated quote is an error (add a
   `ProcessError` variant, e.g. `UnterminatedQuote`, via `thiserror`); empty input stays
   `ProcessError::EmptyCommand`. Existing callers (`LivePreviewManager::start` `:746`, tests `1231`,
   `1294`, `1299`) keep passing.
   Tests (≥ 3): a quoted program path with spaces (`"C:/Program Files/x/node.exe" run dev` →
   program `C:/Program Files/x/node.exe`), single quotes + escapes + joining, unterminated quote error.
2. **`probe_line_for`** (`:922-925`, test-only): quote the executable —
   `format!("\"{}\" --exact {test} --ignored --nocapture", exe.display())` — so a test binary under a
   path with spaces survives the new splitter; keep `probe_line()` (`:906-908`) working.
3. **Read-before-write in `FilesystemToolExecutor`** (`agent_tools.rs:194-337`). The executor is
   `{working_dir}` with `#[derive(Debug, Clone, PartialEq, Eq)]` and `execute(&self, &AgentTool)`
   (trait `ToolExecutor: Send + Sync`, `:171-174`). Add:
   - field `read_guard: Option<Arc<Mutex<ReadBeforeWriteGuard>>>` (default `None` — behaviour unchanged);
   - builder `pub fn with_read_before_write(mut self, enforce: bool) -> Self` (`true` installs
     `ReadBeforeWriteGuard::new(true)`, `false` removes it);
   - in `execute`: a successful `AgentTool::ReadFile` calls `record_read(path)`; `AgentTool::WriteFile`
     on a path for which `may_write(path)` is false returns a failed `ToolResult` with a clear message
     and writes nothing; paths are normalised the same way for both calls (relative to `working_dir`);
   - a poisoned mutex becomes a failed `ToolResult` (no `unwrap`/`expect` outside tests);
   - replace the derived `PartialEq`/`Eq` with a manual impl comparing `working_dir` and whether
     enforcement is on (keep `Debug`, `Clone`; check every existing `==` use still compiles).
   Tests (≥ 3): default executor writes without a read (unchanged); enforced executor refuses an unread
   write and leaves the file absent; read-then-write succeeds; clones share the guard.
4. **`@file` mentions attached in `AgentLoop`** (`agent_loop.rs`: `run_turn` `:353-354` parses
   mentions; `:623` `model_prompt(input, mentions, command)`; `model_prompt` `:853-867` only appends
   `attached: @file x`; the doc comment `:723-725` says reading is the caller's job — update it).
   For each `Mention { kind: MentionKind::File, target }`: call
   `self.tool_executor.execute(&AgentTool::ReadFile { path: target.clone() })`; on success compress the
   output with `OutputCompressor::compress(&output, MAX_TOOL_OUTPUT_LINES)` (`agent_workflow.rs:1050-1066`)
   and pass it to `model_prompt`, which appends one block per file (path + compressed text + an
   "N of M lines shown" note); on failure append a one-line "could not attach" note — never abort the
   turn. Non-file mentions keep today's `attached:` line. Reading through the executor means an
   enforced read-before-write guard records the mention as read.
   Tests (≥ 3, temp dirs + the existing fake/mock executor — no network): a mentioned file's content
   reaches the prompt; a long file is compressed; a missing file yields the note and the turn completes.
5. `cargo fmt --all`; small Conventional Commits (`fix(pipeline): …`, `feat(pipeline): …`). Do not push.

## 4. Frozen verification gates
Each gate is one command; expected result in the comment above it. Use the same `CARGO_TARGET_DIR`.
```bash
# G6.S scope — expect output: 0
git diff --name-only $BASE..HEAD | grep -vE '^crates/warsha-pipeline/src/(process_spawn|agent_tools|agent_loop)\.rs$' | wc -l
# G6.1 — expect exit 0
cargo fmt --all --check
# G6.2 — expect exit 0
cargo clippy --workspace --all-targets -- -D warnings
# G6.3 — expect exit 0 and >= 350 passed, 0 failed (sum of "test result: ok. N passed" lines)
cargo test -p warsha-pipeline --all-targets
# G6.4 — expect exit 0 and >= 734 passed, 0 failed
cargo test --workspace --all-targets
# G6.5 — expect exit 0
grep -q 'pub fn with_read_before_write' crates/warsha-pipeline/src/agent_tools.rs && grep -q 'OutputCompressor::compress' crates/warsha-pipeline/src/agent_loop.rs
# G6.A / G6.P / G6.W — expect exit 0 each
node scripts/check-arch.mjs
node scripts/check-engineering-policy.mjs
node scripts/check-wire-contract.mjs
```
Reviewer check R6.1: no new `unwrap()`/`expect(` outside `#[cfg(test)]` code in the diff.

## 5. Report and stop
Write `C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W6/report.md`:
BASE, HEAD, `git diff --stat $BASE..HEAD`, decisions (quoting grammar, guard path normalisation,
prompt block format), your own gate run with exit codes and test totals (not evidence), open issues.
Out-of-scope need → stop with a blocker `{kind: out-of-scope, reason, needs}`. No edits to
`PLAN.md`/`PROGRESS.md`/`DECISIONS.md`; no merge; no push.
