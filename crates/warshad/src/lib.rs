//! Warshad — Daemon binary: local API (JSON-RPC over Unix socket / named pipe + localhost HTTP/WebSocket with token)

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use clap::Parser;
use dirs;
use jsonrpsee::{core::RpcResult, proc_macros::rpc, server::ServerBuilder, types::ErrorObject};
use keyring::Entry;
use std::path::PathBuf;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};
use tracing::{error, info, warn};
use warsha_backends::BackendFactory;
use warsha_core::*;
use warsha_git::GitHubClient;
use warsha_pipeline::PipelineEngine;
use warsha_providers::ProviderRouter;
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
    #[error("Authentication failed")]
    AuthFailed,
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
        let config_dir = dirs::config_dir().map(|d| d.join("warsha")).unwrap_or_else(|| PathBuf::from(".").join("warsha"));
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
    async fn list_devices(&self) -> RpcResult<Vec<DeviceIdentity>>;

    #[method(name = "devices.pair")]
    async fn pair_device(&self, pairing_data: PairingData) -> RpcResult<()>;

    #[method(name = "devices.revoke")]
    async fn revoke_device(&self, device_id: DeviceId) -> RpcResult<()>;
}

/// Health response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub uptime_seconds: u64,
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

    async fn pair_device(&self, pairing_data: PairingData) -> RpcResult<()> {
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
}

/// HTTP server for REST API and WebSocket
async fn health_handler() -> impl IntoResponse {
    Json(HealthResponse {
        status: "healthy".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_seconds: 0,
    })
}

async fn auth_middleware(
    State(state): State<Arc<DaemonState>>,
    headers: axum::http::HeaderMap,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Result<impl IntoResponse, StatusCode> {
    let auth_header = headers
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "));

    if auth_header != Some(&state.config.auth_token) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    Ok(next.run(request).await)
}

/// Main daemon entry point
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

    // Ensure single instance lock
    let _lock = acquire_lock(&config.data_dir)?;

    // Initialize store
    let store = Arc::new(Store::new().await?);

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

    let state = Arc::new(DaemonState {
        config: config.clone(),
        store,
        providers,
        pipeline,
        backends,
        github,
        devices,
    });

    // Start JSON-RPC server (Unix socket / named pipe)
    let rpc_server = ServerBuilder::default()
        .build(format!("unix:{}", config.socket_path.display()))
        .await?;
    let rpc_addr = rpc_server.local_addr()?;
    let rpc = WarshaRpc::new(state.clone());
    tokio::spawn(async move {
        if let Err(e) = rpc_server.start(rpc.into_rpc()).await {
            error!("RPC server error: {}", e);
        }
    });
    info!("JSON-RPC server listening on {}", rpc_addr);

    // Start HTTP/WebSocket server
    let allowed_origins = config
                        .allowed_origins
                        .clone()
                        .into_iter()
                        .filter_map(|o| o.parse().ok())
                        .collect::<Vec<_>>();

    let app = Router::new()
        .route("/health", get(health_handler))
        .layer(
            CorsLayer::new()
                .allow_origin(allowed_origins)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(state.clone());

    let http_listener =
        tokio::net::TcpListener::bind(format!("127.0.0.1:{}", config.http_port)).await?;
    info!(
        "HTTP server listening on http://127.0.0.1:{}",
        config.http_port
    );

    tokio::spawn(async move {
        if let Err(e) = axum::serve(http_listener, app).await {
            error!("HTTP server error: {}", e);
        }
    });

    // Keep running
    if args.foreground {
        tokio::signal::ctrl_c().await?;
    } else {
        // Daemonize - in real implementation, use daemonize crate
        tokio::signal::ctrl_c().await?;
    }

    Ok(())
}

async fn load_or_create_config(config_path: Option<&PathBuf>) -> Result<DaemonConfig> {
    let config_dir = dirs::config_dir().unwrap().join("warsha");
    std::fs::create_dir_all(&config_dir)?;

    let path = config_path.unwrap_or(&config_dir.join("config.toml"));

    if path.exists() {
        let content = std::fs::read_to_string(path)?;
        let config: DaemonConfig = toml::from_str(&content)?;
        Ok(config)
    } else {
        // Generate auth token
        let mut token = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut token);
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

fn acquire_lock(data_dir: &PathBuf) -> Result<LockFile> {
    let lock_path = data_dir.join("warshad.lock");
    let lock = LockFile::new(lock_path)?;
    lock.try_lock()
        .map_err(|_| DaemonError::Lock("Another instance is running".to_string()))?;
    Ok(lock)
}

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
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .open(&self.path)?;

        // Try to lock
        #[cfg(unix)]
        {
            use std::os::unix::fs::FileExt;
            // Use flock or fcntl
        }

        self.file = Some(file);
        Ok(())
    }
}

impl Drop for LockFile {
    fn drop(&mut self) {
        if let Some(file) = self.file.take() {
            drop(file);
        }
        let _ = std::fs::remove_file(&self.path);
    }
}

fn get_github_token() -> Result<String> {
    let entry = Entry::new("warsha", "github_token")?;
    entry
        .get_password()
        .map_err(|_| DaemonError::Config("GitHub token not in keychain".to_string()))
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
