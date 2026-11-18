//! The settings migration on the three database states it has to survive
//! (P-E7, OD-E7): a fresh file, a daemon database written before the
//! pairing-expiry column existed, and one written between the expiry migration
//! and this one.
//!
//! The fixture builds the older states with `sqlx` directly — the applied
//! migrations are the real files, filtered, so their checksums are the ones a
//! daemon has in its `_sqlx_migrations` ledger — and then opens the database
//! with the store the way the daemon does.

use std::path::{Path, PathBuf};

use sqlx::SqlitePool;
use tempfile::TempDir;
use warsha_store::Store;

/// The settings tables `006_settings.sql` owns.
const SETTINGS_TABLES: [&str; 11] = [
    "active_harness",
    "backend_kits",
    "configured_providers",
    "custom_models",
    "harnesses",
    "integrations",
    "pairing_devices",
    "plugins",
    "preferences",
    "run_modes",
    "skills",
];

/// The settings schema as the synchronous store created it *before* audit H1:
/// the same tables, with a four-column `pairing_devices`.
const PRE_H1_SETTINGS_SCHEMA_SQL: &str = "CREATE TABLE preferences (
    project_id     TEXT    NOT NULL,
    key            TEXT    NOT NULL,
    score          REAL    NOT NULL,
    evidence_count INTEGER NOT NULL,
    last_updated   INTEGER NOT NULL,
    PRIMARY KEY (project_id, key)
);
CREATE TABLE backend_kits (
    project_id  TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    url         TEXT NOT NULL,
    config_json TEXT NOT NULL
);
CREATE TABLE run_modes (
    mode        TEXT PRIMARY KEY,
    config_json TEXT NOT NULL
);
CREATE TABLE pairing_devices (
    device_id  TEXT PRIMARY KEY,
    secret     TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    revoked    INTEGER NOT NULL
);
CREATE TABLE configured_providers (
    name       TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,
    api_base   TEXT,
    enabled    INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE harnesses (
    id         TEXT PRIMARY KEY,
    version    TEXT NOT NULL,
    name       TEXT NOT NULL,
    description TEXT NOT NULL,
    data_json  TEXT NOT NULL,
    is_preset  INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE skills (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    source      TEXT NOT NULL,
    license     TEXT NOT NULL,
    content     TEXT NOT NULL,
    enabled     INTEGER NOT NULL,
    tags_json   TEXT NOT NULL
);
CREATE TABLE plugins (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    transport   TEXT NOT NULL,
    command     TEXT,
    args_json   TEXT NOT NULL,
    env_json    TEXT NOT NULL,
    enabled     INTEGER NOT NULL,
    tools_json  TEXT NOT NULL,
    source      TEXT NOT NULL
);
CREATE TABLE custom_models (
    provider       TEXT NOT NULL,
    model_id       TEXT NOT NULL,
    display_name   TEXT,
    context_window INTEGER,
    enabled        INTEGER NOT NULL,
    PRIMARY KEY (provider, model_id)
);
CREATE TABLE integrations (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    connected     INTEGER NOT NULL,
    config_json   TEXT NOT NULL,
    configured_at INTEGER
);
CREATE TABLE active_harness (
    project_id TEXT PRIMARY KEY,
    harness_id TEXT NOT NULL
);
INSERT INTO pairing_devices (device_id, secret, created_at, revoked)
VALUES ('legacy-device', 'legacy-secret', 1700000000, 0);
INSERT INTO preferences (project_id, key, score, evidence_count, last_updated)
VALUES ('project-1', 'dark mode', 2.5, 2, 1700000000);
INSERT INTO configured_providers (name, kind, api_base, enabled, created_at)
VALUES ('open_router', 'open_router', 'https://openrouter.ai/api/v1', 1, 1700000000);
";

/// The settings schema as the store created it *after* audit H1 and before this
/// migration: the same tables, with the expiry column added by 005.
const POST_H1_SETTINGS_SCHEMA_SQL: &str = "CREATE TABLE preferences (
    project_id     TEXT    NOT NULL,
    key            TEXT    NOT NULL,
    score          REAL    NOT NULL,
    evidence_count INTEGER NOT NULL,
    last_updated   INTEGER NOT NULL,
    PRIMARY KEY (project_id, key)
);
CREATE TABLE backend_kits (
    project_id  TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    url         TEXT NOT NULL,
    config_json TEXT NOT NULL
);
CREATE TABLE run_modes (
    mode        TEXT PRIMARY KEY,
    config_json TEXT NOT NULL
);
CREATE TABLE pairing_devices (
    device_id  TEXT PRIMARY KEY,
    secret     TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    revoked    INTEGER NOT NULL,
    expires_at INTEGER
);
CREATE TABLE configured_providers (
    name       TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,
    api_base   TEXT,
    enabled    INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE harnesses (
    id         TEXT PRIMARY KEY,
    version    TEXT NOT NULL,
    name       TEXT NOT NULL,
    description TEXT NOT NULL,
    data_json  TEXT NOT NULL,
    is_preset  INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE skills (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    source      TEXT NOT NULL,
    license     TEXT NOT NULL,
    content     TEXT NOT NULL,
    enabled     INTEGER NOT NULL,
    tags_json   TEXT NOT NULL
);
CREATE TABLE plugins (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    transport   TEXT NOT NULL,
    command     TEXT,
    args_json   TEXT NOT NULL,
    env_json    TEXT NOT NULL,
    enabled     INTEGER NOT NULL,
    tools_json  TEXT NOT NULL,
    source      TEXT NOT NULL
);
CREATE TABLE custom_models (
    provider       TEXT NOT NULL,
    model_id       TEXT NOT NULL,
    display_name   TEXT,
    context_window INTEGER,
    enabled        INTEGER NOT NULL,
    PRIMARY KEY (provider, model_id)
);
CREATE TABLE integrations (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    connected     INTEGER NOT NULL,
    config_json   TEXT NOT NULL,
    configured_at INTEGER
);
CREATE TABLE active_harness (
    project_id TEXT PRIMARY KEY,
    harness_id TEXT NOT NULL
);
INSERT INTO pairing_devices (device_id, secret, created_at, revoked, expires_at)
VALUES ('expiring-device', 'expiring-secret', 1700000000, 0, 1700000600);
INSERT INTO pairing_devices (device_id, secret, created_at, revoked, expires_at)
VALUES ('permanent-device', 'legacy-secret', 1700000100, 0, NULL);
INSERT INTO configured_providers (name, kind, api_base, enabled, created_at)
VALUES ('my-llm', 'custom', 'http://localhost:8000/v1', 1, 1700000100);
";

/// A fresh temp directory for one test's workspace.
fn fresh_tempdir() -> TempDir {
    if let Some(base) = std::env::var_os("CARGO_TARGET_TMPDIR") {
        let base = PathBuf::from(base);
        if base.is_dir() {
            if let Ok(dir) = TempDir::new_in(&base) {
                return dir;
            }
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(deps) = exe.parent() {
            let base = deps.join("tmp");
            if std::fs::create_dir_all(&base).is_ok() {
                if let Ok(dir) = TempDir::new_in(&base) {
                    return dir;
                }
            }
        }
    }
    TempDir::new().expect("tempdir for the test workspace")
}

/// A plain `sqlx` pool the fixture writes the older database states with.
async fn fixture_pool(path: &Path) -> SqlitePool {
    sqlx::SqlitePool::connect(&format!("sqlite://{}?mode=rwc", path.display()))
        .await
        .expect("the fixture database opens")
}

/// Apply the real migration files up to and including `max_version`.
///
/// Filtering the embedded migrator (rather than hand-writing schema SQL) is what
/// makes the fixture a database a daemon actually had: the `_sqlx_migrations`
/// rows carry the checksums of the shipped files.
async fn apply_migrations_through(pool: &SqlitePool, max_version: i64) {
    let mut migrator = sqlx::migrate!("./migrations");
    migrator
        .migrations
        .to_mut()
        .retain(|migration| migration.version <= max_version);
    migrator
        .run(pool)
        .await
        .expect("the prefix of migrations runs");
}

/// The versions recorded in the migration ledger, in order.
async fn applied_versions(pool: &SqlitePool) -> Vec<i64> {
    sqlx::query_scalar("SELECT version FROM _sqlx_migrations ORDER BY version")
        .fetch_all(pool)
        .await
        .expect("the migration ledger is readable")
}

/// Every non-`sqlite_` table in the database, in name order.
async fn tables(pool: &SqlitePool) -> Vec<String> {
    sqlx::query_scalar(
        "SELECT name FROM sqlite_master \
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC",
    )
    .fetch_all(pool)
    .await
    .expect("the schema is readable")
}

/// Whether `table` has a column named `column`.
async fn has_column(pool: &SqlitePool, table: &str, column: &str) -> bool {
    let found: Option<String> =
        sqlx::query_scalar("SELECT name FROM pragma_table_info(?) WHERE name = ?")
            .bind(table)
            .bind(column)
            .fetch_optional(pool)
            .await
            .expect("the schema is readable");
    found.is_some()
}

/// Assert the settings tables and the async schema are both there, exactly once.
async fn assert_full_schema(pool: &SqlitePool) {
    let names = tables(pool).await;
    for table in SETTINGS_TABLES {
        assert!(names.iter().any(|name| name == table), "{table} is missing");
    }
    // The async schema's own tables, from 001-004.
    for table in [
        "projects",
        "runs",
        "events",
        "gates",
        "artifacts",
        "costs",
        "mcp_permissions",
    ] {
        assert!(names.iter().any(|name| name == table), "{table} is missing");
    }
    // The two-schema trap: `providers` is 001's, `configured_providers` is 006's,
    // and both have to exist as separate tables.
    assert!(names.iter().any(|name| name == "providers"));
    assert!(names.iter().any(|name| name == "configured_providers"));
}

/// Fresh: a file that does not exist yet gets the async schema and the settings
/// schema in one migration run, and a second open is a no-op.
#[tokio::test]
async fn a_fresh_database_gets_the_whole_schema_once() {
    let dir = fresh_tempdir();
    let path = dir.path().join("warsha.db");

    let store = Store::open_at(path.clone())
        .await
        .expect("a fresh database migrates");
    assert_full_schema(store.pool()).await;
    assert_eq!(
        applied_versions(store.pool()).await,
        vec![1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
        "the ledger is every applied migration, in order"
    );
    assert!(has_column(store.pool(), "pairing_devices", "expires_at").await);
    drop(store);

    // Opening the same file again (what a second daemon start does) applies
    // nothing and leaves the ledger alone.
    let reopened = Store::open_at(path)
        .await
        .expect("the second open applies nothing");
    assert_eq!(
        applied_versions(reopened.pool()).await,
        vec![1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
    );
    assert_full_schema(reopened.pool()).await;
}

/// Legacy daemon database: the async schema at 001-004 plus the pre-H1 settings
/// tables, with rows in them. The new migration has to open it, add the expiry
/// column, grandfather the paired device and keep every row.
#[tokio::test]
async fn a_legacy_daemon_database_migrates_and_keeps_its_rows() {
    let dir = fresh_tempdir();
    let path = dir.path().join("warsha.db");

    let fixture = fixture_pool(&path).await;
    apply_migrations_through(&fixture, 4).await;
    sqlx::raw_sql(PRE_H1_SETTINGS_SCHEMA_SQL)
        .execute(&fixture)
        .await
        .expect("the pre-H1 settings schema and rows are written");
    assert!(
        !has_column(&fixture, "pairing_devices", "expires_at").await,
        "the fixture is the pre-H1 shape"
    );
    fixture.close().await;

    let before = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("the clock is after 1970")
        .as_secs();
    let store = Store::open_at(path.clone())
        .await
        .expect("a legacy daemon database migrates cleanly");
    assert_eq!(
        applied_versions(store.pool()).await,
        vec![1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
    );
    assert_full_schema(store.pool()).await;
    assert!(has_column(store.pool(), "pairing_devices", "expires_at").await);

    // The row a pre-H1 daemon paired is grandfathered with the 10-minute grace
    // window the expiry migration always used.
    let expires_at: Option<i64> = sqlx::query_scalar(
        "SELECT expires_at FROM pairing_devices WHERE device_id = 'legacy-device'",
    )
    .fetch_one(store.pool())
    .await
    .expect("the legacy row is readable");
    let expires_at = expires_at.expect("the legacy row was grandfathered");
    assert!(
        (before + 599..=before + 601).contains(&(expires_at as u64)),
        "the legacy pairing expires at {expires_at}, not ~10 minutes after {before}"
    );

    // The rows the older settings store wrote are untouched.
    let score: f64 =
        sqlx::query_scalar("SELECT score FROM preferences WHERE project_id = 'project-1'")
            .fetch_one(store.pool())
            .await
            .expect("the preference row survived");
    assert!((score - 2.5).abs() < 1e-9);
    let providers: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM configured_providers")
        .fetch_one(store.pool())
        .await
        .expect("the provider rows are readable");
    assert_eq!(providers, 1);
    drop(store);

    // A second start does not move the deadline again.
    let reopened = Store::open_at(path)
        .await
        .expect("the second open applies nothing");
    let deadlines: Vec<Option<i64>> =
        sqlx::query_scalar("SELECT expires_at FROM pairing_devices ORDER BY device_id")
            .fetch_all(reopened.pool())
            .await
            .expect("the pairing rows are readable");
    assert_eq!(deadlines, vec![Some(expires_at)]);
}

/// Mid-upgrade: a daemon database that already has the expiry column (the state
/// every running install is in today) migrates without touching its rows or
/// inventing a deadline for a pairing that deliberately has none.
#[tokio::test]
async fn a_mid_upgrade_database_keeps_both_shapes_of_pairing() {
    let dir = fresh_tempdir();
    let path = dir.path().join("warsha.db");

    let fixture = fixture_pool(&path).await;
    apply_migrations_through(&fixture, 4).await;
    sqlx::raw_sql(POST_H1_SETTINGS_SCHEMA_SQL)
        .execute(&fixture)
        .await
        .expect("the post-H1 settings schema and rows are written");
    fixture.close().await;

    let store = Store::open_at(path.clone())
        .await
        .expect("a post-H1 database migrates cleanly");
    assert_eq!(
        applied_versions(store.pool()).await,
        vec![1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
    );
    assert_full_schema(store.pool()).await;

    let rows: Vec<(String, Option<i64>)> =
        sqlx::query_as("SELECT device_id, expires_at FROM pairing_devices ORDER BY created_at ASC")
            .fetch_all(store.pool())
            .await
            .expect("the pairing rows are readable");
    assert_eq!(
        rows,
        vec![
            ("expiring-device".to_string(), Some(1_700_000_600)),
            ("permanent-device".to_string(), None),
        ],
        "the migration must not re-grandfather a row that deliberately has no deadline"
    );

    let providers: Vec<String> =
        sqlx::query_scalar("SELECT name FROM configured_providers ORDER BY name")
            .fetch_all(store.pool())
            .await
            .expect("the provider rows are readable");
    assert_eq!(providers, vec!["my-llm".to_string()]);
}

#[tokio::test]
async fn a_legacy_cost_database_migrates_and_adds_new_columns() {
    let dir = fresh_tempdir();
    let path = dir.path().join("warsha.db");
    let pool = fixture_pool(&path).await;

    // Apply migrations up to 006 (before 007)
    apply_migrations_through(&pool, 6).await;

    // Create required project first
    sqlx::query("INSERT INTO projects (id, name, description, language, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(vec![0u8; 16])
        .bind("test-project")
        .bind("")
        .bind("en")
        .bind("2026-11-15T00:00:00Z")
        .bind("2026-11-15T00:00:00Z")
        .execute(&pool)
        .await
        .expect("project inserted");

    // Create required run first to satisfy FK
    sqlx::query("INSERT INTO runs (id, project_id, status, current_stage, gate_states, artifacts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind("01J0000000000000000000001")
        .bind(vec![0u8; 16])
        .bind("starting")
        .bind("planning")
        .bind("{}")
        .bind("{}")
        .bind("2026-11-15T00:00:00Z")
        .bind("2026-11-15T00:00:00Z")
        .execute(&pool)
        .await
        .expect("run inserted");

    // Insert a legacy row
    sqlx::query("INSERT INTO costs (id, run_id, project_id, provider_id, model_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind("01J00000000000000000000000")
        .bind("01J0000000000000000000001")
        .bind(vec![0u8; 16])
        .bind("provider")
        .bind("model")
        .bind("2026-11-15T00:00:00Z")
        .execute(&pool)
        .await
        .expect("legacy row inserted");

    pool.close().await;

    // Migrate up to 007 and open
    let store = Store::open_at(path.clone())
        .await
        .expect("migration succeeds");

    // Check columns
    assert!(has_column(store.pool(), "costs", "cache_read_tokens").await);
    assert!(has_column(store.pool(), "costs", "source").await);

    // Verify row
    let row: (i64, String, bool, bool) = sqlx::query_as(
        "SELECT cache_read_tokens, source, estimated, cost_known FROM costs WHERE id = ?",
    )
    .bind("01J00000000000000000000000")
    .fetch_one(store.pool())
    .await
    .expect("row readable");

    assert_eq!(row.0, 0); // Default value
    assert_eq!(row.1, "api_metered"); // Default value
    assert!(!row.2); // Default value
    assert!(row.3); // Default value
}

#[tokio::test]
async fn a_legacy_project_database_migrates_and_adds_new_columns() {
    let dir = fresh_tempdir();
    let path = dir.path().join("warsha.db");
    let pool = fixture_pool(&path).await;

    // Apply migrations up to 008 (before 009)
    apply_migrations_through(&pool, 8).await;

    // Insert a legacy project row
    sqlx::query("INSERT INTO projects (id, name, description, language, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(vec![0u8; 16])
        .bind("test-project")
        .bind("")
        .bind("en")
        .bind("2026-11-15T00:00:00Z")
        .bind("2026-11-15T00:00:00Z")
        .execute(&pool)
        .await
        .expect("project inserted");

    pool.close().await;

    // Migrate up to 009 and open
    let store = Store::open_at(path.clone())
        .await
        .expect("migration succeeds");

    // Check columns
    assert!(has_column(store.pool(), "projects", "confinement").await);
    assert!(has_column(store.pool(), "projects", "approval_mode").await);

    // Verify row
    let row: (Option<String>, Option<String>) =
        sqlx::query_as("SELECT confinement, approval_mode FROM projects WHERE id = ?")
            .bind(vec![0u8; 16])
            .fetch_one(store.pool())
            .await
            .expect("row readable");

    assert!(row.0.is_none());
    assert!(row.1.is_none());
}
