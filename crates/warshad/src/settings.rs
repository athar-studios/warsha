//! The daemon's durable settings — the M20 records, in the file the daemon
//! already owns (PLAN.md M20).
//!
//! `warsha-store` holds these rows through a synchronous [`SqliteStore`], and the
//! pipeline records know how to project themselves into it: taste
//! preferences, backend kits, run modes and phone pairings. The configured
//! providers live here too — a provider's *configuration*, never its key, which is
//! the OS keychain's. This module is the
//! seam between those two facts and the daemon, which is async:
//!
//! - **Every call moves to a blocking thread.** [`SqliteStore`] owns one
//!   `rusqlite` connection and runs its statements on the caller's thread, so
//!   calling it from an RPC would park a runtime worker on the file. Each method
//!   here hands its job to `tokio::task::spawn_blocking` instead and awaits the
//!   result, which is what keeps the daemon answering while a setting is written.
//! - **One connection per call, deliberately.** A `rusqlite` connection is `Send`
//!   but not `Sync`, so one shared handle could not be handed to two blocking
//!   threads anyway; and a `Mutex` around it would make every settings read wait
//!   behind every write. WAL mode plus the store's 5-second busy timeout is what
//!   makes short-lived connections cheap and safe against the async pool writing
//!   the same file.
//! - **The file is the one `<data_dir>/warsha.db`.** The rows live beside the
//!   projects, runs and events rather than in a second database, because a
//!   settings file that can be lost separately from the project it configures is
//!   a second source of truth.
//! - **A read is a read, not a cache.** Nothing here remembers what it loaded:
//!   the seeding at startup and the write-through after each change are the
//!   daemon's business, and a store that cached would answer from memory after
//!   another process changed the file.

use std::path::Path;

use thiserror::Error;
use warsha_pipeline::{
    BackendKit, InMemoryPairingStore, InMemoryPreferenceStore, Preference, RunMode, RunModeConfig,
};
use warsha_store::{SqliteStore, StoreError, StoredProvider};

/// Everything that can go wrong reading or writing the daemon's settings.
#[derive(Debug, Error)]
pub enum SettingsError {
    /// The settings database could not be read or written.
    #[error("settings store: {0}")]
    Store(#[from] StoreError),
    /// The blocking task that owns the connection did not come back.
    #[error("settings task: {0}")]
    Task(#[from] tokio::task::JoinError),
    /// The data directory cannot name a database file.
    #[error("settings path is not valid UTF-8: {0}")]
    Path(String),
}

/// The result of a settings read or write.
pub type SettingsResult<T> = std::result::Result<T, SettingsError>;

/// The daemon's settings file.
///
/// Cheap to clone — it is a path, not a connection — so the daemon holds one for
/// every RPC and each call opens what it needs on a blocking thread.
#[derive(Debug, Clone)]
pub struct SettingsStore {
    path: String,
}

impl SettingsStore {
    /// Open the settings at `path`, creating the file and applying the schema.
    ///
    /// The migration is idempotent, so this runs on every start; a path that
    /// cannot be opened fails the start rather than the first setting the owner
    /// changes. The async `Store` opens the same file: its migrations and these
    /// five tables do not overlap — which is why the configured providers' table is
    /// `configured_providers` and not `providers`, the name the async schema's
    /// migration already created.
    pub async fn open(path: &Path) -> SettingsResult<Self> {
        let path = path
            .to_str()
            .ok_or_else(|| SettingsError::Path(path.display().to_string()))?
            .to_string();
        let settings = SettingsStore { path };
        settings
            .run(|store| {
                store.migrate()?;
                Ok(())
            })
            .await?;
        Ok(settings)
    }

    /// The path of the database these settings live in.
    pub fn path(&self) -> &str {
        &self.path
    }

    /// The backend kits of the projects named, as `(project_id, kit)` pairs.
    ///
    /// A project with no stored kit is absent rather than defaulted: the default
    /// is the caller's to build, because only the caller knows the project's name.
    pub async fn load_backend_kits(
        &self,
        project_ids: Vec<String>,
    ) -> SettingsResult<Vec<(String, BackendKit)>> {
        self.run(move |store| {
            let mut kits = Vec::new();
            for project_id in &project_ids {
                if let Some(kit) = BackendKit::load_from_store(store, project_id)? {
                    kits.push((project_id.clone(), kit));
                }
            }
            Ok(kits)
        })
        .await
    }

    /// One project's stored backend kit.
    pub async fn load_backend_kit(&self, project_id: &str) -> SettingsResult<Option<BackendKit>> {
        let project_id = project_id.to_string();
        self.run(move |store| {
            BackendKit::load_from_store(store, &project_id).map_err(SettingsError::from)
        })
        .await
    }

    /// Store one project's backend kit, replacing the row it had.
    pub async fn save_backend_kit(&self, project_id: &str, kit: &BackendKit) -> SettingsResult<()> {
        let project_id = project_id.to_string();
        let kit = kit.clone();
        self.run(move |store| {
            kit.save_to_store(store, &project_id)?;
            Ok(())
        })
        .await
    }

    /// Every run mode that has a saved row, in `RunMode::all` order.
    ///
    /// A mode that was never saved is absent: `RunModeConfig::for_mode` is what a
    /// caller starts from, and storing that guess would freeze it.
    pub async fn load_run_modes(&self) -> SettingsResult<Vec<RunModeConfig>> {
        self.run(|store| {
            let mut configs = Vec::new();
            for mode in RunMode::all() {
                if let Some(config) = RunModeConfig::load_from_store(store, mode)? {
                    configs.push(config);
                }
            }
            Ok(configs)
        })
        .await
    }

    /// Store one run mode's config, replacing the row it had.
    pub async fn save_run_mode(&self, config: &RunModeConfig) -> SettingsResult<()> {
        let config = config.clone();
        self.run(move |store| {
            config.save_to_store(store)?;
            Ok(())
        })
        .await
    }

    /// A project's stored preferences, highest score first.
    pub async fn load_preferences(&self, project_id: &str) -> SettingsResult<Vec<Preference>> {
        let project_id = project_id.to_string();
        self.run(move |store| {
            InMemoryPreferenceStore::load_from_store(store, &project_id)
                .map_err(SettingsError::from)
        })
        .await
    }

    /// The stored preferences of the projects named, as `(project_id, rows)` pairs.
    ///
    /// The seeded daemon state is built from this one call rather than one call
    /// per project: the projects are known together, so they are read together.
    pub async fn load_all_preferences(
        &self,
        project_ids: Vec<String>,
    ) -> SettingsResult<Vec<(String, Vec<Preference>)>> {
        self.run(move |store| {
            let mut rows = Vec::new();
            for project_id in &project_ids {
                let preferences = InMemoryPreferenceStore::load_from_store(store, project_id)?;
                if !preferences.is_empty() {
                    rows.push((project_id.clone(), preferences));
                }
            }
            Ok(rows)
        })
        .await
    }

    /// Project a run's signal log into the preferences table.
    pub async fn save_preferences(&self, memory: InMemoryPreferenceStore) -> SettingsResult<()> {
        self.run(move |store| {
            memory.save_to_store(store)?;
            Ok(())
        })
        .await
    }

    /// Every stored pairing, including the revoked ones.
    pub async fn load_pairings(&self) -> SettingsResult<InMemoryPairingStore> {
        self.run(|store| InMemoryPairingStore::load_from_store(store).map_err(SettingsError::from))
            .await
    }

    /// Store every pairing the daemon holds, revocation included.
    pub async fn save_pairings(&self, pairings: InMemoryPairingStore) -> SettingsResult<()> {
        self.run(move |store| {
            pairings.save_to_store(store)?;
            Ok(())
        })
        .await
    }

    /// Every configured provider, oldest first.
    pub async fn load_providers(&self) -> SettingsResult<Vec<StoredProvider>> {
        self.run(|store| store.load_providers().map_err(SettingsError::from))
            .await
    }

    /// One provider by name, or `None` if not configured.
    pub async fn load_provider(&self, name: &str) -> SettingsResult<Option<StoredProvider>> {
        let name = name.to_string();
        self.run(move |store| store.load_provider(&name).map_err(SettingsError::from))
            .await
    }

    /// Save one provider configuration to the settings store.
    pub async fn save_provider(&self, provider: &StoredProvider) -> SettingsResult<()> {
        let provider = provider.clone();
        self.run(move |store| {
            store.save_provider(&provider)?;
            Ok(())
        })
        .await
    }

    /// Delete one provider by name, returning true if it existed.
    pub async fn delete_provider(&self, name: &str) -> SettingsResult<bool> {
        let name = name.to_string();
        self.run(move |store| store.delete_provider(&name).map_err(SettingsError::from))
            .await
    }

    /// Run one settings job on a blocking thread, over its own connection.
    ///
    /// The job owns the connection for its whole life, so a closure that panics
    /// cannot hand a half-used connection to the next call: the failure arrives as
    /// [`SettingsError::Task`] and the next call opens a fresh one.
    async fn run<T, F>(&self, job: F) -> SettingsResult<T>
    where
        F: FnOnce(&SqliteStore) -> SettingsResult<T> + Send + 'static,
        T: Send + 'static,
    {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || {
            let store = SqliteStore::open(&path)?;
            job(&store)
        })
        .await?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use tempfile::tempdir;
    use warsha_pipeline::{BackendKind, ColumnDef, RunMode, RunModeConfig, TableDef};

    /// A settings store over a fresh temporary database.
    async fn settings() -> (tempfile::TempDir, SettingsStore) {
        let dir = tempdir().expect("a temporary directory");
        let store = SettingsStore::open(&dir.path().join("warsha.db"))
            .await
            .expect("the settings open");
        (dir, store)
    }

    #[tokio::test]
    async fn open_creates_the_file_and_applies_the_schema() {
        let (dir, settings) = settings().await;

        assert!(dir.path().join("warsha.db").exists());
        assert!(settings.path().ends_with("warsha.db"));
        // Nothing is stored yet, so every read is empty rather than an error.
        assert!(settings
            .load_backend_kits(vec!["project-1".to_string()])
            .await
            .expect("the kits are read")
            .is_empty());
        assert!(settings
            .load_run_modes()
            .await
            .expect("the modes are read")
            .is_empty());
    }

    #[tokio::test]
    async fn a_run_mode_and_a_backend_kit_round_trip_through_the_store() {
        let (_dir, settings) = settings().await;

        let mut kit =
            BackendKit::from_project("Shop", "http://127.0.0.1:8090", BackendKind::PocketBase);
        kit.add_table(TableDef::new(
            "orders",
            vec![ColumnDef::new("id", "TEXT", false)],
        ))
        .expect("the table is added");
        settings
            .save_backend_kit("project-1", &kit)
            .await
            .expect("the kit is stored");

        let mut hosted = RunModeConfig::for_mode(RunMode::Hosted);
        hosted.relay_url = Some("wss://relay.example.invalid".to_string());
        settings
            .save_run_mode(&hosted)
            .await
            .expect("the mode is stored");

        // A second store over the same file: what a restart sees.
        let reopened = SettingsStore::open(Path::new(settings.path()))
            .await
            .expect("the settings reopen");
        let kits = reopened
            .load_backend_kits(vec!["project-1".to_string()])
            .await
            .expect("the kits are read");
        assert_eq!(kits.len(), 1);
        assert_eq!(kits[0].0, "project-1");
        assert_eq!(kits[0].1.config.project_name, "Shop");
        assert!(kits[0].1.table("orders").is_some());

        let modes = reopened.load_run_modes().await.expect("the modes are read");
        assert_eq!(modes.len(), 1);
        assert_eq!(modes[0].mode, RunMode::Hosted);
        assert_eq!(
            modes[0].relay_url.as_deref(),
            Some("wss://relay.example.invalid")
        );
    }

    #[tokio::test]
    async fn a_provider_round_trips_through_the_settings_store() {
        let (_dir, settings) = settings().await;

        let provider = StoredProvider {
            name: "open_router".to_string(),
            kind: "open_router".to_string(),
            api_base: Some("https://openrouter.ai/api/v1".to_string()),
            enabled: true,
            created_at: 1_700_000_000,
        };
        settings
            .save_provider(&provider)
            .await
            .expect("provider is stored");

        let reopened = SettingsStore::open(Path::new(settings.path()))
            .await
            .expect("the settings reopen");
        let providers = reopened
            .load_providers()
            .await
            .expect("the providers are read");
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0], provider);

        let single = reopened
            .load_provider("open_router")
            .await
            .expect("single load");
        assert_eq!(single, Some(provider));

        let deleted = reopened
            .delete_provider("open_router")
            .await
            .expect("delete");
        assert!(deleted);
        assert!(reopened
            .load_providers()
            .await
            .expect("providers load")
            .is_empty());
    }
}
