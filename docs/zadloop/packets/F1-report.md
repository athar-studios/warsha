# Packet F1 — pinned-font Docker capture host

Date: 2026-11-15. Branch: `r-next/f1-capture-host`. Base: `debc525` (`r-next/integration` after F0).
Plan: `docs/zadloop/R-NEXT-MASTER-PLAN.md` §4 F1. Attempts: 1 + 3 corrections; the final
determinism repair (AA-tolerance canary) was completed by the PM after the worker stalled, as the
fix to the packet's own acceptance artifact.

## Delivered

- `docker/capture/Dockerfile` — capture image: `node:22-bookworm-slim` pinned by digest
  (`sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee`), pnpm 9.0.0 via
  corepack, `@playwright/test` 1.49.1 from the repo's own lockfile with its chromium
  (`playwright install chromium`; system libs apt-pinned in the same layer), the nine IBM Plex
  faces installed by the repo's pinned `scripts/ci/install-capture-fonts.sh`
  (google/fonts commit `6c1dbe27`, SHA-256 per face, refuses on mismatch), `FONTCONFIG_FILE`
  pinned to `scripts/ci/capture-fontconfig.conf`.
- `docker/capture/capture.sh` — one-command capture: mounts the repo, runs
  `pnpm exec playwright test --project=<p> <spec>` inside the container as the host user
  (`--user`, `HOME=/tmp/pw-home`) with pinned resources (`--cpus=2 --memory=4g --shm-size=1g`),
  output to a host directory. Passes extra args through to Playwright.
- `docker/capture/canary.sh` — the acceptance gate: captures the remote bench surface twice, then
  compares **decoded pixels** (pure-Python PNG decoder, no new dependency): per-image, every
  differing pixel within `WARSHA_CANARY_MAX_DELTA` (13) per channel and at most
  `WARSHA_CANARY_MAX_PIXELS` (64) of them; fails on zero captures, count mismatch, missing/extra
  images, and geometry/format mismatches.
- `scripts/ci/baseline-manifest.json` — per-surface manifest (9 surface rows, all `pending` until
  F2 captures them) plus the `f1` canary record (digest + date).
- `docker/capture/README.md` — build/canary/capture docs, the tolerance rationale, manifest shape.

## VERIFY evidence

- `docker --version` → Docker version 29.1.3, build 29.1.3-0ubuntu4.1 (2026-11-15).
- `@playwright/test` 1.49.1 (repo `package.json` devDependency; installed from the repo's own
  `pnpm-lock.yaml` inside the image).
- Font pin: `scripts/ci/install-capture-fonts.sh` — commit `6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec`,
  nine faces, SHA-256 verified in-build (script exits non-zero on mismatch).
- Capture image digest: `sha256:581c7fc1b5c51dc3abb78534134071d45be81f29c4ca047de03b3b0385ac4b3f`
  (`docker images --digests warsha-capture`, 2026-11-15) — recorded in the manifest's `f1` row.

## Third-party components audit (§3.3)

| Component | Version | Licence | Pin | Findings |
|---|---|---|---|---|
| node:22-bookworm-slim (base) | 22-bookworm, digest-pinned | Node licence (MIT-style) | `sha256:e9f565d3…` | LOW |
| @playwright/test | 1.49.1 | Apache-2.0 | repo lockfile | LOW |
| IBM Plex Sans Arabic / Mono | google/fonts @ `6c1dbe27` | OFL-1.1 | SHA-256 per face | LOW |
| pnpm | 9.0.0 | MIT | corepack pin | LOW |

No install-time scripts run from third-party packages beyond Playwright's own browser installer;
no new egress at capture time (dev servers are local; the harness stubs its daemon).

## Gate results

- `docker build -f docker/capture/Dockerfile -t warsha-capture:0.3.0 .` → exit 0 (built
  2026-11-15, 2.23 GB).
- `bash docker/capture/canary.sh` → **pass**: `Compared count: 84` +
  `Canary passed: 84 PNGs within the AA tolerance (decoded-pixel compare).` — run by the PM on the
  final tree. History: byte-compare canary failed ~1 run in 2 (3 px, ≤ 8 levels, SVG brand-mark AA
  edge; runs measured 2026-11-15 17:47–20:16, 4 mismatching runs incl. 3 consecutive with
  `--cpus=2` pinning), which matches the repo's measured Chromium behaviour
  (`playwright.config.ts:56-64`: "two captures of one tree and one case differ by 10–60 px at 1–2
  levels"; rasterizer flags tried and reverted upstream).
- Tamper test (PM): a 60-level, 140×40-px block edit in one PNG is rejected by the compare
  (`failures: 1`), the untouched 83 pass — the tolerance does not blind it.
- `node scripts/check-engineering-policy.mjs` → `policy: 8 checks, 0 failures`.
- `node scripts/check-arch.mjs` → `arch: 5 rules, 0 violations`.

## Fleet decisions (PM to log)

- **D-RN-F1-1:** the canary compares decoded pixels with per-channel delta ≤ 13 and ≤ 64 differing
  px per image, instead of plan-literal byte identity. Decision rule §0.4: follow the repo (the
  repo's own measured contract is `threshold: 0.05`, tolerance on magnitude not count — a byte
  gate is unachievable on this rasterizer and contradicts the shipped config); fail closed is
  preserved (structural changes still fail; missing/extra images fail).

## Findings

- The container is deterministic up to the rasterizer's AA jitter; fresh captures are stable under
  the repo's threshold contract. The committed remote baselines were NOT re-captured and still
  differ from this container's rasterization (host provenance change) — F2's genesis captures must
  capture them fresh on this host, per R-UI-4 Part A's protocol.
- Playwright's own `maxDiffPixelRatio: 0` with `threshold` unset would flake on the same 3-px AA
  jitter; the config already sets `threshold: 0.05` globally, which is what makes F2's captures
  viable.

## Owner checklist items

- None added for F1.
