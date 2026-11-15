# N0 Report: CLI usage recovery

## Delivered
- Schema migration (007) for cost table.
- Updated `CostRecord` with CLI tracking fields.
- Updated `claude-code` and `codex-cli` backends to parse and report usage.
- Pipeline integration for CLI usage.
- Added estimated TPS accessor.

## VERIFY Evidence
- **claude version**: 2.1.322.
- **claude probe**:
  ```json
  {
    "usage": {
      "input_tokens": 2,
      "output_tokens": 4,
      ...
    }
  }
  ```
- **codex**: Not installed; fallback to documented JSONL format implemented.

## Decisions / Deviations
- **D-RN-N0-1**: Mapping CLI usage (tokens-only) to cost. Decided to map to source='cli_derived', estimated=true, cost_known=false until pricing is integrated. Currently reporting 0 cents.

## Tests
- Added canary tests to verify that logs/db do not leak canary content.
- Migration tests for 007 included.
