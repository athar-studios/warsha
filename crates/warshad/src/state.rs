use crate::auth::RateLimitConfig;
use crate::lock::LockFile;
use clap::Parser;
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{info, warn};
use warsha_pipeline::ProcessManager;

pub const REDACTED: &str = "[REDACTED]";

pub const SECRET_KEY_NAMES: &[&str] = &[
    "api_key",
    "apikey",
    "secret",
    "token",
    "auth_token",
    "password",
    "authorization",
];

pub fn scrub_event_payload(payload: &mut serde_json::Value, auth_token: &str) {
    scrub_value(payload, auth_token);
}

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

pub(crate) fn redact_string(text: &str, auth_token: &str) -> bool {
    (!auth_token.is_empty() && text.contains(auth_token))
        || contains_sk_token(text)
        || contains_bearer(text)
}

fn starts_with_at(haystack: &[u8], at: usize, needle: &[u8]) -> bool {
    haystack.get(at..at + needle.len()) == Some(needle)
}

fn is_sk_body(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'-'
}

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

fn is_bearer_body(c: u8) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-')
}

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

pub fn windows_firewall_command(http_port: u16, ws_port: u16) -> String {
    format!(
        "netsh advfirewall firewall add rule name=\"Warsha Daemon\" dir=in action=allow protocol=TCP localport={http_port},{ws_port} profile=private"
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RemoteBind {
    #[default]
    Default,
    Localhost,
    Tailscale,
}

impl std::fmt::Display for RemoteBind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RemoteBind::Default => write!(f, "default"),
            RemoteBind::Localhost => write!(f, "localhost"),
            RemoteBind::Tailscale => write!(f, "tailscale"),
        }
    }
}

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

    /// The network interface mode to bind the remote listener to: `default` (standard host),
    /// `localhost` (127.0.0.1 only), or `tailscale` (binds to Tailscale IP).
    #[serde(default)]
    pub remote_bind: RemoteBind,

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
    /// Empty means the default list ([`crate::DEFAULT_ALLOWED_COMMANDS`]) rather than "no
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
    /// overlaid by [`crate::apply_env_overrides`] like every other `WARSHA_*` value; a
    /// `config.toml` may name `remote_assets_dir` directly. A caller driving
    /// [`crate::start_daemon`] in-process can set the field without touching the environment.
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
            auth_token: String::new(),
            allowed_origins: vec![
                "http://localhost:5173".to_string(),
                "tauri://localhost".to_string(),
                "http://tauri.localhost".to_string(),
            ],
            rate_limits: RateLimitConfig::default(),
            allowed_commands: Vec::new(),
            remote_assets_dir: None,
            remote_bind: RemoteBind::default(),
        }
    }
}

pub fn default_bind_host() -> String {
    LOCALHOST_BIND.to_string()
}

pub const LOCALHOST_BIND: &str = "127.0.0.1";

/// Handle to a running daemon instance.
pub struct DaemonHandle {
    pub(crate) _lock_file: LockFile,
    pub(crate) http_task: tokio::task::JoinHandle<()>,
    pub(crate) rpc_server: jsonrpsee::server::ServerHandle,
    pub(crate) loopback_http_task: Option<tokio::task::JoinHandle<()>>,
    pub(crate) loopback_rpc_server: Option<jsonrpsee::server::ServerHandle>,
    pub(crate) http_port: u16,
    pub(crate) rpc_port: u16,
    /// The address both listeners actually bound. Reported so a startup log and a test can
    /// name where the daemon is rather than re-reading a configuration it may have
    /// resolved differently.
    pub(crate) bind_addr: IpAddr,
    /// What [`DaemonHandle::pairing_origin`] answered at start: the address a pairing link
    /// may advertise, or `None` when the daemon cannot name one.
    pub(crate) pairing_origin: Option<String>,
    /// The one spawner, so shutdown can take the daemon's children with it.
    pub(crate) processes: Arc<dyn ProcessManager>,
    /// The runtime this daemon is running on, kept for the sweep a `Drop` has to run
    /// without an `.await` (see [`DaemonHandle::drop`]).
    pub(crate) runtime: tokio::runtime::Handle,
    /// Whether the children have already been reaped, so the drop sweep runs once.
    pub(crate) reaped: std::sync::atomic::AtomicBool,
}

const DROP_REAP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

impl std::fmt::Debug for DaemonHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
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
    /// Whether this daemon started a companion loopback listener (e.g. for RemoteBind::Tailscale).
    pub fn has_loopback_companion(&self) -> bool {
        self.loopback_rpc_server.is_some()
    }
    /// Shuts down the daemon: stops the RPC server, aborts the HTTP task,
    /// kills and reaps every child it started, and releases the lock file.
    ///
    /// The children are the whole [`ProcessManager`] list — a preview dev server,
    /// an MCP stdio server, anything `process.spawn` started — and each one is
    /// killed *and* waited for. Killing alone would leave a zombie, and dropping
    /// the handles would leave a dev server holding its port for the next daemon
    /// to trip over.
    pub async fn shutdown(mut self) {
        if let Err(e) = self.rpc_server.stop() {
            warn!("RPC server was already stopped: {e}");
        }
        if let Some(loopback_rpc) = self.loopback_rpc_server.take() {
            if let Err(e) = loopback_rpc.stop() {
                warn!("Companion loopback RPC server was already stopped: {e}");
            }
        }
        self.http_task.abort();
        if let Some(loopback_http) = self.loopback_http_task.take() {
            loopback_http.abort();
        }
        let killed = self.processes.kill_all().await;
        self.reaped.store(true, std::sync::atomic::Ordering::SeqCst);
        if killed > 0 {
            info!("killed {killed} child process(es) on shutdown");
        }
    }
}

impl Drop for DaemonHandle {
    fn drop(&mut self) {
        if self.reaped.load(std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        let _ = self.rpc_server.stop();
        if let Some(loopback_rpc) = &self.loopback_rpc_server {
            let _ = loopback_rpc.stop();
        }
        self.http_task.abort();
        if let Some(loopback_http) = &self.loopback_http_task {
            loopback_http.abort();
        }

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

#[derive(Parser, Debug)]
pub struct DaemonArgs {
    #[arg(short, long)]
    pub config: Option<PathBuf>,
    #[arg(short, long)]
    pub foreground: bool,
    #[arg(long, default_value = "8765")]
    pub http_port: u16,
    #[arg(long, default_value = "8766")]
    pub ws_port: u16,
    #[arg(long, visible_alias = "bind")]
    pub bind_host: Option<String>,
    #[arg(long)]
    pub advertised_host: Option<String>,
    #[arg(long)]
    pub socket: Option<PathBuf>,
}

// ============================================ daemon state (P-H1 step A4)

// Moved out of `lib.rs` unchanged: `DaemonState`, the alias `lib.rs` names it by,
// the pairing predicate the request guard re-checks, and the MCP permission DTOs.
// `lib.rs` still names them, so they are re-exported at the crate root; the three
// items other modules call directly are `pub(crate)` here.

use crate::api::{HealthCapabilities, RoleRoutingConfig};
use crate::auth::{Actor, ActorRole, RateGovernor, Sessions};
use crate::events::EventSequencer;
use crate::now_epoch_secs;
use crate::providers::ProviderFactory;
use crate::settings::SettingsStore;
use std::collections::HashMap;
use tokio::sync::RwLock;
use warsha_core::{Role, RunId};
use warsha_git::GitHubClient;
use warsha_pipeline::{
    AgentLoop, BackendKit, InMemoryCrashReportStore, InMemoryPairingStore, InMemoryPreferenceStore,
    InMemoryStoreReviewStore, LivePreviewManager, McpApprovals, McpManager, PairingStore,
    PhonePairing, Preference, RoutineRegistry, RoutineScheduler, RunAgentSessions, RunMode,
    RunModeConfig, RunWorktree, StaticPermissions,
};
use warsha_providers::{ProviderRouter, SecretStore};
use warsha_remote::DeviceRegistry;
use warsha_store::Store;

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
    /// The daemon-wide agent loop — the legacy single conversation.
    ///
    /// `agent.turn`, the only RPC that ran a turn on it, is retired by OD-E2 and
    /// refuses: a turn is one run's own loop (`agent.turn_run`). What this loop still
    /// serves is the record the agent RPCs read and change when they carry no run id
    /// — `agent.state` answers it, `agent.approve_mode` / `agent.plan_mode` move it —
    /// and the restart snapshot below. With a run id (OD-E2b) those same three RPCs
    /// answer and move that run's own loop instead. Its two seams are wired by
    /// [`build_agent_loop`] — file tools inside `<data_dir>/workspace`, model calls
    /// through the daemon's provider router.
    ///
    /// What the conversation *is* — the mode it reached, who approved each switch,
    /// the todos and the unanswered questions — is written to the daemon's settings
    /// after every turn that changes it and read back at start
    /// ([`AgentLoopSnapshot`]), so a restart continues the conversation instead of
    /// starting a blank one. What is not written is the transcript: the compactor's
    /// folded context is this process's working set, and a stale one replayed into a
    /// new daemon would be a memory the owner never approved keeping.
    pub agent_loop: Arc<RwLock<AgentLoop>>,
    /// The MCP permission table consulted before every agent tool call.
    pub mcp_permissions: Arc<StaticPermissions>,
    /// The pending MCP approvals and `allow_once` grants (R-BRIDGE-B3a).
    ///
    /// Shared by every run's loop and by the two approval RPCs, so an owner can
    /// answer while a turn is running without taking the loop's own lock. Process
    /// memory only: a restart leaves no grant and no pending entry behind, which is
    /// the same state as a table with no row — `Ask`.
    pub mcp_approvals: Arc<McpApprovals>,
    /// The per-run git worktrees created at `runs.start` (ENGINE E3 wiring).
    pub run_worktrees: Arc<RwLock<HashMap<RunId, RunWorktree>>>,
    /// The per-run agent sessions (ENGINE E2 wiring). A run's turn uses its own loop
    /// and workspace, and since OD-E2b the mode RPCs reach that loop too — `run_id`
    /// on `agent.state`, `agent.approve_mode` and `agent.plan_mode` — so the plan →
    /// approve → execute flow runs per run. Without a run id those RPCs keep serving
    /// the daemon-wide record above, with `agent.turn` retired and refusing.
    pub agent_sessions: Arc<RunAgentSessions>,
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
    /// When this daemon instance started running.
    ///
    /// Single source of truth for daemon uptime across HTTP `/health` and JSON-RPC
    /// `health` so both endpoints report truthful, monotonically increasing uptime.
    pub start_time: std::time::Instant,
}

/// Whether a paired actor's device is still in the active pairing set.
///
/// This is the predicate behind the per-request re-authorization: a WebSocket's
/// extensions are frozen at upgrade, so the role alone can outlive the pairing.
/// The owner always passes; a paired actor without a device id never does
/// (PAIR research finding 2).
pub(crate) fn paired_device_is_active(actor: &Actor, active: &[PhonePairing]) -> bool {
    if actor.role() != ActorRole::Paired {
        return true;
    }
    let Some(device) = actor.pairing_device_id() else {
        return false;
    };
    active
        .iter()
        .any(|pairing| pairing.device_id.trim() == device)
}

impl DaemonState {
    /// The pairing records that may authenticate a session right now.
    ///
    /// Read at the moment of the call rather than cached, so `pairing.revoke` takes
    /// effect on the phone's next request instead of at the next restart: a revocation
    /// that only landed on a reboot is a revocation the owner cannot use. The deadline
    /// is judged at this call's clock too, so an expired pairing stops authenticating
    /// without a restart (audit H1).
    pub(crate) async fn active_pairings(&self) -> Vec<PhonePairing> {
        self.pairings.read().await.active_at(now_epoch_secs())
    }

    /// Count one limiter refusal and write the aggregate line when it is due.
    ///
    /// Every refusal path in the daemon comes through here (re-audit LOAD-1 finding 2).
    /// `ceiling` is the method name whose tier bound the caller, or `transport` for the
    /// whole-request ceiling in front of it; `key` is the limiter's own key, which is an
    /// identity label or a peer address and is digested rather than printed — a refusal
    /// line must carry counts a caller can act on, not the credential or the identity of
    /// whoever held it.
    pub(crate) fn report_refusal(&self, ceiling: &'static str, key: &str) {
        if let Some(summary) = self
            .rates
            .refusals()
            .note(ceiling, key, std::time::Instant::now())
        {
            warn!("{}", summary.message());
        }
    }

    /// Probe real capabilities of the daemon (daemon, providers, keychain availability, and
    /// whether the store carries the run-ending machinery).
    pub async fn probe_capabilities(&self) -> HealthCapabilities {
        // Probe daemon capability: verify store connectivity.
        let daemon = self.store.list_projects().await.is_ok();

        // Probe providers capability: are any providers configured or pipeline roles routed?
        let providers_configured = self
            .settings
            .load_providers()
            .await
            .map(|list| list.iter().any(|p| p.enabled))
            .unwrap_or(false);
        let roles_routed = !self.role_routings.read().await.is_empty();
        let providers = providers_configured || roles_routed;

        // Probe keychain capability: verify secret store is operational.
        let keychain = match self.secrets.load("__warsha_health_probe__").await {
            Ok(_) => true,
            Err(warsha_providers::ProviderError::Auth(msg)) => {
                let lower = msg.to_ascii_lowercase();
                !lower.contains("platform")
                    && !lower.contains("unavailable")
                    && !lower.contains("couldn't access")
            }
            Err(_) => false,
        };

        // Probe run-ending capability: the controls `gates.changes` / `gates.reject` /
        // `runs.cancel` end a run, and the daemon may only advertise them when its store
        // can serve the run-version CAS loop those calls race against. A daemon that is
        // not up cannot honour them whatever the schema says.
        let run_controls = daemon && self.store_has_run_versions().await;

        HealthCapabilities {
            daemon,
            providers,
            keychain,
            run_controls,
        }
    }
}

impl DaemonState {
    /// Whether the store really carries the K2 run-version (CAS) column.
    ///
    /// `runs.version` is what `003_run_version.sql` adds and what the run-state CAS loop needs:
    /// a store without it cannot serve `gates.changes`, `gates.reject` or `runs.cancel` safely.
    /// A constant `true` is exactly the class K3 refused for health, so this reads the store on
    /// every call. `get_run_version` selects that one column for one id, and the id is freshly
    /// minted and certainly unstored, which makes the read side-effect free: it answers
    /// `RunNotFound` only when the column resolved against the migrated schema, and a database
    /// error (`no such column: version`) when the migration is missing. Any other failure — an
    /// unreachable database included — reads as unsupported, which is the safe direction for a
    /// control that ends runs.
    async fn store_has_run_versions(&self) -> bool {
        matches!(
            self.store.get_run_version(RunId::new()).await,
            Err(warsha_store::StoreError::RunNotFound(_))
        )
    }
}

/// One `server::tool::role` MCP permission row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpPermissionRow {
    /// The MCP server the row names.
    pub server: String,
    /// The tool the row names.
    pub tool: String,
    /// The role the row names.
    pub role: String,
    /// `allow`, `ask` or `deny`.
    pub permission: String,
}

/// The permission table plus the agent role's fail-closed default.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpPermissionsReply {
    /// Every stored row, in key order.
    pub rows: Vec<McpPermissionRow>,
    /// The role every agent tool call is checked under.
    pub agent_role: String,
    /// The permission an unseen `server::tool` gets for [`McpPermissionsReply::agent_role`].
    pub default_permission: String,
}
