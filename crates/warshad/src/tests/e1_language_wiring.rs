#![allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]

use super::*;
use warsha_core::ProviderQuota;
use warsha_providers::{
    ChatChoice, ChatMessage, ChatProvider, ChatRequest, ChatResponse, ChatStreamChunk, HealthCheck,
    MessageRole, ModelInfo, ProviderError,
};

fn owner() -> RpcExtensions {
    let mut ext = RpcExtensions::new();
    ext.insert(Actor::owner(DeviceId::new()));
    ext
}

/// A provider that records the system prompt of every stage it answers.
struct PromptCapturingProvider {
    captured: Arc<std::sync::Mutex<Vec<String>>>,
}

#[async_trait::async_trait]
impl ChatProvider for PromptCapturingProvider {
    fn id(&self) -> &str {
        "capturing"
    }

    fn kind(&self) -> ProviderKind {
        ProviderKind::CustomOpenAICompatible
    }

    async fn list_models(&self) -> std::result::Result<Vec<ModelInfo>, ProviderError> {
        Ok(vec![ModelInfo {
            id: "capturing-model".to_string(),
            name: "Capturing Model".to_string(),
            provider: "capturing".to_string(),
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

    async fn chat(&self, request: ChatRequest) -> std::result::Result<ChatResponse, ProviderError> {
        if let Some(message) = request.messages.first() {
            self.captured
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(message.content.clone());
        }
        Ok(ChatResponse {
            id: "capturing-response".to_string(),
            model: "capturing-model".to_string(),
            choices: vec![ChatChoice {
                index: 0,
                message: ChatMessage {
                    role: MessageRole::Assistant,
                    content: "# Research Report\n\nCaptured content.".to_string(),
                },
                finish_reason: Some("stop".to_string()),
            }],
            usage: TokenUsage {
                input: 10,
                output: 5,
                total: 15,
                cost_cents: None,
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

    async fn get_quota(&self) -> std::result::Result<ProviderQuota, ProviderError> {
        Ok(ProviderQuota::Unknown)
    }
}

/// An active harness whose Researcher prompt carries `{{language}}`, so the one
/// stage this test reaches renders the project's language into what the provider
/// receives.
async fn store_language_harness(settings: &SettingsStore, project_id: ProjectId) {
    let definition = HarnessDefinition {
        id: "language-harness".to_string(),
        version: "1.0.0".to_string(),
        name: "Language Harness".to_string(),
        description: "Renders the research prompt in the project's language".to_string(),
        stages: vec![
            HarnessStage {
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
            },
            HarnessStage {
                id: "prd".to_string(),
                role: Role::PM,
                name: "PRD spec".to_string(),
                prompt_template: Some(
                    "---\nrole: pm\nstage: prd_spec\n---\n\n\
                     Write the spec in Language: `{{language}}`."
                        .to_string(),
                ),
                gate: None,
                auto_advance: true,
            },
        ],
        rules: HarnessRules {
            max_repair_iterations: 1,
            coding_cli_timeout_seconds: None,
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
}

#[tokio::test]
async fn a_project_created_in_arabic_renders_its_run_prompts_in_arabic() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = crate::tests::test_state(temp.path()).await;

    // Route the first executed stage to a provider that keeps the prompt.
    let captured = Arc::new(std::sync::Mutex::new(Vec::new()));
    {
        let mut router = state.providers.write().await;
        router.register_provider(Box::new(PromptCapturingProvider {
            captured: captured.clone(),
        }));
        for role in [Role::Researcher, Role::PM] {
            router.set_role_routing(RoleRouting {
                role,
                targets: vec![RoutingTarget {
                    provider_id: "capturing".to_string(),
                    model_id: "capturing-model".to_string(),
                    weight: 100,
                }],
                fallback_enabled: false,
                budget_cents_per_run: None,
            });
        }
    }

    let rpc = WarshaRpc::new(state.clone());
    let owner = owner();
    // The project is created the way a client creates one: through the RPC, which
    // is what stores `language` on the row the pipeline later reads.
    let project = rpc
        .create_project(
            &owner,
            "عيادة أسنان".to_string(),
            "A dental clinic booking app".to_string(),
            "ar".to_string(),
            None,
            None,
            None,
            None,
        )
        .await
        .expect("the project is created");
    assert_eq!(project.language, "ar");
    store_language_harness(&state.settings, project.id).await;

    let run = rpc
        .start_run(
            &owner,
            project.id,
            "تطبيق حجز مواعيد".to_string(),
            None,
            None,
            None,
        )
        .await
        .expect("the run starts");
    let at_gate = rpc
        .advance_run(&owner, run.id)
        .await
        .expect("advance to Gate A");
    assert_eq!(at_gate.current_stage, Stage::GateA);
    rpc.approve_gate(&owner, run.id, Stage::GateA, None)
        .await
        .expect("Gate A approves");
    rpc.advance_run(&owner, run.id)
        .await
        .expect("the research stage executes");

    let prompts = captured
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    assert_eq!(
        prompts.len(),
        2,
        "the walk runs Research and the PRD spec before Gate B: {prompts:?}"
    );
    for prompt in &prompts {
        assert!(
            prompt.contains("Language: `ar`"),
            "the project's language never reached the renderer: {prompt}"
        );
        assert!(
            !prompt.contains("Language: `en`"),
            "the prompt still hardcoded English: {prompt}"
        );
    }
}
