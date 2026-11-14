//! Warsha Pipeline — Stage engine, agent roles, prompts, gate state machine

use crate::settings::{SettingsProvider, SettingsStore};
use chrono::Utc;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::{info, warn};
use ulid::Ulid;
use warsha_core::*;
use warsha_providers::{
    ChatMessage, ChatProvider, ChatRequest, EnvLlmConfig, FakeProvider, MessageRole,
    OpenAIProvider, ProviderRouter,
};
use warsha_store::Store;

mod agent_loop;
pub mod agent_sessions;
mod agent_tools;
mod agent_workflow;
mod backend_kit;
pub mod coding_backend;
pub use crate::coding_backend::{
    BackendError, CodingBackend, CodingResult, CodingTask, FileAction, Sandbox, TaskFile,
};
mod build_cache;
mod command_policy;
mod evals;
pub mod gate_evidence;
mod gate_integrity;
mod guardrails;
mod handoff;
mod llm_cache;
pub mod mcp;
pub mod mcp_approval;
pub mod mcp_permission;
pub mod worktree;
pub use crate::agent_sessions::{AgentSessionError, RunAgentSessions};
pub use crate::gate_evidence::{
    collect_gate_evidence, GateEvidence, GateEvidenceError, TestRun, GATE_EVIDENCE_CAPTURE_BYTES,
    GATE_EVIDENCE_TIMEOUT,
};
pub use crate::mcp_approval::{
    canonical_json, ApprovalError, ArgumentSummarizer, Grant, KeysOnlySummarizer, McpApprovals,
    PendingApproval, PendingApprovalView, ResolvedApproval, TakeOutcome, MAX_PENDING_PER_RUN,
    MCP_ONCE_GRANT_TTL, PENDING_TTL,
};
pub use crate::mcp_permission::{
    AskEverything, McpPermissionSource, McpPermissionStore, StaticPermissions, MCP_AGENT_ROLE,
};
pub use crate::worktree::{
    create_run_worktree, remove_run_worktree, worktree_path, RunWorktree, WorktreeError,
};
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
mod run_integrity;
mod run_modes;
mod scale_standards;
mod scout;
pub mod settings;
mod skills;
#[cfg(test)]
mod status_truth;
/// Test-only helpers shared by this crate's test modules.
#[cfg(test)]
pub(crate) mod test_util;
mod work_protection;

pub use crate::agent_loop::{
    AgentLoop, AgentTurnResult, ExecutedTurn, PreparedTurn, ProviderRouterAdapter, Router,
    RouterError, AGENT_ROLE, TURN_CONTEXT_BUDGET_TOKENS,
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
    backend_mcp_tools, is_safe_column_type, is_safe_identifier, BackendConfig, BackendFeature,
    BackendKind, BackendKit, BackendKitError, ColumnDef, ExportBundle, PaymentsGate, RlsOperation,
    RlsPolicy, TableDef,
};
pub use crate::build_cache::{
    BuildCache, BuildCacheEntry, BuildCacheKey, BuildCacheStats, InMemoryBuildCache,
};
pub use crate::command_policy::{
    CommandOutput, CommandPolicy, CommandPolicyError, DEFAULT_ALLOWED_COMMANDS,
    DEFAULT_COMMAND_TIMEOUT, DEFAULT_OUTPUT_CAP_BYTES, MINIMAL_CHILD_ENV, SHELL_COMMANDS,
};
pub use crate::evals::{blocks_change, run_suite, EvalCase, EvalError, EvalOutcome, EvalSuite};
pub use crate::gate_integrity::artifacts_sha256;
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
    split_command, InMemoryProcessManager, LivePreview, LivePreviewManager, ManagedProcess,
    ProcessError, ProcessManager, ProcessStatus, ProcessSummary,
};
pub use crate::provider_setup::{ConnectionTestResult, OneClickProvider, ProviderSetupWizard};
pub use crate::router_quality::{
    CostEntry, CostSink, EcoMode, EcoModeDecision, LocalFallbackPolicy, ModelTier, PerTaskDefault,
    PerTaskDefaults, ResponseCache, RouterPolicy, RouterTarget, TargetKind, TaskDifficulty,
};
pub use crate::routines::{
    Routine, RoutineAction, RoutineError, RoutineId, RoutineRegistry, RoutineRunner,
    RoutineSchedule, RoutineScheduler, RoutineState, UnavailableRoutineRunner,
};
pub use crate::run_modes::{
    is_loopback_host, InMemoryPairingStore, PairingStore, PhonePairing, RunMode, RunModeConfig,
    RunModeError, LOCALHOST, LOOPBACK_HOST, REDACTED_SECRET, WILDCARD_HOST,
};
pub use crate::scale_standards::{ScaleCategory, ScaleStandard, ScaleStandards, SCALE_STANDARDS};
pub use crate::scout::{
    ProductionScoutRegistryClient, Scout, ScoutConfig, ScoutDependency, ScoutError, ScoutProposal,
    ScoutRegistryClient, ScoutResult, ScoutSource,
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

/// The Code-stage artifact a coding CLI's run leaves behind: the files it changed
/// and the diff git reports, both read from the run's repository after the CLI
/// exited. The stage records the change that exists, not one the CLI claims.
fn code_stage_report(backend: &str, result: &CodingResult) -> String {
    let mut report = format!("# Code\n\nThe coding backend `{backend}` ran this stage.\n");
    report.push_str(&format!("Duration: {} ms\n", result.duration_ms));
    if result.files_changed.is_empty() {
        report.push_str("\nFiles changed: none\n");
    } else {
        report.push_str("\nFiles changed:\n");
        for path in &result.files_changed {
            report.push_str(&format!("- {path}\n"));
        }
    }
    match result.diff.as_deref() {
        Some(diff) if !diff.trim().is_empty() => {
            report.push_str("\n```diff\n");
            report.push_str(diff.trim_end_matches('\n'));
            report.push_str("\n```\n");
        }
        _ => report.push_str("\nNo diff was captured.\n"),
    }
    report
}

/// Scrub the API key out of a provider failure before it is recorded or logged.
///
/// A real-LLM call can fail with a message this layer did not write — the
/// provider's own text, an echo of the request, a wrapper error — and the one
/// thing such a message may never carry is the credential that was refused
/// (AGENTS.md: secrets are never logged, and the run's event log is a thing
/// owners read). Two passes close that from both ends: the exact
/// `WARSHA_LLM_API_KEY` value is replaced wherever it appears, and
/// [`mask_secrets`] then masks any credential-shaped token that survived the
/// first — the same heuristic the agent loop guards its transcripts with,
/// reused here so one table defines what a secret looks like.
fn scrub_llm_error(error: &PipelineError) -> String {
    let raw = error.to_string();
    let scrubbed = match EnvLlmConfig::from_env().api_key {
        Some(key) if !key.is_empty() => raw.replace(key.as_str(), REDACTED),
        _ => raw,
    };
    mask_secrets(&scrubbed)
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
    #[error("No provider routed for role: {0:?}")]
    NoProviderRouted(Role),
    #[error("Invalid stage transition: {0:?} -> {1:?}")]
    InvalidTransition(Stage, Stage),
    #[error("Budget exceeded: spent {spent_cents} of {budget_cents} cents")]
    BudgetExceeded {
        /// The run's budget.
        budget_cents: u64,
        /// What it has already spent.
        spent_cents: u64,
    },
    #[error(
        "Project budget exhausted: spent {spent_cents} of {budget_cents} cents; raise the \
         budget before starting another run"
    )]
    ProjectBudgetExhausted {
        /// The budget the project carries.
        budget_cents: u64,
        /// What the project has already spent against it.
        spent_cents: u64,
    },
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Other: {0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, PipelineError>;

/// The acting device a gate decision may be recorded against (security audit H-03).
///
/// Who is calling is decided above this layer: the daemon's transport authenticates
/// the credential and hands the resulting device id down. What happens here is the
/// floor under that — a decision that arrives without an acting device is refused
/// rather than recorded, so an absent identity cannot become an approver by every
/// layer above it forgetting to check. The nil uuid is the shape of "nobody": it is
/// what a default, an unset field and a caller that invented an id all look like, and
/// none of them is a device that approved something.
fn verified_actor(device_id: DeviceId, action: &str) -> Result<DeviceId> {
    if device_id.0.is_nil() {
        return Err(PipelineError::Other(format!(
            "{action} needs a verified acting device; a nil device id is not one"
        )));
    }
    Ok(device_id)
}

/// Control structure for a single run, maintaining per-run execution serialization,
/// state write mutual exclusion, and cooperative cancellation signaling (K2).
pub struct RunControl {
    /// Serializes stage execution (`advance_stage`, `advance_to_next_gate`, `resume_run`)
    /// so two concurrent writers/advancers never interleave stage walks.
    pub exec_lock: tokio::sync::Mutex<()>,
    /// Short-lived mutex protecting database read-modify-write transitions.
    /// Never held across external provider calls.
    pub state_lock: tokio::sync::Mutex<()>,
    /// Live cancellation broadcast for this run (`true` = cancelled).
    pub cancel_tx: tokio::sync::watch::Sender<bool>,
    /// Keeps the watch channel open even when no worker is subscribed, ensuring
    /// `cancel_tx.send(true)` reliably updates the value without receiver-drop error.
    _cancel_keepalive: tokio::sync::watch::Receiver<bool>,
}

/// Map a gate to the stage that produced the artifacts reviewed by that gate.
pub(crate) fn producing_stage_for_gate(gate: Stage) -> Option<Stage> {
    match gate {
        Stage::GateA => Some(Stage::Idea),
        Stage::GateB => Some(Stage::PrdSpec),
        Stage::GateC => Some(Stage::ReviewQaSecurity),
        Stage::GateD => Some(Stage::Release),
        _ => None,
    }
}

/// What one stage produced, before it is committed as the stage's artifact.
struct StageCompletion {
    /// The artifact body.
    content: String,
    /// What the stage cost; a coding CLI runs on the owner's own subscription.
    cost_cents: u64,
    /// Provider token usage; `None` when no provider answered.
    tokens: Option<TokenUsage>,
    /// The coding backend that ran the stage, when one did.
    backend: Option<String>,
}

/// Pipeline engine that drives the stage machine
pub struct PipelineEngine<S: SettingsProvider> {
    store: Arc<Store>,
    #[allow(dead_code)]
    providers: Arc<RwLock<ProviderRouter>>,
    orchestrator: Orchestrator,
    /// Settings store for accessing active harness, enabled skills, and plugins
    settings: Arc<S>,
    /// The coding CLI the Code stage runs through, when the owner selected one.
    coding_backend: Option<Arc<dyn CodingBackend>>,
    /// Per-run synchronization controls for execution serialization and real cancel
    run_controls: Arc<tokio::sync::Mutex<HashMap<RunId, Arc<RunControl>>>>,
}

impl<S: SettingsProvider> PipelineEngine<S> {
    pub fn new(
        store: Arc<Store>,
        providers: Arc<RwLock<ProviderRouter>>,
        settings: Arc<S>,
    ) -> Self {
        Self {
            store,
            providers,
            orchestrator: Orchestrator::new(OrchestratorConfig::default()),
            settings,
            coding_backend: None,
            run_controls: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        }
    }

    /// Run the Code stage through this coding backend instead of the routed provider.
    ///
    /// The selection is explicit: without a backend the Code stage keeps executing
    /// as it did before, through the provider router. The wiring side (the daemon)
    /// reads `WARSHA_CODING_BACKEND` and hands the resolved backend in.
    pub fn with_coding_backend(mut self, backend: Arc<dyn CodingBackend>) -> Self {
        self.coding_backend = Some(backend);
        self
    }

    /// The coding backend the Code stage runs through, when the run selected one.
    ///
    /// The backend is injected through [`PipelineEngine::with_coding_backend`]; the
    /// pipeline itself never reads the environment or names a backend. The backend
    /// is used even when its CLI is not installed, so the stage can report the
    /// absent CLI instead of quietly falling back to a provider.
    fn selected_coding_backend(&self) -> Option<Arc<dyn CodingBackend>> {
        self.coding_backend.clone()
    }

    /// Obtain or create the [`RunControl`] for `run_id`.
    pub async fn control_for(&self, run_id: RunId) -> Arc<RunControl> {
        let mut controls = self.run_controls.lock().await;
        controls
            .entry(run_id)
            .or_insert_with(|| {
                let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
                Arc::new(RunControl {
                    exec_lock: tokio::sync::Mutex::new(()),
                    state_lock: tokio::sync::Mutex::new(()),
                    cancel_tx,
                    _cancel_keepalive: cancel_rx,
                })
            })
            .clone()
    }

    /// Create a PipelineEngine with default settings for testing
    pub fn new_test(
        store: Arc<Store>,
        providers: Arc<RwLock<ProviderRouter>>,
    ) -> PipelineEngine<SettingsStore> {
        PipelineEngine::new(store, providers, Arc::new(SettingsStore::new()))
    }

    /// The budget a project already carries, read the way the daemon's
    /// `budget.show` (`show_budget` in `crates/warshad/src/lib.rs`) reads it: the
    /// newest run's budget and spend.
    ///
    /// Budget data is per-run (`runs.budget_cents` / `runs.spent_cents`); there is
    /// no project or global budget row and no default budget in settings, and the
    /// RPC layer calls the newest run's row "the project's budget". A project with
    /// no runs yet carries no budget.
    async fn project_budget_state(&self, project_id: ProjectId) -> Result<(Option<u64>, u64)> {
        let runs = self.store.list_runs(project_id).await?;
        Ok(match runs.first() {
            Some(newest) => (newest.budget_cents, newest.spent_cents),
            None => (None, 0),
        })
    }

    /// Start a new run for a project.
    ///
    /// A project that has already spent its whole budget cannot start another run:
    /// the refusal is the same fail-closed `spent >= budget` floor `resume_run`
    /// applies, and it happens before the run row exists, so a refused start leaves
    /// no orphan run behind. The new run inherits the budget the project carries so
    /// the ceiling the owner set is not dropped on the next run; a project with no
    /// budget stays unbudgeted, which is allowed.
    pub async fn start_run(&self, project_id: ProjectId, idea: &str) -> Result<Run> {
        let _project = self.store.get_project(project_id).await?;

        let (project_budget_cents, project_spent_cents) =
            self.project_budget_state(project_id).await?;
        if let Some(budget_cents) = project_budget_cents {
            if project_spent_cents >= budget_cents {
                return Err(PipelineError::ProjectBudgetExhausted {
                    budget_cents,
                    spent_cents: project_spent_cents,
                });
            }
        }

        let mut run = Run {
            id: RunId::new(),
            project_id,
            current_stage: Stage::Idea,
            gate_states: HashMap::new(),
            artifacts: HashMap::new(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            status: RunStatus::Running,
            budget_cents: project_budget_cents,
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

        // Create initial artifact: brief.md
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
        self.store.update_run(&run).await?;

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

    /// Advance to the next stage (serialized per-run via `exec_lock`).
    /// Refuse to advance or execute when the run's budget is already exhausted.
    ///
    /// The stage that spent the last cents still records them and emits
    /// `BudgetExceeded`; this is the floor under the next advance, so a run cannot
    /// keep executing stages after its budget is gone.
    fn ensure_budget(run: &Run) -> Result<()> {
        if let Some(budget_cents) = run.budget_cents {
            if run.spent_cents >= budget_cents {
                return Err(PipelineError::BudgetExceeded {
                    budget_cents,
                    spent_cents: run.spent_cents,
                });
            }
        }
        Ok(())
    }

    pub async fn advance_stage(&self, run_id: RunId) -> Result<Run> {
        let ctrl = self.control_for(run_id).await;
        let _exec_guard = ctrl.exec_lock.lock().await;
        self.advance_stage_locked(run_id, &ctrl).await
    }

    async fn advance_stage_locked(&self, run_id: RunId, ctrl: &RunControl) -> Result<Run> {
        let (mut run, mut version, current, next) = {
            let _state_guard = ctrl.state_lock.lock().await;
            if *ctrl.cancel_tx.borrow() {
                return Err(PipelineError::Other("Run is cancelled".to_string()));
            }
            let (mut run, version) = self.store.get_run_versioned(run_id).await?;

            if run.status != RunStatus::Running {
                return Err(PipelineError::Other(format!(
                    "Run is not running: {:?}",
                    run.status
                )));
            }
            Self::ensure_budget(&run)?;

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

            // Persist the stage advance with CAS before emitting StageStarted.
            let next_version = self.store.update_run_cas(&run, version).await?;

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
            (run, next_version, current, next)
        };

        // Execute the new stage (unless it's a gate or final stage) without holding state_lock
        // across the provider await so cancel_run can interrupt immediately.
        if !next.is_gate() && next != Stage::Feedback {
            self.execute_stage_with_feedback(&mut run, &mut version, ctrl, None)
                .await?;
        }

        info!("Run {} advanced from {:?} to {:?}", run_id.0, current, next);
        Ok(run)
    }

    /// Execute the role's agent step for the current stage, observing cooperative cancellation
    /// and committing via CAS so a stale stage write cannot overwrite a cancel or concurrent update.
    async fn execute_stage_with_feedback(
        &self,
        run: &mut Run,
        version: &mut u64,
        ctrl: &RunControl,
        feedback: Option<&str>,
    ) -> Result<()> {
        let stage = run.current_stage;
        let role = match crate::prompts::role_for_stage(stage) {
            Some(r) => r,
            None => return Ok(()), // Gates don't execute, they just wait for approval
        };

        // Re-check cancellation before starting any provider work.
        if *ctrl.cancel_tx.borrow() {
            return Err(PipelineError::Other("Run is cancelled".to_string()));
        }
        {
            let latest = self.store.get_run(run.id).await?;
            if latest.status == RunStatus::Cancelled {
                return Err(PipelineError::Other("Run is cancelled".to_string()));
            }
            Self::ensure_budget(&latest)?;
        }

        // Build context from previous artifacts (plus optional change-request feedback)
        let context = self.build_context_with_feedback(run, feedback);

        // --- Zero "sandwich code" wiring: active harness + enabled skills ---
        //
        // The pipeline must not stop at SQLite CRUD; the active harness's stage
        // prompt_template (if present) and every enabled skill's markdown content
        // are injected into the prompt that the LLM actually receives.
        let project_id_str = run.project_id.0.to_string();

        // 1. Get active harness for this project (default: "autonomous-factory")
        let harness_id = self
            .settings
            .get_active_harness(&project_id_str)
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| "autonomous-factory".to_string());

        // 2. Get the harness definition
        let harness = self.settings.get_harness(&harness_id).await.ok().flatten();

        // 3. Find the stage in the harness matching the current stage
        let harness_stage = harness.as_ref().and_then(|h| {
            // Parse the harness definition from data_json
            let harness_def: HarnessDefinition = serde_json::from_str(&h.data_json).ok()?;
            // Find and clone the matching stage by role
            harness_def
                .stages
                .iter()
                .find(|hs| hs.role == role)
                .cloned()
        });

        // 4. Determine the base prompt: harness stage prompt_template overrides role base prompt
        // The role marker is needed for the FakeProvider to detect the stage.
        // Static prompts from prompts.rs already include it; harness templates need it added.
        // FakeProvider expects lowercase role names (e.g., "pm" not "PM")
        let role_str = format!("{:?}", role).to_lowercase();
        let stage_str = stage_to_string(stage);
        let role_marker = format!("---\nrole: {}\nstage: {}\n---\n\n", role_str, stage_str);
        let base_prompt: String = harness_stage
            .as_ref()
            .and_then(|hs| hs.prompt_template.as_ref())
            .map(|s| {
                // If the harness template doesn't already have the role marker, prepend it
                if s.trim_start().starts_with("---\nrole:") {
                    s.clone()
                } else {
                    // This shouldn't happen with current templates, but handle it
                    format!("{}{}", role_marker, s)
                }
            })
            .unwrap_or_else(|| crate::prompts::get_prompt(role).to_string());

        // 5. Get enabled skills and prepend their markdown content
        let enabled_skills = self
            .settings
            .list_skills()
            .await
            .unwrap_or_default()
            .into_iter()
            .filter(|s| s.enabled)
            .collect::<Vec<_>>();

        let skill_preamble = if enabled_skills.is_empty() {
            String::new()
        } else {
            let mut preamble = String::new();
            for skill in &enabled_skills {
                preamble.push_str(&skill.content);
                preamble.push_str("\n\n---\n\n");
            }
            preamble
        };

        // 6. Compose final prompt: skill content + harness/role prompt + context
        let prompt_template = if skill_preamble.is_empty() {
            base_prompt.to_string()
        } else {
            format!("{}{}", skill_preamble, base_prompt)
        };

        // Render the prompt with context, in the language of the run's project
        // (the project row decides; "en" when it has no language).
        let language = self.project_language(run.project_id).await;
        let prompt = self.render_prompt(&prompt_template, &context, &language);

        // Cancellation is observed before any stage work: a coding CLI's own timeout
        // bounds its run, but a cancelled run does not start it at all.
        let mut cancel_rx = ctrl.cancel_tx.subscribe();
        if *cancel_rx.borrow() {
            return Err(PipelineError::Other(
                "Run cancelled before stage execution".to_string(),
            ));
        }

        // The Code stage runs through a selected coding CLI when one is selected;
        // the artifact is the change the CLI actually made in the run's repository.
        let cli_completion = match self
            .code_stage_completion(run, stage, &prompt, &language)
            .await
        {
            Ok(completion) => completion,
            Err(error) => {
                return Err(self
                    .record_stage_failure(run, *version, ctrl, stage, role, error)
                    .await);
            }
        };

        let completion = match cli_completion {
            Some(completion) => completion,
            None => {
                // Call the provider while watching the live cancellation channel.
                let providers = {
                    let router = self.providers.read().await;
                    (*router).clone()
                };
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

                let dispatch_project_id = run.project_id.0.to_string();
                let response = tokio::select! {
                    biased;
                    _ = cancel_rx.changed() => {
                        return Err(PipelineError::Other(
                            "Run cancelled during stage execution".to_string(),
                        ));
                    }
                    res = Self::dispatch_chat(&providers, role, &dispatch_project_id, request) => {
                        match res {
                            Ok(response) => response,
                            Err(error) => {
                                return Err(self
                                    .record_stage_failure(run, *version, ctrl, stage, role, error)
                                    .await);
                            }
                        }
                    }
                };

                let content = response
                    .choices
                    .first()
                    .map(|c| c.message.content.clone())
                    .unwrap_or_default();
                let cost_cents = providers.cost_of(&response.model, &response.usage)?;
                StageCompletion {
                    content,
                    cost_cents,
                    tokens: Some(response.usage),
                    backend: None,
                }
            }
        };

        let StageCompletion {
            content: artifact_body,
            cost_cents,
            tokens,
            backend,
        } = completion;

        // Re-check cancellation and commit under state_lock via CAS before writing any artifact.
        let (artifact_name, artifact_content, budget_exceeded_info, budget_warn_info) = {
            let _state_guard = ctrl.state_lock.lock().await;
            if *ctrl.cancel_tx.borrow() {
                return Err(PipelineError::Other(
                    "Run cancelled before committing stage artifact".to_string(),
                ));
            }
            let (latest, _latest_v) = self.store.get_run_versioned(run.id).await?;
            if latest.status == RunStatus::Cancelled {
                return Err(PipelineError::Other(
                    "Run cancelled before committing stage artifact".to_string(),
                ));
            }

            let artifact_content = artifact_body;

            let artifact_name = stage_to_string(stage).to_lowercase();
            let prev_version = run
                .artifacts
                .get(&artifact_name)
                .map(|a| a.version)
                .unwrap_or(0);
            let artifact = Artifact {
                name: artifact_name.clone(),
                content: artifact_content.clone(),
                stage,
                role: Some(role),
                created_at: Utc::now(),
                updated_at: Utc::now(),
                version: prev_version + 1,
            };

            run.artifacts.insert(artifact_name.clone(), artifact);
            run.spent_cents += cost_cents;
            run.updated_at = Utc::now();

            let mut budget_exceeded_info = None;
            let mut budget_warn_info = None;
            if let Some(budget) = run.budget_cents {
                if run.spent_cents >= budget {
                    run.status = RunStatus::Paused;
                    budget_exceeded_info = Some((budget, run.spent_cents));
                } else if run.spent_cents as f64 >= budget as f64 * 0.8 {
                    budget_warn_info = Some((budget, run.spent_cents));
                }
            }

            // Atomic CAS update: refuses to overwrite if a concurrent cancel or writer bumped version.
            *version = self.store.update_run_cas(run, *version).await?;

            (
                artifact_name,
                artifact_content,
                budget_exceeded_info,
                budget_warn_info,
            )
        };

        // Persist artifact file to factory and append events only after CAS succeeded.
        self.store
            .write_artifact(run.project_id, &artifact_name, &artifact_content)
            .await?;

        let payload = match &backend {
            Some(backend) => {
                serde_json::json!({ "role": role, "stage": stage, "backend": backend })
            }
            None => serde_json::json!({ "role": role, "stage": stage }),
        };
        let event = Event {
            id: Ulid::new(),
            run_id: run.id,
            stage,
            role: Some(role),
            kind: EventKind::AgentStep,
            payload,
            cost_cents: Some(cost_cents),
            tokens,
            created_at: Utc::now(),
            device_id: None,
        };
        self.store.append_event(&event).await?;

        if let Some((budget, spent)) = budget_exceeded_info {
            let budget_event = Event {
                id: Ulid::new(),
                run_id: run.id,
                stage,
                role: None,
                kind: EventKind::BudgetExceeded,
                payload: serde_json::json!({ "budget_cents": budget, "spent_cents": spent }),
                cost_cents: None,
                tokens: None,
                created_at: Utc::now(),
                device_id: None,
            };
            self.store.append_event(&budget_event).await?;
            warn!(
                "Budget exceeded for run {}: {} >= {}",
                run.id.0, spent, budget
            );
        } else if let Some((budget, spent)) = budget_warn_info {
            let warn_event = Event {
                id: Ulid::new(),
                run_id: run.id,
                stage,
                role: None,
                kind: EventKind::BudgetWarning,
                payload: serde_json::json!({
                    "budget_cents": budget,
                    "spent_cents": spent,
                    "percent": (spent as f64 / budget as f64 * 100.0) as u32
                }),
                cost_cents: None,
                tokens: None,
                created_at: Utc::now(),
                device_id: None,
            };
            self.store.append_event(&warn_event).await?;
        }

        Ok(())
    }

    /// Run the Code stage through a coding CLI, and describe the change it made.
    ///
    /// `Ok(None)` means no backend was selected, so the caller keeps the routed
    /// provider. A selected backend that is not installed, a project with no
    /// attached repository and a failed CLI are errors the caller records on the
    /// run — never a silent success and never a fallback that hides the selection.
    /// The CLI's own run is bounded by the backend's `CODING_CLI_TIMEOUT`.
    async fn code_stage_completion(
        &self,
        run: &Run,
        stage: Stage,
        prompt: &str,
        language: &str,
    ) -> Result<Option<StageCompletion>> {
        if stage != Stage::Code {
            return Ok(None);
        }
        let Some(backend) = self.selected_coding_backend() else {
            return Ok(None);
        };
        let backend_name = backend.name().to_string();
        if !backend.is_available() {
            return Err(PipelineError::Other(format!(
                "the selected coding backend `{backend_name}` is not installed"
            )));
        }

        let project = self.store.get_project(run.project_id).await?;
        let repo_path = project
            .repo_path
            .as_deref()
            .map(str::trim)
            .filter(|path| !path.is_empty())
            .ok_or_else(|| {
                PipelineError::Other(format!(
                    "the selected coding backend `{backend_name}` needs an attached repository; \
                     project `{}` has none",
                    project.name
                ))
            })?;

        let task = CodingTask {
            id: Ulid::new(),
            run_id: run.id,
            title: format!("{} — Code", project.name),
            description: prompt.to_string(),
            repo_path: PathBuf::from(repo_path),
            branch_name: format!("warsha/run-{}", run.id.0),
            base_branch: "HEAD".to_string(),
            files: Vec::new(),
            context: HashMap::from([
                ("project".to_string(), project.name.clone()),
                ("language".to_string(), language.to_string()),
                ("run".to_string(), run.id.0.to_string()),
                ("stage".to_string(), stage_to_string(stage).to_string()),
            ]),
        };
        let sandbox = Sandbox::new(PathBuf::from(repo_path));

        let result = backend.execute(task, &sandbox).await.map_err(|error| {
            PipelineError::Other(format!(
                "the coding backend `{backend_name}` failed: {error}"
            ))
        })?;
        if !result.success {
            return Err(PipelineError::Other(format!(
                "the coding backend `{backend_name}` reported failure: {}",
                result.error.as_deref().unwrap_or("no detail")
            )));
        }

        Ok(Some(StageCompletion {
            content: code_stage_report(&backend_name, &result),
            cost_cents: 0,
            tokens: None,
            backend: Some(backend_name),
        }))
    }

    /// Take one stage/follow-up request to the provider that should answer it.
    ///
    /// 1. The role IS routed (`providers.route(role).is_some()`): the request goes
    ///    through [`ProviderRouter::chat_with_fallback`].
    /// 2. If `WARSHA_LLM_PROVIDER=fake` is explicitly set in the environment,
    ///    [`FakeProvider`] answers for zero-network testing.
    /// 3. If the environment carries `WARSHA_LLM_API_KEY` (and `WARSHA_LLM_PROVIDER`
    ///    is not "fake"), an OpenAI-compatible client built from [`EnvLlmConfig`] answers.
    /// 4. Otherwise, the unrouted role produces an explicit [`PipelineError::NoProviderRouted`]
    ///    error — no silent fake answers are fabricated.
    async fn dispatch_chat(
        providers: &ProviderRouter,
        role: Role,
        project_id: &str,
        request: ChatRequest,
    ) -> Result<warsha_providers::ChatResponse> {
        if providers.route(role).is_some() {
            return Ok(providers
                .chat_with_fallback(role, project_id, request)
                .await?);
        }

        let env_cfg = EnvLlmConfig::from_env();
        let forced_fake = std::env::var("WARSHA_LLM_PROVIDER")
            .ok()
            .map(|value| value.trim() == "fake")
            .unwrap_or(false);
        if env_cfg.api_key.is_some() && !forced_fake {
            let provider = OpenAIProvider::from_env_config("env-openai".to_string(), &env_cfg)?;
            let request = ChatRequest {
                model: env_cfg.model.clone(),
                ..request
            };
            return Ok(provider.chat(request).await?);
        }

        if forced_fake {
            return Ok(FakeProvider::new().chat(request).await?);
        }

        Err(PipelineError::NoProviderRouted(role))
    }

    /// Record a stage whose model call failed, and hand the caller back the error.
    ///
    /// This is the real-LLM failure path the walk used to miss: a refused key, a
    /// timeout, a dead endpoint made `dispatch_chat` return an error that left the
    /// run `Running` at the stage that could not produce anything, with no event
    /// explaining why. Here the run's own record carries the ending instead: the
    /// status becomes [`RunStatus::Failed`] (or [`RunStatus::Paused`] if an unrouted
    /// provider needs to be configured) and is persisted, and one
    /// [`EventKind::Error`] with `"action": "stage_failed"` or `"provider_required"`
    /// explains why. The error itself is *not* swallowed — the caller gets it back so
    /// the RPC reply is still an honest failure of the call that made it.
    async fn record_stage_failure(
        &self,
        run: &mut Run,
        version: u64,
        ctrl: &RunControl,
        stage: Stage,
        role: Role,
        error: PipelineError,
    ) -> PipelineError {
        let message = scrub_llm_error(&error);

        let _guard = ctrl.state_lock.lock().await;
        if *ctrl.cancel_tx.borrow() {
            return PipelineError::Other("Run is cancelled".to_string());
        }
        if let Ok((latest, _)) = self.store.get_run_versioned(run.id).await {
            if latest.status == RunStatus::Cancelled {
                return PipelineError::Other("Run is cancelled".to_string());
            }
        }

        let is_unrouted = matches!(error, PipelineError::NoProviderRouted(_));
        if is_unrouted {
            run.status = RunStatus::Paused;
        } else {
            run.status = RunStatus::Failed;
        }
        run.updated_at = Utc::now();
        if let Err(store_error) = self.store.update_run_cas(run, version).await {
            warn!(
                "the failed-run write for run {} did not land: {store_error}",
                run.id.0
            );
        }

        let action = if is_unrouted {
            "provider_required"
        } else {
            "stage_failed"
        };

        let error_event = Event {
            id: Ulid::new(),
            run_id: run.id,
            stage,
            role: Some(role),
            kind: EventKind::Error,
            payload: serde_json::json!({
                "action": action,
                "stage": stage_to_string(stage),
                "role": role,
                "message": message,
            }),
            cost_cents: None,
            tokens: None,
            created_at: Utc::now(),
            device_id: None,
        };
        if let Err(store_error) = self.store.append_event(&error_event).await {
            warn!(
                "the {action} event for run {} did not land: {store_error}",
                run.id.0
            );
        }

        // The scrubbed message only: an API key is never a log line's content
        // (AGENTS.md — secrets never reach a log).
        warn!(
            "Stage {} failed for run {}: {message}",
            stage_to_string(stage),
            run.id.0
        );
        if is_unrouted {
            error
        } else {
            PipelineError::Other(message)
        }
    }

    /// Walk the run forward until it is waiting at a gate or has reached the final
    /// `Feedback` stage.
    ///
    /// Serialized per run so two concurrent callers execute each stage at most once.
    pub async fn advance_to_next_gate(&self, run_id: RunId) -> Result<Run> {
        let ctrl = self.control_for(run_id).await;
        let _exec_guard = ctrl.exec_lock.lock().await;
        self.advance_to_next_gate_locked(run_id, &ctrl).await
    }

    async fn advance_to_next_gate_locked(&self, run_id: RunId, ctrl: &RunControl) -> Result<Run> {
        let (mut run, _version) = self.store.get_run_versioned(run_id).await?;

        if run.status == RunStatus::Paused {
            return Err(PipelineError::Other(
                "Run is paused; call runs.resume before advancing".to_string(),
            ));
        }

        loop {
            if *ctrl.cancel_tx.borrow() {
                return self.store.get_run(run_id).await.map_err(Into::into);
            }
            if run.status == RunStatus::Failed
                || run.status == RunStatus::Cancelled
                || run.status == RunStatus::Paused
            {
                return Ok(run);
            }
            if run.current_stage == Stage::Feedback {
                let _state_guard = ctrl.state_lock.lock().await;
                let (mut latest, latest_v) = self.store.get_run_versioned(run_id).await?;
                if latest.status == RunStatus::Running {
                    latest.status = RunStatus::Completed;
                    latest.updated_at = Utc::now();
                    self.store.update_run_cas(&latest, latest_v).await?;
                }
                return Ok(latest);
            }
            if run.current_stage.is_gate() {
                let decided = matches!(
                    run.gate_states.get(&run.current_stage),
                    Some(GateState::Approved { .. })
                );
                if !decided {
                    return Ok(run);
                }
            }
            run = match self.advance_stage_locked(run.id, ctrl).await {
                Ok(next_run) => {
                    if next_run.status == RunStatus::Paused
                        || next_run.status == RunStatus::Cancelled
                        || next_run.status == RunStatus::Failed
                    {
                        return Ok(next_run);
                    }
                    next_run
                }
                Err(error) => {
                    if matches!(error, PipelineError::NoProviderRouted(_)) {
                        return Err(error);
                    }
                    let current = self.store.get_run(run_id).await?;
                    if current.status == RunStatus::Failed || current.status == RunStatus::Cancelled
                    {
                        return Ok(current);
                    }
                    return Err(error);
                }
            };
        }
    }

    /// Cancel a run, recording why.
    ///
    /// Signals any in-flight stage worker via the per-run cancellation watch channel,
    /// atomically sets `RunStatus::Cancelled` via CAS (retrying on concurrent version bumps
    /// so cancel is never lost), and appends an [`EventKind::Error`] event with
    /// `"action": "run_cancelled"`.
    pub async fn cancel_run(&self, run_id: RunId, reason: Option<String>) -> Result<Run> {
        let ctrl = self.control_for(run_id).await;
        let _ = ctrl.cancel_tx.send(true);

        let _state_guard = ctrl.state_lock.lock().await;
        let mut attempts = 0;
        let run = loop {
            let (mut run, version) = self.store.get_run_versioned(run_id).await?;
            run.status = RunStatus::Cancelled;
            run.updated_at = Utc::now();
            match self.store.update_run_cas(&run, version).await {
                Ok(_) => break run,
                Err(warsha_store::StoreError::VersionConflict { .. }) if attempts < 8 => {
                    attempts += 1;
                }
                Err(e) => return Err(e.into()),
            }
        };

        let event = Event {
            id: Ulid::new(),
            run_id,
            stage: run.current_stage,
            role: None,
            kind: EventKind::Error,
            payload: serde_json::json!({ "action": "run_cancelled", "reason": reason }),
            cost_cents: None,
            tokens: None,
            created_at: Utc::now(),
            device_id: None,
        };
        self.store.append_event(&event).await?;

        info!("Run {} cancelled: {:?}", run_id.0, reason);
        Ok(run)
    }

    /// Resume a paused run (change request loop, budget-exceeded pause, or restart recovery).
    pub async fn resume_run(&self, run_id: RunId) -> Result<Run> {
        let ctrl = self.control_for(run_id).await;
        let _exec_guard = ctrl.exec_lock.lock().await;

        let (mut run, mut version, gate_feedback_opt) = {
            let _state_guard = ctrl.state_lock.lock().await;
            let (mut run, version) = self.store.get_run_versioned(run_id).await?;

            match run.status {
                RunStatus::Completed | RunStatus::Cancelled => {
                    return Err(PipelineError::Other(format!(
                        "Cannot resume run in {:?} status",
                        run.status
                    )));
                }
                RunStatus::Running => return Ok(run),
                RunStatus::Failed => {
                    return Err(PipelineError::Other(
                        "Cannot resume a failed run".to_string(),
                    ));
                }
                RunStatus::Paused => {}
            }

            if let Some(budget) = run.budget_cents {
                if run.spent_cents >= budget {
                    return Err(PipelineError::Other(format!(
                        "Budget exceeded ({} >= {}); increase budget before resuming",
                        run.spent_cents, budget
                    )));
                }
            }

            if run.current_stage.is_gate() {
                let gate_stage = run.current_stage;
                match run.gate_states.get(&gate_stage).cloned() {
                    Some(GateState::ChangesRequested { notes, .. }) => {
                        let producing_stage =
                            producing_stage_for_gate(gate_stage).ok_or_else(|| {
                                PipelineError::Other(format!(
                                    "No producing stage for gate {gate_stage:?}"
                                ))
                            })?;
                        run.gate_states.insert(gate_stage, GateState::Pending);
                        run.current_stage = producing_stage;
                        run.status = RunStatus::Running;
                        run.updated_at = Utc::now();
                        let next_v = self.store.update_run_cas(&run, version).await?;

                        let event = Event {
                            id: Ulid::new(),
                            run_id,
                            stage: gate_stage,
                            role: None,
                            kind: EventKind::StageStarted,
                            payload: serde_json::json!({
                                "action": "run_resumed",
                                "from_gate": stage_to_string(gate_stage),
                                "notes": notes
                            }),
                            cost_cents: None,
                            tokens: None,
                            created_at: Utc::now(),
                            device_id: None,
                        };
                        self.store.append_event(&event).await?;
                        (run, next_v, Some(notes))
                    }
                    Some(GateState::Rejected { reason, .. }) => {
                        let producing_stage =
                            producing_stage_for_gate(gate_stage).ok_or_else(|| {
                                PipelineError::Other(format!(
                                    "No producing stage for gate {gate_stage:?}"
                                ))
                            })?;
                        run.gate_states.insert(gate_stage, GateState::Pending);
                        run.current_stage = producing_stage;
                        run.status = RunStatus::Running;
                        run.updated_at = Utc::now();
                        let next_v = self.store.update_run_cas(&run, version).await?;

                        let event = Event {
                            id: Ulid::new(),
                            run_id,
                            stage: gate_stage,
                            role: None,
                            kind: EventKind::StageStarted,
                            payload: serde_json::json!({
                                "action": "run_resumed",
                                "from_gate": stage_to_string(gate_stage),
                                "reason": reason
                            }),
                            cost_cents: None,
                            tokens: None,
                            created_at: Utc::now(),
                            device_id: None,
                        };
                        self.store.append_event(&event).await?;
                        (run, next_v, Some(reason))
                    }
                    _ => {
                        run.status = RunStatus::Running;
                        run.updated_at = Utc::now();
                        let next_v = self.store.update_run_cas(&run, version).await?;
                        let event = Event {
                            id: Ulid::new(),
                            run_id,
                            stage: gate_stage,
                            role: None,
                            kind: EventKind::StageStarted,
                            payload: serde_json::json!({ "action": "run_resumed" }),
                            cost_cents: None,
                            tokens: None,
                            created_at: Utc::now(),
                            device_id: None,
                        };
                        self.store.append_event(&event).await?;
                        (run, next_v, None)
                    }
                }
            } else {
                run.status = RunStatus::Running;
                run.updated_at = Utc::now();
                let next_v = self.store.update_run_cas(&run, version).await?;
                let event = Event {
                    id: Ulid::new(),
                    run_id,
                    stage: run.current_stage,
                    role: None,
                    kind: EventKind::StageStarted,
                    payload: serde_json::json!({ "action": "run_resumed" }),
                    cost_cents: None,
                    tokens: None,
                    created_at: Utc::now(),
                    device_id: None,
                };
                self.store.append_event(&event).await?;
                (run, next_v, None)
            }
        };

        if let Some(feedback) = gate_feedback_opt {
            self.execute_stage_with_feedback(&mut run, &mut version, &ctrl, Some(&feedback))
                .await?;
            if run.status != RunStatus::Running {
                return Ok(run);
            }
            return self.advance_stage_locked(run.id, &ctrl).await;
        }

        if !run.current_stage.is_gate() && run.current_stage != Stage::Feedback {
            let stage = run.current_stage;
            let needs_exec = if stage == Stage::Idea {
                !run.artifacts.contains_key("brief")
            } else {
                !run.artifacts
                    .contains_key(&stage_to_string(stage).to_lowercase())
            };
            if needs_exec {
                self.execute_stage_with_feedback(&mut run, &mut version, &ctrl, None)
                    .await?;
                if run.status != RunStatus::Running {
                    return Ok(run);
                }
            }
            return self.advance_to_next_gate_locked(run.id, &ctrl).await;
        }

        if run.current_stage.is_gate()
            && matches!(
                run.gate_states.get(&run.current_stage),
                Some(GateState::Approved { .. })
            )
        {
            return self.advance_to_next_gate_locked(run.id, &ctrl).await;
        }

        Ok(run)
    }

    /// Update a run's budget under per-run lock and CAS protection.
    pub async fn set_run_budget(&self, run_id: RunId, budget_cents: u64) -> Result<Run> {
        let ctrl = self.control_for(run_id).await;
        let _guard = ctrl.state_lock.lock().await;
        let mut attempts = 0;
        loop {
            let (mut run, version) = self.store.get_run_versioned(run_id).await?;
            run.budget_cents = Some(budget_cents);
            run.updated_at = Utc::now();
            match self.store.update_run_cas(&run, version).await {
                Ok(_) => return Ok(run),
                Err(warsha_store::StoreError::VersionConflict { .. }) if attempts < 8 => {
                    attempts += 1;
                }
                Err(e) => return Err(e.into()),
            }
        }
    }

    /// Recover any runs left in `Running` status after an unclean restart.
    pub async fn recover_interrupted_runs(&self) -> Result<Vec<Run>> {
        self.store
            .recover_interrupted_runs()
            .await
            .map_err(Into::into)
    }

    /// Answer a follow-up prompt on an existing run without moving its stage.
    pub async fn followup_run(&self, run_id: RunId, prompt: &str) -> Result<Run> {
        let ctrl = self.control_for(run_id).await;
        let (run, version, role) = {
            let _guard = ctrl.state_lock.lock().await;
            if *ctrl.cancel_tx.borrow() {
                return Err(PipelineError::Other("Run is cancelled".to_string()));
            }
            let (run, version) = self.store.get_run_versioned(run_id).await?;
            if matches!(
                run.status,
                RunStatus::Cancelled | RunStatus::Completed | RunStatus::Failed
            ) {
                return Err(PipelineError::Other(format!(
                    "Cannot apply followup to a {:?} run",
                    run.status
                )));
            }
            let role = crate::prompts::role_for_stage(run.current_stage).unwrap_or(Role::Intake);
            (run, version, role)
        };

        let providers = {
            let router = self.providers.read().await;
            (*router).clone()
        };
        let request = ChatRequest {
            model: "default".to_string(),
            messages: vec![ChatMessage {
                role: MessageRole::User,
                content: prompt.to_string(),
            }],
            temperature: Some(0.7),
            max_tokens: Some(4000),
            stream: false,
        };
        let mut cancel_rx = ctrl.cancel_tx.subscribe();
        if *cancel_rx.borrow() {
            return Err(PipelineError::Other("Run is cancelled".to_string()));
        }
        let dispatch_project_id = run.project_id.0.to_string();
        let response = tokio::select! {
            biased;
            _ = cancel_rx.changed() => {
                return Err(PipelineError::Other("Run cancelled during followup".to_string()));
            }
            res = Self::dispatch_chat(&providers, role, &dispatch_project_id, request) => {
                res?
            }
        };
        let answer = response
            .choices
            .first()
            .map(|choice| choice.message.content.clone())
            .unwrap_or_default();
        let cost_cents = providers.cost_of(&response.model, &response.usage)?;

        let now = Utc::now();
        let mut updated = {
            let _guard = ctrl.state_lock.lock().await;
            if *ctrl.cancel_tx.borrow() {
                return Err(PipelineError::Other("Run is cancelled".to_string()));
            }
            let (mut latest, latest_v) = self.store.get_run_versioned(run_id).await?;
            if matches!(
                latest.status,
                RunStatus::Cancelled | RunStatus::Completed | RunStatus::Failed
            ) || latest_v != version
            {
                return Err(PipelineError::Other(
                    "Run state changed concurrently during followup".to_string(),
                ));
            }
            let artifact = Artifact {
                name: "followup".to_string(),
                content: answer.clone(),
                stage: latest.current_stage,
                role: Some(role),
                created_at: now,
                updated_at: now,
                version: 1,
            };
            latest.artifacts.insert(artifact.name.clone(), artifact);
            latest.spent_cents += cost_cents;
            latest.updated_at = now;
            self.store.update_run_cas(&latest, latest_v).await?;
            latest
        };

        self.store
            .write_artifact(updated.project_id, "followup", &answer)
            .await?;

        let event = Event {
            id: Ulid::new(),
            run_id,
            stage: updated.current_stage,
            role: Some(role),
            kind: EventKind::AgentStep,
            payload: serde_json::json!({
                "action": "followup",
                "prompt": prompt,
                "response": answer,
            }),
            cost_cents: Some(cost_cents),
            tokens: Some(response.usage.clone()),
            created_at: now,
            device_id: None,
        };
        self.store.append_event(&event).await?;
        updated.updated_at = now;

        info!("Follow-up answered for run {}", run_id.0);
        Ok(updated)
    }

    /// Build context from previous artifacts for the prompt, optionally carrying change-request notes.
    fn build_context_with_feedback(&self, run: &Run, feedback: Option<&str>) -> serde_json::Value {
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

        if let Some(notes) = feedback {
            context.insert(
                "change_request_notes".to_string(),
                serde_json::json!({
                    "content": notes,
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

    /// Build context from previous artifacts for the prompt
    #[allow(dead_code)]
    fn build_context(&self, run: &Run) -> serde_json::Value {
        self.build_context_with_feedback(run, None)
    }

    /// The language this run's prompts are rendered in: its project row's `language`.
    ///
    /// Read at render time, not cached on the engine, because a resumed run
    /// (`resume_run` after a restart) rebuilds its state from the store and must
    /// render exactly like the process that started it.
    ///
    /// This is presentation, not a correctness gate: a project row that cannot be
    /// read, or one whose `language` is empty or blank, falls back to `"en"` rather
    /// than failing the stage.
    async fn project_language(&self, project_id: ProjectId) -> String {
        const DEFAULT_LANGUAGE: &str = "en";
        match self.store.get_project(project_id).await {
            Ok(project) => {
                let language = project.language.trim();
                if language.is_empty() {
                    DEFAULT_LANGUAGE.to_string()
                } else {
                    language.to_string()
                }
            }
            Err(_) => DEFAULT_LANGUAGE.to_string(),
        }
    }

    /// Simple template rendering - replace {{key}} with values
    fn render_prompt(&self, template: &str, context: &serde_json::Value, language: &str) -> String {
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

        // Replace {{language}} with the run project's language. The caller resolves
        // this from the project row ([`PipelineEngine::project_language`]) and falls
        // back to "en" when that row is missing or its language is blank.
        result = result.replace("{{language}}", language);

        // Inject change-request feedback if present
        if let Some(feedback) = context
            .get("change_request_notes")
            .and_then(|v| v.get("content"))
            .and_then(|v| v.as_str())
        {
            result = result.replace("{{feedback}}", feedback);
            result = result.replace("{{notes}}", feedback);
            if !result.contains(feedback) {
                result.push_str(&format!(
                    "\n\n## Feedback / Change Request Notes\n\n{feedback}\n"
                ));
            }
        }

        result
    }

    /// Approve a gate
    pub async fn approve_gate(
        &self,
        run_id: RunId,
        stage: Stage,
        device_id: DeviceId,
    ) -> Result<Run> {
        let device_id = verified_actor(device_id, "an approval")?;
        let ctrl = self.control_for(run_id).await;
        let _guard = ctrl.state_lock.lock().await;
        let (mut run, version) = self.store.get_run_versioned(run_id).await?;

        gate_integrity::ensure_gate_decidable(&run, stage)?;
        let artifacts_hash = gate_integrity::artifacts_sha256(&run.artifacts);

        let gate_state = run
            .gate_states
            .get_mut(&stage)
            .ok_or(PipelineError::Other("Gate not found".to_string()))?;

        *gate_state = GateState::Approved {
            by: device_id,
            at: Utc::now(),
        };
        run.updated_at = Utc::now();

        self.store.update_run_cas(&run, version).await?;

        let event = Event {
            id: Ulid::new(),
            run_id,
            stage,
            role: None,
            kind: EventKind::GateDecision,
            payload: serde_json::json!({
                "decision": "approved",
                "by": device_id.0,
                "artifacts_sha256": artifacts_hash,
            }),
            cost_cents: None,
            tokens: None,
            created_at: Utc::now(),
            device_id: Some(device_id),
        };
        self.store.append_event(&event).await?;

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
        let device_id = verified_actor(device_id, "a rejection")?;
        let ctrl = self.control_for(run_id).await;
        let _guard = ctrl.state_lock.lock().await;
        let (mut run, version) = self.store.get_run_versioned(run_id).await?;

        gate_integrity::ensure_gate_decidable(&run, stage)?;
        let artifacts_hash = gate_integrity::artifacts_sha256(&run.artifacts);

        let gate_state = run
            .gate_states
            .get_mut(&stage)
            .ok_or(PipelineError::Other("Gate not found".to_string()))?;

        *gate_state = GateState::Rejected {
            reason: reason.clone(),
            by: device_id,
            at: Utc::now(),
        };
        run.updated_at = Utc::now();
        run.status = RunStatus::Paused;

        self.store.update_run_cas(&run, version).await?;

        let event = Event {
            id: Ulid::new(),
            run_id,
            stage,
            role: None,
            kind: EventKind::GateDecision,
            payload: serde_json::json!({
                "decision": "rejected",
                "reason": reason,
                "by": device_id.0,
                "artifacts_sha256": artifacts_hash,
            }),
            cost_cents: None,
            tokens: None,
            created_at: Utc::now(),
            device_id: Some(device_id),
        };
        self.store.append_event(&event).await?;

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
        let device_id = verified_actor(device_id, "a change request")?;
        let ctrl = self.control_for(run_id).await;
        let _guard = ctrl.state_lock.lock().await;
        let (mut run, version) = self.store.get_run_versioned(run_id).await?;

        gate_integrity::ensure_gate_decidable(&run, stage)?;
        let artifacts_hash = gate_integrity::artifacts_sha256(&run.artifacts);

        let gate_state = run
            .gate_states
            .get_mut(&stage)
            .ok_or(PipelineError::Other("Gate not found".to_string()))?;

        *gate_state = GateState::ChangesRequested {
            notes: notes.clone(),
            by: device_id,
            at: Utc::now(),
        };
        run.updated_at = Utc::now();
        run.status = RunStatus::Paused;

        self.store.update_run_cas(&run, version).await?;

        let event = Event {
            id: Ulid::new(),
            run_id,
            stage,
            role: None,
            kind: EventKind::GateDecision,
            payload: serde_json::json!({
                "decision": "changes_requested",
                "notes": notes,
                "by": device_id.0,
                "artifacts_sha256": artifacts_hash,
            }),
            cost_cents: None,
            tokens: None,
            created_at: Utc::now(),
            device_id: Some(device_id),
        };
        self.store.append_event(&event).await?;

        info!(
            "Gate {:?} changes requested for run {} by device {}",
            stage, run_id.0, device_id.0
        );
        Ok(run)
    }

    /// Create or update an artifact
    pub async fn upsert_artifact(&self, run_id: RunId, artifact: Artifact) -> Result<()> {
        let ctrl = self.control_for(run_id).await;
        let _guard = ctrl.state_lock.lock().await;
        let (mut run, version) = self.store.get_run_versioned(run_id).await?;
        run.artifacts
            .insert(artifact.name.clone(), artifact.clone());
        run.updated_at = Utc::now();

        self.store.update_run_cas(&run, version).await?;

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
        let ctrl = self.control_for(run_id).await;
        let _guard = ctrl.state_lock.lock().await;
        let (mut run, mut version) = self.store.get_run_versioned(run_id).await?;
        run.spent_cents += cost_cents;
        run.updated_at = Utc::now();

        version = self.store.update_run_cas(&run, version).await?;

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

        // Check budget
        if let Some(budget) = run.budget_cents {
            if run.spent_cents >= budget {
                run.status = RunStatus::Paused;
                run.updated_at = Utc::now();
                self.store.update_run_cas(&run, version).await?;
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
    use crate::test_util::fresh_tempdir;
    use warsha_core::{RoleRouting, RoutingTarget};
    use warsha_providers::{MockProvider, ProviderRouter};
    use warsha_store::Store;

    async fn temp_store() -> Arc<Store> {
        let dir = fresh_tempdir();
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

    fn setup_settings() -> Arc<SettingsStore> {
        Arc::new(SettingsStore::new())
    }

    #[tokio::test]
    async fn test_pipeline_start_run() {
        let store = temp_store().await;
        let providers = Arc::new(RwLock::new(ProviderRouter::new()));
        let settings = setup_settings();
        let engine = PipelineEngine::new(store.clone(), providers, settings);

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

    /// A run at a pending Gate C, with the store and engine that serve it.
    async fn pending_gate_run<S: SettingsProvider>(
        store: &Arc<Store>,
        engine: &PipelineEngine<S>,
    ) -> Run {
        let project = Project {
            id: ProjectId::new(),
            name: "Gate Project".to_string(),
            description: "A run with a gate to decide".to_string(),
            language: "en".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            repo_path: None,
            repo_url: None,
        };
        store.create_project(&project).await.expect("a project");
        let run = engine
            .start_run(project.id, "Build a todo app")
            .await
            .expect("a run starts");
        let mut run = store.get_run(run.id).await.expect("the run is readable");
        run.current_stage = Stage::GateC;
        run.gate_states.insert(Stage::GateC, GateState::Pending);
        store.update_run(&run).await.expect("the gate is pending");
        run
    }

    #[tokio::test]
    async fn a_gate_decision_is_recorded_against_the_device_that_made_it() {
        // Security audit H-03 is about *whose* decision a gate stores. The identity is
        // decided by the caller's transport and handed down; what this layer owes the
        // record is that the device it was given is the device that comes back out —
        // on the gate state and on the event — and not one invented along the way.
        let store = temp_store().await;
        let providers = Arc::new(RwLock::new(ProviderRouter::new()));
        let settings = setup_settings();
        let engine = PipelineEngine::new(store.clone(), providers, settings);
        let run = pending_gate_run(&store, &engine).await;

        let approver = DeviceId::new();
        let decided = engine
            .approve_gate(run.id, Stage::GateC, approver)
            .await
            .expect("a verified device approves the gate");

        assert!(
            matches!(
                decided.gate_states[&Stage::GateC],
                GateState::Approved { by, .. } if by == approver
            ),
            "the approver recorded is not the device that decided: {:?}",
            decided.gate_states[&Stage::GateC]
        );

        let events = store.get_events(run.id).await.expect("events are readable");
        let decision = events
            .iter()
            .find(|event| event.kind == EventKind::GateDecision)
            .expect("the decision is on the record");
        assert_eq!(
            decision.device_id,
            Some(approver),
            "the event names a different device than the gate state"
        );
        assert_eq!(decision.payload["by"], approver.0.to_string());
    }

    #[tokio::test]
    async fn a_gate_that_was_already_decided_is_not_decided_twice() {
        let store = temp_store().await;
        let providers = Arc::new(RwLock::new(ProviderRouter::new()));
        let settings = setup_settings();
        let engine = PipelineEngine::new(store.clone(), providers, settings);
        let run = pending_gate_run(&store, &engine).await;

        let approver = DeviceId::new();
        engine
            .approve_gate(run.id, Stage::GateC, approver)
            .await
            .expect("the first decision is accepted");

        // A second device cannot overwrite a decision that is already on the record.
        let error = engine
            .approve_gate(run.id, Stage::GateC, DeviceId::new())
            .await
            .expect_err("a decided gate is not pending");
        assert!(
            matches!(error, PipelineError::GateNotPending(Stage::GateC)),
            "unexpected error: {error:?}"
        );
    }

    #[tokio::test]
    async fn test_gate_approval() {
        let store = temp_store().await;
        let providers = Arc::new(RwLock::new(ProviderRouter::new()));
        let settings = setup_settings();
        let engine = PipelineEngine::new(store.clone(), providers, settings);

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
        let settings = setup_settings();
        let engine = PipelineEngine::new(store.clone(), providers, settings);

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
        let settings = setup_settings();
        let engine = PipelineEngine::new(store.clone(), providers, settings);

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

    /// ENGINE E1 slice: an exhausted budget stops the next advance and stage run.
    mod e1_budget {
        use super::*;

        fn project() -> Project {
            Project {
                id: ProjectId::new(),
                name: "Budget Project".to_string(),
                description: "Test".to_string(),
                language: "en".to_string(),
                created_at: Utc::now(),
                updated_at: Utc::now(),
                repo_path: None,
                repo_url: None,
            }
        }

        #[tokio::test]
        async fn an_exhausted_budget_refuses_the_next_advance() {
            let store = temp_store().await;
            let engine =
                PipelineEngine::new(store.clone(), setup_providers_with_mock(), setup_settings());
            let project = project();
            store.create_project(&project).await.unwrap();
            let mut run = engine
                .start_run(project.id, "Build a todo app")
                .await
                .unwrap();
            run.current_stage = Stage::PrdSpec;
            run.budget_cents = Some(100);
            run.spent_cents = 100;
            store.update_run(&run).await.unwrap();

            let error = engine
                .advance_stage(run.id)
                .await
                .expect_err("an exhausted budget advanced");

            assert!(
                matches!(
                    error,
                    PipelineError::BudgetExceeded {
                        budget_cents: 100,
                        spent_cents: 100
                    }
                ),
                "{error:?}"
            );
            let stored = store.get_run(run.id).await.unwrap();
            assert_eq!(
                stored.current_stage,
                Stage::PrdSpec,
                "the stage moved despite the budget"
            );
        }

        #[tokio::test]
        async fn a_run_with_remaining_budget_still_advances() {
            let store = temp_store().await;
            let engine =
                PipelineEngine::new(store.clone(), setup_providers_with_mock(), setup_settings());
            let project = project();
            store.create_project(&project).await.unwrap();
            let mut run = engine
                .start_run(project.id, "Build a todo app")
                .await
                .unwrap();
            run.current_stage = Stage::PrdSpec;
            run.budget_cents = Some(100);
            run.spent_cents = 99;
            store.update_run(&run).await.unwrap();

            let run = engine
                .advance_stage(run.id)
                .await
                .expect("99 of 100 still advances");
            assert_eq!(run.current_stage, Stage::GateB);
        }

        /// P-E1a: a project that already spent its whole budget cannot start a run,
        /// and the refusal leaves no run row behind (no orphan rows).
        #[tokio::test]
        async fn a_project_that_spent_its_budget_refuses_a_new_run() {
            let store = temp_store().await;
            let engine =
                PipelineEngine::new(store.clone(), setup_providers_with_mock(), setup_settings());
            let project = project();
            store.create_project(&project).await.unwrap();
            let mut first = engine
                .start_run(project.id, "Build a todo app")
                .await
                .unwrap();
            first.budget_cents = Some(100);
            first.spent_cents = 100;
            store.update_run(&first).await.unwrap();

            let error = engine
                .start_run(project.id, "Build a second app")
                .await
                .expect_err("an exhausted project budget started another run");

            assert!(
                matches!(
                    &error,
                    PipelineError::ProjectBudgetExhausted {
                        budget_cents: 100,
                        spent_cents: 100
                    }
                ),
                "{error:?}"
            );
            let message = error.to_string();
            assert!(
                message.contains("spent 100 of 100 cents"),
                "the refusal must name the spent and the budget: {message}"
            );

            let runs = store.list_runs(project.id).await.unwrap();
            assert_eq!(runs.len(), 1, "the refused start created a run row");
            assert_eq!(runs[0].id, first.id);
        }

        /// P-E1a: a project under its budget still starts, and the new run inherits
        /// the budget the project carries instead of dropping it to `None`.
        #[tokio::test]
        async fn a_project_under_budget_starts_a_run_carrying_the_budget() {
            let store = temp_store().await;
            let engine =
                PipelineEngine::new(store.clone(), setup_providers_with_mock(), setup_settings());
            let project = project();
            store.create_project(&project).await.unwrap();
            let mut first = engine
                .start_run(project.id, "Build a todo app")
                .await
                .unwrap();
            first.budget_cents = Some(100);
            first.spent_cents = 40;
            store.update_run(&first).await.unwrap();

            let second = engine
                .start_run(project.id, "Build a second app")
                .await
                .expect("99 of 100 starts, 40 of 100 certainly does");

            assert_eq!(second.budget_cents, Some(100));
            assert_eq!(second.spent_cents, 0);
            let stored = store.get_run(second.id).await.unwrap();
            assert_eq!(stored.budget_cents, Some(100));
        }

        /// P-E1a: unbudgeted stays unbudgeted — the refusal only fires over a budget
        /// that exists.
        #[tokio::test]
        async fn a_project_without_a_budget_starts_an_unbudgeted_run() {
            let store = temp_store().await;
            let engine =
                PipelineEngine::new(store.clone(), setup_providers_with_mock(), setup_settings());
            let project = project();
            store.create_project(&project).await.unwrap();
            let first = engine
                .start_run(project.id, "Build a todo app")
                .await
                .unwrap();
            assert_eq!(first.budget_cents, None);

            let second = engine
                .start_run(project.id, "Build a second app")
                .await
                .expect("no budget is not a ceiling on starting");

            assert_eq!(second.budget_cents, None);
        }

        #[tokio::test]
        async fn a_run_without_a_budget_advances() {
            let store = temp_store().await;
            let engine =
                PipelineEngine::new(store.clone(), setup_providers_with_mock(), setup_settings());
            let project = project();
            store.create_project(&project).await.unwrap();
            let mut run = engine
                .start_run(project.id, "Build a todo app")
                .await
                .unwrap();
            run.current_stage = Stage::PrdSpec;
            store.update_run(&run).await.unwrap();

            let run = engine
                .advance_stage(run.id)
                .await
                .expect("no budget is not a ceiling");
            assert_eq!(run.current_stage, Stage::GateB);
        }
    }

    /// ENGINE E1 slice: the prompt is rendered in the *project's* language.
    ///
    /// The renderer used to hardcode `"en"` for `{{language}}`, so an Arabic
    /// project still received English prompts. These tests pin the rendered value
    /// to the project row and pin the safe `"en"` fallback.
    mod e1_language {
        use super::*;
        use crate::settings::StoredHarness;
        use warsha_providers::{
            ChatChoice, ChatResponse, ChatStreamChunk, HealthCheck, ModelInfo, ProviderError,
        };

        /// A provider that records the system prompt the pipeline actually sent.
        ///
        /// `pub(super)` so the `e1_discovery` module below records the prompt it
        /// sends instead of restating this provider.
        pub(super) struct RecordingProvider {
            pub(super) captured: Arc<std::sync::Mutex<Option<String>>>,
        }

        #[async_trait::async_trait]
        impl ChatProvider for RecordingProvider {
            fn id(&self) -> &str {
                "recording"
            }

            fn kind(&self) -> ProviderKind {
                ProviderKind::CustomOpenAICompatible
            }

            async fn list_models(&self) -> std::result::Result<Vec<ModelInfo>, ProviderError> {
                Ok(vec![ModelInfo {
                    id: "recording-model".to_string(),
                    name: "Recording Model".to_string(),
                    provider: "recording".to_string(),
                    context_window: 8192,
                    max_output: 4096,
                    pricing: ModelPricing {
                        input_per_million_cents: 0,
                        output_per_million_cents: 0,
                    },
                }])
            }

            async fn health(&self) -> std::result::Result<HealthCheck, ProviderError> {
                Ok(HealthCheck {
                    healthy: true,
                    latency_ms: Some(0),
                    error: None,
                })
            }

            async fn chat(
                &self,
                request: ChatRequest,
            ) -> std::result::Result<ChatResponse, ProviderError> {
                if let Some(message) = request.messages.first() {
                    let mut guard = self
                        .captured
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    *guard = Some(message.content.clone());
                }
                Ok(ChatResponse {
                    id: "recording-response".to_string(),
                    model: "recording-model".to_string(),
                    choices: vec![ChatChoice {
                        index: 0,
                        message: ChatMessage {
                            role: MessageRole::Assistant,
                            content: "# Research Report\n\nRecorded content.".to_string(),
                        },
                        finish_reason: Some("stop".to_string()),
                    }],
                    usage: TokenUsage {
                        input: 10,
                        output: 5,
                        total: 15,
                    },
                })
            }

            async fn chat_stream(
                &self,
                _request: ChatRequest,
            ) -> std::result::Result<
                Box<
                    dyn futures::Stream<Item = std::result::Result<ChatStreamChunk, ProviderError>>
                        + Send
                        + Unpin,
                >,
                ProviderError,
            > {
                Err(ProviderError::Other(
                    "streaming is not part of this test".to_string(),
                ))
            }

            fn cost_of(
                &self,
                _model: &str,
                _usage: &TokenUsage,
            ) -> std::result::Result<u64, ProviderError> {
                Ok(1)
            }
        }

        /// A project whose language the test names, stored in `store`.
        pub(super) async fn project_in(store: &Arc<Store>, language: &str) -> Project {
            let project = Project {
                id: ProjectId::new(),
                name: "Language Project".to_string(),
                description: "A project whose language decides how prompts render".to_string(),
                language: language.to_string(),
                created_at: Utc::now(),
                updated_at: Utc::now(),
                repo_path: None,
                repo_url: None,
            };
            store.create_project(&project).await.expect("a project");
            project
        }

        /// Settings whose active harness puts `{{language}}` in the Researcher prompt,
        /// the one stage a test reaches with two advances and one gate approval.
        async fn settings_with_language_template(project_id: ProjectId) -> Arc<SettingsStore> {
            let settings = SettingsStore::new();
            let definition = HarnessDefinition {
                id: "language-harness".to_string(),
                version: "1.0.0".to_string(),
                name: "Language Harness".to_string(),
                description: "Renders the problem statement in the project's language".to_string(),
                stages: vec![HarnessStage {
                    id: "research".to_string(),
                    role: Role::Researcher,
                    name: "Research".to_string(),
                    prompt_template: Some(
                        "---\nrole: researcher\nstage: research\n---\n\n\
                         Research the idea and answer in Language: `{{language}}`."
                            .to_string(),
                    ),
                    gate: None,
                    auto_advance: true,
                }],
                rules: HarnessRules {
                    max_repair_iterations: 1,
                    budget_cap_cents: None,
                    allow_parallel_subagents: false,
                    require_verification_receipt: false,
                },
                preset: false,
                active: false,
                created_at: Utc::now(),
            };
            settings
                .save_harness(&StoredHarness {
                    id: "language-harness".to_string(),
                    version: "1.0.0".to_string(),
                    name: "Language Harness".to_string(),
                    description: "Renders prompts in the project's language".to_string(),
                    data_json: serde_json::to_string(&definition).expect("a harness definition"),
                    is_preset: false,
                    created_at: 1_735_689_600,
                })
                .await
                .expect("the harness is stored");
            settings
                .set_active_harness(&project_id.0.to_string(), "language-harness")
                .await
                .expect("the harness is active");
            Arc::new(settings)
        }

        /// The system prompt the pipeline sent for the run's first executed stage.
        ///
        /// The run executes the Researcher stage, whose harness template carries
        /// `{{language}}`, so the captured prompt shows what the project's language
        /// resolved to.
        async fn first_executed_prompt(store: &Arc<Store>, language: &str) -> String {
            let project = project_in(store, language).await;

            let captured = Arc::new(std::sync::Mutex::new(None::<String>));
            let mut router = ProviderRouter::new();
            router.register_provider(Box::new(RecordingProvider {
                captured: captured.clone(),
            }));
            router.set_role_routing(RoleRouting {
                role: Role::Researcher,
                targets: vec![RoutingTarget {
                    provider_id: "recording".to_string(),
                    model_id: "recording-model".to_string(),
                    weight: 100,
                }],
                fallback_enabled: false,
                budget_cents_per_run: None,
            });
            let engine = PipelineEngine::new(
                store.clone(),
                Arc::new(RwLock::new(router)),
                settings_with_language_template(project.id).await,
            );
            let run = engine
                .start_run(project.id, "Build a todo app")
                .await
                .expect("a run starts");
            let at_gate = engine
                .advance_stage(run.id)
                .await
                .expect("advance to Gate A");
            assert_eq!(at_gate.current_stage, Stage::GateA);
            engine
                .approve_gate(run.id, Stage::GateA, DeviceId::new())
                .await
                .expect("Gate A approves");
            let executed = engine
                .advance_stage(run.id)
                .await
                .expect("the research stage executes");
            assert_eq!(executed.current_stage, Stage::Research);

            let prompt = captured
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clone()
                .expect("the provider received a prompt");
            prompt
        }

        #[tokio::test]
        async fn a_run_prompt_uses_the_project_language_not_english() {
            let store = temp_store().await;
            let prompt = first_executed_prompt(&store, "ar").await;

            assert!(
                prompt.contains("Language: `ar`"),
                "the project's language never reached the template: {prompt}"
            );
            assert!(
                !prompt.contains("Language: `en`"),
                "the prompt still hardcoded English: {prompt}"
            );
            assert!(
                !prompt.contains("{{language}}"),
                "the placeholder was left unrendered: {prompt}"
            );
        }

        #[tokio::test]
        async fn a_run_prompt_falls_back_to_english_when_the_project_language_is_missing() {
            // A blank language row: no panic, English.
            let store = temp_store().await;
            let prompt = first_executed_prompt(&store, "").await;
            assert!(
                prompt.contains("Language: `en`"),
                "a blank language did not fall back to English: {prompt}"
            );

            // A project row that is not there at all: same fallback, still no panic.
            let engine = PipelineEngine::new(
                store.clone(),
                setup_providers_with_mock(),
                settings_with_language_template(ProjectId::new()).await,
            );
            assert_eq!(
                engine.project_language(ProjectId::new()).await,
                "en",
                "a missing project row must render English, not fail"
            );
        }
    }

    /// ENGINE E1 slice: the run's prompts come from the *harness's* stored data,
    /// not from a canned map.
    ///
    /// What is real data today, pinned below:
    ///
    /// * the active harness per project (`settings.get_active_harness`), its stored
    ///   definition (`settings.get_harness` → `data_json`) and the `prompt_template`
    ///   its stage for the run's role carries — a harness template is the text the
    ///   provider receives;
    /// * the enabled skills (`settings.list_skills`), prepended to that text.
    ///
    /// What is still static, pinned as such rather than redesigned:
    ///
    /// * the walk is `Stage::all()`/`Stage::next()`, and the stage → role map is
    ///   `prompts::role_for_stage`; the harness is consulted *by role* for the
    ///   current stage, so its `stages` vector is a lookup table and not the run's
    ///   itinerary, and its `gate`/`auto_advance`/`rules` fields never reach the walk;
    /// * a harness with no template for the run's role falls back to the built-in
    ///   prompt (`prompts::get_prompt`), and `"autonomous-factory"` is the harness
    ///   the pipeline falls back to when no harness is active. That fallback is a
    ///   built-in *template*, not a fabricated answer: the role still has to be
    ///   routed, and an unrouted role fails with `NoProviderRouted` below.
    mod e1_discovery {
        use super::e1_language::{project_in, RecordingProvider};
        use super::*;
        use crate::prompts::get_prompt;
        use crate::settings::StoredHarness;
        use std::sync::Mutex;

        /// Text only the harness template stored by these tests carries. The canned
        /// Researcher prompt cannot produce it, so a prompt carrying it proves the
        /// harness row was read.
        const HARNESS_BRIEF: &str =
            "HARNESS-DISCOVERY-BRIEF: research exactly what this harness asks for.";

        /// Text only the built-in `prompts/researcher.md` carries.
        const CANNED_BRIEF: &str = "You are the **Researcher Agent** for Warsha";

        /// Which harness the run's project points at.
        enum ActiveHarness {
            /// No active harness: the pipeline's `"autonomous-factory"` fallback decides.
            Unset,
            /// The active harness id whose row this is.
            Stored(StoredHarness),
            /// An active harness id with no row behind it.
            MissingRow(&'static str),
        }

        fn harness_stage(role: Role, template: Option<String>) -> HarnessStage {
            HarnessStage {
                id: format!("{:?}", role).to_lowercase(),
                role,
                name: format!("{:?}", role),
                prompt_template: template,
                gate: None,
                auto_advance: true,
            }
        }

        fn harness_row(id: &str, stages: Vec<HarnessStage>) -> StoredHarness {
            let definition = HarnessDefinition {
                id: id.to_string(),
                version: "1.0.0".to_string(),
                name: "Discovery Harness".to_string(),
                description: "A harness whose own stages and templates the run must read"
                    .to_string(),
                stages,
                rules: HarnessRules {
                    max_repair_iterations: 1,
                    budget_cap_cents: None,
                    allow_parallel_subagents: false,
                    require_verification_receipt: false,
                },
                preset: false,
                active: false,
                created_at: Utc::now(),
            };
            StoredHarness {
                id: id.to_string(),
                version: "1.0.0".to_string(),
                name: "Discovery Harness".to_string(),
                description: "A harness whose own stages and templates the run must read"
                    .to_string(),
                data_json: serde_json::to_string(&definition).expect("a harness definition"),
                is_preset: false,
                created_at: 1_735_689_600,
            }
        }

        /// The harness's own Researcher template: the role marker real templates
        /// carry, then text no built-in prompt has.
        fn research_template() -> String {
            format!("---\nrole: researcher\nstage: research\n---\n\n{HARNESS_BRIEF}")
        }

        /// Start a run whose project points at `active`, drive it to the first
        /// executed stage (`Research`, with Gate A approved on the way), and answer
        /// with the system prompt the provider received.
        async fn prompt_at_research(store: &Arc<Store>, active: ActiveHarness) -> String {
            let project = project_in(store, "en").await;
            let settings = SettingsStore::new();
            match active {
                ActiveHarness::Unset => {}
                ActiveHarness::Stored(harness) => {
                    settings
                        .save_harness(&harness)
                        .await
                        .expect("the harness is stored");
                    settings
                        .set_active_harness(&project.id.0.to_string(), &harness.id)
                        .await
                        .expect("the harness is active");
                }
                ActiveHarness::MissingRow(id) => {
                    settings
                        .set_active_harness(&project.id.0.to_string(), id)
                        .await
                        .expect("the harness id is active");
                }
            }

            let captured = Arc::new(Mutex::new(None::<String>));
            let mut router = ProviderRouter::new();
            router.register_provider(Box::new(RecordingProvider {
                captured: captured.clone(),
            }));
            router.set_role_routing(RoleRouting {
                role: Role::Researcher,
                targets: vec![RoutingTarget {
                    provider_id: "recording".to_string(),
                    model_id: "recording-model".to_string(),
                    weight: 100,
                }],
                fallback_enabled: false,
                budget_cents_per_run: None,
            });
            let engine = PipelineEngine::new(
                store.clone(),
                Arc::new(RwLock::new(router)),
                Arc::new(settings),
            );

            let run = engine
                .start_run(project.id, "Build a todo app")
                .await
                .expect("a run starts");
            let at_gate = engine
                .advance_stage(run.id)
                .await
                .expect("advance to Gate A");
            assert_eq!(at_gate.current_stage, Stage::GateA);
            engine
                .approve_gate(run.id, Stage::GateA, DeviceId::new())
                .await
                .expect("Gate A approves");
            let executed = engine
                .advance_stage(run.id)
                .await
                .expect("the research stage executes");
            assert_eq!(executed.current_stage, Stage::Research);

            let prompt = captured
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clone();
            prompt.expect("the provider received a prompt")
        }

        /// P-E1b: the harness's `prompt_template` for the run's stage is the text
        /// the provider receives — not the built-in role prompt.
        ///
        /// The discrimination is structural: `HARNESS_BRIEF` exists only in the
        /// harness row this test stores and `CANNED_BRIEF` only in
        /// `prompts/researcher.md`, so a canned-map answer cannot pass both
        /// assertions.
        #[tokio::test]
        async fn a_harness_prompt_template_drives_discovery_instead_of_the_canned_map() {
            let store = temp_store().await;
            let harness = harness_row(
                "discovery-harness",
                vec![harness_stage(Role::Researcher, Some(research_template()))],
            );
            let prompt = prompt_at_research(&store, ActiveHarness::Stored(harness)).await;

            assert!(
                prompt.contains(HARNESS_BRIEF),
                "the harness's own template never reached the provider: {prompt}"
            );
            assert!(
                !prompt.contains(CANNED_BRIEF),
                "the canned role prompt was used although the harness has a template: {prompt}"
            );
            // Without this, the negative assertion above could pass vacuously.
            assert!(
                get_prompt(Role::Researcher).contains(CANNED_BRIEF),
                "the built-in Researcher prompt moved; {CANNED_BRIEF} is no longer in it"
            );
        }

        /// P-E1b: the K3 provider-truth posture on the discovery path. A harness
        /// whose Researcher stage nothing can serve — the harness names the role,
        /// the routing has no route for it — fails the advance with the explicit
        /// [`PipelineError::NoProviderRouted`]; the run pauses with a
        /// `provider_required` event and no research artifact is fabricated, so the
        /// harness template is never answered by a built-in stub.
        #[tokio::test]
        async fn an_unroutable_role_fails_closed_in_discovery_with_no_provider_routed() {
            let store = temp_store().await;
            let project = project_in(&store, "en").await;
            let harness = harness_row(
                "discovery-harness",
                vec![harness_stage(Role::Researcher, Some(research_template()))],
            );
            let settings = SettingsStore::new();
            settings
                .save_harness(&harness)
                .await
                .expect("the harness is stored");
            settings
                .set_active_harness(&project.id.0.to_string(), &harness.id)
                .await
                .expect("the harness is active");
            let engine = PipelineEngine::new(
                store.clone(),
                Arc::new(RwLock::new(ProviderRouter::new())),
                Arc::new(settings),
            );

            let run = engine
                .start_run(project.id, "Build a todo app")
                .await
                .expect("a run starts");
            engine
                .advance_stage(run.id)
                .await
                .expect("advance to Gate A");
            engine
                .approve_gate(run.id, Stage::GateA, DeviceId::new())
                .await
                .expect("Gate A approves");

            let error = engine
                .advance_stage(run.id)
                .await
                .expect_err("an unrouted role was answered anyway");
            assert!(
                matches!(error, PipelineError::NoProviderRouted(Role::Researcher)),
                "the unrouted role must fail with the explicit error, got: {error:?}"
            );

            let stored = store.get_run(run.id).await.expect("the run is readable");
            assert_eq!(
                stored.status,
                RunStatus::Paused,
                "an unrouted role must pause the run, not leave it running"
            );
            assert!(
                !stored.artifacts.contains_key("research"),
                "an unrouted stage fabricated a research artifact"
            );
            let events = store.get_events(run.id).await.expect("the run's events");
            let required = events
                .iter()
                .find(|event| event.payload["action"] == "provider_required")
                .expect("no provider_required event was recorded");
            assert_eq!(required.payload["role"], "researcher");
        }

        /// P-E1b boundary: the harness's `stages` vector is a lookup table keyed by
        /// role, not the run's itinerary. A harness naming only a role this run
        /// never resolves (`Role::QA`; the walk maps `ReviewQaSecurity` to
        /// `Role::Reviewer`) leaves the run on the built-in prompt: the harness data
        /// is real, but it neither adds nor skips a stage.
        #[tokio::test]
        async fn a_harness_stage_the_walk_never_uses_does_not_hijack_discovery() {
            let store = temp_store().await;
            let harness = harness_row(
                "discovery-harness",
                vec![harness_stage(
                    Role::QA,
                    Some("HARNESS-QA-ONLY: emit the verification receipt.".to_string()),
                )],
            );
            let prompt = prompt_at_research(&store, ActiveHarness::Stored(harness)).await;

            assert!(
                prompt.contains(CANNED_BRIEF),
                "the run left the built-in prompt although the harness has no Researcher \
                 stage: {prompt}"
            );
            assert!(
                !prompt.contains("HARNESS-QA-ONLY"),
                "a harness stage for another role reached this stage's prompt: {prompt}"
            );
            assert_eq!(
                crate::prompts::role_for_stage(Stage::Research),
                Some(Role::Researcher),
                "the stage this run executes is no longer mapped to Researcher"
            );
        }

        /// P-E1b: the `"autonomous-factory"` fallback and the missing-data fallback
        /// render the built-in role prompt, and that is distinguishable from the
        /// harness path — which never renders `CANNED_BRIEF`.
        #[tokio::test]
        async fn the_autonomous_factory_fallback_renders_the_built_in_prompt_in_discovery() {
            // (a) No active harness: the pipeline's `"autonomous-factory"` fallback
            // decides, and that harness's Researcher stage carries no template.
            let store = temp_store().await;
            let prompt = prompt_at_research(&store, ActiveHarness::Unset).await;
            assert!(
                prompt.contains(CANNED_BRIEF),
                "the fallback harness never rendered the built-in prompt: {prompt}"
            );
            assert!(
                !prompt.contains(HARNESS_BRIEF),
                "a harness template appeared with no harness active: {prompt}"
            );

            // (b) An active harness id with no row behind it: same built-in prompt,
            // and the run still executes instead of failing.
            let store = temp_store().await;
            let prompt =
                prompt_at_research(&store, ActiveHarness::MissingRow("no-such-harness")).await;
            assert!(
                prompt.contains(CANNED_BRIEF),
                "a missing harness row did not fall back to the built-in prompt: {prompt}"
            );

            // (c) A row whose `data_json` does not parse: the stage lookup finds
            // nothing and the run stays on the built-in prompt. The catalog keeps
            // such a row visible as a stageless harness (`wave2::harness_definition`),
            // so this is that documented degradation, not a role-resolution error.
            let mut damaged = harness_row(
                "discovery-harness",
                vec![harness_stage(Role::Researcher, Some(research_template()))],
            );
            damaged.data_json = "{ not a harness definition".to_string();
            let store = temp_store().await;
            let prompt = prompt_at_research(&store, ActiveHarness::Stored(damaged)).await;
            assert!(
                prompt.contains(CANNED_BRIEF),
                "an unreadable harness row did not fall back to the built-in prompt: {prompt}"
            );
            assert!(
                !prompt.contains(HARNESS_BRIEF),
                "a template was read out of an unreadable harness row: {prompt}"
            );
        }
    }
}
