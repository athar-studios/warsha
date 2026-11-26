use super::*;
use axum::extract::State as AxumState;
use axum::http::HeaderMap;
use axum::routing::post;
use axum::{Json, Router};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use warsha_core::IntegrationConfig;

fn run_git_sync(args: &[&str]) {
    let out = Command::new("git").args(args).output().expect("spawn git");
    assert!(
        out.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&out.stderr)
    );
}

fn init_bare_repo_with_commit(root: &Path, name: &str) -> std::path::PathBuf {
    let bare = root.join(format!("{name}.git"));
    run_git_sync(&["init", "--bare", "-q", &bare.to_string_lossy()]);

    let seed = root.join(format!("{name}-seed"));
    run_git_sync(&[
        "clone",
        "-q",
        &bare.to_string_lossy(),
        &seed.to_string_lossy(),
    ]);
    run_git_sync(&[
        "-C",
        &seed.to_string_lossy(),
        "config",
        "user.name",
        "Warsha Test",
    ]);
    run_git_sync(&[
        "-C",
        &seed.to_string_lossy(),
        "config",
        "user.email",
        "test@warsha.local",
    ]);
    std::fs::write(seed.join("README.md"), format!("# {name}\n")).expect("write readme");
    run_git_sync(&["-C", &seed.to_string_lossy(), "add", "README.md"]);
    run_git_sync(&["-C", &seed.to_string_lossy(), "commit", "-qm", "seed"]);
    run_git_sync(&[
        "-C",
        &seed.to_string_lossy(),
        "push",
        "-q",
        "origin",
        "HEAD",
    ]);
    bare
}

#[tokio::test]
async fn prepare_folder_rpc_creates_git_repo_and_creates_project() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);
    let owner = owner_ext();

    let parent_dir = temp.path().join("workspace-parent");
    std::fs::create_dir_all(&parent_dir).expect("parent dir");

    let prepared = rpc
        .prepare_project_folder(
            &owner,
            parent_dir.to_string_lossy().to_string(),
            "my-new-app".to_string(),
        )
        .await
        .expect("prepare_folder succeeds");

    let expected_path = parent_dir.join("my-new-app");
    assert_eq!(PathBuf::from(&prepared.repo_path), expected_path);
    assert!(expected_path.join(".git").exists());

    let project = rpc
        .create_project(
            &owner,
            "My New App".to_string(),
            "Prepared via folder option".to_string(),
            "en".to_string(),
            None,
            None,
            Some(prepared.repo_path.clone()),
            None,
        )
        .await
        .expect("create_project succeeds");

    assert_eq!(
        project.repo_path.as_deref(),
        Some(prepared.repo_path.as_str())
    );
    assert_eq!(project.repo_url, None);

    let fetched = store.get_project(project.id).await.expect("stored project");
    assert_eq!(
        fetched.repo_path.as_deref(),
        Some(prepared.repo_path.as_str())
    );
    assert_eq!(fetched.repo_url, None);
}

#[tokio::test]
async fn clone_repo_rpc_clones_local_bare_repo_and_persists_repo_url() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);
    let owner = owner_ext();

    let bare = init_bare_repo_with_commit(temp.path(), "sample-repo");
    let clone_parent = temp.path().join("cloned-parent");
    std::fs::create_dir_all(&clone_parent).expect("clone parent");

    let cloned = rpc
        .clone_project_repo(
            &owner,
            bare.to_string_lossy().to_string(),
            Some(clone_parent.to_string_lossy().to_string()),
            Some("custom-checkout".to_string()),
        )
        .await
        .expect("clone_repo succeeds");

    let expected_path = clone_parent.join("custom-checkout");
    assert_eq!(PathBuf::from(&cloned.repo_path), expected_path);
    assert!(expected_path.join(".git").exists());
    assert!(expected_path.join("README.md").exists());

    let canonical_url = cloned
        .repo_url
        .clone()
        .unwrap_or_else(|| bare.to_string_lossy().to_string());
    let project = rpc
        .create_project(
            &owner,
            "Cloned App".to_string(),
            "Cloned from local bare repo".to_string(),
            "en".to_string(),
            None,
            None,
            Some(cloned.repo_path.clone()),
            Some(canonical_url.clone()),
        )
        .await
        .expect("create_project succeeds");

    assert_eq!(
        project.repo_path.as_deref(),
        Some(cloned.repo_path.as_str())
    );
    assert_eq!(project.repo_url.as_deref(), Some(canonical_url.as_str()));

    let loaded = rpc
        .get_project(&owner, project.id)
        .await
        .expect("projects.get succeeds");
    assert_eq!(loaded.repo_url.as_deref(), Some(canonical_url.as_str()));
    let stored = store.get_project(project.id).await.expect("stored");
    assert_eq!(stored.repo_url.as_deref(), Some(canonical_url.as_str()));
}

#[derive(Clone)]
struct MockGitHubState {
    clone_url: String,
    captured: Arc<Mutex<Vec<(String, serde_json::Value)>>>,
}

#[tokio::test]
async fn create_github_repo_rpc_uses_integration_token_and_mock_server() {
    let temp = crate::test_util::fresh_tempdir();
    let bare = temp.path().join("remote-empty.git");
    run_git_sync(&["init", "--bare", "-q", &bare.to_string_lossy()]);

    let captured = Arc::new(Mutex::new(Vec::new()));
    let mock_state = MockGitHubState {
        clone_url: bare.to_string_lossy().to_string(),
        captured: captured.clone(),
    };

    let app = Router::new()
        .route(
            "/user/repos",
            post(
                |AxumState(st): AxumState<MockGitHubState>,
                 headers: HeaderMap,
                 Json(body): Json<serde_json::Value>| async move {
                    let auth = headers
                        .get("authorization")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("")
                        .to_string();
                    st.captured.lock().expect("lock").push((auth, body.clone()));
                    let name = body
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("repo")
                        .to_string();
                    Json(serde_json::json!({
                        "id": 42,
                        "name": name,
                        "full_name": format!("octo/{name}"),
                        "description": body.get("description").cloned().unwrap_or(serde_json::Value::Null),
                        "private": body.get("private").cloned().unwrap_or(serde_json::Value::Bool(false)),
                        "html_url": format!("https://github.com/octo/{name}"),
                        "clone_url": st.clone_url,
                        "default_branch": "main"
                    }))
                },
            ),
        )
        .with_state(mock_state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind mock github");
    let addr = listener.local_addr().expect("local addr");
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    let base_url = format!("http://{addr}");
    let (state, _store) = test_state_with(temp.path(), |cfg| {
        cfg.github_api_base = Some(base_url);
    })
    .await;
    let rpc = WarshaRpc::new(state);
    let owner = owner_ext();

    // Token stored via Settings -> Integrations RPC.
    rpc.connect_integration(
        &owner,
        "github".to_string(),
        IntegrationConfig {
            token: Some("ghp_test_integration_secret".to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("integrations.connect succeeds");

    let status = rpc
        .project_github_status(&owner)
        .await
        .expect("github_status succeeds");
    assert!(status.configured);
    assert_eq!(status.source.as_deref(), Some("integrations"));

    let parent_dir = temp.path().join("gh-projects");
    std::fs::create_dir_all(&parent_dir).expect("gh parent");

    let created = rpc
        .create_github_repo(
            &owner,
            "warsha-demo".to_string(),
            Some("Created via mock GitHub".to_string()),
            Some(parent_dir.to_string_lossy().to_string()),
            None,
        )
        .await
        .expect("create_github_repo succeeds");

    assert_eq!(created.full_name, "octo/warsha-demo");
    assert_eq!(created.html_url, "https://github.com/octo/warsha-demo");
    assert_eq!(created.repo_url, bare.to_string_lossy());
    let local_path = PathBuf::from(&created.repo_path);
    assert_eq!(local_path, parent_dir.join("warsha-demo"));
    assert!(local_path.join(".git").exists());
    // Empty bare repo cloned locally gets an initial HEAD commit so worktrees work.
    let head = Command::new("git")
        .args(["-C", &created.repo_path, "rev-parse", "--verify", "HEAD"])
        .output()
        .expect("rev-parse HEAD");
    assert!(head.status.success(), "cloned empty repo must have HEAD");

    {
        let reqs = captured.lock().expect("lock");
        assert_eq!(reqs.len(), 1);
        assert_eq!(reqs[0].0, "Bearer ghp_test_integration_secret");
        assert_eq!(
            reqs[0].1.get("name").and_then(|v| v.as_str()),
            Some("warsha-demo")
        );
        assert_eq!(
            reqs[0].1.get("description").and_then(|v| v.as_str()),
            Some("Created via mock GitHub")
        );
        // Null/absent `private_repo` means PRIVATE: the request body always
        // carries `"private": true` by default.
        assert_eq!(
            reqs[0].1.get("private").and_then(|v| v.as_bool()),
            Some(true)
        );
    }

    // An explicit `private_repo: false` opts into a public repository.
    let created_public = rpc
        .create_github_repo(
            &owner,
            "warsha-public".to_string(),
            None,
            Some(parent_dir.to_string_lossy().to_string()),
            Some(false),
        )
        .await
        .expect("public create_github_repo succeeds");
    assert_eq!(created_public.full_name, "octo/warsha-public");
    let reqs = captured.lock().expect("lock");
    assert_eq!(reqs.len(), 2);
    assert_eq!(
        reqs[1].1.get("private").and_then(|v| v.as_bool()),
        Some(false)
    );

    server.abort();
}

#[tokio::test]
async fn github_status_unconfigured_and_create_github_repo_refuses() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);
    let owner = owner_ext();

    let status = rpc
        .project_github_status(&owner)
        .await
        .expect("github_status succeeds");
    assert!(!status.configured);
    assert_eq!(status.source, None);

    let err = rpc
        .create_github_repo(&owner, "blocked-repo".to_string(), None, None, None)
        .await
        .expect_err("create_github_repo must refuse without token");
    assert!(
        err.message()
            .contains("GitHub token is not configured. Configure one in Settings -> Integrations."),
        "unexpected refusal message: {}",
        err.message()
    );
}

fn head_sha_sync(dir: &Path) -> String {
    let out = Command::new("git")
        .args(["-C", &dir.to_string_lossy(), "rev-parse", "HEAD"])
        .output()
        .expect("rev-parse HEAD");
    assert!(out.status.success());
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// B-1 acceptance: a plain non-git folder goes probe -> prepare -> create.
///
/// `projects.repo_status` reports `{exists: true, is_repo: false,
/// has_head: false}`; `projects.prepare_existing_folder` returns the path
/// unchanged; `projects.create` with that `repo_path` then succeeds (today it
/// fails with "not a git repository").
#[tokio::test]
async fn existing_folder_probe_prepare_then_create_succeeds() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);
    let owner = owner_ext();

    let plain = temp.path().join("my-existing-app");
    std::fs::create_dir_all(&plain).expect("plain dir");
    std::fs::write(plain.join("main.py"), "print('hello')\n").expect("write main");

    let status = rpc
        .project_repo_status(
            &owner,
            Some(plain.to_string_lossy().to_string()),
            None,
            None,
        )
        .await
        .expect("repo_status succeeds");
    assert!(status.exists);
    assert!(!status.is_repo);
    assert!(!status.has_head);

    let prepared = rpc
        .prepare_existing_folder(&owner, plain.to_string_lossy().to_string())
        .await
        .expect("prepare_existing_folder succeeds");
    assert_eq!(PathBuf::from(&prepared.repo_path), plain);
    assert!(plain.join(".git").exists());
    assert_eq!(
        std::fs::read_to_string(plain.join("main.py")).expect("read main"),
        "print('hello')\n"
    );

    let project = rpc
        .create_project(
            &owner,
            "Existing App".to_string(),
            "Imported from an existing folder".to_string(),
            "en".to_string(),
            None,
            None,
            Some(prepared.repo_path.clone()),
            None,
        )
        .await
        .expect("create_project with a prepared existing folder succeeds");
    assert_eq!(
        project.repo_path.as_deref(),
        Some(prepared.repo_path.as_str())
    );
}

/// `projects.repo_status` on a git repo with HEAD, a missing path, and the
/// parent_dir+name form (including the `../evil` refusal).
#[tokio::test]
async fn repo_status_probe_forms() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);
    let owner = owner_ext();

    // A git repo with HEAD: true/true/true.
    let ready = temp.path().join("ready-probe");
    std::fs::create_dir_all(&ready).expect("ready dir");
    run_git_sync(&["init", "-q", &ready.to_string_lossy()]);
    run_git_sync(&[
        "-C",
        &ready.to_string_lossy(),
        "config",
        "user.email",
        "t@t",
    ]);
    run_git_sync(&["-C", &ready.to_string_lossy(), "config", "user.name", "T"]);
    std::fs::write(ready.join("a.txt"), "a").expect("write a");
    run_git_sync(&["-C", &ready.to_string_lossy(), "add", "a.txt"]);
    run_git_sync(&["-C", &ready.to_string_lossy(), "commit", "-qm", "seed"]);

    let status = rpc
        .project_repo_status(
            &owner,
            Some(ready.to_string_lossy().to_string()),
            None,
            None,
        )
        .await
        .expect("repo_status on ready repo succeeds");
    assert!(status.exists);
    assert!(status.is_repo);
    assert!(status.has_head);

    // A missing path: exists=false.
    let missing = rpc
        .project_repo_status(
            &owner,
            Some(
                temp.path()
                    .join("no-such-dir")
                    .to_string_lossy()
                    .to_string(),
            ),
            None,
            None,
        )
        .await
        .expect("repo_status on missing path succeeds");
    assert!(!missing.exists);
    assert!(!missing.is_repo);
    assert!(!missing.has_head);

    // parent_dir+name with an existing prepared folder: true/true/true.
    let parent = temp.path().join("probe-parent");
    std::fs::create_dir_all(&parent).expect("probe parent");
    let prepared = rpc
        .prepare_project_folder(
            &owner,
            parent.to_string_lossy().to_string(),
            "probed-app".to_string(),
        )
        .await
        .expect("prepare_folder succeeds");
    let via_parent = rpc
        .project_repo_status(
            &owner,
            None,
            Some(parent.to_string_lossy().to_string()),
            Some("probed-app".to_string()),
        )
        .await
        .expect("repo_status parent_dir+name succeeds");
    assert!(via_parent.exists);
    assert!(via_parent.is_repo);
    assert!(via_parent.has_head);
    assert_eq!(
        PathBuf::from(&prepared.repo_path),
        parent.join("probed-app")
    );

    // `../evil` as a name is refused with -32602.
    let evil = rpc
        .project_repo_status(
            &owner,
            None,
            Some(parent.to_string_lossy().to_string()),
            Some("../evil".to_string()),
        )
        .await
        .expect_err("evil name must be refused");
    assert_eq!(super::rpc_error_code(&evil), -32602);
}

/// `prepare_existing_folder` on an already-initialized repo returns the path
/// with the HEAD commit unchanged.
#[tokio::test]
async fn prepare_existing_folder_rpc_leaves_initialized_repo_untouched() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);
    let owner = owner_ext();

    let ready = temp.path().join("untouched-app");
    std::fs::create_dir_all(&ready).expect("ready dir");
    run_git_sync(&["init", "-q", &ready.to_string_lossy()]);
    run_git_sync(&[
        "-C",
        &ready.to_string_lossy(),
        "config",
        "user.email",
        "t@t",
    ]);
    run_git_sync(&["-C", &ready.to_string_lossy(), "config", "user.name", "T"]);
    std::fs::write(ready.join("b.txt"), "b").expect("write b");
    run_git_sync(&["-C", &ready.to_string_lossy(), "add", "b.txt"]);
    run_git_sync(&["-C", &ready.to_string_lossy(), "commit", "-qm", "seed"]);
    let sha_before = head_sha_sync(&ready);

    let prepared = rpc
        .prepare_existing_folder(&owner, ready.to_string_lossy().to_string())
        .await
        .expect("prepare_existing_folder on ready repo succeeds");
    assert_eq!(PathBuf::from(&prepared.repo_path), ready);
    assert_eq!(head_sha_sync(&ready), sha_before);
    assert!(!ready.join("README.md").exists());
}
