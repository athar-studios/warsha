//! Warshad — Daemon binary: local API (JSON-RPC over Unix socket / named pipe + localhost HTTP/WebSocket with token)

use axum::{
    extract::{ws::WebSocketUpgrade, ConnectInfo, Query, State},
    http::{header::AUTHORIZATION, HeaderMap},
    response::{IntoResponse, Json, Response},
    routing::get,
    Router,
};
use base64::Engine as _;
use chrono::Utc;
use clap::Parser;
use fs2::FileExt;
use jsonrpsee::{
    core::{async_trait, BoxError, RpcResult},
    proc_macros::rpc,
    server::{HttpRequest, HttpResponse, ServerBuilder},
    types::{ErrorObject, ErrorObjectOwned},
};
use keyring::Entry;
use rand::TryRngCore;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::task::{Context, Poll};
use thiserror::Error;
use tokio::sync::{broadcast, RwLock};
use tower::Layer;
use tower_http::cors::{Any, CorsLayer};
use tracing::{error, info, warn};
use warsha_backends::BackendFactory;
use warsha_core::*;
use warsha_git::GitHubClient;
use warsha_pipeline::{
    AgentLoop, AgentMode, AgentTurnResult, AskUserQueue, BackendKind, BackendKit, CrashReport,
    CrashReportStore, FilesystemToolExecutor, HandoffBundle, HandoffManager,
    InMemoryCrashReportStore, InMemoryMcpManager, InMemoryPairingStore, InMemoryPreferenceStore,
    InMemoryProcessManager, InMemoryStoreReviewStore, LivePreview, LivePreviewManager,
    ManagedProcess, McpConnection, McpManager, MessageBus, ModeManager, ModeTransition,
    PairingStore, PhonePairing, Preference, PreferenceSignal, PreferenceStore, ProcessManager,
    ProcessStatus, ProcessSummary, ProviderRouterAdapter, Routine, RoutineRegistry, RoutineRunner,
    RoutineScheduler, RunMode, RunModeConfig, SlashCommand, SlashCommandRegistry, StoreReview,
    StoreReviewStore, TodoItem, TodoList, AGENT_ROLE,
};
use warsha_providers::{
    probe_endpoint, HealthCheck, KeychainSecretStore, OneClickProvider, ProviderRouter,
    ProviderSetupWizard, SecretStore,
};
use warsha_remote::rate_limit::rate_key;
use warsha_remote::DeviceRegistry;
use warsha_store::{
    Store, StoredHarness, StoredIntegration, StoredPlugin, StoredProvider, StoredSkill,
};

mod auth;
mod providers;
mod settings;
mod wave2;

pub use auth::{
    Actor, ActorRole, MethodPolicy, Policy, ProcessPolicy, QuotaConfig, RateGovernor,
    RateLimitConfig, Sessions, Tier, DEFAULT_ALLOWED_COMMANDS, METHOD_POLICIES,
};
pub use providers::{
    adapter_kind, keychain_credentials, AdapterKind, DeferredProvider, KeychainProviderFactory,
    MockProviderFactory, ProviderFactory, RemovedProvider,
};
pub use settings::{SettingsError, SettingsStore};

/// The `&Extensions` a `with_extensions` RPC method is handed by jsonrpsee.
///
/// A verified [`Actor`] travels in it, put there by the transport after it checked
/// the caller's credential.
pub type RpcExtensions = jsonrpsee::server::Extensions;

/// The request extensions a verified session carries, for a caller that drives the
/// RPC surface in-process rather than over the wire.
///
/// Over HTTP and WebSocket an actor is *only* ever produced by the transport, after it
/// has compared the bearer credential to the daemon's token and the live pairings;
/// nothing a client sends can put one in a request. Building the extensions by hand is
/// therefore an act of trust available to in-process code — the daemon's own tests, and
/// an embedded host that already holds the state — and to nobody else.
pub fn session_extensions(actor: Actor) -> RpcExtensions {
    let mut ext = RpcExtensions::new();
    ext.insert(actor);
    ext
}

/// The extensions of the owner session for a daemon whose local device is
/// `local_device` — the same actor the transport produces when the daemon's own token
/// presents itself.
pub fn owner_session(local_device: DeviceId) -> RpcExtensions {
    session_extensions(Actor::owner(local_device))
}

/// The extensions of no session at all: what a request that never authenticated
/// carries, and what every authorized method must refuse.
pub fn anonymous_session() -> RpcExtensions {
    RpcExtensions::new()
}

#[derive(Error, Debug)]
pub enum DaemonError {
    #[error("Store error: {0}")]
    Store(#[from] warsha_store::StoreError),
    #[error("Settings error: {0}")]
    Settings(#[from] SettingsError),
    #[error("Provider error: {0}")]
    Provider(#[from] warsha_providers::ProviderError),
    #[error("Pipeline error: {0}")]
    Pipeline(#[from] warsha_pipeline::PipelineError),
    #[error("Git error: {0}")]
    Git(#[from] warsha_git::GitError),
    #[error("Remote error: {0}")]
    Remote(#[from] warsha_remote::RemoteError),
    #[error("Config error: {0}")]
    Config(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("TOML decode error: {0}")]
    TomlDecode(#[from] toml::de::Error),
    #[error("TOML encode error: {0}")]
    TomlEncode(#[from] toml::ser::Error),
    #[error("Authentication failed")]
    AuthFailed,
    #[error("Keyring error: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("Lock error: {0}")]
    Lock(String),
    #[error("Other: {0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, DaemonError>;

/// The JSON-RPC error a `providers.*` refusal carries.
///
/// The message is the reason the owner is shown, and every message this module
/// builds is written for that: no key, no request headers, no base URL that could
/// carry a token in its query string.
fn provider_refusal(message: impl Into<String>) -> ErrorObjectOwned {
    ErrorObject::owned(-32000, message.into(), None::<()>)
}

// =============================================================== the event stream

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

/// The value every scrubbed secret is replaced with.
const REDACTED: &str = "[REDACTED]";

/// The object keys (compared lowercased) whose every string value is redacted
/// whatever it holds, because the key alone says the value is a secret.
const SECRET_KEY_NAMES: &[&str] = &[
    "api_key",
    "apikey",
    "secret",
    "token",
    "auth_token",
    "password",
    "authorization",
];

/// Scrub an event payload in place before it is stored, streamed, or returned.
///
/// Runs *before* an event enters the sequencer, before it goes out over `/events`,
/// and before `runs.events`/`runs.subscribe` hand it back, so a secret can never
/// reach a wire no matter which path a caller took. The two halves of the rule:
///   * a string *value* is replaced whole if it contains the daemon's
///     (non-empty) `auth_token`, an `sk-`-shaped provider key, or a `Bearer …`
///     credential; and
///   * the value under any object key naming a secret (see
///     [`SECRET_KEY_NAMES`]) is replaced whatever it holds.
///
/// Hand-rolled rather than regex because the crate has no `regex` dependency and
/// `Cargo.lock` is off-limits to this change; the patterns are fixed, short, and
/// ASCII, so a byte scan is exact and cannot panic on a multibyte boundary.
pub fn scrub_event_payload(payload: &mut serde_json::Value, auth_token: &str) {
    scrub_value(payload, auth_token);
}

/// Recurse one [`serde_json::Value`], redacting strings and secret-named entries.
fn scrub_value(value: &mut serde_json::Value, auth_token: &str) {
    match value {
        serde_json::Value::String(text) => {
            if redact_string(text, auth_token) {
                *text = REDACTED.to_string();
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                scrub_value(item, auth_token);
            }
        }
        serde_json::Value::Object(entries) => {
            for (key, inner) in entries.iter_mut() {
                let lower = key.to_lowercase();
                if SECRET_KEY_NAMES.contains(&lower.as_str()) {
                    *inner = serde_json::Value::String(REDACTED.to_string());
                } else {
                    scrub_value(inner, auth_token);
                }
            }
        }
        _ => {}
    }
}

/// Whether a string value carries a secret and so must be replaced whole.
fn redact_string(text: &str, auth_token: &str) -> bool {
    (!auth_token.is_empty() && text.contains(auth_token))
        || contains_sk_token(text)
        || contains_bearer(text)
}

/// A byte-level prefix test that never panics on a multibyte boundary.
fn starts_with_at(haystack: &[u8], at: usize, needle: &[u8]) -> bool {
    haystack.get(at..at + needle.len()) == Some(needle)
}

/// Whether `c` continues an `sk-…` provider key body.
fn is_sk_body(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'-'
}

/// Whether `s` contains `sk-` followed by eight or more key-body characters.
fn contains_sk_token(s: &str) -> bool {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if starts_with_at(bytes, i, b"sk-") {
            let mut run = 0;
            let mut j = i + 3;
            while j < bytes.len() && is_sk_body(bytes[j]) {
                run += 1;
                j += 1;
            }
            if run >= 8 {
                return true;
            }
            i = j;
            continue;
        }
        i += 1;
    }
    false
}

/// Whether `c` continues the credential that follows a `Bearer ` scheme.
fn is_bearer_body(c: u8) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-')
}

/// Whether `s` contains a `Bearer` scheme followed by whitespace and a non-empty
/// token of [`is_bearer_body`] characters — the wire spelling of an auth header
/// value, matched case-sensitively because that is how it is minted.
fn contains_bearer(s: &str) -> bool {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if starts_with_at(bytes, i, b"Bearer") {
            let mut j = i + b"Bearer".len();
            while j < bytes.len() && matches!(bytes[j], b' ' | b'\t') {
                j += 1;
            }
            let start = j;
            while j < bytes.len() && is_bearer_body(bytes[j]) {
                j += 1;
            }
            if j > start {
                return true;
            }
        }
        i += 1;
    }
    false
}

/// The `netsh` command that opens a LAN-bound daemon's two ports on Windows.
///
/// A `0.0.0.0` bind publishes the daemon to the local network, and on Windows the
/// inbound firewall rule does not create itself — so the daemon prints the exact
/// one-command fix rather than leaving the owner to guess the verb, the profile,
/// or which of its two ports to open. Returned as a string (the daemon never runs
/// it: raising the firewall is the owner's deliberate, elevated act), and spelled
/// here once so a startup log line and a test agree on the same text.
pub fn windows_firewall_command(http_port: u16, ws_port: u16) -> String {
    format!(
        "netsh advfirewall firewall add rule name=\"Warsha Daemon\" dir=in action=allow protocol=TCP localport={http_port},{ws_port} profile=private"
    )
}

// ============================================================= /end event stream

/// Daemon configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonConfig {
    pub data_dir: PathBuf,
    pub socket_path: PathBuf,
    pub http_port: u16,
    pub ws_port: u16,
    /// The address *both* listeners bind: the JSON-RPC server on [`DaemonConfig::ws_port`]
    /// and the HTTP/`/events` server on [`DaemonConfig::http_port`].
    ///
    /// **Loopback is the default and stays the default.** A daemon holds the owner's
    /// projects, runs and provider configuration, and its only network-facing
    /// credential is a bearer token; binding it to a LAN address publishes that token
    /// to every host on the network, which is a change of security posture and has to be
    /// an act the owner takes deliberately — by spelling this field in the config file
    /// or passing `--bind-host`. It is a bare IP literal (`127.0.0.1`, `192.168.1.20`,
    /// `::1`), not a hostname: a name would be resolved once at start and quietly mean a
    /// different machine after a DHCP change, and the resolved address is what the
    /// startup log and every pairing link have to agree with.
    ///
    /// `#[serde(default)]` because a `config.toml` written before this field existed
    /// names no bind address, and a daemon that refused to start on an old file would be
    /// a daemon that failed its owner at the worst moment — the same reasoning as
    /// [`DaemonConfig::rate_limits`]. A file that names nothing binds loopback.
    #[serde(default = "default_bind_host")]
    pub bind_host: String,
    /// The host a pairing link advertises when [`DaemonConfig::bind_host`] is a wildcard
    /// (`0.0.0.0`, `::`).
    ///
    /// A wildcard bind means "every address this machine has", and the daemon cannot know
    /// which of them the owner's phone is meant to dial — advertising the first interface
    /// it happened to find would be a guess printed on a credential. So a wildcard bind
    /// with no advertised host still *serves* (nothing about the listeners changes), and
    /// the one thing it refuses is minting a pairing link: `devices.pair-start` answers an
    /// actionable refusal instead of inventing an address. A bare host or IP only — the
    /// daemon serves plain HTTP and does not terminate TLS, so the scheme is not a value
    /// this field may carry.
    #[serde(default)]
    pub advertised_host: Option<String>,
    pub auth_token: String,
    pub allowed_origins: Vec<String>,
    /// The inbound ceilings the daemon enforces on every RPC and HTTP request, and
    /// what happens past them (security audit H-01).
    ///
    /// `#[serde(default)]` because a configuration file written before this existed
    /// names no ceilings, and a daemon that refused to start on an old `config.toml`
    /// would be a daemon that failed its owner at the worst moment.
    #[serde(default)]
    pub rate_limits: RateLimitConfig,
    /// The programs `process.spawn`, `mcp.connect` and `preview.start` may start.
    ///
    /// Empty means the default list ([`DEFAULT_ALLOWED_COMMANDS`]) rather than "no
    /// restrictions": an unset allow-list is a policy the owner did not choose, and
    /// the safe reading of that is the narrow one (audit H-05). A name here is the
    /// only way a program joins the list — nothing on the RPC can add to it.
    #[serde(default)]
    pub allowed_commands: Vec<String>,
    /// A pre-built remote UI bundle the HTTP listener serves statically.
    ///
    /// `Some` turns the daemon's own listener on [`DaemonConfig::http_port`] into the
    /// static host for a built SPA (the shipped `apps/remote` bundle): files come from
    /// this directory, unknown extension-less paths fall back to its `index.html` so
    /// client routes like `/runs/<id>` load, and hashed assets are served immutable.
    /// `None` — the default — keeps the listener exactly as it was: `/health`, `/events`
    /// and a 404 for everything else. The daemon never invents a bundle directory.
    ///
    /// The deployment knob is the `WARSHA_REMOTE_ASSETS_DIR` environment variable,
    /// overlaid by [`apply_env_overrides`] like every other `WARSHA_*` value; a
    /// `config.toml` may name `remote_assets_dir` directly. A caller driving
    /// [`start_daemon`] in-process can set the field without touching the environment.
    #[serde(default)]
    pub remote_assets_dir: Option<PathBuf>,
}

impl Default for DaemonConfig {
    fn default() -> Self {
        let config_dir = dirs::config_dir()
            .map(|d| d.join("warsha"))
            .unwrap_or_else(|| PathBuf::from(".").join("warsha"));
        Self {
            data_dir: config_dir.clone(),
            socket_path: config_dir.join("warshad.sock"),
            http_port: 8765,
            ws_port: 8766,
            bind_host: default_bind_host(),
            advertised_host: None,
            auth_token: String::new(), // Generated on first run
            allowed_origins: vec![
                "http://localhost:5173".to_string(),
                "tauri://localhost".to_string(),
            ],
            rate_limits: RateLimitConfig::default(),
            allowed_commands: Vec::new(),
            // No bundle until an owner names one: unset, the listener answers 404 for
            // every static path exactly as it did before remote serving existed.
            remote_assets_dir: None,
        }
    }
}

/// The address a daemon binds when its configuration names none: loopback.
///
/// A function rather than a literal so `#[serde(default = "default_bind_host")]` and
/// [`DaemonConfig::default`] cannot drift apart — the file default and the code default
/// must be the same address, or an owner who never opted into a LAN bind gets one on a
/// restart and the other on a fresh install.
fn default_bind_host() -> String {
    LOCALHOST_BIND.to_string()
}

/// The literal [`default_bind_host`] returns, spelled once so a test can name it.
const LOCALHOST_BIND: &str = "127.0.0.1";

/// Handle to a running daemon instance.
pub struct DaemonHandle {
    _lock_file: LockFile,
    http_task: tokio::task::JoinHandle<()>,
    rpc_server: jsonrpsee::server::ServerHandle,
    http_port: u16,
    rpc_port: u16,
    /// The address both listeners actually bound. Reported so a startup log and a test can
    /// name where the daemon is rather than re-reading a configuration it may have
    /// resolved differently.
    bind_addr: IpAddr,
    /// What [`DaemonHandle::pairing_origin`] answered at start: the address a pairing link
    /// may advertise, or `None` when the daemon cannot name one.
    pairing_origin: Option<String>,
    /// The one spawner, so shutdown can take the daemon's children with it.
    processes: Arc<dyn ProcessManager>,
    /// The runtime this daemon is running on, kept for the sweep a `Drop` has to run
    /// without an `.await` (see [`DaemonHandle::drop`]).
    runtime: tokio::runtime::Handle,
    /// Whether the children have already been reaped, so the drop sweep runs once.
    reaped: std::sync::atomic::AtomicBool,
}

/// How long a dropped-without-shutdown handle waits for its child sweep.
///
/// Bounded on purpose. The sweep needs the runtime to poll it, and a `Drop` that runs on
/// the runtime's own thread cannot wait for that without deadlocking the very thing it
/// is trying to stop — so the wait is a courtesy, and a timeout is reported rather than
/// hidden. A daemon that exits through [`DaemonHandle::shutdown`] or
/// [`run_daemon`]'s signal path never takes this branch.
const DROP_REAP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

impl std::fmt::Debug for DaemonHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // The spawner holds live children and is not `Debug`, so the handle
        // reports the ports it is serving on and the lock it holds rather than
        // pretending to print a process table.
        f.debug_struct("DaemonHandle")
            .field("http_port", &self.http_port)
            .field("rpc_port", &self.rpc_port)
            .field("bind_addr", &self.bind_addr)
            .field("pairing_origin", &self.pairing_origin)
            .field(
                "reaped",
                &self.reaped.load(std::sync::atomic::Ordering::Relaxed),
            )
            .finish_non_exhaustive()
    }
}

impl DaemonHandle {
    /// Returns the actual HTTP port the server is bound to.
    pub fn http_port(&self) -> u16 {
        self.http_port
    }

    /// Returns the actual RPC (WebSocket/JSON-RPC) port the server is bound to.
    pub fn rpc_port(&self) -> u16 {
        self.rpc_port
    }

    /// The address both listeners are bound to — loopback unless the owner opted into
    /// another one (see [`DaemonConfig::bind_host`]).
    pub fn bind_addr(&self) -> IpAddr {
        self.bind_addr
    }

    /// The origin a pairing link advertises, or `None` when the daemon cannot say yet.
    ///
    /// `None` is one of exactly two states: the daemon is bound to a wildcard with no
    /// `advertised_host` to resolve the ambiguity (see
    /// [`DaemonConfig::advertised_host`]), which is the only case a *running* daemon can
    /// be in. A pairing link is never minted against an address the daemon does not
    /// listen on, so `devices.pair-start` refuses here rather than guessing one.
    pub fn pairing_origin(&self) -> Option<String> {
        self.pairing_origin.clone()
    }

    /// Shuts down the daemon: stops the RPC server, aborts the HTTP task,
    /// kills and reaps every child it started, and releases the lock file.
    ///
    /// The children are the whole [`ProcessManager`] list — a preview dev server,
    /// an MCP stdio server, anything `process.spawn` started — and each one is
    /// killed *and* waited for. Killing alone would leave a zombie, and dropping
    /// the handles would leave a dev server holding its port for the next daemon
    /// to trip over.
    pub async fn shutdown(self) {
        if let Err(e) = self.rpc_server.stop() {
            warn!("RPC server was already stopped: {e}");
        }
        // Aborting the HTTP task drops its listener, so the port is released.
        self.http_task.abort();
        // The RPC server is down, so nothing can start a child while the sweep
        // runs to completion.
        let killed = self.processes.kill_all().await;
        // Recorded before the drop runs, so the sweep is paid for once.
        self.reaped.store(true, std::sync::atomic::Ordering::SeqCst);
        if killed > 0 {
            info!("killed {killed} child process(es) on shutdown");
        }
        // The lock handle closes here, releasing the lock. The lock *file* stays,
        // deliberately: see [`LockFile`].
    }
}

impl Drop for DaemonHandle {
    fn drop(&mut self) {
        // The ordinary exit goes through [`DaemonHandle::shutdown`], which sets the
        // flag and never comes here. This path is for the ones that do not: a host that
        // returns an error after the daemon started, a `?` between the start and the
        // shutdown, a panic unwinding through the desktop shell's build.
        //
        // All of them would otherwise leave a dev server or an MCP stdio process
        // holding a port and a working tree after the daemon that started them is gone,
        // which is the "orphan" C2 is about. The same sweep runs, on the same manager,
        // and the only difference is that a `Drop` cannot await: the job goes to a
        // thread that can block on the runtime, and this thread waits for it for up to
        // [`DROP_REAP_TIMEOUT`] before giving up and saying so.
        if self.reaped.load(std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        let _ = self.rpc_server.stop();
        self.http_task.abort();

        let processes = Arc::clone(&self.processes);
        let runtime = self.runtime.clone();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let reaper = std::thread::Builder::new()
            .name("warshad-reap".to_string())
            .spawn(move || {
                let killed = runtime.block_on(processes.kill_all());
                let _ = done_tx.send(killed);
            });
        let Ok(_thread) = reaper else {
            warn!("the child sweep on drop could not start; a child may still be running");
            return;
        };
        match done_rx.recv_timeout(DROP_REAP_TIMEOUT) {
            Ok(killed) if killed > 0 => {
                info!("killed {killed} child process(es) when the daemon handle dropped");
            }
            Ok(_) => {}
            Err(_) => warn!(
                "the child sweep on drop did not finish within {} seconds; \
                 a preview server or MCP process may still be running",
                DROP_REAP_TIMEOUT.as_secs()
            ),
        }
        self.reaped.store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

/// Tower layer for RPC authentication and the ceiling in front of it.
///
/// Two jobs, in this order (security audit H-01, H-03, H-04):
///
/// - **Bound the transport first**, on the key the transport actually has: the
///   authenticated identity when the credential resolved, and one shared bounded
///   bucket when it did not. Measuring before the credential is judged is the point —
///   a caller spraying tokens is spending its own budget, not the daemon's CPU.
/// - **Say who is calling**, and put that in the request for the RPC methods to read.
///   A method never learns the caller's identity from its own params; that is the
///   whole of H-03 and half of H-04.
///
/// There is no per-peer-address key here: jsonrpsee's HTTP service does not put the
/// accepted socket's address in the request it hands a middleware, and inventing one
/// from a header would be trusting a value the caller writes. The address-keyed
/// ceiling is on the daemon's own HTTP listener, where axum does supply it.
#[derive(Clone)]
struct RpcAuthLayer {
    state: Arc<DaemonState>,
}

impl<S> Layer<S> for RpcAuthLayer {
    type Service = RpcAuthService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        RpcAuthService {
            inner,
            state: self.state.clone(),
        }
    }
}

/// Tower service for RPC authentication.
/// Mirrors the pattern used by jsonrpsee's own `HostFilter` middleware layer.
#[derive(Clone)]
struct RpcAuthService<S> {
    inner: S,
    state: Arc<DaemonState>,
}

/// The bearer token in a request's `Authorization` header, or an empty string.
///
/// An empty string is not a session: [`Sessions::resolve`] refuses it, and no caller
/// that sends no header is answerable for the traffic of one that does.
fn bearer_token(headers: &axum::http::HeaderMap) -> String {
    headers
        .get(AUTHORIZATION)
        .and_then(|header| header.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or_default()
        .to_string()
}

/// The one route that also reads a credential from the WebSocket subprotocol list.
///
/// A browser — and the desktop's webview — cannot set `Authorization` on a WebSocket
/// handshake: the constructor takes a URL and a subprotocol list and nothing else.
/// `/events` is the only place that has to know this, so it is the only place that does.
const EVENTS_PATH: &str = "/events";

/// The subprotocol prefix a `/events` caller carries its credential in.
///
/// The client's half of this string is `TOKEN_SUBPROTOCOL_PREFIX` in
/// `packages/client/src/index.ts`; the two ends have to agree, and a live-daemon test
/// (`crates/warshad/tests/events_ws_auth.rs`) is what pins that they do.
const TOKEN_SUBPROTOCOL_PREFIX: &str = "warsha.token.";

/// The `/events` data-plane subprotocol, and the only one the daemon ever *selects*.
///
/// It carries no secret, which is the whole reason it exists: RFC 6455 §1.9 has the
/// server answer the handshake with one of the protocols the client offered, and the
/// only other thing the client offers is its credential. Echoing that back would put
/// the token on the response headers of every hop that reads them.
const EVENTS_SUBPROTOCOL: &str = "warsha.events.v1";

/// The credential in a `/events` caller's `Sec-WebSocket-Protocol` list, or an empty
/// string when the list carries none.
///
/// One entry of the list is treated exactly as the `Authorization` header is: its
/// remainder goes to [`Sessions::resolve`] and nothing else happens with it. Every
/// offered protocol is a candidate, not just the first, because a client is free to
/// offer the data-plane name before its credential. Multiple header lines are joined
/// the way the transport joins them (`get_all`), and a value that is not UTF-8 simply
/// carries no credential. An empty result is not a session —
/// [`Sessions::resolve`] refuses it — so a caller that offers `warsha.token.` with
/// nothing after the prefix is refused like a caller that offers nothing.
///
/// Nothing here reads the request URI: a token in the query string is not a credential
/// this daemon will ever accept, because a URL is logged by every proxy, browser history
/// and `Referer` between the caller and this listener.
fn subprotocol_token(headers: &axum::http::HeaderMap) -> String {
    headers
        .get_all(axum::http::header::SEC_WEBSOCKET_PROTOCOL)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .find_map(|offered| offered.trim().strip_prefix(TOKEN_SUBPROTOCOL_PREFIX))
        .unwrap_or_default()
        .to_string()
}

/// A refusal with a status and a body, on jsonrpsee's own response type.
fn rpc_refusal(
    status: axum::http::StatusCode,
    body: serde_json::Value,
    retry_after_secs: Option<u64>,
) -> HttpResponse {
    let mut response = jsonrpsee::server::http::response::ok_response(body.to_string());
    *response.status_mut() = status;
    response.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        axum::http::HeaderValue::from_static("application/json"),
    );
    if let Some(secs) = retry_after_secs {
        response
            .headers_mut()
            .insert(axum::http::header::RETRY_AFTER, retry_after_header(secs));
    }
    response
}

/// The `Retry-After` value a bounded caller is answered with.
///
/// A number of seconds is always a representable header value, and a refusal that
/// could not name its wait would be an invitation to retry at once — so the
/// unreachable case says `1` rather than dropping the header.
fn retry_after_header(secs: u64) -> axum::http::HeaderValue {
    axum::http::HeaderValue::from_str(&secs.max(1).to_string())
        .unwrap_or_else(|_| axum::http::HeaderValue::from_static("1"))
}

impl<S, B> tower::Service<HttpRequest<B>> for RpcAuthService<S>
where
    S: tower::Service<HttpRequest<B>, Response = HttpResponse> + Clone + Send + 'static,
    S::Response: 'static,
    S::Future: Send + 'static,
    S::Error: Into<BoxError> + Send + 'static,
    B: Send + 'static,
{
    type Response = S::Response;
    type Error = BoxError;
    type Future = Pin<
        Box<dyn Future<Output = std::result::Result<Self::Response, Self::Error>> + Send + 'static>,
    >;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<std::result::Result<(), Self::Error>> {
        self.inner.poll_ready(cx).map_err(Into::into)
    }

    fn call(&mut self, req: HttpRequest<B>) -> Self::Future {
        let state = self.state.clone();
        let mut inner = self.inner.clone();
        let token = bearer_token(req.headers());

        Box::pin(async move {
            // The pairing store is read at the moment of the call, so revoking a
            // device takes effect on its next request rather than at the next start.
            let actor = state
                .sessions
                .resolve(&token, &state.active_pairings().await);
            // No peer address is available on this transport, so an unauthenticated
            // caller falls back to one shared bounded bucket rather than to none.
            let key = rate_key(actor.as_ref().map(|actor| actor.key()), None);

            let ceiling = state.rates.transport().check(&key);
            if !ceiling.is_allowed() {
                state.report_refusal("transport", &key);
                return Ok(rpc_refusal(
                    axum::http::StatusCode::TOO_MANY_REQUESTS,
                    serde_json::json!({ "error": "rate limited" }),
                    Some(ceiling.retry_after_secs()),
                ));
            }

            let Some(actor) = actor else {
                let mut response = rpc_refusal(
                    axum::http::StatusCode::UNAUTHORIZED,
                    serde_json::json!({ "error": "unauthorized" }),
                    None,
                );
                response.headers_mut().insert(
                    axum::http::header::WWW_AUTHENTICATE,
                    axum::http::HeaderValue::from_static("Bearer"),
                );
                return Ok(response);
            };

            // The verified caller travels in the request's extensions, which is a
            // value only this service can write: nothing on the wire reaches it.
            let mut req = req;
            req.extensions_mut().insert(actor);
            inner.call(req).await.map_err(Into::into)
        })
    }
}

/// CLI arguments for warshad
#[derive(Parser, Debug)]
#[command(name = "warshad", version, about = "Warsha daemon")]
pub struct DaemonArgs {
    /// Config file path
    #[arg(short, long)]
    pub config: Option<PathBuf>,

    /// Run in foreground (don't daemonize)
    #[arg(short, long)]
    pub foreground: bool,

    /// HTTP port
    #[arg(long, default_value = "8765")]
    pub http_port: u16,

    /// WebSocket port
    #[arg(long, default_value = "8766")]
    pub ws_port: u16,

    /// The address both listeners bind: a bare IP literal, `127.0.0.1` by default.
    ///
    /// Naming this is an explicit decision to publish the daemon beyond this machine —
    /// see [`DaemonConfig::bind_host`] for why the default is loopback and why a LAN
    /// address has to be asked for rather than assumed.
    ///
    /// `Option` with no clap `default_value`, unlike the two ports above, so that a
    /// `bind_host` written in `config.toml` survives: clap's default would otherwise
    /// overwrite the owner's choice on every start, which for this particular field means
    /// silently ignoring the one opt-in the owner deliberately made.
    #[arg(long)]
    pub bind_host: Option<String>,

    /// The host a pairing link advertises when `--bind-host` is a wildcard (`0.0.0.0`).
    #[arg(long)]
    pub advertised_host: Option<String>,

    /// Socket path
    #[arg(long)]
    pub socket: Option<PathBuf>,
}

/// App state alias for DaemonState
pub type AppState = DaemonState;

/// Daemon state
pub struct DaemonState {
    pub config: DaemonConfig,
    pub store: Arc<Store>,
    pub providers: Arc<RwLock<ProviderRouter>>,
    pub pipeline: Arc<warsha_pipeline::PipelineEngine<SettingsStore>>,
    pub backends: Vec<Box<dyn warsha_backends::CodingBackend>>,
    pub github: Option<GitHubClient>,
    pub devices: Arc<DeviceRegistry>,
    /// Backend kits by project id, seeded from [`SettingsStore`] at start.
    ///
    /// The key is the project, not the run: `backend.export` addresses a run, and
    /// every run of one project exports the same schema, so two runs of a project
    /// share one kit rather than each growing its own. A run whose project is not
    /// in the store is keyed by its own id, which is what makes an export of an
    /// unregistered run answerable.
    pub backend_kits: Arc<RwLock<HashMap<String, BackendKit>>>,
    /// Crash reports, in arrival order. Nothing records one yet: the opt-in
    /// collector is PLAN.md M17's remaining half.
    pub crash_reports: Arc<RwLock<InMemoryCrashReportStore>>,
    /// Store reviews, in arrival order. Nothing fetches one yet: the store API
    /// client is PLAN.md M17's remaining half.
    pub store_reviews: Arc<RwLock<InMemoryStoreReviewStore>>,
    /// The agent loop behind `agent.turn`.
    ///
    /// One loop per daemon: the mode manager, the todo list, the `ask_user` queue,
    /// the message bus and the transcript are a run's conversation, and the loop's
    /// own compactor is what keeps the transcript bounded. Its two seams are wired
    /// by [`build_agent_loop`] — file tools inside `<data_dir>/workspace`, model
    /// calls through the daemon's provider router.
    ///
    /// What the conversation *is* — the mode it reached, who approved each switch,
    /// the todos and the unanswered questions — is written to the daemon's settings
    /// after every turn that changes it and read back at start
    /// ([`AgentLoopSnapshot`]), so a restart continues the conversation instead of
    /// starting a blank one. What is not written is the transcript: the compactor's
    /// folded context is this process's working set, and a stale one replayed into a
    /// new daemon would be a memory the owner never approved keeping.
    pub agent_loop: Arc<RwLock<AgentLoop>>,
    /// The one spawner: `process.*` drives it, the MCP stdio transport starts its
    /// server through it, and the live preview runs its dev server on it, so every
    /// child the daemon starts shows up in one `process.list`.
    ///
    /// It is also the complete list of children [`DaemonHandle::shutdown`] has to
    /// reap, which is why one manager is shared rather than each feature holding
    /// its own.
    pub processes: Arc<dyn ProcessManager>,
    /// MCP servers by name, with their connections. `mcp.*` is its RPC surface.
    pub mcp: Arc<dyn McpManager>,
    /// Live-preview dev servers, one per project.
    pub previews: Arc<LivePreviewManager>,
    /// The daemon's settings file: the four small M20 records, read once at start
    /// and written by every RPC that changes one.
    pub settings: Arc<SettingsStore>,
    /// The run modes by mode, seeded from [`SettingsStore`] at start.
    ///
    /// Every mode has an entry: one the owner never saved carries the
    /// [`RunModeConfig::for_mode`] default, which for Hosted is deliberately
    /// invalid until a relay is named — so `runmode.list` reports the whole switch
    /// and `runmode.set` is what makes a mode servable.
    pub run_modes: Arc<RwLock<HashMap<RunMode, RunModeConfig>>>,
    /// The taste signals recorded in this daemon's life.
    ///
    /// Signals are what the decay is computed from, so they stay in memory and are
    /// projected into the store on every record; a restart reloads the projection
    /// ([`DaemonState::stored_preferences`]) rather than replaying signals nobody
    /// kept.
    pub preferences: Arc<RwLock<InMemoryPreferenceStore>>,
    /// The stored preference rows per project, as read at start and refreshed
    /// after each recorded signal.
    ///
    /// This is what `preferences.list` answers from: the table is the projection
    /// every daemon shares, and the signal log is this daemon's own.
    pub stored_preferences: Arc<RwLock<HashMap<String, Vec<Preference>>>>,
    /// The paired phones, seeded from [`SettingsStore`] at start.
    pub pairings: Arc<RwLock<InMemoryPairingStore>>,
    /// Where a configured provider's API key lives.
    ///
    /// The OS keychain when the daemon started normally
    /// ([`KeychainSecretStore`]); a test double when it was handed one through
    /// [`start_daemon_with_secrets`], because a headless runner has no secret
    /// service to talk to. The provider *configuration* is not here at all: it is
    /// a row in [`DaemonState::settings`], read per call, so nothing in memory can
    /// disagree with what a restart would see.
    pub secrets: Arc<dyn SecretStore>,
    /// The scheduled routines (`routines.*`), behind the same lock the scheduler
    /// drives, so an owner action and a background tick cannot disagree.
    pub routines: Arc<RwLock<RoutineRegistry>>,
    /// The background loop that ticks [`DaemonState::routines`].
    ///
    /// `routines.run_now`/`pause`/`resume` go through it rather than through the
    /// registry, which is what lets the runner see each owner action. The loop is
    /// started after the state exists (`routines.start`) and stopped by
    /// [`DaemonHandle::shutdown`].
    pub routine_scheduler: Arc<RoutineScheduler>,
    /// Which credential means which caller (security audit H-03, H-04).
    ///
    /// The daemon had one bearer token and no answer to "who is asking" — so a gate
    /// recorded whatever approver the request named, and any token holder could write
    /// a provider key or a budget. Every RPC that needs an actor gets it from here,
    /// which is derived from the credential the transport checked, and from nowhere
    /// else.
    pub sessions: Arc<Sessions>,
    /// The live inbound ceilings, per authenticated identity (audit H-01).
    pub rates: Arc<RateGovernor>,
    /// Every role the owner has routed, as `roles.list` reports it.
    ///
    /// This is the table the router is driven from, and the one that is stored: the
    /// router keeps its own copy for the call path and cannot be read back out of, so
    /// the daemon holds the authoritative one. A routing that names a provider the
    /// owner has not configured is still here — and still refused at the call, because
    /// nothing is registered under a name that has no row behind it.
    pub role_routings: Arc<RwLock<HashMap<Role, RoleRoutingConfig>>>,
    /// The seam that turns a configured provider's row into a live adapter.
    ///
    /// [`KeychainProviderFactory`] is what [`start_daemon`] installs: the provider's
    /// key is read from the OS keychain, under the account `providers.add` filed it at,
    /// by the same adapter the wizard's connection test already speaks to. A test
    /// installs [`MockProviderFactory`] instead, which is what lets the whole
    /// configured-provider path — row, routing, agent turn, restart — be driven with no
    /// key, no network and no bill (AGENTS.md).
    pub provider_factory: Arc<dyn ProviderFactory>,
    /// The origin a device should dial to reach this daemon, as `http://<host>:<port>`.
    ///
    /// Written exactly once, by [`start_daemon_with_provider_factory`], *after* the RPC
    /// listener has bound: the port it ended up on is the port a pairing link may
    /// advertise, and a configuration that asked for `0` would otherwise send a phone to
    /// a port nothing listens on. `devices.pair-start` reads it, which is why the pairing
    /// link and the socket cannot disagree.
    ///
    /// Empty until the daemon is serving. A hand-built state (a unit test calling an RPC
    /// directly) is exactly that case, and `devices.pair-start` refuses rather than
    /// inventing an address — see [`DaemonConfig::advertised_host`] for the other refusal.
    pub pairing_origin: std::sync::OnceLock<String>,
    /// The daemon-wide event stream: one sequencer stamping every event with a shared
    /// monotonic `seq`, holding a bounded replay ring, and broadcasting live frames to
    /// every `/events` socket and every `runs.subscribe`.
    ///
    /// Fed by the single background pump in [`start_daemon_with_provider_factory`],
    /// which drains the store's event bus, scrubs each event, and publishes it here. It
    /// is the one reason two clients can be proven to see the same events in the same
    /// order, and the same reason the `/events` replay and the `runs.subscribe` sync
    /// cannot disagree about where the stream is.
    pub events: Arc<EventSequencer>,
}

impl DaemonState {
    /// The pairing records that may authenticate a session right now.
    ///
    /// Read at the moment of the call rather than cached, so `pairing.revoke` takes
    /// effect on the phone's next request instead of at the next restart: a revocation
    /// that only landed on a reboot is a revocation the owner cannot use.
    async fn active_pairings(&self) -> Vec<PhonePairing> {
        self.pairings.read().await.active()
    }

    /// Count one limiter refusal and write the aggregate line when it is due.
    ///
    /// Every refusal path in the daemon comes through here (re-audit LOAD-1 finding 2).
    /// `ceiling` is the method name whose tier bound the caller, or `transport` for the
    /// whole-request ceiling in front of it; `key` is the limiter's own key, which is an
    /// identity label or a peer address and is digested rather than printed — a refusal
    /// line must carry counts a caller can act on, not the credential or the identity of
    /// whoever held it.
    fn report_refusal(&self, ceiling: &'static str, key: &str) {
        if let Some(summary) = self
            .rates
            .refusals()
            .note(ceiling, key, std::time::Instant::now())
        {
            warn!("{}", summary.message());
        }
    }
}

/// JSON-RPC API trait
#[rpc(server)]
pub trait WarshaApi {
    // Every method on this surface takes `with_extensions` (security re-audit, LOAD-1
    // finding 1). Two things follow, and both are the point: the handler can reach the
    // [`Actor`] the transport verified, so the `Tier` its [`MethodPolicy`] names is
    // actually spent — a table entry nothing consults is a ceiling on paper — and a
    // request that never authenticated cannot get as far as the query. Before this, the
    // 24 read methods declared without extensions answered from the looser transport
    // ceiling only: the spike run proved it, refusing 1.3M requests with the transport
    // bucket while the `standard` bucket (240 burst, 1,200 a minute) never fired once.
    #[method(name = "health", with_extensions)]
    async fn health(&self) -> RpcResult<HealthResponse>;

    #[method(name = "projects.list", with_extensions)]
    async fn list_projects(&self) -> RpcResult<Vec<Project>>;

    #[method(name = "projects.create", with_extensions)]
    async fn create_project(
        &self,
        name: String,
        description: String,
        language: String,
    ) -> RpcResult<Project>;

    #[method(name = "projects.get", with_extensions)]
    async fn get_project(&self, id: ProjectId) -> RpcResult<Project>;

    #[method(name = "runs.start", with_extensions)]
    async fn start_run(&self, project_id: ProjectId, idea: String) -> RpcResult<Run>;

    #[method(name = "runs.get", with_extensions)]
    async fn get_run(&self, run_id: RunId) -> RpcResult<Run>;

    #[method(name = "runs.list", with_extensions)]
    async fn list_runs(&self, project_id: ProjectId) -> RpcResult<Vec<Run>>;

    #[method(name = "runs.events", with_extensions)]
    async fn get_events(&self, run_id: RunId) -> RpcResult<Vec<Event>>;

    // Gates (security audit H-03).
    //
    // The device that decided a gate is the device the *credential* authenticated —
    // the local desktop's owner session, or the phone whose pairing secret arrived —
    // and never a `device_id` in these params. The field is still accepted, as an
    // `Option` in the same positional slot, so a client written against the old shape
    // keeps parsing; its value is checked against the session and a mismatch is a
    // `-32003` refusal rather than a recorded approver. A client that stops sending it
    // changes nothing about what gets stored.
    #[method(name = "gates.approve", with_extensions)]
    async fn approve_gate(
        &self,
        run_id: RunId,
        stage: Stage,
        device_id: Option<DeviceId>,
    ) -> RpcResult<Run>;

    #[method(name = "gates.reject", with_extensions)]
    async fn reject_gate(
        &self,
        run_id: RunId,
        stage: Stage,
        reason: String,
        device_id: Option<DeviceId>,
    ) -> RpcResult<Run>;

    #[method(name = "gates.changes", with_extensions)]
    async fn request_changes(
        &self,
        run_id: RunId,
        stage: Stage,
        notes: String,
        device_id: Option<DeviceId>,
    ) -> RpcResult<Run>;

    /// The gates queue of one run (#25): all four gate stages in `Stage::all()`
    /// order, each with its current state and `Pending` for a stage the run has no
    /// entry for.
    ///
    /// All four stages ride back rather than a pending-only filter because the
    /// desktop renders the whole ledger with who-decided-when
    /// (`apps/desktop/src/screens/GatesInbox.tsx`) while `SimpleMode.tsx` filters
    /// pending client-side. The state is the flat [`GateSummaryState`] the client
    /// declares, not the adjacent-tagged `warsha_core::GateState`.
    ///
    /// It is a read of `authorize`'s `Session`/`Standard` class (`runs.list`-style):
    /// a paired phone must be able to read the queue it is asked to decide, and
    /// `SimpleMode` polls this path. The `device_id` slot matches the gates block's
    /// legacy shape and is ignored — this read records no identity, and nothing here
    /// believes a caller-named device.
    #[method(name = "gates.list", with_extensions)]
    async fn list_gates(
        &self,
        run_id: RunId,
        device_id: Option<DeviceId>,
    ) -> RpcResult<Vec<GateSummary>>;

    #[method(name = "providers.list", with_extensions)]
    async fn list_providers(&self) -> RpcResult<Vec<ProviderRecord>>;

    /// Add a provider and put its API key in the OS keychain.
    ///
    /// Four named parameters, which is the object the wizard already sends
    /// (`{ name, kind, key, api_base }`): the key rides on this one call and
    /// nowhere else, and `api_base` is `None` when the caller sent none.
    #[method(name = "providers.add", with_extensions)]
    async fn add_provider(
        &self,
        name: String,
        kind: String,
        key: String,
        api_base: Option<String>,
    ) -> RpcResult<ProviderRecord>;

    /// Test a stored provider's connection. A refusal is a JSON-RPC error whose
    /// message says why and whose `data` carries the [`HealthCheck`].
    #[method(name = "providers.test", with_extensions)]
    async fn test_provider(&self, name: String, model: Option<String>) -> RpcResult<HealthCheck>;

    /// Check a registered provider for model catalog updates without overwriting existing settings.
    #[method(name = "providers.check_models", with_extensions)]
    async fn check_provider_models(
        &self,
        name: String,
    ) -> RpcResult<warsha_providers::ModelCatalogDiff>;

    #[method(name = "devices.list", with_extensions)]
    async fn list_devices(&self) -> RpcResult<Vec<warsha_remote::DeviceIdentity>>;

    #[method(name = "devices.pair", with_extensions)]
    async fn pair_device(&self, pairing_data: warsha_remote::PairingData) -> RpcResult<()>;

    /// `devices.pair-start` — mint a pairing and hand back what a phone can actually use.
    ///
    /// The producer the pairing path never had: `devices.pair` *consumes* a
    /// [`warsha_remote::PairingData`], and nothing in the product made one, so the desktop
    /// screen was showing a `Math.random()` string as a pairing code. This mints the
    /// 32-byte one-time secret and its ten-minute expiry (`PairingData::new`), and returns
    /// them together with the daemon's resolved listening origin as a pairing link and a QR
    /// plate (`PairingOffer`).
    ///
    /// Takes no parameter. The pairing's expiry, secret and origin are all the daemon's to
    /// decide, and a caller that could name them could name the address a phone is sent to.
    #[method(name = "devices.pair-start", with_extensions)]
    async fn start_pairing(&self) -> RpcResult<warsha_remote::PairingOffer>;

    #[method(name = "devices.revoke", with_extensions)]
    async fn revoke_device(&self, device_id: DeviceId) -> RpcResult<()>;

    // Providers
    #[method(name = "providers.remove", with_extensions)]
    async fn remove_provider(&self, name: String) -> RpcResult<ProviderRecord>;

    // Roles
    #[method(name = "roles.list", with_extensions)]
    async fn list_roles(&self) -> RpcResult<Vec<RoleRoutingConfig>>;

    #[method(name = "roles.set", with_extensions)]
    async fn set_role(&self, config: RoleRoutingConfig) -> RpcResult<()>;

    // Budget
    #[method(name = "budget.show", with_extensions)]
    async fn show_budget(&self, project_id: ProjectId) -> RpcResult<BudgetStatus>;

    #[method(name = "budget.set", with_extensions)]
    async fn set_budget(&self, project_id: ProjectId, cents: u64) -> RpcResult<()>;

    // Backend kit (PLAN.md M19) — first wiring batch
    #[method(name = "backend.export", with_extensions)]
    async fn export_backend(&self, run_id: String, output_dir: String) -> RpcResult<String>;

    // Continue on server (PLAN.md M6a) — first wiring batch
    #[method(name = "handoff.create", with_extensions)]
    async fn create_handoff(
        &self,
        run_id: String,
        files: Vec<(String, String)>,
    ) -> RpcResult<String>;

    #[method(name = "handoff.apply", with_extensions)]
    async fn apply_handoff(&self, path: String, owner_wins: bool) -> RpcResult<String>;

    // Post-launch care (PLAN.md M17) — read halves only
    #[method(name = "postlaunch.crashes", with_extensions)]
    async fn list_crash_reports(&self, run_id: String) -> RpcResult<Vec<CrashReport>>;

    #[method(name = "postlaunch.reviews", with_extensions)]
    async fn list_store_reviews(&self, store: String) -> RpcResult<Vec<StoreReview>>;

    // Agent workflow (PLAN.md M18) — the skills catalog, one turn, and the mode the
    // next turn runs in.
    //
    // The three `agent.*` writes take the session because the M18 rule is that Agent
    // mode exists only on an owner's approval, and audit H-03 is that an approval
    // records who gave it: the approver is the authenticated device and never a param.
    //
    // `skills.list` is the owner-facing catalog — every installed skill, the same
    // rows `skills.import`/`skills.toggle`/`skills.delete` manage. It is *not* the
    // slash-command registry the agent loop executes: `skill_catalog()` builds that
    // in-process from the enabled rows, and it is unchanged by this shape.
    #[method(name = "skills.list", with_extensions)]
    async fn list_skills(&self) -> RpcResult<Vec<SkillDefinition>>;

    #[method(name = "agent.turn", with_extensions)]
    async fn agent_turn(&self, input: String) -> RpcResult<AgentTurnResult>;

    #[method(name = "agent.approve_mode", with_extensions)]
    async fn approve_agent_mode(&self) -> RpcResult<ModeTransition>;

    #[method(name = "agent.plan_mode", with_extensions)]
    async fn return_agent_to_plan(&self) -> RpcResult<ModeTransition>;

    #[method(name = "agent.state", with_extensions)]
    async fn agent_state(&self) -> RpcResult<AgentState>;

    // Process spawning and MCP transports (PLAN.md M20) — real child processes
    #[method(name = "process.spawn", with_extensions)]
    async fn spawn_process(
        &self,
        command: String,
        args: Vec<String>,
        env: HashMap<String, String>,
    ) -> RpcResult<String>;

    #[method(name = "process.stop", with_extensions)]
    async fn stop_process(&self, id: String) -> RpcResult<()>;

    #[method(name = "process.status", with_extensions)]
    async fn process_status(&self, id: String) -> RpcResult<ProcessStatus>;

    #[method(name = "process.list", with_extensions)]
    async fn list_processes(&self) -> RpcResult<Vec<ProcessSummary>>;

    #[method(name = "mcp.connect", with_extensions)]
    async fn connect_mcp(
        &self,
        config: warsha_pipeline::mcp_transport::McpServerConfig,
    ) -> RpcResult<()>;

    #[method(name = "mcp.disconnect", with_extensions)]
    async fn disconnect_mcp(&self, name: String) -> RpcResult<()>;

    #[method(name = "mcp.list", with_extensions)]
    async fn list_mcp(&self) -> RpcResult<Vec<McpConnection>>;

    #[method(name = "mcp.send", with_extensions)]
    async fn send_mcp(&self, name: String, payload: String) -> RpcResult<String>;

    #[method(name = "mcp.call", with_extensions)]
    async fn call_mcp(
        &self,
        name: String,
        tool: String,
        arguments: serde_json::Value,
    ) -> RpcResult<warsha_pipeline::mcp::McpToolResult>;

    // Live preview dev server (PLAN.md M5b + M20)
    #[method(name = "preview.start", with_extensions)]
    async fn start_preview(&self, project_id: String, command: String) -> RpcResult<LivePreview>;

    #[method(name = "preview.stop", with_extensions)]
    async fn stop_preview(&self, project_id: String) -> RpcResult<()>;

    #[method(name = "preview.status", with_extensions)]
    async fn preview_status(&self, project_id: String) -> RpcResult<LivePreview>;

    // Settings that survive a restart (PLAN.md M20) — the four stored records.
    // Every method here writes through to the settings file before it answers, so
    // a restart sees the change; a write that could not be stored is an error the
    // caller sees rather than a change the owner believes they made.
    #[method(name = "runmode.list", with_extensions)]
    async fn list_run_modes(&self) -> RpcResult<Vec<RunModeConfig>>;

    #[method(name = "runmode.set", with_extensions)]
    async fn set_run_mode(&self, config: RunModeConfig) -> RpcResult<RunModeConfig>;

    #[method(name = "backend.get", with_extensions)]
    async fn get_backend(&self, run_id: String) -> RpcResult<Option<BackendKit>>;

    #[method(name = "backend.set", with_extensions)]
    async fn set_backend(&self, run_id: String, kit: BackendKit) -> RpcResult<()>;

    #[method(name = "preferences.list", with_extensions)]
    async fn list_preferences(&self, project_id: String) -> RpcResult<Vec<Preference>>;

    /// Record one taste signal.
    ///
    /// This is a **write** on the same surface as the reads, and it is measured like one
    /// (re-audit N-8): the session's role decides whether it may write, the `standard`
    /// tier's ceiling is spent on the way in, and the actor is the verified one rather
    /// than absent. The legacy signature — one `PreferenceSignal`, no identity field — is
    /// unchanged on the wire.
    #[method(name = "preferences.record", with_extensions)]
    async fn record_preference(&self, signal: PreferenceSignal) -> RpcResult<Vec<Preference>>;

    #[method(name = "pairing.list", with_extensions)]
    async fn list_pairings(&self) -> RpcResult<Vec<PhonePairing>>;

    #[method(name = "pairing.create", with_extensions)]
    async fn create_pairing(&self, device_id: String, secret: String) -> RpcResult<PhonePairing>;

    #[method(name = "pairing.revoke", with_extensions)]
    async fn revoke_pairing(&self, device_id: String) -> RpcResult<PhonePairing>;

    // Routines (PLAN.md M16)
    #[method(name = "routines.list", with_extensions)]
    async fn list_routines(&self) -> RpcResult<Vec<Routine>>;

    #[method(name = "routines.get", with_extensions)]
    async fn get_routine(&self, id: String) -> RpcResult<Option<Routine>>;

    #[method(name = "routines.run_now", with_extensions)]
    async fn run_routine_now(&self, id: String) -> RpcResult<Routine>;

    #[method(name = "routines.pause", with_extensions)]
    async fn pause_routine(&self, id: String) -> RpcResult<Routine>;

    #[method(name = "routines.resume", with_extensions)]
    async fn resume_routine(&self, id: String) -> RpcResult<Routine>;

    // The sequenced event stream. `runs.subscribe` is the RPC mirror of the `/events`
    // WebSocket's replay: it answers where the daemon-wide stream is and hands back the
    // buffered, scrubbed frames after the caller's cursor, so a client that cannot hold
    // a socket (or reconnects after one dropped) resynchronises from one call. Both
    // `run_id` and `since_seq` are optional: no run means every run, no cursor means the
    // current end (nothing replayed).
    #[method(name = "runs.subscribe", with_extensions)]
    async fn subscribe_run(
        &self,
        run_id: Option<RunId>,
        since_seq: Option<u64>,
    ) -> RpcResult<RunStreamSync>;

    /// Drive a run one gate forward. Walks `advance_to_next_gate` until the run reaches
    /// a gate, the final `Feedback` stage, or a terminal status; reaching `Feedback`
    /// completes the run. An unrouted pipeline role is answered by the pipeline's own
    /// dispatch (W5's deterministic fake provider, or the env-configured model), so a
    /// fresh daemon advances out of the box with no key and no network.
    #[method(name = "runs.advance", with_extensions)]
    async fn advance_run(&self, run_id: RunId) -> RpcResult<Run>;

    /// Cancel a running run. Sets the status to `Cancelled`, records why, and appends an
    /// `Error`-kind event carrying `{"action": "run_cancelled", …}` to the same stream a
    /// live viewer watches. (The stream needs *some* event kind for a cancellation and
    /// `warsha_core::EventKind` has no `StageFailed`; `Error` is the closest existing.)
    #[method(name = "runs.cancel", with_extensions)]
    async fn cancel_run(&self, run_id: RunId, reason: Option<String>) -> RpcResult<Run>;

    /// Add a follow-up to a run at its current stage. Writes a `followup` artifact and
    /// appends an `AgentStep` event with the prompt and the response, both of which flow
    /// to `/events`. An empty or whitespace-only prompt is refused with `-32602`.
    #[method(name = "runs.followup", with_extensions)]
    async fn followup_run(&self, run_id: RunId, prompt: String) -> RpcResult<Run>;

    /// The run's artifacts, sorted by name — the seam `ArtifactViewer.tsx` names.
    #[method(name = "runs.artifacts", with_extensions)]
    async fn list_run_artifacts(&self, run_id: RunId) -> RpcResult<Vec<Artifact>>;

    // Wave 2 — harnesses (PLAN.md M20's declarative pipelines).
    //
    // The five methods are one read pair and three writes over the `harnesses`
    // tables in [`SettingsStore`], seeded once from
    // [`warsha_core::bundled_harnesses`]. The row *is* the record: a list, a get and
    // an import all answer from what a restart would read back, so nothing an owner
    // does here is visible only until the next boot. `harness.import` reads a JSON
    // document and always stamps the result user-authored (`preset: false`), because
    // a harness the owner typed is not one the daemon ships, and re-importing the
    // same name replaces it rather than forking it. `harness.select` writes the
    // project's active pipeline — with no project it writes the daemon-wide default
    // under the key `global`, which is what an unprojected run reads. `harness.delete`
    // refuses a bundled preset: the seed would put it back on the next start, and a
    // delete that silently undoes itself is worse than one that says no.
    #[method(name = "harness.list", with_extensions)]
    async fn list_harnesses(&self) -> RpcResult<Vec<HarnessDefinition>>;

    #[method(name = "harness.get", with_extensions)]
    async fn get_harness(&self, id: String) -> RpcResult<HarnessDefinition>;

    #[method(name = "harness.import", with_extensions)]
    async fn import_harness(
        &self,
        content: String,
        format: Option<String>,
    ) -> RpcResult<HarnessDefinition>;

    #[method(name = "harness.select", with_extensions)]
    async fn select_harness(&self, harness_id: String, project_id: Option<String>)
        -> RpcResult<()>;

    #[method(name = "harness.delete", with_extensions)]
    async fn delete_harness(&self, id: String) -> RpcResult<()>;

    // Wave 2 — skills.
    //
    // `skills.list` is the catalog the owner manages: every installed
    // [`SkillDefinition`], bundled and imported, enabled or not. (It answered the
    // `/review`-style [`SlashCommand`] list before the table existed; the agent loop's
    // own command registry is served in-process by `skill_catalog()` and is unchanged,
    // so the browser catalog and the runnable commands are now different things on
    // purpose — the owner manages the first, the agent executes the second.)
    // `skills.import` reads either a JSON row or a markdown skill with `---` front
    // matter; a URL is refused rather than fetched, because a daemon that pulls
    // arbitrary code over the network at an owner's click is the thing this project
    // promises not to be. `skills.toggle` *sets* the flag the caller names (the store's
    // `toggle_skill` flips, which cannot honour an explicit `enabled`).
    #[method(name = "skills.import", with_extensions)]
    async fn import_skill(
        &self,
        url_or_content: String,
        name: Option<String>,
    ) -> RpcResult<SkillDefinition>;

    #[method(name = "skills.toggle", with_extensions)]
    async fn toggle_skill(&self, id: String, enabled: bool) -> RpcResult<SkillDefinition>;

    #[method(name = "skills.delete", with_extensions)]
    async fn delete_skill(&self, id: String) -> RpcResult<()>;

    // Wave 2 — plugins (MCP extension packs).
    //
    // A plugin row carries its transport, its command line and its environment
    // *references*; `plugins.configure` is where a value that looks like a secret is
    // taken out of the row and filed in the OS keychain under
    // `plugin:{id}:{KEY}`, leaving `${secrets:plugin:{id}:{KEY}}` in its place — the
    // same shape `providers.add` already uses, so `plugins.list` can be read by a
    // browser without ever carrying a token. `plugins.install` reads a JSON manifest
    // only; a URL is refused for the reason `skills.import` gives.
    #[method(name = "plugins.list", with_extensions)]
    async fn list_plugins(&self) -> RpcResult<Vec<PluginDefinition>>;

    #[method(name = "plugins.install", with_extensions)]
    async fn install_plugin(&self, manifest_json_or_url: String) -> RpcResult<PluginDefinition>;

    #[method(name = "plugins.toggle", with_extensions)]
    async fn toggle_plugin(&self, id: String, enabled: bool) -> RpcResult<PluginDefinition>;

    #[method(name = "plugins.configure", with_extensions)]
    async fn configure_plugin(
        &self,
        id: String,
        env: HashMap<String, String>,
    ) -> RpcResult<PluginDefinition>;

    #[method(name = "plugins.remove", with_extensions)]
    async fn remove_plugin(&self, id: String) -> RpcResult<()>;

    // Wave 2 — custom models.
    //
    // A custom model is one the owner names by hand under a provider the daemon
    // already knows; the row is `(provider, model_id)`, so `models.add` is an upsert
    // and `models.remove` needs both halves. `models.list` filters by provider when
    // one is named, because the settings screen shows one provider's rows at a time.
    #[method(name = "models.list", with_extensions)]
    async fn list_custom_models(
        &self,
        provider: Option<String>,
    ) -> RpcResult<Vec<CustomModelRecord>>;

    #[method(name = "models.add", with_extensions)]
    async fn add_custom_model(
        &self,
        provider: String,
        model_id: String,
        display_name: Option<String>,
        context_window: Option<u32>,
    ) -> RpcResult<CustomModelRecord>;

    #[method(name = "models.remove", with_extensions)]
    async fn remove_custom_model(&self, provider: String, model_id: String) -> RpcResult<()>;

    // Wave 2 — integrations.
    //
    // An integration is one row per service, and its credentials are never in the
    // row: `integrations.connect` takes `IntegrationConfig`, files `token` and
    // `bot_token` in the keychain under `integration:{id}` / `integration:{id}:bot`,
    // and stores the rest. Every answer is an [`IntegrationStatus`], which has no
    // token field by construction. `integrations.test` is the one method under the
    // Spend tier: a check that reached GitHub or Slack would be the daemon spending
    // an owner's quota on their behalf, so today it reports what the daemon can know
    // locally — whether the service is configured and filed — and says so plainly.
    #[method(name = "integrations.list", with_extensions)]
    async fn list_integrations(&self) -> RpcResult<Vec<IntegrationStatus>>;

    #[method(name = "integrations.connect", with_extensions)]
    async fn connect_integration(
        &self,
        id: String,
        config: IntegrationConfig,
    ) -> RpcResult<IntegrationStatus>;

    #[method(name = "integrations.disconnect", with_extensions)]
    async fn disconnect_integration(&self, id: String) -> RpcResult<IntegrationStatus>;

    #[method(name = "integrations.test", with_extensions)]
    async fn test_integration(&self, id: String) -> RpcResult<IntegrationTestResult>;

    // Wave 2 — the project file browser.
    //
    // Both methods are confined to the project on purpose. The root is the project's
    // `repo_path` when it has one and `<data_dir>/files/<project key>` when it does
    // not; the requested path is joined component-by-component, so `..`, a root or a
    // prefix is refused before the filesystem is touched, and the joined path is then
    // canonicalised and required to still sit inside the root — which is what stops a
    // symlink from naming a file outside it. Reads are capped and text-only.
    #[method(name = "files.tree", with_extensions)]
    async fn list_project_files(
        &self,
        project_id: String,
        path: Option<String>,
    ) -> RpcResult<Vec<FileEntry>>;

    #[method(name = "files.read", with_extensions)]
    async fn read_project_file(&self, project_id: String, path: String) -> RpcResult<FileContent>;
}

/// Health response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub uptime_seconds: u64,
}

/// Provider configuration for RPC
///
/// The wire shape the desktop's first-run wizard already sends and reads, so the
/// wizard, its tests and the 112 screenshot baselines stay exactly as they are:
///
/// - `name` is the provider's identity — the keychain account for its key, the
///   key `providers.add`/`test`/`remove` take, and what `providers.list` reports.
///   There is no separate `id`: an owner who can name the provider once should not
///   have to keep two names in step.
/// - `kind` is the adapter tag the wizard's presets use (`open_router`,
///   `deep_seek`, `kimi`, `glm`, `qwen`), which is also what names a default base
///   URL and model in `warsha-providers`.
/// - `api_base` is present only when one is configured; the client declares it
///   optional for the same reason.
/// - There is no `key` field. A provider's secret lives in the OS keychain and is
///   never part of a reply, so no `providers.*` answer can leak it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderRecord {
    pub name: String,
    pub kind: String,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_base: Option<String>,
}

impl From<StoredProvider> for ProviderRecord {
    fn from(provider: StoredProvider) -> Self {
        Self {
            name: provider.name,
            kind: provider.kind,
            enabled: provider.enabled,
            api_base: provider.api_base,
        }
    }
}

/// The endpoint `provider` is tested against: the owner's own, else its kind's
/// published default. `None` only for a kind with neither.
///
/// `pub(crate)` because [`providers`] builds the adapter for the same row and has to
/// call the same endpoint: two rules about where a provider lives, in two files, are
/// two rules that will disagree.
pub(crate) fn provider_endpoint(provider: &StoredProvider) -> Option<String> {
    provider.api_base.clone().or_else(|| {
        OneClickProvider::from_tag(&provider.kind)
            .and_then(OneClickProvider::default_base_url)
            .map(str::to_string)
    })
}

/// The model `provider` is tested with: its kind's published default, or `""` when
/// the kind has none — which the setup check reports as "Enter the model id."
#[allow(dead_code)]
fn provider_model(provider: &StoredProvider) -> &'static str {
    OneClickProvider::from_tag(&provider.kind)
        .and_then(OneClickProvider::default_model)
        .unwrap_or_default()
}

/// A blank string is no string: the wizard sends `api_base` only when it has one,
/// but a caller that sends `""` means the same thing.
fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Role routing configuration for RPC
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleRoutingConfig {
    pub role: String,
    pub targets: Vec<RoutingTargetConfig>,
    pub fallback_enabled: bool,
    pub budget_cents_per_run: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingTargetConfig {
    pub provider_id: String,
    pub model_id: String,
    pub weight: u32,
}

/// Budget status for RPC
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetStatus {
    pub project_id: ProjectId,
    pub budget_cents: Option<u64>,
    pub spent_cents: u64,
    pub remaining_cents: Option<u64>,
}

/// One gate of one run, as `gates.list` answers it (#25).
///
/// This is the daemon-local wire shape `@warsha/client` declares
/// (`packages/client/src/index.ts:84-87`): a stage and its **flat** state. It exists
/// because `warsha_core::GateState` is adjacent-tagged on the wire
/// (`#[serde(tag = "state", content = "detail")]`, `crates/warsha-core/src/lib.rs:109`,
/// proven by `crates/warshad/tests/security_identity.rs:173-178` reading
/// `approved["detail"]["by"]`) while the client and both apps read
/// `approved["by"]` directly. Converting here is what lets the queue be served without
/// churning the TS types and every gates baseline beside them (DECISIONS.md 2026-11-03).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GateSummary {
    pub stage: Stage,
    pub state: GateSummaryState,
}

/// [`GateState`] flattened onto the wire: the deciding device and instant sit beside
/// `state` instead of under `detail`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum GateSummaryState {
    Pending,
    Approved {
        by: DeviceId,
        at: chrono::DateTime<Utc>,
    },
    Rejected {
        reason: String,
        by: DeviceId,
        at: chrono::DateTime<Utc>,
    },
    ChangesRequested {
        notes: String,
        by: DeviceId,
        at: chrono::DateTime<Utc>,
    },
}

impl From<GateState> for GateSummaryState {
    fn from(state: GateState) -> Self {
        match state {
            GateState::Pending => Self::Pending,
            GateState::Approved { by, at } => Self::Approved { by, at },
            GateState::Rejected { reason, by, at } => Self::Rejected { reason, by, at },
            GateState::ChangesRequested { notes, by, at } => {
                Self::ChangesRequested { notes, by, at }
            }
        }
    }
}

/// The agent loop's own state, as one RPC answer.
///
/// C2's promise is that the conversation survives a restart, and a promise nobody can
/// read is not one: this is what a caller compares after starting a second daemon over
/// the same data directory. `agent.turn` also answers its todos, but it cannot answer
/// the approval history without running a turn — and running a turn in Agent mode is
/// spend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentState {
    /// The mode the next turn runs in.
    pub mode: AgentMode,
    /// Every switch the loop recorded, oldest first, each naming the device that
    /// approved it. This is the approval history `agent.approve_mode` appends to.
    pub approvals: Vec<ModeTransition>,
    /// What the loop said it would do, one item per turn.
    pub todos: Vec<TodoItem>,
    /// Whether a model call is wired behind an Agent-mode turn. It is the daemon's
    /// routing table that decides whether that call reaches a provider, so a wired
    /// loop with no routing still answers honestly that nothing was reached.
    pub model_wired: bool,
}

/// RPC implementation
pub struct WarshaRpc {
    state: Arc<DaemonState>,
    start_time: std::time::Instant,
}

impl WarshaRpc {
    pub fn new(state: Arc<DaemonState>) -> Self {
        Self {
            state,
            start_time: std::time::Instant::now(),
        }
    }

    /// The working tree a handoff bundle is applied to.
    ///
    /// The bundle names the run, the run names the project, and the project's
    /// `repo_path` is where that project's files live. `None` when any link is
    /// missing (a bundle whose run id is not a ULID, a run the store does not
    /// have, a project with no repo yet): an apply writes files, so the caller
    /// refuses instead of writing into the daemon's own bundle directory.
    async fn working_tree_for_run(&self, run_id: &str) -> Option<PathBuf> {
        let id = run_id.parse::<ulid::Ulid>().ok()?;
        let run = self.state.store.get_run(RunId(id)).await.ok()?;
        let project = self.state.store.get_project(run.project_id).await.ok()?;
        project.repo_path.map(PathBuf::from)
    }

    /// The project behind a run: its id and its name, or the run id as both.
    ///
    /// The settings rows are keyed by project while the RPCs are addressed by run,
    /// so this is the one place that resolution happens: RunId → Run → Project.
    /// A link that is missing (a bundle whose run id is not a ULID, a run the store
    /// does not have, a project that was deleted) falls back to the run id as both
    /// the key and the name, which keeps an export of an unregistered run working
    /// instead of failing on a project that was never stored.
    async fn project_for_run(&self, run_id: &str) -> (String, String) {
        let fallback = || (run_id.to_string(), run_id.to_string());
        let Ok(id) = run_id.parse::<ulid::Ulid>() else {
            return fallback();
        };
        let Ok(run) = self.state.store.get_run(RunId(id)).await else {
            return fallback();
        };
        let Ok(project) = self.state.store.get_project(run.project_id).await else {
            return fallback();
        };
        let name = if project.name.trim().is_empty() {
            run_id.to_string()
        } else {
            project.name
        };
        (project.id.to_string(), name)
    }

    /// The kit of a project key: the daemon's copy, else the stored row, else the
    /// default for that project.
    ///
    /// The order is the point. The in-memory copy is what a `backend.set` in this
    /// life put there; the stored row is what an earlier life left; the default is
    /// what a project that never exported gets, so the first export of a new
    /// project is the empty schema rather than nothing at all.
    async fn backend_kit(&self, key: &str, project_name: &str) -> BackendKit {
        if let Some(kit) = self.state.backend_kits.read().await.get(key) {
            return kit.clone();
        }
        match self.state.settings.load_backend_kit(key).await {
            Ok(Some(kit)) => kit,
            Ok(None) => default_backend_kit(project_name),
            Err(error) => {
                // A kit that cannot be read is reported and the default stands in:
                // an export is still worth producing, and the row is left untouched
                // for the next read.
                warn!("could not read the backend kit for `{key}`: {error}");
                default_backend_kit(project_name)
            }
        }
    }

    /// Remember a kit: on disk first, then in memory.
    ///
    /// That order is what makes the in-memory copy trustworthy — it never holds a
    /// change the file refused — and it is why a failed write is an error the
    /// caller sees rather than a setting the owner only thinks they made.
    async fn remember_backend_kit(&self, key: &str, kit: &BackendKit) -> RpcResult<()> {
        self.state
            .settings
            .save_backend_kit(key, kit)
            .await
            .map_err(|error| rpc_error(error.to_string()))?;
        self.state
            .backend_kits
            .write()
            .await
            .insert(key.to_string(), kit.clone());
        Ok(())
    }

    /// Write the daemon's pairings through to the settings file.
    ///
    /// The whole list is written because a revocation is a value on the row rather
    /// than a delete: the table has to mirror the store exactly, or a phone the
    /// owner revoked would come back paired after a restart.
    async fn save_pairings(&self) -> RpcResult<()> {
        let pairings = self.state.pairings.read().await.clone();
        self.state
            .settings
            .save_pairings(pairings)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    /// One Wave 2 row or the refusal that it is not installed.
    ///
    /// The four readers below share one shape because the four catalogs are managed
    /// the same way: a write names a row, and a row that is not in the store is the
    /// caller's mistake (`-32602`), not the daemon's. The message names what *is*
    /// installed only by count, because a catalog can be long and a browser that got
    /// the id wrong already has the list call to make.
    async fn stored_harness(&self, id: &str) -> RpcResult<StoredHarness> {
        self.state
            .settings
            .get_harness(id)
            .await
            .map_err(rpc_error)?
            .ok_or_else(|| rpc_invalid_params(format!("no harness `{id}` is installed")))
    }

    async fn stored_skill(&self, id: &str) -> RpcResult<StoredSkill> {
        self.state
            .settings
            .get_skill(id)
            .await
            .map_err(rpc_error)?
            .ok_or_else(|| rpc_invalid_params(format!("no skill `{id}` is installed")))
    }

    async fn stored_plugin(&self, id: &str) -> RpcResult<StoredPlugin> {
        self.state
            .settings
            .get_plugin(id)
            .await
            .map_err(rpc_error)?
            .ok_or_else(|| rpc_invalid_params(format!("no plugin `{id}` is installed")))
    }

    async fn stored_integration(&self, id: &str) -> RpcResult<StoredIntegration> {
        self.state
            .settings
            .get_integration(id)
            .await
            .map_err(rpc_error)?
            .ok_or_else(|| {
                rpc_invalid_params(format!(
                    "no integration `{id}` is connected; integrations.connect writes one"
                ))
            })
    }

    /// File a plugin pack's environment values, returning what the row keeps.
    ///
    /// Anything that is already a `${…}` reference is stored as written — the owner
    /// may be pointing at the process environment or at an entry filed for another
    /// pack, and the daemon has no business second-guessing that. Everything else is
    /// treated as secret material and moved to the keychain under an account namespaced
    /// by the pack, so two packs that both want `GITHUB_TOKEN` hold two secrets and the
    /// row carries only the address. A keychain that refuses is a refusal of the whole
    /// call: an environment half-filed would launch a pack with a token the owner
    /// believes is set.
    async fn file_plugin_env(
        &self,
        id: &str,
        env: &HashMap<String, String>,
    ) -> RpcResult<HashMap<String, String>> {
        let (references, secrets) = wave2::split_plugin_env(id, env);
        for (account, value) in secrets {
            self.state
                .secrets
                .store(&account, &value)
                .await
                .map_err(|error| {
                    rpc_error(format!(
                        "the value for `{account}` could not be stored in the OS keychain: {error}"
                    ))
                })?;
        }
        Ok(references)
    }

    /// One integration's status, with the keychain consulted for what the row omits.
    ///
    /// `has_token` is "an entry exists", never "a token was read": the value is not
    /// brought into memory to answer a listing, and a reply that carried it would put
    /// a secret on the wire the browser reads.
    async fn integration_status_of(&self, id: &str) -> RpcResult<IntegrationStatus> {
        let row = self.stored_integration(id).await?;
        Ok(wave2::integration_status(
            &row,
            self.state
                .secrets
                .load(&wave2::integration_secret_account(&row.id))
                .await
                .is_ok(),
            self.state
                .secrets
                .load(&wave2::integration_bot_secret_account(&row.id))
                .await
                .is_ok(),
        ))
    }

    /// Every integration the daemon has been connected, by name.
    async fn integration_statuses(&self) -> RpcResult<Vec<IntegrationStatus>> {
        let rows = self
            .state
            .settings
            .list_integrations()
            .await
            .map_err(rpc_error)?;
        let mut statuses = Vec::with_capacity(rows.len());
        for row in &rows {
            statuses.push(wave2::integration_status(
                row,
                self.state
                    .secrets
                    .load(&wave2::integration_secret_account(&row.id))
                    .await
                    .is_ok(),
                self.state
                    .secrets
                    .load(&wave2::integration_bot_secret_account(&row.id))
                    .await
                    .is_ok(),
            ));
        }
        Ok(statuses)
    }

    /// The directory a project's files are browsed from.
    ///
    /// A project with a working tree is browsed there, because that is the tree the
    /// agent edits and the one an owner wants to read. A project without one — created
    /// by name alone, or a caller that passed an id the store has never seen — is
    /// browsed from `<data_dir>/files/<sanitised id>`, which is a directory the daemon
    /// owns and the agent's own file tools can write into. The fallback is what makes
    /// `files.*` answerable for every id a browser can hold, and the sanitising is what
    /// stops an unknown id from choosing where it lives.
    async fn project_files_root(&self, project_id: &str) -> PathBuf {
        let repo_path = match uuid::Uuid::parse_str(project_id.trim()) {
            Ok(id) => self
                .state
                .store
                .get_project(ProjectId(id))
                .await
                .ok()
                .and_then(|project| project.repo_path),
            Err(_) => None,
        };
        wave2::project_files_root(
            &self.state.config.data_dir,
            project_id,
            repo_path.as_deref(),
        )
    }

    /// The daemon's command policy, read from its configuration (security audit H-05).
    ///
    /// Built per call rather than stored, because the configuration it comes from is
    /// the daemon's own and never a request's: an RPC cannot widen the allow-list, and
    /// a state that cached a list nothing can change would only be a second copy of it.
    fn process_policy(&self) -> ProcessPolicy {
        ProcessPolicy::from_config(
            &self.state.config.allowed_commands,
            &self.state.config.data_dir,
        )
    }

    /// The verified caller behind this request, its ceiling spent, and its role
    /// checked against what the method asks for.
    ///
    /// Everything an RPC is allowed to know about who is asking comes through here,
    /// which is the point (security audit H-03, H-04): the actor was put in the
    /// request's extensions by the transport after it checked the credential, and a
    /// method that skipped this call would know nothing about its caller at all.
    ///
    /// Three refusals, each with its own code so a client can tell them apart:
    /// `-32001` for no verified session, `-32004` for a caller past a ceiling (the
    /// RPC form of the HTTP 429 the daemon's other listener answers with), and
    /// `-32002` for a caller that is verified but not the owner.
    fn authorize(&self, ext: &RpcExtensions, method: &str) -> RpcResult<Actor> {
        let policy = auth::policy_of(method)
            .ok_or_else(|| rpc_forbidden(format!("{method} is not a method this daemon serves")))?;

        let actor = ext
            .get::<Actor>()
            .cloned()
            .ok_or_else(|| rpc_unauthenticated(format!("{method} needs a verified session")))?;

        // The tier is keyed on the authenticated identity, so one device's flood is
        // not another device's refusal (audit H-01).
        let ceiling = self.state.rates.check(policy.tier, actor.key());
        if !ceiling.is_allowed() {
            let secs = ceiling.retry_after_secs();
            self.state.report_refusal(policy.method, actor.key());
            return Err(rpc_rate_limited(secs));
        }

        let required = match policy.policy {
            Policy::Session => ActorRole::Paired,
            Policy::Owner => ActorRole::Owner,
        };
        if !actor.role().covers(required) {
            return Err(rpc_forbidden(format!(
                "{method} is the daemon owner's; this session is a paired device"
            )));
        }
        Ok(actor)
    }

    /// The device a gate decision is recorded against — the session's, always.
    ///
    /// `claimed` is the legacy `device_id` parameter the shape of this RPC still
    /// carries so a client that has not been updated parses. It is checked against
    /// the authenticated session and never believed: a caller that names a different
    /// device is refused with `-32003` rather than being recorded as that device,
    /// which is exactly the failure audit H-03 described.
    fn gate_approver(
        &self,
        actor: &Actor,
        claimed: Option<DeviceId>,
        method: &str,
    ) -> RpcResult<DeviceId> {
        let verified = actor.device_id().ok_or_else(|| {
            rpc_identity_mismatch(format!(
                "{method} records the deciding device, and this session's pairing does not name one"
            ))
        })?;
        if let Some(claimed) = claimed {
            if claimed != verified {
                warn!(
                    "{method} refused: the session is {verified} but the request named {claimed}"
                );
                return Err(rpc_identity_mismatch(format!(
                    "{method} was called as {verified} with {claimed} in its params; a device id in a request does not decide who is asking"
                )));
            }
        }
        Ok(verified)
    }

    /// Write the loop's conversation to the daemon's settings.
    async fn store_agent(&self, snapshot: &AgentLoopSnapshot) -> Result<()> {
        store_agent_snapshot(&self.state.settings, snapshot).await
    }

    /// Ask for one of the two agent modes, on the session's own authority.
    ///
    /// The order is the one `roles.set` uses and for the same reason: the record has to
    /// survive before the switch does. So the loop is switched, the history is written,
    /// and a write that fails puts the loop back to exactly what it was and refuses —
    /// because an approval the next daemon does not know about is an approval that lets
    /// a tool run under a name no audit trail carries (audit H-03).
    ///
    /// The approver is never taken from the params. [`Self::gate_approver`] is what says
    /// so, and it is shared with the gate methods for exactly that reason: one rule, in
    /// one place, with one refusal code.
    async fn agent_switch(&self, ext: &RpcExtensions, to: AgentMode) -> RpcResult<ModeTransition> {
        let method = match to {
            AgentMode::Agent => "agent.approve_mode",
            AgentMode::Plan => "agent.plan_mode",
        };
        let actor = self.authorize(ext, method)?;
        let approver = self.gate_approver(&actor, None, method)?.to_string();

        let mut agent_loop = self.state.agent_loop.write().await;
        let before = AgentLoopSnapshot::of(&agent_loop);
        let transition = match to {
            // A switch into Agent mode is the one that needs the name: the mode manager
            // refuses a blank approver itself, so this cannot invent one.
            AgentMode::Agent => agent_loop.approve_agent_mode(approver.as_str()),
            AgentMode::Plan => agent_loop.return_to_plan_mode(),
        }
        .map_err(|error| rpc_error(error.to_string()))?;
        let after = AgentLoopSnapshot::of(&agent_loop);
        drop(agent_loop);

        if let Err(error) = self.store_agent(&after).await {
            // Undo the live switch, so nothing runs in a mode no record approved.
            let mut guard = self.state.agent_loop.write().await;
            before.restore(&mut guard);
            return Err(rpc_error(format!(
                "{method} could not be recorded, so the mode did not change: {error}"
            )));
        }
        info!("{method} recorded for the device the session authenticated");
        Ok(transition)
    }

    async fn resolve_test_model(
        &self,
        provider: &StoredProvider,
        explicit_model: Option<String>,
    ) -> String {
        if let Some(m) = explicit_model
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
        {
            return m;
        }

        if let Ok(models) = self.state.settings.list_custom_models().await {
            if let Some(m) = models.into_iter().find(|m| {
                m.enabled
                    && (m.provider.eq_ignore_ascii_case(&provider.name)
                        || m.provider.eq_ignore_ascii_case(&provider.kind))
            }) {
                if !m.model_id.trim().is_empty() {
                    return m.model_id;
                }
            }
        }

        let routings = self.state.role_routings.read().await;
        for config in routings.values() {
            for target in &config.targets {
                if (target.provider_id.eq_ignore_ascii_case(&provider.name)
                    || target.provider_id.eq_ignore_ascii_case(&provider.kind))
                    && !target.model_id.trim().is_empty()
                {
                    return target.model_id.clone();
                }
            }
        }

        if let Some(default_m) =
            OneClickProvider::from_tag(&provider.kind).and_then(OneClickProvider::default_model)
        {
            if !default_m.trim().is_empty() {
                return default_m.to_string();
            }
        }

        let kind = provider.kind.to_lowercase();
        if kind.contains("anthropic") {
            "claude-3-5-haiku-latest".to_string()
        } else if kind.contains("ollama") {
            "llama3.2".to_string()
        } else if kind.contains("fake") || kind.contains("mock") {
            "fake-model".to_string()
        } else {
            "gpt-4o-mini".to_string()
        }
    }

    async fn active_skill_catalog(&self) -> Vec<SlashCommand> {
        let mut registry = SlashCommandRegistry::new();
        for (name, description) in SKILL_CATALOG {
            let _ = registry.register(SlashCommand::new(*name, *description));
        }
        if let Ok(rows) = self.state.settings.list_skills().await {
            for row in rows {
                if row.enabled {
                    let _ = registry.register(SlashCommand::new(&row.id, &row.description));
                }
            }
        }
        registry.skills()
    }
}

/// Seconds since the Unix epoch, or `0` on a clock that cannot answer.
///
/// A settings row is stamped with this when the caller does not supply a time, and
/// a stamp is diagnostic: a host whose clock sits before 1970 records `0` rather
/// than refusing the write.
fn now_epoch_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default()
}

#[async_trait]
impl WarshaApiServer for WarshaRpc {
    async fn health(&self, ext: &RpcExtensions) -> RpcResult<HealthResponse> {
        self.authorize(ext, "health")?;
        Ok(HealthResponse {
            status: "healthy".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            uptime_seconds: self.start_time.elapsed().as_secs(),
        })
    }

    async fn list_projects(&self, ext: &RpcExtensions) -> RpcResult<Vec<Project>> {
        self.authorize(ext, "projects.list")?;
        self.state
            .store
            .list_projects()
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn create_project(
        &self,
        ext: &RpcExtensions,
        name: String,
        description: String,
        language: String,
    ) -> RpcResult<Project> {
        self.authorize(ext, "projects.create")?;
        let project = Project {
            id: ProjectId::new(),
            name,
            description,
            language,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            repo_path: None,
            repo_url: None,
        };
        self.state
            .store
            .create_project(&project)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;
        Ok(project)
    }

    async fn get_project(&self, ext: &RpcExtensions, id: ProjectId) -> RpcResult<Project> {
        self.authorize(ext, "projects.get")?;
        self.state
            .store
            .get_project(id)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn start_run(
        &self,
        ext: &RpcExtensions,
        project_id: ProjectId,
        idea: String,
    ) -> RpcResult<Run> {
        self.authorize(ext, "runs.start")?;
        let run = self
            .state
            .pipeline
            .start_run(project_id, &idea)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;

        // Wire active harness + enabled skills + enabled plugins into run start context (F2)
        let active_harness = self
            .state
            .settings
            .get_active_harness(&project_id.to_string())
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| "autonomous-factory".to_string());
        let enabled_skills: Vec<String> = self
            .state
            .settings
            .list_skills()
            .await
            .unwrap_or_default()
            .into_iter()
            .filter(|s| s.enabled)
            .map(|s| s.id)
            .collect();
        let enabled_plugins: Vec<String> = self
            .state
            .settings
            .list_plugins()
            .await
            .unwrap_or_default()
            .into_iter()
            .filter(|p| p.enabled)
            .map(|p| p.id)
            .collect();

        tracing::info!(
            target: "audit",
            run_id = %run.id.0,
            stage = ?run.current_stage,
            harness = %active_harness,
            skills = ?enabled_skills,
            plugins = ?enabled_plugins,
            "run start audit context"
        );

        Ok(run)
    }

    async fn get_run(&self, ext: &RpcExtensions, run_id: RunId) -> RpcResult<Run> {
        self.authorize(ext, "runs.get")?;
        self.state
            .store
            .get_run(run_id)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn list_runs(&self, ext: &RpcExtensions, project_id: ProjectId) -> RpcResult<Vec<Run>> {
        self.authorize(ext, "runs.list")?;
        self.state
            .store
            .list_runs(project_id)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn get_events(&self, ext: &RpcExtensions, run_id: RunId) -> RpcResult<Vec<Event>> {
        self.authorize(ext, "runs.events")?;
        let token = self.state.config.auth_token.clone();
        let mut events = self
            .state
            .store
            .get_events(run_id)
            .await
            .map_err(rpc_error)?;
        // The store holds the payload as it was written; the wire never sees a secret.
        for event in &mut events {
            scrub_event_payload(&mut event.payload, &token);
        }
        Ok(events)
    }

    async fn approve_gate(
        &self,
        ext: &RpcExtensions,
        run_id: RunId,
        stage: Stage,
        device_id: Option<DeviceId>,
    ) -> RpcResult<Run> {
        let actor = self.authorize(ext, "gates.approve")?;
        let approver = self.gate_approver(&actor, device_id, "gates.approve")?;
        self.state
            .pipeline
            .approve_gate(run_id, stage, approver)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn reject_gate(
        &self,
        ext: &RpcExtensions,
        run_id: RunId,
        stage: Stage,
        reason: String,
        device_id: Option<DeviceId>,
    ) -> RpcResult<Run> {
        let actor = self.authorize(ext, "gates.reject")?;
        let approver = self.gate_approver(&actor, device_id, "gates.reject")?;
        self.state
            .pipeline
            .reject_gate(run_id, stage, reason, approver)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn request_changes(
        &self,
        ext: &RpcExtensions,
        run_id: RunId,
        stage: Stage,
        notes: String,
        device_id: Option<DeviceId>,
    ) -> RpcResult<Run> {
        let actor = self.authorize(ext, "gates.changes")?;
        let approver = self.gate_approver(&actor, device_id, "gates.changes")?;
        self.state
            .pipeline
            .request_changes(run_id, stage, notes, approver)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn list_gates(
        &self,
        ext: &RpcExtensions,
        run_id: RunId,
        device_id: Option<DeviceId>,
    ) -> RpcResult<Vec<GateSummary>> {
        self.authorize(ext, "gates.list")?;
        // Accepted for the gates block's legacy param shape, and believed for nothing:
        // this read records no identity, so there is no session claim to compare it to
        // and no caller-named device that changes what is answered.
        let _ = device_id;
        // Read from `Run.gate_states` through the store's run getter — **not** from
        // `Store::list_gates`. The `gates` table's only writer, `create_gate`, has no
        // production caller, so a table-backed read would answer `[]` for every run and
        // turn every queue into a silent lie (the trap DECISIONS.md 2026-11-03 #25
        // records; `Run.gate_states` is what the pipeline seeds on `start_run` and what
        // `gates.approve`/`reject`/`changes` mutate, so it is the live truth).
        let run = self
            .state
            .store
            .get_run(run_id)
            .await
            .map_err(|e| rpc_error(e.to_string()))?;
        Ok(Stage::all()
            .iter()
            .filter(|stage| stage.is_gate())
            .map(|stage| GateSummary {
                stage: *stage,
                state: run
                    .gate_states
                    .get(stage)
                    .cloned()
                    .unwrap_or_default()
                    .into(),
            })
            .collect())
    }

    async fn list_providers(&self, ext: &RpcExtensions) -> RpcResult<Vec<ProviderRecord>> {
        self.authorize(ext, "providers.list")?;
        let stored = self
            .state
            .settings
            .load_providers()
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;
        Ok(stored.into_iter().map(ProviderRecord::from).collect())
    }

    /// Add a provider: keychain first, then the settings row.
    ///
    /// The order is the point. A keychain that refuses (a locked keyring, a
    /// platform with no secret service) must leave no row behind, because a
    /// configured provider whose key is missing is a provider every
    /// `providers.test` would refuse — recorded as if the owner had finished
    /// setup. Nothing here logs the key, echoes it in an error, or writes it
    /// anywhere but the store it was handed.
    async fn add_provider(
        &self,
        ext: &RpcExtensions,
        name: String,
        kind: String,
        key: String,
        api_base: Option<String>,
    ) -> RpcResult<ProviderRecord> {
        self.authorize(ext, "providers.add")?;
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err(provider_refusal("a provider needs a name"));
        }
        if name == MOCK_PROVIDER_ID {
            // The daemon's own offline adapter holds this id, and every automated test
            // routes to it. A row that claimed it would be registered now and skipped
            // at the next start (`register_configured_providers` leaves the id to the
            // mock), which is a provider that works until it quietly does not.
            return Err(provider_refusal(format!(
                "{MOCK_PROVIDER_ID} is the daemon's own offline provider; choose another name"
            )));
        }
        let kind = kind.trim().to_string();
        if kind.is_empty() {
            return Err(provider_refusal(format!(
                "provider {name} needs a kind (open_router, deep_seek, kimi, glm, qwen or custom)"
            )));
        }
        let api_base = non_empty(api_base);
        // A pasted key arrives with the whitespace the paste carried; the wizard's
        // own check trims before it judges, so the key that is stored and later sent
        // as a bearer token is the trimmed one and not a key with a newline in it.
        let key = key.trim().to_string();

        // The endpoint has to be known before anything is stored: the kind's
        // default when the caller sent none, and a refusal when there is none.
        let endpoint = api_base.clone().or_else(|| {
            OneClickProvider::from_tag(&kind)
                .and_then(OneClickProvider::default_base_url)
                .map(str::to_string)
        });
        let Some(endpoint) = endpoint else {
            return Err(provider_refusal(format!(
                "no base URL is known for provider kind {kind}; send api_base with the provider"
            )));
        };

        // The two input checks that belong to `add`: the URL parses and the key is
        // usable. The model is not checked here — `add` has no model to check, and
        // `providers.test` is where that field is reported.
        let inputs = ProviderSetupWizard::test_connection(&endpoint, &key, "");
        if let Some(reason) = inputs.url_reason {
            return Err(provider_refusal(reason));
        }
        if let Some(reason) = inputs.key_reason {
            return Err(provider_refusal(reason));
        }

        self.state.secrets.store(&name, &key).await.map_err(|e| {
            provider_refusal(format!(
                "the API key could not be stored in the OS keychain: {e}"
            ))
        })?;

        let provider = StoredProvider {
            name: name.clone(),
            kind,
            api_base,
            enabled: true,
            created_at: u64::try_from(Utc::now().timestamp()).unwrap_or_default(),
        };
        self.state
            .settings
            .save_provider(&provider)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;

        // The row is the owner's half of a provider and the router is the callable half.
        // Registering the deferred adapter here is what makes a provider usable by the
        // next turn rather than only by the daemon after the next restart — and
        // registering calls nothing: the adapter is built on its first use, so a fresh
        // daemon with three configured providers still starts with no network at all.
        self.state
            .providers
            .write()
            .await
            .register_provider(Box::new(DeferredProvider::new(
                provider.clone(),
                Arc::clone(&self.state.provider_factory),
            )));

        info!("provider {name} configured");
        Ok(provider.into())
    }

    /// Test a stored provider for real: is the input well formed, then does the
    /// endpoint answer and accept the key.
    ///
    /// A refusal is an error rather than `{healthy: false}`, because the desktop
    /// client's `providers.test` treats a resolved call as a passing test — the
    /// wizard could not tell an unhealthy result from a healthy one. The reason
    /// therefore travels in the error's message (what the wizard shows) and in its
    /// `data` as the [`HealthCheck`] the RPC declares.
    async fn test_provider(
        &self,
        ext: &RpcExtensions,
        name: String,
        model: Option<String>,
    ) -> RpcResult<HealthCheck> {
        self.authorize(ext, "providers.test")?;
        let provider = self
            .state
            .settings
            .load_provider(&name)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?
            .ok_or_else(|| provider_refusal(format!("no provider named {name} is configured")))?;

        let endpoint = provider_endpoint(&provider).ok_or_else(|| {
            provider_refusal(format!(
                "no base URL is known for provider kind {}; add it again with api_base",
                provider.kind
            ))
        })?;
        let key = self.state.secrets.load(&name).await.map_err(|e| {
            provider_refusal(format!(
                "the API key for {name} could not be read from the OS keychain: {e}"
            ))
        })?;

        // Resolve test probe model per D1:
        // 1. Explicit model param
        // 2. Custom model registered for this provider that is enabled
        // 3. Role routing targeting this provider
        // 4. OneClickProvider default
        // 5. Kind-specific fallback
        let resolved_model = self.resolve_test_model(&provider, model).await;

        // No network yet: a malformed URL or a key the owner typed with a space in
        // it is refused here, from the wizard's own checks.
        if let Some(reason) =
            ProviderSetupWizard::test_connection(&endpoint, &key, &resolved_model).reason()
        {
            return Err(provider_refusal(reason));
        }

        let health = probe_endpoint(&endpoint, &key).await;
        if health.healthy {
            return Ok(health);
        }

        let reason = health
            .error
            .clone()
            .unwrap_or_else(|| "the connection test failed".to_string());
        warn!("provider {name} failed its connection test: {reason}");
        Err(ErrorObject::owned(-32000, reason, Some(health)))
    }

    async fn check_provider_models(
        &self,
        ext: &RpcExtensions,
        name: String,
    ) -> RpcResult<warsha_providers::ModelCatalogDiff> {
        self.authorize(ext, "providers.check_models")?;
        // A handle rather than a lock held across the catalog call (audit N-3): this
        // reaches the provider over the network, and a read guard kept through it would
        // make an owner's `providers.add` wait for a round trip it has nothing to do with.
        let router = {
            let guard = self.state.providers.read().await;
            (*guard).clone()
        };
        router
            .check_model_updates(&name, &[])
            .await
            .map_err(|e| rpc_error(e.to_string()))
    }

    async fn list_devices(
        &self,
        ext: &RpcExtensions,
    ) -> RpcResult<Vec<warsha_remote::DeviceIdentity>> {
        self.authorize(ext, "devices.list")?;
        Ok(self.state.devices.list_devices().await)
    }

    async fn pair_device(
        &self,
        ext: &RpcExtensions,
        pairing_data: warsha_remote::PairingData,
    ) -> RpcResult<()> {
        self.authorize(ext, "devices.pair")?;
        let device = warsha_remote::DeviceIdentity {
            device_id: pairing_data.device_id,
            static_public: pairing_data.static_public,
            name: "Paired Device".to_string(),
            created_at: Utc::now(),
            revoked: false,
            revoked_at: None,
        };
        self.state
            .devices
            .add_device(device)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;

        {
            let mut pairings = self.state.pairings.write().await;
            if pairings.get(&pairing_data.device_id.to_string()).is_none() {
                let _ = pairings.create(
                    &pairing_data.device_id.to_string(),
                    &pairing_data.secret_token(),
                    now_epoch_secs(),
                );
            }
        }
        self.save_pairings().await?;
        Ok(())
    }

    async fn start_pairing(&self, ext: &RpcExtensions) -> RpcResult<warsha_remote::PairingOffer> {
        // Owner-only, deliberately (see `crates/warshad/src/auth.rs`): this is the method
        // that mints the credential the daemon will later trust a caller as, so a caller
        // that is already only a paired device must not be able to hand out a second one.
        self.authorize(ext, "devices.pair-start")?;

        // The address a phone is sent to, taken from the socket the daemon actually bound
        // and not from the configuration that asked for it: a link may never advertise an
        // address the daemon is not listening on, which is the one way parts A and B of
        // this change could disagree and produce a pairing that cannot be used.
        let server_origin = self.state.pairing_origin.get().cloned().ok_or_else(|| {
            rpc_error(
                "this daemon has no resolved listening origin to advertise yet; a pairing link \
                 would send a phone to an address it cannot reach. If the daemon is bound to a \
                 wildcard address (0.0.0.0), set `advertised_host` to the address your phone \
                 reaches this machine at"
                    .to_string(),
            )
        })?;
        let loopback_only = origin_is_loopback(&server_origin);

        let device = warsha_remote::DeviceIdentity::generate("Pairing in progress".to_string())
            .map_err(|error| rpc_error(error.to_string()))?;
        // `relay_url` is `None` on purpose. The daemon keeps a `RunModeConfig` per mode and
        // no single one of them is "the mode this daemon serves" — there is no active-mode
        // state to read — and the relay path carries encrypted frames rather than this RPC
        // surface, so naming one would be a guess about where the phone connects. The
        // origin in the pairing link is what a phone dials today; see DECISIONS/PLAN for the
        // relay as its own milestone.
        let offer = warsha_remote::PairingOffer::new(&device, &server_origin, None, loopback_only)
            .map_err(|error| rpc_error(error.to_string()))?;

        // The secret itself is never logged: the origin and the expiry are what an owner
        // and a reviewer need, and a pairing line in a log is otherwise a bearer token in
        // a file that gets shipped to support (audit N-1).
        self.state
            .devices
            .add_device(device.clone())
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;

        {
            let mut pairings = self.state.pairings.write().await;
            pairings
                .create(
                    &device.device_id.to_string(),
                    &offer.pairing.secret_token(),
                    now_epoch_secs(),
                )
                .map_err(|error| rpc_error(error.to_string()))?;
        }
        self.save_pairings().await?;

        info!(
            "minted a pairing for device {} at {server_origin}, valid until {}",
            offer.pairing.device_id,
            offer.expires_at().to_rfc3339()
        );
        Ok(offer)
    }

    async fn revoke_device(&self, ext: &RpcExtensions, device_id: DeviceId) -> RpcResult<()> {
        self.authorize(ext, "devices.revoke")?;
        self.state
            .devices
            .revoke_device(device_id)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;

        {
            let mut pairings = self.state.pairings.write().await;
            let _ = pairings.revoke(&device_id.to_string());
        }
        self.save_pairings().await?;
        Ok(())
    }

    // Providers
    async fn remove_provider(
        &self,
        ext: &RpcExtensions,
        name: String,
    ) -> RpcResult<ProviderRecord> {
        self.authorize(ext, "providers.remove")?;
        let provider = self
            .state
            .settings
            .load_provider(&name)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?
            .ok_or_else(|| provider_refusal(format!("no provider named {name} is configured")))?;

        // The keychain goes first, and a failure there stops the removal: the
        // account is the provider's name, so a row deleted while its key stayed
        // behind would be an entry nothing could ever overwrite or reach again.
        self.state.secrets.delete(&name).await.map_err(|e| {
            provider_refusal(format!(
                "the API key could not be removed from the OS keychain: {e}"
            ))
        })?;
        self.state
            .settings
            .delete_provider(&name)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;

        // The router may already hold a built adapter with this provider's key inside
        // its request headers, and a row that is gone does not take that back. Putting a
        // refusal under the same id is what makes removal a removal rather than the
        // deletion of the record that it happened.
        self.state
            .providers
            .write()
            .await
            .register_provider(Box::new(RemovedProvider::new(&name)));

        // Routings that name it go too, written through in the same order `roles.set`
        // uses: stored first, then honoured. Leaving them would leave a role whose every
        // call fails with a provider the owner can no longer see in `providers.list`.
        let (table, dropped) = {
            let current = self.state.role_routings.read().await;
            let mut table: HashMap<Role, RoleRoutingConfig> = HashMap::clone(&current);
            let mut dropped: Vec<String> = Vec::new();
            table.retain(|_, config| {
                let names = config
                    .targets
                    .iter()
                    .any(|target| target.provider_id.trim() == name);
                if names {
                    dropped.push(config.role.clone());
                }
                !names
            });
            (table, dropped)
        };
        if !dropped.is_empty() {
            store_role_routings(&self.state.settings, &table)
                .await
                .map_err(|error| {
                    rpc_error(format!(
                        "the provider is removed but its routings could not be rewritten: {error}"
                    ))
                })?;
            *self.state.role_routings.write().await = table;
            info!(
                "routings for {} role(s) dropped with provider {name}",
                dropped.len()
            );
        }

        info!("provider {name} removed");
        Ok(provider.into())
    }

    // Roles.
    //
    // The routing an owner sets is the routing a turn follows: `roles.set` hands it to
    // the router *and* to the daemon's settings, so the model the owner chose answers
    // the next call and every call after a restart. Both halves matter — a routing kept
    // only in memory was C2's second gap, and one kept only on disk is a preference
    // nobody honours.
    async fn list_roles(&self, ext: &RpcExtensions) -> RpcResult<Vec<RoleRoutingConfig>> {
        self.authorize(ext, "roles.list")?;
        let routings = self.state.role_routings.read().await;
        let mut configs: Vec<RoleRoutingConfig> = routings.values().cloned().collect();
        configs.sort_by(|left, right| left.role.cmp(&right.role));
        Ok(configs)
    }

    /// Route one role, or refuse the request and change nothing.
    ///
    /// Three things have to hold before the router is touched (audit H-01, H-07):
    ///
    /// - the role is one the pipeline knows, and every target names both a provider and
    ///   a model — an empty target resolves to nothing at the call, which is a slower
    ///   way of saying no;
    /// - every named provider is one the owner configured (or the daemon's own mock).
    ///   A routing to a name with no row behind it would be a routing that silently
    ///   never spends, and an owner who reads a `200` here is entitled to believe the
    ///   next call reaches that provider;
    /// - the settings write succeeds before the in-memory table is replaced, so a
    ///   refused write leaves the daemon routing exactly what it was routing.
    async fn set_role(&self, ext: &RpcExtensions, config: RoleRoutingConfig) -> RpcResult<()> {
        self.authorize(ext, "roles.set")?;
        let (role, routing) = routing_for(&config).map_err(rpc_error)?;
        // Normalised through the core routing, so what is stored is what was honoured:
        // a caller who sent `INTAKE` or a target with a trailing space gets the same
        // table back from `roles.list` as the router is running.
        let stored = routing_config(role, &routing);

        for target in &stored.targets {
            if target.provider_id == MOCK_PROVIDER_ID {
                continue;
            }
            let configured = self
                .state
                .settings
                .load_provider(&target.provider_id)
                .await
                .map_err(|error| rpc_error(error.to_string()))?;
            if configured.is_none() {
                return Err(rpc_policy_refused(format!(
                    "role {} names provider {}, which is not configured",
                    stored.role, target.provider_id
                )));
            }
        }

        // Order is the whole of the durability story: the table is written to the
        // daemon's settings *before* the router is told, so a settings write that fails
        // changes nothing at all — no live routing that a restart forgets, and no
        // stored routing the running daemon does not honour.
        let table = {
            let current = self.state.role_routings.read().await;
            let mut table: HashMap<Role, RoleRoutingConfig> = HashMap::clone(&current);
            table.insert(role, stored.clone());
            table
        };
        store_role_routings(&self.state.settings, &table)
            .await
            .map_err(|error| {
                rpc_error(format!(
                    "the routing for {} could not be stored, so nothing was changed: {error}",
                    stored.role
                ))
            })?;

        // The router holds the adapter a routing names by the time the routing exists,
        // because a provider added by `providers.add` registered its adapter then. The
        // agent role's per-run ceiling, when the owner named one, is installed against
        // the key agent turns are metered under: the router checks it before every
        // attempt, so the cap written here is the cap that stops a paid call (H-07).
        //
        // A routing that names no ceiling replaces the old one with a ceiling that cannot
        // be reached rather than leaving the previous cap in place: the router has no way
        // to forget a budget, and a silently retained cap is a setting the owner removed
        // and the daemon still enforces.
        {
            let mut router = self.state.providers.write().await;
            if role == AGENT_ROLE {
                let cents = stored.budget_cents_per_run.unwrap_or(u64::MAX);
                router.set_budget(AGENT_METER_KEY, cents);
            }
            router.set_role_routing(routing);
        }
        *self.state.role_routings.write().await = table;

        info!("role {} routed", stored.role);
        Ok(())
    }

    // Budget
    async fn show_budget(
        &self,
        ext: &RpcExtensions,
        project_id: ProjectId,
    ) -> RpcResult<BudgetStatus> {
        self.authorize(ext, "budget.show")?;
        let runs = self
            .state
            .store
            .list_runs(project_id)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;
        let run = runs
            .first()
            .ok_or_else(|| ErrorObject::owned(-32000, "No runs found for project", None::<()>))?;
        Ok(BudgetStatus {
            project_id,
            budget_cents: run.budget_cents,
            spent_cents: run.spent_cents,
            remaining_cents: run.budget_cents.map(|b| b.saturating_sub(run.spent_cents)),
        })
    }

    async fn set_budget(
        &self,
        ext: &RpcExtensions,
        project_id: ProjectId,
        cents: u64,
    ) -> RpcResult<()> {
        self.authorize(ext, "budget.set")?;
        let runs = self
            .state
            .store
            .list_runs(project_id)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;
        let mut run = runs
            .first()
            .cloned()
            .ok_or_else(|| ErrorObject::owned(-32000, "No runs found for project", None::<()>))?;
        run.budget_cents = Some(cents);
        self.state
            .store
            .update_run(&run)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    // Backend kit (PLAN.md M19)
    async fn export_backend(
        &self,
        ext: &RpcExtensions,
        run_id: String,
        output_dir: String,
    ) -> RpcResult<String> {
        self.authorize(ext, "backend.export")?;
        // The kit is the project's, not the run's: the stored row is keyed by
        // project id, so a second run of one project exports the same schema
        // instead of starting a second, empty one. It is loaded (the daemon's copy,
        // then the stored row, then the default) and re-remembered, so an export is
        // the write-through that would otherwise never happen for a kit that was
        // only read. The dump, the storage archive stem and the header all name the
        // project, not the run.
        let (key, project_name) = self.project_for_run(&run_id).await;
        let kit = self.backend_kit(&key, &project_name).await;
        self.remember_backend_kit(&key, &kit).await?;

        kit.export_to_dir(&output_dir)
            .map_err(|error| rpc_error(error.to_string()))
    }

    // Continue on server (PLAN.md M6a)
    async fn create_handoff(
        &self,
        ext: &RpcExtensions,
        run_id: String,
        files: Vec<(String, String)>,
    ) -> RpcResult<String> {
        self.authorize(ext, "handoff.create")?;
        let manager = HandoffManager::new();
        let captured: Vec<(&str, &str)> = files
            .iter()
            .map(|(path, content)| (path.as_str(), content.as_str()))
            .collect();
        let bundle = manager.create_bundle(&run_id, &captured);

        // Bundles live under the daemon's data directory, next to the store.
        let dir = self.state.config.data_dir.join(HANDOFF_DIR);
        let dir = dir.to_string_lossy().into_owned();
        manager
            .write_bundle(&bundle, &dir)
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn apply_handoff(
        &self,
        ext: &RpcExtensions,
        path: String,
        owner_wins: bool,
    ) -> RpcResult<String> {
        self.authorize(ext, "handoff.apply")?;
        let encoded = std::fs::read_to_string(&path).map_err(|e| {
            ErrorObject::owned(-32000, format!("could not read `{path}`: {e}"), None::<()>)
        })?;
        let bundle: HandoffBundle = serde_json::from_str(&encoded).map_err(|e| {
            ErrorObject::owned(
                -32000,
                format!("`{path}` is not a handoff bundle: {e}"),
                None::<()>,
            )
        })?;

        // RunId → Run → Project.repo_path is the tree the bundle is written into.
        let root = self
            .working_tree_for_run(&bundle.run_id)
            .await
            .ok_or_else(|| {
                ErrorObject::owned(
                    -32000,
                    format!("run `{}` has no project repo to apply into", bundle.run_id),
                    None::<()>,
                )
            })?;

        // The apply copies every file it overwrites into
        // `{working_tree}/.warsha-backup/{timestamp}/` and then writes the files,
        // so the returned summary names the conflicts and that backup directory.
        let result = HandoffManager::new()
            .apply_to_disk(&bundle, &root.to_string_lossy(), owner_wins)
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;

        serde_json::to_string(&result)
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    // Post-launch care (PLAN.md M17)
    async fn list_crash_reports(
        &self,
        ext: &RpcExtensions,
        run_id: String,
    ) -> RpcResult<Vec<CrashReport>> {
        self.authorize(ext, "postlaunch.crashes")?;
        let reports = self.state.crash_reports.read().await.list();
        let wanted = run_id.trim();
        // A blank run id asks for every report, which is what the crash screen
        // shows before a run is selected.
        Ok(if wanted.is_empty() {
            reports
        } else {
            reports
                .into_iter()
                .filter(|report| report.run_id == wanted)
                .collect()
        })
    }

    async fn list_store_reviews(
        &self,
        ext: &RpcExtensions,
        store: String,
    ) -> RpcResult<Vec<StoreReview>> {
        self.authorize(ext, "postlaunch.reviews")?;
        let reviews = self.state.store_reviews.read().await;
        let wanted = store.trim();
        Ok(if wanted.is_empty() {
            reviews.list()
        } else {
            reviews.list_by_store(wanted)
        })
    }

    // Agent workflow (PLAN.md M18, C2: the mode an owner approves is the mode that
    // spends, and both are the conversation the next daemon reads back).
    //
    // The three methods here share one rule from audit H-03: *who approved* is never a
    // value in the params. It is the device the transport authenticated, and a session
    // whose pairing names no device is refused instead of being recorded under a name
    // the daemon invented.
    /// Run one turn of the owner's conversation, and store what it changed.
    ///
    /// The turn is the only way a todo, an answer or a mode note is recorded over the
    /// wire, so the snapshot is taken while the loop's write lock is still held — the
    /// state that is stored is exactly the state that answered. A store that fails is
    /// warned about rather than turned into a refusal: the turn ran, and in Agent mode it
    /// may have spent; reporting an error after a call the owner asked for would be the
    /// worse answer. What the next restart reads is then the previous conversation, and
    /// `agent.turn` is still the one place that says so.
    async fn agent_turn(&self, ext: &RpcExtensions, input: String) -> RpcResult<AgentTurnResult> {
        self.authorize(ext, "agent.turn")?;
        // The turn parses, decides and compacts; in Agent mode it may also run one
        // tool or make one model call, so the write lock is held across that await.
        // Nothing else takes this lock mid-turn, so the ordering stays one turn at a
        // time — which is what keeps the todo list and the transcript coherent.
        let skills = self.active_skill_catalog().await;
        let (result, snapshot) = {
            let mut agent_loop = self.state.agent_loop.write().await;
            let result = agent_loop.run_turn(&input, &skills).await;
            (result, AgentLoopSnapshot::of(&agent_loop))
        };
        if let Err(error) = self.store_agent(&snapshot).await {
            warn!("the agent conversation could not be stored, so it continues from the last turn that was: {error}");
        }
        Ok(result)
    }

    /// Approve Agent mode for the session that asks.
    ///
    /// Plan mode is what `agent.turn` starts in, and the M18 rule is absolute: nothing
    /// edits a file or runs a tool until the owner approves. Until now the only caller
    /// that could approve was in-process, which meant Agent mode — the mode this daemon
    /// routes to a configured provider — was unreachable from the desktop. The approver
    /// recorded is the authenticated device, and a blank one is refused by the mode
    /// manager itself.
    async fn approve_agent_mode(&self, ext: &RpcExtensions) -> RpcResult<ModeTransition> {
        self.agent_switch(ext, AgentMode::Agent).await
    }

    /// Return the conversation to Plan mode.
    ///
    /// The read-only direction is always allowed, which is why an owner can end Agent
    /// mode without another approval — and why the daemon can be put back to a state
    /// that cannot edit or spend by any session that can reach it.
    async fn return_agent_to_plan(&self, ext: &RpcExtensions) -> RpcResult<ModeTransition> {
        self.agent_switch(ext, AgentMode::Plan).await
    }

    /// Report which mode the loop is in, and how it got there.
    async fn agent_state(&self, ext: &RpcExtensions) -> RpcResult<AgentState> {
        self.authorize(ext, "agent.state")?;
        let agent_loop = self.state.agent_loop.read().await;
        Ok(AgentState {
            mode: agent_loop.mode(),
            approvals: agent_loop.mode_manager.history.clone(),
            todos: agent_loop.todo_list.items.clone(),
            // The loop's router seam is wired by `build_agent_loop`, so this answers the
            // question the owner actually has: is there a model behind the next turn.
            model_wired: agent_loop.has_router(),
        })
    }

    // Process spawning and MCP transports (PLAN.md M20)
    async fn spawn_process(
        &self,
        ext: &RpcExtensions,
        command: String,
        args: Vec<String>,
        env: HashMap<String, String>,
    ) -> RpcResult<String> {
        self.authorize(ext, "process.spawn")?;
        // Audit H-05: the owner's authority over a process table is not handed to a
        // caller that merely holds a token. The program has to be one the daemon's own
        // configuration allows, and the environment cannot carry a variable that
        // changes what the program is — `PATH`, `LD_PRELOAD`, `NODE_OPTIONS` and the
        // rest are execution hijacks wearing a configuration's clothes.
        let policy = self.process_policy();
        policy.check_command(&command).map_err(rpc_policy_refused)?;
        for key in env.keys() {
            policy.check_env(key).map_err(rpc_policy_refused)?;
        }
        self.state
            .processes
            .spawn(&command, &args, &env)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn stop_process(&self, ext: &RpcExtensions, id: String) -> RpcResult<()> {
        self.authorize(ext, "process.stop")?;
        self.state
            .processes
            .stop(&id)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn process_status(&self, ext: &RpcExtensions, id: String) -> RpcResult<ProcessStatus> {
        self.authorize(ext, "process.status")?;
        self.state
            .processes
            .status(&id)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn list_processes(&self, ext: &RpcExtensions) -> RpcResult<Vec<ProcessSummary>> {
        self.authorize(ext, "process.list")?;
        // `list` hands back the record without its child handle; the summary is the
        // same facts in a type an RPC result (which must be clonable) can carry.
        Ok(self
            .state
            .processes
            .list()
            .await
            .iter()
            .map(ManagedProcess::summary)
            .collect())
    }

    async fn connect_mcp(
        &self,
        ext: &RpcExtensions,
        config: warsha_pipeline::mcp_transport::McpServerConfig,
    ) -> RpcResult<()> {
        self.authorize(ext, "mcp.connect")?;
        // Audit H-05: an MCP server is a child process or an outbound endpoint, so the
        // same policy that bounds `process.spawn` bounds the transports here. A stdio
        // server's program is checked as a program; an HTTP or WebSocket server's URL
        // is checked as a transport — TLS anywhere, plain http/ws only on loopback.
        let policy = self.process_policy();
        match &config.transport {
            warsha_pipeline::mcp_transport::McpTransport::Stdio => {
                let command = config.command.as_deref().ok_or_else(|| {
                    rpc_policy_refused("a stdio MCP server names no program to start")
                })?;
                policy.check_command(command).map_err(rpc_policy_refused)?;
            }
            transport => {
                let url = transport.url().ok_or_else(|| {
                    rpc_policy_refused("an MCP transport names no endpoint to reach")
                })?;
                policy
                    .check_transport_url(url)
                    .map_err(rpc_policy_refused)?;
            }
        }
        // An `Http`/`WebSocket` config succeeds without connecting: the transport
        // is recorded and `mcp.list` reports it as disconnected (see
        // `McpServerConfig::is_wired`).
        self.state
            .mcp
            .connect(config)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn disconnect_mcp(&self, ext: &RpcExtensions, name: String) -> RpcResult<()> {
        self.authorize(ext, "mcp.disconnect")?;
        self.state
            .mcp
            .disconnect(&name)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn list_mcp(&self, ext: &RpcExtensions) -> RpcResult<Vec<McpConnection>> {
        self.authorize(ext, "mcp.list")?;
        Ok(self.state.mcp.list().await)
    }

    async fn send_mcp(
        &self,
        ext: &RpcExtensions,
        name: String,
        payload: String,
    ) -> RpcResult<String> {
        self.authorize(ext, "mcp.send")?;
        self.state
            .mcp
            .send(&name, &payload)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn call_mcp(
        &self,
        ext: &RpcExtensions,
        name: String,
        tool: String,
        arguments: serde_json::Value,
    ) -> RpcResult<warsha_pipeline::mcp::McpToolResult> {
        self.authorize(ext, "mcp.call")?;
        self.state
            .mcp
            .call_tool(&name, &tool, arguments)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    // Live preview dev server (PLAN.md M5b + M20)
    async fn start_preview(
        &self,
        ext: &RpcExtensions,
        project_id: String,
        command: String,
    ) -> RpcResult<LivePreview> {
        self.authorize(ext, "preview.start")?;
        // The command line is split on whitespace by the pipeline (no shell), so
        // `npm run dev` runs `npm` with `run dev` and nothing else is interpreted.
        // The policy judges the program the pipeline will start, which is its first
        // word (audit H-05).
        let policy = self.process_policy();
        let program = command.split_whitespace().next().unwrap_or_default();
        policy.check_command(program).map_err(rpc_policy_refused)?;
        self.state
            .previews
            .start(&project_id, &command)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn stop_preview(&self, ext: &RpcExtensions, project_id: String) -> RpcResult<()> {
        self.authorize(ext, "preview.stop")?;
        self.state
            .previews
            .stop(&project_id)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn preview_status(
        &self,
        ext: &RpcExtensions,
        project_id: String,
    ) -> RpcResult<LivePreview> {
        self.authorize(ext, "preview.status")?;
        self.state
            .previews
            .status(&project_id)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    // Settings that survive a restart (PLAN.md M20)
    async fn list_run_modes(&self, ext: &RpcExtensions) -> RpcResult<Vec<RunModeConfig>> {
        self.authorize(ext, "runmode.list")?;
        // Mode order, not insertion order: the caller renders a switch, and a
        // switch whose rows move when one of them is saved is a switch that
        // reorders itself under the pointer.
        let modes = self.state.run_modes.read().await;
        Ok(RunMode::all()
            .into_iter()
            .filter_map(|mode| modes.get(&mode).cloned())
            .collect())
    }

    async fn set_run_mode(
        &self,
        ext: &RpcExtensions,
        config: RunModeConfig,
    ) -> RpcResult<RunModeConfig> {
        self.authorize(ext, "runmode.set")?;
        // The rule a daemon has to pass before it binds is applied before the
        // config is stored: a mode that cannot be served is not a setting.
        config
            .validate()
            .map_err(|error| rpc_error(error.to_string()))?;
        self.state
            .settings
            .save_run_mode(&config)
            .await
            .map_err(|error| rpc_error(error.to_string()))?;
        self.state
            .run_modes
            .write()
            .await
            .insert(config.mode, config.clone());
        Ok(config)
    }

    async fn get_backend(
        &self,
        ext: &RpcExtensions,
        run_id: String,
    ) -> RpcResult<Option<BackendKit>> {
        self.authorize(ext, "backend.get")?;
        let (key, _project_name) = self.project_for_run(&run_id).await;
        // A project that never exported has no stored row, and reporting the
        // default as if it were one would invent a kit the owner never reviewed.
        // A kit set in this life does count: the owner asked for exactly that one.
        if let Some(kit) = self.state.backend_kits.read().await.get(&key) {
            return Ok(Some(kit.clone()));
        }
        self.state
            .settings
            .load_backend_kit(&key)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn set_backend(
        &self,
        ext: &RpcExtensions,
        run_id: String,
        kit: BackendKit,
    ) -> RpcResult<()> {
        self.authorize(ext, "backend.set")?;
        let (key, _project_name) = self.project_for_run(&run_id).await;
        self.remember_backend_kit(&key, &kit).await
    }

    async fn list_preferences(
        &self,
        ext: &RpcExtensions,
        project_id: String,
    ) -> RpcResult<Vec<Preference>> {
        self.authorize(ext, "preferences.list")?;
        let preferences = self.state.stored_preferences.read().await;
        Ok(preferences
            .get(project_id.trim())
            .cloned()
            .unwrap_or_default())
    }

    async fn record_preference(
        &self,
        ext: &RpcExtensions,
        signal: PreferenceSignal,
    ) -> RpcResult<Vec<Preference>> {
        // A write on the read surface (re-audit N-8): the session's role decides whether
        // it may write, the tier is spent on the way in, and the actor is the verified one
        // rather than absent. The signal itself is unchanged on the wire.
        self.authorize(ext, "preferences.record")?;
        let project_id = signal.project_id.trim().to_string();
        {
            let mut store = self.state.preferences.write().await;
            // The clock is what the decay is measured against, and it is not the
            // wall clock of the store: without this a signal recorded by a
            // long-running daemon would be scored against the last write.
            store.advance_to(now_epoch_secs());
            store
                .record_signal(signal)
                .map_err(|error| rpc_error(error.to_string()))?;
        }

        // The rows are the projection, so they are written before they are
        // reported: what this returns is what a restart would load.
        let memory = self.state.preferences.read().await.clone();
        self.state
            .settings
            .save_preferences(memory)
            .await
            .map_err(|error| rpc_error(error.to_string()))?;
        let rows = self
            .state
            .settings
            .load_preferences(&project_id)
            .await
            .map_err(|error| rpc_error(error.to_string()))?;
        self.state
            .stored_preferences
            .write()
            .await
            .insert(project_id, rows.clone());
        Ok(rows)
    }

    async fn list_pairings(&self, ext: &RpcExtensions) -> RpcResult<Vec<PhonePairing>> {
        self.authorize(ext, "pairing.list")?;
        Ok(self.state.pairings.read().await.list())
    }

    async fn create_pairing(
        &self,
        ext: &RpcExtensions,
        device_id: String,
        secret: String,
    ) -> RpcResult<PhonePairing> {
        self.authorize(ext, "pairing.create")?;
        let pairing = {
            let mut pairings = self.state.pairings.write().await;
            pairings
                .create(&device_id, &secret, now_epoch_secs())
                .map_err(|error| rpc_error(error.to_string()))?
        };
        self.save_pairings().await?;
        Ok(pairing)
    }

    async fn revoke_pairing(
        &self,
        ext: &RpcExtensions,
        device_id: String,
    ) -> RpcResult<PhonePairing> {
        self.authorize(ext, "pairing.revoke")?;
        let pairing = {
            let mut pairings = self.state.pairings.write().await;
            pairings
                .revoke(&device_id)
                .map_err(|error| rpc_error(error.to_string()))?
        };
        self.save_pairings().await?;
        Ok(pairing)
    }

    async fn list_routines(&self, ext: &RpcExtensions) -> RpcResult<Vec<Routine>> {
        self.authorize(ext, "routines.list")?;
        let registry = self.state.routines.read().await;
        Ok(registry.list().into_iter().cloned().collect())
    }

    async fn get_routine(&self, ext: &RpcExtensions, id: String) -> RpcResult<Option<Routine>> {
        self.authorize(ext, "routines.get")?;
        let registry = self.state.routines.read().await;
        Ok(registry.get(&id).cloned())
    }

    async fn run_routine_now(&self, ext: &RpcExtensions, id: String) -> RpcResult<Routine> {
        self.authorize(ext, "routines.run_now")?;
        self.state
            .routine_scheduler
            .run_now(&id)
            .await
            .map_err(|error| rpc_error(error.to_string()))?;
        let registry = self.state.routines.read().await;
        registry
            .get(&id)
            .cloned()
            .ok_or_else(|| rpc_error(format!("routine {id} not found")))
    }

    async fn pause_routine(&self, ext: &RpcExtensions, id: String) -> RpcResult<Routine> {
        self.authorize(ext, "routines.pause")?;
        self.state
            .routine_scheduler
            .pause(&id)
            .await
            .map_err(|error| rpc_error(error.to_string()))?;
        let registry = self.state.routines.read().await;
        registry
            .get(&id)
            .cloned()
            .ok_or_else(|| rpc_error(format!("routine {id} not found")))
    }

    async fn resume_routine(&self, ext: &RpcExtensions, id: String) -> RpcResult<Routine> {
        self.authorize(ext, "routines.resume")?;
        self.state
            .routine_scheduler
            .resume(&id)
            .await
            .map_err(|error| rpc_error(error.to_string()))?;
        let registry = self.state.routines.read().await;
        registry
            .get(&id)
            .cloned()
            .ok_or_else(|| rpc_error(format!("routine {id} not found")))
    }

    async fn subscribe_run(
        &self,
        ext: &RpcExtensions,
        run_id: Option<RunId>,
        since_seq: Option<u64>,
    ) -> RpcResult<RunStreamSync> {
        self.authorize(ext, "runs.subscribe")?;
        // No cursor means "start from where the stream is now", so nothing is replayed;
        // `0` means "everything the ring still holds".
        let sync = self.state.events.sync(since_seq.unwrap_or(0), run_id).await;
        let run = match run_id {
            Some(id) => self.state.store.get_run(id).await.ok(),
            None => None,
        };
        Ok(RunStreamSync {
            seq: sync.current_seq,
            gap_detected: sync.gap_detected,
            resync_required: sync.resync_required,
            dropped_count: sync.dropped_count,
            run,
            events: sync.frames,
        })
    }

    async fn advance_run(&self, ext: &RpcExtensions, run_id: RunId) -> RpcResult<Run> {
        self.authorize(ext, "runs.advance")?;
        // No mock routing is seeded here: W5's pipeline dispatch answers an unrouted
        // role with the deterministic `FakeProvider` (or the env-configured model), so
        // a fresh daemon with no provider still advances a run offline with rich stage
        // artifacts. `advance_to_next_gate` walks the run to the next undecided gate
        // (passing approved ones) and marks a run that reaches `Feedback` completed.
        let run = self
            .state
            .pipeline
            .advance_to_next_gate(run_id)
            .await
            .map_err(rpc_error)?;

        // Record factory context on advance (F2)
        if let Ok(active_harness) = self
            .state
            .settings
            .get_active_harness(&run.project_id.to_string())
            .await
        {
            let harness_id = active_harness.unwrap_or_else(|| "autonomous-factory".to_string());
            let enabled_skills: Vec<String> = self
                .state
                .settings
                .list_skills()
                .await
                .unwrap_or_default()
                .into_iter()
                .filter(|s| s.enabled)
                .map(|s| s.id)
                .collect();
            let enabled_plugins: Vec<String> = self
                .state
                .settings
                .list_plugins()
                .await
                .unwrap_or_default()
                .into_iter()
                .filter(|p| p.enabled)
                .map(|p| p.id)
                .collect();

            tracing::info!(
                target: "audit",
                run_id = %run.id.0,
                stage = ?run.current_stage,
                harness = %harness_id,
                skills = ?enabled_skills,
                plugins = ?enabled_plugins,
                "run advance audit context"
            );
        }

        Ok(run)
    }

    async fn cancel_run(
        &self,
        ext: &RpcExtensions,
        run_id: RunId,
        reason: Option<String>,
    ) -> RpcResult<Run> {
        self.authorize(ext, "runs.cancel")?;
        let mut run = self.state.store.get_run(run_id).await.map_err(rpc_error)?;
        let reason = reason.unwrap_or_else(|| "Cancelled by user".to_string());
        run.status = RunStatus::Cancelled;
        run.updated_at = Utc::now();
        self.state.store.update_run(&run).await.map_err(rpc_error)?;
        // `warsha_core::EventKind` has no cancellation/stage-failed variant and that
        // crate is outside this change's ownership, so `Error` carries it; the payload
        // names the action so a viewer never has to infer it from the kind.
        let event = Event {
            id: ulid::Ulid::new(),
            run_id,
            stage: run.current_stage,
            role: None,
            kind: EventKind::Error,
            payload: serde_json::json!({ "action": "run_cancelled", "reason": reason }),
            cost_cents: None,
            tokens: None,
            created_at: Utc::now(),
            device_id: None,
        };
        self.state
            .store
            .append_event(&event)
            .await
            .map_err(rpc_error)?;
        Ok(run)
    }

    async fn followup_run(
        &self,
        ext: &RpcExtensions,
        run_id: RunId,
        prompt: String,
    ) -> RpcResult<Run> {
        self.authorize(ext, "runs.followup")?;
        if prompt.trim().is_empty() {
            return Err(ErrorObject::owned(
                -32602,
                "runs.followup needs a non-empty prompt",
                None::<()>,
            ));
        }
        let mut run = self.state.store.get_run(run_id).await.map_err(rpc_error)?;
        let trimmed = prompt.trim();
        let content = format!(
            "Follow-up applied at stage {:?}: {}",
            run.current_stage, trimmed
        );
        let now = Utc::now();
        run.updated_at = now;
        // Store first, then the run's own artifact map: the write is the durable record,
        // and `run.artifacts` is what `runs.get` and `runs.artifacts` report from.
        self.state
            .store
            .write_artifact(run.project_id, "followup", &content)
            .await
            .map_err(rpc_error)?;
        run.artifacts.insert(
            "followup".to_string(),
            Artifact {
                name: "followup".to_string(),
                content: content.clone(),
                stage: run.current_stage,
                role: None,
                created_at: now,
                updated_at: now,
                version: 1,
            },
        );
        self.state.store.update_run(&run).await.map_err(rpc_error)?;
        let event = Event {
            id: ulid::Ulid::new(),
            run_id,
            stage: run.current_stage,
            role: None,
            kind: EventKind::AgentStep,
            payload: serde_json::json!({
                "action": "followup",
                "prompt": trimmed,
                "response": content,
            }),
            cost_cents: None,
            tokens: None,
            created_at: now,
            device_id: None,
        };
        self.state
            .store
            .append_event(&event)
            .await
            .map_err(rpc_error)?;
        Ok(run)
    }

    async fn list_run_artifacts(
        &self,
        ext: &RpcExtensions,
        run_id: RunId,
    ) -> RpcResult<Vec<Artifact>> {
        self.authorize(ext, "runs.artifacts")?;
        let run = self.state.store.get_run(run_id).await.map_err(rpc_error)?;
        let mut artifacts: Vec<Artifact> = run.artifacts.values().cloned().collect();
        artifacts.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(artifacts)
    }

    // ============================================== Wave 2 (harnesses, skills,
    // plugins, custom models, integrations, files)
    //
    // Six surfaces, one shape of method: `authorize` first, then read or write the
    // [`SettingsStore`] row, then answer with the record the *stored* row decodes to.
    // That last half is the rule the whole batch follows — a method never returns the
    // value the caller handed it if the store would have kept something else, so a
    // reply is a promise a restart can check. Secret material is the exception by
    // design: it is filed in the OS keychain and the row keeps a reference, so a
    // reply carries the reference and never the value.
    //
    // Refusals split the same way everywhere: `-32602` when the caller's document or
    // path is what is wrong, `-32000` when the daemon's own store, keychain or
    // filesystem failed.

    async fn list_harnesses(&self, ext: &RpcExtensions) -> RpcResult<Vec<HarnessDefinition>> {
        self.authorize(ext, "harness.list")?;
        let active_id = self
            .state
            .settings
            .get_active_harness(ACTIVE_HARNESS_GLOBAL_KEY)
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| "autonomous-factory".to_string());
        let rows = self
            .state
            .settings
            .list_harnesses()
            .await
            .map_err(rpc_error)?;
        Ok(rows
            .iter()
            .map(|row| {
                let mut def = wave2::harness_definition(row);
                def.active = def.id == active_id;
                def
            })
            .collect())
    }

    async fn get_harness(&self, ext: &RpcExtensions, id: String) -> RpcResult<HarnessDefinition> {
        self.authorize(ext, "harness.get")?;
        let active_id = self
            .state
            .settings
            .get_active_harness(ACTIVE_HARNESS_GLOBAL_KEY)
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| "autonomous-factory".to_string());
        let mut def = wave2::harness_definition(&self.stored_harness(&id).await?);
        def.active = def.id == active_id;
        Ok(def)
    }

    async fn import_harness(
        &self,
        ext: &RpcExtensions,
        content: String,
        format: Option<String>,
    ) -> RpcResult<HarnessDefinition> {
        self.authorize(ext, "harness.import")?;
        let definition =
            wave2::parse_harness_import(&content, format.as_deref()).map_err(rpc_invalid_params)?;
        let row = wave2::harness_row(&definition).map_err(rpc_error)?;
        self.state
            .settings
            .save_harness(&row)
            .await
            .map_err(rpc_error)?;
        let active_id = self
            .state
            .settings
            .get_active_harness(ACTIVE_HARNESS_GLOBAL_KEY)
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| "autonomous-factory".to_string());
        let mut def = wave2::harness_definition(&self.stored_harness(&row.id).await?);
        def.active = def.id == active_id;
        Ok(def)
    }

    /// Point a project — or, with no project, the daemon as a whole — at a harness.
    ///
    /// The selection is stored under the project id, and `global` is the key an
    /// unprojected run reads, so a browser that has not picked a project yet can
    /// still set the default its first run will use. Selecting a name that is not
    /// installed is refused here rather than at the first gate: a run that starts
    /// against a harness nobody has would fail in the middle of spending, and the
    /// owner would learn about it from a pipeline rather than from a settings screen.
    async fn select_harness(
        &self,
        ext: &RpcExtensions,
        harness_id: String,
        project_id: Option<String>,
    ) -> RpcResult<()> {
        self.authorize(ext, "harness.select")?;
        self.stored_harness(&harness_id).await?;
        let key = project_id
            .as_deref()
            .map(str::trim)
            .filter(|project| !project.is_empty())
            .unwrap_or(ACTIVE_HARNESS_GLOBAL_KEY);
        self.state
            .settings
            .set_active_harness(key, &harness_id)
            .await
            .map_err(rpc_error)
    }

    /// Remove a user-authored harness.
    ///
    /// A bundled preset is refused: the seed at daemon start would write it back, and
    /// a delete that quietly undoes itself at the next restart is a worse answer than
    /// one that says which rows it cannot remove. The `global` selection is cleared
    /// when it named the harness being removed, because that is the one key this
    /// method can read; per-project selections are left alone (the store has no way to
    /// enumerate them) and `harness.get` is what tells a run that its selection is
    /// gone.
    async fn delete_harness(&self, ext: &RpcExtensions, id: String) -> RpcResult<()> {
        self.authorize(ext, "harness.delete")?;
        let stored = self.stored_harness(&id).await?;
        if stored.is_preset {
            return Err(rpc_invalid_params(format!(
                "`{id}` is a bundled harness; harness.delete removes the ones you imported, \
                 and a preset returns at the next start because the daemon ships it"
            )));
        }
        self.state
            .settings
            .delete_harness(&id)
            .await
            .map_err(rpc_error)?;
        if self
            .state
            .settings
            .get_active_harness(ACTIVE_HARNESS_GLOBAL_KEY)
            .await
            .ok()
            .flatten()
            .as_deref()
            == Some(id.as_str())
        {
            self.state
                .settings
                .clear_active_harness(ACTIVE_HARNESS_GLOBAL_KEY)
                .await
                .map_err(rpc_error)?;
        }
        Ok(())
    }

    /// The installed skills, in the shape the owner manages them in.
    ///
    /// Every row, enabled or not: a screen that could only see the enabled ones could
    /// not switch one back on. `skill_catalog()` remains the in-process registry the
    /// agent loop runs, built from exactly these rows with the disabled ones dropped.
    async fn list_skills(&self, ext: &RpcExtensions) -> RpcResult<Vec<SkillDefinition>> {
        self.authorize(ext, "skills.list")?;
        let rows = self.state.settings.list_skills().await.map_err(rpc_error)?;
        Ok(rows.iter().map(wave2::skill_definition).collect())
    }

    async fn import_skill(
        &self,
        ext: &RpcExtensions,
        url_or_content: String,
        name: Option<String>,
    ) -> RpcResult<SkillDefinition> {
        self.authorize(ext, "skills.import")?;
        let definition = wave2::parse_skill_import(&url_or_content, name.as_deref())
            .map_err(rpc_invalid_params)?;
        let row = wave2::skill_row(&definition).map_err(rpc_error)?;
        self.state
            .settings
            .save_skill(&row)
            .await
            .map_err(rpc_error)?;
        let stored = self
            .state
            .settings
            .get_skill(&row.id)
            .await
            .map_err(rpc_error)?
            .ok_or_else(|| {
                rpc_error(format!(
                    "the skill `{}` was not in the store after saving",
                    row.id
                ))
            })?;
        Ok(wave2::skill_definition(&stored))
    }

    /// Set one skill's flag to the value the caller named.
    ///
    /// The store's `toggle_skill` *flips*, which is what a keyboard shortcut wants and
    /// is not what an `enabled: bool` parameter is: flipping a skill that is already
    /// in the requested state would switch it off. So the row is read, and flipped only
    /// when the flip is the change asked for.
    async fn toggle_skill(
        &self,
        ext: &RpcExtensions,
        id: String,
        enabled: bool,
    ) -> RpcResult<SkillDefinition> {
        self.authorize(ext, "skills.toggle")?;
        let row = self.stored_skill(&id).await?;
        if row.enabled != enabled {
            self.state
                .settings
                .toggle_skill(&id)
                .await
                .map_err(rpc_error)?;
        }
        let stored = self
            .state
            .settings
            .get_skill(&id)
            .await
            .map_err(rpc_error)?
            .ok_or_else(|| {
                rpc_error(format!(
                    "the skill `{id}` vanished while it was being enabled"
                ))
            })?;
        Ok(wave2::skill_definition(&stored))
    }

    async fn delete_skill(&self, ext: &RpcExtensions, id: String) -> RpcResult<()> {
        self.authorize(ext, "skills.delete")?;
        self.stored_skill(&id).await?;
        self.state
            .settings
            .delete_skill(&id)
            .await
            .map_err(rpc_error)?;
        Ok(())
    }

    async fn list_plugins(&self, ext: &RpcExtensions) -> RpcResult<Vec<PluginDefinition>> {
        self.authorize(ext, "plugins.list")?;
        let rows = self
            .state
            .settings
            .list_plugins()
            .await
            .map_err(rpc_error)?;
        Ok(rows.iter().map(wave2::plugin_definition).collect())
    }

    async fn install_plugin(
        &self,
        ext: &RpcExtensions,
        manifest_json_or_url: String,
    ) -> RpcResult<PluginDefinition> {
        self.authorize(ext, "plugins.install")?;
        let mut definition =
            wave2::parse_plugin_manifest(&manifest_json_or_url).map_err(rpc_invalid_params)?;
        // A manifest may name a token outright, and this is the seam that decides
        // where it lives: the keychain holds the value, the row holds the reference.
        let env = self
            .file_plugin_env(&definition.id, &definition.env)
            .await?;
        definition.env = env;
        let row = wave2::plugin_row(&definition).map_err(rpc_error)?;
        self.state
            .settings
            .save_plugin(&row)
            .await
            .map_err(rpc_error)?;
        let stored = self
            .state
            .settings
            .get_plugin(&row.id)
            .await
            .map_err(rpc_error)?
            .ok_or_else(|| {
                rpc_error(format!(
                    "the plugin `{}` was not in the store after saving",
                    row.id
                ))
            })?;
        Ok(wave2::plugin_definition(&stored))
    }

    async fn toggle_plugin(
        &self,
        ext: &RpcExtensions,
        id: String,
        enabled: bool,
    ) -> RpcResult<PluginDefinition> {
        self.authorize(ext, "plugins.toggle")?;
        let row = self.stored_plugin(&id).await?;
        if row.enabled != enabled {
            self.state
                .settings
                .toggle_plugin(&id)
                .await
                .map_err(rpc_error)?;
        }
        let updated = self.stored_plugin(&id).await?;
        let def = wave2::plugin_definition(&updated);
        // Sync with MCP manager (F2)
        if enabled {
            if let Some(cmd) = &def.command {
                if !cmd.trim().is_empty() {
                    let mcp_cfg = warsha_pipeline::mcp_transport::McpServerConfig::new_stdio(
                        &def.id,
                        cmd,
                        def.args.clone(),
                    );
                    let _ = self.state.mcp.connect(mcp_cfg).await;
                }
            }
        } else {
            let _ = self.state.mcp.disconnect(&def.id).await;
        }
        Ok(def)
    }

    /// Replace a pack's environment map, filing anything secret in the keychain.
    ///
    /// The map the caller sends is the whole map, not a patch: a key that was there
    /// and is not named now is gone from the row, and the keychain entry beside it is
    /// left for the next `configure` of that key to overwrite — a remove of an entry
    /// this method cannot see the owner asking for would be a delete nobody requested.
    async fn configure_plugin(
        &self,
        ext: &RpcExtensions,
        id: String,
        env: HashMap<String, String>,
    ) -> RpcResult<PluginDefinition> {
        self.authorize(ext, "plugins.configure")?;
        let mut row = self.stored_plugin(&id).await?;
        let references = self.file_plugin_env(&id, &env).await?;
        row.env_json = serde_json::to_string(&references).map_err(rpc_error)?;
        self.state
            .settings
            .save_plugin(&row)
            .await
            .map_err(rpc_error)?;
        let updated = self.stored_plugin(&id).await?;
        let def = wave2::plugin_definition(&updated);
        // Sync with MCP manager if enabled (F2)
        if def.enabled {
            if let Some(cmd) = &def.command {
                if !cmd.trim().is_empty() {
                    let mcp_cfg = warsha_pipeline::mcp_transport::McpServerConfig::new_stdio(
                        &def.id,
                        cmd,
                        def.args.clone(),
                    );
                    let _ = self.state.mcp.connect(mcp_cfg).await;
                }
            }
        }
        Ok(def)
    }

    async fn remove_plugin(&self, ext: &RpcExtensions, id: String) -> RpcResult<()> {
        self.authorize(ext, "plugins.remove")?;
        let row = self.stored_plugin(&id).await?;
        // Keychain first, exactly as `providers.remove` does it: a row deleted while
        // its secrets stayed behind would be an address nothing could reach again.
        for account in wave2::filed_secret_accounts(&wave2::plugin_definition(&row).env) {
            self.state.secrets.delete(&account).await.map_err(|error| {
                rpc_error(format!(
                    "the secret `{account}` could not be removed from the OS keychain: {error}"
                ))
            })?;
        }
        self.state
            .settings
            .delete_plugin(&id)
            .await
            .map_err(rpc_error)?;
        Ok(())
    }

    async fn list_custom_models(
        &self,
        ext: &RpcExtensions,
        provider: Option<String>,
    ) -> RpcResult<Vec<CustomModelRecord>> {
        self.authorize(ext, "models.list")?;
        let rows = self
            .state
            .settings
            .list_custom_models()
            .await
            .map_err(rpc_error)?;
        let wanted = provider
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string);
        Ok(rows
            .iter()
            .map(wave2::custom_model_record)
            .filter(|record| match &wanted {
                Some(name) => &record.provider == name,
                None => true,
            })
            .collect())
    }

    /// Register one model by hand under one provider.
    ///
    /// The pair `(provider, model_id)` is the key, so this is an upsert: the second
    /// call with the same pair is the owner correcting a label or a window, not a
    /// second row. The provider does not have to be configured yet — an owner who
    /// knows the model id they want can write it down before the key arrives, and
    /// routing is what fails later, honestly, with its own refusal.
    async fn add_custom_model(
        &self,
        ext: &RpcExtensions,
        provider: String,
        model_id: String,
        display_name: Option<String>,
        context_window: Option<u32>,
    ) -> RpcResult<CustomModelRecord> {
        self.authorize(ext, "models.add")?;
        if provider.trim().is_empty() || model_id.trim().is_empty() {
            return Err(rpc_invalid_params(
                "models.add needs both a provider and a model id: the pair is the row's key",
            ));
        }
        let record = CustomModelRecord {
            provider: provider.trim().to_string(),
            model_id: model_id.trim().to_string(),
            display_name: display_name
                .map(|name| name.trim().to_string())
                .filter(|name| !name.is_empty()),
            context_window,
            enabled: true,
        };
        self.state
            .settings
            .save_custom_model(&wave2::custom_model_row(&record))
            .await
            .map_err(rpc_error)?;
        let stored = self
            .state
            .settings
            .get_custom_model(&record.provider, &record.model_id)
            .await
            .map_err(rpc_error)?
            .ok_or_else(|| rpc_error("the custom model was not in the store after saving"))?;
        Ok(wave2::custom_model_record(&stored))
    }

    async fn remove_custom_model(
        &self,
        ext: &RpcExtensions,
        provider: String,
        model_id: String,
    ) -> RpcResult<()> {
        self.authorize(ext, "models.remove")?;
        self.state
            .settings
            .delete_custom_model(&provider, &model_id)
            .await
            .map_err(rpc_error)?;
        Ok(())
    }

    async fn list_integrations(&self, ext: &RpcExtensions) -> RpcResult<Vec<IntegrationStatus>> {
        self.authorize(ext, "integrations.list")?;
        self.integration_statuses().await
    }

    /// Connect one external service.
    ///
    /// The token halves of the config ride the write once and are then gone from the
    /// daemon's view of the row: they are filed under `integration:{id}` and
    /// `integration:{id}:bot`, and what the settings database keeps is the non-secret
    /// half. `connected` therefore means "this daemon holds a credential or a webhook
    /// for it", which is the strongest claim a daemon that has not opened a socket can
    /// honestly make.
    async fn connect_integration(
        &self,
        ext: &RpcExtensions,
        id: String,
        config: IntegrationConfig,
    ) -> RpcResult<IntegrationStatus> {
        self.authorize(ext, "integrations.connect")?;
        let id = id.trim().to_string();
        if id.is_empty() {
            return Err(rpc_invalid_params(
                "integrations.connect needs an integration id to file the configuration under",
            ));
        }
        let token_account = wave2::integration_secret_account(&id);
        let bot_account = wave2::integration_bot_secret_account(&id);
        match config
            .token
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
        {
            Some(token) => self
                .state
                .secrets
                .store(&token_account, token)
                .await
                .map_err(|e| {
                    rpc_error(format!(
                        "the token could not be stored in the OS keychain: {e}"
                    ))
                })?,
            None => self
                .state
                .secrets
                .delete(&token_account)
                .await
                .map_err(|e| rpc_error(format!("the stale token could not be removed: {e}")))?,
        }
        match config
            .bot_token
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
        {
            Some(bot_token) => self
                .state
                .secrets
                .store(&bot_account, bot_token)
                .await
                .map_err(|e| {
                    rpc_error(format!(
                        "the bot token could not be stored in the OS keychain: {e}"
                    ))
                })?,
            None => {
                self.state.secrets.delete(&bot_account).await.map_err(|e| {
                    rpc_error(format!("the stale bot token could not be removed: {e}"))
                })?
            }
        }

        let stored_token = config
            .token
            .as_deref()
            .map(str::trim)
            .is_some_and(|t| !t.is_empty());
        let stored_bot = config
            .bot_token
            .as_deref()
            .map(str::trim)
            .is_some_and(|t| !t.is_empty());
        let webhook = config
            .webhook_url
            .as_deref()
            .map(str::trim)
            .is_some_and(|url| !url.is_empty());
        let redacted = wave2::redact_config(&config);
        let name = match self
            .state
            .settings
            .get_integration(&id)
            .await
            .map_err(rpc_error)?
        {
            Some(row) if !row.name.trim().is_empty() => row.name,
            _ => wave2::integration_name(&id),
        };
        let row = wave2::integration_row(
            &id,
            &name,
            stored_token || stored_bot || webhook,
            &redacted,
            Some(now_epoch_secs()),
        )
        .map_err(rpc_error)?;
        self.state
            .settings
            .save_integration(&row, Some(&row.config_json))
            .await
            .map_err(rpc_error)?;
        self.integration_status_of(&id).await
    }

    /// Disconnect one service: the credentials go, the shape stays.
    ///
    /// The workspace, channel and webhook the owner typed are kept so a re-connect is
    /// one token away rather than a form refilled, and `connected` is written false
    /// because the daemon no longer holds anything to connect with.
    async fn disconnect_integration(
        &self,
        ext: &RpcExtensions,
        id: String,
    ) -> RpcResult<IntegrationStatus> {
        self.authorize(ext, "integrations.disconnect")?;
        let row = self.stored_integration(&id).await?;
        for account in [
            wave2::integration_secret_account(&row.id),
            wave2::integration_bot_secret_account(&row.id),
        ] {
            self.state.secrets.delete(&account).await.map_err(|e| {
                rpc_error(format!(
                    "the credential could not be removed from the OS keychain: {e}"
                ))
            })?;
        }
        let disconnected = wave2::integration_row(
            &row.id,
            &row.name,
            false,
            &wave2::integration_config(&row),
            row.configured_at,
        )
        .map_err(rpc_error)?;
        self.state
            .settings
            .save_integration(&disconnected, Some(&disconnected.config_json))
            .await
            .map_err(rpc_error)?;
        self.integration_status_of(&row.id).await
    }

    /// Report what a daemon that opens no socket can know about an integration.
    ///
    /// This is the one method under the Spend tier, and the reason it does not spend:
    /// a check that reached GitHub or Slack would be the daemon using an owner's quota
    /// on their behalf, and this batch's rule is that no RPC quietly goes to a third
    /// party. So `ok` means "the configuration is complete and filed" and `unconfigured`
    /// names the half that is missing — and neither word claims a connection was made.
    /// A future live probe is a separate decision with its own budget, not a detail of
    /// this method.
    async fn test_integration(
        &self,
        ext: &RpcExtensions,
        id: String,
    ) -> RpcResult<IntegrationTestResult> {
        self.authorize(ext, "integrations.test")?;
        let row = self.stored_integration(&id).await?;
        let config = wave2::integration_config(&row);
        let has_token = self
            .state
            .secrets
            .load(&wave2::integration_secret_account(&row.id))
            .await
            .is_ok();
        let has_bot_token = self
            .state
            .secrets
            .load(&wave2::integration_bot_secret_account(&row.id))
            .await
            .is_ok();
        let has_webhook = config
            .webhook_url
            .as_ref()
            .map(|url| !url.trim().is_empty())
            .unwrap_or(false);
        let missing: Vec<&str> = match row.id.as_str() {
            "github" => {
                if !has_token {
                    vec!["an access token"]
                } else {
                    Vec::new()
                }
            }
            "slack" => {
                if !has_webhook && !has_bot_token {
                    vec!["a webhook URL or bot token"]
                } else {
                    Vec::new()
                }
            }
            _ => {
                if !has_token && !has_webhook && !has_bot_token {
                    vec!["an access token, webhook URL, or bot token"]
                } else {
                    Vec::new()
                }
            }
        };
        Ok(IntegrationTestResult {
            status: if missing.is_empty() {
                "ok".to_string()
            } else {
                "unconfigured".to_string()
            },
            message: if missing.is_empty() {
                format!(
                    "`{}` is configured and its credential is filed in the OS keychain; \
                     no live request was made, so this says nothing about the service",
                    row.id
                )
            } else {
                format!(
                    "`{}` is missing {}: integrations.connect writes the configuration, \
                     and no live request is made from here",
                    row.id,
                    missing.join(" or ")
                )
            },
        })
    }

    async fn list_project_files(
        &self,
        ext: &RpcExtensions,
        project_id: String,
        path: Option<String>,
    ) -> RpcResult<Vec<FileEntry>> {
        self.authorize(ext, "files.tree")?;
        let root = self.project_files_root(&project_id).await;
        let dir = match path.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
            Some(relative) => {
                let joined = wave2::safe_join(&root, relative).map_err(rpc_invalid_params)?;
                wave2::resolve_inside(&root, &joined).map_err(rpc_invalid_params)?
            }
            None => root.clone(),
        };
        wave2::list_tree(&root, &dir).map_err(rpc_error)
    }

    async fn read_project_file(
        &self,
        ext: &RpcExtensions,
        project_id: String,
        path: String,
    ) -> RpcResult<FileContent> {
        self.authorize(ext, "files.read")?;
        let root = self.project_files_root(&project_id).await;
        let joined = wave2::safe_join(&root, &path).map_err(rpc_invalid_params)?;
        let file = wave2::resolve_inside(&root, &joined).map_err(rpc_invalid_params)?;
        wave2::read_text(&root, &file).map_err(rpc_error)
    }
}

/// A caller's document, path or name is what is wrong: JSON-RPC's own
/// "invalid params", the same code `runs.followup` uses for an empty prompt.
///
/// Wave 2 answers with it whenever the refusal is about what the caller sent — an
/// unparseable manifest, a `..` in a path, a delete of a row that is not there — so a
/// client can tell "you sent that wrong" from "my store failed" without reading prose.
fn rpc_invalid_params(message: impl Into<String>) -> ErrorObjectOwned {
    ErrorObject::owned(-32602, message.into(), None::<()>)
}

/// One JSON-RPC error object for every failure these methods can return.
///
/// `-32000` is the daemon's existing "server error" code; the message is the
/// `thiserror` rendering, which names the process, server or project involved.
fn rpc_error(message: impl std::fmt::Display) -> ErrorObjectOwned {
    ErrorObject::owned(-32000, message.to_string(), None::<()>)
}

/// The caller has no verified session: the transport could not say who it was.
fn rpc_unauthenticated(message: impl Into<String>) -> ErrorObjectOwned {
    ErrorObject::owned(auth::rpc_codes::UNAUTHENTICATED, message.into(), None::<()>)
}

/// The caller is verified and not allowed: audit H-04's method-level refusal.
fn rpc_forbidden(message: impl Into<String>) -> ErrorObjectOwned {
    ErrorObject::owned(auth::rpc_codes::FORBIDDEN, message.into(), None::<()>)
}

/// The caller named an identity that is not the one it authenticated as (audit H-03).
fn rpc_identity_mismatch(message: impl Into<String>) -> ErrorObjectOwned {
    ErrorObject::owned(
        auth::rpc_codes::IDENTITY_MISMATCH,
        message.into(),
        None::<()>,
    )
}

/// The caller passed a ceiling — the RPC form of HTTP 429, carrying the wait so a
/// client can honour it (audit H-01).
fn rpc_rate_limited(retry_after_secs: u64) -> ErrorObjectOwned {
    ErrorObject::owned(
        auth::rpc_codes::RATE_LIMITED,
        format!("rate limited: retry after {retry_after_secs}s"),
        Some(serde_json::json!({ "retry_after_secs": retry_after_secs })),
    )
}

/// A command or transport the daemon will not start (audit H-05).
fn rpc_policy_refused(message: impl Into<String>) -> ErrorObjectOwned {
    ErrorObject::owned(auth::rpc_codes::POLICY_REFUSED, message.into(), None::<()>)
}

/// The slash commands `skills.list` reports: `/review`, `/refactor`, `/test`,
/// `/fix`, `/explain`, in the order the composer should offer them.
///
/// This is the hardcoded catalog the M18 wiring starts from. M11's skill loader
/// (`skills.rs`) and `factory/skills.lock` are what would fill the registry from a
/// project's installed skills; until that wiring exists, the RPC reports these
/// five and nothing here reads a directory or a lockfile.
const SKILL_CATALOG: &[(&str, &str)] = &[
    ("review", "Review the current diff and report problems"),
    (
        "refactor",
        "Restructure the code without changing behaviour",
    ),
    ("test", "Write or run the tests for the current change"),
    ("fix", "Repair the failing check, test or build"),
    ("explain", "Explain what a file or a change does"),
];

/// The catalog as a list, built through the registry so the RPC serves exactly
/// what [`SlashCommandRegistry::register`] accepts.
///
/// A refusal cannot happen with the constants above (no blank name, no whitespace,
/// no duplicate), and an entry that somehow failed would simply not be listed
/// rather than failing the RPC.
#[allow(dead_code)]
fn skill_catalog() -> Vec<SlashCommand> {
    let mut registry = SlashCommandRegistry::new();
    for (name, description) in SKILL_CATALOG {
        let _ = registry.register(SlashCommand::new(*name, *description));
    }
    registry.skills()
}

/// Directory under the daemon's data directory that holds handoff bundles.
const HANDOFF_DIR: &str = "handoff";

/// The selection key a harness carries when no project was named.
///
/// `harnesses_active` is keyed by a text id and every other caller in this module uses
/// a project's UUID; `global` is the one key that cannot collide with a UUID, so the
/// daemon-wide default and a project's override live in the same table without either
/// pretending to be the other. A project id that a caller *does* pass is used verbatim
/// as its key, which is what `harness.select` from a browser and a run's own project
/// both read.
const ACTIVE_HARNESS_GLOBAL_KEY: &str = "global";

/// The local PocketBase address PLAN.md M19 documents for a generated project.
const LOCAL_POCKETBASE_URL: &str = "http://127.0.0.1:8090";

/// The backend kit a project starts from until it exports or sets one of its own.
///
/// PocketBase is the PLAN's preferred backend, and the project name is what the
/// export header and the storage archive stem are made of.
fn default_backend_kit(project_name: &str) -> BackendKit {
    BackendKit::from_project(project_name, LOCAL_POCKETBASE_URL, BackendKind::PocketBase)
}

/// Every project id in the store, as the strings the settings rows are keyed by.
///
/// The `ProjectId`'s display form is the UUID the RPCs and the settings columns
/// both use, which is what makes one key meaningful in both places.
async fn project_ids(store: &Store) -> Result<Vec<String>> {
    Ok(store
        .list_projects()
        .await?
        .into_iter()
        .map(|project| project.id.to_string())
        .collect())
}

/// Every run mode: the stored config where the owner saved one, the mode's
/// default where they never did.
///
/// Both halves matter. All three modes are present because `runmode.list` reports
/// a switch, and a mode that was stored comes back exactly as it was stored —
/// including a Hosted mode with no relay, which [`RunModeConfig::validate`] keeps
/// refusing until the owner names one rather than this function inventing it.
async fn seed_run_modes(settings: &SettingsStore) -> Result<HashMap<RunMode, RunModeConfig>> {
    let mut modes: HashMap<RunMode, RunModeConfig> = RunMode::all()
        .into_iter()
        .map(|mode| (mode, RunModeConfig::for_mode(mode)))
        .collect();
    for stored in settings.load_run_modes().await? {
        modes.insert(stored.mode, stored);
    }
    Ok(modes)
}

/// The stored backend kits of every project in the store, by project id.
///
/// A project with no stored row is absent rather than defaulted: the default names
/// the project, and only the RPC that resolves a run knows which project it is.
async fn seed_backend_kits(
    store: &Store,
    settings: &SettingsStore,
) -> Result<HashMap<String, BackendKit>> {
    let kits = settings
        .load_backend_kits(project_ids(store).await?)
        .await?;
    Ok(kits.into_iter().collect())
}

/// The stored preference rows of every project in the store, by project id.
///
/// The signals themselves are not stored — the table keeps the derived score — so
/// this is what `preferences.list` answers with after a restart, and the daemon's
/// signal log starts empty.
async fn seed_preferences(
    store: &Store,
    settings: &SettingsStore,
) -> Result<HashMap<String, Vec<Preference>>> {
    let rows = settings
        .load_all_preferences(project_ids(store).await?)
        .await?;
    Ok(rows.into_iter().collect())
}

/// The stored phone pairings, revocation included.
async fn seed_pairings(settings: &SettingsStore) -> Result<InMemoryPairingStore> {
    Ok(settings.load_pairings().await?)
}

/// Directory under the daemon's data directory the agent loop's file tools read
/// and write in.
///
/// One directory per daemon, not one per run: an agent turn is the owner's
/// conversation and belongs to no run, so every path a turn names resolves inside
/// this single directory — and nothing outside it, because
/// [`FilesystemToolExecutor`] refuses a path that escapes. Pointing the loop at a
/// project's repository instead is a caller's decision, and is not made here.
const AGENT_WORKSPACE_DIR: &str = "workspace";

/// The budget meter key the agent turn's model calls are recorded under.
///
/// A turn belongs to no run, so its spend cannot be metered against a project id.
/// The router's cost meter keys on this one stable string instead, which is what
/// `ProviderRouterAdapter` takes as its `project_id`.
const AGENT_METER_KEY: &str = "agent-loop";

/// The agent loop behind `agent.turn`: the real filesystem tool layer under the
/// daemon's data directory, and the real provider router behind the model call,
/// routed as [`AGENT_ROLE`].
///
/// Both halves are seams the loop only reports on: with no role routing set the
/// loop answers that no provider is routed for the agent role, and a tool request
/// whose path leaves the workspace is refused — neither is a panic and neither is
/// a silent no-op.
fn build_agent_loop(
    data_dir: &Path,
    providers: Arc<RwLock<ProviderRouter>>,
    mcp: Arc<dyn McpManager>,
    backend_kit: Arc<RwLock<BackendKit>>,
) -> Arc<RwLock<AgentLoop>> {
    let tools = FilesystemToolExecutor::new(data_dir.join(AGENT_WORKSPACE_DIR));
    let router = ProviderRouterAdapter::new(providers, AGENT_ROLE, AGENT_METER_KEY);
    Arc::new(RwLock::new(
        AgentLoop::with_tool_executor(Box::new(tools))
            .with_router(Arc::new(router))
            .with_mcp(mcp)
            .with_backend_kit(backend_kit),
    ))
}

/// The settings document the role routing table is kept in.
const ROLE_ROUTINGS_DOCUMENT: &str = "role-routings";

/// The settings document the agent loop's conversation state is kept in.
const AGENT_LOOP_DOCUMENT: &str = "agent-loop";

/// The provider id the daemon's own offline provider is registered under.
///
/// A routing may name it, and it is the only adapter that answers without a key or a
/// network — which is why it is the one thing every daemon starts with.
const MOCK_PROVIDER_ID: &str = "mock";

/// What of the agent loop survives a restart.
///
/// Four pieces, and only the four the owner can see: the mode and every switch that
/// got it there (the approval history the AC asks for), the todo list, the questions
/// the loop asked and the answers it was given, and the notes on the message bus. The
/// transcript is deliberately absent — the loop's own compactor holds it and hands out
/// no way to put one back, so a restart starts a bounded context rather than replaying
/// a memory nobody approved keeping.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentLoopSnapshot {
    /// Plan ↔ Agent state, with every approved switch.
    pub modes: ModeManager,
    /// What the loop said it would do, one item per turn.
    pub todos: TodoList,
    /// The `ask_user` questions and their answers.
    pub questions: AskUserQueue,
    /// The `send_message` notes.
    pub notes: MessageBus,
}

impl AgentLoopSnapshot {
    /// The current state of `loop_`, as one document.
    fn of(loop_: &AgentLoop) -> Self {
        Self {
            modes: loop_.mode_manager.clone(),
            todos: loop_.todo_list.clone(),
            questions: loop_.ask_queue.clone(),
            notes: loop_.message_bus.clone(),
        }
    }

    /// Put this state into a freshly built loop.
    fn restore(self, loop_: &mut AgentLoop) {
        let Self {
            modes,
            todos,
            questions,
            notes,
        } = self;
        loop_.mode_manager = modes;
        loop_.todo_list = todos;
        loop_.ask_queue = questions;
        loop_.message_bus = notes;
    }
}

/// The routing table as it was stored, or empty when nothing was stored.
///
/// A document that cannot be read is a warning and an empty table rather than a failed
/// start: a daemon that refused to boot would leave the owner with no way to see or fix
/// what it wrote, and an unrouted role already refuses every call it would have made.
async fn seed_role_routings(settings: &SettingsStore) -> Result<HashMap<Role, RoleRoutingConfig>> {
    let stored = match settings.load_document(ROLE_ROUTINGS_DOCUMENT).await {
        Ok(stored) => stored,
        Err(error) => {
            warn!("the routing table could not be read and starts empty: {error}");
            return Ok(HashMap::new());
        }
    };
    let Some(stored) = stored else {
        return Ok(HashMap::new());
    };
    let configs: Vec<RoleRoutingConfig> = match serde_json::from_value(stored) {
        Ok(configs) => configs,
        Err(error) => {
            warn!("the routing table is not a routing table and starts empty: {error}");
            return Ok(HashMap::new());
        }
    };
    let mut routings = HashMap::new();
    for config in configs {
        match routing_key(&config) {
            Ok(role) => {
                routings.insert(role, config);
            }
            Err(reason) => {
                // A row the daemon cannot honour is dropped here rather than kept and
                // refused at every call: the owner sees it the next time they set it.
                warn!("a stored routing is not usable and was dropped: {reason}");
            }
        }
    }
    Ok(routings)
}

/// The loop's stored conversation, if there is one.
async fn seed_agent_snapshot(settings: &SettingsStore) -> Result<Option<AgentLoopSnapshot>> {
    let stored = match settings.load_document(AGENT_LOOP_DOCUMENT).await {
        Ok(stored) => stored,
        Err(error) => {
            warn!("the agent conversation could not be read and starts fresh: {error}");
            return Ok(None);
        }
    };
    let Some(stored) = stored else {
        return Ok(None);
    };
    match serde_json::from_value::<AgentLoopSnapshot>(stored) {
        Ok(snapshot) => Ok(Some(snapshot)),
        Err(error) => {
            warn!("the agent conversation is not one this daemon can hold: {error}");
            Ok(None)
        }
    }
}

/// Give the router an adapter for every provider the owner has configured.
///
/// Nothing here calls a provider: what is registered is a [`DeferredProvider`], which
/// holds the row and the factory and builds the real adapter on the first call. That is
/// what lets a restart bring the configured providers back with no network at all — a
/// daemon that phoned home on boot would be slow, and one that started offline would
/// come up broken.
///
/// The count it answers is what a start-up log line carries, and nothing else: no key,
/// no endpoint, no provider name beyond the ones the owner chose to type.
async fn register_configured_providers(
    providers: &Arc<RwLock<ProviderRouter>>,
    settings: &SettingsStore,
    factory: &Arc<dyn ProviderFactory>,
) -> Result<usize> {
    let stored = settings.load_providers().await?;
    let mut registered = 0;
    for provider in stored {
        if !provider.enabled {
            continue;
        }
        if provider.name == MOCK_PROVIDER_ID {
            // The daemon's own offline provider owns this id; a row that tries to take
            // it is refused rather than silently replacing what every test routes to.
            warn!("a stored provider is named {MOCK_PROVIDER_ID} and was not registered");
            continue;
        }
        let deferred = DeferredProvider::new(provider.clone(), Arc::clone(factory));
        providers
            .write()
            .await
            .register_provider(Box::new(deferred));
        registered += 1;
    }
    Ok(registered)
}

/// Hand the router the owner's routing table.
///
/// Each role gets its targets in the order the owner set them (the router walks them
/// as a fallback list), and the agent role's per-run ceiling, when it names one, is
/// installed against [`AGENT_METER_KEY`] — the key every agent turn is metered under —
/// so the cap an owner writes is the cap the router enforces before it spends.
async fn apply_role_routings(
    providers: &Arc<RwLock<ProviderRouter>>,
    routings: &HashMap<Role, RoleRoutingConfig>,
) {
    let mut router = providers.write().await;
    for config in routings.values() {
        let Ok((role, routing)) = routing_for(config) else {
            continue;
        };
        if role == AGENT_ROLE {
            if let Some(cents) = routing.budget_cents_per_run {
                router.set_budget(AGENT_METER_KEY, cents);
            }
        }
        router.set_role_routing(routing);
    }
}

/// The role a config names, or the reason it names nothing.
fn role_from_name(name: &str) -> std::result::Result<Role, String> {
    serde_json::from_value::<Role>(serde_json::Value::String(name.trim().to_string()))
        .map_err(|_| format!("{name} is not one of the roles the pipeline knows"))
}

/// The name a role is stored and answered under.
fn role_name(role: Role) -> String {
    serde_json::to_value(role)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// The role and validation of a routing request, before anything is written.
///
/// The role has to be one the pipeline knows, and every target has to name both a
/// provider and a model: a routing with an empty provider id is a routing that resolves
/// to nothing at the call, and refusing it here is what makes `roles.set` mean what it
/// says it means.
fn routing_key(config: &RoleRoutingConfig) -> std::result::Result<Role, String> {
    let role = role_from_name(&config.role)?;
    if config.targets.is_empty() {
        return Err(format!("role {} has no target", config.role));
    }
    for target in &config.targets {
        if target.provider_id.trim().is_empty() {
            return Err(format!(
                "role {} names a target with no provider",
                config.role
            ));
        }
        if target.model_id.trim().is_empty() {
            return Err(format!("role {} names a target with no model", config.role));
        }
    }
    Ok(role)
}

/// The routing the router is given, from the validated config.
fn routing_for(config: &RoleRoutingConfig) -> std::result::Result<(Role, RoleRouting), String> {
    let role = routing_key(config)?;
    let targets = config
        .targets
        .iter()
        .map(|target| RoutingTarget {
            provider_id: target.provider_id.trim().to_string(),
            model_id: target.model_id.trim().to_string(),
            weight: target.weight,
        })
        .collect();
    Ok((
        role,
        RoleRouting {
            role,
            targets,
            fallback_enabled: config.fallback_enabled,
            budget_cents_per_run: config.budget_cents_per_run,
        },
    ))
}

/// The config a stored routing is reported as.
fn routing_config(role: Role, routing: &RoleRouting) -> RoleRoutingConfig {
    RoleRoutingConfig {
        role: role_name(role),
        targets: routing
            .targets
            .iter()
            .map(|target| RoutingTargetConfig {
                provider_id: target.provider_id.clone(),
                model_id: target.model_id.clone(),
                weight: target.weight,
            })
            .collect(),
        fallback_enabled: routing.fallback_enabled,
        budget_cents_per_run: routing.budget_cents_per_run,
    }
}

/// Write the routing table to the daemon's settings.
///
/// An owner's routing is only worth having if the next daemon reads the same table, so
/// every change is written through rather than kept in memory: a routing that dies with
/// the process is a routing that has to be set again by whoever restarts it.
async fn store_role_routings(
    settings: &SettingsStore,
    routings: &HashMap<Role, RoleRoutingConfig>,
) -> Result<()> {
    let mut configs: Vec<RoleRoutingConfig> = routings.values().cloned().collect();
    // Sorted so the document a daemon writes is comparable across runs: the same table
    // written twice is the same bytes, which is what makes it reviewable.
    configs.sort_by(|left, right| left.role.cmp(&right.role));
    let document = serde_json::to_value(configs).map_err(|error| {
        DaemonError::Config(format!("the routing table could not be encoded: {error}"))
    })?;
    settings
        .save_document(ROLE_ROUTINGS_DOCUMENT, &document)
        .await?;
    Ok(())
}

/// Write the loop's conversation to the daemon's settings.
async fn store_agent_snapshot(
    settings: &SettingsStore,
    snapshot: &AgentLoopSnapshot,
) -> Result<()> {
    let document = serde_json::to_value(snapshot).map_err(|error| {
        DaemonError::Config(format!(
            "the agent conversation could not be encoded: {error}"
        ))
    })?;
    settings
        .save_document(AGENT_LOOP_DOCUMENT, &document)
        .await?;
    Ok(())
}

/// HTTP server for REST API and WebSocket
async fn health_handler() -> impl IntoResponse {
    Json(HealthResponse {
        status: "healthy".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_seconds: 0,
    })
}

/// The address both listeners bind, as resolved from the configuration.
///
/// An IP literal and nothing else. A hostname would be resolved once at start and could
/// mean another machine after a DHCP or DNS change, while the startup log and every
/// pairing link quote the address the socket *really* opened — so the owner spells an
/// address, and the daemon never resolves one behind their back. A value that does not
/// parse is a configuration error the owner sees at startup rather than a listener that
/// quietly came up somewhere else.
fn resolve_bind_host(config: &DaemonConfig) -> Result<IpAddr> {
    config.bind_host.trim().parse::<IpAddr>().map_err(|error| {
        DaemonError::Config(format!(
            "`{}` is not an address this daemon can bind: {error}; `bind_host` takes an IP literal \
             such as `127.0.0.1`, and loopback is the default when the configuration names none",
            config.bind_host
        ))
    })
}

/// Whether an address names "every interface" rather than one of them.
fn is_wildcard(addr: IpAddr) -> bool {
    addr.is_unspecified()
}

/// Whether `advertised_host` names a host a pairing link may carry, in its URL spelling.
///
/// Accepted: an IP literal of either version (an IPv6 one comes back bracketed, so the
/// port separator stays unambiguous) and a plain hostname. Refused: anything carrying a
/// URL separator or a space — a scheme, a path, a query, credentials — because the daemon
/// serves plain HTTP and terminates no TLS, so a `https://` in this field would advertise
/// an endpoint it does not have, and a host with a path in it is a link to somewhere else.
fn advertised_host_spelling(raw: &str) -> Option<String> {
    let host = raw.trim();
    if host.is_empty() {
        return None;
    }
    if let Ok(addr) = host.parse::<IpAddr>() {
        return Some(match addr {
            IpAddr::V6(_) => format!("[{addr}]"),
            IpAddr::V4(_) => addr.to_string(),
        });
    }
    let hostname_shape = host
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    if hostname_shape {
        Some(host.to_string())
    } else {
        None
    }
}

/// The origin `devices.pair-start` puts in a pairing link for a daemon listening on
/// `bind` at the port it actually got, `port`.
///
/// Three cases, and the rule they share is that a link must never advertise an address
/// the daemon is not reachable at:
///
///   * a **loopback** bind advertises that literal. It is honest and it is the default,
///     and it is a link a phone on the same network cannot open — which is what
///     [`warsha_remote::PairingOffer::loopback_only`] says out loud rather than hiding;
///   * a **specific** non-loopback bind (`192.168.1.20`) advertises exactly that address,
///     because the daemon bound only there and the owner named it;
///   * a **wildcard** bind (`0.0.0.0`) is reachable at an address the daemon cannot pick
///     out — enumerating interfaces would be a guess printed on a bearer credential — so
///     it advertises [`DaemonConfig::advertised_host`] when the owner set one, and refuses
///     when they did not. The refusal is actionable and names the flag; the bind itself
///     still serves, because nothing about the listeners depends on this.
fn pairing_origin(
    bind: IpAddr,
    port: u16,
    advertised: Option<&str>,
) -> std::result::Result<String, DaemonError> {
    let host = if is_wildcard(bind) {
        let raw = advertised.ok_or_else(|| {
            DaemonError::Config(format!(
            "this daemon is bound to the wildcard address `{bind}`, so it cannot say which of its \
             addresses a phone should dial; set `advertised_host` in the configuration (or pass \
             `--advertised-host`) to the address the phone reaches this machine at, such as \
             `192.168.1.20`"
        ))
        })?;
        advertised_host_spelling(raw).ok_or_else(|| {
            DaemonError::Config(format!(
            "`{raw}` is not a host a pairing link can advertise: `advertised_host` takes a bare \
             hostname or IP (`warsha.local`, `192.168.1.20`, `fd00::2`) and never a scheme, a path \
             or a port, because the daemon serves plain HTTP on the port it bound"
        ))
        })?
    } else if bind.is_ipv6() {
        format!("[{bind}]")
    } else {
        bind.to_string()
    };
    Ok(format!("http://{host}:{port}"))
}

/// Whether a pairing origin is reachable only from this machine.
///
/// Read off the origin the daemon built, so it is the same fact the listeners act on
/// rather than a second opinion about the configuration. The host is what decides it: a
/// bracketed IPv6 literal (`http://[::1]:8766/`), a plain one, or a hostname from
/// `advertised_host` — which is by definition not a loopback address the daemon invented,
/// and reads as "not loopback" exactly as it should.
///
/// This is the flag that keeps parts A and B honest with each other: a link minted over a
/// loopback bind is a link no phone can open, and the screen has to say so instead of
/// printing a plate that cannot work.
fn origin_is_loopback(origin: &str) -> bool {
    let after_scheme = origin.split("://").nth(1).unwrap_or(origin);
    let authority = after_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default();
    let host = authority.rsplit('@').next().unwrap_or_default();
    let host = match host.strip_prefix('[') {
        Some(bracketed) => bracketed.split(']').next().unwrap_or_default(),
        None => host.split(':').next().unwrap_or_default(),
    };
    host.parse::<IpAddr>().is_ok_and(|addr| addr.is_loopback())
}

/// Start the daemon and return a handle for management.
/// Accepts `http_port` and `ws_port` of 0 to let the OS choose ports.
pub async fn start_daemon(config: DaemonConfig) -> Result<DaemonHandle> {
    start_daemon_with_secrets(config, Arc::new(KeychainSecretStore::new())).await
}

/// Start the daemon with the secret store it should keep provider keys in.
///
/// The production entry point ([`start_daemon`]) passes the OS keychain. This one
/// exists because the keychain is not always there: a headless CI container or a
/// WSL shell with no D-Bus secret service refuses `keyring` with
/// `PlatformFailure`, and an integration test that drove `providers.add` through
/// it would be testing the runner. The daemon's behaviour is otherwise identical,
/// and the key that a test writes is the key `providers.test` reads back.
///
/// It installs [`KeychainProviderFactory`], the production adapter factory: a test
/// that wants the *provider construction* to be offline as well uses
/// [`start_daemon_with_provider_factory`].
pub async fn start_daemon_with_secrets(
    config: DaemonConfig,
    secrets: Arc<dyn SecretStore>,
) -> Result<DaemonHandle> {
    start_daemon_with_provider_factory(config, secrets, Arc::new(KeychainProviderFactory::new()))
        .await
}

/// Start the daemon with both of its injectable seams named: where keys live, and
/// what builds an adapter for a configured provider.
///
/// The second seam is what closes C2's real-provider gap offline. The daemon's
/// production behaviour is [`KeychainProviderFactory`], which reads the OS keychain —
/// so an integration test that used it would need a keychain, and one that got a
/// keychain would be making a real call. [`MockProviderFactory`] answers the same
/// rows with the workspace's mock adapter under the same ids, which lets a test drive
/// the whole path a configured provider takes: row, routing, registered adapter,
/// agent turn, restart, and the routing and the turn still there afterwards.
pub async fn start_daemon_with_provider_factory(
    config: DaemonConfig,
    secrets: Arc<dyn SecretStore>,
    provider_factory: Arc<dyn ProviderFactory>,
) -> Result<DaemonHandle> {
    // The environment is consulted here and not only in [`load_or_create_config`]:
    // an embedded host that builds a [`DaemonConfig`] in-process still gets the
    // deployment knob of [`REMOTE_ASSETS_DIR_ENV`], and a configuration that named
    // a bundle directory directly is never overwritten by it.
    let mut config = config;
    if config.remote_assets_dir.is_none() {
        config.remote_assets_dir = env_string(REMOTE_ASSETS_DIR_ENV).map(PathBuf::from);
    }

    // Ensure single instance lock
    let lock_file = acquire_lock(&config.data_dir)?;

    // Ensure data directory exists
    std::fs::create_dir_all(&config.data_dir)?;

    // Initialize store with configurable path
    let db_path = config.data_dir.join("warsha.db");
    // The settings are the same database the async store uses: the four small
    // records a restart has to keep live beside the projects they configure, in one
    // file, so a project and the settings that describe it cannot be lost
    // separately. The migration runs here, before anything is served, so a file
    // that cannot be opened fails the start instead of the first setting the owner
    // changes.
    let settings = Arc::new(SettingsStore::open(&db_path).await?);
    let store = Arc::new(Store::open_at(db_path).await?);

    // Initialize provider router
    let providers = Arc::new(RwLock::new(ProviderRouter::new()));

    // Register mock provider for testing
    providers
        .write()
        .await
        .register_provider(Box::new(warsha_providers::MockProvider::new(
            MOCK_PROVIDER_ID,
        )));
    // W5's deterministic fake provider: unrouted pipeline stages already answer
    // through it inside the pipeline's dispatch, and registering it here makes it
    // visible to `providers.list` and routable by the owner like any provider.
    providers
        .write()
        .await
        .register_provider(Box::new(warsha_providers::FakeProvider::new()));

    // The providers the owner configured, before anything is served. This is the
    // bridge C2 was missing: `providers.add` stores a row and files a key, and a
    // router that never learns about them answers every turn with "no model is
    // wired" — including the turn that comes after a restart, which is the one the
    // owner has no way to explain. Registration calls nothing: what is handed to
    // the router is a deferred adapter that builds on the first call.
    let configured =
        register_configured_providers(&providers, &settings, &provider_factory).await?;
    if configured > 0 {
        info!("registered {configured} configured provider(s)");
    }

    // The owner's routing table, read from the settings and handed to the router.
    // A role with no routing refuses its calls, which is the honest answer to a
    // daemon that was never told which provider speaks for it.
    let role_routings = seed_role_routings(&settings).await?;
    apply_role_routings(&providers, &role_routings).await;

    // Initialize pipeline
    // The daemon's SettingsStore implements SettingsProvider, so we can use it directly
    let pipeline: Arc<warsha_pipeline::PipelineEngine<SettingsStore>> = Arc::new(
        warsha_pipeline::PipelineEngine::new(store.clone(), providers.clone(), settings.clone()),
    );

    // Initialize backends
    let backends = BackendFactory::all_available();

    // Initialize GitHub client if token available
    let github = if let Ok(token) = get_github_token() {
        Some(GitHubClient::new(&token)?)
    } else {
        None
    };

    // Initialize device registry
    let local_identity = warsha_remote::DeviceIdentity::generate("Warsha Daemon".to_string())?;
    let devices = Arc::new(DeviceRegistry::new(local_identity));

    // The live event bus is the store's: every `append_event` publishes on it, and
    // `/events` subscribes through `state.store`. There is deliberately no second
    // sender a handler could attach to and feed itself a silent stream.

    // One spawner for the daemon: the MCP stdio transport starts its server
    // through it and the live preview runs its dev server on it, so `process.list`
    // is the one place that names every child.
    let processes: Arc<dyn ProcessManager> = InMemoryProcessManager::shared();
    let mcp: Arc<dyn McpManager> = Arc::new(InMemoryMcpManager::new(processes.clone()));
    let previews = Arc::new(LivePreviewManager::new(processes.clone()));

    // The agent loop's two seams, wired to the real thing: its file tools run
    // inside `<data_dir>/workspace`, and its model calls go out through the same
    // router the pipeline stages use — a router that now holds the configured
    // providers and the owner's routing, so an Agent-mode turn reaches a model
    // rather than reporting that nothing is wired.
    let default_kit = Arc::new(RwLock::new(default_backend_kit("default")));
    let agent_loop = build_agent_loop(
        &config.data_dir,
        providers.clone(),
        mcp.clone(),
        default_kit,
    );

    // The conversation the last daemon was having, if any: the mode it reached, who
    // approved each switch, the todos and the questions. Restored before the RPC
    // surface opens, so the first `agent.turn` after a restart is the next turn of
    // one conversation rather than the first turn of a new one.
    if let Some(snapshot) = seed_agent_snapshot(&settings).await? {
        let mut guard = agent_loop.write().await;
        snapshot.restore(&mut guard);
    }

    // Seed the four settings records from the file before the RPC surface opens.
    // A daemon that answered the first request from an empty switch while the
    // owner's settings sat on disk would be the bug this batch exists to fix, so
    // the seeding is part of starting rather than a background warm-up.
    let run_modes = seed_run_modes(&settings).await?;
    let backend_kits = seed_backend_kits(&store, &settings).await?;
    let stored_preferences = seed_preferences(&store, &settings).await?;
    let pairings = seed_pairings(&settings).await?;
    // The three Wave 2 catalogs, from `warsha-core` rather than from the file. They
    // are seeded because they are *shipped*: a fresh daemon must answer
    // `harness.list`, `skills.list` and `plugins.list` with the presets the product
    // documents, and only the empty case is filled — an owner who deleted a preset
    // deleted it on purpose, and a seed that rewrote their table every start would
    // delete that decision instead.
    wave2::seed_bundled_records(&settings).await?;
    let routines = Arc::new(RwLock::new(RoutineRegistry::new()));
    let routine_runner: Arc<dyn RoutineRunner + Send + Sync> =
        Arc::new(warsha_pipeline::MockRoutineRunner::new());
    let routine_scheduler = Arc::new(RoutineScheduler::new(routines.clone(), routine_runner));

    // Which credential means which caller, and how often it may ask (audit H-01,
    // H-03, H-04). The owner session speaks as the daemon's own device, which is what
    // keeps the local desktop workflow exactly as it was: the app holds the daemon's
    // token, so it is the owner, and a gate it approves is recorded against this
    // machine. A phone joins that set only through a pairing secret the owner issued.
    let sessions = Arc::new(Sessions::new(
        config.auth_token.clone(),
        devices.local_identity().device_id,
    ));
    let rates = Arc::new(RateGovernor::new(&config.rate_limits));

    // The daemon-wide event stream. One sequencer gives every `/events` socket and every
    // `runs.subscribe` the same monotonic ordering and the same replay ring; the pump
    // spawned just below is its only writer, draining the store's event bus.
    let events = Arc::new(EventSequencer::new());

    let state = Arc::new(DaemonState {
        config: config.clone(),
        store,
        providers,
        pipeline,
        backends,
        github,
        devices,
        backend_kits: Arc::new(RwLock::new(backend_kits)),
        crash_reports: Arc::new(RwLock::new(InMemoryCrashReportStore::new())),
        store_reviews: Arc::new(RwLock::new(InMemoryStoreReviewStore::new())),
        agent_loop,
        processes,
        mcp,
        previews,
        settings,
        run_modes: Arc::new(RwLock::new(run_modes)),
        preferences: Arc::new(RwLock::new(InMemoryPreferenceStore::new())),
        stored_preferences: Arc::new(RwLock::new(stored_preferences)),
        pairings: Arc::new(RwLock::new(pairings)),
        secrets,
        routines,
        routine_scheduler,
        sessions,
        rates,
        role_routings: Arc::new(RwLock::new(role_routings)),
        provider_factory,
        // Filled the moment the RPC listener has bound — see [`DaemonState::pairing_origin`].
        pairing_origin: std::sync::OnceLock::new(),
        events,
    });

    // The single writer of the event stream: drain the store's event bus, scrub each
    // event against the daemon's own token, and publish it under the next `seq`. Running
    // it here — rather than in each producer — is what makes `seq` order equal the
    // store's arrival order and guarantees the *same* scrub runs whether an event came
    // from a pipeline stage, a gate decision, or one of the new `runs.*` writes.
    {
        let pump = Arc::clone(&state);
        tokio::spawn(async move {
            let mut rx = pump.store.subscribe_events();
            let token = pump.config.auth_token.clone();
            let sequencer = pump.events.clone();
            loop {
                match rx.recv().await {
                    Ok(mut event) => {
                        scrub_event_payload(&mut event.payload, &token);
                        sequencer.publish(event).await;
                    }
                    // The pump lags only if it is starved of the runtime; nothing is
                    // dropped from the durable record (the store already holds it), so
                    // resynchronising the bus and continuing is the whole recovery.
                    Err(broadcast::error::RecvError::Lagged(dropped)) => {
                        warn!("the event pump lagged the store bus by {dropped} events");
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }

    // Start JSON-RPC server (TCP for cross-platform compatibility)
    //
    // The host is the configuration's, not a literal: a phone cannot dial `127.0.0.1` and
    // reach this machine — it would be dialling itself. Loopback remains the default, and
    // every other address is an opt-in the owner made in the config file or with
    // `--bind-host` (see [`DaemonConfig::bind_host`] for why that posture is deliberate).
    let bind = resolve_bind_host(&config)?;
    let rpc_addr: SocketAddr = SocketAddr::new(bind, config.ws_port);
    // The origins this daemon accepts, parsed once and used by both servers below.
    //
    // They are not optional for the RPC server: `warsha-desktop` serves its webview from
    // `http://tauri.localhost`, so every RPC call it makes is cross-origin and arrives with
    // `Content-Type: application/json`, which makes it a request a browser has to preflight. A
    // preflight carries no `Authorization` header, so the CORS layer has to sit *outside* the auth
    // layer: inside, every preflight would be answered "unauthorized" and the real POST would never
    // be sent. A client that sends no `Origin` (the CLI, a test) sees no CORS headers and is
    // unaffected.
    let allowed_origins = config
        .allowed_origins
        .clone()
        .into_iter()
        .filter_map(|o| o.parse::<axum::http::HeaderValue>().ok())
        .collect::<Vec<axum::http::HeaderValue>>();
    let rpc_cors = CorsLayer::new()
        .allow_origin(allowed_origins.clone())
        .allow_methods(Any)
        .allow_headers(Any);
    let rpc_auth_layer = RpcAuthLayer {
        state: state.clone(),
    };
    let rpc_server = ServerBuilder::default()
        .set_http_middleware(
            tower::ServiceBuilder::new()
                .layer(rpc_cors)
                .layer(rpc_auth_layer),
        )
        .build(rpc_addr)
        .await
        .map_err(|e| DaemonError::Config(format!("could not bind RPC server: {e}")))?;
    let actual_rpc_port = rpc_server.local_addr()?.port();
    // The origin a pairing link may advertise, decided now rather than at the call: this
    // is the moment the daemon knows the address it is actually reachable at, and
    // `devices.pair-start` must not put a port on a QR plate that no socket holds.
    //
    // A wildcard bind with no `advertised_host` is the one case that cannot be answered,
    // and the answer is a startup warning plus a refusal at the call — never a guess. The
    // listeners are already up by then, so a daemon that only *serves* is unaffected; only
    // minting a pairing needs the owner to say which address their phone dials.
    let resolved_origin =
        match pairing_origin(bind, actual_rpc_port, config.advertised_host.as_deref()) {
            Ok(origin) => {
                if state.pairing_origin.set(origin.clone()).is_err() {
                    warn!("the pairing origin was already set; this daemon served one before");
                }
                Some(origin)
            }
            Err(error) => {
                warn!(
                    "this daemon cannot yet say what address a phone should dial: {error}; \
                     `devices.pair-start` will refuse until it is answered"
                );
                None
            }
        };
    let rpc = WarshaRpc::new(state.clone());
    let rpc_handle = rpc_server.start(rpc.into_rpc());
    {
        let stopped_handle = rpc_handle.clone();
        tokio::spawn(async move {
            stopped_handle.stopped().await;
            info!("RPC server stopped");
        });
    }
    // The port was resolved from the socket before `.start()` consumed the server; the
    // handle it returns exposes no address, so that captured value is the only truthful
    // source for what this listener is bound to.
    info!(
        "JSON-RPC server listening on {}",
        SocketAddr::new(bind, actual_rpc_port)
    );

    // Start HTTP/WebSocket server. The same origin list as the RPC server, parsed above.
    let cors = CorsLayer::new()
        .allow_origin(allowed_origins)
        .allow_methods(Any)
        .allow_headers(Any);

    // Auth middleware: a bounded ceiling on every route, and a verified bearer token
    // on every route except /health (security audit H-01, H-03, H-04).
    let auth_middleware = axum::middleware::from_fn_with_state(state.clone(), auth_handler_inner);

    // `/health` and `/events` are real routes, so they match before any fallback and
    // keep their existing handlers whatever the static surface does; `/rpc` lives on
    // the other listener and is refused from the static path by name
    // ([`is_reserved_static_path`]). The fallback is mounted only when a bundle is
    // configured: with none, an unmatched path 404s exactly as it did before.
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/events", get(events_handler));
    let app = if state.config.remote_assets_dir.is_some() {
        app.fallback(static_asset_handler)
    } else {
        app
    };
    let app = app
        .layer(auth_middleware)
        .layer(cors)
        .with_state(state.clone());

    // The same host as the RPC listener: a phone that can reach one must be able to
    // reach the other, and a daemon split across a loopback and a LAN address would be a
    // daemon whose pairing link works for half its surface.
    let http_addr = SocketAddr::new(bind, config.http_port);
    let http_listener = tokio::net::TcpListener::bind(http_addr).await?;
    let actual_http_port = http_listener.local_addr()?.port();
    info!(
        "HTTP server listening on http://{}",
        http_listener.local_addr()?
    );

    // A non-loopback bind publishes the daemon past this machine. On Windows the inbound
    // firewall rule for it is not created on the daemon's behalf — raising the firewall is
    // the owner's elevated, deliberate act — so the exact one-command fix is printed here
    // rather than left to be guessed. The address and the two ports only: never the token.
    if !bind.is_loopback() {
        let firewall = windows_firewall_command(actual_http_port, actual_rpc_port);
        info!("LAN bind on {bind}: open the Windows firewall with `{firewall}`");
        // Which host a peer dials. A wildcard bind cannot name one, so the owner's
        // `advertised_host` (a LAN address, or a Tailscale IP) is what makes the link real.
        let share_host = match config.advertised_host.as_deref().map(str::trim) {
            Some(host) if !host.is_empty() => host.to_string(),
            _ => bind.to_string(),
        };
        // Bracket a bare IPv6 address so the port separator stays unambiguous.
        let share_spelling = if share_host.contains(':') && !share_host.starts_with('[') {
            format!("[{share_host}]")
        } else {
            share_host
        };
        info!(
            "reachable over the local network or Tailscale at http://{share_spelling}:{actual_rpc_port} \
             (events at http://{share_spelling}:{actual_http_port})"
        );
    }

    // The HTTP listener is the daemon's surface that knows the peer address, and it
    // is the one that has to: a rate limit with no identity to key on falls back to
    // the address, and an unbounded `/events` is a socket-occupying denial of service
    // with no response code for it (audit H-01).
    let http_task = tokio::spawn(async move {
        if let Err(e) = axum::serve(
            http_listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        {
            error!("HTTP server error: {}", e);
        }
    });

    Ok(DaemonHandle {
        _lock_file: lock_file,
        http_task,
        rpc_server: rpc_handle,
        http_port: actual_http_port,
        rpc_port: actual_rpc_port,
        bind_addr: bind,
        pairing_origin: resolved_origin,
        // The daemon's own spawner, not a second one: the sweep at shutdown has to
        // see the children the RPCs started.
        processes: state.processes.clone(),
        // The runtime the servers are being driven on, kept so a handle that is
        // dropped without `shutdown` can still take its children with it. An `async fn`
        // only ever runs on a runtime, so asking for the current one cannot fail here.
        runtime: tokio::runtime::Handle::current(),
        reaped: std::sync::atomic::AtomicBool::new(false),
    })
}

/// Layer the command line over a configuration the daemon read from disk.
///
/// Its own function because the *shape* of each override is a decision, not an
/// accident: the two ports arrive with clap defaults and therefore always overwrite the
/// file (a wart this change leaves alone rather than silently widening), while the bind
/// address and the advertised host are `Option`s that overwrite only when the owner
/// actually passed them. That asymmetry is deliberate and load-bearing — `bind_host` is
/// the one field an owner may legitimately set in `config.toml` and never pass a flag
/// again, especially from the desktop shell that starts the daemon in-process and gives
/// them no way to pass one at all. A default here would put their LAN bind back to
/// loopback on every start.
fn apply_cli_overrides(config: &mut DaemonConfig, args: &DaemonArgs) {
    config.http_port = args.http_port;
    config.ws_port = args.ws_port;
    if let Some(bind_host) = args.bind_host.as_deref() {
        config.bind_host = bind_host.to_string();
    }
    if args.advertised_host.is_some() {
        config.advertised_host = args.advertised_host.clone();
    }
    if let Some(socket) = &args.socket {
        config.socket_path = socket.clone();
    }
}

/// Main daemon entry point (kept for CLI compatibility)
pub async fn run_daemon(args: DaemonArgs) -> Result<()> {
    // Load or create config
    let config = load_or_create_config(args.config.as_deref()).await?;

    // Override with CLI args
    let mut config = config;
    apply_cli_overrides(&mut config, &args);

    let handle = start_daemon(config).await?;
    // The listener lines are `start_daemon`'s to write — it is the one that knows the
    // ports it ended up on — and they are written there exactly once. Repeating them here
    // is what the load run recorded as a startup log with two of each line
    // (`bridge-io/security/load/report.md`, finding 3): a log a reviewer has to dedupe by
    // hand is a log that hides the lines that matter. The mode line stays, because which
    // mode the process came up in is a fact about *this* entry point, not about the
    // listeners.
    //
    // The address it names is the one the sockets bound, not `127.0.0.1`: an owner who
    // opted into a LAN bind reads a startup log that says where the daemon really is, and
    // an owner who did not sees loopback because that is what is listening.
    let bind = handle.bind_addr();
    info!(
        "warshad serving on http://{bind}:{} and RPC {bind}:{}",
        handle.http_port(),
        handle.rpc_port()
    );

    // Keep running until interrupted. True daemonization is not implemented yet,
    // so background mode also waits on Ctrl-C.
    if args.foreground {
        info!("warshad running in foreground mode");
    } else {
        info!("warshad running in background mode");
    }

    // Every exit path goes through the same shutdown, so no child outlives the
    // daemon: a signal that could not be listened for is waited out as an error
    // *after* the children are reaped, rather than returning early and leaving a
    // dev server holding its port.
    let interrupted = wait_for_shutdown_signal().await;
    handle.shutdown().await;
    interrupted?;
    Ok(())
}

/// Wait for the signal that says "stop this daemon".
///
/// Ctrl-C is what a terminal sends. On a service manager, in a container, or under a
/// plain `kill`, what arrives is SIGTERM — and a daemon that listened only for Ctrl-C
/// ignored it, so the stop that followed was a SIGKILL after a timeout: children kept
/// their ports, the lock was released only by the operating system, and the shutdown
/// path the code documents never ran. Both signals are answered the same way here:
/// return, and let [`run_daemon`] take the children down through the one shutdown.
///
/// Windows has no SIGTERM to catch, and a console close is the operating system's to
/// report; what covers a process that never gets to run its own code is
/// [`DaemonHandle`]'s drop sweep, plus the fact that the desktop shell runs the daemon
/// *inside* its own process, so an app that dies takes the daemon with it.
async fn wait_for_shutdown_signal() -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut terminate = signal(SignalKind::terminate())?;
        tokio::select! {
            interrupted = tokio::signal::ctrl_c() => interrupted,
            _ = terminate.recv() => Ok(()),
        }
    }
    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c().await
    }
}

pub async fn load_or_create_config(config_path: Option<&Path>) -> Result<DaemonConfig> {
    let config_dir = dirs::config_dir()
        .map(|d| d.join("warsha"))
        .unwrap_or_else(|| PathBuf::from(".").join("warsha"));
    std::fs::create_dir_all(&config_dir)?;

    let default_config_path = config_dir.join("config.toml");
    let path = config_path.unwrap_or(&default_config_path);

    let config = if path.exists() {
        let content = std::fs::read_to_string(path)?;
        toml::from_str(&content)?
    } else {
        // Generate auth token
        let mut token = [0u8; 32];
        rand::rngs::OsRng
            .try_fill_bytes(&mut token)
            .map_err(|e| DaemonError::Config(e.to_string()))?;
        let auth_token = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(token);

        let config = DaemonConfig {
            auth_token,
            ..Default::default()
        };

        // Save config with 0600 permissions
        let content = toml::to_string_pretty(&config)?;
        std::fs::write(path, content)?;

        // Set permissions (Unix only)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        }

        // A brand-new daemon has just minted the one owner token it will never show
        // again, because after this the file already holds it. Printing it is the way a
        // headless operator captures that first token, and it is deliberately gated
        // behind `WARSHA_PRINT_BOOTSTRAP_TOKEN=1`: a normal run, and every test, must
        // not leak a freshly minted secret into a log or a CI capture (AGENTS.md).
        if std::env::var("WARSHA_PRINT_BOOTSTRAP_TOKEN")
            .ok()
            .is_some_and(|value| value == "1")
        {
            info!("BOOTSTRAP_ADMIN_TOKEN={}", config.auth_token);
        }
        config
    };

    // The environment is the deployment-time knob, overlaid last so it wins over both
    // a `config.toml` and the defaults a fresh file was written from.
    Ok(apply_env_overrides(config))
}

/// Overlay `WARSHA_*` environment variables on a configuration the daemon read or made.
///
/// A container image sets the bind address and the ports without rewriting a
/// `config.toml`, and an operator supplies an already-held token through
/// `WARSHA_AUTH_TOKEN` instead of letting one be minted. A port that does not parse as
/// a `u16` is ignored rather than failing the start — a stray `WARSHA_HTTP_PORT=abc`
/// must not brick a deploy — while the bind address is passed through as written and
/// validated by [`resolve_bind_host`], which owns the error an owner should actually
/// see for a non-address.
fn apply_env_overrides(mut config: DaemonConfig) -> DaemonConfig {
    if let Some(host) = env_string("WARSHA_BIND_HOST") {
        config.bind_host = host;
    }
    if let Some(host) = env_string("WARSHA_ADVERTISED_HOST") {
        config.advertised_host = Some(host);
    }
    if let Some(port) = env_port("WARSHA_HTTP_PORT") {
        config.http_port = port;
    }
    if let Some(port) = env_port("WARSHA_WS_PORT") {
        config.ws_port = port;
    }
    if let Some(dir) = env_string("WARSHA_DATA_DIR") {
        config.data_dir = PathBuf::from(dir);
    }
    if let Some(token) = env_string("WARSHA_AUTH_TOKEN") {
        config.auth_token = token;
    }
    if let Some(dir) = env_string(REMOTE_ASSETS_DIR_ENV) {
        config.remote_assets_dir = Some(PathBuf::from(dir));
    }
    config
}

/// A non-empty environment value, trimmed; `None` when the name is unset, blank, or
/// not valid UTF-8.
fn env_string(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// An environment value parsed as a `u16` port number.
fn env_port(name: &str) -> Option<u16> {
    env_string(name).and_then(|value| value.parse::<u16>().ok())
}

/// Take the daemon's single-instance lock over `data_dir`.
///
/// The directory is made first: the lock lives in it, so a data directory the owner
/// named in a config file and never created would otherwise fail the start with an
/// I/O error that reads like a refusal to run twice.
///
/// The holder's process id is written into the file, and mirrored into an unlocked
/// `warshad.pid` beside it (see [`LockFile`]), so a second daemon — or the desktop
/// shell that found one already running — can say *which* process has the directory,
/// which is the difference between "restart the app" and a half-hour of hunting a
/// stray `warshad`.
fn acquire_lock(data_dir: &Path) -> Result<LockFile> {
    std::fs::create_dir_all(data_dir)?;
    let lock_path = data_dir.join("warshad.lock");
    let mut lock = LockFile::new(lock_path.clone());
    lock.acquire().map_err(|_error| {
        // The operating system's own reason (`WouldBlock`, almost always) says nothing
        // an owner can act on; who holds the lock does.
        DaemonError::Lock(format!(
            "another warshad holds {lock_path:?} ({}); this daemon will not share a data directory",
            lock_holder(&lock_path)
        ))
    })?;
    Ok(lock)
}

/// Who the lock file says holds the lock, as a hint for an error message.
///
/// The holder mirrors its pid into a `warshad.pid` beside the lock precisely because
/// the lock file itself can be unreadable while held (on Windows the holder opens it
/// for writing without sharing read access), so the mirror is tried first and the
/// lock file is the fallback — a holder that predates the mirror, or a mirror that
/// was cleaned away, still names its pid if the lock file can be read at all.
///
/// A pid in a file is a *hint*: the operating system releases the advisory lock when a
/// process dies, so a stale file can name a process that has been gone for years and a
/// recycled pid can name something that has nothing to do with Warsha. Nothing here acts
/// on it — no signal is sent and no lock is taken over another's — because the safe way
/// to stop a daemon the owner cannot see is to ask them, with the number to look at.
fn lock_holder(path: &Path) -> String {
    let mirror = path.with_extension("pid");
    for candidate in [&mirror, path] {
        if let Ok(text) = std::fs::read_to_string(candidate) {
            let pid = text.split_whitespace().next().unwrap_or_default();
            if !pid.is_empty() {
                return format!("pid {pid}");
            }
        }
    }
    "no pid recorded".to_string()
}

/// The daemon's single-instance lock.
///
/// Two things a restart depends on, both of them deliberate:
///
/// - **The advisory lock, not the file's existence, is what decides.** `fs2`'s
///   exclusive lock is held by the *open file description* (Unix) or the file handle
///   (Windows), so the operating system drops it when the holder exits — cleanly, by
///   panic, or by `kill -9`. A lock that had to be deleted by its holder is a lock that
///   has to be cleaned up by whoever comes after.
/// - **The file is never deleted.** Removing it is the one way a restart can end up with
///   two daemons on one data directory: instance A unlinks the path while instance B
///   still holds a handle to the old inode and instance C creates a new file at the same
///   name, and B and C both lock successfully because they locked different files. The
///   next bind to the RPC port is then a crash, or two databases in one directory.
///   Leaving the file costs one inode and makes every instance contend on the same one.
#[derive(Debug)]
struct LockFile {
    path: PathBuf,
    file: Option<std::fs::File>,
}

impl LockFile {
    fn new(path: PathBuf) -> Self {
        Self { path, file: None }
    }

    /// Take the exclusive lock and record this process as the holder.
    fn acquire(&mut self) -> std::io::Result<()> {
        use std::fs::OpenOptions;
        use std::io::Write;
        // `truncate(false)` is deliberate at *open* time: truncating a file another
        // instance may be holding would be the wrong semantic for a lock. Once this
        // process holds the lock exclusively, overwriting its contents is not.
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(&self.path)?;

        // An exclusive advisory lock, without blocking. On Unix this is flock(2), on
        // Windows LockFileEx. A lock another instance holds answers `WouldBlock`, which
        // `acquire_lock` turns into the refusal the desktop shell reads as "there is
        // already a daemon, and it is reachable on the ports we both configured".
        file.try_lock_exclusive()?;

        let pid = std::process::id().to_string();
        file.set_len(0)?;
        (&file).write_all(pid.as_bytes())?;

        // Mirror the pid into an ordinary, unlocked file next to the lock. On Windows
        // the lock file is open by its holder for writing, and a write-only open there
        // does not share read access, so a second instance's read of `warshad.lock`
        // fails with a sharing violation — exactly when the refusal needs a name. The
        // mirror is that name; it decides nothing about the lock itself.
        std::fs::write(self.path.with_extension("pid"), pid.as_bytes())?;

        self.file = Some(file);
        Ok(())
    }
}

impl Drop for LockFile {
    fn drop(&mut self) {
        if let Some(file) = self.file.take() {
            // Release the lock, then let the handle close. The file stays: that is the
            // point of `LockFile`, and the next instance truncates it to its own pid
            // the moment it holds the lock.
            let _ = file.unlock();
            drop(file);
        }
    }
}

fn get_github_token() -> Result<String> {
    // keyring 1.2's `Entry::new` is infallible (it returns `Entry`, not a `Result`).
    let entry = Entry::new("warsha", "github_token");
    entry
        .get_password()
        .map_err(|_| DaemonError::Config("GitHub token not in keychain".to_string()))
}

/// The HTTP listener's ceiling and authentication: a bounded answer for every route,
/// and a verified caller for every route but `/health`.
///
/// Three things the audit asked for happen here (H-01, H-03, H-04):
///
/// - **A 429 with a `Retry-After`.** The listener used to have no overload path at
///   all: `/events` would take as many sockets as a caller could open.
/// - **A ceiling keyed on who is calling.** This listener knows the peer address (the
///   RPC transport's middleware does not), so an authenticated identity decides the
///   bucket and the address is the fallback for a caller that never got authenticated.
/// - **The verified caller, in the request.** A handler that wants to know who asked
///   reads the [`Actor`] the credential produced — never a field of its own params.
///
/// The credential is a bearer header on every route, and additionally a
/// `warsha.token.<token>` subprotocol on `/events` — the only form a browser can send on
/// a WebSocket handshake, and the reason that socket was being refused (task #49). Both
/// forms go to the same [`Sessions::resolve`] and are refused the same way. Neither is a
/// URL query parameter, which this listener never reads.
async fn auth_handler_inner(
    State(state): State<Arc<DaemonState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
    mut request: axum::http::Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> Response {
    let path = request.uri().path();
    // The credential, in the order the two forms are trusted. A bearer header is what
    // every HTTP caller sends and what every other route answers to; the subprotocol
    // form exists only because a browser cannot set a header on a WebSocket handshake,
    // and it is read on `/events` and nowhere else. A token in the URL is never read at
    // all — see [`subprotocol_token`].
    let token = bearer_token(&headers);
    let token = if token.is_empty() && path == EVENTS_PATH {
        subprotocol_token(&headers)
    } else {
        token
    };

    if path == "/health" {
        // The one route that answers without a credential is still bounded, per peer:
        // an unauthenticated free path is a limiter an attacker routes around.
        let ceiling = state.rates.transport().check(&rate_key(None, Some(peer)));
        if !ceiling.is_allowed() {
            return http_refusal(
                axum::http::StatusCode::TOO_MANY_REQUESTS,
                serde_json::json!({ "error": "rate limited" }),
                Some(ceiling.retry_after_secs()),
            );
        }
        return next.run(request).await;
    }

    let actor = state
        .sessions
        .resolve(&token, &state.active_pairings().await);
    let key = rate_key(actor.as_ref().map(|actor| actor.key()), Some(peer));

    let ceiling = state.rates.transport().check(&key);
    if !ceiling.is_allowed() {
        state.report_refusal("http-transport", &key);
        return http_refusal(
            axum::http::StatusCode::TOO_MANY_REQUESTS,
            serde_json::json!({ "error": "rate limited" }),
            Some(ceiling.retry_after_secs()),
        );
    }

    let Some(actor) = actor else {
        // `/events` is the only authenticated surface on this listener. Everything
        // else it can answer without a session is the static remote UI (a built SPA's
        // `index.html`, its hashed assets, its client routes) or a 404 — neither is a
        // secret, and a browser loading a remote page cannot attach a bearer header
        // to the `<script>`/`<link>`/history-route requests it makes. The ceiling
        // above still bounds every caller per peer. With no bundle configured this
        // pass-through reaches a router that 404s the path, exactly as before; an
        // unauthenticated `/events` is still refused, and the RPC surface on the
        // other port authenticates in its own transport and is unaffected.
        if path != EVENTS_PATH {
            return next.run(request).await;
        }
        warn!("Unauthorized request to {path}");
        return http_refusal(
            axum::http::StatusCode::UNAUTHORIZED,
            serde_json::json!({ "error": "unauthorized" }),
            None,
        );
    };

    request.extensions_mut().insert(actor);
    next.run(request).await
}

/// A refusal on the daemon's HTTP listener, with the wait a rate-limited caller must
/// honour before trying again.
fn http_refusal(
    status: axum::http::StatusCode,
    body: serde_json::Value,
    retry_after_secs: Option<u64>,
) -> Response {
    let mut builder = axum::http::Response::builder().status(status);
    if let Some(secs) = retry_after_secs {
        builder = builder.header(axum::http::header::RETRY_AFTER, retry_after_header(secs));
    }
    builder
        .header(
            axum::http::header::CONTENT_TYPE,
            axum::http::HeaderValue::from_static("application/json"),
        )
        .body(axum::body::Body::from(body.to_string()))
        .unwrap_or_else(|_| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                body.to_string(),
            )
                .into_response()
        })
}

// ============================================================ static remote UI

/// The environment variable that opts the daemon's HTTP listener into serving a
/// pre-built remote UI bundle from disk (see [`DaemonConfig::remote_assets_dir`]).
pub const REMOTE_ASSETS_DIR_ENV: &str = "WARSHA_REMOTE_ASSETS_DIR";

/// Paths static serving must never answer, even through the fallback. `/events` and
/// `/health` are matched routes that win over the fallback at the router, and their
/// *prefixed* children are refused here so a stray `/health/notes` or `/events/x`
/// cannot render the SPA shell instead of the daemon's own answer; `/rpc` belongs to
/// the RPC listener on [`DaemonConfig::ws_port`], and a request that reached this
/// port for it gets a refusal, not an HTML page that would hide the misroute.
fn is_reserved_static_path(path: &str) -> bool {
    path == EVENTS_PATH
        || path.starts_with("/events/")
        || path == "/health"
        || path.starts_with("/health/")
        || path == "/rpc"
        || path.starts_with("/rpc/")
}

/// The fallback handler of the HTTP listener when a remote UI bundle is configured.
///
/// What it serves, in priority order: a real file under the bundle directory; an
/// `index.html` inside a matched directory; the SPA history fallback for an
/// extension-less client route (`/runs/<id>` and friends); otherwise 404. Anything
/// that tries to leave the bundle directory — a `..` in any spelling, percent-encoded
/// included, or the Windows separators — is a 400 rather than a read attempt, and a
/// reserved daemon path is a 404 rather than a page. The bundle is public UI: no
/// response here carries a credential, and the rate ceiling in
/// [`auth_handler_inner`] bounds the caller per peer exactly as it bounds every
/// other route.
async fn static_asset_handler(
    State(state): State<Arc<DaemonState>>,
    request: axum::http::Request<axum::body::Body>,
) -> Response {
    let Some(assets_dir) = state.config.remote_assets_dir.clone() else {
        return static_not_found();
    };
    if !matches!(request.method().as_str(), "GET" | "HEAD") {
        return static_not_found();
    }
    let path = request.uri().path();
    if is_reserved_static_path(path) {
        return static_not_found();
    }

    // Decode *before* splitting: a traversal arrives as `/%2e%2e/etc/passwd` exactly
    // as it arrives as `/../etc/passwd`, and the second form is what a naive proxy
    // forwards. Every segment is then checked for the shapes that mean "outside" —
    // the dot-dot, the backslash and colon spellings of a Windows escape (a bare
    // drive letter is the colon case), and control characters no served file is
    // named with.
    let decoded = percent_decode_path(path);
    let mut segments: Vec<&str> = Vec::new();
    for segment in decoded.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".."
            || segment.contains('\\')
            || segment.contains(':')
            || segment.chars().any(|c| (c as u32) < 0x20)
        {
            return static_bad_request();
        }
        segments.push(segment);
    }

    // The bundle root as the operating system sees it, so the containment check
    // below compares resolved paths and a symlink into `/etc` cannot pass it. A root
    // that does not exist serves nothing; that is a 404, not a broken daemon.
    let Ok(root) = tokio::fs::canonicalize(&assets_dir).await else {
        return static_not_found();
    };
    let mut candidate = root.clone();
    for segment in &segments {
        candidate.push(segment);
    }
    if !candidate.starts_with(&root) {
        return static_bad_request();
    }

    if let Ok(canonical_candidate) = tokio::fs::canonicalize(&candidate).await {
        if !canonical_candidate.starts_with(&root) {
            return static_bad_request();
        }
        if let Ok(meta) = tokio::fs::metadata(&canonical_candidate).await {
            if meta.is_file() {
                return serve_static_file(&canonical_candidate, path).await;
            }
        }
    }

    // A directory gets its own index.html when it has one; a missing path
    // falls through to the SPA rule.
    let dir_index = candidate.join("index.html");
    if let Ok(canonical_dir_index) = tokio::fs::canonicalize(&dir_index).await {
        if !canonical_dir_index.starts_with(&root) {
            return static_bad_request();
        }
        if let Ok(meta) = tokio::fs::metadata(&canonical_dir_index).await {
            if meta.is_file() {
                return serve_static_file(&canonical_dir_index, path).await;
            }
        }
    }

    // History fallback: a client route's last segment carries no extension.
    // A path that *looks* like a file (`/missing-hash.js`) is a plain 404, so
    // a stale bundle reference never masquerades as the app shell.
    if segments.last().is_some_and(|last| last.contains('.')) {
        return static_not_found();
    }
    let spa_index = root.join("index.html");
    if let Ok(canonical_spa_index) = tokio::fs::canonicalize(&spa_index).await {
        if canonical_spa_index.starts_with(&root) {
            if let Ok(meta) = tokio::fs::metadata(&canonical_spa_index).await {
                if meta.is_file() {
                    return serve_static_file(&canonical_spa_index, path).await;
                }
            }
        }
    }
    static_not_found()
}

/// One bundle file onto the wire, with the type and caching its name decides.
async fn serve_static_file(full: &Path, request_path: &str) -> Response {
    let Ok(bytes) = tokio::fs::read(full).await else {
        return static_not_found();
    };
    let response = axum::http::Response::builder()
        .status(axum::http::StatusCode::OK)
        .header(
            axum::http::header::CONTENT_TYPE,
            axum::http::HeaderValue::from_static(static_content_type(full)),
        )
        .header(
            axum::http::header::CACHE_CONTROL,
            axum::http::HeaderValue::from_static(static_cache_control(request_path, full)),
        )
        .body(axum::body::Body::from(bytes));
    response.unwrap_or_else(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "could not build the static response",
        )
            .into_response()
    })
}

fn static_not_found() -> Response {
    http_refusal(
        axum::http::StatusCode::NOT_FOUND,
        serde_json::json!({ "error": "not found" }),
        None,
    )
}

fn static_bad_request() -> Response {
    http_refusal(
        axum::http::StatusCode::BAD_REQUEST,
        serde_json::json!({ "error": "invalid path" }),
        None,
    )
}

/// Percent-decode a URI path. A malformed escape (`%zz`, a truncated `%a`) is kept
/// verbatim rather than refused: it cannot form a path segment this handler serves,
/// and passing it through keeps the segment checks the single place refusals happen.
fn percent_decode_path(input: &str) -> String {
    fn hex_value(byte: u8) -> Option<u8> {
        match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            b'A'..=b'F' => Some(byte - b'A' + 10),
            _ => None,
        }
    }

    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let high = hex_value(bytes[index + 1]);
            let low = hex_value(bytes[index + 2]);
            if let (Some(high), Some(low)) = (high, low) {
                out.push(high * 16 + low);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The `Content-Type` a bundle file is served with, by extension. The set is the one
/// a built SPA ships; anything else is opaque bytes, never guessed HTML, so a bundle
/// file with an unknown name cannot become an active document on the daemon's origin.
fn static_content_type(full: &Path) -> &'static str {
    let extension = full
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase());
    match extension.as_deref() {
        Some("html") | Some("htm") => "text/html; charset=utf-8",
        Some("js") | Some("mjs") | Some("cjs") => "application/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") | Some("map") => "application/json",
        Some("webmanifest") => "application/manifest+json",
        Some("txt") => "text/plain; charset=utf-8",
        Some("xml") => "application/xml",
        Some("wasm") => "application/wasm",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        _ => "application/octet-stream",
    }
}

/// The `Cache-Control` a bundle file is served with.
///
/// `index.html` — directly, as `/`, or as the history fallback — is `no-cache`: it is
/// the one file whose content a redeploy changes without changing its name, and a
/// stale shell is a black screen (the remote UI's P0). A hashed asset — under the
/// bundle's `/assets/` prefix or carrying a content hash in its name — is immutable
/// for a year, which is what its name is *for*: the same URL never means different
/// bytes. Everything else is `no-cache` too; serving a misnamed live file from a CDN
/// cache is the failure this table exists to prevent.
fn static_cache_control(request_path: &str, full: &Path) -> &'static str {
    let file_name = full.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if file_name.eq_ignore_ascii_case("index.html") {
        return "no-cache";
    }
    let under_assets = percent_decode_path(request_path).starts_with("/assets/");
    if under_assets || looks_hashed_file_name(file_name) {
        return "public, max-age=31536000, immutable";
    }
    "no-cache"
}

/// Whether a bundle file name carries a content hash after its last hyphen — the
/// `app-1234abcd.js`, `index-D2hP1rSv9Q.js` shape every modern bundler emits. The
/// tail must be at least eight alphanumeric characters and contain a digit, so
/// `vendor-polyfill.js` and `-legacy` suffixes stay cache-revalidating.
fn looks_hashed_file_name(file_name: &str) -> bool {
    let stem = file_name
        .rsplit_once('.')
        .map_or(file_name, |(stem, _extension)| stem);
    stem.rsplit_once('-')
        .map(|(_prefix, hash)| {
            hash.len() >= 8
                && hash.chars().all(|c| c.is_ascii_alphanumeric())
                && hash.chars().any(|c| c.is_ascii_digit())
        })
        .unwrap_or(false)
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
async fn events_handler(
    State(state): State<Arc<DaemonState>>,
    Query(params): Query<EventStreamParams>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let last_event_id = last_event_id_header(&headers);
    ws.protocols([EVENTS_SUBPROTOCOL])
        .on_upgrade(move |socket| handle_events_socket(socket, state, params, last_event_id))
}

/// The `/events` query string: an optional replay cursor and an optional run filter.
/// Both default to absent, so a bare `GET /events` still upgrades and streams live
/// exactly as it did before this existed.
#[derive(Debug, Clone, Deserialize, Default)]
struct EventStreamParams {
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

    loop {
        tokio::select! {
            received = rx.recv() => {
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
            _ = ping_interval.tick() => {
                if socket.send(axum::extract::ws::Message::Ping(vec![])).await.is_err() {
                    break;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use warsha_providers::InMemorySecretStore;

    #[test]
    fn the_default_backend_kit_comes_from_the_run_project() {
        let kit = default_backend_kit("Shop");

        assert_eq!(kit.config.kind, BackendKind::PocketBase);
        assert_eq!(kit.config.url, LOCAL_POCKETBASE_URL);
        // The project name, not the run id, names the export and its archive.
        assert_eq!(kit.config.project_name, "Shop");
        assert!(kit.config.enabled_features.is_empty());
        assert!(kit.is_empty());
        assert!(kit.export().sql_dump.contains("-- project: Shop"));
    }

    #[tokio::test]
    async fn test_config_generation() {
        let temp_dir = crate::test_util::fresh_tempdir();
        let config_path = temp_dir.path().join("config.toml");

        let config = DaemonConfig {
            data_dir: temp_dir.path().to_path_buf(),
            auth_token: "test-token".to_string(),
            ..Default::default()
        };

        let content = toml::to_string_pretty(&config).unwrap();
        std::fs::write(&config_path, content).unwrap();

        let loaded: DaemonConfig =
            toml::from_str(&std::fs::read_to_string(&config_path).unwrap()).unwrap();
        assert_eq!(loaded.auth_token, "test-token");
    }

    /// A daemon state over a temporary store, plus the store so a test can write
    /// the project and run the RPC reads.
    async fn test_state(data_dir: &Path) -> (Arc<DaemonState>, Arc<Store>) {
        test_state_with(data_dir, |_| {}).await
    }

    /// The same state with a configuration the test names.
    ///
    /// `configure` runs before the sessions and the ceilings are built from the
    /// configuration, so a test that wants a command allowed by the process policy or
    /// a bucket small enough to overflow in one loop gets exactly that.
    async fn test_state_with(
        data_dir: &Path,
        configure: impl FnOnce(&mut DaemonConfig),
    ) -> (Arc<DaemonState>, Arc<Store>) {
        std::fs::create_dir_all(data_dir).expect("the data directory is made");
        let mut config = DaemonConfig {
            data_dir: data_dir.to_path_buf(),
            auth_token: "test-token".to_string(),
            ..Default::default()
        };
        configure(&mut config);
        let store = Arc::new(
            Store::open_at(data_dir.join("warsha.db"))
                .await
                .expect("the store opens"),
        );
        let providers = Arc::new(RwLock::new(agent_router_with_mock()));
        let settings = Arc::new(
            SettingsStore::open(&data_dir.join("warsha.db"))
                .await
                .expect("the settings open"),
        );
        let pipeline = Arc::new(warsha_pipeline::PipelineEngine::new(
            store.clone(),
            providers.clone(),
            settings.clone(),
        ));
        let identity = warsha_remote::DeviceIdentity::generate("test daemon".to_string())
            .expect("a device identity");
        // The same seeding a real start performs, so a test's daemon answers
        // `harness.list` with the presets it ships and a catalog write has the row
        // under it that production would have.
        wave2::seed_bundled_records(&settings)
            .await
            .expect("the bundled catalogs seed");

        let routines = Arc::new(RwLock::new(RoutineRegistry::new()));
        let routine_runner: Arc<dyn RoutineRunner + Send + Sync> =
            Arc::new(warsha_pipeline::MockRoutineRunner::new());
        let routine_scheduler = Arc::new(RoutineScheduler::new(routines.clone(), routine_runner));

        // A hand-built state carries the same session and ceiling wiring a real one
        // does: the daemon's own token is the owner session and speaks as the daemon's
        // device, which is exactly the desktop's situation.
        let sessions = Arc::new(Sessions::new(config.auth_token.clone(), identity.device_id));
        let rates = Arc::new(RateGovernor::new(&config.rate_limits));

        // One spawner for the daemon: the MCP stdio transport starts its server
        // through it and the live preview runs its dev server on it, so `process.list`
        // is the one place that names every child.
        let processes: Arc<dyn ProcessManager> = InMemoryProcessManager::shared();
        let mcp: Arc<dyn McpManager> = Arc::new(InMemoryMcpManager::new(processes.clone()));
        let previews = Arc::new(LivePreviewManager::new(processes.clone()));

        // The agent loop's two seams, wired to the real thing: its file tools run
        // inside `<data_dir>/workspace`, and its model calls go out through the same
        // router the pipeline stages use — a router that now holds the configured
        // providers and the owner's routing, so an Agent-mode turn reaches a model
        // rather than reporting that nothing is wired.
        let default_kit = Arc::new(RwLock::new(default_backend_kit("default")));
        let agent_loop = build_agent_loop(
            &config.data_dir,
            providers.clone(),
            mcp.clone(),
            default_kit,
        );

        let state = Arc::new(DaemonState {
            config,
            store: store.clone(),
            providers,
            pipeline,
            backends: BackendFactory::all_available(),
            github: None,
            devices: Arc::new(DeviceRegistry::new(identity)),
            backend_kits: Arc::new(RwLock::new(HashMap::new())),
            crash_reports: Arc::new(RwLock::new(InMemoryCrashReportStore::new())),
            store_reviews: Arc::new(RwLock::new(InMemoryStoreReviewStore::new())),
            agent_loop,
            processes,
            mcp,
            previews,
            settings,
            // The seeded maps are what `start_daemon` builds; a state built by hand
            // starts from the defaults and no rows, which is the same shape.
            run_modes: Arc::new(RwLock::new(
                RunMode::all()
                    .into_iter()
                    .map(|mode| (mode, RunModeConfig::for_mode(mode)))
                    .collect(),
            )),
            preferences: Arc::new(RwLock::new(InMemoryPreferenceStore::new())),
            stored_preferences: Arc::new(RwLock::new(HashMap::new())),
            pairings: Arc::new(RwLock::new(InMemoryPairingStore::new())),
            // A state built by hand is a state under test: no OS keychain is
            // reached, and a test that adds a provider can read its key back.
            secrets: Arc::new(InMemorySecretStore::new()),
            routines,
            routine_scheduler,
            sessions,
            rates,
            // The offline factory and no routing: a hand-built state is a state under
            // test, and a test that wants a routing sets one through `roles.set`.
            role_routings: Arc::new(RwLock::new(HashMap::new())),
            provider_factory: Arc::new(MockProviderFactory::new()),
            // No listener has bound: a hand-built state is a daemon that is not serving,
            // and `devices.pair-start` refuses rather than advertising a made-up origin.
            pairing_origin: std::sync::OnceLock::new(),
            // A hand-built state has no background pump, so this sequencer stays empty
            // unless a test publishes onto it directly; the live stream is exercised by
            // the real-daemon tests.
            events: Arc::new(EventSequencer::new()),
        });
        (state, store)
    }

    /// The request extensions a verified **owner** session arrives with.
    ///
    /// This is what the daemon's transport puts on a request after it checked the
    /// bearer credential, so a test that calls an RPC with these extensions is in the
    /// same position as the desktop app holding the daemon's own token.
    fn owner_ext() -> RpcExtensions {
        owner_ext_as(DeviceId::new())
    }

    /// The owner session speaking as a particular device, so a test can name the
    /// approver it expects to be recorded.
    fn owner_ext_as(device_id: DeviceId) -> RpcExtensions {
        let mut ext = RpcExtensions::new();
        ext.insert(Actor::owner(device_id));
        ext
    }

    /// The extensions a **paired device** session arrives with.
    fn paired_ext(device_id: &str) -> RpcExtensions {
        let mut ext = RpcExtensions::new();
        ext.insert(Actor::paired(&PhonePairing::new(
            device_id,
            "a-pairing-secret",
            1_700_000_000,
        )));
        ext
    }

    /// The extensions of a request that never authenticated: an empty map, because
    /// nothing but the transport can put an actor in one.
    fn anonymous_ext() -> RpcExtensions {
        RpcExtensions::new()
    }

    /// The `code` of a JSON-RPC error, for asserting *which* refusal a caller got.
    fn rpc_error_code(error: &jsonrpsee::types::ErrorObjectOwned) -> i32 {
        error.code()
    }

    // ---- Security audit S1a: identity, authorization and the policy floor.

    /// Every method the server registers has a policy, and every policy names a
    /// method the server registers.
    ///
    /// This is the check that the authorization table is the whole surface rather than
    /// a list of the methods someone remembered: an RPC added later without an entry
    /// fails here instead of shipping unauthenticated-by-omission.
    #[tokio::test]
    async fn every_registered_method_has_a_policy_and_no_policy_names_a_missing_one() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = test_state(temp.path()).await;
        let module = WarshaRpc::new(state).into_rpc();

        let registered: std::collections::BTreeSet<&str> = module.method_names().collect();
        let table: std::collections::BTreeSet<&str> = auth::METHOD_POLICIES
            .iter()
            .map(|entry| entry.method)
            .collect();

        let unpoliced: Vec<&str> = registered.difference(&table).copied().collect();
        assert!(
            unpoliced.is_empty(),
            "methods the daemon serves with no entry in the policy table: {unpoliced:?}"
        );
        let unknown: Vec<&str> = table.difference(&registered).copied().collect();
        assert!(
            unknown.is_empty(),
            "the policy table names methods the daemon does not serve: {unknown:?}"
        );

        // The structural half of re-audit LOAD-1 finding 1. A method that is not handed
        // its caller cannot reach `authorize()`, and a `Tier` nobody spends is a ceiling
        // on paper — that is exactly how 24 read methods ended up bounded only by the
        // transport. Scanning the declarations is the check that keeps a new method from
        // joining that set by accident, which is what the behaviour tests below cannot see
        // until someone remembers to write one.
        let source = include_str!("lib.rs");
        let trait_body = source
            .split("pub trait WarshaApi {")
            .nth(1)
            .expect("the RPC trait is declared")
            .split("\n}")
            .next()
            .expect("the RPC trait has an end");
        let declared: Vec<&str> = trait_body
            .lines()
            .filter(|line| line.trim_start().starts_with("#[method(name ="))
            .collect();
        let without_session: Vec<&&str> = declared
            .iter()
            .filter(|line| !line.contains("with_extensions"))
            .collect();
        assert!(
            without_session.is_empty(),
            "methods declared without `with_extensions`, so their handlers cannot see the \
             caller and cannot spend their tier: {without_session:?}"
        );
        assert_eq!(
            declared.len(),
            auth::METHOD_POLICIES.len(),
            "the trait declares {} methods and the policy table names {}",
            declared.len(),
            auth::METHOD_POLICIES.len()
        );
    }

    #[tokio::test]
    async fn an_authorized_method_refuses_no_session_and_a_paired_device_differently() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);
        let project = ProjectId::new();

        // No verified session: the caller is nobody.
        let no_session = rpc
            .set_budget(&anonymous_ext(), project, 500)
            .await
            .expect_err("a caller with no session set a budget");
        assert_eq!(
            rpc_error_code(&no_session),
            auth::rpc_codes::UNAUTHENTICATED,
            "an unauthenticated caller got the wrong refusal"
        );

        // A verified session that is not the owner: somebody, but not that.
        let phone = uuid::Uuid::new_v4().to_string();
        let paired = rpc
            .set_budget(&paired_ext(&phone), project, 500)
            .await
            .expect_err("a paired device set a budget");
        assert_eq!(
            rpc_error_code(&paired),
            auth::rpc_codes::FORBIDDEN,
            "a paired device was allowed an owner's mutation"
        );

        // The same refusal shape on the other privileged surfaces.
        for (method, result) in [
            (
                "roles.set",
                rpc.set_role(&paired_ext(&phone), role_config())
                    .await
                    .map(|_| ()),
            ),
            (
                "backend.set",
                rpc.set_backend(
                    &paired_ext(&phone),
                    "run".to_string(),
                    default_backend_kit("Shop"),
                )
                .await
                .map(|_| ()),
            ),
        ] {
            let error = result.expect_err(&format!("{method} accepted a paired device"));
            assert_eq!(
                rpc_error_code(&error),
                auth::rpc_codes::FORBIDDEN,
                "{method} refused a paired device for the wrong reason"
            );
        }
    }

    #[tokio::test]
    async fn a_gate_decision_refuses_a_device_id_that_is_not_the_session() {
        // Audit H-03, at the seam: the legacy param is accepted, and a value that is
        // not the authenticated device is refused without touching the run.
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(temp.path()).await;
        let run = stored_run_with_gate(&store, "Shop").await;
        let rpc = WarshaRpc::new(state.clone());

        let session_device = DeviceId::new();
        let ext = owner_ext_as(session_device);
        let claimed = DeviceId::new();

        let error = rpc
            .approve_gate(&ext, run.id, Stage::GateA, Some(claimed))
            .await
            .expect_err("a spoofed approver was recorded");
        assert_eq!(
            rpc_error_code(&error),
            auth::rpc_codes::IDENTITY_MISMATCH,
            "a claimed device id was not refused as a mismatch"
        );

        let untouched = store.get_run(run.id).await.expect("the run is readable");
        assert!(
            matches!(untouched.gate_states[&Stage::GateA], GateState::Pending),
            "the refused decision still moved the gate"
        );

        // The session's own id, sent the old way, is accepted — and what is recorded is
        // the session's device either way.
        let approved = rpc
            .approve_gate(&ext, run.id, Stage::GateA, Some(session_device))
            .await
            .expect("the session's own device id is accepted");
        assert!(
            matches!(
                approved.gate_states[&Stage::GateA],
                GateState::Approved { by, .. } if by == session_device
            ),
            "the approver recorded is not the session's device"
        );

        let omitted = rpc
            .reject_gate(&ext, run.id, Stage::GateB, "not yet".to_string(), None)
            .await
            .expect("a decision with no legacy param is served");
        assert!(
            matches!(
                omitted.gate_states[&Stage::GateB],
                GateState::Rejected { by, .. } if by == session_device
            ),
            "a decision without the legacy field lost its decider"
        );
    }

    #[tokio::test]
    async fn a_session_with_no_device_id_cannot_be_recorded_as_an_approver() {
        // A pairing whose id is not a device id is a real session for reads, and has no
        // approver to record: the daemon says so rather than storing an invented uuid.
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(temp.path()).await;
        let run = stored_run_with_gate(&store, "Shop").await;
        let rpc = WarshaRpc::new(state);

        let error = rpc
            .approve_gate(
                &paired_ext("a-phone-that-named-itself"),
                run.id,
                Stage::GateA,
                None,
            )
            .await
            .expect_err("a session with no device id approved a gate");
        assert_eq!(
            rpc_error_code(&error),
            auth::rpc_codes::IDENTITY_MISMATCH,
            "an unrecordable approver was accepted"
        );
    }

    #[tokio::test]
    async fn the_pipeline_refuses_a_gate_decision_for_no_device() {
        // The floor under the daemon (audit H-03): even a caller that reached the
        // pipeline directly cannot record the nil device as an approver.
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(temp.path()).await;
        let run = stored_run_with_gate(&store, "Shop").await;

        let nobody = DeviceId(uuid::Uuid::nil());
        let error = state
            .pipeline
            .approve_gate(run.id, Stage::GateA, nobody)
            .await
            .expect_err("a nil device approved a gate");
        assert!(
            error.to_string().contains("verified acting device"),
            "unexpected error: {error}"
        );
    }

    // ---- gates.list (issue #25): the queue read served from `Run.gate_states`.

    #[tokio::test]
    async fn gates_list_answers_every_gate_stage_in_pipeline_order() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(temp.path()).await;
        let run = stored_run_with_gate(&store, "Shop").await;
        let rpc = WarshaRpc::new(state);

        let gates = rpc
            .list_gates(&owner_ext(), run.id, None)
            .await
            .expect("the queue is served");
        let stages: Vec<Stage> = gates.iter().map(|gate| gate.stage).collect();
        assert_eq!(
            stages,
            vec![Stage::GateA, Stage::GateB, Stage::GateC, Stage::GateD],
            "the queue is not the four gate stages in `Stage::all()` order"
        );
        // The helper seeded `gate_a` and `gate_b` as explicit Pending entries and left
        // `gate_c`/`gate_d` out of the map: a missing key answers Pending, it is neither
        // a dropped row nor a refusal, and nothing is filtered out client-side here.
        for gate in &gates {
            assert_eq!(
                gate.state,
                GateSummaryState::Pending,
                "{:?} answered decided before anyone decided it",
                gate.stage
            );
        }

        // The ledger reads the same `Run.gate_states` the decisions mutate: approving
        // gate_a moves its answer on the next read, through the store.
        rpc.approve_gate(&owner_ext(), run.id, Stage::GateA, None)
            .await
            .expect("gate_a is approved");
        let after = rpc
            .list_gates(&owner_ext(), run.id, None)
            .await
            .expect("the queue is re-read");
        assert!(
            matches!(after[0].state, GateSummaryState::Approved { .. }),
            "a decision did not move the queue read: {after:?}"
        );
    }

    #[tokio::test]
    async fn gates_list_answers_the_flat_state_shape_the_client_declares() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(temp.path()).await;
        let run = stored_run(&store, "Shop", None).await;
        let mut run = store.get_run(run.id).await.expect("the run is readable");
        let device = DeviceId(
            uuid::Uuid::parse_str("00000000-0000-0000-0000-00000000000a")
                .expect("a fixed device id"),
        );
        let at = chrono::DateTime::parse_from_rfc3339("2026-11-03T09:30:00Z")
            .expect("a fixed instant")
            .with_timezone(&Utc);
        run.gate_states
            .insert(Stage::GateA, GateState::Approved { by: device, at });
        run.gate_states.insert(
            Stage::GateB,
            GateState::Rejected {
                reason: "not this".to_string(),
                by: device,
                at,
            },
        );
        run.gate_states.insert(
            Stage::GateC,
            GateState::ChangesRequested {
                notes: "tighten the brief".to_string(),
                by: device,
                at,
            },
        );
        // `gate_d` is deliberately absent: it must answer `{"state": "pending"}`.
        store.update_run(&run).await.expect("the states are stored");
        let rpc = WarshaRpc::new(state);

        let gates = rpc
            .list_gates(&owner_ext(), run.id, None)
            .await
            .expect("the queue is served");
        let wire = serde_json::to_value(&gates).expect("the queue serializes");
        // Literally the shape `@warsha/client` declares (`GateSummary`/`GateState` in
        // `packages/client/src/index.ts`): `by`, `at`, `reason` and `notes` sit beside
        // `state`, never under a `detail` object — `detail` is the adjacent-tagged
        // `runs.get` shape (`security_identity.rs` reads `approved["detail"]["by"]`),
        // and the queue must not fork it.
        assert_eq!(
            wire,
            serde_json::json!([
                {
                    "stage": "gate_a",
                    "state": {
                        "state": "approved",
                        "by": "00000000-0000-0000-0000-00000000000a",
                        "at": "2026-11-03T09:30:00Z"
                    }
                },
                {
                    "stage": "gate_b",
                    "state": {
                        "state": "rejected",
                        "reason": "not this",
                        "by": "00000000-0000-0000-0000-00000000000a",
                        "at": "2026-11-03T09:30:00Z"
                    }
                },
                {
                    "stage": "gate_c",
                    "state": {
                        "state": "changes_requested",
                        "notes": "tighten the brief",
                        "by": "00000000-0000-0000-0000-00000000000a",
                        "at": "2026-11-03T09:30:00Z"
                    }
                },
                {
                    "stage": "gate_d",
                    "state": { "state": "pending" }
                }
            ])
        );
    }

    #[tokio::test]
    async fn gates_list_refuses_a_run_the_store_does_not_have() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);

        let error = rpc
            .list_gates(&owner_ext(), RunId::new(), None)
            .await
            .expect_err("a run the store does not have answered a queue");
        assert_eq!(
            rpc_error_code(&error),
            -32000,
            "an unknown run was refused for a reason other than the store's error"
        );
        assert!(
            error.message().contains("run not found"),
            "unexpected refusal: {error}"
        );
    }

    #[tokio::test]
    async fn the_gates_queue_reads_on_any_verified_session_and_refuses_without_one() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(temp.path()).await;
        let run = stored_run_with_gate(&store, "Shop").await;
        let rpc = WarshaRpc::new(state);

        // Unauthenticated reads nothing: `-32001` from `authorize`, before any tier.
        let anonymous = rpc
            .list_gates(&anonymous_ext(), run.id, None)
            .await
            .expect_err("an unauthenticated caller read the queue");
        assert_eq!(
            rpc_error_code(&anonymous),
            auth::rpc_codes::UNAUTHENTICATED,
            "a caller with no session read the gates queue"
        );

        // A paired phone reads the very queue it is asked to decide (#25's auth
        // decision: `Session`/`Standard`, the `runs.list` class, not `Auth`).
        let phone = uuid::Uuid::new_v4().to_string();
        let paired = rpc
            .list_gates(&paired_ext(&phone), run.id, None)
            .await
            .expect("a paired device was refused the queue it decides");
        assert_eq!(paired.len(), 4, "the queue is not all four gate stages");

        // The owner reads it too, and the legacy `device_id` slot is accepted and
        // believed for nothing: naming some other device changes no answer.
        let claimed = DeviceId::new();
        let owner = rpc
            .list_gates(&owner_ext(), run.id, Some(claimed))
            .await
            .expect("the owner was refused its own queue");
        assert_eq!(
            owner, paired,
            "a claimed device id changed what the queue read answered"
        );
    }

    #[tokio::test]
    async fn gates_list_is_registered_and_policied_as_one_method() {
        // Registry==policy for the new name, in both views. The whole-set invariant is
        // `every_registered_method_has_a_policy_and_no_policy_names_a_missing_one`;
        // this pins `gates.list` by name so a one-sided addition fails at the name
        // rather than only at the count.
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = test_state(temp.path()).await;
        let module = WarshaRpc::new(state).into_rpc();
        assert!(
            module.method_names().any(|name| name == "gates.list"),
            "the server does not register gates.list"
        );

        let policy = auth::policy_of("gates.list").expect("gates.list has a policy row");
        assert_eq!(policy.policy, Policy::Session);
        assert_eq!(policy.tier, Tier::Standard);
    }

    #[tokio::test]
    async fn process_and_mcp_control_refuse_an_unlisted_program_and_a_remote_transport() {
        let temp = crate::test_util::fresh_tempdir();
        // Only `cargo` is admitted, by configuration rather than by a caller.
        let (state, _store) = test_state_with(temp.path(), |config| {
            config.allowed_commands = vec!["cargo".to_string()];
        })
        .await;
        let rpc = WarshaRpc::new(state);
        let ext = owner_ext();

        for (command, args) in [
            ("rm", vec!["-rf".to_string()]),
            ("sh", vec![]),
            ("npm", vec![]),
            ("", vec![]),
        ] {
            let error = rpc
                .spawn_process(&ext, command.to_string(), args, HashMap::new())
                .await
                .expect_err(&format!("`{command}` was started"));
            assert_eq!(
                rpc_error_code(&error),
                auth::rpc_codes::POLICY_REFUSED,
                "`{command}` was refused for a reason other than the policy"
            );
        }

        // An environment variable that changes execution is refused on its own.
        for key in ["PATH", "LD_PRELOAD", "NODE_OPTIONS"] {
            let mut env = HashMap::new();
            env.insert(key.to_string(), "/tmp".to_string());
            let error = rpc
                .spawn_process(&ext, "cargo".to_string(), vec![], env)
                .await
                .expect_err(&format!("{key} was handed to a child"));
            assert_eq!(
                rpc_error_code(&error),
                auth::rpc_codes::POLICY_REFUSED,
                "{key} reached a child process"
            );
        }

        // An allowed program is still startable: the policy restricts, it does not
        // disable the daemon's own workflow.
        let started = rpc
            .spawn_process(
                &ext,
                "cargo".to_string(),
                vec!["--version".to_string()],
                HashMap::new(),
            )
            .await
            .expect("an allowed program starts");
        rpc.stop_process(&ext, started).await.ok();

        // MCP transports: a stdio program is bounded like a spawn, and a remote one is
        // bounded to a secure or loopback endpoint.
        let unlisted =
            warsha_pipeline::mcp_transport::McpServerConfig::new_stdio("bad", "sh", Vec::new());
        let error = rpc
            .connect_mcp(&ext, unlisted)
            .await
            .expect_err("an unlisted stdio MCP server connected");
        assert_eq!(rpc_error_code(&error), auth::rpc_codes::POLICY_REFUSED);

        for url in [
            "http://evil.example/mcp",
            "file:///etc/passwd",
            "http://169.254.169.254/latest",
        ] {
            let error = rpc
                .connect_mcp(
                    &ext,
                    warsha_pipeline::mcp_transport::McpServerConfig::new_http("remote", url),
                )
                .await
                .expect_err(&format!("{url} was recorded"));
            assert_eq!(
                rpc_error_code(&error),
                auth::rpc_codes::POLICY_REFUSED,
                "{url} passed the transport policy"
            );
        }
        rpc.connect_mcp(
            &ext,
            warsha_pipeline::mcp_transport::McpServerConfig::new_http(
                "secure",
                "https://mcp.example/mcp",
            ),
        )
        .await
        .expect("an https MCP endpoint is allowed");
        rpc.connect_mcp(
            &ext,
            warsha_pipeline::mcp_transport::McpServerConfig::new_http(
                "local",
                "http://127.0.0.1:9100/mcp",
            ),
        )
        .await
        .expect("a loopback MCP endpoint is allowed");

        // None of it is reachable without the owner's role.
        let phone = uuid::Uuid::new_v4().to_string();
        let error = rpc
            .spawn_process(
                &paired_ext(&phone),
                "cargo".to_string(),
                vec![],
                HashMap::new(),
            )
            .await
            .expect_err("a paired device reached the process table");
        assert_eq!(rpc_error_code(&error), auth::rpc_codes::FORBIDDEN);
    }

    /// A role-routing config with no targets, for a test that only needs it to parse.
    fn role_config() -> RoleRoutingConfig {
        RoleRoutingConfig {
            role: "coder".to_string(),
            targets: Vec::new(),
            fallback_enabled: false,
            budget_cents_per_run: None,
        }
    }

    /// A stored run sitting at its first two pending gates.
    async fn stored_run_with_gate(store: &Arc<Store>, name: &str) -> Run {
        let run = stored_run(store, name, None).await;
        let mut run = store.get_run(run.id).await.expect("the run is readable");
        run.gate_states.insert(Stage::GateA, GateState::Pending);
        run.gate_states.insert(Stage::GateB, GateState::Pending);
        store.update_run(&run).await.expect("the gates are pending");
        run
    }

    #[test]
    fn a_providers_endpoint_falls_back_to_its_kinds_default() {
        let stored = StoredProvider {
            name: "mine".to_string(),
            kind: "qwen".to_string(),
            api_base: Some("http://127.0.0.1:8000/v1".to_string()),
            enabled: true,
            created_at: 1_700_000_000,
        };
        // What the owner named wins.
        assert_eq!(
            provider_endpoint(&stored).as_deref(),
            Some("http://127.0.0.1:8000/v1")
        );

        // The kind's published default when the owner named none, which is what
        // makes "paste one API key" the whole first-run input.
        let defaulted = StoredProvider {
            api_base: None,
            ..stored.clone()
        };
        assert_eq!(
            provider_endpoint(&defaulted).as_deref(),
            Some(
                OneClickProvider::Qwen
                    .default_base_url()
                    .expect("qwen has a default")
            )
        );

        // A custom endpoint is the owner's to name: no default URL, no default
        // model, and the setup check is what says so.
        let custom = StoredProvider {
            kind: "custom".to_string(),
            api_base: None,
            ..stored
        };
        assert_eq!(provider_endpoint(&custom), None);
        assert_eq!(provider_model(&custom), "");
    }

    #[test]
    fn a_providers_model_comes_from_its_kind_and_blank_input_is_no_input() {
        let kimi = StoredProvider {
            name: "kimi".to_string(),
            kind: "kimi".to_string(),
            api_base: None,
            enabled: true,
            created_at: 1_700_000_000,
        };
        assert_eq!(
            provider_model(&kimi),
            OneClickProvider::Kimi
                .default_model()
                .expect("kimi has a default")
        );
        assert!(!provider_model(&kimi).is_empty());

        // A blank string is no string, and a padded one is trimmed.
        assert_eq!(non_empty(None), None);
        assert_eq!(non_empty(Some("   ".to_string())), None);
        assert_eq!(
            non_empty(Some(" http://127.0.0.1:9/v1 ".to_string())).as_deref(),
            Some("http://127.0.0.1:9/v1")
        );
    }

    /// A provider router with the one mock provider routed for the agent role.
    /// `warsha_providers::MockProvider` is the only provider a test may use
    /// (AGENTS.md): no key, no network, no spend. Routing it for [`AGENT_ROLE`] is
    /// what makes an Agent-mode turn's model path a real router call inside a test.
    fn agent_router_with_mock() -> ProviderRouter {
        let mut router = ProviderRouter::new();
        router.register_provider(Box::new(warsha_providers::MockProvider::new("mock")));
        router.set_role_routing(RoleRouting {
            role: AGENT_ROLE,
            targets: vec![RoutingTarget {
                provider_id: "mock".to_string(),
                model_id: "mock-model".to_string(),
                weight: 100,
            }],
            fallback_enabled: false,
            budget_cents_per_run: None,
        });
        router
    }

    /// Store a project and a run in it, returning the run.
    async fn stored_run(store: &Store, name: &str, repo_path: Option<&Path>) -> Run {
        let project = Project {
            id: ProjectId::new(),
            name: name.to_string(),
            description: format!("{name} description"),
            language: "en".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            repo_path: repo_path.map(|path| path.to_string_lossy().into_owned()),
            repo_url: None,
        };
        store
            .create_project(&project)
            .await
            .expect("the project is stored");

        let run = Run {
            id: RunId::new(),
            project_id: project.id,
            current_stage: Stage::Idea,
            gate_states: HashMap::new(),
            artifacts: HashMap::new(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            status: RunStatus::Running,
            budget_cents: None,
            spent_cents: 0,
        };
        store.create_run(&run).await.expect("the run is stored");
        run
    }

    #[tokio::test]
    async fn apply_handoff_writes_the_files_and_reports_the_conflict_and_backup() {
        use warsha_pipeline::ApplyResult;

        let temp = crate::test_util::fresh_tempdir();
        let working_tree = temp.path().join("repo");
        std::fs::create_dir_all(working_tree.join("src")).expect("the working tree is made");
        std::fs::write(working_tree.join("src/lib.rs"), "local edit\n")
            .expect("the local file is written");

        let (state, store) = test_state(&temp.path().join("data")).await;
        let run = stored_run(&store, "Shop", Some(&working_tree)).await;

        // The bundle the remote run sends back, written where handoff.create puts
        // it: the same directory shape, one JSON file per run.
        let bundle = HandoffManager::new().create_bundle(
            &run.id.0.to_string(),
            &[("src/lib.rs", "remote\n"), ("src/new.rs", "new\n")],
        );
        let handoff_dir = temp.path().join("handoff");
        let path = HandoffManager::new()
            .write_bundle(&bundle, &handoff_dir.to_string_lossy())
            .expect("the bundle is written");

        let rpc = WarshaRpc::new(state);
        let summary = rpc
            .apply_handoff(&owner_ext(), path, false)
            .await
            .expect("a bundle with a project repo is applied");
        let result: ApplyResult = serde_json::from_str(&summary).expect("the summary is a result");

        // Remote wins: the conflict is overwritten and still on record.
        assert_eq!(result.applied, vec!["src/lib.rs", "src/new.rs"]);
        assert_eq!(result.conflicts.len(), 1);
        assert_eq!(result.conflicts[0].path, "src/lib.rs");
        assert!(result.requires_gate());
        // The file the two sides agreed nothing about is a plain write.
        assert_eq!(
            std::fs::read_to_string(working_tree.join("src/new.rs")).expect("the new file"),
            "new\n"
        );
        assert_eq!(
            std::fs::read_to_string(working_tree.join("src/lib.rs")).expect("the overwritten file"),
            "remote\n"
        );

        // The summary names the backup directory, and the local edit is in it.
        let backup_dir = result
            .backup_dir
            .as_deref()
            .expect("the summary names the backup directory");
        assert!(Path::new(backup_dir).starts_with(working_tree.join(".warsha-backup")));
        assert_eq!(
            std::fs::read_to_string(Path::new(backup_dir).join("src/lib.rs"))
                .expect("the backup is readable"),
            "local edit\n"
        );
    }

    #[tokio::test]
    async fn apply_handoff_refuses_a_run_with_no_project_repo() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(temp.path()).await;
        let run = stored_run(&store, "Shop", None).await;

        let bundle = HandoffManager::new().create_bundle(&run.id.0.to_string(), &[("a.rs", "a\n")]);
        let handoff_dir = temp.path().join("handoff");
        let path = HandoffManager::new()
            .write_bundle(&bundle, &handoff_dir.to_string_lossy())
            .expect("the bundle is written");

        let error = WarshaRpc::new(state)
            .apply_handoff(&owner_ext(), path, true)
            .await
            .expect_err("an apply needs a working tree to write into");
        let message = format!("{error:?}");
        assert!(
            message.contains("has no project repo"),
            "unexpected error: {message}"
        );
        // Nothing was written next to the daemon's own bundle file.
        assert!(!handoff_dir.join("a.rs").exists());
    }

    #[tokio::test]
    async fn export_backend_names_the_dump_after_the_run_project() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(&temp.path().join("data")).await;
        let run = stored_run(&store, "Shop", None).await;

        let output_dir = temp.path().join("export");
        let path = WarshaRpc::new(state)
            .export_backend(
                &owner_ext(),
                run.id.0.to_string(),
                output_dir.to_string_lossy().into_owned(),
            )
            .await
            .expect("the export is written");

        assert_eq!(Path::new(&path), output_dir.join("schema.sql").as_path());
        let dump = std::fs::read_to_string(&path).expect("schema.sql is readable");
        // The project, not the run id, names the dump.
        assert!(dump.contains("-- project: Shop"), "unexpected dump: {dump}");
        assert!(dump.contains("-- backend: PocketBase"));
    }

    #[tokio::test]
    async fn skills_list_reports_the_slash_command_catalog() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = test_state(temp.path()).await;

        let skills = WarshaRpc::new(state)
            .list_skills(&owner_ext())
            .await
            .expect("the catalog is served");

        let ids: Vec<&str> = skills.iter().map(|skill| skill.id.as_str()).collect();
        assert!(skills.len() >= 12);
        assert!(ids.contains(&"brainstorming"));
        assert!(ids.contains(&"writing-plans"));
        assert!(ids.contains(&"test-driven-development"));
        assert!(skills
            .iter()
            .all(|skill| !skill.description.trim().is_empty()));
        // The in-process slash command catalog resolves as a registry:
        let catalog = skill_catalog();
        let registry = SlashCommandRegistry::from_skills(&catalog);
        assert_eq!(
            registry.lookup("/FIX").map(|command| command.name.as_str()),
            Some("/fix")
        );
    }

    #[tokio::test]
    async fn agent_turn_plans_first_and_executes_after_the_owner_approves() {
        use warsha_pipeline::AgentMode;

        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state.clone());

        let planned = rpc
            .agent_turn(
                &owner_ext(),
                "/review the diff of @file src/main.rs".to_string(),
            )
            .await
            .expect("a plan turn answers");
        assert_eq!(planned.mode, AgentMode::Plan);
        assert_eq!(
            planned
                .command
                .as_ref()
                .map(|command| command.name.as_str()),
            Some("/review")
        );
        assert_eq!(planned.mentions.len(), 1);
        assert_eq!(planned.todos.len(), 1);
        assert!(planned.tools.is_empty());
        assert!(!state.agent_loop.read().await.mode_manager.can_edit());

        // Agent mode is only reachable through the owner's approval.
        state
            .agent_loop
            .write()
            .await
            .approve_agent_mode("owner")
            .expect("the approval is accepted");

        let executed = rpc
            .agent_turn(&owner_ext(), "now apply it".to_string())
            .await
            .expect("an agent turn answers");
        assert_eq!(executed.mode, AgentMode::Agent);
        assert_eq!(executed.command, None);
        assert_eq!(executed.todos.len(), 2);
        assert_eq!(executed.todos[1].id, "turn-2");
        // The turn is not a tool request, so it went to the router — which is the
        // daemon's real `ProviderRouter`, holding the mock provider in this test.
        assert!(executed.response.starts_with("Summary (model completion):"));
        assert!(executed.response.contains("- model: Mock response"));
        assert!(executed.tools.is_empty());
    }

    #[tokio::test]
    async fn agent_turn_runs_a_tool_inside_the_agent_workspace() {
        use warsha_pipeline::AgentMode;

        let temp = crate::test_util::fresh_tempdir();
        let data_dir = temp.path().join("data");
        let (state, _store) = test_state(&data_dir).await;
        let rpc = WarshaRpc::new(state.clone());
        state
            .agent_loop
            .write()
            .await
            .approve_agent_mode("owner")
            .expect("the approval is accepted");

        let executed = rpc
            .agent_turn(
                &owner_ext(),
                "write file notes/hello.md: written by the agent".to_string(),
            )
            .await
            .expect("a tool turn answers");

        assert_eq!(executed.mode, AgentMode::Agent);
        assert_eq!(executed.tools.len(), 1);
        assert!(
            executed.tools[0].success,
            "unexpected tool: {:?}",
            executed.tools[0]
        );
        // The real file layer wrote it, inside `<data_dir>/workspace`.
        let written = data_dir.join("workspace").join("notes").join("hello.md");
        assert!(written.is_file(), "{} was not written", written.display());
        assert_eq!(
            std::fs::read_to_string(&written).expect("the file is readable"),
            "written by the agent"
        );

        // A path that leaves the workspace is refused, not written.
        let refused = rpc
            .agent_turn(&owner_ext(), "write file ../escape.md: no".to_string())
            .await
            .expect("a refused tool turn still answers");
        assert_eq!(refused.tools.len(), 1);
        assert!(!refused.tools[0].success);
        assert!(
            !data_dir.join("escape.md").exists(),
            "the screen let a path out"
        );
    }

    /// The tool name [`mcp_probe_server`] answers `tools/list` with.
    const PROBE_TOOL: &str = "read_file";

    /// The address [`preview_probe`] prints, as a dev server prints one.
    const PROBE_URL: &str = "http://127.0.0.1:5199/";

    /// A stdio MCP server, run as a child of this test binary.
    ///
    /// `mcp.connect` now speaks the protocol, so a test server has to answer it.
    /// The daemon starts a server with the program and arguments it was given and
    /// no environment, so the child identifies itself by `--exact` and answers from
    /// the constant above. `--nocapture` is what lets this `println!` reach the pipe
    /// the manager reads instead of libtest's in-memory buffer, and the guard makes
    /// the probe harmless if a full ignored run ever reaches it.
    #[test]
    #[ignore = "a child process, not a test"]
    fn mcp_probe_server() {
        use std::io::BufRead;

        if !std::env::args().any(|arg| arg == "--exact") {
            return;
        }
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            let Ok(request) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            let Some(id) = request.get("id").cloned() else {
                continue;
            };
            match request.get("method").and_then(serde_json::Value::as_str) {
                Some("initialize") => println!(
                    "{}",
                    serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": { "protocolVersion": "2024-11-05", "capabilities": {} },
                    })
                ),
                Some("tools/list") => println!(
                    "{}",
                    serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": { "tools": [{ "name": PROBE_TOOL }] },
                    })
                ),
                Some("tools/call") => {
                    let tool_name = request
                        .get("params")
                        .and_then(|p| p.get("name"))
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("");
                    println!(
                        "{}",
                        serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "result": {
                                "content": [{ "type": "text", "text": format!("mcp called {tool_name}") }],
                                "isError": false,
                            }
                        })
                    );
                }
                _ => println!(
                    "{}",
                    serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": { "code": -32601, "message": "unknown method" },
                    })
                ),
            }
        }
    }

    /// A dev server, run as a child of this test binary: it prints its address and
    /// stays up, which is what `preview.start` waits to read.
    #[test]
    #[ignore = "a child process, not a test"]
    fn preview_probe() {
        if !std::env::args().any(|arg| arg == "--exact") {
            return;
        }
        println!("  ➜  Local:   {PROBE_URL}");
        std::thread::sleep(std::time::Duration::from_secs(30));
    }

    /// The command line that starts one probe of this test binary.
    ///
    /// A preview is given one command line and splits it itself, so a binary path
    /// with a space in it would not survive. It does not here, and the pipeline's
    /// own preview tests rest on the same assumption.
    fn probe_line(test: &str) -> String {
        let exe = std::env::current_exe().expect("the test binary names itself");
        format!(
            "{} --exact tests::{test} --ignored --nocapture",
            exe.display()
        )
    }

    /// The same probe as a program plus args, which is what `mcp.connect` takes.
    fn probe_command(test: &str) -> (String, Vec<String>) {
        let exe = std::env::current_exe().expect("the test binary names itself");
        (
            exe.to_string_lossy().into_owned(),
            vec![
                "--exact".to_string(),
                format!("tests::{test}"),
                "--ignored".to_string(),
                "--nocapture".to_string(),
            ],
        )
    }

    /// A program plus args that keeps running until the test stops it.
    #[cfg(windows)]
    fn long_running() -> (String, Vec<String>) {
        (
            "cmd".to_string(),
            vec!["/C".to_string(), "ping -n 30 127.0.0.1 >nul".to_string()],
        )
    }

    /// A program plus args that keeps running until the test stops it (Unix).
    #[cfg(not(windows))]
    fn long_running() -> (String, Vec<String>) {
        (
            "sh".to_string(),
            vec!["-c".to_string(), "sleep 30".to_string()],
        )
    }

    #[tokio::test]
    async fn process_rpcs_spawn_list_report_and_stop_a_real_process() {
        let temp = crate::test_util::fresh_tempdir();
        // The owner's own configuration is what admits a program: this test's
        // long-running stand-in is `cmd`/`sh`, which the default list deliberately
        // does not carry.
        let (state, _store) = test_state_with(temp.path(), |config| {
            config.allowed_commands = vec!["cmd".to_string(), "sh".to_string()];
        })
        .await;
        let rpc = WarshaRpc::new(state);
        let (command, args) = long_running();

        let id = rpc
            .spawn_process(&owner_ext(), command.clone(), args.clone(), HashMap::new())
            .await
            .expect("the process starts");
        assert_eq!(
            rpc.process_status(&owner_ext(), id.clone()).await.unwrap(),
            ProcessStatus::Running
        );
        let listed = rpc
            .list_processes(&owner_ext())
            .await
            .expect("the list is served");
        let process = listed.first().expect("the process is listed");
        assert_eq!(process.id, id);
        assert_eq!(process.command, command);
        assert_eq!(process.args, args);
        assert!(process.started_at.is_some());

        rpc.stop_process(&owner_ext(), id.clone())
            .await
            .expect("the process stops");
        assert_eq!(
            rpc.process_status(&owner_ext(), id.clone()).await.unwrap(),
            ProcessStatus::Stopped
        );

        // A second stop has nothing left to signal, and an unknown id is refused.
        assert!(rpc.stop_process(&owner_ext(), id).await.is_err());
        assert!(rpc
            .process_status(&owner_ext(), "proc-404".to_string())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn mcp_rpcs_connect_send_and_disconnect_a_stdio_server() {
        let temp = crate::test_util::fresh_tempdir();
        let (command, args) = probe_command("mcp_probe_server");
        // The stdio transport starts this test's own binary as the MCP server, and the
        // daemon's configuration is what admits that exact program.
        let allowed = command.clone();
        let (state, _store) = test_state_with(temp.path(), move |config| {
            config.allowed_commands = vec![allowed];
        })
        .await;
        let rpc = WarshaRpc::new(state);

        rpc.connect_mcp(
            &owner_ext(),
            warsha_pipeline::mcp_transport::McpServerConfig::new_stdio("files", command, args),
        )
        .await
        .expect("the server connects");
        let listed = rpc
            .list_mcp(&owner_ext())
            .await
            .expect("the list is served");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].status, warsha_pipeline::McpStatus::Connected);
        assert!(listed[0].process_id.is_some());
        // The handshake ran, so `mcp.list` reports what the server said it can do.
        assert_eq!(listed[0].tools, vec![PROBE_TOOL.to_string()]);

        let frame = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#;
        assert_eq!(
            rpc.send_mcp(&owner_ext(), "files".to_string(), frame.to_string())
                .await
                .expect("the frame is written"),
            frame
        );

        let call_res = rpc
            .call_mcp(
                &owner_ext(),
                "files".to_string(),
                PROBE_TOOL.to_string(),
                serde_json::json!({}),
            )
            .await
            .expect("call_mcp succeeds");
        assert!(!call_res.is_error);
        assert_eq!(call_res.content.len(), 1);
        match &call_res.content[0] {
            warsha_pipeline::mcp::McpContent::Text { text } => {
                assert_eq!(text, &format!("mcp called {PROBE_TOOL}"));
            }
            _ => panic!("expected text content"),
        }

        rpc.disconnect_mcp(&owner_ext(), "files".to_string())
            .await
            .expect("the server disconnects");
        let listed = rpc
            .list_mcp(&owner_ext())
            .await
            .expect("the list is served");
        assert_eq!(listed[0].status, warsha_pipeline::McpStatus::Disconnected);
        assert_eq!(listed[0].process_id, None);
        // Nothing is dialled for a *wired* name after the disconnect.
        assert!(rpc
            .send_mcp(&owner_ext(), "files".to_string(), "{}".to_string())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn mcp_connect_records_an_http_transport_without_dialling_it() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);

        rpc.connect_mcp(
            &owner_ext(),
            warsha_pipeline::mcp_transport::McpServerConfig::new_http(
                "remote",
                "https://mcp.example/mcp",
            ),
        )
        .await
        .expect("the config is recorded");

        let listed = rpc
            .list_mcp(&owner_ext())
            .await
            .expect("the list is served");
        assert_eq!(listed[0].status, warsha_pipeline::McpStatus::Disconnected);
        assert_eq!(listed[0].process_id, None);
        assert!(rpc
            .list_processes(&owner_ext())
            .await
            .expect("the list is served")
            .is_empty());
        // The transport is recorded, not wired, and the error says so.
        let error = rpc
            .send_mcp(&owner_ext(), "remote".to_string(), "{}".to_string())
            .await
            .expect_err("nothing dials an http transport yet");
        assert!(format!("{error:?}").contains("not wired"));
    }

    #[tokio::test]
    async fn preview_rpcs_start_report_and_stop_one_dev_server_per_project() {
        let temp = crate::test_util::fresh_tempdir();
        let command = probe_line("preview_probe");
        // A preview's command line names this test binary as its program, so the
        // owner's configuration is what admits that exact path.
        let program = command
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .to_string();
        let (state, _store) = test_state_with(temp.path(), move |config| {
            config.allowed_commands = vec![program];
        })
        .await;
        let rpc = WarshaRpc::new(state.clone());

        let started = rpc
            .start_preview(&owner_ext(), "project-1".to_string(), command.clone())
            .await
            .expect("the preview starts");
        assert_eq!(started.project_id, "project-1");
        // The dev server prints its address, and `preview.start` reports it (D4).
        assert_eq!(started.url.as_deref(), Some(PROBE_URL));
        let status = rpc
            .preview_status(&owner_ext(), "project-1".to_string())
            .await
            .expect("the preview is tracked");
        assert_eq!(status.process_id, started.process_id);
        assert_eq!(status.status, ProcessStatus::Running);
        assert_eq!(status.url.as_deref(), Some(PROBE_URL));
        // The dev server is a real child, so `process.list` sees it too.
        assert_eq!(
            rpc.list_processes(&owner_ext())
                .await
                .expect("the list is served")
                .len(),
            1
        );

        // One preview per project, and an unknown project is refused.
        assert!(rpc
            .start_preview(&owner_ext(), "project-1".to_string(), command)
            .await
            .is_err());
        assert!(rpc
            .preview_status(&owner_ext(), "nobody".to_string())
            .await
            .is_err());

        rpc.stop_preview(&owner_ext(), "project-1".to_string())
            .await
            .expect("the preview stops");
        assert_eq!(
            rpc.preview_status(&owner_ext(), "project-1".to_string())
                .await
                .expect("the preview is still tracked")
                .status,
            ProcessStatus::Stopped
        );
        // The process stays in the list as a stopped record.
        let listed = rpc
            .list_processes(&owner_ext())
            .await
            .expect("the list is served");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].status, ProcessStatus::Stopped);
    }

    #[tokio::test]
    async fn routines_rpcs_list_get_run_now_pause_and_resume() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state.clone());

        // Empty at start
        let list = rpc
            .list_routines(&owner_ext())
            .await
            .expect("list routines");
        assert!(list.is_empty());

        // Register routines
        {
            let mut reg = state.routines.write().await;
            reg.register(Routine::new(
                "task-manual",
                "Manual Routine",
                warsha_pipeline::RoutineSchedule::Manual,
            ))
            .expect("register manual");
            reg.register(Routine::new(
                "task-interval",
                "Interval Routine",
                warsha_pipeline::RoutineSchedule::IntervalSeconds(60),
            ))
            .expect("register interval");
        }

        // List
        let list = rpc
            .list_routines(&owner_ext())
            .await
            .expect("list routines");
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "task-interval");
        assert_eq!(list[1].id, "task-manual");

        // Get
        let item = rpc
            .get_routine(&owner_ext(), "task-manual".to_string())
            .await
            .expect("get routine");
        assert!(item.is_some());
        assert_eq!(item.unwrap().name, "Manual Routine");

        let ghost = rpc
            .get_routine(&owner_ext(), "ghost".to_string())
            .await
            .expect("get ghost routine");
        assert!(ghost.is_none());

        // Run now
        let updated = rpc
            .run_routine_now(&owner_ext(), "task-manual".to_string())
            .await
            .expect("run routine now");
        assert_eq!(updated.id, "task-manual");
        assert_eq!(updated.state, warsha_pipeline::RoutineState::Idle);
        assert!(updated.last_run_unix.is_some());

        // Pause
        let paused = rpc
            .pause_routine(&owner_ext(), "task-interval".to_string())
            .await
            .expect("pause routine");
        assert_eq!(paused.state, warsha_pipeline::RoutineState::Paused);

        // Resume
        let resumed = rpc
            .resume_routine(&owner_ext(), "task-interval".to_string())
            .await
            .expect("resume routine");
        assert_eq!(resumed.state, warsha_pipeline::RoutineState::Idle);

        // Not found error
        assert!(rpc
            .run_routine_now(&owner_ext(), "ghost".to_string())
            .await
            .is_err());
        assert!(rpc
            .pause_routine(&owner_ext(), "ghost".to_string())
            .await
            .is_err());
        assert!(rpc
            .resume_routine(&owner_ext(), "ghost".to_string())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn providers_check_models_rpc() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state.clone());

        {
            let mut router = state.providers.write().await;
            router.register_provider(Box::new(
                warsha_providers::MockProvider::new("ollama_test").with_models(vec![
                    warsha_providers::ModelInfo {
                        id: "qwen2.5-coder:7b".to_string(),
                        name: "Qwen 2.5 Coder 7B".to_string(),
                        provider: "ollama_test".to_string(),
                        context_window: 32_000,
                        max_output: 8_192,
                        pricing: warsha_core::ModelPricing {
                            input_per_million_cents: 0,
                            output_per_million_cents: 0,
                        },
                    },
                ]),
            ));
        }

        let diff = rpc
            .check_provider_models(&owner_ext(), "ollama_test".to_string())
            .await
            .expect("check_provider_models succeeds");
        assert_eq!(diff.provider, "ollama_test");
        assert_eq!(diff.new_models.len(), 1);
        assert_eq!(diff.new_models[0].id, "qwen2.5-coder:7b");

        assert!(rpc
            .check_provider_models(&owner_ext(), "non_existent".to_string())
            .await
            .is_err());
    }

    // ---- Re-audit LOAD-1 finding 1: the tier table has to bind the read surface too.
    //
    // 24 of the 56 methods were declared without `with_extensions`, so their handlers had
    // no `RpcExtensions` to read and never reached `authorize()` — the only place a tier
    // token is spent. Their `Tier::Standard` rows in `METHOD_POLICIES` were dead on the
    // RPC surface and the spike run proved it: 1.34M requests, zero `-32004`, and the
    // admitted total landed exactly on the far looser transport ceiling. These tests are
    // the two claims the fix has to hold: a method-level ceiling now fires on a read, and
    // no read answers a caller that never authenticated.

    /// Every read method, refused for want of a session.
    ///
    /// Driven in-process, which is the floor under the transport: a paired device, an
    /// unpaired caller or an embedded host that forgets to build the extensions must not
    /// get data out of a handler that no longer has an identity to check. The wire
    /// half — a request with no credential never reaches a handler at all — is
    /// `security_identity.rs` and `security_rate_limits.rs`.
    #[tokio::test]
    async fn every_read_method_refuses_a_caller_with_no_session() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);
        let anonymous = anonymous_session();
        let project = ProjectId::new();
        let run = RunId::new();

        let outcomes = [
            ("health", rpc.health(&anonymous).await.map(|_| ())),
            (
                "projects.list",
                rpc.list_projects(&anonymous).await.map(|_| ()),
            ),
            (
                "projects.get",
                rpc.get_project(&anonymous, project).await.map(|_| ()),
            ),
            ("runs.get", rpc.get_run(&anonymous, run).await.map(|_| ())),
            (
                "runs.list",
                rpc.list_runs(&anonymous, project).await.map(|_| ()),
            ),
            (
                "runs.events",
                rpc.get_events(&anonymous, run).await.map(|_| ()),
            ),
            (
                "providers.list",
                rpc.list_providers(&anonymous).await.map(|_| ()),
            ),
            ("roles.list", rpc.list_roles(&anonymous).await.map(|_| ())),
            (
                "budget.show",
                rpc.show_budget(&anonymous, project).await.map(|_| ()),
            ),
            (
                "devices.list",
                rpc.list_devices(&anonymous).await.map(|_| ()),
            ),
            (
                "pairing.list",
                rpc.list_pairings(&anonymous).await.map(|_| ()),
            ),
            (
                "backend.get",
                rpc.get_backend(&anonymous, "run".to_string())
                    .await
                    .map(|_| ()),
            ),
            (
                "runmode.list",
                rpc.list_run_modes(&anonymous).await.map(|_| ()),
            ),
            (
                "preferences.list",
                rpc.list_preferences(&anonymous, "project".to_string())
                    .await
                    .map(|_| ()),
            ),
            (
                "preferences.record",
                rpc.record_preference(
                    &anonymous,
                    PreferenceSignal::new(
                        "signal-1",
                        "project",
                        "owner",
                        warsha_pipeline::SignalKind::Approve,
                        "button",
                        1_700_000_000,
                    ),
                )
                .await
                .map(|_| ()),
            ),
            (
                "postlaunch.crashes",
                rpc.list_crash_reports(&anonymous, "run".to_string())
                    .await
                    .map(|_| ()),
            ),
            (
                "postlaunch.reviews",
                rpc.list_store_reviews(&anonymous, "apple".to_string())
                    .await
                    .map(|_| ()),
            ),
            ("skills.list", rpc.list_skills(&anonymous).await.map(|_| ())),
            (
                "process.status",
                rpc.process_status(&anonymous, "proc-1".to_string())
                    .await
                    .map(|_| ()),
            ),
            (
                "process.list",
                rpc.list_processes(&anonymous).await.map(|_| ()),
            ),
            ("mcp.list", rpc.list_mcp(&anonymous).await.map(|_| ())),
            (
                "preview.status",
                rpc.preview_status(&anonymous, "project".to_string())
                    .await
                    .map(|_| ()),
            ),
            (
                "routines.list",
                rpc.list_routines(&anonymous).await.map(|_| ()),
            ),
            (
                "routines.get",
                rpc.get_routine(&anonymous, "task".to_string())
                    .await
                    .map(|_| ()),
            ),
        ];

        assert_eq!(
            outcomes.len(),
            24,
            "the read surface the re-audit counted is what this asserts over"
        );
        for (method, outcome) in outcomes {
            let error = outcome.expect_err(&format!("{method} served a caller with no session"));
            assert_eq!(
                rpc_error_code(&error),
                auth::rpc_codes::UNAUTHENTICATED,
                "{method} refused an unauthenticated caller for the wrong reason"
            );
        }
    }

    /// The `standard` tier is spent by a read now, which is the finding's actual claim:
    /// `projects.list` can be refused with the method-tier code while the transport
    /// ceiling in front of it is still serving traffic normally.
    #[tokio::test]
    async fn a_read_is_measured_by_its_own_tier_and_not_only_by_the_transport() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = test_state_with(temp.path(), |config| {
            // The transport stays wide — the refusal below has to come from the method
            // tier, not from the whole-request bucket in front of it.
            config.rate_limits = RateLimitConfig {
                transport: QuotaConfig {
                    burst: 600,
                    sustained: 600,
                    window_secs: 60,
                },
                standard: QuotaConfig {
                    burst: 3,
                    sustained: 3,
                    window_secs: 60,
                },
                ..RateLimitConfig::default()
            };
        })
        .await;
        let rpc = WarshaRpc::new(state.clone());
        let owner = owner_ext();

        for _ in 0..3 {
            rpc.list_projects(&owner)
                .await
                .expect("the standard burst is served");
        }

        let refused = rpc
            .list_projects(&owner)
            .await
            .map(|_| ())
            .expect_err("a read past the standard ceiling was served");
        assert_eq!(
            rpc_error_code(&refused),
            auth::rpc_codes::RATE_LIMITED,
            "the method tier did not bind the method tier's own caller"
        );

        // A second identity is not refused for the first one's flood.
        let phone = uuid::Uuid::new_v4().to_string();
        rpc.list_projects(&paired_ext(&phone))
            .await
            .expect("one caller's ceiling is not another's");

        // The refusal is the tier's, not the method's: `health` sits in `standard` with
        // the other reads, so the same caller that drained the bucket is refused there too
        // — which is what the table claiming one ceiling per tier has to mean.
        let health_refused = rpc
            .health(&owner)
            .await
            .map(|_| ())
            .expect_err("the standard tier refueled between two calls in one test");
        assert_eq!(
            rpc_error_code(&health_refused),
            auth::rpc_codes::RATE_LIMITED,
            "the tier is not per identity and ceiling"
        );
    }

    /// Re-audit N-8 on the one write that sat on the read surface: `preferences.record`
    /// now needs a session, spends its tier and records its actor — and a paired device is
    /// still allowed to record taste, which is what the table has always said.
    #[tokio::test]
    async fn recording_a_preference_is_a_write_with_a_ceiling_and_an_actor() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = test_state_with(temp.path(), |config| {
            config.rate_limits = RateLimitConfig {
                standard: QuotaConfig {
                    burst: 1,
                    sustained: 1,
                    window_secs: 60,
                },
                ..RateLimitConfig::default()
            };
        })
        .await;
        let rpc = WarshaRpc::new(state);
        let phone = uuid::Uuid::new_v4().to_string();
        let paired = paired_ext(&phone);
        let signal = || {
            PreferenceSignal::new(
                uuid::Uuid::new_v4().to_string(),
                "project-1",
                "owner-1",
                warsha_pipeline::SignalKind::Approve,
                "button",
                1_700_000_000,
            )
        };

        // Served once, and its own ceiling binds the next one rather than the caller
        // writing the settings file forever.
        rpc.record_preference(&paired, signal())
            .await
            .expect("a paired device records taste");
        let refused = rpc
            .record_preference(&paired, signal())
            .await
            .map(|_| ())
            .expect_err("an unbounded write on the read surface");
        assert_eq!(
            rpc_error_code(&refused),
            auth::rpc_codes::RATE_LIMITED,
            "the standard tier did not bind the write it names"
        );

        // A caller with no session writes nothing at all.
        let anonymous = rpc
            .record_preference(&anonymous_session(), signal())
            .await
            .map(|_| ())
            .expect_err("no session recorded a preference");
        assert_eq!(
            rpc_error_code(&anonymous),
            auth::rpc_codes::UNAUTHENTICATED,
            "an unauthenticated caller persisted a preference"
        );
    }

    /// The log lines a daemon wrote, kept by a test subscriber.
    ///
    /// Two of this batch's findings are about the *shape* of the log rather than the value
    /// of any field: a startup line written twice, and a refusal line written 1.3 million
    /// times. Neither is assertable from a handler's return value, so the daemon's own
    /// output is captured and counted.
    #[derive(Clone, Default)]
    struct LogCapture(Arc<std::sync::Mutex<Vec<String>>>);

    impl LogCapture {
        /// Every line written so far.
        fn lines(&self) -> Vec<String> {
            self.0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone()
        }

        /// How many lines carry `needle`.
        fn count_matching(&self, needle: &str) -> usize {
            self.lines()
                .iter()
                .filter(|line| line.contains(needle))
                .count()
        }
    }

    /// The one field of an event a log-shape test needs: its message.
    #[derive(Default)]
    struct MessageVisitor {
        message: String,
    }

    impl tracing::field::Visit for MessageVisitor {
        fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
            if field.name() == "message" {
                self.message = value.to_string();
            }
        }

        fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
            if field.name() == "message" {
                self.message = format!("{value:?}");
            }
        }
    }

    /// A subscriber layer that appends each event's level and message to a [`LogCapture`].
    struct CaptureLayer(LogCapture);

    impl<S: tracing::Subscriber> tracing_subscriber::Layer<S> for CaptureLayer {
        fn on_event(
            &self,
            event: &tracing::Event<'_>,
            _ctx: tracing_subscriber::layer::Context<'_, S>,
        ) {
            let mut visitor = MessageVisitor::default();
            event.record(&mut visitor);
            self.0
                 .0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(format!("{} {}", event.metadata().level(), visitor.message));
        }
    }

    /// The capture, with a filter mounted beside it.
    ///
    /// The filter is not decoration. tracing caches, per callsite, whether it is *ever*
    /// enabled, and a callsite first reached by another test running in parallel — with no
    /// subscriber of its own — is cached as "never", which blinds a thread-local capture to
    /// exactly the line it is looking for. A subscriber that answers `Interest::sometimes()`
    /// bypasses that cache, so the capture sees the events whatever the rest of the suite
    /// has already done to the callsite: without the filter these two tests pass under
    /// `--test-threads=1` and fail in a parallel run.
    fn capture_subscriber(
        capture: &LogCapture,
    ) -> impl tracing::Subscriber + Send + Sync + 'static {
        use tracing_subscriber::layer::SubscriberExt;

        tracing_subscriber::Registry::default()
            .with(CaptureLayer(capture.clone()))
            .with(tracing_subscriber::filter::Targets::new().with_default(tracing::Level::TRACE))
    }

    /// Re-audit LOAD-1 finding 3: the listener lines are written once per daemon start.
    ///
    /// The measured startup log carried each of them twice — once from `start_daemon`,
    /// which is the code that knows the ports, and once from `run_daemon`, which only
    /// repeats them. Asserted two ways on purpose: the runtime capture proves one start
    /// writes one of each, and the source scan proves nothing has grown a second format
    /// string for the same line, which is how the duplicate came back the first time.
    #[test]
    fn the_startup_listener_lines_are_written_once() {
        let capture = LogCapture::default();
        let subscriber = capture_subscriber(&capture);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a current-thread runtime");
        let temp = crate::test_util::fresh_tempdir();
        let data_dir = temp.path().to_path_buf();

        tracing::subscriber::with_default(subscriber, || {
            runtime.block_on(async move {
                let config = DaemonConfig {
                    data_dir,
                    auth_token: "one-line-token".to_string(),
                    http_port: 0,
                    ws_port: 0,
                    ..Default::default()
                };
                let handle =
                    start_daemon_with_secrets(config, Arc::new(InMemorySecretStore::new()))
                        .await
                        .expect("the daemon starts");
                assert!(handle.http_port() > 0 && handle.rpc_port() > 0);
                handle.shutdown().await;
            });
        });

        assert_eq!(
            capture.count_matching("HTTP server listening"),
            1,
            "the HTTP listener line was written more than once: {:?}",
            capture.lines()
        );
        assert_eq!(
            capture.count_matching("JSON-RPC server listening"),
            1,
            "the RPC listener line was written more than once: {:?}",
            capture.lines()
        );

        // The source-level guard: exactly one format string each, in the production part of
        // the crate. The duplicate this batch removed was a second call site in
        // `run_daemon`, and a second call site is exactly what this catches — the runtime
        // count above only sees the one start this test performed.
        let source = include_str!("lib.rs");
        let production = source
            .split("#[cfg(test)]")
            .next()
            .expect("the crate has a test module to exclude");
        for shape in ["HTTP server listening on", "JSON-RPC server listening on"] {
            let sites = production
                .lines()
                .filter(|line| line.contains(shape))
                .count();
            assert_eq!(
                sites, 1,
                "`{shape}` is written from {sites} places; a listener line has one owner"
            );
        }
    }

    /// Re-audit LOAD-1 finding 2 at the daemon: a flood of refusals is a count, and one
    /// line — not a line per refusal.
    ///
    /// Asserted on the meter the handler actually drives (refusals counted, lines handed
    /// out, tallies kept) rather than on a log the test process intercepts. A subscriber
    /// installed inside one test of a parallel suite only sees the events whose callsites
    /// route to it, and the callsite here is shared with the other refusal tests in this
    /// binary, so a capture assertion is flaky by construction; a counter is not. What the
    /// line *says* — counts, a ceiling, a one-way digest, never an identity or a token —
    /// is asserted next to the function that builds it, in `warsha-remote`.
    #[test]
    fn a_flood_of_refusals_is_counted_and_earns_one_line() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a current-thread runtime");
        let temp = crate::test_util::fresh_tempdir();

        runtime.block_on(async {
            let (state, _store) = test_state_with(temp.path(), |config| {
                config.rate_limits = RateLimitConfig {
                    standard: QuotaConfig {
                        burst: 1,
                        sustained: 1,
                        window_secs: 60,
                    },
                    ..RateLimitConfig::default()
                };
            })
            .await;
            let rpc = WarshaRpc::new(state.clone());
            let owner = owner_ext();

            // The first call is served; every one after it is a refusal.
            rpc.list_projects(&owner).await.expect("the burst");
            for _ in 0..500 {
                let refused = rpc
                    .list_projects(&owner)
                    .await
                    .map(|_| ())
                    .expect_err("a caller past its ceiling was served");
                assert_eq!(rpc_error_code(&refused), auth::rpc_codes::RATE_LIMITED);
            }

            let meter = state.rates.refusals();
            assert_eq!(meter.refusals_total(), 500, "every refusal is counted");
            assert_eq!(
                meter.lines_written(),
                1,
                "500 refusals earned one line, not 500 of them"
            );
            assert_eq!(meter.tracked(), 1, "one caller earned one tally");
            assert_eq!(meter.untracked(), 0, "the meter overflowed its bound");

            // And nothing about the caller survives in the state that prints: the limiter
            // keys, the identity labels and the daemon's own credential are all absent, so
            // a `debug!` of the governor cannot leak what the refusal line already refuses
            // to print.
            let printed = format!("{:?}", state.rates);
            assert!(
                !printed.contains("test-token"),
                "the ceilings printed the owner credential: {printed}"
            );
            assert!(
                !printed.contains("identity:") && !printed.contains("peer:"),
                "the ceilings printed a limiter key: {printed}"
            );
        });
    }
}

// Declared last, after the test module above: `tests::the_startup_listener_lines_are_written_once`
// treats everything before the first `#[cfg(test)]` attribute in this file as the production
// part of the crate, and an earlier declaration here would empty that region.
#[cfg(test)]
pub(crate) mod test_util;
