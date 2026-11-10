//! Tests for K3 status and provider truthfulness (no silent fakes).

use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use warsha_core::*;
use warsha_providers::{
    ChatChoice, ChatMessage, ChatProvider, ChatRequest, ChatResponse, ChatStreamChunk, HealthCheck,
    MessageRole, ModelInfo, ProviderError, ProviderRouter,
};
use warsha_store::Store;

use crate::routines::{
    Routine, RoutineError, RoutineRunner, RoutineSchedule, UnavailableRoutineRunner,
};
use crate::scout::{Scout, ScoutConfig, ScoutError};
use crate::settings::SettingsStore;
use crate::{PipelineEngine, PipelineError};

static ENV_LOCK: Mutex<()> = Mutex::const_new(());

/// Tracking provider for explicit routing tests.
struct TestTruthProvider {
    id: String,
}

impl TestTruthProvider {
    fn new(id: &str) -> Self {
        Self { id: id.to_string() }
    }
}

#[async_trait::async_trait]
impl ChatProvider for TestTruthProvider {
    fn id(&self) -> &str {
        &self.id
    }

    fn kind(&self) -> ProviderKind {
        ProviderKind::OpenAI
    }

    async fn list_models(&self) -> std::result::Result<Vec<ModelInfo>, ProviderError> {
        Ok(vec![ModelInfo {
            id: "truth-model".to_string(),
            name: "Truth Model".to_string(),
            provider: self.id.clone(),
            context_window: 8192,
            max_output: 4096,
            pricing: ModelPricing {
                input_per_million_cents: 100,
                output_per_million_cents: 200,
            },
        }])
    }

    async fn health(&self) -> std::result::Result<HealthCheck, ProviderError> {
        Ok(HealthCheck {
            healthy: true,
            latency_ms: Some(1),
            error: None,
        })
    }

    async fn chat(
        &self,
        _request: ChatRequest,
    ) -> std::result::Result<ChatResponse, ProviderError> {
        Ok(ChatResponse {
            id: "truth-resp".to_string(),
            model: "truth-model".to_string(),
            choices: vec![ChatChoice {
                index: 0,
                message: ChatMessage {
                    role: MessageRole::Assistant,
                    content: "# Truth Artifact\nVerified content".to_string(),
                },
                finish_reason: Some("stop".to_string()),
            }],
            usage: TokenUsage {
                input: 100,
                output: 100,
                total: 200,
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
            "streaming not implemented".to_string(),
        ))
    }

    fn cost_of(
        &self,
        _model: &str,
        _usage: &TokenUsage,
    ) -> std::result::Result<u64, ProviderError> {
        Ok(10)
    }
}

async fn setup_fixture() -> (
    Arc<Store>,
    PipelineEngine<SettingsStore>,
    ProjectId,
    Arc<RwLock<ProviderRouter>>,
) {
    let dir = crate::test_util::fresh_tempdir();
    let db_path = dir.path().join("status_truth.db");
    let store = Arc::new(Store::open_at(db_path).await.expect("store open"));
    let settings = Arc::new(SettingsStore::new());
    std::mem::forget(dir);

    let project = Project {
        id: ProjectId::new(),
        name: "Status Truth Project".to_string(),
        description: "Testing K3 no-silent-fakes invariants".to_string(),
        language: "en".to_string(),
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        repo_path: None,
        repo_url: None,
    };
    store
        .create_project(&project)
        .await
        .expect("create project");

    let router = Arc::new(RwLock::new(ProviderRouter::new()));
    let engine = PipelineEngine::new(store.clone(), router.clone(), settings);

    (store, engine, project.id, router)
}

#[tokio::test]
async fn unrouted_role_returns_typed_error_and_does_not_silently_fallback() {
    let _env_guard = ENV_LOCK.lock().await;
    std::env::remove_var("WARSHA_LLM_PROVIDER");
    let (store, engine, project_id, router) = setup_fixture().await;

    // Only route Role::Intake so start_run/idea can initialize.
    {
        let mut r = router.write().await;
        r.register_provider(Box::new(TestTruthProvider::new("intake-prov")));
        r.set_role_routing(RoleRouting {
            role: Role::Intake,
            targets: vec![RoutingTarget {
                provider_id: "intake-prov".to_string(),
                model_id: "truth-model".to_string(),
                weight: 100,
            }],
            fallback_enabled: false,
            budget_cents_per_run: None,
        });
    }

    let run = engine
        .start_run(project_id, "Truth Idea")
        .await
        .expect("start run");

    // Advance Idea -> GateA.
    let at_gate = engine
        .advance_stage(run.id)
        .await
        .expect("advance to GateA");
    assert_eq!(at_gate.current_stage, Stage::GateA);

    // Approve GateA.
    engine
        .approve_gate(run.id, Stage::GateA, DeviceId::new())
        .await
        .expect("approve GateA");

    // Researcher is unrouted. Advancing must refuse with NoProviderRouted.
    let err = engine
        .advance_stage(run.id)
        .await
        .expect_err("unrouted researcher must fail explicitly");
    assert!(
        matches!(err, PipelineError::NoProviderRouted(Role::Researcher)),
        "expected NoProviderRouted(Researcher), got: {err:?}"
    );

    // No artifact must have been fabricated for research.
    let reloaded = store.get_run(run.id).await.expect("reload run");
    assert!(
        !reloaded.artifacts.contains_key("research"),
        "zero artifacts must be produced when role is unrouted"
    );
}

#[tokio::test]
async fn unrouted_stage_pauses_run_and_emits_provider_required_event() {
    let _env_guard = ENV_LOCK.lock().await;
    std::env::remove_var("WARSHA_LLM_PROVIDER");
    let (store, engine, project_id, router) = setup_fixture().await;

    // Route Intake.
    {
        let mut r = router.write().await;
        r.register_provider(Box::new(TestTruthProvider::new("intake-prov")));
        r.set_role_routing(RoleRouting {
            role: Role::Intake,
            targets: vec![RoutingTarget {
                provider_id: "intake-prov".to_string(),
                model_id: "truth-model".to_string(),
                weight: 100,
            }],
            fallback_enabled: false,
            budget_cents_per_run: None,
        });
    }

    let run = engine.start_run(project_id, "Pause Test").await.unwrap();
    engine.advance_stage(run.id).await.unwrap();
    engine
        .approve_gate(run.id, Stage::GateA, DeviceId::new())
        .await
        .unwrap();

    let _ = engine.advance_stage(run.id).await;

    // Run must be paused, not left running or completed.
    let reloaded = store.get_run(run.id).await.unwrap();
    assert_eq!(
        reloaded.status,
        RunStatus::Paused,
        "unrouted stage must transition run to Paused"
    );

    // Event log must carry provider_required action.
    let events = store.get_events(run.id).await.unwrap();
    let provider_req = events
        .iter()
        .find(|e| e.payload["action"] == "provider_required");
    assert!(
        provider_req.is_some(),
        "provider_required event must be recorded"
    );
    let event = provider_req.unwrap();
    assert_eq!(event.payload["role"], "researcher");
}

#[tokio::test]
async fn forced_fake_environment_only_answers_when_explicitly_configured() {
    let _env_guard = ENV_LOCK.lock().await;
    std::env::remove_var("WARSHA_LLM_PROVIDER");
    let (_store, engine, project_id, _router) = setup_fixture().await;

    let run = engine
        .start_run(project_id, "Unforced fake idea")
        .await
        .expect("start run");

    // Intake is unrouted and fake is not forced -> must error.
    let err = engine
        .followup_run(run.id, "Followup question")
        .await
        .expect_err("without forced fake, unrouted followup must fail");
    assert!(
        matches!(err, PipelineError::NoProviderRouted(Role::Intake)),
        "unexpected error: {err:?}"
    );

    // With explicit WARSHA_LLM_PROVIDER=fake, FakeProvider answers.
    std::env::set_var("WARSHA_LLM_PROVIDER", "fake");
    let result = engine.followup_run(run.id, "Followup question").await;
    std::env::remove_var("WARSHA_LLM_PROVIDER");

    assert!(
        result.is_ok(),
        "forced fake must allow offline execution when explicitly configured"
    );
}

#[tokio::test]
async fn unrouted_followup_fails_honestly_without_creating_fake_artifact() {
    let _env_guard = ENV_LOCK.lock().await;
    std::env::remove_var("WARSHA_LLM_PROVIDER");
    let (store, engine, project_id, _router) = setup_fixture().await;

    let run = engine
        .start_run(project_id, "Honest followup test")
        .await
        .expect("start run");

    let err = engine
        .followup_run(run.id, "Tell me more details")
        .await
        .expect_err("unrouted followup must fail");
    assert!(
        matches!(err, PipelineError::NoProviderRouted(_)),
        "expected NoProviderRouted, got: {err:?}"
    );

    let reloaded = store.get_run(run.id).await.expect("reloaded run");
    assert!(
        !reloaded.artifacts.contains_key("followup"),
        "zero followup artifacts must be recorded on unrouted failure"
    );
}

#[tokio::test]
async fn unavailable_routine_runner_refuses_execution_honestly() {
    let runner = UnavailableRoutineRunner::new();
    let routine = Routine::new("daily-sync", "Daily Sync", RoutineSchedule::Manual);

    let err = runner
        .run(&routine)
        .expect_err("unavailable routine runner must refuse execution");
    assert!(
        matches!(err, RoutineError::Runner(ref msg) if msg.contains("unavailable")),
        "expected unavailable runner error, got: {err:?}"
    );
}

#[tokio::test]
async fn scout_registry_seam_reports_honest_catalog_unavailable_in_production() {
    let scout = Scout::new(ScoutConfig::default());
    let err = scout
        .scout_for_role(ProjectId::new(), Role::Coder, None)
        .await
        .expect_err("production scout without network/fixtures must fail with catalog unavailable");
    assert!(
        matches!(err, ScoutError::CatalogUnavailable(_)),
        "expected CatalogUnavailable, got: {err:?}"
    );
    assert!(err.to_string().contains("catalog unavailable"));
}
