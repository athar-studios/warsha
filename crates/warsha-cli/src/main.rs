//! Warsha CLI binary entry point

use clap::Parser;
use std::path::Path;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use warsha_cli::{no_token_message, Cli, CliApp, CliLang, DaemonConfig};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "warn".to_string()),
        ))
        .with(tracing_subscriber::fmt::layer().with_writer(std::io::stderr))
        .init();

    let cli = Cli::parse();

    // Load auth token and device id from config.toml or CLI overrides
    let token = load_token(&cli)?;
    let device_id = load_device_id(&cli);

    // Handle daemon subcommand specially (runs in-process)
    if matches!(cli.command, warsha_cli::Commands::Daemon(_)) {
        let app =
            CliApp::new(cli.url.clone(), token, cli.json)?.with_device_id(device_id.clone())?;
        app.run(cli).await?;
        return Ok(());
    }

    // For all other commands, connect to daemon
    let app = CliApp::new(cli.url.clone(), token, cli.json)?.with_device_id(device_id)?;
    app.run(cli).await?;
    Ok(())
}

/// The CLI-only device id: `--device-id`, else the `device_id` key in `config.toml`.
fn load_device_id(cli: &Cli) -> Option<String> {
    let config_path = cli.config.clone().unwrap_or_else(|| {
        dirs::config_dir()
            .map(|d| d.join("warsha").join("config.toml"))
            .unwrap_or_else(|| Path::new(".").join("warsha").join("config.toml"))
    });
    warsha_cli::resolve_device_id(cli.device_id.as_deref(), &config_path)
}

fn load_token(cli: &Cli) -> Result<String, Box<dyn std::error::Error>> {
    // CLI override takes precedence
    if let Some(token) = &cli.token {
        return Ok(token.clone());
    }

    // Try to load from config file
    let config_path = cli.config.clone().unwrap_or_else(|| {
        dirs::config_dir()
            .map(|d| d.join("warsha").join("config.toml"))
            .unwrap_or_else(|| Path::new(".").join("warsha").join("config.toml"))
    });

    if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)?;
        let config: DaemonConfig = toml::from_str(&content)?;
        if !config.auth_token.is_empty() {
            return Ok(config.auth_token);
        }
    }

    // No token found
    let lang = CliLang::from_process_locale(cli.json);
    Err(no_token_message(lang, &config_path.display().to_string()).into())
}
