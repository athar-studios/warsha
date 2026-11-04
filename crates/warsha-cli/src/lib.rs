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
        /// API key. Required for a kind that is called with one (every hosted kind);
        /// refused for a local kind that is not (`ollama`, `lm_studio`).
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

/// The language `warsha` writes its own human messages in.
///
/// English is the fallback and the language every message written so far is in: the
/// crate has no locale of its own yet (`warsha init --lang` takes a language and writes
/// a `config.toml` whose fields belong to the daemon, which nothing reads back), so
/// [`CliLang::from_locale`] follows the process locale the way a command-line program
/// normally does. The one Rust-side precedent for a bilingual human message in this
/// workspace is `DailySummaryBuilder` in `crates/warsha-pipeline/src/post_launch.rs`:
/// two inline wordings, one language enum, chosen at build time — because `packages/i18n`
/// is a TypeScript catalog that no Rust crate reads, and adding a dependency here was not
/// an option.
///
/// The Arabic wordings are written unvocalised — no harakat, no shadda, the way the
/// shipped catalog strings read — because `src/main.rs` prints a returned error with
/// `Debug`, and `Debug` escapes Unicode combining marks as `\u{64f}`. A refusal an owner
/// cannot read is not a refusal; the test on that printing keeps the wordings honest.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CliLang {
    /// Arabic, the product's first language.
    Arabic,
    /// English, and the reading of any locale that does not say `ar`.
    English,
}

impl CliLang {
    /// The language one locale string names: `ar`, `ar_SA.UTF-8`, `ar-EG` → Arabic,
    /// anything else (including an empty value) → English.
    pub fn from_locale(locale: &str) -> Self {
        if locale.trim().to_lowercase().starts_with("ar") {
            CliLang::Arabic
        } else {
            CliLang::English
        }
    }

    /// The language a message for this call is written in.
    ///
    /// `--json` is a machine contract, so its text never follows the locale: a script
    /// that matches on a sentence must get the same one from any shell. Everything else
    /// follows the locale. Split out as a pure function so the rule is testable without
    /// editing the environment of the test process.
    fn for_output(json_output: bool, locale: &str) -> Self {
        if json_output {
            CliLang::English
        } else {
            Self::from_locale(locale)
        }
    }
}

/// What `providers add` does with its `--key`, decided before any call leaves the CLI.
///
/// Deliberately no `Debug`: the [`AddPlan::Call`] variant holds the owner's API key, and
/// a plan printed in a test failure or a log line must not be able to render it.
enum AddPlan {
    /// The kind is called with a key and one was given: `providers.add` receives exactly
    /// that value, and nothing was invented for it.
    Call { key: String },
    /// The kind is called with a key and none was given: refuse, with the message that
    /// names the kind and says where the key goes.
    RefuseNeedsKey(String),
    /// The kind needs no key at all: refuse, because there is no honest value to send.
    RefuseKeylessKind(String),
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
                    .request::<Vec<warshad::ProviderRecord>, _>("providers.list", rpc_params![])
                    .await?;
                for p in providers {
                    self.output(format!("{} ({})", p.name, p.kind))?;
                }
            }
            ProviderAction::Add { id, kind, key } => {
                // Whether `--key` is required is the *kind's* answer — `ProviderKind::needs_api_key`
                // — not a rule this crate imposes on every provider. A local server has no
                // credential, so demanding a flag for it was asking the owner to invent one.
                match plan_provider_add(&id, &kind, key, self.message_lang()) {
                    AddPlan::Call { key } => {
                        // Positional, in the order the RPC declares: name, kind, key,
                        // api_base. `None` lets the daemon use the kind's default URL.
                        let provider = self
                            .client
                            .request::<warshad::ProviderRecord, _>(
                                "providers.add",
                                (id.clone(), kind, key, None::<String>),
                            )
                            .await?;
                        self.output(format!(
                            "Provider {} added ({})",
                            provider.name, provider.kind
                        ))?;
                    }
                    // Both refusals happen here, before the call: no RPC is sent, so no
                    // invented key can reach the daemon and be filed in the keychain under
                    // the provider's name.
                    AddPlan::RefuseNeedsKey(message) | AddPlan::RefuseKeylessKind(message) => {
                        return Err(CliError::Other(message))
                    }
                }
            }
            ProviderAction::Test { id } => {
                let health = self
                    .client
                    .request::<warsha_providers::HealthCheck, _>("providers.test", (id,))
                    .await?;
                self.output(format!("Provider health: {health:?}"))?;
            }
            ProviderAction::Remove { id } => {
                self.client
                    .request::<warshad::ProviderRecord, _>("providers.remove", (id,))
                    .await?;
                self.output("Provider removed".to_string())?;
            }
        }
        Ok(())
    }

    async fn cmd_roles(&self, action: RoleAction) -> Result<()> {
        match action {
            RoleAction::List => {
                let roles = self
                    .client
                    .request::<Vec<warshad::RoleRoutingConfig>, _>("roles.list", rpc_params![])
                    .await?;
                for r in roles {
                    self.output(format!(
                        "{} -> {} (fallback: {})",
                        r.role,
                        r.targets
                            .iter()
                            .map(|t| format!("{}:{}", t.provider_id, t.model_id))
                            .collect::<Vec<_>>()
                            .join(", "),
                        r.fallback_enabled
                    ))?;
                }
            }
            RoleAction::Set { role, targets } => {
                let target_vec: Vec<warshad::RoutingTargetConfig> = targets
                    .split(',')
                    .map(|s| {
                        let parts: Vec<&str> = s.split(':').collect();
                        if parts.len() != 2 {
                            return Err(CliError::Config(format!(
                                "Invalid target format: {} (expected provider:model)",
                                s
                            )));
                        }
                        Ok(warshad::RoutingTargetConfig {
                            provider_id: parts[0].to_string(),
                            model_id: parts[1].to_string(),
                            weight: 100,
                        })
                    })
                    .collect::<Result<Vec<_>>>()?;

                let config = warshad::RoleRoutingConfig {
                    role: role.clone(),
                    targets: target_vec,
                    fallback_enabled: true,
                    budget_cents_per_run: None,
                };
                self.client.request::<(), _>("roles.set", (config,)).await?;
                self.output(format!("Role routing set for {}", role))?;
            }
        }
        Ok(())
    }

    async fn cmd_budget(&self, action: BudgetAction) -> Result<()> {
        match action {
            BudgetAction::Show { project } => {
                let project_id = self.resolve_project(&project).await?;
                let budget = self
                    .client
                    .request::<warshad::BudgetStatus, _>("budget.show", (project_id,))
                    .await?;
                self.output(format!(
                    "Budget: {} / {} cents ({}% used)",
                    budget.spent_cents,
                    budget.budget_cents.unwrap_or(0),
                    if budget.budget_cents.unwrap_or(0) > 0 {
                        (budget.spent_cents * 100) / budget.budget_cents.unwrap()
                    } else {
                        0
                    }
                ))?;
                if let Some(remaining) = budget.remaining_cents {
                    self.output(format!("Remaining: {} cents", remaining))?;
                }
            }
            BudgetAction::Set { project, cents } => {
                let project_id = self.resolve_project(&project).await?;
                self.client
                    .request::<(), _>("budget.set", (project_id, cents))
                    .await?;
                self.output(format!("Budget set to {} cents for {}", cents, project))?;
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

    /// The language this call writes its human messages in.
    fn message_lang(&self) -> CliLang {
        CliLang::for_output(self.json_output, &locale_from_env())
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

/// The locale this process was started in: `LC_ALL` first, then `LANG`, empty when
/// neither is set. The order is the one the C library itself uses, so a shell that pins
/// `LC_ALL` wins over a `LANG` the owner forgot about.
fn locale_from_env() -> String {
    ["LC_ALL", "LANG"]
        .into_iter()
        .find_map(|key| std::env::var(key).ok())
        .unwrap_or_default()
}

/// Whether `providers add` must be given `--key` for the kind tag `kind`.
///
/// Two existing sources of truth answer it, and neither is a list this crate keeps:
/// `warshad`'s own `adapter_kind` says which protocol a tag is spoken in — and the local
/// server arm is documented as needing no key — and the `ProviderKind` it maps to answers
/// [`ProviderKind::needs_api_key`]. A tag neither one recognises (`kimi`, `glm`, a
/// `custom` URL) is OpenAI-compatible, and every hosted endpoint is called with a key, so
/// the fall-through answer is the flag the daemon itself insists on.
fn kind_needs_key(kind: &str) -> bool {
    warshad::adapter_kind(kind).provider_kind().needs_api_key()
}

/// Decide what `providers add` does, from its three arguments and the message language.
///
/// A pure function on purpose: the whole rule — which kind is asked for a key, which is
/// refused, and what each refusal says — is testable without a daemon, a keychain or a
/// locale in the environment of the test process.
fn plan_provider_add(id: &str, kind: &str, key: Option<String>, lang: CliLang) -> AddPlan {
    if kind_needs_key(kind) {
        match key {
            // The owner's own key, or no call at all: a credential kind is never sent a
            // value this crate made up, and never sent an empty one.
            Some(key) => AddPlan::Call { key },
            None => AddPlan::RefuseNeedsKey(needs_key_message(lang, id, kind)),
        }
    } else {
        // A key-less kind gets no RPC at all, with or without `--key`. The daemon's
        // `providers.add` declares its key as `key: String` — not an option — trims it, runs
        // the wizard's "is a key present" check on it, and files it in the secret store under
        // the provider's name (`add_provider` in `crates/warshad/src/lib.rs`), so the only
        // ways to reach that call would be a fabricated secret or an empty one. The call is
        // what is dropped.
        AddPlan::RefuseKeylessKind(no_key_kind_message(lang, id, kind, key.is_some()))
    }
}

/// The refusal that says `--key` is required: it names the kind and says where the key
/// is kept, which is the reason the flag is not optional for this kind.
fn needs_key_message(lang: CliLang, id: &str, kind: &str) -> String {
    match lang {
        CliLang::English => format!(
            "providers add {id}: the kind {kind} is called with an API key, so --key is required. \
             The key is stored in the OS keychain, never in the database and never in a log."
        ),
        CliLang::Arabic => format!(
            "providers add {id}: النوع «{kind}» يحتاج مفتاح API للاتصال به، لذا يلزم تمرير --key. \
             يحفظ المفتاح في سلسلة مفاتيح النظام، ولا يكتب في قاعدة البيانات ولا في السجلات."
        ),
    }
}

/// The refusal for a kind that needs no key: it says so plainly, does not ask for the
/// flag, and says why the provider is still not added. With `key_passed` it also says
/// what became of the value the owner typed, because a secret that was entered in a
/// terminal deserves an answer about where it went (nowhere).
fn no_key_kind_message(lang: CliLang, id: &str, kind: &str, key_passed: bool) -> String {
    match (lang, key_passed) {
        (CliLang::English, false) => format!(
            "providers add {id}: the kind {kind} needs no API key, so --key is not required here. \
             It is still not added: the daemon's providers.add files a key in the OS keychain for \
             every provider it adds and has no shape for one without a key."
        ),
        (CliLang::English, true) => format!(
            "providers add {id}: the kind {kind} needs no API key, so the value passed to --key is \
             not sent to the daemon and not stored. It is still not added: the daemon's \
             providers.add files a key in the OS keychain for every provider it adds and has no \
             shape for one without a key."
        ),
        (CliLang::Arabic, false) => format!(
            "providers add {id}: النوع «{kind}» لا يحتاج مفتاح API، لذا لا يلزم تمرير --key. \
             ومع ذلك لن يضاف المزود، لأن providers.add يحفظ مفتاح كل مزود في سلسلة مفاتيح \
             النظام ولا يقبل مزودا بدونه."
        ),
        (CliLang::Arabic, true) => format!(
            "providers add {id}: النوع «{kind}» لا يحتاج مفتاح API، لذا لن يرسل المفتاح الذي \
             مررته إلى الخادم ولا يحفظه. ومع ذلك لن يضاف المزود، لأن providers.add يحفظ مفتاح \
             كل مزود في سلسلة مفاتيح النظام ولا يقبل مزودا بدونه."
        ),
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

    #[test]
    fn only_a_hosted_kind_is_called_with_a_key() {
        // The local servers an owner runs for free: no credential, nothing to file.
        for tag in [
            "ollama",
            "Ollama",
            "lm_studio",
            "LM-Studio",
            "LM Studio",
            "lmstudio",
        ] {
            assert!(
                !kind_needs_key(tag),
                "{tag} runs on this machine and is called with no key"
            );
        }
        // Every hosted kind — including the tags the daemon's own wizard offers and a tag
        // nothing recognises, whose safe answer is the flag the daemon insists on.
        for tag in [
            "open_router",
            "deep_seek",
            "kimi",
            "glm",
            "qwen",
            "custom",
            "openai",
            "anthropic",
            "not-a-kind",
            "",
        ] {
            assert!(
                kind_needs_key(tag),
                "{tag} is a hosted endpoint called with an API key"
            );
        }
    }

    #[test]
    fn a_key_less_kind_is_asked_for_no_key_and_never_sends_one() {
        // The bug this pins: `providers add <id> ollama` demanded `--key` from a kind that
        // has no credential, and shipped whatever string was pasted for it to the daemon to
        // file in the OS keychain. A key-less kind now reaches no RPC at all, with or
        // without the flag, and the refusal never repeats the value that was typed.
        for key in [None, Some("sk-not-a-real-key".to_string())] {
            let AddPlan::RefuseKeylessKind(message) =
                plan_provider_add("local", "ollama", key, CliLang::English)
            else {
                panic!("a key-less kind must never be planned as a call to providers.add");
            };
            assert!(message.contains("ollama"), "the refusal names the kind");
            assert!(
                message.contains("needs no API key"),
                "the refusal says the key is not required: {message}"
            );
            assert!(
                message.contains("--key is not required") || message.contains("is not sent"),
                "the refusal must not demand the flag: {message}"
            );
            assert!(
                message.contains("It is still not added"),
                "and it must not promise an add it cannot do: {message}"
            );
            assert!(
                !message.contains("sk-not-a-real-key"),
                "the refusal must not echo the value passed to --key"
            );
        }
    }

    #[test]
    fn a_credential_kind_without_a_key_names_the_kind_and_the_keychain() {
        let AddPlan::RefuseNeedsKey(message) =
            plan_provider_add("or", "open_router", None, CliLang::English)
        else {
            panic!("open_router is called with a key, so a missing --key must be refused");
        };
        assert!(
            message.contains("open_router"),
            "the refusal names the kind"
        );
        assert!(
            message.contains("--key is required"),
            "the refusal says which flag to pass: {message}"
        );
        assert!(
            message.contains("OS keychain"),
            "the refusal says where the key is kept: {message}"
        );

        // With a key the same kind is called with exactly what the owner passed: nothing is
        // invented, and nothing is substituted, on the way to the keychain.
        let AddPlan::Call { key } = plan_provider_add(
            "or",
            "open_router",
            Some("sk-owner-key".to_string()),
            CliLang::English,
        ) else {
            panic!("a credential kind given --key is a call");
        };
        assert_eq!(key, "sk-owner-key", "the owner's key is sent, unchanged");
    }

    #[test]
    fn the_refusal_follows_the_locale_and_json_output_does_not() {
        assert_eq!(CliLang::from_locale("ar_SA.UTF-8"), CliLang::Arabic);
        assert_eq!(CliLang::from_locale("ar"), CliLang::Arabic);
        assert_eq!(CliLang::from_locale("en_US.UTF-8"), CliLang::English);
        assert_eq!(CliLang::from_locale("C.UTF-8"), CliLang::English);
        assert_eq!(CliLang::from_locale(""), CliLang::English);
        // `--json` is a machine contract: its text never follows the shell's locale.
        assert_eq!(CliLang::for_output(true, "ar_SA.UTF-8"), CliLang::English);
        assert_eq!(CliLang::for_output(false, "ar_SA.UTF-8"), CliLang::Arabic);

        let arabic = needs_key_message(CliLang::Arabic, "or", "open_router");
        let english = needs_key_message(CliLang::English, "or", "open_router");
        assert_ne!(
            arabic, english,
            "an Arabic locale must not get the English sentence"
        );
        assert!(
            arabic.contains("open_router"),
            "the kind is machine data and is never translated"
        );
        assert!(
            arabic.contains("لذا يلزم تمرير --key"),
            "the Arabic message asks for the flag: {arabic}"
        );
        assert!(
            arabic.contains("سلسلة مفاتيح"),
            "the Arabic message says where the key goes: {arabic}"
        );
        assert!(
            !arabic.contains("OS keychain"),
            "and says it in Arabic, not in English"
        );

        let arabic_keyless = no_key_kind_message(CliLang::Arabic, "local", "ollama", false);
        assert!(arabic_keyless.contains("ollama"));
        assert!(
            arabic_keyless.contains("لا يلزم تمرير --key"),
            "the Arabic message for a key-less kind says the flag is not needed: {arabic_keyless}"
        );
        assert!(
            !arabic_keyless.contains("لذا يلزم تمرير"),
            "and it never demands a flag it just said is not needed"
        );

        let english_keyless_with_key =
            no_key_kind_message(CliLang::English, "local", "ollama", true);
        assert!(
            english_keyless_with_key.contains("not sent to the daemon and not stored"),
            "a key that was typed gets an answer about where it went: {english_keyless_with_key}"
        );
    }

    #[test]
    fn the_arabic_refusals_print_as_they_are_written() {
        // `src/main.rs` hands a returned error to `Debug`, which escapes a Unicode
        // combining mark as `\u{64f}`: an owner reading a refusal in Arabic must not be
        // reading an escape table. This is why the Arabic wordings carry no vocalisation.
        for message in [
            needs_key_message(CliLang::Arabic, "or", "open_router"),
            no_key_kind_message(CliLang::Arabic, "local", "ollama", false),
            no_key_kind_message(CliLang::Arabic, "local", "ollama", true),
        ] {
            let printed = format!("{:?}", message);
            assert!(
                !printed.contains("\\u{"),
                "the Arabic refusal must print as written: {printed}"
            );
            assert!(
                printed.contains("providers add"),
                "and still name the command the owner typed: {printed}"
            );
        }
    }
}
