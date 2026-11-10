# OD1 review pack — the 40 failing remote visual cases

Expected / actual / diff images captured by Playwright during the OD4 rehearsal run on the
authoritative Linux x86_64 capture host (integration tree + W5 + INT-2).

**Nothing here is a new baseline.** No file under any `*-snapshots/` directory was created,
changed or deleted to produce this pack — these are Playwright failure artifacts only.

**What to look for:** the diff images should show *added product surface* (create-project and
start-run panels on Projects; run-controls, followup and artifacts on Run; the needs-you
densities) rather than shifted or broken layout. Added panels mean the baselines are older than
the product. A structural break would mean a real defect and should be fixed instead.

Total: 40 cases across 5 screen states,
120 PNG files (expected, actual, diff per case).

## needs-you — 12 cases

| viewport | locale | theme | images |
| --- | --- | --- | --- |
| 320x568 | ar | dark | `bench.visual-needs-you-320x568-ar-dark-remote--expected.png` / `--actual.png` / `--diff.png` |
| 320x568 | ar | light | `bench.visual-needs-you-320x568-ar-light-remote--expected.png` / `--actual.png` / `--diff.png` |
| 320x568 | en | dark | `bench.visual-needs-you-320x568-en-dark-remote--expected.png` / `--actual.png` / `--diff.png` |
| 320x568 | en | light | `bench.visual-needs-you-320x568-en-light-remote--expected.png` / `--actual.png` / `--diff.png` |
| 390x844 | ar | dark | `bench.visual-needs-you-390x844-ar-dark-remote--expected.png` / `--actual.png` / `--diff.png` |
| 390x844 | ar | light | `bench.visual-needs-you-390x844-ar-light-remote--expected.png` / `--actual.png` / `--diff.png` |
| 390x844 | en | dark | `bench.visual-needs-you-390x844-en-dark-remote--expected.png` / `--actual.png` / `--diff.png` |
| 390x844 | en | light | `bench.visual-needs-you-390x844-en-light-remote--expected.png` / `--actual.png` / `--diff.png` |
| 768x1024 | ar | dark | `bench.visual-needs-you-768x1024-ar-dark-remote--expected.png` / `--actual.png` / `--diff.png` |
| 768x1024 | ar | light | `bench.visual-needs-you-768x1024-ar-light-remote--expected.png` / `--actual.png` / `--diff.png` |
| 768x1024 | en | dark | `bench.visual-needs-you-768x1024-en-dark-remote--expected.png` / `--actual.png` / `--diff.png` |
| 768x1024 | en | light | `bench.visual-needs-you-768x1024-en-light-remote--expected.png` / `--actual.png` / `--diff.png` |

## needs-you-dense — 4 cases

| viewport | locale | theme | images |
| --- | --- | --- | --- |
| 320x568 | ar | dark | `bench.visual-needs-you-dense-320x568-ar-dark-remote--expected.png` / `--actual.png` / `--diff.png` |
| 320x568 | ar | light | `bench.visual-needs-you-dense-320x568-ar-light-remote--expected.png` / `--actual.png` / `--diff.png` |
| 320x568 | en | dark | `bench.visual-needs-you-dense-320x568-en-dark-remote--expected.png` / `--actual.png` / `--diff.png` |
| 320x568 | en | light | `bench.visual-needs-you-dense-320x568-en-light-remote--expected.png` / `--actual.png` / `--diff.png` |

## needs-you-permission — 4 cases

| viewport | locale | theme | images |
| --- | --- | --- | --- |
| 320x568 | ar | dark | `bench.visual-needs-you-permission-320x568-ar-dark-remote--expected.png` / `--actual.png` / `--diff.png` |
| 320x568 | ar | light | `bench.visual-needs-you-permission-320x568-ar-light-remote--expected.png` / `--actual.png` / `--diff.png` |
| 320x568 | en | dark | `bench.visual-needs-you-permission-320x568-en-dark-remote--expected.png` / `--actual.png` / `--diff.png` |
| 320x568 | en | light | `bench.visual-needs-you-permission-320x568-en-light-remote--expected.png` / `--actual.png` / `--diff.png` |

## projects — 8 cases

| viewport | locale | theme | images |
| --- | --- | --- | --- |
| 320x568 | ar | dark | `bench.visual-projects-320x568-ar-dark-remote--expected.png` / `--actual.png` / `--diff.png` |
| 320x568 | ar | light | `bench.visual-projects-320x568-ar-light-remote--expected.png` / `--actual.png` / `--diff.png` |
| 320x568 | en | dark | `bench.visual-projects-320x568-en-dark-remote--expected.png` / `--actual.png` / `--diff.png` |
| 320x568 | en | light | `bench.visual-projects-320x568-en-light-remote--expected.png` / `--actual.png` / `--diff.png` |
| 390x844 | ar | dark | `bench.visual-projects-390x844-ar-dark-remote--expected.png` / `--actual.png` / `--diff.png` |
| 390x844 | ar | light | `bench.visual-projects-390x844-ar-light-remote--expected.png` / `--actual.png` / `--diff.png` |
| 390x844 | en | dark | `bench.visual-projects-390x844-en-dark-remote--expected.png` / `--actual.png` / `--diff.png` |
| 390x844 | en | light | `bench.visual-projects-390x844-en-light-remote--expected.png` / `--actual.png` / `--diff.png` |

## run — 12 cases

| viewport | locale | theme | images |
| --- | --- | --- | --- |
| 320x568 | ar | dark | `bench.visual-run-320x568-ar-dark-remote--expected.png` / `--actual.png` / `--diff.png` |
| 320x568 | ar | light | `bench.visual-run-320x568-ar-light-remote--expected.png` / `--actual.png` / `--diff.png` |
| 320x568 | en | dark | `bench.visual-run-320x568-en-dark-remote--expected.png` / `--actual.png` / `--diff.png` |
| 320x568 | en | light | `bench.visual-run-320x568-en-light-remote--expected.png` / `--actual.png` / `--diff.png` |
| 390x844 | ar | dark | `bench.visual-run-390x844-ar-dark-remote--expected.png` / `--actual.png` / `--diff.png` |
| 390x844 | ar | light | `bench.visual-run-390x844-ar-light-remote--expected.png` / `--actual.png` / `--diff.png` |
| 390x844 | en | dark | `bench.visual-run-390x844-en-dark-remote--expected.png` / `--actual.png` / `--diff.png` |
| 390x844 | en | light | `bench.visual-run-390x844-en-light-remote--expected.png` / `--actual.png` / `--diff.png` |
| 768x1024 | ar | dark | `bench.visual-run-768x1024-ar-dark-remote--expected.png` / `--actual.png` / `--diff.png` |
| 768x1024 | ar | light | `bench.visual-run-768x1024-ar-light-remote--expected.png` / `--actual.png` / `--diff.png` |
| 768x1024 | en | dark | `bench.visual-run-768x1024-en-dark-remote--expected.png` / `--actual.png` / `--diff.png` |
| 768x1024 | en | light | `bench.visual-run-768x1024-en-light-remote--expected.png` / `--actual.png` / `--diff.png` |

## If you decide to refresh (Phase B, decision D1)

On the capture host, from a clean worktree at the accepted integration tip:

1. `pnpm install --frozen-lockfile`
2. `pnpm exec playwright test --project=remote --update-snapshots`
3. Review the refreshed PNGs as a diff against HEAD **before** committing them.
4. `pnpm exec playwright test --project=remote` with no flags — expect 91 passed, 0 failed.
5. Re-run `GC.10` and `GC.12` at the new tip.

That refresh is the only work left on the remote side, and it changes only `*-snapshots/` files.
