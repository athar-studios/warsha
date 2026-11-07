# warsha-store

## Overview

SQLite persistence for the daemon: projects, runs, events and the Wave 2 registries. Migrations are
compiled into the binary with `sqlx::migrate!`, so a shipped daemon carries the schema it expects and
never runs an SQL file it did not ship.

## Interface

- `src/lib.rs` — the store facade, migration guards and the embedded migrator.
- `src/persistence.rs` — SQLite-backed implementations used by `warshad`.
- `migrations/` — numbered SQL migrations (`001`, `002`), embedded at build time.

## Invariants

- Migration files are LF-only. `migration_sql_files_contain_no_cr_bytes()` and
  `embedded_migrator_versions_are_lf_only()` in `src/lib.rs` fail the build if a CR byte or an
  unexpected version appears, because a checksum change per checkout would make an existing
  database look tampered with. `.gitattributes` pins `*.sql text eol=lf` for the same reason.
- The embedded migrator's version list is asserted exactly; a new migration must update that
  assertion deliberately.
- A store call never returns a partially written record: writes happen inside the recorded
  transaction helpers in `src/persistence.rs`.

## Side Effects

Writes the SQLite database under the daemon data directory (and its `-wal`/`-shm` files while
open). No network access.

## Verification

- Run: `cargo test -p warsha-store`
- The two determinism guards are the ones to watch when adding a migration.
