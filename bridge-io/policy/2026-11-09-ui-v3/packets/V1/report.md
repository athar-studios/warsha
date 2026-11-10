# Packet V1 Report: release-truth

- Run: `2026-11-09-ui-v3`
- Packet: `V1` (`release-truth`)
- Role: Implementer
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/v1`
- Branch: `run/2026-11-09-ui-v3/v1-release-truth`
- Base commit: `4c65ead4f46cf97eecffd73149a57056e505568c`
- Head commit: `017ffb9d98f63181ec73d9b00a8b81df1e0b29dc`

## Changes Per Step

1. **Workspace version alignment (0.2.1)**:
   - Root `package.json`, `apps/remote/package.json`, and `packages/{ui,client,i18n,crypto}/package.json` updated from `0.1.0` to `0.2.1`.
   - `apps/mobile/android/app/build.gradle`: updated `versionName` to `"0.2.1"` and `versionCode` to `201` (`0*10000 + 2*100 + 1`).
   - `docker/compose.yml`: updated daemon image tag from `warsha/warshad:0.1.0` to `warsha/warshad:0.2.1`.

2. **Automated version tool (`scripts/check-versions.mjs`) & root script**:
   - Implemented dependency-free `scripts/check-versions.mjs` supporting `--expect <v>`, `--set <v>`, and `--self-test`.
   - Validates all workspace package versions, `Cargo.toml [workspace.package]`, `apps/desktop/src-tauri/{Cargo.toml,tauri.conf.json}`, `apps/desktop/package.json`, mobile `versionName`/`versionCode`, `docker/compose.yml` tag, and offline `Cargo.lock` workspace crate entries.
   - Added root `"versions": "node scripts/check-versions.mjs"` script to `package.json`.

3. **Dockerfile version metadata**:
   - Added `ARG WARSHA_VERSION=0.2.1` and runtime stage `LABEL org.opencontainers.image.version=$WARSHA_VERSION` to `docker/Dockerfile`.

4. **Android asset sync build guarantee**:
   - In `apps/mobile/android/app/build.gradle` (`syncRemoteWebAssets`), removed the missing-directory condition so `apps/remote` is always built with pnpm before asset sync.
   - Maintained `Sync` task type, `**/*.map` exclusion, and loud failure (`GradleException`).

5. **Root `.gitignore`**:
   - Added `*.jks`, `*.keystore`, `*.p12`, and `keystore.properties` to ensure Android signing credentials cannot be committed.

6. **Release workflow permissions & version guard**:
   - In `.github/workflows/release.yml`: scoped top-level permissions to `contents: read`, removed unused `packages: write` and `id-token: write`, and granted `contents: write` specifically to the `release` job.
   - Added early check step in `prepare` job running `node scripts/check-versions.mjs --expect "${GITHUB_REF_NAME#v}"`.
   - Kept `draft: true` on the GitHub release step.
   - Corrected the stale comment at `.github/workflows/desktop-bundle.yml:18` regarding `bundle.createUpdaterArtifacts`.

7. **Mobile documentation cleanup**:
   - In `apps/mobile/README.md`: removed the `840513` size contradiction (updated to 842981), removed the stale UTC build date, and retained v0.2.0 APK verification facts as a dated record.

8. **Daemon documentation alignment**:
   - In `docs/DAEMON.md`: updated pipeline stage serialization to explicitly list all 14 `Stage` variants from `crates/warsha-core/src/lib.rs:74-89` (`idea`, `gate_a`, `research`, `prd_spec`, `gate_b`, `design`, `plan_tasks`, `code`, `review_qa_security`, `gate_c`, `release`, `gate_d`, `launch_drafts`, `feedback`), removing the stale "no `gate_a`/`gate_b` stage" statement.
   - Replaced stale empty-vector description with an accurate overview of live `providers.*` RPC handlers (keychain secret store, database persistence, and active health probing).

## Decisions & Alternatives Rejected

1. **Dependency-free Node CLI for `check-versions.mjs`**:
   - Decision: Built using `node:fs`, `node:path`, `node:os` standard library modules without external npm dependencies.
   - Alternative rejected: Installing `semver` or `@iarna/toml`. Rejected to guarantee execution before `pnpm install` across CI runners and offline containers.

2. **Scoped permissions in `release.yml`**:
   - Decision: Tightened top-level workflow permissions to `contents: read` and isolated `contents: write` to the `release` draft publication job, dropping `packages: write` and `id-token: write`.
   - Alternative rejected: Keeping write permissions at the workflow root level. Rejected to follow least-privilege security principles and satisfy Gate V1.5.

3. **Unconditional build in Gradle `syncRemoteWebAssets`**:
   - Decision: Removed the check for existing dist/index.html to ensure clean rebuild on every sync.
   - Alternative rejected: Checking file timestamps or checksums. Rejected to guarantee that changes to remote source files are always compiled before APK bundling.

4. **Dated record in `apps/mobile/README.md`**:
   - Decision: Preserved historical v0.2.0 verification hashes as an explicit dated baseline while removing the contradictory stat output and stale timestamp.
   - Alternative rejected: Deleting the release artifact section entirely. Rejected because having a reproducible verification record for previous releases remains valuable documentation.

## Measured Unit Counts

- Version fields check: 13/13 fields aligned to `0.2.1`, `versionCode` `201`.
- `check-versions.mjs --self-test`: 4 assertions, 0 failures.
- `pnpm policy`: 8 checks, 0 failures.
- `pnpm arch`: 5 rules, 0 violations.
- `actionlint`: 0 errors across `.github/workflows/release.yml` and `.github/workflows/desktop-bundle.yml`.
- `git diff --stat BASE..HEAD`: 15 files changed, 454 insertions(+), 46 deletions(-).

## Frozen Gates Verdict

- `V1.1`: Pass (exit 0, `versions: aligned (expected 0.2.1)`).
- `V1.2`: Pass (exit 0, `check-versions self-test: 4 assertions, 0 failures`).
- `V1.3`: Pass (exit 0, frozen lockfile valid, cargo metadata locked & offline).
- `V1.4`: Pass (exit 0, `actionlint` clean).
- `V1.5`: Pass (exit 1, no top-level write permissions before `jobs:`).
- `V1.6`: Pass (exit 0, `draft: true` and `check-versions` present).
- `V1.7`: Pass (exit 0, `.jks`, `.keystore`, `.p12`, `keystore.properties` ignored).
- `V1.8`: Pass (exit 1, `840513` contradiction removed).
- `V1.9`: Pass (exit 0, `org.opencontainers.image.version` present in `docker/Dockerfile`).
- `V1.10`: Pass (exit 0, all modified files within allowed scope regex).
- `V1.11`: Pass (exit 0, all 14 stages present, stale claims removed).
- `V1.deps`: Pass (exit 1, no dependencies added or bumped).
- `V1.snap`: Pass (exit 0, `snapshot_changes=0`).

## Left Alone (Out of Packet Scope)

- `packages/client/src/index.test.ts` pre-existing lint unused variable errors on base commit `4c65ead`: left alone to avoid modifying files outside V1 allowed scope (Gate V1.10).
