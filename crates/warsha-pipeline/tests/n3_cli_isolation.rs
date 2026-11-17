//! N3 acceptance tests: CLI Code stage isolation.
//!
//! The CLI Code stage must run in the run's own worktree — never the project
//! checkout — and its result must be committed on the run branch by the daemon.
//! The engine drives the stage through `advance_stage` with a mock CLI backend
//! (the `fake_cli` shell-script pattern from `warsha-backends`' own tests).

#![cfg(unix)]

use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use tokio::sync::RwLock;

use warsha_core::{
    DeviceId, Project, ProjectId, ProjectPermissions, Role, RoleRouting, RoutingTarget, Stage,
};
use warsha_pipeline::settings::SettingsStore;
use warsha_pipeline::PipelineEngine;
use warsha_pipeline::{BackendError, CodingBackend, CodingResult, CodingTask, Sandbox};
use warsha_providers::{ProviderRouter, FAKE_MODEL_ID, FAKE_PROVIDER_ID};
use warsha_store::Store;

/// A mock coding backend: writes a marker file into whatever directory the
/// sandbox points at, so the test can see exactly where the stage ran.
struct IsolationProbe {
    marker: &'static str,
}

#[async_trait::async_trait]
impl CodingBackend for IsolationProbe {
    fn name(&self) -> &str {
        "isolation-probe"
    }

    fn is_available(&self) -> bool {
        true
    }

    async fn execute(
        &self,
        task: CodingTask,
        sandbox: &Sandbox,
    ) -> Result<CodingResult, BackendError> {
        let marker_path = sandbox.work_dir.join(self.marker);
        std::fs::write(&marker_path, "probe")
            .map_err(|e| BackendError::ExecutionFailed(e.to_string()))?;
        Ok(CodingResult {
            task_id: task.id,
            success: true,
            diff: Some("diff --git a/probe.txt b/probe.txt".to_string()),
            files_changed: vec![self.marker.to_string()],
            usage: None,
            error: None,
            duration_ms: 1,
        })
    }
}

/// A git repository fixture with one commit, so a worktree can be cut from it.
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

fn head_tree(repo: &str) -> String {
    let out = Command::new("git")
        .args(["rev-parse", "HEAD^{tree}"])
        .current_dir(repo)
        .output()
        .expect("git runs");
    assert!(out.status.success(), "git rev-parse failed");
    String::from_utf8(out.stdout)
        .expect("utf8")
        .trim()
        .to_string()
}

async fn routed_router() -> Arc<RwLock<ProviderRouter>> {
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

async fn engine() -> (
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
    let engine = PipelineEngine::<SettingsStore>::new_test(store.clone(), routed_router().await)
        .with_coding_backend(Arc::new(IsolationProbe {
            marker: "probe.txt",
        }));

    // A project attached to a real git repository.
    let repo = dir.path().join("repo");
    std::fs::create_dir(&repo).expect("repo dir");
    std::fs::write(repo.join("base.txt"), "base").expect("base file");
    git_repo(&repo);

    let project = Project {
        id: ProjectId::new(),
        name: "n3-isolation".to_string(),
        description: "N3 isolation fixture".to_string(),
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

/// The CLI stage runs in the run's worktree — the project checkout's tree hash
/// is unchanged, and the stage's change is committed on `warsha/run-<id>`.
#[tokio::test]
async fn cli_stage_runs_in_run_worktree_and_isolates_project() {
    let (engine, store, dir, project) = engine().await;
    let repo = project.repo_path.clone().expect("attached repo");
    let tree_before = head_tree(&repo);

    let run = engine
        .start_run(project.id, "Build a todo app")
        .await
        .expect("a run starts");

    // Cut a run worktree the way the daemon does and persist it on the Run row.
    let worktree = warsha_pipeline::create_run_worktree(
        std::path::Path::new(&repo),
        &dir.path().join("worktrees"),
        &run.id.0.to_string(),
        "HEAD",
    )
    .await
    .expect("the run worktree is created");
    let mut run = store.get_run(run.id).await.expect("run readable");
    run.worktree_path = Some(worktree.path.to_string_lossy().into_owned());
    run.worktree_branch = Some(format!("warsha/run-{}", run.id.0));
    store.update_run(&run).await.expect("run updated");

    // Walk the run to the Code stage: advance one stage at a time, approving
    // each gate as it becomes pending, until the run sits at Code.
    let mut run = engine
        .advance_stage(run.id)
        .await
        .expect("the Idea stage runs");
    loop {
        if run.current_stage == Stage::Code {
            break;
        }
        if run.current_stage.is_gate() {
            engine
                .approve_gate(run.id, run.current_stage, DeviceId::new())
                .await
                .expect("gate approves");
        }
        run = engine
            .advance_stage(run.id)
            .await
            .expect("the run advances");
    }

    // The probe wrote into the RUN worktree, not the project checkout.
    assert!(
        worktree.path.join("probe.txt").exists(),
        "the backend must run inside the run worktree"
    );
    assert!(
        !std::path::Path::new(&repo).join("probe.txt").exists(),
        "the backend must not touch the project checkout"
    );
    assert_eq!(
        tree_before,
        head_tree(&repo),
        "the project checkout tree hash must be unchanged"
    );

    // The stage's change is committed on the run branch, naming the run.
    let log = Command::new("git")
        .args(["log", "--oneline", &format!("warsha/run-{}", run.id.0)])
        .current_dir(&worktree.path)
        .output()
        .expect("git runs");
    let log = String::from_utf8(log.stdout).expect("utf8");
    assert!(
        log.contains(&format!("chore(run-{})", run.id.0)),
        "the stage commit must name the run, got: {log}"
    );
}

/// A run with no assigned worktree fails by name — never a silent fallback to
/// the project checkout.
#[tokio::test]
async fn cli_stage_without_worktree_fails_by_name() {
    let (engine, store, _dir, project) = engine().await;
    let run = engine
        .start_run(project.id, "Build a todo app")
        .await
        .expect("a run starts");

    // Walk to the Code stage without ever assigning a worktree: advance one
    // stage at a time, approving each gate as it becomes pending.
    let mut latest = engine
        .advance_stage(run.id)
        .await
        .expect("the Idea stage runs");
    let outcome = loop {
        if latest.current_stage == Stage::Code {
            break engine.advance_stage(run.id).await;
        }
        if latest.current_stage.is_gate() {
            engine
                .approve_gate(run.id, latest.current_stage, DeviceId::new())
                .await
                .expect("gate approves");
        }
        latest = match engine.advance_stage(run.id).await {
            Ok(next) => next,
            Err(error) => break Err(error),
        };
    };
    match outcome {
        Err(error) => assert!(
            error.to_string().contains("no assigned worktree"),
            "the failure must name the missing worktree, got: {error}"
        ),
        Ok(run) => {
            // The stage recorded the failure on the run instead of raising it;
            // the run's events must still carry the named cause.
            let events = store.get_events(run.id).await.expect("events readable");
            let named = events.iter().any(|event| {
                serde_json::to_string(&event)
                    .map(|s| s.contains("no assigned worktree"))
                    .unwrap_or(false)
            });
            assert!(
                named,
                "a run that reached the Code stage without a worktree must carry the named failure"
            );
        }
    }
}

/// The worktree fields survive a store round-trip (restart survival).
#[tokio::test]
async fn worktree_fields_survive_a_store_round_trip() {
    let (engine, store, dir, project) = engine().await;
    let repo = project.repo_path.clone().expect("attached repo");
    let run = engine
        .start_run(project.id, "Build a todo app")
        .await
        .expect("a run starts");

    let worktree = warsha_pipeline::create_run_worktree(
        std::path::Path::new(&repo),
        &dir.path().join("worktrees"),
        &run.id.0.to_string(),
        "HEAD",
    )
    .await
    .expect("the run worktree is created");
    let mut run = store.get_run(run.id).await.expect("run readable");
    run.worktree_path = Some(worktree.path.to_string_lossy().into_owned());
    run.worktree_branch = Some(format!("warsha/run-{}", run.id.0));
    store.update_run(&run).await.expect("run updated");

    let reloaded = store.get_run(run.id).await.expect("run readable");
    assert_eq!(
        reloaded.worktree_path.as_deref(),
        Some(worktree.path.to_string_lossy().as_ref()),
        "the worktree path persists across a restart (store round-trip)"
    );
    assert_eq!(
        reloaded.worktree_branch.as_deref(),
        Some(format!("warsha/run-{}", run.id.0).as_str()),
        "the run branch persists across a restart"
    );
}

/// Silence the unused-warning for PathBuf when the probe is compiled on
/// non-unix targets (the whole file is unix-gated anyway).
#[allow(dead_code)]
fn _pathbuf_witness(_: PathBuf) {}

/// B2: a read-only run's CLI stage cannot modify its worktree — the stage
/// fails with the violation named and the tree is restored from HEAD.
#[tokio::test]
async fn read_only_stage_writing_fails_named_and_restores_the_tree() {
    let (engine, store, dir, project) = engine().await;
    let repo = project.repo_path.clone().expect("attached repo");

    let run = engine
        .start_run(project.id, "Build a todo app")
        .await
        .expect("a run starts");
    let worktree = warsha_pipeline::create_run_worktree(
        std::path::Path::new(&repo),
        &dir.path().join("worktrees"),
        &run.id.0.to_string(),
        "HEAD",
    )
    .await
    .expect("the run worktree is created");
    let mut run = store.get_run(run.id).await.expect("run readable");
    run.worktree_path = Some(worktree.path.to_string_lossy().into_owned());
    run.worktree_branch = Some(format!("warsha/run-{}", run.id.0));
    // B2: the run is read-only — resolved at start, persisted on the Run row.
    run.confinement = Some(warsha_core::Confinement::ReadOnly);
    store.update_run(&run).await.expect("run updated");

    // A backend that writes into the worktree it is handed.
    struct WritingProbe;
    #[async_trait::async_trait]
    impl CodingBackend for WritingProbe {
        fn name(&self) -> &str {
            "writing-probe"
        }
        fn is_available(&self) -> bool {
            true
        }
        async fn execute(
            &self,
            task: CodingTask,
            sandbox: &Sandbox,
        ) -> Result<CodingResult, BackendError> {
            std::fs::write(sandbox.work_dir.join("violation.txt"), "written")
                .map_err(|e| BackendError::ExecutionFailed(e.to_string()))?;
            Ok(CodingResult {
                task_id: task.id,
                success: true,
                diff: Some("diff --git a/violation.txt".to_string()),
                files_changed: vec!["violation.txt".to_string()],
                usage: None,
                error: None,
                duration_ms: 1,
            })
        }
    }
    let engine = engine.with_coding_backend(Arc::new(WritingProbe));

    // Walk to the Code stage and run it: the stage must fail with the
    // violation named, and the tree must be restored.
    let mut latest = engine
        .advance_stage(run.id)
        .await
        .expect("the Idea stage runs");
    let outcome = loop {
        if latest.current_stage == Stage::Code {
            break engine.advance_stage(run.id).await;
        }
        if latest.current_stage.is_gate() {
            engine
                .approve_gate(run.id, latest.current_stage, DeviceId::new())
                .await
                .expect("gate approves");
        }
        latest = match engine.advance_stage(run.id).await {
            Ok(next) => next,
            Err(error) => break Err(error),
        };
    };
    match outcome {
        Err(error) => assert!(
            error.to_string().contains("read-only violation"),
            "the failure must name the violation, got: {error}"
        ),
        Ok(run_after) => panic!(
            "a read-only stage must not succeed after writing; stage={:?}, violation.txt={}",
            run_after.current_stage,
            worktree.path.join("violation.txt").exists()
        ),
    }
    assert!(
        !worktree.path.join("violation.txt").exists(),
        "the written file must be restored away"
    );
    // The worktree (not the project checkout) is back at its base tree.
    let wt_head = Command::new("git")
        .args(["rev-parse", "HEAD^{tree}"])
        .current_dir(&worktree.path)
        .output()
        .expect("git runs");
    assert!(
        wt_head.status.success(),
        "the run worktree must still be a valid git tree"
    );
}
