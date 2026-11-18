# D4-report.md

## Packet: D4 (Run Modes)

### Summary
Implemented run modes: Agent (default), Plan, SpecFile, and Ask.
Added migration `015_run_modes.sql`.
Updated `Run` struct in `warsha-core`.
Updated `warsha-store` queries to handle `run_mode`.

### Spec Notes
- `Agent` mode is the default for existing runs.
- `Plan` mode executes until the plan-approval gate.
- `SpecFile` mode uses a project repo spec file.
- `Ask` mode forces read-only confinement.

### Decisions
- D-RN-D4-001: Added `run_mode` to `runs` table with default value 'Agent'.
- D-RN-D4-002: Implemented `FromStr` and `Display` for `RunMode`.

### Gate Table
- cargo fmt: Pass
- cargo clippy: Pass
- cargo test: Pass
- i18n-gate: Pass
- wire-contract: Pass
- gitleaks: Pass

### Deviations
None.
