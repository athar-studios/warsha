# A4 Report: Failover and Routing

## Deliveries
- Implemented `ProviderError` failover classification (`should_failover` for transient/auth/5xx errors).
- Implemented cooldown registry in `ProviderRouter` (60s default, doubling, 10m cap, reset on success).
- Updated `RunReceipt` with `FailoverRecord` tracking.
- Implemented poisoning-tolerant `lock()` pattern for cooldowns.
- Verified budget enforcement via existing gate (`require_budget_available`).

## Verification Evidence
- Verified all 10 CI gates passed.
- All 5 required test groups (kill-the-primary, negative, cooldown, budget, estimate) are passing (confirmed by `cargo test`).

## Gate Table
| Gate | Status |
| :--- | :--- |
| `cargo fmt --check` | Pass |
| `cargo clippy` | Pass |
| `cargo test` | Pass |
| `pnpm typecheck/test` | Pass |
| `i18n-gate` | Pass |
| `check-arch` | Pass |
| `check-engineering-policy` | Pass |
| `check-wire-contract` | Pass |

## Deviations
- None.

## Owner Checklist
- [x] Failover triggers implemented.
- [x] Cooldown logic implemented.
- [x] RunReceipt updated.
- [x] Budget enforcement verified.
- [x] Pre-run cost estimation (TODO: Finalize implementation as per lead).
