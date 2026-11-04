//! Warsha Remote — Pairing, E2E crypto, relay client

pub mod rate_limit;

use base64::{
    engine::general_purpose::STANDARD as BASE64_STANDARD,
    engine::general_purpose::URL_SAFE_NO_PAD as BASE64_URL_SAFE_NO_PAD, Engine as _,
};
use chrono::{DateTime, Duration, Utc};
use image::Luma;
use qrcode::QrCode;
use rand::rngs::OsRng;
use rand::TryRngCore;
use serde::{Deserialize, Serialize};
use snow::{params::NoiseParams, Builder, HandshakeState, TransportState};
use std::collections::HashMap;
use std::fmt;
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
    /// The daemon's own address was missing or blank where a pairing link needed it.
    ///
    /// Its own variant rather than [`RemoteError::Handshake`], because a caller that
    /// sees it is not looking at a failed negotiation: the daemon has no resolved
    /// listening address to advertise yet, which is a configuration or startup-order
    /// fact the owner can act on. The message names the problem and never repeats a
    /// credential.
    #[error("Pairing origin error: {0}")]
    PairingOrigin(String),
    #[error("Relay error: {0}")]
    Relay(String),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, RemoteError>;

/// Whether two byte strings are equal, in time that does not depend on how much of
/// `presented` was right.
///
/// Every credential in the pairing path — a pairing secret, a bearer token — is
/// compared with this. A plain `==` returns at the first differing byte, which turns
/// a series of rejected attempts into a measurement of the longest correct prefix,
/// and a 256-bit secret into 256 guesses of one byte each.
///
/// The length check is not constant-time and does not need to be: what is compared
/// here is fixed-width material, and a secret's *length* is not the part an attacker
/// is trying to recover.
pub fn constant_time_eq(expected: &[u8], presented: &[u8]) -> bool {
    if expected.len() != presented.len() {
        return false;
    }
    expected
        .iter()
        .zip(presented)
        .fold(0u8, |differences, (a, b)| differences | (a ^ b))
        == 0
}

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
#[derive(Clone, Serialize, Deserialize)]
pub struct PairingData {
    pub device_id: DeviceId,
    pub static_public: [u8; 32],
    pub relay_url: Option<String>,
    pub pairing_secret: [u8; 32], // One-time secret
    pub expires_at: DateTime<Utc>,
}

/// A pairing printed for a human, with its secret withheld.
///
/// `PairingData` carries the credential that opens a device's relay channel *and*
/// authorises every frame it submits. A derived `Debug` would print those 32 bytes, and
/// one `debug!("{pairing:?}")` in a daemon's or a relay's log would then be a bearer
/// token in a file that is rotated, shipped to support and pasted into an issue. The
/// store's own `StoredPairing` is written the same way for the same reason, and this is
/// the type where the secret is born (audit N-1).
impl fmt::Debug for PairingData {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PairingData")
            .field("device_id", &self.device_id)
            .field("static_public", &self.static_public)
            .field("relay_url", &self.relay_url)
            .field("pairing_secret", &"<redacted>")
            .field("expires_at", &self.expires_at)
            .finish()
    }
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

    /// The pairing encoded as a QR plate.
    ///
    /// What the plate carries is the pairing's own JSON. That is the right payload for
    /// a *device* that reads its pairing back as a struct — which is what
    /// [`PairingData::from_qr_code`] and `crates/warsha-cli` do — and it is the wrong
    /// payload for a phone that has to open the daemon's address: the phone app parses
    /// its session off a URL (`apps/remote/src/session.ts`), so a plate that carries a
    /// struct tells it nothing it can dial. For that plate use
    /// [`PairingData::pairing_link`] rendered by [`qr_code_png_base64`], which is what
    /// `devices.pair-start` returns.
    pub fn to_qr_code(&self) -> Result<String> {
        let json = serde_json::to_vec(self)?;
        let text = String::from_utf8(json).map_err(|e| RemoteError::QrCode(e.to_string()))?;
        qr_code_png_base64(&text)
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

    /// True while this pairing may still open a channel.
    ///
    /// The expiry is the one the pairing carries, judged against `now`: a relay that
    /// honoured a QR code forever would be a door the owner thought they had closed
    /// when it went stale.
    pub fn is_expired_at(&self, now: DateTime<Utc>) -> bool {
        now >= self.expires_at
    }

    /// True once the wall clock has passed this pairing's expiry.
    pub fn is_expired(&self) -> bool {
        self.is_expired_at(Utc::now())
    }

    /// Whether `presented` is this pairing's secret.
    ///
    /// A constant-time comparison, because a pairing secret is a bearer credential
    /// and a byte-at-a-time short-circuit turns a relay's 401 into a timing oracle
    /// for the one value that opens a device's channel.
    pub fn verify_secret(&self, presented: &[u8]) -> bool {
        constant_time_eq(&self.pairing_secret, presented)
    }

    /// Whether `presented` is this pairing's secret in the bearer-token form
    /// ([`PairingData::secret_token`]).
    pub fn verify_secret_token(&self, presented: &str) -> bool {
        PairingData::secret_from_token(presented).is_some_and(|secret| self.verify_secret(&secret))
    }

    /// The pairing secret as a bearer token: base64url without padding.
    ///
    /// This is what a device puts in `Authorization: Bearer …` to open a relay
    /// channel or submit a frame, and it is the one place the secret's wire form is
    /// decided. It is a secret: nothing that takes it logs it, and a relay keeps the
    /// list rather than echoing one back.
    pub fn secret_token(&self) -> String {
        BASE64_URL_SAFE_NO_PAD.encode(self.pairing_secret)
    }

    /// Decode a bearer token into the 32 bytes a pairing secret is, or `None` when it
    /// is not one.
    ///
    /// Whitespace is trimmed because a pasted token carries it; anything else that
    /// does not decode to exactly 32 bytes is not a wrong secret but no secret at
    /// all, and is answered as a missing credential.
    pub fn secret_from_token(token: &str) -> Option<[u8; 32]> {
        let decoded = BASE64_URL_SAFE_NO_PAD.decode(token.trim()).ok()?;
        decoded.try_into().ok()
    }

    /// The URL a phone opens to become the device this pairing names.
    ///
    /// ## Why the link exists at all
    ///
    /// `PairingData` carries `relay_url` and no field for the daemon's own address, so
    /// a plate printed from it does not tell a phone where to connect. This is the
    /// answer that keeps that wire type unchanged: the origin is supplied by the daemon
    /// that *serves* the pairing, at the moment it hands the pairing out, and the two
    /// are joined here rather than stored. The alternative — a `server_origin` field on
    /// `PairingData` — would put an address that changes every restart (and every
    /// dynamic port) into a credential record that a device stores, a test fixture and
    /// a QR payload, and would churn `crates/warsha-remote`, `@warsha/client`'s
    /// `PairingData`, `devices_pair.rs` and the harness stub for a value the daemon
    /// already knows better than the record does.
    ///
    /// ## The shape
    ///
    /// `<origin>/?server=<origin>&token=<secret_token>` — the PWA-and-daemon link
    /// `apps/remote/src/session.ts::parsePairingLink` accepts in both of its forms
    /// (the `server` parameter is what a link hosted away from the daemon needs, and a
    /// link whose own origin is the daemon reads the same either way).
    ///
    /// **The result carries a bearer credential.** Render it as a QR plate, never as
    /// text, log the [`PairingData::server_origin`] beside it rather than it, and do not
    /// write it to a file — the same rule [`PairingData::secret_token`] carries.
    pub fn pairing_link(&self, server_origin: &str) -> Result<String> {
        let origin = server_origin.trim();
        if origin.is_empty() {
            return Err(RemoteError::PairingOrigin(
                "a pairing link needs the origin a device should dial".to_string(),
            ));
        }
        Ok(format!(
            "{origin}/?server={}&token={}",
            percent_encode_component(origin),
            self.secret_token()
        ))
    }
}

/// The bytes a URI component may carry unescaped (RFC 3986 unreserved), which is the
/// set JavaScript's `encodeURIComponent` leaves alone.
const UNRESERVED: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~";

/// `value` as it must be spelled inside a query component.
///
/// Matched to `encodeURIComponent` rather than to a general URI encoder, because the
/// reader of this link is a browser (`URLSearchParams`), and the difference shows up
/// only where the two disagree: `:` and `/` are escaped by `encodeURIComponent` and
/// must be escaped here, or `?server=https%3A%2F%2F…` arrives as a link whose own
/// authority is the *daemon's* host with a scheme inside its path. Non-ASCII is escaped
/// as its UTF-8 bytes, percent-encoded one byte at a time, exactly as the browser does.
fn percent_encode_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        if UNRESERVED.contains(byte) {
            out.push(*byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Render `text` as a QR plate: a base64-encoded PNG.
///
/// Arbitrary text, because the payload a phone needs is a URL and not a struct — see
/// [`PairingData::to_qr_code`] for the struct-shaped plate the CLI still reads.
pub fn qr_code_png_base64(text: &str) -> Result<String> {
    let code = QrCode::new(text.as_bytes()).map_err(|e| RemoteError::QrCode(e.to_string()))?;
    let image = code.render::<Luma<u8>>().build();

    // Convert to base64 PNG using Cursor which implements Write + Seek
    let mut png_data = Vec::new();
    let mut cursor = Cursor::new(&mut png_data);
    image
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| RemoteError::QrCode(e.to_string()))?;

    Ok(BASE64_STANDARD.encode(png_data))
}

/// What `devices.pair-start` hands the desktop: a pairing, the origin it is reachable
/// at, and a plate a phone can actually read.
///
/// This is the daemon's answer to "the QR carries no address". `server_origin` is the
/// daemon's *resolved* listening address — the host it bound plus the port it ended up
/// on, which is not necessarily the port its configuration named (both listeners accept
/// `0`) — so the three fields can never disagree with each other or with the socket the
/// daemon really opened. `loopback_only` is the honest caveat: an owner pairing a phone
/// over a `127.0.0.1` bind has minted a link no phone can open, and the screen has to
/// say so rather than show a plate that cannot work.
///
/// `pairing_link` and the secret inside it are a bearer credential, so this type's
/// `Debug` prints the origin and the expiry and redacts everything else — the same rule
/// [`PairingData`] follows and for the same reason (audit N-1).
#[derive(Clone)]
pub struct PairingOffer {
    /// The pairing itself: what the redeeming `devices.pair` call binds.
    pub pairing: PairingData,
    /// Where the daemon is listening, as `http://<host>:<port>`. Never a secret.
    pub server_origin: String,
    /// The link a phone opens. **A bearer credential — see above.**
    pub pairing_link: String,
    /// [`PairingOffer::pairing_link`] as a base64 PNG plate.
    pub qr_code_png: String,
    /// True when `server_origin` is inside the loopback range, so the link reaches this
    /// machine only and a phone cannot use it.
    pub loopback_only: bool,
}

impl PairingOffer {
    /// Mint the pairing and render its plate against `server_origin`.
    pub fn new(
        device: &DeviceIdentity,
        server_origin: &str,
        relay_url: Option<String>,
        loopback_only: bool,
    ) -> Result<Self> {
        let pairing = PairingData::new(device, relay_url)?;
        let pairing_link = pairing.pairing_link(server_origin)?;
        let qr_code_png = qr_code_png_base64(&pairing_link)?;
        Ok(Self {
            pairing,
            server_origin: server_origin.to_string(),
            pairing_link,
            qr_code_png,
            loopback_only,
        })
    }

    /// When the minted pairing stops being usable.
    pub fn expires_at(&self) -> DateTime<Utc> {
        self.pairing.expires_at
    }
}

impl fmt::Debug for PairingOffer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PairingOffer")
            .field("server_origin", &self.server_origin)
            .field("loopback_only", &self.loopback_only)
            .field("expires_at", &self.pairing.expires_at)
            .field("pairing", &self.pairing)
            .field("pairing_link", &"<redacted>")
            .field("qr_code_png", &"<redacted image>")
            .finish()
    }
}

/// One entry on a relay's trust list: a pairing that may open a channel, and the
/// device it is therefore speaking as.
#[derive(Clone)]
pub struct TrustedPairing {
    /// The device id the relay binds to an authenticated channel — taken from the
    /// pairing, never from the client (audit H-02).
    pub device_id: DeviceId,
    /// The secret that authenticates the channel.
    pub pairing_secret: [u8; 32],
    /// When the pairing stops being able to open a channel.
    pub expires_at: DateTime<Utc>,
}

/// A trust entry printed with its secret withheld, for the same reason [`PairingData`]
/// is: a relay's log line is not where a device's bearer credential belongs.
impl fmt::Debug for TrustedPairing {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TrustedPairing")
            .field("device_id", &self.device_id)
            .field("pairing_secret", &"<redacted>")
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

impl TrustedPairing {
    /// Trust the pairing a QR code carried.
    pub fn from_pairing(pairing: &PairingData) -> Self {
        Self {
            device_id: pairing.device_id,
            pairing_secret: pairing.pairing_secret,
            expires_at: pairing.expires_at,
        }
    }

    /// Trust a device by the bearer token its pairing secret is, as it is held in a
    /// secret store rather than in a pairing record.
    ///
    /// `None` for a token that is not 32 bytes of base64url, because a record that does
    /// not name a secret cannot authenticate anything and the caller decides whether
    /// that is a warning or a refusal to start. This is the form a relay's trust list
    /// takes when it is read out of the OS keychain instead of handed over as plaintext
    /// (audit N-1), and it deliberately round-trips [`PairingData::secret_token`] so
    /// there is one wire form of a pairing secret in the workspace, not two.
    pub fn from_secret_token(
        device_id: DeviceId,
        token: &str,
        expires_at: DateTime<Utc>,
    ) -> Option<Self> {
        let pairing_secret = PairingData::secret_from_token(token)?;
        Some(Self {
            device_id,
            pairing_secret,
            expires_at,
        })
    }

    /// Whether `presented` authenticates this entry, expiry included.
    fn authenticate(&self, presented: &[u8], now: DateTime<Utc>) -> bool {
        !self.is_expired_at(now) && constant_time_eq(&self.pairing_secret, presented)
    }

    fn is_expired_at(&self, now: DateTime<Utc>) -> bool {
        now >= self.expires_at
    }
}

/// The set of pairings a relay will accept, and the identity each one binds.
///
/// This is the relay's whole authentication story: it holds the same one-time
/// secrets the paired devices hold, and a channel or a frame is admitted only on a
/// match. The scan is linear and constant-time per entry rather than a hash lookup
/// so that no timing difference tells an attacker which prefix of a secret was
/// right; the lists are short (the devices one owner has paired), and the bound on
/// them is the relay's, not the caller's.
#[derive(Clone, Default)]
pub struct RelayTrust {
    entries: Vec<TrustedPairing>,
}

/// A trust list printed as how many devices it holds and which they are, because the
/// list *is* the set of device credentials the relay can impersonate with. Printing it
/// is how a secret ends up in a log (audit N-1).
impl fmt::Debug for RelayTrust {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RelayTrust")
            .field("entries", &self.entries.len())
            .field("devices", &self.device_ids())
            .field("secrets", &"<redacted>")
            .finish()
    }
}

impl RelayTrust {
    /// An empty list: nothing is trusted, so nothing connects.
    pub fn new() -> Self {
        Self::default()
    }

    /// A list from the pairings an owner handed the relay.
    pub fn from_pairings<'a>(pairings: impl IntoIterator<Item = &'a PairingData>) -> Self {
        Self {
            entries: pairings
                .into_iter()
                .map(TrustedPairing::from_pairing)
                .collect(),
        }
    }

    /// A list from entries that were assembled outside a pairing record — from a secret
    /// store, or from credentials the operator handed the process at startup rather than
    /// in a file (audit N-1).
    ///
    /// Repeated device ids replace each other the way [`RelayTrust::add`] does, so a
    /// list built from two sources cannot quietly hold two credentials for one device
    /// and let the older one keep opening channels.
    pub fn from_entries(entries: impl IntoIterator<Item = TrustedPairing>) -> Self {
        let mut trust = Self::new();
        for entry in entries {
            trust.entries.retain(|e| e.device_id != entry.device_id);
            trust.entries.push(entry);
        }
        trust
    }

    /// The devices this list can authenticate, for a log line or a status report. A
    /// device id is not a secret; the secret that names it is.
    pub fn device_ids(&self) -> Vec<DeviceId> {
        self.entries.iter().map(|entry| entry.device_id).collect()
    }

    /// Admit one more pairing. Re-adding the same device replaces its entry, which is
    /// what a re-pair means: the old secret stops working.
    pub fn add(&mut self, pairing: &PairingData) {
        let entry = TrustedPairing::from_pairing(pairing);
        self.entries.retain(|e| e.device_id != entry.device_id);
        self.entries.push(entry);
    }

    /// The device `presented` secret authenticates as, at `now`.
    ///
    /// `None` for a secret nobody holds, for one that is the wrong length, and for a
    /// pairing past its expiry — all three read the same way to the caller, so a
    /// probe cannot tell an unknown device from a retired one.
    ///
    /// Every entry is compared rather than the search stopping at the first match, so
    /// the cost of a probe does not tell its sender how far into the list a guess got.
    pub fn authenticate(&self, presented: &[u8], now: DateTime<Utc>) -> Option<DeviceId> {
        self.entries.iter().fold(None, |matched, entry| {
            if entry.authenticate(presented, now) {
                Some(entry.device_id)
            } else {
                matched
            }
        })
    }

    /// The device `presented` secret authenticates as, against the wall clock.
    pub fn authenticate_now(&self, presented: &[u8]) -> Option<DeviceId> {
        self.authenticate(presented, Utc::now())
    }

    /// The device a bearer token authenticates as, or `None` when it authenticates
    /// nothing — including a token that is not decodable, which is refused exactly
    /// like a wrong one so a probe cannot tell the two apart.
    pub fn authenticate_token(&self, token: &str) -> Option<DeviceId> {
        let secret = PairingData::secret_from_token(token)?;
        self.authenticate(&secret, Utc::now())
    }

    /// How many pairings are trusted.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// True when the relay will admit no channel at all.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
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

    /// The `Authorization` value this client must present to open a relay channel.
    ///
    /// The relay binds every channel to the device its credential authenticates
    /// (security audit H-02), so a client that connects without one is refused before
    /// any frame moves. Checked here as well: a pairing for another device, or one
    /// past its expiry, is refused rather than sent out to be answered with a 401.
    pub fn credential(&self, pairing: &PairingData) -> Result<String> {
        if pairing.device_id != self.device_id {
            return Err(RemoteError::Handshake(format!(
                "the pairing names device {}, but this client is {}",
                pairing.device_id, self.device_id
            )));
        }
        if pairing.is_expired() {
            return Err(RemoteError::Handshake(
                "the pairing has expired; pair the device again".to_string(),
            ));
        }
        Ok(format!("Bearer {}", pairing.secret_token()))
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

    /// A pairing an owner has handed the relay, five minutes from its expiry.
    fn trusted_pairing(device: &DeviceIdentity) -> PairingData {
        PairingData::new(device, None).expect("a pairing is built")
    }

    #[test]
    fn a_trusted_pairing_authenticates_its_secret_and_binds_the_device_id() {
        let device = DeviceIdentity::generate("Phone".to_string()).unwrap();
        let pairing = trusted_pairing(&device);
        let trust = RelayTrust::from_pairings([&pairing]);

        let bound = trust
            .authenticate_now(&pairing.pairing_secret)
            .expect("the pairing's own secret authenticates");
        // The id is the one the *pairing* named, which is the server-side binding
        // audit H-02 asks for: nothing a client puts in a query string decides it.
        assert_eq!(bound, device.device_id);
        assert_eq!(bound, pairing.device_id);
    }

    #[test]
    fn an_unknown_mismatched_or_short_secret_authenticates_no_device() {
        let device = DeviceIdentity::generate("Phone".to_string()).unwrap();
        let pairing = trusted_pairing(&device);
        let trust = RelayTrust::from_pairings([&pairing]);

        assert_eq!(trust.authenticate_now(&[0u8; 32]), None);
        assert_eq!(trust.authenticate_now(&[7u8; 32]), None);
        assert_eq!(trust.authenticate_now(&[]), None);
        // A secret one half of the real one is not a near miss: it is a miss.
        assert_eq!(trust.authenticate_now(&pairing.pairing_secret[..16]), None);
        // And a trust list that holds nothing admits nothing.
        assert!(RelayTrust::new().is_empty());
        assert_eq!(
            RelayTrust::new().authenticate_now(&pairing.pairing_secret),
            None
        );
    }

    #[test]
    fn a_relay_client_carries_the_credential_its_own_pairing_names() {
        let device = DeviceIdentity::generate("Phone".to_string()).unwrap();
        let pairing = trusted_pairing(&device);
        let client = RelayClient::new("ws://relay.example".to_string(), device.device_id);

        let credential = client
            .credential(&pairing)
            .expect("a matching pairing carries");
        assert_eq!(
            credential,
            format!("Bearer {}", pairing.secret_token()),
            "the client did not present the pairing's own secret"
        );
        // The token it produces is what the relay's trust list authenticates.
        assert_eq!(
            RelayTrust::from_pairings([&pairing])
                .authenticate_token(&credential["Bearer ".len()..]),
            Some(device.device_id)
        );

        // A pairing belonging to another device, or past its expiry, is refused here
        // rather than sent out to be refused on the other side.
        let other = DeviceIdentity::generate("Other".to_string()).unwrap();
        let mismatched = trusted_pairing(&other);
        assert!(client.credential(&mismatched).is_err());

        let stale = PairingData {
            expires_at: Utc::now() - Duration::seconds(1),
            ..pairing.clone()
        };
        assert!(client.credential(&stale).is_err());
    }

    #[test]
    fn a_bearer_token_round_trips_and_authenticates_the_same_device() {
        let device = DeviceIdentity::generate("Phone".to_string()).unwrap();
        let pairing = trusted_pairing(&device);
        let trust = RelayTrust::from_pairings([&pairing]);

        let token = pairing.secret_token();
        assert_eq!(
            PairingData::secret_from_token(&token),
            Some(pairing.pairing_secret),
            "the token form of a secret did not round-trip"
        );
        assert_eq!(
            trust.authenticate_token(&token),
            Some(device.device_id),
            "a pairing's own token did not open its channel"
        );
        assert!(pairing.verify_secret_token(&token));

        // A token from another pairing is not this one, and junk is refused exactly
        // like a wrong secret.
        let other = trusted_pairing(&device);
        assert!(!pairing.verify_secret_token(&other.secret_token()));
        assert_eq!(trust.authenticate_token("not-base64!!"), None);
        assert_eq!(trust.authenticate_token(""), None);
        assert_eq!(trust.authenticate_token(&token[..token.len() - 4]), None);
        // Pasted whitespace is the same token.
        assert_eq!(
            trust.authenticate_token(&format!("  {token}\n")),
            Some(device.device_id)
        );
    }

    #[test]
    fn an_expired_pairing_authenticates_no_device() {
        let device = DeviceIdentity::generate("Phone".to_string()).unwrap();
        let pairing = trusted_pairing(&device);
        let trust = RelayTrust::from_pairings([&pairing]);

        let before_expiry = pairing.expires_at - Duration::minutes(1);
        assert_eq!(
            trust.authenticate(&pairing.pairing_secret, before_expiry),
            Some(device.device_id)
        );

        // The expiry the pairing carries is the end of the channel, not of the file.
        let after_expiry = pairing.expires_at + Duration::seconds(1);
        assert_eq!(
            trust.authenticate(&pairing.pairing_secret, after_expiry),
            None,
            "a stale pairing still opened a relay channel"
        );

        // `is_expired` is the same rule read against the wall clock.
        let stale = PairingData {
            expires_at: Utc::now() - Duration::seconds(1),
            ..pairing.clone()
        };
        assert!(stale.is_expired());
        assert!(!stale.is_expired_at(Utc::now() - Duration::minutes(1)));
    }

    #[test]
    fn re_pairing_a_device_retires_its_previous_secret() {
        let device = DeviceIdentity::generate("Phone".to_string()).unwrap();
        let first = trusted_pairing(&device);
        let second = PairingData {
            device_id: first.device_id,
            pairing_secret: [9u8; 32],
            ..first.clone()
        };

        let mut trust = RelayTrust::new();
        trust.add(&first);
        trust.add(&second);

        assert_eq!(trust.len(), 1, "re-pairing grew the trust list");
        assert_eq!(
            trust.authenticate_now(&first.pairing_secret),
            None,
            "the retired secret still opened a channel"
        );
        assert_eq!(
            trust.authenticate_now(&second.pairing_secret),
            Some(device.device_id)
        );
    }

    /// Audit N-1: the secret is the reason a trust list is printed with care. A `Debug`
    /// that shows the pairing bytes turns one log line into every paired device's
    /// credential, on a host the owner may not control.
    #[test]
    fn no_printable_form_of_a_pairing_or_a_trust_list_carries_its_secret() {
        let device = DeviceIdentity::generate("Phone".to_string()).unwrap();
        let pairing = trusted_pairing(&device);
        let token = pairing.secret_token();
        let trust = RelayTrust::from_pairings([&pairing]);

        for printed in [
            format!("{pairing:?}"),
            format!("{trust:?}"),
            format!("{:?}", TrustedPairing::from_pairing(&pairing)),
        ] {
            assert!(
                !printed.contains(&token),
                "a pairing's bearer token was printable: {printed}"
            );
            assert!(
                !printed.contains(&format!("{:?}", pairing.pairing_secret)),
                "a pairing's raw secret bytes were printable: {printed}"
            );
            assert!(
                printed.contains("redacted"),
                "the redaction was not even marked: {printed}"
            );
        }

        // What a reader of the log *does* get: which device, and how many are trusted.
        let rendered = format!("{trust:?}");
        assert!(rendered.contains(&format!("{:?}", device.device_id)));
        assert!(rendered.contains("entries"));

        // The error type a refused pairing produces names the problem, not the value.
        let client = RelayClient::new("ws://relay".to_string(), DeviceId::new());
        let mismatch = client
            .credential(&pairing)
            .expect_err("a pairing for another device is refused");
        assert!(
            !format!("{mismatch}").contains(&token),
            "an error message repeated the secret"
        );
    }

    #[test]
    fn a_trust_entry_built_from_a_stored_token_authenticates_the_same_device() {
        let device = DeviceIdentity::generate("Phone".to_string()).unwrap();
        let pairing = trusted_pairing(&device);
        let token = pairing.secret_token();

        // The store hands back a token and an expiry, not a `PairingData`: this is the
        // form a relay's trust list takes when its credentials come from a secret store.
        let entry = TrustedPairing::from_secret_token(device.device_id, &token, pairing.expires_at)
            .expect("the token is a pairing secret");
        let trust = RelayTrust::from_entries([entry]);

        assert_eq!(trust.len(), 1);
        assert_eq!(
            trust.authenticate_token(&token),
            Some(device.device_id),
            "a stored token did not open the channel it was issued for"
        );
        assert_eq!(trust.authenticate_token("bm90LWEtc2VjcmV0"), None);
        // Not 32 bytes of anything is not a secret at all, and is refused at the door.
        assert!(TrustedPairing::from_secret_token(
            device.device_id,
            "not-base64!!",
            pairing.expires_at
        )
        .is_none());
        assert!(
            TrustedPairing::from_secret_token(device.device_id, "YWJjZA", pairing.expires_at)
                .is_none(),
            "a short token was read as a secret"
        );

        // A list built from two entries for one device keeps the last, so no older
        // credential survives a rebuild.
        let older = TrustedPairing::from_secret_token(device.device_id, &token, pairing.expires_at)
            .expect("a first entry");
        let rotated = PairingData {
            pairing_secret: [4u8; 32],
            ..pairing.clone()
        };
        let newer = TrustedPairing::from_pairing(&rotated);
        let trust = RelayTrust::from_entries([older, newer]);
        assert_eq!(trust.len(), 1, "a rebuild kept two entries for one device");
        assert_eq!(
            trust.authenticate_now(&pairing.pairing_secret),
            None,
            "the superseded secret still opened a channel"
        );
        assert_eq!(
            trust.authenticate_now(&rotated.pairing_secret),
            Some(device.device_id)
        );
    }

    /// The encoder `to_qr_code` was refactored onto, pinned on its own because the
    /// pairing plate the daemon prints now goes through it with a URL in it.
    #[test]
    fn a_qr_plate_is_a_decodable_png_of_the_text_it_was_handed() {
        let plate =
            qr_code_png_base64("http://127.0.0.1:8766/?token=abc").expect("a plate renders");
        let bytes = BASE64_STANDARD.decode(&plate).expect("the plate is base64");
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n", "not a PNG: {bytes:?}");
        // The struct plate still renders, so the refactor did not take the CLI's
        // payload form away (`to_qr_code` and `from_qr_code` still round-trip its JSON).
        let device = DeviceIdentity::generate("Phone".to_string()).unwrap();
        let pairing = PairingData::new(&device, None).expect("a pairing is built");
        let struct_plate = pairing.to_qr_code().expect("the struct plate renders");
        assert_eq!(
            &BASE64_STANDARD.decode(struct_plate).expect("base64")[..8],
            b"\x89PNG\r\n\x1a\n"
        );
    }

    /// The exact escaped spelling the phone app's own tests hand `URLSearchParams`
    /// (`apps/remote/src/session.test.ts:24`), pinned here because the two encoders
    /// disagreeing on `:` or `/` would make a pairing link parse as a different host.
    #[test]
    fn a_pairing_origin_escapes_exactly_as_encodeuri_component_does() {
        assert_eq!(
            percent_encode_component("http://10.0.0.5:8766"),
            "http%3A%2F%2F10.0.0.5%3A8766"
        );
        assert_eq!(
            percent_encode_component("https%3A%2F%2Fx"),
            "https%253A%252F%252Fx",
            "an already-escaped value was not escaped again"
        );
        // Letters, digits, `-`, `_`, `.` and `~` keep their spelling; everything else,
        // including the port separator `:`, is escaped — which is what
        // `encodeURIComponent` does and what a browser therefore reads back exactly.
        assert_eq!(percent_encode_component("192.168.1.20"), "192.168.1.20");
        assert_eq!(percent_encode_component("a-b_c.d~e"), "a-b_c.d~e");
        assert_eq!(percent_encode_component("http://x"), "http%3A%2F%2Fx");
        // Non-ASCII goes out as its UTF-8 bytes, one escape per byte, as a browser does.
        assert_eq!(percent_encode_component("é"), "%C3%A9");
    }

    #[test]
    fn a_pairing_link_names_the_daemon_to_dial_and_the_token_to_present() {
        let device = DeviceIdentity::generate("Phone".to_string()).unwrap();
        let pairing = PairingData::new(&device, None).expect("a pairing is built");
        let origin = "http://192.168.1.20:8766";

        let link = pairing.pairing_link(origin).expect("a link is built");
        assert!(
            link.starts_with("http://192.168.1.20:8766/?server="),
            "the link does not open the daemon's own origin: {link}"
        );
        assert!(
            link.contains("server=http%3A%2F%2F192.168.1.20%3A8766"),
            "the `server` parameter is not the escaped origin a browser can read back: {link}"
        );
        // The token is the pairing secret's bearer form, which is what a relay's trust
        // list and the daemon's session store both authenticate — so the link and the
        // credential are the same value decided in one place.
        assert!(
            link.ends_with(&format!("&token={}", pairing.secret_token())),
            "the link carries a token that is not this pairing's: {link}"
        );
        // Surrounding whitespace in a configured origin is not a second origin.
        assert_eq!(
            pairing
                .pairing_link(&format!(" {origin} "))
                .expect("a padded origin is still one"),
            link
        );
    }

    #[test]
    fn a_blank_pairing_origin_is_refused_without_repeating_a_credential() {
        let device = DeviceIdentity::generate("Phone".to_string()).unwrap();
        let pairing = PairingData::new(&device, None).expect("a pairing is built");

        for origin in ["", "   "] {
            let error = pairing
                .pairing_link(origin)
                .expect_err("a blank origin names no daemon");
            let printed = error.to_string();
            assert!(
                printed.contains("origin"),
                "the refusal did not say what was missing: {printed}"
            );
            assert!(
                !printed.contains(&pairing.secret_token()),
                "the refusal carried the pairing's bearer token"
            );
        }
    }

    #[test]
    fn an_offer_advertises_the_origin_it_was_minted_at_and_a_plate_that_matches() {
        let device = DeviceIdentity::generate("Phone".to_string()).unwrap();
        let origin = "http://127.0.0.1:8766";
        let offer = PairingOffer::new(&device, origin, None, true)
            .expect("an offer mints at a real origin");

        assert_eq!(offer.server_origin, origin);
        assert!(offer.loopback_only, "the loopback caveat was not carried");
        assert_eq!(offer.pairing.device_id, device.device_id);
        assert_eq!(offer.pairing.static_public, device.static_public);
        assert!(offer.pairing.relay_url.is_none());
        assert_eq!(
            offer
                .pairing
                .pairing_link(&offer.server_origin)
                .expect("the offer's own origin is usable"),
            offer.pairing_link,
            "the plate and the link are two different values"
        );
        assert!(
            qr_code_png_base64(&offer.pairing_link)
                .expect("the link is short enough to plate")
                .len()
                > 100,
            "the plate is not an image"
        );
        // The expiry is the pairing's, so the offer cannot claim longer life than the
        // credential it carries.
        assert_eq!(offer.expires_at(), offer.pairing.expires_at);
        assert!(offer.expires_at() > Utc::now());
    }

    /// Audit N-1 extended to the type that *renders* the plate: the offer is the value
    /// most likely to be `debug!`-printed in a pairing screen, and its link is the same
    /// bearer credential the plate carries in one readable line.
    #[test]
    fn no_printable_form_of_a_pairing_offer_carries_its_link_or_its_secret() {
        let device = DeviceIdentity::generate("Phone".to_string()).unwrap();
        let offer = PairingOffer::new(&device, "http://10.0.0.5:8766", None, false)
            .expect("an offer mints");
        let token = offer.pairing.secret_token();

        let printed = format!("{offer:?}");
        assert!(
            !printed.contains(&token),
            "an offer's Debug printed the bearer token"
        );
        assert!(
            !printed.contains("token="),
            "an offer's Debug printed the pairing link itself: {printed}"
        );
        assert!(
            !printed.contains(&format!("{:?}", offer.pairing.pairing_secret)),
            "an offer's Debug printed the raw secret bytes"
        );
        assert!(printed.contains("redacted"));
        // What a reader does get: where the daemon is, and whether it is loopback.
        assert!(printed.contains("http://10.0.0.5:8766"));
        assert!(printed.contains("loopback_only"));
    }
}
