use reqwest::Client;
use serde_json::{json, Value};
use tempfile::TempDir;
use warshad::{start_daemon, DaemonConfig, DaemonHandle, RateLimitConfig};

const OWNER: &str = "sessions-owner-token";

fn fresh_tempdir() -> TempDir {
    TempDir::new().expect("tempdir for the daemon data dir")
}

struct Daemon {
    handle: DaemonHandle,
    _dir: TempDir,
}

impl Daemon {
    async fn start() -> Self {
        std::env::set_var("WARSHA_LLM_PROVIDER", "fake");
        let dir = fresh_tempdir();
        let config = DaemonConfig {
            data_dir: dir.path().to_path_buf(),
            socket_path: dir.path().join("warshad.sock"),
            http_port: 0,
            ws_port: 0,
            auth_token: OWNER.to_string(),
            allowed_origins: vec!["http://localhost:5173".to_string()],
            allowed_commands: Vec::new(),
            rate_limits: RateLimitConfig::default(),
            ..DaemonConfig::default()
        };
        Daemon {
            handle: start_daemon(config).await.expect("the daemon starts"),
            _dir: dir,
        }
    }

    fn rpc(&self) -> u16 {
        self.handle.rpc_port()
    }

    async fn shutdown(self) {
        self.handle.shutdown().await;
    }
}

async fn rpc(port: u16, token: &str, method: &str, params: Value) -> (reqwest::StatusCode, Value) {
    let response = Client::new()
        .post(format!("http://127.0.0.1:{port}"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params,
        }))
        .send()
        .await
        .expect("the daemon answers");
    let status = response.status();
    let body = response.json::<Value>().await.unwrap_or_else(|_| json!({}));
    (status, body)
}

#[tokio::test]
async fn test_sessions_rpc_list_tail_stop() {
    let daemon = Daemon::start().await;
    let port = daemon.rpc();

    // 1. Create a project and a run
    let (_, proj_res) = rpc(
        port,
        OWNER,
        "projects.create",
        json!(["Sessions Test Proj", "Sessions Test", "en"]),
    )
    .await;
    let project_id = proj_res["result"]["id"].as_str().expect("project id");

    let (_, run_res) = rpc(
        port,
        OWNER,
        "runs.start",
        json!([project_id, "Test run prompt"]),
    )
    .await;
    let run_id = run_res["result"]["id"].as_str().expect("run id");

    // 2. Query sessions.list for this run
    let (status, list_res) = rpc(port, OWNER, "sessions.list", json!({ "run_id": run_id })).await;
    assert_eq!(status, reqwest::StatusCode::OK);
    assert!(list_res.get("result").is_some(), "result: {list_res}");
    let sessions_list = list_res["result"].as_array().expect("array of sessions");
    // At this point, native Builtin sessions or whatever stage has run
    println!("Found {} sessions for run {run_id}", sessions_list.len());

    // 3. Test sessions.tail for an arbitrary session id
    let dummy_session_id = ulid::Ulid::new().to_string();
    let (status, tail_res) = rpc(
        port,
        OWNER,
        "sessions.tail",
        json!({ "session_id": dummy_session_id }),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK);
    assert!(tail_res.get("result").is_some());
    println!("tail_res: {tail_res}");
    let lines = tail_res["result"].as_array().expect("lines array");
    assert!(lines.is_empty());

    // 4. Test sessions.stop for a non-running / unknown session id
    let (status, stop_res) = rpc(
        port,
        OWNER,
        "sessions.stop",
        json!({ "session_id": dummy_session_id }),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK);
    println!("stop_res: {stop_res}");
    assert!(stop_res.get("result").is_some() || stop_res.get("error").is_some());

    daemon.shutdown().await;
}
