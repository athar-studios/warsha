//! CLI ↔ daemon RPC-path integration tests.
//!
//! These pin the two defects the CLI had against the daemon's JSON-RPC surface:
//! - no `Authorization: Bearer <token>` header on RPC requests (the daemon's
//!   `RpcAuthLayer` answers every unauthenticated call 401), and
//! - liveness probed via `GET {rpc_url}/health`, a route that does not exist on
//!   the RPC port (`/health` lives on the separate HTTP port), so `ensure_daemon`
//!   reported "not connected" even against a running daemon.

use std::path::PathBuf;
use tempfile::TempDir;
use warsha_cli::{Cli, CliApp, CliError, Commands, ProviderAction};
use warshad::{start_daemon, DaemonConfig, DaemonHandle};

const TEST_TOKEN: &str = "cli-test-auth-token-12345";

/// A fresh temp directory for one daemon's data dir.
///
/// Prefers cargo's `CARGO_TARGET_TMPDIR`, then a `tmp` sibling of the test
/// binary's `deps` directory (the target dir is writable wherever the build
/// ran), and only then the system temp dir.
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
    TempDir::new().expect("tempdir for the daemon data dir")
}

/// Start a daemon on OS-chosen ports with a known token, mirroring the
/// `warshad` integration tests.
async fn start_test_daemon(data_dir: &std::path::Path) -> DaemonHandle {
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

fn cli_for(url: String, command: Commands) -> Cli {
    Cli {
        command,
        json: false,
        socket: None,
        url,
        token: None,
        config: None,
    }
}

#[tokio::test]
async fn status_and_providers_list_succeed_over_the_authenticated_rpc_path() {
    let dir = fresh_tempdir();
    let handle = start_test_daemon(dir.path()).await;
    let url = format!("http://127.0.0.1:{}", handle.rpc_port());

    let app = CliApp::new(url.clone(), TEST_TOKEN.to_string(), false).expect("CliApp");

    // `warsha status` (no args): ensure_daemon + projects.list. Empty catalog
    // must still complete without error — that is the acceptance criterion
    // "warsha projects list succeeds against a default daemon".
    app.run(cli_for(
        url.clone(),
        Commands::Status {
            project: None,
            run: None,
        },
    ))
    .await
    .expect("status against a running daemon with the right token");

    // `warsha providers list`: a direct RPC call, no ensure_daemon.
    app.run(cli_for(
        url,
        Commands::Providers {
            action: ProviderAction::List,
        },
    ))
    .await
    .expect("providers list with the right token");

    handle.shutdown().await;
}

#[tokio::test]
async fn a_wrong_token_is_refused_by_the_daemon_not_reported_as_offline() {
    let dir = fresh_tempdir();
    let handle = start_test_daemon(dir.path()).await;
    let url = format!("http://127.0.0.1:{}", handle.rpc_port());

    let app = CliApp::new(url.clone(), "not-the-daemon-token".to_string(), false).expect("CliApp");

    let err = app
        .run(cli_for(
            url,
            Commands::Status {
                project: None,
                run: None,
            },
        ))
        .await
        .expect_err("a wrong token must not read as success");

    // The daemon is up and *rejected* the call: that surfaces as an RPC error,
    // distinct from `NotConnected`, so the owner is not told the daemon is down.
    assert!(
        matches!(err, CliError::Rpc(_)),
        "expected a refused RPC error, got: {err}"
    );

    handle.shutdown().await;
}

#[tokio::test]
async fn no_daemon_listening_reports_not_connected() {
    // Bind and release a port so the address is very likely unused.
    let spare = std::net::TcpListener::bind("127.0.0.1:0").expect("bind spare port");
    let port = spare.local_addr().expect("local addr").port();
    drop(spare);
    let url = format!("http://127.0.0.1:{}", port);

    let app = CliApp::new(url.clone(), TEST_TOKEN.to_string(), false).expect("CliApp");

    let err = app
        .run(cli_for(
            url,
            Commands::Status {
                project: None,
                run: None,
            },
        ))
        .await
        .expect_err("nothing is listening");
    assert!(
        matches!(err, CliError::NotConnected),
        "expected NotConnected, got: {err}"
    );
}

#[tokio::test]
async fn a_token_that_cannot_form_a_header_value_is_rejected_at_construction() {
    // A token containing a newline would make the `Authorization` header
    // invalid; it must fail fast as a config error, not silently drop the auth.
    // (`CliApp` is not `Debug`, so no `expect_err` here.)
    let result = CliApp::new(
        "http://127.0.0.1:1".to_string(),
        "bad\ntoken".to_string(),
        false,
    );
    match result {
        Err(CliError::Config(_)) => {}
        Err(other) => panic!("expected a Config error, got: {other}"),
        Ok(_) => panic!("a header-unsafe token must be rejected"),
    }
}
