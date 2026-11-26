#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::unimplemented,
    clippy::unwrap_used,
    unused_crate_dependencies
)]

//! D5 acceptance tests: the swarm run mode (engine half).
//!
//! Spec anchor: `docs/zadloop/R-NEXT-MASTER-PLAN.md` §D5 (`:1490-1560`). The
//! daemon half (runs.subtasks RPC, swarm settings RPC) is covered by the
//! warshad suites; the desktop picker gating by the v3 suites.
//!
//! These tests drive the real pipeline to the Code stage with a mock coding
//! backend, so the swarm path — decomposition, scheduling, budget
//! reservations, rate-limit halt, worktree isolation, local merger, conflict
//! re-queue — runs end to end on the engine.

#![cfg(unix)]
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

use warsha_core::{DeviceId, Project, ProjectId, Role, Stage, TokenUsage};
use warsha_core::{ProviderKind, ProviderQuota, RoleRouting, RoutingTarget};
use warsha_pipeline::settings::SettingsStore;
use warsha_pipeline::{
    BackendError, CodingBackend, CodingResult, CodingTask, PipelineEngine, Sandbox,
};
use warsha_providers::{
    ChatMessage, ChatProvider, ChatRequest, ChatResponse, ChatStreamChunk, HealthCheck,
    MessageRole, ModelInfo, ProviderError, ProviderRouter,
};
use warsha_store::Store;

/// Peak concurrent subtask executions, for the parallel-cap assertions.
/// Per-fixture: a static would leak across tests running in parallel.
#[derive(Default)]
struct ProbeCounters {
    concurrent: AtomicUsize,
    max_seen: AtomicUsize,
}

impl ProbeCounters {
    fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    fn max_seen(&self) -> usize {
        self.max_seen.load(Ordering::SeqCst)
    }
}

/// A mock coding backend: writes a marker named after the subtask into the
/// sandbox's work dir, optionally failing with a rate-limit error.
struct SwarmProbe {
    /// Fail (with a 429-style error) when the task description contains this.
    fail_on: Option<&'static str>,
    /// Use one shared file for every subtask (the conflict fixture).
    shared_file: Option<&'static str>,
    /// The fixture's own concurrency counters.
    counters: Arc<ProbeCounters>,
}

#[async_trait::async_trait]
impl CodingBackend for SwarmProbe {
    fn name(&self) -> &str {
        "swarm-probe"
    }

    fn is_available(&self) -> bool {
        true
    }

    async fn execute(
        &self,
        task: CodingTask,
        sandbox: &Sandbox,
    ) -> Result<CodingResult, BackendError> {
        let inflight = self.counters.concurrent.fetch_add(1, Ordering::SeqCst) + 1;
        self.counters.max_seen.fetch_max(inflight, Ordering::SeqCst);
        tokio::time::sleep(std::time::Duration::from_millis(120)).await;

        let title = task
            .context
            .get("subtask")
            .cloned()
            .unwrap_or_else(|| "unnamed".to_string());
        let file = match self.shared_file {
            Some(shared) => shared.to_string(),
            None => format!("src/{}.txt", title.replace(' ', "-")),
        };
        if let Some(parent) = sandbox.work_dir.join(&file).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| BackendError::ExecutionFailed(e.to_string()))?;
        }
        std::fs::write(sandbox.work_dir.join(&file), title.clone())
            .map_err(|e| BackendError::ExecutionFailed(e.to_string()))?;

        self.counters.concurrent.fetch_sub(1, Ordering::SeqCst);

        if let Some(fail_on) = self.fail_on {
            if title.contains(fail_on) {
                return Ok(CodingResult {
                    task_id: task.id,
                    success: false,
                    diff: Some(format!(
                        "+ sk-swarmPersistCanary123456\n{}",
                        "+é\n".repeat(32 * 1024)
                    )),
                    files_changed: vec![file],
                    usage: None,
                    error: Some("HTTP 429: rate limit exceeded".to_string()),
                    duration_ms: 1,
                });
            }
        }

        Ok(CodingResult {
            task_id: task.id,
            success: true,
            diff: Some("diff --git a/x b/x".to_string()),
            files_changed: vec![file],
            usage: Some(TokenUsage {
                input: 1,
                output: 1,
                total: 2,
                cost_cents: None,
            }),
            error: None,
            duration_ms: 1,
        })
    }
}

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .current_dir(dir)
        .args(args)
        .status()
        .expect("git runs");
    assert!(status.success(), "git {args:?} failed");
}

/// A routed provider whose every chat reply is the test's plan text, so the
/// PlanTasks stage writes the plan into the `plan_tasks` artifact exactly —
/// the decomposition source for the swarm stage is then deterministic.
struct ScriptedProvider {
    content: String,
    id: String,
}

impl ScriptedProvider {
    fn new(content: &str) -> Self {
        Self {
            content: content.to_string(),
            id: "scripted".to_string(),
        }
    }
}

#[async_trait::async_trait]
impl ChatProvider for ScriptedProvider {
    fn id(&self) -> &str {
        &self.id
    }

    fn kind(&self) -> ProviderKind {
        ProviderKind::CustomOpenAICompatible
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError> {
        Ok(vec![ModelInfo {
            id: "mock-model".to_string(),
            name: "Scripted Model".to_string(),
            provider: self.id.clone(),
            context_window: 4096,
            max_output: 2048,
            pricing: warsha_core::ModelPricing {
                input_per_million_cents: 100,
                output_per_million_cents: 200,
            },
        }])
    }

    async fn health(&self) -> Result<HealthCheck, ProviderError> {
        Ok(HealthCheck {
            healthy: true,
            latency_ms: Some(1),
            error: None,
        })
    }

    async fn chat(&self, _request: ChatRequest) -> Result<ChatResponse, ProviderError> {
        Ok(ChatResponse {
            id: "scripted-response".to_string(),
            model: "mock-model".to_string(),
            choices: vec![warsha_providers::ChatChoice {
                index: 0,
                message: ChatMessage {
                    role: MessageRole::Assistant,
                    content: self.content.clone(),
                },
                finish_reason: Some("stop".to_string()),
            }],
            usage: TokenUsage {
                input: 0,
                output: 0,
                total: 0,
                cost_cents: None,
            },
        })
    }

    async fn chat_stream(
        &self,
        _request: ChatRequest,
    ) -> Result<
        Box<dyn futures::Stream<Item = Result<ChatStreamChunk, ProviderError>> + Send + Unpin>,
        ProviderError,
    > {
        unimplemented!("the swarm fixture never streams")
    }

    fn cost_of(&self, _model: &str, _usage: &TokenUsage) -> Result<u64, ProviderError> {
        Ok(0)
    }

    async fn get_quota(&self) -> Result<ProviderQuota, ProviderError> {
        Ok(ProviderQuota::Unknown)
    }
}

fn git_repo(dir: &Path) {
    git(dir, &["init", "-q"]);
    git(dir, &["config", "user.email", "test@example.com"]);
    git(dir, &["config", "user.name", "Test"]);
    std::fs::write(dir.join("base.txt"), "base").expect("base file");
    git(dir, &["add", "."]);
    git(dir, &["commit", "-qm", "base"]);
}

async fn routed_router(plan: &str) -> Arc<RwLock<ProviderRouter>> {
    let mut router = ProviderRouter::new();
    router.register_provider(Box::new(ScriptedProvider::new(plan)));
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
                provider_id: "scripted".to_string(),
                model_id: "mock-model".to_string(),
                weight: 100,
            }],
            fallback_enabled: false,
            budget_cents_per_run: None,
        });
    }
    Arc::new(RwLock::new(router))
}

struct Fixture {
    engine: PipelineEngine<SettingsStore>,
    store: Arc<Store>,
    dir: tempfile::TempDir,
    repo: PathBuf,
    project: Project,
    counters: Arc<ProbeCounters>,
}

async fn fixture(
    plan: &str,
    fail_on: Option<&'static str>,
    shared_file: Option<&'static str>,
) -> Fixture {
    let dir = tempfile::tempdir().expect("tempdir");
    let store = Arc::new(
        Store::open_at(dir.path().join("d5.db"))
            .await
            .expect("store opens"),
    );
    let counters = ProbeCounters::new();
    let probe = SwarmProbe {
        fail_on,
        shared_file,
        counters: counters.clone(),
    };
    let engine =
        PipelineEngine::<SettingsStore>::new_test(store.clone(), routed_router(plan).await)
            .with_coding_backend(Arc::new(probe));

    let repo = dir.path().join("repo");
    std::fs::create_dir(&repo).expect("repo dir");
    git_repo(&repo);

    let project = Project {
        id: ProjectId::new(),
        name: "d5-swarm".to_string(),
        description: "D5 swarm fixture".to_string(),
        language: "en".to_string(),
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        repo_path: Some(repo.to_string_lossy().into_owned()),
        ..Default::default()
    };
    store.create_project(&project).await.expect("project");

    Fixture {
        engine,
        store,
        dir,
        repo,
        project,
        counters,
    }
}

/// Enable swarm for the fixture project.
async fn enable_swarm(fx: &Fixture, max_parallel: u32) {
    fx.store
        .settings()
        .save_project_swarm_settings(&warsha_store::StoredProjectSwarmSettings {
            project_id: fx.project.id.0.to_string(),
            enable_swarm: true,
            max_parallel_agents: max_parallel,
        })
        .await
        .expect("swarm settings saved");
}

/// Assign the worktree, the way the
/// daemon does at `runs.start`, then walk the run to the Code stage.
async fn swarm_run_to_code(fx: &Fixture, budget_cents: Option<u64>) -> warsha_core::Run {
    let run = fx
        .engine
        .start_run(fx.project.id, "Build the thing")
        .await
        .expect("a run starts");

    let worktree = warsha_pipeline::create_run_worktree(
        &fx.repo,
        &fx.dir.path().join("worktrees"),
        &run.id.0.to_string(),
        "HEAD",
    )
    .await
    .expect("the run worktree is created");
    let mut run = fx.store.get_run(run.id).await.expect("run readable");
    run.worktree_path = Some(worktree.path.to_string_lossy().into_owned());
    run.worktree_branch = Some(format!("warsha/run-{}", run.id.0));
    run.budget_cents = budget_cents;
    fx.store.update_run(&run).await.expect("run updated");

    let mut run = fx.engine.advance_stage(run.id).await.expect("Idea runs");
    loop {
        if run.current_stage == Stage::Code {
            break;
        }
        if run.current_stage.is_gate() {
            fx.engine
                .approve_gate(run.id, run.current_stage, DeviceId::new())
                .await
                .expect("gate approves");
        }
        run = fx
            .engine
            .advance_stage(run.id)
            .await
            .expect("the run advances");
    }
    fx.store.get_run(run.id).await.expect("run readable")
}

const THREE_TASKS: &str =
    "- task one files: src/a.txt\n- task two files: src/b.txt\n- task three files: src/c.txt\n";

/// The swarm path dispatches parallel children, merges them into the run
/// branch locally, and leaves the summary in the code artifact.
#[tokio::test]
async fn swarm_dispatches_children_merges_locally() {
    let fx = fixture(THREE_TASKS, None, None).await;
    enable_swarm(&fx, 4).await;

    let run = swarm_run_to_code(&fx, None).await;

    // Every subtask row is persisted and succeeded.
    let subtasks = fx
        .store
        .list_run_subtasks(run.id)
        .await
        .expect("subtasks listed");
    assert_eq!(subtasks.len(), 3, "the plan decomposed into 3 subtasks");
    for subtask in &subtasks {
        assert_eq!(
            subtask.status,
            warsha_core::RunSubtaskStatus::Succeeded,
            "subtask {} must succeed",
            subtask.title
        );
        assert!(
            subtask.session_id.is_some(),
            "each subtask links its child session"
        );
    }

    // Child sessions carry the N1 parent link: one parent (the merger) and
    // three children.
    let sessions = fx
        .store
        .list_sessions_by_run(run.id)
        .await
        .expect("sessions listed");
    let parent = sessions
        .iter()
        .find(|s| s.parent_session_id.is_none() && s.role == warsha_core::Role::Coder)
        .expect("the merger session exists");
    let children: Vec<_> = sessions
        .iter()
        .filter(|s| s.parent_session_id == Some(parent.id))
        .collect();
    assert_eq!(children.len(), 3, "three child sessions under one parent");

    // Parallelism never exceeded the setting (4) — the fixture sleeps, so the
    // cap is observable.
    assert!(
        fx.counters.max_seen() <= 4,
        "max parallel 4 was never exceeded, saw {}",
        fx.counters.max_seen()
    );

    // The subtask branches were merged into the run branch, locally only.
    let log = Command::new("git")
        .args(["log", "--oneline", &format!("warsha/run-{}", run.id.0)])
        .current_dir(&fx.repo)
        .output()
        .expect("git runs");
    let log = String::from_utf8(log.stdout).expect("utf8");
    assert!(
        log.contains("swarm subtask"),
        "the run branch carries the merged subtask commits, got: {log}"
    );
    assert!(
        Command::new("git")
            .args(["remote"])
            .current_dir(&fx.repo)
            .output()
            .expect("git runs")
            .stdout
            .is_empty(),
        "nothing was pushed — no remote exists"
    );

    // The code artifact carries the swarm summary.
    let artifact = run.artifacts.get("code").expect("the code artifact exists");
    assert!(
        artifact.content.contains("Swarm run of 3 subtasks"),
        "the summary names the subtask count, got: {}",
        artifact.content
    );
}

/// Results survive a store reopen and are attributable to each lane, including
/// a backend that returns partial edits with success=false.
#[tokio::test]
async fn swarm_coding_results_are_durable_and_bounded() {
    for fail_on in [None, Some("task one")] {
        let fx = fixture("- task one files: src/a.txt\n", fail_on, None).await;
        enable_swarm(&fx, 1).await;
        let run = swarm_run_to_code(&fx, None).await;
        let reopened = Store::open_at(fx.dir.path().join("d5.db"))
            .await
            .expect("store reopens");
        let subtasks = reopened.list_run_subtasks(run.id).await.expect("subtasks");
        assert_eq!(subtasks.len(), 1);
        let events = reopened.get_events(run.id).await.expect("events");
        let results: Vec<_> = events
            .iter()
            .filter(|event| event.payload["type"] == "swarm_coding_result")
            .collect();
        assert_eq!(results.len(), 1, "one durable result per execution");
        let event = results[0];
        assert_eq!(event.kind, warsha_core::EventKind::AgentStep);
        assert_eq!(event.stage, Stage::Code);
        assert_eq!(event.role, Some(Role::Coder));
        assert_eq!(event.payload["subtask_id"], subtasks[0].id.to_string());
        assert_eq!(
            event.payload["session_id"],
            subtasks[0].session_id.expect("child session").0.to_string()
        );
        assert_eq!(event.payload["success"], fail_on.is_none());
        assert_eq!(
            event.payload["files_changed"],
            serde_json::json!(["src/task-one.txt"])
        );
        let diff = event.payload["diff"].as_str().expect("diff persisted");
        if fail_on.is_none() {
            assert_eq!(diff, "diff --git a/x b/x");
            assert_eq!(event.payload["diff_truncated"], false);
        } else {
            assert!(diff.len() <= 64 * 1024);
            assert!(diff.ends_with("\n…[truncated]"));
            assert_eq!(event.payload["diff_truncated"], true);
            assert!(!diff.contains("sk-swarmPersistCanary123456"));
            assert!(diff.contains("[redacted]"));
        }
    }
}

/// Two subtasks declaring a shared file never run concurrently; a subtask that
/// declares no files runs alone.
#[tokio::test]
async fn overlap_serializes_and_no_files_runs_alone() {
    let plan = "- first files: src/shared.rs\n- second files: src/shared.rs\n";
    let fx = fixture(plan, None, None).await;
    enable_swarm(&fx, 4).await;

    let _run = swarm_run_to_code(&fx, None).await;
    assert!(
        fx.counters.max_seen() <= 1,
        "a shared declared file never runs concurrently, saw {}",
        fx.counters.max_seen()
    );

    let plan2 = "- alone task\n- later files: src/other.rs\n";
    let fx2 = fixture(plan2, None, None).await;
    enable_swarm(&fx2, 4).await;
    let _run = swarm_run_to_code(&fx2, None).await;
    assert!(
        fx2.counters.max_seen() <= 1,
        "a no-files subtask runs alone, saw {}",
        fx2.counters.max_seen()
    );
}

/// Load at 8 and the 20-agent guard: parallelism stays within the setting and
/// every agent's cap is run budget ÷ max agents.
#[tokio::test]
async fn scheduler_load_at_eight_and_guard_at_twenty() {
    let load_plan: String = (1..=8)
        .map(|i| format!("- load {i} files: src/load-{i}.txt\n"))
        .collect();
    let fx = fixture(&load_plan, None, None).await;
    enable_swarm(&fx, 8).await;
    let run = swarm_run_to_code(&fx, None).await;
    assert!(
        fx.counters.max_seen() <= 8,
        "load-8 never exceeded 8, saw {}",
        fx.counters.max_seen()
    );
    let subtasks = fx.store.list_run_subtasks(run.id).await.expect("listed");
    assert_eq!(subtasks.len(), 8);

    // Guard at 20 (A12): 20 agents, budget 2000 → every cap is 100.
    let guard_plan: String = (1..=20)
        .map(|i| format!("- guard {i} files: src/guard-{i}.txt\n"))
        .collect();
    let fx2 = fixture(&guard_plan, None, None).await;
    enable_swarm(&fx2, 20).await;
    let run = swarm_run_to_code(&fx2, Some(2000)).await;
    assert!(
        fx2.counters.max_seen() <= 20,
        "the hard cap 20 was never exceeded, saw {}",
        fx2.counters.max_seen()
    );
    let subtasks = fx2.store.list_run_subtasks(run.id).await.expect("listed");
    assert_eq!(subtasks.len(), 20, "all 20 agents dispatched");
    let mut reservations = warsha_pipeline::swarm::BudgetReservations::new(20);
    let cap = 2000 / 20;
    assert_eq!(cap, 100, "per-agent cap = budget ÷ 20");
    for agent in 0..20 {
        reservations
            .try_reserve(0, 2000)
            .unwrap_or_else(|_| panic!("agent {agent}'s cap of {cap} fits the run budget"));
    }
    // The 21st agent cannot fit: the budget is fully reserved.
    assert!(reservations.try_reserve(0, 2000).is_err());
}

/// Budget reservation at dispatch: once spend plus outstanding reservations
/// leaves less than one agent's cap, nothing new is dispatched.
#[tokio::test]
async fn budget_reservation_blocks_dispatch() {
    let plan: String = (1..=4)
        .map(|i| format!("- budget {i} files: src/budget-{i}.txt\n"))
        .collect();
    let fx = fixture(&plan, None, None).await;
    // Budget 2, max 2 → cap 1 per agent. The router prices the probe's
    // usage (1 token in / 1 token out) at 1¢ per agent.
    enable_swarm(&fx, 2).await;
    let run = swarm_run_to_code(&fx, Some(2)).await;

    let subtasks = fx.store.list_run_subtasks(run.id).await.expect("listed");
    let dispatched = subtasks
        .iter()
        .filter(|s| s.status != warsha_core::RunSubtaskStatus::Queued)
        .count();
    assert_eq!(
        dispatched, 2,
        "two agents fit the 2¢ budget at a 1¢ cap: while one runs, its outstanding reservation plus the spend leaves no room for a third; saw {:?}",
        subtasks.iter().map(|s| (s.title.clone(), s.status)).collect::<Vec<_>>()
    );
    let queued = subtasks
        .iter()
        .filter(|s| s.status == warsha_core::RunSubtaskStatus::Queued)
        .count();
    assert_eq!(queued, 2, "the rest stay queued, never dispatched");

    // The recorded spend hit the run budget — the halt is visible.
    let run = fx.store.get_run(run.id).await.expect("run readable");
    assert_eq!(run.spent_cents, 2, "the subtask spend reached the budget");
    assert_eq!(
        run.status,
        warsha_core::RunStatus::Paused,
        "the run halts when the sum of agent spend reaches the budget"
    );
}

/// The first rate-limit stops new dispatch; running agents finish; the event
/// is in the receipt (the subtask rows and the summary).
#[tokio::test]
async fn rate_limit_stops_new_dispatch() {
    let plan: String = (1..=6)
        .map(|i| format!("- rate task {i} files: src/rate-{i}.txt\n"))
        .collect();
    let fx = fixture(&plan, Some("rate task 1"), None).await;
    enable_swarm(&fx, 4).await;

    let run = swarm_run_to_code(&fx, None).await;
    let subtasks = fx.store.list_run_subtasks(run.id).await.expect("listed");
    let failed = subtasks
        .iter()
        .filter(|s| s.status == warsha_core::RunSubtaskStatus::Failed)
        .count();
    let queued = subtasks
        .iter()
        .filter(|s| s.status == warsha_core::RunSubtaskStatus::Queued)
        .count();
    assert_eq!(failed, 1, "the rate-limited agent fails");
    assert_eq!(queued, 2, "no new agent is dispatched after the rate limit");
    assert_eq!(
        subtasks
            .iter()
            .filter(|s| s.status == warsha_core::RunSubtaskStatus::Succeeded)
            .count(),
        3,
        "the three running agents finished"
    );

    // The summary names the halt.
    let run = fx.store.get_run(run.id).await.expect("run readable");
    let artifact = run.artifacts.get("code").expect("code artifact");
    assert!(
        artifact.content.contains("rate-limited halt: true"),
        "the rate-limit halt is on the run surface, got: {}",
        artifact.content
    );
}

/// Each agent sees only its own worktree.
#[tokio::test]
async fn filesystem_isolation_between_subtasks() {
    let fx = fixture(THREE_TASKS, None, None).await;
    enable_swarm(&fx, 4).await;

    let run = swarm_run_to_code(&fx, None).await;
    let worktrees_root = fx.dir.path().join("worktrees");
    let prefix = format!("run-{}-subtask-", run.id.0);
    let subtasks = fx.store.list_run_subtasks(run.id).await.expect("listed");

    // Each subtask worktree exists, holds only its own marker, and no
    // subtask's marker appears in another's worktree.
    let mut markers = Vec::new();
    for entry in std::fs::read_dir(&worktrees_root)
        .expect("worktrees root")
        .filter_map(|e| e.ok())
    {
        let wt = entry.path();
        if !wt.is_dir() || !entry.file_name().to_string_lossy().starts_with(&prefix) {
            continue;
        }
        let own: Vec<String> = subtasks
            .iter()
            .map(|st| format!("src/{}.txt", st.title.replace(' ', "-")))
            .filter(|marker| wt.join(marker).exists())
            .collect();
        assert_eq!(
            own.len(),
            1,
            "worktree {} holds exactly its own marker, saw {own:?}",
            wt.display()
        );
        markers.push(own[0].clone());
    }
    assert_eq!(
        markers.len(),
        3,
        "one marker per subtask worktree, each in its own tree: {markers:?}"
    );
    assert_eq!(
        markers
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        3,
        "each agent's tree holds a different marker"
    );
}

/// A conflicting subtask returns to the queue marked conflicted, is
/// re-dispatched at most twice, and is then reported unmerged — never
/// force-merged.
#[tokio::test]
async fn conflict_returns_to_queue_then_reports_unmerged() {
    let plan = "- alpha\n- beta\n";
    let fx = fixture(plan, None, Some("src/main.rs")).await;
    enable_swarm(&fx, 4).await;

    let run = swarm_run_to_code(&fx, None).await;

    let subtasks = fx.store.list_run_subtasks(run.id).await.expect("listed");
    let unmerged: Vec<_> = subtasks
        .iter()
        .filter(|s| s.status == warsha_core::RunSubtaskStatus::Unmerged)
        .collect();
    assert_eq!(
        unmerged.len(),
        1,
        "exactly one subtask ends unmerged; saw {:?}",
        subtasks
            .iter()
            .map(|s| (s.title.clone(), s.status))
            .collect::<Vec<_>>()
    );
    // Its branch was never force-merged: the run branch holds only one
    // subtask commit for the shared file.
    let log = Command::new("git")
        .args(["log", "--oneline", &format!("warsha/run-{}", run.id.0)])
        .current_dir(&fx.repo)
        .output()
        .expect("git runs");
    let log = String::from_utf8(log.stdout).expect("utf8");
    assert_eq!(
        log.lines().filter(|l| l.contains("swarm subtask")).count(),
        1,
        "only the first subtask merged into the run branch, got: {log}"
    );
}

/// With the setting off, no Swarm code path is reachable: the Code stage runs
/// the single-CLI path and no subtask rows ever exist.
#[tokio::test]
async fn setting_off_leaves_no_swarm_path() {
    // The fixture never calls enable_swarm.
    let fx = fixture(THREE_TASKS, None, None).await;

    let run = swarm_run_to_code(&fx, None).await;
    let subtasks = fx
        .store
        .list_run_subtasks(run.id)
        .await
        .expect("listing works");
    assert!(
        subtasks.is_empty(),
        "no subtask rows without the setting on"
    );
    let artifact = run.artifacts.get("code").expect("code artifact");
    assert!(
        !artifact.content.contains("Swarm run"),
        "the artifact is the single-CLI result, not a swarm summary"
    );
    // No subtask worktrees were cut.
    let worktrees_root = fx.dir.path().join("worktrees");
    let prefix = format!("run-{}-subtask-", run.id.0);
    assert!(
        !std::fs::read_dir(&worktrees_root)
            .expect("worktrees root")
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().starts_with(&prefix)),
        "no subtask worktrees are created without the setting on"
    );
}
