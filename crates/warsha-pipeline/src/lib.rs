//! Warsha Pipeline — Stage engine, agent roles, prompts, gate state machine

use std::sync::Arc;
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::{info, warn};
use warsha_core::*;
use warsha_providers::ProviderRouter;
use warsha_store::Store;

#[derive(Error, Debug)]
pub enum PipelineError {
    #[error("Store error: {0}")]
    Store(#[from] warsha_store::StoreError),
    #[error("Provider error: {0}")]
    Provider(#[from] warsha_providers::ProviderError),
    #[error("Run not found: {0}")]
    RunNotFound(RunId),
    #[error("Project not found: {0}")]
    ProjectNotFound(ProjectId),
    #[error("Gate not pending: {0:?}")]
    GateNotPending(Stage),
    #[error("Invalid stage transition: {0:?} -> {1:?}")]
    InvalidTransition(Stage, Stage),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Other: {0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, PipelineError>;

/// Pipeline engine that drives the stage machine
pub struct PipelineEngine {
    store: Arc<Store>,
    providers: Arc<RwLock<ProviderRouter>>,
}

impl PipelineEngine {
    pub fn new(store: Arc<Store>, providers: Arc<RwLock<ProviderRouter>>) -> Self {
        Self { store, providers }
    }

    /// Start a new run for a project
    pub async fn start_run(&self, project_id: ProjectId, idea: &str) -> Result<Run> {
        let project = self.store.get_project(project_id).await?;

        let run = Run {
            id: RunId::new(),
            project_id,
            current_stage: Stage::Idea,
            gate_states: HashMap::new(),
            artifacts: HashMap::new(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            status: RunStatus::Running,
            budget_cents: None,
            spent_cents: 0,
        };

        // Initialize gate states for all gate stages
        for stage in Stage::all() {
            if stage.is_gate() {
                run.gate_states.insert(stage, GateState::Pending);
            }
        }

        // Create initial artifact: idea.md
        let idea_artifact = Artifact {
            name: "idea".to_string(),
            content: idea.to_string(),
            stage: Stage::Idea,
            role: Some(Role::Intake),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            version: 1,
        };
        run.artifacts.insert("idea".to_string(), idea_artifact);

        self.store.create_run(&run).await?;

        // Emit event
        let event = Event {
            id: Ulid::new(),
            run_id: run.id,
            stage: Stage::Idea,
            role: Some(Role::Intake),
            kind: EventKind::StageStarted,
            payload: serde_json::json!({ "action": "start_run", "idea": idea }),
            cost_cents: None,
            tokens: None,
            created_at: Utc::now(),
            device_id: None,
        };
        self.store.append_event(&event).await?;

        info!("Started run {} for project {}", run.id.0, project_id.0);
        Ok(run)
    }

    /// Advance to the next stage
    pub async fn advance_stage(&self, run_id: RunId) -> Result<Run> {
        let mut run = self.store.get_run(run_id).await?;

        if run.status != RunStatus::Running {
            return Err(PipelineError::Other(format!(
                "Run is not running: {:?}",
                run.status
            )));
        }

        let current = run.current_stage;
        let next = current
            .next()
            .ok_or(PipelineError::InvalidTransition(current, current))?;

        // Check if we're at a gate that needs approval
        if current.is_gate() {
            let gate_state = run.gate_states.get(&current).unwrap_or(&GateState::Pending);
            if !matches!(gate_state, GateState::Approved { .. }) {
                return Err(PipelineError::GateNotPending(current));
            }
        }

        run.current_stage = next;
        run.updated_at = Utc::now();

        // Emit event
        let event = Event {
            id: Ulid::new(),
            run_id,
            stage: next,
            role: None,
            kind: EventKind::StageStarted,
            payload: serde_json::json!({ "from": current, "to": next }),
            cost_cents: None,
            tokens: None,
            created_at: Utc::now(),
            device_id: None,
        };
        self.store.append_event(&event).await?;
        self.store.update_run(&run).await?;

        info!("Run {} advanced from {:?} to {:?}", run_id.0, current, next);
        Ok(run)
    }

    /// Approve a gate
    pub async fn approve_gate(
        &self,
        run_id: RunId,
        stage: Stage,
        device_id: DeviceId,
    ) -> Result<Run> {
        let mut run = self.store.get_run(run_id).await?;

        if !stage.is_gate() {
            return Err(PipelineError::Other(format!(
                "{:?} is not a gate stage",
                stage
            )));
        }

        let gate_state = run
            .gate_states
            .get_mut(&stage)
            .ok_or(PipelineError::Other("Gate not found".to_string()))?;
        if !matches!(gate_state, GateState::Pending) {
            return Err(PipelineError::GateNotPending(stage));
        }

        *gate_state = GateState::Approved {
            by: device_id,
            at: Utc::now(),
        };
        run.updated_at = Utc::now();

        let event = Event {
            id: Ulid::new(),
            run_id,
            stage,
            role: None,
            kind: EventKind::GateDecision,
            payload: serde_json::json!({ "decision": "approved", "by": device_id.0 }),
            cost_cents: None,
            tokens: None,
            created_at: Utc::now(),
            device_id: Some(device_id),
        };
        self.store.append_event(&event).await?;
        self.store.update_run(&run).await?;

        info!(
            "Gate {:?} approved for run {} by device {}",
            stage, run_id.0, device_id.0
        );
        Ok(run)
    }

    /// Reject a gate
    pub async fn reject_gate(
        &self,
        run_id: RunId,
        stage: Stage,
        reason: String,
        device_id: DeviceId,
    ) -> Result<Run> {
        let mut run = self.store.get_run(run_id).await?;

        if !stage.is_gate() {
            return Err(PipelineError::Other(format!(
                "{:?} is not a gate stage",
                stage
            )));
        }

        let gate_state = run
            .gate_states
            .get_mut(&stage)
            .ok_or(PipelineError::Other("Gate not found".to_string()))?;
        if !matches!(gate_state, GateState::Pending) {
            return Err(PipelineError::GateNotPending(stage));
        }

        *gate_state = GateState::Rejected {
            reason: reason.clone(),
            by: device_id,
            at: Utc::now(),
        };
        run.updated_at = Utc::now();
        run.status = RunStatus::Paused;

        let event = Event {
            id: Ulid::new(),
            run_id,
            stage,
            role: None,
            kind: EventKind::GateDecision,
            payload: serde_json::json!({ "decision": "rejected", "reason": reason, "by": device_id.0 }),
            cost_cents: None,
            tokens: None,
            created_at: Utc::now(),
            device_id: Some(device_id),
        };
        self.store.append_event(&event).await?;
        self.store.update_run(&run).await?;

        info!(
            "Gate {:?} rejected for run {} by device {}: {}",
            stage, run_id.0, device_id.0, reason
        );
        Ok(run)
    }

    /// Request changes at a gate
    pub async fn request_changes(
        &self,
        run_id: RunId,
        stage: Stage,
        notes: String,
        device_id: DeviceId,
    ) -> Result<Run> {
        let mut run = self.store.get_run(run_id).await?;

        if !stage.is_gate() {
            return Err(PipelineError::Other(format!(
                "{:?} is not a gate stage",
                stage
            )));
        }

        let gate_state = run
            .gate_states
            .get_mut(&stage)
            .ok_or(PipelineError::Other("Gate not found".to_string()))?;
        if !matches!(gate_state, GateState::Pending) {
            return Err(PipelineError::GateNotPending(stage));
        }

        *gate_state = GateState::ChangesRequested {
            notes: notes.clone(),
            by: device_id,
            at: Utc::now(),
        };
        run.updated_at = Utc::now();
        run.status = RunStatus::Paused;

        let event = Event {
            id: Ulid::new(),
            run_id,
            stage,
            role: None,
            kind: EventKind::GateDecision,
            payload: serde_json::json!({ "decision": "changes_requested", "notes": notes, "by": device_id.0 }),
            cost_cents: None,
            tokens: None,
            created_at: Utc::now(),
            device_id: Some(device_id),
        };
        self.store.append_event(&event).await?;
        self.store.update_run(&run).await?;

        info!(
            "Gate {:?} changes requested for run {} by device {}",
            stage, run_id.0, device_id.0
        );
        Ok(run)
    }

    /// Create or update an artifact
    pub async fn upsert_artifact(&self, run_id: RunId, artifact: Artifact) -> Result<()> {
        let mut run = self.store.get_run(run_id).await?;
        run.artifacts
            .insert(artifact.name.clone(), artifact.clone());
        run.updated_at = Utc::now();

        // Write to factory directory
        self.store
            .write_artifact(run.project_id, &artifact.name, &artifact.content)
            .await?;

        let event = Event {
            id: Ulid::new(),
            run_id,
            stage: artifact.stage,
            role: artifact.role,
            kind: EventKind::ArtifactCreated,
            payload: serde_json::json!({ "artifact": artifact.name, "stage": artifact.stage }),
            cost_cents: None,
            tokens: None,
            created_at: Utc::now(),
            device_id: None,
        };
        self.store.append_event(&event).await?;
        self.store.update_run(&run).await?;

        Ok(())
    }

    /// Record cost
    pub async fn record_cost(
        &self,
        run_id: RunId,
        stage: Stage,
        role: Option<Role>,
        cost_cents: u64,
        tokens: Option<TokenUsage>,
    ) -> Result<()> {
        let mut run = self.store.get_run(run_id).await?;
        run.spent_cents += cost_cents;
        run.updated_at = Utc::now();

        let event = Event {
            id: Ulid::new(),
            run_id,
            stage,
            role,
            kind: EventKind::CostRecorded,
            payload: serde_json::json!({ "cost_cents": cost_cents }),
            cost_cents: Some(cost_cents),
            tokens,
            created_at: Utc::now(),
            device_id: None,
        };
        self.store.append_event(&event).await?;
        self.store.update_run(&run).await?;

        // Check budget
        if let Some(budget) = run.budget_cents {
            if run.spent_cents >= budget {
                let budget_event = Event {
                    id: Ulid::new(),
                    run_id,
                    stage,
                    role: None,
                    kind: EventKind::BudgetExceeded,
                    payload: serde_json::json!({ "budget_cents": budget, "spent_cents": run.spent_cents }),
                    cost_cents: None,
                    tokens: None,
                    created_at: Utc::now(),
                    device_id: None,
                };
                self.store.append_event(&budget_event).await?;
                run.status = RunStatus::Paused;
                self.store.update_run(&run).await?;
                warn!(
                    "Budget exceeded for run {}: {} >= {}",
                    run_id.0, run.spent_cents, budget
                );
            } else if run.spent_cents as f64 >= budget as f64 * 0.8 {
                let warn_event = Event {
                    id: Ulid::new(),
                    run_id,
                    stage,
                    role: None,
                    kind: EventKind::BudgetWarning,
                    payload: serde_json::json!({ "budget_cents": budget, "spent_cents": run.spent_cents, "percent": (run.spent_cents as f64 / budget as f64 * 100.0) as u32 }),
                    cost_cents: None,
                    tokens: None,
                    created_at: Utc::now(),
                    device_id: None,
                };
                self.store.append_event(&warn_event).await?;
            }
        }

        Ok(())
    }

    /// Get run with all events
    pub async fn get_run_with_events(&self, run_id: RunId) -> Result<(Run, Vec<Event>)> {
        let run = self.store.get_run(run_id).await?;
        let events = self.store.get_events(run_id).await?;
        Ok((run, events))
    }
}

use std::collections::HashMap;

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use warsha_providers::ProviderRouter;
    use warsha_store::Store;

    #[tokio::test]
    async fn test_pipeline_start_run() {
        let store = Arc::new(Store::new().await.unwrap());
        let providers = Arc::new(RwLock::new(ProviderRouter::new()));
        let engine = PipelineEngine::new(store.clone(), providers);

        // Create a project first
        let project = Project {
            id: ProjectId::new(),
            name: "Test Project".to_string(),
            description: "Test".to_string(),
            language: "en".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            repo_path: None,
            repo_url: None,
        };
        store.create_project(&project).await.unwrap();

        let run = engine
            .start_run(project.id, "Build a todo app")
            .await
            .unwrap();
        assert_eq!(run.current_stage, Stage::Idea);
        assert!(run.artifacts.contains_key("idea"));
    }

    #[tokio::test]
    async fn test_gate_approval() {
        let store = Arc::new(Store::new().await.unwrap());
        let providers = Arc::new(RwLock::new(ProviderRouter::new()));
        let engine = PipelineEngine::new(store.clone(), providers);

        let project = Project {
            id: ProjectId::new(),
            name: "Test Project".to_string(),
            description: "Test".to_string(),
            language: "en".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            repo_path: None,
            repo_url: None,
        };
        store.create_project(&project).await.unwrap();

        let run = engine
            .start_run(project.id, "Build a todo app")
            .await
            .unwrap();

        // Advance to GateC (need to go through stages first)
        // For testing, directly set to GateC
        let mut run = store.get_run(run.id).await.unwrap();
        run.current_stage = Stage::GateC;
        run.gate_states.insert(Stage::GateC, GateState::Pending);
        store.update_run(&run).await.unwrap();

        let device = DeviceId::new();
        let run = engine
            .approve_gate(run.id, Stage::GateC, device)
            .await
            .unwrap();

        let gate_state = run.gate_states.get(&Stage::GateC).unwrap();
        assert!(matches!(gate_state, GateState::Approved { .. }));
    }

    #[tokio::test]
    async fn test_gate_rejection() {
        let store = Arc::new(Store::new().await.unwrap());
        let providers = Arc::new(RwLock::new(ProviderRouter::new()));
        let engine = PipelineEngine::new(store.clone(), providers);

        let project = Project {
            id: ProjectId::new(),
            name: "Test Project".to_string(),
            description: "Test".to_string(),
            language: "en".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            repo_path: None,
            repo_url: None,
        };
        store.create_project(&project).await.unwrap();

        let mut run = engine
            .start_run(project.id, "Build a todo app")
            .await
            .unwrap();
        run.current_stage = Stage::GateC;
        run.gate_states.insert(Stage::GateC, GateState::Pending);
        store.update_run(&run).await.unwrap();

        let device = DeviceId::new();
        let run = engine
            .reject_gate(
                run.id,
                Stage::GateC,
                "Needs more detail".to_string(),
                device,
            )
            .await
            .unwrap();

        let gate_state = run.gate_states.get(&Stage::GateC).unwrap();
        assert!(matches!(gate_state, GateState::Rejected { .. }));
        assert_eq!(run.status, RunStatus::Paused);
    }
}
