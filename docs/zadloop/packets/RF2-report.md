# RF2-report: Baseline capture (visual v3)

**Goal:** Unblock F2 visual baselines via CI capture.
**Status:** In-progress.
**Workflow:** `.github/workflows/capture-baselines.yml`

## Execution Status
- **Run 1:** 43752538005 (In progress: https://github.com/athar-studios/warsha-dev/actions/runs/43752538005)

## Issues/Root Causes
- Initial workflow dispatch issues due to file not being registered on all branches/API.
- CI runs failing due to unrelated environment issues in existing CI (CodeQL config, Rust clippy).
- Current run is proceeding through main CI infrastructure.

## Plan
1. Confirm completion of run 43752538005.
2. Verify artifacts and generate 3-consecutive-green status.
3. Update report with final status.

Cost note: Public repository, GitHub-hosted minutes free.
