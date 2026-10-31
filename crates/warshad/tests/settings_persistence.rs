//! D1 — the daemon's settings survive a restart (PLAN.md M20).
//!
//! The seam under test is the daemon's own RPC surface: the first daemon is told
//! to change a setting, it is shut down, and a second daemon is started on the same
//! data directory and asked what the setting is. Nothing is read or written behind
//! the daemon's back — no test opens `warsha.db` itself — because the promise is
//! that a change made *through the daemon* is still there afterwards.
//!
//! All four stored records are covered: a run mode, a backend kit, a recorded taste
//! signal and a phone pairing. The two easy kinds the plan names (a run mode and a
//! backend kit) are the two that carry the most structure; the other two are here
//! because "settings persist" has to mean all of them or it means nothing about
//! the ones that were left out.

use std::path::Path;

use reqwest::Client;
use serde_json::{json, Value};
use tempfile::tempdir;
use warshad::{start_daemon, DaemonConfig};

/// The token both daemons in a test are started with.
const TEST_TOKEN: &str = "settings-persistence-token";

/// The relay a Hosted run mode is not valid without.
const RELAY_URL: &str = "wss://relay.example.invalid";

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

    /// Call one method and hand back its `result`.
    ///
    /// A JSON-RPC error fails the test with the daemon's own message, which is
    /// the point: a setting that could not be stored must not read as a setting.
    async fn call(&self, method: &str, params: Value) -> Value {
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
        let body = response
            .json::<Value>()
            .await
            .expect("the response is JSON");
        assert!(
            body.get("error").is_none(),
            "{method} failed: {}",
            body["error"]
        );
        body["result"].clone()
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

#[tokio::test]
async fn every_stored_setting_comes_back_after_a_restart() {
    let dir = tempdir().expect("a temporary directory");
    let data_dir = dir.path().to_path_buf();

    // ---- The first life: change one setting of each kind through the RPCs. ----
    let first = start_daemon(config(&data_dir))
        .await
        .expect("the first daemon starts");
    let rpc = Rpc::new(first.rpc_port());

    // A project and a run: `backend.set` and `preferences.list` are addressed by
    // run and by project respectively, so both need a stored project to resolve.
    let project = rpc
        .call("projects.create", json!(["Shop", "A shop", "en"]))
        .await;
    let project_id = project["id"].as_str().expect("the project id").to_string();
    let run = rpc
        .call("runs.start", json!([project_id, "Sell things online"]))
        .await;
    let run_id = run["id"].as_str().expect("the run id").to_string();

    // (1) A run mode. Hosted is stored only if it names a relay, so this also
    // proves the stored config is the one that passed validation.
    let stored_mode = rpc
        .call(
            "runmode.set",
            json!([{
                "mode": "hosted",
                "bind_host": "127.0.0.1",
                "allowed_hosts": [],
                "relay_url": RELAY_URL,
            }]),
        )
        .await;
    assert_eq!(stored_mode["mode"], "hosted");
    assert_eq!(stored_mode["relay_url"], RELAY_URL);

    // (2) A backend kit, with a table on it, for the project behind the run.
    let kit = json!({
        "config": {
            "kind": "pocket_base",
            "url": "http://127.0.0.1:8090",
            "project_name": "Shop",
            "enabled_features": [],
        },
        "tables": [{
            "name": "orders",
            "columns": [
                { "name": "id", "col_type": "TEXT", "nullable": false },
                { "name": "note", "col_type": "TEXT", "nullable": true },
            ],
        }],
        "rls_policies": [],
        "storage_buckets": [],
        "functions": [],
    });
    rpc.call("backend.set", json!([run_id, kit])).await;

    // (3) A taste signal, recorded against the project. The timestamp is "now"
    // because a signal's score is decayed against the daemon's clock: a made-up
    // older timestamp would store a decayed score and the row would say less.
    let recorded_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("the clock is after 1970")
        .as_secs();
    let rows = rpc
        .call(
            "preferences.record",
            json!([{
                "id": "signal-1",
                "project_id": project_id,
                "owner_id": "owner-1",
                "kind": "approve",
                "target": "src/money.rs",
                "weight": 1.0,
                "recorded_at": recorded_at,
            }]),
        )
        .await;
    let recorded = rows.as_array().expect("the recorded rows");
    assert_eq!(recorded.len(), 1, "one target was signalled, got {rows}");
    assert_eq!(recorded[0]["key"], "src/money.rs");
    let recorded_score = recorded[0]["score"].as_f64().expect("the recorded score");
    assert!(
        recorded_score > 0.0,
        "an approval scores above zero, got {recorded_score}"
    );

    // (4) A phone pairing.
    let pairing = rpc
        .call("pairing.create", json!(["phone-1", "secret-1"]))
        .await;
    assert_eq!(pairing["device_id"], "phone-1");
    assert_eq!(pairing["revoked"], false);

    first.shutdown().await;

    // ---- The second life: the same data directory, a fresh daemon. ----
    let second = start_daemon(config(&data_dir))
        .await
        .expect("the second daemon starts on the same data directory");
    let rpc = Rpc::new(second.rpc_port());

    // The run mode came back, and the modes never saved still report their
    // defaults, so the switch is whole rather than only remembering one row.
    let modes = rpc.call("runmode.list", json!([])).await;
    let modes = modes.as_array().expect("the mode list");
    let hosted = modes
        .iter()
        .find(|mode| mode["mode"] == "hosted")
        .expect("the hosted mode is listed");
    assert_eq!(hosted["relay_url"], RELAY_URL);
    assert_eq!(hosted["bind_host"], "127.0.0.1");
    let local = modes
        .iter()
        .find(|mode| mode["mode"] == "local")
        .expect("the local mode is listed");
    assert_eq!(local["relay_url"], Value::Null);

    // The backend kit came back with its table, resolved through the run.
    let kit = rpc.call("backend.get", json!([run_id])).await;
    assert_eq!(kit["config"]["project_name"], "Shop");
    assert_eq!(kit["tables"][0]["name"], "orders");
    assert_eq!(
        kit["tables"][0]["columns"].as_array().map(Vec::len),
        Some(2)
    );

    // The taste row came back, score and all.
    let rows = rpc.call("preferences.list", json!([project_id])).await;
    let rows = rows.as_array().expect("the stored rows");
    assert_eq!(rows.len(), 1, "one stored target, got {rows:?}");
    assert_eq!(rows[0]["key"], "src/money.rs");
    assert_eq!(rows[0]["score"].as_f64(), Some(recorded_score));
    assert_eq!(rows[0]["evidence_count"], 1);

    // The pairing came back active.
    let pairings = rpc.call("pairing.list", json!([])).await;
    let pairings = pairings.as_array().expect("the pairing list");
    assert_eq!(pairings.len(), 1, "one pairing, got {pairings:?}");
    assert_eq!(pairings[0]["device_id"], "phone-1");
    assert_eq!(pairings[0]["revoked"], false);

    second.shutdown().await;

    // The settings live in the database the projects do: one file, not two.
    assert!(data_dir.join("warsha.db").exists());
}

#[tokio::test]
async fn a_revoked_pairing_stays_revoked_and_a_refused_setting_is_not_stored() {
    let dir = tempdir().expect("a temporary directory");
    let data_dir = dir.path().to_path_buf();

    let first = start_daemon(config(&data_dir))
        .await
        .expect("the first daemon starts");
    let rpc = Rpc::new(first.rpc_port());

    rpc.call("pairing.create", json!(["phone-1", "secret-1"]))
        .await;
    let revoked = rpc.call("pairing.revoke", json!(["phone-1"])).await;
    assert_eq!(revoked["revoked"], true);

    // A good Hosted mode first, so the refused one below has a stored row to leave
    // alone rather than an empty table to agree with.
    rpc.call(
        "runmode.set",
        json!([{
            "mode": "hosted",
            "bind_host": "127.0.0.1",
            "allowed_hosts": [],
            "relay_url": RELAY_URL,
        }]),
    )
    .await;

    // A mode that cannot be served is refused: no relay, on a wide bind.
    let response = rpc
        .client
        .post(format!("http://127.0.0.1:{}", rpc.rpc_port))
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "runmode.set",
            "params": [{
                "mode": "hosted",
                "bind_host": "0.0.0.0",
                "allowed_hosts": [],
                "relay_url": null,
            }],
        }))
        .send()
        .await
        .expect("the RPC request is sent");
    let body = response
        .json::<Value>()
        .await
        .expect("the response is JSON");
    assert!(
        body.get("error").is_some(),
        "a Hosted mode on a wide bind with no relay must be refused, got {body}"
    );

    first.shutdown().await;

    let second = start_daemon(config(&data_dir))
        .await
        .expect("the second daemon starts");
    let rpc = Rpc::new(second.rpc_port());

    let pairings = rpc.call("pairing.list", json!([])).await;
    assert_eq!(
        pairings[0]["revoked"], true,
        "a revocation is a setting too, and it is not undone by a restart"
    );

    let modes = rpc.call("runmode.list", json!([])).await;
    let hosted = modes
        .as_array()
        .expect("the mode list")
        .iter()
        .find(|mode| mode["mode"] == "hosted")
        .cloned()
        .expect("the hosted mode is listed");
    assert_eq!(
        hosted["relay_url"], RELAY_URL,
        "the refused config was not stored over the good one"
    );

    second.shutdown().await;
}
