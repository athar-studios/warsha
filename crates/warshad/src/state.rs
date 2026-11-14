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

fn redact_string(text: &str, auth_token: &str) -> bool {
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
        self.http_task.abort();
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
    #[arg(long)]
    pub bind_host: Option<String>,
    #[arg(long)]
    pub advertised_host: Option<String>,
    #[arg(long)]
    pub socket: Option<PathBuf>,
}
