# Packet V1 Verification — run 2026-11-09-ui-v3

- Role: VERIFIER (independent of implementer and reviewer)
- Base: `4c65ead4f46cf97eecffd73149a57056e505568c` · reviewed HEAD: `017ffb9d98f63181ec73d9b00a8b81df1e0b29dc`
- Worktrees: Windows `warsha-wt/v3/v1` (clean before/after), capture `/root/verify-v1` (detached at HEAD), capture scratch `/root/v1-scratch` (branch `scratch/v1-verify` at `4c65ead`, `merge --no-ff 017ffb9` → `6883dc7`, clean; never pushed, never on a run branch)
- Gates verbatim from `delegation/wave-a/V1.verify.brief.md`; executed 2026-11-09 ~13:52–14:16Z
- `/root/warsha-visual` never checked out (still 221 dirty entries)

## Per-gate results

| id | verdict | exit | log |
| --- | --- | --- | --- |
| V1.1 versions `--expect 0.2.1` | **pass** | 0 | `gates/V1.1.log` |
| V1.2 check-versions + `--self-test` | **pass** | 0 (0 and 0) | `gates/V1.2.log` |
| V1.3 pnpm install + `cargo metadata --locked --offline` | **pass** | 0 | `gates/V1.3.log` |
| V1.4 actionlint (capture) | **pass** | 0 | `gates/V1.4.log` |
| V1.5 workflow-level `*: write` absent | **pass** | 1 (expected) | `gates/V1.5.log` |
| V1.6 `draft: true` + `check-versions` in release.yml | **pass** | 0 | `gates/V1.6.log` |
| V1.7 keystore gitignore rules (4 paths) | **pass** | 0 | `gates/V1.7.log` |
| V1.8 README `840513` gone | **pass** | 1 (expected) | `gates/V1.8.log` |
| V1.9 Dockerfile OCI version label | **pass** | 0 | `gates/V1.9.log` |
| V1.10 scope allowlist | **pass** | 0 | `gates/V1.10.log` |
| V1.11 DAEMON.md truth (stale claims gone, 14 stages) | **pass** | 0 | `gates/V1.11.log` |
| V1.deps no dependency added/bumped | **pass** | 1 (expected) | `gates/V1.deps.log` |
| V1.snap `pw-gate snapshots $BASE HEAD -` | **pass** | 0 | `gates/V1.snap.log` |
| V1.pw scratch-merge full suite (capture) | **pass** | 0 | `gates/V1.pw.pw-gate.log` (+ `V1.pw.json`, `V1.pw.log`) |

### Evidence detail (log bodies)

- **V1.1** — all 13 version rows `0.2.1` / `versionCode 201 (want 201)`, `versions: aligned (expected 0.2.1)`, `GATE_EXIT=0`.
- **V1.2** — `versions: aligned`; `check-versions self-test: 4 assertions, 0 failures`; `COMBINED_EXIT=0`.
- **V1.3** — `PNPM_INSTALL_EXIT=0`, `CARGO_METADATA_EXIT=0`.
- **V1.4** — actionlint on `release.yml` + `desktop-bundle.yml` produced no findings; exit recorded by script: `GATE_EXIT=0`.
- **V1.5** — pre-`jobs:` block has no `contents/packages/id-token: write` (grep no match) → `GATE_EXIT=1`.
- **V1.6** — `draft: true` at release.yml:576; `check-versions --expect "${GITHUB_REF_NAME#v}"` at :60 → `COMBINED_EXIT=0`.
- **V1.7** — `git check-ignore` true for `a/x.jks`, `a/x.keystore`, `a/keystore.properties`, `a/x.p12` → `GATE_EXIT=0`.
- **V1.8** — no `840513` in `apps/mobile/README.md` → `GATE_EXIT=1`.
- **V1.9** — `docker/Dockerfile:84 LABEL org.opencontainers.image.version=$WARSHA_VERSION` → `GATE_EXIT=0`.
- **V1.10** — 15 changed files, all inside the allowlist (workflows, `.gitignore`, manifests, `pnpm-lock.yaml`, `build.gradle`, `README.md`, `docker/*`, `scripts/check-versions.mjs`, `docs/DAEMON.md`); outside list empty → `GATE_EXIT=0`.
- **V1.11** — stale-claim grep exit 1; all 14 stages (`idea … feedback`) present → `GATE_EXIT=0`.
- **V1.deps** — PIPESTATUS `0,0,1`; the only added manifest lines are `"version"` keys, explicitly excluded by the gate's second grep → pipeline exit **1** as required.
- **V1.snap** — `snapshot_changes=0 outside=0`, `GATE_EXIT=0`.
- **V1.pw** — scratch merge (`6883dc7`), `pnpm install --frozen-lockfile` OK, port guard free, `CI=true`, workers 2, no `--update-snapshots`, one invocation. **stats: 884 listed, expected 884, unexpected 0, flaky 0, skipped 0** (1057.4 s); **pw-gate vs `named/EMPTY.txt`: `unexpected=0 outside=0`, exit 0**. Scratch `*--snapshots*` status empty; scratch tree clean (0); Playwright process exit **0**.

## Classification

- Product failures: none (v2 suites 100% green after the R0 refresh at `4c65ead`).
- Environment/permission blockers: none — actionlint present on capture host; native Windows gates clean; no `0xC0000142`.
- Harness quirks: none affecting verdicts — WSL exit markers were taken from script-written `.exit` files (never `$?` inside `-lc` strings); every verdict is backed by a log body on disk.

## Uncovered scope

- No Rust/`cargo test` and no e2e behaviour beyond the v2 suite belong to V1 (covered by G0/F1/F2 gates).
- `actionlint` ran only on the two workflows named by the gate, not the whole `.github/workflows/` set.
- CI-side tag push and artifact signing/updater config remain human-only (listed by the run as out of scope).

## Blockers

None. All 14 gates **pass**.
