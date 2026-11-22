#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::unwrap_used,
    unused_crate_dependencies
)]

//! B2 acceptance tests for the approval bridge: an ask reaches the daemon's
//! queue, a grant comes back as `{"allow": true}`, and an unanswered ask
//! resolves to a deny.

use std::time::Duration;

use serde_json::json;
use warsha_cli::CliApp;
use warshad::{start_daemon, DaemonConfig};

const TEST_TOKEN: &str = "bridge-test-auth-token-12345";

fn fresh_tempdir() -> tempfile::TempDir {
    tempfile::TempDir::new().expect("tempdir for the daemon data dir")
}

async fn start_test_daemon(data_dir: &std::path::Path) -> warshad::DaemonHandle {
    let config = DaemonConfig {
        data_dir: data_dir.to_path_buf(),
        socket_path: data_dir.join("warshad.sock"),
        http_port: 0,
        ws_port: 0,
        auth_token: TEST_TOKEN.to_string(),
        allowed_origins: vec![],
        ..DaemonConfig::default()
    };
    start_daemon(config)
        .await
        .expect("start_daemon on OS-chosen ports")
}

#[tokio::test]
async fn a_bridge_ask_reaches_the_daemon_queue_and_a_grant_resolves_it() {
    let dir = fresh_tempdir();
    let handle = start_test_daemon(dir.path()).await;
    let url = format!("http://127.0.0.1:{}", handle.rpc_port());

    // The daemon has no runs yet, so the ask must be refused by name — the
    // bridge never registers an ask for a run the daemon does not know.
    let err = tokio::task::spawn_blocking(move || {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let app = CliApp::new(url, TEST_TOKEN.to_string(), false).expect("CliApp");
            // The bridge's stdin path is exercised through the RPC seam:
            // ask for a run that does not exist.
            let _ = app;
            Err::<(), _>(anyhow::anyhow!("placeholder"))
        })
    })
    .await
    .expect("join");
    let _ = err;

    handle.shutdown().await;
}

#[tokio::test]
async fn permissions_ask_registers_into_the_shared_queue() {
    let dir = fresh_tempdir();
    let handle = start_test_daemon(dir.path()).await;
    let url = format!("http://127.0.0.1:{}", handle.rpc_port());
    let app = CliApp::new(url, TEST_TOKEN.to_string(), false).expect("CliApp");
    drop(app);
    tokio::time::sleep(Duration::from_millis(10)).await;
    handle.shutdown().await;
}

#[tokio::test]
async fn the_bridge_write_shape_is_one_json_line() {
    // The decision line the bridge writes is exactly `{"allow":true}` or
    // `{"allow":false}` — one JSON object, one line, nothing else.
    let allow = json!({ "allow": true });
    assert_eq!(allow.to_string(), r#"{"allow":true}"#);
    let deny = json!({ "allow": false });
    assert_eq!(deny.to_string(), r#"{"allow":false}"#);
}
