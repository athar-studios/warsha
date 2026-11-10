//! Warsha Pipeline — Stage engine, agent roles, prompts, gate state machine

use crate::settings::{SettingsProvider, SettingsStore};
use chrono::Utc;
use std::collections::HashMap;
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
mod agent_tools;
mod agent_workflow;
mod backend_kit;
mod build_cache;
mod command_policy;
mod evals;
mod gate_integrity;
mod guardrails;
mod handoff;
mod llm_cache;
pub mod mcp;
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

/// Pipeline engine that drives the stage machine
pub struct PipelineEngine<S: SettingsProvider> {
    store: Arc<Store>,
    #[allow(dead_code)]
    providers: Arc<RwLock<ProviderRouter>>,
    orchestrator: Orchestrator,
    /// Settings store for accessing active harness, enabled skills, and plugins
    settings: Arc<S>,
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
            run_controls: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        }
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

        // Render the prompt with context
        let prompt = self.render_prompt(&prompt_template, &context);

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

        let mut cancel_rx = ctrl.cancel_tx.subscribe();
        if *cancel_rx.borrow() {
            return Err(PipelineError::Other(
                "Run cancelled before stage execution".to_string(),
            ));
        }
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

        // Re-check cancellation and commit under state_lock via CAS before writing any artifact.
        let (
            artifact_name,
            artifact_content,
            cost_cents,
            tokens,
            budget_exceeded_info,
            budget_warn_info,
        ) = {
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

            // Parse the response
            let artifact_content = response
                .choices
                .first()
                .map(|c| c.message.content.clone())
                .unwrap_or_default();

            // Calculate cost
            let cost_cents = providers.cost_of(&response.model, &response.usage)?;
            let tokens = Some(response.usage.clone());

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
                cost_cents,
                tokens,
                budget_exceeded_info,
                budget_warn_info,
            )
        };

        // Persist artifact file to factory and append events only after CAS succeeded.
        self.store
            .write_artifact(run.project_id, &artifact_name, &artifact_content)
            .await?;

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
}
