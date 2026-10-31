//! D2 — the provider RPCs really store, really test and really remove (PLAN.md M20,
//! provider-RPC batch).
//!
//! The desktop's first-run wizard pastes one API key and calls four methods on
//! `@warsha/client`. This file drives the same four over the daemon's real HTTP
//! JSON-RPC surface, with the params the client actually sends — a JSON object per
//! method, not a positional array — because the wire the wizard promises is the
//! wire this test has to prove:
//!
//! ```text
//! providers.list                 []
//! providers.add                  { name, kind, key, api_base }
//! providers.test                 { name }
//! providers.remove               { name }
//! ```
//!
//! What is proved, and by what:
//!
//! - **`providers.add` persists.** The first daemon is told to add a provider, it
//!   is shut down, and a second daemon on the same data directory answers
//!   `providers.list` with it. Nothing writes the row behind the daemon's back: no
//!   test opens `warsha.db` for reading or writing.
//! - **The key is not on disk.** The canary key the test sends is looked for in
//!   *every* byte of every file in the data directory — `warsha.db` and its WAL
//!   sidecars included — and in every `providers.*` reply. A whole-file scan rather
//!   than a column check on purpose: a secret that leaked into a column nobody
//!   queries would still be a secret on disk.
//! - **The key is in the store.** The daemon is handed an in-process
//!   [`InMemorySecretStore`] because the OS keychain is not available in a headless
//!   container (see `warshad::start_daemon_with_secrets`); the test asserts the key
//!   is filed there under the provider's name and — the load-bearing half — that
//!   `providers.test` sends it to the stub endpoint as a bearer token, which is
//!   only possible if the daemon read it back out of the store.
//! - **`providers.test` tests.** Three endpoints, three answers: a stub answering
//!   `200` is healthy with a latency, a stub answering `401` is a refused key, and
//!   a loopback port nothing listens on is an unreachable endpoint. None of them is
//!   a real model API: two are loopback stubs, one is a closed loopback port.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;

use reqwest::Client;
use serde_json::{json, Value};
use tempfile::tempdir;
use warsha_providers::InMemorySecretStore;
use warshad::{start_daemon_with_secrets, DaemonConfig};

/// The token every daemon in this file is started with.
const TEST_TOKEN: &str = "provider-rpc-token";

/// The key the wizard would paste, and the canary this test hunts for on disk.
const CANARY_KEY: &str = "sk-canary-provider-key-9f3c1d";

/// The provider's `kind`: a one-click preset, so the daemon knows a default model
/// for the connection test without the owner naming one.
const KIND: &str = "qwen";

/// One daemon's RPC surface.
struct Rpc {
    client: Client,
    rpc_port: u16,
}

impl Rpc {
    /// A client for one daemon's RPC port.
    fn new(rpc_port: u16) -> Self {
        let client = Client::builder()
            .default_headers({
                let mut headers = reqwest::header::HeaderMap::new();
                headers.insert(
                    reqwest::header::AUTHORIZATION,
                    format!("Bearer {TEST_TOKEN}")
                        .parse()
                        .expect("a valid auth header"),
                );
                headers
            })
            .build()
            .expect("a reqwest client");
        Rpc { client, rpc_port }
    }

    /// Call one method and hand back its `result`, failing on a JSON-RPC error.
    async fn call(&self, method: &str, params: Value) -> Value {
        let body = self.post(method, params).await;
        assert!(
            body.get("error").is_none(),
            "{method} failed: {}",
            body["error"]
        );
        body["result"].clone()
    }

    /// Call one method that must be refused, and hand back its error object.
    async fn call_refused(&self, method: &str, params: Value) -> Value {
        let body = self.post(method, params).await;
        assert!(
            body.get("error").is_some(),
            "{method} was expected to refuse and answered {}",
            body["result"]
        );
        body["error"].clone()
    }

    /// POST one JSON-RPC request and hand back the decoded envelope.
    async fn post(&self, method: &str, params: Value) -> Value {
        let response = self
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
            .expect("the RPC request is sent");
        assert_eq!(
            response.status(),
            reqwest::StatusCode::OK,
            "{method} answered HTTP {}",
            response.status()
        );
        response
            .json::<Value>()
            .await
            .expect("the response is JSON")
    }
}

/// A daemon configuration over one data directory, on OS-chosen ports.
fn config(data_dir: &Path) -> DaemonConfig {
    DaemonConfig {
        data_dir: data_dir.to_path_buf(),
        socket_path: data_dir.join("warshad.sock"),
        http_port: 0,
        ws_port: 0,
        auth_token: TEST_TOKEN.to_string(),
        allowed_origins: vec!["http://localhost:5173".to_string()],
    }
}

/// The message of a JSON-RPC error, for a readable assertion failure.
fn message(error: &Value) -> String {
    error["message"].as_str().unwrap_or_default().to_string()
}

/// A loopback endpoint that answers `status` to every request and records the
/// `Authorization` header it was sent.
///
/// This is the "endpoint" a provider is pointed at, and it is what makes "the
/// daemon really read the key back" an assertion rather than a claim: the header
/// it captured is the key the wizard pasted.
struct StubEndpoint {
    base_url: String,
    seen: Arc<Mutex<Vec<String>>>,
}

impl StubEndpoint {
    /// Start a stub answering `status` (`200` or `401`).
    fn start(status: u16) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback port");
        let port = listener.local_addr().expect("the bound address").port();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let captured = seen.clone();

        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let mut reader = BufReader::new(stream.try_clone().expect("a cloned stream"));
                let mut line = String::new();
                let mut authorization = String::new();
                while reader.read_line(&mut line).is_ok() && line != "\r\n" {
                    if line.to_lowercase().starts_with("authorization:") {
                        authorization = line.trim().to_string();
                    }
                    line.clear();
                }
                captured
                    .lock()
                    .expect("the capture lock")
                    .push(authorization);

                let body = if status == 200 {
                    r#"{"data":[]}"#
                } else {
                    "{}"
                };
                let response = format!(
                    "HTTP/1.1 {status} stub\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });

        Self {
            base_url: format!("http://127.0.0.1:{port}/v1"),
            seen,
        }
    }

    /// Every `Authorization` header the stub was sent, oldest first.
    fn authorization_headers(&self) -> Vec<String> {
        self.seen.lock().expect("the capture lock").clone()
    }
}

/// The bearer header a written key arrives in.
fn bearer(key: &str) -> String {
    format!("authorization: Bearer {key}")
}

/// A base URL on a loopback port nothing listens on.
fn closed_endpoint() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback port");
    let port = listener.local_addr().expect("the bound address").port();
    drop(listener);
    format!("http://127.0.0.1:{port}/v1")
}

/// Every file directly inside `dir`, as `(file name, contents)` pairs.
///
/// A provider's key must not be readable in any of them.
fn every_file_in(dir: &Path) -> Vec<(String, String)> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(dir).expect("the data directory is readable") {
        let path = entry.expect("a directory entry").path();
        if !path.is_file() {
            continue;
        }
        let bytes = std::fs::read(&path).expect("the file is readable");
        files.push((
            path.file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
            String::from_utf8_lossy(&bytes).into_owned(),
        ));
    }
    files.sort();
    files
}

/// `providers.add` with the params the wizard sends.
fn add_params(name: &str, api_base: &str, key: &str) -> Value {
    json!({
        "name": name,
        "kind": KIND,
        "key": key,
        "api_base": api_base,
    })
}

/// A data directory, and a daemon over it with one in-process secret store.
///
/// The tuple is the order things must drop in: the daemon outlives the directory
/// only if the test shuts it down first, which `shutdown` is.
async fn daemon_over(
    dir: &Path,
    secrets: Arc<InMemorySecretStore>,
) -> (warshad::DaemonHandle, Rpc) {
    std::fs::create_dir_all(dir).expect("the data directory is made");
    let handle = start_daemon_with_secrets(config(dir), secrets)
        .await
        .expect("the daemon starts");
    let rpc = Rpc::new(handle.rpc_port());
    (handle, rpc)
}

#[tokio::test]
async fn a_provider_added_over_rpc_survives_a_restart_and_leaves_no_key_on_disk() {
    let dir = tempdir().expect("a temporary directory");
    let data_dir = dir.path().join("data");
    let endpoint = StubEndpoint::start(200);
    // One store, two daemons: the key the first writes is the key the second reads
    // back, which is what a restart against a real OS keychain would do too.
    let secrets = Arc::new(InMemorySecretStore::new());

    let (first, rpc) = daemon_over(&data_dir, secrets.clone()).await;

    // Nothing is configured yet, so the wizard is offered its built-in presets.
    assert_eq!(
        rpc.call("providers.list", json!([])).await,
        json!([]),
        "a fresh daemon reports no providers"
    );

    let added = rpc
        .call(
            "providers.add",
            add_params("my-qwen", &endpoint.base_url, CANARY_KEY),
        )
        .await;
    assert_eq!(added["name"], json!("my-qwen"));
    assert_eq!(added["kind"], json!(KIND));
    assert_eq!(added["enabled"], json!(true));
    assert_eq!(added["api_base"], json!(endpoint.base_url));
    // The reply carries the configuration and no secret: exactly the fields
    // `@warsha/client`'s `ProviderConfig` declares.
    let mut fields: Vec<&str> = added
        .as_object()
        .expect("a provider object")
        .keys()
        .map(String::as_str)
        .collect();
    fields.sort_unstable();
    assert_eq!(fields, vec!["api_base", "enabled", "kind", "name"]);

    // The listed provider is the added one, and the key is not in the list.
    let listed = rpc.call("providers.list", json!([])).await;
    assert_eq!(listed.as_array().expect("a list").len(), 1);
    assert_eq!(listed[0]["name"], json!("my-qwen"));
    assert!(
        !listed.to_string().contains(CANARY_KEY),
        "no providers.* reply may carry the key: {listed}"
    );

    // The key is in the store the daemon was handed, under the provider's name.
    assert_eq!(
        secrets.key_for("my-qwen").as_deref(),
        Some(CANARY_KEY),
        "providers.add must file the key in the secret store"
    );

    // The connection test really used it: the stub was sent it as a bearer token.
    let health = rpc
        .call("providers.test", json!({ "name": "my-qwen" }))
        .await;
    assert_eq!(health["healthy"], json!(true));
    assert!(
        health["latency_ms"].is_number(),
        "a healthy probe reports its latency: {health}"
    );
    assert_eq!(health["error"], json!(null));
    assert_eq!(
        endpoint.authorization_headers(),
        vec![bearer(CANARY_KEY)],
        "the key must reach the endpoint, and only as a bearer token"
    );

    first.shutdown().await;

    // Nothing in the data directory holds the key: not the settings row, not the
    // WAL sidecar.
    let files = every_file_in(&data_dir);
    let scanned: Vec<&str> = files.iter().map(|(name, _)| name.as_str()).collect();
    assert!(
        scanned.contains(&"warsha.db"),
        "the settings database exists: {scanned:?}"
    );
    // The negative control: the row that was just written is in what was scanned —
    // the main database or its WAL sidecar — so "the key is not in it" is an
    // assertion about that row and not about an empty file.
    let all: String = files
        .iter()
        .map(|(_, contents)| contents.as_str())
        .collect::<Vec<&str>>()
        .join("\n");
    assert!(
        all.contains("my-qwen") && all.contains(&endpoint.base_url),
        "the scanned files ({scanned:?}) must include the database holding the provider's row"
    );
    for (name, contents) in &files {
        assert!(
            !contents.contains(CANARY_KEY),
            "{name} contains the API key; a key must live only in the OS keychain"
        );
    }

    // A second daemon on the same data directory: the provider is still configured.
    let (second, rpc) = daemon_over(&data_dir, secrets.clone()).await;

    let after = rpc.call("providers.list", json!([])).await;
    assert_eq!(
        after.as_array().expect("a list").len(),
        1,
        "providers.list must return a provider added before the restart: {after}"
    );
    assert_eq!(after[0]["name"], json!("my-qwen"));
    assert_eq!(after[0]["kind"], json!(KIND));
    assert_eq!(after[0]["api_base"], json!(endpoint.base_url));
    assert!(!after.to_string().contains(CANARY_KEY));

    // And it is testable, which means the key came back with the row: the stub's
    // second request carries the same bearer token.
    let health = rpc
        .call("providers.test", json!({ "name": "my-qwen" }))
        .await;
    assert_eq!(health["healthy"], json!(true));
    assert_eq!(
        endpoint.authorization_headers(),
        vec![bearer(CANARY_KEY), bearer(CANARY_KEY)],
        "the restarted daemon tested the provider too"
    );

    second.shutdown().await;
}

#[tokio::test]
async fn a_wrong_key_an_unreachable_endpoint_and_a_good_key_are_three_answers() {
    let dir = tempdir().expect("a temporary directory");
    let data_dir = dir.path().join("data");
    let good = StubEndpoint::start(200);
    let refusing = StubEndpoint::start(401);
    let secrets = Arc::new(InMemorySecretStore::new());

    let (daemon, rpc) = daemon_over(&data_dir, secrets.clone()).await;

    for (name, api_base) in [
        ("good-key", good.base_url.clone()),
        ("wrong-key", refusing.base_url.clone()),
        ("no-endpoint", closed_endpoint()),
    ] {
        rpc.call("providers.add", add_params(name, &api_base, CANARY_KEY))
            .await;
    }

    // 1. A good key against a live endpoint: healthy, with a latency.
    let healthy = rpc
        .call("providers.test", json!({ "name": "good-key" }))
        .await;
    assert_eq!(healthy["healthy"], json!(true));
    assert_eq!(healthy["error"], json!(null));

    // 2. A key the endpoint refuses: refused, and the reason names the key.
    let refused = rpc
        .call_refused("providers.test", json!({ "name": "wrong-key" }))
        .await;
    let refusal = message(&refused);
    assert!(
        refusal.contains("refused the API key"),
        "a refused key must not be reported as anything else: {refused}"
    );
    assert!(!refusal.contains(CANARY_KEY), "the key must not be echoed");
    // The reply the client expects is still the `HealthCheck`: unhealthy, with the
    // reason in `error`, carried as the error's data.
    assert_eq!(refused["data"]["healthy"], json!(false));
    assert_eq!(
        refused["data"]["error"].as_str().unwrap_or_default(),
        refusal,
        "the HealthCheck's error and the error's message must agree"
    );

    // 3. An endpoint nothing answers on: a different refusal, in different words.
    let unreachable = rpc
        .call_refused("providers.test", json!({ "name": "no-endpoint" }))
        .await;
    assert!(
        message(&unreachable).contains("could not be reached"),
        "an unreachable endpoint must say so: {unreachable}"
    );
    assert_ne!(
        message(&unreachable),
        refusal,
        "a wrong key and a dead endpoint are different answers"
    );
    assert_eq!(unreachable["data"]["healthy"], json!(false));

    // 4. An unknown provider is refused rather than answered with a fake healthy.
    let unknown = rpc
        .call_refused("providers.test", json!({ "name": "never-added" }))
        .await;
    assert!(
        message(&unknown).contains("no provider named never-added"),
        "{unknown}"
    );

    daemon.shutdown().await;
}

#[tokio::test]
async fn a_provider_whose_key_the_keychain_lost_is_refused() {
    let dir = tempdir().expect("a temporary directory");
    let data_dir = dir.path().join("data");
    let endpoint = StubEndpoint::start(200);

    let (first, rpc) = daemon_over(&data_dir, Arc::new(InMemorySecretStore::new())).await;
    rpc.call(
        "providers.add",
        add_params("orphan", &endpoint.base_url, CANARY_KEY),
    )
    .await;
    rpc.call("providers.test", json!({ "name": "orphan" }))
        .await;
    first.shutdown().await;

    // A daemon that comes up with an empty secret store: the keychain entry the row
    // depends on is gone (a wiped keyring, a restored profile).
    let (second, rpc) = daemon_over(&data_dir, Arc::new(InMemorySecretStore::new())).await;
    assert_eq!(
        rpc.call("providers.list", json!([]))
            .await
            .as_array()
            .expect("a list")
            .len(),
        1,
        "the configuration survives even when the secret does not"
    );

    let missing = rpc
        .call_refused("providers.test", json!({ "name": "orphan" }))
        .await;
    assert!(
        message(&missing).contains("keychain"),
        "a provider whose key is gone must say which half is missing: {missing}"
    );

    second.shutdown().await;
}

#[tokio::test]
async fn removing_a_provider_removes_its_row_and_its_key() {
    let dir = tempdir().expect("a temporary directory");
    let data_dir = dir.path().join("data");
    let doomed_endpoint = StubEndpoint::start(200);
    let kept_endpoint = StubEndpoint::start(200);
    let secrets = Arc::new(InMemorySecretStore::new());

    let (daemon, rpc) = daemon_over(&data_dir, secrets.clone()).await;

    rpc.call(
        "providers.add",
        add_params("doomed", &doomed_endpoint.base_url, CANARY_KEY),
    )
    .await;
    rpc.call(
        "providers.add",
        add_params("kept", &kept_endpoint.base_url, CANARY_KEY),
    )
    .await;
    assert_eq!(secrets.accounts(), vec!["doomed", "kept"]);

    let removed = rpc
        .call("providers.remove", json!({ "name": "doomed" }))
        .await;
    assert_eq!(removed["name"], json!("doomed"));
    assert_eq!(removed["kind"], json!(KIND));

    // The row is gone...
    let listed = rpc.call("providers.list", json!([])).await;
    assert_eq!(listed.as_array().expect("a list").len(), 1);
    assert_eq!(listed[0]["name"], json!("kept"));
    // ...and so is the key, which is the half a row-only removal would leave behind.
    assert_eq!(
        secrets.accounts(),
        vec!["kept"],
        "the removed provider's keychain entry must go with its row"
    );
    // The provider cannot be used any more.
    let refused = rpc
        .call_refused("providers.test", json!({ "name": "doomed" }))
        .await;
    assert!(
        message(&refused).contains("no provider named doomed"),
        "{refused}"
    );
    // Removing it twice is refused rather than silently successful.
    rpc.call_refused("providers.remove", json!({ "name": "doomed" }))
        .await;

    // The kept provider still works.
    let health = rpc.call("providers.test", json!({ "name": "kept" })).await;
    assert_eq!(health["healthy"], json!(true));
    assert_eq!(
        kept_endpoint.authorization_headers(),
        vec![bearer(CANARY_KEY)]
    );

    daemon.shutdown().await;
}

#[tokio::test]
async fn adding_a_provider_refuses_input_it_cannot_use() {
    let dir = tempdir().expect("a temporary directory");
    let data_dir = dir.path().join("data");
    let secrets = Arc::new(InMemorySecretStore::new());

    let (daemon, rpc) = daemon_over(&data_dir, secrets.clone()).await;

    // A key is not optional: without one, nothing could ever be tested.
    let no_key = rpc
        .call_refused(
            "providers.add",
            json!({
                "name": "no-key",
                "kind": KIND,
                "key": "",
                "api_base": "http://127.0.0.1:9/v1",
            }),
        )
        .await;
    assert!(message(&no_key).contains("API key"), "{no_key}");

    // Nor is a URL that cannot be parsed.
    let bad_url = rpc
        .call_refused(
            "providers.add",
            json!({
                "name": "bad-url",
                "kind": KIND,
                "key": CANARY_KEY,
                "api_base": "api.example.com",
            }),
        )
        .await;
    assert!(message(&bad_url).contains("http"), "{bad_url}");

    // A kind nobody knows carries no default URL, so one has to be sent.
    let unknown_kind = rpc
        .call_refused(
            "providers.add",
            json!({ "name": "mystery", "kind": "not_a_provider", "key": CANARY_KEY }),
        )
        .await;
    assert!(
        message(&unknown_kind).contains("no base URL is known"),
        "{unknown_kind}"
    );

    // Every refusal left nothing behind: no row, no key.
    assert_eq!(rpc.call("providers.list", json!([])).await, json!([]));
    assert!(
        secrets.accounts().is_empty(),
        "a refused add must not file a key: {:?}",
        secrets.accounts()
    );

    daemon.shutdown().await;
}

/// A pasted key arrives with whatever the paste carried, and the wizard's own key
/// check trims before it judges — so the daemon must store and send the trimmed
/// key rather than one with a newline in it, which every endpoint would refuse.
#[tokio::test]
async fn a_key_pasted_with_surrounding_whitespace_is_stored_trimmed() {
    let dir = tempdir().expect("a temporary directory");
    let data_dir = dir.path().join("data");
    let endpoint = StubEndpoint::start(200);
    let secrets = Arc::new(InMemorySecretStore::new());

    let (daemon, rpc) = daemon_over(&data_dir, secrets.clone()).await;

    rpc.call(
        "providers.add",
        add_params("pasted", &endpoint.base_url, &format!("  {CANARY_KEY}\n")),
    )
    .await;
    assert_eq!(
        secrets.key_for("pasted").as_deref(),
        Some(CANARY_KEY),
        "the stored key must be the trimmed one"
    );

    let health = rpc
        .call("providers.test", json!({ "name": "pasted" }))
        .await;
    assert_eq!(health["healthy"], json!(true));
    assert_eq!(
        endpoint.authorization_headers(),
        vec![bearer(CANARY_KEY)],
        "the bearer token must not carry the pasted whitespace"
    );

    daemon.shutdown().await;
}
