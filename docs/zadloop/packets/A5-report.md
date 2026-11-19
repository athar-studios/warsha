# A5 — Final code-health audit report (2026-11-19)

Audit of the R-NEXT tree at branch `r-next/a5-health` (commit `978e40e`) before Z1.

## HIGH/MEDIUM/LOW Audit Table

| Finding | Severity | Status | Decision/Note |
| :--- | :--- | :--- | :--- |
| `cargo deny` advisory failures | HIGH | Recorded | `D-RN-A5-1`: Dependency bump (oauth2 5.x) required; non-mechanical. |
| `wire` contract violations | MEDIUM | Recorded | `catalog.refresh`/`apply` lack e2e stubs. |
| `actions` gate (19 violations) | MEDIUM | Recorded | 176 registered vs 182 used; coverage gaps in settings/permissions. |
| `ds-v3` Gauge.css literals | LOW | Recorded | Length-literal violations in `packages/ui/src/v3/composites/Gauge.css`. |

## Gate Matrix Results (Evidence: `bridge-io/audit/a5/`)

| Check | Result | Evidence |
| :--- | :--- | :--- |
| `cargo fmt` | PASS | `fmt.log` |
| `clippy` | PASS | `clippy.log` |
| `cargo test` | PASS | `cargo-test.log` |
| `arch` | PASS | `arch.log` |
| `versions` | PASS | `versions.log` |
| `i18n` | PASS | `i18n.log` |
| `gitleaks` | PASS | `gitleaks.log` |
| `policy` | PASS | `policy.log` |
| `wire` | FAIL | `wire.log` |
| `actions` | FAIL | `actions.log` |
| `ds-v3` | FAIL | `dsv3.log` |
| `deny` | FAIL | `deny-root.log` |

## Inventory Sweep
- **TODO/FIXME:** 32 items inventoried (primarily `M20 wiring` technical debt).
- **#[ignore]:** 14 tests ignored (child process handling).
- **Duplication:** 10 potential helpers detected; no byte-identical dedup possible.
- **Largest Files:** Report included in `largest.txt`.
- **Docs Freshness:** `SECURITY.md` updated to `0.3.0`.
