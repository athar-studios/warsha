//! Warsha Store — SQLite persistence layer with migrations.
//!
//! Uses runtime `sqlx` queries (no compile-time `DATABASE_URL` requirement) and
//! stores identifiers as their text/byte encodings described in
//! `migrations/001_initial.sql`.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::migrate::MigrateDatabase;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::collections::HashMap;
use std::path::PathBuf;
use thiserror::Error;
use tracing::info;
use ulid::Ulid;
use uuid::Uuid;
use warsha_core::{
    Artifact, DeviceId, Event, EventKind, GateState, Project, ProjectId, Role, Run, RunId,
    RunStatus, Stage, TokenUsage,
};

/// Errors raised by the persistence layer.
#[derive(Debug, Error)]
pub enum StoreError {
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
    /// Cost in cents.
    pub cost_cents: u64,
    /// Row creation timestamp.
    pub created_at: DateTime<Utc>,
}

/// Thin wrapper around a SQLite connection pool.
pub struct Store {
    pool: SqlitePool,
    db_path: PathBuf,
}

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
        let options = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new().connect_with(options).await?;
        Self::run_migrations(&pool).await?;
        Ok(Self { pool, db_path })
    }

    async fn run_migrations(pool: &SqlitePool) -> Result<()> {
        sqlx::migrate!("./migrations")
            .run(pool)
            .await
            .map_err(|e| StoreError::Migration(e.to_string()))?;
        Ok(())
    }

    /// Borrow the underlying pool.
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// Path of the database file backing this store.
    pub fn db_path(&self) -> &PathBuf {
        &self.db_path
    }

    // ---------------------------------------------------------------- projects

    /// Insert a new project.
    pub async fn create_project(&self, project: &Project) -> Result<()> {
        sqlx::query(
            "INSERT INTO projects \
             (id, name, description, language, created_at, updated_at, repo_path, repo_url) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(project.id.0.as_bytes().to_vec())
        .bind(&project.name)
        .bind(&project.description)
        .bind(&project.language)
        .bind(project.created_at.to_rfc3339())
        .bind(project.updated_at.to_rfc3339())
        .bind(&project.repo_path)
        .bind(&project.repo_url)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Fetch a project by id.
    pub async fn get_project(&self, id: ProjectId) -> Result<Project> {
        let row = sqlx::query(
            "SELECT id, name, description, language, created_at, updated_at, repo_path, repo_url \
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
            "SELECT id, name, description, language, created_at, updated_at, repo_path, repo_url \
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
             repo_path = ?, repo_url = ? WHERE id = ?",
        )
        .bind(&project.name)
        .bind(&project.description)
        .bind(&project.language)
        .bind(project.updated_at.to_rfc3339())
        .bind(&project.repo_path)
        .bind(&project.repo_url)
        .bind(project.id.0.as_bytes().to_vec())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    // ------------------------------------------------------------------- runs

    /// Insert a new run.
    pub async fn create_run(&self, run: &Run) -> Result<()> {
        sqlx::query(
            "INSERT INTO runs (id, project_id, current_stage, gate_states, artifacts, \
             created_at, updated_at, status, budget_cents, spent_cents) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Fetch a run by id.
    pub async fn get_run(&self, id: RunId) -> Result<Run> {
        let row = sqlx::query(
            "SELECT id, project_id, current_stage, gate_states, artifacts, created_at, \
             updated_at, status, budget_cents, spent_cents FROM runs WHERE id = ?",
        )
        .bind(id.0.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(StoreError::RunNotFound(id))?;
        run_from_row(&row)
    }

    /// Update a run's mutable fields.
    pub async fn update_run(&self, run: &Run) -> Result<()> {
        sqlx::query(
            "UPDATE runs SET current_stage = ?, gate_states = ?, artifacts = ?, updated_at = ?, \
             status = ?, budget_cents = ?, spent_cents = ? WHERE id = ?",
        )
        .bind(serde_json::to_string(&run.current_stage)?)
        .bind(serde_json::to_string(&run.gate_states)?)
        .bind(serde_json::to_string(&run.artifacts)?)
        .bind(run.updated_at.to_rfc3339())
        .bind(serde_json::to_string(&run.status)?)
        .bind(run.budget_cents.map(|v| v as i64))
        .bind(run.spent_cents as i64)
        .bind(run.id.0.to_string())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// List runs belonging to a project, newest first.
    pub async fn list_runs(&self, project_id: ProjectId) -> Result<Vec<Run>> {
        let rows = sqlx::query(
            "SELECT id, project_id, current_stage, gate_states, artifacts, created_at, \
             updated_at, status, budget_cents, spent_cents FROM runs \
             WHERE project_id = ? ORDER BY created_at DESC",
        )
        .bind(project_id.0.as_bytes().to_vec())
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(run_from_row).collect()
    }

    // ----------------------------------------------------------------- events

    /// Append an event to a run's append-only log.
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

    // ------------------------------------------------------------------ gates

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

    // ------------------------------------------------------------------ costs

    /// Record one model call's token usage and cost.
    pub async fn record_cost(&self, cost: &CostRecord) -> Result<()> {
        let agent_role = match cost.agent_role {
            Some(role) => Some(serde_json::to_string(&role)?),
            None => None,
        };
        sqlx::query(
            "INSERT INTO costs (id, run_id, project_id, agent_role, provider_id, model_id, \
             prompt_tokens, completion_tokens, cost_cents, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(cost.id.to_string())
        .bind(cost.run_id.0.to_string())
        .bind(cost.project_id.0.as_bytes().to_vec())
        .bind(agent_role)
        .bind(&cost.provider_id)
        .bind(&cost.model_id)
        .bind(cost.prompt_tokens as i64)
        .bind(cost.completion_tokens as i64)
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
             completion_tokens, cost_cents, created_at FROM costs WHERE run_id = ? \
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
    Ok(Project {
        id: ProjectId(parse_uuid("projects.id", &column_blob(row, "id")?)?),
        name: column_text(row, "name")?,
        description: column_text(row, "description")?,
        language: column_text(row, "language")?,
        created_at: parse_time("projects.created_at", &column_text(row, "created_at")?)?,
        updated_at: parse_time("projects.updated_at", &column_text(row, "updated_at")?)?,
        repo_path: column_opt_text(row, "repo_path")?,
        repo_url: column_opt_text(row, "repo_url")?,
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
    let device_id = match column_opt_int(row, "device_id")? {
        Some(_) => Some(DeviceId(parse_uuid(
            "events.device_id",
            &column_blob(row, "device_id")?,
        )?)),
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
        cost_cents: column_int(row, "cost_cents")?.unsigned_abs(),
        created_at: parse_time("costs.created_at", &column_text(row, "created_at")?)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

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
        }
    }

    async fn temp_store() -> Store {
        let dir = tempfile::tempdir().unwrap();
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
}
