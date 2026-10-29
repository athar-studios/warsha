//! Warsha CLI — `warsha` binary

use clap::{Parser, Subcommand};
use jsonrpsee::core::client::ClientT;
use jsonrpsee::http_client::{HttpClient, HttpClientBuilder};
use jsonrpsee::rpc_params;
use reqwest::Client;
use std::path::PathBuf;
use thiserror::Error;
use ulid::Ulid;
use uuid::Uuid;
use warsha_core::*;
use warsha_remote::DeviceIdentity;
pub use warshad::DaemonConfig;
use warshad::{run_daemon, DaemonArgs};

#[derive(Error, Debug)]
pub enum CliError {
    // Boxed: `DaemonError` aggregates every other crate's error and exceeds
    // clippy's 128-byte `Err`-variant threshold.
    #[error("Daemon error: {0}")]
    Daemon(#[source] Box<warshad::DaemonError>),
    #[error("Remote error: {0}")]
    Remote(#[from] warsha_remote::RemoteError),
    #[error("RPC error: {0}")]
    Rpc(#[from] jsonrpsee::core::client::Error),
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Config error: {0}")]
    Config(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("TOML error: {0}")]
    Toml(#[from] toml::ser::Error),
    #[error("Not connected to daemon")]
    NotConnected,
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Other: {0}")]
    Other(String),
}

impl From<warshad::DaemonError> for CliError {
    fn from(err: warshad::DaemonError) -> Self {
        Self::Daemon(Box::new(err))
    }
}

pub type Result<T> = std::result::Result<T, CliError>;

#[derive(Parser, Debug)]
#[command(
    name = "warsha",
    version,
    about = "Warsha — Arabic-first AI Software Factory"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,

    /// Output as JSON
    #[arg(short, long, global = true)]
    pub json: bool,

    /// Daemon socket path
    #[arg(long, global = true)]
    pub socket: Option<PathBuf>,

    /// Daemon JSON-RPC URL (default: http://127.0.0.1:8766)
    #[arg(long, global = true, default_value = "http://127.0.0.1:8766")]
    pub url: String,

    /// Daemon auth token (overrides config.toml)
    #[arg(long, global = true)]
    pub token: Option<String>,

    /// Config file path
    #[arg(short, long, global = true)]
    pub config: Option<PathBuf>,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Initialize Warsha configuration
    Init {
        /// Language (ar/en)
        #[arg(short, long, default_value = "en")]
        lang: String,
    },

    /// Create a new project from an idea
    New {
        /// The idea description
        idea: String,
        /// Project name
        #[arg(short, long)]
        name: Option<String>,
        /// Template to use (web, cli, desktop, android)
        #[arg(short, long)]
        template: Option<String>,
    },

    /// Start a run for a project
    Run {
        /// Project ID or name
        project: String,
    },

    /// Show project/run status
    Status {
        /// Project ID or name
        project: Option<String>,
        /// Run ID
        #[arg(short, long)]
        run: Option<String>,
    },

    /// Follow run logs
    Logs {
        /// Run ID
        run: String,
        /// Follow (tail -f)
        #[arg(short, long)]
        follow: bool,
    },

    /// List gates for a run
    Gates {
        /// Run ID
        run: String,
    },

    /// Approve a gate
    Approve {
        /// Run ID
        run: String,
        /// Gate stage (gate_c, gate_d)
        gate: String,
    },

    /// Reject a gate
    Reject {
        /// Run ID
        run: String,
        /// Gate stage (gate_c, gate_d)
        gate: String,
        /// Reason for rejection
        #[arg(short, long)]
        reason: String,
    },

    /// Provider management
    Providers {
        #[command(subcommand)]
        action: ProviderAction,
    },

    /// Role routing configuration
    Roles {
        #[command(subcommand)]
        action: RoleAction,
    },

    /// Budget management
    Budget {
        #[command(subcommand)]
        action: BudgetAction,
    },

    /// System diagnostics
    Doctor,

    /// Pair a remote device
    Pair {
        /// QR code data (base64 PNG)
        qr_code: String,
    },

    /// Device management
    Devices {
        #[command(subcommand)]
        action: DeviceAction,
    },

    /// Start the daemon (internal)
    #[command(hide = true)]
    Daemon(DaemonArgs),
}

#[derive(Subcommand, Debug)]
pub enum ProviderAction {
    /// List configured providers
    List,
    /// Add a provider
    Add {
        /// Provider ID
        id: String,
        /// Provider kind (openai, anthropic, ollama, etc.)
        kind: String,
        /// API key (or use keychain)
        #[arg(short, long)]
        key: Option<String>,
    },
    /// Test a provider
    Test {
        /// Provider ID
        id: String,
    },
    /// Remove a provider
    Remove {
        /// Provider ID
        id: String,
    },
}

#[derive(Subcommand, Debug)]
pub enum RoleAction {
    /// List role routings
    List,
    /// Set routing for a role
    Set {
        /// Role name
        role: String,
        /// Provider/model targets (provider:model,provider:model...)
        targets: String,
    },
}

#[derive(Subcommand, Debug)]
pub enum BudgetAction {
    /// Show budget status
    Show {
        /// Project ID
        project: String,
    },
    /// Set budget for a project
    Set {
        /// Project ID
        project: String,
        /// Budget in cents
        cents: u64,
    },
}

#[derive(Subcommand, Debug)]
pub enum DeviceAction {
    /// List paired devices
    List,
    /// Revoke a device
    Revoke {
        /// Device ID
        id: String,
    },
}

/// CLI application
pub struct CliApp {
    client: HttpClient,
    http_client: Client,
    base_url: String,
    json_output: bool,
    _token: String,
}

impl CliApp {
    pub fn new(base_url: String, token: String, json_output: bool) -> Result<Self> {
        // Build HTTP client with auth header
        let mut headers = reqwest::header::HeaderMap::new();
        if !token.is_empty() {
            let auth_value = format!("Bearer {}", token);
            headers.insert(
                reqwest::header::AUTHORIZATION,
                reqwest::header::HeaderValue::from_str(&auth_value)
                    .map_err(|e| CliError::Config(format!("Invalid auth token: {e}")))?,
            );
        }
        let http_client = Client::builder().default_headers(headers).build()?;

        // JSON-RPC client (no /rpc suffix - daemon serves at root)
        let client = HttpClientBuilder::default().build(base_url.clone())?;

        Ok(Self {
            client,
            http_client,
            base_url,
            json_output,
            _token: token,
        })
    }

    pub async fn run(&self, cli: Cli) -> Result<()> {
        match cli.command {
            Commands::Init { lang } => self.cmd_init(lang).await,
            Commands::New {
                idea,
                name,
                template,
            } => self.cmd_new(idea, name, template).await,
            Commands::Run { project } => self.cmd_run(project).await,
            Commands::Status { project, run } => self.cmd_status(project, run).await,
            Commands::Logs { run, follow } => self.cmd_logs(run, follow).await,
            Commands::Gates { run } => self.cmd_gates(run).await,
            Commands::Approve { run, gate } => self.cmd_approve(run, gate).await,
            Commands::Reject { run, gate, reason } => self.cmd_reject(run, gate, reason).await,
            Commands::Providers { action } => self.cmd_providers(action).await,
            Commands::Roles { action } => self.cmd_roles(action).await,
            Commands::Budget { action } => self.cmd_budget(action).await,
            Commands::Doctor => self.cmd_doctor().await,
            Commands::Pair { qr_code } => self.cmd_pair(qr_code).await,
            Commands::Devices { action } => self.cmd_devices(action).await,
            Commands::Daemon(args) => self.cmd_daemon(args).await,
        }
    }

    async fn cmd_init(&self, _lang: String) -> Result<()> {
        let config_dir = dirs::config_dir()
            .ok_or_else(|| CliError::Config("Config directory not found".to_string()))?
            .join("warsha");
        std::fs::create_dir_all(&config_dir)?;

        let config = DaemonConfig {
            data_dir: config_dir.clone(),
            ..Default::default()
        };

        let content = toml::to_string_pretty(&config)?;
        std::fs::write(config_dir.join("config.toml"), content)?;

        self.output("Warsha initialized".to_string())?;
        Ok(())
    }

    async fn cmd_new(
        &self,
        idea: String,
        name: Option<String>,
        _template: Option<String>,
    ) -> Result<()> {
        // Ensure daemon is running
        self.ensure_daemon().await?;

        // Create project via RPC
        let project_name = name.unwrap_or_else(|| "New Project".to_string());
        let project = self
            .client
            .request::<warsha_core::Project, _>(
                "projects.create",
                (project_name, idea.clone(), "en".to_string()),
            )
            .await?;

        // Start run
        let run = self
            .client
            .request::<warsha_core::Run, _>("runs.start", (project.id, idea))
            .await?;

        self.output(format!(
            "Created project {} and started run {}",
            project.id.0, run.id.0
        ))?;
        Ok(())
    }

    async fn cmd_run(&self, project: String) -> Result<()> {
        self.ensure_daemon().await?;

        // Resolve project ID
        let project_id = self.resolve_project(&project).await?;

        // For now, just show status
        let runs = self
            .client
            .request::<Vec<warsha_core::Run>, _>("runs.list", (project_id,))
            .await?;

        if let Some(run) = runs.first() {
            self.output(format!(
                "Run {} is at stage {:?}",
                run.id.0, run.current_stage
            ))?;
        } else {
            self.output("No runs found".to_string())?;
        }
        Ok(())
    }

    async fn cmd_status(&self, project: Option<String>, run: Option<String>) -> Result<()> {
        self.ensure_daemon().await?;

        if let Some(run_id_str) = run {
            let run_id =
                RunId(Ulid::from_string(&run_id_str).map_err(|e| CliError::Other(e.to_string()))?);
            let run = self
                .client
                .request::<warsha_core::Run, _>("runs.get", (run_id,))
                .await?;
            self.output(format!(
                "Run {}: {:?} ({:?})",
                run.id.0, run.current_stage, run.status
            ))?;
        } else if let Some(project_str) = project {
            let project_id = self.resolve_project(&project_str).await?;
            let runs = self
                .client
                .request::<Vec<warsha_core::Run>, _>("runs.list", (project_id,))
                .await?;
            for run in runs {
                self.output(format!(
                    "  {} {:?} {:?}",
                    run.id.0, run.current_stage, run.status
                ))?;
            }
        } else {
            let projects = self
                .client
                .request::<Vec<warsha_core::Project>, _>("projects.list", rpc_params![])
                .await?;
            for project in projects {
                self.output(format!("{} {}", project.id.0, project.name))?;
            }
        }
        Ok(())
    }

    async fn cmd_logs(&self, run: String, follow: bool) -> Result<()> {
        self.ensure_daemon().await?;

        let run_id = RunId(Ulid::from_string(&run).map_err(|e| CliError::Other(e.to_string()))?);
        let events = self
            .client
            .request::<Vec<warsha_core::Event>, _>("runs.events", (run_id,))
            .await?;

        for event in events {
            self.output(format!(
                "[{}] {:?} {:?}",
                event.created_at.format("%H:%M:%S"),
                event.stage,
                event.kind
            ))?;
        }

        if follow {
            // In real implementation, subscribe to WebSocket
            self.output("Following... (WebSocket not implemented)".to_string())?;
        }
        Ok(())
    }

    async fn cmd_gates(&self, run: String) -> Result<()> {
        let run_id = RunId(Ulid::from_string(&run).map_err(|e| CliError::Other(e.to_string()))?);
        let run_data = self
            .client
            .request::<warsha_core::Run, _>("runs.get", (run_id,))
            .await?;

        for (stage, state) in run_data.gate_states {
            if stage.is_gate() {
                self.output(format!("{:?}: {:?}", stage, state))?;
            }
        }
        Ok(())
    }

    async fn cmd_approve(&self, run: String, gate: String) -> Result<()> {
        let run_id = RunId(Ulid::from_string(&run).map_err(|e| CliError::Other(e.to_string()))?);
        let stage = parse_gate_stage(&gate)?;
        let device_id = DeviceId::new(); // In real implementation, get from config

        self.client
            .request::<warsha_core::Run, _>("gates.approve", (run_id, stage, device_id))
            .await?;
        self.output(format!("Gate {:?} approved", stage))?;
        Ok(())
    }

    async fn cmd_reject(&self, run: String, gate: String, reason: String) -> Result<()> {
        let run_id = RunId(Ulid::from_string(&run).map_err(|e| CliError::Other(e.to_string()))?);
        let stage = parse_gate_stage(&gate)?;
        let device_id = DeviceId::new();

        self.client
            .request::<warsha_core::Run, _>("gates.reject", (run_id, stage, reason, device_id))
            .await?;
        self.output(format!("Gate {:?} rejected", stage))?;
        Ok(())
    }

    async fn cmd_providers(&self, action: ProviderAction) -> Result<()> {
        match action {
            ProviderAction::List => {
                let providers = self
                    .client
                    .request::<Vec<warshad::ProviderConfig>, _>("providers.list", rpc_params![])
                    .await?;
                for p in providers {
                    self.output(format!("{} ({})", p.id, p.kind))?;
                }
            }
            ProviderAction::Add { .. } => {
                // Implementation
            }
            ProviderAction::Test { id } => {
                let health = self
                    .client
                    .request::<warsha_providers::HealthCheck, _>("providers.test", (id,))
                    .await?;
                self.output(format!("Provider health: {:?}", health))?;
            }
            ProviderAction::Remove { .. } => {
                // Implementation
            }
        }
        Ok(())
    }

    async fn cmd_roles(&self, action: RoleAction) -> Result<()> {
        match action {
            RoleAction::List => {
                // Implementation
            }
            RoleAction::Set { .. } => {
                // Implementation
            }
        }
        Ok(())
    }

    async fn cmd_budget(&self, action: BudgetAction) -> Result<()> {
        match action {
            BudgetAction::Show { .. } => {
                // Implementation
            }
            BudgetAction::Set { .. } => {
                // Implementation
            }
        }
        Ok(())
    }

    async fn cmd_doctor(&self) -> Result<()> {
        self.output("Warsha Doctor".to_string())?;
        self.output("=============".to_string())?;

        // Check daemon
        match self
            .http_client
            .get(format!("{}/health", self.base_url))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                self.output("✓ Daemon: Running".to_string())?;
            }
            _ => {
                self.output("✗ Daemon: Not running".to_string())?;
            }
        }

        // Check tools
        let tools = [
            ("git", "git"),
            ("docker", "docker"),
            ("node", "node"),
            ("pnpm", "pnpm"),
            ("rustc", "rustc"),
            ("cargo", "cargo"),
        ];

        for (name, cmd) in tools {
            if which::which(cmd).is_ok() {
                self.output(format!("✓ {}: Found", name))?;
            } else {
                self.output(format!("✗ {}: Not found", name))?;
            }
        }

        // Check providers
        self.output("\nProviders:".to_string())?;
        // Check CLIs
        let clis = [
            ("Claude Code", "claude"),
            ("Codex CLI", "codex"),
            ("Gemini CLI", "gemini"),
            ("Cursor CLI", "cursor"),
            ("OpenHands", "openhands"),
            ("Opencode", "opencode"),
        ];

        for (name, cmd) in clis {
            if which::which(cmd).is_ok() {
                self.output(format!("  ✓ {}", name))?;
            } else {
                self.output(format!("  ✗ {} (not installed)", name))?;
            }
        }

        Ok(())
    }

    async fn cmd_pair(&self, qr_code: String) -> Result<()> {
        // Parse QR code and pair device
        let pairing: warsha_remote::PairingData =
            warsha_remote::PairingData::from_qr_code(&qr_code)?;
        self.client
            .request::<(), _>("devices.pair", (pairing,))
            .await?;
        self.output("Device paired successfully".to_string())?;
        Ok(())
    }

    async fn cmd_devices(&self, action: DeviceAction) -> Result<()> {
        match action {
            DeviceAction::List => {
                let devices = self
                    .client
                    .request::<Vec<DeviceIdentity>, _>("devices.list", rpc_params![])
                    .await?;
                for d in devices {
                    let status = if d.revoked { "REVOKED" } else { "active" };
                    self.output(format!("{} {} ({})", d.device_id.0, d.name, status))?;
                }
            }
            DeviceAction::Revoke { id } => {
                let device_id =
                    DeviceId(Uuid::parse_str(&id).map_err(|e| CliError::Other(e.to_string()))?);
                self.client
                    .request::<(), _>("devices.revoke", (device_id,))
                    .await?;
                self.output("Device revoked".to_string())?;
            }
        }
        Ok(())
    }

    async fn cmd_daemon(&self, args: DaemonArgs) -> Result<()> {
        run_daemon(args).await?;
        Ok(())
    }

    async fn ensure_daemon(&self) -> Result<()> {
        let resp = self
            .http_client
            .get(format!("{}/health", self.base_url))
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(CliError::NotConnected);
        }
        Ok(())
    }

    async fn resolve_project(&self, name_or_id: &str) -> Result<ProjectId> {
        // Try as UUID first
        if let Ok(uuid) = Uuid::parse_str(name_or_id) {
            return Ok(ProjectId(uuid));
        }

        // Otherwise search by name
        let projects = self
            .client
            .request::<Vec<warsha_core::Project>, _>("projects.list", rpc_params![])
            .await?;
        for project in projects {
            if project.name == name_or_id {
                return Ok(project.id);
            }
        }

        Err(CliError::Other(format!(
            "Project not found: {}",
            name_or_id
        )))
    }

    fn output(&self, msg: String) -> Result<()> {
        if self.json_output {
            println!("{}", serde_json::json!({ "message": msg }));
        } else {
            println!("{}", msg);
        }
        Ok(())
    }
}

fn parse_gate_stage(s: &str) -> Result<Stage> {
    match s.to_lowercase().as_str() {
        "gate_a" | "gatea" | "a" => Ok(Stage::GateA),
        "gate_b" | "gateb" | "b" => Ok(Stage::GateB),
        "gate_c" | "gatec" | "c" => Ok(Stage::GateC),
        "gate_d" | "gated" | "d" => Ok(Stage::GateD),
        _ => Err(CliError::Other(format!("Unknown gate stage: {}", s))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_gate_stage() {
        assert_eq!(parse_gate_stage("gate_a").unwrap(), Stage::GateA);
        assert_eq!(parse_gate_stage("gatea").unwrap(), Stage::GateA);
        assert_eq!(parse_gate_stage("a").unwrap(), Stage::GateA);
        assert_eq!(parse_gate_stage("gate_b").unwrap(), Stage::GateB);
        assert_eq!(parse_gate_stage("gateb").unwrap(), Stage::GateB);
        assert_eq!(parse_gate_stage("b").unwrap(), Stage::GateB);
        assert_eq!(parse_gate_stage("gate_c").unwrap(), Stage::GateC);
        assert_eq!(parse_gate_stage("gatec").unwrap(), Stage::GateC);
        assert_eq!(parse_gate_stage("c").unwrap(), Stage::GateC);
        assert_eq!(parse_gate_stage("gate_d").unwrap(), Stage::GateD);
        assert!(parse_gate_stage("invalid").is_err());
    }
}
