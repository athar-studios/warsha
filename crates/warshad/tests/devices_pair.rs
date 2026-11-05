//! `devices.pair` over the real transport (task #58).
//!
//! The pairing write is the one RPC the shipped client had never reached: measured against
//! a live daemon, `{ qrData }` answered `-32602 missing field 'pairing_data'` (#54), the
//! key was renamed, and the call then answered `-32602 invalid type: string …, expected
//! struct PairingData` — the client was sending the QR *text* where
//! `crates/warshad/src/lib.rs:781` binds the whole `warsha_remote::PairingData` struct
//! (`crates/warsha-remote/src/lib.rs:112-118`). A unit test against a stub cannot see any
//! of that: the refusal is serde's, produced at or below the transport. So this drives the
//! real daemon over HTTP, the way `gates_list.rs` and `security_identity.rs` do, and pins
//! (1) the struct accepted in the shape `@warsha/client` now sends, (2) the string still
//! refused in serde's own words, and (3) the QR round trip — the bytes the producer puts
//! into the QR *are* the struct's JSON (`to_qr_code`, `crates/warsha-remote/src/lib.rs:156`),
//! so the redeeming side can parse them back and put the same object on the wire.

use reqwest::Client;
use serde_json::{json, Value};
use std::path::PathBuf;
use tempfile::TempDir;
use warsha_remote::{DeviceIdentity, PairingData};
use warshad::{start_daemon, DaemonConfig, DaemonHandle, RateLimitConfig};

/// The daemon's own bearer token: the owner credential the desktop holds. `devices.pair`
/// is an Owner-policy method (`crates/warshad/src/auth.rs:359-363`), so this is the only
/// credential the accepted calls need.
const OWNER: &str = "devices-pair-owner-token";

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

/// A running daemon, the port it answers on, and the data directory it holds a lock
/// in for as long as the test is talking to it.
struct Daemon {
    handle: DaemonHandle,
    _dir: TempDir,
}

impl Daemon {
    async fn start() -> Self {
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

/// One JSON-RPC call over HTTP, with the credential the caller presents.
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

/// One JSON-RPC call that expects a refusal: the error `code`, `message` and `data`
/// exactly as the daemon put them on the wire.
async fn rpc_refusal(port: u16, method: &str, params: Value) -> (i64, String, String) {
    let (status, body) = rpc(port, OWNER, method, params).await;
    assert_eq!(
        status,
        reqwest::StatusCode::OK,
        "{method} never reached the dispatcher"
    );
    let Some(error) = body.get("error") else {
        panic!("{method} answered a result where a refusal was expected: {body}");
    };
    (
        error["code"].as_i64().expect("an error code"),
        error["message"].as_str().unwrap_or_default().to_string(),
        error["data"].as_str().unwrap_or_default().to_string(),
    )
}

/// A fresh identity and pairing, built by the same code the producing side runs
/// (`DeviceIdentity::generate` + `PairingData::new`), so the test's fixture cannot drift
/// from what a real QR plate carries.
fn fresh_pairing() -> (DeviceIdentity, PairingData) {
    let identity = DeviceIdentity::generate("Phone".to_string()).expect("an identity is generated");
    let pairing = PairingData::new(&identity, Some("wss://relay.example.com".to_string()))
        .expect("a pairing is built");
    (identity, pairing)
}

/// The pairing exactly as serde writes it — the object `@warsha/client`'s `PairingData`
/// declares and the daemon's decoder binds.
fn pairing_json(pairing: &PairingData) -> Value {
    serde_json::to_value(pairing).expect("a pairing is JSON")
}

/// The device id as `devices.list` reports it: `DeviceId(Uuid)` serializes to the
/// hyphenated string.
fn device_id_value(identity: &DeviceIdentity) -> Value {
    Value::String(identity.device_id.0.to_string())
}

/// The whole point of #58: the struct, named under the daemon's own key, is accepted by
/// a live daemon — `pair_device` answers `()` — and the device lands in the ledger. The
/// positional call form (`warsha-cli`'s `(pairing,)`, `crates/warsha-cli/src/lib.rs:762`)
/// binds the same argument and is accepted too.
#[tokio::test]
async fn a_pairing_struct_is_accepted_in_the_shape_the_client_now_sends() {
    let daemon = Daemon::start().await;
    let port = daemon.rpc();

    let (first, first_pairing) = fresh_pairing();
    let result = rpc_ok(
        port,
        OWNER,
        "devices.pair",
        json!({ "pairing_data": pairing_json(&first_pairing) }),
    )
    .await;
    assert!(
        result.is_null(),
        "`pair_device` returns `()`; a live daemon answered something other than null: {result}"
    );

    let devices = rpc_ok(port, OWNER, "devices.list", json!([])).await;
    let list = devices.as_array().expect("devices.list is a list");
    let paired = list
        .iter()
        .find(|device| device["device_id"] == device_id_value(&first))
        .unwrap_or_else(|| panic!("the paired device never reached the ledger: {devices}"));
    assert_eq!(paired["name"], "Paired Device");
    assert_eq!(
        paired["static_public"],
        pairing_json(&first_pairing)["static_public"],
        "the ledger stored a different key than the pairing carried"
    );

    // The positional form a same-struct caller (the CLI) uses binds the one argument too.
    let (second, second_pairing) = fresh_pairing();
    rpc_ok(
        port,
        OWNER,
        "devices.pair",
        json!([pairing_json(&second_pairing)]),
    )
    .await;
    let devices = rpc_ok(port, OWNER, "devices.list", json!([])).await;
    assert!(
        devices
            .as_array()
            .expect("devices.list is a list")
            .iter()
            .any(|device| device["device_id"] == device_id_value(&second)),
        "the positional pairing never reached the ledger: {devices}"
    );

    daemon.shutdown().await;
}

/// The refusal the measured bug left behind, pinned so no future client can regress into
/// it: QR *text* under the right key parses at the key and fails at the value, with
/// serde's own words on the wire — `-32602`, `Invalid params`, and an `invalid type`
/// data line naming `struct PairingData`. Never a pairing, never a method-not-found.
#[tokio::test]
async fn a_string_payload_is_still_refused_in_serdes_own_words() {
    let daemon = Daemon::start().await;
    let port = daemon.rpc();

    // What the shipped client sent after #54's rename: a JSON string, named correctly.
    for (shape, params) in [
        (
            "named",
            json!({ "pairing_data": "{\"device_id\":\"dev-1\"}" }),
        ),
        ("positional", json!(["{\"device_id\":\"dev-1\"}"])),
    ] {
        let (code, message, data) = rpc_refusal(port, "devices.pair", params).await;
        assert_eq!(
            code, -32602,
            "the {shape} string payload was refused for a reason other than its params: \
             {message} / {data}"
        );
        assert_eq!(
            message, "Invalid params",
            "the {shape} string refusal carried a message other than jsonrpsee's own"
        );
        assert!(
            data.starts_with("invalid type: string"),
            "the {shape} string payload was refused in a shape other than serde's: {data}"
        );
        assert!(
            data.contains("expected struct PairingData"),
            "the {shape} string refusal did not name the struct the daemon binds: {data}"
        );
    }

    // An object is required, and a *sequence* under the key is refused too — what a client
    // that "fixed" the shape by wrapping the struct in an array would hit. The measured
    // answer is not the plain "expected struct PairingData": jsonrpsee's params replay is
    // self-describing, so serde reads the sequence as the struct's tuple form and its first
    // element — a map — arrives where `device_id` wants the UUID string. That is serde's
    // own words for this payload, and it is pinned as such.
    let (code, _message, data) = rpc_refusal(
        port,
        "devices.pair",
        json!({ "pairing_data": [pairing_json(&fresh_pairing().1)] }),
    )
    .await;
    assert_eq!(code, -32602, "a sequence payload was not refused: {data}");
    assert!(
        data.starts_with("invalid type: map, expected a formatted UUID string"),
        "the sequence payload was refused in a shape other than serde's: {data}"
    );

    daemon.shutdown().await;
}

/// The round trip both ends share, walked against the live daemon: the producer writes
/// the pairing into a QR as `serde_json::to_vec(&pairing)` (`to_qr_code`,
/// `crates/warsha-remote/src/lib.rs:156-169`), the redeeming side parses that text back
/// into the struct (the JSON step of `from_qr_code`, `:171-180`, mirrored by
/// `pairingDataFromQrPayload` in `@warsha/client`), and sends *that* to `devices.pair`.
/// Nothing is lost or reshaped between the plate and the daemon — which is why the fix
/// is the client sending the struct, not the daemon accepting a string.
#[tokio::test]
async fn a_qr_payload_walks_both_ends_of_the_pairing_round_trip() {
    let daemon = Daemon::start().await;
    let port = daemon.rpc();

    // Desktop/CLI side: mint a pairing and encode it the way the QR plate does.
    let (identity, pairing) = fresh_pairing();
    let qr_text = String::from_utf8(serde_json::to_vec(&pairing).expect("a pairing is JSON"))
        .expect("the QR payload is UTF-8");

    // Phone side: read the QR text back into the struct — the exact bytes must decode to
    // an equal pairing, or the two ends have drifted and no wire fix can save them.
    let redeemed: PairingData =
        serde_json::from_str(&qr_text).expect("the QR text parses back into a pairing");
    assert_eq!(redeemed.device_id.0, identity.device_id.0);
    assert_eq!(redeemed.static_public, identity.static_public);
    assert_eq!(redeemed.relay_url, pairing.relay_url);
    assert_eq!(redeemed.pairing_secret, pairing.pairing_secret);
    assert_eq!(redeemed.expires_at, pairing.expires_at);

    // And that struct, sent the way the client now sends it, pairs on the live daemon.
    rpc_ok(
        port,
        OWNER,
        "devices.pair",
        json!({ "pairing_data": pairing_json(&redeemed) }),
    )
    .await;
    let devices = rpc_ok(port, OWNER, "devices.list", json!([])).await;
    assert!(
        devices
            .as_array()
            .expect("devices.list is a list")
            .iter()
            .any(|device| device["device_id"] == device_id_value(&identity)),
        "a pairing that survived the QR round trip never reached the ledger: {devices}"
    );

    // The one thing that must stay refused: the raw QR text as the parameter value.
    let (code, _message, data) =
        rpc_refusal(port, "devices.pair", json!({ "pairing_data": qr_text })).await;
    assert_eq!(code, -32602, "the QR text itself was accepted as a pairing");
    assert!(
        data.starts_with("invalid type: string") && data.contains("expected struct PairingData"),
        "the QR text was refused in a shape other than serde's: {data}"
    );

    daemon.shutdown().await;
}

/// A minted pairing link from `devices.pair-start` authenticates the phone's session,
/// appears in the devices ledger, allows the phone to call Session-policy methods like
/// `devices.pair`, and revoking the device cuts off its access immediately.
#[tokio::test]
async fn a_minted_pairing_authenticates_the_session_and_dies_on_revoke() {
    let daemon = Daemon::start().await;
    let port = daemon.rpc();

    // 1. Owner calls devices.pair-start to mint an offer
    let offer = rpc_ok(port, OWNER, "devices.pair-start", json!([])).await;
    let pairing_link = offer["pairing_link"]
        .as_str()
        .expect("pairing_link is a string");
    let device_id = offer["pairing"]["device_id"]
        .as_str()
        .expect("device_id is a string");
    let qr_code_png = offer["qr_code_png"]
        .as_str()
        .expect("qr_code_png is a string");
    assert!(!pairing_link.is_empty());
    assert!(!qr_code_png.is_empty());

    // Extract the token from the pairing link: ...?server=...&token=<token>
    let url = reqwest::Url::parse(pairing_link).expect("pairing_link parses as URL");
    let phone_token = url
        .query_pairs()
        .find(|(k, _)| k == "token")
        .expect("token param exists in pairing_link")
        .1
        .to_string();
    assert!(!phone_token.is_empty());

    // 2. The phone can now authenticate using that token!
    let (status, body) = rpc(port, &phone_token, "projects.list", json!([])).await;
    assert_eq!(status, reqwest::StatusCode::OK);
    assert!(body.get("result").is_some());

    // 3. The minted device is visible in devices.list
    let devices = rpc_ok(port, OWNER, "devices.list", json!([])).await;
    assert!(
        devices
            .as_array()
            .unwrap()
            .iter()
            .any(|d| d["device_id"] == device_id),
        "minted device was not in devices.list: {devices}"
    );

    // 4. The phone (Session role) can call devices.pair
    let (_second_identity, second_pairing) = fresh_pairing();
    rpc_ok(
        port,
        &phone_token,
        "devices.pair",
        json!({ "pairing_data": pairing_json(&second_pairing) }),
    )
    .await;

    // 5. But the phone CANNOT call Owner-only methods like devices.pair-start or devices.revoke
    let (_, refusal) = rpc(port, &phone_token, "devices.pair-start", json!([])).await;
    assert_eq!(refusal["error"]["code"], -32002);

    // 6. Owner revokes the device
    rpc_ok(port, OWNER, "devices.revoke", json!([device_id])).await;

    // 7. On its very next request, the phone's token is rejected with 401 UNAUTHORIZED!
    let (status, _) = rpc(port, &phone_token, "projects.list", json!([])).await;
    assert_eq!(
        status,
        reqwest::StatusCode::UNAUTHORIZED,
        "revoked device was still able to authenticate"
    );

    daemon.shutdown().await;
}
