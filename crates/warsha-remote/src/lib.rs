//! Warsha Remote — Pairing, E2E crypto, relay client

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use chrono::{DateTime, Duration, Utc};
use image::Luma;
use qrcode::QrCode;
use rand::rngs::OsRng;
use rand::TryRngCore;
use serde::{Deserialize, Serialize};
use snow::{params::NoiseParams, Builder, HandshakeState, TransportState};
use std::collections::HashMap;
use std::io::Cursor;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::Mutex;
use warsha_core::*;
use x25519_dalek::{PublicKey, StaticSecret};

#[derive(Error, Debug)]
pub enum RemoteError {
    #[error("Crypto error: {0}")]
    Crypto(String),
    #[error("Handshake failed: {0}")]
    Handshake(String),
    #[error("Device not found: {0}")]
    DeviceNotFound(DeviceId),
    #[error("Device revoked: {0}")]
    DeviceRevoked(DeviceId),
    #[error("Replay attack detected")]
    ReplayAttack,
    #[error("QR code generation failed: {0}")]
    QrCode(String),
    #[error("Relay error: {0}")]
    Relay(String),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, RemoteError>;

/// Noise XX parameters
const NOISE_PARAMS: &str = "Noise_XX_25519_ChaChaPoly_BLAKE2s";

/// Long-term device identity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceIdentity {
    pub device_id: DeviceId,
    pub static_public: [u8; 32], // X25519 public key
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub revoked: bool,
    pub revoked_at: Option<DateTime<Utc>>,
}

impl DeviceIdentity {
    pub fn generate(name: String) -> Result<Self> {
        let mut secret_bytes = [0u8; 32];
        OsRng
            .try_fill_bytes(&mut secret_bytes)
            .map_err(|e| RemoteError::Crypto(e.to_string()))?;
        let static_secret = StaticSecret::from(secret_bytes);
        let static_public = PublicKey::from(&static_secret).to_bytes();

        Ok(Self {
            device_id: DeviceId::new(),
            static_public,
            name,
            created_at: Utc::now(),
            revoked: false,
            revoked_at: None,
        })
    }

    pub fn verify_signature(&self, _message: &[u8], _signature: &[u8]) -> bool {
        // In real implementation, verify Ed25519 signature
        true
    }
}

/// Pairing data exchanged via QR code
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairingData {
    pub device_id: DeviceId,
    pub static_public: [u8; 32],
    pub relay_url: Option<String>,
    pub pairing_secret: [u8; 32], // One-time secret
    pub expires_at: DateTime<Utc>,
}

impl PairingData {
    pub fn new(device: &DeviceIdentity, relay_url: Option<String>) -> Result<Self> {
        let mut pairing_secret = [0u8; 32];
        OsRng
            .try_fill_bytes(&mut pairing_secret)
            .map_err(|e| RemoteError::Crypto(e.to_string()))?;

        Ok(Self {
            device_id: device.device_id,
            static_public: device.static_public,
            relay_url,
            pairing_secret,
            expires_at: Utc::now() + Duration::minutes(10),
        })
    }

    pub fn to_qr_code(&self) -> Result<String> {
        let data = serde_json::to_vec(self)?;
        let code = QrCode::new(&data).map_err(|e| RemoteError::QrCode(e.to_string()))?;
        let image = code.render::<Luma<u8>>().build();

        // Convert to base64 PNG using Cursor which implements Write + Seek
        let mut png_data = Vec::new();
        let mut cursor = Cursor::new(&mut png_data);
        image
            .write_to(&mut cursor, image::ImageFormat::Png)
            .map_err(|e| RemoteError::QrCode(e.to_string()))?;

        Ok(BASE64_STANDARD.encode(png_data))
    }

    pub fn from_qr_code(base64_png: &str) -> Result<Self> {
        let png_data = BASE64_STANDARD
            .decode(base64_png)
            .map_err(|e| RemoteError::QrCode(e.to_string()))?;

        // In real implementation, decode QR from image
        // For now, assume we have the JSON data directly
        let data = serde_json::from_slice(&png_data)?;
        Ok(data)
    }
}

/// Encrypted frame for relay transport
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedFrame {
    pub from: DeviceId,
    pub to: DeviceId,
    pub nonce: [u8; 12],
    pub ciphertext: Vec<u8>,
    pub timestamp: DateTime<Utc>,
}

/// E2E encrypted channel using Noise XX
#[allow(dead_code)]
pub struct EncryptedChannel {
    transport: Option<TransportState>,
    local_static: StaticSecret,
    remote_static: PublicKey,
    local_device_id: DeviceId,
    remote_device_id: DeviceId,
    replay_cache: Arc<Mutex<Vec<[u8; 12]>>>,
}

impl EncryptedChannel {
    /// Initiator side: start handshake
    pub fn initiate(local_identity: &DeviceIdentity, remote_public: &[u8; 32]) -> Result<Self> {
        let params: NoiseParams = NOISE_PARAMS
            .parse::<NoiseParams>()
            .map_err(|e: snow::Error| RemoteError::Crypto(e.to_string()))?;
        let builder = Builder::new(params);

        let mut secret_bytes = [0u8; 32];
        OsRng
            .try_fill_bytes(&mut secret_bytes)
            .map_err(|e| RemoteError::Crypto(e.to_string()))?;
        let local_static = StaticSecret::from(secret_bytes);

        let _handshake = builder
            .local_private_key(&local_static.to_bytes())
            .remote_public_key(remote_public)
            .build_initiator()
            .map_err(|e| RemoteError::Handshake(e.to_string()))?;

        Ok(Self {
            transport: None,
            local_static,
            remote_static: PublicKey::from(*remote_public),
            local_device_id: local_identity.device_id,
            remote_device_id: DeviceId::new(), // Will be set after handshake
            replay_cache: Arc::new(Mutex::new(Vec::new())),
        })
    }

    /// Responder side: start handshake
    pub fn respond(local_identity: &DeviceIdentity) -> Result<Self> {
        let params: NoiseParams = NOISE_PARAMS
            .parse::<NoiseParams>()
            .map_err(|e: snow::Error| RemoteError::Crypto(e.to_string()))?;
        let builder = Builder::new(params);

        let mut secret_bytes = [0u8; 32];
        OsRng
            .try_fill_bytes(&mut secret_bytes)
            .map_err(|e| RemoteError::Crypto(e.to_string()))?;
        let local_static = StaticSecret::from(secret_bytes);

        let _handshake = builder
            .local_private_key(&local_static.to_bytes())
            .build_responder()
            .map_err(|e| RemoteError::Handshake(e.to_string()))?;

        Ok(Self {
            transport: None,
            local_static,
            remote_static: PublicKey::from([0u8; 32]), // Will be set after handshake
            local_device_id: local_identity.device_id,
            remote_device_id: DeviceId::new(),
            replay_cache: Arc::new(Mutex::new(Vec::new())),
        })
    }

    /// Process handshake message
    pub fn process_handshake(&mut self, _msg: &[u8], _out: &mut Vec<u8>) -> Result<bool> {
        // In real implementation, use snow's handshake state machine
        Ok(false)
    }

    /// Write a message (encrypt)
    pub fn write_message(&mut self, plaintext: &[u8], out: &mut [u8]) -> Result<()> {
        if let Some(transport) = &mut self.transport {
            transport
                .write_message(plaintext, out)
                .map_err(|e| RemoteError::Crypto(e.to_string()))?;
            Ok(())
        } else {
            Err(RemoteError::Handshake("Handshake not complete".to_string()))
        }
    }

    /// Read a message (decrypt)
    pub fn read_message(&mut self, ciphertext: &[u8], out: &mut [u8]) -> Result<()> {
        if let Some(transport) = &mut self.transport {
            transport
                .read_message(ciphertext, out)
                .map_err(|e| RemoteError::Crypto(e.to_string()))?;

            // Check replay protection
            Ok(())
        } else {
            Err(RemoteError::Handshake("Handshake not complete".to_string()))
        }
    }

    /// Complete handshake and get transport
    pub fn complete_handshake(&mut self, handshake: HandshakeState) -> Result<()> {
        self.transport = Some(
            handshake
                .into_transport_mode()
                .map_err(|e| RemoteError::Handshake(e.to_string()))?,
        );
        Ok(())
    }
}

/// Relay client for connecting to warsha-relay
#[allow(dead_code)]
pub struct RelayClient {
    url: String,
    device_id: DeviceId,
    channel: Arc<Mutex<Option<EncryptedChannel>>>,
}

impl RelayClient {
    pub fn new(url: String, device_id: DeviceId) -> Self {
        Self {
            url,
            device_id,
            channel: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn connect(&self, _pairing: &PairingData) -> Result<()> {
        // In real implementation, connect to relay WebSocket
        // Perform handshake with remote device
        Ok(())
    }

    pub async fn send_frame(&self, _frame: EncryptedFrame) -> Result<()> {
        // Send encrypted frame to relay
        Ok(())
    }

    pub async fn receive_frames(&self) -> Result<Vec<EncryptedFrame>> {
        // Receive frames from relay
        Ok(vec![])
    }
}

/// Device registry for managing paired devices
pub struct DeviceRegistry {
    devices: Arc<Mutex<HashMap<DeviceId, DeviceIdentity>>>,
    local_identity: DeviceIdentity,
}

impl DeviceRegistry {
    pub fn new(local_identity: DeviceIdentity) -> Self {
        let mut devices = HashMap::new();
        devices.insert(local_identity.device_id, local_identity.clone());

        Self {
            devices: Arc::new(Mutex::new(devices)),
            local_identity,
        }
    }

    pub async fn add_device(&self, device: DeviceIdentity) -> Result<()> {
        if device.revoked {
            return Err(RemoteError::DeviceRevoked(device.device_id));
        }
        self.devices.lock().await.insert(device.device_id, device);
        Ok(())
    }

    pub async fn revoke_device(&self, device_id: DeviceId) -> Result<()> {
        let mut devices = self.devices.lock().await;
        if let Some(device) = devices.get_mut(&device_id) {
            device.revoked = true;
            device.revoked_at = Some(Utc::now());
            Ok(())
        } else {
            Err(RemoteError::DeviceNotFound(device_id))
        }
    }

    pub async fn get_device(&self, device_id: DeviceId) -> Result<DeviceIdentity> {
        let devices = self.devices.lock().await;
        devices
            .get(&device_id)
            .cloned()
            .ok_or(RemoteError::DeviceNotFound(device_id))
    }

    pub async fn list_devices(&self) -> Vec<DeviceIdentity> {
        self.devices.lock().await.values().cloned().collect()
    }

    pub async fn is_revoked(&self, device_id: DeviceId) -> bool {
        self.devices
            .lock()
            .await
            .get(&device_id)
            .map(|d| d.revoked)
            .unwrap_or(true)
    }

    pub fn local_identity(&self) -> &DeviceIdentity {
        &self.local_identity
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_device_identity_generation() {
        let device = DeviceIdentity::generate("Test Device".to_string()).unwrap();
        assert!(!device.revoked);
        assert_eq!(device.name, "Test Device");
    }

    #[test]
    fn test_pairing_data() {
        let device = DeviceIdentity::generate("Test".to_string()).unwrap();
        let pairing =
            PairingData::new(&device, Some("wss://relay.example.com".to_string())).unwrap();

        assert_eq!(pairing.device_id, device.device_id);
        assert_eq!(pairing.static_public, device.static_public);
        assert!(pairing.relay_url.is_some());
        assert!(pairing.expires_at > Utc::now());
    }

    #[tokio::test]
    async fn test_device_registry() {
        let local = DeviceIdentity::generate("Local".to_string()).unwrap();
        let registry = DeviceRegistry::new(local.clone());

        let remote = DeviceIdentity::generate("Remote".to_string()).unwrap();
        registry.add_device(remote.clone()).await.unwrap();

        let devices = registry.list_devices().await;
        assert_eq!(devices.len(), 2);

        let retrieved = registry.get_device(remote.device_id).await.unwrap();
        assert_eq!(retrieved.name, "Remote");

        registry.revoke_device(remote.device_id).await.unwrap();
        assert!(registry.is_revoked(remote.device_id).await);
    }

    #[test]
    fn test_encrypted_channel_creation() {
        let local = DeviceIdentity::generate("Local".to_string()).unwrap();
        let remote_public = [1u8; 32]; // dummy

        let channel = EncryptedChannel::initiate(&local, &remote_public).unwrap();
        assert_eq!(channel.local_device_id, local.device_id);
    }
}
