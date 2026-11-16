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
