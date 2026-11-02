//! C2 — Agent mode reaches the provider the owner configured, through the daemon,
//! and the routing, the approval history and the todos are still there after a
//! restart.
//!
//! Four seams used to be open, and this file walks them in one story:
//!
//! - `providers.add` stored a row and filed a key, but the provider router only ever
//!   held the mock, so no turn or stage could reach what the owner had configured;
//! - `roles.set` accepted a routing and threw it away, so there was no way to say
//!   which provider speaks for the agent role;
//! - neither survived a restart, because neither was written anywhere;
//! - the agent loop's mode, approval history and todos lived in memory, so a restart
//!   forgot who approved what.
//!
//! # Offline by construction
//!
//! Every daemon here is started with [`start_daemon_with_provider_factory`] and
//! [`MockProviderFactory`]: a configured row becomes the workspace's mock adapter under
//! the same id. Nothing in this file holds a real key, reaches a model API, or spends a
//! cent (AGENTS.md). The production factory — the one that reads the OS keychain and
//! calls the endpoint — is `KeychainProviderFactory`, and what is tested here is the
//! path a configured provider takes to become callable, which is the same path either
//! factory walks.
//!
//! # Restart discipline
//!
//! The restart tests do not open `warsha.db` or the settings documents behind the
//! daemon's back. They shut one daemon down, start a second over the same data
//! directory, and ask it the same questions — which is the only way to test what an
//! owner gets rather than what a file contains.

use std::path::Path;
use std::sync::Arc;

use reqwest::Client;
use serde_json::{json, Value};
use tempfile::tempdir;
use warsha_providers::InMemorySecretStore;
use warshad::{start_daemon_with_provider_factory, DaemonConfig, MockProviderFactory};

/// The token every daemon in this file is started with: the owner's own.
const TEST_TOKEN: &str = "agent-provider-token";

/// A key that is not a key. It never leaves the process, and the answer the provider
/// gives is the mock's canned line.
const FAKE_KEY: &str = "sk-c2-fake-key-for-the-mock-adapter";

/// The provider the tests configure. `qwen` is a one-click kind, so the daemon knows
/// its endpoint and model without the owner naming either.
const PROVIDER: &str = "my-qwen";
const KIND: &str = "qwen";

/// The role an agent turn is routed as — the owner's own conversation (`Intake`).
const AGENT_ROLE_NAME: &str = "intake";

/// One daemon's RPC surface.
struct Rpc {
    client: Client,
    rpc_port: u16,
}

impl Rpc {
    /// A client for one daemon's RPC port, speaking as the owner.
    fn new(rpc_port: u16) -> Self {
        let client = Client::builder()
            .default_headers({
                let mut headers = reqwest::header::HeaderMap::new();
                headers.insert(
                    reqwest::header::AUTHORIZATION,
                    format!("Bearer {TEST_TOKEN}")
                        .parse()
                        .expect("a valid header"),
                );
                headers
            })
            .build()
            .expect("a reqwest client");
        Rpc { client, rpc_port }
    }

    /// Call one method and hand back its `result`, failing on a refusal.
    async fn call(&self, method: &str, params: Value) -> Value {
        let body = self.post(method, params).await;
        if let Some(error) = body.get("error") {
            panic!("{method} was refused: {error}");
        }
        body["result"].clone()
    }

    /// Call one method and hand back the `error` object, failing if it answered.
    async fn call_refused(&self, method: &str, params: Value) -> Value {
        let body = self.post(method, params).await;
        match body.get("error") {
            Some(error) => error.clone(),
            None => panic!(
                "{method} was expected to refuse, but it answered {}",
                body["result"]
            ),
        }
    }

    /// The wire call both helpers share.
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
        response.json::<Value>().await.expect("the answer is JSON")
    }

    /// Configure a provider through the daemon, as the wizard does.
    async fn add_provider(&self) {
        self.call(
            "providers.add",
            json!({ "name": PROVIDER, "kind": KIND, "key": FAKE_KEY, "api_base": Value::Null }),
        )
        .await;
    }

    /// Route a role to a provider, as the settings screen would.
    async fn route(&self, role: &str, provider: &str, budget_cents: Value) -> Value {
        self.call(
            "roles.set",
            json!({
                "config": {
                    "role": role,
                    "targets": [{ "provider_id": provider, "model_id": "cheapest", "weight": 100 }],
                    "fallback_enabled": false,
                    "budget_cents_per_run": budget_cents,
                }
            }),
        )
        .await
    }

    /// One turn of the owner's conversation.
    async fn turn(&self, input: &str) -> Value {
        self.call("agent.turn", json!({ "input": input })).await
    }

    /// What the agent loop is right now: mode, approvals, todos.
    async fn state(&self) -> Value {
        self.call("agent.state", json!([])).await
    }

    /// Approve Agent mode for this session.
    async fn approve_agent_mode(&self) -> Value {
        self.call("agent.approve_mode", json!([])).await
    }

    /// The roles the daemon reports, by role name.
    async fn roles(&self) -> Value {
        self.call("roles.list", json!([])).await
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
        allowed_commands: Vec::new(),
        rate_limits: warshad::RateLimitConfig::default(),
    }
}

/// A daemon over `data_dir`, with the offline provider factory and its own secret store.
async fn daemon(data_dir: &Path) -> (warshad::DaemonHandle, Rpc) {
    let handle = start_daemon_with_provider_factory(
        config(data_dir),
        Arc::new(InMemorySecretStore::new()),
        Arc::new(MockProviderFactory::new()),
    )
    .await
    .expect("the daemon starts");
    let rpc = Rpc::new(handle.rpc_port());
    (handle, rpc)
}

/// The whole C2 story on one daemon: configure, route, approve, and the model answers.
#[tokio::test]
async fn agent_mode_reaches_the_provider_the_owner_configured_and_routed() {
    let dir = tempdir().expect("a temporary directory");
    let (handle, rpc) = daemon(dir.path()).await;

    // Before anything is configured, a turn says honestly that it planned only: no
    // provider, no edit, no spend. This is the state every automated test lives in.
    let first = rpc.turn("a booking app for a dental clinic").await;
    assert_eq!(first["mode"], json!("plan"), "a fresh loop plans");

    // The owner configures a provider. Nothing is called by this: a configured row is
    // registered as a deferred adapter, so a daemon with three providers still starts
    // and answers with no network at all.
    rpc.add_provider().await;
    assert_eq!(
        rpc.call("providers.list", json!([])).await[0]["name"],
        json!(PROVIDER)
    );

    // The routing the old daemon silently discarded. `roles.list` now reports it,
    // because the daemon holds the table it drives the router from.
    rpc.route(AGENT_ROLE_NAME, PROVIDER, Value::Null).await;
    let roles = rpc.roles().await;
    assert_eq!(roles.as_array().expect("a list of routings").len(), 1);
    assert_eq!(roles[0]["role"], json!(AGENT_ROLE_NAME));
    assert_eq!(roles[0]["targets"][0]["provider_id"], json!(PROVIDER));

    // Agent mode is the owner's decision, and the approver recorded is the session
    // that asked — the daemon's own device, since this is the daemon's own token.
    let transition = rpc.approve_agent_mode().await;
    assert_eq!(transition["from"], json!("plan"));
    assert_eq!(transition["to"], json!("agent"));
    let approved_by = transition["approved_by"].as_str().expect("an approver");
    assert!(
        !approved_by.trim().is_empty(),
        "the approval names a device"
    );

    // And the turn reaches a model: the provider the owner configured, under the name
    // the owner gave it. This single assertion is the gap C2 was opened for.
    let answered = rpc.turn("now write the booking page").await;
    let response = answered["response"].as_str().expect("a response");
    assert!(
        response.starts_with("Summary (model completion):"),
        "an Agent-mode turn with a routed provider is answered by the model: {response}"
    );
    assert!(
        response.contains("Mock response"),
        "the routed provider is the one that answered: {response}"
    );

    handle.shutdown().await;
}

/// The routing and the conversation are what the *next* daemon runs and continues.
#[tokio::test]
async fn a_restart_keeps_the_routing_the_approval_history_and_the_todos() {
    let dir = tempdir().expect("a temporary directory");
    let (handle, rpc) = daemon(dir.path()).await;

    rpc.add_provider().await;
    rpc.route(AGENT_ROLE_NAME, PROVIDER, Value::Null).await;
    rpc.approve_agent_mode().await;
    rpc.turn("first turn").await;
    rpc.turn("second turn").await;

    let before = rpc.state().await;
    assert_eq!(before["mode"], json!("agent"));
    assert_eq!(
        before["approvals"].as_array().expect("one approval").len(),
        1,
        "the approval history is the audit trail"
    );
    let todos_before = before["todos"]
        .as_array()
        .expect("the turn recorded todos")
        .len();
    assert!(
        todos_before >= 2,
        "each turn records a todo, and two turns did: {before}"
    );

    handle.shutdown().await;

    // A second daemon, the same data directory, nothing written behind its back.
    let (second_handle, second) = daemon(dir.path()).await;

    // 1. The routing it never was told about, in the table it never held in memory.
    let roles = second.roles().await;
    assert_eq!(
        roles[0]["targets"][0]["provider_id"],
        json!(PROVIDER),
        "the owner's routing survived the restart: {roles}"
    );

    // 2. The mode, the approval and the todos.
    let after = second.state().await;
    assert_eq!(
        after["mode"],
        json!("agent"),
        "the loop is still in Agent mode"
    );
    assert_eq!(
        after["approvals"], before["approvals"],
        "the history is the same record"
    );
    assert_eq!(
        after["todos"].as_array().expect("the todos").len(),
        todos_before,
        "the todo list came back whole"
    );

    // 3. And the routing is not a report but a wiring: a turn on the second daemon
    //    reaches the configured provider, which means the row was registered as a
    //    callable adapter by the start itself.
    let answered = second.turn("after the restart").await;
    let response = answered["response"].as_str().expect("a response");
    assert_eq!(answered["mode"], json!("agent"));
    assert!(
        response.starts_with("Summary (model completion):"),
        "the restarted daemon's Agent mode is still routed to a provider: {response}"
    );
    assert!(
        response.contains("Mock response"),
        "the provider came back with the routing: {response}"
    );

    second_handle.shutdown().await;
}

/// A routing to a provider that does not exist is refused, and an unknown role is
/// refused, with the router left exactly as it was.
#[tokio::test]
async fn roles_set_refuses_a_routing_it_could_not_honour() {
    let dir = tempdir().expect("a temporary directory");
    let (handle, rpc) = daemon(dir.path()).await;

    // A role the pipeline does not know.
    let unknown_role = rpc
        .call_refused(
            "roles.set",
            json!({
                "config": {
                    "role": "something-else",
                    "targets": [{ "provider_id": PROVIDER, "model_id": "m", "weight": 100 }],
                    "fallback_enabled": false,
                    "budget_cents_per_run": Value::Null,
                }
            }),
        )
        .await;
    assert!(
        unknown_role["message"]
            .as_str()
            .unwrap_or_default()
            .contains("is not one of the roles"),
        "the refusal says which part was wrong: {unknown_role}"
    );

    // A provider the owner never configured: the routing would resolve to nothing at
    // the call, so it is refused here rather than reported as a success.
    rpc.add_provider().await;
    let unknown_provider = rpc
        .call_refused(
            "roles.set",
            json!({
                "config": {
                    "role": AGENT_ROLE_NAME,
                    "targets": [{ "provider_id": "never-added", "model_id": "m", "weight": 100 }],
                    "fallback_enabled": false,
                    "budget_cents_per_run": Value::Null,
                }
            }),
        )
        .await;
    assert!(
        unknown_provider["message"]
            .as_str()
            .unwrap_or_default()
            .contains("is not configured"),
        "a routing to a provider with no row behind it is refused: {unknown_provider}"
    );

    // A target with no model, and a routing with no targets at all.
    for broken in [
        json!({ "role": AGENT_ROLE_NAME, "targets": [], "fallback_enabled": false,
                 "budget_cents_per_run": Value::Null }),
        json!({ "role": AGENT_ROLE_NAME,
                 "targets": [{ "provider_id": PROVIDER, "model_id": "  ", "weight": 100 }],
                 "fallback_enabled": false, "budget_cents_per_run": Value::Null }),
    ] {
        let refused = rpc
            .call_refused("roles.set", json!({ "config": broken }))
            .await;
        assert!(
            refused["message"].as_str().unwrap_or_default().len() > 10,
            "the refusal explains itself: {refused}"
        );
    }

    // Nothing was stored by any of those calls.
    assert_eq!(
        rpc.roles().await,
        json!([]),
        "a refused routing changes nothing"
    );

    // And the one routing that is honoured is reported in the shape the daemon accepts.
    rpc.route(AGENT_ROLE_NAME, PROVIDER, Value::Null).await;
    let stored = rpc.roles().await;
    assert_eq!(
        stored[0]["targets"][0]["model_id"],
        json!("cheapest"),
        "what was stored is what was asked for: {stored}"
    );

    handle.shutdown().await;
}

/// Removing a provider takes its routings with it, so no role is left pointing at a
/// name the owner can no longer see.
#[tokio::test]
async fn removing_a_provider_removes_the_routings_that_named_it() {
    let dir = tempdir().expect("a temporary directory");
    let (handle, rpc) = daemon(dir.path()).await;

    rpc.add_provider().await;
    rpc.route(AGENT_ROLE_NAME, PROVIDER, Value::Null).await;
    rpc.approve_agent_mode().await;
    assert!(rpc.roles().await.as_array().expect("one routing").len() == 1);

    rpc.call("providers.remove", json!({ "name": PROVIDER }))
        .await;

    // The routing is gone from the table and from the stored document.
    assert_eq!(
        rpc.roles().await,
        json!([]),
        "a routing to a removed provider is not kept"
    );

    // The loop is still in Agent mode — a removal is not a mode decision — but the next
    // turn says honestly that nothing is routed, which is the fail-closed answer. It
    // does not silently fall back to the mock.
    let answered = rpc.turn("still there?").await;
    let response = answered["response"].as_str().expect("a response");
    assert!(
        response.starts_with("Summary (model unavailable):"),
        "an unrouted role refuses rather than answering from a provider nobody chose: {response}"
    );

    // A restart agrees: the empty table is the stored table.
    handle.shutdown().await;
    let (second_handle, second) = daemon(dir.path()).await;
    assert_eq!(second.roles().await, json!([]), "the removal was written");
    second_handle.shutdown().await;
}

/// The per-run ceiling an owner puts on the agent routing is the ceiling the router
/// enforces before it spends — the paid-call control, wired to the routing — and it is
/// the ceiling the *next* daemon enforces too.
#[tokio::test]
async fn the_budget_in_the_routing_caps_the_agents_spend_and_comes_back_after_a_restart() {
    let dir = tempdir().expect("a temporary directory");
    let (handle, rpc) = daemon(dir.path()).await;

    rpc.add_provider().await;
    // Zero cents: the cap is closed before the first call.
    rpc.route(AGENT_ROLE_NAME, PROVIDER, json!(0)).await;
    rpc.approve_agent_mode().await;

    let answered = rpc.turn("spend nothing").await;
    let response = answered["response"].as_str().expect("a response");
    assert!(
        response.starts_with("Summary (model unavailable):"),
        "a capped agent does not spend: {response}"
    );

    // The refusal is not a crash and not a silent mock answer: the loop is still in
    // Agent mode, and the spend that was refused is recorded against the cap.
    let state = rpc.state().await;
    assert_eq!(state["mode"], json!("agent"));

    handle.shutdown().await;

    // A second daemon over the same directory: the routing it reads back carries the
    // ceiling, so the cap is enforced by the start itself rather than only by the call
    // that set it.
    let (second_handle, second) = daemon(dir.path()).await;
    let roles = second.roles().await;
    assert_eq!(
        roles[0]["budget_cents_per_run"],
        json!(0),
        "the ceiling is part of the stored routing: {roles}"
    );
    let still_capped = second.turn("spend nothing now").await;
    assert!(
        still_capped["response"]
            .as_str()
            .expect("a response")
            .starts_with("Summary (model unavailable):"),
        "the restarted daemon enforces the same cap: {still_capped}"
    );

    // And an owner who re-routes with no ceiling gets the ceiling lifted: the router
    // cannot forget a budget, so the daemon replaces it with one nothing can reach.
    second.route(AGENT_ROLE_NAME, PROVIDER, Value::Null).await;
    let uncapped = second.turn("now you may answer").await;
    assert!(
        uncapped["response"]
            .as_str()
            .expect("a response")
            .starts_with("Summary (model completion):"),
        "a routing with no ceiling is not a silent cap: {uncapped}"
    );

    second_handle.shutdown().await;
}

/// The daemon's own offline provider is not a name an owner can take over.
#[tokio::test]
async fn the_reserved_mock_provider_name_cannot_be_configured() {
    let dir = tempdir().expect("a temporary directory");
    let (handle, rpc) = daemon(dir.path()).await;

    let refused = rpc
        .call_refused(
            "providers.add",
            json!({ "name": "mock", "kind": KIND, "key": FAKE_KEY, "api_base": Value::Null }),
        )
        .await;
    assert!(
        refused["message"]
            .as_str()
            .unwrap_or_default()
            .contains("the daemon's own offline provider"),
        "the refusal says why: {refused}"
    );
    assert_eq!(rpc.call("providers.list", json!([])).await, json!([]));

    handle.shutdown().await;
}

/// `roles.set` is the owner's, and a caller with no verified session gets nothing.
///
/// The point of the test is what the method used to be: a stub that checked the
/// session and then discarded the routing. A stub is easy to pass — an unauthenticated
/// caller gets the same `Ok` a session does — so the honest check is the pair: the
/// refusal here and the accepted routing in every other test in this file.
#[tokio::test]
async fn an_unauthorized_caller_changes_no_routing() {
    let dir = tempdir().expect("a temporary directory");
    let (handle, rpc) = daemon(dir.path()).await;
    rpc.add_provider().await;

    let anonymous = Client::builder().build().expect("a client with no token");
    let response = anonymous
        .post(format!("http://127.0.0.1:{}", handle.rpc_port()))
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "roles.set",
            "params": {
                "config": {
                    "role": AGENT_ROLE_NAME,
                    "targets": [{ "provider_id": PROVIDER, "model_id": "cheapest", "weight": 100 }],
                    "fallback_enabled": false,
                    "budget_cents_per_run": Value::Null,
                }
            },
        }))
        .send()
        .await
        .expect("the request is sent");
    assert_eq!(
        response.status(),
        reqwest::StatusCode::UNAUTHORIZED,
        "a caller with no verified session is refused at the transport"
    );

    assert_eq!(
        rpc.roles().await,
        json!([]),
        "the refused call changed nothing, in memory or on disk"
    );

    handle.shutdown().await;
}

/// A mode switch back to Plan is recorded too, and the history keeps both.
#[tokio::test]
async fn returning_to_plan_mode_is_recorded_and_stored() {
    let dir = tempdir().expect("a temporary directory");
    let (handle, rpc) = daemon(dir.path()).await;
    rpc.add_provider().await;
    rpc.route(AGENT_ROLE_NAME, PROVIDER, Value::Null).await;

    rpc.approve_agent_mode().await;
    rpc.call("agent.plan_mode", json!([])).await;
    let state = rpc.state().await;
    assert_eq!(state["mode"], json!("plan"), "the safe direction is free");
    assert_eq!(
        state["approvals"].as_array().expect("two switches").len(),
        2,
        "both are in the audit trail"
    );

    // A turn in Plan mode plans, even with a provider routed: the routing does not
    // decide whether a call is made, the mode does.
    let planned = rpc.turn("would you edit this now?").await;
    assert_eq!(planned["mode"], json!("plan"));
    assert!(
        planned["response"]
            .as_str()
            .expect("a response")
            .starts_with("Plan (nothing executed):"),
        "Plan mode executes nothing"
    );

    handle.shutdown().await;
    let (second_handle, second) = daemon(dir.path()).await;
    let after = second.state().await;
    assert_eq!(after["mode"], json!("plan"), "the restart keeps the mode");
    assert_eq!(
        after["approvals"].as_array().expect("two switches").len(),
        2,
        "and keeps who approved them"
    );
    second_handle.shutdown().await;
}
