//! Harness + Skills wiring test for pipeline execution.
//!
//! This test verifies that the `execute_stage` method correctly:
//! 1. Retrieves the active harness for the project
//! 2. Finds the matching stage in the harness by role
//! 3. Uses the harness stage's prompt_template (if present) instead of the default role prompt
//! 4. Prepends enabled skills' content to the prompt
//! 5. Composes the final prompt sent to the provider

use async_trait::async_trait;
use futures::Stream;
use std::path::PathBuf;
use std::sync::Arc;

use chrono::Utc;
use tempfile::TempDir;
use tokio::sync::RwLock;
use warsha_core::{DeviceId, Project, ProjectId, Role, Stage};
use warsha_core::{ModelPricing, ProviderKind, TokenUsage};
use warsha_pipeline::{settings::SettingsStore, PipelineEngine};
use warsha_providers::{
    ChatChoice, ChatMessage, ChatProvider, ChatRequest, ChatResponse, MessageRole, ModelInfo,
    ProviderRouter, Result as ProviderResult,
};
use warsha_store::Store;

/// A fake temp directory preferring cargo's `CARGO_TARGET_TMPDIR`
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
    TempDir::new().expect("tempdir for the test data")
}

async fn fresh_store() -> (TempDir, Arc<Store>) {
    let dir = fresh_tempdir();
    let store = Store::open_at(dir.path().join("pipeline.db"))
        .await
        .expect("the store opens");
    (dir, Arc::new(store))
}

async fn create_project(store: &Arc<Store>) -> ProjectId {
    let project = Project {
        id: ProjectId::new(),
        name: "wiring-test".to_string(),
        description: "Test harness/skills wiring".to_string(),
        language: "ar".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        repo_path: None,
        repo_url: None,
    };
    store.create_project(&project).await.expect("a project");
    project.id
}

/// A mock provider that captures the prompt it receives
#[derive(Debug, Clone)]
struct CapturingProvider {
    captured_prompt: Arc<std::sync::Mutex<Option<String>>>,
}

impl CapturingProvider {
    fn new(captured_prompt: Arc<std::sync::Mutex<Option<String>>>) -> Self {
        Self { captured_prompt }
    }
}

#[async_trait]
impl ChatProvider for CapturingProvider {
    fn id(&self) -> &str {
        "capturing"
    }

    fn kind(&self) -> ProviderKind {
        ProviderKind::CustomOpenAICompatible
    }

    async fn list_models(&self) -> ProviderResult<Vec<ModelInfo>> {
        Ok(vec![ModelInfo {
            id: "capturing-model".to_string(),
            name: "Capturing Model".to_string(),
            provider: "capturing".to_string(),
            context_window: 128_000,
            max_output: 4_096,
            pricing: ModelPricing {
                input_per_million_cents: 0,
                output_per_million_cents: 0,
            },
        }])
    }

    async fn health(&self) -> ProviderResult<warsha_providers::HealthCheck> {
        Ok(warsha_providers::HealthCheck {
            healthy: true,
            latency_ms: Some(0),
            error: None,
        })
    }

    async fn chat(&self, request: ChatRequest) -> ProviderResult<ChatResponse> {
        // Capture the system prompt
        if let Some(system_msg) = request
            .messages
            .iter()
            .find(|m| m.role == MessageRole::System)
        {
            let mut guard = self.captured_prompt.lock().unwrap();
            *guard = Some(system_msg.content.clone());
        }

        Ok(ChatResponse {
            id: "test-response".to_string(),
            model: "capturing-model".to_string(),
            choices: vec![ChatChoice {
                index: 0,
                message: ChatMessage {
                    role: MessageRole::Assistant,
                    content: "# Test Artifact\n\nFake content".to_string(),
                },
                finish_reason: Some("stop".to_string()),
            }],
            usage: TokenUsage {
                input: 100,
                output: 50,
                total: 150,
            },
        })
    }

    async fn chat_stream(
        &self,
        _request: ChatRequest,
    ) -> ProviderResult<
        Box<dyn Stream<Item = ProviderResult<warsha_providers::ChatStreamChunk>> + Send + Unpin>,
    > {
        Err(warsha_providers::ProviderError::Other(
            "stream not implemented".to_string(),
        ))
    }

    fn cost_of(&self, _model: &str, _usage: &TokenUsage) -> ProviderResult<u64> {
        Ok(1)
    }
}

#[tokio::test]
async fn execute_stage_uses_harness_prompt_template_when_available() {
    let (_dir, store) = fresh_store().await;
    let project_id = create_project(&store).await;

    // Create a custom harness with a prompt_template for the Researcher stage
    let settings = SettingsStore::new();
    let project_id_str = project_id.0.to_string();

    // Create a harness with a custom prompt template for Researcher
    let harness_def = warsha_core::HarnessDefinition {
        id: "custom-harness".to_string(),
        version: "1.0.0".to_string(),
        name: "Custom Harness".to_string(),
        description: "Test harness with custom prompt".to_string(),
        stages: vec![
            warsha_core::HarnessStage {
                id: "research".to_string(),
                role: Role::Researcher,
                name: "Research".to_string(),
                prompt_template: Some(
                    "CUSTOM HARNESS PROMPT: Research the idea thoroughly. Idea: {artifact}"
                        .to_string(),
                ),
                gate: None,
                auto_advance: true,
            },
            warsha_core::HarnessStage {
                id: "prd".to_string(),
                role: Role::PM,
                name: "PRD spec".to_string(),
                prompt_template: None, // Use default
                gate: None,
                auto_advance: true,
            },
        ],
        rules: warsha_core::HarnessRules {
            max_repair_iterations: 3,
            budget_cap_cents: Some(2000),
            allow_parallel_subagents: true,
            require_verification_receipt: true,
        },
        preset: false,
        active: false,
        created_at: Utc::now(),
    };

    let stored_harness = warsha_pipeline::settings::StoredHarness {
        id: "custom-harness".to_string(),
        version: "1.0.0".to_string(),
        name: "Custom Harness".to_string(),
        description: "Test harness with custom prompt".to_string(),
        data_json: serde_json::to_string(&harness_def).unwrap(),
        is_preset: false,
        created_at: 1_735_689_600,
    };

    // Save harness and set as active for the project
    settings
        .save_harness(&stored_harness)
        .await
        .expect("save harness");
    settings
        .set_active_harness(&project_id_str, "custom-harness")
        .await
        .expect("set active harness");

    let captured_prompt = Arc::new(std::sync::Mutex::new(None::<String>));
    let mut router = ProviderRouter::new();
    router.register_provider(Box::new(CapturingProvider::new(captured_prompt.clone())));

    // Route Researcher to our capturing provider
    router.set_role_routing(warsha_core::RoleRouting {
        role: Role::Researcher,
        targets: vec![warsha_core::RoutingTarget {
            provider_id: "capturing".to_string(),
            model_id: "capturing-model".to_string(),
            weight: 100,
        }],
        fallback_enabled: false,
        budget_cents_per_run: None,
    });

    let providers = Arc::new(RwLock::new(router));
    let engine = PipelineEngine::new(store.clone(), providers, Arc::new(settings));

    // Start a run
    let run = engine
        .start_run(project_id, "Test idea for wiring")
        .await
        .expect("run starts");

    // Approve Gate A
    engine
        .approve_gate(run.id, Stage::GateA, DeviceId::new())
        .await
        .expect("gate A approved");

    // Advance to Research stage (first executed stage after Gate A)
    let _run = engine
        .advance_to_next_gate(run.id)
        .await
        .expect("advance to Gate B (which executes Research)");

    // Check that the captured prompt contains the custom harness template
    let prompt = captured_prompt
        .lock()
        .unwrap()
        .take()
        .expect("prompt was captured");
    assert!(
        prompt.contains("CUSTOM HARNESS PROMPT"),
        "Expected custom harness prompt template in prompt, got: {}",
        prompt
    );
    assert!(
        prompt.contains("Research the idea thoroughly"),
        "Expected harness prompt content in prompt"
    );
}

#[tokio::test]
async fn execute_stage_prepends_enabled_skills_to_prompt() {
    let (_dir, store) = fresh_store().await;
    let project_id = create_project(&store).await;

    // Create a settings store with an enabled skill
    let settings = SettingsStore::new();

    // Add a custom enabled skill
    let skill = warsha_pipeline::settings::StoredSkill {
        id: "test-skill".to_string(),
        name: "Test Skill".to_string(),
        description: "A test skill".to_string(),
        source: "test".to_string(),
        license: "MIT".to_string(),
        content: "# Test Skill Instructions\n\nAlways answer in verse. Every response must rhyme."
            .to_string(),
        enabled: true,
        tags_json: serde_json::to_string(&["test"]).unwrap(),
    };
    settings.save_skill(&skill).await.expect("save skill");

    let captured_prompt = Arc::new(std::sync::Mutex::new(None::<String>));
    let mut router = ProviderRouter::new();
    router.register_provider(Box::new(CapturingProvider::new(captured_prompt.clone())));

    // Route Researcher to our capturing provider
    router.set_role_routing(warsha_core::RoleRouting {
        role: Role::Researcher,
        targets: vec![warsha_core::RoutingTarget {
            provider_id: "capturing".to_string(),
            model_id: "capturing-model".to_string(),
            weight: 100,
        }],
        fallback_enabled: false,
        budget_cents_per_run: None,
    });

    let providers = Arc::new(RwLock::new(router));
    let engine = PipelineEngine::new(store.clone(), providers, Arc::new(settings));

    // Start a run
    let run = engine
        .start_run(project_id, "Test idea for skills wiring")
        .await
        .expect("run starts");

    // Approve Gate A
    engine
        .approve_gate(run.id, Stage::GateA, DeviceId::new())
        .await
        .expect("gate A approved");

    // Advance to Research stage
    let _run = engine
        .advance_to_next_gate(run.id)
        .await
        .expect("advance to Gate B (which executes Research)");

    // Check that the captured prompt contains the skill content
    let prompt = captured_prompt
        .lock()
        .unwrap()
        .take()
        .expect("prompt was captured");
    assert!(
        prompt.contains("# Test Skill Instructions"),
        "Expected skill content in prompt, got: {}",
        prompt
    );
    assert!(
        prompt.contains("Always answer in verse"),
        "Expected skill instruction in prompt"
    );
    // Skill should come before the base prompt (which contains the role marker)
    let skill_pos = prompt
        .find("# Test Skill Instructions")
        .expect("skill not found");
    let base_prompt_pos = prompt
        .find("role: researcher")
        .expect("role marker not found");
    assert!(
        skill_pos < base_prompt_pos,
        "Skill content should be prepended before base prompt"
    );
}

#[tokio::test]
async fn execute_stage_combines_harness_template_and_skills() {
    let (_dir, store) = fresh_store().await;
    let project_id = create_project(&store).await;

    // Create a settings store with both a custom harness AND an enabled skill
    let settings = SettingsStore::new();
    let project_id_str = project_id.0.to_string();

    // Create a harness with a custom prompt template for Researcher
    let harness_def = warsha_core::HarnessDefinition {
        id: "combined-harness".to_string(),
        version: "1.0.0".to_string(),
        name: "Combined Harness".to_string(),
        description: "Test harness with custom prompt".to_string(),
        stages: vec![warsha_core::HarnessStage {
            id: "research".to_string(),
            role: Role::Researcher,
            name: "Research".to_string(),
            prompt_template: Some(
                "HARNESS TEMPLATE: Research with special instructions.".to_string(),
            ),
            gate: None,
            auto_advance: true,
        }],
        rules: warsha_core::HarnessRules {
            max_repair_iterations: 3,
            budget_cap_cents: Some(2000),
            allow_parallel_subagents: true,
            require_verification_receipt: true,
        },
        preset: false,
        active: false,
        created_at: Utc::now(),
    };

    let stored_harness = warsha_pipeline::settings::StoredHarness {
        id: "combined-harness".to_string(),
        version: "1.0.0".to_string(),
        name: "Combined Harness".to_string(),
        description: "Test harness with custom prompt".to_string(),
        data_json: serde_json::to_string(&harness_def).unwrap(),
        is_preset: false,
        created_at: 1_735_689_600,
    };

    // Save harness and set as active
    settings
        .save_harness(&stored_harness)
        .await
        .expect("save harness");
    settings
        .set_active_harness(&project_id_str, "combined-harness")
        .await
        .expect("set active harness");

    // Add an enabled skill
    let skill = warsha_pipeline::settings::StoredSkill {
        id: "combined-skill".to_string(),
        name: "Combined Skill".to_string(),
        description: "A test skill".to_string(),
        source: "test".to_string(),
        license: "MIT".to_string(),
        content: "# Combined Skill\n\nSpecial skill instruction: be very thorough.".to_string(),
        enabled: true,
        tags_json: serde_json::to_string(&["test"]).unwrap(),
    };
    settings.save_skill(&skill).await.expect("save skill");

    let captured_prompt = Arc::new(std::sync::Mutex::new(None::<String>));
    let mut router = ProviderRouter::new();
    router.register_provider(Box::new(CapturingProvider::new(captured_prompt.clone())));

    // Route Researcher to our capturing provider
    router.set_role_routing(warsha_core::RoleRouting {
        role: Role::Researcher,
        targets: vec![warsha_core::RoutingTarget {
            provider_id: "capturing".to_string(),
            model_id: "capturing-model".to_string(),
            weight: 100,
        }],
        fallback_enabled: false,
        budget_cents_per_run: None,
    });

    let providers = Arc::new(RwLock::new(router));
    let engine = PipelineEngine::new(store.clone(), providers, Arc::new(settings));

    // Start a run
    let run = engine
        .start_run(project_id, "Test combined wiring")
        .await
        .expect("run starts");

    // Approve Gate A
    engine
        .approve_gate(run.id, Stage::GateA, DeviceId::new())
        .await
        .expect("gate A approved");

    // Advance to Research stage
    let _run = engine
        .advance_to_next_gate(run.id)
        .await
        .expect("advance to Gate B (which executes Research)");

    // Check that the captured prompt contains BOTH the skill content AND the harness template
    let prompt = captured_prompt
        .lock()
        .unwrap()
        .take()
        .expect("prompt was captured");

    // Skill content should be present
    assert!(
        prompt.contains("# Combined Skill"),
        "Expected skill content in prompt, got: {}",
        prompt
    );
    assert!(
        prompt.contains("Special skill instruction"),
        "Expected skill instruction in prompt"
    );

    // Harness template should be present
    assert!(
        prompt.contains("HARNESS TEMPLATE: Research with special instructions."),
        "Expected harness template in prompt"
    );

    // Order: skill first, then harness template
    let skill_pos = prompt.find("# Combined Skill").expect("skill not found");
    let harness_pos = prompt
        .find("HARNESS TEMPLATE")
        .expect("harness template not found");
    assert!(
        skill_pos < harness_pos,
        "Skill should come before harness template, skill_pos={}, harness_pos={}",
        skill_pos,
        harness_pos
    );
}

#[tokio::test]
async fn execute_stage_uses_default_prompt_when_no_harness_template() {
    let (_dir, store) = fresh_store().await;
    let project_id = create_project(&store).await;

    // Create a settings store with a harness that has NO prompt_template for Researcher
    let settings = SettingsStore::new();
    let project_id_str = project_id.0.to_string();

    let harness_def = warsha_core::HarnessDefinition {
        id: "no-template-harness".to_string(),
        version: "1.0.0".to_string(),
        name: "No Template Harness".to_string(),
        description: "Test harness without custom prompt".to_string(),
        stages: vec![warsha_core::HarnessStage {
            id: "research".to_string(),
            role: Role::Researcher,
            name: "Research".to_string(),
            prompt_template: None, // No template - should fall back to default
            gate: None,
            auto_advance: true,
        }],
        rules: warsha_core::HarnessRules {
            max_repair_iterations: 3,
            budget_cap_cents: Some(2000),
            allow_parallel_subagents: true,
            require_verification_receipt: true,
        },
        preset: false,
        active: false,
        created_at: Utc::now(),
    };

    let stored_harness = warsha_pipeline::settings::StoredHarness {
        id: "no-template-harness".to_string(),
        version: "1.0.0".to_string(),
        name: "No Template Harness".to_string(),
        description: "Test harness without custom prompt".to_string(),
        data_json: serde_json::to_string(&harness_def).unwrap(),
        is_preset: false,
        created_at: 1_735_689_600,
    };

    settings
        .save_harness(&stored_harness)
        .await
        .expect("save harness");
    settings
        .set_active_harness(&project_id_str, "no-template-harness")
        .await
        .expect("set active harness");

    let captured_prompt = Arc::new(std::sync::Mutex::new(None::<String>));
    let mut router = ProviderRouter::new();
    router.register_provider(Box::new(CapturingProvider::new(captured_prompt.clone())));

    router.set_role_routing(warsha_core::RoleRouting {
        role: Role::Researcher,
        targets: vec![warsha_core::RoutingTarget {
            provider_id: "capturing".to_string(),
            model_id: "capturing-model".to_string(),
            weight: 100,
        }],
        fallback_enabled: false,
        budget_cents_per_run: None,
    });

    let providers = Arc::new(RwLock::new(router));
    let engine = PipelineEngine::new(store.clone(), providers, Arc::new(settings));

    // Start a run
    let run = engine
        .start_run(project_id, "Test default prompt")
        .await
        .expect("run starts");

    // Approve Gate A
    engine
        .approve_gate(run.id, Stage::GateA, DeviceId::new())
        .await
        .expect("gate A approved");

    // Advance to Research stage
    let _run = engine
        .advance_to_next_gate(run.id)
        .await
        .expect("advance to Gate B (which executes Research)");

    // Check that the captured prompt contains the DEFAULT role prompt (from prompts.rs)
    let prompt = captured_prompt
        .lock()
        .unwrap()
        .take()
        .expect("prompt was captured");

    // The default researcher prompt should contain "Researcher" role marker and "Output Format"
    assert!(
        prompt.contains("role: researcher"),
        "Expected default role marker in prompt, got: {}",
        prompt
    );
    assert!(
        prompt.contains("Output Format"),
        "Expected default prompt content in prompt"
    );
    // Should NOT contain a custom harness template
    assert!(
        !prompt.contains("HARNESS TEMPLATE"),
        "Should not have harness template when none defined"
    );
}
