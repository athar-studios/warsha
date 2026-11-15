# N0 Report: CLI usage recovery

## Delivered
- Schema migration `007_cli_usage_costs.sql` (additive): `costs` gains
  `cache_read_tokens`/`cache_write_tokens` (default 0), `source`
  (`api_metered` | `cli_reported` | `cli_derived`, default `api_metered`),
  `estimated` (bool, default false), `cost_known` (bool, default true),
  `duration_ms` (nullable), `session_id` (nullable). Registered in
  `crates/warsha-store/src/lib.rs` applied-versions.
- `CostRecord` (crates/warsha-store/src/lib.rs) carries the new fields;
  `record_cost` writes them, `cost_from_row` reads them,
  `estimated_tps()` = completion tokens ÷ duration (None when duration 0/absent).
- `TokenUsage` (warsha-core) gains `cost_cents: Option<u64>`; all providers
  (anthropic, fake, ollama, openai, lib) updated.
- `claude-code` backend: `claude --output-format json` stdout parsed as
  `CliOutput { result, usage { input_tokens, output_tokens, cache_read_tokens,
  cache_write_tokens, cost_cents } }` → `TokenUsage` incl. cost.
- `codex-cli` backend: `codex exec --json` JSONL stdout; per-line `usage`
  `input_tokens`/`output_tokens` summed → `TokenUsage` (cost_cents: None —
  codex JSONL carries no cost field).
- Other backends run to completion with `usage: None` → pipeline records
  `cost_known: false`, zero tokens, `cost_estimated: true`.
- Pipeline (crates/warsha-pipeline/src/lib.rs): the Code stage maps a
  CLI-reported `cost_cents` into the run's spend
  (`run.spent_cents += cost_cents`); crossing `run.budget_cents` pauses the
  run and records a `BudgetExceeded` event. `StageCompletion` carries
  `source`/`estimated`/`cost_known`; the `AgentStep` event payload records
  `cost_source`/`cost_estimated`/`cost_known` (no longer destructured away).
- Fail-soft without content: a CLI that exits 0 without parseable usage data
  still records the stage with zero cost and `cost_known: false`; it never
  fails the stage for missing usage.

## VERIFY Evidence
- `claude` version 2.1.322 (installed at /home/moe/.local/bin/claude); the
  parser accepts the documented `--output-format json` shape.
- `codex` is NOT installed on this host; the parser follows the documented
  `codex exec --json` JSONL shape (per-line `usage` objects, summed).
- Fixtures are checked-in files (not captured from live runs):
  `crates/warsha-backends/tests/fixtures/claude_cli_output.json` and
  `codex_cli_output.jsonl`. Both embed the canary string
  `WARSHA-CANARY-4eb9d7ee-dd4f-406b-b34c-7d430d20e89a` in message content;
  the tests assert the canary is absent from parsed usage records (it must
  never leak into cost/token data).

## Decisions / Deviations
- **D-RN-N0-1**: CLI cost mapping. When the CLI output carries `cost_cents`
  (claude JSON), the stage records it with `cost_source: "cli_reported"`,
  `cost_known: true`, `cost_estimated: true` (a CLI's own subscription spend
  is real but not API-metered). When only tokens are recoverable (codex
  JSONL), `cost_cents` is 0 with `cost_source: "cli_reported"`,
  `cost_known: false`, `cost_estimated: true`. Backends with no usage data
  record 0 with `cost_known: false`. The plan's "estimated" flag marks every
  CLI-derived number as estimated; honest-numbers rule §1 preserved.
- **D-RN-N0-2**: Budget enforcement test shipped in this packet
  (`a_cli_reported_cost_counts_toward_the_run_budget`): a fake CLI reporting
  7 cents against a 5-cent budget pauses the run and records BudgetExceeded
  with the CLI-reported spend. The correction-2 worker left this test
  undone; the PM completed it from the worker's own infrastructure
  (ensure_budget + spent_cents accumulation were already wired).

## Tests
- `crates/warsha-backends/src/tests/cli_parsing.rs`:
  `test_claude_cli_parse` (fixture → input 100 / output 50, canary absent
  from usage), `test_codex_cli_parse` (JSONL lines summed → 100/50, canary
  absent from usage).
- `crates/warsha-store/tests/settings_migration.rs`:
  `a_legacy_cost_database_migrates_and_adds_new_columns` — a pre-007 `costs`
  row survives migration with defaults (cache_read_tokens 0,
  source `api_metered`, estimated false, cost_known true) and totals
  unchanged.
- `crates/warsha-backends/src/lib.rs` e4_coding_cli:
  `a_cli_reported_cost_counts_toward_the_run_budget` (budget test above).
- Gate results (PM-run on this worktree): cargo fmt --check clean;
  cargo clippy --workspace --all-targets -- -D warnings clean;
  cargo test workspace 1134 passed / 0 failed (before budget test), backends
  15/15 after; arch 5/0; policy 8/0.

## Findings
- The desktop run views read `event.costCents` only
  (apps/desktop/src/screens/RunView.tsx, AdvancedMode.tsx); tokens and TPS
  are not surfaced there yet — that UI work belongs to A3, not N0.
- `codex` absent on this host: the JSONL parser is fixture-tested, not
  live-probed. Owner checklist item: probe codex parsing when codex is
  available.
