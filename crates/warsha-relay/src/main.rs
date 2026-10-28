//! Warsha Relay binary entry point

use clap::Parser;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use warsha_relay::{run_relay, RelayArgs};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,warsha_relay=debug".to_string()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let args = RelayArgs::parse();
    run_relay(args).await?;
    Ok(())
}
