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
    HandoffBundle, HandoffManager, InMemoryCrashReportStore, InMemoryMcpManager,
    InMemoryProcessManager, InMemoryStoreReviewStore, LivePreview, LivePreviewManager,
    ManagedProcess, McpConnection, McpManager, PipelineEngine, ProcessManager, ProcessStatus,
    ProcessSummary, SlashCommand, SlashCommandRegistry, StoreReview, StoreReviewStore,
};
use warsha_providers::{HealthCheck, ProviderRouter};
use warsha_remote::DeviceRegistry;
use warsha_store::Store;

#[derive(Error, Debug)]
pub enum DaemonError {
    #[error("Store error: {0}")]
    Store(#[from] warsha_store::StoreError),
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
#[derive(Debug)]
pub struct DaemonHandle {
    _lock_file: LockFile,
    http_task: tokio::task::JoinHandle<()>,
    rpc_server: jsonrpsee::server::ServerHandle,
    http_port: u16,
    rpc_port: u16,
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
    /// and releases the lock file.
    pub async fn shutdown(self) {
        if let Err(e) = self.rpc_server.stop() {
            warn!("RPC server was already stopped: {e}");
        }
        // Aborting the HTTP task drops its listener, so the port is released.
        self.http_task.abort();
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
    /// Backend kits per run, in memory for the first wiring batch.
    ///
    /// TODO(persistence): back this with `Store` so a restart keeps the schema a
    /// backend run built; the MCP client that fills it in is not wired yet, so a
    /// run starts from [`default_backend_kit`].
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
    /// own compactor is what keeps the transcript bounded.
    ///
    /// TODO(persistence): the loop lives in memory, so a restart forgets the
    /// approval history and the todos; `Store` persistence is a later batch.
    pub agent_loop: Arc<RwLock<AgentLoop>>,
    /// The one spawner: `process.*` drives it, the MCP stdio transport starts its
    /// server through it, and the live preview runs its dev server on it, so every
    /// child the daemon starts shows up in one `process.list`.
    ///
    /// TODO(reaping): nothing kills these children when the daemon exits, so a
    /// restart forgets a dev server that is still listening on its port.
    pub processes: Arc<dyn ProcessManager>,
    /// MCP servers by name, with their connections. `mcp.*` is its RPC surface.
    pub mcp: Arc<dyn McpManager>,
    /// Live-preview dev servers, one per project.
    pub previews: Arc<LivePreviewManager>,
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
    async fn list_providers(&self) -> RpcResult<Vec<ProviderConfig>>;

    #[method(name = "providers.add")]
    async fn add_provider(&self, config: ProviderConfig) -> RpcResult<()>;

    #[method(name = "providers.test")]
    async fn test_provider(&self, provider_id: String) -> RpcResult<HealthCheck>;

    #[method(name = "devices.list")]
    async fn list_devices(&self) -> RpcResult<Vec<warsha_remote::DeviceIdentity>>;

    #[method(name = "devices.pair")]
    async fn pair_device(&self, pairing_data: warsha_remote::PairingData) -> RpcResult<()>;

    #[method(name = "devices.revoke")]
    async fn revoke_device(&self, device_id: DeviceId) -> RpcResult<()>;

    // Providers
    #[method(name = "providers.remove")]
    async fn remove_provider(&self, provider_id: String) -> RpcResult<()>;

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
}

/// Health response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub uptime_seconds: u64,
}

/// Provider configuration for RPC
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub id: String,
    pub kind: String,
    pub api_base: Option<String>,
    pub models: Vec<String>,
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

    /// The name of the project behind a run, for a backend export.
    ///
    /// The kit names the project the export belongs to, so `backend.export`
    /// resolves RunId → Run → Project and falls back to the run id when a link is
    /// missing, which keeps an export of an unregistered run working.
    async fn project_name_for_run(&self, run_id: &str) -> String {
        let Ok(id) = run_id.parse::<ulid::Ulid>() else {
            return run_id.to_string();
        };
        let Ok(run) = self.state.store.get_run(RunId(id)).await else {
            return run_id.to_string();
        };
        let Ok(project) = self.state.store.get_project(run.project_id).await else {
            return run_id.to_string();
        };
        if project.name.trim().is_empty() {
            run_id.to_string()
        } else {
            project.name
        }
    }
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

    async fn list_providers(&self) -> RpcResult<Vec<ProviderConfig>> {
        // Return empty for now
        Ok(vec![])
    }

    async fn add_provider(&self, _config: ProviderConfig) -> RpcResult<()> {
        Ok(())
    }

    async fn test_provider(&self, _provider_id: String) -> RpcResult<HealthCheck> {
        Ok(HealthCheck {
            healthy: true,
            latency_ms: Some(10),
            error: None,
        })
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
    async fn remove_provider(&self, _provider_id: String) -> RpcResult<()> {
        Ok(())
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
        // The kit is created here on first use: no RPC adds tables yet, so an
        // export is the header plus whatever an in-process caller put in the map.
        // It is built from the run's project, so the dump, the storage archive
        // stem and the header all name the project rather than the run.
        let project_name = self.project_name_for_run(&run_id).await;
        let kit = self
            .state
            .backend_kits
            .write()
            .await
            .entry(run_id.clone())
            .or_insert_with(|| default_backend_kit(&project_name))
            .clone();

        kit.export_to_dir(&output_dir)
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
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
        // The turn is synchronous (it parses, decides and compacts), so the write
        // lock is held for its duration and no `.await` runs inside it.
        let skills = skill_catalog();
        let mut agent_loop = self.state.agent_loop.write().await;
        Ok(agent_loop.run_turn(&input, &skills))
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

/// The backend kit a run starts from until the MCP layer fills one in.
///
/// PocketBase is the PLAN's preferred backend, and the project name is what the
/// export header and the storage archive stem are made of.
fn default_backend_kit(project_name: &str) -> BackendKit {
    BackendKit::from_project(project_name, LOCAL_POCKETBASE_URL, BackendKind::PocketBase)
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
    // Ensure single instance lock
    let lock_file = acquire_lock(&config.data_dir)?;

    // Ensure data directory exists
    std::fs::create_dir_all(&config.data_dir)?;

    // Initialize store with configurable path
    let db_path = config.data_dir.join("warsha.db");
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

    let state = Arc::new(DaemonState {
        config: config.clone(),
        store,
        providers,
        pipeline,
        backends,
        github,
        devices,
        event_tx,
        backend_kits: Arc::new(RwLock::new(HashMap::new())),
        crash_reports: Arc::new(RwLock::new(InMemoryCrashReportStore::new())),
        store_reviews: Arc::new(RwLock::new(InMemoryStoreReviewStore::new())),
        agent_loop: Arc::new(RwLock::new(AgentLoop::new())),
        processes,
        mcp,
        previews,
    });

    // Start JSON-RPC server (TCP for cross-platform compatibility)
    let rpc_addr: SocketAddr = format!("127.0.0.1:{}", config.ws_port)
        .parse()
        .map_err(|e| DaemonError::Config(format!("invalid RPC bind address: {e}")))?;
    let rpc_auth_layer = RpcAuthLayer {
        expected_token: config.auth_token.clone(),
    };
    let rpc_server = ServerBuilder::default()
        .set_http_middleware(tower::ServiceBuilder::new().layer(rpc_auth_layer))
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

    // Start HTTP/WebSocket server
    let allowed_origins = config
        .allowed_origins
        .clone()
        .into_iter()
        .filter_map(|o| o.parse::<axum::http::HeaderValue>().ok())
        .collect::<Vec<axum::http::HeaderValue>>();

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
    tokio::signal::ctrl_c().await?;

    handle.shutdown().await;
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
        let providers = Arc::new(RwLock::new(ProviderRouter::new()));
        let pipeline = Arc::new(PipelineEngine::new(store.clone(), providers.clone()));
        let identity = warsha_remote::DeviceIdentity::generate("test daemon".to_string())
            .expect("a device identity");
        let (event_tx, _) = broadcast::channel::<Event>(16);

        let processes: Arc<dyn ProcessManager> = InMemoryProcessManager::shared();
        let mcp: Arc<dyn McpManager> = Arc::new(InMemoryMcpManager::new(processes.clone()));
        let previews = Arc::new(LivePreviewManager::new(processes.clone()));

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
            agent_loop: Arc::new(RwLock::new(AgentLoop::new())),
            processes,
            mcp,
            previews,
        });
        (state, store)
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
        assert!(executed.response.contains("mock execution"));
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

    /// The same server as one command line, which is what `preview.start` takes.
    fn long_running_line() -> String {
        let (command, args) = long_running();
        std::iter::once(command)
            .chain(args)
            .collect::<Vec<String>>()
            .join(" ")
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
        let (command, args) = long_running();

        rpc.connect_mcp(warsha_pipeline::mcp_transport::McpServerConfig::new_stdio(
            "files", command, args,
        ))
        .await
        .expect("the server connects");
        let listed = rpc.list_mcp().await.expect("the list is served");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].status, warsha_pipeline::McpStatus::Connected);
        assert!(listed[0].process_id.is_some());

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
        let command = long_running_line();

        let started = rpc
            .start_preview("project-1".to_string(), command.clone())
            .await
            .expect("the preview starts");
        assert_eq!(started.project_id, "project-1");
        let status = rpc
            .preview_status("project-1".to_string())
            .await
            .expect("the preview is tracked");
        assert_eq!(status.process_id, started.process_id);
        assert_eq!(status.status, ProcessStatus::Running);
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
