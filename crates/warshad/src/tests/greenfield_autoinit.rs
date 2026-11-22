#![allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]

use super::*;
use std::path::Path;

fn owner() -> RpcExtensions {
    let mut ext = RpcExtensions::new();
    ext.insert(Actor::owner(DeviceId::new()));
    ext
}

/// Greenfield project creation without repo_path auto-initializes a repository,
/// persists the path, validates as a git repository, and allows start_run to create
/// an isolated run worktree containing the initial gitignore and README.
#[tokio::test]
async fn test_greenfield_create_project_auto_inits_repo_and_start_run_yields_worktree() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = crate::tests::test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);
    let owner = owner();

    let project = rpc
        .create_project(
            &owner,
            "Greenfield App".to_string(),
            "An app started without an existing repo".to_string(),
            "en".to_string(),
            None,
            None,
            None,
        )
        .await
        .expect("create_project succeeds for greenfield");

    let expected_repo = temp
        .path()
        .join("projects")
        .join(project.id.to_string())
        .join("repo");
    let expected_str = expected_repo.to_str().expect("valid utf-8 path");

    assert_eq!(
        project.repo_path.as_deref(),
        Some(expected_str),
        "greenfield project repo_path must be initialized under data_dir/projects/<id>/repo"
    );

    // Verify repository files on disk
    assert!(expected_repo.exists(), "repo directory must exist on disk");
    assert!(
        expected_repo.join(".gitignore").exists(),
        ".gitignore must exist in auto-initted repo"
    );
    assert!(
        expected_repo.join("README.md").exists(),
        "README.md must exist in auto-initted repo"
    );

    // Verify git repository validity via warsha_pipeline primitive
    warsha_pipeline::worktree::validate_repository(&expected_repo)
        .await
        .expect("auto-initted repo must pass validate_repository");

    // Verify store persistence
    let stored = store
        .get_project(project.id)
        .await
        .expect("project stored in DB");
    assert_eq!(
        stored.repo_path.as_deref(),
        Some(expected_str),
        "persisted repo_path must match auto-initted path"
    );

    // Follow-up start_run produces non-null worktree_path
    let run = rpc
        .start_run(
            &owner,
            project.id,
            "Initial prompt for greenfield".to_string(),
            None,
            None,
        )
        .await
        .expect("start_run succeeds");

    assert!(
        run.worktree_path.is_some(),
        "start_run must produce non-null worktree_path for greenfield project"
    );

    let worktree = rpc
        .run_worktree(&owner, run.id)
        .await
        .expect("run_worktree query succeeds");
    assert!(
        worktree.is_some(),
        "runs.worktree RPC must return Some(worktree)"
    );
    let wt = worktree.expect("worktree presence verified");
    assert_eq!(
        run.worktree_path.as_deref(),
        wt.path.to_str(),
        "RPC worktree path matches run.worktree_path"
    );

    // Worktree checkout contains .gitignore and README.md from HEAD
    let wt_path = Path::new(&wt.path);
    assert!(
        wt_path.join(".gitignore").exists(),
        ".gitignore must be present in worktree"
    );
    assert!(
        wt_path.join("README.md").exists(),
        "README.md must be present in worktree"
    );
}

/// Passing empty or whitespace string for repo_path also activates greenfield auto-init.
#[tokio::test]
async fn test_greenfield_create_project_with_empty_or_whitespace_repo_path() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = crate::tests::test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);
    let owner = owner();

    let project = rpc
        .create_project(
            &owner,
            "Whitespace Repo Project".to_string(),
            "Testing whitespace repo_path handling".to_string(),
            "en".to_string(),
            None,
            None,
            Some("   \t  \n".to_string()),
        )
        .await
        .expect("create_project with whitespace repo_path succeeds");

    let expected_repo = temp
        .path()
        .join("projects")
        .join(project.id.to_string())
        .join("repo");
    assert_eq!(
        project.repo_path.as_deref(),
        Some(expected_repo.to_str().expect("utf-8 path")),
        "whitespace repo_path must trigger auto-init"
    );

    let stored = store
        .get_project(project.id)
        .await
        .expect("project stored in DB");
    assert_eq!(stored.repo_path, project.repo_path);
}

/// Fail-closed behavior: when auto-init cannot initialize the repository (e.g. unwritable data dir),
/// create_project returns an explicit RPC error and never silently stores None.
#[tokio::test]
async fn test_greenfield_create_project_fail_closed_on_unwritable_path() {
    let temp = crate::test_util::fresh_tempdir();
    // Block the "projects" path by creating a regular file there instead of a directory
    let blocked_projects_dir = temp.path().join("projects");
    std::fs::write(&blocked_projects_dir, "blocking regular file").expect("write blocking file");

    let (state, store) = crate::tests::test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);
    let owner = owner();

    let err = rpc
        .create_project(
            &owner,
            "Unwritable Greenfield".to_string(),
            "Cannot write to blocked projects directory".to_string(),
            "en".to_string(),
            None,
            None,
            None,
        )
        .await
        .expect_err("create_project must fail closed when repo auto-init fails");

    let err_msg = err.to_string();
    assert!(
        err_msg.contains("cannot initialize repository"),
        "error message must clearly indicate auto-init failure, got: {err_msg}"
    );

    // Crucial check: verify nothing was silently stored with None in the database
    let all_projects = store.list_projects().await.expect("list_projects succeeds");
    assert!(
        all_projects.is_empty(),
        "store must remain empty; no project should be silently persisted with None"
    );
}

/// Greenfield project allows attaching a real external repository to replace the initial scratch repo.
#[tokio::test]
async fn test_greenfield_project_allows_attaching_real_repo_later() {
    let temp = crate::test_util::fresh_tempdir();
    let external_repo = tempfile::tempdir().expect("external repo dir");
    // Initialize external repo
    std::fs::write(external_repo.path().join("main.txt"), "hello").expect("write file");
    for args in [
        vec!["init", "-q"],
        vec!["config", "user.email", "dev@example.com"],
        vec!["config", "user.name", "Dev"],
        vec!["add", "."],
        vec!["commit", "-qm", "feat: initial commit"],
    ] {
        let status = std::process::Command::new("git")
            .current_dir(external_repo.path())
            .args(&args)
            .status()
            .expect("git executes");
        assert!(status.success(), "git {args:?} succeeded");
    }

    let (state, store) = crate::tests::test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);
    let owner = owner();

    // 1. Create greenfield project
    let project = rpc
        .create_project(
            &owner,
            "Upgraded Project".to_string(),
            "Started greenfield then attached real repo".to_string(),
            "en".to_string(),
            None,
            None,
            None,
        )
        .await
        .expect("create_project succeeds");

    let auto_repo = temp
        .path()
        .join("projects")
        .join(project.id.to_string())
        .join("repo");
    assert_eq!(
        project.repo_path.as_deref(),
        Some(auto_repo.to_str().expect("utf-8 path"))
    );

    // 2. Attach external repository — this must succeed because the existing repo was auto-initted
    let ext_path = external_repo.path().display().to_string();
    let attached = rpc
        .attach_project(&owner, project.id, ext_path.clone())
        .await
        .expect("attaching real repository over auto-initted scratch repo must succeed");
    assert_eq!(attached.repo_path.as_deref(), Some(ext_path.as_str()));

    let stored = store
        .get_project(project.id)
        .await
        .expect("get_project succeeds");
    assert_eq!(stored.repo_path.as_deref(), Some(ext_path.as_str()));

    // 3. Attempting a second attach to yet another repo must be refused (unless detached)
    let second_repo = tempfile::tempdir().expect("second repo dir");
    std::fs::write(second_repo.path().join("dummy.txt"), "dummy").expect("write");
    let status = std::process::Command::new("git")
        .current_dir(second_repo.path())
        .args(["init", "-q"])
        .status()
        .expect("git init");
    assert!(status.success());

    let second_path = second_repo.path().display().to_string();
    let second_err = rpc
        .attach_project(&owner, project.id, second_path)
        .await
        .expect_err("second attach must be refused");
    assert!(
        second_err
            .to_string()
            .contains("already has the repository"),
        "must refuse second attach of non-auto-initted repo: {second_err}"
    );
}
