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
/// English is the fallback and the reading of any locale that does not say `ar`. Every
/// message this crate writes in prose — confirmations, refusals, its own error sentences
/// — is built by a `_message` function below with exactly two inline wordings, one per
/// language, chosen by the process locale (`LC_ALL` then `LANG`). That is the pattern
/// `DailySummaryBuilder` in `crates/warsha-pipeline/src/post_launch.rs` established: two
/// inline wordings, one language enum — because `packages/i18n` is a TypeScript catalog
/// that no Rust crate reads, and adding a dependency here was not an option.
///
/// Three surfaces stay English by design, and the test
/// `no_human_word_reaches_output_without_a_language_choice` guards the rest: clap's
/// generated `--help` (it renders doc comments, not `CliLang` output), `--json` (a machine
/// contract — [`CliLang::for_output`] pins it to English), and anything rendered through
/// Rust's `Debug` (stage and status enum names, errors whose text belongs to another
/// crate).
///
/// The Arabic wordings are written unvocalised — no harakat, no shadda, the way the
/// shipped catalog strings read but without their tashkeel — because `src/main.rs` prints
/// a returned error with `Debug`, and `Debug` escapes Unicode combining marks as
/// `\u{64f}`. A refusal an owner cannot read is not a refusal; the test on that printing
/// keeps the wordings honest.
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

    /// The message language of this process, read from its environment.
    ///
    /// Public because `src/main.rs` writes one human message of its own (the missing
    /// auth token) before any [`CliApp`] exists, and that message follows the locale too.
    pub fn from_process_locale(json_output: bool) -> Self {
        Self::for_output(json_output, &locale_from_env())
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
                reqwest::header::HeaderValue::from_str(&auth_value).map_err(|e| {
                    CliError::Config(invalid_auth_token_message(
                        CliLang::from_process_locale(json_output),
                        &e.to_string(),
                    ))
                })?,
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
        let lang = self.message_lang();
        let config_dir = dirs::config_dir()
            .ok_or_else(|| CliError::Config(config_dir_missing_message(lang)))?
            .join("warsha");
        std::fs::create_dir_all(&config_dir)?;

        let config = DaemonConfig {
            data_dir: config_dir.clone(),
            ..Default::default()
        };

        let content = toml::to_string_pretty(&config)?;
        std::fs::write(config_dir.join("config.toml"), content)?;

        self.output(init_done_message(lang))?;
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

        self.output(created_project_message(
            self.message_lang(),
            &project.id.0.to_string(),
            &run.id.0.to_string(),
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
            self.output(run_at_stage_message(
                self.message_lang(),
                &run.id.0.to_string(),
                &format!("{:?}", run.current_stage),
            ))?;
        } else {
            self.output(no_runs_message(self.message_lang()))?;
        }
        Ok(())
    }

    async fn cmd_status(&self, project: Option<String>, run: Option<String>) -> Result<()> {
        self.ensure_daemon().await?;
        let lang = self.message_lang();

        if let Some(run_id_str) = run {
            let run_id =
                RunId(Ulid::from_string(&run_id_str).map_err(|e| CliError::Other(e.to_string()))?);
            let run = self
                .client
                .request::<warsha_core::Run, _>("runs.get", (run_id,))
                .await?;
            self.output(run_status_line_message(
                lang,
                &run.id.0.to_string(),
                &format!("{:?}", run.current_stage),
                &format!("{:?}", run.status),
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
            self.output(following_message(self.message_lang()))?;
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
        let lang = self.message_lang();
        let run_id = RunId(Ulid::from_string(&run).map_err(|e| CliError::Other(e.to_string()))?);
        let stage = parse_gate_stage(&gate, lang)?;
        let device_id = DeviceId::new(); // In real implementation, get from config

        self.client
            .request::<warsha_core::Run, _>("gates.approve", (run_id, stage, device_id))
            .await?;
        self.output(gate_approved_message(lang, &format!("{stage:?}")))?;
        Ok(())
    }

    async fn cmd_reject(&self, run: String, gate: String, reason: String) -> Result<()> {
        let lang = self.message_lang();
        let run_id = RunId(Ulid::from_string(&run).map_err(|e| CliError::Other(e.to_string()))?);
        let stage = parse_gate_stage(&gate, lang)?;
        let device_id = DeviceId::new();

        self.client
            .request::<warsha_core::Run, _>("gates.reject", (run_id, stage, reason, device_id))
            .await?;
        self.output(gate_rejected_message(lang, &format!("{stage:?}")))?;
        Ok(())
    }

    async fn cmd_providers(&self, action: ProviderAction) -> Result<()> {
        let lang = self.message_lang();
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
                match plan_provider_add(&id, &kind, key, lang) {
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
                        self.output(provider_added_message(lang, &provider.name, &provider.kind))?;
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
                self.output(provider_health_message(lang, &format!("{health:?}")))?;
            }
            ProviderAction::Remove { id } => {
                self.client
                    .request::<warshad::ProviderRecord, _>("providers.remove", (id,))
                    .await?;
                self.output(provider_removed_message(lang))?;
            }
        }
        Ok(())
    }

    async fn cmd_roles(&self, action: RoleAction) -> Result<()> {
        let lang = self.message_lang();
        match action {
            RoleAction::List => {
                let roles = self
                    .client
                    .request::<Vec<warshad::RoleRoutingConfig>, _>("roles.list", rpc_params![])
                    .await?;
                for r in roles {
                    self.output(role_row_message(
                        lang,
                        &r.role,
                        &r.targets
                            .iter()
                            .map(|t| format!("{}:{}", t.provider_id, t.model_id))
                            .collect::<Vec<_>>()
                            .join(", "),
                        r.fallback_enabled,
                    ))?;
                }
            }
            RoleAction::Set { role, targets } => {
                let target_vec: Vec<warshad::RoutingTargetConfig> = targets
                    .split(',')
                    .map(|s| {
                        let parts: Vec<&str> = s.split(':').collect();
                        if parts.len() != 2 {
                            return Err(CliError::Config(invalid_target_message(lang, s)));
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
                self.output(role_routing_set_message(lang, &role))?;
            }
        }
        Ok(())
    }

    async fn cmd_budget(&self, action: BudgetAction) -> Result<()> {
        let lang = self.message_lang();
        match action {
            BudgetAction::Show { project } => {
                let project_id = self.resolve_project(&project).await?;
                let budget = self
                    .client
                    .request::<warshad::BudgetStatus, _>("budget.show", (project_id,))
                    .await?;
                self.output(budget_summary_message(
                    lang,
                    budget.spent_cents,
                    budget.budget_cents.unwrap_or(0),
                    if budget.budget_cents.unwrap_or(0) > 0 {
                        (budget.spent_cents * 100) / budget.budget_cents.unwrap()
                    } else {
                        0
                    },
                ))?;
                if let Some(remaining) = budget.remaining_cents {
                    self.output(budget_remaining_message(lang, remaining))?;
                }
            }
            BudgetAction::Set { project, cents } => {
                let project_id = self.resolve_project(&project).await?;
                self.client
                    .request::<(), _>("budget.set", (project_id, cents))
                    .await?;
                self.output(budget_set_message(lang, cents, &project))?;
            }
        }
        Ok(())
    }

    async fn cmd_doctor(&self) -> Result<()> {
        let lang = self.message_lang();
        self.output(doctor_header_message(lang))?;
        self.output("=============".to_string())?;

        // Check daemon
        match self
            .http_client
            .get(format!("{}/health", self.base_url))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                self.output(daemon_running_message(lang))?;
            }
            _ => {
                self.output(daemon_not_running_message(lang))?;
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
                self.output(tool_found_message(lang, name))?;
            } else {
                self.output(tool_not_found_message(lang, name))?;
            }
        }

        // Check providers
        self.output(providers_section_message(lang))?;
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
                self.output(agent_cli_missing_message(lang, name))?;
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
        self.output(device_paired_message(self.message_lang()))?;
        Ok(())
    }

    async fn cmd_devices(&self, action: DeviceAction) -> Result<()> {
        let lang = self.message_lang();
        match action {
            DeviceAction::List => {
                let devices = self
                    .client
                    .request::<Vec<DeviceIdentity>, _>("devices.list", rpc_params![])
                    .await?;
                for d in devices {
                    self.output(device_row_message(
                        lang,
                        &d.device_id.0.to_string(),
                        &d.name,
                        d.revoked,
                    ))?;
                }
            }
            DeviceAction::Revoke { id } => {
                let device_id =
                    DeviceId(Uuid::parse_str(&id).map_err(|e| CliError::Other(e.to_string()))?);
                self.client
                    .request::<(), _>("devices.revoke", (device_id,))
                    .await?;
                self.output(device_revoked_message(lang))?;
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

        Err(CliError::Other(project_not_found_message(
            self.message_lang(),
            name_or_id,
        )))
    }

    /// The language this call writes its human messages in.
    fn message_lang(&self) -> CliLang {
        CliLang::from_process_locale(self.json_output)
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

fn parse_gate_stage(s: &str, lang: CliLang) -> Result<Stage> {
    match s.to_lowercase().as_str() {
        "gate_a" | "gatea" | "a" => Ok(Stage::GateA),
        "gate_b" | "gateb" | "b" => Ok(Stage::GateB),
        "gate_c" | "gatec" | "c" => Ok(Stage::GateC),
        "gate_d" | "gated" | "d" => Ok(Stage::GateD),
        _ => Err(CliError::Other(unknown_gate_message(lang, s))),
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

// ---------------------------------------------------------------------------
// Human message wordings
//
// One pure function per message, each with exactly two inline wordings — the
// pattern `needs_key_message` and `no_key_kind_message` set. The English arm
// reproduces the sentence this CLI has always printed, byte for byte: `--json`
// pins its language to English, and a script that matches on a sentence must
// get the same one after localization as before it. `every_message_pair` in
// the tests below enumerates them, so a wording collapsed back to
// English-only fails a test rather than the owner.
// ---------------------------------------------------------------------------

fn init_done_message(lang: CliLang) -> String {
    match lang {
        CliLang::English => "Warsha initialized".to_string(),
        CliLang::Arabic => "تم تجهيز Warsha".to_string(),
    }
}

fn created_project_message(lang: CliLang, project: &str, run: &str) -> String {
    match lang {
        CliLang::English => format!("Created project {project} and started run {run}"),
        CliLang::Arabic => format!("أنشأت المشروع {project} وبدأت التشغيل {run}"),
    }
}

fn run_at_stage_message(lang: CliLang, run: &str, stage: &str) -> String {
    match lang {
        CliLang::English => format!("Run {run} is at stage {stage}"),
        CliLang::Arabic => format!("التشغيل {run} في المرحلة {stage}"),
    }
}

fn no_runs_message(lang: CliLang) -> String {
    match lang {
        CliLang::English => "No runs found".to_string(),
        CliLang::Arabic => "لا تشغيل بعد".to_string(),
    }
}

/// A status line whose stage and status arrive already `Debug`-rendered: the sentence
/// around them follows the locale, the enum names inside it do not (they are machine
/// data owned by `warsha-core`, printed through `Debug` like every other `{:?}` value).
fn run_status_line_message(lang: CliLang, run: &str, stage: &str, status: &str) -> String {
    match lang {
        CliLang::English => format!("Run {run}: {stage} ({status})"),
        CliLang::Arabic => format!("التشغيل {run}: {stage} ({status})"),
    }
}

fn following_message(lang: CliLang) -> String {
    match lang {
        CliLang::English => "Following... (WebSocket not implemented)".to_string(),
        CliLang::Arabic => "متابعة مستمرة... (WebSocket غير متوفر بعد)".to_string(),
    }
}

fn gate_approved_message(lang: CliLang, stage: &str) -> String {
    match lang {
        CliLang::English => format!("Gate {stage} approved"),
        CliLang::Arabic => format!("تمت الموافقة على البوابة {stage}"),
    }
}

fn gate_rejected_message(lang: CliLang, stage: &str) -> String {
    match lang {
        CliLang::English => format!("Gate {stage} rejected"),
        CliLang::Arabic => format!("تم رفض البوابة {stage}"),
    }
}

fn provider_added_message(lang: CliLang, name: &str, kind: &str) -> String {
    match lang {
        CliLang::English => format!("Provider {name} added ({kind})"),
        CliLang::Arabic => format!("تمت إضافة المزود {name} ({kind})"),
    }
}

fn provider_health_message(lang: CliLang, health: &str) -> String {
    match lang {
        CliLang::English => format!("Provider health: {health}"),
        CliLang::Arabic => format!("فحص المزود: {health}"),
    }
}

fn provider_removed_message(lang: CliLang) -> String {
    match lang {
        CliLang::English => "Provider removed".to_string(),
        CliLang::Arabic => "تم حذف المزود".to_string(),
    }
}

/// A `roles list` row: id-shaped data stays as-is; only the "(fallback: …)" label
/// is a human word, so only it follows the locale. The `->` separator is kept in
/// both languages — flipping it for RTL would rewrite the reading of the routing.
fn role_row_message(lang: CliLang, role: &str, targets: &str, fallback: bool) -> String {
    match lang {
        CliLang::English => format!("{role} -> {targets} (fallback: {fallback})"),
        CliLang::Arabic => format!("{role} -> {targets} (البديل: {fallback})"),
    }
}

fn role_routing_set_message(lang: CliLang, role: &str) -> String {
    match lang {
        CliLang::English => format!("Role routing set for {role}"),
        CliLang::Arabic => format!("تم ضبط توجيه الدور {role}"),
    }
}

fn budget_summary_message(lang: CliLang, spent: u64, budget: u64, used_pct: u64) -> String {
    match lang {
        CliLang::English => format!("Budget: {spent} / {budget} cents ({used_pct}% used)"),
        CliLang::Arabic => format!("الميزانية: {spent} / {budget} سنت (تم صرف {used_pct}%)"),
    }
}

fn budget_remaining_message(lang: CliLang, remaining: u64) -> String {
    match lang {
        CliLang::English => format!("Remaining: {remaining} cents"),
        CliLang::Arabic => format!("المتبقي: {remaining} سنت"),
    }
}

fn budget_set_message(lang: CliLang, cents: u64, project: &str) -> String {
    match lang {
        CliLang::English => format!("Budget set to {cents} cents for {project}"),
        CliLang::Arabic => format!("تم ضبط الميزانية على {cents} سنت للمشروع {project}"),
    }
}

fn doctor_header_message(lang: CliLang) -> String {
    match lang {
        CliLang::English => "Warsha Doctor".to_string(),
        CliLang::Arabic => "فحص Warsha".to_string(),
    }
}

fn daemon_running_message(lang: CliLang) -> String {
    match lang {
        CliLang::English => "✓ Daemon: Running".to_string(),
        CliLang::Arabic => "✓ الخادم: متصل".to_string(),
    }
}

fn daemon_not_running_message(lang: CliLang) -> String {
    match lang {
        CliLang::English => "✗ Daemon: Not running".to_string(),
        CliLang::Arabic => "✗ الخادم: غير متصل".to_string(),
    }
}

fn tool_found_message(lang: CliLang, name: &str) -> String {
    match lang {
        CliLang::English => format!("✓ {name}: Found"),
        CliLang::Arabic => format!("✓ {name}: متوفر"),
    }
}

fn tool_not_found_message(lang: CliLang, name: &str) -> String {
    match lang {
        CliLang::English => format!("✗ {name}: Not found"),
        CliLang::Arabic => format!("✗ {name}: غير متوفر"),
    }
}

fn providers_section_message(lang: CliLang) -> String {
    match lang {
        CliLang::English => "\nProviders:".to_string(),
        CliLang::Arabic => "\nالمزودون:".to_string(),
    }
}

fn agent_cli_missing_message(lang: CliLang, name: &str) -> String {
    match lang {
        CliLang::English => format!("  ✗ {name} (not installed)"),
        CliLang::Arabic => format!("  ✗ {name} (غير مثبت)"),
    }
}

fn device_paired_message(lang: CliLang) -> String {
    match lang {
        CliLang::English => "Device paired successfully".to_string(),
        CliLang::Arabic => "تم اقتران الجهاز بنجاح".to_string(),
    }
}

/// A `devices list` row: the UUID and the name are data; the status word is a human
/// word, so it follows the locale.
fn device_row_message(lang: CliLang, id: &str, name: &str, revoked: bool) -> String {
    let status = match lang {
        CliLang::English => {
            if revoked {
                "REVOKED"
            } else {
                "active"
            }
        }
        CliLang::Arabic => {
            if revoked {
                "ملغى"
            } else {
                "نشط"
            }
        }
    };
    format!("{id} {name} ({status})")
}

fn device_revoked_message(lang: CliLang) -> String {
    match lang {
        CliLang::English => "Device revoked".to_string(),
        CliLang::Arabic => "تم إلغاء الجهاز".to_string(),
    }
}

fn project_not_found_message(lang: CliLang, name: &str) -> String {
    match lang {
        CliLang::English => format!("Project not found: {name}"),
        CliLang::Arabic => format!("المشروع غير موجود: {name}"),
    }
}

fn unknown_gate_message(lang: CliLang, stage: &str) -> String {
    match lang {
        CliLang::English => format!("Unknown gate stage: {stage}"),
        CliLang::Arabic => format!("مرحلة بوابة غير معروفة: {stage}"),
    }
}

fn invalid_target_message(lang: CliLang, target: &str) -> String {
    match lang {
        CliLang::English => {
            format!("Invalid target format: {target} (expected provider:model)")
        }
        CliLang::Arabic => format!("صيغة الهدف غير صحيحة: {target} (المطلوب provider:model)"),
    }
}

fn config_dir_missing_message(lang: CliLang) -> String {
    match lang {
        CliLang::English => "Config directory not found".to_string(),
        CliLang::Arabic => "لم يتم العثور على مجلد الإعدادات".to_string(),
    }
}

fn invalid_auth_token_message(lang: CliLang, error: &str) -> String {
    match lang {
        CliLang::English => format!("Invalid auth token: {error}"),
        CliLang::Arabic => format!("رمز المصادقة غير صالح: {error}"),
    }
}

/// The one human message `src/main.rs` writes: no token, so no daemon call can be
/// authenticated. Public with [`CliLang::from_process_locale`] because the binary
/// needs it before any [`CliApp`] exists.
pub fn no_token_message(lang: CliLang, config_path: &str) -> String {
    match lang {
        CliLang::English => format!(
            "No auth token found. Run 'warsha init' first or provide --token. Config path: {config_path}"
        ),
        CliLang::Arabic => format!(
            "لم يتم العثور على رمز مصادقة. شغل أمر 'warsha init' أولا أو مرر --token. مسار الملف: {config_path}"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_gate_stage() {
        assert_eq!(
            parse_gate_stage("gate_a", CliLang::English).unwrap(),
            Stage::GateA
        );
        assert_eq!(
            parse_gate_stage("gatea", CliLang::English).unwrap(),
            Stage::GateA
        );
        assert_eq!(
            parse_gate_stage("a", CliLang::English).unwrap(),
            Stage::GateA
        );
        assert_eq!(
            parse_gate_stage("gate_b", CliLang::English).unwrap(),
            Stage::GateB
        );
        assert_eq!(
            parse_gate_stage("gateb", CliLang::English).unwrap(),
            Stage::GateB
        );
        assert_eq!(
            parse_gate_stage("b", CliLang::English).unwrap(),
            Stage::GateB
        );
        assert_eq!(
            parse_gate_stage("gate_c", CliLang::English).unwrap(),
            Stage::GateC
        );
        assert_eq!(
            parse_gate_stage("gatec", CliLang::English).unwrap(),
            Stage::GateC
        );
        assert_eq!(
            parse_gate_stage("c", CliLang::English).unwrap(),
            Stage::GateC
        );
        assert_eq!(
            parse_gate_stage("gate_d", CliLang::English).unwrap(),
            Stage::GateD
        );
        let english = parse_gate_stage("invalid", CliLang::English)
            .expect_err("an unknown gate must be refused");
        let arabic = parse_gate_stage("invalid", CliLang::Arabic)
            .expect_err("an unknown gate must be refused");
        assert!(
            format!("{english}").contains("Unknown gate stage"),
            "the English parse error keeps its sentence: {english}"
        );
        assert!(
            has_arabic(&format!("{arabic}")),
            "and the Arabic parse error follows the locale: {arabic}"
        );
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

    /// True when the string carries a character from the Arabic block.
    fn has_arabic(s: &str) -> bool {
        s.chars().any(|c| ('\u{0600}'..='\u{06FF}').contains(&c))
    }

    /// Every human message the CLI can write, in both wordings, with fixed sample
    /// arguments. Any `_message` function missing from this list is untested, and any
    /// wording collapsed back to English-only fails the tests over this list.
    fn every_message_pair() -> Vec<(&'static str, String, String)> {
        let en = CliLang::English;
        let ar = CliLang::Arabic;
        vec![
            ("init_done", init_done_message(en), init_done_message(ar)),
            (
                "created_project",
                created_project_message(en, "P-1", "R-1"),
                created_project_message(ar, "P-1", "R-1"),
            ),
            (
                "run_at_stage",
                run_at_stage_message(en, "R-1", "Build"),
                run_at_stage_message(ar, "R-1", "Build"),
            ),
            ("no_runs", no_runs_message(en), no_runs_message(ar)),
            (
                "run_status_line",
                run_status_line_message(en, "R-1", "Build", "Running"),
                run_status_line_message(ar, "R-1", "Build", "Running"),
            ),
            ("following", following_message(en), following_message(ar)),
            (
                "gate_approved",
                gate_approved_message(en, "GateC"),
                gate_approved_message(ar, "GateC"),
            ),
            (
                "gate_rejected",
                gate_rejected_message(en, "GateC"),
                gate_rejected_message(ar, "GateC"),
            ),
            (
                "provider_added",
                provider_added_message(en, "or", "open_router"),
                provider_added_message(ar, "or", "open_router"),
            ),
            (
                "provider_health",
                provider_health_message(en, "Healthy"),
                provider_health_message(ar, "Healthy"),
            ),
            (
                "provider_removed",
                provider_removed_message(en),
                provider_removed_message(ar),
            ),
            (
                "role_row",
                role_row_message(en, "planner", "or:gpt", true),
                role_row_message(ar, "planner", "or:gpt", true),
            ),
            (
                "role_routing_set",
                role_routing_set_message(en, "planner"),
                role_routing_set_message(ar, "planner"),
            ),
            (
                "budget_summary",
                budget_summary_message(en, 10, 100, 10),
                budget_summary_message(ar, 10, 100, 10),
            ),
            (
                "budget_remaining",
                budget_remaining_message(en, 90),
                budget_remaining_message(ar, 90),
            ),
            (
                "budget_set",
                budget_set_message(en, 100, "proj"),
                budget_set_message(ar, 100, "proj"),
            ),
            (
                "doctor",
                doctor_header_message(en),
                doctor_header_message(ar),
            ),
            (
                "daemon_running",
                daemon_running_message(en),
                daemon_running_message(ar),
            ),
            (
                "daemon_not_running",
                daemon_not_running_message(en),
                daemon_not_running_message(ar),
            ),
            (
                "tool_found",
                tool_found_message(en, "git"),
                tool_found_message(ar, "git"),
            ),
            (
                "tool_not_found",
                tool_not_found_message(en, "git"),
                tool_not_found_message(ar, "git"),
            ),
            (
                "providers_section",
                providers_section_message(en),
                providers_section_message(ar),
            ),
            (
                "agent_cli_missing",
                agent_cli_missing_message(en, "claude"),
                agent_cli_missing_message(ar, "claude"),
            ),
            (
                "device_paired",
                device_paired_message(en),
                device_paired_message(ar),
            ),
            (
                "device_row_active",
                device_row_message(en, "u-1", "phone", false),
                device_row_message(ar, "u-1", "phone", false),
            ),
            (
                "device_row_revoked",
                device_row_message(en, "u-1", "phone", true),
                device_row_message(ar, "u-1", "phone", true),
            ),
            (
                "device_revoked",
                device_revoked_message(en),
                device_revoked_message(ar),
            ),
            (
                "project_not_found",
                project_not_found_message(en, "nope"),
                project_not_found_message(ar, "nope"),
            ),
            (
                "unknown_gate",
                unknown_gate_message(en, "zz"),
                unknown_gate_message(ar, "zz"),
            ),
            (
                "invalid_target",
                invalid_target_message(en, "oops"),
                invalid_target_message(ar, "oops"),
            ),
            (
                "config_dir_missing",
                config_dir_missing_message(en),
                config_dir_missing_message(ar),
            ),
            (
                "invalid_auth_token",
                invalid_auth_token_message(en, "e"),
                invalid_auth_token_message(ar, "e"),
            ),
            (
                "no_token",
                no_token_message(en, "/c.toml"),
                no_token_message(ar, "/c.toml"),
            ),
            (
                "needs_key_refusal",
                needs_key_message(en, "or", "open_router"),
                needs_key_message(ar, "or", "open_router"),
            ),
            (
                "no_key_kind_refusal",
                no_key_kind_message(en, "local", "ollama", false),
                no_key_kind_message(ar, "local", "ollama", false),
            ),
            (
                "no_key_kind_refusal_with_key",
                no_key_kind_message(en, "local", "ollama", true),
                no_key_kind_message(ar, "local", "ollama", true),
            ),
        ]
    }

    #[test]
    fn every_human_message_has_two_wordings() {
        for (name, english, arabic) in every_message_pair() {
            assert_ne!(
                english, arabic,
                "{name}: an Arabic locale must not get the English sentence — \
                 collapse this wording to English-only and this test fails"
            );
            assert!(
                has_arabic(&arabic),
                "{name}: the Arabic wording must be written in Arabic script: {arabic}"
            );
            assert!(
                !has_arabic(&english),
                "{name}: the English wording must stay English: {english}"
            );
        }
    }

    #[test]
    fn the_arabic_wordings_print_as_they_are_written() {
        // Same rule `src/main.rs`'s `Debug` printing forced on the refusals, for every
        // message: no harakat, no shadda — a Debug-escaped Arabic string is unreadable.
        for (name, _, arabic) in every_message_pair() {
            let printed = format!("{arabic:?}");
            assert!(
                !printed.contains("\\u{"),
                "{name}: the Arabic wording must survive Debug unescaped: {printed}"
            );
        }
    }

    #[test]
    fn the_english_wordings_stay_the_machine_contract_sentences() {
        // `--json` pins its language to English, so the English arm is what any script
        // has matched since M4. A byte that changes here changes the contract.
        for (name, english, _) in every_message_pair() {
            assert!(
                english
                    .chars()
                    .all(|c| c.is_ascii() || c == '✓' || c == '✗'),
                "{name}: the English wording must stay ASCII (the ✓/✗ glyphs excepted): \
                 {english}"
            );
        }
    }

    #[test]
    fn no_human_word_reaches_output_without_a_language_choice() {
        // The re-hardcoding guard on the call sites: the argument of every `self.output`
        // call either goes through a `_message(...)` function or is pure data — a
        // literal with no human word in it. The needle is built at runtime so the
        // scanner does not match this test's own source.
        let src = include_str!("lib.rs");
        let needle = ["self.output", "("].concat();
        let mut offenders: Vec<String> = Vec::new();
        for (byte_idx, _) in src.match_indices(&needle) {
            let rest = &src[byte_idx + needle.len()..];
            let mut depth = 1usize;
            let mut in_str = false;
            let mut escaped = false;
            let mut arg = None;
            for (off, c) in rest.char_indices() {
                if escaped {
                    escaped = false;
                    continue;
                }
                if in_str {
                    match c {
                        '\\' => escaped = true,
                        '"' => in_str = false,
                        _ => {}
                    }
                    continue;
                }
                match c {
                    '"' => in_str = true,
                    '(' => depth += 1,
                    ')' => {
                        depth -= 1;
                        if depth == 0 {
                            arg = Some(&rest[..off]);
                            break;
                        }
                    }
                    _ => {}
                }
            }
            let arg = arg.unwrap_or_else(|| panic!("unbalanced `{needle}` at byte {byte_idx}"));
            if arg.contains("_message(") {
                continue;
            }
            // No language choice in the argument: no quoted literal inside it may carry
            // a run of two ASCII letters (a human word). Data placeholders — `{}`,
            // `{:?}`, `%H:%M:%S`, `=============` — carry none.
            let mut in_str = false;
            let mut escaped = false;
            let mut run = 0usize;
            for c in arg.chars() {
                if escaped {
                    escaped = false;
                    continue;
                }
                if in_str {
                    match c {
                        '\\' => escaped = true,
                        '"' => in_str = false,
                        x if x.is_ascii_alphabetic() => {
                            run += 1;
                            if run >= 2 {
                                let line = src[..byte_idx].matches('\n').count() + 1;
                                offenders.push(format!("line {line}: {arg}"));
                                break;
                            }
                        }
                        _ => run = 0,
                    }
                    continue;
                }
                if c == '"' {
                    in_str = true;
                    run = 0;
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "these output calls print a human word without choosing a language — \
             route them through a `_message` function:\n{}",
            offenders.join("\n")
        );
    }
}
