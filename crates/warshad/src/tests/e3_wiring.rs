use super::*;
use std::process::Command;

fn owner() -> RpcExtensions {
    let mut ext = RpcExtensions::new();
    ext.insert(Actor::owner(DeviceId::new()));
    ext
}

fn project(repo_path: Option<String>) -> Project {
    Project {
        id: ProjectId::new(),
        name: "Worktree Project".to_string(),
        description: "Test".to_string(),
        language: "en".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        repo_path,
        repo_url: None,
    }
}

fn git_repo(dir: &std::path::Path) {
    std::fs::write(dir.join("base.txt"), "base").expect("a base file");
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

#[tokio::test]
async fn a_repository_backed_run_gets_its_own_worktree() {
    let temp = crate::test_util::fresh_tempdir();
    let repo = tempfile::tempdir().expect("a repo dir");
    git_repo(repo.path());
    let (state, store) = crate::tests::test_state(temp.path()).await;
    let project = project(Some(repo.path().display().to_string()));
    store.create_project(&project).await.expect("the project");
    let rpc = WarshaRpc::new(state);

    let run = rpc
        .start_run(&owner(), project.id, "Build a todo app".to_string())
        .await
        .expect("the run starts");
    let worktree = rpc
        .run_worktree(&owner(), run.id)
        .await
        .expect("the worktree is reported")
        .expect("the run has a worktree");

    assert!(worktree.path.exists());
    let check = Command::new("git")
        .arg("-C")
        .arg(&worktree.path)
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .expect("git runs");
    assert!(check.status.success());
    assert_eq!(String::from_utf8_lossy(&check.stdout).trim(), "true");
}

#[tokio::test]
async fn an_unusable_repository_cancels_the_run() {
    let temp = crate::test_util::fresh_tempdir();
    let plain = tempfile::tempdir().expect("a plain dir");
    let (state, store) = crate::tests::test_state(temp.path()).await;
    let project = project(Some(plain.path().display().to_string()));
    store.create_project(&project).await.expect("the project");
    let rpc = WarshaRpc::new(state);

    let error = rpc
        .start_run(&owner(), project.id, "Build a todo app".to_string())
        .await
        .expect_err("a non-repository is refused");
    assert!(error.to_string().contains("worktree"), "{error}");
    let runs = store.list_runs(project.id).await.expect("the runs list");
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].status, RunStatus::Cancelled);
}

// ---- P-E3: `projects.attach`.
//
// Before this RPC a project's repository could only be named at
// `projects.create` time, so a project created without one was stranded: no
// later operation could give it a checkout, and `runs.start`'s worktree path
// never ran for it. These tests are the three claims the RPC has to hold — the
// repository lands on the row, an unusable path is refused and changes nothing,
// and a project that already has one is not silently moved.

#[tokio::test]
async fn attaching_an_existing_repository_records_it_on_the_project() {
    let temp = crate::test_util::fresh_tempdir();
    let repo = tempfile::tempdir().expect("a repo dir");
    git_repo(repo.path());
    let (state, store) = crate::tests::test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);

    // The shape `projects.create` always makes: no repository.
    let project = rpc
        .create_project(
            &owner(),
            "Attach Project".to_string(),
            "Test".to_string(),
            "en".to_string(),
        )
        .await
        .expect("the project is created");
    assert_eq!(project.repo_path, None);

    let path = repo.path().display().to_string();
    let attached = rpc
        .attach_project(&owner(), project.id, path.clone())
        .await
        .expect("the repository attaches");
    assert_eq!(attached.repo_path.as_deref(), Some(path.as_str()));

    // The response is not the claim: the row carries the path, both through the
    // read RPC and through the store a later `runs.start` reads it from.
    let read_back = rpc
        .get_project(&owner(), project.id)
        .await
        .expect("the project reads back");
    assert_eq!(read_back.repo_path.as_deref(), Some(path.as_str()));
    let stored = store
        .get_project(project.id)
        .await
        .expect("the project row");
    assert_eq!(stored.repo_path.as_deref(), Some(path.as_str()));
}

#[tokio::test]
async fn attaching_a_path_that_is_not_a_repository_is_refused_and_changes_nothing() {
    let temp = crate::test_util::fresh_tempdir();
    let plain = tempfile::tempdir().expect("a plain dir");
    let missing = temp.path().join("no-such-repository");
    let (state, store) = crate::tests::test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);
    let project = rpc
        .create_project(
            &owner(),
            "Attach Project".to_string(),
            "Test".to_string(),
            "en".to_string(),
        )
        .await
        .expect("the project is created");

    // A real directory that is not a git repository, and a path that is not there
    // at all. Neither may attach, and neither may leave the row touched.
    for path in [
        plain.path().display().to_string(),
        missing.display().to_string(),
    ] {
        let error = rpc
            .attach_project(&owner(), project.id, path.clone())
            .await
            .expect_err("an unusable path is refused");
        assert!(
            error.to_string().contains(&path),
            "the error names the refused path `{path}`: {error}"
        );
        let stored = store
            .get_project(project.id)
            .await
            .expect("the project row");
        assert_eq!(
            stored.repo_path, None,
            "a refused attach half-attached {path}"
        );
        assert_eq!(
            stored.updated_at, project.updated_at,
            "a refused attach touched the project row"
        );
    }
}

#[tokio::test]
async fn a_project_that_already_has_a_repository_refuses_a_second_attach() {
    let temp = crate::test_util::fresh_tempdir();
    let first = tempfile::tempdir().expect("a first repo");
    git_repo(first.path());
    let second = tempfile::tempdir().expect("a second repo");
    git_repo(second.path());
    let (state, store) = crate::tests::test_state(temp.path()).await;
    let project = project(Some(first.path().display().to_string()));
    store.create_project(&project).await.expect("the project");
    let rpc = WarshaRpc::new(state);

    let error = rpc
        .attach_project(&owner(), project.id, second.path().display().to_string())
        .await
        .expect_err("a project with a repository refuses a second one");
    assert!(
        error.to_string().contains("already has the repository"),
        "the refusal says the project is already attached: {error}"
    );

    let stored = store
        .get_project(project.id)
        .await
        .expect("the project row");
    assert_eq!(
        stored.repo_path, project.repo_path,
        "the existing repository was overwritten"
    );
}
