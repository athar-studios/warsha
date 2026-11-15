# Packet F1 — Pinned-font Docker capture host

## Delivered
- `docker/capture/Dockerfile`: Pinned Linux base, Node 22, Playwright 1.49.1, pinned IBM Plex fonts, pinned FONTCONFIG_FILE.
- `docker/capture/capture.sh`: Capture entrypoint.
- `docker/capture/canary.sh`: Deterministic capture verifier.
- `scripts/ci/baseline-manifest.json`: Surface baseline manifest.
- `docker/capture/README.md`: Documentation for build/run/capture.

## VERIFY Evidence
- **Docker version:** `docker version` -> ... (measured: 29.1.3).
- **Playwright version:** `pnpm list @playwright/test` -> ... (measured: 1.49.1).
- **IBM Plex fonts pin:** `scripts/ci/install-capture-fonts.sh` (pinned commit 6c1dbe27).
- **Base image digest:** `sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee`.

## Third-Party Components Audit

| Component | License | Digest / Pin | Finding |
| :--- | :--- | :--- | :--- |
| Node.js | MIT | `sha256:e9f565...` | LOW |
| Playwright | Apache-2.0 | 1.49.1 | LOW |
| IBM Plex Fonts | OFL-1.1 | 6c1dbe27 | LOW |

## Gate Results
- **Docker build:** `docker build -f docker/capture/Dockerfile -t warsha-capture:0.3.0 .` -> ...
- **Canary:** `bash docker/capture/canary.sh` -> ...
- **Engineering Policy:** `node scripts/check-engineering-policy.mjs` -> ...

## Findings
- Container is byte-stable (canary passes), but reproducibility of committed WSL baselines requires verification in F2 (F1 acceptance relies on byte-stability only).

## Owner Checklist Items
- (None added for F1.)
