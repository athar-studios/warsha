//! Warshad binary entry point

use async_trait as _;
use axum as _;
use base64 as _;
use chrono as _;
use dirs as _;
use fs2 as _;
use futures as _;
use jsonrpsee as _;
use keyring as _;
use rand as _;
use reqwest as _;
use serde as _;
use serde_json as _;
#[cfg(test)]
use sqlx as _;
#[cfg(test)]
use tempfile as _;
use thiserror as _;
use toml as _;
use tower as _;
use tower_http as _;
use tracing as _;
use ulid as _;
use uuid as _;
use warsha_backends as _;
use warsha_core as _;
use warsha_git as _;
use warsha_pipeline as _;
use warsha_providers as _;
use warsha_remote as _;
use warsha_store as _;

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
