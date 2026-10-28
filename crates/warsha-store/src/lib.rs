//! Warsha Store — SQLite persistence layer with migrations.
//!
//! Uses runtime `sqlx` queries (no compile-time `DATABASE_URL` requirement) and
//! stores identifiers as their text/byte encodings described in
//! `migrations/001_initial.sql`.

use chrono::{DateTime, Utc};
use sqlx::migrate::MigrateDatabase;
use sqlx::{Row, SqlitePool};
use std::collections::HashMap;
use std::path::PathBuf;
use thiserror::Error;
use tracing::info;
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
        if !sqlx::Sqlite::database_exists(&db_url).await.unwrap_or(false) {
            info!("creating database at {}", db_path.display());
            sqlx::Sqlite::create_database(&db_url)
                .await
                .map_err(|e| StoreError::Migration(e.to_string()))?;
        }
        let pool = SqlitePool::connect(&db_url).await?;
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
}
