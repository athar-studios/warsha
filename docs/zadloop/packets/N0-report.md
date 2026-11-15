# N0 Report: CLI usage recovery

## Delivered
- Schema migration (007) for cost table.
- Updated `CostRecord` with CLI tracking fields.
- Updated `TokenUsage` to include `cost_cents`.
- Updated `claude-code` and `codex-cli` backends to parse and report usage/cost.
- Pipeline integration for CLI usage, cost estimation, and budget enforcement.
- Added canary tests for CLI parsing.
- Added migration tests for 007.

## VERIFY Evidence
- **claude version**: 2.1.322.
- **claude probe**:
  ```json
  {
    "usage": {
      "input_tokens": 2,
      "output_tokens": 4,
      "cost_cents": 5
    }
  }
  ```
- **codex**: Fallback to documented JSONL format implemented.

## Decisions / Deviations
- **D-RN-N0-1**: Mapping CLI usage (tokens) to cost. Now using actual reported cost if present in CLI output, otherwise estimated=true and 0 cents.

## Tests
- Added canary tests to verify that logs/db do not leak canary content.
- Migration tests for 007 included.
- Verified TokenUsage propagation across all providers (anthropic, fake, ollama, openai, lib).
