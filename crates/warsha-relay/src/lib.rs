//! Warsha Relay — Tiny optional relay server (axum) — opaque frame forwarding

use axum::{
    extract::{
        ws::{Message, WebSocket},
        Query, State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use clap::Parser;
use futures::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::broadcast;
use tokio::sync::RwLock;
use tracing::{info, warn};
use uuid::Uuid;
use warsha_core::*;
use warsha_remote::EncryptedFrame;

#[derive(Error, Debug)]
pub enum RelayError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Device not found: {0}")]
    DeviceNotFound(DeviceId),
    #[error("Channel closed")]
    ChannelClosed,
    #[error("Other: {0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, RelayError>;

#[derive(Parser, Debug)]
#[command(name = "warsha-relay", version, about = "Warsha relay server")]
pub struct RelayArgs {
    /// Bind address
    #[arg(short, long, default_value = "0.0.0.0:8767")]
    pub bind: String,

    /// Maximum frame size
    #[arg(long, default_value = "1048576")] // 1MB
    pub max_frame_size: usize,
}

/// Relay state
pub struct RelayState {
    pub channels: Arc<RwLock<HashMap<DeviceId, broadcast::Sender<EncryptedFrame>>>>,
    pub max_frame_size: usize,
}

impl RelayState {
    pub fn new(max_frame_size: usize) -> Self {
        Self {
            channels: Arc::new(RwLock::new(HashMap::new())),
            max_frame_size,
        }
    }

    pub async fn register(&self, device_id: DeviceId) -> broadcast::Receiver<EncryptedFrame> {
        let mut channels = self.channels.write().await;
        let (tx, rx) = broadcast::channel(100);
        channels.insert(device_id, tx);
        rx
    }

    pub async fn unregister(&self, device_id: DeviceId) {
        self.channels.write().await.remove(&device_id);
    }

    pub async fn forward(&self, frame: &EncryptedFrame) -> Result<()> {
        let channels = self.channels.read().await;
        if let Some(tx) = channels.get(&frame.to) {
            tx.send(frame.clone())
                .map_err(|_| RelayError::ChannelClosed)?;
        }
        Ok(())
    }
}

/// HTTP handler for frame submission (for non-WebSocket clients)
async fn submit_frame(
    State(state): State<Arc<RelayState>>,
    Json(frame): Json<EncryptedFrame>,
) -> axum::response::Response {
    if frame.ciphertext.len() > state.max_frame_size {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    }

    if state.forward(&frame).await.is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    StatusCode::ACCEPTED.into_response()
}

/// WebSocket handler for real-time frame relay
async fn websocket_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<Arc<RelayState>>,
) -> impl IntoResponse {
    let device_id = params
        .get("device_id")
        .and_then(|s| Uuid::parse_str(s).ok())
        .map(DeviceId);

    let Some(device_id) = device_id else {
        return ws.on_upgrade(|_| async {}).into_response();
    };

    ws.on_upgrade(move |socket| handle_websocket(socket, device_id, state))
        .into_response()
}

async fn handle_websocket(socket: WebSocket, device_id: DeviceId, state: Arc<RelayState>) {
    let mut rx = state.register(device_id).await;
    info!("Device {} connected to relay", device_id.0);

    let (mut sender, mut receiver) = socket.split();

    // Task to forward frames from relay to this device
    let forward_task = tokio::spawn(async move {
        while let Ok(frame) = rx.recv().await {
            let msg = match serde_json::to_vec(&frame) {
                Ok(vec) => Message::Binary(vec),
                Err(_) => break,
            };
            if sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Task to receive frames from this device and relay them
    let relay_state = state.clone();
    let recv_task = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            if let Ok(msg) = msg {
                if let Message::Binary(data) = msg {
                    if let Ok(frame) = serde_json::from_slice::<EncryptedFrame>(&data) {
                        if let Err(e) = relay_state.forward(&frame).await {
                            warn!("Failed to forward frame: {}", e);
                        }
                    }
                }
            } else {
                break;
            }
        }
    });

    // Wait for either task to complete
    tokio::select! {
        _ = forward_task => {},
        _ = recv_task => {},
    }

    state.unregister(device_id).await;
    info!("Device {} disconnected from relay", device_id.0);
}

/// Health check endpoint
async fn health() -> impl IntoResponse {
    Json(serde_json::json!({ "status": "healthy" }))
}

/// Run the relay server
pub async fn run_relay(args: RelayArgs) -> Result<()> {
    let state = Arc::new(RelayState::new(args.max_frame_size));

    let app = Router::new()
        .route("/health", get(health))
        .route("/frame", post(submit_frame))
        .route("/ws", get(websocket_handler))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&args.bind).await?;
    info!("Relay server listening on {}", args.bind);

    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[tokio::test]
    async fn test_relay_state() {
        let state = RelayState::new(1024);
        let device_id = DeviceId::new();

        let mut rx = state.register(device_id).await;
        assert!(rx.is_empty());

        let frame = EncryptedFrame {
            from: DeviceId::new(),
            to: device_id,
            nonce: [0u8; 12],
            ciphertext: vec![1, 2, 3],
            timestamp: Utc::now(),
        };

        state.forward(&frame).await.unwrap();

        let received = rx.recv().await.unwrap();
        assert_eq!(received.ciphertext, vec![1, 2, 3]);

        state.unregister(device_id).await;
    }
}
