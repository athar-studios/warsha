# R-UI-4 — Part A: F2 Report

**Status:** Delivered with one blocked gate (§0.6) — baselines captured and committed from CI; the exact 416/0 verify protocol is recorded as blocked for the owner (RF2-report.md).

## 1. Canary Output
The host canary passed (84/84 within AA tolerance) — F1's pinned-font Docker capture host (`warsha-capture:0.3.0`).

## 2. Capture and Verification
All 8 v3 desktop spec files were captured **in CI** by the RF2 capture workflow (Amendment A7; local capture was proven non-deterministic — see RF2-report.md).
- **Spec files captured:** `bench` 96, `frame` 24, `home` 40, `inbox` 32, `onboarding` 32, `project` 40, `projects` 32, `settings` 120 — 416 total, committed at 88b41ba.
- **Genesis leg (CI run 43773883755):** 416 written, `pw-genesis unexpected=0 judged=0 defective=0`.
- **Verify leg (same run, one container session, D-RN-RF2-2):** **416 passed / 0 failed** (`pw-gate passed=416 failed=0 skipped=0`).
- **Blocked gate (§0.6):** the verify leg is not reproducible at 416/0 across page loads — the LCD subpixel fringe of horizontal rule ends flickers per page load (200+ measured passes; full evidence in `docs/zadloop/packets/RF2-report.md`). A7 forbids tolerance changes, so this is recorded as an owner decision, not silently tolerated. FIN4's @visual rows carry this finding.

## 3. Remote Baselines (D-RN-F2-2)
- Remote bench baselines re-captured due to host-provenance change (the committed ones predated the current tree — verified stale by pixel forensics: structural UI drift, not AA noise).
- Remote suite verified: 84 passed / 0 failed (same one-container session).

## 4. Manifest
- Updated `scripts/ci/baseline-manifest.json` with `captured` status for all surfaces, using image digest `sha256:581c7fc1b5c51dc3abb78534134071d45be81f29c4ca047de03b3b0385ac4b3f` and date `2026-11-15`.

## Decisions
- D-RN-F2-1 — local capture abandoned after non-determinism evidence; CI route per A7.
- D-RN-F2-2 — remote baselines re-captured in CI (stale committed baselines proven by structural pixel diff).
