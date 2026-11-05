//! Integration tests for the daemon's inbound ceilings (security audit H-01).
//!
//! The audit's finding was that no endpoint had a 429 path at all: the JSON-RPC
//! surface, `/events` and the health probe would take as much as a caller sent. These
//! tests drive a real daemon on loopback and assert the two things a limiter has to
//! get right — a bounded caller is *refused with a wait*, and the refusal is *that
//! caller's*, not everybody's — plus the specific ceilings the audit called the
//! strictest: credentials, pairing, and anything that spends money or starts a process.
//!
//! Every ceiling here is set to a number a test can reach in one loop. The defaults the
//! daemon ships are wide enough that a working desktop session never sees a refusal;
//! what is under test is the mechanism, and a mechanism only a flood can reach cannot
//! be demonstrated by a flood in a test suite.

use reqwest::Client;
use serde_json::{json, Value};
use std::path::PathBuf;
use tempfile::TempDir;
use warshad::{start_daemon, DaemonConfig, DaemonHandle, QuotaConfig, RateLimitConfig};

/// The daemon's bearer token: the owner credential.
const OWNER: &str = "s1a-rate-token";

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

/// A daemon with the ceilings a test names.
struct Daemon {
    handle: DaemonHandle,
    _dir: TempDir,
}

impl Daemon {
    async fn start(rate_limits: RateLimitConfig) -> Self {
        let dir = fresh_tempdir();
        let config = DaemonConfig {
            data_dir: dir.path().to_path_buf(),
            socket_path: dir.path().join("warshad.sock"),
            http_port: 0,
            ws_port: 0,
            auth_token: OWNER.to_string(),
            allowed_origins: vec!["http://localhost:5173".to_string()],
            allowed_commands: Vec::new(),
            rate_limits,
            // The bind address stays the loopback default: the ceilings under test
            // are enforced on every address equally, so this test names neither
            // `bind_host` nor `advertised_host` (see `DaemonConfig::bind_host`).
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

    fn http(&self) -> u16 {
        self.handle.http_port()
    }

    async fn shutdown(self) {
        self.handle.shutdown().await;
    }
}

/// Ceilings with the transport left wide, so a method-tier test measures its own tier
/// and not the whole-request ceiling in front of it.
fn tiers() -> RateLimitConfig {
    RateLimitConfig {
        transport: QuotaConfig {
            burst: 500,
            sustained: 500,
            window_secs: 60,
        },
        ..RateLimitConfig::default()
    }
}

/// A small burst that refills at one request a minute.
fn tight(burst: u32) -> QuotaConfig {
    QuotaConfig {
        burst,
        sustained: 1,
        window_secs: 60,
    }
}

/// One JSON-RPC call, returning the transport status and the envelope.
async fn rpc(port: u16, token: &str, method: &str, params: Value) -> (reqwest::StatusCode, Value) {
    let response = Client::new()
        .post(format!("http://127.0.0.1:{port}"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}))
        .send()
        .await
        .expect("the daemon answers");
    let status = response.status();
    let body = response.json::<Value>().await.unwrap_or_else(|_| json!({}));
    (status, body)
}

/// The JSON-RPC `code` of a refusal, or a panic naming the method that served instead.
async fn rpc_code(port: u16, token: &str, method: &str, params: Value) -> i64 {
    let (_status, body) = rpc(port, token, method, params).await;
    body["error"]["code"]
        .as_i64()
        .unwrap_or_else(|| panic!("{method} did not refuse: {body}"))
}

/// The result of a call a test expects to be served.
async fn rpc_ok(port: u16, token: &str, method: &str, params: Value) -> Value {
    let (status, body) = rpc(port, token, method, params).await;
    assert_eq!(status, reqwest::StatusCode::OK, "{method} did not arrive");
    assert!(body.get("result").is_some(), "{method} refused: {body}");
    body["result"].clone()
}

/// A project and a run, for a test that needs a gate to decide.
async fn owned_run(port: u16) -> String {
    let project = rpc_ok(
        port,
        OWNER,
        "projects.create",
        json!(["Rate Shop", "a run to spend on", "en"]),
    )
    .await;
    let run = rpc_ok(
        port,
        OWNER,
        "runs.start",
        json!([project["id"], "build it"]),
    )
    .await;
    run["id"].as_str().expect("a run id").to_string()
}

/// Audit H-01 on the HTTP listener: `/health` — the one route that answers without a
/// credential — is bounded, and a bounded caller is told when to come back.
#[tokio::test]
async fn the_http_listener_answers_429_with_a_retry_after() {
    let mut limits = tiers();
    limits.transport = tight(3);
    let daemon = Daemon::start(limits).await;
    let url = format!("http://127.0.0.1:{}/health", daemon.http());
    let client = Client::new();

    for _ in 0..3 {
        let response = client.get(&url).send().await.expect("the daemon answers");
        assert_eq!(response.status(), reqwest::StatusCode::OK);
    }

    let refused = client.get(&url).send().await.expect("the daemon answers");
    assert_eq!(
        refused.status(),
        reqwest::StatusCode::TOO_MANY_REQUESTS,
        "a caller past the ceiling was still served"
    );
    let retry_after = refused
        .headers()
        .get("retry-after")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_else(|| panic!("a 429 carried no Retry-After"))
        .to_string();
    assert!(
        retry_after
            .parse::<u64>()
            .expect("a whole number of seconds")
            >= 1,
        "Retry-After was {retry_after}"
    );

    daemon.shutdown().await;
}

/// The WebSocket route is bounded too: it was the unbounded one, since every event
/// stream is a long-lived socket the daemon keeps and reads from.
#[tokio::test]
async fn the_events_socket_is_bounded_per_caller() {
    let mut limits = tiers();
    limits.transport = tight(2);
    let daemon = Daemon::start(limits).await;
    let client = Client::new();
    let mut attempts = Vec::new();

    for _ in 0..4 {
        let response = client
            .get(format!("http://127.0.0.1:{}/events", daemon.http()))
            .header("Authorization", format!("Bearer {OWNER}"))
            .header("Upgrade", "websocket")
            .header("Connection", "Upgrade")
            .header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
            .header("Sec-WebSocket-Version", "13")
            .send()
            .await
            .expect("the daemon answers");
        attempts.push(response.status());
    }

    assert!(
        attempts.contains(&reqwest::StatusCode::TOO_MANY_REQUESTS),
        "an unbounded `/events` upgrade was the free path: {attempts:?}"
    );

    daemon.shutdown().await;
}

/// Audit H-01's strictest ceiling: pairing mints the credentials the daemon later
/// trusts, so it is the first to stop.
#[tokio::test]
async fn pairing_is_bounded_before_anything_else() {
    let mut limits = tiers();
    limits.pairing = tight(2);
    let daemon = Daemon::start(limits).await;
    let port = daemon.rpc();

    for index in 0..2 {
        rpc_ok(
            port,
            OWNER,
            "pairing.create",
            json!([format!("device-{index}"), format!("secret-{index}")]),
        )
        .await;
    }

    let code = rpc_code(
        port,
        OWNER,
        "pairing.create",
        json!(["device-2", "secret-2"]),
    )
    .await;
    assert_eq!(
        code, -32004,
        "a caller past the pairing ceiling was still minting credentials"
    );

    // An ordinary read on the same session is not refused: the ceiling is per tier,
    // and pairing is not the budget for everything else.
    rpc_ok(port, OWNER, "pairing.list", json!([])).await;

    daemon.shutdown().await;
}

/// Audit H-01 on the paid path: a model turn is bounded before it reaches a provider.
#[tokio::test]
async fn paid_work_is_bounded_before_it_can_spend() {
    let mut limits = tiers();
    limits.spend = tight(2);
    let daemon = Daemon::start(limits).await;
    let port = daemon.rpc();

    for _ in 0..2 {
        // A plan-mode turn parses and plans; it is the daemon's spend-tier method, and
        // the mock provider behind it means no key, no network, no bill.
        rpc_ok(port, OWNER, "agent.turn", json!(["/review the diff"])).await;
    }

    let code = rpc_code(port, OWNER, "agent.turn", json!(["/review the diff"])).await;
    assert_eq!(
        code, -32004,
        "a caller past the spend ceiling reached the model path"
    );
    let message = {
        let (_status, body) = rpc(port, OWNER, "agent.turn", json!(["/review the diff"])).await;
        body["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .to_string()
    };
    assert!(
        message.contains("rate limited") && message.contains("retry after"),
        "the refusal did not name a wait: {message}"
    );

    daemon.shutdown().await;
}

/// Audit H-01, the property that decides whether a limit is a service or an outage:
/// one identity's ceiling is not another's, and a flood of unauthenticated probes is
/// bounded too.
#[tokio::test]
async fn a_ceiling_belongs_to_the_identity_that_earned_it() {
    let mut limits = tiers();
    limits.auth = tight(2);
    let daemon = Daemon::start(limits).await;
    let port = daemon.rpc();
    let first_run = owned_run(port).await;
    let second_run = owned_run(port).await;

    // Two phones, so the gate tier can be measured per device.
    let phone_a = uuid::Uuid::new_v4().to_string();
    let phone_b = uuid::Uuid::new_v4().to_string();
    rpc_ok(port, OWNER, "pairing.create", json!([phone_a, "secret-a"])).await;
    rpc_ok(port, OWNER, "pairing.create", json!([phone_b, "secret-b"])).await;

    // Phone A spends its burst and is then refused.
    rpc_ok(
        port,
        "secret-a",
        "gates.approve",
        json!([first_run, "gate_a"]),
    )
    .await;
    rpc_ok(
        port,
        "secret-a",
        "gates.approve",
        json!([second_run, "gate_a"]),
    )
    .await;
    let code = rpc_code(
        port,
        "secret-a",
        "gates.approve",
        json!([first_run, "gate_b"]),
    )
    .await;
    assert_eq!(code, -32004, "phone A's ceiling did not bind phone A");

    // Phone B, on the same daemon at the same moment, is served: the bucket is keyed
    // on the authenticated device, not on the process.
    rpc_ok(
        port,
        "secret-b",
        "gates.approve",
        json!([first_run, "gate_b"]),
    )
    .await;

    // The owner is its own identity too, and is not answerable for a phone's traffic.
    rpc_ok(port, OWNER, "gates.approve", json!([second_run, "gate_b"])).await;

    daemon.shutdown().await;
}

/// The transport ceiling is measured *before* a credential is judged, so a caller
/// spraying tokens is refused rather than merely unauthenticated forever.
#[tokio::test]
async fn a_flood_of_bad_credentials_is_bounded_at_the_transport() {
    let mut limits = tiers();
    limits.transport = tight(3);
    let daemon = Daemon::start(limits).await;
    let port = daemon.rpc();

    let mut statuses = Vec::new();
    for index in 0..6 {
        let (status, _body) = rpc(
            port,
            &format!("wrong-token-{index}"),
            "projects.list",
            json!([]),
        )
        .await;
        statuses.push(status);
    }

    assert!(
        statuses.contains(&reqwest::StatusCode::UNAUTHORIZED),
        "a wrong token was never refused as unauthenticated: {statuses:?}"
    );
    assert!(
        statuses.contains(&reqwest::StatusCode::TOO_MANY_REQUESTS),
        "an unauthenticated flood was unbounded: {statuses:?}"
    );

    daemon.shutdown().await;
}

/// Re-audit LOAD-1 finding 1, over the wire: a **read** is refused by its own method tier,
/// with the RPC code for a ceiling, while the transport ceiling in front of it is still
/// answering normally.
///
/// This is the pair of facts the measured spike run could not show. It offered 1.34M
/// `projects.list` calls from one identity, served exactly the transport bucket (600 burst
/// + 6,000/min) and returned **zero** `-32004`, because the read methods never reached
/// `authorize()` and so never spent their `standard` tier. The fix has to be visible as a
/// refusal the transport would not have produced, which is what this asserts.
#[tokio::test]
async fn a_read_is_refused_by_the_method_tier_while_the_transport_still_answers() {
    let mut limits = tiers();
    limits.standard = tight(4);
    let daemon = Daemon::start(limits).await;
    let port = daemon.rpc();

    for _ in 0..4 {
        rpc_ok(port, OWNER, "projects.list", json!([])).await;
    }

    let (status, body) = rpc(port, OWNER, "projects.list", json!([])).await;
    assert_eq!(
        status,
        reqwest::StatusCode::OK,
        "the transport refused the request rather than the method tier: {body}"
    );
    assert_eq!(
        body["error"]["code"].as_i64(),
        Some(-32004),
        "the standard tier did not bind the read it is assigned to: {body}"
    );
    let message = body["error"]["message"].as_str().unwrap_or_default();
    assert!(
        message.contains("rate limited") && message.contains("retry after"),
        "the refusal named no wait a client can honour: {message}"
    );

    // The transport is untouched by a drained method bucket, and so is another tier on the
    // same identity: pairing still mints, because it is its own ceiling.
    rpc_ok(
        port,
        OWNER,
        "pairing.create",
        json!(["device-tier", "secret-tier"]),
    )
    .await;

    // And the daemon's unauthenticated listener keeps answering, which is the other half
    // of "the transport tier still works".
    let health = Client::new()
        .get(format!("http://127.0.0.1:{}/health", daemon.http()))
        .send()
        .await
        .expect("the health route answers");
    assert_eq!(health.status(), reqwest::StatusCode::OK);

    daemon.shutdown().await;
}

/// Re-audit LOAD-1 finding 1, the other claim: a read that is no longer authorized-by-
/// omission is still not reachable without a credential. The transport refuses it before
/// the handler runs, and the method's own check refuses an in-process caller that has no
/// session (`every_read_method_refuses_a_caller_with_no_session` in the crate's tests).
#[tokio::test]
async fn a_read_without_a_credential_is_refused_before_it_reads() {
    let daemon = Daemon::start(RateLimitConfig::default()).await;
    let port = daemon.rpc();

    for method in ["projects.list", "health", "runs.list", "providers.list"] {
        let params = if method == "runs.list" {
            json!([uuid::Uuid::new_v4().to_string()])
        } else {
            json!([])
        };
        let (status, body) = rpc(port, "no-such-token", method, params).await;
        assert_eq!(
            status,
            reqwest::StatusCode::UNAUTHORIZED,
            "{method} answered an unauthenticated caller: {body}"
        );
    }

    daemon.shutdown().await;
}

/// A default-configured daemon is not a tight one: a working session does its whole
/// flow without meeting a refusal. This is the guard against a ceiling that ships as an
/// outage.
#[tokio::test]
async fn the_default_ceilings_do_not_interrupt_a_working_session() {
    let daemon = Daemon::start(RateLimitConfig::default()).await;
    let port = daemon.rpc();

    let project = rpc_ok(
        port,
        OWNER,
        "projects.create",
        json!(["Default Shop", "nothing tightened", "en"]),
    )
    .await;
    // 12 runs, each started (spend tier), decided (auth tier) and read (standard tier):
    // 36 requests on one identity. The default spend burst is 20 per minute, so a
    // working session stays inside it while a 40-run loop would not — which is the
    // number this test exists to state.
    for index in 0..12 {
        let run = rpc_ok(
            port,
            OWNER,
            "runs.start",
            json!([project["id"], format!("idea {index}")]),
        )
        .await;
        let id = run["id"].as_str().expect("a run id").to_string();
        rpc_ok(port, OWNER, "gates.approve", json!([id, "gate_a"])).await;
        rpc_ok(port, OWNER, "runs.get", json!([id])).await;
    }

    daemon.shutdown().await;
}
