# B1 Report

## Summary
Replaced cosmetic permission switch with a robust, stored, two-axis permission system (confinement + approval).

## Decisions
- D-RN-B1-1: Project permissions are persisted with confinement and approval_mode. Global default is stored in `run_modes` table under `permissions_default`. Per-project overrides use the new columns, which are nullable; `null` implies inheritance from the global default.
- D-RN-B1-2: Legacy permissions are bridged at load time in `crates/warsha-store/src/settings.rs` to maintain compatibility with older configuration formats.
- D-RN-B1-3: RPC methods `permissions.*` are authenticated with `Session` policy for gets and `Owner` for sets.

## Tests
- Added `a_legacy_project_database_migrates_and_adds_new_columns` to `crates/warsha-store/tests/settings_migration.rs` to verify the migration of existing projects.
- Verified all workspace tests pass.

## Findings
- Database schema successfully migrated to version 9.
- Authorization surface expanded to include new RPC methods.
- UI and client updated with new wire contracts.
- i18n keys added for confinement and approval modes.

## Desktop UI
- Implemented global default and per-project override permissions in Settings (`PermissionsSection`) and Project pages (`data-testid="project-permissions-sheet"`).
- Honest-copy info banner displayed in `PermissionsSection` in both languages:
  - EN: "Warsha's own tools are confined by path checks. CLI stages are confined by the CLI's own sandbox and flags. There is no operating-system sandbox around Warsha itself. 'Full access' means no path confinement for Warsha's tools and the CLI runs without its sandbox."
  - AR: "أدوات ورشة محصورة بفحوص المسار. مراحل CLI محصورة بصندوق الحماية ورايات CLI الخاصة بها. لا يوجد صندوق حماية على مستوى نظام التشغيل حول ورشة نفسها. 'وصول كامل' يعني عدم وجود حصر للمسار لأدوات ورشة ويعمل CLI بدون صندوق حمايته."
- Updated settings navigation test count (14 -> 15) in `apps/desktop/e2e/v3/settings.spec.ts` and `apps/desktop/src/v3/pages/settings/Settings.test.tsx`.
- Created `apps/desktop/e2e/v3/permissions.spec.ts` testing:
  - Settings: global default selects and RPC dispatch (`permissions.defaults.set`).
  - Project override: opening permissions sheet and setting override (`permissions.project.set`).
  - Honest-copy banner presence and visibility.
