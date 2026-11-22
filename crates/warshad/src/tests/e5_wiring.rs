#![allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]

use super::*;
use std::process::Command;

fn owner() -> RpcExtensions {
    let mut ext = RpcExtensions::new();
    ext.insert(Actor::owner(DeviceId::new()));
    ext
}

fn code(error: &jsonrpsee::types::ErrorObjectOwned) -> i32 {
    error.code()
}

fn project(repo_path: Option<String>) -> Project {
    Project {
        id: ProjectId::new(),
        name: "Evidence Project".to_string(),
        description: "Test".to_string(),
        language: "en".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        repo_path,
        repo_url: None,
        ..Default::default()
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

async fn start(store: &Store, rpc: &WarshaRpc, project: &Project, gate_c: bool) -> Run {
    let run = rpc
        .start_run(
            &owner(),
            project.id,
            "Build a todo app".to_string(),
            None,
            None,
        )
        .await
        .expect("the run starts");
    if gate_c {
        let mut stored = store.get_run(run.id).await.expect("the run");
        stored.current_stage = Stage::GateC;
        store.update_run(&stored).await.expect("the stage moves");
    }
    run
}

#[tokio::test]
async fn evidence_carries_the_diff_and_the_policy_checked_test() {
    let temp = crate::test_util::fresh_tempdir();
    let repo = tempfile::tempdir().expect("a repo");
    git_repo(repo.path());
    let (state, store) = crate::tests::test_state(temp.path()).await;
    let project = project(Some(repo.path().display().to_string()));
    store.create_project(&project).await.expect("the project");
    let rpc = WarshaRpc::new(state);
    let run = start(&store, &rpc, &project, true).await;
    let worktree = rpc
        .run_worktree(&owner(), run.id)
        .await
        .expect("reported")
        .expect("a worktree");
    std::fs::write(worktree.path.join("base.txt"), "changed").expect("change");
    std::fs::write(worktree.path.join("made.txt"), "made").expect("create");

    let evidence = rpc
        .gate_evidence(
            &owner(),
            run.id,
            "git".to_string(),
            vec!["--version".to_string()],
        )
        .await
        .expect("the evidence is collected");

    assert!(evidence.diff.contains("base.txt"), "{}", evidence.diff);
    assert!(
        evidence.files_changed.iter().any(|path| path == "made.txt"),
        "{:?}",
        evidence.files_changed
    );
    assert!(evidence.tests.success);
    assert!(
        evidence.tests.stdout.contains("git version"),
        "{}",
        evidence.tests.stdout
    );
}

#[tokio::test]
async fn a_shell_program_is_refused_by_policy() {
    let temp = crate::test_util::fresh_tempdir();
    let repo = tempfile::tempdir().expect("a repo");
    git_repo(repo.path());
    let (state, store) = crate::tests::test_state(temp.path()).await;
    let project = project(Some(repo.path().display().to_string()));
    store.create_project(&project).await.expect("the project");
    let rpc = WarshaRpc::new(state);
    let run = start(&store, &rpc, &project, true).await;

    let error = rpc
        .gate_evidence(
            &owner(),
            run.id,
            "sh".to_string(),
            vec!["-c".to_string(), "true".to_string()],
        )
        .await
        .expect_err("a shell is refused by the command policy");
    assert_eq!(code(&error), auth::rpc_codes::POLICY_REFUSED);
}

#[tokio::test]
async fn evidence_needs_gate_c_and_a_worktree() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = crate::tests::test_state(temp.path()).await;
    let project = project(None);
    store.create_project(&project).await.expect("the project");
    let rpc = WarshaRpc::new(state);

    let not_gate_c = start(&store, &rpc, &project, false).await;
    let error = rpc
        .gate_evidence(
            &owner(),
            not_gate_c.id,
            "git".to_string(),
            vec!["--version".to_string()],
        )
        .await
        .expect_err("a run outside Gate C has no evidence");
    assert!(error.to_string().contains("Gate C"), "{error}");

    let gate_c = start(&store, &rpc, &project, true).await;
    let error = rpc
        .gate_evidence(
            &owner(),
            gate_c.id,
            "git".to_string(),
            vec!["--version".to_string()],
        )
        .await
        .expect_err("a run without a worktree has no evidence");
    assert!(error.to_string().contains("no worktree"), "{error}");
}

/// The address `tests::preview_probe` prints. That fixture constant is private
/// to the `tests` module, so the same value is spelled here.
const PROBE_URL: &str = "http://127.0.0.1:5199/";

/// The command line that starts one `tests::preview_probe` dev server — the
/// same probe the preview RPC tests run, named from this module.
fn preview_probe_line() -> String {
    let exe = std::env::current_exe().expect("the test binary names itself");
    format!(
        "{} --exact tests::preview_probe --ignored --nocapture",
        exe.display()
    )
}

/// A state whose process policy admits the probe as a preview and `git` as the
/// Gate C test program.
async fn state_that_admits_the_preview(
    data_dir: &std::path::Path,
    command: &str,
) -> (Arc<DaemonState>, Arc<Store>) {
    let program = command
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_string();
    crate::tests::test_state_with_seams(
        data_dir,
        move |config| config.allowed_commands = vec!["git".to_string(), program],
        None,
        None,
        None,
    )
    .await
}

/// The preview joins the diff and the tests: a dev server the owner already runs
/// for the run's project is recorded, with the URL it printed.
#[tokio::test]
async fn evidence_carries_the_url_of_a_running_preview() {
    let temp = crate::test_util::fresh_tempdir();
    let repo = tempfile::tempdir().expect("a repo");
    git_repo(repo.path());
    let command = preview_probe_line();
    let (state, store) = state_that_admits_the_preview(temp.path(), &command).await;
    let project = project(Some(repo.path().display().to_string()));
    store.create_project(&project).await.expect("the project");
    let rpc = WarshaRpc::new(state);
    let run = start(&store, &rpc, &project, true).await;

    // The preview the panel starts: one per project, started before evidence.
    let started = rpc
        .start_preview(&owner(), project.id.to_string(), command)
        .await
        .expect("the preview starts");
    assert_eq!(started.url.as_deref(), Some(PROBE_URL));

    let evidence = rpc
        .gate_evidence(
            &owner(),
            run.id,
            "git".to_string(),
            vec!["--version".to_string()],
        )
        .await
        .expect("the evidence is collected");

    let preview = evidence
        .preview
        .expect("the running preview is part of the evidence");
    assert_eq!(preview.url.as_deref(), Some(PROBE_URL));
    assert_eq!(preview.status, ProcessStatus::Running);
    assert_eq!(preview.project_id, project.id.to_string());
    assert_eq!(preview.process_id, started.process_id);

    // Read-only: the evidence reported the preview that was already running.
    let after = rpc
        .preview_status(&owner(), project.id.to_string())
        .await
        .expect("the preview is still tracked");
    assert_eq!(after.process_id, started.process_id);
    assert_eq!(after.status, ProcessStatus::Running);

    rpc.stop_preview(&owner(), project.id.to_string())
        .await
        .expect("the preview stops");
}

/// No preview is an explicit `None` in the evidence, not an error and not a
/// field that disappears from the response.
#[tokio::test]
async fn evidence_without_a_preview_carries_an_explicit_none() {
    let temp = crate::test_util::fresh_tempdir();
    let repo = tempfile::tempdir().expect("a repo");
    git_repo(repo.path());
    let (state, store) = crate::tests::test_state(temp.path()).await;
    let project = project(Some(repo.path().display().to_string()));
    store.create_project(&project).await.expect("the project");
    let rpc = WarshaRpc::new(state);
    let run = start(&store, &rpc, &project, true).await;

    let evidence = rpc
        .gate_evidence(
            &owner(),
            run.id,
            "git".to_string(),
            vec!["--version".to_string()],
        )
        .await
        .expect("a run with no preview still has Gate C evidence");

    assert!(
        evidence.preview.is_none(),
        "a preview appeared without one being started"
    );
    let value = serde_json::to_value(&evidence).expect("the evidence serialises");
    assert!(
        value.get("preview").is_some_and(serde_json::Value::is_null),
        "an absent preview must be an explicit null: {value}"
    );
}

/// The read-only pin: collecting evidence never starts a dev server.
#[tokio::test]
async fn evidence_collection_never_starts_a_preview() {
    let temp = crate::test_util::fresh_tempdir();
    let repo = tempfile::tempdir().expect("a repo");
    git_repo(repo.path());
    let (state, store) = crate::tests::test_state(temp.path()).await;
    let project = project(Some(repo.path().display().to_string()));
    store.create_project(&project).await.expect("the project");
    let rpc = WarshaRpc::new(state.clone());
    let run = start(&store, &rpc, &project, true).await;

    rpc.gate_evidence(
        &owner(),
        run.id,
        "git".to_string(),
        vec!["--version".to_string()],
    )
    .await
    .expect("the evidence is collected");

    // The manager is the state the pin reads: the project was never started, and
    // it is still not started after the evidence was collected.
    let previews = state.previews.list().await;
    assert!(
        previews.is_empty(),
        "evidence collection started a preview: {previews:?}"
    );
    assert!(
        state
            .previews
            .status(&project.id.to_string(), Some(&run.id.0.to_string()))
            .await
            .is_err(),
        "evidence collection registered a preview for the run's project"
    );
}
