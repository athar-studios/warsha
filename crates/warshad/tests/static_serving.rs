//! Static serving of the remote UI on the daemon's HTTP listener (GAP 1).
//!
//! The measured break: the built `apps/remote` bundle had no server. Caddy routed
//! `/*` to the *RPC* port, where every GET answers 404, so a browser opening the
//! deployed URL got a JSON-RPC error instead of an app — and the daemon's own HTTP
//! listener, port 8765, served only `/health` and `/events` and 404-ed the root.
//! With `WARSHA_REMOTE_ASSETS_DIR` (or the matching `DaemonConfig` field, which is
//! what a config file and an in-process caller use) the listener now serves the
//! bundle: `index.html` at `/`, hashed assets immutable, a history fallback to
//! `index.html` for client routes like `/runs/<id>`, and a hard refusal of anything
//! that tries to leave the bundle directory. `/rpc`, `/events` and `/health` keep
//! their own answers; without a bundle configured the listener behaves exactly as
//! it did before, and GET `/` is a 404 again.
//!
//! Like `events_ws_auth.rs`, this drives a real daemon over real sockets: the
//! traversal cases in particular must speak raw HTTP/1.1, because a normal client
//! (reqwest's URL parser) would resolve `/../secret.txt` and `/%2e%2e/secret.txt`
//! before they ever reached the daemon — the daemon has to be the one that refuses
//! them.

use std::path::{Path, PathBuf};
use std::time::Duration;

use reqwest::StatusCode;
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use warshad::{start_daemon, DaemonConfig, DaemonHandle, RateLimitConfig, REMOTE_ASSETS_DIR_ENV};

/// The daemon's owner token. These tests send it nowhere on purpose: a browser
/// loading a page has none, and serving the UI must not depend on one.
const OWNER: &str = "static-serving-owner-token-4b72";
/// The marker that says the bytes came from the bundle's `index.html`.
const INDEX_MARK: &str = "<div id=\"root\">warsha-remote</div>";
/// The one thing a traversal refusal must never let slip out of the bundle.
const SECRET_MARK: &str = "TOP-SECRET-OUTSIDE-THE-BUNDLE";

/// How long a test waits for one thing the daemon does on its own initiative.
const BEAT: Duration = Duration::from_secs(5);

/// A fresh temp directory, the same three-way fallback the other daemon tests use
/// (`fresh_tempdir` in `crates/warshad/tests/child_reaping.rs`): some Windows
/// machines protect `%TEMP%` against even creating a directory there.
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
    TempDir::new().expect("tempdir for the test data")
}

/// A stand-in for a built SPA bundle: an `index.html`, the hashed files under
/// `assets/` that modern bundlers emit, and one ordinary file at the root.
fn write_bundle(root: &Path) {
    std::fs::create_dir_all(root.join("assets")).expect("the assets directory");
    std::fs::write(
        root.join("index.html"),
        format!(
            "<!doctype html><html lang=\"ar\"><head><meta charset=\"utf-8\">\
             <title>Warsha Remote</title></head><body>{INDEX_MARK}\
             <script type=\"module\" src=\"/assets/app-1234abcd.js\"></script></body></html>"
        ),
    )
    .expect("index.html");
    std::fs::write(
        root.join("assets/app-1234abcd.js"),
        "console.log(\"warsha remote ui\");\n",
    )
    .expect("the hashed entry");
    std::fs::write(root.join("assets/styles.9f8e7d6c.css"), "body{margin:0}\n")
        .expect("the hashed stylesheet");
    std::fs::write(root.join("favicon.ico"), [0x00, 0x00, 0x01, 0x00]).expect("the icon");
}

/// A running daemon, the port its HTTP listener answers on, and the data directory
/// it holds a lock in for as long as the test is talking to it.
struct Daemon {
    handle: DaemonHandle,
    _dir: TempDir,
}

impl Daemon {
    /// `Some(dir)` serves that bundle; `None` starts exactly the daemon that existed
    /// before static serving — `/health`, `/events`, and a 404 for everything else.
    ///
    /// The bundle arrives through the configuration field, not the environment:
    /// `start_daemon` resolves `WARSHA_REMOTE_ASSETS_DIR` for deployments, and an
    /// ambient value on the machine running this suite would otherwise decide what
    /// the no-bundle case serves. The unset case below says so out loud when the
    /// variable is ambiently present.
    async fn start(assets: Option<PathBuf>) -> Self {
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
            remote_assets_dir: assets,
            ..DaemonConfig::default()
        };
        Daemon {
            handle: start_daemon(config).await.expect("the daemon starts"),
            _dir: dir,
        }
    }

    fn http(&self) -> u16 {
        self.handle.http_port()
    }

    async fn shutdown(self) {
        self.handle.shutdown().await;
    }
}

/// An unauthenticated GET — the shape a browser makes when it opens the URL.
async fn get(port: u16, path: &str) -> reqwest::Response {
    reqwest::Client::new()
        .get(format!("http://127.0.0.1:{port}{path}"))
        .send()
        .await
        .expect("the daemon answers")
}

/// One header as text, or the empty string when it is absent.
async fn header_of(response: &reqwest::Response, name: &str) -> String {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string()
}

/// A raw HTTP/1.1 GET and the whole reply, status line included. The traversal
/// requests are sent this way because a client library normalises `/../` and
/// `/%2e%2e/` before the daemon ever sees them — and the daemon is the thing under
/// test.
async fn raw_get(port: u16, target: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .await
        .expect("the daemon's HTTP port accepts a connection");
    stream
        .write_all(
            format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .await
        .expect("the request reaches the daemon");
    let mut buffer: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let read = tokio::time::timeout(BEAT, stream.read(&mut chunk))
            .await
            .expect("the daemon answers within the beat")
            .expect("the connection stays open long enough to answer");
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
        assert!(
            buffer.len() < 65_536,
            "a reply that big is not a refusal: {buffer:?}"
        );
    }
    String::from_utf8_lossy(&buffer).into_owned()
}

fn status_of(reply: &str) -> u16 {
    reply
        .split_whitespace()
        .nth(1)
        .unwrap_or_else(|| panic!("a reply with no status line: {reply:?}"))
        .parse()
        .unwrap_or_else(|_| panic!("a status line that is not a code: {reply:?}"))
}

// --------------------------------------------------------------------------------
// Serving the bundle.
// --------------------------------------------------------------------------------

/// `/` is the bundle's `index.html`, typed as HTML, and never cached — the shell
/// is the one file a redeploy changes without changing its name. The request is
/// unauthenticated: serving the UI cannot require the token a browser cannot send
/// on a top-level navigation.
#[tokio::test]
async fn the_root_serves_index_html_unauthenticated_and_no_cache() {
    let bundle = fresh_tempdir();
    write_bundle(bundle.path());
    let daemon = Daemon::start(Some(bundle.path().to_path_buf())).await;

    let response = get(daemon.http(), "/").await;
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "GET / did not serve the bundle"
    );
    let content_type = header_of(&response, "content-type").await;
    assert!(
        content_type.starts_with("text/html"),
        "the shell was not typed as HTML: {content_type}"
    );
    assert_eq!(
        header_of(&response, "cache-control").await,
        "no-cache",
        "index.html must revalidate or a redeploy is invisible"
    );
    let body = response.text().await.expect("the shell body");
    assert!(body.contains(INDEX_MARK), "not the bundle's shell: {body}");

    daemon.shutdown().await;
}

/// A hashed asset is typed and cached for a year, immutable — its name is the
/// cache key, so a URL that never changes never means different bytes.
#[tokio::test]
async fn a_hashed_asset_is_typed_and_served_immutable() {
    let bundle = fresh_tempdir();
    write_bundle(bundle.path());
    let daemon = Daemon::start(Some(bundle.path().to_path_buf())).await;

    let response = get(daemon.http(), "/assets/app-1234abcd.js").await;
    assert_eq!(response.status(), StatusCode::OK);
    let content_type = header_of(&response, "content-type").await;
    assert!(
        content_type.starts_with("application/javascript"),
        "the entry was not typed as JavaScript: {content_type}"
    );
    assert_eq!(
        header_of(&response, "cache-control").await,
        "public, max-age=31536000, immutable"
    );
    let body = response.text().await.expect("the asset body");
    assert!(body.contains("warsha remote ui"), "{body}");

    // The stylesheet from the same prefix is `text/css` and immutable too.
    let css = get(daemon.http(), "/assets/styles.9f8e7d6c.css").await;
    assert_eq!(css.status(), StatusCode::OK);
    let css_type = header_of(&css, "content-type").await;
    assert!(css_type.starts_with("text/css"), "{css_type}");
    assert_eq!(
        header_of(&css, "cache-control").await,
        "public, max-age=31536000, immutable"
    );

    // A root file with no hash — favicon — gets its own type and revalidates.
    let icon = get(daemon.http(), "/favicon.ico").await;
    assert_eq!(icon.status(), StatusCode::OK);
    assert_eq!(header_of(&icon, "content-type").await, "image/x-icon");
    assert_eq!(header_of(&icon, "cache-control").await, "no-cache");

    daemon.shutdown().await;
}

/// The SPA history fallback: `/runs/<id>` is a client route, not a file, and the
/// bundle's shell answers it — that is how a deep link into the PWA loads at all.
/// A missing *file*-looking path is not a client route: it stays a 404, so a stale
/// hashed reference cannot be silently served an HTML shell with a JS type.
#[tokio::test]
async fn a_client_route_falls_back_to_the_shell_and_a_missing_file_does_not() {
    let bundle = fresh_tempdir();
    write_bundle(bundle.path());
    let daemon = Daemon::start(Some(bundle.path().to_path_buf())).await;

    let response = get(daemon.http(), "/runs/abc").await;
    assert_eq!(response.status(), StatusCode::OK, "GET /runs/abc");
    let content_type = header_of(&response, "content-type").await;
    assert!(content_type.starts_with("text/html"), "{content_type}");
    assert_eq!(header_of(&response, "cache-control").await, "no-cache");
    let body = response.text().await.expect("the fallback body");
    assert!(
        body.contains(INDEX_MARK),
        "the fallback was not the shell: {body}"
    );

    let missing = get(daemon.http(), "/assets/app-ffffffffffff.js").await;
    assert_eq!(
        missing.status(),
        StatusCode::NOT_FOUND,
        "a missing asset 404s"
    );
    let missing_type = header_of(&missing, "content-type").await;
    assert!(
        !missing_type.starts_with("text/html"),
        "a missing file was served the shell: {missing_type}"
    );

    daemon.shutdown().await;
}

// --------------------------------------------------------------------------------
// What serving refuses.
// --------------------------------------------------------------------------------

/// Every traversal spelling is refused before the bundle directory is touched,
/// and none of them reads the file that sits one level above it. The forms are the
/// ones a proxy forwards: the bare `/../`, the percent-encoded `/%2e%2e/`, and the
/// mid-path `/assets/../../` — the last one is why the check runs on the decoded
/// path, not the raw one.
#[tokio::test]
async fn every_traversal_spelling_is_refused_and_reads_nothing() {
    let outer = fresh_tempdir();
    std::fs::write(outer.path().join("secret.txt"), SECRET_MARK).expect("the secret file");
    let bundle_root = outer.path().join("ui");
    std::fs::create_dir_all(&bundle_root).expect("the bundle directory");
    write_bundle(&bundle_root);
    let daemon = Daemon::start(Some(bundle_root)).await;

    for target in [
        "/../secret.txt",
        "/%2e%2e/secret.txt",
        "/%2E%2E/secret.txt",
        "/assets/../../secret.txt",
        "/assets/%2e%2e/%2e%2e/secret.txt",
    ] {
        let reply = raw_get(daemon.http(), target).await;
        let status = status_of(&reply);
        assert!(
            status == 400 || status == 403 || status == 404,
            "{target} was not refused outright: {reply}"
        );
        assert!(
            !reply.contains(SECRET_MARK),
            "{target} read the file outside the bundle: {reply}"
        );
    }

    daemon.shutdown().await;
}

/// The daemon's own surfaces outrank the bundle. `/events` still requires its
/// credential (a static page must not become a way to watch someone's stream),
/// `/health` still answers without one, and `/rpc` — which belongs to the other
/// listener — is refused here rather than answered with a shell that would hide
/// the misroute. A path *under* the reserved prefixes gets the same refusal, not
/// an SPA page.
#[tokio::test]
async fn the_reserved_daemon_routes_are_never_served_from_the_bundle() {
    let bundle = fresh_tempdir();
    write_bundle(bundle.path());
    let daemon = Daemon::start(Some(bundle.path().to_path_buf())).await;

    let health = get(daemon.http(), "/health").await;
    assert_eq!(health.status(), StatusCode::OK, "/health must stay open");

    let events = get(daemon.http(), "/events").await;
    assert_eq!(
        events.status(),
        StatusCode::UNAUTHORIZED,
        "/events stopped requiring its credential"
    );

    let rpc = get(daemon.http(), "/rpc").await;
    assert_eq!(rpc.status(), StatusCode::NOT_FOUND, "/rpc is not a page");
    let rpc_type = header_of(&rpc, "content-type").await;
    assert_eq!(
        rpc_type, "application/json",
        "/rpc answered HTML: {rpc_type}"
    );

    let events_child = get(daemon.http(), "/events/anything").await;
    assert_eq!(events_child.status(), StatusCode::NOT_FOUND);
    let child_type = header_of(&events_child, "content-type").await;
    assert!(
        !child_type.starts_with("text/html"),
        "a reserved prefix fell through to the shell: {child_type}"
    );

    daemon.shutdown().await;
}

// --------------------------------------------------------------------------------
// Without a bundle, nothing changed.
// --------------------------------------------------------------------------------

/// No `WARSHA_REMOTE_ASSETS_DIR`, no static surface: the same listener that used to
/// 404 the root still does — unauthenticated *or* authenticated — and the fallback
/// handler is not even mounted. This is the "existing deployments are untouched"
/// pin.
#[tokio::test]
async fn without_a_bundle_configured_the_root_still_404s() {
    if std::env::var_os(REMOTE_ASSETS_DIR_ENV).is_some() {
        eprintln!(
            "ambient {REMOTE_ASSETS_DIR_ENV} is set on this machine; skipping the \
             unset-daemon case rather than mutating the shared environment mid-suite"
        );
        return;
    }
    let daemon = Daemon::start(None).await;

    let response = get(daemon.http(), "/").await;
    assert_eq!(
        response.status(),
        StatusCode::NOT_FOUND,
        "a daemon with no bundle gained a root handler it never had"
    );

    // And an asset-looking path is the same plain 404, not an accident of routing.
    let asset = get(daemon.http(), "/assets/app-1234abcd.js").await;
    assert_eq!(asset.status(), StatusCode::NOT_FOUND);

    daemon.shutdown().await;
}
