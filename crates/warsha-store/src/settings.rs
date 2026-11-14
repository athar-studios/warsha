//! The asynchronous settings repository (P-E7, OD-E7).
//!
//! These are the settings-shaped rows the daemon, the desktop and the pipeline
//! touch one at a time: taste preferences, backend kits, run modes, phone
//! pairings, configured providers, harnesses, skills, plugins, custom models,
//! integrations and the per-project active harness. They were written through a
//! synchronous `rusqlite` connection with a fresh connection per call; they now
//! go through [`SettingsRepo`], a thin layer over a `sqlx` pool, so the whole
//! workspace speaks one SQLite API and links one SQLite stack.
//!
//! The method set and the observable behaviour are the store's own: the same
//! statements, the same ordering, the same rows. What changed is the caller's
//! side — a call is now `await`ed on the daemon's runtime instead of being moved
//! to a blocking thread, and the connection is a pooled one instead of one
//! opened per call.
//!
//! The schema is `migrations/006_settings.sql`, the same file the async
//! migrator embeds, so a database this repository creates and one a daemon
//! migration created are the same database.

use std::fmt;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};

use crate::{
    column_int, column_opt_int, column_opt_text, column_text, repair_settings_expiry, Result,
    StoreError,
};

// --------------------------------------------------------------- stored rows

/// Shown in place of a pairing secret by [`StoredPairing`]'s `Debug` impl.
pub const REDACTED_SECRET: &str = "<redacted>";

/// One derived preference as it is stored: the decayed score per project target.
///
/// This is a snapshot, not a live value — `score` is whatever the pipeline
/// computed when it saved the row, and ageing it further is the pipeline's job
/// on the next save.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredPreference {
    /// The project the taste belongs to.
    pub project_id: String,
    /// The target the signals were about — a file, a style key, a phrasing.
    pub key: String,
    /// The decayed, weighted score at the time it was saved.
    pub score: f64,
    /// How many signals backed that score.
    pub evidence_count: u32,
    /// When the newest backing signal was recorded, in Unix seconds.
    pub last_updated: u64,
}

/// One project's backend kit: the picked backend plus its serialised schema.
///
/// `kind` and `url` duplicate two fields inside `config_json` on purpose: they
/// are the columns a `SELECT` can filter on without decoding the JSON, and the
/// JSON stays the single source the pipeline deserialises.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredBackendKit {
    /// The project the kit belongs to.
    pub project_id: String,
    /// The backend kind tag, e.g. `pocket_base` (informational, queryable).
    pub kind: String,
    /// Where the backend answers (informational, queryable).
    pub url: String,
    /// The serialised `BackendKit`.
    pub config_json: String,
}

/// One run mode's config, keyed by the mode tag (`local`, `self_hosted`, `hosted`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredRunMode {
    /// The mode tag the row is keyed by.
    pub mode: String,
    /// The serialised `RunModeConfig`.
    pub config_json: String,
}

/// One paired phone.
///
/// The secret is stored because the pairing channel has to hand it to the
/// device; it is `Debug`-redacted so a stray `{:?}` cannot put it in a log.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredPairing {
    /// Stable device id, minted by the M6 device flow.
    pub device_id: String,
    /// The one-time secret; never logged.
    pub secret: String,
    /// When the pairing was created, in Unix seconds.
    pub created_at: u64,
    /// True once the owner revoked it; a revoked pairing keeps its row.
    pub revoked: bool,
    /// Unix seconds after which the secret stops authenticating; `None` for a
    /// record the legacy `pairing.create` path wrote.
    pub expires_at: Option<u64>,
}

impl fmt::Debug for StoredPairing {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("StoredPairing")
            .field("device_id", &self.device_id)
            .field("secret", &REDACTED_SECRET)
            .field("created_at", &self.created_at)
            .field("revoked", &self.revoked)
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

/// One configured model provider, as the daemon's `providers.*` RPCs store it.
///
/// The name is the row's key and the keychain account: one provider, one secret,
/// no collision between two providers that happen to share a kind. There is
/// deliberately no `key` column — the API key is the OS keychain's, and a row
/// that could carry it is a row that could leak it into a backup, a crash report
/// or a `SELECT *` in a bug report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredProvider {
    /// The owner's name for this provider; also its keychain account.
    pub name: String,
    /// The adapter kind tag the wizard sent, e.g. `open_router`.
    pub kind: String,
    /// The OpenAI-compatible base URL, `None` when the kind's default applies.
    pub api_base: Option<String>,
    /// Whether the provider may be used. A stored provider is enabled; a
    /// removed one has no row at all rather than a disabled one.
    pub enabled: bool,
    /// When the provider was added, in Unix seconds. Ordering only.
    pub created_at: u64,
}

/// One harness row: the queryable header columns plus the whole
/// `warsha_core::HarnessDefinition` serialised into `data_json`.
///
/// The store keeps JSON for the nested stages and rules because they are read
/// and written whole; `name`, `version` and `is_preset` are duplicated as
/// columns only so a picker can render without decoding every row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredHarness {
    /// Stable harness identifier.
    pub id: String,
    /// Definition schema version.
    pub version: String,
    /// Human-readable name.
    pub name: String,
    /// One-paragraph description.
    pub description: String,
    /// The serialised `HarnessDefinition`.
    pub data_json: String,
    /// True for the bundled presets, false for user-authored harnesses.
    pub is_preset: bool,
    /// When the row was created, in Unix seconds.
    pub created_at: u64,
}

/// One skill row: the markdown pack, source and license as the store keeps them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredSkill {
    /// Stable skill identifier.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// One-line description.
    pub description: String,
    /// Upstream source, e.g. `github.com/obra/superpowers`.
    pub source: String,
    /// SPDX license tag of the upstream.
    pub license: String,
    /// The full markdown prompt body.
    pub content: String,
    /// Whether the skill is active for new runs.
    pub enabled: bool,
    /// Serialised `Vec<String>` of tags.
    pub tags_json: String,
}

/// One MCP plugin pack row.
///
/// `args_json`, `env_json` and `tools_json` hold the serialised lists/maps so
/// the row survives without a per-tool table; env values are keychain or
/// config *references*, never secret material.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredPlugin {
    /// Stable plugin identifier.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// One-paragraph description.
    pub description: String,
    /// Transport kind, `stdio` or `http`.
    pub transport: String,
    /// Launch command for stdio transports; `None` for externally managed servers.
    pub command: Option<String>,
    /// Serialised argument list.
    pub args_json: String,
    /// Serialised environment reference map.
    pub env_json: String,
    /// Whether the pack is active for new runs.
    pub enabled: bool,
    /// Serialised tool list.
    pub tools_json: String,
    /// Upstream source of the pack.
    pub source: String,
}

/// One user-registered custom model, keyed by `(provider, model_id)`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredCustomModel {
    /// Provider the model belongs to.
    pub provider: String,
    /// Model id as the provider names it.
    pub model_id: String,
    /// Display label; `None` falls back to `model_id` in the UI.
    pub display_name: Option<String>,
    /// Declared context window in tokens.
    pub context_window: Option<u32>,
    /// Whether the model may be routed to.
    pub enabled: bool,
}

/// One external integration row. `config_json` is the serialised
/// `IntegrationConfig` as last written; secret-bearing fields inside it are
/// the keychain's, so this column normally holds them as `null`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredIntegration {
    /// Stable integration identifier, e.g. `github`.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Whether the integration currently connects.
    pub connected: bool,
    /// The serialised `IntegrationConfig`.
    pub config_json: String,
    /// When it was last configured, in Unix seconds; `None` until then.
    pub configured_at: Option<u64>,
}

// ------------------------------------------------------------ value helpers

/// A `u64` as the `INTEGER` SQLite stores, without wrapping a corrupt value into
/// a negative one.
pub(crate) fn sql_int(value: u64, field: &'static str) -> Result<i64> {
    i64::try_from(value).map_err(|_| StoreError::CorruptId {
        field,
        value: value.to_string(),
    })
}

/// A stored `INTEGER` read back as a `u32`; a negative or oversized value is
/// corrupt data, not something to clamp.
pub(crate) fn unsigned_u32(value: i64, field: &'static str) -> Result<u32> {
    u32::try_from(value).map_err(|_| StoreError::CorruptId {
        field,
        value: value.to_string(),
    })
}

/// A stored `INTEGER` read back as a `u64`.
pub(crate) fn unsigned_u64(value: i64, field: &'static str) -> Result<u64> {
    u64::try_from(value).map_err(|_| StoreError::CorruptId {
        field,
        value: value.to_string(),
    })
}

/// The settings schema, exactly as the async migrator applies it.
///
/// One SQL source for both appliers: the migrator (`sqlx::migrate!`) and
/// [`SettingsRepo::migrate`], which applies it directly for a caller that has a
/// database but no migration run (a settings-only handle in a test, say).
const SETTINGS_SCHEMA_SQL: &str = include_str!("../migrations/006_settings.sql");

/// The settings rows, over one shared `sqlx` pool.
///
/// Cheap to clone — a pool handle, not a connection — so a daemon can hold one
/// per service and every clone reads and writes the same database. The pool is
/// the caller's to keep alive; nothing here opens or closes the file.
#[derive(Debug, Clone)]
pub struct SettingsRepo {
    pool: SqlitePool,
}

impl SettingsRepo {
    /// Open (creating if necessary) the database at `path` and switch it to WAL.
    ///
    /// A blank path is [`StoreError::InvalidPath`] rather than SQLite's silent
    /// temporary database, and a database that cannot enter WAL is
    /// [`StoreError::WalNotEnabled`] — the durability this store promises is not
    /// something to find out later. No schema is created here: [`migrate`] is
    /// what creates the tables, so opening a file to ask what is in it does not
    /// write to it.
    ///
    /// [`migrate`]: SettingsRepo::migrate
    pub async fn open(path: &str) -> Result<Self> {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return Err(StoreError::InvalidPath(path.to_string()));
        }
        // The same three pragmas the synchronous store set: WAL so a reader does
        // not block the daemon's writer, a five-second busy timeout so a short
        // lock waits instead of erroring, and foreign keys so the async schema's
        // `ON DELETE CASCADE` clauses fire on this connection too.
        let options = SqliteConnectOptions::new()
            .filename(trimmed)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(5))
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new().connect_with(options).await?;
        let repo = Self { pool };
        repo.ensure_wal().await?;
        Ok(repo)
    }

    /// A repository over a pool the caller already owns.
    ///
    /// This is how the daemon's own [`Store`](crate::Store) hands out the
    /// settings repository: one pool, one file, no second connection story.
    pub fn from_pool(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// Practice the settings schema on this database, idempotently.
    ///
    /// One transaction, so a failure half way through leaves no partial schema.
    /// Every statement is `CREATE TABLE IF NOT EXISTS` and the one shape
    /// `CREATE TABLE` cannot repair (a pre-H1 `pairing_devices`) is fixed by the
    /// guarded step, so calling this on every start is safe.
    pub async fn migrate(&self) -> Result<()> {
        let mut transaction = self.pool.begin().await?;
        sqlx::raw_sql(SETTINGS_SCHEMA_SQL)
            .execute(&mut *transaction)
            .await?;
        repair_settings_expiry(&mut transaction).await?;
        transaction.commit().await?;
        Ok(())
    }

    /// The tables this database holds, in name order.
    pub async fn tables(&self) -> Result<Vec<String>> {
        let names = sqlx::query_scalar::<_, String>(
            "SELECT name FROM sqlite_master \
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(names)
    }

    /// Borrow the underlying pool, for a caller that needs a query this module
    /// does not wrap (health checks, `PRAGMA`s in tests).
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    // ------------------------------------------------------------ preferences

    /// Insert or replace one derived preference, keyed by `(project_id, key)`.
    pub async fn save_preference(&self, preference: &StoredPreference) -> Result<()> {
        sqlx::query(
            "INSERT INTO preferences (project_id, key, score, evidence_count, last_updated) \
             VALUES (?, ?, ?, ?, ?) \
             ON CONFLICT(project_id, key) DO UPDATE SET \
             score = excluded.score, \
             evidence_count = excluded.evidence_count, \
             last_updated = excluded.last_updated",
        )
        .bind(&preference.project_id)
        .bind(&preference.key)
        .bind(preference.score)
        .bind(i64::from(preference.evidence_count))
        .bind(sql_int(
            preference.last_updated,
            "preferences.last_updated",
        )?)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// One project's preferences, highest score first, then by key.
    pub async fn load_preferences(&self, project_id: &str) -> Result<Vec<StoredPreference>> {
        let rows = sqlx::query(
            "SELECT project_id, key, score, evidence_count, last_updated FROM preferences \
             WHERE project_id = ? ORDER BY score DESC, key ASC",
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter()
            .map(|row| {
                Ok(StoredPreference {
                    project_id: column_text(row, "project_id")?,
                    key: column_text(row, "key")?,
                    score: row
                        .try_get::<f64, _>("score")
                        .map_err(|_| StoreError::UnexpectedType("score"))?,
                    evidence_count: unsigned_u32(
                        column_int(row, "evidence_count")?,
                        "preferences.evidence_count",
                    )?,
                    last_updated: unsigned_u64(
                        column_int(row, "last_updated")?,
                        "preferences.last_updated",
                    )?,
                })
            })
            .collect()
    }

    // ------------------------------------------------------------ backend kit

    /// Insert or replace a project's backend kit, keyed by project id.
    pub async fn save_backend_kit(&self, kit: &StoredBackendKit) -> Result<()> {
        sqlx::query(
            "INSERT INTO backend_kits (project_id, kind, url, config_json) \
             VALUES (?, ?, ?, ?) \
             ON CONFLICT(project_id) DO UPDATE SET \
             kind = excluded.kind, url = excluded.url, config_json = excluded.config_json",
        )
        .bind(&kit.project_id)
        .bind(&kit.kind)
        .bind(&kit.url)
        .bind(&kit.config_json)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// A project's backend kit, or `None` when the project has none.
    pub async fn load_backend_kit(&self, project_id: &str) -> Result<Option<StoredBackendKit>> {
        let row = sqlx::query(
            "SELECT project_id, kind, url, config_json FROM backend_kits WHERE project_id = ?",
        )
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref()
            .map(|row| {
                Ok(StoredBackendKit {
                    project_id: column_text(row, "project_id")?,
                    kind: column_text(row, "kind")?,
                    url: column_text(row, "url")?,
                    config_json: column_text(row, "config_json")?,
                })
            })
            .transpose()
    }

    // --------------------------------------------------------------- run mode

    /// Insert or replace one run mode's config, keyed by the mode tag.
    pub async fn save_run_mode(&self, config: &StoredRunMode) -> Result<()> {
        sqlx::query(
            "INSERT INTO run_modes (mode, config_json) VALUES (?, ?) \
             ON CONFLICT(mode) DO UPDATE SET config_json = excluded.config_json",
        )
        .bind(&config.mode)
        .bind(&config.config_json)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// One mode's config, or `None` when that mode was never saved.
    pub async fn load_run_mode(&self, mode: &str) -> Result<Option<StoredRunMode>> {
        let row = sqlx::query("SELECT mode, config_json FROM run_modes WHERE mode = ?")
            .bind(mode)
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref()
            .map(|row| {
                Ok(StoredRunMode {
                    mode: column_text(row, "mode")?,
                    config_json: column_text(row, "config_json")?,
                })
            })
            .transpose()
    }

    // --------------------------------------------------------------- pairings

    /// Insert or replace one paired phone, keyed by device id.
    ///
    /// Replacing is how a revoke lands: `revoked` flips on the existing row
    /// rather than the row being deleted, so "was this device ever paired, and
    /// when was it cut off" stays answerable.
    pub async fn save_pairing(&self, pairing: &StoredPairing) -> Result<()> {
        let expires_at = pairing
            .expires_at
            .map(|expires_at| sql_int(expires_at, "pairing_devices.expires_at"))
            .transpose()?;
        sqlx::query(
            "INSERT INTO pairing_devices (device_id, secret, created_at, revoked, expires_at) \
             VALUES (?, ?, ?, ?, ?) \
             ON CONFLICT(device_id) DO UPDATE SET \
             secret = excluded.secret, created_at = excluded.created_at, \
             revoked = excluded.revoked, expires_at = excluded.expires_at",
        )
        .bind(&pairing.device_id)
        .bind(&pairing.secret)
        .bind(sql_int(pairing.created_at, "pairing_devices.created_at")?)
        .bind(i64::from(pairing.revoked))
        .bind(expires_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Every pairing, active and revoked, oldest first.
    pub async fn load_pairings(&self) -> Result<Vec<StoredPairing>> {
        let rows = sqlx::query(
            "SELECT device_id, secret, created_at, revoked, expires_at FROM pairing_devices \
             ORDER BY created_at ASC, device_id ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.iter()
            .map(|row| {
                let expires_at = column_opt_int(row, "expires_at")?
                    .map(|expires_at| unsigned_u64(expires_at, "pairing_devices.expires_at"))
                    .transpose()?;
                Ok(StoredPairing {
                    device_id: column_text(row, "device_id")?,
                    secret: column_text(row, "secret")?,
                    created_at: unsigned_u64(
                        column_int(row, "created_at")?,
                        "pairing_devices.created_at",
                    )?,
                    revoked: column_bool(row, "revoked")?,
                    expires_at,
                })
            })
            .collect()
    }

    // -------------------------------------------------------------- providers

    /// Insert or replace one configured provider, keyed by its name.
    ///
    /// Replacing is how a re-`add` of the same name works: the row keeps its
    /// `created_at` (the provider is not new again just because its key was
    /// re-entered) and takes the kind and base URL the caller just sent.
    pub async fn save_provider(&self, provider: &StoredProvider) -> Result<()> {
        sqlx::query(
            "INSERT INTO configured_providers (name, kind, api_base, enabled, created_at) \
             VALUES (?, ?, ?, ?, ?) \
             ON CONFLICT(name) DO UPDATE SET \
             kind = excluded.kind, api_base = excluded.api_base, enabled = excluded.enabled",
        )
        .bind(&provider.name)
        .bind(&provider.kind)
        .bind(provider.api_base.as_deref())
        .bind(i64::from(provider.enabled))
        .bind(sql_int(
            provider.created_at,
            "configured_providers.created_at",
        )?)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// One provider by name, or `None` when no such row exists.
    pub async fn load_provider(&self, name: &str) -> Result<Option<StoredProvider>> {
        let row = sqlx::query(
            "SELECT name, kind, api_base, enabled, created_at FROM configured_providers \
             WHERE name = ?",
        )
        .bind(name)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(stored_provider_from_row).transpose()
    }

    /// Every configured provider, oldest first, then by name.
    pub async fn load_providers(&self) -> Result<Vec<StoredProvider>> {
        let rows = sqlx::query(
            "SELECT name, kind, api_base, enabled, created_at FROM configured_providers \
             ORDER BY created_at ASC, name ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(stored_provider_from_row).collect()
    }

    /// Delete one provider's row, answering whether there was one.
    pub async fn delete_provider(&self, name: &str) -> Result<bool> {
        let deleted = sqlx::query("DELETE FROM configured_providers WHERE name = ?")
            .bind(name)
            .execute(&self.pool)
            .await?
            .rows_affected();
        Ok(deleted > 0)
    }

    // -------------------------------------------------------------- harnesses

    /// Insert or replace one harness, keyed by its id.
    pub async fn save_harness(&self, harness: &StoredHarness) -> Result<()> {
        sqlx::query(
            "INSERT INTO harnesses (id, version, name, description, data_json, is_preset, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT(id) DO UPDATE SET \
             version = excluded.version, name = excluded.name, description = excluded.description, \
             data_json = excluded.data_json, is_preset = excluded.is_preset",
        )
        .bind(&harness.id)
        .bind(&harness.version)
        .bind(&harness.name)
        .bind(&harness.description)
        .bind(&harness.data_json)
        .bind(i64::from(harness.is_preset))
        .bind(sql_int(
            harness.created_at,
            "harnesses.created_at",
        )?)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// One harness by id, or `None` when no such row exists.
    pub async fn load_harness(&self, id: &str) -> Result<Option<StoredHarness>> {
        let row = sqlx::query(
            "SELECT id, version, name, description, data_json, is_preset, created_at \
             FROM harnesses WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(stored_harness_from_row).transpose()
    }

    /// Every harness, presets and user-authored alike, oldest first.
    pub async fn load_harnesses(&self) -> Result<Vec<StoredHarness>> {
        let rows = sqlx::query(
            "SELECT id, version, name, description, data_json, is_preset, created_at \
             FROM harnesses ORDER BY created_at ASC, id ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(stored_harness_from_row).collect()
    }

    /// Delete one harness row, answering whether there was one.
    pub async fn delete_harness(&self, id: &str) -> Result<bool> {
        let deleted = sqlx::query("DELETE FROM harnesses WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        Ok(deleted > 0)
    }

    /// Point a project at a harness, replacing any previous selection.
    pub async fn set_active_harness(&self, project_id: &str, harness_id: &str) -> Result<()> {
        sqlx::query(
            "INSERT INTO active_harness (project_id, harness_id) VALUES (?, ?) \
             ON CONFLICT(project_id) DO UPDATE SET harness_id = excluded.harness_id",
        )
        .bind(project_id)
        .bind(harness_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// The harness a project is currently running with, if one was selected.
    pub async fn get_active_harness(&self, project_id: &str) -> Result<Option<String>> {
        let harness_id = sqlx::query_scalar::<_, String>(
            "SELECT harness_id FROM active_harness WHERE project_id = ?",
        )
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(harness_id)
    }

    /// Clear a project's harness selection, answering whether there was one.
    pub async fn clear_active_harness(&self, project_id: &str) -> Result<bool> {
        let deleted = sqlx::query("DELETE FROM active_harness WHERE project_id = ?")
            .bind(project_id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        Ok(deleted > 0)
    }

    // ---------------------------------------------------------------- skills

    /// Insert or replace one skill, keyed by its id.
    pub async fn save_skill(&self, skill: &StoredSkill) -> Result<()> {
        sqlx::query(
            "INSERT INTO skills (id, name, description, source, license, content, enabled, tags_json) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT(id) DO UPDATE SET \
             name = excluded.name, description = excluded.description, source = excluded.source, \
             license = excluded.license, content = excluded.content, enabled = excluded.enabled, \
             tags_json = excluded.tags_json",
        )
        .bind(&skill.id)
        .bind(&skill.name)
        .bind(&skill.description)
        .bind(&skill.source)
        .bind(&skill.license)
        .bind(&skill.content)
        .bind(i64::from(skill.enabled))
        .bind(&skill.tags_json)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// One skill by id.
    pub async fn load_skill(&self, id: &str) -> Result<Option<StoredSkill>> {
        let row = sqlx::query(
            "SELECT id, name, description, source, license, content, enabled, tags_json \
             FROM skills WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(stored_skill_from_row).transpose()
    }

    /// Every skill, by name, whether enabled or not.
    pub async fn load_skills(&self) -> Result<Vec<StoredSkill>> {
        let rows = sqlx::query(
            "SELECT id, name, description, source, license, content, enabled, tags_json \
             FROM skills ORDER BY name ASC, id ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(stored_skill_from_row).collect()
    }

    /// Delete one skill row, answering whether there was one.
    pub async fn delete_skill(&self, id: &str) -> Result<bool> {
        let deleted = sqlx::query("DELETE FROM skills WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        Ok(deleted > 0)
    }

    /// Flip a skill's enabled flag, answering with the new state, or `None`
    /// when no such skill exists.
    pub async fn toggle_skill(&self, id: &str) -> Result<Option<bool>> {
        let changed = sqlx::query("UPDATE skills SET enabled = 1 - enabled WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        if changed == 0 {
            return Ok(None);
        }
        let enabled = self.load_skill(id).await?.map(|skill| skill.enabled);
        Ok(enabled)
    }

    // --------------------------------------------------------------- plugins

    /// Insert or replace one plugin pack, keyed by its id.
    pub async fn save_plugin(&self, plugin: &StoredPlugin) -> Result<()> {
        sqlx::query(
            "INSERT INTO plugins (id, name, description, transport, command, args_json, \
             env_json, enabled, tools_json, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT(id) DO UPDATE SET \
             name = excluded.name, description = excluded.description, transport = excluded.transport, \
             command = excluded.command, args_json = excluded.args_json, env_json = excluded.env_json, \
             enabled = excluded.enabled, tools_json = excluded.tools_json, source = excluded.source",
        )
        .bind(&plugin.id)
        .bind(&plugin.name)
        .bind(&plugin.description)
        .bind(&plugin.transport)
        .bind(plugin.command.as_deref())
        .bind(&plugin.args_json)
        .bind(&plugin.env_json)
        .bind(i64::from(plugin.enabled))
        .bind(&plugin.tools_json)
        .bind(&plugin.source)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// One plugin by id.
    pub async fn load_plugin(&self, id: &str) -> Result<Option<StoredPlugin>> {
        let row = sqlx::query(
            "SELECT id, name, description, transport, command, args_json, env_json, \
             enabled, tools_json, source FROM plugins WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(stored_plugin_from_row).transpose()
    }

    /// Every plugin pack, by name, whether enabled or not.
    pub async fn load_plugins(&self) -> Result<Vec<StoredPlugin>> {
        let rows = sqlx::query(
            "SELECT id, name, description, transport, command, args_json, env_json, enabled, \
             tools_json, source FROM plugins ORDER BY name ASC, id ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(stored_plugin_from_row).collect()
    }

    /// Delete one plugin row, answering whether there was one.
    pub async fn delete_plugin(&self, id: &str) -> Result<bool> {
        let deleted = sqlx::query("DELETE FROM plugins WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        Ok(deleted > 0)
    }

    /// Flip a plugin's enabled flag, answering with the new state, or `None`
    /// when no such plugin exists.
    pub async fn toggle_plugin(&self, id: &str) -> Result<Option<bool>> {
        let changed = sqlx::query("UPDATE plugins SET enabled = 1 - enabled WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        if changed == 0 {
            return Ok(None);
        }
        let enabled = self.load_plugin(id).await?.map(|plugin| plugin.enabled);
        Ok(enabled)
    }

    // --------------------------------------------------------- custom models

    /// Insert or replace one custom model, keyed by `(provider, model_id)`.
    pub async fn save_custom_model(&self, model: &StoredCustomModel) -> Result<()> {
        sqlx::query(
            "INSERT INTO custom_models (provider, model_id, display_name, context_window, enabled) \
             VALUES (?, ?, ?, ?, ?) \
             ON CONFLICT(provider, model_id) DO UPDATE SET \
             display_name = excluded.display_name, context_window = excluded.context_window, \
             enabled = excluded.enabled",
        )
        .bind(&model.provider)
        .bind(&model.model_id)
        .bind(model.display_name.as_deref())
        .bind(model.context_window.map(i64::from))
        .bind(i64::from(model.enabled))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// One custom model by provider and model id.
    pub async fn load_custom_model(
        &self,
        provider: &str,
        model_id: &str,
    ) -> Result<Option<StoredCustomModel>> {
        let row = sqlx::query(
            "SELECT provider, model_id, display_name, context_window, enabled \
             FROM custom_models WHERE provider = ? AND model_id = ?",
        )
        .bind(provider)
        .bind(model_id)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(stored_custom_model_from_row).transpose()
    }

    /// Every custom model, by provider then model id.
    pub async fn load_custom_models(&self) -> Result<Vec<StoredCustomModel>> {
        let rows = sqlx::query(
            "SELECT provider, model_id, display_name, context_window, enabled FROM custom_models \
             ORDER BY provider ASC, model_id ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(stored_custom_model_from_row).collect()
    }

    /// Delete one custom model, answering whether there was one.
    pub async fn delete_custom_model(&self, provider: &str, model_id: &str) -> Result<bool> {
        let deleted = sqlx::query("DELETE FROM custom_models WHERE provider = ? AND model_id = ?")
            .bind(provider)
            .bind(model_id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        Ok(deleted > 0)
    }

    /// Flip a custom model's enabled flag, answering with the new state, or
    /// `None` when no such model exists.
    pub async fn toggle_custom_model(
        &self,
        provider: &str,
        model_id: &str,
    ) -> Result<Option<bool>> {
        let changed = sqlx::query(
            "UPDATE custom_models SET enabled = 1 - enabled WHERE provider = ? AND model_id = ?",
        )
        .bind(provider)
        .bind(model_id)
        .execute(&self.pool)
        .await?
        .rows_affected();
        if changed == 0 {
            return Ok(None);
        }
        let enabled = self
            .load_custom_model(provider, model_id)
            .await?
            .map(|model| model.enabled);
        Ok(enabled)
    }

    // ------------------------------------------------------------ integrations

    /// Insert or replace one integration row.
    ///
    /// A save with `config_json: None` keeps the config the row already had —
    /// a connection check updates status without rewriting credentials.
    pub async fn save_integration(
        &self,
        integration: &StoredIntegration,
        config_json: Option<&str>,
    ) -> Result<()> {
        let configured_at = integration
            .configured_at
            .map(|value| sql_int(value, "integrations.configured_at"))
            .transpose()?;
        sqlx::query(
            "INSERT INTO integrations (id, name, connected, config_json, configured_at) \
             VALUES (?, ?, ?, ?, ?) \
             ON CONFLICT(id) DO UPDATE SET \
             name = excluded.name, connected = excluded.connected, \
             config_json = COALESCE(?, integrations.config_json), \
             configured_at = COALESCE(?, integrations.configured_at)",
        )
        .bind(&integration.id)
        .bind(&integration.name)
        .bind(i64::from(integration.connected))
        .bind(&integration.config_json)
        .bind(configured_at)
        // The `COALESCE` arguments repeat the two values above: a bound
        // parameter is used once in a positional statement, and `None` here is
        // what keeps the stored value.
        .bind(config_json)
        .bind(configured_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// One integration by id.
    pub async fn load_integration(&self, id: &str) -> Result<Option<StoredIntegration>> {
        let row = sqlx::query(
            "SELECT id, name, connected, config_json, configured_at FROM integrations \
             WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(stored_integration_from_row).transpose()
    }

    /// Every integration, by name.
    pub async fn load_integrations(&self) -> Result<Vec<StoredIntegration>> {
        let rows = sqlx::query(
            "SELECT id, name, connected, config_json, configured_at FROM integrations \
             ORDER BY name ASC, id ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(stored_integration_from_row).collect()
    }

    /// Delete one integration row, answering whether there was one.
    pub async fn delete_integration(&self, id: &str) -> Result<bool> {
        let deleted = sqlx::query("DELETE FROM integrations WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        Ok(deleted > 0)
    }

    /// Read the journal mode back and refuse anything that is not WAL.
    async fn ensure_wal(&self) -> Result<()> {
        let mode: String = sqlx::query_scalar("PRAGMA journal_mode")
            .fetch_one(&self.pool)
            .await?;
        if mode.eq_ignore_ascii_case("wal") {
            Ok(())
        } else {
            Err(StoreError::WalNotEnabled(mode))
        }
    }
}

/// A stored `INTEGER` read back as a boolean, the way the synchronous store's
/// `bool` column reads behaved: zero is false, anything else is true.
fn column_bool(row: &sqlx::sqlite::SqliteRow, column: &'static str) -> Result<bool> {
    Ok(column_int(row, column)? != 0)
}

/// One `configured_providers` row, in the column order both provider queries
/// select.
fn stored_provider_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<StoredProvider> {
    Ok(StoredProvider {
        name: column_text(row, "name")?,
        kind: column_text(row, "kind")?,
        api_base: column_opt_text(row, "api_base")?,
        enabled: column_bool(row, "enabled")?,
        created_at: unsigned_u64(
            column_int(row, "created_at")?,
            "configured_providers.created_at",
        )?,
    })
}

/// One `harnesses` row, in the column order both harness queries select.
fn stored_harness_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<StoredHarness> {
    Ok(StoredHarness {
        id: column_text(row, "id")?,
        version: column_text(row, "version")?,
        name: column_text(row, "name")?,
        description: column_text(row, "description")?,
        data_json: column_text(row, "data_json")?,
        is_preset: column_bool(row, "is_preset")?,
        created_at: unsigned_u64(column_int(row, "created_at")?, "harnesses.created_at")?,
    })
}

/// One `skills` row, in the column order both skill queries select.
fn stored_skill_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<StoredSkill> {
    Ok(StoredSkill {
        id: column_text(row, "id")?,
        name: column_text(row, "name")?,
        description: column_text(row, "description")?,
        source: column_text(row, "source")?,
        license: column_text(row, "license")?,
        content: column_text(row, "content")?,
        enabled: column_bool(row, "enabled")?,
        tags_json: column_text(row, "tags_json")?,
    })
}

/// One `plugins` row, in the column order both plugin queries select.
fn stored_plugin_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<StoredPlugin> {
    Ok(StoredPlugin {
        id: column_text(row, "id")?,
        name: column_text(row, "name")?,
        description: column_text(row, "description")?,
        transport: column_text(row, "transport")?,
        command: column_opt_text(row, "command")?,
        args_json: column_text(row, "args_json")?,
        env_json: column_text(row, "env_json")?,
        enabled: column_bool(row, "enabled")?,
        tools_json: column_text(row, "tools_json")?,
        source: column_text(row, "source")?,
    })
}

/// One `custom_models` row, in the column order both model queries select.
///
/// `context_window` is read back through an `i64` so a negative or oversized
/// stored value is reported as corrupt data rather than clamped.
fn stored_custom_model_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<StoredCustomModel> {
    let context_window = column_opt_int(row, "context_window")?
        .map(|value| {
            u32::try_from(value).map_err(|_| StoreError::CorruptId {
                field: "custom_models.context_window",
                value: value.to_string(),
            })
        })
        .transpose()?;
    Ok(StoredCustomModel {
        provider: column_text(row, "provider")?,
        model_id: column_text(row, "model_id")?,
        display_name: column_opt_text(row, "display_name")?,
        context_window,
        enabled: column_bool(row, "enabled")?,
    })
}

/// One `integrations` row, in the column order both integration queries select.
fn stored_integration_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<StoredIntegration> {
    let configured_at = column_opt_int(row, "configured_at")?
        .map(|value| unsigned_u64(value, "integrations.configured_at"))
        .transpose()?;
    Ok(StoredIntegration {
        id: column_text(row, "id")?,
        name: column_text(row, "name")?,
        connected: column_bool(row, "connected")?,
        config_json: column_text(row, "config_json")?,
        configured_at,
    })
}
