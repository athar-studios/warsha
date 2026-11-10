//! `gates.list` over the real transport (issue #25).
//!
//! The queue read is the seam that both apps' gates screens polls, and the whole
//! point of serving it from `Run.gate_states` is that the answer is *not* `[]` and
//! *not* the adjacent-tagged `runs.get` shape. Neither claim is visible from a unit
//! test that calls the handler in-process: name registration, the params the wire
//! accepts, the flat `state`/`by`/`at` shape and the `Session`-tier auth are all
//! decided at or below the transport. So this drives the real daemon, the way
//! `security_identity.rs` drives the real daemon for the decisions.

use reqwest::Client;
use serde_json::{json, Value};
use std::path::PathBuf;
use tempfile::TempDir;
use warshad::{start_daemon, DaemonConfig, DaemonHandle, RateLimitConfig};

/// The daemon's own bearer token: the owner credential the desktop holds.
const OWNER: &str = "gates-list-owner-token";
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

/// A running daemon, the port it answers on, and the data directory it holds a lock
/// in for as long as the test is talking to it.
struct Daemon {
    handle: DaemonHandle,
    _dir: TempDir,
}

impl Daemon {
    async fn start() -> Self {
        std::env::set_var("WARSHA_LLM_PROVIDER", "fake");
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
            // The bind address keeps the loopback default and nothing is advertised:
            // this daemon is only ever dialed from the test process on this machine.
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

/// The daemon's `-32602` for a named-params object that does not carry one required
/// argument, and the field it says it could not bind.
///
/// The `data` line is serde's own `missing field \`x\` at line 1 column N`; that column
/// is a byte position inside *this* payload, so the prefix is what is pinable — the
/// suffix moves with every id length and key order and is not a contract.
async fn assert_missing_param(port: u16, method: &str, params: Value, field: &str) {
    let (code, message, data) = rpc_refusal(port, method, params.clone()).await;
    assert_eq!(
        code, -32602,
        "{method} refused {params} for a reason other than its params: {message} / {data}"
    );
    assert_eq!(
        message, "Invalid params",
        "{method} refused {params} with a message other than jsonrpsee's own"
    );
    assert!(
        data.starts_with(&format!("missing field `{field}`")),
        "{method} refused {params} for a field other than `{field}`: {data}"
    );
}

/// A project and a run, as the owner would create them. The pipeline seeds all four
/// gate stages Pending on `start_run`, which is what the queue reads back.
async fn owned_run(port: u16) -> String {
    let project = rpc_ok(
        port,
        OWNER,
        "projects.create",
        json!(["Gates List Shop", "a queue to read", "en"]),
    )
    .await;
    let run = rpc_ok(
        port,
        OWNER,
        "runs.start",
        json!([project["id"], "build the shop"]),
    )
    .await;
    run["id"].as_str().expect("a run id").to_string()
}

/// The device id the owner session speaks as: the daemon's own local identity.
async fn owner_device(port: u16) -> String {
    let devices = rpc_ok(port, OWNER, "devices.list", json!([])).await;
    let local = devices
        .as_array()
        .and_then(|list| list.first())
        .expect("the daemon registers its own device");
    local["device_id"]
        .as_str()
        .expect("a device id")
        .to_string()
}

/// The name's promise, on the wire: `gates.list` is a registered method — not the
/// `-32601 Method not found` the client used to get — and its answer is the four
/// gate stages in pipeline order, in the *flat* state shape the client declares.
/// A fresh run answers all Pending; the three decisions then move exactly their
/// own rows, and `detail` (the `runs.get` adjacent-tagged shape) is nowhere in it.
#[tokio::test]
async fn the_gates_queue_is_served_over_the_wire_in_the_flat_shape() {
    let daemon = Daemon::start().await;
    let port = daemon.rpc();
    let local = owner_device(port).await;
    let run = owned_run(port).await;

    let queue = rpc_ok(port, OWNER, "gates.list", json!([run.clone()])).await;
    let gates = queue.as_array().expect("the queue is a list");
    assert_eq!(gates.len(), 4, "the queue is not all four gate stages");
    let stages: Vec<&str> = gates
        .iter()
        .map(|gate| gate["stage"].as_str().expect("a stage name"))
        .collect();
    assert_eq!(
        stages,
        vec!["gate_a", "gate_b", "gate_c", "gate_d"],
        "the queue is not in pipeline order"
    );
    for gate in gates {
        assert_eq!(
            gate["state"]["state"].as_str(),
            Some("pending"),
            "a fresh run answered a decided gate: {gate}"
        );
    }

    // Decide gates at their reached stages; the ledger the queue reads is the same one
    // the decisions mutate, so the next read shows them — flat, with `by`/`at` beside
    // `state`. Rejecting `gate_b` pauses this run before `gate_c`, so `gate_c`'s
    // `changes_requested` state is exercised on a second run that approves through `gate_b`.
    rpc_ok(port, OWNER, "runs.advance", json!([run.clone()])).await;
    rpc_ok(port, OWNER, "gates.approve", json!([run, "gate_a"])).await;
    rpc_ok(port, OWNER, "runs.advance", json!([run.clone()])).await;
    rpc_ok(
        port,
        OWNER,
        "gates.reject",
        json!([run, "gate_b", "not this"]),
    )
    .await;

    let decided = rpc_ok(port, OWNER, "gates.list", json!([run.clone()])).await;
    let gates = decided.as_array().expect("the queue is a list");
    assert_eq!(gates[0]["state"]["state"], "approved");
    assert_eq!(
        gates[0]["state"]["by"].as_str(),
        Some(local.as_str()),
        "the flat queue lost the deciding device the session recorded"
    );
    assert!(
        gates[0]["state"]["at"].is_string(),
        "the flat queue lost the decision instant"
    );
    assert_eq!(gates[1]["state"]["state"], "rejected");
    assert_eq!(gates[1]["state"]["reason"], "not this");
    assert_eq!(gates[2]["state"], json!({ "state": "pending" }));
    assert_eq!(gates[3]["state"], json!({ "state": "pending" }));
    for gate in gates.iter() {
        assert!(
            gate["state"].get("detail").is_none(),
            "the queue carried the adjacent-tagged `detail` object instead of the \
             flat shape: {}",
            gate["state"]
        );
    }

    let changes_run = owned_run(port).await;
    rpc_ok(port, OWNER, "runs.advance", json!([changes_run.clone()])).await;
    rpc_ok(port, OWNER, "gates.approve", json!([changes_run, "gate_a"])).await;
    rpc_ok(port, OWNER, "runs.advance", json!([changes_run.clone()])).await;
    rpc_ok(port, OWNER, "gates.approve", json!([changes_run, "gate_b"])).await;
    rpc_ok(port, OWNER, "runs.advance", json!([changes_run.clone()])).await;
    rpc_ok(
        port,
        OWNER,
        "gates.changes",
        json!([changes_run, "gate_c", "tighten"]),
    )
    .await;

    let changes_decided = rpc_ok(port, OWNER, "gates.list", json!([changes_run.clone()])).await;
    let changes_gates = changes_decided.as_array().expect("the queue is a list");
    assert_eq!(changes_gates[0]["state"]["state"], "approved");
    assert_eq!(changes_gates[1]["state"]["state"], "approved");
    assert_eq!(changes_gates[2]["state"]["state"], "changes_requested");
    assert_eq!(changes_gates[2]["state"]["notes"], "tighten");
    assert_eq!(changes_gates[3]["state"], json!({ "state": "pending" }));
    for gate in changes_gates.iter() {
        assert!(
            gate["state"].get("detail").is_none(),
            "the queue carried the adjacent-tagged `detail` object instead of the \
             flat shape: {}",
            gate["state"]
        );
    }

    daemon.shutdown().await;
}

/// A run the store does not have is refused, and an unauthenticated caller never
/// reaches the query at all.
#[tokio::test]
async fn the_gates_queue_refuses_an_unknown_run_and_a_caller_with_no_credential() {
    let daemon = Daemon::start().await;
    let port = daemon.rpc();

    let unknown = ulid::Ulid::new().to_string();
    let (_status, body) = rpc(port, OWNER, "gates.list", json!([unknown])).await;
    assert_eq!(
        body["error"]["code"].as_i64(),
        Some(-32000),
        "a run the store does not have answered a queue: {body}"
    );
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("run not found"),
        "the unknown run was refused for a reason other than the store's error: {body}"
    );

    let (status, _) = rpc(port, "", "gates.list", json!([])).await;
    assert_eq!(
        status,
        reqwest::StatusCode::UNAUTHORIZED,
        "a caller with no credential read the gates queue"
    );

    daemon.shutdown().await;
}

/// #25's auth decision, on the wire: `gates.list` is `Session`/`Standard`, not the
/// `Auth`-tier the three decisions sit on — the phone must be able to read the queue
/// it is asked to decide. (That is what `SimpleMode` polls from the paired device.)
#[tokio::test]
async fn a_paired_phone_reads_the_queue_it_is_asked_to_decide() {
    let daemon = Daemon::start().await;
    let port = daemon.rpc();
    let run = owned_run(port).await;

    let phone = uuid::Uuid::new_v4().to_string();
    rpc_ok(
        port,
        OWNER,
        "pairing.create",
        json!([phone.clone(), PHONE_SECRET]),
    )
    .await;

    let queue = rpc_ok(port, PHONE_SECRET, "gates.list", json!([run])).await;
    assert_eq!(
        queue.as_array().map(Vec::len),
        Some(4),
        "the paired device's queue read was not all four gate stages: {queue}"
    );

    daemon.shutdown().await;
}

/// The three param forms, measured against a real daemon (issue #40).
///
/// `packages/client/src/index.ts` sends named objects, and the daemon's handlers bind
/// named params by their Rust argument name — which is snake_case. The question is
/// whether a camelCase key is a different key. It is not, and the reason is below the
/// daemon's own source: jsonrpsee 0.26.1 generates the named-params decoder as an ad-hoc
/// serde struct per method (`jsonrpsee-proc-macros-0.26.1/src/render_server.rs:398-416`,
/// the `decode_map` block) that carries `#[serde(rename = "<arg>")]` *plus*
/// `#[serde(alias = "<heck snake_case>")]` and `#[serde(alias = "<heck lowerCamelCase>")]`
/// (lines 409-412), and serde ignores unknown fields by default. So positional,
/// snake_case named and camelCase named all bind the same argument, and this pins that —
/// nothing here is a wish about what the wire should do.
///
/// The corollary is the part a "camelCase is broken" reading of the client would miss:
/// the alias is a *casing* of the one argument name, not a general rename. A key that is
/// a different word (`id` for `run_id`) binds nothing, and that refusal is
/// `assert_named_keys_that_are_not_a_casing_of_the_argument_are_refused` below.
///
/// Every assertion here is a *positive binding* proof, not an acceptance proof: a method
/// with a required param cannot answer at all unless the key reached that param, and the
/// two-project control shows a read that would answer empty for a key the daemon ignored.
#[tokio::test]
async fn a_required_param_binds_from_a_positional_array_and_from_either_casing_of_its_name() {
    let daemon = Daemon::start().await;
    let port = daemon.rpc();

    // One project with a run and one without: an ignored key would answer `[]` for both,
    // so a camelCase read that returns the run is read as the binding, not the parsing.
    let busy = rpc_ok(
        port,
        OWNER,
        "projects.create",
        json!(["Busy Shop", "has a run", "en"]),
    )
    .await;
    let idle = rpc_ok(
        port,
        OWNER,
        "projects.create",
        json!(["Idle Shop", "has no run", "en"]),
    )
    .await;
    let busy_id = busy["id"].as_str().expect("a project id").to_string();
    let idle_id = idle["id"].as_str().expect("a project id").to_string();
    let run = rpc_ok(
        port,
        OWNER,
        "runs.start",
        json!([busy_id.clone(), "build it"]),
    )
    .await;
    let run_id = run["id"].as_str().expect("a run id").to_string();

    // (a) positional array, (b) snake_case named, (c) camelCase named — the same answer,
    // because all three reached `project_id: ProjectId`.
    let positional = rpc_ok(port, OWNER, "runs.list", json!([busy_id.clone()])).await;
    let snake = rpc_ok(
        port,
        OWNER,
        "runs.list",
        json!({ "project_id": busy_id.clone() }),
    )
    .await;
    let camel = rpc_ok(
        port,
        OWNER,
        "runs.list",
        json!({ "projectId": busy_id.clone() }),
    )
    .await;
    assert_eq!(
        positional.as_array().map(Vec::len),
        Some(1),
        "the run was not listed for its own project: {positional}"
    );
    assert_eq!(
        camel, snake,
        "camelCase `projectId` did not bind the daemon's `project_id`"
    );
    assert_eq!(
        snake, positional,
        "snake_case `project_id` did not bind the same arg the positional array did"
    );
    let other_project = rpc_ok(port, OWNER, "runs.list", json!({ "projectId": idle_id })).await;
    assert_eq!(
        other_project.as_array().map(Vec::len),
        Some(0),
        "camelCase `projectId` was ignored rather than bound, and answered another \
         project's runs: {other_project}"
    );

    // `gates.list` is the required-plus-optional case: `run_id: RunId` then
    // `device_id: Option<DeviceId>`. All four spellings reach the same queue.
    let by_position = rpc_ok(port, OWNER, "gates.list", json!([run_id.clone()])).await;
    assert_eq!(
        by_position.as_array().map(Vec::len),
        Some(4),
        "the positional queue lost a gate stage: {by_position}"
    );
    for queue_params in [
        json!({ "run_id": run_id.clone() }),
        json!({ "runId": run_id.clone() }),
        json!({ "run_id": run_id.clone(), "device_id": Value::Null }),
        json!({ "runId": run_id, "deviceId": Value::Null }),
    ] {
        let queue = rpc_ok(port, OWNER, "gates.list", queue_params.clone()).await;
        assert_eq!(
            queue, by_position,
            "gates.list did not bind {queue_params} to `run_id`/`device_id` as the \
             positional array binds them"
        );
    }

    // A camelCase read that got as far as the store is the last proof the key bound: an
    // unbound required param would have been refused before any query ran.
    let unknown = ulid::Ulid::new().to_string();
    let (code, message, _) = rpc_refusal(port, "gates.list", json!({ "runId": unknown })).await;
    assert_eq!(
        code, -32000,
        "camelCase `runId` did not reach the store's lookup: {message}"
    );
    assert!(
        message.contains("run not found"),
        "the camelCase unknown-run read refused for a reason other than the store's: {message}"
    );

    // `projects.create` is the three-required-args case, and its three names are single
    // words: casing cannot distinguish them, so what is pinned is which names bind. All
    // three as named keys create the project, and the daemon stored the values it was
    // given under them (`language` is the third, and the project comes back in it).
    let named = rpc_ok(
        port,
        OWNER,
        "projects.create",
        json!({ "name": "Named Params", "description": "three args", "language": "ar" }),
    )
    .await;
    assert_eq!(named["name"], "Named Params");
    assert_eq!(named["description"], "three args");
    assert_eq!(
        named["language"], "ar",
        "the named object did not bind `language` — a project created in the wrong locale"
    );
    let extra_key = rpc_ok(
        port,
        OWNER,
        "projects.create",
        json!({ "name": "Extra Key", "description": "tolerates it", "language": "en", "runId": "not-a-run" }),
    )
    .await;
    assert_eq!(
        extra_key["name"], "Extra Key",
        "an unknown extra named key was not ignored: {extra_key}"
    );

    daemon.shutdown().await;
}

/// The other half of the measurement: the alias is a casing of the argument's name, not
/// a free translation of it. A key that is a different *word* binds nothing, and a
/// required argument that is not bound is `-32602 Invalid params` — never `-32601`, which
/// is a method name the daemon does not register at all, and never a silent empty read.
///
/// These are the two call sites in the shipped client that the casing answer does not
/// rescue (`runs.get` with `{ id }`, `devices.pair` with `{ qrData }`), so the refusal is
/// pinned with the field name the daemon actually asked for.
#[tokio::test]
async fn named_keys_that_are_not_a_casing_of_the_argument_are_refused_as_invalid_params() {
    let daemon = Daemon::start().await;
    let port = daemon.rpc();
    let run_id = owned_run(port).await;

    // `runs.get(run_id: RunId)` — `id` is neither `run_id` nor `runId`.
    assert_missing_param(port, "runs.get", json!({ "id": run_id.clone() }), "run_id").await;
    // Its own spellings do bind, so the refusal above is the key and not the method.
    let run = rpc_ok(port, OWNER, "runs.get", json!({ "runId": run_id.clone() })).await;
    assert_eq!(run["id"], run_id);

    // `devices.pair(pairing_data: PairingData)` — `qrData` is a rename of a different word.
    assert_missing_param(
        port,
        "devices.pair",
        json!({ "qrData": "not a pairing payload" }),
        "pairing_data",
    )
    .await;

    // `projects.create` really does require all three: leaving the last one out is the
    // same refusal, naming the field that is missing.
    assert_missing_param(
        port,
        "projects.create",
        json!({ "name": "Two Of Three", "description": "no language" }),
        "language",
    )
    .await;

    // A required param that is simply absent is a missing field, not a default.
    assert_missing_param(
        port,
        "gates.list",
        json!({ "deviceId": Value::Null }),
        "run_id",
    )
    .await;

    // An unregistered name is `-32601 Method not found` even when its params are a shape
    // the daemon would accept: a client must not read a bad name as a bad param.
    let (code, message, _) = rpc_refusal(port, "runs.status", json!({ "runId": run_id })).await;
    assert_eq!(
        code, -32601,
        "an unregistered method name answered something other than method-not-found"
    );
    assert_eq!(message, "Method not found");

    daemon.shutdown().await;
}
