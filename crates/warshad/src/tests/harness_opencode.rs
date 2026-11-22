#![allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]

use super::*;
use std::process::Command;

fn owner() -> RpcExtensions {
    let mut ext = RpcExtensions::new();
    ext.insert(Actor::owner(DeviceId::new()));
    ext
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

/// (a) list backends returns opencode entry with installed flag type-correct
#[tokio::test]
async fn test_list_backends_returns_opencode_entry() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = crate::tests::test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);
    let owner = owner();

    let backends = rpc
        .list_coding_backends(&owner)
        .await
        .expect("coding_backends.list succeeds");

    let opencode = backends
        .iter()
        .find(|b| b.name == "opencode")
        .expect("opencode backend must be present in catalog");
    assert_eq!(opencode.name, "opencode");
    assert_eq!(opencode.display_name, "OpenCode");
    assert_eq!(opencode.command, "opencode");
    // boolean flag type-correct
    let _installed: bool = opencode.installed;
}

/// (b) set/get routing round-trip persists
#[tokio::test]
async fn test_set_get_backend_routing_round_trip_persists() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = crate::tests::test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);
    let owner = owner();

    let mut role_backends = std::collections::HashMap::new();
    role_backends.insert("coder".to_string(), "opencode".to_string());

    let mut project_backends = std::collections::HashMap::new();
    let proj_id = ProjectId::new();
    project_backends.insert(proj_id.0.to_string(), "claude-code".to_string());

    let saved = rpc
        .set_backend_routing(
            &owner,
            Some("opencode".to_string()),
            Some(role_backends.clone()),
            Some(project_backends.clone()),
        )
        .await
        .expect("backend_routing.set succeeds");

    assert_eq!(saved.default_backend.as_deref(), Some("opencode"));
    assert_eq!(saved.role_backends, role_backends);
    assert_eq!(saved.project_backends, project_backends);

    // Read back via get_backend_routing
    let read_back = rpc
        .get_backend_routing(&owner)
        .await
        .expect("backend_routing.get succeeds");
    assert_eq!(read_back.default_backend.as_deref(), Some("opencode"));
    assert_eq!(read_back.role_backends, role_backends);
    assert_eq!(read_back.project_backends, project_backends);
}

/// (c) create_project with repo_path then start_run yields non-null runs.worktree
#[tokio::test]
async fn test_create_project_with_repo_path_then_start_run_yields_worktree() {
    let temp = crate::test_util::fresh_tempdir();
    let repo = tempfile::tempdir().expect("a repo dir");
    git_repo(repo.path());
    let (state, _store) = crate::tests::test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);
    let owner = owner();
    let repo_path = repo.path().display().to_string();

    let project = rpc
        .create_project(
            &owner,
            "Plumbed Project".to_string(),
            "Testing repo_path in create_project".to_string(),
            "en".to_string(),
            None,
            None,
            Some(repo_path.clone()),
        )
        .await
        .expect("project created with repo_path");
    assert_eq!(project.repo_path.as_deref(), Some(repo_path.as_str()));

    let run = rpc
        .start_run(
            &owner,
            project.id,
            "Build something".to_string(),
            None,
            None,
            None,
        )
        .await
        .expect("run starts");

    let worktree = rpc
        .run_worktree(&owner, run.id)
        .await
        .expect("worktree rpc succeeds");
    assert!(
        worktree.is_some(),
        "runs.worktree must yield non-null worktree"
    );
    let wt = worktree.unwrap();
    assert!(!wt.path.is_empty());
    assert!(!wt.base.is_empty());
}

/// (d) Code stage / start_run with unknown backend name errors fail-loud (no silent native fallback)
#[tokio::test]
async fn test_unknown_backend_routing_errors_fail_loud() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = crate::tests::test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);
    let owner = owner();

    let project = rpc
        .create_project(
            &owner,
            "Fail Loud Project".to_string(),
            "Testing fail-loud on unknown backend".to_string(),
            "en".to_string(),
            None,
            None,
            None,
        )
        .await
        .expect("project created");

    // Set unknown backend name
    rpc.set_backend_routing(
        &owner,
        Some("ghost-coding-engine-does-not-exist".to_string()),
        None,
        None,
    )
    .await
    .expect("backend routing set");

    let err = rpc
        .start_run(
            &owner,
            project.id,
            "Build with ghost backend".to_string(),
            None,
            None,
            None,
        )
        .await
        .expect_err("start_run must fail loud when configured backend is unknown");

    assert!(
        err.message().contains("ghost-coding-engine-does-not-exist")
            && err.message().contains("refusing to fall back"),
        "error must name unknown backend and refuse fallback: {}",
        err.message()
    );
}

/// (e) test coding_backends.test returns diagnostics
#[tokio::test]
async fn test_test_coding_backend_diagnostics() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = crate::tests::test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);
    let owner = owner();

    // Testing a known backend (e.g. opencode)
    let diag = rpc
        .test_coding_backend(&owner, "opencode".to_string())
        .await
        .expect("coding_backends.test succeeds for opencode");
    assert_eq!(diag.name, "opencode");
    assert_eq!(diag.command, "opencode");

    // Testing an unknown backend fails with invalid params (-32602)
    let err = rpc
        .test_coding_backend(&owner, "nonexistent-backend".to_string())
        .await
        .unwrap_err();
    assert!(err.to_string().contains("unknown coding backend"));
}
