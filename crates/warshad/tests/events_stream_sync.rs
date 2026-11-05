//! WS3 — the daemon's sequenced event stream, replay, and run-control RPCs.
//!
//! What this file pins down, end to end against a real daemon wherever the
//! behaviour needs one (`crates/warshad/src/lib.rs`, the `EventSequencer`, the
//! `/events` handler, and the `runs.subscribe` / `runs.advance` / `runs.cancel`
//! / `runs.followup` / `runs.artifacts` surface):
//!
//!   1. `seq` is monotonic across the whole run-control sequence — a start, an
//!      advance, a gate approval, a follow-up, a cancel and an artifact read all
//!      stamp the same shared counter in the order the store appended them.
//!   2. Reconnecting `/events?since_seq=N` replays exactly the frames after `N`,
//!      in order, without duplicates.
//!   3. The same replay happens when the cursor arrives as a `Last-Event-ID`
//!      header instead of a query parameter.
//!   4. A cursor the ring can no longer honour — evicted history, or a cursor
//!      past this process's whole life — answers `gap_detected` and
//!      `resync_required` rather than a silent partial replay (the ring decision
//!      is exercised directly on a small-capacity `EventSequencer`, and the RPC
//!      mirror over the wire).
//!   5. `scrub_event_payload` redacts the daemon token, `sk-…` provider keys and
//!      `Bearer …` credentials out of every payload before it reaches a wire.
//!   6. `windows_firewall_command` prints the exact `netsh` rule with both ports.
//!
//! Tests make no network calls to real model APIs: the run-control sequence runs
//! a fresh daemon with no routed provider, which `PipelineEngine::dispatch_chat`
//! answers through the deterministic `FakeProvider`, and the environment is
//! additionally forced to `WARSHA_LLM_PROVIDER=fake` so even a machine exporting
//! `WARSHA_LLM_API_KEY` stays offline.

use std::path::PathBuf;
use std::time::Duration;

use base64::Engine as _;
use chrono::Utc;
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use warsha_core::{Event, EventKind, RunId, Stage};
use warshad::{
    scrub_event_payload, start_daemon, windows_firewall_command, DaemonConfig, DaemonHandle,
    EventSequencer, RateLimitConfig,
};

/// The daemon's own bearer token for this test's daemon.
const OWNER: &str = "events-sync-owner-token-4c1a";
/// The data-plane subprotocol the client offers and the daemon selects.
const EVENTS_SUBPROTOCOL: &str = "warsha.events.v1";
/// The prefix carrying the credential, as `packages/client/src/index.ts` sends it.
const TOKEN_PREFIX: &str = "warsha.token.";
/// How long a test waits for one thing the daemon does on its own initiative.
const BEAT: Duration = Duration::from_secs(5);

/// Force the zero-network provider path, whatever the machine's environment
/// happens to carry. Every test in this binary wants the same answer, so racing
/// writers cannot change what any of them observes.
fn force_fake_provider() {
    std::env::set_var("WARSHA_LLM_PROVIDER", "fake");
}

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

/// A running daemon, the ports it answers on, and the data directory it holds a
/// lock in for as long as the test is talking to it.
struct Daemon {
    handle: DaemonHandle,
    _dir: TempDir,
}

impl Daemon {
    async fn start() -> Self {
        force_fake_provider();
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
// The RPC half.
// --------------------------------------------------------------------------------

async fn rpc_value(port: u16, method: &str, params: Value) -> Value {
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
    response.json::<Value>().await.expect("a JSON answer")
}

async fn rpc_ok(port: u16, method: &str, params: Value) -> Value {
    let body = rpc_value(port, method, params).await;
    assert!(
        body.get("result").is_some(),
        "{method} returned an error: {body}"
    );
    body["result"].clone()
}

/// A plain event for the direct sequencer tests: the pump's inputs all look
/// exactly like this by the time the store publishes them.
fn plain_event(run_id: RunId, summary: &str) -> Event {
    Event {
        id: ulid::Ulid::new(),
        run_id,
        stage: Stage::Idea,
        role: None,
        kind: EventKind::AgentStep,
        payload: json!({ "summary": summary }),
        cost_cents: None,
        tokens: None,
        created_at: Utc::now(),
        device_id: None,
    }
}

/// Create a project and start one run, returning `(run_id)`.
async fn start_run(port: u16, name: &str) -> String {
    let project = rpc_ok(
        port,
        "projects.create",
        json!([name, "a run for the sequenced stream", "en"]),
    )
    .await;
    let run = rpc_ok(
        port,
        "runs.start",
        json!([project["id"], "build the sequenced shop"]),
    )
    .await;
    run["id"].as_str().expect("a run id").to_string()
}

/// Poll `runs.subscribe` (the RPC mirror of the ring) until the sequencer has
/// stamped at least `want` frames, and return that sync. The pump drains the
/// store bus on its own task, so "the RPC answered" and "the ring holds it" are
/// two instants; a replay test may only open its socket once the ring caught up.
async fn wait_for_seq_at_least(port: u16, want: u64) -> Value {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    loop {
        let sync = rpc_ok(port, "runs.subscribe", json!({ "run_id": null })).await;
        if sync["seq"].as_u64().unwrap_or(0) >= want {
            return sync;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "the pump never reached seq {want}: {sync}"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

// --------------------------------------------------------------------------------
// The WebSocket half: the raw HTTP/1.1 machinery from `events_ws_live.rs`, with
// the two knobs a replay test needs — a request target (for `?since_seq`) and
// extra handshake headers (for `Last-Event-ID`).
// --------------------------------------------------------------------------------

struct Socket {
    stream: TcpStream,
    buffer: Vec<u8>,
}

async fn open_events_socket(port: u16, target: &str, extra_headers: &str) -> Socket {
    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .await
        .expect("the daemon's HTTP port accepts a connection");
    let key = {
        let mut bytes = [0x5au8; 16];
        bytes[..2].copy_from_slice(&u16::to_be_bytes(0xdead));
        base64::engine::general_purpose::STANDARD.encode(bytes)
    };
    let request = format!(
        "GET {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\n\
         Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\
         Sec-WebSocket-Protocol: {EVENTS_SUBPROTOCOL}, {TOKEN_PREFIX}{OWNER}\r\n\
         {extra_headers}\r\n"
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

    /// One server frame. Server frames are never masked; a masked one is treated
    /// as the protocol error it is and ends the read.
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

    /// The next TEXT frame with keepalive Pings skipped. The first frame on a
    /// cursor-less socket is the keepalive Ping (`handle_events_socket` ticks its
    /// interval immediately), while a cursor socket replays before the loop even
    /// starts — skipping pings here keeps one reader honest for both.
    async fn next_text_frame(&mut self, waiting_for: &str) -> Value {
        for _ in 0..32 {
            let frame = tokio::time::timeout(BEAT, self.read_frame())
                .await
                .unwrap_or_else(|_| {
                    panic!("no frame within {BEAT:?} while waiting for {waiting_for}")
                })
                .unwrap_or_else(|| panic!("the socket ended while waiting for {waiting_for}"));
            let (opcode, payload) = frame;
            if opcode == 0x9 || opcode == 0xA {
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
        panic!("thirty-two frames in and the socket never carried a text event frame")
    }
}

/// The `seq` of a frame, as a number the assertions can compare.
fn frame_seq(frame: &Value) -> u64 {
    frame["seq"]
        .as_u64()
        .expect("a sequenced frame carries `seq`")
}

// --------------------------------------------------------------------------------
// 1. Monotonic `seq` across the whole run-control sequence.
// --------------------------------------------------------------------------------

#[tokio::test]
async fn seq_is_monotonic_across_start_advance_approve_followup_cancel_artifacts() {
    let daemon = Daemon::start().await;
    let port = daemon.rpc();

    // The socket is open from before anything happens, so every frame it sees
    // was produced by the sequence below and stamped live — not replayed.
    let mut socket = open_events_socket(daemon.http(), "/events", "").await;

    let run_id = start_run(port, "Sequenced Shop").await;

    // Each action must produce at least one event, and later actions must be
    // stamped later — the stream's order is the store's order.
    rpc_ok(
        port,
        "gates.approve",
        json!({ "run_id": run_id, "stage": "gate_a" }),
    )
    .await;
    let advanced = rpc_ok(port, "runs.advance", json!({ "run_id": run_id.clone() })).await;
    assert_eq!(
        advanced["id"].as_str(),
        Some(run_id.as_str()),
        "runs.advance must answer the same run"
    );

    let followed = rpc_ok(
        port,
        "runs.followup",
        json!({ "run_id": run_id.clone(), "prompt": "ما هي المرحلة الحالية؟" }),
    )
    .await;
    assert_eq!(followed["id"].as_str(), Some(run_id.as_str()));

    let cancelled = rpc_ok(
        port,
        "runs.cancel",
        json!({ "run_id": run_id.clone(), "reason": "the test is tearing the run down" }),
    )
    .await;
    assert_eq!(
        cancelled["status"].as_str(),
        Some("cancelled"),
        "runs.cancel must report the cancelled run it just persisted"
    );

    let artifacts = rpc_ok(port, "runs.artifacts", json!({ "run_id": run_id.clone() })).await;
    assert!(
        artifacts.is_array(),
        "runs.artifacts answers a list: {artifacts}"
    );

    // The cancel event is the last thing the store appended for this run; once
    // the pump has stamped it, every earlier action's events are in the ring too.
    let stored = rpc_ok(port, "runs.events", json!([run_id.clone()])).await;
    let stored_ids: Vec<String> = stored
        .as_array()
        .expect("the run's event log")
        .iter()
        .map(|event| event["id"].as_str().expect("an event id").to_string())
        .collect();
    let want = stored_ids.len() as u64;
    let sync = wait_for_seq_at_least(port, want).await;

    // The ring's frames: strictly increasing, no gaps starting at 1, no
    // duplicates, and the run's own store order matches the stamp order.
    let frames = sync["events"].as_array().expect("replay frames");
    let mut previous = 0u64;
    let mut seq_by_id = std::collections::HashMap::new();
    for frame in frames {
        let seq = frame_seq(frame);
        assert!(
            seq > previous,
            "seq {seq} did not follow {previous}: {frame}"
        );
        previous = seq;
        seq_by_id.insert(frame["id"].as_str().unwrap_or_default().to_string(), seq);
    }
    assert_eq!(
        previous,
        sync["seq"].as_u64().expect("the sync names its end")
    );

    let mut last_seen_seq = 0u64;
    for id in &stored_ids {
        let seq = *seq_by_id
            .get(id.as_str())
            .unwrap_or_else(|| panic!("the ring never stamped store event {id}"));
        assert!(
            seq > last_seen_seq,
            "store order and stream order disagree: {id} stamped {seq} after {last_seen_seq}"
        );
        last_seen_seq = seq;
    }

    // The live socket carries the same stamps for the same events: two clients,
    // one counter. Read as many text frames as the run produced events.
    for (index, id) in stored_ids.iter().enumerate() {
        let frame = socket.next_text_frame("a live sequenced event").await;
        assert_eq!(
            frame["seq"].as_u64(),
            seq_by_id.get(id.as_str()).copied(),
            "the live socket's frame {index} disagrees with the ring's stamp"
        );
    }

    daemon.shutdown().await;
}

// --------------------------------------------------------------------------------
// 2 + 3. Reconnect replay, by query cursor and by `Last-Event-ID`.
// --------------------------------------------------------------------------------

/// Produce at least four events on a fresh daemon and return the run id.
async fn seed_events(port: u16) -> String {
    let run_id = start_run(port, "Replay Shop").await;
    rpc_ok(
        port,
        "gates.approve",
        json!({ "run_id": run_id, "stage": "gate_a" }),
    )
    .await;
    rpc_ok(
        port,
        "runs.followup",
        json!({ "run_id": run_id.clone(), "prompt": "what is next?" }),
    )
    .await;
    rpc_ok(
        port,
        "runs.cancel",
        json!({ "run_id": run_id.clone(), "reason": "replay fixture done" }),
    )
    .await;
    run_id
}

/// The shared body of tests 2 and 3: whatever cursor transport a reconnect
/// used, `/events` must replay exactly the frames after the cursor, in order,
/// once each.
async fn assert_reconnect_replays_after_two(daemon: &Daemon) {
    // The ring, as the RPC sees it, is the reference for "exact order, no
    // duplicates": the socket and `runs.subscribe` read the same decision and
    // cannot disagree.
    let sync = wait_for_seq_at_least(daemon.rpc(), 3).await;
    let ring = sync["events"].as_array().expect("replay frames");
    let expected: Vec<(u64, String)> = ring
        .iter()
        .filter(|frame| frame_seq(frame) > 2)
        .map(|frame| {
            (
                frame_seq(frame),
                frame["id"].as_str().expect("an event id").to_string(),
            )
        })
        .collect();
    assert!(
        !expected.is_empty(),
        "the fixture produced no frames after seq 2: {sync}"
    );

    let mut socket = open_events_socket(daemon.http(), "/events?since_seq=2", "").await;
    for (seq, id) in &expected {
        let frame = socket.next_text_frame("a replayed frame").await;
        assert_eq!(
            frame_seq(&frame),
            *seq,
            "the replay delivered a frame out of ring order"
        );
        assert_eq!(
            frame["id"].as_str(),
            Some(id.as_str()),
            "the replayed frame at seq {seq} is not the ring's frame at that seq"
        );
        assert_eq!(
            frame["gap_detected"],
            json!(false),
            "a replayed data frame must not announce a gap"
        );
    }
    socket.stream.shutdown().await.ok();
}

#[tokio::test]
async fn reconnecting_with_since_seq_replays_later_frames_in_exact_order() {
    let daemon = Daemon::start().await;
    seed_events(daemon.rpc()).await;
    assert_reconnect_replays_after_two(&daemon).await;
    daemon.shutdown().await;
}

#[tokio::test]
async fn reconnecting_with_last_event_id_header_replays_later_frames_too() {
    let daemon = Daemon::start().await;
    seed_events(daemon.rpc()).await;

    let port = daemon.rpc();
    let sync = wait_for_seq_at_least(port, 3).await;
    let ring = sync["events"].as_array().expect("replay frames");
    let expected: Vec<(u64, String)> = ring
        .iter()
        .filter(|frame| frame_seq(frame) > 2)
        .map(|frame| {
            (
                frame_seq(frame),
                frame["id"].as_str().expect("an event id").to_string(),
            )
        })
        .collect();
    assert!(
        !expected.is_empty(),
        "the fixture produced no frames after seq 2: {sync}"
    );

    // The header form: no query string at all, just `Last-Event-ID: 2`.
    let mut socket = open_events_socket(daemon.http(), "/events", "Last-Event-ID: 2\r\n").await;
    for (seq, id) in &expected {
        let frame = socket.next_text_frame("a header-replayed frame").await;
        assert_eq!(frame_seq(&frame), *seq);
        assert_eq!(frame["id"].as_str(), Some(id.as_str()));
    }

    daemon.shutdown().await;
}

// --------------------------------------------------------------------------------
// 4. Ring overflow and unhonourable cursors: gap + resync, never a silent tail.
// --------------------------------------------------------------------------------

#[tokio::test]
async fn a_cursor_the_ring_cannot_honour_answers_gap_and_resync() {
    // The eviction path needs a ring small enough to actually overflow; the
    // daemon's own ring is 2048 frames and a test must not fake that many
    // publishes to reach the front. The decision is the same code the RPC and
    // `/events` read (`EventSequencer::sync`), so a small ring tests it honestly.
    let sequencer = EventSequencer::with_capacity(4);
    let run = RunId::default();
    for index in 1..=6u64 {
        sequencer
            .publish(plain_event(run, &format!("event {index}")))
            .await;
    }
    assert_eq!(sequencer.current_seq(), 6);

    // The ring now holds seq 3..=6; a cursor at 1 asks for frames 1 and 2, which
    // have been evicted: a gap with their true count and a resync, no frames.
    let evicted = sequencer.sync(1, None).await;
    assert!(
        evicted.gap_detected,
        "an evicted cursor must report the gap"
    );
    assert!(evicted.resync_required, "an evicted cursor owes a resync");
    assert_eq!(evicted.frames.len(), 0, "no partial replay past a gap");
    assert_eq!(
        evicted.dropped_count, 1,
        "only seq 2 (between cursor+1 and the front) is gone"
    );
    assert_eq!(evicted.current_seq, 6);

    // A cursor the front still holds replays cleanly: seq 3 is the oldest frame,
    // so a cursor at 3 asks for 4..=6 and gets them, in order, with no gap.
    let clean = sequencer.sync(3, None).await;
    assert!(!clean.gap_detected && !clean.resync_required);
    let got: Vec<u64> = clean.frames.iter().map(|frame| frame.seq).collect();
    assert_eq!(got, vec![4, 5, 6]);

    // A cursor past everything this process ever stamped — a restart, or a
    // client replaying a number from a dead daemon — is a resync immediately.
    let ahead = sequencer.sync(99, None).await;
    assert!(ahead.gap_detected && ahead.resync_required);
    assert_eq!(ahead.frames.len(), 0);
    assert_eq!(ahead.dropped_count, 99 - 6);

    // The RPC mirror answers the same way over the wire against a live daemon.
    let daemon = Daemon::start().await;
    let sync = rpc_ok(
        daemon.rpc(),
        "runs.subscribe",
        json!({ "run_id": null, "since_seq": 10_000 }),
    )
    .await;
    assert_eq!(
        sync["gap_detected"],
        json!(true),
        "a cursor past the end must say so: {sync}"
    );
    assert_eq!(
        sync["resync_required"],
        json!(true),
        "and require the store rebuild: {sync}"
    );
    assert!(sync["events"]
        .as_array()
        .is_some_and(|frames| frames.is_empty()));
    daemon.shutdown().await;
}

// --------------------------------------------------------------------------------
// 5. Scrubbing: no secret reaches a wire through an event payload.
// --------------------------------------------------------------------------------

#[tokio::test]
async fn scrub_event_payload_redacts_tokens_keys_and_bearer_credentials() {
    let token = "daemon-secret-token-9d77";
    let mut payload = json!({
        "note": format!("connect with {token} to continue"),
        "provider_key": "sk-abcdefghijklmnop",
        "headers": ["Authorization: Bearer abc.def-123"],
        "api_key": "anything at all is replaced by its key name",
        "nested": {
            "auth_token": "x",
            "deep": { "idea": "a perfectly public sentence" },
        },
        "count": 7,
    });
    scrub_event_payload(&mut payload, token);

    assert_eq!(
        payload["note"],
        json!("[REDACTED]"),
        "the daemon token must not survive in a value"
    );
    assert_eq!(
        payload["provider_key"],
        json!("[REDACTED]"),
        "an sk-… key must not survive"
    );
    assert_eq!(
        payload["headers"][0],
        json!("[REDACTED]"),
        "a Bearer credential must not survive"
    );
    assert_eq!(
        payload["api_key"],
        json!("[REDACTED]"),
        "a secret-named key is redacted whatever it holds"
    );
    assert_eq!(payload["nested"]["auth_token"], json!("[REDACTED]"));
    assert_eq!(
        payload["nested"]["deep"]["idea"],
        json!("a perfectly public sentence"),
        "scrubbing redacts secrets, it does not eat the event"
    );
    assert_eq!(
        payload["count"],
        json!(7),
        "non-secret scalars pass through untouched"
    );

    // A short empty-token daemon must still redact key-shaped and Bearer values.
    let mut without_token = json!({ "line": "used sk-0123456789ab and Bearer zz9", "ok": true });
    scrub_event_payload(&mut without_token, "");
    assert_eq!(without_token["line"], json!("[REDACTED]"));
    assert_eq!(without_token["ok"], json!(true));

    // An empty auth token never redacts ordinary strings — no "contains everything"
    // by way of an empty needle.
    let mut ordinary = json!({ "idea": "a shop for furniture" });
    scrub_event_payload(&mut ordinary, "");
    assert_eq!(ordinary["idea"], json!("a shop for furniture"));
}

// --------------------------------------------------------------------------------
// 6. The LAN-bind firewall command.
// --------------------------------------------------------------------------------

#[test]
fn windows_firewall_command_names_netsh_and_both_ports() {
    let command = windows_firewall_command(8765, 8766);
    assert!(
        command.contains("netsh advfirewall firewall add rule"),
        "the printed fix must be the netsh verb an elevated owner can paste: {command}"
    );
    assert!(
        command.contains("8765"),
        "the HTTP port must be named: {command}"
    );
    assert!(
        command.contains("8766"),
        "the RPC port must be named: {command}"
    );
    assert!(
        command.contains("localport=8765,8766"),
        "both ports are one rule's localport list: {command}"
    );
}
