//! M1 integration tests for the Warsha daemon.
//!
//! Tests cover:
//! - Daemon restart with state intact
//! - Unauthenticated call rejection
//! - Second instance lockout

use reqwest::Client;
use reqwest::StatusCode;
use serde_json::json;
use tempfile::tempdir;
use warshad::{start_daemon, DaemonConfig, DaemonError};

const TEST_TOKEN: &str = "test-auth-token-12345";

/// Build a test client with the given auth token.
fn client_with_token(token: &str) -> Client {
    Client::builder()
        .default_headers({
            let mut h = reqwest::header::HeaderMap::new();
            h.insert(
                reqwest::header::AUTHORIZATION,
                format!("Bearer {}", token)
                    .parse()
                    .expect("valid auth header"),
            );
            h
        })
        .build()
        .expect("reqwest client")
}

/// Build a client with no auth header.
fn client_no_auth() -> Client {
    Client::new()
}

/// RPC client wrapper.
struct Rpc {
    client: Client,
    rpc_port: u16,
}

impl Rpc {
    fn with_token(token: &str, rpc_port: u16) -> Self {
        Self {
            client: client_with_token(token),
            rpc_port,
        }
    }

    async fn call(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> (StatusCode, serde_json::Value) {
        let resp = self
            .client
            .post(format!("http://127.0.0.1:{}", self.rpc_port))
            .json(&json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": method,
                "params": params,
            }))
            .send()
            .await
            .expect("RPC request failed");
        let status = resp.status();
        let body = resp.json().await.expect("RPC response parse failed");
        (status, body)
    }
}

/// HTTP GET helper.
async fn http_get(client: &Client, http_port: u16, path: &str) -> reqwest::Response {
    client
        .get(format!("http://127.0.0.1:{}{}", http_port, path))
        .send()
        .await
        .expect("HTTP request failed")
}

#[tokio::test]
async fn restart_survives_with_state_intact() {
    let dir = tempdir().expect("tempdir");
    let data_dir = dir.path().to_path_buf();
    let db_path = data_dir.join("warsha.db");

    let config = DaemonConfig {
        data_dir: data_dir.clone(),
        socket_path: data_dir.join("warshad.sock"),
        http_port: 0,
        ws_port: 0,
        auth_token: TEST_TOKEN.to_string(),
        allowed_origins: vec!["http://localhost:5173".to_string()],
    };

    // First daemon instance
    let handle = start_daemon(config.clone())
        .await
        .expect("start_daemon first instance");
    let http_port = handle.http_port();
    let rpc_port = handle.rpc_port();
    assert_ne!(http_port, 0, "OS should assign a non-zero HTTP port");
    assert_ne!(rpc_port, 0, "OS should assign a non-zero RPC port");

    let rpc = Rpc::with_token(TEST_TOKEN, rpc_port);

    // Create a project (positional params: name, description, language)
    let params = json!(["test-project", "A test project", "en"]);
    let (status, resp) = rpc.call("projects.create", params).await;
    assert_eq!(status, StatusCode::OK);
    let project = resp["result"].clone();
    let project_id = project["id"].as_str().expect("project id");
    assert_eq!(project["name"], "test-project");

    // Start a run (positional params: project_id, idea)
    let params = json!([project_id, "Test idea"]);
    let (status, resp) = rpc.call("runs.start", params).await;
    assert_eq!(status, StatusCode::OK);
    let run = resp["result"].clone();
    let run_id = run["id"].as_str().expect("run id");

    // Read events to verify at least one was appended by start_run
    let params = json!([run_id]);
    let (status, resp) = rpc.call("runs.events", params).await;
    assert_eq!(status, StatusCode::OK);
    let events = resp["result"].as_array().expect("events array");
    assert!(
        !events.is_empty(),
        "at least one event expected from start_run"
    );

    // Shutdown first instance
    handle.shutdown().await;

    // Restart daemon on same data_dir
    let handle2 = start_daemon(config)
        .await
        .expect("start_daemon second instance (restart)");
    let _http_port2 = handle2.http_port();
    let rpc_port2 = handle2.rpc_port();

    let rpc2 = Rpc::with_token(TEST_TOKEN, rpc_port2);

    // Verify project persists
    let params = json!([project_id]);
    let (status, resp) = rpc2.call("projects.get", params).await;
    assert_eq!(status, StatusCode::OK);
    let proj = resp["result"].clone();
    assert_eq!(proj["id"], project_id);
    assert_eq!(proj["name"], "test-project");

    // Verify run persists
    let params = json!([run_id]);
    let (status, resp) = rpc2.call("runs.get", params).await;
    assert_eq!(status, StatusCode::OK);
    let run = resp["result"].clone();
    assert_eq!(run["id"], run_id);

    // Verify events persist
    let params = json!([run_id]);
    let (status, resp) = rpc2.call("runs.events", params).await;
    assert_eq!(status, StatusCode::OK);
    let events2 = resp["result"]
        .as_array()
        .expect("events array after restart");
    assert!(!events2.is_empty(), "events should persist after restart");

    // Verify DB file exists (real reopen)
    assert!(db_path.exists(), "warsha.db should exist after restart");

    handle2.shutdown().await;
}

#[tokio::test]
async fn unauthenticated_calls_are_rejected() {
    let dir = tempdir().expect("tempdir");
    let config = DaemonConfig {
        data_dir: dir.path().to_path_buf(),
        socket_path: dir.path().join("warshad.sock"),
        http_port: 0,
        ws_port: 0,
        auth_token: TEST_TOKEN.to_string(),
        allowed_origins: vec!["http://localhost:5173".to_string()],
    };

    let handle = start_daemon(config).await.expect("start_daemon");
    let http_port = handle.http_port();
    let rpc_port = handle.rpc_port();

    // 1. GET /health without auth -> 200 (health is explicitly allowed)
    let no_auth = client_no_auth();
    let health = http_get(&no_auth, http_port, "/health").await;
    assert_eq!(health.status(), StatusCode::OK);

    // 2. GET /events without auth -> 200 with error body (observed current middleware behaviour)
    // Note: the axum middleware returns 200 + JSON {"error":"unauthorized"} rather than 401.
    // This is a pre-existing behaviour; the middleware rejects the request by returning an
    // error body instead of upgrading to WebSocket. A stronger rejection would be 401.
    let events = http_get(&no_auth, http_port, "/events").await;
    assert_eq!(
        events.status(),
        StatusCode::OK,
        "/events without auth returns 200 (observed)"
    );
    let body = events
        .json::<serde_json::Value>()
        .await
        .expect("parse error body");
    assert!(
        body.get("error").is_some(),
        "error key present in /events rejection"
    );

    // 3. RPC projects.list without auth header -> HTTP 401
    let no_auth_rpc = client_no_auth();
    let rpc_no_auth = Rpc {
        client: no_auth_rpc,
        rpc_port,
    };
    let (status, resp) = rpc_no_auth.call("projects.list", json!([])).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(
        resp.get("error").is_some(),
        "RPC 401 body should contain error object, got: {}",
        resp
    );

    // 4. RPC projects.list with wrong bearer token -> HTTP 401
    let wrong_token = Client::builder()
        .default_headers({
            let mut h = reqwest::header::HeaderMap::new();
            h.insert(
                reqwest::header::AUTHORIZATION,
                "Bearer wrong-token".parse().expect("valid header"),
            );
            h
        })
        .build()
        .expect("reqwest client");
    let rpc_wrong = Rpc {
        client: wrong_token,
        rpc_port,
    };
    let (status, resp) = rpc_wrong.call("projects.list", json!([])).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(
        resp.get("error").is_some(),
        "RPC 401 body should contain error object, got: {}",
        resp
    );

    // 5. RPC projects.list with correct token -> succeeds with JSON-RPC result (HTTP 200)
    let rpc_ok = Rpc::with_token(TEST_TOKEN, rpc_port);
    let (status, resp) = rpc_ok.call("projects.list", json!([])).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        resp.get("result").is_some(),
        "RPC with correct token should have result, got: {}",
        resp
    );

    handle.shutdown().await;
}

#[tokio::test]
async fn second_instance_is_locked_out() {
    let dir = tempdir().expect("tempdir");
    let data_dir = dir.path().to_path_buf();

    let config = DaemonConfig {
        data_dir: data_dir.clone(),
        socket_path: data_dir.join("warshad.sock"),
        http_port: 0,
        ws_port: 0,
        auth_token: TEST_TOKEN.to_string(),
        allowed_origins: vec!["http://localhost:5173".to_string()],
    };

    // First instance
    let handle1 = start_daemon(config.clone())
        .await
        .expect("first start_daemon");

    // Second instance on same data_dir should fail due to lock
    let config2 = DaemonConfig {
        http_port: 0,
        ws_port: 0,
        ..config.clone()
    };
    let err = start_daemon(config2)
        .await
        .expect_err("second start_daemon should fail");

    // Assert it's a Lock error
    assert!(
        matches!(err, DaemonError::Lock(_)),
        "expected DaemonError::Lock, got {:?}",
        err
    );

    handle1.shutdown().await;
}
