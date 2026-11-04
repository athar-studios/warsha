//! The `/events` WebSocket handshake, against a real daemon (task #49).
//!
//! The measured break: `auth_handler_inner` read the credential out of the
//! `Authorization` header only, while `events_handler` did no auth of its own — and a
//! browser (the desktop's webview included) cannot set that header on a WebSocket
//! handshake, because the constructor takes a URL and a subprotocol list and nothing
//! else. So every `/events` socket the shipped client opens was refused, which is why
//! neither desktop mode ever saw a pushed event.
//!
//! The client carries its credential in a `warsha.token.<token>` subprotocol
//! (`packages/client/src/index.ts`), so the daemon now reads that too — on `/events`
//! only, through the same `Sessions::resolve` and the same refusal. What it still does
//! *not* read is the URL query string, and what it never does is echo the credential
//! back: RFC 6455 §1.9 has the server select one of the offered subprotocols, and the
//! one it selects is the non-secret `warsha.events.v1`.
//!
//! None of that is visible from a unit test with a stub router: the header the transport
//! hands the middleware, the subprotocol negotiation in the 101 reply, and the upgrade
//! itself are all decided at or below `axum::serve`. So this file speaks HTTP/1.1 on a
//! real socket to a real daemon and reads the bytes back, the way `gates_list.rs` and
//! `devices_pair.rs` drive the real daemon over the RPC transport.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine as _;
use serde_json::{json, Value};
use tempfile::{tempdir, TempDir};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use warshad::{start_daemon, DaemonConfig, DaemonHandle, RateLimitConfig};

/// The daemon's own bearer token: the owner credential the desktop holds.
const OWNER: &str = "events-ws-owner-token-7c1f";
/// A token this daemon has never issued, in either form.
const UNKNOWN: &str = "events-ws-unknown-token-3d9a";
/// The secret one phone is paired with, which is that phone's whole credential.
const PHONE_SECRET: &str = "events-ws-phone-secret-1a44";

/// The data-plane subprotocol the client offers and the daemon selects. Mirrors
/// `EVENTS_SUBPROTOCOL` in `crates/warshad/src/lib.rs` and `EVENTS_SUBPROTOCOL` in
/// `packages/client/src/index.ts` — the two ends of this string have to agree.
const EVENTS_SUBPROTOCOL: &str = "warsha.events.v1";
/// The prefix carrying the credential. Mirrors `TOKEN_SUBPROTOCOL_PREFIX` in the client.
const TOKEN_PREFIX: &str = "warsha.token.";

/// How long a test waits for one thing the daemon does on its own initiative.
const BEAT: Duration = Duration::from_secs(5);

/// A running daemon, the port its HTTP listener answers on, and the data directory it
/// holds a lock in for as long as the test is talking to it.
struct Daemon {
    handle: DaemonHandle,
    _dir: TempDir,
}

impl Daemon {
    async fn start() -> Self {
        let dir = tempdir().expect("a temporary directory");
        let config = DaemonConfig {
            data_dir: dir.path().to_path_buf(),
            socket_path: dir.path().join("warshad.sock"),
            http_port: 0,
            ws_port: 0,
            auth_token: OWNER.to_string(),
            allowed_origins: vec!["http://localhost:5173".to_string()],
            allowed_commands: Vec::new(),
            rate_limits: RateLimitConfig::default(),
        };
        Daemon {
            handle: start_daemon(config).await.expect("the daemon starts"),
            _dir: dir,
        }
    }

    fn http(&self) -> u16 {
        self.handle.http_port()
    }

    fn rpc(&self) -> u16 {
        self.handle.rpc_port()
    }

    async fn shutdown(self) {
        self.handle.shutdown().await;
    }
}

fn token_subprotocol(token: &str) -> String {
    format!("{TOKEN_PREFIX}{token}")
}

/// One handshake, as a caller would send it. The three credential forms — bearer
/// header, subprotocol, query string — are all expressible here so that each one's
/// acceptance or refusal is a test rather than an assumption.
struct Connect {
    path: String,
    bearer: Option<String>,
    subprotocols: Vec<String>,
}

impl Connect {
    fn to(path: &str) -> Self {
        Connect {
            path: path.to_string(),
            bearer: None,
            subprotocols: Vec::new(),
        }
    }

    fn with_bearer(mut self, token: &str) -> Self {
        self.bearer = Some(token.to_string());
        self
    }

    fn offering(mut self, subprotocols: &[String]) -> Self {
        self.subprotocols = subprotocols.to_vec();
        self
    }

    /// The list `@warsha/client` sends: the data-plane name first, the credential beside
    /// it. No bearer header, so a socket this builder opens is accepted only if the
    /// middleware reads the subprotocol.
    fn with_client_offering(self, token: &str) -> Self {
        self.offering(&[EVENTS_SUBPROTOCOL.to_string(), token_subprotocol(token)])
    }
}

/// A WebSocket frame, decoded just far enough to be asserted on. The daemon's side of
/// this is `axum`'s own protocol layer; hand-rolling the client half is what lets these
/// tests see the raw handshake reply rather than a library's summary of it.
struct Frame {
    opcode: u8,
    payload: Vec<u8>,
}

impl Frame {
    fn is_ping(&self) -> bool {
        self.opcode == 0x9
    }

    fn is_text(&self) -> bool {
        self.opcode == 0x1
    }

    fn payload_text(&self) -> String {
        String::from_utf8_lossy(&self.payload).into_owned()
    }
}

/// The socket behind a completed upgrade, plus whatever bytes were already buffered
/// after the handshake reply.
struct Socket {
    stream: TcpStream,
    buffer: Vec<u8>,
}

impl Socket {
    async fn fill(&mut self, want: usize) -> Option<()> {
        let mut chunk = [0u8; 4096];
        while self.buffer.len() < want {
            let read = match tokio::time::timeout(BEAT, self.stream.read(&mut chunk)).await {
                Ok(Ok(read)) => read,
                // Deadline or EOF: there is no frame to be had.
                _ => return None,
            };
            if read == 0 {
                return None;
            }
            self.buffer.extend_from_slice(&chunk[..read]);
        }
        Some(())
    }

    /// One frame from the server, or `None` at EOF or deadline. Server frames are never
    /// masked, so a masked frame here would be a protocol error worth failing on.
    async fn read_frame(&mut self) -> Option<Frame> {
        self.fill(2).await?;
        let opcode = self.buffer[0] & 0x0f;
        let masked = self.buffer[1] & 0x80 != 0;
        let short = (self.buffer[1] & 0x7f) as u64;
        let offset = 2;
        let len = match short {
            126 => {
                self.fill(4).await?;
                u16::from_be_bytes([self.buffer[2], self.buffer[3]]) as u64
            }
            127 => {
                self.fill(10).await?;
                let bytes: [u8; 8] = self.buffer[2..10].try_into().ok()?;
                u64::from_be_bytes(bytes)
            }
            n => n,
        };
        if masked || len > 1_048_576 {
            return None;
        }
        self.fill(offset + len as usize).await?;
        let payload = self.buffer[offset..offset + len as usize].to_vec();
        self.buffer.drain(..offset + len as usize);
        Some(Frame { opcode, payload })
    }

    /// The next frame, bounded.
    async fn next(&mut self) -> Option<Frame> {
        tokio::time::timeout(BEAT, self.read_frame()).await.ok()?
    }

    /// The text of every frame received up to the daemon's first Ping, which is what
    /// proves this socket really is the `/events` handler's loop and not a bare upgrade:
    /// `handle_events_socket` ticks its keepalive interval immediately on entry, so the
    /// first thing a subscribed socket is handed is that Ping.
    async fn until_first_ping(&mut self) -> String {
        let mut received = String::new();
        for _ in 0..8 {
            let Some(frame) = self.next().await else {
                panic!(
                    "no keepalive beat arrived on the upgraded socket: the `/events` handler \
                     never ran on it (frames so far: {received:?})"
                );
            };
            if frame.is_ping() {
                return received;
            }
            assert!(
                !frame.is_text(),
                "the daemon pushed an event frame the test did not expect: {}",
                frame.payload_text()
            );
            received.push_str(&frame.payload_text());
        }
        panic!("the first eight frames on the socket were not the events keepalive Ping")
    }
}

/// Everything the daemon answered: the raw bytes of the reply, its parsed status and
/// headers, the body of a refusal, and — only when the upgrade happened — the socket.
struct Reply {
    status: u16,
    raw_head: Vec<u8>,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
    socket: Option<Socket>,
}

impl Reply {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    /// Every byte the daemon put on the wire back at us, for the assertions that a
    /// credential is not among them.
    fn wire_text(&self) -> String {
        let mut text = String::from_utf8_lossy(&self.raw_head).into_owned();
        text.push_str(&String::from_utf8_lossy(&self.body));
        text
    }

    fn is_upgraded(&self) -> bool {
        self.status == 101 && self.socket.is_some()
    }

    fn into_socket(self) -> Socket {
        let raw = self.wire_text();
        assert!(
            self.is_upgraded(),
            "no socket was upgraded to take over; the daemon answered {raw:?}"
        );
        self.socket.expect("an upgraded socket, checked above")
    }
}

/// `GET` the handshake and read the reply. A 101 keeps the connection (it *is* the
/// socket); anything else is read as an ordinary HTTP response, because that is what a
/// refusal of an upgrade is.
async fn open(port: u16, connect: &Connect) -> Reply {
    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .await
        .expect("the daemon's HTTP port accepts a connection");

    let mut request = format!(
        "GET {} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\n\
         Connection: Upgrade\r\nSec-WebSocket-Key: {}\r\nSec-WebSocket-Version: 13\r\n",
        connect.path,
        sec_websocket_key()
    );
    if let Some(bearer) = &connect.bearer {
        request.push_str(&format!("Authorization: Bearer {bearer}\r\n"));
    }
    if !connect.subprotocols.is_empty() {
        request.push_str(&format!(
            "Sec-WebSocket-Protocol: {}\r\n",
            connect.subprotocols.join(", ")
        ));
    }
    request.push_str("\r\n");
    stream
        .write_all(request.as_bytes())
        .await
        .expect("the handshake reaches the daemon");

    let (raw_head, mut rest) = read_head(&mut stream).await;
    let (status, headers) = parse_head(&raw_head);
    if status == 101 {
        return Reply {
            status,
            raw_head,
            headers,
            body: Vec::new(),
            socket: Some(Socket {
                stream,
                buffer: rest,
            }),
        };
    }
    let body = read_body(&mut stream, &headers, &mut rest).await;
    Reply {
        status,
        raw_head,
        headers,
        body,
        socket: None,
    }
}

/// A distinct `Sec-WebSocket-Key` per handshake. Its value is not a secret and is not
/// asserted on; the daemon computes its own `Sec-WebSocket-Accept` from it.
fn sec_websocket_key() -> String {
    static CONNECTIONS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let index = CONNECTIONS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let mut bytes = [0xa7u8; 16];
    bytes[..4].copy_from_slice(&index.to_be_bytes());
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

async fn read_head(stream: &mut TcpStream) -> (Vec<u8>, Vec<u8>) {
    let mut buffer: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let read = tokio::time::timeout(BEAT, stream.read(&mut chunk))
            .await
            .expect("the daemon answers the handshake")
            .expect("the connection stays open long enough to answer");
        if read == 0 {
            panic!(
                "the daemon closed the connection without answering: {:?}",
                String::from_utf8_lossy(&buffer)
            );
        }
        buffer.extend_from_slice(&chunk[..read]);
        assert!(
            buffer.len() < 65_536,
            "a handshake reply that big: {buffer:?}"
        );
        if let Some(end) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            let head = buffer[..end + 4].to_vec();
            let rest = buffer[end + 4..].to_vec();
            return (head, rest);
        }
    }
}

fn parse_head(head: &[u8]) -> (u16, Vec<(String, String)>) {
    let text = String::from_utf8_lossy(head).into_owned();
    let mut lines = text.split("\r\n").filter(|line| !line.is_empty());
    let status_line = lines
        .next()
        .unwrap_or_else(|| panic!("a handshake reply with no status line: {text:?}"));
    let status: u16 = status_line
        .split_whitespace()
        .nth(1)
        .unwrap_or_else(|| panic!("a status line with no code: {status_line:?}"))
        .parse()
        .unwrap_or_else(|error| {
            panic!("a status line that is not a code: {status_line:?} ({error})")
        });
    let headers = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_string()))
        .collect();
    (status, headers)
}

async fn read_body(
    stream: &mut TcpStream,
    headers: &[(String, String)],
    rest: &mut Vec<u8>,
) -> Vec<u8> {
    let expected = headers
        .iter()
        .find(|(name, _)| name == "content-length")
        .and_then(|(_, value)| value.parse::<usize>().ok());
    let mut chunk = [0u8; 1024];
    match expected {
        Some(want) => {
            while rest.len() < want {
                let read = tokio::time::timeout(BEAT, stream.read(&mut chunk))
                    .await
                    .expect("the refusal body arrives")
                    .expect("the connection stays open long enough to answer");
                if read == 0 {
                    break;
                }
                rest.extend_from_slice(&chunk[..read]);
            }
            rest.truncate(want);
            rest.clone()
        }
        // A refusal with no length: read until the daemon closes it, bounded so a wrong
        // assumption here fails the test instead of hanging it.
        None => {
            while let Ok(Ok(read)) =
                tokio::time::timeout(Duration::from_secs(1), stream.read(&mut chunk)).await
            {
                if read == 0 {
                    break;
                }
                rest.extend_from_slice(&chunk[..read]);
            }
            rest.clone()
        }
    }
}

/// One JSON-RPC call over the daemon's RPC port, with the credential the caller presents
/// in the only place that transport reads one.
async fn rpc(
    port: u16,
    headers: &[(&str, String)],
    method: &str,
    params: Value,
) -> reqwest::StatusCode {
    let mut request = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{port}"))
        .json(&json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params }));
    for (name, value) in headers {
        request = request.header(*name, value.clone());
    }
    request.send().await.expect("the daemon answers").status()
}

/// `pairing.create` as the owner, so a phone's secret is a credential this daemon
/// recognises.
async fn pair_a_phone(port: u16, device: &str, secret: &str) {
    let status = rpc(
        port,
        &[("Authorization", format!("Bearer {OWNER}"))],
        "pairing.create",
        json!([device, secret]),
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::OK,
        "the owner could not mint the pairing this test needs"
    );
}

// --------------------------------------------------------------------------------
// The accepted cases.
// --------------------------------------------------------------------------------

/// The bug, and its fix: a `/events` caller whose only credential is a
/// `warsha.token.<token>` subprotocol is authenticated by the same `Sessions::resolve`
/// the bearer header goes through, upgraded, and handed the live event socket.
#[tokio::test]
async fn a_credential_carried_only_in_the_subprotocol_opens_the_events_socket() {
    let daemon = Daemon::start().await;
    let reply = open(
        daemon.http(),
        &Connect::to("/events").with_client_offering(OWNER),
    )
    .await;

    assert_eq!(
        reply.status,
        101,
        "a subprotocol credential did not open `/events`: {}",
        reply.wire_text()
    );
    assert_eq!(
        reply
            .header("upgrade")
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("websocket"),
        "the answer was not an upgrade: {}",
        reply.wire_text()
    );

    // The keepalive Ping is the `/events` loop speaking, so the socket is not merely
    // upgraded: it is attached to the stream.
    let mut socket = reply.into_socket();
    socket.until_first_ping().await;

    daemon.shutdown().await;
}

/// Regression: the header path is untouched. A caller that sends `Authorization` and no
/// subprotocol is still accepted, and its reply is still exactly what it was — no
/// `Sec-WebSocket-Protocol`, because nothing selectable was offered.
#[tokio::test]
async fn the_authorization_header_still_opens_the_events_socket_unchanged() {
    let daemon = Daemon::start().await;
    let reply = open(daemon.http(), &Connect::to("/events").with_bearer(OWNER)).await;

    assert_eq!(
        reply.status,
        101,
        "the bearer header stopped being a credential on `/events`: {}",
        reply.wire_text()
    );
    assert_eq!(
        reply.header("sec-websocket-protocol"),
        None,
        "a caller that offered no subprotocol was handed a selection it never asked for"
    );

    open(daemon.http(), &Connect::to("/events").with_bearer(UNKNOWN))
        .await
        .expect_refused();

    let mut socket = reply.into_socket();
    socket.until_first_ping().await;

    daemon.shutdown().await;
}

/// The other half of the handshake: the server must *select* one of the subprotocols the
/// client offered, or a client that offered one may treat the connection as failed. The
/// selection is the non-secret data-plane name. Where a client offers nothing but its
/// credential the daemon selects nothing, because the only thing it could echo is the
/// secret — asserted below, and again by `the_credential_never_reaches_the_wire_or_the_logs`.
#[tokio::test]
async fn the_handshake_selects_the_data_plane_protocol_the_client_offered() {
    let daemon = Daemon::start().await;

    // The client's own shape: data-plane name first, credential beside it.
    let with_both = open(
        daemon.http(),
        &Connect::to("/events").with_client_offering(OWNER),
    )
    .await;
    assert_eq!(with_both.status, 101, "{}", with_both.wire_text());
    assert_eq!(
        with_both.header("sec-websocket-protocol"),
        Some(EVENTS_SUBPROTOCOL),
        "the handshake reply did not select the protocol the client offered: {}",
        with_both.wire_text()
    );

    // The credential alone: accepted (the middleware reads it), but there is no
    // non-secret protocol on offer to select, so the reply says nothing about
    // subprotocols rather than repeating the caller's secret back at it.
    let credential_only = open(
        daemon.http(),
        &Connect::to("/events").offering(&[token_subprotocol(OWNER)]),
    )
    .await;
    assert_eq!(
        credential_only.status,
        101,
        "a client that offers only its credential was still refused: {}",
        credential_only.wire_text()
    );
    assert_eq!(
        credential_only.header("sec-websocket-protocol"),
        None,
        "the handshake selected something"
    );

    let mut socket = with_both.into_socket();
    socket.until_first_ping().await;

    daemon.shutdown().await;
}

/// A paired phone's secret is a credential like any other: the same `Sessions::resolve`
/// answers for it on the subprotocol path, so a phone can watch the stream it is paired
/// to see.
#[tokio::test]
async fn a_paired_phone_secret_opens_the_events_socket_through_the_subprotocol() {
    let daemon = Daemon::start().await;
    pair_a_phone(daemon.rpc(), "events-ws-phone", PHONE_SECRET).await;

    let reply = open(
        daemon.http(),
        &Connect::to("/events").with_client_offering(PHONE_SECRET),
    )
    .await;
    assert_eq!(
        reply.status,
        101,
        "the subprotocol path did not reach the pairing store: {}",
        reply.wire_text()
    );

    let mut socket = reply.into_socket();
    socket.until_first_ping().await;

    daemon.shutdown().await;
}

// --------------------------------------------------------------------------------
// The refusals.
// --------------------------------------------------------------------------------

impl Reply {
    /// The refusal `/events` gives a caller the middleware did not recognise: the status
    /// and body the header path has always used, and no socket.
    fn expect_refused(&self) {
        assert_eq!(
            self.status,
            401,
            "expected a refusal, got: {}",
            self.wire_text()
        );
        assert_eq!(
            String::from_utf8_lossy(&self.body),
            "{\"error\":\"unauthorized\"}",
            "the refusal body is not the one the header path uses: {}",
            self.wire_text()
        );
        assert!(
            !self.is_upgraded(),
            "a refused caller was handed a socket anyway: {}",
            self.wire_text()
        );
        assert_eq!(
            self.header("sec-websocket-protocol"),
            None,
            "a refusal selected a subprotocol: {}",
            self.wire_text()
        );
    }
}

/// No credential in any form: refused with the middleware's 401, and — the point of the
/// refusal — no socket exists for that caller to read anyone's stream through.
#[tokio::test]
async fn a_caller_with_no_credential_gets_no_socket_and_so_no_stream() {
    let daemon = Daemon::start().await;

    open(daemon.http(), &Connect::to("/events"))
        .await
        .expect_refused();

    // The data-plane name is a protocol, not a credential: offering it, even first,
    // authenticates nobody.
    open(
        daemon.http(),
        &Connect::to("/events").offering(&[EVENTS_SUBPROTOCOL.to_string()]),
    )
    .await
    .expect_refused();

    // An empty credential after the prefix is no credential, the same way an empty
    // bearer token is none.
    open(
        daemon.http(),
        &Connect::to("/events")
            .offering(&[EVENTS_SUBPROTOCOL.to_string(), TOKEN_PREFIX.to_string()]),
    )
    .await
    .expect_refused();

    // And a bearer header that is present but not a bearer token does not stop the
    // subprotocol from being read — the header is simply absent as a credential.
    let header_that_carries_nothing = open(
        daemon.http(),
        &Connect::to("/events")
            .with_bearer("")
            .with_client_offering(OWNER),
    )
    .await;
    assert_eq!(
        header_that_carries_nothing.status,
        101,
        "a header that carries no token blocked the subprotocol credential: {}",
        header_that_carries_nothing.wire_text()
    );

    daemon.shutdown().await;
}

/// Every way of failing to authenticate `/events` is refused identically: same status,
/// same body, same absence of a socket. A caller learns nothing about *which* of
/// "no credential", "unknown token" and "wrong form" it was.
#[tokio::test]
async fn every_refused_events_credential_is_refused_the_same_way() {
    let daemon = Daemon::start().await;

    let no_credential = open(daemon.http(), &Connect::to("/events")).await;
    let bogus_header = open(daemon.http(), &Connect::to("/events").with_bearer(UNKNOWN)).await;
    let bogus_subprotocol = open(
        daemon.http(),
        &Connect::to("/events").with_client_offering(UNKNOWN),
    )
    .await;
    let bogus_in_both = open(
        daemon.http(),
        &Connect::to("/events")
            .with_bearer(UNKNOWN)
            .offering(&[token_subprotocol(UNKNOWN)]),
    )
    .await;

    for refusal in [
        &no_credential,
        &bogus_header,
        &bogus_subprotocol,
        &bogus_in_both,
    ] {
        refusal.expect_refused();
    }
    for refusal in [&bogus_header, &bogus_subprotocol, &bogus_in_both] {
        assert_eq!(
            refusal.body,
            no_credential.body,
            "an unrecognised credential was refused with a body the no-credential caller \
             did not get: {}",
            refusal.wire_text()
        );
        assert_eq!(refusal.status, no_credential.status);
    }

    daemon.shutdown().await;
}

/// The forbidden shortcut, pinned as forbidden: a token in the query string is not a
/// credential. It is the easier fix — a browser *can* put a token in a URL — and it is
/// the one that leaks, because a URL is recorded by access logs, browser history and
/// `Referer` headers on every hop between the caller and this listener.
#[tokio::test]
async fn a_token_in_the_url_is_not_a_credential_and_is_not_echoed() {
    let daemon = Daemon::start().await;

    open(
        daemon.http(),
        &Connect::to(&format!("/events?token={OWNER}")),
    )
    .await
    .expect_refused();

    // A query token does not become a credential by sitting beside a real subprotocol
    // either — and the two forms are not mixed into one credential.
    let query_only_for_owner = open(
        daemon.http(),
        &Connect::to(&format!("/events?token={OWNER}&bearer={UNKNOWN}")).with_bearer(UNKNOWN),
    )
    .await;
    query_only_for_owner.expect_refused();
    assert!(
        !query_only_for_owner.wire_text().contains(OWNER),
        "the refusal echoed the URL token back: {}",
        query_only_for_owner.wire_text()
    );

    daemon.shutdown().await;
}

/// The subprotocol credential is read on `/events` and nowhere else. Every other route on
/// this daemon — the RPC transport's HTTP face here, and `/health` on the listener —
/// keeps the rule it has always had, so the exception stays one route wide.
#[tokio::test]
async fn the_subprotocol_credential_is_read_on_events_only() {
    let daemon = Daemon::start().await;

    // The RPC transport authenticates from the header only (`RpcAuthService`), so a
    // caller that presents the owner's credential as a subprotocol and no header is not
    // the owner there.
    let subprotocol_only = format!("{EVENTS_SUBPROTOCOL}, {}", token_subprotocol(OWNER));
    let status = rpc(
        daemon.rpc(),
        &[("Sec-WebSocket-Protocol", subprotocol_only)],
        "projects.list",
        json!([]),
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::UNAUTHORIZED,
        "a subprotocol credential opened an RPC method that the header path refuses"
    );

    // Same credential, same method, as a header: proves the refusal above is the form
    // and not the token.
    let with_header = rpc(
        daemon.rpc(),
        &[("Authorization", format!("Bearer {OWNER}"))],
        "projects.list",
        json!([]),
    )
    .await;
    assert_eq!(with_header, reqwest::StatusCode::OK);

    // `/health` is the one route that answers without a credential, and it does not
    // become a session by being given one.
    let health = open(
        daemon.http(),
        &Connect::to("/health").with_client_offering(OWNER),
    )
    .await;
    assert_eq!(
        health.status,
        200,
        "/health stopped answering an unauthenticated caller: {}",
        health.wire_text()
    );

    daemon.shutdown().await;
}

// --------------------------------------------------------------------------------
// The credential stays where it was put.
// --------------------------------------------------------------------------------

/// Every field of every event this process logs, captured.
#[derive(Clone, Default)]
struct LogCapture(Arc<Mutex<Vec<String>>>);

impl LogCapture {
    fn push(&self, line: String) {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(line);
    }

    fn lines(&self) -> Vec<String> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    fn clear(&self) {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
    }
}

/// All of an event's fields, not just its message: a credential leaking into a structured
/// field is exactly as leaked as one in the sentence beside it.
#[derive(Default)]
struct FieldVisitor {
    text: String,
}

impl tracing::field::Visit for FieldVisitor {
    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        use std::fmt::Write as _;
        let _ = write!(self.text, " {}={}", field.name(), value);
    }

    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        use std::fmt::Write as _;
        let _ = write!(self.text, " {}={:?}", field.name(), value);
    }
}

struct CaptureLayer(LogCapture);

impl<S: tracing::Subscriber> tracing_subscriber::Layer<S> for CaptureLayer {
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        let mut visitor = FieldVisitor::default();
        event.record(&mut visitor);
        self.0.push(format!(
            "{} {}{}",
            event.metadata().level(),
            event.metadata().target(),
            visitor.text
        ));
    }
}

/// The capture, with a filter mounted beside it. The filter is not decoration: tracing
/// caches per-callsite whether it is *ever* enabled, and a callsite first reached by
/// another test with no subscriber of its own is cached as "never", which blinds a
/// thread-local capture to exactly the line it is looking for. A subscriber answering
/// `Interest::sometimes()` bypasses that cache.
fn capture_subscriber(capture: &LogCapture) -> impl tracing::Subscriber + Send + Sync + 'static {
    use tracing_subscriber::layer::SubscriberExt as _;

    tracing_subscriber::Registry::default()
        .with(CaptureLayer(capture.clone()))
        .with(tracing_subscriber::filter::Targets::new().with_default(tracing::Level::TRACE))
}

/// The credential is not a thing this listener says out loud. Accepted, refused, and
/// refused in a different shape: none of the replies carry it, and none of the log lines
/// do — at TRACE, on every target in the process, including the URL-token handshake whose
/// path *is* logged while its query is not.
///
/// The capture deliberately holds no RPC calls. Measured while writing this: the RPC
/// transport's own TRACE line (`jsonrpsee_server` printing the request it is serving)
/// includes the request headers, so an `Authorization: Bearer <token>` call at TRACE puts
/// that credential in a log line. That is pre-existing, on the other port, behind an
/// operator who set `RUST_LOG` above the default `info,warshad=debug`
/// (`crates/warshad/src/main.rs:12`), and untouched by this task — it is reported rather
/// than asserted on, because a test that *requires* a dependency's leaky line to stay
/// leaky is the wrong kind of pin. What is pinned here is that the path this task changed
/// never produces one.
#[tokio::test]
async fn the_credential_never_reaches_the_wire_or_the_logs() {
    let capture = LogCapture::default();
    let _guard = tracing::subscriber::set_default(capture_subscriber(&capture));

    let daemon = Daemon::start().await;
    capture.clear();

    let accepted = open(
        daemon.http(),
        &Connect::to("/events").with_client_offering(OWNER),
    )
    .await;
    assert_eq!(accepted.status, 101, "{}", accepted.wire_text());
    let accepted_raw = accepted.wire_text();
    let mut socket = accepted.into_socket();
    let frames_before_beat = socket.until_first_ping().await;

    open(daemon.http(), &Connect::to("/events"))
        .await
        .expect_refused();
    let unknown = open(
        daemon.http(),
        &Connect::to("/events").with_client_offering(UNKNOWN),
    )
    .await;
    unknown.expect_refused();
    let unknown_raw = unknown.wire_text();
    let in_url = open(
        daemon.http(),
        &Connect::to(&format!("/events?token={OWNER}")),
    )
    .await;
    in_url.expect_refused();
    let in_url_raw = in_url.wire_text();

    // The two forms at once, with the header winning: the credential the middleware
    // *used* is the bearer one, and the one it ignored is a token this daemon has never
    // issued. Neither is a thing the reply or the log says.
    let header_authenticated = open(
        daemon.http(),
        &Connect::to("/events")
            .with_bearer(OWNER)
            .with_client_offering(UNKNOWN),
    )
    .await;
    assert_eq!(
        header_authenticated.status,
        101,
        "{}",
        header_authenticated.wire_text()
    );
    let header_raw = header_authenticated.wire_text();

    let lines = capture.lines();
    // The control that keeps the silence above from being vacuous: the middleware's own
    // refusal line for this path is in the capture, so the capture was watching the code
    // that would have leaked — and it names the path, not the query.
    assert!(
        lines
            .iter()
            .any(|line| line.contains("Unauthorized request to /events")),
        "the capture never saw the middleware's refusal, so its silence proves nothing: \
         {lines:?}"
    );
    assert!(
        !lines.iter().any(|line| line.contains("?token=")),
        "a log line carries the request's query string, which is where the URL-token \
         form would put the credential: {lines:?}"
    );

    let secrets = [OWNER, UNKNOWN];
    for line in &lines {
        for secret in secrets {
            assert!(
                !line.contains(secret),
                "the daemon logged the credential {secret} in: {line}"
            );
        }
        assert!(
            !line.contains(TOKEN_PREFIX),
            "a log line carries a whole subprotocol credential in it: {line}"
        );
    }
    for (label, wire) in [
        ("accepted handshake", &accepted_raw),
        ("unknown-token refusal", &unknown_raw),
        ("url-token refusal", &in_url_raw),
        ("header-authenticated socket", &header_raw),
        ("frames pushed before the beat", &frames_before_beat),
    ] {
        for secret in secrets {
            assert!(
                !wire.contains(secret),
                "the daemon put the credential {secret} on the wire in the {label}: {wire}"
            );
        }
    }

    daemon.shutdown().await;
}
