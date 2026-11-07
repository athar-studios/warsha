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
//! - **Two settings are documents, not rows.** The daemon's role routing table and
//!   the agent loop's conversation state are read and written whole and never
//!   queried, so they are JSON documents in the same data directory
//!   ([`SettingsStore::save_document]` / [`SettingsStore::load_document]`), each
//!   written as a temp file and a rename. They sit next to `warsha.db` rather than
//!   somewhere else for the same reason the rows do: one directory is the install.
//! - **A read is a read, not a cache.** Nothing here remembers what it loaded:
//!   the seeding at startup and the write-through after each change are the
//!   daemon's business, and a store that cached would answer from memory after
//!   another process changed the file.

use std::path::{Path, PathBuf};

use thiserror::Error;
use warsha_pipeline::{
    settings::{
        SettingsError as PipelineSettingsError, SettingsProvider,
        StoredHarness as PipelineStoredHarness, StoredPlugin as PipelineStoredPlugin,
        StoredSkill as PipelineStoredSkill,
    },
    BackendKit, InMemoryPairingStore, InMemoryPreferenceStore, Preference, RunMode, RunModeConfig,
};
use warsha_store::{
    SqliteStore, StoreError, StoredCustomModel, StoredHarness, StoredIntegration, StoredPlugin,
    StoredProvider, StoredSkill,
};

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
    /// A document was asked for by a name that is not a file name.
    #[error("settings document name is not usable: {0}")]
    Document(String),
    /// A document could not be written or read.
    #[error("settings document {name}: {reason}")]
    DocumentIo {
        /// Which document.
        name: String,
        /// What the operating system said, with no key or path secret in it.
        reason: String,
    },
    /// A document that exists could not be read back as JSON.
    #[error("settings document {0} is not valid JSON")]
    DocumentFormat(String),
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

    /// The directory these settings live in — the daemon's data directory.
    ///
    /// A path with no parent (a bare file name, which is what a test with a relative
    /// path hands over) is the current directory, the same reading `std::fs` gives it.
    pub fn directory(&self) -> PathBuf {
        Path::new(&self.path)
            .parent()
            .map_or_else(|| PathBuf::from("."), PathBuf::from)
    }

    /// Store one whole JSON document beside the database, replacing what was there.
    ///
    /// These are the settings that are not rows: the daemon's own role routing table
    /// and the agent loop's conversation state. Both are read and written whole, by
    /// one owner, and never queried — a `SELECT` over them would ask for a table, and
    /// a table would ask `warshad` for a SQLite dependency it does not have and does
    /// not need. They live in the daemon's data directory, next to the `warsha.db`
    /// they configure, so one directory is still the whole install: backing it up,
    /// deleting it or moving it carries the settings with it.
    ///
    /// The write is a temp file and a rename, so a daemon that dies halfway leaves
    /// the previous document intact rather than a truncated one a restart cannot read:
    /// a setting that survives a crash is a setting, and one that survives only until
    /// the next unclean exit is a rumour.
    pub async fn save_document(
        &self,
        name: &str,
        document: &serde_json::Value,
    ) -> SettingsResult<()> {
        let name = checked_document_name(name)?;
        let directory = self.directory();
        let encoded =
            serde_json::to_vec_pretty(document).map_err(|error| SettingsError::DocumentIo {
                name: name.clone(),
                reason: format!("it could not be encoded: {error}"),
            })?;
        Self::run_blocking(move || write_document(&directory, &name, &encoded)).await
    }

    /// Read one whole JSON document, or `None` when it was never written.
    ///
    /// A document that exists and does not parse is an error rather than a `None`:
    /// "nothing is configured" and "what is configured cannot be read" are different
    /// facts, and a daemon that answered the second with the first would silently
    /// forget the owner's routing.
    pub async fn load_document(&self, name: &str) -> SettingsResult<Option<serde_json::Value>> {
        let name = checked_document_name(name)?;
        let directory = self.directory();
        Self::run_blocking(move || read_document(&directory, &name)).await
    }

    /// Run one file job on a blocking thread.
    ///
    /// Same reason as [`SettingsStore::run`]: a disk write does not get to park a
    /// runtime worker on the daemon's request path.
    async fn run_blocking<T, F>(job: F) -> SettingsResult<T>
    where
        F: FnOnce() -> SettingsResult<T> + Send + 'static,
        T: Send + 'static,
    {
        tokio::task::spawn_blocking(job).await?
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

    // -------------------------------------------------------------- harnesses

    /// Insert or replace one harness definition, keyed by its id.
    pub async fn save_harness(&self, harness: &StoredHarness) -> SettingsResult<()> {
        let harness = harness.clone();
        self.run(move |store| {
            store.save_harness(&harness)?;
            Ok(())
        })
        .await
    }

    /// One harness by id, or `None` when no such row exists.
    pub async fn get_harness(&self, id: &str) -> SettingsResult<Option<StoredHarness>> {
        let id = id.to_string();
        self.run(move |store| store.load_harness(&id).map_err(SettingsError::from))
            .await
    }

    /// Every harness, presets and user-authored alike, oldest first.
    pub async fn list_harnesses(&self) -> SettingsResult<Vec<StoredHarness>> {
        self.run(|store| store.load_harnesses().map_err(SettingsError::from))
            .await
    }

    /// Delete one harness by id, returning true if it existed.
    pub async fn delete_harness(&self, id: &str) -> SettingsResult<bool> {
        let id = id.to_string();
        self.run(move |store| store.delete_harness(&id).map_err(SettingsError::from))
            .await
    }

    /// Point a project at a harness, replacing any previous selection.
    pub async fn set_active_harness(
        &self,
        project_id: &str,
        harness_id: &str,
    ) -> SettingsResult<()> {
        let project_id = project_id.to_string();
        let harness_id = harness_id.to_string();
        self.run(move |store| {
            store.set_active_harness(&project_id, &harness_id)?;
            Ok(())
        })
        .await
    }

    /// The harness id a project currently runs with, if one was selected.
    pub async fn get_active_harness(&self, project_id: &str) -> SettingsResult<Option<String>> {
        let project_id = project_id.to_string();
        self.run(move |store| {
            store
                .get_active_harness(&project_id)
                .map_err(SettingsError::from)
        })
        .await
    }

    /// Clear a project's harness selection, returning true if there was one.
    pub async fn clear_active_harness(&self, project_id: &str) -> SettingsResult<bool> {
        let project_id = project_id.to_string();
        self.run(move |store| {
            store
                .clear_active_harness(&project_id)
                .map_err(SettingsError::from)
        })
        .await
    }

    // ---------------------------------------------------------------- skills

    /// Insert or replace one skill, keyed by its id.
    pub async fn save_skill(&self, skill: &StoredSkill) -> SettingsResult<()> {
        let skill = skill.clone();
        self.run(move |store| {
            store.save_skill(&skill)?;
            Ok(())
        })
        .await
    }

    /// One skill by id.
    pub async fn get_skill(&self, id: &str) -> SettingsResult<Option<StoredSkill>> {
        let id = id.to_string();
        self.run(move |store| store.load_skill(&id).map_err(SettingsError::from))
            .await
    }

    /// Every skill, by name, whether enabled or not.
    pub async fn list_skills(&self) -> SettingsResult<Vec<StoredSkill>> {
        self.run(|store| store.load_skills().map_err(SettingsError::from))
            .await
    }

    /// Delete one skill by id, returning true if it existed.
    pub async fn delete_skill(&self, id: &str) -> SettingsResult<bool> {
        let id = id.to_string();
        self.run(move |store| store.delete_skill(&id).map_err(SettingsError::from))
            .await
    }

    /// Flip a skill's enabled flag, answering with the new state or `None`
    /// when the skill does not exist.
    pub async fn toggle_skill(&self, id: &str) -> SettingsResult<Option<bool>> {
        let id = id.to_string();
        self.run(move |store| store.toggle_skill(&id).map_err(SettingsError::from))
            .await
    }

    // --------------------------------------------------------------- plugins

    /// Insert or replace one MCP plugin pack, keyed by its id.
    pub async fn save_plugin(&self, plugin: &StoredPlugin) -> SettingsResult<()> {
        let plugin = plugin.clone();
        self.run(move |store| {
            store.save_plugin(&plugin)?;
            Ok(())
        })
        .await
    }

    /// One plugin pack by id.
    pub async fn get_plugin(&self, id: &str) -> SettingsResult<Option<StoredPlugin>> {
        let id = id.to_string();
        self.run(move |store| store.load_plugin(&id).map_err(SettingsError::from))
            .await
    }

    /// Every plugin pack, by name, whether enabled or not.
    pub async fn list_plugins(&self) -> SettingsResult<Vec<StoredPlugin>> {
        self.run(|store| store.load_plugins().map_err(SettingsError::from))
            .await
    }

    /// Delete one plugin pack by id, returning true if it existed.
    pub async fn delete_plugin(&self, id: &str) -> SettingsResult<bool> {
        let id = id.to_string();
        self.run(move |store| store.delete_plugin(&id).map_err(SettingsError::from))
            .await
    }

    /// Flip a plugin's enabled flag, answering with the new state or `None`
    /// when the pack does not exist.
    pub async fn toggle_plugin(&self, id: &str) -> SettingsResult<Option<bool>> {
        let id = id.to_string();
        self.run(move |store| store.toggle_plugin(&id).map_err(SettingsError::from))
            .await
    }

    // --------------------------------------------------------- custom models

    /// Insert or replace one custom model, keyed by `(provider, model_id)`.
    pub async fn save_custom_model(&self, model: &StoredCustomModel) -> SettingsResult<()> {
        let model = model.clone();
        self.run(move |store| {
            store.save_custom_model(&model)?;
            Ok(())
        })
        .await
    }

    /// One custom model by provider and model id.
    pub async fn get_custom_model(
        &self,
        provider: &str,
        model_id: &str,
    ) -> SettingsResult<Option<StoredCustomModel>> {
        let provider = provider.to_string();
        let model_id = model_id.to_string();
        self.run(move |store| {
            store
                .load_custom_model(&provider, &model_id)
                .map_err(SettingsError::from)
        })
        .await
    }

    /// Every custom model, by provider then model id.
    pub async fn list_custom_models(&self) -> SettingsResult<Vec<StoredCustomModel>> {
        self.run(|store| store.load_custom_models().map_err(SettingsError::from))
            .await
    }

    /// Delete one custom model, returning true if it existed.
    pub async fn delete_custom_model(
        &self,
        provider: &str,
        model_id: &str,
    ) -> SettingsResult<bool> {
        let provider = provider.to_string();
        let model_id = model_id.to_string();
        self.run(move |store| {
            store
                .delete_custom_model(&provider, &model_id)
                .map_err(SettingsError::from)
        })
        .await
    }

    /// Flip a custom model's enabled flag, answering with the new state or
    /// `None` when the model does not exist.
    pub async fn toggle_custom_model(
        &self,
        provider: &str,
        model_id: &str,
    ) -> SettingsResult<Option<bool>> {
        let provider = provider.to_string();
        let model_id = model_id.to_string();
        self.run(move |store| {
            store
                .toggle_custom_model(&provider, &model_id)
                .map_err(SettingsError::from)
        })
        .await
    }

    // ------------------------------------------------------------ integrations

    /// Insert or replace one integration row.
    ///
    /// `config_json` is the serialised `IntegrationConfig`; `None` keeps the
    /// config the row already had, so a connection check can update status
    /// without rewriting credentials.
    pub async fn save_integration(
        &self,
        integration: &StoredIntegration,
        config_json: Option<&str>,
    ) -> SettingsResult<()> {
        let integration = integration.clone();
        let config_json = config_json.map(str::to_string);
        self.run(move |store| {
            store.save_integration(&integration, config_json.as_deref())?;
            Ok(())
        })
        .await
    }

    /// One integration by id.
    pub async fn get_integration(&self, id: &str) -> SettingsResult<Option<StoredIntegration>> {
        let id = id.to_string();
        self.run(move |store| store.load_integration(&id).map_err(SettingsError::from))
            .await
    }

    /// Every integration, by name.
    pub async fn list_integrations(&self) -> SettingsResult<Vec<StoredIntegration>> {
        self.run(|store| store.load_integrations().map_err(SettingsError::from))
            .await
    }

    /// Delete one integration by id, returning true if it existed.
    pub async fn delete_integration(&self, id: &str) -> SettingsResult<bool> {
        let id = id.to_string();
        self.run(move |store| store.delete_integration(&id).map_err(SettingsError::from))
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

/// The counter that makes each document write's temp file unique.
///
/// One process can write two documents, or the same document twice in a row, and two
/// writers must not share a scratch file: the second would rename the first's bytes
/// and call that durable.
static DOCUMENT_WRITE_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// The name a settings document may be stored under.
///
/// A lower-case slug of at most 64 characters, because this name becomes a file and
/// code that reaches the filesystem has to treat everything it is given as something
/// a caller wrote. A `..`, a slash or a backslash would let a caller name a file
/// outside the data directory, and no document has ever needed a name like that.
fn checked_document_name(name: &str) -> SettingsResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return Err(SettingsError::Document(format!(
            "{name} is not a document name between 1 and 64 characters"
        )));
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
    {
        return Err(SettingsError::Document(format!(
            "{name} holds characters a document name may not: lower-case letters, \
             digits, `-` and `_` only"
        )));
    }
    Ok(trimmed.to_string())
}

/// Write the document, atomically, and leave it on disk.
fn write_document(directory: &Path, name: &str, encoded: &[u8]) -> SettingsResult<()> {
    let failure = |reason: String| SettingsError::DocumentIo {
        name: name.to_string(),
        reason,
    };
    std::fs::create_dir_all(directory).map_err(|error| failure(error.to_string()))?;
    let sequence = DOCUMENT_WRITE_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let scratch = directory.join(format!(
        ".{name}.json.{}.{}.tmp",
        std::process::id(),
        sequence
    ));
    let target = directory.join(format!("{name}.json"));
    if let Err(error) = std::fs::write(&scratch, encoded) {
        // A half-written scratch file is nothing the next write should inherit.
        let _ = std::fs::remove_file(&scratch);
        return Err(failure(error.to_string()));
    }
    std::fs::rename(&scratch, &target).map_err(|error| {
        let _ = std::fs::remove_file(&scratch);
        failure(error.to_string())
    })
}

/// Read the document, or say it is not there / not readable.
fn read_document(directory: &Path, name: &str) -> SettingsResult<Option<serde_json::Value>> {
    let target = directory.join(format!("{name}.json"));
    let bytes = match std::fs::read(&target) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(SettingsError::DocumentIo {
                name: name.to_string(),
                reason: error.to_string(),
            })
        }
    };
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| SettingsError::DocumentFormat(name.to_string()))
}

// Implementation of SettingsProvider trait for the daemon's SettingsStore
#[async_trait::async_trait]
impl SettingsProvider for SettingsStore {
    async fn get_active_harness(
        &self,
        project_id: &str,
    ) -> Result<Option<String>, PipelineSettingsError> {
        self.get_active_harness(project_id)
            .await
            .map_err(|e| PipelineSettingsError::Store(e.to_string()))
    }

    async fn get_harness(
        &self,
        id: &str,
    ) -> Result<Option<PipelineStoredHarness>, PipelineSettingsError> {
        self.get_harness(id)
            .await
            .map_err(|e| PipelineSettingsError::Store(e.to_string()))
            .map(|opt| {
                opt.map(|h| PipelineStoredHarness {
                    id: h.id,
                    version: h.version,
                    name: h.name,
                    description: h.description,
                    data_json: h.data_json,
                    is_preset: h.is_preset,
                    created_at: h.created_at,
                })
            })
    }

    async fn list_skills(&self) -> Result<Vec<PipelineStoredSkill>, PipelineSettingsError> {
        self.list_skills()
            .await
            .map_err(|e| PipelineSettingsError::Store(e.to_string()))
            .map(|skills| {
                skills
                    .into_iter()
                    .map(|s| PipelineStoredSkill {
                        id: s.id,
                        name: s.name,
                        description: s.description,
                        source: s.source,
                        license: s.license,
                        content: s.content,
                        enabled: s.enabled,
                        tags_json: s.tags_json,
                    })
                    .collect()
            })
    }

    async fn list_plugins(&self) -> Result<Vec<PipelineStoredPlugin>, PipelineSettingsError> {
        self.list_plugins()
            .await
            .map_err(|e| PipelineSettingsError::Store(e.to_string()))
            .map(|plugins| {
                plugins
                    .into_iter()
                    .map(|p| PipelineStoredPlugin {
                        id: p.id,
                        name: p.name,
                        description: p.description,
                        source: p.source,
                        license: "Apache-2.0".to_string(), // Default license
                        data_json: serde_json::json!({
                            "transport": p.transport,
                            "command": p.command,
                            "args_json": p.args_json,
                            "env_json": p.env_json,
                            "enabled": p.enabled,
                            "tools_json": p.tools_json,
                        })
                        .to_string(),
                        enabled: p.enabled,
                    })
                    .collect()
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use warsha_pipeline::{BackendKind, ColumnDef, RunMode, RunModeConfig, TableDef};

    /// A settings store over a fresh temporary database.
    async fn settings() -> (tempfile::TempDir, SettingsStore) {
        let dir = crate::test_util::fresh_tempdir();
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

    #[tokio::test]
    async fn a_document_written_by_one_daemon_is_read_by_the_next() {
        let (_dir, settings) = settings().await;

        assert_eq!(
            settings
                .load_document("role-routings")
                .await
                .expect("an absent document is not an error"),
            None
        );

        let document = serde_json::json!([
            { "role": "intake", "targets": [{ "provider_id": "my-qwen", "model_id": "m", "weight": 100 }],
              "fallback_enabled": false, "budget_cents_per_run": 25 }
        ]);
        settings
            .save_document("role-routings", &document)
            .await
            .expect("the document is written");

        // A second handle over the same directory: what a restart sees.
        let reopened = SettingsStore::open(Path::new(settings.path()))
            .await
            .expect("the settings reopen");
        assert_eq!(
            reopened
                .load_document("role-routings")
                .await
                .expect("the document is read"),
            Some(document)
        );
        // It is the daemon's data directory that holds it, beside the database.
        assert!(settings.directory().join("role-routings.json").is_file());
    }

    #[tokio::test]
    async fn rewriting_a_document_replaces_it_whole() {
        let (_dir, settings) = settings().await;
        settings
            .save_document("agent-loop", &serde_json::json!({ "todos": ["one"] }))
            .await
            .expect("the first write");
        settings
            .save_document("agent-loop", &serde_json::json!({ "todos": [] }))
            .await
            .expect("the second write");

        let read = settings
            .load_document("agent-loop")
            .await
            .expect("the document is read")
            .expect("it was written");
        assert_eq!(read, serde_json::json!({ "todos": [] }));
        // No scratch file is left behind: the rename is the publish step.
        let leftovers = std::fs::read_dir(settings.directory())
            .expect("the data directory reads")
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".agent-loop.json.")
            })
            .count();
        assert_eq!(leftovers, 0, "a completed write leaves no scratch file");
    }

    #[tokio::test]
    async fn a_name_that_could_escape_the_data_directory_is_refused() {
        let (_dir, settings) = settings().await;
        for name in ["../elsewhere", "a/b", "..", "", "With Space", "UPPER"] {
            assert!(
                checked_document_name(name).is_err(),
                "{name:?} is not a document name"
            );
            assert!(settings
                .save_document(name, &serde_json::json!({}))
                .await
                .is_err());
            assert!(settings.load_document(name).await.is_err());
        }
    }

    #[tokio::test]
    async fn a_document_that_does_not_parse_is_an_error_and_not_an_empty_one() {
        let (_dir, settings) = settings().await;
        // What a daemon killed halfway through a non-atomic write would leave behind.
        std::fs::write(settings.directory().join("role-routings.json"), b"{\"rol")
            .expect("the corrupt document is placed");

        let error = settings
            .load_document("role-routings")
            .await
            .expect_err("an unreadable document is not \"nothing configured\"");
        assert!(
            matches!(error, SettingsError::DocumentFormat(ref name) if name == "role-routings"),
            "{error}"
        );
    }

    #[tokio::test]
    async fn wave_two_rows_round_trip_through_the_settings_store() {
        let (_dir, settings) = settings().await;

        // Harness: save, list, active selection, delete.
        let harness = StoredHarness {
            id: "solo-bench".to_string(),
            version: "1.0.0".to_string(),
            name: "Solo Bench".to_string(),
            description: "Minimalist single-agent supervisor flow".to_string(),
            data_json: r#"{"id":"solo-bench","stages":[]}"#.to_string(),
            is_preset: true,
            created_at: 1_700_000_000,
        };
        settings
            .save_harness(&harness)
            .await
            .expect("harness stored");
        settings
            .set_active_harness("project-1", "solo-bench")
            .await
            .expect("active set");
        let reopened = SettingsStore::open(Path::new(settings.path()))
            .await
            .expect("the settings reopen");
        assert_eq!(
            reopened
                .get_harness("solo-bench")
                .await
                .expect("get")
                .as_ref(),
            Some(&harness)
        );
        assert_eq!(reopened.list_harnesses().await.expect("list").len(), 1);
        assert_eq!(
            reopened
                .get_active_harness("project-1")
                .await
                .expect("active")
                .as_deref(),
            Some("solo-bench")
        );
        assert!(reopened.delete_harness("solo-bench").await.expect("delete"));

        // Skill: save, toggle, delete.
        let skill = StoredSkill {
            id: "test-driven-development".to_string(),
            name: "Test-Driven Development".to_string(),
            description: "Red, green, refactor.".to_string(),
            source: "github.com/obra/superpowers".to_string(),
            license: "MIT".to_string(),
            content: "# TDD".to_string(),
            enabled: true,
            tags_json: r#"["testing"]"#.to_string(),
        };
        settings.save_skill(&skill).await.expect("skill stored");
        assert_eq!(
            reopened
                .toggle_skill("test-driven-development")
                .await
                .expect("toggle"),
            Some(false)
        );
        assert_eq!(
            reopened
                .get_skill("test-driven-development")
                .await
                .expect("get")
                .map(|row| row.enabled),
            Some(false)
        );
        assert!(reopened
            .delete_skill("test-driven-development")
            .await
            .expect("delete"));

        // Plugin, custom model and integration each have their CRUD path.
        let plugin = StoredPlugin {
            id: "git-mcp".to_string(),
            name: "Git".to_string(),
            description: "Structured git operations.".to_string(),
            transport: "stdio".to_string(),
            command: Some("npx".to_string()),
            args_json: r#"["@modelcontextprotocol/server-git"]"#.to_string(),
            env_json: "{}".to_string(),
            enabled: true,
            tools_json: "[]".to_string(),
            source: "github.com/modelcontextprotocol/servers".to_string(),
        };
        settings.save_plugin(&plugin).await.expect("plugin stored");
        assert_eq!(reopened.list_plugins().await.expect("list").len(), 1);

        let model = StoredCustomModel {
            provider: "open_router".to_string(),
            model_id: "qwen/qwen3-coder".to_string(),
            display_name: Some("Qwen Coder".to_string()),
            context_window: Some(262_144),
            enabled: true,
        };
        settings
            .save_custom_model(&model)
            .await
            .expect("model stored");
        assert_eq!(
            reopened
                .get_custom_model("open_router", "qwen/qwen3-coder")
                .await
                .expect("get")
                .as_ref(),
            Some(&model)
        );

        let integration = StoredIntegration {
            id: "github".to_string(),
            name: "GitHub".to_string(),
            connected: false,
            config_json: r#"{"org":"warsha"}"#.to_string(),
            configured_at: Some(1_700_000_000),
        };
        settings
            .save_integration(&integration, None)
            .await
            .expect("integration stored");
        assert_eq!(reopened.list_integrations().await.expect("list").len(), 1);
        assert!(reopened.delete_integration("github").await.expect("delete"));
    }
}
