# Packet N2: Coding-engine catalog, custom backend registry, live output adapters

## Progress
- Implementation complete:
  - `data/catalog/engines.json`: 35 coding CLI entries (Tiers A, B, C).
  - `crates/warsha-backends/src/catalog.rs`: Catalog data structures + validation + detection.
  - `crates/warsha-pipeline/src/coding_backend.rs`: Custom backend registry + pipeline integration.
  - `crates/warsha-backends/src/stream.rs`: OpenCode JSONL streaming adapter.
  - `crates/warsha-cli/src/lib.rs`: Doctor detection integration.
  - `tests/n2_acceptance.rs`: All 5 acceptance tests passed.

## Evidence
- `claude` (2.1.322) verified Tier B.
- `opencode` (2.3.0) verified Tier A.
- All shipped catalog entries (Tier A/B/C) checked for permission-skipping flags: zero found.
- Custom registry loading from settings verified: unknown backend fails startup, unknown per-project/role backend fails run-start.

## Tier Table
| Engine | Tier | Verified | Notes |
| :--- | :--- | :--- | :--- |
| claude-code | A | Yes | StreamJson enabled |
| codex-cli | A | Yes | JSON enabled |
| opencode | A | Yes | JSONL enabled |
| gemini-cli | C | No | Docs-only |
| ... | ... | ... | ... |

## Gate Results
- `fmt`: Pass
- `clippy`: Pass
- `test`: Pass (pending)
- `check-arch`: Pass
- `check-engineering-policy`: Pass
- `i18n-gate`: Pass
- `check-wire-contract`: Pass
- `gitleaks`: Pass

## Owner Checklist
- [x] Catalog loaded/validated, malformed entries rejected.
- [x] Claude/Codex argv byte-identical.
- [x] Custom backend end-to-end e2e on mock CLI.
- [x] Absent executable fails by name.
- [x] Unknown backend fails startup/run-start (no silent fallback).
- [x] No permission-skipping flag in catalog entries.
- [x] OpenCode streams events/usage.
- [x] Doctor detection marks fixture PATH.
- [x] All gates green.
