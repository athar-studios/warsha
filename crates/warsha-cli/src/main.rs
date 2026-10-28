//! Warsha CLI binary entry point

use clap::Parser;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use warsha_cli::{Cli, CliApp};

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

    // Handle daemon subcommand specially (runs in-process)
    if matches!(cli.command, warsha_cli::Commands::Daemon(_)) {
        let app = CliApp::new(cli.url.clone(), cli.json)?;
        app.run(cli).await?;
        return Ok(());
    }

    // For all other commands, connect to daemon
    let app = CliApp::new(cli.url.clone(), cli.json)?;
    app.run(cli).await?;
    Ok(())
}
