//! The daemon-wide event stream: one `seq` counter, one bounded replay ring, and
//! one live bus every `/events` socket subscribes to.
//!
//! Moved out of `lib.rs` unchanged (P-H1 step 2). `lib.rs` re-exports
//! [`EVENT_REPLAY_CAPACITY`], [`SequencedEventFrame`], [`RunStreamSync`],
//! [`StreamSync`] and [`EventSequencer`] at the crate root, so every existing
//! `warshad::…` path still resolves.
//!
//! The socket layer — `events_handler` and the `/events` connection loop below the
//! [`EventSequencer`] — joined this module in P-H1 step A5, also unchanged.

use axum::{
    extract::{ws::WebSocketUpgrade, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Extension,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use warsha_core::{Event, EventKind, Run, RunId, Stage};

use crate::{paired_device_is_active, Actor, DaemonState, EVENTS_SUBPROTOCOL};

/// How many sequenced events the daemon keeps buffered for replay — to a
/// reconnecting `/events` client that names a `since_seq` (or sends a
/// `Last-Event-ID`), and to a `runs.subscribe` that asks to catch up.
///
/// A ring, not an unbounded log. The durable history is the store's job
/// (`runs.events`); this buffer exists only to close the gap between a client's
/// last seen `seq` and the live stream. Once an event scrolls off the front the
/// daemon stops pretending it can replay it and answers with
/// `gap_detected`/`resync_required` instead of silently skipping, so the client
/// catches up from the store rather than believing it saw everything.
pub const EVENT_REPLAY_CAPACITY: usize = 2048;

/// One [`Event`] plus the daemon-wide sequence number every client agrees on.
///
/// `seq` is the ordering, from one counter shared by every subscriber, so two
/// clients watching one daemon see the same event under the same `seq` and
/// cannot disagree about order. The three flags are `#[serde(default)]` so a
/// normal frame decodes with them false; they carry the only two abnormal things
/// a bounded, live stream can produce:
///   * `gap_detected` + `dropped_count`: this subscriber fell behind the bus and
///     `dropped_count` frames went past between the last one it saw and this one;
///   * `resync_required`: the daemon cannot resume from where the client asked
///     (its cursor predates the ring, or points past anything this process has
///     published — a restart), so the client should rebuild from `runs.events`.
///
/// `#[serde(flatten)] event` keeps the `Event`'s own fields at the top level of
/// the frame, so a consumer that still parses a frame as a bare
/// `warsha_core::Event` — the desktop client and the existing `/events` tests —
/// keeps working untouched: `seq` and the flags are extra fields serde ignores.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SequencedEventFrame {
    pub seq: u64,
    #[serde(default)]
    pub gap_detected: bool,
    #[serde(default)]
    pub dropped_count: u64,
    #[serde(default)]
    pub resync_required: bool,
    #[serde(flatten)]
    pub event: Event,
}

/// What a `/events` reconnect and the `runs.subscribe` RPC agree a client holds
/// after it catches up: where the stream is (`seq`), whether a gap or a full
/// resync is owed (`gap_detected` / `resync_required` / `dropped_count`), the run
/// the client named when it named one (`run`), and the buffered frames after its
/// cursor in exact order (`events`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunStreamSync {
    pub seq: u64,
    pub gap_detected: bool,
    pub resync_required: bool,
    pub dropped_count: u64,
    pub run: Option<Run>,
    pub events: Vec<SequencedEventFrame>,
}

/// The answer to "give me everything from `since_seq` onward": the current end of
/// the stream, the ordered buffered frames the ring still holds, and whether a
/// gap (frames already evicted) or a full resync (a restart, or a cursor past the
/// end) is owed. This is the one decision `/events` connect, `/events` replay and
/// `runs.subscribe` all read from, so they cannot disagree.
///
/// Public so an integration test can drive the gap/resync decision on a
/// small-capacity sequencer (`EventSequencer::with_capacity`) without booting a
/// daemon that would have to evict 2048 real frames to reach the same state.
#[derive(Debug, Clone)]
pub struct StreamSync {
    /// The `seq` of the most recently published frame (0 before the first).
    pub current_seq: u64,
    /// The contiguous buffered frames after the cursor, oldest first.
    pub frames: Vec<SequencedEventFrame>,
    /// True when frames between the cursor and the ring's front have been evicted.
    pub gap_detected: bool,
    /// True when the client must rebuild from the store rather than resume.
    pub resync_required: bool,
    /// How many frames the cursor cannot recover.
    pub dropped_count: u64,
}

/// The daemon-wide sequencer: one monotonic `seq` counter, one bounded replay
/// ring, and one live bus every `/events` socket subscribes to.
///
/// A single source stamps each event exactly once, which is what makes "two
/// clients see identical events in identical order" provable rather than
/// emergent. It is fed by the one background pump in
/// [`crate::start_daemon_with_provider_factory`], which drains the store's event bus,
/// scrubs each event, and calls [`EventSequencer::publish`]; because the pump is
/// the only writer, `seq` order is the store's arrival order and no two RPCs can
/// race to stamp the same instant.
pub struct EventSequencer {
    /// The next `seq` to hand out. Starts at 1, so `seq` 0 is never used and a
    /// client's `since_seq: 0` means "from the very beginning of the ring".
    next_seq: AtomicU64,
    /// The bounded replay buffer, oldest at the front. An async lock because
    /// `publish` runs on the pump task while `sync` runs inside request handlers.
    ring: RwLock<VecDeque<SequencedEventFrame>>,
    /// The live bus. Its capacity equals the ring's, so a subscriber that pauses
    /// is reported `Lagged` at the same backlog that would have evicted a frame
    /// from replay — the two ways to lose events stay in step.
    tx: broadcast::Sender<SequencedEventFrame>,
    capacity: usize,
}

impl Default for EventSequencer {
    fn default() -> Self {
        Self::new()
    }
}

impl EventSequencer {
    pub fn new() -> Self {
        Self::with_capacity(EVENT_REPLAY_CAPACITY)
    }

    /// A sequencer with a named replay capacity.
    ///
    /// Exposed for tests, which cannot cheaply fill a 2048-frame ring on a live
    /// socket: a small capacity makes the two loss paths (`Lagged` on the live
    /// bus, eviction off the ring front) reachable in a handful of publishes.
    pub fn with_capacity(capacity: usize) -> Self {
        let capacity = capacity.max(1);
        let (tx, _rx) = broadcast::channel(capacity);
        Self {
            next_seq: AtomicU64::new(1),
            ring: RwLock::new(VecDeque::with_capacity(capacity)),
            tx,
            capacity,
        }
    }

    /// The `seq` of the most recently published frame, or 0 before the first.
    pub fn current_seq(&self) -> u64 {
        self.next_seq.load(Ordering::SeqCst).saturating_sub(1)
    }

    /// Stamp `event` with the next `seq`, append it to the ring (evicting the
    /// oldest frame when the ring is already full), and broadcast it live.
    pub async fn publish(&self, event: Event) -> SequencedEventFrame {
        let seq = self.next_seq.fetch_add(1, Ordering::SeqCst);
        let frame = SequencedEventFrame {
            seq,
            gap_detected: false,
            dropped_count: 0,
            resync_required: false,
            event,
        };
        {
            let mut ring = self.ring.write().await;
            if ring.len() >= self.capacity {
                ring.pop_front();
            }
            ring.push_back(frame.clone());
        }
        // A failed send means no live subscriber is attached right now. The frame
        // is still in the ring for the next `sync`, so the ring and the store —
        // never the broadcast — are the record of what happened.
        let _ = self.tx.send(frame.clone());
        frame
    }

    /// A fresh live subscriber, starting at whatever is published after this call.
    pub fn subscribe(&self) -> broadcast::Receiver<SequencedEventFrame> {
        self.tx.subscribe()
    }

    /// Replay everything after `since_seq`, optionally narrowed to one run, and
    /// decide whether the caller instead owes a gap or a full resync.
    ///
    /// Three outcomes:
    ///   * `since_seq` points *past* `current_seq` — the client talked to a
    ///     process that is no longer here — so a resync is owed immediately;
    ///   * `since_seq` predates the oldest frame still in the ring, so the frames
    ///     between it and the front have scrolled off: a gap with their true
    ///     count, and no partial replay to imply the client saw the whole tail;
    ///   * otherwise the contiguous frames after `since_seq` come back in order
    ///     and nothing abnormal is owed.
    pub async fn sync(&self, since_seq: u64, run_filter: Option<RunId>) -> StreamSync {
        let current_seq = self.current_seq();

        if since_seq > current_seq {
            return StreamSync {
                current_seq,
                frames: Vec::new(),
                gap_detected: true,
                resync_required: true,
                dropped_count: since_seq.saturating_sub(current_seq),
            };
        }

        let ring = self.ring.read().await;
        if let Some(front_seq) = ring.front().map(|frame| frame.seq) {
            if since_seq.saturating_add(1) < front_seq {
                return StreamSync {
                    current_seq,
                    frames: Vec::new(),
                    gap_detected: true,
                    resync_required: true,
                    dropped_count: front_seq.saturating_sub(since_seq).saturating_sub(1),
                };
            }
        }

        let frames = ring
            .iter()
            .filter(|frame| frame.seq > since_seq)
            .filter(|frame| run_filter.is_none() || Some(frame.event.run_id) == run_filter)
            .cloned()
            .collect();
        StreamSync {
            current_seq,
            frames,
            gap_detected: false,
            resync_required: false,
            dropped_count: 0,
        }
    }
}

/// WebSocket handler for /events endpoint
///
/// Authentication is the middleware's job ([`auth_handler_inner`], which reads either
/// the bearer header or the `warsha.token.<token>` subprotocol for this path). What is
/// this handler's job is the second half of the handshake: RFC 6455 §1.9 has the server
/// select one of the protocols the client offered, and a client that offered a
/// subprotocol and sees no selection back is entitled to treat the connection as failed.
///
/// The value selected is [`EVENTS_SUBPROTOCOL`] and nothing else. `protocols` only ever
/// answers with a name the client actually offered, so a caller that sends no subprotocol
/// — every `Authorization`-header caller that exists today — gets a reply identical to
/// the one this handler sent before, and a caller that offers only its credential gets no
/// echo of that credential either.
///
/// Beyond the handshake the socket is a *sequenced* stream: it subscribes to the
/// daemon's [`EventSequencer`] (not the raw store bus), so every frame carries the
/// same `seq` every other client sees. A `?since_seq` query or a `Last-Event-ID`
/// header replays the buffered frames after that point (or, when they have scrolled
/// off the ring, answers one gap frame); a `?run_id` narrows the stream to one run;
/// and the client may drive the subscription live with `runs.subscribe` /
/// `runs.unsubscribe` commands down the socket.
pub(crate) async fn events_handler(
    State(state): State<Arc<DaemonState>>,
    Extension(actor): Extension<Actor>,
    Query(params): Query<EventStreamParams>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let last_event_id = last_event_id_header(&headers);
    ws.protocols([EVENTS_SUBPROTOCOL])
        .on_upgrade(move |socket| handle_events_socket(socket, state, actor, params, last_event_id))
}

/// The `/events` query string: an optional replay cursor and an optional run filter.
/// Both default to absent, so a bare `GET /events` still upgrades and streams live
/// exactly as it did before this existed.
#[derive(Debug, Clone, Deserialize, Default)]
pub(crate) struct EventStreamParams {
    #[serde(default)]
    since_seq: Option<u64>,
    #[serde(default)]
    run_id: Option<String>,
}

/// The `Last-Event-ID` cursor a reconnecting client sends — an unsigned `seq` — or
/// `None` when the header is absent or not a number. Consulted only when the client
/// sent no `?since_seq`, so the query parameter wins.
fn last_event_id_header(headers: &HeaderMap) -> Option<u64> {
    headers
        .get("Last-Event-ID")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
}

/// Parse a run id out of a query value or a command's `run_id`, tolerating the empty
/// and the malformed by answering `None` (= every run) rather than failing the socket.
fn parse_run_id(raw: Option<&str>) -> Option<RunId> {
    raw.map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| value.parse::<ulid::Ulid>().ok())
        .map(RunId)
}

/// Serialise and send one sequenced frame, mapping a closed socket to the error the
/// caller breaks on.
async fn send_frame(
    socket: &mut axum::extract::ws::WebSocket,
    frame: &SequencedEventFrame,
) -> std::result::Result<(), axum::Error> {
    let text = serde_json::to_string(frame).unwrap_or_default();
    socket.send(axum::extract::ws::Message::Text(text)).await
}

/// A synthetic frame carrying stream-level state rather than a pipeline event: a
/// replay gap, a live-consumer lag, or an unsubscribe acknowledgement.
///
/// It is a [`SequencedEventFrame`] so a client parses one kind of frame for the whole
/// stream, and its `event.payload` names the `action` so the meaning never has to be
/// inferred from the event kind — `warsha_core::EventKind` has no "stream control"
/// variant and that crate is outside this change's ownership, so a gap rides as
/// [`EventKind::Error`] and an ack as [`EventKind::AgentStep`] with a telling payload.
fn control_frame(
    seq: u64,
    run_filter: Option<RunId>,
    kind: EventKind,
    payload: serde_json::Value,
    gap_detected: bool,
    dropped_count: u64,
    resync_required: bool,
) -> SequencedEventFrame {
    SequencedEventFrame {
        seq,
        gap_detected,
        dropped_count,
        resync_required,
        event: Event {
            id: ulid::Ulid::new(),
            run_id: run_filter.unwrap_or_default(),
            stage: Stage::Idea,
            role: None,
            kind,
            payload,
            cost_cents: None,
            tokens: None,
            created_at: Utc::now(),
            device_id: None,
        },
    }
}

/// A command a client sends *down* the `/events` socket. Only the two subscribe verbs
/// are recognised; any other text is ignored so an unexpected frame cannot kill a
/// connection that is otherwise healthy.
#[derive(Debug, Deserialize)]
struct SocketCommand {
    method: String,
    #[serde(default)]
    params: SocketCommandParams,
}

#[derive(Debug, Default, Deserialize)]
struct SocketCommandParams {
    #[serde(default)]
    run_id: Option<String>,
    #[serde(default)]
    since_seq: Option<u64>,
}

/// Apply one down-socket command and return the frames to send back, mutating the
/// socket's live subscription (`subscribed`, `run_filter`).
///
/// `runs.subscribe` turns the stream on, optionally re-narrows it to a run, and — when
/// the command names a `since_seq` — replays after that point or answers one gap frame.
/// `runs.unsubscribe` turns it off and answers a single acknowledgement.
async fn handle_socket_command(
    text: &str,
    state: &DaemonState,
    subscribed: &mut bool,
    run_filter: &mut Option<RunId>,
) -> Vec<SequencedEventFrame> {
    let Ok(command) = serde_json::from_str::<SocketCommand>(text) else {
        return Vec::new();
    };
    match command.method.as_str() {
        "runs.subscribe" => {
            *subscribed = true;
            *run_filter = parse_run_id(command.params.run_id.as_deref());
            let mut frames = Vec::new();
            if let Some(since) = command.params.since_seq {
                let sync = state.events.sync(since, *run_filter).await;
                if sync.gap_detected || sync.resync_required {
                    frames.push(control_frame(
                        sync.current_seq,
                        *run_filter,
                        EventKind::Error,
                        serde_json::json!({
                            "action": "replay_gap",
                            "dropped_count": sync.dropped_count,
                            "resync_required": true,
                        }),
                        true,
                        sync.dropped_count,
                        true,
                    ));
                } else {
                    frames.extend(sync.frames);
                }
            }
            frames
        }
        "runs.unsubscribe" => {
            *subscribed = false;
            vec![control_frame(
                state.events.current_seq(),
                *run_filter,
                EventKind::AgentStep,
                serde_json::json!({ "action": "unsubscribed" }),
                false,
                0,
                false,
            )]
        }
        _ => Vec::new(),
    }
}

async fn handle_events_socket(
    mut socket: axum::extract::ws::WebSocket,
    state: Arc<DaemonState>,
    actor: Actor,
    params: EventStreamParams,
    last_event_id: Option<u64>,
) {
    // The subscription the client starts on: every run unless `?run_id` narrows it, and
    // live from the moment it connects unless a cursor asks for the past.
    let mut run_filter = parse_run_id(params.run_id.as_deref());
    let mut subscribed = true;
    // An explicit `?since_seq` wins over a `Last-Event-ID` header; with neither there is
    // no replay and the socket's first frame stays the keepalive Ping (the contract the
    // existing `/events` delivery test asserts).
    let cursor = params.since_seq.or(last_event_id);

    // Subscribe to the live bus *before* reading the ring, so an event published while
    // the replay is in flight is not missed; `last_seq_seen` then drops the frames the
    // replay already delivered instead of sending them twice.
    let mut rx = state.events.subscribe();
    let mut last_seq_seen;

    if let Some(since) = cursor {
        last_seq_seen = since;
        let sync = state.events.sync(since, run_filter).await;
        if sync.gap_detected || sync.resync_required {
            let frame = control_frame(
                sync.current_seq,
                run_filter,
                EventKind::Error,
                serde_json::json!({
                    "action": "replay_gap",
                    "dropped_count": sync.dropped_count,
                    "resync_required": true,
                }),
                true,
                sync.dropped_count,
                true,
            );
            last_seq_seen = last_seq_seen.max(frame.seq);
            if send_frame(&mut socket, &frame).await.is_err() {
                return;
            }
        } else {
            for frame in sync.frames {
                last_seq_seen = last_seq_seen.max(frame.seq);
                if send_frame(&mut socket, &frame).await.is_err() {
                    return;
                }
            }
        }
    } else {
        // Live from the current end onward; the ring's history is the store's job.
        last_seq_seen = state.events.current_seq();
    }

    // Send ping every 30 seconds to keep the connection alive.
    let mut ping_interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
    // A frozen upgrade identity does not outlive the pairing: a revoked or expired
    // device loses the stream on the next tick (PAIR research finding 3).
    let mut authority_interval = tokio::time::interval(tokio::time::Duration::from_secs(2));
    authority_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            received = rx.recv() => {
                if !paired_device_is_active(&actor, &state.active_pairings().await) {
                    break;
                }
                match received {
                    Ok(frame) => {
                        // A monotonic filter: never resend a frame the replay (or an
                        // earlier live tick) already put on the wire.
                        if frame.seq <= last_seq_seen {
                            continue;
                        }
                        last_seq_seen = frame.seq;
                        let matches_run =
                            run_filter.is_none() || Some(frame.event.run_id) == run_filter;
                        if subscribed && matches_run && send_frame(&mut socket, &frame).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(dropped)) => {
                        // A slow consumer is *not* silently skipped: the old handler
                        // `continue`d here and the client never learned it had missed
                        // frames. Instead send a gap frame naming how many were dropped
                        // and that a resync is required, so the client catches up from
                        // `runs.events`/`runs.subscribe` rather than trusting a hole.
                        let frame = control_frame(
                            state.events.current_seq(),
                            run_filter,
                            EventKind::Error,
                            serde_json::json!({
                                "action": "stream_gap",
                                "dropped_count": dropped,
                                "resync_required": true,
                            }),
                            true,
                            dropped,
                            true,
                        );
                        last_seq_seen = last_seq_seen.max(frame.seq);
                        if send_frame(&mut socket, &frame).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(axum::extract::ws::Message::Text(text))) => {
                        if !paired_device_is_active(&actor, &state.active_pairings().await) {
                            break;
                        }
                        let replies = handle_socket_command(
                            text.as_str(),
                            &state,
                            &mut subscribed,
                            &mut run_filter,
                        )
                        .await;
                        for frame in replies {
                            last_seq_seen = last_seq_seen.max(frame.seq);
                            if send_frame(&mut socket, &frame).await.is_err() {
                                return;
                            }
                        }
                    }
                    Some(Ok(axum::extract::ws::Message::Close(_))) | None => break,
                    // Ping/Pong/Binary carry no subscription intent.
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
            _ = authority_interval.tick() => {
                if !paired_device_is_active(&actor, &state.active_pairings().await) {
                    break;
                }
            }
            _ = ping_interval.tick() => {
                if socket.send(axum::extract::ws::Message::Ping(vec![])).await.is_err() {
                    break;
                }
            }
        }
    }
}
