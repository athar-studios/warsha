//! Settings store wrapper for the pipeline crate.
//!
//! This provides a thin async wrapper around the daemon's SettingsStore
//! so the pipeline can access active harness, skills, and plugins.

use chrono::DateTime;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use warsha_core::{HarnessDefinition, HarnessRules, HarnessStage, Role};

/// Trait for providing settings to the pipeline - implemented by both
/// the in-memory test store and the daemon's SQLite-backed store.
#[async_trait::async_trait]
pub trait SettingsProvider: Send + Sync + 'static {
    /// Get the active harness for a project
    async fn get_active_harness(&self, project_id: &str) -> Result<Option<String>, SettingsError>;

    /// Get a harness by id
    async fn get_harness(&self, id: &str) -> Result<Option<StoredHarness>, SettingsError>;

    /// List all skills
    async fn list_skills(&self) -> Result<Vec<StoredSkill>, SettingsError>;

    /// List all plugins (optional, for future use)
    async fn list_plugins(&self) -> Result<Vec<StoredPlugin>, SettingsError> {
        Ok(Vec::new())
    }
}

/// Settings store for the pipeline - local types to avoid circular dependency
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// One plugin row
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredPlugin {
    /// Stable plugin identifier.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// One-line description.
    pub description: String,
    /// Upstream source.
    pub source: String,
    /// SPDX license tag.
    pub license: String,
    /// The plugin manifest/pack definition as JSON.
    pub data_json: String,
    /// Whether the plugin is active.
    pub enabled: bool,
}

/// Error type for settings operations
#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("settings store: {0}")]
    Store(String),
    #[error("settings task: {0}")]
    Task(String),
    #[error("settings document {name}: {reason}")]
    DocumentIo { name: String, reason: String },
    #[error("settings document {0} is not valid JSON")]
    DocumentFormat(String),
}

/// In-memory settings store for testing
#[derive(Debug, Clone)]
pub struct SettingsStore {
    harnesses: Arc<RwLock<HashMap<String, StoredHarness>>>,
    skills: Arc<RwLock<HashMap<String, StoredSkill>>>,
    plugins: Arc<RwLock<HashMap<String, StoredPlugin>>>,
    active_harness: Arc<RwLock<HashMap<String, String>>>,
}

impl SettingsStore {
    /// Create a new settings store with defaults
    pub fn new() -> Self {
        let mut harnesses = HashMap::new();
        harnesses.insert(
            "autonomous-factory".to_string(),
            autonomous_factory_harness(),
        );

        let mut skills = HashMap::new();
        skills.insert("test-driven-development".to_string(), StoredSkill {
            id: "test-driven-development".to_string(),
            name: "Test-Driven Development".to_string(),
            description: "Write the failing test first, watch it fail for the right reason, then implement the minimum code to pass.".to_string(),
            source: "github.com/obra/superpowers".to_string(),
            license: "MIT".to_string(),
            content: "# Test-Driven Development\n\nWrite the failing test first, watch it fail for the right reason, then implement the minimum code to pass. Red, green, refactor.\n".to_string(),
            enabled: true,
            tags_json: serde_json::to_string(&["testing", "coding", "quality"]).unwrap(),
        });

        Self {
            harnesses: Arc::new(RwLock::new(harnesses)),
            skills: Arc::new(RwLock::new(skills)),
            plugins: Arc::new(RwLock::new(HashMap::new())),
            active_harness: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Get the active harness for a project
    pub async fn get_active_harness(
        &self,
        project_id: &str,
    ) -> Result<Option<String>, SettingsError> {
        let map = self.active_harness.read().await;
        Ok(map.get(project_id).cloned())
    }

    /// Get a harness by id
    pub async fn get_harness(&self, id: &str) -> Result<Option<StoredHarness>, SettingsError> {
        let map = self.harnesses.read().await;
        Ok(map.get(id).cloned())
    }

    /// List all skills
    pub async fn list_skills(&self) -> Result<Vec<StoredSkill>, SettingsError> {
        let map = self.skills.read().await;
        Ok(map.values().cloned().collect())
    }

    /// List all plugins
    pub async fn list_plugins(&self) -> Result<Vec<StoredPlugin>, SettingsError> {
        let map = self.plugins.read().await;
        Ok(map.values().cloned().collect())
    }

    /// Save a harness (for testing)
    pub async fn save_harness(&self, harness: &StoredHarness) -> Result<(), SettingsError> {
        let mut map = self.harnesses.write().await;
        map.insert(harness.id.clone(), harness.clone());
        Ok(())
    }

    /// Save a skill (for testing)
    pub async fn save_skill(&self, skill: &StoredSkill) -> Result<(), SettingsError> {
        let mut map = self.skills.write().await;
        map.insert(skill.id.clone(), skill.clone());
        Ok(())
    }

    /// Set active harness for a project (for testing)
    pub async fn set_active_harness(
        &self,
        project_id: &str,
        harness_id: &str,
    ) -> Result<(), SettingsError> {
        let mut map = self.active_harness.write().await;
        map.insert(project_id.to_string(), harness_id.to_string());
        Ok(())
    }
}

#[async_trait::async_trait]
impl SettingsProvider for SettingsStore {
    async fn get_active_harness(&self, project_id: &str) -> Result<Option<String>, SettingsError> {
        self.get_active_harness(project_id).await
    }

    async fn get_harness(&self, id: &str) -> Result<Option<StoredHarness>, SettingsError> {
        self.get_harness(id).await
    }

    async fn list_skills(&self) -> Result<Vec<StoredSkill>, SettingsError> {
        self.list_skills().await
    }

    async fn list_plugins(&self) -> Result<Vec<StoredPlugin>, SettingsError> {
        self.list_plugins().await
    }
}

fn autonomous_factory_harness() -> StoredHarness {
    let harness_def = HarnessDefinition {
        id: "autonomous-factory".to_string(),
        version: "1.0.0".to_string(),
        name: "Autonomous Factory".to_string(),
        description: "Loki + Hard Mode 9-stage autonomous pipeline".to_string(),
        stages: vec![
            HarnessStage {
                id: "intake".to_string(),
                role: Role::Intake,
                name: "Intake".to_string(),
                prompt_template: Some("Capture the ticket or idea verbatim; do not interpret yet.".to_string()),
                gate: Some("supervisor-approval".to_string()),
                auto_advance: false,
            },
            HarnessStage {
                id: "research".to_string(),
                role: Role::Researcher,
                name: "Research".to_string(),
                prompt_template: None,
                gate: None,
                auto_advance: true,
            },
            HarnessStage {
                id: "prd".to_string(),
                role: Role::PM,
                name: "PRD spec".to_string(),
                prompt_template: Some("Write the PRD; ambiguities are decided and logged, never asked.".to_string()),
                gate: None,
                auto_advance: true,
            },
            HarnessStage {
                id: "design".to_string(),
                role: Role::Designer,
                name: "Design".to_string(),
                prompt_template: None,
                gate: None,
                auto_advance: true,
            },
            HarnessStage {
                id: "architect".to_string(),
                role: Role::Architect,
                name: "Architecture".to_string(),
                prompt_template: None,
                gate: None,
                auto_advance: true,
            },
            HarnessStage {
                id: "code".to_string(),
                role: Role::Coder,
                name: "Coding".to_string(),
                prompt_template: Some("Implement against the architecture. Budget cap is hard: stop and report rather than exceed it.".to_string()),
                gate: None,
                auto_advance: true,
            },
            HarnessStage {
                id: "review".to_string(),
                role: Role::Reviewer,
                name: "Automated evaluation".to_string(),
                prompt_template: None,
                gate: Some("auto-eval".to_string()),
                auto_advance: true,
            },
            HarnessStage {
                id: "qa".to_string(),
                role: Role::QA,
                name: "Verification".to_string(),
                prompt_template: Some("Run the full suite and emit the verification receipt.".to_string()),
                gate: Some("verification-receipt".to_string()),
                auto_advance: true,
            },
            HarnessStage {
                id: "release".to_string(),
                role: Role::Release,
                name: "Release".to_string(),
                prompt_template: None,
                gate: None,
                auto_advance: true,
            },
        ],
        rules: HarnessRules {
            max_repair_iterations: 3,
            budget_cap_cents: Some(2000),
            allow_parallel_subagents: true,
            require_verification_receipt: true,
        },
        preset: true,
        active: false,
        created_at: DateTime::from_timestamp(1_735_689_600, 0).unwrap_or_default(),
    };

    StoredHarness {
        id: "autonomous-factory".to_string(),
        version: "1.0.0".to_string(),
        name: "Autonomous Factory".to_string(),
        description: "Loki + Hard Mode 9-stage autonomous pipeline".to_string(),
        data_json: serde_json::to_string(&harness_def).unwrap(),
        is_preset: true,
        created_at: 1_735_689_600,
    }
}
