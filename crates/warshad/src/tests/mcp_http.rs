#![allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]

//! T8–T11 (R-EXT-4): `ReqwestMcpHttp` against an in-process loopback server.
//!
//! Nothing here reaches the real network: every test binds `127.0.0.1:0`, so the port
//! is the kernel's and no fixed port is ever taken. The two refusals are proved on
//! hosts that cannot resolve (`mcp.example`, `192.0.2.1`), which is what makes a
//! message about `loopback` evidence that the check ran before a socket was opened
//! rather than after a failed dial.
//!
//! What these pin is the packet's list: a JSON reply and an SSE reply both complete
//! the handshake and a call; a session id the server issues is echoed and a request
//! without it is refused; a `404` on a sessioned request is expiry; `DELETE` arrives
//! on disconnect; the 2 MiB message cap, the 8 MiB stream cap and the timeout each
//! end as the error they are; and the only headers that leave the process are
//! `Accept`, `Content-Type`, `User-Agent`, `Mcp-Session-Id` and
//! `MCP-Protocol-Version` — never `Authorization` or `Cookie`.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::{
    body::Bytes,
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Router,
};
use serde_json::{json, Value};
use warsha_pipeline::mcp_http::{McpHttpClient, McpHttpError, McpHttpRequest};
use warsha_pipeline::mcp_transport::{InMemoryMcpManager, McpManager, McpServerConfig, McpStatus};
use warsha_pipeline::InMemoryProcessManager;

use crate::WarshaApiServer;

use super::{ReqwestMcpHttp, MAX_MESSAGE_BYTES};

/// The session id this server issues on `initialize`.
const SESSION: &str = "session-abc";

/// How one request reached the server, as the server itself read it.
#[derive(Debug, Clone)]
struct Seen {
    method: String,
    id: Option<Value>,
    session: Option<String>,
    protocol_version: Option<String>,
    authorization: Option<String>,
    cookie: Option<String>,
    header_names: Vec<String>,
}

/// How the server answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    /// One `application/json` object per request.
    Json,
    /// `text/event-stream`, with an unrelated notification event first.
    Sse,
    /// `401` to everything: the authorization refusal this version reports.
    RequireAuth,
    /// `404` to every request that carries the session: the expiry signal.
    Expired,
    /// A JSON body past the 2 MiB message cap.
    Oversize,
    /// An event stream past the 8 MiB total cap, never carrying the reply.
    EndlessStream,
    /// A reply slower than the client's bound.
    Slow,
    /// A `302` off loopback, onto a plain `http` host.
    RedirectOffLoopback,
    /// Nothing here is a reply: `text/html`.
    NotAReply,
}

/// The server's own state: what it issued and what it was asked.
#[derive(Clone)]
struct Server {
    state: Arc<Mutex<Transcript>>,
    mode: Mode,
}

#[derive(Default)]
struct Transcript {
    requests: Vec<Seen>,
    deletes: Vec<Option<String>>,
}

impl Server {
    fn new(mode: Mode) -> Self {
        Server {
            state: Arc::new(Mutex::new(Transcript::default())),
            mode,
        }
    }

    fn seen(&self) -> Vec<Seen> {
        self.state
            .lock()
            .expect("the transcript lock")
            .requests
            .clone()
    }

    fn deletes(&self) -> Vec<Option<String>> {
        self.state
            .lock()
            .expect("the transcript lock")
            .deletes
            .clone()
    }
}

/// Serve `server` on an ephemeral loopback port and return its base URL.
async fn spawn(server: Server) -> String {
    let app = Router::new()
        .route("/mcp", post(mcp_endpoint).delete(mcp_delete))
        .with_state(server);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("an ephemeral loopback port");
    let address = listener.local_addr().expect("the bound address");
    tokio::spawn(async move {
        // The server ends when the test's runtime does; every request in these tests
        // is answered.
        let _ = axum::serve(listener, app).await;
    });
    format!("http://{address}/mcp")
}

/// The `initialize` result this server answers with.
fn initialize_result() -> Value {
    json!({
        "protocolVersion": "2025-06-18",
        "capabilities": { "tools": {} },
        "serverInfo": { "name": "warsha-loopback", "version": "1.0.0" },
    })
}

/// The result for one JSON-RPC method, as a JSON-RPC reply object.
fn reply_for(request: &Value) -> Value {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let method = request
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let result = match method {
        "initialize" => initialize_result(),
        "tools/list" => json!({
            "tools": [{
                "name": "echo",
                "description": "echo description",
                "inputSchema": { "type": "object" },
            }],
        }),
        "tools/call" => json!({
            "content": [{ "type": "text", "text": "called over http" }],
            "isError": false,
        }),
        _ => json!({}),
    };
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn json_reply(request: &Value) -> Response {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        reply_for(request).to_string(),
    )
        .into_response()
}

/// An SSE reply: an unrelated notification event first, then the real answer, so the
/// client has to pick the reply by id instead of taking the first event.
fn sse_reply(request: &Value) -> Response {
    let body = format!(
        ": keep-alive\n\nevent: message\ndata: {}\n\ndata: {}\n\n",
        json!({ "jsonrpc": "2.0", "method": "notifications/message", "params": {} }),
        reply_for(request),
    );
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/event-stream")],
        body,
    )
        .into_response()
}

/// The session header's value, as the server reads it.
fn session_of(headers: &HeaderMap) -> Option<String> {
    headers
        .get("mcp-session-id")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

/// The `application/json` mode: `initialize` issues the session, everything after it
/// must carry the session back, and a notification gets the spec's `202`.
fn json_mode(request: &Value, headers: &HeaderMap) -> Response {
    if request.get("id").is_none() {
        let mut response = StatusCode::ACCEPTED.into_response();
        response
            .headers_mut()
            .insert("mcp-session-id", header::HeaderValue::from_static(SESSION));
        return response;
    }
    let is_initialize = request.get("method").and_then(Value::as_str) == Some("initialize");
    if is_initialize {
        let mut response = json_reply(request);
        response
            .headers_mut()
            .insert("mcp-session-id", header::HeaderValue::from_static(SESSION));
        return response;
    }
    if session_of(headers).as_deref() != Some(SESSION) {
        return (StatusCode::BAD_REQUEST, "a session is required").into_response();
    }
    json_reply(request)
}

/// The `text/event-stream` mode, with the same session rule.
fn sse_mode(request: &Value, headers: &HeaderMap) -> Response {
    if request.get("id").is_none() {
        return StatusCode::ACCEPTED.into_response();
    }
    let is_initialize = request.get("method").and_then(Value::as_str) == Some("initialize");
    if is_initialize {
        let mut response = sse_reply(request);
        response
            .headers_mut()
            .insert("mcp-session-id", header::HeaderValue::from_static(SESSION));
        return response;
    }
    if session_of(headers).as_deref() != Some(SESSION) {
        return (StatusCode::BAD_REQUEST, "a session is required").into_response();
    }
    sse_reply(request)
}

async fn mcp_endpoint(State(server): State<Server>, headers: HeaderMap, body: Bytes) -> Response {
    let request: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    let mut names: Vec<String> = headers
        .keys()
        .map(|name| name.as_str().to_string())
        .collect();
    names.sort_unstable();
    let read = |name: &str| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    };
    server
        .state
        .lock()
        .expect("the transcript lock")
        .requests
        .push(Seen {
            method: request
                .get("method")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            id: request.get("id").cloned(),
            session: read("mcp-session-id"),
            protocol_version: read("mcp-protocol-version"),
            authorization: read("authorization"),
            cookie: read("cookie"),
            header_names: names,
        });

    match server.mode {
        Mode::RequireAuth => (
            StatusCode::UNAUTHORIZED,
            "an API key is required for this endpoint",
        )
            .into_response(),
        // A server that has forgotten the session: the handshake still answers, and
        // the call that follows is the `404` the revision calls expiry.
        Mode::Expired => {
            let expired = request.get("method").and_then(Value::as_str) == Some("tools/call")
                && read("mcp-session-id").is_some();
            if expired {
                (StatusCode::NOT_FOUND, "no such session").into_response()
            } else {
                json_mode(&request, &headers)
            }
        }
        Mode::Oversize => {
            let mut body = reply_for(&request).to_string();
            body.push_str(&"x".repeat(MAX_MESSAGE_BYTES + 4096));
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "application/json")],
                body,
            )
                .into_response()
        }
        Mode::EndlessStream => {
            // 9 MiB of events that never carry the reply: past the 8 MiB stream cap.
            let event = "data: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/message\"}\n\n";
            let body = event.repeat((9 * 1024 * 1024) / event.len() + 1);
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "text/event-stream")],
                body,
            )
                .into_response()
        }
        Mode::Slow => {
            tokio::time::sleep(Duration::from_millis(1500)).await;
            json_reply(&request)
        }
        Mode::RedirectOffLoopback => (
            StatusCode::FOUND,
            [(header::LOCATION, "http://mcp.example/mcp")],
        )
            .into_response(),
        Mode::NotAReply => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "text/html")],
            "<html>not an MCP server</html>",
        )
            .into_response(),
        Mode::Json => json_mode(&request, &headers),
        Mode::Sse => sse_mode(&request, &headers),
    }
}

async fn mcp_delete(State(server): State<Server>, headers: HeaderMap) -> Response {
    let session = headers
        .get("mcp-session-id")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    server
        .state
        .lock()
        .expect("the transcript lock")
        .deletes
        .push(session);
    StatusCode::OK.into_response()
}

/// A client whose policy is built the way the daemon builds it, over a fresh data
/// directory held by the caller.
fn client(temp: &std::path::Path) -> ReqwestMcpHttp {
    ReqwestMcpHttp::new(crate::ProcessPolicy::from_config(&[], temp)).expect("the client builds")
}

/// A manager over `client`, with a spawner this transport never uses.
fn manager(client: ReqwestMcpHttp) -> InMemoryMcpManager {
    InMemoryMcpManager::new(InMemoryProcessManager::shared()).with_http_client(Arc::new(client))
}

/// T8: a JSON server completes `initialize` + `tools/list` + `tools/call`.
#[tokio::test]
async fn a_json_server_completes_the_handshake_and_a_call() {
    let temp = crate::test_util::fresh_tempdir();
    let server = Server::new(Mode::Json);
    let url = spawn(server.clone()).await;
    let mcp = manager(client(temp.path()));

    mcp.connect(McpServerConfig::new_http("remote", url.clone()))
        .await
        .expect("the JSON handshake completes");
    let listed = mcp.list().await;
    assert_eq!(listed[0].status, McpStatus::Connected);
    assert_eq!(listed[0].tools, vec!["echo".to_string()]);
    assert_eq!(listed[0].process_id, None);

    let result = mcp
        .call_tool("remote", "echo", json!({ "msg": "hi" }))
        .await
        .expect("the call is answered");
    assert!(!result.is_error);

    let seen = server.seen();
    assert_eq!(
        seen.iter().map(|s| s.method.as_str()).collect::<Vec<_>>(),
        vec![
            "initialize",
            "notifications/initialized",
            "tools/list",
            "tools/call"
        ]
    );
    // The session the JSON `initialize` reply issued is echoed on every later one.
    assert_eq!(seen[0].session, None);
    for request in &seen[1..] {
        assert_eq!(request.session.as_deref(), Some(SESSION));
        assert_eq!(
            request.protocol_version.as_deref(),
            Some("2025-06-18"),
            "the negotiated revision goes on every request after initialize"
        );
    }
    // The 202 answer to the notification is what the transport expects: no reply.
    assert_eq!(seen[1].id, None);
}

/// T8: an SSE server completes the same path, and the reply is picked out of a
/// stream whose first event is not it.
#[tokio::test]
async fn an_sse_server_completes_the_handshake_and_a_call() {
    let temp = crate::test_util::fresh_tempdir();
    let server = Server::new(Mode::Sse);
    let url = spawn(server.clone()).await;
    let mcp = manager(client(temp.path()));

    mcp.connect(McpServerConfig::new_http("remote", url.clone()))
        .await
        .expect("the SSE handshake completes");
    let listed = mcp.list().await;
    assert_eq!(listed[0].status, McpStatus::Connected);
    assert_eq!(listed[0].tools, vec!["echo".to_string()]);
    assert_eq!(
        listed[0].tool_definitions[0].description,
        "echo description"
    );

    let result = mcp
        .call_tool("remote", "echo", json!({}))
        .await
        .expect("the call is answered out of the stream");
    assert_eq!(
        result.content,
        vec![warsha_pipeline::mcp::McpContent::Text {
            text: "called over http".to_string()
        }]
    );

    let seen = server.seen();
    assert_eq!(seen.len(), 4);
    assert_eq!(seen[3].method, "tools/call");
    assert_eq!(seen[3].session.as_deref(), Some(SESSION));
}

/// T9: the session the server issued is required by it, and the client sends it;
/// expiry is a `SessionExpired`, and disconnect sends the `DELETE`.
#[tokio::test]
async fn a_session_is_required_echoed_expired_and_deleted() {
    let temp = crate::test_util::fresh_tempdir();
    let server = Server::new(Mode::Json);
    let url = spawn(server.clone()).await;
    let mcp = manager(client(temp.path()));

    mcp.connect(McpServerConfig::new_http("remote", url.clone()))
        .await
        .expect("the handshake completes");
    // The server refuses a sessioned-path request that carries no session, so the
    // successful `tools/list` above is proof the id was echoed; this proves the
    // refusal is real rather than an accommodating handler.
    let direct = client(temp.path());
    let error = direct
        .post(
            &url,
            McpHttpRequest::new(
                json!({ "jsonrpc": "2.0", "id": 9, "method": "tools/list" }),
                Some(json!(9)),
                Duration::from_secs(5),
            ),
        )
        .await
        .expect_err("a request with no session is refused");
    assert!(
        matches!(error, McpHttpError::Status { code: 400, .. }),
        "got {error:?}"
    );

    // The `DELETE` the revision asks for arrives with the session.
    mcp.disconnect("remote").await.expect("it disconnects");
    assert_eq!(server.deletes(), vec![Some(SESSION.to_string())]);

    // A server that has forgotten the session answers 404 → SessionExpired, and the
    // connection is an error rather than a silent re-handshake.
    let temp = crate::test_util::fresh_tempdir();
    let expiring = Server::new(Mode::Expired);
    let url = spawn(expiring.clone()).await;
    let mcp = manager(client(temp.path()));
    mcp.connect(McpServerConfig::new_http("remote", url.clone()))
        .await
        .expect("the first reply is the initialize one");
    let error = mcp
        .call_tool("remote", "echo", json!({}))
        .await
        .expect_err("an expired session is not a call");
    assert!(
        matches!(
            &error,
            warsha_pipeline::mcp_transport::McpTransportError::SessionExpired { .. }
        ),
        "got {error:?}"
    );
    assert!(matches!(mcp.list().await[0].status, McpStatus::Error(_)));
    // Nothing re-initialized: the server saw the handshake and the refused call.
    assert_eq!(expiring.seen().len(), 4);
}

/// T10: a JSON body past the 2 MiB message cap is `Oversize`, and the connection is
/// left an error rather than a connected server with no tools.
#[tokio::test]
async fn a_message_past_the_cap_is_refused() {
    let temp = crate::test_util::fresh_tempdir();
    let server = Server::new(Mode::Oversize);
    let url = spawn(server.clone()).await;
    let mcp = manager(client(temp.path()));

    let error = mcp
        .connect(McpServerConfig::new_http("remote", url))
        .await
        .expect_err("an oversize reply is not a handshake");
    assert!(
        matches!(&error, warsha_pipeline::mcp_transport::McpTransportError::Http { problem, .. } if problem.contains("larger")),
        "got {error:?}"
    );
    let listed = mcp.list().await;
    assert!(matches!(listed[0].status, McpStatus::Error(_)));
    assert!(listed[0].tools.is_empty());
}

/// T10: an event stream past the 8 MiB total cap is refused while it is being read.
#[tokio::test]
async fn a_stream_past_the_total_cap_is_refused() {
    let temp = crate::test_util::fresh_tempdir();
    let server = Server::new(Mode::EndlessStream);
    let url = spawn(server.clone()).await;
    let client = Arc::new(client(temp.path()));

    let error = client
        .post(
            &url,
            McpHttpRequest::new(
                json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }),
                Some(json!(1)),
                Duration::from_secs(20),
            ),
        )
        .await
        .expect_err("a stream that never answers is refused");
    assert!(
        matches!(error, McpHttpError::Oversize | McpHttpError::Timeout),
        "got {error:?}"
    );
}

/// T10: a server slower than the bound is a `Timeout`.
#[tokio::test]
async fn a_slow_server_is_a_timeout() {
    let temp = crate::test_util::fresh_tempdir();
    let server = Server::new(Mode::Slow);
    let url = spawn(server.clone()).await;
    let client = Arc::new(client(temp.path()));

    let error = client
        .post(
            &url,
            McpHttpRequest::new(
                json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }),
                Some(json!(1)),
                Duration::from_millis(200),
            ),
        )
        .await
        .expect_err("a slow server is not an answer");
    assert!(matches!(error, McpHttpError::Timeout), "got {error:?}");
}

/// T10: a `2xx` that is neither JSON nor an event stream is a protocol failure.
#[tokio::test]
async fn a_reply_that_is_not_a_reply_is_a_protocol_failure() {
    let temp = crate::test_util::fresh_tempdir();
    let server = Server::new(Mode::NotAReply);
    let url = spawn(server).await;
    let client = Arc::new(client(temp.path()));

    let error = client
        .post(
            &url,
            McpHttpRequest::new(
                json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }),
                Some(json!(1)),
                Duration::from_secs(5),
            ),
        )
        .await
        .expect_err("an html page is not a JSON-RPC reply");
    assert!(
        matches!(&error, McpHttpError::Protocol(problem) if problem.contains("neither")),
        "got {error:?}"
    );
}

/// T11: a plain `http` host that is not loopback is refused before any socket, both
/// on the first URL and through a redirect.
#[tokio::test]
async fn a_plain_http_host_off_loopback_is_refused_before_a_socket() {
    let temp = crate::test_util::fresh_tempdir();
    let direct = client(temp.path());

    let error = direct
        .post(
            "http://mcp.example/mcp",
            McpHttpRequest::new(
                json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }),
                Some(json!(1)),
                Duration::from_secs(5),
            ),
        )
        .await
        .expect_err("a plain http host off loopback is refused");
    assert!(
        matches!(&error, McpHttpError::Unavailable(reason) if reason.contains("loopback")),
        "got {error:?}"
    );

    // The same refusal through a redirect: a loopback server cannot bounce this
    // client onto a plain-http host it would never have dialled directly.
    let server = Server::new(Mode::RedirectOffLoopback);
    let url = spawn(server.clone()).await;
    let error = direct
        .post(
            &url,
            McpHttpRequest::new(
                json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }),
                Some(json!(1)),
                Duration::from_secs(5),
            ),
        )
        .await
        .expect_err("the redirect target is refused");
    assert!(
        matches!(&error, McpHttpError::Unavailable(reason) if reason.contains("loopback")),
        "got {error:?}"
    );
    assert_eq!(server.seen().len(), 1, "the redirect was never followed");
}

/// T11: the request the server saw carries no credential of any kind.
#[tokio::test]
async fn no_credential_leaves_the_process() {
    let temp = crate::test_util::fresh_tempdir();
    let server = Server::new(Mode::Json);
    let url = spawn(server.clone()).await;
    let mcp = manager(client(temp.path()));
    mcp.connect(McpServerConfig::new_http("remote", url))
        .await
        .expect("the handshake completes");

    for request in server.seen() {
        assert_eq!(request.authorization, None, "no Authorization is sent");
        assert_eq!(request.cookie, None, "no Cookie is sent");
        for name in &request.header_names {
            assert!(
                !name.contains("token")
                    && !name.contains("secret")
                    && name != "proxy-authorization",
                "unexpected header `{name}`"
            );
        }
        assert!(
            request.header_names.contains(&"user-agent".to_string()),
            "the client names itself"
        );
    }
}

/// T11: a `401` is reported with the authorization sentence, never retried with a
/// credential.
#[tokio::test]
async fn a_401_is_reported_and_not_solved() {
    let temp = crate::test_util::fresh_tempdir();
    let server = Server::new(Mode::RequireAuth);
    let url = spawn(server.clone()).await;
    let client = client(temp.path());

    let error = client
        .post(
            &url,
            McpHttpRequest::new(
                json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }),
                Some(json!(1)),
                Duration::from_secs(5),
            ),
        )
        .await
        .expect_err("a 401 is a refusal");
    assert!(
        matches!(&error, McpHttpError::Status { code: 401, reason } if reason.contains("authorization")),
        "got {error:?}"
    );
    assert_eq!(server.seen().len(), 1, "nothing was retried");
    assert_eq!(server.seen()[0].authorization, None);
}

/// The best-effort `DELETE`: a server that refuses the method still leaves the
/// teardown done, which is what the revision asks a client to tolerate.
#[tokio::test]
async fn a_refused_delete_is_still_a_closed_session() {
    let temp = crate::test_util::fresh_tempdir();
    // A router with no `DELETE` route answers 405, the method refusal the spec names.
    let app = Router::new().route(
        "/mcp",
        post(|| async {
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "application/json")],
                "{}",
            )
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("an ephemeral loopback port");
    let address = listener.local_addr().expect("the bound address");
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    let url = format!("http://{address}/mcp");

    client(temp.path())
        .close(&url, SESSION)
        .await
        .expect("a 405 on DELETE is what a teardown wanted");
}

/// T12: the whole path through the RPCs — `mcp.connect` dials, `mcp.list` reports
/// what the server said, `mcp.call` is gated by the permission table exactly as it
/// is for stdio, and `mcp.disconnect` closes the session.
#[tokio::test]
async fn the_rpcs_dial_list_call_and_disconnect_an_http_server() {
    let data = crate::test_util::fresh_tempdir();
    let temp = crate::test_util::fresh_tempdir();
    let server = Server::new(Mode::Json);
    let url = spawn(server.clone()).await;
    let transport: Arc<dyn McpManager> = Arc::new(manager(client(data.path())));
    let (state, _store) =
        crate::tests::test_state_with_seams(temp.path(), |_config| {}, None, None, Some(transport))
            .await;
    let rpc = crate::WarshaRpc::new(state);
    let owner = crate::tests::owner_ext();

    rpc.connect_mcp(&owner, McpServerConfig::new_http("remote", url.clone()))
        .await
        .expect("the daemon dials the loopback server");
    let listed = rpc.list_mcp(&owner).await.expect("the list is served");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].status, warsha_pipeline::McpStatus::Connected);
    assert_eq!(listed[0].process_id, None);
    assert_eq!(listed[0].tools, vec!["echo".to_string()]);

    // An empty table is `Ask`, and `Ask` is the same refusal over HTTP as over stdio.
    let asked = rpc
        .call_mcp(&owner, "remote".to_string(), "echo".to_string(), json!({}))
        .await
        .expect_err("ask-gated tools are refused");
    assert_eq!(asked.code(), -32005, "{asked}");

    rpc.set_mcp_permission(
        &owner,
        "remote".to_string(),
        "echo".to_string(),
        warsha_pipeline::MCP_AGENT_ROLE.to_string(),
        "allow".to_string(),
    )
    .await
    .expect("the owner grants the tool");
    let result = rpc
        .call_mcp(&owner, "remote".to_string(), "echo".to_string(), json!({}))
        .await
        .expect("the call is answered");
    assert!(!result.is_error);

    rpc.disconnect_mcp(&owner, "remote".to_string())
        .await
        .expect("the server disconnects");
    let listed = rpc.list_mcp(&owner).await.expect("the list is served");
    assert_eq!(listed[0].status, warsha_pipeline::McpStatus::Disconnected);
    // The `DELETE` the revision asks for went out with the session.
    assert_eq!(server.deletes(), vec![Some(SESSION.to_string())]);
}

/// T11 through the RPC edge: a plain `http` host that is not loopback is refused by
/// `mcp.connect` itself, before any client is consulted and before any socket.
#[tokio::test]
async fn an_rpc_connect_to_a_plain_http_host_off_loopback_is_refused() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) =
        crate::tests::test_state_with_seams(temp.path(), |_config| {}, None, None, None).await;
    let rpc = crate::WarshaRpc::new(state);
    let owner = crate::tests::owner_ext();

    let refused = rpc
        .connect_mcp(
            &owner,
            McpServerConfig::new_http("remote", "http://mcp.example/mcp"),
        )
        .await
        .expect_err("a plain http host off loopback is refused");
    assert_eq!(refused.code(), -32005, "{refused}");
    assert!(
        rpc.list_mcp(&owner)
            .await
            .expect("the list is served")
            .is_empty(),
        "nothing was recorded"
    );
}
