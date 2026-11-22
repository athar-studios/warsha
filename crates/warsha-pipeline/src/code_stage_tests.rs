#![cfg(test)]
#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::unwrap_used,
    clippy::redundant_clone
)]

use std::process::Command;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

use warsha_core::{
    DeviceId, EventKind, GateState, ModelPricing, Project, ProjectId, ProjectPermissions,
    ProviderKind, ProviderQuota, Role, RoleRouting, RoutingTarget, RunStatus, Stage, TokenUsage,
};
use warsha_providers::{
    ChatChoice, ChatMessage, ChatProvider, ChatRequest, ChatResponse, ChatStreamChunk, HealthCheck,
    MessageRole, ModelInfo, ProviderError, ProviderRouter, FAKE_MODEL_ID, FAKE_PROVIDER_ID,
};
use warsha_store::Store;

use crate::coding_backend::{BackendError, CodingBackend, CodingResult, CodingTask, Sandbox};
use crate::settings::{SettingsProvider, SettingsStore};
use crate::PipelineEngine;

#[derive(Clone)]
struct CapturingBackend {
    name: String,
    available: bool,
    fail_with: Option<String>,
    captured_tasks: Arc<Mutex<Vec<CodingTask>>>,
}

impl CapturingBackend {
    fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            available: true,
            fail_with: None,
            captured_tasks: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn unavailable(name: &str) -> Self {
        Self {
            name: name.to_string(),
            available: false,
            fail_with: None,
            captured_tasks: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn failing(name: &str, error: &str) -> Self {
        Self {
            name: name.to_string(),
            available: true,
            fail_with: Some(error.to_string()),
            captured_tasks: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

#[async_trait::async_trait]
impl CodingBackend for CapturingBackend {
    fn name(&self) -> &str {
        &self.name
    }

    fn is_available(&self) -> bool {
        self.available
    }

    async fn execute(
        &self,
        task: CodingTask,
        sandbox: &Sandbox,
    ) -> Result<CodingResult, BackendError> {
        self.captured_tasks.lock().await.push(task.clone());
        if let Some(err) = &self.fail_with {
            return Ok(CodingResult {
                task_id: task.id,
                success: false,
                diff: None,
                files_changed: Vec::new(),
                usage: None,
                error: Some(err.clone()),
                duration_ms: 10,
            });
        }

        let marker_path = sandbox.work_dir.join("main.rs");
        std::fs::write(&marker_path, "fn main() { println!(\"Hello\"); }")
            .map_err(|e| BackendError::ExecutionFailed(e.to_string()))?;

        Ok(CodingResult {
            task_id: task.id,
            success: true,
            diff: Some("diff --git a/main.rs b/main.rs\n+fn main() {}".to_string()),
            files_changed: vec!["main.rs".to_string()],
            usage: None,
            error: None,
            duration_ms: 25,
        })
    }
}

struct CapturingProvider {
    captured_prompts: Arc<Mutex<Vec<String>>>,
}

impl CapturingProvider {
    fn new(captured: Arc<Mutex<Vec<String>>>) -> Self {
        Self {
            captured_prompts: captured,
        }
    }
}

#[async_trait::async_trait]
impl ChatProvider for CapturingProvider {
    fn id(&self) -> &str {
        "capturing-provider"
    }

    fn kind(&self) -> ProviderKind {
        ProviderKind::OpenAI
    }

    async fn list_models(&self) -> std::result::Result<Vec<ModelInfo>, ProviderError> {
        Ok(vec![ModelInfo {
            id: "capture-model".to_string(),
            name: "Capture Model".to_string(),
            provider: "capturing-provider".to_string(),
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
            latency_ms: Some(1),
            error: None,
        })
    }

    async fn chat(&self, request: ChatRequest) -> std::result::Result<ChatResponse, ProviderError> {
        for msg in &request.messages {
            self.captured_prompts.lock().await.push(msg.content.clone());
        }
        Ok(ChatResponse {
            id: "msg-1".to_string(),
            model: "capture-model".to_string(),
            choices: vec![ChatChoice {
                index: 0,
                message: ChatMessage {
                    role: MessageRole::Assistant,
                    content: r#"{"files": [{"path": "src/main.rs", "content": "fn main() { println!(\"code artifact\"); }", "language": "rust"}], "notes": "ok"}"#.to_string(),
                },
                finish_reason: Some("stop".to_string()),
            }],
            usage: TokenUsage {
                input: 10,
                output: 10,
                total: 20,
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
        Err(ProviderError::Other("streaming not supported".to_string()))
    }

    fn cost_of(
        &self,
        _model: &str,
        _usage: &TokenUsage,
    ) -> std::result::Result<u64, ProviderError> {
        Ok(0)
    }

    async fn get_quota(&self) -> std::result::Result<ProviderQuota, ProviderError> {
        Ok(ProviderQuota::Unknown)
    }
}

struct ScriptedProvider {
    id: String,
    content: String,
    calls: Arc<std::sync::atomic::AtomicUsize>,
}

impl ScriptedProvider {
    fn new(id: &str, content: &str) -> (Self, Arc<std::sync::atomic::AtomicUsize>) {
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        (
            Self {
                id: id.to_string(),
                content: content.to_string(),
                calls: calls.clone(),
            },
            calls,
        )
    }
}

#[async_trait::async_trait]
impl ChatProvider for ScriptedProvider {
    fn id(&self) -> &str {
        &self.id
    }

    fn kind(&self) -> ProviderKind {
        ProviderKind::OpenAI
    }

    async fn list_models(&self) -> std::result::Result<Vec<ModelInfo>, ProviderError> {
        Ok(vec![ModelInfo {
            id: "scripted-model".to_string(),
            name: "Scripted Model".to_string(),
            provider: self.id.clone(),
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
            latency_ms: Some(1),
            error: None,
        })
    }

    async fn chat(
        &self,
        _request: ChatRequest,
    ) -> std::result::Result<ChatResponse, ProviderError> {
        self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(ChatResponse {
            id: "msg-scripted".to_string(),
            model: "scripted-model".to_string(),
            choices: vec![ChatChoice {
                index: 0,
                message: ChatMessage {
                    role: MessageRole::Assistant,
                    content: self.content.clone(),
                },
                finish_reason: Some("stop".to_string()),
            }],
            usage: TokenUsage {
                input: 10,
                output: 10,
                total: 20,
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
        Err(ProviderError::Other("streaming not supported".to_string()))
    }

    fn cost_of(
        &self,
        _model: &str,
        _usage: &TokenUsage,
    ) -> std::result::Result<u64, ProviderError> {
        Ok(0)
    }

    async fn get_quota(&self) -> std::result::Result<ProviderQuota, ProviderError> {
        Ok(ProviderQuota::Unknown)
    }
}

fn git_repo(dir: &std::path::Path) {
    for args in [
        vec!["init", "-q"],
        vec!["config", "user.email", "test@example.com"],
        vec!["config", "user.name", "Test"],
        vec!["add", "."],
        vec!["commit", "-qm", "base"],
    ] {
        let status = Command::new("git")
            .current_dir(dir)
            .args(&args)
            .status()
            .expect("git runs");
        assert!(status.success(), "git {args:?} failed");
    }
}

async fn fake_routed_router() -> Arc<RwLock<ProviderRouter>> {
    let mut router = ProviderRouter::new();
    for role in [
        Role::Intake,
        Role::Researcher,
        Role::PM,
        Role::Designer,
        Role::Architect,
        Role::Coder,
        Role::Reviewer,
        Role::Release,
        Role::Marketer,
        Role::Feedback,
    ] {
        router.set_role_routing(RoleRouting {
            role,
            targets: vec![RoutingTarget {
                provider_id: FAKE_PROVIDER_ID.to_string(),
                model_id: FAKE_MODEL_ID.to_string(),
                weight: 100,
            }],
            fallback_enabled: false,
            budget_cents_per_run: None,
        });
    }
    Arc::new(RwLock::new(router))
}

async fn fixture(
    backend: Option<Arc<dyn CodingBackend>>,
) -> (
    PipelineEngine<SettingsStore>,
    Arc<Store>,
    tempfile::TempDir,
    Project,
) {
    let dir = tempfile::tempdir().expect("tempdir");
    let store = Arc::new(
        Store::open_at(dir.path().join("pipeline.db"))
            .await
            .expect("store opens"),
    );

    let router = fake_routed_router().await;
    let mut engine = PipelineEngine::<SettingsStore>::new_test(store.clone(), router);
    if let Some(b) = backend {
        engine = engine.with_coding_backend(b);
    }

    let repo = dir.path().join("repo");
    std::fs::create_dir(&repo).expect("repo dir");
    std::fs::write(repo.join("base.txt"), "base").expect("base file");
    git_repo(&repo);

    let project = Project {
        id: ProjectId::new(),
        name: "code-stage-test".to_string(),
        description: "Code stage test fixture".to_string(),
        language: "en".to_string(),
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        repo_path: Some(repo.to_string_lossy().into_owned()),
        repo_url: None,
        confinement: None,
        approval_mode: None,
        permissions: ProjectPermissions::default(),
    };
    store.create_project(&project).await.expect("project");

    (engine, store, dir, project)
}

async fn walk_to_stage<S: SettingsProvider>(
    engine: &PipelineEngine<S>,
    run_id: warsha_core::RunId,
    target: Stage,
) -> warsha_core::Run {
    let mut run = engine
        .advance_stage(run_id)
        .await
        .expect("Idea stage advances");
    loop {
        if run.current_stage == target {
            return run;
        }
        if run.current_stage.is_gate() {
            engine
                .approve_gate(run_id, run.current_stage, DeviceId::new())
                .await
                .expect("gate approves");
        }
        run = engine.advance_stage(run_id).await.expect("advance stage");
    }
}

/// 1. Prove that the Code stage receives the plan in prompt and task context,
/// and the mock backend captures it.
#[tokio::test]
async fn code_stage_receives_plan_in_prompt_and_context() {
    let backend = Arc::new(CapturingBackend::new("plan-capture-backend"));
    let tasks_ref = backend.captured_tasks.clone();

    let (engine, store, dir, project) = fixture(Some(backend.clone())).await;
    engine
        .backend_registry()
        .set_project_backend(project.id, "plan-capture-backend");

    let run = engine
        .start_run(project.id, "Build a rust microservice")
        .await
        .expect("start run");

    let repo_path = project.repo_path.as_ref().expect("repo path");
    let worktree = crate::worktree::create_run_worktree(
        std::path::Path::new(repo_path),
        &dir.path().join("worktrees"),
        &run.id.0.to_string(),
        "HEAD",
    )
    .await
    .expect("worktree created");

    let mut run = store.get_run(run.id).await.expect("run exists");
    run.worktree_path = Some(worktree.path.to_string_lossy().into_owned());
    run.worktree_branch = Some(format!("warsha/run-{}", run.id.0));
    store.update_run(&run).await.expect("run updated");

    let run_at_plan = walk_to_stage(&engine, run.id, Stage::PlanTasks).await;
    assert_eq!(run_at_plan.current_stage, Stage::PlanTasks);

    let plan_artifact = run_at_plan
        .artifacts
        .get("plan_tasks")
        .expect("plan_tasks artifact exists");
    let plan_content = plan_artifact.content.clone();
    assert!(!plan_content.is_empty(), "plan content should not be empty");

    // Now advance from Stage::PlanTasks into Stage::Code with our mock backend
    let advanced = engine
        .advance_stage(run.id)
        .await
        .expect("code stage executes");
    assert_eq!(advanced.current_stage, Stage::Code);

    let captured = tasks_ref.lock().await;
    assert_eq!(captured.len(), 1, "mock backend executed once");
    let task = &captured[0];

    // Assert task.description contains the plan content
    assert!(
        task.description.contains(&plan_content),
        "task description must contain the plan content; got: {}",
        task.description
    );
    assert!(
        task.description.contains("Implementation Plan"),
        "task description must have Implementation Plan header"
    );

    // Assert task.context contains the plan
    let context_plan = task
        .context
        .get("plan")
        .expect("task context contains plan key");
    assert_eq!(context_plan, &plan_content);
}

/// 2. Prove that on the env-provider path (no coding backend), the routed LLM provider
/// receives the plan content in its prompt.
#[tokio::test]
async fn code_stage_env_provider_receives_plan_in_prompt() {
    let captured_prompts = Arc::new(Mutex::new(Vec::new()));
    let provider = CapturingProvider::new(captured_prompts.clone());

    let dir = tempfile::tempdir().expect("tempdir");
    let store = Arc::new(
        Store::open_at(dir.path().join("pipeline.db"))
            .await
            .expect("store opens"),
    );

    let mut router = ProviderRouter::new();
    router.register_provider(Box::new(provider));
    for role in [
        Role::Intake,
        Role::Researcher,
        Role::PM,
        Role::Designer,
        Role::Architect,
        Role::Reviewer,
        Role::Release,
        Role::Marketer,
        Role::Feedback,
    ] {
        router.set_role_routing(RoleRouting {
            role,
            targets: vec![RoutingTarget {
                provider_id: FAKE_PROVIDER_ID.to_string(),
                model_id: FAKE_MODEL_ID.to_string(),
                weight: 100,
            }],
            fallback_enabled: false,
            budget_cents_per_run: None,
        });
    }
    // Route Coder to our CapturingProvider
    router.set_role_routing(RoleRouting {
        role: Role::Coder,
        targets: vec![RoutingTarget {
            provider_id: "capturing-provider".to_string(),
            model_id: "capture-model".to_string(),
            weight: 100,
        }],
        fallback_enabled: false,
        budget_cents_per_run: None,
    });

    let engine =
        PipelineEngine::<SettingsStore>::new_test(store.clone(), Arc::new(RwLock::new(router)));

    let repo = dir.path().join("repo");
    std::fs::create_dir(&repo).expect("repo dir");
    std::fs::write(repo.join("base.txt"), "base").expect("base file");
    git_repo(&repo);

    let project = Project {
        id: ProjectId::new(),
        name: "code-env-provider-test".to_string(),
        description: "Code env-provider test".to_string(),
        language: "en".to_string(),
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        repo_path: Some(repo.to_string_lossy().into_owned()),
        repo_url: None,
        confinement: None,
        approval_mode: None,
        permissions: ProjectPermissions::default(),
    };
    store
        .create_project(&project)
        .await
        .expect("project created");

    let run = engine
        .start_run(project.id, "Build a service")
        .await
        .expect("start run");

    let run_at_plan = walk_to_stage(&engine, run.id, Stage::PlanTasks).await;
    assert_eq!(run_at_plan.current_stage, Stage::PlanTasks);

    let plan_artifact = run_at_plan
        .artifacts
        .get("plan_tasks")
        .expect("plan_tasks artifact exists");
    let plan_content = plan_artifact.content.clone();

    // Advance Stage::Code via env-provider path
    let advanced = engine
        .advance_stage(run.id)
        .await
        .expect("code stage executes via chat provider");
    assert_eq!(advanced.current_stage, Stage::Code);

    let prompts = captured_prompts.lock().await;
    assert_eq!(prompts.len(), 1, "chat provider called once for code stage");
    let coder_prompt = &prompts[0];

    assert!(
        coder_prompt.contains(&plan_content),
        "prompt to LLM must contain the plan content; got: {coder_prompt}"
    );
    assert!(
        coder_prompt.contains("Implementation Plan"),
        "prompt to LLM must contain Implementation Plan section"
    );
}

/// 3. Missing backend -> recorded error naming the backend.
#[tokio::test]
async fn code_stage_missing_backend_records_error_naming_backend() {
    let uninstalled = Arc::new(CapturingBackend::unavailable("missing-cli-tool"));
    let (engine, store, dir, project) = fixture(Some(uninstalled)).await;

    engine
        .backend_registry()
        .set_project_backend(project.id, "missing-cli-tool");

    let run = engine
        .start_run(project.id, "Build something")
        .await
        .expect("start run");

    let repo_path = project.repo_path.as_ref().expect("repo path");
    let worktree = crate::worktree::create_run_worktree(
        std::path::Path::new(repo_path),
        &dir.path().join("worktrees"),
        &run.id.0.to_string(),
        "HEAD",
    )
    .await
    .expect("worktree created");

    let mut run = store.get_run(run.id).await.expect("run exists");
    run.worktree_path = Some(worktree.path.to_string_lossy().into_owned());
    run.worktree_branch = Some(format!("warsha/run-{}", run.id.0));
    store.update_run(&run).await.expect("run updated");

    let run_at_plan = walk_to_stage(&engine, run.id, Stage::PlanTasks).await;
    assert_eq!(run_at_plan.current_stage, Stage::PlanTasks);

    // Advancing from PlanTasks into Code with uninstalled backend must fail
    let err = engine
        .advance_stage(run.id)
        .await
        .expect_err("missing backend must fail loudly");
    assert!(
        err.to_string().contains("missing-cli-tool"),
        "error must name missing backend: {err}"
    );

    // Run must be marked Failed
    let run_after = store.get_run(run.id).await.expect("run exists");
    assert_eq!(run_after.status, RunStatus::Failed);

    // Store events must contain an error event naming the backend
    let events = store.get_events(run.id).await.expect("events load");
    let error_event = events
        .iter()
        .find(|e| matches!(e.kind, EventKind::Error))
        .expect("error event recorded in store");
    let msg = error_event
        .payload
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    assert!(
        msg.contains("missing-cli-tool"),
        "error event message must name the backend: {msg}"
    );
}

/// 4. Missing repository -> recorded error naming missing repository.
#[tokio::test]
async fn code_stage_missing_repo_records_error() {
    let backend = Arc::new(CapturingBackend::new("available-cli"));
    let (engine, store, _dir, mut project) = fixture(Some(backend)).await;

    engine
        .backend_registry()
        .set_project_backend(project.id, "available-cli");

    // Remove repo from project
    project.repo_path = None;
    store
        .update_project(&project)
        .await
        .expect("project updated");

    let run = engine
        .start_run(project.id, "Build without repo")
        .await
        .expect("start run");

    let run_at_plan = walk_to_stage(&engine, run.id, Stage::PlanTasks).await;
    assert_eq!(run_at_plan.current_stage, Stage::PlanTasks);

    // Advancing into Code with no repo must fail
    let err = engine
        .advance_stage(run.id)
        .await
        .expect_err("missing repo must fail loudly");
    assert!(
        err.to_string().contains("needs an attached repository"),
        "error must mention missing repo: {err}"
    );

    let run_after = store.get_run(run.id).await.expect("run exists");
    assert_eq!(run_after.status, RunStatus::Failed);

    let events = store.get_events(run.id).await.expect("events load");
    let error_event = events
        .iter()
        .find(|e| matches!(e.kind, EventKind::Error))
        .expect("error event recorded");
    let msg = error_event
        .payload
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    assert!(
        msg.contains("needs an attached repository"),
        "error event message must mention repository: {msg}"
    );
}

/// 5. CLI failure -> run records failure truthfully.
#[tokio::test]
async fn code_stage_cli_failure_records_run_failure() {
    let failing_backend = Arc::new(CapturingBackend::failing(
        "broken-cli",
        "compiler error: syntax error in generated code",
    ));
    let (engine, store, dir, project) = fixture(Some(failing_backend)).await;

    engine
        .backend_registry()
        .set_project_backend(project.id, "broken-cli");

    let run = engine
        .start_run(project.id, "Build broken")
        .await
        .expect("start run");

    let repo_path = project.repo_path.as_ref().expect("repo path");
    let worktree = crate::worktree::create_run_worktree(
        std::path::Path::new(repo_path),
        &dir.path().join("worktrees"),
        &run.id.0.to_string(),
        "HEAD",
    )
    .await
    .expect("worktree created");

    let mut run = store.get_run(run.id).await.expect("run exists");
    run.worktree_path = Some(worktree.path.to_string_lossy().into_owned());
    run.worktree_branch = Some(format!("warsha/run-{}", run.id.0));
    store.update_run(&run).await.expect("run updated");

    let run_at_plan = walk_to_stage(&engine, run.id, Stage::PlanTasks).await;
    assert_eq!(run_at_plan.current_stage, Stage::PlanTasks);

    // Advancing into Code with failing CLI must fail
    let err = engine
        .advance_stage(run.id)
        .await
        .expect_err("failing CLI must fail loudly");
    assert!(
        err.to_string().contains("syntax error in generated code"),
        "error must mention the failure reason: {err}"
    );

    let run_after = store.get_run(run.id).await.expect("run exists");
    assert_eq!(run_after.status, RunStatus::Failed);

    let events = store.get_events(run.id).await.expect("events load");
    let error_event = events
        .iter()
        .find(|e| matches!(e.kind, EventKind::Error))
        .expect("error event recorded");
    let msg = error_event
        .payload
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    assert!(
        msg.contains("syntax error in generated code"),
        "error event message must contain failure detail: {msg}"
    );
}

/// 6. Success -> completion recorded truthfully.
#[tokio::test]
async fn code_stage_success_records_completion() {
    let backend = Arc::new(CapturingBackend::new("working-cli"));
    let (engine, store, dir, project) = fixture(Some(backend)).await;

    engine
        .backend_registry()
        .set_project_backend(project.id, "working-cli");

    let run = engine
        .start_run(project.id, "Build working app")
        .await
        .expect("start run");

    let repo_path = project.repo_path.as_ref().expect("repo path");
    let worktree = crate::worktree::create_run_worktree(
        std::path::Path::new(repo_path),
        &dir.path().join("worktrees"),
        &run.id.0.to_string(),
        "HEAD",
    )
    .await
    .expect("worktree created");

    let mut run = store.get_run(run.id).await.expect("run exists");
    run.worktree_path = Some(worktree.path.to_string_lossy().into_owned());
    run.worktree_branch = Some(format!("warsha/run-{}", run.id.0));
    store.update_run(&run).await.expect("run updated");

    let run_at_plan = walk_to_stage(&engine, run.id, Stage::PlanTasks).await;
    assert_eq!(run_at_plan.current_stage, Stage::PlanTasks);

    // Advance Stage::PlanTasks into Stage::Code
    let advanced = engine
        .advance_stage(run.id)
        .await
        .expect("code stage executes and succeeds");

    assert_eq!(advanced.current_stage, Stage::Code);
    assert_eq!(advanced.status, RunStatus::Running);

    // Code artifact must be recorded
    let code_artifact = advanced
        .artifacts
        .get("code")
        .expect("code artifact must be recorded");
    assert!(
        code_artifact
            .content
            .contains("The coding backend `working-cli` ran this stage."),
        "code artifact content must report the backend run: {}",
        code_artifact.content
    );
}

#[tokio::test]
async fn code_stage_rejects_empty_output() {
    let dir = tempfile::tempdir().expect("tempdir");
    let store = Arc::new(
        Store::open_at(dir.path().join("pipeline.db"))
            .await
            .expect("store opens"),
    );

    let (empty_provider, _) = ScriptedProvider::new("empty-coder", "");
    let mut router = ProviderRouter::new();
    router.register_provider(Box::new(empty_provider));
    for role in [
        Role::Intake,
        Role::Researcher,
        Role::PM,
        Role::Designer,
        Role::Architect,
        Role::Reviewer,
        Role::Release,
        Role::Marketer,
        Role::Feedback,
    ] {
        router.set_role_routing(RoleRouting {
            role,
            targets: vec![RoutingTarget {
                provider_id: FAKE_PROVIDER_ID.to_string(),
                model_id: FAKE_MODEL_ID.to_string(),
                weight: 100,
            }],
            fallback_enabled: false,
            budget_cents_per_run: None,
        });
    }
    router.set_role_routing(RoleRouting {
        role: Role::Coder,
        targets: vec![RoutingTarget {
            provider_id: "empty-coder".to_string(),
            model_id: "scripted-model".to_string(),
            weight: 100,
        }],
        fallback_enabled: false,
        budget_cents_per_run: None,
    });

    let engine =
        PipelineEngine::<SettingsStore>::new_test(store.clone(), Arc::new(RwLock::new(router)));

    let repo = dir.path().join("repo");
    std::fs::create_dir(&repo).expect("repo dir");
    std::fs::write(repo.join("base.txt"), "base").expect("base file");
    git_repo(&repo);

    let project = Project {
        id: ProjectId::new(),
        name: "empty-code-test".to_string(),
        description: "Empty code test".to_string(),
        language: "en".to_string(),
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        repo_path: Some(repo.to_string_lossy().into_owned()),
        repo_url: None,
        confinement: None,
        approval_mode: None,
        permissions: ProjectPermissions::default(),
    };
    store
        .create_project(&project)
        .await
        .expect("project created");

    let run = engine
        .start_run(project.id, "Build empty app")
        .await
        .expect("start run");

    let run_at_plan = walk_to_stage(&engine, run.id, Stage::PlanTasks).await;
    assert_eq!(run_at_plan.current_stage, Stage::PlanTasks);

    // Advancing from PlanTasks into Code must fail loudly
    let result = engine.advance_stage(run.id).await;
    assert!(
        result.is_err(),
        "advance_stage into Code with empty output must fail"
    );

    let failed_run = store.get_run(run.id).await.expect("run exists");
    assert_eq!(
        failed_run.status,
        RunStatus::Failed,
        "run status must be Failed"
    );

    let events = store.get_events(run.id).await.expect("events exist");
    assert!(
        events.iter().any(|e| e.kind == EventKind::Error
            && e.payload.get("action").and_then(|a| a.as_str()) == Some("stage_failed")),
        "stage_failed event must be emitted on empty output"
    );
}

#[tokio::test]
async fn code_stage_rejects_dsml_leak() {
    let dir = tempfile::tempdir().expect("tempdir");
    let store = Arc::new(
        Store::open_at(dir.path().join("pipeline.db"))
            .await
            .expect("store opens"),
    );

    let (dsml_provider, _) = ScriptedProvider::new(
        "dsml-coder",
        "</｜DSML｜ parameter> </｜DSML｜ invoke> </｜DSML｜ calls>",
    );
    let mut router = ProviderRouter::new();
    router.register_provider(Box::new(dsml_provider));
    for role in [
        Role::Intake,
        Role::Researcher,
        Role::PM,
        Role::Designer,
        Role::Architect,
        Role::Reviewer,
        Role::Release,
        Role::Marketer,
        Role::Feedback,
    ] {
        router.set_role_routing(RoleRouting {
            role,
            targets: vec![RoutingTarget {
                provider_id: FAKE_PROVIDER_ID.to_string(),
                model_id: FAKE_MODEL_ID.to_string(),
                weight: 100,
            }],
            fallback_enabled: false,
            budget_cents_per_run: None,
        });
    }
    router.set_role_routing(RoleRouting {
        role: Role::Coder,
        targets: vec![RoutingTarget {
            provider_id: "dsml-coder".to_string(),
            model_id: "scripted-model".to_string(),
            weight: 100,
        }],
        fallback_enabled: false,
        budget_cents_per_run: None,
    });

    let engine =
        PipelineEngine::<SettingsStore>::new_test(store.clone(), Arc::new(RwLock::new(router)));

    let repo = dir.path().join("repo");
    std::fs::create_dir(&repo).expect("repo dir");
    std::fs::write(repo.join("base.txt"), "base").expect("base file");
    git_repo(&repo);

    let project = Project {
        id: ProjectId::new(),
        name: "dsml-code-test".to_string(),
        description: "DSML leak test".to_string(),
        language: "en".to_string(),
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        repo_path: Some(repo.to_string_lossy().into_owned()),
        repo_url: None,
        confinement: None,
        approval_mode: None,
        permissions: ProjectPermissions::default(),
    };
    store
        .create_project(&project)
        .await
        .expect("project created");

    let run = engine
        .start_run(project.id, "Build DSML leak app")
        .await
        .expect("start run");

    let run_at_plan = walk_to_stage(&engine, run.id, Stage::PlanTasks).await;
    assert_eq!(run_at_plan.current_stage, Stage::PlanTasks);

    // Advancing from PlanTasks into Code must fail loudly
    let result = engine.advance_stage(run.id).await;
    assert!(
        result.is_err(),
        "advance_stage into Code with DSML leak must fail"
    );

    let failed_run = store.get_run(run.id).await.expect("run exists");
    assert_eq!(
        failed_run.status,
        RunStatus::Failed,
        "run status must be Failed"
    );

    let events = store.get_events(run.id).await.expect("events exist");
    assert!(
        events.iter().any(|e| e.kind == EventKind::Error
            && e.payload.get("action").and_then(|a| a.as_str()) == Some("stage_failed")),
        "stage_failed event must be emitted on DSML leak"
    );
}

#[tokio::test]
async fn gate_c_changes_requested_reruns_coder() {
    let dir = tempfile::tempdir().expect("tempdir");
    let store = Arc::new(
        Store::open_at(dir.path().join("pipeline.db"))
            .await
            .expect("store opens"),
    );

    let valid_code = r#"{"files": [{"path": "src/main.rs", "content": "fn main() { println!(\"gate c test\"); }", "language": "rust"}], "notes": "initial"}"#;
    let (coder_provider, coder_calls) = ScriptedProvider::new("custom-coder", valid_code);
    let (reviewer_provider, reviewer_calls) = ScriptedProvider::new(
        "custom-reviewer",
        "# Review\n\n- status: APPROVED\n- notes: looks good\n",
    );

    let mut router = ProviderRouter::new();
    router.register_provider(Box::new(coder_provider));
    router.register_provider(Box::new(reviewer_provider));
    for role in [
        Role::Intake,
        Role::Researcher,
        Role::PM,
        Role::Designer,
        Role::Architect,
        Role::Release,
        Role::Marketer,
        Role::Feedback,
    ] {
        router.set_role_routing(RoleRouting {
            role,
            targets: vec![RoutingTarget {
                provider_id: FAKE_PROVIDER_ID.to_string(),
                model_id: FAKE_MODEL_ID.to_string(),
                weight: 100,
            }],
            fallback_enabled: false,
            budget_cents_per_run: None,
        });
    }
    router.set_role_routing(RoleRouting {
        role: Role::Coder,
        targets: vec![RoutingTarget {
            provider_id: "custom-coder".to_string(),
            model_id: "scripted-model".to_string(),
            weight: 100,
        }],
        fallback_enabled: false,
        budget_cents_per_run: None,
    });
    router.set_role_routing(RoleRouting {
        role: Role::Reviewer,
        targets: vec![RoutingTarget {
            provider_id: "custom-reviewer".to_string(),
            model_id: "scripted-model".to_string(),
            weight: 100,
        }],
        fallback_enabled: false,
        budget_cents_per_run: None,
    });

    let engine =
        PipelineEngine::<SettingsStore>::new_test(store.clone(), Arc::new(RwLock::new(router)));

    let repo = dir.path().join("repo");
    std::fs::create_dir(&repo).expect("repo dir");
    std::fs::write(repo.join("base.txt"), "base").expect("base file");
    git_repo(&repo);

    let project = Project {
        id: ProjectId::new(),
        name: "gate-c-rerun-test".to_string(),
        description: "Gate-C rerun test".to_string(),
        language: "en".to_string(),
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        repo_path: Some(repo.to_string_lossy().into_owned()),
        repo_url: None,
        confinement: None,
        approval_mode: None,
        permissions: ProjectPermissions::default(),
    };
    store
        .create_project(&project)
        .await
        .expect("project created");

    let run = engine
        .start_run(project.id, "Build Gate-C app")
        .await
        .expect("start run");

    // Walk run until GateC is reached
    let run_at_gate = walk_to_stage(&engine, run.id, Stage::GateC).await;
    assert_eq!(run_at_gate.current_stage, Stage::GateC);

    let coder_calls_before = coder_calls.load(std::sync::atomic::Ordering::SeqCst);
    let reviewer_calls_before = reviewer_calls.load(std::sync::atomic::Ordering::SeqCst);
    assert_eq!(coder_calls_before, 1, "coder called once before Gate-C");
    assert_eq!(
        reviewer_calls_before, 1,
        "reviewer called once before Gate-C"
    );

    // Request changes at Gate-C
    engine
        .request_changes(
            run.id,
            Stage::GateC,
            "Implementation missing core features".to_string(),
            DeviceId::new(),
        )
        .await
        .expect("request_changes succeeds");

    let paused_run = store.get_run(run.id).await.expect("run exists");
    assert_eq!(paused_run.status, RunStatus::Paused);

    // Producing stage for GateC must be Stage::Code (not ReviewQaSecurity)
    assert_eq!(
        crate::producing_stage_for_gate(Stage::GateC),
        Some(Stage::Code),
        "producing stage for Gate-C must be Code"
    );

    // Resume the run: must re-run Coder, then re-run Reviewer, then return at Gate-C
    let resumed = engine
        .resume_run(run.id)
        .await
        .expect("resume_run succeeds");
    assert_eq!(
        resumed.current_stage,
        Stage::GateC,
        "Gate-C resume must bring run back to Gate-C"
    );
    assert_eq!(resumed.gate_states[&Stage::GateC], GateState::Pending);

    let coder_calls_after = coder_calls.load(std::sync::atomic::Ordering::SeqCst);
    let reviewer_calls_after = reviewer_calls.load(std::sync::atomic::Ordering::SeqCst);
    assert_eq!(
        coder_calls_after, 2,
        "coder must have re-executed after Gate-C resume: before={}, after={}",
        coder_calls_before, coder_calls_after
    );
    assert_eq!(
        reviewer_calls_after, 2,
        "reviewer must have re-executed after coder: before={}, after={}",
        reviewer_calls_before, reviewer_calls_after
    );
}
