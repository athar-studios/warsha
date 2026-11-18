//! R-NEXT N2 acceptance tests:
//! - Custom backend end-to-end on a mock project via fake_cli() + absent-executable twin fails by name
//! - Unknown backend name fails at run start and never silently falls back to routed provider (A16.11)
//! - Unmapped engine refused under read-only confinement with backstop off, allowed with backstop on
//! - Shipped catalog has zero permission-skipping flags; custom entry with one emits standing warning
//! - Catalog detection marks installed/absent against a fixture PATH

#![cfg(unix)]

use std::collections::HashMap;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tokio::sync::RwLock;
use ulid::Ulid;

use warsha_backends::catalog::EngineCatalog;
use warsha_backends::CliBackend;
use warsha_core::config::CustomBackendDefinition;
use warsha_core::{
    Confinement, DeviceId, Project, ProjectId, ProjectPermissions, Role, RoleRouting,
    RoutingTarget, RunId, Stage,
};
use warsha_pipeline::settings::SettingsStore;
use warsha_pipeline::{CodingBackend, CodingBackendRegistry, CodingTask, PipelineEngine, Sandbox};
use warsha_providers::{ProviderRouter, FAKE_MODEL_ID, FAKE_PROVIDER_ID};
use warsha_store::Store;

fn fake_cli(dir: &Path, name: &str, body: &str) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("write fake cli");
    let mut perms = std::fs::metadata(&path).expect("metadata").permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&path, perms).expect("chmod +x");
    path
}

fn git_repo(dir: &Path) {
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
        Role::QA,
        Role::Security,
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

async fn setup_repo_project(
    dir: &Path,
    store: &Store,
    confinement: Option<Confinement>,
) -> Project {
    let repo = dir.join("repo");
    std::fs::create_dir(&repo).expect("repo dir");
    std::fs::write(repo.join("base.txt"), "base").expect("base file");
    git_repo(&repo);

    let project = Project {
        id: ProjectId::new(),
        name: "n2-mock-project".to_string(),
        description: "N2 acceptance fixture".to_string(),
        language: "en".to_string(),
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        repo_path: Some(repo.to_string_lossy().into_owned()),
        repo_url: None,
        confinement,
        approval_mode: None,
        permissions: ProjectPermissions::default(),
    };
    store
        .create_project(&project)
        .await
        .expect("create project");
    project
}

/// Start a run, attach a worktree, and advance up to the gate immediately before `Stage::Code`.
async fn advance_until_code_ready(
    engine: &PipelineEngine<SettingsStore>,
    store: &Store,
    dir: &Path,
    project: &Project,
    confinement: Option<Confinement>,
) -> warsha_core::Run {
    let mut run = engine
        .start_run(project.id, "Add feature X")
        .await
        .expect("start_run");
    let repo = project.repo_path.as_deref().expect("repo_path");
    let worktree = warsha_pipeline::create_run_worktree(
        Path::new(repo),
        &dir.join("worktrees"),
        &run.id.0.to_string(),
        "HEAD",
    )
    .await
    .expect("worktree");
    run.worktree_path = Some(worktree.path.to_string_lossy().into_owned());
    run.worktree_branch = Some(format!("warsha/run-{}", run.id.0));
    run.confinement = confinement;
    store.update_run(&run).await.expect("update run");

    let approver = DeviceId::new();
    let mut run = engine.advance_stage(run.id).await.expect("Idea stage runs");
    loop {
        if run.current_stage == Stage::PlanTasks {
            break;
        }
        if run.current_stage.is_gate() {
            engine
                .approve_gate(run.id, run.current_stage, approver)
                .await
                .expect("gate approves");
        }
        run = engine.advance_stage(run.id).await.expect("advance stage");
    }
    run
}

#[tokio::test]
async fn custom_backend_runs_end_to_end_on_mock_project_and_absent_twin_fails_by_name() {
    let dir = tempfile::tempdir().expect("tempdir");
    let script = fake_cli(
        dir.path(),
        "my-custom-coder",
        "echo 'custom code generated' > custom_output.txt\necho 'done'",
    );

    let custom_def = CustomBackendDefinition {
        name: "my-custom-coder".to_string(),
        display_name: "My Custom Coder".to_string(),
        executable: script.to_string_lossy().into_owned(),
        args_template: vec!["--task".to_string(), "{prompt}".to_string()],
        output_format: "plain".to_string(),
        env_names: vec![],
        permission_mapping: None,
    };
    custom_def.validate().expect("custom def validates");

    let store = Arc::new(
        Store::open_at(dir.path().join("pipeline.db"))
            .await
            .expect("store"),
    );
    let project = setup_repo_project(dir.path(), &store, None).await;

    let registry = Arc::new(CodingBackendRegistry::new());
    registry.register(Arc::new(CliBackend::from_custom_definition(&custom_def)));
    registry.set_project_backend(project.id, "my-custom-coder");

    let engine = PipelineEngine::<SettingsStore>::new_test(store.clone(), routed_router().await)
        .with_backend_registry(registry.clone());

    let run = advance_until_code_ready(&engine, &store, dir.path(), &project, None).await;
    // The probe wrote into the RUN worktree, not the project checkout.
    let run = engine
        .advance_stage(run.id)
        .await
        .expect("custom backend runs Code stage");
    assert_eq!(run.current_stage, Stage::Code);

    let wt = PathBuf::from(run.worktree_path.as_deref().expect("worktree path"));
    assert!(
        wt.join("custom_output.txt").exists(),
        "custom backend must execute inside the run worktree"
    );

    // Absent-executable twin must fail by name
    let absent_def = CustomBackendDefinition {
        name: "my-missing-coder".to_string(),
        display_name: "My Missing Coder".to_string(),
        executable: "/nonexistent/path/to/my-missing-coder-binary".to_string(),
        args_template: vec!["{prompt}".to_string()],
        output_format: "plain".to_string(),
        env_names: vec![],
        permission_mapping: None,
    };
    absent_def.validate().expect("absent def validates");
    registry.register(Arc::new(CliBackend::from_custom_definition(&absent_def)));
    registry.set_project_backend(project.id, "my-missing-coder");

    let run2 = advance_until_code_ready(&engine, &store, dir.path(), &project, None).await;
    let err = engine
        .advance_stage(run2.id)
        .await
        .expect_err("absent-executable custom backend must fail");
    let msg = err.to_string();
    assert!(
        msg.contains("my-missing-coder"),
        "failure must name the absent backend, got: {msg}"
    );
}

#[tokio::test]
async fn unknown_backend_name_fails_at_run_start_and_never_uses_routed_provider() {
    let dir = tempfile::tempdir().expect("tempdir");
    let store = Arc::new(
        Store::open_at(dir.path().join("pipeline.db"))
            .await
            .expect("store"),
    );
    let project = setup_repo_project(dir.path(), &store, None).await;

    // Even with a valid routed provider, an unknown coding backend must fail at start_run
    let registry = Arc::new(CodingBackendRegistry::new());
    registry.set_default_backend(Some("totally-unknown-engine".to_string()));

    let engine = PipelineEngine::<SettingsStore>::new_test(store.clone(), routed_router().await)
        .with_backend_registry(registry.clone());

    let err = engine
        .start_run(project.id, "Build something")
        .await
        .expect_err("unknown backend must fail at run start");
    assert!(
        err.to_string().contains("totally-unknown-engine"),
        "error must name the unknown backend, got: {err}"
    );

    // Verify per-project unknown backend also fails at run start
    registry.set_default_backend(None);
    registry.set_project_backend(project.id, "ghost-project-cli");
    let err = engine
        .start_run(project.id, "Build something else")
        .await
        .expect_err("unknown project backend must fail at run start");
    assert!(
        err.to_string().contains("ghost-project-cli"),
        "error must name the unknown project backend, got: {err}"
    );

    // Verify per-role unknown backend also fails at run start
    let registry2 = Arc::new(CodingBackendRegistry::new());
    registry2.set_role_backend(Role::Coder, "ghost-role-cli");
    let engine2 = PipelineEngine::<SettingsStore>::new_test(store.clone(), routed_router().await)
        .with_backend_registry(registry2);
    let err = engine2
        .start_run(project.id, "Build something third")
        .await
        .expect_err("unknown role backend must fail at run start");
    assert!(
        err.to_string().contains("ghost-role-cli"),
        "error must name the unknown role backend, got: {err}"
    );

    // Ensure no orphan runs were created (routed provider was never invoked)
    let runs = store.list_runs(project.id).await.expect("list runs");
    assert!(
        runs.is_empty(),
        "refused start_run must leave zero runs and never invoke routed provider"
    );
}

#[tokio::test]
async fn unmapped_engine_refused_under_read_only_with_backstop_off_and_allowed_with_backstop_on() {
    let dir = tempfile::tempdir().expect("tempdir");
    let script = fake_cli(
        dir.path(),
        "unmapped-readonly-cli",
        "echo 'read-only check'",
    );

    let def = CustomBackendDefinition {
        name: "unmapped-cli".to_string(),
        display_name: "Unmapped CLI".to_string(),
        executable: script.to_string_lossy().into_owned(),
        args_template: vec!["{prompt}".to_string()],
        output_format: "plain".to_string(),
        env_names: vec![],
        permission_mapping: None,
    };
    let backend = CliBackend::from_custom_definition(&def);
    assert!(!backend.has_permission_mapping());

    // 1. Direct CliBackend::execute refusal with backstop off
    let mut ctx = HashMap::new();
    ctx.insert("confinement".to_string(), "read_only".to_string());
    ctx.insert("approval_mode".to_string(), "ask_for_risky".to_string());
    ctx.insert("read_only_backstop".to_string(), "false".to_string());

    let task = CodingTask {
        id: Ulid::new(),
        run_id: RunId::new(),
        title: "Read-only inspect".to_string(),
        description: "Inspect code".to_string(),
        repo_path: dir.path().to_path_buf(),
        worktree_path: Some(dir.path().to_path_buf()),
        branch_name: "warsha/test".to_string(),
        base_branch: "main".to_string(),
        files: vec![],
        context: ctx.clone(),
    };
    let sandbox = Sandbox::new(dir.path().to_path_buf());
    let err = backend
        .execute(task, &sandbox)
        .await
        .expect_err("unmapped backend under read_only with backstop off must fail");
    assert!(
        err.to_string().contains("no permission mapping"),
        "error must explain missing permission mapping, got: {err}"
    );

    // 2. Direct CliBackend::execute succeeds when backstop is active
    ctx.insert("read_only_backstop".to_string(), "true".to_string());
    let task_ok = CodingTask {
        id: Ulid::new(),
        run_id: RunId::new(),
        title: "Read-only inspect".to_string(),
        description: "Inspect code".to_string(),
        repo_path: dir.path().to_path_buf(),
        worktree_path: Some(dir.path().to_path_buf()),
        branch_name: "warsha/test".to_string(),
        base_branch: "main".to_string(),
        files: vec![],
        context: ctx,
    };
    let res = backend
        .execute(task_ok, &sandbox)
        .await
        .expect("unmapped backend under read_only with backstop on must succeed");
    assert!(res.success);

    // 3. Pipeline-level refusal with backstop off
    let store = Arc::new(
        Store::open_at(dir.path().join("pipeline.db"))
            .await
            .expect("store"),
    );
    let project = setup_repo_project(dir.path(), &store, Some(Confinement::ReadOnly)).await;
    let registry = Arc::new(CodingBackendRegistry::new());
    registry.register(Arc::new(CliBackend::from_custom_definition(&def)));
    registry.set_project_backend(project.id, "unmapped-cli");

    let engine_no_backstop =
        PipelineEngine::<SettingsStore>::new_test(store.clone(), routed_router().await)
            .with_backend_registry(registry.clone())
            .with_read_only_backstop(false);

    let run = advance_until_code_ready(
        &engine_no_backstop,
        &store,
        dir.path(),
        &project,
        Some(Confinement::ReadOnly),
    )
    .await;
    let err = engine_no_backstop
        .advance_stage(run.id)
        .await
        .expect_err("pipeline must refuse unmapped backend under read-only with backstop off");
    assert!(
        err.to_string().contains("no permission mapping"),
        "pipeline error must explain missing permission mapping, got: {err}"
    );
}

#[test]
fn custom_backend_permission_skipping_warning_and_catalog_sweep() {
    // No shipped catalog entry may carry a permission-skipping flag
    let catalog = EngineCatalog::builtin();
    assert!(
        catalog.entries().len() >= 35,
        "catalog must contain ~35 coding CLIs"
    );
    for entry in catalog.entries() {
        assert!(
            !entry.has_permission_skipping_flag(),
            "shipped catalog entry `{}` must not carry a permission-skipping flag",
            entry.name
        );
    }

    // Owner-written custom entry MAY carry one, and surfaces standing warning data
    let custom_unsafe = CustomBackendDefinition {
        name: "owner-yolo-cli".to_string(),
        display_name: "Owner YOLO CLI".to_string(),
        executable: "claude".to_string(),
        args_template: vec![
            "--dangerously-skip-permissions".to_string(),
            "-p".to_string(),
            "{prompt}".to_string(),
        ],
        output_format: "plain".to_string(),
        env_names: vec![],
        permission_mapping: None,
    };
    assert!(custom_unsafe.validate().is_ok());
    assert!(custom_unsafe.has_permission_skipping_flag());
}

#[test]
fn detection_marks_installed_and_absent_against_fixture_path() {
    let dir = tempfile::tempdir().expect("tempdir");
    // Put only `claude` and `opencode` executables in the fixture PATH
    fake_cli(dir.path(), "claude", "exit 0");
    fake_cli(dir.path(), "opencode", "exit 0");

    let catalog = EngineCatalog::builtin();
    let results = catalog.detect_in_path(Some(dir.path().as_os_str()), dir.path());
    assert_eq!(results.len(), catalog.entries().len());

    let map: HashMap<&str, bool> = results
        .iter()
        .map(|(entry, installed)| (entry.name.as_str(), *installed))
        .collect();

    assert_eq!(map.get("claude-code"), Some(&true));
    assert_eq!(map.get("opencode"), Some(&true));
    assert_eq!(map.get("codex-cli"), Some(&false));
    assert_eq!(map.get("gemini-cli"), Some(&false));
    assert_eq!(map.get("cursor-cli"), Some(&false));
    assert_eq!(map.get("openhands"), Some(&false));
    assert_eq!(map.get("aider"), Some(&false));

    let installed_count = results.iter().filter(|(_, inst)| *inst).count();
    assert_eq!(installed_count, 2);
}
