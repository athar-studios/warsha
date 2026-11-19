#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::unwrap_used,
    unused_crate_dependencies
)]

//! Integration tests for `warsha mcp serve` against a real loopback `warshad` daemon.
//!
//! Covers:
//! 1. Spawning the real `warsha` binary with `mcp serve` over stdio pipes while `RUST_LOG=info`
//!    writes tracing to `stderr`, proving `stdout` carries strictly valid JSON-RPC 2.0 frames.
//! 2. Full MCP flow: `initialize` -> `notifications/initialized` -> `tools/list` ->
//!    `tools/call` (`list_projects`, `start_run`, `list_runs`, `run_status`, `pending_gates`).
//! 3. Security invariants: gate-decision tools and secret/plugin mutations are absent from
//!    `tools/list` and fail safely with `-32601` if invoked; wrong tokens fail with
//!    `isError: true` without leaking credentials; unreachable daemons fail with
//!    `isError: true` without terminating the MCP server loop.

use reqwest::Client;
use serde_json::{json, Value};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tempfile::TempDir;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use warsha_cli::CliApp;
use warshad::{start_daemon, DaemonConfig, DaemonHandle, RateLimitConfig};

const OWNER_TOKEN: &str = "mcp-serve-test-owner-token-001";
const WRONG_TOKEN: &str = "mcp-serve-test-wrong-token-999";

fn fresh_tempdir() -> TempDir {
    if let Some(base) = std::env::var_os("CARGO_TARGET_TMPDIR") {
        let base = PathBuf::from(base);
        if base.is_dir() {
            if let Ok(dir) = TempDir::new_in(&base) {
                return dir;
            }
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(deps) = exe.parent() {
            let base = deps.join("tmp");
            if std::fs::create_dir_all(&base).is_ok() {
                if let Ok(dir) = TempDir::new_in(&base) {
                    return dir;
                }
            }
        }
    }
    TempDir::new().expect("tempdir for daemon data dir")
}

async fn start_test_daemon(data_dir: &std::path::Path) -> DaemonHandle {
    let config = DaemonConfig {
        data_dir: data_dir.to_path_buf(),
        socket_path: data_dir.join("warshad.sock"),
        http_port: 0,
        ws_port: 0,
        bind_host: "127.0.0.1".to_string(),
        advertised_host: None,
        auth_token: OWNER_TOKEN.to_string(),
        allowed_origins: Vec::new(),
        allowed_commands: Vec::new(),
        rate_limits: RateLimitConfig::default(),
        remote_assets_dir: None,
        remote_bind: warshad::RemoteBind::Default,
    };
    start_daemon(config)
        .await
        .expect("start_daemon on OS-chosen loopback ports")
}

async fn daemon_rpc_ok(port: u16, method: &str, params: Value) -> Value {
    let resp = Client::new()
        .post(format!("http://127.0.0.1:{port}"))
        .header("Authorization", format!("Bearer {OWNER_TOKEN}"))
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params,
        }))
        .send()
        .await
        .expect("daemon RPC request succeeds");
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let body: Value = resp.json().await.expect("daemon RPC response is JSON");
    assert!(
        body.get("result").is_some(),
        "daemon RPC `{method}` returned error: {body}"
    );
    body["result"].clone()
}

async fn send_frame<W: tokio::io::AsyncWrite + Unpin>(writer: &mut W, frame: &Value) {
    let mut line = serde_json::to_string(frame).expect("serialize JSON-RPC frame");
    line.push('\n');
    writer
        .write_all(line.as_bytes())
        .await
        .expect("write JSON-RPC line");
    writer.flush().await.expect("flush JSON-RPC line");
}

async fn read_frame<R: tokio::io::AsyncBufRead + Unpin>(lines: &mut tokio::io::Lines<R>) -> Value {
    let raw = tokio::time::timeout(Duration::from_secs(5), lines.next_line())
        .await
        .expect("MCP response did not time out")
        .expect("read stdout line succeeds")
        .expect("unexpected EOF reading MCP response");
    serde_json::from_str(&raw).unwrap_or_else(|err| {
        panic!("stdout contained non-JSON line `{raw}`: {err}");
    })
}

fn closed_port_url() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
    let port = listener.local_addr().expect("local addr").port();
    drop(listener);
    format!("http://127.0.0.1:{port}")
}

#[tokio::test]
async fn binary_stdio_mcp_round_trip_against_loopback_daemon() {
    let dir = fresh_tempdir();
    let handle = start_test_daemon(dir.path()).await;
    let rpc_port = handle.rpc_port();
    let rpc_url = format!("http://127.0.0.1:{rpc_port}");

    // Seed an existing project on the daemon directly.
    let project = daemon_rpc_ok(
        rpc_port,
        "projects.create",
        json!(["MCP Test Project", "Seeded project for X8 test", "en"]),
    )
    .await;
    let project_id = project["id"]
        .as_str()
        .expect("project id string")
        .to_string();

    // Point --config at a non-existent file inside the temp dir so host user config
    // cannot interfere with the test run.
    let unused_config = dir.path().join("no-host-config.toml");

    let mut child = Command::new(env!("CARGO_BIN_EXE_warsha"))
        .arg("--url")
        .arg(&rpc_url)
        .arg("--token")
        .arg(OWNER_TOKEN)
        .arg("--config")
        .arg(&unused_config)
        .arg("mcp")
        .arg("serve")
        .env("RUST_LOG", "info")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn `warsha mcp serve`");

    let mut stdin = child.stdin.take().expect("child stdin piped");
    let stdout = child.stdout.take().expect("child stdout piped");
    let mut stdout_lines = BufReader::new(stdout).lines();

    // 1. Handshake: initialize
    send_frame(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "warsha-integration-test", "version": "0.1.0" }
            }
        }),
    )
    .await;

    let init_reply = read_frame(&mut stdout_lines).await;
    assert_eq!(init_reply["id"], 1);
    assert_eq!(init_reply["result"]["protocolVersion"], "2024-11-05");
    assert_eq!(init_reply["result"]["capabilities"], json!({ "tools": {} }));
    assert_eq!(init_reply["result"]["serverInfo"]["name"], "warsha-mcp");

    // 2. Notification: notifications/initialized (no id, no reply)
    send_frame(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        }),
    )
    .await;

    // 3. tools/list
    send_frame(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {}
        }),
    )
    .await;

    let list_reply = read_frame(&mut stdout_lines).await;
    assert_eq!(list_reply["id"], 2);
    let tools = list_reply["result"]["tools"]
        .as_array()
        .expect("tools array");
    let tool_names: Vec<&str> = tools
        .iter()
        .map(|t| t["name"].as_str().expect("tool name"))
        .collect();
    assert_eq!(
        tool_names,
        vec![
            "list_projects",
            "list_runs",
            "run_status",
            "pending_gates",
            "start_run",
        ]
    );
    for forbidden in ["approve_gate", "reject_gate", "request_changes"] {
        assert!(!tool_names.contains(&forbidden));
    }

    // 4. tools/call: list_projects
    send_frame(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "list_projects",
                "arguments": {}
            }
        }),
    )
    .await;

    let projects_reply = read_frame(&mut stdout_lines).await;
    assert_eq!(projects_reply["id"], 3);
    assert_eq!(projects_reply["result"]["isError"], false);
    let projects_text = projects_reply["result"]["content"][0]["text"]
        .as_str()
        .expect("text content");
    let projects_json: Value =
        serde_json::from_str(projects_text).expect("list_projects text is JSON");
    let projects_arr = projects_json.as_array().expect("projects array");
    assert_eq!(projects_arr.len(), 1);
    assert_eq!(projects_arr[0]["id"], project_id);

    // 5. tools/call: start_run
    send_frame(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {
                "name": "start_run",
                "arguments": {
                    "project_id": project_id,
                    "idea": "Build a clean MCP integration"
                }
            }
        }),
    )
    .await;

    let start_reply = read_frame(&mut stdout_lines).await;
    assert_eq!(start_reply["id"], 4);
    assert_eq!(start_reply["result"]["isError"], false);
    let started_run: Value = serde_json::from_str(
        start_reply["result"]["content"][0]["text"]
            .as_str()
            .expect("start_run text"),
    )
    .expect("start_run text is JSON");
    let run_id = started_run["id"].as_str().expect("run id").to_string();
    assert_eq!(started_run["project_id"], project_id);
    assert_eq!(started_run["current_stage"], "idea");

    // 6. tools/call: list_runs
    send_frame(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": {
                "name": "list_runs",
                "arguments": { "project_id": project_id }
            }
        }),
    )
    .await;

    let runs_reply = read_frame(&mut stdout_lines).await;
    assert_eq!(runs_reply["id"], 5);
    assert_eq!(runs_reply["result"]["isError"], false);
    let runs_arr: Value = serde_json::from_str(
        runs_reply["result"]["content"][0]["text"]
            .as_str()
            .expect("list_runs text"),
    )
    .expect("list_runs text is JSON");
    assert_eq!(runs_arr.as_array().map(Vec::len), Some(1));
    assert_eq!(runs_arr[0]["id"], run_id);

    // 7. tools/call: run_status
    send_frame(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": 6,
            "method": "tools/call",
            "params": {
                "name": "run_status",
                "arguments": { "run_id": run_id }
            }
        }),
    )
    .await;

    let status_reply = read_frame(&mut stdout_lines).await;
    assert_eq!(status_reply["id"], 6);
    assert_eq!(status_reply["result"]["isError"], false);
    let run_json: Value = serde_json::from_str(
        status_reply["result"]["content"][0]["text"]
            .as_str()
            .expect("run_status text"),
    )
    .expect("run_status text is JSON");
    assert_eq!(run_json["id"], run_id);
    assert_eq!(run_json["status"], "running");

    // 8. tools/call: pending_gates (fresh run has all 4 gates pending)
    send_frame(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": 7,
            "method": "tools/call",
            "params": {
                "name": "pending_gates",
                "arguments": { "run_id": run_id }
            }
        }),
    )
    .await;

    let gates_reply = read_frame(&mut stdout_lines).await;
    assert_eq!(gates_reply["id"], 7);
    assert_eq!(gates_reply["result"]["isError"], false);
    let pending: Value = serde_json::from_str(
        gates_reply["result"]["content"][0]["text"]
            .as_str()
            .expect("pending_gates text"),
    )
    .expect("pending_gates text is JSON");
    assert_eq!(pending.as_array().map(Vec::len), Some(4));

    // Approve gate_a via the owner daemon RPC directly (never via MCP), then confirm
    // pending_gates now reports only the 3 remaining pending gates.
    daemon_rpc_ok(rpc_port, "runs.advance", json!([run_id.clone()])).await;
    daemon_rpc_ok(rpc_port, "gates.approve", json!([run_id.clone(), "gate_a"])).await;

    send_frame(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": 8,
            "method": "tools/call",
            "params": {
                "name": "pending_gates",
                "arguments": { "run_id": run_id }
            }
        }),
    )
    .await;

    let gates_after_reply = read_frame(&mut stdout_lines).await;
    assert_eq!(gates_after_reply["id"], 8);
    assert_eq!(gates_after_reply["result"]["isError"], false);
    let pending_after: Value = serde_json::from_str(
        gates_after_reply["result"]["content"][0]["text"]
            .as_str()
            .expect("pending_gates text"),
    )
    .expect("pending_gates text is JSON");
    let stages_after: Vec<&str> = pending_after
        .as_array()
        .expect("array")
        .iter()
        .map(|g| g["stage"].as_str().expect("stage"))
        .collect();
    assert_eq!(stages_after, vec!["gate_b", "gate_c", "gate_d"]);

    // 9. Calling any gate-decision tool fails safely with -32601.
    send_frame(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": 9,
            "method": "tools/call",
            "params": {
                "name": "approve_gate",
                "arguments": { "run_id": run_id, "gate": "gate_b" }
            }
        }),
    )
    .await;
    let forbidden_reply = read_frame(&mut stdout_lines).await;
    assert_eq!(forbidden_reply["id"], 9);
    assert_eq!(forbidden_reply["error"]["code"], -32601);

    // Close stdin and verify clean exit status 0.
    drop(stdin);
    let status = tokio::time::timeout(Duration::from_secs(5), child.wait())
        .await
        .expect("child exits before timeout")
        .expect("wait on child succeeds");
    assert!(status.success(), "warsha mcp serve exited with {status}");

    handle.shutdown().await;
}

#[tokio::test]
async fn cli_app_serve_mcp_handles_wrong_token_and_offline_daemon_without_leaks() {
    let dir = fresh_tempdir();
    let handle = start_test_daemon(dir.path()).await;
    let rpc_url = format!("http://127.0.0.1:{}", handle.rpc_port());

    // Wrong token: CliApp's authenticated client refuses with 401 -> MCP returns isError: true
    // and never echoes the credential.
    let bad_app = CliApp::new(rpc_url, WRONG_TOKEN.to_string(), false).expect("CliApp builds");
    let (client_tx, server_rx) = tokio::io::duplex(8192);
    let (server_tx, client_rx) = tokio::io::duplex(8192);

    let server = tokio::spawn(async move {
        bad_app
            .serve_mcp(BufReader::new(server_rx), server_tx)
            .await
            .expect("serve_mcp completes cleanly");
    });

    let mut writer = client_tx;
    let mut reader = BufReader::new(client_rx).lines();

    send_frame(
        &mut writer,
        &json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": { "name": "list_projects", "arguments": {} }
        }),
    )
    .await;

    let auth_err = read_frame(&mut reader).await;
    assert_eq!(auth_err["id"], 1);
    assert_eq!(auth_err["result"]["isError"], true);
    let err_text = auth_err["result"]["content"][0]["text"]
        .as_str()
        .expect("error text");
    assert!(
        !err_text.contains(WRONG_TOKEN) && !err_text.contains(OWNER_TOKEN),
        "MCP tool error must never leak bearer tokens: {err_text}"
    );

    drop(writer);
    server.await.expect("server exits cleanly");
    handle.shutdown().await;

    // Offline daemon: returns ToolResult isError: true and keeps loop usable.
    let offline_app =
        CliApp::new(closed_port_url(), OWNER_TOKEN.to_string(), false).expect("CliApp builds");
    let (client_tx, server_rx) = tokio::io::duplex(8192);
    let (server_tx, client_rx) = tokio::io::duplex(8192);

    let offline_server = tokio::spawn(async move {
        offline_app
            .serve_mcp(BufReader::new(server_rx), server_tx)
            .await
            .expect("serve_mcp completes cleanly");
    });

    let mut writer = client_tx;
    let mut reader = BufReader::new(client_rx).lines();

    send_frame(
        &mut writer,
        &json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": { "name": "list_projects", "arguments": {} }
        }),
    )
    .await;

    let offline_err = read_frame(&mut reader).await;
    assert_eq!(offline_err["id"], 2);
    assert_eq!(offline_err["result"]["isError"], true);

    // Server stays responsive after daemon call fails.
    send_frame(
        &mut writer,
        &json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "ping"
        }),
    )
    .await;
    let pong = read_frame(&mut reader).await;
    assert_eq!(pong["id"], 3);
    assert_eq!(pong["result"], json!({}));

    drop(writer);
    offline_server.await.expect("offline server exits cleanly");
}
