//! Warshad binary entry point

use clap::Parser;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use warshad::{run_daemon, DaemonArgs};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,warshad=debug".to_string()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let args = DaemonArgs::parse();
    run_daemon(args).await?;
    Ok(())
}
