//! Characterization tests for the settings store (P-E7).
//!
//! These cases were written against the synchronous `rusqlite` `SqliteStore`
//! *before* its rows moved onto the async `sqlx` pool, and they pinned the
//! behaviour the migration had to preserve: every case ran against both
//! implementations while both existed. The synchronous one is gone, so they are
//! now the shipped specification of [`SettingsRepo`] — every method, including
//! the legacy-schema upgrade the pairing-expiry column performs.
//!
//! The cases are still written against the private [`SettingsOps`] seam: it costs
//! one thin impl and keeps the case bodies implementation-agnostic.
//!
//! Only the SQLite file is touched, and only inside a temporary directory.

use std::path::{Path, PathBuf};

use tempfile::TempDir;
use warsha_store::{
    SettingsRepo, StoreError, StoredBackendKit, StoredCustomModel, StoredHarness,
    StoredIntegration, StoredPairing, StoredPlugin, StoredPreference, StoredProvider,
    StoredRunMode, StoredSkill,
};

/// The marker [`StoredPairing`]'s `Debug` impl prints in place of the secret.
const REDACTED_SECRET: &str = "<redacted>";

/// The settings schema as a pre-audit-H1 database had it: `pairing_devices`
/// without the `expires_at` column the expiry migration adds.
///
/// Written out literally, not through the store, because the point is to open a
/// database this binary has never written.
const LEGACY_PAIRING_SCHEMA_SQL: &str = "\
CREATE TABLE pairing_devices (
    device_id  TEXT PRIMARY KEY,
    secret     TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    revoked    INTEGER NOT NULL
);
INSERT INTO pairing_devices (device_id, secret, created_at, revoked)
VALUES ('legacy-device', 'legacy-secret', 1700000000, 0);
";

/// A fresh temp directory for one test's workspace.
///
/// Same preference order as the store's own tests: cargo's target tmp dir, then
/// a `tmp` sibling of the test binary, then the system temp dir.
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

/// The database path inside a fresh temporary directory.
fn fresh_db(dir: &TempDir) -> String {
    dir.path().join("warsha.db").to_string_lossy().into_owned()
}

/// Write a database whose `pairing_devices` table is the four-column pre-H1
/// shape, with one row in it, using `sqlx` directly so no implementation under
/// test is involved in building the fixture.
async fn write_legacy_database(path: &Path) -> sqlx::SqlitePool {
    let url = format!("sqlite://{}?mode=rwc", path.display());
    let pool = sqlx::SqlitePool::connect(&url)
        .await
        .expect("the legacy database opens");
    sqlx::raw_sql(LEGACY_PAIRING_SCHEMA_SQL)
        .execute(&pool)
        .await
        .expect("the pre-H1 schema and row are written");
    pool
}

/// Every settings-store operation the cases below need, so one case body can be
/// run against more than one implementation.
///
/// The method names and signatures mirror the synchronous store's own, which is
/// what makes the cases read like the store's tests.
trait SettingsOps: Sized {
    /// Open (creating if necessary) the database at `path`.
    async fn open(path: &str) -> Result<Self, StoreError>;
    /// Create the settings schema, idempotently.
    async fn migrate(&self) -> Result<(), StoreError>;
    /// The tables in the database, in name order.
    async fn tables(&self) -> Result<Vec<String>, StoreError>;
    /// The database's journal mode, as SQLite reports it.
    async fn journal_mode(&self) -> Result<String, StoreError>;

    /// Insert or replace one derived preference.
    async fn save_preference(&self, preference: &StoredPreference) -> Result<(), StoreError>;
    /// One project's preferences, highest score first.
    async fn load_preferences(&self, project_id: &str)
        -> Result<Vec<StoredPreference>, StoreError>;

    /// Insert or replace one project's backend kit.
    async fn save_backend_kit(&self, kit: &StoredBackendKit) -> Result<(), StoreError>;
    /// One project's backend kit.
    async fn load_backend_kit(
        &self,
        project_id: &str,
    ) -> Result<Option<StoredBackendKit>, StoreError>;

    /// Insert or replace one run mode.
    async fn save_run_mode(&self, config: &StoredRunMode) -> Result<(), StoreError>;
    /// One run mode's config.
    async fn load_run_mode(&self, mode: &str) -> Result<Option<StoredRunMode>, StoreError>;

    /// Insert or replace one pairing.
    async fn save_pairing(&self, pairing: &StoredPairing) -> Result<(), StoreError>;
    /// Every pairing, oldest first.
    async fn load_pairings(&self) -> Result<Vec<StoredPairing>, StoreError>;

    /// Insert or replace one configured provider.
    async fn save_provider(&self, provider: &StoredProvider) -> Result<(), StoreError>;
    /// One provider by name.
    async fn load_provider(&self, name: &str) -> Result<Option<StoredProvider>, StoreError>;
    /// Every provider, oldest first.
    async fn load_providers(&self) -> Result<Vec<StoredProvider>, StoreError>;
    /// Delete one provider, answering whether there was one.
    async fn delete_provider(&self, name: &str) -> Result<bool, StoreError>;

    /// Insert or replace one harness.
    async fn save_harness(&self, harness: &StoredHarness) -> Result<(), StoreError>;
    /// One harness by id.
    async fn load_harness(&self, id: &str) -> Result<Option<StoredHarness>, StoreError>;
    /// Every harness, oldest first.
    async fn load_harnesses(&self) -> Result<Vec<StoredHarness>, StoreError>;
    /// Delete one harness, answering whether there was one.
    async fn delete_harness(&self, id: &str) -> Result<bool, StoreError>;
    /// Point a project at a harness.
    async fn set_active_harness(
        &self,
        project_id: &str,
        harness_id: &str,
    ) -> Result<(), StoreError>;
    /// The harness a project is pointed at.
    async fn get_active_harness(&self, project_id: &str) -> Result<Option<String>, StoreError>;
    /// Clear a project's harness selection.
    async fn clear_active_harness(&self, project_id: &str) -> Result<bool, StoreError>;

    /// Insert or replace one skill.
    async fn save_skill(&self, skill: &StoredSkill) -> Result<(), StoreError>;
    /// One skill by id.
    async fn load_skill(&self, id: &str) -> Result<Option<StoredSkill>, StoreError>;
    /// Every skill, by name.
    async fn load_skills(&self) -> Result<Vec<StoredSkill>, StoreError>;
    /// Delete one skill.
    async fn delete_skill(&self, id: &str) -> Result<bool, StoreError>;
    /// Flip a skill's enabled flag.
    async fn toggle_skill(&self, id: &str) -> Result<Option<bool>, StoreError>;

    /// Insert or replace one plugin pack.
    async fn save_plugin(&self, plugin: &StoredPlugin) -> Result<(), StoreError>;
    /// One plugin by id.
    async fn load_plugin(&self, id: &str) -> Result<Option<StoredPlugin>, StoreError>;
    /// Every plugin pack, by name.
    async fn load_plugins(&self) -> Result<Vec<StoredPlugin>, StoreError>;
    /// Delete one plugin pack.
    async fn delete_plugin(&self, id: &str) -> Result<bool, StoreError>;
    /// Flip a plugin's enabled flag.
    async fn toggle_plugin(&self, id: &str) -> Result<Option<bool>, StoreError>;

    /// Insert or replace one custom model.
    async fn save_custom_model(&self, model: &StoredCustomModel) -> Result<(), StoreError>;
    /// One custom model by provider and model id.
    async fn load_custom_model(
        &self,
        provider: &str,
        model_id: &str,
    ) -> Result<Option<StoredCustomModel>, StoreError>;
    /// Every custom model.
    async fn load_custom_models(&self) -> Result<Vec<StoredCustomModel>, StoreError>;
    /// Delete one custom model.
    async fn delete_custom_model(&self, provider: &str, model_id: &str)
        -> Result<bool, StoreError>;
    /// Flip a custom model's enabled flag.
    async fn toggle_custom_model(
        &self,
        provider: &str,
        model_id: &str,
    ) -> Result<Option<bool>, StoreError>;

    /// Insert or replace one integration, keeping the stored config when
    /// `config_json` is `None`.
    async fn save_integration(
        &self,
        integration: &StoredIntegration,
        config_json: Option<&str>,
    ) -> Result<(), StoreError>;
    /// One integration by id.
    async fn load_integration(&self, id: &str) -> Result<Option<StoredIntegration>, StoreError>;
    /// Every integration, by name.
    async fn load_integrations(&self) -> Result<Vec<StoredIntegration>, StoreError>;
    /// Delete one integration.
    async fn delete_integration(&self, id: &str) -> Result<bool, StoreError>;
}

impl SettingsOps for SettingsRepo {
    async fn open(path: &str) -> Result<Self, StoreError> {
        SettingsRepo::open(path).await
    }

    async fn migrate(&self) -> Result<(), StoreError> {
        SettingsRepo::migrate(self).await
    }

    async fn tables(&self) -> Result<Vec<String>, StoreError> {
        SettingsRepo::tables(self).await
    }

    async fn journal_mode(&self) -> Result<String, StoreError> {
        sqlx::query_scalar::<_, String>("PRAGMA journal_mode")
            .fetch_one(self.pool())
            .await
            .map_err(StoreError::from)
    }

    async fn save_preference(&self, preference: &StoredPreference) -> Result<(), StoreError> {
        SettingsRepo::save_preference(self, preference).await
    }

    async fn load_preferences(
        &self,
        project_id: &str,
    ) -> Result<Vec<StoredPreference>, StoreError> {
        SettingsRepo::load_preferences(self, project_id).await
    }

    async fn save_backend_kit(&self, kit: &StoredBackendKit) -> Result<(), StoreError> {
        SettingsRepo::save_backend_kit(self, kit).await
    }

    async fn load_backend_kit(
        &self,
        project_id: &str,
    ) -> Result<Option<StoredBackendKit>, StoreError> {
        SettingsRepo::load_backend_kit(self, project_id).await
    }

    async fn save_run_mode(&self, config: &StoredRunMode) -> Result<(), StoreError> {
        SettingsRepo::save_run_mode(self, config).await
    }

    async fn load_run_mode(&self, mode: &str) -> Result<Option<StoredRunMode>, StoreError> {
        SettingsRepo::load_run_mode(self, mode).await
    }

    async fn save_pairing(&self, pairing: &StoredPairing) -> Result<(), StoreError> {
        SettingsRepo::save_pairing(self, pairing).await
    }

    async fn load_pairings(&self) -> Result<Vec<StoredPairing>, StoreError> {
        SettingsRepo::load_pairings(self).await
    }

    async fn save_provider(&self, provider: &StoredProvider) -> Result<(), StoreError> {
        SettingsRepo::save_provider(self, provider).await
    }

    async fn load_provider(&self, name: &str) -> Result<Option<StoredProvider>, StoreError> {
        SettingsRepo::load_provider(self, name).await
    }

    async fn load_providers(&self) -> Result<Vec<StoredProvider>, StoreError> {
        SettingsRepo::load_providers(self).await
    }

    async fn delete_provider(&self, name: &str) -> Result<bool, StoreError> {
        SettingsRepo::delete_provider(self, name).await
    }

    async fn save_harness(&self, harness: &StoredHarness) -> Result<(), StoreError> {
        SettingsRepo::save_harness(self, harness).await
    }

    async fn load_harness(&self, id: &str) -> Result<Option<StoredHarness>, StoreError> {
        SettingsRepo::load_harness(self, id).await
    }

    async fn load_harnesses(&self) -> Result<Vec<StoredHarness>, StoreError> {
        SettingsRepo::load_harnesses(self).await
    }

    async fn delete_harness(&self, id: &str) -> Result<bool, StoreError> {
        SettingsRepo::delete_harness(self, id).await
    }

    async fn set_active_harness(
        &self,
        project_id: &str,
        harness_id: &str,
    ) -> Result<(), StoreError> {
        SettingsRepo::set_active_harness(self, project_id, harness_id).await
    }

    async fn get_active_harness(&self, project_id: &str) -> Result<Option<String>, StoreError> {
        SettingsRepo::get_active_harness(self, project_id).await
    }

    async fn clear_active_harness(&self, project_id: &str) -> Result<bool, StoreError> {
        SettingsRepo::clear_active_harness(self, project_id).await
    }

    async fn save_skill(&self, skill: &StoredSkill) -> Result<(), StoreError> {
        SettingsRepo::save_skill(self, skill).await
    }

    async fn load_skill(&self, id: &str) -> Result<Option<StoredSkill>, StoreError> {
        SettingsRepo::load_skill(self, id).await
    }

    async fn load_skills(&self) -> Result<Vec<StoredSkill>, StoreError> {
        SettingsRepo::load_skills(self).await
    }

    async fn delete_skill(&self, id: &str) -> Result<bool, StoreError> {
        SettingsRepo::delete_skill(self, id).await
    }

    async fn toggle_skill(&self, id: &str) -> Result<Option<bool>, StoreError> {
        SettingsRepo::toggle_skill(self, id).await
    }

    async fn save_plugin(&self, plugin: &StoredPlugin) -> Result<(), StoreError> {
        SettingsRepo::save_plugin(self, plugin).await
    }

    async fn load_plugin(&self, id: &str) -> Result<Option<StoredPlugin>, StoreError> {
        SettingsRepo::load_plugin(self, id).await
    }

    async fn load_plugins(&self) -> Result<Vec<StoredPlugin>, StoreError> {
        SettingsRepo::load_plugins(self).await
    }

    async fn delete_plugin(&self, id: &str) -> Result<bool, StoreError> {
        SettingsRepo::delete_plugin(self, id).await
    }

    async fn toggle_plugin(&self, id: &str) -> Result<Option<bool>, StoreError> {
        SettingsRepo::toggle_plugin(self, id).await
    }

    async fn save_custom_model(&self, model: &StoredCustomModel) -> Result<(), StoreError> {
        SettingsRepo::save_custom_model(self, model).await
    }

    async fn load_custom_model(
        &self,
        provider: &str,
        model_id: &str,
    ) -> Result<Option<StoredCustomModel>, StoreError> {
        SettingsRepo::load_custom_model(self, provider, model_id).await
    }

    async fn load_custom_models(&self) -> Result<Vec<StoredCustomModel>, StoreError> {
        SettingsRepo::load_custom_models(self).await
    }

    async fn delete_custom_model(
        &self,
        provider: &str,
        model_id: &str,
    ) -> Result<bool, StoreError> {
        SettingsRepo::delete_custom_model(self, provider, model_id).await
    }

    async fn toggle_custom_model(
        &self,
        provider: &str,
        model_id: &str,
    ) -> Result<Option<bool>, StoreError> {
        SettingsRepo::toggle_custom_model(self, provider, model_id).await
    }

    async fn save_integration(
        &self,
        integration: &StoredIntegration,
        config_json: Option<&str>,
    ) -> Result<(), StoreError> {
        SettingsRepo::save_integration(self, integration, config_json).await
    }

    async fn load_integration(&self, id: &str) -> Result<Option<StoredIntegration>, StoreError> {
        SettingsRepo::load_integration(self, id).await
    }

    async fn load_integrations(&self) -> Result<Vec<StoredIntegration>, StoreError> {
        SettingsRepo::load_integrations(self).await
    }

    async fn delete_integration(&self, id: &str) -> Result<bool, StoreError> {
        SettingsRepo::delete_integration(self, id).await
    }
}

// ------------------------------------------------------------------ fixtures

/// A store on a fresh temporary file, with the schema applied.
async fn temp_store<S: SettingsOps>() -> (S, TempDir) {
    let dir = fresh_tempdir();
    let store = S::open(&fresh_db(&dir)).await.expect("the store opens");
    store.migrate().await.expect("the schema is applied");
    (store, dir)
}

fn preference(key: &str, score: f64, evidence_count: u32, last_updated: u64) -> StoredPreference {
    StoredPreference {
        project_id: "project-1".to_string(),
        key: key.to_string(),
        score,
        evidence_count,
        last_updated,
    }
}

fn harness(id: &str, preset: bool, created_at: u64) -> StoredHarness {
    StoredHarness {
        id: id.to_string(),
        version: "1.0.0".to_string(),
        name: format!("Harness {id}"),
        description: "a test harness".to_string(),
        data_json: format!(r#"{{"id":"{id}","stages":[]}}"#),
        is_preset: preset,
        created_at,
    }
}

/// A base plugin row for struct-update literals in the plugin case.
fn plugin_styled_base() -> StoredPlugin {
    StoredPlugin {
        id: "unused".to_string(),
        name: "Unused".to_string(),
        description: String::new(),
        transport: "stdio".to_string(),
        command: Some("npx".to_string()),
        args_json: "[]".to_string(),
        env_json: "{}".to_string(),
        enabled: true,
        tools_json: "[]".to_string(),
        source: "example".to_string(),
    }
}

// -------------------------------------------------------------------- cases

/// The settings tables, exactly, after one migration; a second is a no-op.
async fn migrate_creates_the_settings_tables_and_is_idempotent<S: SettingsOps>() {
    let (store, _dir) = temp_store::<S>().await;

    assert_eq!(
        store.tables().await.expect("the schema is readable"),
        vec![
            "active_harness".to_string(),
            "backend_kits".to_string(),
            "configured_providers".to_string(),
            "custom_models".to_string(),
            "harnesses".to_string(),
            "integrations".to_string(),
            "pairing_devices".to_string(),
            "plugins".to_string(),
            "preferences".to_string(),
            "run_modes".to_string(),
            "skills".to_string(),
        ]
    );

    // A second run is a no-op, not an error: every CREATE is IF NOT EXISTS.
    store
        .migrate()
        .await
        .expect("the second migration is a no-op");
    assert_eq!(
        store.tables().await.expect("the schema is readable").len(),
        11
    );
}

/// `open` creates the file in WAL mode and creates nothing else; `migrate` is
/// what creates the schema.
async fn open_creates_the_database_file_in_wal_mode<S: SettingsOps>() {
    let dir = fresh_tempdir();
    let path = dir.path().join("nested").join("warsha.db");
    // The directory is the caller's to create — that is documented.
    std::fs::create_dir_all(path.parent().expect("the path has a parent"))
        .expect("the directory is created");
    assert!(!path.exists());

    let store = S::open(&path.to_string_lossy())
        .await
        .expect("the store opens");

    assert!(path.exists(), "open must create the database file");
    let mode = store
        .journal_mode()
        .await
        .expect("journal_mode is readable");
    assert_eq!(mode.to_lowercase(), "wal");
    // Nothing is created until `migrate` runs: open only opens.
    assert!(store
        .tables()
        .await
        .expect("the schema is readable")
        .is_empty());
}

/// WAL is a property of the file, and the rows survive a reopen.
async fn wal_mode_survives_a_reopen<S: SettingsOps>() {
    let dir = fresh_tempdir();
    let path = fresh_db(&dir);

    let first = S::open(&path).await.expect("the first open");
    first.migrate().await.expect("the schema is applied");
    first
        .save_preference(&preference("dark mode", 2.0, 3, 1_700_000_000))
        .await
        .expect("the row is written");
    drop(first);

    let second = S::open(&path).await.expect("the second open");
    assert_eq!(
        second
            .journal_mode()
            .await
            .expect("journal_mode is readable")
            .to_lowercase(),
        "wal"
    );
    // The rows written in WAL mode are there after a reopen.
    assert_eq!(
        second
            .load_preferences("project-1")
            .await
            .expect("the rows are readable")
            .len(),
        1
    );
}

/// A blank path is refused rather than quietly becoming a temporary database.
async fn open_refuses_a_blank_path<S: SettingsOps>() {
    assert!(matches!(
        S::open("   ").await,
        Err(StoreError::InvalidPath(path)) if path == "   "
    ));
}

/// A preference round-trips, and another project sees nothing.
async fn save_and_load_a_preference_round_trip<S: SettingsOps>() {
    let (store, _dir) = temp_store::<S>().await;
    let saved = preference("dark mode", 2.25, 3, 1_700_000_000);
    store
        .save_preference(&saved)
        .await
        .expect("the row is written");

    let loaded = store
        .load_preferences("project-1")
        .await
        .expect("the rows are readable");
    assert_eq!(loaded, vec![saved]);
    // Another project sees nothing.
    assert!(store
        .load_preferences("project-2")
        .await
        .expect("the rows are readable")
        .is_empty());
}

/// Highest score first, then by key.
async fn preferences_load_by_score_then_key<S: SettingsOps>() {
    let (store, _dir) = temp_store::<S>().await;
    for (key, score) in [("tone", 1.0), ("dark mode", 3.0), ("layout", 1.0)] {
        store
            .save_preference(&preference(key, score, 1, 1_700_000_000))
            .await
            .expect("the row is written");
    }

    let keys: Vec<String> = store
        .load_preferences("project-1")
        .await
        .expect("the rows are readable")
        .into_iter()
        .map(|row| row.key)
        .collect();
    assert_eq!(keys, vec!["dark mode", "layout", "tone"]);
}

/// The key is unique per project, so a second save replaces the row.
async fn saving_the_same_preference_replaces_the_row<S: SettingsOps>() {
    let (store, _dir) = temp_store::<S>().await;
    store
        .save_preference(&preference("dark mode", 1.0, 1, 1_700_000_000))
        .await
        .expect("the first write");
    store
        .save_preference(&preference("dark mode", 4.0, 2, 1_700_000_900))
        .await
        .expect("the second write");

    let loaded = store
        .load_preferences("project-1")
        .await
        .expect("the rows are readable");
    assert_eq!(loaded.len(), 1, "the key is unique per project");
    assert!((loaded[0].score - 4.0).abs() < 1e-9);
    assert_eq!(loaded[0].evidence_count, 2);
    assert_eq!(loaded[0].last_updated, 1_700_000_900);
}

/// A backend kit round-trips and a second save replaces the row.
async fn save_and_load_a_backend_kit_round_trip<S: SettingsOps>() {
    let (store, _dir) = temp_store::<S>().await;
    assert_eq!(
        store
            .load_backend_kit("project-1")
            .await
            .expect("the read works"),
        None
    );

    let kit = StoredBackendKit {
        project_id: "project-1".to_string(),
        kind: "pocket_base".to_string(),
        url: "http://127.0.0.1:8090".to_string(),
        config_json: r#"{"config":{"kind":"pocket_base"}}"#.to_string(),
    };
    store
        .save_backend_kit(&kit)
        .await
        .expect("the row is written");
    assert_eq!(
        store
            .load_backend_kit("project-1")
            .await
            .expect("the read works"),
        Some(kit)
    );

    // A second save replaces the row for that project.
    let updated = StoredBackendKit {
        project_id: "project-1".to_string(),
        kind: "supabase".to_string(),
        url: "http://localhost:54321".to_string(),
        config_json: r#"{"config":{"kind":"supabase"}}"#.to_string(),
    };
    store
        .save_backend_kit(&updated)
        .await
        .expect("the second write");
    let loaded = store
        .load_backend_kit("project-1")
        .await
        .expect("the read works")
        .expect("the row exists");
    assert_eq!(loaded.kind, "supabase");
    assert_eq!(loaded.url, "http://localhost:54321");
}

/// A run mode round-trips and the mode tag is the key.
async fn save_and_load_a_run_mode_round_trip<S: SettingsOps>() {
    let (store, _dir) = temp_store::<S>().await;
    assert_eq!(
        store.load_run_mode("hosted").await.expect("the read works"),
        None
    );

    let config = StoredRunMode {
        mode: "hosted".to_string(),
        config_json: r#"{"mode":"hosted","bind_host":"127.0.0.1"}"#.to_string(),
    };
    store
        .save_run_mode(&config)
        .await
        .expect("the row is written");
    assert_eq!(
        store.load_run_mode("hosted").await.expect("the read works"),
        Some(config)
    );

    // The mode tag is the key, so a second save overwrites.
    let replaced = StoredRunMode {
        mode: "hosted".to_string(),
        config_json: r#"{"mode":"hosted","bind_host":"localhost"}"#.to_string(),
    };
    store
        .save_run_mode(&replaced)
        .await
        .expect("the second write");
    let loaded = store
        .load_run_mode("hosted")
        .await
        .expect("the read works")
        .expect("the row exists");
    assert_eq!(loaded.config_json, replaced.config_json);
    assert_eq!(
        store.load_run_mode("local").await.expect("the read works"),
        None
    );
}

/// Revoking rewrites the row rather than dropping it.
async fn save_and_load_pairings_keeps_revoked_rows<S: SettingsOps>() {
    let (store, _dir) = temp_store::<S>().await;
    assert!(store
        .load_pairings()
        .await
        .expect("the read works")
        .is_empty());

    let first = StoredPairing {
        device_id: "device-1".to_string(),
        secret: "one-time-secret".to_string(),
        created_at: 1_700_000_000,
        revoked: false,
        expires_at: Some(1_700_000_600),
    };
    let second = StoredPairing {
        device_id: "device-2".to_string(),
        secret: "another-secret".to_string(),
        created_at: 1_700_000_100,
        revoked: true,
        expires_at: None,
    };
    store.save_pairing(&first).await.expect("the first row");
    store.save_pairing(&second).await.expect("the second row");

    assert_eq!(
        store.load_pairings().await.expect("the read works"),
        vec![first.clone(), second]
    );

    // Revoking rewrites the row instead of dropping it.
    let revoked = StoredPairing {
        revoked: true,
        ..first
    };
    store
        .save_pairing(&revoked)
        .await
        .expect("the revoke lands");
    let listed = store.load_pairings().await.expect("the read works");
    assert_eq!(listed.len(), 2);
    assert!(listed[0].revoked);
    assert_eq!(listed[0].secret, "one-time-secret");
    // The revoke rewrote the row without losing its deadline.
    assert_eq!(listed[0].expires_at, Some(1_700_000_600));
    assert_eq!(listed[1].expires_at, None);
}

/// Audit H1 / H1.2: the store keeps both shapes of expiry — a deadline and the
/// absence of one — across a real save/load, so a restart cannot silently
/// promote a limited secret to a permanent one or the reverse.
async fn save_and_load_pairings_preserves_the_expiry<S: SettingsOps>() {
    let (store, _dir) = temp_store::<S>().await;
    let expiring = StoredPairing {
        device_id: "device-1".to_string(),
        secret: "expiring-secret".to_string(),
        created_at: 1_700_000_000,
        revoked: false,
        expires_at: Some(1_700_000_600),
    };
    let permanent = StoredPairing {
        device_id: "device-2".to_string(),
        secret: "legacy-secret".to_string(),
        created_at: 1_700_000_100,
        revoked: false,
        expires_at: None,
    };
    store
        .save_pairing(&expiring)
        .await
        .expect("the expiring row");
    store
        .save_pairing(&permanent)
        .await
        .expect("the legacy row");

    let loaded = store.load_pairings().await.expect("the rows are read");
    assert_eq!(loaded, vec![expiring, permanent]);
    assert_eq!(loaded[0].expires_at, Some(1_700_000_600));
    assert_eq!(loaded[1].expires_at, None);

    // A rewrite replaces the deadline rather than keeping the old one.
    let extended = StoredPairing {
        expires_at: Some(1_700_001_200),
        ..loaded[0].clone()
    };
    store
        .save_pairing(&extended)
        .await
        .expect("the rewrite lands");
    assert_eq!(
        store.load_pairings().await.expect("the rows are read")[0].expires_at,
        Some(1_700_001_200)
    );
}

/// Audit H1 / H1.2: the expiry migration applies to a database this binary has
/// never seen — a four-column `pairing_devices` with a row written by a pre-H1
/// daemon — grandfathering that row with a 10-minute grace window, and a second
/// migration does not move the deadline again.
async fn migration_applies_to_an_empty_and_a_legacy_database<S: SettingsOps>() {
    // Empty: `migrate` creates the table with the column already in it.
    let (empty, _empty_dir) = temp_store::<S>().await;
    let fresh_row = StoredPairing {
        device_id: "device-1".to_string(),
        secret: "one-time-secret".to_string(),
        created_at: 1_700_000_000,
        revoked: false,
        expires_at: None,
    };
    empty
        .save_pairing(&fresh_row)
        .await
        .expect("the row is written");
    // A legacy row with no deadline stays without one: the grandfathering step
    // runs only while the column is missing.
    empty
        .migrate()
        .await
        .expect("the second migration is a no-op");
    assert_eq!(
        empty.load_pairings().await.expect("the rows are read")[0].expires_at,
        None
    );

    // Legacy: the four-column table and a row written by the old code.
    let dir = fresh_tempdir();
    let path = dir.path().join("warsha.db");
    let legacy_pool = write_legacy_database(&path).await;
    legacy_pool.close().await;

    let before = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("the clock is after 1970")
        .as_secs();
    let legacy = S::open(&path.to_string_lossy())
        .await
        .expect("the store opens the legacy database");
    legacy
        .migrate()
        .await
        .expect("the expiry migration applies");
    let rows = legacy.load_pairings().await.expect("the rows are readable");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].device_id, "legacy-device");
    let expires_at = rows[0]
        .expires_at
        .expect("the legacy row was grandfathered without a deadline");
    // Ten minutes of grace, measured against the clock at the migration
    // (a second of slack either way for a slow test).
    assert!(
        (before + 599..=before + 601).contains(&expires_at),
        "legacy row expires at {expires_at}, not ~10 minutes after {before}"
    );
    assert!(!rows[0].revoked);

    // The other settings tables are there too, so one migrate leaves a usable
    // schema behind on a legacy file.
    assert_eq!(
        legacy.tables().await.expect("the schema is readable").len(),
        11
    );
}

/// Provider CRUD: creation order, update keeping `created_at`, delete.
async fn provider_crud_round_trips_through_the_store<S: SettingsOps>() {
    let (store, _dir) = temp_store::<S>().await;

    // Empty at start.
    assert!(store
        .load_providers()
        .await
        .expect("providers load")
        .is_empty());
    assert_eq!(
        store
            .load_provider("open_router")
            .await
            .expect("load single"),
        None
    );

    let openrouter = StoredProvider {
        name: "open_router".to_string(),
        kind: "open_router".to_string(),
        api_base: Some("https://openrouter.ai/api/v1".to_string()),
        enabled: true,
        created_at: 1_700_000_000,
    };
    let custom = StoredProvider {
        name: "my-llm".to_string(),
        kind: "custom".to_string(),
        api_base: Some("http://localhost:8000/v1".to_string()),
        enabled: true,
        created_at: 1_700_000_100,
    };

    store
        .save_provider(&openrouter)
        .await
        .expect("openrouter stored");
    store.save_provider(&custom).await.expect("custom stored");

    // Both return in creation order.
    let list = store.load_providers().await.expect("providers load");
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].name, "open_router");
    assert_eq!(list[1].name, "my-llm");

    // Single lookup works.
    let single = store
        .load_provider("open_router")
        .await
        .expect("single load");
    assert_eq!(single, Some(openrouter));

    // Update of kind / api_base preserves created_at.
    let updated = StoredProvider {
        name: "open_router".to_string(),
        kind: "open_router".to_string(),
        api_base: Some("https://openrouter.example.com/v1".to_string()),
        enabled: false,
        created_at: 1_800_000_000, // ignored by the ON CONFLICT DO UPDATE
    };
    store.save_provider(&updated).await.expect("update stored");
    let reloaded = store.load_provider("open_router").await.expect("reload");
    assert_eq!(
        reloaded,
        Some(StoredProvider {
            name: "open_router".to_string(),
            kind: "open_router".to_string(),
            api_base: Some("https://openrouter.example.com/v1".to_string()),
            enabled: false,
            created_at: 1_700_000_000,
        })
    );

    // Deletion removes the row.
    assert!(store.delete_provider("open_router").await.expect("delete"));
    assert!(!store
        .delete_provider("open_router")
        .await
        .expect("delete again"));
    assert_eq!(
        store
            .load_provider("open_router")
            .await
            .expect("load after delete"),
        None
    );
    assert_eq!(store.load_providers().await.expect("remaining").len(), 1);
}

/// Harness CRUD plus the per-project active selection.
async fn harness_crud_and_active_selection_round_trip<S: SettingsOps>() {
    let (store, _dir) = temp_store::<S>().await;
    assert!(store.load_harnesses().await.expect("list").is_empty());
    assert_eq!(store.load_harness("solo").await.expect("get"), None);

    store
        .save_harness(&harness("solo", true, 1_700_000_000))
        .await
        .expect("save");
    store
        .save_harness(&harness("factory", false, 1_700_000_100))
        .await
        .expect("save");

    let list = store.load_harnesses().await.expect("list");
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].id, "solo", "oldest first");
    assert!(list[0].is_preset);
    assert!(!list[1].is_preset);

    // Re-save keeps created_at and replaces the payload.
    let updated = StoredHarness {
        data_json: r#"{"id":"solo","stages":[1,2]}"#.to_string(),
        created_at: 1_800_000_000,
        ..harness("solo", true, 1_700_000_000)
    };
    store.save_harness(&updated).await.expect("re-save");
    let loaded = store
        .load_harness("solo")
        .await
        .expect("get")
        .expect("row exists");
    assert_eq!(loaded.created_at, 1_700_000_000);
    assert_eq!(loaded.data_json, updated.data_json);

    // Active selection is per project and replaceable.
    store
        .set_active_harness("project-1", "solo")
        .await
        .expect("set active");
    assert_eq!(
        store
            .get_active_harness("project-1")
            .await
            .expect("get active")
            .as_deref(),
        Some("solo")
    );
    store
        .set_active_harness("project-1", "factory")
        .await
        .expect("repoint");
    assert_eq!(
        store
            .get_active_harness("project-1")
            .await
            .expect("get active")
            .as_deref(),
        Some("factory")
    );
    assert_eq!(
        store.get_active_harness("project-2").await.expect("unset"),
        None
    );
    assert!(store
        .clear_active_harness("project-1")
        .await
        .expect("clear"));
    assert!(!store
        .clear_active_harness("project-1")
        .await
        .expect("clear again"));

    assert!(store.delete_harness("solo").await.expect("delete"));
    assert!(!store.delete_harness("solo").await.expect("delete again"));
    assert_eq!(store.load_harnesses().await.expect("remaining").len(), 1);
}

/// Skill CRUD, name ordering and the toggle.
async fn skill_crud_and_toggle_round_trip<S: SettingsOps>() {
    let (store, _dir) = temp_store::<S>().await;
    assert!(store.load_skills().await.expect("list").is_empty());

    let skill = StoredSkill {
        id: "test-driven-development".to_string(),
        name: "Test-Driven Development".to_string(),
        description: "Red, green, refactor.".to_string(),
        source: "github.com/obra/superpowers".to_string(),
        license: "MIT".to_string(),
        content: "# TDD\nWrite the failing test first.".to_string(),
        enabled: true,
        tags_json: r#"["testing","quality"]"#.to_string(),
    };
    store.save_skill(&skill).await.expect("save");
    assert_eq!(
        store.load_skill(skill.id.as_str()).await.expect("get"),
        Some(skill.clone())
    );

    let other = StoredSkill {
        id: "mcp-builder".to_string(),
        name: "MCP Builder".to_string(),
        source: "github.com/anthropics/skills".to_string(),
        license: "Apache-2.0".to_string(),
        ..skill
    };
    store.save_skill(&other).await.expect("save other");

    // Ordered by name: "MCP Builder" sorts before "Test-Driven Development".
    let list = store.load_skills().await.expect("list");
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].id, "mcp-builder");

    assert_eq!(
        store.toggle_skill("mcp-builder").await.expect("toggle"),
        Some(false)
    );
    assert_eq!(
        store
            .toggle_skill("mcp-builder")
            .await
            .expect("toggle back"),
        Some(true)
    );
    assert_eq!(
        store.toggle_skill("missing").await.expect("toggle miss"),
        None
    );

    assert!(store.delete_skill("mcp-builder").await.expect("delete"));
    assert!(!store
        .delete_skill("mcp-builder")
        .await
        .expect("delete again"));
}

/// Plugin CRUD and the toggle.
async fn plugin_crud_and_toggle_round_trip<S: SettingsOps>() {
    let (store, _dir) = temp_store::<S>().await;
    let plugin = StoredPlugin {
        id: "github-mcp".to_string(),
        name: "GitHub".to_string(),
        description: "Issues, PRs and CI.".to_string(),
        transport: "stdio".to_string(),
        command: Some("npx".to_string()),
        args_json: r#"["@modelcontextprotocol/server-github"]"#.to_string(),
        env_json: r#"{"GITHUB_PERSONAL_ACCESS_TOKEN":"${secrets:github-token}"}"#.to_string(),
        enabled: true,
        tools_json: r#"[{"name":"create_issue"}]"#.to_string(),
        source: "github.com/modelcontextprotocol/servers".to_string(),
    };
    store.save_plugin(&plugin).await.expect("save");
    assert_eq!(
        store.load_plugin("github-mcp").await.expect("get"),
        Some(plugin)
    );

    let http_pack = StoredPlugin {
        id: "remote-pack".to_string(),
        command: None,
        transport: "http".to_string(),
        enabled: false,
        ..plugin_styled_base()
    };
    store.save_plugin(&http_pack).await.expect("save http");
    assert_eq!(store.load_plugins().await.expect("list").len(), 2);

    assert_eq!(
        store.toggle_plugin("remote-pack").await.expect("toggle"),
        Some(true)
    );
    assert!(store.delete_plugin("remote-pack").await.expect("delete"));
    assert!(!store
        .delete_plugin("remote-pack")
        .await
        .expect("delete again"));
}

/// Custom-model CRUD, keyed by `(provider, model_id)`, and the toggle.
async fn custom_model_crud_and_toggle_round_trip<S: SettingsOps>() {
    let (store, _dir) = temp_store::<S>().await;
    let model = StoredCustomModel {
        provider: "open_router".to_string(),
        model_id: "qwen/qwen3-coder".to_string(),
        display_name: Some("Qwen Coder".to_string()),
        context_window: Some(262_144),
        enabled: true,
    };
    store.save_custom_model(&model).await.expect("save");
    assert_eq!(
        store
            .load_custom_model("open_router", "qwen/qwen3-coder")
            .await
            .expect("get"),
        Some(model.clone())
    );
    assert_eq!(
        store
            .load_custom_model("open_router", "absent")
            .await
            .expect("miss"),
        None
    );

    let bare = StoredCustomModel {
        model_id: "raw/model".to_string(),
        display_name: None,
        context_window: None,
        enabled: false,
        ..model
    };
    store.save_custom_model(&bare).await.expect("save bare");
    assert_eq!(store.load_custom_models().await.expect("list").len(), 2);

    assert_eq!(
        store
            .toggle_custom_model("open_router", "raw/model")
            .await
            .expect("toggle"),
        Some(true)
    );
    assert_eq!(
        store
            .toggle_custom_model("open_router", "missing")
            .await
            .expect("miss"),
        None
    );
    assert!(store
        .delete_custom_model("open_router", "raw/model")
        .await
        .expect("delete"));
    assert!(!store
        .delete_custom_model("open_router", "raw/model")
        .await
        .expect("delete again"));
}

/// Integration CRUD, including the status-only save that keeps the stored config.
async fn integration_crud_round_trip<S: SettingsOps>() {
    let (store, _dir) = temp_store::<S>().await;
    let integration = StoredIntegration {
        id: "github".to_string(),
        name: "GitHub".to_string(),
        connected: false,
        config_json: r#"{"org":"warsha"}"#.to_string(),
        configured_at: Some(1_700_000_000),
    };
    store
        .save_integration(&integration, None)
        .await
        .expect("save");
    assert_eq!(
        store.load_integration("github").await.expect("get"),
        Some(integration.clone())
    );

    // A status-only save keeps the stored config; an explicit config replaces it.
    let connected = StoredIntegration {
        connected: true,
        config_json: String::new(),
        configured_at: None,
        ..integration.clone()
    };
    store
        .save_integration(&connected, None)
        .await
        .expect("status save");
    let reloaded = store
        .load_integration("github")
        .await
        .expect("get")
        .expect("row");
    assert!(reloaded.connected);
    assert_eq!(reloaded.config_json, integration.config_json);
    assert_eq!(reloaded.configured_at, integration.configured_at);

    store
        .save_integration(&connected, Some(r#"{"org":"warsha","channel":"dev"}"#))
        .await
        .expect("config save");
    let reloaded = store
        .load_integration("github")
        .await
        .expect("get")
        .expect("row");
    assert_eq!(reloaded.config_json, r#"{"org":"warsha","channel":"dev"}"#);

    assert_eq!(store.load_integrations().await.expect("list").len(), 1);
    assert!(store.delete_integration("github").await.expect("delete"));
    assert!(!store
        .delete_integration("github")
        .await
        .expect("delete again"));
}

/// The pairing secret never prints, whichever implementation stored the row.
#[test]
fn debug_redacts_the_pairing_secret() {
    let pairing = StoredPairing {
        device_id: "device-1".to_string(),
        secret: "super-secret-value".to_string(),
        created_at: 42,
        revoked: false,
        expires_at: None,
    };
    let rendered = format!("{pairing:?}");
    assert!(rendered.contains("device-1"));
    assert!(rendered.contains(REDACTED_SECRET));
    assert!(!rendered.contains("super-secret-value"));
}

// ------------------------------------------------------------ case wiring

/// Expand the shared cases for one implementation.
///
/// `$backend` is the implementation the case bodies are instantiated with; each
/// case builds its own database.
macro_rules! shared_cases {
    ($module:ident, $backend:ty; $($case:ident),+ $(,)?) => {
        mod $module {
            use super::*;

            $(
                #[tokio::test]
                async fn $case() {
                    super::$case::<$backend>().await;
                }
            )+

            #[tokio::test]
            async fn open_creates_the_database_file_in_wal_mode() {
                super::open_creates_the_database_file_in_wal_mode::<$backend>().await;
            }

            #[tokio::test]
            async fn wal_mode_survives_a_reopen() {
                super::wal_mode_survives_a_reopen::<$backend>().await;
            }

            #[tokio::test]
            async fn open_refuses_a_blank_path() {
                super::open_refuses_a_blank_path::<$backend>().await;
            }

            #[tokio::test]
            async fn migration_applies_to_an_empty_and_a_legacy_database() {
                super::migration_applies_to_an_empty_and_a_legacy_database::<$backend>().await;
            }
        }
    };
}

/// The case list, written once and expanded per implementation (one today).
macro_rules! every_case_for {
    ($module:ident, $backend:ty) => {
        shared_cases!($module, $backend;
            migrate_creates_the_settings_tables_and_is_idempotent,
            save_and_load_a_preference_round_trip,
            preferences_load_by_score_then_key,
            saving_the_same_preference_replaces_the_row,
            save_and_load_a_backend_kit_round_trip,
            save_and_load_a_run_mode_round_trip,
            save_and_load_pairings_keeps_revoked_rows,
            save_and_load_pairings_preserves_the_expiry,
            provider_crud_round_trips_through_the_store,
            harness_crud_and_active_selection_round_trip,
            skill_crud_and_toggle_round_trip,
            plugin_crud_and_toggle_round_trip,
            custom_model_crud_and_toggle_round_trip,
            integration_crud_round_trip,
        );
    };
}

every_case_for!(settings_repo_backend, SettingsRepo);
