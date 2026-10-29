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
    types::ErrorObject,
};
use keyring::Entry;
use rand::TryRngCore;
use serde::{Deserialize, Serialize};
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
use warsha_pipeline::PipelineEngine;
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

    let state = Arc::new(DaemonState {
        config: config.clone(),
        store,
        providers,
        pipeline,
        backends,
        github,
        devices,
        event_tx,
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
}
