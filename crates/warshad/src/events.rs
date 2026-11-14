//! The daemon-wide event stream: one `seq` counter, one bounded replay ring, and
//! one live bus every `/events` socket subscribes to.
//!
//! Moved out of `lib.rs` unchanged (P-H1 step 2). `lib.rs` re-exports
//! [`EVENT_REPLAY_CAPACITY`], [`SequencedEventFrame`], [`RunStreamSync`],
//! [`StreamSync`] and [`EventSequencer`] at the crate root, so every existing
//! `warshad::…` path still resolves.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::{broadcast, RwLock};
use warsha_core::{Event, Run, RunId};

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
/// [`start_daemon_with_provider_factory`], which drains the store's event bus,
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
