//! The CLI's own transport, against a real daemon (tasks #14, #15).
//!
//! Two defects reached the owner that no test here caught: every RPC `warsha` sent left
//! the bearer token behind (the credential was put on a `reqwest` client that only ever
//! probed `/health`, while the JSON-RPC client was built with no headers at all), and the
//! liveness probe in `ensure_daemon` asked a question the address it was given cannot
//! answer. Both are invisible to a unit test that only formats messages, and invisible to
//! `crates/warshad`'s e2e tests, which build their own client instead of this one. So this
//! file boots a real daemon and drives the real [`CliApp`].
//!
//! Three rules the tests here are written to keep:
//!
//! - A success case is only meaningful beside a refusal case. #14's "the token reaches the
//!   RPC" is proven by the *pair*: with the daemon's own token a command returns `Ok`, with
//!   a different token the same command returns the daemon's HTTP 401. No stub that skipped
//!   sending the request could satisfy both, and no daemon that ignored credentials could
//!   satisfy the second.
//! - The token is a test-local secret and is never printed. Assertions name the *status*,
//!   never a header value.
//! - Defect #15 is a claim about an address, so it is measured as one: the test asks the
//!   RPC listener for `GET /health` with and without a valid credential, and asks the
//!   daemon's other listener the same question, and asserts what the two answers actually
//!   are.

use jsonrpsee::core::client::Error as RpcError;
use jsonrpsee::http_client::transport::Error as HttpTransportError;
use serde_json::{json, Value};
use std::net::TcpListener;
use std::path::PathBuf;
use tempfile::TempDir;
use warsha_cli::{Cli, CliApp, CliError, Commands, ProviderAction};
use warshad::{start_daemon, DaemonConfig, DaemonHandle, RateLimitConfig};

/// The daemon's own bearer token: the credential the CLI is expected to carry.
/// A test-local string, never a real secret and never printed.
const OWNER: &str = "cli-rpc-auth-owner-token";
/// A credential of the same shape that this daemon was never configured with.
const WRONG: &str = "cli-rpc-auth-wrong-token";

/// A running daemon, the two origins it listens on, and the data directory holding its
/// lock for as long as this test is talking to it.
struct Daemon {
    handle: DaemonHandle,
    _dir: TempDir,
}

/// A fresh temp directory for one daemon's data dir.
///
/// Prefers cargo's `CARGO_TARGET_TMPDIR`, then a `tmp` sibling of the test
/// binary's `deps` directory (the target dir is writable wherever the build
/// ran), and only then the system temp dir — which on some Windows machines is
/// protected and rejects even creating a tempdir (`Access is denied`).
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

impl Daemon {
    async fn start() -> Self {
        let dir = fresh_tempdir();
        let config = DaemonConfig {
            data_dir: dir.path().to_path_buf(),
            socket_path: dir.path().join("warshad.sock"),
            // Both `0`: the OS picks free ports, so this test cannot collide with a
            // daemon another lane is running.
            http_port: 0,
            ws_port: 0,
            // Loopback, the daemon's default and the only address the URLs below name.
            bind_host: "127.0.0.1".to_string(),
            advertised_host: None,
            auth_token: OWNER.to_string(),
            allowed_origins: Vec::new(),
            allowed_commands: Vec::new(),
            rate_limits: RateLimitConfig::default(),
        };
        Daemon {
            handle: start_daemon(config).await.expect("the daemon starts"),
            _dir: dir,
        }
    }

    /// The origin `--url` names for a real caller: the JSON-RPC listener.
    fn rpc_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.handle.rpc_port())
    }

    /// The daemon's *other* listener — the one that actually serves `GET /health`.
    fn http_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.handle.http_port())
    }

    async fn shutdown(self) {
        self.handle.shutdown().await;
    }
}

/// The `warsha` command line these tests drive: the same [`Cli`] struct clap builds from
/// `--url`/`--token`, with one subcommand.
fn cli_for(url: String, command: Commands) -> Cli {
    Cli {
        command,
        // `--json` pins the message language to English (see `CliLang::for_output`), so a
        // developer's locale cannot change what these tests print.
        json: true,
        socket: None,
        url,
        token: None,
        config: None,
    }
}

/// A [`CliApp`] speaking to `url` as the holder of `token` — exactly what `src/main.rs`
/// builds from `--url` and `--token`.
fn app(url: String, token: &str) -> CliApp {
    CliApp::new(url, token.to_string(), true).expect("the CLI clients are built")
}

/// The transport-level HTTP status the daemon answered the CLI with, when it answered at
/// all. `None` for anything else, including "nothing was listening".
///
/// This is the test's independent copy of the downcast the CLI's own
/// `ensure_daemon` relies on: if jsonrpsee ever stops boxing
/// [`HttpTransportError`] inside `Error::Transport`, both this helper and that
/// classification break, and the failure is visible here rather than only in a message an
/// owner reads.
fn rejection_status(err: &RpcError) -> Option<u16> {
    let RpcError::Transport(boxed) = err else {
        return None;
    };
    match boxed.downcast_ref::<HttpTransportError>() {
        Some(HttpTransportError::Rejected { status_code }) => Some(*status_code),
        _ => None,
    }
}

/// Assert a command failed with the daemon's HTTP refusal, at this status code.
#[track_caller]
fn assert_refused(err: CliError, status: u16) {
    let CliError::Rpc(rpc_err) = &err else {
        panic!("expected the daemon's RPC refusal, got {err:?}");
    };
    // The refusal must never carry the credential it was refused for.
    let rendered = format!("{err}");
    assert!(
        !rendered.contains(OWNER) && !rendered.contains(WRONG),
        "a CLI error leaked the token it was refused with"
    );
    assert_eq!(
        rejection_status(rpc_err),
        Some(status),
        "expected an HTTP {status} refusal from the daemon: {err:?}"
    );
}

/// #14, the success half: `warsha providers list` carries the bearer token to the RPC.
#[tokio::test]
async fn providers_list_carries_the_bearer_token_to_the_rpc() {
    let daemon = Daemon::start().await;

    let result = app(daemon.rpc_url(), OWNER)
        .run(cli_for(
            daemon.rpc_url(),
            Commands::Providers {
                action: ProviderAction::List,
            },
        ))
        .await;

    result.expect(
        "a daemon that holds the owner's token must answer `providers list` \
                   with its result instead of an HTTP 401 — before the fix the JSON-RPC \
                   client was built with `HttpClientBuilder::default()` and no headers, so \
                   this call left the credential behind",
    );

    daemon.shutdown().await;
}

/// #14, the refusal half: the credential the daemon checks is the one that has to match,
/// so the success above cannot be an accident of a server that accepts anything.
#[tokio::test]
async fn providers_list_is_refused_with_the_wrong_token() {
    let daemon = Daemon::start().await;

    let err = app(daemon.rpc_url(), WRONG)
        .run(cli_for(
            daemon.rpc_url(),
            Commands::Providers {
                action: ProviderAction::List,
            },
        ))
        .await
        .expect_err("a token this daemon was not configured with must not read providers");

    assert_refused(err, 401);

    daemon.shutdown().await;
}

/// #14, the empty-token half: no credential means no `Authorization` header, and the
/// daemon refuses a caller that sends none rather than treating it as a session.
#[tokio::test]
async fn providers_list_with_no_token_is_refused_too() {
    let daemon = Daemon::start().await;

    let err = app(daemon.rpc_url(), "")
        .run(cli_for(
            daemon.rpc_url(),
            Commands::Providers {
                action: ProviderAction::List,
            },
        ))
        .await
        .expect_err("an absent credential is not a session");

    assert_refused(err, 401);

    daemon.shutdown().await;
}

/// #15: the liveness path `warsha status` and `warsha new` run before any work must reach
/// a daemon that is up. This is the command the orchestrator measured failing with a bare
/// `Error: NotConnected` while the daemon was running and answering.
#[tokio::test]
async fn status_reaches_a_running_daemon() {
    let daemon = Daemon::start().await;

    let result = app(daemon.rpc_url(), OWNER)
        .run(cli_for(
            daemon.rpc_url(),
            Commands::Status {
                project: None,
                run: None,
            },
        ))
        .await;

    result.expect(
        "`warsha status` reported the daemon absent while it was running — the \
                   probe `GET {rpc_url}/health` asks the JSON-RPC listener for a route it \
                   does not have, so no URL and no token could ever satisfy it",
    );

    daemon.shutdown().await;
}

/// #15, the other half of the same path: `warsha new` runs the identical liveness check
/// first. Asserted against an address with nothing behind it, because a successful `new`
/// would create a project and start a run — a real run is not what this test is for.
#[tokio::test]
async fn new_goes_through_the_liveness_check() {
    let closed = closed_port().await;

    let err = app(closed.clone(), OWNER)
        .run(cli_for(
            closed,
            Commands::New {
                idea: "an idea that must never be started".to_string(),
                name: Some("liveness-only".to_string()),
                template: None,
            },
        ))
        .await
        .expect_err("`new` must not proceed past a daemon that is not there");

    assert!(
        matches!(err, CliError::NotConnected),
        "an unreachable daemon must read as `NotConnected`, got {err:?}"
    );
}

/// #15: nothing listening is reported as the daemon being absent, not as a raw transport
/// error — the distinction `ensure_daemon` makes, kept honest against a real socket.
#[tokio::test]
async fn status_reports_not_connected_when_nothing_listens() {
    let closed = closed_port().await;

    let err = app(closed.clone(), OWNER)
        .run(cli_for(
            closed,
            Commands::Status {
                project: None,
                run: None,
            },
        ))
        .await
        .expect_err("a command that needs the daemon must fail when it cannot reach one");

    assert!(
        matches!(err, CliError::NotConnected),
        "expected `Not connected to daemon`, got {err:?}"
    );
}

/// #15's root cause, measured rather than argued: the origin `--url` names is the RPC
/// listener, and `GET /health` is not a route on it — with a valid credential, without
/// one, and at any port the CLI could honestly name. The daemon's real `/health` lives on
/// the *other* listener, which the CLI is never told about.
///
/// That is why the fix is an RPC (`health` on the JSON-RPC surface) and not a better URL:
/// a GET cannot be repaired from inside a client that holds one origin, and
/// `http_port`/`ws_port` are two independent config fields (both settable, both `0` for an
/// ephemeral bind) so neither can be derived from the other.
#[tokio::test]
async fn the_rpc_listener_the_cli_is_given_cannot_answer_a_health_get() {
    let daemon = Daemon::start().await;
    let client = reqwest::Client::new();

    // The RPC listener, with the credential that works for every real RPC.
    let answered = client
        .get(format!("{}/health", daemon.rpc_url()))
        .bearer_auth(OWNER)
        .send()
        .await
        .expect("the RPC listener accepts connections");
    let with_token = answered.status();
    let with_token_body = text_of(answered).await;
    assert!(
        !with_token.is_success(),
        "a GET on the RPC listener would have made the old probe right; it answered \
         {with_token}: {with_token_body}"
    );
    // Pinned from measurement: the jsonrpsee HTTP server serves POSTs at the root and
    // answers any other method with 405, so this is not a missing-route 404.
    assert_eq!(
        with_token,
        reqwest::StatusCode::METHOD_NOT_ALLOWED,
        "unexpected answer to `GET /health` on the RPC listener: {with_token_body}"
    );

    // The RPC listener, with no credential: refused before the method is even considered.
    let anonymous = client
        .get(format!("{}/health", daemon.rpc_url()))
        .send()
        .await
        .expect("the RPC listener accepts connections");
    let without_token = anonymous.status();
    let without_token_body = text_of(anonymous).await;
    assert_eq!(
        without_token,
        reqwest::StatusCode::UNAUTHORIZED,
        "the auth layer must refuse an anonymous caller before the method check: \
         {without_token_body}"
    );

    // The other listener, where `/health` really is: the answer the probe wanted and could
    // never get, because the CLI has no flag that names this origin.
    let healthy = client
        .get(format!("{}/health", daemon.http_url()))
        .send()
        .await
        .expect("the HTTP listener accepts connections");
    let healthy_status = healthy.status();
    let healthy_body = healthy.json::<Value>().await.unwrap_or_else(|_| json!({}));
    assert_eq!(healthy_status, reqwest::StatusCode::OK);
    assert_eq!(
        healthy_body["status"].as_str(),
        Some("healthy"),
        "`/health` on the daemon's HTTP listener is the route that answers: {healthy_body}"
    );

    daemon.shutdown().await;
}

/// A port the OS handed us and we immediately stopped listening on: a bind the daemon
/// could not have, and nothing behind it.
async fn closed_port() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("a free port to give away");
    let port = listener.local_addr().expect("the bound address").port();
    drop(listener);
    format!("http://127.0.0.1:{port}")
}

/// A response body read for an assertion message — bounded, and never a header.
async fn text_of(response: reqwest::Response) -> String {
    let limit = 512usize;
    let bytes = response
        .bytes()
        .await
        .map(|bytes| bytes.iter().take(limit).copied().collect::<Vec<u8>>())
        .unwrap_or_default();
    String::from_utf8_lossy(&bytes).into_owned()
}
