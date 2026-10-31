//! Warshad — Daemon binary: local API (JSON-RPC over Unix socket / named pipe + localhost HTTP/WebSocket with token)

use axum::{
    extract::{ws::WebSocketUpgrade, State},
    http::header::AUTHORIZATION,
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
use std::collections::HashMap;
use std::future::Future;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::pin::Pin;
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
    AgentLoop, AgentTurnResult, BackendKind, BackendKit, CrashReport, CrashReportStore,
    FilesystemToolExecutor, HandoffBundle, HandoffManager, InMemoryCrashReportStore,
    InMemoryMcpManager, InMemoryPairingStore, InMemoryPreferenceStore, InMemoryProcessManager,
    InMemoryStoreReviewStore, LivePreview, LivePreviewManager, ManagedProcess, McpConnection,
    McpManager, PairingStore, PhonePairing, PipelineEngine, Preference, PreferenceSignal,
    PreferenceStore, ProcessManager, ProcessStatus, ProcessSummary, ProviderRouterAdapter, RunMode,
    RunModeConfig, SlashCommand, SlashCommandRegistry, StoreReview, StoreReviewStore, AGENT_ROLE,
};
use warsha_providers::{
    probe_endpoint, HealthCheck, KeychainSecretStore, OneClickProvider, ProviderRouter,
    ProviderSetupWizard, SecretStore,
};
use warsha_remote::DeviceRegistry;
use warsha_store::{Store, StoredProvider};

mod settings;

pub use settings::{SettingsError, SettingsStore};

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

/// Daemon configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonConfig {
    pub data_dir: PathBuf,
    pub socket_path: PathBuf,
    pub http_port: u16,
    pub ws_port: u16,
    pub auth_token: String,
    pub allowed_origins: Vec<String>,
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
            auth_token: String::new(), // Generated on first run
            allowed_origins: vec![
                "http://localhost:5173".to_string(),
                "tauri://localhost".to_string(),
            ],
        }
    }
}

/// Handle to a running daemon instance.
pub struct DaemonHandle {
    _lock_file: LockFile,
    http_task: tokio::task::JoinHandle<()>,
    rpc_server: jsonrpsee::server::ServerHandle,
    http_port: u16,
    rpc_port: u16,
    /// The one spawner, so shutdown can take the daemon's children with it.
    processes: Arc<dyn ProcessManager>,
}

impl std::fmt::Debug for DaemonHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // The spawner holds live children and is not `Debug`, so the handle
        // reports the ports it is serving on and the lock it holds rather than
        // pretending to print a process table.
        f.debug_struct("DaemonHandle")
            .field("http_port", &self.http_port)
            .field("rpc_port", &self.rpc_port)
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
        if killed > 0 {
            info!("killed {killed} child process(es) on shutdown");
        }
        // The lock file is dropped here, releasing the lock and removing the file.
    }
}

/// Tower layer for RPC authentication.
/// Checks the Authorization header for a valid Bearer token.
#[derive(Clone)]
struct RpcAuthLayer {
    expected_token: String,
}

impl<S> Layer<S> for RpcAuthLayer {
    type Service = RpcAuthService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        RpcAuthService {
            inner,
            expected_token: self.expected_token.clone(),
        }
    }
}

/// Tower service for RPC authentication.
/// Mirrors the pattern used by jsonrpsee's own `HostFilter` middleware layer.
#[derive(Clone)]
struct RpcAuthService<S> {
    inner: S,
    expected_token: String,
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
        let authorized = {
            let expected = self.expected_token.as_str();
            req.headers()
                .get(AUTHORIZATION)
                .and_then(|h| h.to_str().ok())
                .and_then(|h| h.strip_prefix("Bearer "))
                .is_some_and(|token| token == expected)
        };

        if !authorized {
            let body = serde_json::json!({ "error": "unauthorized" }).to_string();
            let mut resp = jsonrpsee::server::http::response::ok_response(body);
            *resp.status_mut() = axum::http::StatusCode::UNAUTHORIZED;
            resp.headers_mut().insert(
                axum::http::header::CONTENT_TYPE,
                axum::http::HeaderValue::from_static("application/json"),
            );
            return Box::pin(async move { Ok(resp) });
        }

        let fut = self.inner.call(req);
        Box::pin(async move { fut.await.map_err(Into::into) })
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

    /// Socket path
    #[arg(long)]
    pub socket: Option<PathBuf>,
}

/// Daemon state
pub struct DaemonState {
    pub config: DaemonConfig,
    pub store: Arc<Store>,
    pub providers: Arc<RwLock<ProviderRouter>>,
    pub pipeline: Arc<PipelineEngine>,
    pub backends: Vec<Box<dyn warsha_backends::CodingBackend>>,
    pub github: Option<GitHubClient>,
    pub devices: Arc<DeviceRegistry>,
    pub event_tx: broadcast::Sender<Event>,
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
    /// TODO(persistence): the loop lives in memory, so a restart forgets the
    /// approval history and the todos; `Store` persistence is a later batch.
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
}

/// JSON-RPC API trait
#[rpc(server)]
pub trait WarshaApi {
    #[method(name = "health")]
    async fn health(&self) -> RpcResult<HealthResponse>;

    #[method(name = "projects.list")]
    async fn list_projects(&self) -> RpcResult<Vec<Project>>;

    #[method(name = "projects.create")]
    async fn create_project(
        &self,
        name: String,
        description: String,
        language: String,
    ) -> RpcResult<Project>;

    #[method(name = "projects.get")]
    async fn get_project(&self, id: ProjectId) -> RpcResult<Project>;

    #[method(name = "runs.start")]
    async fn start_run(&self, project_id: ProjectId, idea: String) -> RpcResult<Run>;

    #[method(name = "runs.get")]
    async fn get_run(&self, run_id: RunId) -> RpcResult<Run>;

    #[method(name = "runs.list")]
    async fn list_runs(&self, project_id: ProjectId) -> RpcResult<Vec<Run>>;

    #[method(name = "runs.events")]
    async fn get_events(&self, run_id: RunId) -> RpcResult<Vec<Event>>;

    #[method(name = "gates.approve")]
    async fn approve_gate(
        &self,
        run_id: RunId,
        stage: Stage,
        device_id: DeviceId,
    ) -> RpcResult<Run>;

    #[method(name = "gates.reject")]
    async fn reject_gate(
        &self,
        run_id: RunId,
        stage: Stage,
        reason: String,
        device_id: DeviceId,
    ) -> RpcResult<Run>;

    #[method(name = "gates.changes")]
    async fn request_changes(
        &self,
        run_id: RunId,
        stage: Stage,
        notes: String,
        device_id: DeviceId,
    ) -> RpcResult<Run>;

    #[method(name = "providers.list")]
    async fn list_providers(&self) -> RpcResult<Vec<ProviderRecord>>;

    /// Add a provider and put its API key in the OS keychain.
    ///
    /// Four named parameters, which is the object the wizard already sends
    /// (`{ name, kind, key, api_base }`): the key rides on this one call and
    /// nowhere else, and `api_base` is `None` when the caller sent none.
    #[method(name = "providers.add")]
    async fn add_provider(
        &self,
        name: String,
        kind: String,
        key: String,
        api_base: Option<String>,
    ) -> RpcResult<ProviderRecord>;

    /// Test a stored provider's connection. A refusal is a JSON-RPC error whose
    /// message says why and whose `data` carries the [`HealthCheck`].
    #[method(name = "providers.test")]
    async fn test_provider(&self, name: String) -> RpcResult<HealthCheck>;

    #[method(name = "devices.list")]
    async fn list_devices(&self) -> RpcResult<Vec<warsha_remote::DeviceIdentity>>;

    #[method(name = "devices.pair")]
    async fn pair_device(&self, pairing_data: warsha_remote::PairingData) -> RpcResult<()>;

    #[method(name = "devices.revoke")]
    async fn revoke_device(&self, device_id: DeviceId) -> RpcResult<()>;

    // Providers
    #[method(name = "providers.remove")]
    async fn remove_provider(&self, name: String) -> RpcResult<ProviderRecord>;

    // Roles
    #[method(name = "roles.list")]
    async fn list_roles(&self) -> RpcResult<Vec<RoleRoutingConfig>>;

    #[method(name = "roles.set")]
    async fn set_role(&self, config: RoleRoutingConfig) -> RpcResult<()>;

    // Budget
    #[method(name = "budget.show")]
    async fn show_budget(&self, project_id: ProjectId) -> RpcResult<BudgetStatus>;

    #[method(name = "budget.set")]
    async fn set_budget(&self, project_id: ProjectId, cents: u64) -> RpcResult<()>;

    // Backend kit (PLAN.md M19) — first wiring batch
    #[method(name = "backend.export")]
    async fn export_backend(&self, run_id: String, output_dir: String) -> RpcResult<String>;

    // Continue on server (PLAN.md M6a) — first wiring batch
    #[method(name = "handoff.create")]
    async fn create_handoff(
        &self,
        run_id: String,
        files: Vec<(String, String)>,
    ) -> RpcResult<String>;

    #[method(name = "handoff.apply")]
    async fn apply_handoff(&self, path: String, owner_wins: bool) -> RpcResult<String>;

    // Post-launch care (PLAN.md M17) — read halves only
    #[method(name = "postlaunch.crashes")]
    async fn list_crash_reports(&self, run_id: String) -> RpcResult<Vec<CrashReport>>;

    #[method(name = "postlaunch.reviews")]
    async fn list_store_reviews(&self, store: String) -> RpcResult<Vec<StoreReview>>;

    // Agent workflow (PLAN.md M18) — the skills catalog and one turn
    #[method(name = "skills.list")]
    async fn list_skills(&self) -> RpcResult<Vec<SlashCommand>>;

    #[method(name = "agent.turn")]
    async fn agent_turn(&self, input: String) -> RpcResult<AgentTurnResult>;

    // Process spawning and MCP transports (PLAN.md M20) — real child processes
    #[method(name = "process.spawn")]
    async fn spawn_process(
        &self,
        command: String,
        args: Vec<String>,
        env: HashMap<String, String>,
    ) -> RpcResult<String>;

    #[method(name = "process.stop")]
    async fn stop_process(&self, id: String) -> RpcResult<()>;

    #[method(name = "process.status")]
    async fn process_status(&self, id: String) -> RpcResult<ProcessStatus>;

    #[method(name = "process.list")]
    async fn list_processes(&self) -> RpcResult<Vec<ProcessSummary>>;

    #[method(name = "mcp.connect")]
    async fn connect_mcp(
        &self,
        config: warsha_pipeline::mcp_transport::McpServerConfig,
    ) -> RpcResult<()>;

    #[method(name = "mcp.disconnect")]
    async fn disconnect_mcp(&self, name: String) -> RpcResult<()>;

    #[method(name = "mcp.list")]
    async fn list_mcp(&self) -> RpcResult<Vec<McpConnection>>;

    #[method(name = "mcp.send")]
    async fn send_mcp(&self, name: String, payload: String) -> RpcResult<String>;

    // Live preview dev server (PLAN.md M5b + M20)
    #[method(name = "preview.start")]
    async fn start_preview(&self, project_id: String, command: String) -> RpcResult<LivePreview>;

    #[method(name = "preview.stop")]
    async fn stop_preview(&self, project_id: String) -> RpcResult<()>;

    #[method(name = "preview.status")]
    async fn preview_status(&self, project_id: String) -> RpcResult<LivePreview>;

    // Settings that survive a restart (PLAN.md M20) — the four stored records.
    // Every method here writes through to the settings file before it answers, so
    // a restart sees the change; a write that could not be stored is an error the
    // caller sees rather than a change the owner believes they made.
    #[method(name = "runmode.list")]
    async fn list_run_modes(&self) -> RpcResult<Vec<RunModeConfig>>;

    #[method(name = "runmode.set")]
    async fn set_run_mode(&self, config: RunModeConfig) -> RpcResult<RunModeConfig>;

    #[method(name = "backend.get")]
    async fn get_backend(&self, run_id: String) -> RpcResult<Option<BackendKit>>;

    #[method(name = "backend.set")]
    async fn set_backend(&self, run_id: String, kit: BackendKit) -> RpcResult<()>;

    #[method(name = "preferences.list")]
    async fn list_preferences(&self, project_id: String) -> RpcResult<Vec<Preference>>;

    #[method(name = "preferences.record")]
    async fn record_preference(&self, signal: PreferenceSignal) -> RpcResult<Vec<Preference>>;

    #[method(name = "pairing.list")]
    async fn list_pairings(&self) -> RpcResult<Vec<PhonePairing>>;

    #[method(name = "pairing.create")]
    async fn create_pairing(&self, device_id: String, secret: String) -> RpcResult<PhonePairing>;

    #[method(name = "pairing.revoke")]
    async fn revoke_pairing(&self, device_id: String) -> RpcResult<PhonePairing>;
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
fn provider_endpoint(provider: &StoredProvider) -> Option<String> {
    provider.api_base.clone().or_else(|| {
        OneClickProvider::from_tag(&provider.kind)
            .and_then(OneClickProvider::default_base_url)
            .map(str::to_string)
    })
}

/// The model `provider` is tested with: its kind's published default, or `""` when
/// the kind has none — which the setup check reports as "Enter the model id."
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
    async fn health(&self) -> RpcResult<HealthResponse> {
        Ok(HealthResponse {
            status: "healthy".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            uptime_seconds: self.start_time.elapsed().as_secs(),
        })
    }

    async fn list_projects(&self) -> RpcResult<Vec<Project>> {
        self.state
            .store
            .list_projects()
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn create_project(
        &self,
        name: String,
        description: String,
        language: String,
    ) -> RpcResult<Project> {
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

    async fn get_project(&self, id: ProjectId) -> RpcResult<Project> {
        self.state
            .store
            .get_project(id)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn start_run(&self, project_id: ProjectId, idea: String) -> RpcResult<Run> {
        self.state
            .pipeline
            .start_run(project_id, &idea)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn get_run(&self, run_id: RunId) -> RpcResult<Run> {
        self.state
            .store
            .get_run(run_id)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn list_runs(&self, project_id: ProjectId) -> RpcResult<Vec<Run>> {
        self.state
            .store
            .list_runs(project_id)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn get_events(&self, run_id: RunId) -> RpcResult<Vec<Event>> {
        self.state
            .store
            .get_events(run_id)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn approve_gate(
        &self,
        run_id: RunId,
        stage: Stage,
        device_id: DeviceId,
    ) -> RpcResult<Run> {
        self.state
            .pipeline
            .approve_gate(run_id, stage, device_id)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn reject_gate(
        &self,
        run_id: RunId,
        stage: Stage,
        reason: String,
        device_id: DeviceId,
    ) -> RpcResult<Run> {
        self.state
            .pipeline
            .reject_gate(run_id, stage, reason, device_id)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn request_changes(
        &self,
        run_id: RunId,
        stage: Stage,
        notes: String,
        device_id: DeviceId,
    ) -> RpcResult<Run> {
        self.state
            .pipeline
            .request_changes(run_id, stage, notes, device_id)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn list_providers(&self) -> RpcResult<Vec<ProviderRecord>> {
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
        name: String,
        kind: String,
        key: String,
        api_base: Option<String>,
    ) -> RpcResult<ProviderRecord> {
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err(provider_refusal("a provider needs a name"));
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
    async fn test_provider(&self, name: String) -> RpcResult<HealthCheck> {
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

        // No network yet: a malformed URL or a key the owner typed with a space in
        // it is refused here, from the wizard's own checks.
        if let Some(reason) =
            ProviderSetupWizard::test_connection(&endpoint, &key, provider_model(&provider))
                .reason()
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

    async fn list_devices(&self) -> RpcResult<Vec<warsha_remote::DeviceIdentity>> {
        Ok(self.state.devices.list_devices().await)
    }

    async fn pair_device(&self, pairing_data: warsha_remote::PairingData) -> RpcResult<()> {
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
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn revoke_device(&self, device_id: DeviceId) -> RpcResult<()> {
        self.state
            .devices
            .revoke_device(device_id)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    // Providers
    async fn remove_provider(&self, name: String) -> RpcResult<ProviderRecord> {
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

        info!("provider {name} removed");
        Ok(provider.into())
    }

    // Roles
    async fn list_roles(&self) -> RpcResult<Vec<RoleRoutingConfig>> {
        Ok(vec![])
    }

    async fn set_role(&self, _config: RoleRoutingConfig) -> RpcResult<()> {
        Ok(())
    }

    // Budget
    async fn show_budget(&self, project_id: ProjectId) -> RpcResult<BudgetStatus> {
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

    async fn set_budget(&self, project_id: ProjectId, cents: u64) -> RpcResult<()> {
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
    async fn export_backend(&self, run_id: String, output_dir: String) -> RpcResult<String> {
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
        run_id: String,
        files: Vec<(String, String)>,
    ) -> RpcResult<String> {
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

    async fn apply_handoff(&self, path: String, owner_wins: bool) -> RpcResult<String> {
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
    async fn list_crash_reports(&self, run_id: String) -> RpcResult<Vec<CrashReport>> {
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

    async fn list_store_reviews(&self, store: String) -> RpcResult<Vec<StoreReview>> {
        let reviews = self.state.store_reviews.read().await;
        let wanted = store.trim();
        Ok(if wanted.is_empty() {
            reviews.list()
        } else {
            reviews.list_by_store(wanted)
        })
    }

    // Agent workflow (PLAN.md M18)
    async fn list_skills(&self) -> RpcResult<Vec<SlashCommand>> {
        Ok(skill_catalog())
    }

    async fn agent_turn(&self, input: String) -> RpcResult<AgentTurnResult> {
        // The turn parses, decides and compacts; in Agent mode it may also run one
        // tool or make one model call, so the write lock is held across that await.
        // Nothing else takes this lock mid-turn, so the ordering stays one turn at a
        // time — which is what keeps the todo list and the transcript coherent.
        let skills = skill_catalog();
        let mut agent_loop = self.state.agent_loop.write().await;
        Ok(agent_loop.run_turn(&input, &skills).await)
    }

    // Process spawning and MCP transports (PLAN.md M20)
    async fn spawn_process(
        &self,
        command: String,
        args: Vec<String>,
        env: HashMap<String, String>,
    ) -> RpcResult<String> {
        self.state
            .processes
            .spawn(&command, &args, &env)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn stop_process(&self, id: String) -> RpcResult<()> {
        self.state
            .processes
            .stop(&id)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn process_status(&self, id: String) -> RpcResult<ProcessStatus> {
        self.state
            .processes
            .status(&id)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn list_processes(&self) -> RpcResult<Vec<ProcessSummary>> {
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
        config: warsha_pipeline::mcp_transport::McpServerConfig,
    ) -> RpcResult<()> {
        // An `Http`/`WebSocket` config succeeds without connecting: the transport
        // is recorded and `mcp.list` reports it as disconnected (see
        // `McpServerConfig::is_wired`).
        self.state
            .mcp
            .connect(config)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn disconnect_mcp(&self, name: String) -> RpcResult<()> {
        self.state
            .mcp
            .disconnect(&name)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn list_mcp(&self) -> RpcResult<Vec<McpConnection>> {
        Ok(self.state.mcp.list().await)
    }

    async fn send_mcp(&self, name: String, payload: String) -> RpcResult<String> {
        self.state
            .mcp
            .send(&name, &payload)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    // Live preview dev server (PLAN.md M5b + M20)
    async fn start_preview(&self, project_id: String, command: String) -> RpcResult<LivePreview> {
        // The command line is split on whitespace by the pipeline (no shell), so
        // `npm run dev` runs `npm` with `run dev` and nothing else is interpreted.
        self.state
            .previews
            .start(&project_id, &command)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn stop_preview(&self, project_id: String) -> RpcResult<()> {
        self.state
            .previews
            .stop(&project_id)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn preview_status(&self, project_id: String) -> RpcResult<LivePreview> {
        self.state
            .previews
            .status(&project_id)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    // Settings that survive a restart (PLAN.md M20)
    async fn list_run_modes(&self) -> RpcResult<Vec<RunModeConfig>> {
        // Mode order, not insertion order: the caller renders a switch, and a
        // switch whose rows move when one of them is saved is a switch that
        // reorders itself under the pointer.
        let modes = self.state.run_modes.read().await;
        Ok(RunMode::all()
            .into_iter()
            .filter_map(|mode| modes.get(&mode).cloned())
            .collect())
    }

    async fn set_run_mode(&self, config: RunModeConfig) -> RpcResult<RunModeConfig> {
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

    async fn get_backend(&self, run_id: String) -> RpcResult<Option<BackendKit>> {
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

    async fn set_backend(&self, run_id: String, kit: BackendKit) -> RpcResult<()> {
        let (key, _project_name) = self.project_for_run(&run_id).await;
        self.remember_backend_kit(&key, &kit).await
    }

    async fn list_preferences(&self, project_id: String) -> RpcResult<Vec<Preference>> {
        let preferences = self.state.stored_preferences.read().await;
        Ok(preferences
            .get(project_id.trim())
            .cloned()
            .unwrap_or_default())
    }

    async fn record_preference(&self, signal: PreferenceSignal) -> RpcResult<Vec<Preference>> {
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

    async fn list_pairings(&self) -> RpcResult<Vec<PhonePairing>> {
        Ok(self.state.pairings.read().await.list())
    }

    async fn create_pairing(&self, device_id: String, secret: String) -> RpcResult<PhonePairing> {
        let pairing = {
            let mut pairings = self.state.pairings.write().await;
            pairings
                .create(&device_id, &secret, now_epoch_secs())
                .map_err(|error| rpc_error(error.to_string()))?
        };
        self.save_pairings().await?;
        Ok(pairing)
    }

    async fn revoke_pairing(&self, device_id: String) -> RpcResult<PhonePairing> {
        let pairing = {
            let mut pairings = self.state.pairings.write().await;
            pairings
                .revoke(&device_id)
                .map_err(|error| rpc_error(error.to_string()))?
        };
        self.save_pairings().await?;
        Ok(pairing)
    }
}

/// One JSON-RPC error object for every failure these methods can return.
///
/// `-32000` is the daemon's existing "server error" code; the message is the
/// `thiserror` rendering, which names the process, server or project involved.
fn rpc_error(message: String) -> ErrorObjectOwned {
    ErrorObject::owned(-32000, message, None::<()>)
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
fn skill_catalog() -> Vec<SlashCommand> {
    let mut registry = SlashCommandRegistry::new();
    for (name, description) in SKILL_CATALOG {
        let _ = registry.register(SlashCommand::new(*name, *description));
    }
    registry.skills()
}

/// Directory under the daemon's data directory that holds handoff bundles.
const HANDOFF_DIR: &str = "handoff";

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
) -> Arc<RwLock<AgentLoop>> {
    let tools = FilesystemToolExecutor::new(data_dir.join(AGENT_WORKSPACE_DIR));
    let router = ProviderRouterAdapter::new(providers, AGENT_ROLE, AGENT_METER_KEY);
    Arc::new(RwLock::new(
        AgentLoop::with_tool_executor(Box::new(tools)).with_router(Arc::new(router)),
    ))
}

/// HTTP server for REST API and WebSocket
async fn health_handler() -> impl IntoResponse {
    Json(HealthResponse {
        status: "healthy".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_seconds: 0,
    })
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
pub async fn start_daemon_with_secrets(
    config: DaemonConfig,
    secrets: Arc<dyn SecretStore>,
) -> Result<DaemonHandle> {
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
        .register_provider(Box::new(warsha_providers::MockProvider::new("mock")));

    // Initialize pipeline
    let pipeline = Arc::new(PipelineEngine::new(store.clone(), providers.clone()));

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

    // Create broadcast channel for event streaming
    let (event_tx, _) = broadcast::channel::<Event>(1024);

    // One spawner for the daemon: the MCP stdio transport starts its server
    // through it and the live preview runs its dev server on it, so `process.list`
    // is the one place that names every child.
    let processes: Arc<dyn ProcessManager> = InMemoryProcessManager::shared();
    let mcp: Arc<dyn McpManager> = Arc::new(InMemoryMcpManager::new(processes.clone()));
    let previews = Arc::new(LivePreviewManager::new(processes.clone()));

    // The agent loop's two seams, wired to the real thing: its file tools run
    // inside `<data_dir>/workspace`, and its model calls go out through the same
    // router the pipeline stages use.
    let agent_loop = build_agent_loop(&config.data_dir, providers.clone());

    // Seed the four settings records from the file before the RPC surface opens.
    // A daemon that answered the first request from an empty switch while the
    // owner's settings sat on disk would be the bug this batch exists to fix, so
    // the seeding is part of starting rather than a background warm-up.
    let run_modes = seed_run_modes(&settings).await?;
    let backend_kits = seed_backend_kits(&store, &settings).await?;
    let stored_preferences = seed_preferences(&store, &settings).await?;
    let pairings = seed_pairings(&settings).await?;

    let state = Arc::new(DaemonState {
        config: config.clone(),
        store,
        providers,
        pipeline,
        backends,
        github,
        devices,
        event_tx,
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
    });

    // Start JSON-RPC server (TCP for cross-platform compatibility)
    let rpc_addr: SocketAddr = format!("127.0.0.1:{}", config.ws_port)
        .parse()
        .map_err(|e| DaemonError::Config(format!("invalid RPC bind address: {e}")))?;
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
        expected_token: config.auth_token.clone(),
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
    let rpc = WarshaRpc::new(state.clone());
    let rpc_handle = rpc_server.start(rpc.into_rpc());
    {
        let stopped_handle = rpc_handle.clone();
        tokio::spawn(async move {
            stopped_handle.stopped().await;
            info!("RPC server stopped");
        });
    }
    info!("JSON-RPC server listening on 127.0.0.1:{}", actual_rpc_port);

    // Start HTTP/WebSocket server. The same origin list as the RPC server, parsed above.
    let cors = CorsLayer::new()
        .allow_origin(allowed_origins)
        .allow_methods(Any)
        .allow_headers(Any);

    // Auth middleware: require Bearer token on all routes except /health
    let auth_token = config.auth_token.clone();
    let auth_middleware = axum::middleware::from_fn(
        move |headers: axum::http::HeaderMap,
              request: axum::http::Request<axum::body::Body>,
              next: axum::middleware::Next| {
            let token = auth_token.clone();
            async move { auth_handler_inner(token, headers, request, next).await }
        },
    );

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/events", get(events_handler))
        .layer(auth_middleware)
        .layer(cors)
        .with_state(state.clone());

    let http_listener =
        tokio::net::TcpListener::bind(format!("127.0.0.1:{}", config.http_port)).await?;
    let actual_http_port = http_listener.local_addr()?.port();
    info!(
        "HTTP server listening on http://127.0.0.1:{}",
        actual_http_port
    );

    let http_task = tokio::spawn(async move {
        if let Err(e) = axum::serve(http_listener, app).await {
            error!("HTTP server error: {}", e);
        }
    });

    Ok(DaemonHandle {
        _lock_file: lock_file,
        http_task,
        rpc_server: rpc_handle,
        http_port: actual_http_port,
        rpc_port: actual_rpc_port,
        // The daemon's own spawner, not a second one: the sweep at shutdown has to
        // see the children the RPCs started.
        processes: state.processes.clone(),
    })
}

/// Main daemon entry point (kept for CLI compatibility)
pub async fn run_daemon(args: DaemonArgs) -> Result<()> {
    // Load or create config
    let config = load_or_create_config(args.config.as_deref()).await?;

    // Override with CLI args
    let mut config = config;
    config.http_port = args.http_port;
    config.ws_port = args.ws_port;
    if let Some(socket) = args.socket {
        config.socket_path = socket;
    }

    let handle = start_daemon(config).await?;
    info!(
        "HTTP server listening on http://127.0.0.1:{}",
        handle.http_port()
    );
    info!(
        "JSON-RPC server listening on 127.0.0.1:{}",
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
    let interrupted = tokio::signal::ctrl_c().await;
    handle.shutdown().await;
    interrupted?;
    Ok(())
}

pub async fn load_or_create_config(config_path: Option<&Path>) -> Result<DaemonConfig> {
    let config_dir = dirs::config_dir()
        .map(|d| d.join("warsha"))
        .unwrap_or_else(|| PathBuf::from(".").join("warsha"));
    std::fs::create_dir_all(&config_dir)?;

    let default_config_path = config_dir.join("config.toml");
    let path = config_path.unwrap_or(&default_config_path);

    if path.exists() {
        let content = std::fs::read_to_string(path)?;
        let config: DaemonConfig = toml::from_str(&content)?;
        Ok(config)
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

        Ok(config)
    }
}

fn acquire_lock(data_dir: &Path) -> Result<LockFile> {
    let lock_path = data_dir.join("warshad.lock");
    let mut lock = LockFile::new(lock_path)?;
    lock.try_lock()
        .map_err(|e| DaemonError::Lock(format!("Failed to acquire lock: {e}")))?;
    Ok(lock)
}

#[derive(Debug)]
struct LockFile {
    path: PathBuf,
    file: Option<std::fs::File>,
}

impl LockFile {
    fn new(path: PathBuf) -> Result<Self> {
        Ok(Self { path, file: None })
    }

    fn try_lock(&mut self) -> std::io::Result<()> {
        use std::fs::OpenOptions;
        // `truncate(false)` is deliberate: the lock file's contents are irrelevant,
        // and truncating a file another instance may be holding would be the wrong
        // semantic for a lock.
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(&self.path)?;

        // Take an exclusive advisory lock (blocking). On Unix this uses flock(2),
        // on Windows LockFileEx. The lock is released when the file is closed or
        // the process exits. If another instance holds the lock, this returns
        // WouldBlock which we convert to a Lock error.
        file.try_lock_exclusive()?;

        self.file = Some(file);
        Ok(())
    }
}

impl Drop for LockFile {
    fn drop(&mut self) {
        if let Some(file) = self.file.take() {
            // Release the lock before dropping
            let _ = file.unlock();
            drop(file);
        }
        // Remove the lock file on clean shutdown
        let _ = std::fs::remove_file(&self.path);
    }
}

fn get_github_token() -> Result<String> {
    // keyring 1.2's `Entry::new` is infallible (it returns `Entry`, not a `Result`).
    let entry = Entry::new("warsha", "github_token");
    entry
        .get_password()
        .map_err(|_| DaemonError::Config("GitHub token not in keychain".to_string()))
}

/// Auth middleware: require Bearer token on all routes except /health
async fn auth_handler_inner(
    expected_token: String,
    headers: axum::http::HeaderMap,
    request: axum::http::Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> Response {
    let path = request.uri().path();
    if path == "/health" {
        return next.run(request).await;
    }

    let token = headers
        .get(AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "));

    match token {
        Some(token) if token == expected_token => next.run(request).await,
        Some(_) => {
            warn!("Invalid token for {}", path);
            Json(serde_json::json!({"error": "invalid token"})).into_response()
        }
        None => {
            warn!("Unauthorized request to {}", path);
            Json(serde_json::json!({"error": "unauthorized"})).into_response()
        }
    }
}

/// WebSocket handler for /events endpoint
async fn events_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<DaemonState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_events_socket(socket, state.event_tx.subscribe()))
}

async fn handle_events_socket(
    mut socket: axum::extract::ws::WebSocket,
    mut rx: broadcast::Receiver<Event>,
) {
    // Send ping every 30 seconds to keep connection alive
    let mut ping_interval = tokio::time::interval(tokio::time::Duration::from_secs(30));

    loop {
        tokio::select! {
            event = rx.recv() => {
                match event {
                    Ok(event) => {
                        let json = serde_json::to_string(&event).unwrap_or_default();
                        if socket.send(axum::extract::ws::Message::Text(json)).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        // Subscriber lagged, skip
                        continue;
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        // Channel closed, exit
                        break;
                    }
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
        let temp_dir = tempfile::tempdir().unwrap();
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
        std::fs::create_dir_all(data_dir).expect("the data directory is made");
        let config = DaemonConfig {
            data_dir: data_dir.to_path_buf(),
            auth_token: "test-token".to_string(),
            ..Default::default()
        };
        let store = Arc::new(
            Store::open_at(data_dir.join("warsha.db"))
                .await
                .expect("the store opens"),
        );
        let providers = Arc::new(RwLock::new(agent_router_with_mock()));
        let pipeline = Arc::new(PipelineEngine::new(store.clone(), providers.clone()));
        let identity = warsha_remote::DeviceIdentity::generate("test daemon".to_string())
            .expect("a device identity");
        let (event_tx, _) = broadcast::channel::<Event>(16);

        let processes: Arc<dyn ProcessManager> = InMemoryProcessManager::shared();
        let mcp: Arc<dyn McpManager> = Arc::new(InMemoryMcpManager::new(processes.clone()));
        let previews = Arc::new(LivePreviewManager::new(processes.clone()));
        let agent_loop = build_agent_loop(data_dir, providers.clone());
        let settings = Arc::new(
            SettingsStore::open(&data_dir.join("warsha.db"))
                .await
                .expect("the settings open"),
        );

        let state = Arc::new(DaemonState {
            config,
            store: store.clone(),
            providers,
            pipeline,
            backends: BackendFactory::all_available(),
            github: None,
            devices: Arc::new(DeviceRegistry::new(identity)),
            event_tx,
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
        });
        (state, store)
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

        let temp = tempfile::tempdir().expect("a temporary directory");
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
            .apply_handoff(path, false)
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
        let temp = tempfile::tempdir().expect("a temporary directory");
        let (state, store) = test_state(temp.path()).await;
        let run = stored_run(&store, "Shop", None).await;

        let bundle = HandoffManager::new().create_bundle(&run.id.0.to_string(), &[("a.rs", "a\n")]);
        let handoff_dir = temp.path().join("handoff");
        let path = HandoffManager::new()
            .write_bundle(&bundle, &handoff_dir.to_string_lossy())
            .expect("the bundle is written");

        let error = WarshaRpc::new(state)
            .apply_handoff(path, true)
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
        let temp = tempfile::tempdir().expect("a temporary directory");
        let (state, store) = test_state(&temp.path().join("data")).await;
        let run = stored_run(&store, "Shop", None).await;

        let output_dir = temp.path().join("export");
        let path = WarshaRpc::new(state)
            .export_backend(
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
        let temp = tempfile::tempdir().expect("a temporary directory");
        let (state, _store) = test_state(temp.path()).await;

        let skills = WarshaRpc::new(state)
            .list_skills()
            .await
            .expect("the catalog is served");

        let names: Vec<&str> = skills.iter().map(|skill| skill.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["/review", "/refactor", "/test", "/fix", "/explain"]
        );
        assert!(skills
            .iter()
            .all(|skill| !skill.description.trim().is_empty()));
        // The same list resolves as a registry, which is what `agent.turn` does
        // with it: `/FIX` and `fix` are one command.
        let registry = SlashCommandRegistry::from_skills(&skills);
        assert_eq!(
            registry.lookup("/FIX").map(|command| command.name.as_str()),
            Some("/fix")
        );
    }

    #[tokio::test]
    async fn agent_turn_plans_first_and_executes_after_the_owner_approves() {
        use warsha_pipeline::AgentMode;

        let temp = tempfile::tempdir().expect("a temporary directory");
        let (state, _store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state.clone());

        let planned = rpc
            .agent_turn("/review the diff of @file src/main.rs".to_string())
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
            .agent_turn("now apply it".to_string())
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

        let temp = tempfile::tempdir().expect("a temporary directory");
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
            .agent_turn("write file notes/hello.md: written by the agent".to_string())
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
            .agent_turn("write file ../escape.md: no".to_string())
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
        let temp = tempfile::tempdir().expect("a temporary directory");
        let (state, _store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);
        let (command, args) = long_running();

        let id = rpc
            .spawn_process(command.clone(), args.clone(), HashMap::new())
            .await
            .expect("the process starts");
        assert_eq!(
            rpc.process_status(id.clone()).await.unwrap(),
            ProcessStatus::Running
        );
        let listed = rpc.list_processes().await.expect("the list is served");
        let process = listed.first().expect("the process is listed");
        assert_eq!(process.id, id);
        assert_eq!(process.command, command);
        assert_eq!(process.args, args);
        assert!(process.started_at.is_some());

        rpc.stop_process(id.clone())
            .await
            .expect("the process stops");
        assert_eq!(
            rpc.process_status(id.clone()).await.unwrap(),
            ProcessStatus::Stopped
        );

        // A second stop has nothing left to signal, and an unknown id is refused.
        assert!(rpc.stop_process(id).await.is_err());
        assert!(rpc.process_status("proc-404".to_string()).await.is_err());
    }

    #[tokio::test]
    async fn mcp_rpcs_connect_send_and_disconnect_a_stdio_server() {
        let temp = tempfile::tempdir().expect("a temporary directory");
        let (state, _store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);
        let (command, args) = probe_command("mcp_probe_server");

        rpc.connect_mcp(warsha_pipeline::mcp_transport::McpServerConfig::new_stdio(
            "files", command, args,
        ))
        .await
        .expect("the server connects");
        let listed = rpc.list_mcp().await.expect("the list is served");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].status, warsha_pipeline::McpStatus::Connected);
        assert!(listed[0].process_id.is_some());
        // The handshake ran, so `mcp.list` reports what the server said it can do.
        assert_eq!(listed[0].tools, vec![PROBE_TOOL.to_string()]);

        let frame = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#;
        assert_eq!(
            rpc.send_mcp("files".to_string(), frame.to_string())
                .await
                .expect("the frame is written"),
            frame
        );

        rpc.disconnect_mcp("files".to_string())
            .await
            .expect("the server disconnects");
        let listed = rpc.list_mcp().await.expect("the list is served");
        assert_eq!(listed[0].status, warsha_pipeline::McpStatus::Disconnected);
        assert_eq!(listed[0].process_id, None);
        // Nothing is dialled for a *wired* name after the disconnect.
        assert!(rpc
            .send_mcp("files".to_string(), "{}".to_string())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn mcp_connect_records_an_http_transport_without_dialling_it() {
        let temp = tempfile::tempdir().expect("a temporary directory");
        let (state, _store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);

        rpc.connect_mcp(warsha_pipeline::mcp_transport::McpServerConfig::new_http(
            "remote",
            "https://mcp.example/mcp",
        ))
        .await
        .expect("the config is recorded");

        let listed = rpc.list_mcp().await.expect("the list is served");
        assert_eq!(listed[0].status, warsha_pipeline::McpStatus::Disconnected);
        assert_eq!(listed[0].process_id, None);
        assert!(rpc
            .list_processes()
            .await
            .expect("the list is served")
            .is_empty());
        // The transport is recorded, not wired, and the error says so.
        let error = rpc
            .send_mcp("remote".to_string(), "{}".to_string())
            .await
            .expect_err("nothing dials an http transport yet");
        assert!(format!("{error:?}").contains("not wired"));
    }

    #[tokio::test]
    async fn preview_rpcs_start_report_and_stop_one_dev_server_per_project() {
        let temp = tempfile::tempdir().expect("a temporary directory");
        let (state, _store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state.clone());
        let command = probe_line("preview_probe");

        let started = rpc
            .start_preview("project-1".to_string(), command.clone())
            .await
            .expect("the preview starts");
        assert_eq!(started.project_id, "project-1");
        // The dev server prints its address, and `preview.start` reports it (D4).
        assert_eq!(started.url.as_deref(), Some(PROBE_URL));
        let status = rpc
            .preview_status("project-1".to_string())
            .await
            .expect("the preview is tracked");
        assert_eq!(status.process_id, started.process_id);
        assert_eq!(status.status, ProcessStatus::Running);
        assert_eq!(status.url.as_deref(), Some(PROBE_URL));
        // The dev server is a real child, so `process.list` sees it too.
        assert_eq!(
            rpc.list_processes()
                .await
                .expect("the list is served")
                .len(),
            1
        );

        // One preview per project, and an unknown project is refused.
        assert!(rpc
            .start_preview("project-1".to_string(), command)
            .await
            .is_err());
        assert!(rpc.preview_status("nobody".to_string()).await.is_err());

        rpc.stop_preview("project-1".to_string())
            .await
            .expect("the preview stops");
        assert_eq!(
            rpc.preview_status("project-1".to_string())
                .await
                .expect("the preview is still tracked")
                .status,
            ProcessStatus::Stopped
        );
        // The process stays in the list as a stopped record.
        let listed = rpc.list_processes().await.expect("the list is served");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].status, ProcessStatus::Stopped);
    }
}
