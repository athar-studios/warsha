//! T1–T7 (R-EXT-4): the Streamable HTTP transport, over a fake client.
//!
//! Nothing here opens a socket. [`FakeHttp`] implements [`McpHttpClient`] and
//! answers from a script, recording every request it was handed, so the assertions
//! read the wire the manager actually built — the `id` it expected, the session it
//! named, the revision it sent, the bound it set — instead of trusting the code
//! under test. What needs a real HTTP client (statuses, redirects, caps, the
//! `DELETE`) is `warshad`'s half and is tested there against a loopback server.
//!
//! The manager's behaviour with **no** client injected is pinned by
//! `mcp_transport`'s own `connect_http_is_recorded_and_not_dialled`, which this
//! packet leaves untouched: that test is the proof that the pipeline still has no
//! network default.

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::sync::Mutex;
use warsha_pipeline::mcp::McpContent;
use warsha_pipeline::mcp_http::{McpHttpClient, McpHttpError, McpHttpReply, McpHttpRequest};
use warsha_pipeline::mcp_transport::{
    InMemoryMcpManager, McpManager, McpServerConfig, McpStatus, McpTransportError,
    DEFAULT_RESPONSE_TIMEOUT,
};
use warsha_pipeline::InMemoryProcessManager;

/// One request the fake was handed, copied out so the assertions read the wire.
#[derive(Debug, Clone)]
struct Sent {
    url: String,
    body: Value,
    expect_id: Option<Value>,
    session_id: Option<String>,
    protocol_version: Option<String>,
    timeout: Duration,
}

/// The MCP server this packet talks to, as a script and a transcript.
///
/// It answers in the order it was scripted and refuses once the script runs out,
/// so a test that expects three handshake steps fails loudly if a fourth is made.
struct FakeHttp {
    script: Mutex<VecDeque<Result<McpHttpReply, McpHttpError>>>,
    sent: Mutex<Vec<Sent>>,
    closed: Mutex<Vec<(String, String)>>,
    close_result: Mutex<Result<(), McpHttpError>>,
}

impl FakeHttp {
    fn new(script: Vec<Result<McpHttpReply, McpHttpError>>) -> Arc<Self> {
        Arc::new(FakeHttp {
            script: Mutex::new(script.into()),
            sent: Mutex::new(Vec::new()),
            closed: Mutex::new(Vec::new()),
            close_result: Mutex::new(Ok(())),
        })
    }

    /// Make every `DELETE` fail — the best-effort teardown case.
    async fn refuse_close(&self) {
        *self.close_result.lock().await = Err(McpHttpError::Unavailable("no DELETE here".into()));
    }

    async fn sent(&self) -> Vec<Sent> {
        self.sent.lock().await.clone()
    }

    async fn closed(&self) -> Vec<(String, String)> {
        self.closed.lock().await.clone()
    }
}

#[async_trait]
impl McpHttpClient for FakeHttp {
    async fn post(&self, url: &str, req: McpHttpRequest) -> Result<McpHttpReply, McpHttpError> {
        self.sent.lock().await.push(Sent {
            url: url.to_string(),
            body: req.body.clone(),
            expect_id: req.expect_id.clone(),
            session_id: req.session_id.clone(),
            protocol_version: req.protocol_version.clone(),
            timeout: req.timeout,
        });
        self.script
            .lock()
            .await
            .pop_front()
            .unwrap_or_else(|| Err(McpHttpError::Protocol("the script ran out".into())))
    }

    async fn close(&self, url: &str, session_id: &str) -> Result<(), McpHttpError> {
        self.closed
            .lock()
            .await
            .push((url.to_string(), session_id.to_string()));
        self.close_result.lock().await.clone()
    }
}

/// A manager with `fake` injected and a spawner that is never used.
fn manager_with(fake: Arc<FakeHttp>) -> InMemoryMcpManager {
    InMemoryMcpManager::new(InMemoryProcessManager::shared()).with_http_client(fake)
}

/// A JSON-RPC reply carrying `result`, addressed to `id`.
fn reply(id: Value, result: Value) -> McpHttpReply {
    McpHttpReply {
        message: Some(json!({ "jsonrpc": "2.0", "id": id, "result": result })),
        session_id: None,
    }
}

/// The `initialize` result a Streamable HTTP server answers with.
fn initialize_result(version: &str) -> Value {
    json!({
        "protocolVersion": version,
        "capabilities": { "tools": {} },
        "serverInfo": { "name": "warsha-test-http-server", "version": "1.0.0" },
    })
}

/// The tools a scripted `tools/list` reply carries.
fn tools_result() -> Value {
    json!({
        "tools": [
            {
                "name": "echo",
                "description": "echo description",
                "inputSchema": { "type": "object" },
            },
            {
                "name": "create_table",
                "description": "create_table description",
                "inputSchema": { "type": "object", "properties": { "name": { "type": "string" } } },
            },
        ],
    })
}

/// The three answers one successful handshake takes, with `session` on the first.
fn handshake_script(session: Option<&str>) -> Vec<Result<McpHttpReply, McpHttpError>> {
    vec![
        Ok(McpHttpReply {
            message: Some(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": initialize_result("2025-06-18"),
            })),
            session_id: session.map(str::to_string),
        }),
        // A notification is answered `202 Accepted` with no body.
        Ok(McpHttpReply {
            message: None,
            session_id: None,
        }),
        Ok(reply(json!(2), tools_result())),
    ]
}

/// T2: the handshake over HTTP reports the server's tools, and carries the session
/// and the negotiated revision on every request after `initialize`.
#[tokio::test]
async fn an_http_handshake_reports_the_servers_tools_and_carries_the_session() {
    let fake = FakeHttp::new(handshake_script(Some("session-1")));
    let mcp = manager_with(Arc::clone(&fake));

    mcp.connect(McpServerConfig::new_http(
        "remote",
        "https://mcp.example/mcp",
    ))
    .await
    .expect("a server that answers the handshake connects");

    let listed = mcp.list().await;
    let connection = listed.first().expect("the connection is listed");
    assert_eq!(connection.status, McpStatus::Connected);
    assert_eq!(
        connection.process_id, None,
        "an HTTP connection has no child to observe"
    );
    assert_eq!(connection.tools, vec!["echo", "create_table"]);
    // Identical in shape to what the stdio handshake reports: the same parser.
    assert_eq!(connection.tool_definitions.len(), 2);
    assert_eq!(connection.tool_definitions[0].name, "echo");
    assert_eq!(
        connection.tool_definitions[0].description,
        "echo description"
    );
    assert_eq!(
        connection.tool_definitions[0].input_schema,
        json!({ "type": "object" })
    );
    assert_eq!(
        connection.tool_definitions[1].input_schema["properties"]["name"],
        json!({ "type": "string" })
    );

    let sent = fake.sent().await;
    assert_eq!(
        sent.len(),
        3,
        "initialize, notifications/initialized, tools/list"
    );
    for request in &sent {
        assert_eq!(request.url, "https://mcp.example/mcp");
        assert_eq!(request.timeout, DEFAULT_RESPONSE_TIMEOUT);
    }
    // Call 1: the request the packet freezes, with no session yet.
    assert_eq!(sent[0].body["method"], "initialize");
    assert_eq!(sent[0].expect_id, Some(json!(1)));
    assert_eq!(sent[0].body["params"]["protocolVersion"], "2025-06-18");
    assert_eq!(
        sent[0].session_id, None,
        "no session exists before initialize"
    );
    assert_eq!(sent[0].protocol_version, None);
    // Call 2: the notification, now inside the session.
    assert_eq!(sent[1].body["method"], "notifications/initialized");
    assert_eq!(
        sent[1].expect_id, None,
        "a notification has no reply to match"
    );
    assert_eq!(sent[1].session_id.as_deref(), Some("session-1"));
    assert_eq!(sent[1].protocol_version.as_deref(), Some("2025-06-18"));
    // Call 3: the list, still inside the session.
    assert_eq!(sent[2].body["method"], "tools/list");
    assert_eq!(sent[2].expect_id, Some(json!(2)));
    assert_eq!(sent[2].session_id.as_deref(), Some("session-1"));
    assert_eq!(sent[2].protocol_version.as_deref(), Some("2025-06-18"));
}

/// A server that names no session: the handshake completes and nothing is echoed,
/// because there is nothing to echo.
#[tokio::test]
async fn a_server_that_issues_no_session_still_connects() {
    let fake = FakeHttp::new(handshake_script(None));
    let mcp = manager_with(Arc::clone(&fake));

    mcp.connect(McpServerConfig::new_http(
        "remote",
        "https://mcp.example/mcp",
    ))
    .await
    .expect("a session is optional");

    assert_eq!(mcp.list().await[0].status, McpStatus::Connected);
    let sent = fake.sent().await;
    assert_eq!(sent[1].session_id, None);
    assert_eq!(sent[2].session_id, None);
    // The revision is still negotiated, so it is still sent.
    assert_eq!(sent[2].protocol_version.as_deref(), Some("2025-06-18"));
}

/// T3: `tools/call` over HTTP returns the parsed result, and the per-server timeout
/// is the one the caller asked for.
#[tokio::test]
async fn a_tool_call_over_http_returns_the_parsed_result() {
    let mut script = handshake_script(Some("session-1"));
    script.push(Ok(reply(
        json!(100),
        json!({
            "content": [{ "type": "text", "text": "called echo" }],
            "isError": false,
        }),
    )));
    let fake = FakeHttp::new(script);
    let mcp = manager_with(Arc::clone(&fake));

    mcp.connect(McpServerConfig::new_http(
        "remote",
        "https://mcp.example/mcp",
    ))
    .await
    .expect("the handshake completes");
    let result = mcp
        .call_tool_with_timeout(
            "remote",
            "echo",
            json!({ "msg": "hi" }),
            Duration::from_secs(5),
        )
        .await
        .expect("the call is answered");

    assert!(!result.is_error);
    assert_eq!(
        result.content,
        vec![McpContent::Text {
            text: "called echo".to_string()
        }]
    );

    let sent = fake.sent().await;
    let call = sent.last().expect("the call was sent");
    assert_eq!(call.body["method"], "tools/call");
    assert_eq!(call.body["params"]["name"], "echo");
    assert_eq!(call.body["params"]["arguments"], json!({ "msg": "hi" }));
    assert_eq!(call.session_id.as_deref(), Some("session-1"));
    assert_eq!(call.protocol_version.as_deref(), Some("2025-06-18"));
    assert_eq!(call.timeout, Duration::from_secs(5), "the caller's bound");
}

/// T3: a JSON-RPC error member is a protocol failure, and `isError: true` is a
/// result — the same split the stdio transport makes.
#[tokio::test]
async fn a_tool_call_error_member_is_refused_and_is_error_is_a_result() {
    let mut script = handshake_script(Some("session-1"));
    script.push(Ok(McpHttpReply {
        message: Some(json!({
            "jsonrpc": "2.0",
            "id": 100,
            "result": {
                "content": [{ "type": "text", "text": "the tool refused" }],
                "isError": true,
            },
        })),
        session_id: None,
    }));
    let fake = FakeHttp::new(script);
    let mcp = manager_with(Arc::clone(&fake));
    mcp.connect(McpServerConfig::new_http(
        "remote",
        "https://mcp.example/mcp",
    ))
    .await
    .expect("the handshake completes");

    let result = mcp
        .call_tool("remote", "echo", json!({}))
        .await
        .expect("an isError result is still a result");
    assert!(result.is_error, "the server's flag travels to the caller");

    let mut script = handshake_script(Some("session-1"));
    script.push(Ok(McpHttpReply {
        message: Some(json!({
            "jsonrpc": "2.0",
            "id": 100,
            "error": { "code": -32601, "message": "unknown tool" },
        })),
        session_id: None,
    }));
    let fake = FakeHttp::new(script);
    let mcp = manager_with(Arc::clone(&fake));
    mcp.connect(McpServerConfig::new_http(
        "remote",
        "https://mcp.example/mcp",
    ))
    .await
    .expect("the handshake completes");
    let error = mcp
        .call_tool("remote", "echo", json!({}))
        .await
        .expect_err("a JSON-RPC error is not a result");
    assert!(
        matches!(
            &error,
            McpTransportError::Protocol { method, problem, .. }
                if method == "tools/call" && problem.contains("unknown tool")
        ),
        "got {error:?}"
    );
}

/// T3: an expired session turns the connection into an error that says so — never a
/// silent re-initialize, and never `connected`.
#[tokio::test]
async fn an_expired_session_turns_the_connection_into_an_error() {
    let mut script = handshake_script(Some("session-1"));
    script.push(Err(McpHttpError::SessionExpired));
    let fake = FakeHttp::new(script);
    let mcp = manager_with(Arc::clone(&fake));
    mcp.connect(McpServerConfig::new_http(
        "remote",
        "https://mcp.example/mcp",
    ))
    .await
    .expect("the handshake completes");

    let error = mcp
        .call_tool("remote", "echo", json!({}))
        .await
        .expect_err("an expired session is not a call");
    assert!(
        matches!(&error, McpTransportError::SessionExpired { .. }),
        "got {error:?}"
    );
    let listed = mcp.list().await;
    assert!(
        matches!(&listed[0].status, McpStatus::Error(message) if message.contains("session expired")),
        "got {:?}",
        listed[0].status
    );
    // Nothing re-initialized: the fake saw the handshake and one refused call.
    assert_eq!(fake.sent().await.len(), 4);
}

/// T3: a timeout is reported as one, naming the method and the bound.
#[tokio::test]
async fn a_timeout_is_reported_as_a_timeout() {
    let mut script = handshake_script(Some("session-1"));
    script.push(Err(McpHttpError::Timeout));
    let fake = FakeHttp::new(script);
    let mcp = manager_with(Arc::clone(&fake));
    mcp.connect(McpServerConfig::new_http(
        "remote",
        "https://mcp.example/mcp",
    ))
    .await
    .expect("the handshake completes");

    let error = mcp
        .call_tool_with_timeout("remote", "echo", json!({}), Duration::from_secs(2))
        .await
        .expect_err("a silent server is an error");
    assert!(
        matches!(
            &error,
            McpTransportError::Timeout { method, seconds, .. }
                if method == "tools/call" && *seconds == 2
        ),
        "got {error:?}"
    );
    assert!(matches!(mcp.list().await[0].status, McpStatus::Error(_)));
}

/// T4: a `401` is an error row whose reason names authorization, and no session was
/// issued, so nothing is closed.
#[tokio::test]
async fn a_refused_initialize_is_an_error_row_and_never_connected() {
    let fake = FakeHttp::new(vec![Err(McpHttpError::Status {
        code: 401,
        reason: "server requires authorization, which this version does not support".to_string(),
    })]);
    let mcp = manager_with(Arc::clone(&fake));

    let error = mcp
        .connect(McpServerConfig::new_http(
            "remote",
            "https://mcp.example/mcp",
        ))
        .await
        .expect_err("a refused initialize is not a connection");

    assert!(
        matches!(&error, McpTransportError::Http { problem, .. } if problem.contains("authorization")),
        "got {error:?}"
    );
    let listed = mcp.list().await;
    assert_eq!(listed.len(), 1, "the row is pushed once, as an error");
    assert!(
        matches!(&listed[0].status, McpStatus::Error(message) if message.contains("authorization")),
        "got {:?}",
        listed[0].status
    );
    assert_eq!(listed[0].process_id, None);
    assert!(listed[0].tools.is_empty());
    assert!(
        fake.closed().await.is_empty(),
        "no session was issued, so there is nothing to close"
    );
}

/// T4: a `tools/list` reply with no `tools` array is a protocol failure, and the
/// session that was issued before it is closed best effort.
#[tokio::test]
async fn a_malformed_tools_list_fails_the_handshake_and_closes_the_session() {
    let fake = FakeHttp::new(vec![
        Ok(McpHttpReply {
            message: Some(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": initialize_result("2025-06-18"),
            })),
            session_id: Some("session-1".to_string()),
        }),
        Ok(McpHttpReply {
            message: None,
            session_id: None,
        }),
        Ok(reply(json!(2), json!({ "notTools": [] }))),
    ]);
    let mcp = manager_with(Arc::clone(&fake));

    let error = mcp
        .connect(McpServerConfig::new_http(
            "remote",
            "https://mcp.example/mcp",
        ))
        .await
        .expect_err("a reply with no tools is not a handshake");

    assert!(
        matches!(
            &error,
            McpTransportError::Protocol { method, problem, .. }
                if method == "tools/list" && problem.contains("tools")
        ),
        "got {error:?}"
    );
    assert!(matches!(mcp.list().await[0].status, McpStatus::Error(_)));
    assert_eq!(
        fake.closed().await,
        vec![(
            "https://mcp.example/mcp".to_string(),
            "session-1".to_string()
        )],
        "the session issued before the failure is closed once"
    );
}

/// A handshake that fails before any session is issued closes nothing.
#[tokio::test]
async fn a_handshake_failure_without_a_session_closes_nothing() {
    let fake = FakeHttp::new(vec![
        Ok(McpHttpReply {
            message: Some(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": initialize_result("2025-06-18"),
            })),
            session_id: None,
        }),
        Ok(McpHttpReply {
            message: None,
            session_id: None,
        }),
        Ok(reply(json!(2), json!({ "notTools": [] }))),
    ]);
    let mcp = manager_with(Arc::clone(&fake));

    mcp.connect(McpServerConfig::new_http(
        "remote",
        "https://mcp.example/mcp",
    ))
    .await
    .expect_err("a reply with no tools is not a handshake");

    assert!(fake.closed().await.is_empty());
}

/// T5: `disconnect` closes the session once, clears the tools, and a failure of the
/// `DELETE` is swallowed — the local disconnect happened either way.
#[tokio::test]
async fn disconnect_closes_the_session_and_swallows_the_failure() {
    let fake = FakeHttp::new(handshake_script(Some("session-1")));
    let mcp = manager_with(Arc::clone(&fake));
    mcp.connect(McpServerConfig::new_http(
        "remote",
        "https://mcp.example/mcp",
    ))
    .await
    .expect("the handshake completes");

    // The first disconnect's `DELETE` succeeds.
    mcp.disconnect("remote")
        .await
        .expect("the server disconnects");
    assert_eq!(
        fake.closed().await,
        vec![(
            "https://mcp.example/mcp".to_string(),
            "session-1".to_string()
        )]
    );
    let listed = mcp.list().await;
    assert_eq!(listed[0].status, McpStatus::Disconnected);
    assert!(listed[0].tools.is_empty(), "the tools go with the session");
    assert!(listed[0].process_id.is_none());

    // A reconnect under the same name works, and a refusing server does not turn a
    // disconnect into an error.
    let refusing = FakeHttp::new(handshake_script(Some("session-2")));
    refusing.refuse_close().await;
    let mcp = manager_with(Arc::clone(&refusing));
    mcp.connect(McpServerConfig::new_http(
        "remote",
        "https://mcp.example/mcp",
    ))
    .await
    .expect("the handshake completes");
    mcp.disconnect("remote")
        .await
        .expect("a refused DELETE is not a failed disconnect");
    assert_eq!(refusing.closed().await.len(), 1);
    assert_eq!(mcp.list().await[0].status, McpStatus::Disconnected);
}

/// T5: a disconnected HTTP server reconnects under the same name, with a new session.
#[tokio::test]
async fn a_disconnected_http_server_reconnects_with_a_new_session() {
    let mut script = handshake_script(Some("session-1"));
    script.extend(handshake_script(Some("session-2")));
    let fake = FakeHttp::new(script);
    let mcp = manager_with(Arc::clone(&fake));

    mcp.connect(McpServerConfig::new_http(
        "remote",
        "https://mcp.example/mcp",
    ))
    .await
    .expect("the first handshake completes");
    mcp.disconnect("remote").await.expect("it disconnects");
    mcp.connect(McpServerConfig::new_http(
        "remote",
        "https://mcp.example/mcp",
    ))
    .await
    .expect("the second handshake completes");

    let listed = mcp.list().await;
    assert_eq!(listed.len(), 1, "one row per name");
    assert_eq!(listed[0].status, McpStatus::Connected);
    let sent = fake.sent().await;
    assert_eq!(
        sent[3].session_id, None,
        "a new session starts at initialize"
    );
    assert_eq!(sent[5].session_id.as_deref(), Some("session-2"));
}

/// T6: WebSocket is still recorded with a client injected, and the raw frame seam is
/// refused for an HTTP server this manager dials.
#[tokio::test]
async fn a_websocket_config_is_still_recorded_and_raw_frames_are_stdin_only() {
    let fake = FakeHttp::new(handshake_script(Some("session-1")));
    let mcp = manager_with(Arc::clone(&fake));

    mcp.connect(McpServerConfig::new_websocket(
        "live",
        "wss://mcp.example/ws",
    ))
    .await
    .expect("a websocket config is recorded");
    let listed = mcp.list().await;
    assert_eq!(listed[0].status, McpStatus::Disconnected);
    assert_eq!(listed[0].config.transport.as_str(), "websocket");
    assert!(
        fake.sent().await.is_empty(),
        "nothing dials a websocket transport"
    );
    let error = mcp
        .send("live", "{}")
        .await
        .expect_err("a websocket server has no raw seam");
    assert!(
        matches!(error, McpTransportError::NotWired(_)),
        "got {error:?}"
    );

    // An HTTP server this manager dialled refuses `send` with its own reason: the
    // seam is a stdio feature, not a missing client.
    mcp.connect(McpServerConfig::new_http(
        "remote",
        "https://mcp.example/mcp",
    ))
    .await
    .expect("the handshake completes");
    let error = mcp
        .send(
            "remote",
            "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"ping\"}",
        )
        .await
        .expect_err("no raw frame reaches an HTTP server");
    assert!(
        matches!(&error, McpTransportError::RawFramesStdio(name) if name == "remote"),
        "got {error:?}"
    );
}

/// T6: with **no** client injected, an `http` config is still recorded — no request,
/// no session, no error.
#[tokio::test]
async fn without_a_client_an_http_config_is_recorded_and_not_dialled() {
    let mcp = InMemoryMcpManager::new(InMemoryProcessManager::shared());

    mcp.connect(McpServerConfig::new_http(
        "remote",
        "https://mcp.example/mcp",
    ))
    .await
    .expect("the config is recorded");

    let listed = mcp.list().await;
    assert_eq!(listed[0].status, McpStatus::Disconnected);
    assert_eq!(listed[0].process_id, None);
    assert!(!listed[0].config.is_wired());
    assert!(listed[0].tools.is_empty());
    let error = mcp
        .call_tool("remote", "echo", json!({}))
        .await
        .expect_err("nothing is dialled, so nothing is called");
    assert!(
        matches!(error, McpTransportError::NotWired(_)),
        "got {error:?}"
    );
}

/// A dialled HTTP server with a per-server bound hands that bound to every request.
#[tokio::test]
async fn a_per_server_bound_reaches_the_handshake() {
    let fake = FakeHttp::new(handshake_script(None));
    let mcp = manager_with(Arc::clone(&fake));

    mcp.connect_with(
        McpServerConfig::new_http("remote", "https://mcp.example/mcp"),
        warsha_pipeline::mcp_transport::McpLaunchOptions::default()
            .with_response_timeout(Duration::from_secs(7)),
    )
    .await
    .expect("the handshake completes");

    for request in fake.sent().await {
        assert_eq!(request.timeout, Duration::from_secs(7));
    }
}
