//! Warsha Store — SQLite persistence layer with migrations.
//!
//! Uses runtime `sqlx` queries (no compile-time `DATABASE_URL` requirement) and
//! stores identifiers as their text/byte encodings described in
//! `migrations/001_initial.sql`.
//!
//! The M20 settings-shaped rows (taste preferences, backend kits, run modes,
//! phone pairings and the rest of the Wave 2 records) live in the `settings`
//! module: [`SettingsRepo`], the same `sqlx` pool, and migration
//! `006_settings.sql`. One file, one SQLite API, one native stack — the rules
//! both halves used to need (WAL, a busy timeout, one migration owner) are the
//! store's rules now.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::migrate::MigrateDatabase;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;
use thiserror::Error;
use tokio::sync::broadcast;
use tracing::info;
use ulid::Ulid;
use uuid::Uuid;
use warsha_core::{
    ApprovalMode, Artifact, Confinement, DeviceId, Event, EventKind, GateState, Project, ProjectId,
    ProjectPermissions, Role, Run, RunId, RunStatus, Session, SessionId, SessionStatus, Stage,
    TokenUsage,
};

mod settings;

pub use settings::{
    SettingsRepo, StoredBackendKit, StoredCustomModel, StoredHarness, StoredIntegration,
    StoredPairing, StoredPlugin, StoredPreference, StoredProvider, StoredRunMode, StoredSkill,
};

/// Errors raised by the persistence layer.
#[derive(Debug, Error)]
pub enum StoreError {
    #[error("parse error for {0}: {1}")]
    ParseError(&'static str, String),
    /// Underlying database failure.
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    /// Migration failure.
    #[error("migration error: {0}")]
    Migration(String),
    /// No configuration directory available for the current user.
    #[error("config directory not found")]
    ConfigDirNotFound,
    /// JSON encoding/decoding failure.
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    /// Filesystem failure when reading or writing artifacts.
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    /// Project lookup miss.
    #[error("project not found: {0}")]
    ProjectNotFound(ProjectId),
    /// Run lookup miss.
    #[error("run not found: {0}")]
    RunNotFound(RunId),
    /// Optimistic concurrency conflict: the run was modified concurrently.
    #[error("version conflict on run {run_id}: expected version {expected}, actual {actual}")]
    VersionConflict {
        run_id: RunId,
        expected: u64,
        actual: u64,
    },
    /// Gate lookup miss.
    #[error("gate not found: {0}")]
    GateNotFound(Ulid),
    /// Artifact lookup miss.
    #[error("artifact not found: {0}")]
    ArtifactNotFound(Ulid),
    /// A stored identifier could not be decoded.
    #[error("corrupt identifier for {field}: {value}")]
    CorruptId {
        /// Column that held the identifier.
        field: &'static str,
        /// Raw value read from the database.
        value: String,
    },
    /// A stored column had an unexpected SQL type.
    #[error("unexpected column type for {0}")]
    UnexpectedType(&'static str),
    /// The path handed to [`SettingsRepo::open`] is unusable.
    #[error("invalid database path: {0}")]
    InvalidPath(String),
    /// The database did not end up in WAL mode, so the store refused it.
    #[error("journal mode was not WAL: {0}")]
    WalNotEnabled(String),
}

/// Convenience result alias for the store.
pub type Result<T> = std::result::Result<T, StoreError>;

/// A gate decision recorded for one stage of a run.
///
/// `state` holds the structured decision; the flat columns mirror whatever the
/// current state carries so decisions stay queryable without decoding JSON.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Gate {
    /// Gate identifier.
    pub id: Ulid,
    /// Run the gate belongs to.
    pub run_id: RunId,
    /// Stage the gate guards.
    pub stage: Stage,
    /// Current state of the gate.
    pub state: GateState,
    /// Device that took the decision, when one has been taken.
    pub decided_by_device_id: Option<DeviceId>,
    /// Rejection reason, when the gate was rejected.
    pub reason: Option<String>,
    /// Notes carried by a changes-requested decision.
    pub notes: Option<String>,
    /// When the decision was taken.
    pub decided_at: Option<DateTime<Utc>>,
    /// Row creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Row update timestamp.
    pub updated_at: DateTime<Utc>,
}

/// An index row pointing at an artifact's stored content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactRecord {
    /// Artifact identifier.
    pub id: Ulid,
    /// Run that produced the artifact.
    pub run_id: RunId,
    /// Project that owns the artifact.
    pub project_id: ProjectId,
    /// Artifact name within the run.
    pub name: String,
    /// Artifact kind, such as `markdown` or `patch`.
    pub kind: String,
    /// Path to the artifact's stored content.
    pub content_path: String,
    /// Content hash, when one was recorded.
    pub sha256: Option<String>,
    /// Row creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Row update timestamp.
    pub updated_at: DateTime<Utc>,
}

/// One model call's token usage and cost within a run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CostRecord {
    /// Cost row identifier.
    pub id: Ulid,
    /// Run the cost was incurred by.
    pub run_id: RunId,
    /// Project that owns the run.
    pub project_id: ProjectId,
    /// Agent role that spent the tokens, when one was attributed.
    pub agent_role: Option<Role>,
    /// Provider that served the call.
    pub provider_id: String,
    /// Model that served the call.
    pub model_id: String,
    /// Prompt tokens consumed.
    pub prompt_tokens: u64,
    /// Completion tokens produced.
    pub completion_tokens: u64,
    /// Cache read tokens consumed.
    pub cache_read_tokens: u64,
    /// Cache write tokens produced.
    pub cache_write_tokens: u64,
    /// Source of cost data.
    pub source: String,
    /// Whether cost is estimated.
    pub estimated: bool,
    /// Whether cost is known.
    pub cost_known: bool,
    /// Duration in milliseconds.
    pub duration_ms: Option<u64>,
    /// Session identifier.
    pub session_id: Option<String>,
    /// Cost in cents.
    pub cost_cents: u64,
    /// Row creation timestamp.
    pub created_at: DateTime<Utc>,
}

impl CostRecord {
    /// TPS accessor: completion_tokens / duration_ms (estimated)
    pub fn estimated_tps(&self) -> Option<f64> {
        let duration_ms = self.duration_ms?;
        if duration_ms == 0 {
            return None;
        }
        Some(self.completion_tokens as f64 / (duration_ms as f64 / 1000.0))
    }
}

/// Thin wrapper around a SQLite connection pool.
///
/// The store also owns the live event bus: every [`Store::append_event`] that
/// commits publishes the same [`Event`] on it. Producers reach the stream
/// through the write, never beside it, so no caller can persist an event and
/// forget to broadcast it.
pub struct Store {
    pool: SqlitePool,
    db_path: PathBuf,
    event_tx: broadcast::Sender<Event>,
}

/// How many events a subscriber may fall behind before the bus drops its oldest.
///
/// One burst of a full run's stage output is well under this; the number bounds
/// what a slow socket costs the daemon in buffered events, not what a run may
/// produce.
const EVENT_BUS_CAPACITY: usize = 1024;

impl Store {
    /// Open (creating if necessary) the default database beneath the user's config dir.
    pub async fn new() -> Result<Self> {
        let config_dir = dirs::config_dir()
            .ok_or(StoreError::ConfigDirNotFound)?
            .join("warsha");
        std::fs::create_dir_all(&config_dir)?;
        Self::open_at(config_dir.join("warsha.db")).await
    }

    /// Open (creating if necessary) a database at an explicit path.
    pub async fn open_at(db_path: PathBuf) -> Result<Self> {
        let db_url = format!("sqlite://{}?mode=rwc", db_path.display());
        if !sqlx::Sqlite::database_exists(&db_url)
            .await
            .unwrap_or(false)
        {
            info!("creating database at {}", db_path.display());
            sqlx::Sqlite::create_database(&db_url)
                .await
                .map_err(|e| StoreError::Migration(e.to_string()))?;
        }
        // Foreign keys are enforced per connection; without this the
        // `ON DELETE CASCADE` clauses in the migrations never fire.
        //
        // WAL and the five-second busy timeout are the settings repository's
        // promises too (`SettingsRepo::open`): one file, read by the daemon's
        // settings calls and written by its run handlers, so a reader must not
        // block the writer and a short lock must wait rather than fail the call.
        let options = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(5));
        let pool = SqlitePoolOptions::new().connect_with(options).await?;
        Self::run_migrations(&pool).await?;
        // The bus outlives every subscriber: the receiver here is deliberately
        // dropped, so `send` reports "no receivers" while nobody is watching —
        // which is the normal case, not an error.
        let (event_tx, _rx) = broadcast::channel(EVENT_BUS_CAPACITY);
        Ok(Self {
            pool,
            db_path,
            event_tx,
        })
    }

    async fn run_migrations(pool: &SqlitePool) -> Result<()> {
        // Every migration in `migrations/` is applied here, in version order.
        // The pairing-expiry column used to be a separate step (005) that this
        // migrator had to skip, because the table it altered was created by the
        // synchronous settings store; 006 creates that table with the column in
        // it, so there is one owner and nothing to skip.
        migration_migrator()
            .run(pool)
            .await
            .map_err(|e| StoreError::Migration(e.to_string()))?;
        let mut transaction = pool.begin().await?;
        repair_settings_expiry(&mut transaction).await?;
        transaction.commit().await?;
        Ok(())
    }

    /// Upsert one MCP permission row (`server`, `tool`, `role`).
    ///
    /// The permission string is validated again by the table's CHECK constraint;
    /// the daemon rejects anything but `allow`/`ask`/`deny` before this call.
    pub async fn set_mcp_permission(
        &self,
        server: &str,
        tool: &str,
        role: &str,
        permission: &str,
        updated_at: &str,
    ) -> Result<()> {
        sqlx::query(
            "INSERT INTO mcp_permissions (server, tool, role, permission, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(server, tool, role)
             DO UPDATE SET permission = excluded.permission, updated_at = excluded.updated_at",
        )
        .bind(server)
        .bind(tool)
        .bind(role)
        .bind(permission)
        .bind(updated_at)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    /// Every stored MCP permission row, in key order.
    pub async fn load_mcp_permissions(&self) -> Result<Vec<(String, String, String, String)>> {
        let rows = sqlx::query_as::<_, (String, String, String, String)>(
            "SELECT server, tool, role, permission FROM mcp_permissions
             ORDER BY server, tool, role",
        )
        .fetch_all(self.pool())
        .await?;
        Ok(rows)
    }

    /// Borrow the underlying pool.
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// The settings repository over this store's pool.
    ///
    /// One pool per process, one file: the settings rows and the projects, runs
    /// and events they configure are served by the same connections, so there is
    /// no second connection story to keep in step.
    pub fn settings(&self) -> SettingsRepo {
        SettingsRepo::from_pool(self.pool.clone())
    }

    /// Path of the database file backing this store.
    pub fn db_path(&self) -> &PathBuf {
        &self.db_path
    }

    /// Attach to the live event bus: every event this store commits after the
    /// call arrives on the returned receiver. A fresh receiver starts empty;
    /// events committed before the call are read with [`Store::get_events`],
    /// not replayed here.
    pub fn subscribe_events(&self) -> broadcast::Receiver<Event> {
        self.event_tx.subscribe()
    }

    // ---------------------------------------------------------------- projects

    /// Insert a new project.
    pub async fn create_project(&self, project: &Project) -> Result<()> {
        sqlx::query(
            "INSERT INTO projects \
             (id, name, description, language, created_at, updated_at, repo_path, repo_url, confinement, approval_mode) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(project.id.0.as_bytes().to_vec())
        .bind(&project.name)
        .bind(&project.description)
        .bind(&project.language)
        .bind(project.created_at.to_rfc3339())
        .bind(project.updated_at.to_rfc3339())
        .bind(&project.repo_path)
        .bind(&project.repo_url)
        .bind(project.confinement.as_ref().map(|c| c.to_string()))
        .bind(project.approval_mode.as_ref().map(|a| a.to_string()))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Fetch a project by id.
    pub async fn get_project(&self, id: ProjectId) -> Result<Project> {
        let row = sqlx::query(
            "SELECT id, name, description, language, created_at, updated_at, repo_path, repo_url, confinement, approval_mode \
             FROM projects WHERE id = ?",
        )
        .bind(id.0.as_bytes().to_vec())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(StoreError::ProjectNotFound(id))?;
        project_from_row(&row)
    }

    /// List all projects, newest first.
    pub async fn list_projects(&self) -> Result<Vec<Project>> {
        let rows = sqlx::query(
            "SELECT id, name, description, language, created_at, updated_at, repo_path, repo_url, confinement, approval_mode \
             FROM projects ORDER BY created_at DESC",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(project_from_row).collect()
    }

    /// Update a project's mutable fields.
    pub async fn update_project(&self, project: &Project) -> Result<()> {
        sqlx::query(
            "UPDATE projects SET name = ?, description = ?, language = ?, updated_at = ?, \
             repo_path = ?, repo_url = ?, confinement = ?, approval_mode = ? WHERE id = ?",
        )
        .bind(&project.name)
        .bind(&project.description)
        .bind(&project.language)
        .bind(project.updated_at.to_rfc3339())
        .bind(&project.repo_path)
        .bind(&project.repo_url)
        .bind(project.confinement.as_ref().map(|c| c.to_string()))
        .bind(project.approval_mode.as_ref().map(|a| a.to_string()))
        .bind(project.id.0.as_bytes().to_vec())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Fetch global default project permissions.
    pub async fn get_default_permissions(&self) -> Result<ProjectPermissions> {
        self.settings().get_default_permissions().await
    }

    /// Set global default project permissions.
    pub async fn set_default_permissions(&self, permissions: &ProjectPermissions) -> Result<()> {
        self.settings().set_default_permissions(permissions).await
    }

    /// Get effective permissions for a project (override if set, else global default).
    pub async fn get_project_effective_permissions(
        &self,
        id: ProjectId,
    ) -> Result<ProjectPermissions> {
        let project = self.get_project(id).await?;
        let default = self.get_default_permissions().await?;
        Ok(project.effective_permissions(default))
    }

    /// Set explicit per-project permissions override (null clears to inherit from default).
    pub async fn set_project_permissions(
        &self,
        id: ProjectId,
        confinement: Option<Confinement>,
        approval_mode: Option<ApprovalMode>,
    ) -> Result<ProjectPermissions> {
        let mut project = self.get_project(id).await?;
        sqlx::query(
            "UPDATE projects SET confinement = ?, approval_mode = ?, updated_at = ? WHERE id = ?",
        )
        .bind(confinement.as_ref().map(|c| c.to_string()))
        .bind(approval_mode.as_ref().map(|a| a.to_string()))
        .bind(Utc::now().to_rfc3339())
        .bind(id.0.as_bytes().to_vec())
        .execute(&self.pool)
        .await?;

        project.confinement = confinement;
        project.approval_mode = approval_mode;
        let default = self.get_default_permissions().await?;
        Ok(project.effective_permissions(default))
    }

    // ------------------------------------------------------------------- runs

    /// Insert a new run.
    pub async fn create_run(&self, run: &Run) -> Result<()> {
        sqlx::query(
            "INSERT INTO runs (id, project_id, current_stage, gate_states, artifacts, \
             created_at, updated_at, status, budget_cents, spent_cents, version, \
             worktree_path, worktree_branch, confinement) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
        )
        .bind(run.id.0.to_string())
        .bind(run.project_id.0.as_bytes().to_vec())
        .bind(serde_json::to_string(&run.current_stage)?)
        .bind(serde_json::to_string(&run.gate_states)?)
        .bind(serde_json::to_string(&run.artifacts)?)
        .bind(run.created_at.to_rfc3339())
        .bind(run.updated_at.to_rfc3339())
        .bind(serde_json::to_string(&run.status)?)
        .bind(run.budget_cents.map(|v| v as i64))
        .bind(run.spent_cents as i64)
        .bind(&run.worktree_path)
        .bind(&run.worktree_branch)
        .bind(run.confinement.map(|c| c.to_string()))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Fetch a run by id.
    pub async fn get_run(&self, id: RunId) -> Result<Run> {
        let (run, _version) = self.get_run_versioned(id).await?;
        Ok(run)
    }

    /// Fetch a run by id along with its current optimistic concurrency version.
    pub async fn get_run_versioned(&self, id: RunId) -> Result<(Run, u64)> {
        let row = sqlx::query(
            "SELECT id, project_id, current_stage, gate_states, artifacts, created_at, \
             updated_at, status, budget_cents, spent_cents, version, worktree_path, \
             worktree_branch, confinement FROM runs WHERE id = ?",
        )
        .bind(id.0.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(StoreError::RunNotFound(id))?;
        let run = run_from_row(&row)?;
        let version = column_int(&row, "version")?.unsigned_abs();
        Ok((run, version))
    }

    /// Fetch a run's current optimistic concurrency version.
    pub async fn get_run_version(&self, id: RunId) -> Result<u64> {
        let row = sqlx::query("SELECT version FROM runs WHERE id = ?")
            .bind(id.0.to_string())
            .fetch_optional(&self.pool)
            .await?
            .ok_or(StoreError::RunNotFound(id))?;
        Ok(column_int(&row, "version")?.unsigned_abs())
    }

    /// Update a run's mutable fields, bumping its version.
    pub async fn update_run(&self, run: &Run) -> Result<()> {
        let outcome = sqlx::query(
            "UPDATE runs SET current_stage = ?, gate_states = ?, artifacts = ?, updated_at = ?, \
             status = ?, budget_cents = ?, spent_cents = ?, version = version + 1, \
             worktree_path = ?, worktree_branch = ?, confinement = ? WHERE id = ?",
        )
        .bind(serde_json::to_string(&run.current_stage)?)
        .bind(serde_json::to_string(&run.gate_states)?)
        .bind(serde_json::to_string(&run.artifacts)?)
        .bind(run.updated_at.to_rfc3339())
        .bind(serde_json::to_string(&run.status)?)
        .bind(run.budget_cents.map(|v| v as i64))
        .bind(run.spent_cents as i64)
        .bind(&run.worktree_path)
        .bind(&run.worktree_branch)
        .bind(run.confinement.map(|c| c.to_string()))
        .bind(run.id.0.to_string())
        .execute(&self.pool)
        .await?;
        if outcome.rows_affected() == 0 {
            return Err(StoreError::RunNotFound(run.id));
        }
        Ok(())
    }

    /// Update a run using optimistic concurrency compare-and-swap (CAS).
    ///
    /// If the stored version matches `expected_version`, applies the update,
    /// increments the version by 1, and returns the new version.
    /// If the version has moved, returns [`StoreError::VersionConflict`].
    pub async fn update_run_cas(&self, run: &Run, expected_version: u64) -> Result<u64> {
        let outcome = sqlx::query(
            "UPDATE runs SET current_stage = ?, gate_states = ?, artifacts = ?, updated_at = ?, \
             status = ?, budget_cents = ?, spent_cents = ?, version = version + 1, \
             worktree_path = ?, worktree_branch = ?, confinement = ? \
             WHERE id = ? AND version = ?",
        )
        .bind(serde_json::to_string(&run.current_stage)?)
        .bind(serde_json::to_string(&run.gate_states)?)
        .bind(serde_json::to_string(&run.artifacts)?)
        .bind(run.updated_at.to_rfc3339())
        .bind(serde_json::to_string(&run.status)?)
        .bind(run.budget_cents.map(|v| v as i64))
        .bind(run.spent_cents as i64)
        .bind(&run.worktree_path)
        .bind(&run.worktree_branch)
        .bind(run.confinement.map(|c| c.to_string()))
        .bind(run.id.0.to_string())
        .bind(expected_version as i64)
        .execute(&self.pool)
        .await?;

        if outcome.rows_affected() == 0 {
            let actual = self.get_run_version(run.id).await?;
            return Err(StoreError::VersionConflict {
                run_id: run.id,
                expected: expected_version,
                actual,
            });
        }

        Ok(expected_version + 1)
    }

    /// List runs belonging to a project, newest first.
    pub async fn list_runs(&self, project_id: ProjectId) -> Result<Vec<Run>> {
        let rows = sqlx::query(
            "SELECT id, project_id, current_stage, gate_states, artifacts, created_at, \
             updated_at, status, budget_cents, spent_cents, version, worktree_path, \
             worktree_branch, confinement FROM runs \
             WHERE project_id = ? ORDER BY created_at DESC",
        )
        .bind(project_id.0.as_bytes().to_vec())
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(run_from_row).collect()
    }

    /// List all runs across all projects, newest first.
    pub async fn list_all_runs(&self) -> Result<Vec<Run>> {
        let rows = sqlx::query(
            "SELECT id, project_id, current_stage, gate_states, artifacts, created_at, \
             updated_at, status, budget_cents, spent_cents, version, worktree_path, \
             worktree_branch, confinement FROM runs \
             ORDER BY created_at DESC",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(run_from_row).collect()
    }

    /// Recover runs left in `Running` state after an unclean restart/interruption:
    /// marks them [`RunStatus::Paused`], increments their version via CAS,
    /// and appends an `EventKind::Error` event with `{"action": "run_interrupted"}`.
    pub async fn recover_interrupted_runs(&self) -> Result<Vec<Run>> {
        let rows = sqlx::query(
            "SELECT id, project_id, current_stage, gate_states, artifacts, created_at, \
             updated_at, status, budget_cents, spent_cents, version, worktree_path, \
             worktree_branch, confinement FROM runs \
             WHERE status = '\"running\"'",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut recovered = Vec::new();
        for row in rows {
            let mut run = run_from_row(&row)?;
            let version = column_int(&row, "version")?.unsigned_abs();
            run.status = RunStatus::Paused;
            run.updated_at = Utc::now();
            self.update_run_cas(&run, version).await?;

            let event = Event {
                id: Ulid::new(),
                run_id: run.id,
                stage: run.current_stage,
                role: None,
                kind: EventKind::Error,
                payload: serde_json::json!({ "action": "run_interrupted" }),
                cost_cents: None,
                tokens: None,
                created_at: Utc::now(),
                device_id: None,
            };
            self.append_event(&event).await?;
            recovered.push(run);
        }
        Ok(recovered)
    }

    // ----------------------------------------------------------------- events

    /// Append an event to a run's append-only log, and publish it on the live
    /// event bus once the row is durable.
    ///
    /// The publish is the point of this method, not an addition to it: every
    /// producer in the workspace writes through here, so a committed event is
    /// a broadcast event. The clone is the same `Event` the store holds —
    /// subscribers see exactly what a later `get_events` will read back.
    /// A `send` that finds no receiver, or a subscriber that has lagged, is a
    /// normal case and never fails the write; the payload is not logged, since
    /// it can carry an idea or an artifact body.
    pub async fn append_event(&self, event: &Event) -> Result<()> {
        let role = match event.role {
            Some(role) => Some(serde_json::to_string(&role)?),
            None => None,
        };
        let tokens = match &event.tokens {
            Some(tokens) => Some(serde_json::to_string(tokens)?),
            None => None,
        };
        sqlx::query(
            "INSERT INTO events (id, run_id, stage, role, kind, payload, cost_cents, tokens, \
             created_at, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(event.id.to_string())
        .bind(event.run_id.0.to_string())
        .bind(serde_json::to_string(&event.stage)?)
        .bind(role)
        .bind(serde_json::to_string(&event.kind)?)
        .bind(event.payload.to_string())
        .bind(event.cost_cents.map(|v| v as i64))
        .bind(tokens)
        .bind(event.created_at.to_rfc3339())
        .bind(event.device_id.map(|d| d.0.as_bytes().to_vec()))
        .execute(&self.pool)
        .await?;
        let _ = self.event_tx.send(event.clone());
        Ok(())
    }

    /// Read a run's events in chronological order.
    pub async fn get_events(&self, run_id: RunId) -> Result<Vec<Event>> {
        let rows = sqlx::query(
            "SELECT id, run_id, stage, role, kind, payload, cost_cents, tokens, created_at, \
             device_id FROM events WHERE run_id = ? ORDER BY created_at ASC",
        )
        .bind(run_id.0.to_string())
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(event_from_row).collect()
    }

    // ------------------------------------------------------------------ sessions

    /// Create a session.
    pub async fn create_session(&self, session: &Session) -> Result<()> {
        sqlx::query(
            "INSERT INTO sessions (id, run_id, project_id, role, backend, provider, model, status, \
             started_at, ended_at, parent_session_id, cli_session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(session.id.to_string())
        .bind(session.run_id.0.to_string())
        .bind(session.project_id.0.as_bytes().to_vec())
        .bind(serde_json::to_string(&session.role)?)
        .bind(&session.backend)
        .bind(&session.provider)
        .bind(&session.model)
        .bind(serde_json::to_string(&session.status)?)
        .bind(session.started_at.to_rfc3339())
        .bind(session.ended_at.map(|t| t.to_rfc3339()))
        .bind(session.parent_session_id.map(|id| id.to_string()))
        .bind(&session.cli_session_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Update session status.
    pub async fn update_session_status(
        &self,
        session_id: SessionId,
        status: SessionStatus,
    ) -> Result<()> {
        sqlx::query("UPDATE sessions SET status = ? WHERE id = ?")
            .bind(serde_json::to_string(&status)?)
            .bind(session_id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Finish a session.
    pub async fn finish_session(
        &self,
        session_id: SessionId,
        status: SessionStatus,
        ended_at: DateTime<Utc>,
    ) -> Result<()> {
        sqlx::query("UPDATE sessions SET status = ?, ended_at = ? WHERE id = ?")
            .bind(serde_json::to_string(&status)?)
            .bind(ended_at.to_rfc3339())
            .bind(session_id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// List a run's sessions in creation order.
    pub async fn list_sessions_by_run(&self, run_id: RunId) -> Result<Vec<Session>> {
        let rows = sqlx::query(
            "SELECT id, run_id, project_id, role, backend, provider, model, status, \
             started_at, ended_at, parent_session_id, cli_session_id FROM sessions \
             WHERE run_id = ? ORDER BY started_at ASC",
        )
        .bind(run_id.0.to_string())
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(session_from_row).collect()
    }

    /// Read one session by id.
    pub async fn get_session(&self, session_id: SessionId) -> Result<Option<Session>> {
        let row = sqlx::query(
            "SELECT id, run_id, project_id, role, backend, provider, model, status, \
             started_at, ended_at, parent_session_id, cli_session_id FROM sessions \
             WHERE id = ?",
        )
        .bind(session_id.to_string())
        .fetch_optional(&self.pool)
        .await?;
        row.map(|r| session_from_row(&r)).transpose()
    }

    /// Update a session's CLI-reported session id.
    pub async fn update_session_cli_id(
        &self,
        session_id: SessionId,
        cli_session_id: &str,
    ) -> Result<()> {
        sqlx::query("UPDATE sessions SET cli_session_id = ? WHERE id = ?")
            .bind(cli_session_id)
            .bind(session_id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Insert a gate row for one stage of a run.
    pub async fn create_gate(&self, gate: &Gate) -> Result<()> {
        sqlx::query(
            "INSERT INTO gates (id, run_id, stage, state, decided_by_device_id, reason, notes, \
             decided_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(gate.id.to_string())
        .bind(gate.run_id.0.to_string())
        .bind(serde_json::to_string(&gate.stage)?)
        .bind(serde_json::to_string(&gate.state)?)
        .bind(gate.decided_by_device_id.map(|d| d.0.as_bytes().to_vec()))
        .bind(&gate.reason)
        .bind(&gate.notes)
        .bind(gate.decided_at.map(|t| t.to_rfc3339()))
        .bind(gate.created_at.to_rfc3339())
        .bind(gate.updated_at.to_rfc3339())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Fetch a gate by id.
    pub async fn get_gate(&self, id: Ulid) -> Result<Gate> {
        let row = sqlx::query(
            "SELECT id, run_id, stage, state, decided_by_device_id, reason, notes, decided_at, \
             created_at, updated_at FROM gates WHERE id = ?",
        )
        .bind(id.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(StoreError::GateNotFound(id))?;
        gate_from_row(&row)
    }

    /// List a run's gates in the order they were created.
    pub async fn list_gates(&self, run_id: RunId) -> Result<Vec<Gate>> {
        let rows = sqlx::query(
            "SELECT id, run_id, stage, state, decided_by_device_id, reason, notes, decided_at, \
             created_at, updated_at FROM gates WHERE run_id = ? \
             ORDER BY created_at ASC, id ASC",
        )
        .bind(run_id.0.to_string())
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(gate_from_row).collect()
    }

    /// Persist a gate's new state, keeping the mirrored decision columns in sync.
    pub async fn update_gate_state(
        &self,
        id: Ulid,
        state: &GateState,
        updated_at: DateTime<Utc>,
    ) -> Result<()> {
        let (decided_by, reason, notes, decided_at) = match state {
            GateState::Pending => (None, None, None, None),
            GateState::Approved { by, at } => (Some(*by), None, None, Some(*at)),
            GateState::Rejected { reason, by, at } => {
                (Some(*by), Some(reason.clone()), None, Some(*at))
            }
            GateState::ChangesRequested { notes, by, at } => {
                (Some(*by), None, Some(notes.clone()), Some(*at))
            }
        };
        let outcome = sqlx::query(
            "UPDATE gates SET state = ?, decided_by_device_id = ?, reason = ?, notes = ?, \
             decided_at = ?, updated_at = ? WHERE id = ?",
        )
        .bind(serde_json::to_string(state)?)
        .bind(decided_by.map(|d| d.0.as_bytes().to_vec()))
        .bind(reason)
        .bind(notes)
        .bind(decided_at.map(|t| t.to_rfc3339()))
        .bind(updated_at.to_rfc3339())
        .bind(id.to_string())
        .execute(&self.pool)
        .await?;
        if outcome.rows_affected() == 0 {
            return Err(StoreError::GateNotFound(id));
        }
        Ok(())
    }

    // -------------------------------------------------------- artifact index

    /// Insert an artifact index row.
    pub async fn create_artifact(&self, artifact: &ArtifactRecord) -> Result<()> {
        sqlx::query(
            "INSERT INTO artifacts (id, run_id, project_id, name, kind, content_path, sha256, \
             created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(artifact.id.to_string())
        .bind(artifact.run_id.0.to_string())
        .bind(artifact.project_id.0.as_bytes().to_vec())
        .bind(&artifact.name)
        .bind(&artifact.kind)
        .bind(&artifact.content_path)
        .bind(&artifact.sha256)
        .bind(artifact.created_at.to_rfc3339())
        .bind(artifact.updated_at.to_rfc3339())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Fetch an artifact index row by id.
    pub async fn get_artifact(&self, id: Ulid) -> Result<ArtifactRecord> {
        let row = sqlx::query(
            "SELECT id, run_id, project_id, name, kind, content_path, sha256, created_at, \
             updated_at FROM artifacts WHERE id = ?",
        )
        .bind(id.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(StoreError::ArtifactNotFound(id))?;
        artifact_from_row(&row)
    }

    /// List a run's artifacts in the order they were created.
    pub async fn list_artifacts(&self, run_id: RunId) -> Result<Vec<ArtifactRecord>> {
        let rows = sqlx::query(
            "SELECT id, run_id, project_id, name, kind, content_path, sha256, created_at, \
             updated_at FROM artifacts WHERE run_id = ? \
             ORDER BY created_at ASC, id ASC",
        )
        .bind(run_id.0.to_string())
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(artifact_from_row).collect()
    }

    // ------------------------------------------------------------------ secretary_interviews
    pub async fn save_secretary_interview(&self, project_id: ProjectId, state: &str) -> Result<()> {
        sqlx::query("INSERT OR REPLACE INTO secretary_interviews (project_id, state) VALUES (?, ?)")
            .bind(project_id.0.as_bytes().to_vec())
            .bind(state)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn load_secretary_interview(&self, project_id: ProjectId) -> Result<Option<String>> {
        let row: Option<(String,)> = sqlx::query_as("SELECT state FROM secretary_interviews WHERE project_id = ?")
            .bind(project_id.0.as_bytes().to_vec())
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|r| r.0))
    }

    pub async fn delete_secretary_interview(&self, project_id: ProjectId) -> Result<()> {
        sqlx::query("DELETE FROM secretary_interviews WHERE project_id = ?")
            .bind(project_id.0.as_bytes().to_vec())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Record one model call's token usage and cost.
    pub async fn record_cost(&self, cost: &CostRecord) -> Result<()> {
        let agent_role = match cost.agent_role {
            Some(role) => Some(serde_json::to_string(&role)?),
            None => None,
        };
        sqlx::query(
            "INSERT INTO costs (id, run_id, project_id, agent_role, provider_id, model_id, \
             prompt_tokens, completion_tokens, cache_read_tokens, cache_write_tokens, source, \
             estimated, cost_known, duration_ms, session_id, cost_cents, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(cost.id.to_string())
        .bind(cost.run_id.0.to_string())
        .bind(cost.project_id.0.as_bytes().to_vec())
        .bind(agent_role)
        .bind(&cost.provider_id)
        .bind(&cost.model_id)
        .bind(cost.prompt_tokens as i64)
        .bind(cost.completion_tokens as i64)
        .bind(cost.cache_read_tokens as i64)
        .bind(cost.cache_write_tokens as i64)
        .bind(&cost.source)
        .bind(cost.estimated as i64)
        .bind(cost.cost_known as i64)
        .bind(cost.duration_ms.map(|v| v as i64))
        .bind(&cost.session_id)
        .bind(cost.cost_cents as i64)
        .bind(cost.created_at.to_rfc3339())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// List a run's recorded costs in the order they were recorded.
    pub async fn list_costs(&self, run_id: RunId) -> Result<Vec<CostRecord>> {
        let rows = sqlx::query(
            "SELECT id, run_id, project_id, agent_role, provider_id, model_id, prompt_tokens, \
             completion_tokens, cache_read_tokens, cache_write_tokens, source, estimated, \
             cost_known, duration_ms, session_id, cost_cents, created_at FROM costs \
             WHERE run_id = ? \
             ORDER BY created_at ASC, id ASC",
        )
        .bind(run_id.0.to_string())
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(cost_from_row).collect()
    }

    /// Sum every recorded cost for a run, in cents.
    pub async fn total_cost_cents(&self, run_id: RunId) -> Result<u64> {
        let row =
            sqlx::query("SELECT COALESCE(SUM(cost_cents), 0) AS total FROM costs WHERE run_id = ?")
                .bind(run_id.0.to_string())
                .fetch_one(&self.pool)
                .await?;
        Ok(column_int(&row, "total")?.unsigned_abs())
    }

    /// Aggregate costs by a specified dimension (e.g., 'provider_id', 'model_id', 'agent_role', 'project_id').
    pub async fn aggregate_costs_by(
        &self,
        dimension: &str,
        project_id: Option<ProjectId>,
    ) -> Result<HashMap<String, u64>> {
        let whitelisted = ["provider_id", "model_id", "agent_role", "project_id"];
        if !whitelisted.contains(&dimension) {
            return Err(StoreError::UnexpectedType("invalid dimension"));
        }

        let mut query = format!(
            "SELECT {} AS dim, SUM(cost_cents) AS total FROM costs",
            dimension
        );

        if project_id.is_some() {
            query.push_str(" WHERE project_id = ?");
        }

        query.push_str(" GROUP BY dim");

        let mut query_builder = sqlx::query(&query);
        if let Some(pid) = project_id {
            query_builder = query_builder.bind(pid.0.as_bytes().to_vec());
        }

        let rows = query_builder.fetch_all(&self.pool).await?;

        let mut results = HashMap::new();
        for row in rows {
            results.insert(
                column_text(&row, "dim")?,
                column_int(&row, "total")?.unsigned_abs(),
            );
        }
        Ok(results)
    }

    /// Aggregate tokens by dimension and time (day/month).
    pub async fn aggregate_tokens_by(
        &self,
        dimension: &str,
        time_format: &str, // "%Y-%m-%d" or "%Y-%m"
        project_id: Option<ProjectId>,
    ) -> Result<HashMap<(String, String), (u64, u64, u64, u64, u64)>> {
        let whitelisted = ["provider_id", "model_id", "agent_role", "project_id"];
        if !whitelisted.contains(&dimension) {
            return Err(StoreError::UnexpectedType("invalid dimension"));
        }

        // SQLite date formatting: strftime(format, created_at)
        let time_sql = match time_format {
            "%Y-%m-%d" => "DATE(created_at)",
            "%Y-%m" => "strftime('%Y-%m', created_at)",
            _ => return Err(StoreError::UnexpectedType("invalid time format")),
        };

        let mut query = format!(
            "SELECT {dim} AS dim, {time_sql} AS time, \
             SUM(prompt_tokens) AS p, SUM(completion_tokens) AS c, \
             SUM(cache_read_tokens) AS cr, SUM(cache_write_tokens) AS cw, \
             COUNT(*) AS reqs \
             FROM costs",
            dim = dimension,
            time_sql = time_sql
        );

        if project_id.is_some() {
            query.push_str(" WHERE project_id = ?");
        }

        query.push_str(" GROUP BY dim, time");

        let mut query_builder = sqlx::query(&query);
        if let Some(pid) = project_id {
            query_builder = query_builder.bind(pid.0.as_bytes().to_vec());
        }

        let rows = query_builder.fetch_all(&self.pool).await?;

        let mut results = HashMap::new();
        for row in rows {
            let dim = column_text(&row, "dim")?;
            let time = column_text(&row, "time")?;
            let p = column_int(&row, "p")?.unsigned_abs();
            let c = column_int(&row, "c")?.unsigned_abs();
            let cr = column_int(&row, "cr")?.unsigned_abs();
            let cw = column_int(&row, "cw")?.unsigned_abs();
            let reqs = column_int(&row, "reqs")?.unsigned_abs();
            results.insert((dim, time), (p, c, cr, cw, reqs));
        }
        Ok(results)
    }

    /// Aggregate costs by a time bucket (`"%Y-%m-%d"` for a day, `"%Y-%m"` for a
    /// month), optionally narrowed to one project. The bucket format is
    /// whitelisted, never interpolated from caller input.
    pub async fn aggregate_costs_by_time(
        &self,
        time_format: &str,
        project_id: Option<ProjectId>,
    ) -> Result<HashMap<String, u64>> {
        let time_sql = match time_format {
            "%Y-%m-%d" => "DATE(created_at)",
            "%Y-%m" => "strftime('%Y-%m', created_at)",
            _ => return Err(StoreError::UnexpectedType("invalid time format")),
        };
        let mut query = format!(
            "SELECT {time_sql} AS period, SUM(cost_cents) AS total FROM costs",
            time_sql = time_sql
        );
        if project_id.is_some() {
            query.push_str(" WHERE project_id = ?");
        }
        query.push_str(" GROUP BY period");
        let mut query_builder = sqlx::query(&query);
        if let Some(pid) = project_id {
            query_builder = query_builder.bind(pid.0.as_bytes().to_vec());
        }
        let rows = query_builder.fetch_all(&self.pool).await?;
        let mut results = HashMap::new();
        for row in rows {
            results.insert(
                column_text(&row, "period")?,
                column_int(&row, "total")?.unsigned_abs(),
            );
        }
        Ok(results)
    }

    /// Aggregate costs by day.
    pub async fn aggregate_costs_by_day(&self) -> Result<HashMap<String, u64>> {
        let rows = sqlx::query(
            "SELECT DATE(created_at) AS day, SUM(cost_cents) AS total FROM costs GROUP BY day",
        )
        .fetch_all(&self.pool)
        .await?;
        let mut results = HashMap::new();
        for row in rows {
            results.insert(
                column_text(&row, "day")?,
                column_int(&row, "total")?.unsigned_abs(),
            );
        }
        Ok(results)
    }

    /// Costs and requests inside a trailing window ending now (A3 subscription
    /// windows: a rolling 5-hour or 7-day window over the daemon's own cost
    /// records). The window is one of the whitelisted presets — never
    /// interpolated from caller input. `created_at` is stored as RFC 3339
    /// (see `record_cost`), so the cutoff is formatted the same way.
    pub async fn costs_in_window(&self, window: &str) -> Result<(u64, u64)> {
        let cutoff = match window {
            "5h" => Utc::now() - chrono::Duration::hours(5),
            "7d" => Utc::now() - chrono::Duration::days(7),
            _ => return Err(StoreError::UnexpectedType("invalid window")),
        };
        let row = sqlx::query(
            "SELECT COUNT(*) AS requests, COALESCE(SUM(cost_cents), 0) AS total \
             FROM costs WHERE created_at >= ?",
        )
        .bind(cutoff.to_rfc3339())
        .fetch_one(&self.pool)
        .await?;
        let requests = column_int(&row, "requests")?.unsigned_abs();
        let total = column_int(&row, "total")?.unsigned_abs();
        Ok((requests, total))
    }

    // -------------------------------------------------------------- artifacts

    /// Directory holding a project's generated artifacts.
    pub fn factory_dir(&self, project_id: ProjectId) -> PathBuf {
        self.db_path
            .parent()
            .map_or_else(|| PathBuf::from("."), std::path::Path::to_path_buf)
            .join("projects")
            .join(project_id.0.to_string())
            .join("factory")
    }

    /// Write an artifact as markdown, returning its path.
    pub async fn write_artifact(
        &self,
        project_id: ProjectId,
        name: &str,
        content: &str,
    ) -> Result<PathBuf> {
        let dir = self.factory_dir(project_id);
        std::fs::create_dir_all(&dir)?;
        let path = dir.join(format!("{name}.md"));
        std::fs::write(&path, content)?;
        Ok(path)
    }

    /// Read an artifact's markdown contents.
    pub async fn read_artifact(&self, project_id: ProjectId, name: &str) -> Result<String> {
        let path = self.factory_dir(project_id).join(format!("{name}.md"));
        Ok(std::fs::read_to_string(path)?)
    }
}

// ---------------------------------------------------------------- migrations

/// The migrations this binary ships, embedded at build time.
///
/// One place, so the store and its tests can never disagree about which
/// versions exist.
fn migration_migrator() -> sqlx::migrate::Migrator {
    sqlx::migrate!("./migrations")
}

// ------------------------------------------------------------ settings schema

/// Repair the one settings table shape `006_settings.sql` cannot migrate.
///
/// `CREATE TABLE IF NOT EXISTS` leaves an existing table alone, so a database a
/// pre-audit-H1 daemon wrote keeps its four-column `pairing_devices`, and SQLite
/// has no `ALTER TABLE … ADD COLUMN IF NOT EXISTS` to bring it forward inside
/// the migration. This is that guarded step: while the column is missing it is
/// added, and the rows the older daemon paired are grandfathered with the same
/// 10-minute grace window 005 applied, so an owner upgrading can still use a
/// phone that was paired under the old code and no secret outlives that window.
///
/// It is deliberately conditional on the column's absence: a pairing row with a
/// `NULL` deadline written after the column existed means "revocation only", and
/// a repair that ran unconditionally would silently give it one.
async fn repair_settings_expiry(connection: &mut sqlx::SqliteConnection) -> Result<()> {
    let has_expiry: Option<String> =
        sqlx::query_scalar("SELECT name FROM pragma_table_info('pairing_devices') WHERE name = ?")
            .bind("expires_at")
            .fetch_optional(&mut *connection)
            .await?;
    if has_expiry.is_none() {
        sqlx::query("ALTER TABLE pairing_devices ADD COLUMN expires_at INTEGER")
            .execute(&mut *connection)
            .await?;
        sqlx::query(
            "UPDATE pairing_devices \
                SET expires_at = CAST(strftime('%s', 'now') AS INTEGER) + 600 \
              WHERE expires_at IS NULL",
        )
        .execute(&mut *connection)
        .await?;
    }
    Ok(())
}

// --------------------------------------------------------------- row mapping

fn column_text(row: &sqlx::sqlite::SqliteRow, column: &'static str) -> Result<String> {
    row.try_get::<String, _>(column)
        .map_err(|_| StoreError::UnexpectedType(column))
}

fn column_opt_text(row: &sqlx::sqlite::SqliteRow, column: &'static str) -> Result<Option<String>> {
    row.try_get::<Option<String>, _>(column)
        .map_err(|_| StoreError::UnexpectedType(column))
}

fn column_opt_int(row: &sqlx::sqlite::SqliteRow, column: &'static str) -> Result<Option<i64>> {
    row.try_get::<Option<i64>, _>(column)
        .map_err(|_| StoreError::UnexpectedType(column))
}

fn column_int(row: &sqlx::sqlite::SqliteRow, column: &'static str) -> Result<i64> {
    row.try_get::<i64, _>(column)
        .map_err(|_| StoreError::UnexpectedType(column))
}

fn column_opt_blob(row: &sqlx::sqlite::SqliteRow, field: &'static str) -> Result<Option<Vec<u8>>> {
    row.try_get::<Option<Vec<u8>>, _>(field)
        .map_err(|_| StoreError::UnexpectedType(field))
}

fn parse_uuid(field: &'static str, bytes: &[u8]) -> Result<Uuid> {
    Uuid::from_slice(bytes).map_err(|_| StoreError::CorruptId {
        field,
        value: format!("{bytes:?}"),
    })
}

fn column_blob(row: &sqlx::sqlite::SqliteRow, field: &'static str) -> Result<Vec<u8>> {
    row.try_get::<Vec<u8>, _>(field)
        .map_err(|_| StoreError::UnexpectedType(field))
}

fn parse_ulid(field: &'static str, value: &str) -> Result<ulid::Ulid> {
    ulid::Ulid::from_string(value).map_err(|_| StoreError::CorruptId {
        field,
        value: value.to_owned(),
    })
}

fn parse_time(field: &'static str, value: &str) -> Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value).map_or_else(
        |_| {
            Err(StoreError::CorruptId {
                field,
                value: value.to_owned(),
            })
        },
        |dt| Ok(dt.with_timezone(&Utc)),
    )
}

fn project_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Project> {
    let confinement: Option<Confinement> = column_opt_text(row, "confinement")?
        .map(|s| {
            s.parse()
                .map_err(|e| StoreError::ParseError("confinement", e))
        })
        .transpose()?;
    let approval_mode: Option<ApprovalMode> = column_opt_text(row, "approval_mode")?
        .map(|s| {
            s.parse()
                .map_err(|e| StoreError::ParseError("approval_mode", e))
        })
        .transpose()?;

    Ok(Project {
        id: ProjectId(parse_uuid("projects.id", &column_blob(row, "id")?)?),
        name: column_text(row, "name")?,
        description: column_text(row, "description")?,
        language: column_text(row, "language")?,
        created_at: parse_time("projects.created_at", &column_text(row, "created_at")?)?,
        updated_at: parse_time("projects.updated_at", &column_text(row, "updated_at")?)?,
        repo_path: column_opt_text(row, "repo_path")?,
        repo_url: column_opt_text(row, "repo_url")?,
        confinement,
        approval_mode,
        permissions: ProjectPermissions {
            confinement: confinement.unwrap_or_default(),
            approval_mode: approval_mode.unwrap_or_default(),
            is_override: confinement.is_some() || approval_mode.is_some(),
        },
    })
}

fn run_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Run> {
    let gate_states: HashMap<Stage, GateState> =
        serde_json::from_str(&column_text(row, "gate_states")?)?;
    let artifacts: HashMap<String, Artifact> =
        serde_json::from_str(&column_text(row, "artifacts")?)?;
    Ok(Run {
        id: RunId(parse_ulid("runs.id", &column_text(row, "id")?)?),
        project_id: ProjectId(parse_uuid(
            "runs.project_id",
            &column_blob(row, "project_id")?,
        )?),
        current_stage: serde_json::from_str(&column_text(row, "current_stage")?)?,
        gate_states,
        artifacts,
        created_at: parse_time("runs.created_at", &column_text(row, "created_at")?)?,
        updated_at: parse_time("runs.updated_at", &column_text(row, "updated_at")?)?,
        status: serde_json::from_str::<RunStatus>(&column_text(row, "status")?)?,
        budget_cents: column_opt_int(row, "budget_cents")?.map(|v| v.unsigned_abs()),
        spent_cents: column_opt_int(row, "spent_cents")?
            .map_or(0, |v| u64::from_ne_bytes(i64::to_ne_bytes(v))),
        worktree_path: column_opt_text(row, "worktree_path")?,
        worktree_branch: column_opt_text(row, "worktree_branch")?,
        // B2: the confinement the run is confined by, persisted with the run so
        // the backstop survives a restart. Legacy rows read NULL → None.
        confinement: column_opt_text(row, "confinement")?
            .map(|s| s.parse())
            .transpose()
            .map_err(|e: String| StoreError::ParseError("runs.confinement", e))?,
    })
}

fn event_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Event> {
    let role = match column_opt_text(row, "role")? {
        Some(raw) => Some(serde_json::from_str::<Role>(&raw)?),
        None => None,
    };
    let tokens = match column_opt_text(row, "tokens")? {
        Some(raw) => Some(serde_json::from_str::<TokenUsage>(&raw)?),
        None => None,
    };
    let device_id = match column_opt_blob(row, "device_id")? {
        Some(bytes) => Some(DeviceId(parse_uuid("events.device_id", &bytes)?)),
        None => None,
    };
    Ok(Event {
        id: parse_ulid("events.id", &column_text(row, "id")?)?,
        run_id: RunId(parse_ulid("events.run_id", &column_text(row, "run_id")?)?),
        stage: serde_json::from_str::<Stage>(&column_text(row, "stage")?)?,
        role,
        kind: serde_json::from_str::<EventKind>(&column_text(row, "kind")?)?,
        payload: serde_json::from_str(&column_text(row, "payload")?)?,
        cost_cents: column_opt_int(row, "cost_cents")?.map(|v| v.unsigned_abs()),
        tokens,
        created_at: parse_time("events.created_at", &column_text(row, "created_at")?)?,
        device_id,
    })
}

fn gate_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Gate> {
    let decided_by_device_id = match column_opt_blob(row, "decided_by_device_id")? {
        Some(bytes) => Some(DeviceId(parse_uuid("gates.decided_by_device_id", &bytes)?)),
        None => None,
    };
    let decided_at = match column_opt_text(row, "decided_at")? {
        Some(raw) => Some(parse_time("gates.decided_at", &raw)?),
        None => None,
    };
    Ok(Gate {
        id: parse_ulid("gates.id", &column_text(row, "id")?)?,
        run_id: RunId(parse_ulid("gates.run_id", &column_text(row, "run_id")?)?),
        stage: serde_json::from_str::<Stage>(&column_text(row, "stage")?)?,
        state: serde_json::from_str::<GateState>(&column_text(row, "state")?)?,
        decided_by_device_id,
        reason: column_opt_text(row, "reason")?,
        notes: column_opt_text(row, "notes")?,
        decided_at,
        created_at: parse_time("gates.created_at", &column_text(row, "created_at")?)?,
        updated_at: parse_time("gates.updated_at", &column_text(row, "updated_at")?)?,
    })
}

fn session_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Session> {
    Ok(Session {
        id: SessionId(parse_ulid("sessions.id", &column_text(row, "id")?)?),
        run_id: RunId(parse_ulid("sessions.run_id", &column_text(row, "run_id")?)?),
        project_id: ProjectId(parse_uuid(
            "sessions.project_id",
            &column_blob(row, "project_id")?,
        )?),
        role: serde_json::from_str::<Role>(&column_text(row, "role")?)?,
        backend: column_text(row, "backend")?,
        provider: column_text(row, "provider")?,
        model: column_text(row, "model")?,
        status: serde_json::from_str::<SessionStatus>(&column_text(row, "status")?)?,
        started_at: parse_time("sessions.started_at", &column_text(row, "started_at")?)?,
        ended_at: column_opt_text(row, "ended_at")?
            .map(|t| parse_time("sessions.ended_at", &t))
            .transpose()?,
        parent_session_id: column_opt_text(row, "parent_session_id")?
            .map(|t| parse_ulid("sessions.parent_session_id", &t))
            .transpose()?
            .map(SessionId),
        cli_session_id: column_opt_text(row, "cli_session_id")?,
    })
}

fn artifact_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<ArtifactRecord> {
    Ok(ArtifactRecord {
        id: parse_ulid("artifacts.id", &column_text(row, "id")?)?,
        run_id: RunId(parse_ulid(
            "artifacts.run_id",
            &column_text(row, "run_id")?,
        )?),
        project_id: ProjectId(parse_uuid(
            "artifacts.project_id",
            &column_blob(row, "project_id")?,
        )?),
        name: column_text(row, "name")?,
        kind: column_text(row, "kind")?,
        content_path: column_text(row, "content_path")?,
        sha256: column_opt_text(row, "sha256")?,
        created_at: parse_time("artifacts.created_at", &column_text(row, "created_at")?)?,
        updated_at: parse_time("artifacts.updated_at", &column_text(row, "updated_at")?)?,
    })
}

fn cost_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<CostRecord> {
    let agent_role = match column_opt_text(row, "agent_role")? {
        Some(raw) => Some(serde_json::from_str::<Role>(&raw)?),
        None => None,
    };
    Ok(CostRecord {
        id: parse_ulid("costs.id", &column_text(row, "id")?)?,
        run_id: RunId(parse_ulid("costs.run_id", &column_text(row, "run_id")?)?),
        project_id: ProjectId(parse_uuid(
            "costs.project_id",
            &column_blob(row, "project_id")?,
        )?),
        agent_role,
        provider_id: column_text(row, "provider_id")?,
        model_id: column_text(row, "model_id")?,
        prompt_tokens: column_int(row, "prompt_tokens")?.unsigned_abs(),
        completion_tokens: column_int(row, "completion_tokens")?.unsigned_abs(),
        cache_read_tokens: column_int(row, "cache_read_tokens")?.unsigned_abs(),
        cache_write_tokens: column_int(row, "cache_write_tokens")?.unsigned_abs(),
        source: column_text(row, "source")?,
        estimated: column_int(row, "estimated")? != 0,
        cost_known: column_int(row, "cost_known")? != 0,
        duration_ms: column_opt_int(row, "duration_ms")?.map(|v| v.unsigned_abs()),
        session_id: column_opt_text(row, "session_id")?,
        cost_cents: column_int(row, "cost_cents")?.unsigned_abs(),
        created_at: parse_time("costs.created_at", &column_text(row, "created_at")?)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
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

    fn sample_project() -> Project {
        let now = Utc::now();
        Project {
            id: ProjectId::new(),
            name: "demo".to_owned(),
            description: "demo project".to_owned(),
            language: "ar".to_owned(),
            created_at: now,
            updated_at: now,
            repo_path: None,
            repo_url: None,
            confinement: None,
            approval_mode: None,
            permissions: Default::default(),
        }
    }

    async fn temp_store() -> Store {
        let dir = fresh_tempdir();
        let path = dir.path().join("warsha.db");
        let store = Store::open_at(path).await.unwrap();
        std::mem::forget(dir);
        store
    }

    #[tokio::test]
    async fn creates_database_and_migrates() {
        let store = temp_store().await;
        assert!(store.db_path().exists());
    }

    /// Regression guard: migration SQL must stay LF-only. A CRLF checkout
    /// (Windows `core.autocrlf`) changes the bytes sqlx hashes, breaking
    /// checksum validation against databases migrated from LF files.
    #[test]
    fn migration_sql_files_contain_no_cr_bytes() {
        for (name, bytes) in [
            (
                "001_initial.sql",
                &include_bytes!("../migrations/001_initial.sql")[..],
            ),
            (
                "002_m1_gates_artifacts_costs.sql",
                &include_bytes!("../migrations/002_m1_gates_artifacts_costs.sql")[..],
            ),
            (
                "003_run_version.sql",
                &include_bytes!("../migrations/003_run_version.sql")[..],
            ),
            (
                "006_settings.sql",
                &include_bytes!("../migrations/006_settings.sql")[..],
            ),
            (
                "007_cli_usage_costs.sql",
                &include_bytes!("../migrations/007_cli_usage_costs.sql")[..],
            ),
            (
                "009_project_permissions.sql",
                &include_bytes!("../migrations/009_project_permissions.sql")[..],
            ),
        ] {
            assert!(
                !bytes.contains(&b'\r'),
                "{name} contains CR (0x0D) bytes; migrations must be LF-only \
                 (see root .gitattributes: *.sql text eol=lf)"
            );
        }
    }

    /// Checksum-stability proxy: the compile-time embedded migrator must
    /// expose exactly versions 1, 2, 3, 4, 6, 7, 8, 9, 10, 11 and 12, with no CR
    /// in any embedded SQL.
    ///
    /// 5 is deliberately absent: the pairing-expiry column it added is part of
    /// 006 now (P-E7), and no database can have recorded it, because the
    /// migrator skipped it from the release that introduced it.
    #[test]
    fn embedded_migrator_versions_are_lf_only() {
        let migrator = migration_migrator();
        let versions: Vec<i64> = migrator.iter().map(|m| m.version).collect();
        assert_eq!(versions, vec![1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13]);
        for migration in migrator.iter() {
            assert!(
                !migration.sql.contains('\r'),
                "embedded migration {} contains CR bytes",
                migration.version
            );
        }
    }

    /// The async migrator owns the settings schema (006), and there is no
    /// skipped version left: the ledger is exactly what the migrator runs. The
    /// two tables that would collide are both present and distinct: `providers`
    /// is 001's, `configured_providers` is 006's — the same-file trap
    /// DECISIONS.md records.
    #[tokio::test]
    async fn settings_schema_is_created_by_the_async_migrator() {
        let store = temp_store().await;
        let applied: Vec<i64> =
            sqlx::query_scalar("SELECT version FROM _sqlx_migrations ORDER BY version")
                .fetch_all(store.pool())
                .await
                .expect("the migration ledger is readable");
        assert_eq!(applied, vec![1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13]);

        let tables: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master \
             WHERE type = 'table' AND name IN ('pairing_devices', 'providers', 'configured_providers') \
             ORDER BY name ASC",
        )
        .fetch_all(store.pool())
        .await
        .expect("the schema is readable");
        assert_eq!(
            tables,
            vec![
                "configured_providers".to_string(),
                "pairing_devices".to_string(),
                "providers".to_string(),
            ],
            "the settings tables and the async schema's `providers` share one file"
        );
    }

    /// [`Store::settings`] is the same pool, not a second connection story: a row
    /// written through the repository is visible to a query on the store's own
    /// pool, and the store's migrations created the table it writes to.
    #[tokio::test]
    async fn settings_write_through_the_stores_own_pool() {
        let store = temp_store().await;
        let settings = store.settings();
        settings
            .save_provider(&StoredProvider {
                name: "open_router".to_string(),
                kind: "open_router".to_string(),
                api_base: None,
                enabled: true,
                created_at: 1_700_000_000,
            })
            .await
            .expect("the settings write lands");

        let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM configured_providers")
            .fetch_one(store.pool())
            .await
            .expect("the store pool reads the settings table");
        assert_eq!(rows, 1);
    }

    #[tokio::test]
    async fn round_trips_a_project() {
        let store = temp_store().await;
        let project = sample_project();
        store.create_project(&project).await.unwrap();

        let fetched = store.get_project(project.id).await.unwrap();
        assert_eq!(fetched.name, "demo");
        assert_eq!(fetched.language, "ar");
        assert_eq!(store.list_projects().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn round_trips_a_run() {
        let store = temp_store().await;
        let project = sample_project();
        store.create_project(&project).await.unwrap();

        let now = Utc::now();
        let run = Run {
            id: RunId::new(),
            project_id: project.id,
            current_stage: Stage::Idea,
            gate_states: HashMap::new(),
            artifacts: HashMap::new(),
            created_at: now,
            updated_at: now,
            status: RunStatus::Running,
            budget_cents: Some(500),
            spent_cents: 0,
            worktree_path: None,
            worktree_branch: None,
            confinement: None,
        };
        store.create_run(&run).await.unwrap();

        let fetched = store.get_run(run.id).await.unwrap();
        assert_eq!(fetched.current_stage, Stage::Idea);
        assert_eq!(fetched.budget_cents, Some(500));
        assert_eq!(store.list_runs(project.id).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn appends_and_reads_events() {
        let store = temp_store().await;
        let project = sample_project();
        store.create_project(&project).await.unwrap();
        let now = Utc::now();
        let run = Run {
            id: RunId::new(),
            project_id: project.id,
            current_stage: Stage::Idea,
            gate_states: HashMap::new(),
            artifacts: HashMap::new(),
            created_at: now,
            updated_at: now,
            status: RunStatus::Running,
            budget_cents: None,
            spent_cents: 0,
            worktree_path: None,
            worktree_branch: None,
            confinement: None,
        };
        store.create_run(&run).await.unwrap();

        let event = Event {
            id: ulid::Ulid::new(),
            run_id: run.id,
            stage: Stage::Idea,
            role: Some(Role::Intake),
            kind: EventKind::StageStarted,
            payload: serde_json::json!({ "note": "hello" }),
            cost_cents: Some(3),
            tokens: Some(TokenUsage {
                input: 10,
                output: 5,
                total: 15,
                cost_cents: None,
            }),
            created_at: Utc::now(),
            device_id: None,
        };
        store.append_event(&event).await.unwrap();

        let events = store.get_events(run.id).await.unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, EventKind::StageStarted);
    }

    #[tokio::test]
    async fn reads_an_event_whose_device_id_is_set() {
        // `append_event` binds the device id as a 16-byte UUID blob, so reading it as
        // an integer made a run's whole log unreadable at the first gate decision.
        let store = temp_store().await;
        let project = sample_project();
        store.create_project(&project).await.unwrap();
        let run = sample_run(project.id);
        store.create_run(&run).await.unwrap();

        let device = DeviceId::new();
        let stage_started = Event {
            id: Ulid::new(),
            run_id: run.id,
            stage: Stage::Idea,
            role: None,
            kind: EventKind::StageStarted,
            payload: serde_json::json!({ "note": "no device yet" }),
            cost_cents: None,
            tokens: None,
            created_at: Utc::now(),
            device_id: None,
        };
        let gate_decision = Event {
            id: Ulid::new(),
            run_id: run.id,
            stage: Stage::GateA,
            role: None,
            kind: EventKind::GateDecision,
            payload: serde_json::json!({ "decision": "approved" }),
            cost_cents: None,
            tokens: None,
            created_at: stage_started.created_at + chrono::TimeDelta::seconds(1),
            device_id: Some(device),
        };
        store.append_event(&stage_started).await.unwrap();
        store.append_event(&gate_decision).await.unwrap();

        let events = store.get_events(run.id).await.unwrap();
        assert_eq!(events.len(), 2, "the log reads as a whole: {events:?}");
        assert_eq!(events[0].device_id, None);
        assert_eq!(events[1].kind, EventKind::GateDecision);
        assert_eq!(events[1].device_id, Some(device));
    }

    /// The live bus is the append, not a caller's chore: an event committed by
    /// `append_event` arrives on a pre-existing subscriber as the same
    /// [`Event`] the store read back, and an append with nobody watching is
    /// still a clean write.
    #[tokio::test]
    async fn appending_an_event_publishes_it_on_the_stores_bus() {
        let store = temp_store().await;
        let project = sample_project();
        store.create_project(&project).await.unwrap();
        let run = sample_run(project.id);
        store.create_run(&run).await.unwrap();

        // Nobody subscribed yet: the write must not fail for want of a listener.
        let unwatched = Event {
            id: Ulid::new(),
            run_id: run.id,
            stage: Stage::Idea,
            role: None,
            kind: EventKind::StageStarted,
            payload: serde_json::json!({ "note": "no listener" }),
            cost_cents: None,
            tokens: None,
            created_at: Utc::now(),
            device_id: None,
        };
        store.append_event(&unwatched).await.unwrap();

        let mut rx = store.subscribe_events();
        let watched = Event {
            id: Ulid::new(),
            created_at: unwatched.created_at + chrono::TimeDelta::seconds(1),
            ..unwatched.clone()
        };
        store.append_event(&watched).await.unwrap();

        let published = rx.recv().await.unwrap();
        assert_eq!(published.id, watched.id);
        assert_eq!(published.run_id, watched.run_id);
        assert_eq!(published.kind, EventKind::StageStarted);
        assert_eq!(published.payload, watched.payload);

        let stored = store.get_events(run.id).await.unwrap();
        assert_eq!(stored.len(), 2);
        assert_eq!(
            stored[1].id, published.id,
            "the bus and the store agree about what an event is"
        );
        assert_eq!(stored[1].payload, published.payload);
    }

    #[tokio::test]
    async fn missing_project_is_reported() {
        let store = temp_store().await;
        let err = store.get_project(ProjectId::new()).await;
        assert!(matches!(err, Err(StoreError::ProjectNotFound(_))));
    }

    #[tokio::test]
    async fn writes_and_reads_artifacts() {
        let store = temp_store().await;
        let project = sample_project();
        store.create_project(&project).await.unwrap();
        store
            .write_artifact(project.id, "prd", "# PRD")
            .await
            .unwrap();
        let content = store.read_artifact(project.id, "prd").await.unwrap();
        assert_eq!(content, "# PRD");
    }

    fn sample_run(project_id: ProjectId) -> Run {
        let now = Utc::now();
        Run {
            id: RunId::new(),
            project_id,
            current_stage: Stage::Idea,
            gate_states: HashMap::new(),
            artifacts: HashMap::new(),
            created_at: now,
            updated_at: now,
            status: RunStatus::Running,
            budget_cents: None,
            spent_cents: 0,
            worktree_path: None,
            worktree_branch: None,
            confinement: None,
        }
    }

    fn sample_gate(run_id: RunId, stage: Stage, created_at: DateTime<Utc>) -> Gate {
        Gate {
            id: Ulid::new(),
            run_id,
            stage,
            state: GateState::Pending,
            decided_by_device_id: None,
            reason: None,
            notes: None,
            decided_at: None,
            created_at,
            updated_at: created_at,
        }
    }

    fn sample_artifact(
        run_id: RunId,
        project_id: ProjectId,
        name: &str,
        created_at: DateTime<Utc>,
    ) -> ArtifactRecord {
        ArtifactRecord {
            id: Ulid::new(),
            run_id,
            project_id,
            name: name.to_owned(),
            kind: "markdown".to_owned(),
            content_path: format!("factory/{name}.md"),
            sha256: None,
            created_at,
            updated_at: created_at,
        }
    }

    fn sample_cost(
        run_id: RunId,
        project_id: ProjectId,
        cost_cents: u64,
        created_at: DateTime<Utc>,
    ) -> CostRecord {
        CostRecord {
            id: Ulid::new(),
            run_id,
            project_id,
            agent_role: Some(Role::Coder),
            provider_id: "mock".to_owned(),
            model_id: "mock-1".to_owned(),
            prompt_tokens: 100,
            completion_tokens: 50,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            source: "api_metered".to_owned(),
            estimated: false,
            cost_known: true,
            duration_ms: None,
            session_id: None,
            cost_cents,
            created_at,
        }
    }

    #[tokio::test]
    async fn round_trips_a_gate() {
        let store = temp_store().await;
        let project = sample_project();
        store.create_project(&project).await.unwrap();
        let run = sample_run(project.id);
        store.create_run(&run).await.unwrap();

        let gate = sample_gate(run.id, Stage::GateC, Utc::now());
        store.create_gate(&gate).await.unwrap();

        let fetched = store.get_gate(gate.id).await.unwrap();
        assert_eq!(fetched, gate);
        assert_eq!(store.list_gates(run.id).await.unwrap().len(), 1);
        assert!(matches!(
            store.get_gate(Ulid::new()).await,
            Err(StoreError::GateNotFound(_))
        ));
    }

    #[tokio::test]
    async fn lists_gates_in_creation_order() {
        let store = temp_store().await;
        let project = sample_project();
        store.create_project(&project).await.unwrap();
        let run = sample_run(project.id);
        store.create_run(&run).await.unwrap();

        let now = Utc::now();
        let later = now + chrono::TimeDelta::seconds(5);
        let early_gate = sample_gate(run.id, Stage::GateC, now);
        let late_gate = sample_gate(run.id, Stage::GateD, later);
        store.create_gate(&late_gate).await.unwrap();
        store.create_gate(&early_gate).await.unwrap();

        let stages: Vec<Stage> = store
            .list_gates(run.id)
            .await
            .unwrap()
            .into_iter()
            .map(|gate| gate.stage)
            .collect();
        assert_eq!(stages, vec![Stage::GateC, Stage::GateD]);
    }

    #[tokio::test]
    async fn persists_a_gate_state_transition() {
        let store = temp_store().await;
        let project = sample_project();
        store.create_project(&project).await.unwrap();
        let run = sample_run(project.id);
        store.create_run(&run).await.unwrap();

        let gate = sample_gate(run.id, Stage::GateC, Utc::now());
        store.create_gate(&gate).await.unwrap();

        let device = DeviceId::new();
        let decided_at = Utc::now();
        store
            .update_gate_state(
                gate.id,
                &GateState::Approved {
                    by: device,
                    at: decided_at,
                },
                decided_at,
            )
            .await
            .unwrap();

        let fetched = store.get_gate(gate.id).await.unwrap();
        assert_eq!(
            fetched.state,
            GateState::Approved {
                by: device,
                at: decided_at,
            }
        );
        assert_eq!(fetched.decided_by_device_id, Some(device));
        assert_eq!(fetched.decided_at, Some(decided_at));
        assert_eq!(fetched.updated_at, decided_at);
    }

    #[tokio::test]
    async fn updates_a_missing_gate_is_reported() {
        let store = temp_store().await;
        let err = store
            .update_gate_state(Ulid::new(), &GateState::Pending, Utc::now())
            .await;
        assert!(matches!(err, Err(StoreError::GateNotFound(_))));
    }

    #[tokio::test]
    async fn round_trips_an_artifact_record() {
        let store = temp_store().await;
        let project = sample_project();
        store.create_project(&project).await.unwrap();
        let run = sample_run(project.id);
        store.create_run(&run).await.unwrap();

        let artifact = sample_artifact(run.id, project.id, "prd", Utc::now());
        store.create_artifact(&artifact).await.unwrap();

        let fetched = store.get_artifact(artifact.id).await.unwrap();
        assert_eq!(fetched, artifact);
        assert_eq!(store.list_artifacts(run.id).await.unwrap().len(), 1);
        assert!(matches!(
            store.get_artifact(Ulid::new()).await,
            Err(StoreError::ArtifactNotFound(_))
        ));
    }

    #[tokio::test]
    async fn lists_artifacts_in_creation_order() {
        let store = temp_store().await;
        let project = sample_project();
        store.create_project(&project).await.unwrap();
        let run = sample_run(project.id);
        store.create_run(&run).await.unwrap();

        let now = Utc::now();
        let later = now + chrono::TimeDelta::seconds(5);
        let early = sample_artifact(run.id, project.id, "prd", now);
        let late = sample_artifact(run.id, project.id, "design", later);
        store.create_artifact(&late).await.unwrap();
        store.create_artifact(&early).await.unwrap();

        let names: Vec<String> = store
            .list_artifacts(run.id)
            .await
            .unwrap()
            .into_iter()
            .map(|artifact| artifact.name)
            .collect();
        assert_eq!(names, vec!["prd".to_owned(), "design".to_owned()]);
    }

    #[tokio::test]
    async fn sums_recorded_costs() {
        let store = temp_store().await;
        let project = sample_project();
        store.create_project(&project).await.unwrap();
        let run = sample_run(project.id);
        store.create_run(&run).await.unwrap();

        let now = Utc::now();
        let one = now + chrono::TimeDelta::seconds(1);
        let two = now + chrono::TimeDelta::seconds(2);
        store
            .record_cost(&sample_cost(run.id, project.id, 120, now))
            .await
            .unwrap();
        store
            .record_cost(&sample_cost(run.id, project.id, 250, one))
            .await
            .unwrap();
        store
            .record_cost(&sample_cost(run.id, project.id, 30, two))
            .await
            .unwrap();

        let costs = store.list_costs(run.id).await.unwrap();
        assert_eq!(costs.len(), 3);
        assert_eq!(costs[0].cost_cents, 120);
        assert_eq!(costs[2].cost_cents, 30);
        assert_eq!(costs[0].agent_role, Some(Role::Coder));
        assert_eq!(store.total_cost_cents(run.id).await.unwrap(), 400);
        assert_eq!(store.total_cost_cents(RunId::new()).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn deleting_a_run_cascades_to_children() {
        let store = temp_store().await;
        let project = sample_project();
        store.create_project(&project).await.unwrap();
        let run = sample_run(project.id);
        store.create_run(&run).await.unwrap();

        let now = Utc::now();
        store
            .create_gate(&sample_gate(run.id, Stage::GateC, now))
            .await
            .unwrap();
        store
            .create_artifact(&sample_artifact(run.id, project.id, "prd", now))
            .await
            .unwrap();
        store
            .record_cost(&sample_cost(run.id, project.id, 75, now))
            .await
            .unwrap();

        sqlx::query("DELETE FROM runs WHERE id = ?")
            .bind(run.id.0.to_string())
            .execute(store.pool())
            .await
            .unwrap();

        assert!(store.list_gates(run.id).await.unwrap().is_empty());
        assert!(store.list_artifacts(run.id).await.unwrap().is_empty());
        assert!(store.list_costs(run.id).await.unwrap().is_empty());
        assert_eq!(store.total_cost_cents(run.id).await.unwrap(), 0);
    }

    #[cfg(test)]
    mod cas {
        use super::*;

        #[tokio::test]
        async fn concurrent_update_with_stale_version_is_rejected() {
            let store = temp_store().await;
            let project = sample_project();
            store.create_project(&project).await.unwrap();

            let run = sample_run(project.id);
            store.create_run(&run).await.unwrap();

            // Both workers read the run at version 1.
            let (mut run_w1, v_w1) = store.get_run_versioned(run.id).await.unwrap();
            let (mut run_w2, v_w2) = store.get_run_versioned(run.id).await.unwrap();
            assert_eq!(v_w1, 1);
            assert_eq!(v_w2, 1);

            // Worker 1 commits first with CAS expected version 1.
            run_w1.current_stage = Stage::Research;
            let new_v = store.update_run_cas(&run_w1, v_w1).await.unwrap();
            assert_eq!(new_v, 2);

            // Worker 2 attempts to commit with stale version 1 -> rejected with VersionConflict.
            run_w2.current_stage = Stage::Design;
            let err = store
                .update_run_cas(&run_w2, v_w2)
                .await
                .expect_err("stale CAS update must fail");

            match err {
                StoreError::VersionConflict {
                    run_id,
                    expected,
                    actual,
                } => {
                    assert_eq!(run_id, run.id);
                    assert_eq!(expected, 1);
                    assert_eq!(actual, 2);
                }
                other => panic!("expected VersionConflict, got {other:?}"),
            }

            // Stored state remains Worker 1's commit (Research), not overwritten by Worker 2.
            let (stored, stored_v) = store.get_run_versioned(run.id).await.unwrap();
            assert_eq!(stored.current_stage, Stage::Research);
            assert_eq!(stored_v, 2);

            // Worker 2 re-reads versioned state and retries with expected version 2 -> succeeds.
            run_w2.current_stage = Stage::Design;
            let retry_v = store.update_run_cas(&run_w2, stored_v).await.unwrap();
            assert_eq!(retry_v, 3);

            let (final_run, final_v) = store.get_run_versioned(run.id).await.unwrap();
            assert_eq!(final_run.current_stage, Stage::Design);
            assert_eq!(final_v, 3);
        }

        #[tokio::test]
        async fn sequential_cas_updates_increment_version() {
            let store = temp_store().await;
            let project = sample_project();
            store.create_project(&project).await.unwrap();

            let mut run = sample_run(project.id);
            store.create_run(&run).await.unwrap();
            assert_eq!(store.get_run_version(run.id).await.unwrap(), 1);

            run.current_stage = Stage::Research;
            let v2 = store.update_run_cas(&run, 1).await.unwrap();
            assert_eq!(v2, 2);
            assert_eq!(store.get_run_version(run.id).await.unwrap(), 2);

            run.current_stage = Stage::PrdSpec;
            let v3 = store.update_run_cas(&run, 2).await.unwrap();
            assert_eq!(v3, 3);
            assert_eq!(store.get_run_version(run.id).await.unwrap(), 3);

            // A direct update_run also increments version to 4.
            run.current_stage = Stage::Design;
            store.update_run(&run).await.unwrap();
            assert_eq!(store.get_run_version(run.id).await.unwrap(), 4);

            // A stale expected version (3) now fails because version is 4.
            let err = store
                .update_run_cas(&run, 3)
                .await
                .expect_err("expected version 3 should conflict with version 4");
            assert!(matches!(
                err,
                StoreError::VersionConflict {
                    expected: 3,
                    actual: 4,
                    ..
                }
            ));
        }

        #[tokio::test]
        async fn reloading_run_version_reflects_version_bump() {
            let store = temp_store().await;
            let project = sample_project();
            store.create_project(&project).await.unwrap();

            let run = sample_run(project.id);
            store.create_run(&run).await.unwrap();

            let v = store.get_run_version(run.id).await.unwrap();
            assert_eq!(v, 1);

            let (loaded_run, loaded_v) = store.get_run_versioned(run.id).await.unwrap();
            assert_eq!(loaded_v, 1);
            assert_eq!(loaded_run.id, run.id);
        }

        #[tokio::test]
        async fn recovering_interrupted_runs_bumps_version() {
            let store = temp_store().await;
            let project = sample_project();
            store.create_project(&project).await.unwrap();

            let run = sample_run(project.id);
            store.create_run(&run).await.unwrap();
            assert_eq!(run.status, RunStatus::Running);
            assert_eq!(store.get_run_version(run.id).await.unwrap(), 1);

            let recovered = store.recover_interrupted_runs().await.unwrap();
            assert_eq!(recovered.len(), 1);
            assert_eq!(recovered[0].id, run.id);
            assert_eq!(recovered[0].status, RunStatus::Paused);

            // Version was bumped by the CAS update during recovery.
            let (stored, version) = store.get_run_versioned(run.id).await.unwrap();
            assert_eq!(stored.status, RunStatus::Paused);
            assert_eq!(version, 2);

            // Interrupted event was recorded on the run's log.
            let events = store.get_events(run.id).await.unwrap();
            assert!(events
                .iter()
                .any(|e| e.payload["action"] == "run_interrupted"));
        }
    }

    /// K6: upsert overwrites, the CHECK rejects an unknown permission, and all
    /// three accepted values round-trip in key order.
    #[tokio::test]
    async fn mcp_permissions_upsert_check_and_round_trip() {
        let temp = fresh_tempdir();
        let store = Store::open_at(temp.path().join("permissions.db"))
            .await
            .expect("the test store opens");
        store
            .set_mcp_permission("srv", "tool", "agent", "allow", "2026-01-01T00:00:00Z")
            .await
            .expect("allow writes");
        store
            .set_mcp_permission("srv", "tool", "agent", "deny", "2026-01-02T00:00:00Z")
            .await
            .expect("the upsert writes");
        store
            .set_mcp_permission("srv", "other", "reviewer", "ask", "2026-01-03T00:00:00Z")
            .await
            .expect("ask writes");

        let rows = store.load_mcp_permissions().await.expect("the rows load");
        assert_eq!(
            rows,
            vec![
                (
                    "srv".to_string(),
                    "other".to_string(),
                    "reviewer".to_string(),
                    "ask".to_string()
                ),
                (
                    "srv".to_string(),
                    "tool".to_string(),
                    "agent".to_string(),
                    "deny".to_string()
                ),
            ],
            "the upsert did not overwrite or the rows did not round-trip"
        );

        let refused = store
            .set_mcp_permission("srv", "tool", "agent", "permit", "2026-01-04T00:00:00Z")
            .await;
        assert!(
            refused.is_err(),
            "the CHECK constraint accepted an unknown permission"
        );
    }

    #[tokio::test]
    async fn sessions_crud_round_trip() {
        let temp = fresh_tempdir();
        let store = Store::open_at(temp.path().join("sessions_test.db"))
            .await
            .expect("the test store opens");

        let project = sample_project();
        store
            .create_project(&project)
            .await
            .expect("project creates");
        let run = sample_run(project.id);
        store.create_run(&run).await.expect("run creates");

        let session_id = SessionId::new();
        let session = Session {
            id: session_id,
            run_id: run.id,
            project_id: project.id,
            role: Role::Coder,
            backend: "claude-code".to_string(),
            provider: "anthropic".to_string(),
            model: "claude-3-7-sonnet".to_string(),
            status: SessionStatus::Starting,
            started_at: Utc::now(),
            ended_at: None,
            parent_session_id: None,
            cli_session_id: None,
        };

        store
            .create_session(&session)
            .await
            .expect("session creates");

        let fetched = store
            .get_session(session_id)
            .await
            .expect("session fetches")
            .expect("session is found");
        assert_eq!(fetched.id, session_id);
        assert_eq!(fetched.status, SessionStatus::Starting);
        assert_eq!(fetched.backend, "claude-code");

        store
            .update_session_status(session_id, SessionStatus::Working)
            .await
            .expect("status updates");

        store
            .update_session_cli_id(session_id, "cli-sess-1234")
            .await
            .expect("cli id updates");

        let working = store
            .get_session(session_id)
            .await
            .expect("session fetches")
            .expect("session is found");
        assert_eq!(working.status, SessionStatus::Working);
        assert_eq!(working.cli_session_id.as_deref(), Some("cli-sess-1234"));

        let end_time = Utc::now();
        store
            .finish_session(session_id, SessionStatus::Done, end_time)
            .await
            .expect("session finishes");

        let done = store
            .get_session(session_id)
            .await
            .expect("session fetches")
            .expect("session is found");
        assert_eq!(done.status, SessionStatus::Done);
        assert!(done.ended_at.is_some());

        let list = store
            .list_sessions_by_run(run.id)
            .await
            .expect("sessions list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, session_id);
    }
}
