#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::unwrap_used,
    unused_crate_dependencies
)]

//! T1–T3 (R-FIN-SH4d): `create_pr`'s draft mode against an in-process loopback stub.
//!
//! Nothing here reaches the real GitHub API. Every test binds `127.0.0.1:0`, so the
//! port is the kernel's and no fixed port is ever taken, and points a `GitHubClient`
//! at it with `with_api_base`. The stub is hand-rolled on `tokio::net::TcpListener`
//! because the crate has no mock-HTTP dependency and this packet adds none; the
//! token stays the literal `test-token`.
//!
//! What these pin is the packet's list: a draft request sends `"draft": true` and
//! the server's draft status survives the round trip; a ready request sends
//! `"draft": false` and a response that omits the field still decodes with
//! `draft == false`; and a draft refusal keeps today's `GitError::GitHub` shape,
//! message prefix included, without leaking the token.

use std::sync::{Arc, Mutex};

use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use warsha_git::{GitError, GitHubClient, PrDraft};

/// The one credential these tests ever use: a literal, so a leak in an error
/// message is visible rather than plausible.
const TOKEN: &str = "test-token";

/// One request as the stub read it off the wire.
#[derive(Debug, Clone)]
struct Captured {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: String,
}

impl Captured {
    /// Case-insensitive header lookup, the way HTTP matches names.
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    /// The request body parsed as JSON.
    fn json(&self) -> Value {
        serde_json::from_str(&self.body).expect("the request body is JSON")
    }
}

/// One canned reply: the status the stub answers with and its body.
struct Reply {
    status: u16,
    body: &'static str,
}

/// Bind a loopback stub that answers exactly one request with `reply`.
///
/// Returns the client base URL and the transcript the stub recorded. The stub
/// records the request *before* it writes the response, so a returned client call
/// guarantees the transcript is populated.
async fn spawn_stub(reply: Reply) -> (String, Arc<Mutex<Vec<Captured>>>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("an ephemeral loopback port");
    let address = listener.local_addr().expect("the bound address");
    let seen: Arc<Mutex<Vec<Captured>>> = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&seen);

    tokio::spawn(async move {
        // The stub ends when the test's runtime does; the handle is not joined and
        // never needs to be, because every test makes exactly one request.
        let Ok((mut socket, _)) = listener.accept().await else {
            return;
        };
        let Some(request) = read_request(&mut socket).await else {
            return;
        };
        if let Ok(mut transcript) = recorded.lock() {
            transcript.push(request);
        }

        let reason = match reply.status {
            201 => "Created",
            422 => "Unprocessable Entity",
            _ => "OK",
        };
        let response = format!(
            "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            reply.status,
            reason,
            reply.body.len(),
            reply.body
        );
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.flush().await;
        let _ = socket.shutdown().await;
    });

    (format!("http://{address}"), seen)
}

/// Read one HTTP request: headers up to the terminator, then `Content-Length` bytes.
async fn read_request(socket: &mut tokio::net::TcpStream) -> Option<Captured> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 1024];

    let header_end = loop {
        if let Some(position) = find(&buffer, b"\r\n\r\n") {
            break position + 4;
        }
        match socket.read(&mut chunk).await {
            Ok(0) => return None,
            Ok(read) => buffer.extend_from_slice(&chunk[..read]),
            Err(_) => return None,
        }
    };

    let head = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let mut lines = head.split("\r\n");
    let mut request_line = lines.next()?.split_whitespace();
    let method = request_line.next()?.to_string();
    let path = request_line.next()?.to_string();

    let mut headers = Vec::new();
    let mut content_length = 0usize;
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let (key, value) = line.split_once(':')?;
        let key = key.trim().to_string();
        let value = value.trim().to_string();
        if key.eq_ignore_ascii_case("content-length") {
            content_length = value.parse().ok()?;
        }
        headers.push((key, value));
    }

    let mut body = buffer[header_end..].to_vec();
    while body.len() < content_length {
        match socket.read(&mut chunk).await {
            Ok(0) => break,
            Ok(read) => body.extend_from_slice(&chunk[..read]),
            Err(_) => return None,
        }
    }
    body.truncate(content_length);

    Some(Captured {
        method,
        path,
        headers,
        body: String::from_utf8(body).ok()?,
    })
}

/// First index of `needle` in `haystack`.
fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// A client pointed at the stub.
fn client_for(base: &str) -> GitHubClient {
    GitHubClient::new(TOKEN)
        .expect("a non-empty token")
        .with_api_base(base)
}

/// The single request the stub saw, once the client call has returned.
fn captured(seen: &Arc<Mutex<Vec<Captured>>>) -> Captured {
    let transcript = seen.lock().expect("the transcript lock");
    transcript
        .first()
        .cloned()
        .expect("the stub recorded one request")
}

#[tokio::test]
async fn draft_pr_sends_draft_true_and_parses_it_back() {
    let (base, seen) = spawn_stub(Reply {
        status: 201,
        body: r#"{"id":1,"number":7,"title":"Add parser","body":"body","state":"open","html_url":"https://example.invalid/acme/widget/pull/7","draft":true}"#,
    })
    .await;

    let pr = client_for(&base)
        .create_pr(
            "acme",
            "widget",
            "Add parser",
            "body",
            "feature/parser",
            "main",
            PrDraft::Draft,
        )
        .await
        .expect("a draft pull request");

    let request = captured(&seen);
    assert_eq!(request.method, "POST");
    assert_eq!(request.path, "/repos/acme/widget/pulls");
    assert_eq!(request.header("authorization"), Some("Bearer test-token"));

    let sent = request.json();
    assert_eq!(sent["draft"], Value::Bool(true));
    assert_eq!(sent["title"], "Add parser");
    assert_eq!(sent["head"], "feature/parser");
    assert_eq!(sent["base"], "main");

    assert_eq!(pr.number, 7);
    assert_eq!(pr.title, "Add parser");
    assert!(
        pr.draft,
        "the server's draft status must survive the round trip"
    );
}

#[tokio::test]
async fn ready_pr_sends_draft_false_and_defaults_a_missing_field() {
    // Deliberately no `draft` key: this is what a pre-draft payload looks like.
    let (base, seen) = spawn_stub(Reply {
        status: 201,
        body: r#"{"id":2,"number":8,"title":"Add parser","body":"body","state":"open","html_url":"https://example.invalid/acme/widget/pull/8"}"#,
    })
    .await;

    let pr = client_for(&base)
        .create_pr(
            "acme",
            "widget",
            "Add parser",
            "body",
            "feature/parser",
            "main",
            PrDraft::Ready,
        )
        .await
        .expect("a ready pull request");

    let sent = captured(&seen).json();
    assert_eq!(
        sent.get("draft"),
        Some(&Value::Bool(false)),
        "the field is always serialized, so its value is asserted rather than its absence"
    );

    assert_eq!(pr.number, 8);
    assert!(!pr.draft, "a missing field must default to not-a-draft");
    assert_eq!(PrDraft::default(), PrDraft::Ready);
}

#[tokio::test]
async fn draft_refusal_keeps_the_github_error_shape() {
    let (base, seen) = spawn_stub(Reply {
        status: 422,
        body: r#"{"message":"Draft pull requests are not supported in this repository","documentation_url":"https://docs.github.com/rest"}"#,
    })
    .await;

    let error = client_for(&base)
        .create_pr(
            "acme",
            "widget",
            "Add parser",
            "body",
            "feature/parser",
            "main",
            PrDraft::Draft,
        )
        .await
        .expect_err("a 422 must not decode as a pull request");

    let GitError::GitHub(message) = error else {
        panic!("a draft refusal keeps the GitHub error variant, got {error:?}");
    };
    assert!(
        message.starts_with("GitHub returned HTTP 422: "),
        "unexpected message shape: {message}"
    );
    assert!(
        message.contains("Draft pull requests are not supported"),
        "the response detail must survive: {message}"
    );
    assert!(
        !message.contains(TOKEN),
        "the token must never reach an error message: {message}"
    );

    // The refusal is what the server answered, not a request that never went out.
    let request = captured(&seen);
    assert_eq!(request.header("authorization"), Some("Bearer test-token"));
    assert_eq!(request.json()["draft"], Value::Bool(true));
}
