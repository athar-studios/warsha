//! Integration tests for the daemon's identity, authorization and process policy
//! (security audit H-03, H-04, H-05) — driven through the real transport.
//!
//! These go over the wire on purpose. The three findings are about *where an identity
//! comes from*, and that is decided by the HTTP layer before a method ever runs: a
//! unit test that hands a method a hand-built session would be testing the method's
//! arithmetic, not the claim the audit made. Here a caller sends a credential, the
//! daemon decides who that is, and the test reads back what got recorded.
//!
//! Wire-shape changes are asserted here as well: `gates.approve`/`gates.reject`/
//! `gates.changes` still parse the legacy third positional `device_id`, but it is
//! checked against the session rather than believed, so a client that keeps sending
//! its own device id is refused with `-32003` while a client that stops sending it
//! changes nothing.

use reqwest::Client;
use serde_json::{json, Value};
use std::path::PathBuf;
use tempfile::TempDir;
use warshad::{start_daemon, DaemonConfig, DaemonHandle, RateLimitConfig};

/// The daemon's own bearer token: the owner credential the desktop holds.
const OWNER: &str = "s1a-owner-token";
/// The secret one phone is paired with, which is that phone's whole credential.
const PHONE_SECRET: &str = "a-phone-pairing-secret";

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

/// A running daemon, the ports it answers on, and the data directory it holds a lock
/// in for as long as the test is talking to it.
struct Daemon {
    handle: DaemonHandle,
    _dir: TempDir,
}

impl Daemon {
    async fn start(allowed_commands: Vec<String>) -> Self {
        let dir = fresh_tempdir();
        let config = DaemonConfig {
            data_dir: dir.path().to_path_buf(),
            socket_path: dir.path().join("warshad.sock"),
            http_port: 0,
            ws_port: 0,
            auth_token: OWNER.to_string(),
            allowed_origins: vec!["http://localhost:5173".to_string()],
            allowed_commands,
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

    fn http(&self) -> u16 {
        self.handle.http_port()
    }

    async fn shutdown(self) {
        self.handle.shutdown().await;
    }
}

/// One JSON-RPC call over HTTP, with the credential the caller presents.
///
/// Returns the transport status and the parsed envelope.
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

/// The same call, expecting a result rather than a JSON-RPC error.
async fn rpc_ok(port: u16, token: &str, method: &str, params: Value) -> Value {
    let (status, body) = rpc(port, token, method, params).await;
    assert_eq!(
        status,
        reqwest::StatusCode::OK,
        "{method} did not reach the daemon"
    );
    assert!(
        body.get("result").is_some(),
        "{method} returned an error: {body}"
    );
    body["result"].clone()
}

/// The `code` of a JSON-RPC error, or `None` when the call was served.
async fn rpc_error_code_opt(port: u16, token: &str, method: &str, params: Value) -> Option<i64> {
    let (_status, body) = rpc(port, token, method, params).await;
    body["error"]["code"].as_i64()
}

/// The `code` of a JSON-RPC error a call is expected to have come back with.
async fn rpc_error_code(port: u16, token: &str, method: &str, params: Value) -> i64 {
    let (_status, body) = rpc(port, token, method, params).await;
    body["error"]["code"]
        .as_i64()
        .unwrap_or_else(|| panic!("{method} did not refuse: {body}"))
}

/// A project and a run at its first gate, as the owner would create them.
async fn owned_run(port: u16) -> (String, String) {
    let project = rpc_ok(
        port,
        OWNER,
        "projects.create",
        json!(["S1a Shop", "a gate to decide", "en"]),
    )
    .await;
    let run = rpc_ok(
        port,
        OWNER,
        "runs.start",
        json!([project["id"], "build the shop"]),
    )
    .await;
    (
        project["id"].as_str().expect("a project id").to_string(),
        run["id"].as_str().expect("a run id").to_string(),
    )
}

/// The device id the owner session speaks as: the daemon's own local identity.
async fn owner_device(port: u16) -> String {
    let devices = rpc_ok(port, OWNER, "devices.list", json!([])).await;
    let local = devices
        .as_array()
        .and_then(|list| list.first())
        .expect("the daemon registers its own device");
    assert_eq!(
        local["name"], "Warsha Daemon",
        "the first device is not the daemon's local identity"
    );
    local["device_id"]
        .as_str()
        .expect("a device id")
        .to_string()
}

/// The `by` recorded on a gate of a run, read back over the RPC surface.
async fn gate_state(port: u16, run_id: &str, stage: &str) -> Value {
    let run = rpc_ok(port, OWNER, "runs.get", json!([run_id])).await;
    run["gate_states"][stage].clone()
}

/// Audit H-03: the approver a gate records is the session that decided it, and the
/// legacy `device_id` parameter cannot name somebody else.
#[tokio::test]
async fn a_gate_decision_records_the_session_and_refuses_a_claimed_device() {
    let daemon = Daemon::start(Vec::new()).await;
    let port = daemon.rpc();
    let local = owner_device(port).await;
    let (_project, run) = owned_run(port).await;

    // The workflow the desktop uses today: no device id at all. The daemon still has
    // to know who approved, and it does — from the credential.
    rpc_ok(port, OWNER, "gates.approve", json!([run, "gate_a"])).await;
    let approved = gate_state(port, &run, "gate_a").await;
    assert_eq!(approved["state"], "approved");
    assert_eq!(
        approved["detail"]["by"].as_str(),
        Some(local.as_str()),
        "the approver recorded is not the authenticated owner device"
    );

    // The same decision, claiming a different device: refused, and the gate is
    // untouched. This is the request the audit described as working.
    let claimed = "00000000-0000-0000-0000-000000000001";
    let code = rpc_error_code(
        port,
        OWNER,
        "gates.approve",
        json!([run, "gate_b", claimed]),
    )
    .await;
    assert_eq!(
        code, -32003,
        "a spoofed device id was accepted instead of refused"
    );
    assert_eq!(
        gate_state(port, &run, "gate_b").await["state"],
        "pending",
        "a refused decision still changed the gate"
    );

    // A client that sends the id it *was* authenticated as still works: the field is
    // checked, not removed from the wire shape.
    rpc_ok(port, OWNER, "gates.approve", json!([run, "gate_b", local])).await;
    assert_eq!(gate_state(port, &run, "gate_b").await["state"], "approved");

    // And the other two decisions behave the same way.
    let code = rpc_error_code(
        port,
        OWNER,
        "gates.reject",
        json!([run, "gate_c", "not yet", claimed]),
    )
    .await;
    assert_eq!(code, -32003, "a rejection accepted a claimed device id");
    rpc_ok(
        port,
        OWNER,
        "gates.changes",
        json!([run, "gate_c", "tighten the brief"]),
    )
    .await;
    let changed = gate_state(port, &run, "gate_c").await;
    assert_eq!(changed["state"], "changes_requested");
    assert_eq!(
        changed["detail"]["by"].as_str(),
        Some(local.as_str()),
        "a change request recorded the wrong decider"
    );

    daemon.shutdown().await;
}

/// Audit H-04: a bearer token maps to an identity and a role, and a paired device
/// cannot reach the owner's mutations.
#[tokio::test]
async fn a_paired_device_is_a_session_but_not_the_owner() {
    let daemon = Daemon::start(Vec::new()).await;
    let port = daemon.rpc();
    let phone = uuid::Uuid::new_v4().to_string();

    // Only the owner can mint a credential.
    rpc_ok(
        port,
        OWNER,
        "pairing.create",
        json!([phone.clone(), PHONE_SECRET]),
    )
    .await;

    // The phone's secret is now a session: reads and gate decisions work, and are
    // recorded against the phone.
    let (_project, run) = owned_run(port).await;
    rpc_ok(port, PHONE_SECRET, "projects.list", json!([])).await;
    rpc_ok(port, PHONE_SECRET, "gates.approve", json!([run, "gate_a"])).await;
    let approved = gate_state(port, &run, "gate_a").await;
    assert_eq!(
        approved["detail"]["by"].as_str(),
        Some(phone.as_str()),
        "a paired device's decision was not recorded as its own"
    );

    // A phone cannot sign as the desktop.
    let local = owner_device(port).await;
    let code = rpc_error_code(
        port,
        PHONE_SECRET,
        "gates.approve",
        json!([run, "gate_b", local]),
    )
    .await;
    assert_eq!(
        code, -32003,
        "a paired device claimed the owner's device id"
    );

    // The owner's mutations are closed to it, each with the same refusal. The params
    // are well formed on purpose: what a phone gets is the authorization refusal
    // (`-32002`), not a parse error that would hide it.
    let project_id = uuid::Uuid::new_v4().to_string();
    for (method, params) in [
        ("budget.set", json!([project_id, 500])),
        (
            "providers.add",
            json!(["p", "open_router", "sk-not-a-key", null]),
        ),
        ("providers.remove", json!(["p"])),
        ("providers.test", json!(["p"])),
        ("process.spawn", json!(["npm", [], {}])),
        ("process.stop", json!(["proc-1"])),
        (
            "mcp.connect",
            json!([{"name": "x", "transport": {"kind": "stdio"}, "command": "npm", "args": []}]),
        ),
        ("mcp.call", json!(["x", "tool", {}])),
        ("runmode.set", json!([local_run_mode()])),
        ("roles.set", json!([role_config()])),
        ("devices.revoke", json!([project_id])),
        (
            "pairing.create",
            json!(["another-device", "another-secret"]),
        ),
        ("pairing.revoke", json!(["another-device"])),
        // `backend.set` carries a whole backend kit; its paired-device refusal is
        // asserted where the kit can be built as a value (the daemon's unit tests).
        ("handoff.create", json!(["run", []])),
        ("handoff.apply", json!(["/tmp/bundle.json", true])),
        ("agent.turn", json!(["/review the diff"])),
        ("routines.run_now", json!(["a-routine"])),
        ("routines.pause", json!(["a-routine"])),
        ("routines.resume", json!(["a-routine"])),
        ("preview.start", json!(["p1", "npm run dev"])),
        ("preview.stop", json!(["p1"])),
        ("projects.create", json!(["p", "d", "en"])),
        ("runs.start", json!([project_id, "an idea"])),
        ("backend.export", json!(["run", "/tmp"])),
    ] {
        let code = rpc_error_code(port, PHONE_SECRET, method, params).await;
        assert_eq!(code, -32002, "{method} was reachable by a paired device");
    }

    // `devices.pair` is a Session-policy method: a paired device CAN redeem / register a pairing.
    rpc_ok(
        port,
        PHONE_SECRET,
        "devices.pair",
        json!([pairing_data(&project_id)]),
    )
    .await;

    // A credential that is nobody's is not a session at all.
    let (status, _body) = rpc(port, "not-a-credential", "projects.list", json!([])).await;
    assert_eq!(
        status,
        reqwest::StatusCode::UNAUTHORIZED,
        "an unknown token reached the RPC surface"
    );

    // Revoking the pairing stops the session on its next request, not on a restart.
    rpc_ok(port, OWNER, "pairing.revoke", json!([phone])).await;
    let (status, _) = rpc(port, PHONE_SECRET, "projects.list", json!([])).await;
    assert_eq!(
        status,
        reqwest::StatusCode::UNAUTHORIZED,
        "a revoked pairing still opened a session"
    );

    daemon.shutdown().await;
}

/// Audit H-05: an owner may start a program, but only one its configuration allows,
/// without an environment that hijacks execution, and only over an allowed transport.
#[tokio::test]
async fn process_and_mcp_control_are_owner_only_and_bounded_by_configuration() {
    // One allowed program, named by the daemon's configuration rather than by a caller.
    let daemon = Daemon::start(vec!["cargo".to_string()]).await;
    let port = daemon.rpc();

    // A program the list does not carry is refused before anything is spawned.
    let code = rpc_error_code(
        port,
        OWNER,
        "process.spawn",
        json!(["rm", ["-rf", "/"], {}]),
    )
    .await;
    assert_eq!(code, -32005, "an unlisted program was started");

    // Shell syntax in a program name is refused even if the shell itself were listed.
    let code = rpc_error_code(port, OWNER, "process.spawn", json!(["sh; id", [], {}])).await;
    assert_eq!(code, -32005, "shell syntax reached the process table");

    // An environment variable that changes what a program is stays refused; one that
    // does not is handed over.
    let code = rpc_error_code(
        port,
        OWNER,
        "process.spawn",
        json!(["cargo", ["--version"], {"PATH": "/tmp"}]),
    )
    .await;
    assert_eq!(code, -32005, "PATH was handed to a child process");
    // An allowed program with an ordinary environment is not refused by the policy: it
    // may still fail for its own reasons, which is a different answer from `-32005`.
    let code = rpc_error_code_opt(
        port,
        OWNER,
        "process.spawn",
        json!(["cargo", ["nonexistent-subcommand"], {"MY_PORT": "1"}]),
    )
    .await;
    assert_ne!(
        code,
        Some(-32005),
        "an ordinary environment variable was refused by the policy"
    );

    // A stdio MCP server's program is bounded the same way; a remote transport is
    // bounded to a secure or loopback endpoint.
    let code = rpc_error_code(
        port,
        OWNER,
        "mcp.connect",
        json!([{"name": "n", "transport": {"kind": "stdio"}, "command": "sh", "args": []}]),
    )
    .await;
    assert_eq!(code, -32005, "an unlisted stdio MCP program connected");
    let code = rpc_error_code(
        port,
        OWNER,
        "mcp.connect",
        json!([{"name": "n", "transport": {"kind": "http", "url": "http://evil.example/mcp"}, "command": null, "args": []}]),
    )
    .await;
    assert_eq!(code, -32005, "a plain remote MCP endpoint was recorded");
    rpc_ok(
        port,
        OWNER,
        "mcp.connect",
        json!([{"name": "secure", "transport": {"kind": "http", "url": "https://mcp.example/mcp"}, "command": null, "args": []}]),
    )
    .await;

    // A preview is a dev server: the same command policy, on the first word of the
    // line the pipeline would split.
    let code = rpc_error_code(port, OWNER, "preview.start", json!(["p1", "npm run dev"])).await;
    assert_eq!(
        code, -32005,
        "a preview started a program the policy refuses"
    );

    // And none of this is reachable by a paired device at all: the role gate comes
    // first, so a phone cannot even ask.
    let phone = uuid::Uuid::new_v4().to_string();
    rpc_ok(port, OWNER, "pairing.create", json!([phone, PHONE_SECRET])).await;
    let code = rpc_error_code(
        port,
        PHONE_SECRET,
        "process.spawn",
        json!(["cargo", [], {}]),
    )
    .await;
    assert_eq!(code, -32002, "a paired device reached the process table");
    let code = rpc_error_code(
        port,
        PHONE_SECRET,
        "mcp.connect",
        json!([{"name": "n", "transport": {"kind": "stdio"}, "command": "cargo", "args": []}]),
    )
    .await;
    assert_eq!(code, -32002, "a paired device reached the MCP surface");

    daemon.shutdown().await;
}

/// A caller with no session reaches no method that was authorized — the transport's
/// 401 — and a token that is nearly right is refused the same way as one that is not.
#[tokio::test]
async fn no_credential_and_a_near_miss_reach_no_authorized_method() {
    let daemon = Daemon::start(Vec::new()).await;
    let port = daemon.rpc();

    for method in [
        "gates.approve",
        "budget.set",
        "process.spawn",
        "pairing.create",
    ] {
        let (status, _) = rpc(port, "", method, json!([])).await;
        assert_eq!(
            status,
            reqwest::StatusCode::UNAUTHORIZED,
            "{method} answered a caller with no credential"
        );
    }

    // A prefix of the real token is not the real token, and is refused identically.
    let near: String = OWNER.chars().take(OWNER.len() - 1).collect();
    let (status, _) = rpc(port, &near, "projects.list", json!([])).await;
    assert_eq!(status, reqwest::StatusCode::UNAUTHORIZED);

    // `/health` on the HTTP listener stays the one unauthenticated route.
    let response = Client::new()
        .get(format!("http://127.0.0.1:{}/health", daemon.http()))
        .send()
        .await
        .expect("the daemon answers");
    assert_eq!(response.status(), reqwest::StatusCode::OK);

    daemon.shutdown().await;
}

/// A pairing whose device id is not a device id may open a session but cannot be
/// recorded as an approver: the daemon refuses rather than inventing an identity.
#[tokio::test]
async fn a_pairing_that_names_no_device_id_cannot_decide_a_gate() {
    let daemon = Daemon::start(Vec::new()).await;
    let port = daemon.rpc();
    let (_project, run) = owned_run(port).await;

    rpc_ok(
        port,
        OWNER,
        "pairing.create",
        json!(["not-a-uuid", "legacy-secret"]),
    )
    .await;

    // The session is real — it can read — but a decision has no device to record.
    rpc_ok(port, "legacy-secret", "projects.list", json!([])).await;
    let code = rpc_error_code(
        port,
        "legacy-secret",
        "gates.approve",
        json!([run, "gate_a"]),
    )
    .await;
    assert_eq!(
        code, -32003,
        "a session with no device id was allowed to record an approver"
    );
    assert_eq!(gate_state(port, &run, "gate_a").await["state"], "pending");

    daemon.shutdown().await;
}

/// The param shapes the owner-gated methods expect, so a refusal under test is the
/// authorization one rather than a parameter error in front of it.
fn local_run_mode() -> Value {
    json!({
        "mode": "local",
        "bind_host": "127.0.0.1",
        "allowed_hosts": [],
        "relay_url": null,
    })
}

fn role_config() -> Value {
    json!({
        "role": "coder",
        "targets": [],
        "fallback_enabled": false,
        "budget_cents_per_run": null,
    })
}

fn pairing_data(device_id: &str) -> Value {
    let thirty_two = |byte: u8| -> Vec<u8> { (0..32).map(|_| byte).collect() };
    json!({
        "device_id": device_id,
        "static_public": thirty_two(0),
        "relay_url": null,
        "pairing_secret": thirty_two(7),
        "expires_at": "2100-01-01T00:00:00Z",
    })
}
