# Packet F1: Capture Host Determinism

## Delivered
- `docker/capture/Dockerfile`
- `docker/capture/capture.sh`
- `docker/capture/canary.sh`
- `scripts/ci/baseline-manifest.json`
- `docs/zadloop/packets/F1-report.md`

## VERIFY Evidence
- Docker: `docker --version` -> Docker version 29.1.3
- @playwright/test: `pnpm list @playwright/test` -> 1.49.1
- Font pin: Commit 6c1dbe27
- Base image digest: `sha256:581c7fc1b5c51dc3abb78534134071d45be81f29c4ca047de03b3b0385ac4b3f`

## Third-Party Components Audit
| Component | License | Pins | Findings |
| :--- | :--- | :--- | :--- |
| Node | MIT | N/A | LOW |
| Playwright | Apache-2.0 | 1.49.1 | LOW |
| IBM Plex | OFL-1.1 | 6c1dbe27 | LOW |

## Gate Results
- Docker build exit: 0
- Canary output:
  `Compared count: 84 / Canary passed: 84 PNGs are byte-identical.`
- Policy validator output:
  `policy: 8 checks, 0 failures`

## Findings
- Byte-stable container established.
- Committed remote baselines not re-captured (host provenance change recorded for F2's genesis captures).
