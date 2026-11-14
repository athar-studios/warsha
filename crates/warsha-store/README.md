# warsha-store

## Overview

SQLite persistence for the daemon: projects, runs, events and the Wave 2 registries, plus the
settings-shaped rows (preferences, backend kits, run modes, pairings, configured providers,
harnesses, skills, plugins, custom models, integrations). One `sqlx` pool over one `warsha.db`:
there is no second SQLite API and no second native SQLite in the tree. Migrations are compiled into
the binary with `sqlx::migrate!`, so a shipped daemon carries the schema it expects and never runs an
SQL file it did not ship.

## Interface

- `src/lib.rs` — the store facade (`Store`), the migration guards and the embedded migrator.
- `src/settings.rs` — `SettingsRepo`, the settings rows and the stored-row types, on the same pool.
- `migrations/` — numbered SQL migrations (`001`–`006`), embedded at build time. `006_settings.sql`
  owns every settings table, including the pairing-expiry column that used to be migration `005`.

## Invariants

- Migration files are LF-only. `migration_sql_files_contain_no_cr_bytes()` and
  `embedded_migrator_versions_are_lf_only()` in `src/lib.rs` fail the build if a CR byte or an
  unexpected version appears, because a checksum change per checkout would make an existing
  database look tampered with. `.gitattributes` pins `*.sql text eol=lf` for the same reason.
- The embedded migrator's version list is asserted exactly; a new migration must update that
  assertion deliberately. There is no skipped version: `006` is applied like any other.
- The configured providers are `configured_providers`, never `providers` — `001_initial.sql`
  already owns that name, and the two schemas share one file.
- `CREATE TABLE IF NOT EXISTS` cannot reshape a table that already exists, so the one shape SQLite
  cannot migrate (`pairing_devices` before the expiry column) is repaired by a guarded step after
  the migrator runs (`repair_settings_expiry`), which adds the column and grandfathers the rows that
  have no deadline.
- Every open sets WAL plus a five-second busy timeout, and `SettingsRepo::open` refuses to return a
  handle that is not in WAL.

## Side Effects

Writes the SQLite database under the daemon data directory (and its `-wal`/`-shm` files while
open). No network access.

## Verification

- Run: `cargo test -p warsha-store`
- The two determinism guards are the ones to watch when adding a migration.
- `tests/settings_characterization.rs` is the behaviour specification every settings method has to
  keep; `tests/settings_migration.rs` covers the three database states a migration has to survive
  (fresh, a legacy daemon database, mid-upgrade).
