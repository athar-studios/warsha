//! Warsha Pipeline — Stage engine, agent roles, prompts, gate state machine

use chrono::Utc;
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::{info, warn};
use ulid::Ulid;
use warsha_core::*;
use warsha_providers::{ChatMessage, ChatRequest, MessageRole, ProviderRouter};
use warsha_store::Store;

mod agent_loop;
mod agent_tools;
mod agent_workflow;
mod backend_kit;
mod build_cache;
mod evals;
mod guardrails;
mod handoff;
mod llm_cache;
mod mcp;
/// The MCP connection layer (PLAN.md M20), public as a module because
/// [`McpTransport`] and [`McpServerConfig`] already name the M12 registry types
/// at this crate's root: the two would collide in a flat re-export, and renaming
/// either would make the caller guess which one it got.
pub mod mcp_transport;
mod observability;
mod orchestrator;
mod post_launch;
mod preferences;
mod process_spawn;
mod prompts;
mod provider_setup;
mod router_quality;
mod routines;
mod run_modes;
mod scale_standards;
mod scout;
mod skills;
mod work_protection;

pub use crate::agent_loop::{
    AgentLoop, AgentTurnResult, ProviderRouterAdapter, Router, RouterError, AGENT_ROLE,
    TURN_CONTEXT_BUDGET_TOKENS,
};
pub use crate::agent_tools::{
    AgentTool, FilesystemToolExecutor, NoToolExecutor, ToolError, ToolExecutor, ToolResult,
};
pub use crate::agent_workflow::{
    AgentMode, AgentWorkflowError, AskUserQueue, AskUserRequest, CompressedOutput,
    ContextCompactor, Mention, MentionKind, MentionParser, Message, MessageBus, ModeManager,
    ModeTransition, OutputCompressor, SlashCommand, SlashCommandRegistry, TodoItem, TodoList,
    TodoStatus, CHARS_PER_TOKEN,
};
pub use crate::backend_kit::{
    is_safe_column_type, is_safe_identifier, BackendConfig, BackendFeature, BackendKind,
    BackendKit, BackendKitError, ColumnDef, ExportBundle, PaymentsGate, RlsOperation, RlsPolicy,
    TableDef,
};
pub use crate::build_cache::{
    BuildCache, BuildCacheEntry, BuildCacheKey, BuildCacheStats, InMemoryBuildCache,
};
pub use crate::evals::{blocks_change, run_suite, EvalCase, EvalError, EvalOutcome, EvalSuite};
pub use crate::guardrails::{
    classify_action, mask_secrets, wrap_untrusted, ApprovalRequest, Guardrails, InjectionSignal,
    InputOrigin, InspectionResult, SensitiveAction, REDACTED,
};
pub use crate::handoff::{
    backup_bundle_name, content_checksum, ApplyOptions, ApplyResult, Conflict, HandoffBundle,
    HandoffError, HandoffFile, HandoffManager, HandoffState,
};
pub use crate::llm_cache::{
    normalize_prompt, InMemoryLlmCache, LlmCache, LlmCacheEntry, LlmCacheKey, LlmCacheStats,
};
pub use crate::mcp::{
    McpClient, McpContent, McpError, McpRegistry, McpResource, McpServerConfig, McpTool,
    McpToolAnnotations, McpToolCall, McpToolResult, McpTransport, PermissionScope, ToolPermission,
    ToolPermissionEntry,
};
pub use crate::mcp_transport::{
    InMemoryMcpManager, McpConnection, McpManager, McpStatus, McpTransportError,
};
pub use crate::observability::{Span, SpanKind, SpanStatus, Tracer, RUN_ID_ATTRIBUTE};
pub use crate::orchestrator::{
    DiscoveryAnswer, DiscoveryCategory, DiscoveryQuestion, InputType, Orchestrator,
    OrchestratorConfig, OrchestratorState, OrchestratorStatus, ProjectBrief,
};
pub use crate::post_launch::{
    ChangeRequestStatus, ChangeRequestStore, CrashReport, CrashReportStore, DailySummary,
    DailySummaryBuilder, InMemoryChangeRequestStore, InMemoryCrashReportStore,
    InMemoryStoreReviewStore, PlainLanguageChangeRequest, PostLaunchError, StoreReview,
    StoreReviewStore, SummaryLanguage, MAX_RATING, MIN_RATING,
};
pub use crate::preferences::{
    decay_factor, InMemoryPreferenceStore, Preference, PreferenceError, PreferenceSignal,
    PreferenceStore, SignalKind, DECAY_HALF_LIFE_SECS, DEFAULT_SIGNAL_WEIGHT,
};
pub use crate::process_spawn::{
    InMemoryProcessManager, LivePreview, LivePreviewManager, ManagedProcess, ProcessError,
    ProcessManager, ProcessStatus, ProcessSummary,
};
pub use crate::provider_setup::{ConnectionTestResult, OneClickProvider, ProviderSetupWizard};
pub use crate::router_quality::{
    CostEntry, CostSink, EcoMode, EcoModeDecision, LocalFallbackPolicy, ModelTier, PerTaskDefault,
    PerTaskDefaults, ResponseCache, RouterPolicy, RouterTarget, TargetKind, TaskDifficulty,
};
pub use crate::routines::{
    MockRoutineRunner, Routine, RoutineAction, RoutineError, RoutineId, RoutineRegistry,
    RoutineRunner, RoutineSchedule, RoutineState,
};
pub use crate::run_modes::{
    is_loopback_host, InMemoryPairingStore, PairingStore, PhonePairing, RunMode, RunModeConfig,
    RunModeError, LOCALHOST, LOOPBACK_HOST, REDACTED_SECRET, WILDCARD_HOST,
};
pub use crate::scale_standards::{ScaleCategory, ScaleStandard, ScaleStandards, SCALE_STANDARDS};
pub use crate::scout::{
    Scout, ScoutConfig, ScoutDependency, ScoutError, ScoutProposal, ScoutResult, ScoutSource,
};
pub use crate::skills::{
    default_role_packs, load_skill_from_dir, LicenseClass, RolePack, Skill, SkillDependency,
    SkillError, SkillManifest, SkillRegistry, SkillSource, SkillsLockEntry, SkillsLockfile,
};
pub use crate::work_protection::{
    InMemorySnapshotStore, PermissionMode, ReadBeforeWriteGuard, Snapshot, SnapshotFile,
    SnapshotStore, UndoEntry, UndoStack, WorkProtectionError, WorkProtectionPolicy,
    MAX_UNDO_ENTRIES,
};

// Helper to get stage as string
fn stage_to_string(stage: Stage) -> &'static str {
    match stage {
        Stage::Idea => "idea",
        Stage::GateA => "gate_a",
        Stage::Research => "research",
        Stage::PrdSpec => "prd_spec",
        Stage::GateB => "gate_b",
        Stage::Design => "design",
        Stage::PlanTasks => "plan_tasks",
        Stage::Code => "code",
        Stage::ReviewQaSecurity => "review_qa_security",
        Stage::GateC => "gate_c",
        Stage::Release => "release",
        Stage::GateD => "gate_d",
        Stage::LaunchDrafts => "launch_drafts",
        Stage::Feedback => "feedback",
    }
}

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
    #[allow(dead_code)]
    providers: Arc<RwLock<ProviderRouter>>,
    orchestrator: Orchestrator,
}

impl PipelineEngine {
    pub fn new(store: Arc<Store>, providers: Arc<RwLock<ProviderRouter>>) -> Self {
        Self {
            store,
            providers,
            orchestrator: Orchestrator::new(OrchestratorConfig::default()),
        }
    }

    /// Start a new run for a project
    pub async fn start_run(&self, project_id: ProjectId, idea: &str) -> Result<Run> {
        let _project = self.store.get_project(project_id).await?;

        let mut run = Run {
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
                run.gate_states.insert(*stage, GateState::Pending);
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

        // Run orchestrator discovery interview
        let mut orchestrator_state = self.orchestrator.start_discovery(project_id, run.id);

        // Auto-answer required questions with defaults for automated runs
        // In real usage, this would be interactive via CLI/desktop
        for question in self.orchestrator.questions() {
            if question.required {
                let default_value = match question.input_type {
                    crate::orchestrator::InputType::Text => serde_json::json!("To be determined"),
                    crate::orchestrator::InputType::MultiSelect => serde_json::json!(["Web"]),
                    crate::orchestrator::InputType::SingleSelect => serde_json::json!("Free"),
                    crate::orchestrator::InputType::Boolean => serde_json::json!(false),
                    crate::orchestrator::InputType::Number => serde_json::json!(10000),
                };
                orchestrator_state = self.orchestrator.answer_question(
                    orchestrator_state,
                    question.id.clone(),
                    default_value,
                );
            }
        }

        // Create brief artifact
        let brief_markdown = self.orchestrator.get_brief_markdown(&orchestrator_state);
        let brief_artifact = Artifact {
            name: "brief".to_string(),
            content: brief_markdown,
            stage: Stage::Idea,
            role: Some(Role::Intake),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            version: 1,
        };
        run.artifacts.insert("brief".to_string(), brief_artifact);

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
            let gate_state = run
                .gate_states
                .get(&current)
                .cloned()
                .unwrap_or(GateState::Pending);
            if !matches!(gate_state, GateState::Approved { .. }) {
                return Err(PipelineError::GateNotPending(current));
            }
        }

        run.current_stage = next;
        run.updated_at = Utc::now();

        // Emit event for stage start
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

        // Execute the new stage (unless it's a gate or final stage)
        if !next.is_gate() && next != Stage::Feedback {
            self.execute_stage(&mut run).await?;
            self.store.update_run(&run).await?;
        }

        info!("Run {} advanced from {:?} to {:?}", run_id.0, current, next);
        Ok(run)
    }

    /// Execute the role's agent step for the current stage
    async fn execute_stage(&self, run: &mut Run) -> Result<()> {
        let stage = run.current_stage;
        let role = match crate::prompts::role_for_stage(stage) {
            Some(r) => r,
            None => return Ok(()), // Gates don't execute, they just wait for approval
        };

        // Build context from previous artifacts
        let context = self.build_context(run);

        // Get the prompt template
        let prompt_template = crate::prompts::get_prompt(role);

        // Render the prompt with context
        let prompt = self.render_prompt(prompt_template, &context);

        // Call the provider
        let mut providers = self.providers.write().await;
        let request = ChatRequest {
            model: "default".to_string(), // Will be resolved by router
            messages: vec![ChatMessage {
                role: MessageRole::System,
                content: prompt,
            }],
            temperature: Some(0.7),
            max_tokens: Some(4000),
            stream: false,
        };

        let response = providers
            .chat_with_fallback(role, &run.project_id.0.to_string(), request)
            .await?;

        // Parse the JSON response
        let artifact_content = response
            .choices
            .first()
            .map(|c| c.message.content.clone())
            .unwrap_or_default();

        // Calculate cost
        let cost_cents = providers.cost_of(&response.model, &response.usage)?;
        let tokens = Some(response.usage.clone());

        // Create artifact
        let artifact = Artifact {
            name: stage_to_string(stage).to_lowercase(),
            content: artifact_content,
            stage,
            role: Some(role),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            version: 1,
        };

        // Write artifact to factory and record in run
        self.store
            .write_artifact(run.project_id, &artifact.name, &artifact.content)
            .await?;
        run.artifacts.insert(artifact.name.clone(), artifact);

        // Record cost
        run.spent_cents += cost_cents;

        // Emit event
        let event = Event {
            id: Ulid::new(),
            run_id: run.id,
            stage,
            role: Some(role),
            kind: EventKind::AgentStep,
            payload: serde_json::json!({ "role": role, "stage": stage }),
            cost_cents: Some(cost_cents),
            tokens,
            created_at: Utc::now(),
            device_id: None,
        };
        self.store.append_event(&event).await?;

        // Check budget
        if let Some(budget) = run.budget_cents {
            if run.spent_cents >= budget {
                let budget_event = Event {
                    id: Ulid::new(),
                    run_id: run.id,
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
                warn!(
                    "Budget exceeded for run {}: {} >= {}",
                    run.id.0, run.spent_cents, budget
                );
            } else if run.spent_cents as f64 >= budget as f64 * 0.8 {
                let warn_event = Event {
                    id: Ulid::new(),
                    run_id: run.id,
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

    /// Build context from previous artifacts for the prompt
    fn build_context(&self, run: &Run) -> serde_json::Value {
        let mut context = serde_json::Map::new();

        // Add all previous artifacts
        for (name, artifact) in &run.artifacts {
            context.insert(
                name.clone(),
                serde_json::json!({
                    "content": artifact.content,
                    "stage": artifact.stage,
                    "role": artifact.role,
                }),
            );
        }

        // Add gate states
        let gate_states: serde_json::Map<_, _> = run
            .gate_states
            .iter()
            .map(|(k, v)| {
                (
                    stage_to_string(*k).to_lowercase(),
                    // Gate states are plain data, so serialization cannot fail here.
                    serde_json::to_value(v).unwrap_or_default(),
                )
            })
            .collect();
        context.insert(
            "gate_states".to_string(),
            serde_json::Value::Object(gate_states),
        );

        serde_json::Value::Object(context)
    }

    /// Simple template rendering - replace {{key}} with values
    fn render_prompt(&self, template: &str, context: &serde_json::Value) -> String {
        let mut result = template.to_string();

        // Replace {{idea}} with the original idea
        if let Some(idea) = context
            .get("idea")
            .and_then(|v| v.get("content"))
            .and_then(|v| v.as_str())
        {
            result = result.replace("{{idea}}", idea);
        }

        // Replace {{brief}} with the brief content
        if let Some(brief) = context
            .get("brief")
            .and_then(|v| v.get("content"))
            .and_then(|v| v.as_str())
        {
            result = result.replace("{{brief}}", brief);
        }

        // Replace {{research}} with research content
        if let Some(research) = context
            .get("research")
            .and_then(|v| v.get("content"))
            .and_then(|v| v.as_str())
        {
            result = result.replace("{{research}}", research);
        }

        // Replace {{prd}} with PRD content
        if let Some(prd) = context
            .get("prd_spec")
            .and_then(|v| v.get("content"))
            .and_then(|v| v.as_str())
        {
            result = result.replace("{{prd}}", prd);
        }

        // Replace {{design}} with design content
        if let Some(design) = context
            .get("design")
            .and_then(|v| v.get("content"))
            .and_then(|v| v.as_str())
        {
            result = result.replace("{{design}}", design);
        }

        // Replace {{architecture}} with architecture content
        if let Some(arch) = context
            .get("design")
            .and_then(|v| v.get("content"))
            .and_then(|v| v.as_str())
        {
            result = result.replace("{{architecture}}", arch);
        }

        // Replace {{task}} with task description
        if let Some(task) = context
            .get("plan_tasks")
            .and_then(|v| v.get("content"))
            .and_then(|v| v.as_str())
        {
            result = result.replace("{{task}}", task);
        }

        // Replace {{code}} with code content
        if let Some(code) = context
            .get("code")
            .and_then(|v| v.get("content"))
            .and_then(|v| v.as_str())
        {
            result = result.replace("{{code}}", code);
        }

        // Replace {{language}} with project language
        let _ = context
            .get("idea")
            .and_then(|v| v.get("stage"))
            .and_then(|v| v.as_str());
        // This is a simplification - in reality we'd get language from project
        result = result.replace("{{language}}", "en");

        result
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use warsha_core::{RoleRouting, RoutingTarget};
    use warsha_providers::{MockProvider, ProviderRouter};
    use warsha_store::Store;

    async fn temp_store() -> Arc<Store> {
        let dir = tempdir().unwrap();
        let path = dir.path().join("test.db");
        let store = Store::open_at(path).await.unwrap();
        std::mem::forget(dir);
        Arc::new(store)
    }

    fn setup_providers_with_mock() -> Arc<RwLock<ProviderRouter>> {
        let mut router = ProviderRouter::new();
        let mock = MockProvider::new("test");
        router.register_provider(Box::new(mock));
        router.set_role_routing(RoleRouting {
            role: Role::Designer,
            targets: vec![RoutingTarget {
                provider_id: "test".to_string(),
                model_id: "mock-model".to_string(),
                weight: 100,
            }],
            fallback_enabled: false,
            budget_cents_per_run: None,
        });
        Arc::new(RwLock::new(router))
    }

    #[tokio::test]
    async fn test_pipeline_start_run() {
        let store = temp_store().await;
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
        let store = temp_store().await;
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
        let store = temp_store().await;
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

    #[tokio::test]
    async fn test_gate_b_blocks_advance_to_design() {
        let store = temp_store().await;
        let providers = setup_providers_with_mock();
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
        run.current_stage = Stage::PrdSpec;
        store.update_run(&run).await.unwrap();

        // Spec stage advances into Gate B, but Gate B itself cannot be passed.
        let run = engine.advance_stage(run.id).await.unwrap();
        assert_eq!(run.current_stage, Stage::GateB);
        assert!(matches!(
            engine.advance_stage(run.id).await,
            Err(PipelineError::GateNotPending(Stage::GateB))
        ));

        let device = DeviceId::new();
        engine
            .approve_gate(run.id, Stage::GateB, device)
            .await
            .unwrap();

        let run = engine.advance_stage(run.id).await.unwrap();
        assert_eq!(run.current_stage, Stage::Design);
    }
}
