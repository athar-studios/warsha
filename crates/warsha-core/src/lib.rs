//! Warsha Core — Domain types for projects, runs, stages, gates, artifacts, events

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ulid::Ulid;
use uuid::Uuid;

/// Unique identifier for a project
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ProjectId(pub Uuid);

impl ProjectId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for ProjectId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for ProjectId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Unique identifier for a run
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RunId(pub Ulid);

impl RunId {
    pub fn new() -> Self {
        Self(Ulid::new())
    }
}

impl Default for RunId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for RunId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Pipeline stages as defined in the specification
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    Idea,
    GateA,
    Research,
    PrdSpec,
    GateB,
    Design,
    PlanTasks,
    Code,
    ReviewQaSecurity,
    GateC,
    Release,
    GateD,
    LaunchDrafts,
    Feedback,
}

impl Stage {
    pub fn all() -> &'static [Stage] {
        &[
            Stage::Idea,
            Stage::GateA,
            Stage::Research,
            Stage::PrdSpec,
            Stage::GateB,
            Stage::Design,
            Stage::PlanTasks,
            Stage::Code,
            Stage::ReviewQaSecurity,
            Stage::GateC,
            Stage::Release,
            Stage::GateD,
            Stage::LaunchDrafts,
            Stage::Feedback,
        ]
    }

    pub fn next(&self) -> Option<Stage> {
        let stages = Stage::all();
        let idx = stages.iter().position(|s| s == self)?;
        stages.get(idx + 1).copied()
    }

    pub fn is_gate(&self) -> bool {
        matches!(
            self,
            Stage::GateA | Stage::GateB | Stage::GateC | Stage::GateD
        )
    }
}

/// Gate state machine: pending → approved | rejected(reason) | changes_requested(notes)
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", content = "detail", rename_all = "snake_case")]
pub enum GateState {
    #[default]
    Pending,
    Approved {
        by: DeviceId,
        at: DateTime<Utc>,
    },
    Rejected {
        reason: String,
        by: DeviceId,
        at: DateTime<Utc>,
    },
    ChangesRequested {
        notes: String,
        by: DeviceId,
        at: DateTime<Utc>,
    },
}

/// Device identifier for remote pairing
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DeviceId(pub Uuid);

impl DeviceId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for DeviceId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for DeviceId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Agent roles in the pipeline
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Intake,
    Researcher,
    PM,
    Designer,
    Architect,
    Coder,
    Reviewer,
    QA,
    Security,
    Release,
    Marketer,
    Feedback,
}

impl Role {
    pub fn all() -> &'static [Role] {
        &[
            Role::Intake,
            Role::Researcher,
            Role::PM,
            Role::Designer,
            Role::Architect,
            Role::Coder,
            Role::Reviewer,
            Role::QA,
            Role::Security,
            Role::Release,
            Role::Marketer,
            Role::Feedback,
        ]
    }
}

/// Project configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: ProjectId,
    pub name: String,
    pub description: String,
    pub language: String, // "ar" or "en"
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub repo_path: Option<String>,
    pub repo_url: Option<String>,
}

/// Run represents a single execution of the pipeline for a project
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Run {
    pub id: RunId,
    pub project_id: ProjectId,
    pub current_stage: Stage,
    pub gate_states: HashMap<Stage, GateState>,
    pub artifacts: HashMap<String, Artifact>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub status: RunStatus,
    pub budget_cents: Option<u64>,
    pub spent_cents: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Running,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

/// Artifact generated during a run (stored as markdown in factory/)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artifact {
    pub name: String,
    pub content: String,
    pub stage: Stage,
    pub role: Option<Role>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub version: u32,
}

/// Event — append-only log of everything that happens in a run
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: Ulid,
    pub run_id: RunId,
    pub stage: Stage,
    pub role: Option<Role>,
    pub kind: EventKind,
    pub payload: serde_json::Value,
    pub cost_cents: Option<u64>,
    pub tokens: Option<TokenUsage>,
    pub created_at: DateTime<Utc>,
    pub device_id: Option<DeviceId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    StageStarted,
    StageCompleted,
    GateDecision,
    AgentStep,
    ToolCall,
    ArtifactCreated,
    ArtifactUpdated,
    CostRecorded,
    Error,
    Fallback,
    BudgetWarning,
    BudgetExceeded,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenUsage {
    pub input: u64,
    pub output: u64,
    pub total: u64,
}

/// Provider configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub kind: ProviderKind,
    pub models: Vec<ModelConfig>,
    pub credentials: CredentialsRef,
    pub enabled: bool,
    pub priority: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    OpenAI,
    Anthropic,
    GoogleGemini,
    DeepSeek,
    OpenRouter,
    AzureOpenAI,
    Ollama,
    LMStudio,
    CustomOpenAICompatible,
    ClaudeCode,
    CodexCLI,
    GeminiCLI,
    CursorCLI,
    OpenHands,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub id: String,
    pub name: String,
    pub context_window: u32,
    pub max_output: u32,
    pub pricing: ModelPricing,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ModelPricing {
    pub input_per_million_cents: u64,
    pub output_per_million_cents: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CredentialsRef {
    Keychain { service: String, account: String },
    EnvVar { var: String },
    None,
}

/// Role routing configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleRouting {
    pub role: Role,
    pub targets: Vec<RoutingTarget>,
    pub fallback_enabled: bool,
    pub budget_cents_per_run: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingTarget {
    pub provider_id: String,
    pub model_id: String,
    pub weight: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stage_order() {
        assert_eq!(Stage::Idea.next(), Some(Stage::GateA));
        assert_eq!(Stage::GateA.next(), Some(Stage::Research));
        assert_eq!(Stage::Research.next(), Some(Stage::PrdSpec));
        assert_eq!(Stage::PrdSpec.next(), Some(Stage::GateB));
        assert_eq!(Stage::GateB.next(), Some(Stage::Design));
        assert_eq!(Stage::Design.next(), Some(Stage::PlanTasks));
        assert_eq!(Stage::PlanTasks.next(), Some(Stage::Code));
        assert_eq!(Stage::Code.next(), Some(Stage::ReviewQaSecurity));
        assert_eq!(Stage::ReviewQaSecurity.next(), Some(Stage::GateC));
        assert_eq!(Stage::GateC.next(), Some(Stage::Release));
        assert_eq!(Stage::Release.next(), Some(Stage::GateD));
        assert_eq!(Stage::GateD.next(), Some(Stage::LaunchDrafts));
        assert_eq!(Stage::LaunchDrafts.next(), Some(Stage::Feedback));
        assert_eq!(Stage::Feedback.next(), None);
    }

    #[test]
    fn test_stage_all_matches_next_chain() {
        let stages = Stage::all();
        assert_eq!(stages.len(), 14);
        assert_eq!(stages.first(), Some(&Stage::Idea));
        assert_eq!(stages.last(), Some(&Stage::Feedback));
        for pair in stages.windows(2) {
            assert_eq!(pair[0].next(), Some(pair[1]));
        }
    }

    #[test]
    fn test_is_gate() {
        assert!(Stage::GateA.is_gate());
        assert!(Stage::GateB.is_gate());
        assert!(Stage::GateC.is_gate());
        assert!(Stage::GateD.is_gate());
        let non_gates = [
            Stage::Idea,
            Stage::Research,
            Stage::PrdSpec,
            Stage::Design,
            Stage::PlanTasks,
            Stage::Code,
            Stage::ReviewQaSecurity,
            Stage::Release,
            Stage::LaunchDrafts,
            Stage::Feedback,
        ];
        for stage in non_gates {
            assert!(!stage.is_gate());
        }
        assert_eq!(Stage::all().iter().filter(|s| s.is_gate()).count(), 4);
    }

    #[test]
    fn test_gate_wire_names_round_trip() {
        assert_eq!(serde_json::to_string(&Stage::GateA).unwrap(), "\"gate_a\"");
        assert_eq!(serde_json::to_string(&Stage::GateB).unwrap(), "\"gate_b\"");
        assert_eq!(
            serde_json::from_str::<Stage>("\"gate_a\"").unwrap(),
            Stage::GateA
        );
        assert_eq!(
            serde_json::from_str::<Stage>("\"gate_b\"").unwrap(),
            Stage::GateB
        );
    }

    #[test]
    fn test_gate_state_default() {
        let gate = GateState::default();
        assert_eq!(gate, GateState::Pending);
    }

    #[test]
    fn test_project_id_unique() {
        let id1 = ProjectId::new();
        let id2 = ProjectId::new();
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_run_id_unique() {
        let id1 = RunId::new();
        let id2 = RunId::new();
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_token_usage() {
        let usage = TokenUsage {
            input: 100,
            output: 50,
            total: 150,
        };
        assert_eq!(usage.total, usage.input + usage.output);
    }
}
