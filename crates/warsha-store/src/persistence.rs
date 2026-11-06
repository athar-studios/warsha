//! Durable store for the M20 layers: taste preferences, backend kits, run modes
//! and phone pairings (PLAN.md M20), plus the Wave 2 settings-shaped records:
//! harnesses, skills, plugins, custom models, integrations and the per-project
//! active harness.
//!
//! `warsha-store` already persists projects, runs, events, gates, artifacts and
//! costs through `sqlx`. The records in this module are different: they are
//! *small settings-shaped rows* that the desktop, the daemon and the pipeline
//! touch synchronously, one at a time, so they get a plain [`rusqlite`]
//! connection instead of the async pool:
//!
//! - **WAL, not rollback journalling.** [`SqliteStore::open`] switches the
//!   database to `journal_mode = WAL` and refuses to return a store that did not
//!   end up there, because a reader is not supposed to block the daemon's writer.
//! - **One migration step, idempotent.** [`SqliteStore::migrate`] creates the
//!   settings tables inside a transaction and is a no-op afterwards, so calling it
//!   on every start is safe.
//! - **Rows, not pipeline types.** The store cannot depend on `warsha-pipeline`
//!   (the dependency direction is core ← store ← providers ← pipeline), so the
//!   columns live in row structs like [`StoredPreference`], [`StoredBackendKit`],
//!   [`StoredRunMode`], [`StoredPairing`], [`StoredProvider`], [`StoredHarness`],
//!   [`StoredSkill`], [`StoredPlugin`], [`StoredCustomModel`] and
//!   [`StoredIntegration`]. The pipeline and the daemon convert their own types
//!   to these and back; nothing here knows what a taste signal or a harness
//!   stage is.
//! - **A pairing secret is never printed.** [`StoredPairing`] keeps the one-time
//!   secret so the pairing channel can hand it back, but its `Debug` impl prints
//!   `<redacted>`, the same rule `PhonePairing` follows in `warsha-pipeline`.
//! - **A provider row never carries a key.** [`StoredProvider`] holds the name,
//!   the kind, the base URL and the enabled flag; the API key lives in the OS
//!   keychain, addressed by the provider's name. There is no column for it, so
//!   `providers.add` has nothing to leak into this file.
//!
//! What is deliberately not here: no async API, no connection pool, no query
//! cache and no second migration system. [`SqliteStore`] owns one connection and
//! runs its statements on the caller's thread; the caller decides where that
//! happens.

use std::fmt;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::{Result, StoreError};

/// The schema [`SqliteStore::migrate`] applies, one statement per table.
///
/// Every table is `IF NOT EXISTS`, so the migration is idempotent; the columns
/// are `NOT NULL` because each row is written whole by the methods below.
pub const SCHEMA_SQL: &str = "\
CREATE TABLE IF NOT EXISTS preferences (
    project_id     TEXT    NOT NULL,
    key            TEXT    NOT NULL,
    score          REAL    NOT NULL,
    evidence_count INTEGER NOT NULL,
    last_updated   INTEGER NOT NULL,
    PRIMARY KEY (project_id, key)
);
CREATE TABLE IF NOT EXISTS backend_kits (
    project_id  TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    url         TEXT NOT NULL,
    config_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run_modes (
    mode        TEXT PRIMARY KEY,
    config_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pairing_devices (
    device_id  TEXT PRIMARY KEY,
    secret     TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    revoked    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS configured_providers (
    name       TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,
    api_base   TEXT,
    enabled    INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS harnesses (
    id         TEXT PRIMARY KEY,
    version    TEXT NOT NULL,
    name       TEXT NOT NULL,
    description TEXT NOT NULL,
    data_json  TEXT NOT NULL,
    is_preset  INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS skills (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    source      TEXT NOT NULL,
    license     TEXT NOT NULL,
    content     TEXT NOT NULL,
    enabled     INTEGER NOT NULL,
    tags_json   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plugins (
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
CREATE TABLE IF NOT EXISTS custom_models (
    provider       TEXT NOT NULL,
    model_id       TEXT NOT NULL,
    display_name   TEXT,
    context_window INTEGER,
    enabled        INTEGER NOT NULL,
    PRIMARY KEY (provider, model_id)
);
CREATE TABLE IF NOT EXISTS integrations (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    connected     INTEGER NOT NULL,
    config_json   TEXT NOT NULL,
    configured_at INTEGER
);
CREATE TABLE IF NOT EXISTS active_harness (
    project_id TEXT PRIMARY KEY,
    harness_id TEXT NOT NULL
);
";

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
}

impl fmt::Debug for StoredPairing {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("StoredPairing")
            .field("device_id", &self.device_id)
            .field("secret", &REDACTED_SECRET)
            .field("created_at", &self.created_at)
            .field("revoked", &self.revoked)
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

/// A SQLite database holding the M20 and Wave 2 tables, in WAL mode.
///
/// [`SqliteStore::open`] creates the file (and the directory is the caller's to
/// create) and switches it to WAL; [`SqliteStore::migrate`] creates the tables.
/// Both are idempotent, and a caller that wants a usable store runs both:
///
/// ```rust,ignore
/// let store = SqliteStore::open(&db_path)?;
/// store.migrate()?;
/// ```
pub struct SqliteStore {
    conn: Connection,
}

impl SqliteStore {
    /// Open (creating if necessary) the database at `path` and switch it to WAL.
    ///
    /// A blank path is [`StoreError::InvalidPath`] rather than SQLite's silent
    /// temporary database, and a database that cannot enter WAL (an in-memory
    /// one, or a filesystem without WAL support) is
    /// [`StoreError::WalNotEnabled`] — the durability this store promises is not
    /// something to find out later.
    pub fn open(path: &str) -> Result<Self> {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return Err(StoreError::InvalidPath(path.to_string()));
        }

        let conn = Connection::open(trimmed)?;
        // WAL is a property of the database *file*, so it survives this process.
        conn.execute_batch("PRAGMA journal_mode = WAL;")?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        conn.execute_batch("PRAGMA busy_timeout = 5000;")?;

        let store = Self { conn };
        store.ensure_wal()?;
        Ok(store)
    }

    /// Create the M20 and Wave 2 tables if they do not exist yet.
    ///
    /// One transaction, so a failure half way through leaves no partial schema.
    pub fn migrate(&self) -> Result<()> {
        let transaction = self.conn.unchecked_transaction()?;
        transaction.execute_batch(SCHEMA_SQL)?;
        transaction.commit()?;
        Ok(())
    }

    /// The tables this store's schema defines, in name order.
    pub fn tables(&self) -> Result<Vec<String>> {
        let mut statement = self.conn.prepare(
            "SELECT name FROM sqlite_master \
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC",
        )?;
        let names = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?;
        Ok(names)
    }

    /// Borrow the underlying connection, for a caller that needs a query this
    /// module does not wrap (health checks, `PRAGMA`s in tests).
    pub fn connection(&self) -> &Connection {
        &self.conn
    }

    // ------------------------------------------------------------ preferences

    /// Insert or replace one derived preference, keyed by `(project_id, key)`.
    pub fn save_preference(&self, preference: &StoredPreference) -> Result<()> {
        self.conn.execute(
            "INSERT INTO preferences (project_id, key, score, evidence_count, last_updated) \
             VALUES (?1, ?2, ?3, ?4, ?5) \
             ON CONFLICT(project_id, key) DO UPDATE SET \
             score = excluded.score, \
             evidence_count = excluded.evidence_count, \
             last_updated = excluded.last_updated",
            params![
                preference.project_id,
                preference.key,
                preference.score,
                i64::from(preference.evidence_count),
                sql_int(preference.last_updated, "preferences.last_updated")?,
            ],
        )?;
        Ok(())
    }

    /// One project's preferences, highest score first, then by key.
    pub fn load_preferences(&self, project_id: &str) -> Result<Vec<StoredPreference>> {
        let mut statement = self.conn.prepare(
            "SELECT project_id, key, score, evidence_count, last_updated FROM preferences \
             WHERE project_id = ?1 ORDER BY score DESC, key ASC",
        )?;
        let rows = statement
            .query_map(params![project_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, f64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        rows.into_iter()
            .map(|(project_id, key, score, evidence_count, last_updated)| {
                Ok(StoredPreference {
                    project_id,
                    key,
                    score,
                    evidence_count: unsigned_u32(evidence_count, "preferences.evidence_count")?,
                    last_updated: unsigned_u64(last_updated, "preferences.last_updated")?,
                })
            })
            .collect()
    }

    // ------------------------------------------------------------ backend kit

    /// Insert or replace a project's backend kit, keyed by project id.
    pub fn save_backend_kit(&self, kit: &StoredBackendKit) -> Result<()> {
        self.conn.execute(
            "INSERT INTO backend_kits (project_id, kind, url, config_json) \
             VALUES (?1, ?2, ?3, ?4) \
             ON CONFLICT(project_id) DO UPDATE SET \
             kind = excluded.kind, url = excluded.url, config_json = excluded.config_json",
            params![kit.project_id, kit.kind, kit.url, kit.config_json],
        )?;
        Ok(())
    }

    /// A project's backend kit, or `None` when the project has none.
    pub fn load_backend_kit(&self, project_id: &str) -> Result<Option<StoredBackendKit>> {
        let row = self
            .conn
            .query_row(
                "SELECT project_id, kind, url, config_json FROM backend_kits \
                 WHERE project_id = ?1",
                params![project_id],
                |row| {
                    Ok(StoredBackendKit {
                        project_id: row.get(0)?,
                        kind: row.get(1)?,
                        url: row.get(2)?,
                        config_json: row.get(3)?,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    // --------------------------------------------------------------- run mode

    /// Insert or replace one run mode's config, keyed by the mode tag.
    pub fn save_run_mode(&self, config: &StoredRunMode) -> Result<()> {
        self.conn.execute(
            "INSERT INTO run_modes (mode, config_json) VALUES (?1, ?2) \
             ON CONFLICT(mode) DO UPDATE SET config_json = excluded.config_json",
            params![config.mode, config.config_json],
        )?;
        Ok(())
    }

    /// One mode's config, or `None` when that mode was never saved.
    pub fn load_run_mode(&self, mode: &str) -> Result<Option<StoredRunMode>> {
        let row = self
            .conn
            .query_row(
                "SELECT mode, config_json FROM run_modes WHERE mode = ?1",
                params![mode],
                |row| {
                    Ok(StoredRunMode {
                        mode: row.get(0)?,
                        config_json: row.get(1)?,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    // --------------------------------------------------------------- pairings

    /// Insert or replace one paired phone, keyed by device id.
    ///
    /// Replacing is how a revoke lands: `revoked` flips on the existing row
    /// rather than the row being deleted, so "was this device ever paired, and
    /// when was it cut off" stays answerable.
    pub fn save_pairing(&self, pairing: &StoredPairing) -> Result<()> {
        self.conn.execute(
            "INSERT INTO pairing_devices (device_id, secret, created_at, revoked) \
             VALUES (?1, ?2, ?3, ?4) \
             ON CONFLICT(device_id) DO UPDATE SET \
             secret = excluded.secret, created_at = excluded.created_at, \
             revoked = excluded.revoked",
            params![
                pairing.device_id,
                pairing.secret,
                sql_int(pairing.created_at, "pairing_devices.created_at")?,
                i64::from(pairing.revoked),
            ],
        )?;
        Ok(())
    }

    /// Every pairing, active and revoked, oldest first.
    pub fn load_pairings(&self) -> Result<Vec<StoredPairing>> {
        let mut statement = self.conn.prepare(
            "SELECT device_id, secret, created_at, revoked FROM pairing_devices \
             ORDER BY created_at ASC, device_id ASC",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        rows.into_iter()
            .map(|(device_id, secret, created_at, revoked)| {
                Ok(StoredPairing {
                    device_id,
                    secret,
                    created_at: unsigned_u64(created_at, "pairing_devices.created_at")?,
                    revoked: revoked != 0,
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
    pub fn save_provider(&self, provider: &StoredProvider) -> Result<()> {
        self.conn.execute(
            "INSERT INTO configured_providers (name, kind, api_base, enabled, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5) \
             ON CONFLICT(name) DO UPDATE SET \
             kind = excluded.kind, api_base = excluded.api_base, enabled = excluded.enabled",
            params![
                provider.name,
                provider.kind,
                provider.api_base,
                i64::from(provider.enabled),
                sql_int(provider.created_at, "configured_providers.created_at")?,
            ],
        )?;
        Ok(())
    }

    /// One provider by name, or `None` when no such row exists.
    pub fn load_provider(&self, name: &str) -> Result<Option<StoredProvider>> {
        let row = self
            .conn
            .query_row(
                "SELECT name, kind, api_base, enabled, created_at FROM configured_providers \
                 WHERE name = ?1",
                params![name],
                stored_provider_from_row,
            )
            .optional()?;
        Ok(row)
    }

    /// Every configured provider, oldest first, then by name.
    ///
    /// Creation order is what a picker shows, and the name breaks the tie so two
    /// providers added in the same second still come back in a stable order.
    pub fn load_providers(&self) -> Result<Vec<StoredProvider>> {
        let mut statement = self.conn.prepare(
            "SELECT name, kind, api_base, enabled, created_at FROM configured_providers \
             ORDER BY created_at ASC, name ASC",
        )?;
        let rows = statement
            .query_map([], stored_provider_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Delete one provider's row, answering whether there was one.
    ///
    /// The keychain entry is not touched here: this layer has no keychain, and a
    /// caller that deletes the row without its secret is exactly the orphan this
    /// method's `bool` lets it detect.
    pub fn delete_provider(&self, name: &str) -> Result<bool> {
        let deleted = self.conn.execute(
            "DELETE FROM configured_providers WHERE name = ?1",
            params![name],
        )?;
        Ok(deleted > 0)
    }

    // -------------------------------------------------------------- harnesses

    /// Insert or replace one harness, keyed by its id.
    ///
    /// Like providers, a re-save keeps the original `created_at`: re-importing
    /// a preset does not make it new again.
    pub fn save_harness(&self, harness: &StoredHarness) -> Result<()> {
        self.conn.execute(
            "INSERT INTO harnesses (id, version, name, description, data_json, is_preset, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
             ON CONFLICT(id) DO UPDATE SET \
             version = excluded.version, name = excluded.name, description = excluded.description, \
             data_json = excluded.data_json, is_preset = excluded.is_preset",
            params![
                harness.id,
                harness.version,
                harness.name,
                harness.description,
                harness.data_json,
                i64::from(harness.is_preset),
                sql_int(harness.created_at, "harnesses.created_at")?,
            ],
        )?;
        Ok(())
    }

    /// One harness by id, or `None` when no such row exists.
    pub fn load_harness(&self, id: &str) -> Result<Option<StoredHarness>> {
        let row = self
            .conn
            .query_row(
                "SELECT id, version, name, description, data_json, is_preset, created_at \
                 FROM harnesses WHERE id = ?1",
                params![id],
                stored_harness_from_row,
            )
            .optional()?;
        Ok(row)
    }

    /// Every harness, presets and user-authored alike, oldest first.
    pub fn load_harnesses(&self) -> Result<Vec<StoredHarness>> {
        let mut statement = self.conn.prepare(
            "SELECT id, version, name, description, data_json, is_preset, created_at \
             FROM harnesses ORDER BY created_at ASC, id ASC",
        )?;
        let rows = statement
            .query_map([], stored_harness_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Delete one harness row, answering whether there was one.
    ///
    /// The per-project `active_harness` pointer is not touched: a caller that
    /// deletes a selected harness should clear or repoint it first.
    pub fn delete_harness(&self, id: &str) -> Result<bool> {
        let deleted = self
            .conn
            .execute("DELETE FROM harnesses WHERE id = ?1", params![id])?;
        Ok(deleted > 0)
    }

    /// Point a project at a harness, replacing any previous selection.
    pub fn set_active_harness(&self, project_id: &str, harness_id: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO active_harness (project_id, harness_id) VALUES (?1, ?2) \
             ON CONFLICT(project_id) DO UPDATE SET harness_id = excluded.harness_id",
            params![project_id, harness_id],
        )?;
        Ok(())
    }

    /// The harness a project is currently running with, if one was selected.
    pub fn get_active_harness(&self, project_id: &str) -> Result<Option<String>> {
        let harness_id = self
            .conn
            .query_row(
                "SELECT harness_id FROM active_harness WHERE project_id = ?1",
                params![project_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(harness_id)
    }

    /// Clear a project's harness selection, answering whether there was one.
    pub fn clear_active_harness(&self, project_id: &str) -> Result<bool> {
        let deleted = self.conn.execute(
            "DELETE FROM active_harness WHERE project_id = ?1",
            params![project_id],
        )?;
        Ok(deleted > 0)
    }

    // ---------------------------------------------------------------- skills

    /// Insert or replace one skill, keyed by its id.
    pub fn save_skill(&self, skill: &StoredSkill) -> Result<()> {
        self.conn.execute(
            "INSERT INTO skills (id, name, description, source, license, content, enabled, tags_json) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) \
             ON CONFLICT(id) DO UPDATE SET \
             name = excluded.name, description = excluded.description, source = excluded.source, \
             license = excluded.license, content = excluded.content, enabled = excluded.enabled, \
             tags_json = excluded.tags_json",
            params![
                skill.id,
                skill.name,
                skill.description,
                skill.source,
                skill.license,
                skill.content,
                i64::from(skill.enabled),
                skill.tags_json,
            ],
        )?;
        Ok(())
    }

    /// One skill by id.
    pub fn load_skill(&self, id: &str) -> Result<Option<StoredSkill>> {
        let row = self
            .conn
            .query_row(
                "SELECT id, name, description, source, license, content, enabled, tags_json \
                 FROM skills WHERE id = ?1",
                params![id],
                stored_skill_from_row,
            )
            .optional()?;
        Ok(row)
    }

    /// Every skill, by name, whether enabled or not.
    pub fn load_skills(&self) -> Result<Vec<StoredSkill>> {
        let mut statement = self.conn.prepare(
            "SELECT id, name, description, source, license, content, enabled, tags_json \
             FROM skills ORDER BY name ASC, id ASC",
        )?;
        let rows = statement
            .query_map([], stored_skill_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Delete one skill row, answering whether there was one.
    pub fn delete_skill(&self, id: &str) -> Result<bool> {
        let deleted = self
            .conn
            .execute("DELETE FROM skills WHERE id = ?1", params![id])?;
        Ok(deleted > 0)
    }

    /// Flip a skill's enabled flag, answering with the new state, or `None`
    /// when no such skill exists.
    pub fn toggle_skill(&self, id: &str) -> Result<Option<bool>> {
        let changed = self.conn.execute(
            "UPDATE skills SET enabled = 1 - enabled WHERE id = ?1",
            params![id],
        )?;
        if changed == 0 {
            return Ok(None);
        }
        let enabled = self.load_skill(id)?.map(|skill| skill.enabled);
        Ok(enabled)
    }

    // --------------------------------------------------------------- plugins

    /// Insert or replace one plugin pack, keyed by its id.
    pub fn save_plugin(&self, plugin: &StoredPlugin) -> Result<()> {
        self.conn.execute(
            "INSERT INTO plugins (id, name, description, transport, command, args_json, \
             env_json, enabled, tools_json, source) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) \
             ON CONFLICT(id) DO UPDATE SET \
             name = excluded.name, description = excluded.description, transport = excluded.transport, \
             command = excluded.command, args_json = excluded.args_json, env_json = excluded.env_json, \
             enabled = excluded.enabled, tools_json = excluded.tools_json, source = excluded.source",
            params![
                plugin.id,
                plugin.name,
                plugin.description,
                plugin.transport,
                plugin.command,
                plugin.args_json,
                plugin.env_json,
                i64::from(plugin.enabled),
                plugin.tools_json,
                plugin.source,
            ],
        )?;
        Ok(())
    }

    /// One plugin by id.
    pub fn load_plugin(&self, id: &str) -> Result<Option<StoredPlugin>> {
        let row = self
            .conn
            .query_row(
                "SELECT id, name, description, transport, command, args_json, env_json, \
                 enabled, tools_json, source FROM plugins WHERE id = ?1",
                params![id],
                stored_plugin_from_row,
            )
            .optional()?;
        Ok(row)
    }

    /// Every plugin pack, by name, whether enabled or not.
    pub fn load_plugins(&self) -> Result<Vec<StoredPlugin>> {
        let mut statement = self.conn.prepare(
            "SELECT id, name, description, transport, command, args_json, env_json, enabled, \
             tools_json, source FROM plugins ORDER BY name ASC, id ASC",
        )?;
        let rows = statement
            .query_map([], stored_plugin_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Delete one plugin row, answering whether there was one.
    pub fn delete_plugin(&self, id: &str) -> Result<bool> {
        let deleted = self
            .conn
            .execute("DELETE FROM plugins WHERE id = ?1", params![id])?;
        Ok(deleted > 0)
    }

    /// Flip a plugin's enabled flag, answering with the new state, or `None`
    /// when no such plugin exists.
    pub fn toggle_plugin(&self, id: &str) -> Result<Option<bool>> {
        let changed = self.conn.execute(
            "UPDATE plugins SET enabled = 1 - enabled WHERE id = ?1",
            params![id],
        )?;
        if changed == 0 {
            return Ok(None);
        }
        let enabled = self.load_plugin(id)?.map(|plugin| plugin.enabled);
        Ok(enabled)
    }

    // --------------------------------------------------------- custom models

    /// Insert or replace one custom model, keyed by `(provider, model_id)`.
    pub fn save_custom_model(&self, model: &StoredCustomModel) -> Result<()> {
        self.conn.execute(
            "INSERT INTO custom_models (provider, model_id, display_name, context_window, enabled) \
             VALUES (?1, ?2, ?3, ?4, ?5) \
             ON CONFLICT(provider, model_id) DO UPDATE SET \
             display_name = excluded.display_name, context_window = excluded.context_window, \
             enabled = excluded.enabled",
            params![
                model.provider,
                model.model_id,
                model.display_name,
                model.context_window.map(i64::from),
                i64::from(model.enabled),
            ],
        )?;
        Ok(())
    }

    /// One custom model by provider and model id.
    pub fn load_custom_model(
        &self,
        provider: &str,
        model_id: &str,
    ) -> Result<Option<StoredCustomModel>> {
        let row = self
            .conn
            .query_row(
                "SELECT provider, model_id, display_name, context_window, enabled \
                 FROM custom_models WHERE provider = ?1 AND model_id = ?2",
                params![provider, model_id],
                stored_custom_model_from_row,
            )
            .optional()?;
        Ok(row)
    }

    /// Every custom model, by provider then model id.
    pub fn load_custom_models(&self) -> Result<Vec<StoredCustomModel>> {
        let mut statement = self.conn.prepare(
            "SELECT provider, model_id, display_name, context_window, enabled FROM custom_models \
             ORDER BY provider ASC, model_id ASC",
        )?;
        let rows = statement
            .query_map([], stored_custom_model_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Delete one custom model, answering whether there was one.
    pub fn delete_custom_model(&self, provider: &str, model_id: &str) -> Result<bool> {
        let deleted = self.conn.execute(
            "DELETE FROM custom_models WHERE provider = ?1 AND model_id = ?2",
            params![provider, model_id],
        )?;
        Ok(deleted > 0)
    }

    /// Flip a custom model's enabled flag, answering with the new state, or
    /// `None` when no such model exists.
    pub fn toggle_custom_model(&self, provider: &str, model_id: &str) -> Result<Option<bool>> {
        let changed = self.conn.execute(
            "UPDATE custom_models SET enabled = 1 - enabled WHERE provider = ?1 AND model_id = ?2",
            params![provider, model_id],
        )?;
        if changed == 0 {
            return Ok(None);
        }
        let enabled = self
            .load_custom_model(provider, model_id)?
            .map(|model| model.enabled);
        Ok(enabled)
    }

    // ------------------------------------------------------------ integrations

    /// Insert or replace one integration row.
    ///
    /// A save with `config_json: None` keeps the config the row already had —
    /// a connection check updates status without rewriting credentials.
    pub fn save_integration(
        &self,
        integration: &StoredIntegration,
        config_json: Option<&str>,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO integrations (id, name, connected, config_json, configured_at) \
             VALUES (?1, ?2, ?3, ?4, ?5) \
             ON CONFLICT(id) DO UPDATE SET \
             name = excluded.name, connected = excluded.connected, \
             config_json = COALESCE(?6, integrations.config_json), \
             configured_at = COALESCE(?5, integrations.configured_at)",
            params![
                integration.id,
                integration.name,
                i64::from(integration.connected),
                integration.config_json,
                integration
                    .configured_at
                    .map(|value| sql_int(value, "integrations.configured_at"))
                    .transpose()?,
                config_json,
            ],
        )?;
        Ok(())
    }

    /// One integration by id.
    pub fn load_integration(&self, id: &str) -> Result<Option<StoredIntegration>> {
        let row = self
            .conn
            .query_row(
                "SELECT id, name, connected, config_json, configured_at FROM integrations \
                 WHERE id = ?1",
                params![id],
                stored_integration_from_row,
            )
            .optional()?;
        Ok(row)
    }

    /// Every integration, by name.
    pub fn load_integrations(&self) -> Result<Vec<StoredIntegration>> {
        let mut statement = self.conn.prepare(
            "SELECT id, name, connected, config_json, configured_at FROM integrations \
             ORDER BY name ASC, id ASC",
        )?;
        let rows = statement
            .query_map([], stored_integration_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Delete one integration row, answering whether there was one.
    pub fn delete_integration(&self, id: &str) -> Result<bool> {
        let deleted = self
            .conn
            .execute("DELETE FROM integrations WHERE id = ?1", params![id])?;
        Ok(deleted > 0)
    }

    /// Read the journal mode back and refuse anything that is not WAL.
    fn ensure_wal(&self) -> Result<()> {
        let mode: String = self
            .conn
            .query_row("PRAGMA journal_mode;", [], |row| row.get(0))?;
        if mode.eq_ignore_ascii_case("wal") {
            Ok(())
        } else {
            Err(StoreError::WalNotEnabled(mode))
        }
    }
}

/// A `u64` as the `INTEGER` SQLite stores, without wrapping a corrupt value into
/// a negative one.
fn sql_int(value: u64, field: &'static str) -> Result<i64> {
    i64::try_from(value).map_err(|_| StoreError::CorruptId {
        field,
        value: value.to_string(),
    })
}

/// A stored `INTEGER` read back as a `u32`; a negative or oversized value is
/// corrupt data, not something to clamp.
fn unsigned_u32(value: i64, field: &'static str) -> Result<u32> {
    u32::try_from(value).map_err(|_| StoreError::CorruptId {
        field,
        value: value.to_string(),
    })
}

/// A stored `INTEGER` read back as a `u64`.
fn unsigned_u64(value: i64, field: &'static str) -> Result<u64> {
    u64::try_from(value).map_err(|_| StoreError::CorruptId {
        field,
        value: value.to_string(),
    })
}

/// One `providers` row, in the column order both provider queries select.
///
/// `rusqlite` reads the `INTEGER` columns back as `bool` and `u64` directly, so a
/// negative or oversized stored value is an error rather than something to clamp.
fn stored_provider_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredProvider> {
    Ok(StoredProvider {
        name: row.get(0)?,
        kind: row.get(1)?,
        api_base: row.get(2)?,
        enabled: row.get(3)?,
        created_at: row.get(4)?,
    })
}

/// One `harnesses` row, in the column order both harness queries select.
fn stored_harness_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredHarness> {
    Ok(StoredHarness {
        id: row.get(0)?,
        version: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        data_json: row.get(4)?,
        is_preset: row.get(5)?,
        created_at: row.get(6)?,
    })
}

/// One `skills` row, in the column order both skill queries select.
fn stored_skill_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredSkill> {
    Ok(StoredSkill {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        source: row.get(3)?,
        license: row.get(4)?,
        content: row.get(5)?,
        enabled: row.get(6)?,
        tags_json: row.get(7)?,
    })
}

/// One `plugins` row, in the column order both plugin queries select.
fn stored_plugin_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredPlugin> {
    Ok(StoredPlugin {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        transport: row.get(3)?,
        command: row.get(4)?,
        args_json: row.get(5)?,
        env_json: row.get(6)?,
        enabled: row.get(7)?,
        tools_json: row.get(8)?,
        source: row.get(9)?,
    })
}

/// One `custom_models` row, in the column order both model queries select.
///
/// `context_window` is read back through an `i64` so a negative or oversized
/// stored value is reported as corrupt data rather than clamped.
fn stored_custom_model_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredCustomModel> {
    let context_window: Option<i64> = row.get(3)?;
    let context_window = match context_window {
        Some(value) => Some(
            u32::try_from(value).map_err(|_| rusqlite::Error::IntegralValueOutOfRange(3, value))?,
        ),
        None => None,
    };
    Ok(StoredCustomModel {
        provider: row.get(0)?,
        model_id: row.get(1)?,
        display_name: row.get(2)?,
        context_window,
        enabled: row.get(4)?,
    })
}

/// One `integrations` row, in the column order both integration queries select.
fn stored_integration_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredIntegration> {
    Ok(StoredIntegration {
        id: row.get(0)?,
        name: row.get(1)?,
        connected: row.get(2)?,
        config_json: row.get(3)?,
        configured_at: row.get(4)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;

    /// A fresh temp directory for one test's workspace.
    ///
    /// Prefers cargo's `CARGO_TARGET_TMPDIR`, then a `tmp` sibling of the test
    /// binary's `deps` directory (the target dir is writable wherever the build
    /// ran), and only then the system temp dir — which on some Windows machines is
    /// protected and rejects even creating a tempdir (`Access is denied`).
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

    /// A store on a fresh temporary file, with the schema applied.
    ///
    /// The directory is returned so it outlives the connection: the tuple drops
    /// the store first.
    fn temp_store() -> (SqliteStore, tempfile::TempDir) {
        let dir = fresh_tempdir();
        let path = dir.path().join("warsha.db");
        let store = SqliteStore::open(&path.to_string_lossy()).expect("the store opens");
        store.migrate().expect("the schema is applied");
        (store, dir)
    }

    fn preference(
        key: &str,
        score: f64,
        evidence_count: u32,
        last_updated: u64,
    ) -> StoredPreference {
        StoredPreference {
            project_id: "project-1".to_string(),
            key: key.to_string(),
            score,
            evidence_count,
            last_updated,
        }
    }

    #[test]
    fn open_creates_the_database_file_in_wal_mode() {
        let dir = fresh_tempdir();
        let path = dir.path().join("nested").join("warsha.db");
        // The directory is the caller's to create — that is documented.
        std::fs::create_dir_all(path.parent().expect("the path has a parent"))
            .expect("the directory is created");
        assert!(!path.exists());

        let store = SqliteStore::open(&path.to_string_lossy()).expect("the store opens");

        assert!(path.exists(), "open must create the database file");
        let mode: String = store
            .connection()
            .query_row("PRAGMA journal_mode;", [], |row| row.get(0))
            .expect("journal_mode is readable");
        assert_eq!(mode.to_lowercase(), "wal");
        // Nothing is created until `migrate` runs: open only opens.
        assert!(store.tables().expect("the schema is readable").is_empty());
    }

    #[test]
    fn open_refuses_a_blank_path() {
        assert!(matches!(
            SqliteStore::open("   "),
            Err(StoreError::InvalidPath(path)) if path == "   "
        ));
    }

    #[test]
    fn migrate_creates_the_settings_tables_and_is_idempotent() {
        let dir = fresh_tempdir();
        let path = dir.path().join("warsha.db");
        let store = SqliteStore::open(&path.to_string_lossy()).expect("the store opens");

        store.migrate().expect("the first migration runs");
        assert_eq!(
            store.tables().expect("the schema is readable"),
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
        store.migrate().expect("the second migration is a no-op");
        assert_eq!(store.tables().expect("the schema is readable").len(), 11);
    }

    #[test]
    fn wal_mode_survives_a_reopen() {
        let dir = fresh_tempdir();
        let path = dir.path().join("warsha.db");
        let opened = path.to_string_lossy().into_owned();

        let first = SqliteStore::open(&opened).expect("the first open");
        first.migrate().expect("the schema is applied");
        first
            .save_preference(&preference("dark mode", 2.0, 3, 1_700_000_000))
            .expect("the row is written");
        drop(first);

        let second = SqliteStore::open(&opened).expect("the second open");
        let mode: String = second
            .connection()
            .query_row("PRAGMA journal_mode;", [], |row| row.get(0))
            .expect("journal_mode is readable");
        assert_eq!(mode.to_lowercase(), "wal");
        // The rows written in WAL mode are there after a reopen.
        assert_eq!(
            second
                .load_preferences("project-1")
                .expect("the rows are readable")
                .len(),
            1
        );
    }

    #[test]
    fn save_and_load_a_preference_round_trip() {
        let (store, _dir) = temp_store();
        let saved = preference("dark mode", 2.25, 3, 1_700_000_000);
        store.save_preference(&saved).expect("the row is written");

        let loaded = store
            .load_preferences("project-1")
            .expect("the rows are readable");
        assert_eq!(loaded, vec![saved.clone()]);
        // Another project sees nothing.
        assert!(store
            .load_preferences("project-2")
            .expect("the rows are readable")
            .is_empty());
    }

    #[test]
    fn preferences_load_by_score_then_key() {
        let (store, _dir) = temp_store();
        for (key, score) in [("tone", 1.0), ("dark mode", 3.0), ("layout", 1.0)] {
            store
                .save_preference(&preference(key, score, 1, 1_700_000_000))
                .expect("the row is written");
        }

        let keys: Vec<String> = store
            .load_preferences("project-1")
            .expect("the rows are readable")
            .into_iter()
            .map(|row| row.key)
            .collect();
        assert_eq!(keys, vec!["dark mode", "layout", "tone"]);
    }

    #[test]
    fn saving_the_same_preference_replaces_the_row() {
        let (store, _dir) = temp_store();
        store
            .save_preference(&preference("dark mode", 1.0, 1, 1_700_000_000))
            .expect("the first write");
        store
            .save_preference(&preference("dark mode", 4.0, 2, 1_700_000_900))
            .expect("the second write");

        let loaded = store
            .load_preferences("project-1")
            .expect("the rows are readable");
        assert_eq!(loaded.len(), 1, "the key is unique per project");
        assert!((loaded[0].score - 4.0).abs() < 1e-9);
        assert_eq!(loaded[0].evidence_count, 2);
        assert_eq!(loaded[0].last_updated, 1_700_000_900);
    }

    #[test]
    fn save_and_load_a_backend_kit_round_trip() {
        let (store, _dir) = temp_store();
        assert_eq!(
            store.load_backend_kit("project-1").expect("the read works"),
            None
        );

        let kit = StoredBackendKit {
            project_id: "project-1".to_string(),
            kind: "pocket_base".to_string(),
            url: "http://127.0.0.1:8090".to_string(),
            config_json: r#"{"config":{"kind":"pocket_base"}}"#.to_string(),
        };
        store.save_backend_kit(&kit).expect("the row is written");
        assert_eq!(
            store.load_backend_kit("project-1").expect("the read works"),
            Some(kit)
        );

        // A second save replaces the row for that project.
        let updated = StoredBackendKit {
            project_id: "project-1".to_string(),
            kind: "supabase".to_string(),
            url: "http://localhost:54321".to_string(),
            config_json: r#"{"config":{"kind":"supabase"}}"#.to_string(),
        };
        store.save_backend_kit(&updated).expect("the second write");
        let loaded = store
            .load_backend_kit("project-1")
            .expect("the read works")
            .expect("the row exists");
        assert_eq!(loaded.kind, "supabase");
        assert_eq!(loaded.url, "http://localhost:54321");
    }

    #[test]
    fn save_and_load_a_run_mode_round_trip() {
        let (store, _dir) = temp_store();
        assert_eq!(store.load_run_mode("hosted").expect("the read works"), None);

        let config = StoredRunMode {
            mode: "hosted".to_string(),
            config_json: r#"{"mode":"hosted","bind_host":"127.0.0.1"}"#.to_string(),
        };
        store.save_run_mode(&config).expect("the row is written");
        assert_eq!(
            store.load_run_mode("hosted").expect("the read works"),
            Some(config)
        );

        // The mode tag is the key, so a second save overwrites.
        let replaced = StoredRunMode {
            mode: "hosted".to_string(),
            config_json: r#"{"mode":"hosted","bind_host":"localhost"}"#.to_string(),
        };
        store.save_run_mode(&replaced).expect("the second write");
        let loaded = store
            .load_run_mode("hosted")
            .expect("the read works")
            .expect("the row exists");
        assert_eq!(loaded.config_json, replaced.config_json);
        assert_eq!(store.load_run_mode("local").expect("the read works"), None);
    }

    #[test]
    fn save_and_load_pairings_keeps_revoked_rows() {
        let (store, _dir) = temp_store();
        assert!(store.load_pairings().expect("the read works").is_empty());

        let first = StoredPairing {
            device_id: "device-1".to_string(),
            secret: "one-time-secret".to_string(),
            created_at: 1_700_000_000,
            revoked: false,
        };
        let second = StoredPairing {
            device_id: "device-2".to_string(),
            secret: "another-secret".to_string(),
            created_at: 1_700_000_100,
            revoked: true,
        };
        store.save_pairing(&first).expect("the first row");
        store.save_pairing(&second).expect("the second row");

        assert_eq!(
            store.load_pairings().expect("the read works"),
            vec![first.clone(), second.clone()]
        );

        // Revoking rewrites the row instead of dropping it.
        let revoked = StoredPairing {
            revoked: true,
            ..first
        };
        store.save_pairing(&revoked).expect("the revoke lands");
        let listed = store.load_pairings().expect("the read works");
        assert_eq!(listed.len(), 2);
        assert!(listed[0].revoked);
        assert_eq!(listed[0].secret, "one-time-secret");
    }

    #[test]
    fn debug_redacts_the_pairing_secret() {
        let pairing = StoredPairing {
            device_id: "device-1".to_string(),
            secret: "super-secret-value".to_string(),
            created_at: 42,
            revoked: false,
        };
        let rendered = format!("{pairing:?}");
        assert!(rendered.contains("device-1"));
        assert!(rendered.contains(REDACTED_SECRET));
        assert!(!rendered.contains("super-secret-value"));
    }

    #[test]
    fn provider_crud_round_trips_through_the_store() {
        let (store, _dir) = temp_store();

        // Empty at start.
        assert!(store.load_providers().expect("providers load").is_empty());
        assert_eq!(
            store.load_provider("open_router").expect("load single"),
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

        store.save_provider(&openrouter).expect("openrouter stored");
        store.save_provider(&custom).expect("custom stored");

        // Both return in creation order.
        let list = store.load_providers().expect("providers load");
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "open_router");
        assert_eq!(list[1].name, "my-llm");

        // Single lookup works.
        let single = store.load_provider("open_router").expect("single load");
        assert_eq!(single, Some(openrouter.clone()));

        // Update of kind / api_base preserves created_at.
        let updated = StoredProvider {
            name: "open_router".to_string(),
            kind: "open_router".to_string(),
            api_base: Some("https://openrouter.example.com/v1".to_string()),
            enabled: false,
            created_at: 1_800_000_000, // ignored by the ON CONFLICT DO UPDATE
        };
        store.save_provider(&updated).expect("update stored");
        let reloaded = store.load_provider("open_router").expect("reload");
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
        assert!(store.delete_provider("open_router").expect("delete"));
        assert!(!store.delete_provider("open_router").expect("delete again"));
        assert_eq!(
            store
                .load_provider("open_router")
                .expect("load after delete"),
            None
        );
        assert_eq!(store.load_providers().expect("remaining").len(), 1);
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

    #[test]
    fn harness_crud_and_active_selection_round_trip() {
        let (store, _dir) = temp_store();
        assert!(store.load_harnesses().expect("list").is_empty());
        assert_eq!(store.load_harness("solo").expect("get"), None);

        store
            .save_harness(&harness("solo", true, 1_700_000_000))
            .expect("save");
        store
            .save_harness(&harness("factory", false, 1_700_000_100))
            .expect("save");

        let list = store.load_harnesses().expect("list");
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
        store.save_harness(&updated).expect("re-save");
        let loaded = store
            .load_harness("solo")
            .expect("get")
            .expect("row exists");
        assert_eq!(loaded.created_at, 1_700_000_000);
        assert_eq!(loaded.data_json, updated.data_json);

        // Active selection is per project and replaceable.
        store
            .set_active_harness("project-1", "solo")
            .expect("set active");
        assert_eq!(
            store
                .get_active_harness("project-1")
                .expect("get active")
                .as_deref(),
            Some("solo")
        );
        store
            .set_active_harness("project-1", "factory")
            .expect("repoint");
        assert_eq!(
            store
                .get_active_harness("project-1")
                .expect("get active")
                .as_deref(),
            Some("factory")
        );
        assert_eq!(store.get_active_harness("project-2").expect("unset"), None);
        assert!(store.clear_active_harness("project-1").expect("clear"));
        assert!(!store
            .clear_active_harness("project-1")
            .expect("clear again"));

        assert!(store.delete_harness("solo").expect("delete"));
        assert!(!store.delete_harness("solo").expect("delete again"));
        assert_eq!(store.load_harnesses().expect("remaining").len(), 1);
    }

    #[test]
    fn skill_crud_and_toggle_round_trip() {
        let (store, _dir) = temp_store();
        assert!(store.load_skills().expect("list").is_empty());

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
        store.save_skill(&skill).expect("save");
        assert_eq!(
            store.load_skill(skill.id.as_str()).expect("get"),
            Some(skill.clone())
        );

        let other = StoredSkill {
            id: "mcp-builder".to_string(),
            name: "MCP Builder".to_string(),
            source: "github.com/anthropics/skills".to_string(),
            license: "Apache-2.0".to_string(),
            ..skill
        };
        store.save_skill(&other).expect("save other");

        // Ordered by name: "MCP Builder" sorts before "Test-Driven Development".
        let list = store.load_skills().expect("list");
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "mcp-builder");

        assert_eq!(
            store.toggle_skill("mcp-builder").expect("toggle"),
            Some(false)
        );
        assert_eq!(
            store.toggle_skill("mcp-builder").expect("toggle back"),
            Some(true)
        );
        assert_eq!(store.toggle_skill("missing").expect("toggle miss"), None);

        assert!(store.delete_skill("mcp-builder").expect("delete"));
        assert!(!store.delete_skill("mcp-builder").expect("delete again"));
    }

    #[test]
    fn plugin_crud_and_toggle_round_trip() {
        let (store, _dir) = temp_store();
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
        store.save_plugin(&plugin).expect("save");
        assert_eq!(store.load_plugin("github-mcp").expect("get"), Some(plugin));

        let http_pack = StoredPlugin {
            id: "remote-pack".to_string(),
            command: None,
            transport: "http".to_string(),
            enabled: false,
            ..plugin_styled_base()
        };
        store.save_plugin(&http_pack).expect("save http");
        assert_eq!(store.load_plugins().expect("list").len(), 2);

        assert_eq!(
            store.toggle_plugin("remote-pack").expect("toggle"),
            Some(true)
        );
        assert!(store.delete_plugin("remote-pack").expect("delete"));
        assert!(!store.delete_plugin("remote-pack").expect("delete again"));
    }

    /// A base plugin row for struct-update literals in the plugin test.
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

    #[test]
    fn custom_model_crud_and_toggle_round_trip() {
        let (store, _dir) = temp_store();
        let model = StoredCustomModel {
            provider: "open_router".to_string(),
            model_id: "qwen/qwen3-coder".to_string(),
            display_name: Some("Qwen Coder".to_string()),
            context_window: Some(262_144),
            enabled: true,
        };
        store.save_custom_model(&model).expect("save");
        assert_eq!(
            store
                .load_custom_model("open_router", "qwen/qwen3-coder")
                .expect("get"),
            Some(model.clone())
        );
        assert_eq!(
            store
                .load_custom_model("open_router", "absent")
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
        store.save_custom_model(&bare).expect("save bare");
        assert_eq!(store.load_custom_models().expect("list").len(), 2);

        assert_eq!(
            store
                .toggle_custom_model("open_router", "raw/model")
                .expect("toggle"),
            Some(true)
        );
        assert_eq!(
            store
                .toggle_custom_model("open_router", "missing")
                .expect("miss"),
            None
        );
        assert!(store
            .delete_custom_model("open_router", "raw/model")
            .expect("delete"));
        assert!(!store
            .delete_custom_model("open_router", "raw/model")
            .expect("delete again"));
    }

    #[test]
    fn integration_crud_round_trip() {
        let (store, _dir) = temp_store();
        let integration = StoredIntegration {
            id: "github".to_string(),
            name: "GitHub".to_string(),
            connected: false,
            config_json: r#"{"org":"warsha"}"#.to_string(),
            configured_at: Some(1_700_000_000),
        };
        store.save_integration(&integration, None).expect("save");
        assert_eq!(
            store.load_integration("github").expect("get"),
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
            .expect("status save");
        let reloaded = store.load_integration("github").expect("get").expect("row");
        assert!(reloaded.connected);
        assert_eq!(reloaded.config_json, integration.config_json);
        assert_eq!(reloaded.configured_at, integration.configured_at);

        store
            .save_integration(&connected, Some(r#"{"org":"warsha","channel":"dev"}"#))
            .expect("config save");
        let reloaded = store.load_integration("github").expect("get").expect("row");
        assert_eq!(reloaded.config_json, r#"{"org":"warsha","channel":"dev"}"#);

        assert_eq!(store.load_integrations().expect("list").len(), 1);
        assert!(store.delete_integration("github").expect("delete"));
        assert!(!store.delete_integration("github").expect("delete again"));
    }
}
