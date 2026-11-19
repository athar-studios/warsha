# Packet E5 — Visual baselines sweep report

**Date:** 2026-11-19. **Branch:** `r-next/e5-e1-cleanup`. **Base:** `11104c8` (`r-next/integration`).  
**Plan:** `docs/zadloop/R-NEXT-MASTER-PLAN.md` §E5 (rolling visual baseline sweep).

---

## 1. Delivered

- **Visual baselines sweep:** 144 new/changed visual surface baselines captured and verified byte-identical in one container session on the pinned F1 Docker capture host (`warsha-capture:0.3.0`, digest `sha256:581c7fc1b5c51dc3abb78534134071d45be81f29c4ca047de03b3b0385ac4b3f`):
  - `bench.spec.ts-snapshots`: 8 PNGs (`bench-newrun-mode-*`)
  - `code.spec.ts-snapshots`: 16 PNGs (`code-ready-*`, `code-file-*`)
  - `developers.spec.ts-snapshots`: 16 PNGs (`developers-ready-*`, `developers-detail-*`)
  - `factory.spec.ts-snapshots`: 8 PNGs (`factory-ready-*`)
  - `frame.spec.ts-snapshots`: 8 PNGs (`frame-quota-gauge-*`)
  - `settings.spec.ts-snapshots`: 88 PNGs (`settings-connections-ready-*`, `settings-export-ready-*`, `settings-mcp-ready-*`, `settings-nav-advanced-*`, `settings-nav-quick-*`, `settings-permissions-ready-*`, `settings-provider-auth-*`, `settings-swarm-ready-*`, `settings-usage-ready-*`)
  - Total committed snapshot PNGs: 144 newly tracked files (560 total in `apps/desktop/e2e/v3/`).
- **Baseline manifest updated:** `scripts/ci/baseline-manifest.json` updated with 144 E5 surface rows added (total 153 rows: 9 pre-R-NEXT rows kept intact, 144 E5 rows with `status: "captured"`, capture date `2026-11-19`, and image digest `sha256:581c7fc1b5c51dc3abb78534134071d45be81f29c4ca047de03b3b0385ac4b3f`).
- **Pre-existing debt audit:** verified that zero regressions were introduced in touched surfaces.

---

## 2. VERIFY evidence with paths

- **Playwright @visual verify:** `bridge-io/audit/e5/verify-1.log` (144 passed / 0 failed, 0 unexpected, 0 flaky; exit code 0; duration 5.3m).
- **Playwright verify JSON report:** `bridge-io/audit/e5/verify-1.json` (`status: "passed"`, 144 tests passed across 6 specs).
- **Docker capture host:** `warsha-capture:0.3.0` (image digest `sha256:581c7fc1b5c51dc3abb78534134071d45be81f29c4ca047de03b3b0385ac4b3f`, Linux Bookworm, pinned fontconfig `scripts/ci/capture-fontconfig.conf`).
- **Typecheck:** `bridge-io/audit/e5/typecheck.log` (`pnpm --filter warsha-desktop typecheck`, exit code 0).
- **Desktop unit/component tests:** `bridge-io/audit/e5/test.log` (`pnpm --filter warsha-desktop test`, 105 passed test files, 938 passed tests, exit code 0).
- **Architecture rules:** `bridge-io/audit/e5/arch.log` (`node scripts/check-arch.mjs`, 5 rules, 0 violations, exit code 0).
- **Design System V3:** `bridge-io/audit/e5/ds-v3.log` (`node scripts/check-ds-v3.mjs apps/desktop/src/v3 packages/i18n`, 0 violations, exit code 0).
- **Version alignment:** `bridge-io/audit/e5/versions.log` (`node scripts/check-versions.mjs`, exit code 0).
- **Engineering policy:** `bridge-io/audit/e5/engineering-policy.log` (`node scripts/check-engineering-policy.mjs`, 8 checks, 0 failures, exit code 0).
- **Actions gate:** `bridge-io/audit/e5/actions-gate.log` (`node scripts/ci/actions-gate.mjs`, 193 registered, 193 used, 0 violations, exit code 0).
- **i18n gate:** `bridge-io/audit/e5/i18n-gate.log` (`node scripts/ci/i18n-gate.mjs`, 1021 keys, 0 violations, exit code 0).
- **Gate tools self-test:**
  - `bridge-io/audit/e5/pw-genesis-selftest.log` (`node scripts/ci/pw-genesis.mjs --self-test`, exit code 0).
  - `bridge-io/audit/e5/pw-gate-selftest.log` (`node scripts/ci/pw-gate.mjs --self-test`, exit code 0).
- **Pre-existing debt logs:**
  - `bridge-io/audit/e5/wire-contract.log` (4 pre-existing violations: `catalog.refresh`/`catalog.apply` debt, identical to integration base).
  - `bridge-io/audit/e5/lint.log` (54 pre-existing errors in `apps/desktop/src/v3/`, 0 introduced by E5).

---

## 3. Third-party components audit (§3.3)

| Component | Version | Licence | Pin | Findings |
|---|---|---|---|---|
| node:22-bookworm-slim | 22-bookworm | MIT-style | sha256:e9f565d3... | LOW |
| @playwright/test | 1.49.1 | Apache-2.0 | Repo lockfile | LOW |
| IBM Plex Sans / Mono | google/fonts @ 6c1dbe27 | OFL-1.1 | SHA-256 per face | LOW |
| pnpm | 9.0.0 | MIT | Corepack pin | LOW |

No new third-party runtime or build dependencies added in this packet.

---

## 4. Gate results

| Gate | Exit Code | Result | Evidence Path |
|---|---|---|---|
| `pnpm --filter warsha-desktop typecheck` | 0 | Passed | `bridge-io/audit/e5/typecheck.log` |
| `pnpm --filter warsha-desktop test` | 0 | Passed (938/938) | `bridge-io/audit/e5/test.log` |
| `pnpm --filter warsha-desktop lint` | 1 | Pre-existing debt (54 errors) | `bridge-io/audit/e5/lint.log` |
| `node scripts/check-arch.mjs` | 0 | Passed (5/0) | `bridge-io/audit/e5/arch.log` |
| `node scripts/check-ds-v3.mjs` | 0 | Passed (0 violations) | `bridge-io/audit/e5/ds-v3.log` |
| `node scripts/check-versions.mjs` | 0 | Passed (aligned) | `bridge-io/audit/e5/versions.log` |
| `node scripts/check-engineering-policy.mjs` | 0 | Passed (8 checks, 0 failures) | `bridge-io/audit/e5/engineering-policy.log` |
| `node scripts/ci/actions-gate.mjs` | 0 | Passed (193/193) | `bridge-io/audit/e5/actions-gate.log` |
| `node scripts/ci/i18n-gate.mjs` | 0 | Passed (1021 keys, 0 violations) | `bridge-io/audit/e5/i18n-gate.log` |
| `node scripts/check-wire-contract.mjs` | 1 | Pre-existing debt (4 violations) | `bridge-io/audit/e5/wire-contract.log` |
| `@visual verify` (E5 surfaces) | 0 | Passed (144 passed / 0 failed) | `bridge-io/audit/e5/verify-1.log`, `verify-1.json` |

---

## 5. Fleet decisions

- **D-RN-E5-001** — 144 E5 surface baselines verified against F1 host inside the pinned-font Docker image (`warsha-capture:0.3.0`) and tracked in `scripts/ci/baseline-manifest.json`.

---

## 6. Deviations

None. No thresholds weakened; no tests deleted, skipped, or narrowed.

---

## 7. Owner checklist items

- **Visual baselines:** 144 surfaces captured and verified byte-identical on F1 host; 0 baselines left pending under §3.1.6.
- **Merge-ready:** branch `r-next/e5-e1-cleanup` is ready for merge into `r-next/integration`. Tag `r-next/cp-phase4` to be applied after merge per plan §E5.
