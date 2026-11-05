//! The `/events` stream actually streams, against a real daemon (task #73).
//!
//! The measured gap: the socket authenticated and handshook (`events_ws_auth.rs`) and
//! even received keepalive Pings, but nothing in the workspace ever *published* an
//! event, so an owner watching Simple or Advanced mode held a stream that could never
//! deliver a frame. Publishing now lives inside `Store::append_event` — the one write
//! every producer goes through — and `/events` subscribes to that bus.
//!
//! This test asserts delivery, not bus internals: it holds an authenticated socket
//! open, drives two real owner actions over the RPC transport (a run start, then a
//! gate approval), and requires each to arrive on the socket as the *same* `Event`
//! the store later answers through `runs.events` — same `id`, same `run_id`, same
//! `kind`. The `Lagged` policy is deliberately not re-tested here: what it means is
//! that a phone reconnecting after a burst does not see the dropped frames replayed
//! (it catches up through `runs.events`), and the pipeline is never stalled or
//! corrupted to satisfy a slow viewer.

use std::path::PathBuf;
use std::time::Duration;

use base64::Engine as _;
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use warshad::{start_daemon, DaemonConfig, DaemonHandle, RateLimitConfig};

/// The daemon's own bearer token: the owner credential the desktop holds.
const OWNER: &str = "events-live-owner-token-9f2e";
/// The data-plane subprotocol the client offers and the daemon selects.
const EVENTS_SUBPROTOCOL: &str = "warsha.events.v1";
/// The prefix carrying the credential, as `packages/client/src/index.ts` sends it.
const TOKEN_PREFIX: &str = "warsha.token.";
/// How long a test waits for one thing the daemon does on its own initiative.
const BEAT: Duration = Duration::from_secs(5);

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
            // The bind address keeps the loopback default and nothing is advertised:
            // this daemon is only ever dialed from the test process on this machine.
            ..DaemonConfig::default()
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

// --------------------------------------------------------------------------------
// The RPC half: the same JSON-RPC-over-HTTP calls `gates_list.rs` makes.
// --------------------------------------------------------------------------------

async fn rpc_ok(port: u16, method: &str, params: Value) -> Value {
    let response = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{port}"))
        .header("Authorization", format!("Bearer {OWNER}"))
        .json(&json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params }))
        .send()
        .await
        .expect("the daemon answers");
    assert_eq!(
        response.status(),
        reqwest::StatusCode::OK,
        "{method} did not reach the daemon"
    );
    let body = response.json::<Value>().await.expect("a JSON answer");
    assert!(
        body.get("result").is_some(),
        "{method} returned an error: {body}"
    );
    body["result"].clone()
}

// --------------------------------------------------------------------------------
// The WebSocket half: the raw HTTP/1.1 machinery from `events_ws_auth.rs`, kept to
// exactly what a delivery test reads.
// --------------------------------------------------------------------------------

/// The socket behind a completed `/events` upgrade, plus bytes already buffered
/// after the handshake reply.
struct Socket {
    stream: TcpStream,
    buffer: Vec<u8>,
}

/// `GET` the handshake with the client's own subprotocol offering — the data-plane
/// name first, the credential beside it — and return the upgraded socket.
async fn open_events_socket(port: u16) -> Socket {
    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .await
        .expect("the daemon's HTTP port accepts a connection");
    let key = {
        let mut bytes = [0x5au8; 16];
        bytes[..2].copy_from_slice(&u16::to_be_bytes(0xdead));
        base64::engine::general_purpose::STANDARD.encode(bytes)
    };
    let request = format!(
        "GET /events HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\n\
         Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\
         Sec-WebSocket-Protocol: {EVENTS_SUBPROTOCOL}, {TOKEN_PREFIX}{OWNER}\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .await
        .expect("the handshake reaches the daemon");

    let mut head: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];
    let rest;
    loop {
        let read = tokio::time::timeout(BEAT, stream.read(&mut chunk))
            .await
            .expect("the daemon answers the handshake")
            .expect("the connection stays open long enough to answer");
        assert_ne!(read, 0, "the daemon closed the handshake without answering");
        head.extend_from_slice(&chunk[..read]);
        if let Some(end) = head.windows(4).position(|w| w == b"\r\n\r\n") {
            let tail = head[end + 4..].to_vec();
            head.truncate(end + 4);
            rest = tail;
            break;
        }
        assert!(head.len() < 65_536, "a handshake reply that big: {head:?}");
    }
    let text = String::from_utf8_lossy(&head).into_owned();
    assert!(
        text.starts_with("HTTP/1.1 101")
            && text.to_ascii_lowercase().contains("upgrade: websocket"),
        "the events socket was not upgraded: {text:?}"
    );
    assert!(
        text.to_ascii_lowercase()
            .contains(&format!("sec-websocket-protocol: {EVENTS_SUBPROTOCOL}")),
        "the handshake did not select the data-plane protocol: {text:?}"
    );
    Socket {
        stream,
        buffer: rest,
    }
}

impl Socket {
    async fn fill(&mut self, want: usize) -> Option<()> {
        let mut chunk = [0u8; 4096];
        while self.buffer.len() < want {
            let read = match tokio::time::timeout(BEAT, self.stream.read(&mut chunk)).await {
                Ok(Ok(read)) if read > 0 => read,
                _ => return None,
            };
            self.buffer.extend_from_slice(&chunk[..read]);
        }
        Some(())
    }

    /// One server frame. Server frames are never masked; a masked one is treated as
    /// the protocol error it is and ends the read. The header is 2, 4 or 10 bytes
    /// depending on the length field, and the payload starts after the whole header.
    async fn read_frame(&mut self) -> Option<(u8, Vec<u8>)> {
        self.fill(2).await?;
        let opcode = self.buffer[0] & 0x0f;
        let masked = self.buffer[1] & 0x80 != 0;
        let short = (self.buffer[1] & 0x7f) as u64;
        let mut header = 2usize;
        let len = match short {
            126 => {
                header += 2;
                self.fill(header).await?;
                u16::from_be_bytes(self.buffer[2..4].try_into().ok()?) as u64
            }
            127 => {
                header += 8;
                self.fill(header).await?;
                u64::from_be_bytes(self.buffer[2..10].try_into().ok()?)
            }
            n => n,
        };
        if masked || len > 1_048_576 {
            return None;
        }
        let end = header + len as usize;
        self.fill(end).await?;
        let payload = self.buffer[header..end].to_vec();
        self.buffer.drain(..end);
        Some((opcode, payload))
    }

    /// Wait for the daemon's keepalive Ping: proof the socket is attached to the
    /// events loop and not merely upgraded. `handle_events_socket` ticks its
    /// keepalive interval immediately on entry, and no event has been produced
    /// yet, so the first frame on this socket can only be that Ping.
    async fn expect_attached(&mut self) {
        let (opcode, _) = self.next_frame("the keepalive beat").await;
        assert_eq!(
            opcode, 0x9,
            "the first frame on the upgraded socket was not the keepalive Ping: opcode {opcode} — \
             the /events handler never ran on it"
        );
    }

    /// The next TEXT frame — the pushed event — with keepalive Pings skipped. A
    /// delivery test reads at most this many frames before declaring the stream
    /// silent.
    async fn next_event_frame(&mut self) -> Value {
        for _ in 0..16 {
            let (opcode, payload) = self.next_frame("a pushed event").await;
            if opcode == 0x9 {
                continue;
            }
            assert_eq!(
                opcode, 0x1,
                "expected a text event frame, got opcode {opcode}"
            );
            let text = String::from_utf8_lossy(&payload).into_owned();
            return serde_json::from_str(&text)
                .unwrap_or_else(|e| panic!("the pushed frame is not an Event JSON: {text} ({e})"));
        }
        panic!("sixteen frames in and the socket never carried a text event frame")
    }

    async fn next_frame(&mut self, waiting_for: &str) -> (u8, Vec<u8>) {
        tokio::time::timeout(BEAT, self.read_frame())
            .await
            .unwrap_or_else(|_| {
                panic!("no frame arrived within {BEAT:?}, while waiting for {waiting_for}")
            })
            .unwrap_or_else(|| panic!("the socket ended while waiting for {waiting_for}"))
    }
}

/// The store's answer for the event the socket just delivered, by `id`.
fn store_event_by_id(events: &[Value], id: &str) -> Value {
    events
        .iter()
        .find(|event| event["id"].as_str() == Some(id))
        .unwrap_or_else(|| {
            panic!("the store's log does not hold the delivered event {id}: {events:?}")
        })
        .clone()
}

/// The gap, closed: an authenticated `/events` socket held open across two real
/// owner actions receives both events, and each one is byte-for-byte the event the
/// store persisted.
#[tokio::test]
async fn an_open_events_socket_receives_the_events_a_run_start_and_a_gate_decision_produce() {
    let daemon = Daemon::start().await;

    // 1. The socket opens first: it must see what happens after it attached, so
    //    every event asserted below was produced while it was listening.
    let mut socket = open_events_socket(daemon.http()).await;
    socket.expect_attached().await;

    // 2. A run start. `runs.start` commits a StageStarted event through the
    //    pipeline's store write.
    let project = rpc_ok(
        daemon.rpc(),
        "projects.create",
        json!(["Live Events Shop", "a stream to watch", "en"]),
    )
    .await;
    let run = rpc_ok(
        daemon.rpc(),
        "runs.start",
        json!([project["id"], "build the live shop"]),
    )
    .await;
    let run_id = run["id"].as_str().expect("a run id").to_string();

    let started = socket.next_event_frame().await;
    assert_eq!(started["run_id"].as_str(), Some(run_id.as_str()));
    assert_eq!(started["kind"], json!("stage_started"));

    // 3. A gate decision, same socket still open.
    rpc_ok(
        daemon.rpc(),
        "gates.approve",
        json!([run_id.clone(), "gate_a"]),
    )
    .await;

    let decided = socket.next_event_frame().await;
    assert_eq!(decided["run_id"].as_str(), Some(run_id.as_str()));
    assert_eq!(decided["kind"], json!("gate_decision"));

    // 4. Delivery, not bus internals: the frame the socket got is the event the
    //    store holds — same `id`, same `run_id`, same `kind`, same payload. The
    //    app and the store cannot disagree about what an event is, because they
    //    are looking at the same one.
    let stored = rpc_ok(daemon.rpc(), "runs.events", json!([run_id.clone()])).await;
    let stored = stored.as_array().expect("the run's event log").clone();
    for delivered in [&started, &decided] {
        let id = delivered["id"].as_str().expect("an event id").to_string();
        let persisted = store_event_by_id(&stored, &id);
        assert_eq!(
            persisted["id"], delivered["id"],
            "the delivered event names an id the store does not have"
        );
        assert_eq!(persisted["run_id"], delivered["run_id"]);
        assert_eq!(persisted["kind"], delivered["kind"]);
        assert_eq!(persisted["stage"], delivered["stage"]);
        assert_eq!(persisted["payload"], delivered["payload"]);
    }

    daemon.shutdown().await;
}

/// An event produced with nobody watching is still durable and still answerable:
/// the daemon must accept the write with no socket attached, and a socket that
/// attaches afterwards catches up through `runs.events`, not through a replay the
/// bus never kept.
#[tokio::test]
async fn a_run_start_with_no_socket_attached_is_persisted_and_readable_afterwards() {
    let daemon = Daemon::start().await;

    let project = rpc_ok(
        daemon.rpc(),
        "projects.create",
        json!(["Unwatched Shop", "no listener yet", "en"]),
    )
    .await;
    let run = rpc_ok(
        daemon.rpc(),
        "runs.start",
        json!([project["id"], "an idea nobody was streaming"]),
    )
    .await;
    let run_id = run["id"].as_str().expect("a run id").to_string();

    let stored = rpc_ok(daemon.rpc(), "runs.events", json!([run_id.clone()])).await;
    let started = stored
        .as_array()
        .expect("the run's event log")
        .iter()
        .find(|event| event["kind"] == json!("stage_started"))
        .expect("the unwatched run start is in the store");
    assert_eq!(started["run_id"].as_str(), Some(run_id.as_str()));

    // A socket opened after the fact attaches cleanly and waits: the past is the
    // store's job (`runs.events` above), the socket's job is what comes next.
    let mut socket = open_events_socket(daemon.http()).await;
    socket.expect_attached().await;
    rpc_ok(daemon.rpc(), "gates.approve", json!([run_id, "gate_b"])).await;
    let decided = socket.next_event_frame().await;
    assert_eq!(decided["kind"], json!("gate_decision"));

    daemon.shutdown().await;
}
