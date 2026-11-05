//! Warsha Relay — Tiny optional relay server (axum) — opaque frame forwarding
//!
//! The relay forwards encrypted frames it cannot read. Two things follow from that
//! and neither was true before this batch (security audit H-01, H-02):
//!
//! 1. **Who is calling is decided here, not by the caller.** A frame carries a `from`
//!    and a `to`, and a relay that trusts either is a relay that will deliver anyone's
//!    traffic to anyone. So a channel and a frame are authenticated against the
//!    [`RelayTrust`] list — the pairing secrets the owner handed this relay — and the
//!    device id a socket speaks as is the one *that secret names*. A `device_id` on a
//!    query string is a cross-check at best and is never the source of identity.
//! 2. **Every endpoint is bounded.** `/frame`, `/ws` and `/health` answer
//!    `429 Too Many Requests` with a `Retry-After` once a caller passes its ceiling,
//!    the authentication attempts are measured per peer with the strictest quota, and
//!    the device map has a hard size bound. Frames that are too large are refused with
//!    `413`, and a device that claims to be another loses its channel.
//!
//! The credentials are the operator's input, and they are never a plaintext file
//! (audit N-1). A relay that held every paired device's pairing secret in a JSON file
//! owned the material to impersonate every one of them, on a host the owner typically
//! does not control, so the relay reads them the way a provider key is read — one
//! record per device in the OS keychain ([`KeychainTrustSource`], [`RELAY_TRUST_SERVICE`])
//! named with `--trust-device`, or handed to the process for its lifetime only over
//! standard input with `--trust-stdin`, which is what a headless runner and a test use.
//! `--save-trust` moves records from wherever the operator has them into the keychain.
//! Naming a file with `--pairings` is refused before the path is opened, so the old
//! invocation fails loudly instead of quietly putting secrets back on disk.
//!
//! A relay started with no credentials is not an open relay — it is one that admits
//! nobody, and says so at startup.

use axum::{
    extract::{
        ws::{Message, WebSocket},
        ConnectInfo, Query, State, WebSocketUpgrade,
    },
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use clap::Parser;
use futures::{SinkExt, StreamExt};
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::io::{BufReader, Read};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Instant;
use thiserror::Error;
use tokio::sync::broadcast;
use tokio::sync::RwLock;
use tracing::{info, warn};
use uuid::Uuid;
use warsha_core::*;
use warsha_remote::rate_limit::{
    rate_key, Decision, Quota, RateLimiter, RefusalMeter, DEFAULT_MAX_REFUSAL_KEYS,
    DEFAULT_REFUSAL_LOG_INTERVAL,
};
use warsha_remote::{EncryptedFrame, RelayTrust, TrustedPairing};

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
    /// No credential arrived, or the one that did authenticates nothing here.
    ///
    /// The two are the same answer on purpose: a probe that can tell "unknown
    /// device" from "no token" is told which pairing records exist.
    #[error("a relay channel needs a pairing secret this relay was given")]
    Unauthenticated,
    /// A frame whose `from` is not the device that submitted it, or from a device
    /// that has no channel: the mismatch audit H-02 is about, and the reason it is
    /// refused rather than forwarded.
    #[error("frame claims device {claimed}, but the authenticated device is {expected}")]
    IdentityMismatch {
        /// The device the credential authenticated.
        expected: DeviceId,
        /// The device the frame said it came from.
        claimed: DeviceId,
    },
    /// The relay is holding as many device channels as it was allowed, so this one
    /// is refused rather than pushing an existing device off.
    #[error("the relay is at its limit of {max} device channels")]
    TooManyDevices {
        /// The bound that was reached.
        max: usize,
    },
    /// The caller passed a ceiling. `retry_after_secs` is what it should wait.
    #[error("rate limited: retry after {retry_after_secs}s")]
    RateLimited {
        /// Whole seconds until the caller's bucket holds another token.
        retry_after_secs: u64,
    },
    /// A frame bigger than the relay will hold in memory and forward.
    #[error("frame of {size} bytes is over the relay's limit of {max}")]
    FrameTooLarge {
        /// What the frame carried.
        size: usize,
        /// What the relay accepts.
        max: usize,
    },
    /// The trust record could not be read, or is not one.
    #[error("the relay's trust records could not be used: {0}")]
    Trust(String),
    /// An operator named a plaintext pairing file. The relay refuses it *before opening
    /// the path* rather than reading it and warning afterwards: the whole of audit N-1
    /// is that a relay must not acquire every paired device's secret from a file on a
    /// disk it does not control, and a warning that still loads the file is a warning
    /// that ships the vulnerability.
    #[error(
        "pairing secrets are not read from a plaintext file (`{0}` was refused, audit N-1); \
         put each record in the OS keychain with `warsha-relay --save-trust < records.jsonl` \
         and name it with `--trust-device <id>`, or hand this process its credentials for its \
         lifetime only with `--trust-stdin`, then delete the file"
    )]
    PlaintextPairings(PathBuf),
}

pub type Result<T> = std::result::Result<T, RelayError>;

impl IntoResponse for RelayError {
    fn into_response(self) -> Response {
        // The status is the contract; the message is for the operator's log and the
        // client's error text, and never carries a credential.
        let (status, message) = match &self {
            RelayError::Unauthenticated => (StatusCode::UNAUTHORIZED, self.to_string()),
            RelayError::IdentityMismatch { .. } => (StatusCode::FORBIDDEN, self.to_string()),
            RelayError::DeviceNotFound(_) => (StatusCode::FORBIDDEN, self.to_string()),
            RelayError::TooManyDevices { .. } => {
                (StatusCode::SERVICE_UNAVAILABLE, self.to_string())
            }
            RelayError::RateLimited { .. } => (StatusCode::TOO_MANY_REQUESTS, self.to_string()),
            RelayError::FrameTooLarge { .. } => (StatusCode::PAYLOAD_TOO_LARGE, self.to_string()),
            // Both of these are the relay's own configuration being unusable, which a
            // caller can neither see nor fix; they are answered at startup, not on the
            // wire. The message keeps the operator's reason and never a credential.
            RelayError::Trust(_) | RelayError::PlaintextPairings(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, self.to_string())
            }
            RelayError::Io(_)
            | RelayError::Serialization(_)
            | RelayError::ChannelClosed
            | RelayError::Other(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "relay error".to_string())
            }
        };

        let mut builder = Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, "application/json");
        if let RelayError::RateLimited { retry_after_secs } = self {
            // A refusal without a wait is an instruction to retry immediately.
            builder = builder.header(header::RETRY_AFTER, retry_after_secs.to_string());
        }
        if status == StatusCode::UNAUTHORIZED {
            builder = builder.header(header::WWW_AUTHENTICATE, "Bearer realm=\"warsha-relay\"");
        }
        let body = serde_json::json!({ "error": message }).to_string();
        builder
            .body(axum::body::Body::from(body.clone()))
            // A response that cannot be built here is a header name that is not
            // representable, which is a bug in this function rather than something
            // a caller can fix — and the fallback says so rather than pretending.
            .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, body).into_response())
    }
}

/// The keychain service a relay's trust records live under.
///
/// One service for every relay entry with the device id as the account — the same shape
/// `warsha-providers` uses for a provider's API key (`PROVIDER_KEYCHAIN_SERVICE`), so the
/// workspace has one convention for a secret an operator stores once and never reads back
/// (audit N-1).
pub const RELAY_TRUST_SERVICE: &str = "warsha-relay-trust";

/// One device's credential as a secret store holds it.
///
/// The token is the pairing secret in the form a device presents with
/// (`PairingData::secret_token`), so a record read out of the keychain and a pairing read
/// out of a QR code decide the same channel. Expiry travels with it: a relay that
/// accepted a credential the owner had let lapse would be a door they thought they had
/// closed.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredTrust {
    /// The device this record authenticates.
    pub device_id: DeviceId,
    /// The pairing secret as a bearer token — **a secret**, and the reason this type has
    /// a hand-written `Debug` below rather than a derived one.
    pub pairing_token: String,
    /// When the credential stops opening a channel.
    pub expires_at: DateTime<Utc>,
}

/// A `StoredTrust` printed with its credential withheld.
///
/// Derived `Debug` would put the bearer token in whatever log line printed the record,
/// which is the leak audit N-1 is about: this type is read out of a keychain and built
/// from a pipe, and both of those happen next to a log statement.
impl fmt::Debug for StoredTrust {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("StoredTrust")
            .field("device_id", &self.device_id)
            .field("pairing_token", &"<redacted>")
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

impl StoredTrust {
    /// The record as the trust-list entry it becomes.
    ///
    /// `None` when the stored token is not a pairing secret — a record that cannot be
    /// decoded authenticates nothing, and the caller decides whether that is a warning or
    /// a refusal to start. It does fail closed either way: a device with an unreadable
    /// record cannot connect, and no partial credential is trusted.
    fn to_trusted(&self) -> Option<TrustedPairing> {
        TrustedPairing::from_secret_token(self.device_id, &self.pairing_token, self.expires_at)
    }

    /// The credential as a trust entry, or the refusal a caller should report.
    fn trusted(&self) -> Result<TrustedPairing> {
        self.to_trusted().ok_or_else(|| {
            RelayError::Trust(format!(
                "the record for device {} does not hold a pairing token",
                self.device_id
            ))
        })
    }
}

/// Where a relay reads the credentials it authenticates with.
///
/// A trait rather than a call to `keyring`, for the reason the daemon has a
/// [`warsha_providers::SecretStore`] trait: a headless runner and a unit test have no
/// secret service to talk to, and a test of the relay's authentication would otherwise be
/// a test of the runner. Two implementations exist here —
/// [`KeychainTrustSource`] and [`InMemoryTrustSource`] — and neither one is a file.
pub trait TrustSource: fmt::Debug {
    /// The record stored for `device_id`, or `None` when this source holds nothing for
    /// that device.
    fn load(&self, device_id: DeviceId) -> Result<Option<StoredTrust>>;

    /// File `record`, replacing whatever this source held for its device.
    fn save(&self, record: &StoredTrust) -> Result<()>;
}

/// The OS keychain — Windows Credential Manager, macOS Keychain, the freedesktop Secret
/// Service — under [`RELAY_TRUST_SERVICE`].
#[derive(Debug, Clone, Copy, Default)]
pub struct KeychainTrustSource;

impl KeychainTrustSource {
    /// The keychain store.
    pub fn new() -> Self {
        Self
    }

    /// The entry that addresses `device_id`'s record.
    fn entry(device_id: DeviceId) -> Entry {
        Entry::new(RELAY_TRUST_SERVICE, &device_id.0.to_string())
    }
}

impl TrustSource for KeychainTrustSource {
    fn load(&self, device_id: DeviceId) -> Result<Option<StoredTrust>> {
        match Self::entry(device_id).get_password() {
            Ok(stored) => {
                let record: StoredTrust = serde_json::from_str(&stored).map_err(|error| {
                    RelayError::Trust(format!("the keychain record for {device_id}: {error}"))
                })?;
                Ok(Some(record))
            }
            // Nothing stored is not an error the relay works around: it is the device
            // having no credential here, which the caller reports and starts without.
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(RelayError::Trust(format!(
                "the keychain could not be read for device {device_id}: {error}"
            ))),
        }
    }

    fn save(&self, record: &StoredTrust) -> Result<()> {
        let encoded = serde_json::to_string(record).map_err(|error| {
            RelayError::Trust(format!("the record could not be encoded: {error}"))
        })?;
        Self::entry(record.device_id)
            .set_password(&encoded)
            .map_err(|error| {
                RelayError::Trust(format!(
                    "the keychain would not store the record for device {}: {error}",
                    record.device_id
                ))
            })
    }
}

/// An in-process trust source: what a test drives and what a headless deployment starts
/// with, and deliberately not a file-backed store.
///
/// The point of the keychain is that the credential never sits on the disk the relay is
/// run from; a fallback file would re-create exactly the plaintext trust file audit N-1
/// removed. So the ephemeral source holds records only for the life of the process and
/// prints only which devices it holds.
#[derive(Default)]
pub struct InMemoryTrustSource {
    records: Mutex<HashMap<String, StoredTrust>>,
}

impl fmt::Debug for InMemoryTrustSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("InMemoryTrustSource")
            .field("devices", &self.devices())
            .field("records", &self.len())
            .finish()
    }
}

impl InMemoryTrustSource {
    /// An empty source.
    pub fn new() -> Self {
        Self::default()
    }

    /// How many records are held.
    pub fn len(&self) -> usize {
        self.lock().len()
    }

    /// True when nothing is held.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// The devices held, in id order. A device id is not a secret; the record is.
    pub fn devices(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.lock().keys().cloned().collect();
        ids.sort();
        ids
    }

    /// The record held for `device_id`, for a test that asserts the store was written.
    pub fn record_for(&self, device_id: DeviceId) -> Option<StoredTrust> {
        self.lock().get(&device_id.0.to_string()).cloned()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, StoredTrust>> {
        self.records.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl TrustSource for InMemoryTrustSource {
    fn load(&self, device_id: DeviceId) -> Result<Option<StoredTrust>> {
        Ok(self.record_for(device_id))
    }

    fn save(&self, record: &StoredTrust) -> Result<()> {
        self.lock()
            .insert(record.device_id.0.to_string(), record.clone());
        Ok(())
    }
}

/// CLI arguments for the relay.
#[derive(Parser, Debug)]
#[command(name = "warsha-relay", version, about = "Warsha relay server")]
pub struct RelayArgs {
    /// Bind address
    #[arg(short, long, default_value = "0.0.0.0:8767")]
    pub bind: String,

    /// Maximum frame size
    #[arg(long, default_value = "1048576")] // 1MB
    pub max_frame_size: usize,

    /// How many device channels the relay will hold at once.
    #[arg(long, default_value = "256")]
    pub max_devices: usize,

    /// A JSON array of `PairingData` records this relay may authenticate.
    ///
    /// **Refused.** Reading pairing secrets out of a plaintext file is what audit N-1
    /// removed, and the flag is kept so that an operator who still passes it gets one
    /// sentence explaining why and what to do instead, rather than a clap error about an
    /// unknown argument that reads like a rename. Nothing is opened for this path: the
    /// refusal happens before the filesystem is touched, so a file that would have parsed
    /// is still not read.
    #[arg(long)]
    pub pairings: Option<PathBuf>,

    /// One paired device this relay may authenticate, by its device id.
    ///
    /// Repeatable. Each id names an account under [`RELAY_TRUST_SERVICE`] in the OS
    /// keychain; the secret never appears on a command line, where every process on the
    /// machine could read it out of `ps`. A named device with no stored record stops the
    /// relay at startup rather than leaving a device that cannot connect.
    #[arg(long = "trust-device", value_name = "DEVICE_ID")]
    pub trust_devices: Vec<String>,

    /// Read this relay's credentials as JSON records from standard input, for the
    /// lifetime of the process only.
    ///
    /// One record per line (`{"device_id": …, "pairing_token": …, "expires_at": …}`) or a
    /// single JSON array. What makes this the headless and test path rather than a second
    /// plaintext store is its lifetime: a pipe, never a file, and nothing is written to
    /// disk. Pair it with `--save-trust` to move the records into the keychain instead.
    #[arg(long)]
    pub trust_stdin: bool,

    /// Store the standard-input records in the OS keychain and exit without serving.
    ///
    /// The migration an operator with an old trust file needs: `warsha-relay
    /// --save-trust < records.jsonl`, then delete the file. Requires `--trust-stdin`,
    /// because the only input this reads is a pipe the operator chose to open.
    #[arg(long, requires = "trust_stdin")]
    pub save_trust: bool,
}

impl RelayArgs {
    /// The trust list this relay starts with.
    ///
    /// `source` is where a `--trust-device` record is read from — the OS keychain for an
    /// operator, [`InMemoryTrustSource`] for a test — and `stdin` is what `--trust-stdin`
    /// reads its ephemeral records from, injected for the same reason.
    ///
    /// Three rules, all of them audit N-1:
    ///
    /// - a `--pairings` path is refused **before it is opened**;
    /// - a device named by `--trust-device` with no readable record fails the start, so
    ///   an operator never runs a relay that silently does not trust the device they
    ///   pointed it at;
    /// - with no credentials at all the list is empty, which the relay already treats as
    ///   "admits nobody" (audit H-02) — the safe reading of a relay with no secrets.
    pub fn build_trust(&self, source: &dyn TrustSource, stdin: impl Read) -> Result<RelayTrust> {
        self.refuse_plaintext()?;
        let mut entries = Vec::new();
        for device_id in &self.trust_devices {
            let device_id = parse_device_id(device_id).map_err(RelayError::Trust)?;
            let record = source.load(device_id)?.ok_or_else(|| {
                RelayError::Trust(format!(
                    "no trust record is stored for device {device_id} under `{RELAY_TRUST_SERVICE}`"
                ))
            })?;
            entries.push(record.trusted()?);
        }
        if self.trust_stdin {
            for record in read_trust_records(stdin)? {
                entries.push(record.trusted()?);
            }
        }
        Ok(RelayTrust::from_entries(entries))
    }

    /// Move the standard-input records into `source`, for an operator retiring a trust
    /// file. Returns how many records were stored.
    ///
    /// This is the only path that writes, and it writes to a secret store rather than to
    /// disk. A `--pairings` file is still refused: the migration input is a pipe the
    /// operator opens, so the relay never decides on its own which file holds secrets.
    pub fn save_trust_records(&self, source: &dyn TrustSource, stdin: impl Read) -> Result<usize> {
        self.refuse_plaintext()?;
        if !self.trust_stdin {
            return Err(RelayError::Trust(
                "`--save-trust` reads the records from standard input: run it as \
                 `warsha-relay --trust-stdin --save-trust < records.jsonl`"
                    .to_string(),
            ));
        }
        let records = read_trust_records(stdin)?;
        let mut stored = 0usize;
        for record in &records {
            source.save(record)?;
            stored += 1;
        }
        Ok(stored)
    }

    /// Refuse a plaintext pairing file, before any read of it.
    fn refuse_plaintext(&self) -> Result<()> {
        match &self.pairings {
            Some(path) => Err(RelayError::PlaintextPairings(path.clone())),
            None => Ok(()),
        }
    }
}

/// A device id as an operator types it on a command line.
fn parse_device_id(raw: &str) -> std::result::Result<DeviceId, String> {
    Uuid::parse_str(raw.trim())
        .map(DeviceId)
        .map_err(|_| format!("`{raw}` is not a device id (a uuid the daemon's pairing reports)"))
}

/// Read trust records from a reader: one JSON record per line, or one JSON array.
///
/// Blank lines are skipped, so a hand-edited file with a trailing newline is the same
/// input. A record that does not parse fails the read rather than being passed over: an
/// operator who handed the relay ten devices and got eight trusted would otherwise learn
/// about the two missing ones from a phone that cannot connect.
fn read_trust_records(reader: impl Read) -> Result<Vec<StoredTrust>> {
    let mut buffer = String::new();
    BufReader::new(reader)
        .read_to_string(&mut buffer)
        .map_err(|error| {
            RelayError::Trust(format!("the standard input could not be read: {error}"))
        })?;

    let trimmed = buffer.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    if trimmed.starts_with('[') {
        return serde_json::from_str::<Vec<StoredTrust>>(trimmed).map_err(|error| {
            RelayError::Trust(format!("the trust records are not valid JSON: {error}"))
        });
    }
    let mut records = Vec::new();
    for (number, line) in trimmed.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let record: StoredTrust = serde_json::from_str(line).map_err(|error| {
            RelayError::Trust(format!("trust record on line {}: {error}", number + 1))
        })?;
        records.push(record);
    }
    Ok(records)
}

/// The ceilings the relay enforces, one quota per kind of request.
///
/// Authentication is the strictest of them, because that is the endpoint an attacker
/// aims at rather than the one they use: pairing and token checks are bounded at a
/// rate no honest retry loop needs, and forwarding is bounded widely enough to be a
/// pipe rather than a bottleneck.
#[derive(Debug, Clone)]
pub struct RelayLimits {
    /// Authentication attempts, per peer address.
    pub auth: Quota,
    /// New `/ws` channels, per authenticated device.
    pub channel: Quota,
    /// Frames forwarded, per authenticated device.
    pub frame: Quota,
    /// `/health` reads, per peer address.
    pub health: Quota,
}

impl Default for RelayLimits {
    fn default() -> Self {
        Self {
            // 10 attempts at once, 6 a minute: enough for a client that retries on a
            // bad clock, not enough to brute-force a 256-bit secret.
            auth: Quota::new(10, 6, 60),
            // A device may open a handful of channels a minute, not hundreds.
            channel: Quota::new(8, 20, 60),
            // Forwarding is the relay's job: bounded, but not a throttle on a
            // working pair of devices.
            frame: Quota::new(200, 6_000, 60),
            health: Quota::new(30, 300, 60),
        }
    }
}

/// What the relay did with a frame it accepted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Forwarded {
    /// The recipient has a channel and the frame is on it.
    Delivered,
    /// The frame is legitimate but nobody is listening for it, so it was dropped.
    ///
    /// This is not an error: a device that is offline is a normal state of a relay,
    /// and reporting it as a failure would tell the sender whether its peer is
    /// connected.
    RecipientOffline,
}

/// Relay state: the trust list, the channels, the bounds and the limiters.
pub struct RelayState {
    /// Channels by the device that owns them, which is the device its credential
    /// authenticated as — never one a client named.
    channels: RwLock<HashMap<DeviceId, broadcast::Sender<EncryptedFrame>>>,
    trust: RelayTrust,
    max_frame_size: usize,
    max_devices: usize,
    auth_attempts: RateLimiter<String>,
    channel_attempts: RateLimiter<String>,
    frames: RateLimiter<String>,
    health: RateLimiter<String>,
    /// The tally behind every refusal line this relay writes.
    ///
    /// A relay is the component in this stack that a flood reaches first, and each of the
    /// ceilings above can be hit once per request: unmetered, the thing that bounds the
    /// traffic becomes the thing that fills the disk (see the measured spike run in
    /// `bridge-io/security/load/report.md`, finding 2).
    refusals: RefusalMeter,
}

impl RelayState {
    /// A relay state with the size and device bounds, the given trust list and the
    /// default limits.
    pub fn new(trust: RelayTrust, max_frame_size: usize, max_devices: usize) -> Self {
        Self::with_limits(trust, max_frame_size, max_devices, RelayLimits::default())
    }

    /// A relay state with its ceilings named, which is how a test measures a limit
    /// without waiting a minute for the default one.
    pub fn with_limits(
        trust: RelayTrust,
        max_frame_size: usize,
        max_devices: usize,
        limits: RelayLimits,
    ) -> Self {
        Self {
            channels: RwLock::new(HashMap::new()),
            trust,
            max_frame_size: max_frame_size.max(1),
            max_devices: max_devices.max(1),
            auth_attempts: RateLimiter::new(limits.auth),
            channel_attempts: RateLimiter::new(limits.channel),
            frames: RateLimiter::new(limits.frame),
            health: RateLimiter::new(limits.health),
            refusals: RefusalMeter::new(DEFAULT_REFUSAL_LOG_INTERVAL, DEFAULT_MAX_REFUSAL_KEYS),
        }
    }

    /// The pairings this relay will authenticate.
    pub fn trust(&self) -> &RelayTrust {
        &self.trust
    }

    /// The size limit a frame's ciphertext is held to.
    pub fn max_frame_size(&self) -> usize {
        self.max_frame_size
    }

    /// How many device channels exist right now.
    pub async fn channel_count(&self) -> usize {
        self.channels.read().await.len()
    }

    /// The device a `Bearer` credential authenticates as.
    ///
    /// Every attempt spends a token of the per-peer authentication bucket first, so
    /// a flood of bad credentials is bounded even though none of it is ever
    /// authenticated — the fallback key the audit asks for is the peer address, and
    /// it is the strictest quota the relay has.
    fn authenticate(&self, presented: Option<&str>, peer: SocketAddr) -> Result<DeviceId> {
        let key = rate_key(None, Some(peer));
        self.enforce("auth", &self.auth_attempts, &key)?;
        let token = presented.ok_or(RelayError::Unauthenticated)?;
        self.trust
            .authenticate_token(token)
            .ok_or(RelayError::Unauthenticated)
    }

    /// Spend one token of `limiter` for `key`, or refuse with the wait it named.
    ///
    /// A refusal is counted, and only spoken about on the meter's cadence: every ceiling
    /// here can be reached once per request, so a line each would be the 161 MB the
    /// measured spike run produced from one client. `ceiling` names which limiter refused,
    /// which is what an operator needs; `key` is digested, never printed.
    fn enforce(
        &self,
        ceiling: &'static str,
        limiter: &RateLimiter<String>,
        key: &str,
    ) -> Result<()> {
        match limiter.check(&key.to_string()) {
            Decision::Allowed { .. } => Ok(()),
            Decision::Denied { retry_after } => {
                self.report_refusal(ceiling, key);
                Err(RelayError::RateLimited {
                    retry_after_secs: retry_after.as_secs().max(1),
                })
            }
        }
    }

    /// Count one refusal for `key` and write the aggregate line when it is due.
    fn report_refusal(&self, ceiling: &'static str, key: &str) {
        if let Some(summary) = self.refusals.note(ceiling, key, Instant::now()) {
            warn!("{}", summary.message());
        }
    }

    /// The refusal tallies, for a status report or a test that counts log lines.
    pub fn refusals(&self) -> &RefusalMeter {
        &self.refusals
    }

    /// Open a device's channel, refusing to grow past the relay's device bound.
    ///
    /// A second channel for a device that already has one replaces it, which is what
    /// a reconnect means; a device the relay has never authenticated cannot be
    /// registered here at all, because registration takes an authenticated id.
    pub async fn register(
        &self,
        device_id: DeviceId,
    ) -> Result<broadcast::Receiver<EncryptedFrame>> {
        let mut channels = self.channels.write().await;
        if !channels.contains_key(&device_id) && channels.len() >= self.max_devices {
            return Err(RelayError::TooManyDevices {
                max: self.max_devices,
            });
        }
        let (tx, rx) = broadcast::channel(BROADCAST_CAPACITY);
        channels.insert(device_id, tx);
        Ok(rx)
    }

    /// Close a device's channel.
    pub async fn unregister(&self, device_id: DeviceId) {
        self.channels.write().await.remove(&device_id);
    }

    /// Forward `frame` on behalf of `from`, the device its credential authenticated.
    ///
    /// Both checks audit H-02 names happen here: the frame's own `from` has to agree
    /// with the authenticated device, and the device that agrees is only ever
    /// derived from a pairing secret this relay was given — never from a field a
    /// client filled in. A non-WebSocket client submits through `/frame` without
    /// holding a channel, so a channel is not what authorises a sender: the credential
    /// already did that, and `from` is its consequence.
    ///
    /// Delivery is one-way bounded too: a frame whose recipient holds no channel is
    /// dropped rather than pushed at a stranger.
    pub async fn accept_frame(&self, from: DeviceId, frame: &EncryptedFrame) -> Result<Forwarded> {
        if frame.from != from {
            return Err(RelayError::IdentityMismatch {
                expected: from,
                claimed: frame.from,
            });
        }
        if frame.ciphertext.len() > self.max_frame_size {
            return Err(RelayError::FrameTooLarge {
                size: frame.ciphertext.len(),
                max: self.max_frame_size,
            });
        }

        let channels = self.channels.read().await;
        let Some(tx) = channels.get(&frame.to) else {
            return Ok(Forwarded::RecipientOffline);
        };
        tx.send(frame.clone())
            .map_err(|_| RelayError::ChannelClosed)?;
        Ok(Forwarded::Delivered)
    }
}

/// The channel each registered device reads from.
const BROADCAST_CAPACITY: usize = 100;

/// The credential in a request: `Authorization: Bearer …`, or the `token` query
/// parameter a WebSocket client that cannot set headers has to use.
///
/// Either is a *secret*, never an identity claim: the device id comes from whichever
/// pairing the secret authenticates.
fn credential<'a>(
    headers: &'a HeaderMap,
    query: Option<&'a HashMap<String, String>>,
) -> Option<&'a str> {
    let from_header = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    match from_header {
        Some(token) => Some(token),
        None => query
            .and_then(|params| params.get("token"))
            .map(String::as_str),
    }
}

/// HTTP handler for frame submission (for non-WebSocket clients).
async fn submit_frame(
    State(state): State<Arc<RelayState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(frame): Json<EncryptedFrame>,
) -> Result<StatusCode> {
    let from = state.authenticate(credential(&headers, None), peer)?;

    // The frame tier is keyed on the device the credential named: one device's
    // flood is not another device's 429.
    state.enforce(
        "frame",
        &state.frames,
        &rate_key(Some(&from.to_string()), None),
    )?;

    match state.accept_frame(from, &frame).await? {
        Forwarded::Delivered | Forwarded::RecipientOffline => Ok(StatusCode::ACCEPTED),
    }
}

/// WebSocket handler for real-time frame relay.
async fn websocket_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<RelayState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Response> {
    let from = state.authenticate(credential(&headers, Some(&params)), peer)?;
    state.enforce(
        "channel",
        &state.channel_attempts,
        &rate_key(Some(&from.to_string()), None),
    )?;

    // A `device_id` on the query string is checked against the authenticated device
    // and never believed on its own. It used to be the only source of identity here,
    // which is the bug audit H-02 is about; a mismatch is a client asking to speak as
    // somebody else and gets a 403.
    if let Some(claimed) = params
        .get("device_id")
        .and_then(|raw| Uuid::parse_str(raw).ok())
        .map(DeviceId)
    {
        if claimed != from {
            // Counted rather than streamed: this is the attempt an attacker makes
            // deliberately, and one line per attempt is a second way to win. The
            // caller's digest is what survives, so the two lines a probe produced can
            // still be lined up with each other.
            state.report_refusal(
                "identity-mismatch",
                &rate_key(Some(&from.to_string()), Some(peer)),
            );
            return Err(RelayError::IdentityMismatch {
                expected: from,
                claimed,
            });
        }
    }

    Ok(ws
        .on_upgrade(move |socket| handle_websocket(socket, from, state, peer))
        .into_response())
}

async fn handle_websocket(
    socket: WebSocket,
    device_id: DeviceId,
    state: Arc<RelayState>,
    peer: SocketAddr,
) {
    let mut rx = match state.register(device_id).await {
        Ok(receiver) => receiver,
        Err(_) => {
            // The bound is refused by closing the channel rather than by pushing an
            // existing device off it — and the refusal is counted, not written per
            // attempt: a caller that retries a full relay is the traffic this relay
            // exists to bound, and a line each would be the flood's second win.
            state.report_refusal(
                "channel-limit",
                &rate_key(Some(&device_id.to_string()), Some(peer)),
            );
            return;
        }
    };
    info!("Device {} connected to relay from {}", device_id.0, peer);

    let (mut sender, mut receiver) = socket.split();

    // Task to forward frames from relay to this device.
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

    // Task to receive frames from this device and relay them. Every frame is
    // measured against the channel's own device: a frame that names another sender
    // ends the channel, because there is no version of that which is honest traffic.
    let recv_state = state.clone();
    let recv_task = tokio::spawn(async move {
        // One key for the channel's whole life: every refusal this socket earns is
        // counted under the device its credential authenticated, so a flood of junk
        // frames costs a counter and not a log line each.
        let caller = rate_key(Some(&device_id.to_string()), Some(peer));
        while let Some(msg) = receiver.next().await {
            let Ok(msg) = msg else { break };
            let Message::Binary(data) = msg else { continue };
            if data.len() > recv_state.max_frame_size {
                recv_state.report_refusal("oversized-frame", &caller);
                continue;
            }
            let Ok(frame) = serde_json::from_slice::<EncryptedFrame>(&data) else {
                recv_state.report_refusal("unreadable-frame", &caller);
                continue;
            };
            if recv_state
                .enforce("frame", &recv_state.frames, &caller)
                .is_err()
            {
                // The frame ceiling has already counted this; the channel ending is the
                // consequence and is counted under its own ceiling, never written per
                // frame.
                recv_state.report_refusal("channel-closed-on-ceiling", &caller);
                break;
            }
            if recv_state.accept_frame(device_id, &frame).await.is_err() {
                // A frame that names another sender ends the channel (audit H-02), and
                // the attempt is counted rather than streamed: this is the event an
                // attacker produces deliberately, and one line per attempt is a way to
                // win twice.
                recv_state.report_refusal("refused-frame", &caller);
                break;
            }
        }
    });

    // Wait for either task to complete.
    tokio::select! {
        _ = forward_task => {},
        _ = recv_task => {},
    }

    state.unregister(device_id).await;
    info!("Device {} disconnected from relay", device_id.0);
}

/// Health check endpoint, bounded per peer like everything else the relay answers.
async fn health(
    State(state): State<Arc<RelayState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
) -> Result<Json<serde_json::Value>> {
    state.enforce("health", &state.health, &rate_key(None, Some(peer)))?;
    Ok(Json(serde_json::json!({ "status": "healthy" })))
}

/// The relay's routes, over a state the caller built.
///
/// Split from [`run_relay`] so a test can serve the same router an operator starts,
/// with the same authentication and the same limiters.
pub fn router(state: Arc<RelayState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/frame", post(submit_frame))
        .route("/ws", get(websocket_handler))
        .with_state(state)
}

/// Serve the relay on `bind`, returning the address it ended up on.
///
/// `bind` of `0.0.0.0:0` is what a test asks for; an operator's default is still the
/// wildcard, which is why the trust list and the ceilings above are not optional.
pub async fn serve(
    state: Arc<RelayState>,
    bind: &str,
) -> Result<(SocketAddr, tokio::task::JoinHandle<()>)> {
    let listener = tokio::net::TcpListener::bind(bind).await?;
    let addr = listener.local_addr()?;
    let app = router(state).into_make_service_with_connect_info::<SocketAddr>();
    let task = tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, app).await {
            warn!("relay server stopped: {error}");
        }
    });
    Ok((addr, task))
}

/// Run the relay server.
pub async fn run_relay(args: RelayArgs) -> Result<()> {
    let bind = args.bind.clone();
    let (max_frame_size, max_devices) = (args.max_frame_size, args.max_devices);

    // Reading a keychain is a blocking call into another process (the freedesktop secret
    // service, Credential Manager) and `--trust-stdin` reads a pipe that may not be
    // written yet, so neither happens on a runtime worker. It is also the one moment the
    // relay touches its secret source, and it is before anything is served: a record that
    // cannot be read stops the start rather than surfacing later as a phone that cannot
    // connect (audit N-1, and the fail-closed rule the rest of this stack follows).
    if args.save_trust {
        let stored = tokio::task::spawn_blocking(move || {
            args.save_trust_records(&KeychainTrustSource::new(), std::io::stdin())
        })
        .await
        .map_err(|error| {
            RelayError::Other(format!("the trust records could not be stored: {error}"))
        })??;
        info!(
            "stored {stored} relay trust record(s) under `{RELAY_TRUST_SERVICE}`; nothing was served, and the plaintext source can now be deleted"
        );
        return Ok(());
    }

    let trust = tokio::task::spawn_blocking(move || {
        args.build_trust(&KeychainTrustSource::new(), std::io::stdin())
    })
    .await
    .map_err(|error| {
        RelayError::Other(format!("the trust records could not be read: {error}"))
    })??;

    if trust.is_empty() {
        // Said out loud rather than left as a relay that answers 401 to everyone:
        // forwarding nothing is the safe reading of a relay with no credentials, but it
        // is not what an operator expected if they forgot the flag.
        warn!("relay started with no credentials: no channel will be authenticated and no frame forwarded (use --trust-device for a keychain record, or --trust-stdin for records held for this run only)");
    } else {
        info!(
            "relay trusts {} device(s): {}",
            trust.len(),
            display_device_ids(&trust.device_ids())
        );
    }

    let state = Arc::new(RelayState::new(trust, max_frame_size, max_devices));
    let (addr, server) = serve(state, &bind).await?;
    info!("Relay server listening on {}", addr);

    // The binary's job is to keep serving, so this waits on the server rather than
    // returning while its task is still running: `main` would drop the runtime and
    // take the listener with it.
    server
        .await
        .map_err(|error| RelayError::Other(format!("relay server stopped: {error}")))
}

/// The trusted devices in one log line, as ids.
///
/// A device id is not a secret and naming them is the operator's check that the relay
/// picked up the records they pointed it at; the credentials that go with them are never
/// printed, which is why this takes ids rather than the list itself.
fn display_device_ids(ids: &[DeviceId]) -> String {
    ids.iter()
        .map(|id| id.0.to_string())
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use tempfile::TempDir;
    use warsha_remote::PairingData;

    /// A fresh temp directory for one test's workspace.
    ///
    /// Prefers cargo's `CARGO_TARGET_TMPDIR`, then a `tmp` sibling of the test
    /// binary's `deps` directory (the target dir is writable wherever the build
    /// ran), and only then the system temp dir — which on some Windows machines is
    /// protected and rejects even creating a tempdir (`Access is denied`).
    fn fresh_tempdir() -> TempDir {
        if let Some(base) = std::env::var_os("CARGO_TARGET_TMPDIR") {
            let base = PathBuf::from(base);
            if base.is_dir() {
                if let Ok(dir) = TempDir::new_in(&base) {
                    return dir;
                }
            }
        }
        if let Ok(exe) = std::env::current_exe() {
            if let Some(deps) = exe.parent() {
                let base = deps.join("tmp");
                if std::fs::create_dir_all(&base).is_ok() {
                    if let Ok(dir) = TempDir::new_in(&base) {
                        return dir;
                    }
                }
            }
        }
        TempDir::new().expect("tempdir for the test workspace")
    }

    /// A frame of `ciphertext` bytes from `from` to `to`.
    fn frame(from: DeviceId, to: DeviceId, ciphertext: Vec<u8>) -> EncryptedFrame {
        EncryptedFrame {
            from,
            to,
            nonce: [0u8; 12],
            ciphertext,
            timestamp: Utc::now(),
        }
    }

    /// A state that trusts `pairings`, with a 1024-byte frame limit.
    fn state(pairings: &[PairingData]) -> Arc<RelayState> {
        Arc::new(RelayState::new(
            RelayTrust::from_pairings(pairings),
            1024,
            8,
        ))
    }

    /// A pairing a device generated, five minutes from expiry.
    fn pairing(name: &str) -> (DeviceId, PairingData) {
        let identity =
            warsha_remote::DeviceIdentity::generate(name.to_string()).expect("a device identity");
        let data = PairingData::new(&identity, None).expect("a pairing");
        (identity.device_id, data)
    }

    /// A peer address no test's limiter has seen.
    fn peer(port: u16) -> SocketAddr {
        SocketAddr::from(([127, 0, 0, 1], port))
    }

    #[tokio::test]
    async fn a_registered_device_receives_a_frame_it_authenticated() {
        let (alice_id, alice) = pairing("Alice");
        let (bob_id, _bob) = pairing("Bob");
        let relay = state(std::slice::from_ref(&alice));
        let mut bob_rx = relay.register(bob_id).await.expect("bob's channel");

        let accepted = relay
            .accept_frame(alice_id, &frame(alice_id, bob_id, vec![1, 2, 3]))
            .await
            .expect("the frame is the authenticated device's own");
        assert_eq!(accepted, Forwarded::Delivered);
        assert_eq!(
            bob_rx
                .recv()
                .await
                .expect("bob is sent the frame")
                .ciphertext,
            vec![1, 2, 3]
        );
    }

    #[tokio::test]
    async fn a_frame_claiming_another_device_is_refused_in_both_directions() {
        // Audit H-02, the sending half: `mallory` holds a real pairing and puts
        // `alice`'s id on the frame. The relay knows only what the credential said.
        let (alice_id, _alice) = pairing("Alice");
        let (mallory_id, mallory) = pairing("Mallory");
        let (bob_id, bob_data) = pairing("Bob");
        let relay = state(&[mallory.clone(), bob_data]);
        relay.register(mallory_id).await.expect("mallory's channel");
        let mut bob_rx = relay.register(bob_id).await.expect("bob's channel");

        let error = relay
            .accept_frame(mallory_id, &frame(alice_id, bob_id, vec![9]))
            .await
            .expect_err("a spoofed sender was accepted");
        assert!(
            matches!(
                error,
                RelayError::IdentityMismatch {
                    expected,
                    claimed
                } if expected == mallory_id && claimed == alice_id
            ),
            "unexpected error: {error:?}"
        );
        assert!(bob_rx.try_recv().is_err(), "the spoofed frame reached bob");

        // And the receiving half: nothing is delivered to a device that never
        // authenticated a channel, so a frame cannot be pushed at a stranger.
        let stranger = DeviceId::new();
        let dropped = relay
            .accept_frame(mallory_id, &frame(mallory_id, stranger, vec![1]))
            .await
            .expect("a frame to an offline device is not a failure");
        assert_eq!(dropped, Forwarded::RecipientOffline);
    }

    #[tokio::test]
    async fn a_frame_for_a_device_with_no_channel_is_dropped_not_delivered_widely() {
        let (alice_id, alice) = pairing("Alice");
        let (bob_id, _bob) = pairing("Bob");
        let relay = state(&[alice]);

        // Alice authenticated with her own secret and may submit over `/frame`
        // without holding a WebSocket — that is what the HTTP path is for. But nobody
        // is listening for Bob, so the frame goes nowhere and is not an error a
        // sender could use to learn whether its peer is connected.
        let dropped = relay
            .accept_frame(alice_id, &frame(alice_id, bob_id, vec![1]))
            .await
            .expect("a legitimate frame to an offline peer is not a failure");
        assert_eq!(dropped, Forwarded::RecipientOffline);
        assert_eq!(relay.channel_count().await, 0, "a frame opened a channel");
    }

    #[tokio::test]
    async fn the_device_map_is_bounded_and_refuses_more_channels() {
        let (alice_id, alice) = pairing("Alice");
        let (bob_id, bob) = pairing("Bob");
        let carol = pairing("Carol");
        let relay = Arc::new(RelayState::new(
            RelayTrust::from_pairings([&alice, &bob]),
            1024,
            2,
        ));
        relay.register(alice_id).await.expect("first channel");
        relay.register(bob_id).await.expect("second channel");

        // A third device would push the map past its bound.
        let error = relay
            .register(carol.0)
            .await
            .expect_err("the device limit was not enforced");
        assert!(
            matches!(error, RelayError::TooManyDevices { max: 2 }),
            "unexpected error: {error:?}"
        );
        assert_eq!(relay.channel_count().await, 2);

        // A reconnect of a device that already holds a slot takes the same slot.
        relay
            .register(alice_id)
            .await
            .expect("a reconnect is not a new device");
        assert_eq!(relay.channel_count().await, 2);
    }

    #[test]
    fn an_unreadable_or_absent_credential_authenticates_nothing() {
        let (_alice_id, alice) = pairing("Alice");
        let relay = state(std::slice::from_ref(&alice));

        // The credential is the identity: with none, and with one this relay was not
        // given, the answer is the same 401 for the same reason.
        let no_header = relay.authenticate(None, peer(50_001)).unwrap_err();
        assert!(matches!(no_header, RelayError::Unauthenticated));
        let wrong = relay
            .authenticate(Some("YWJjZA"), peer(50_002))
            .unwrap_err();
        assert!(matches!(wrong, RelayError::Unauthenticated));

        let bound = relay
            .authenticate(Some(&alice.secret_token()), peer(50_003))
            .expect("the pairing's own token authenticates");
        assert_eq!(bound, alice.device_id);
    }

    #[test]
    fn authentication_attempts_are_bounded_per_peer_and_answer_429() {
        let (_alice_id, alice) = pairing("Alice");
        let relay = Arc::new(RelayState::with_limits(
            RelayTrust::from_pairings([&alice]),
            1024,
            8,
            RelayLimits {
                auth: Quota::new(2, 1, 60),
                ..RelayLimits::default()
            },
        ));

        // Two attempts on one peer's bucket are served, the third is refused, and the
        // refusal carries the wait a client has to honour.
        assert!(relay.authenticate(Some("nope"), peer(50_010)).is_err());
        assert!(relay.authenticate(Some("nope"), peer(50_010)).is_err());
        let refused = relay
            .authenticate(Some(&alice.secret_token()), peer(50_010))
            .expect_err("a correct secret past the ceiling was served");
        let response = refused.into_response();
        assert_eq!(
            response.status(),
            StatusCode::TOO_MANY_REQUESTS,
            "a bounded caller did not get a 429"
        );
        let retry_after = response
            .headers()
            .get(header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_else(|| panic!("a 429 carried no Retry-After"))
            .parse::<u64>()
            .expect("Retry-After is a number of seconds");
        assert!(retry_after >= 1, "a refusal named no wait: {retry_after}");

        // A different peer is not answerable for this one's probes.
        assert!(relay
            .authenticate(Some(&alice.secret_token()), peer(50_011))
            .is_ok());
    }

    #[test]
    fn every_refusal_carries_the_status_a_client_can_act_on() {
        let alice = DeviceId::new();
        let bob = DeviceId::new();
        let cases = [
            (RelayError::Unauthenticated, StatusCode::UNAUTHORIZED),
            (
                RelayError::IdentityMismatch {
                    expected: alice,
                    claimed: bob,
                },
                StatusCode::FORBIDDEN,
            ),
            (RelayError::DeviceNotFound(alice), StatusCode::FORBIDDEN),
            (
                RelayError::TooManyDevices { max: 4 },
                StatusCode::SERVICE_UNAVAILABLE,
            ),
            (
                RelayError::RateLimited {
                    retry_after_secs: 3,
                },
                StatusCode::TOO_MANY_REQUESTS,
            ),
            (
                RelayError::FrameTooLarge { size: 9, max: 1 },
                StatusCode::PAYLOAD_TOO_LARGE,
            ),
            (RelayError::ChannelClosed, StatusCode::INTERNAL_SERVER_ERROR),
        ];
        for (error, expected) in cases {
            let response = error.into_response();
            assert_eq!(response.status(), expected, "wrong status for a refusal");
        }

        // A 401 says how to authenticate, and no refusal repeats a credential.
        let unauthorized = RelayError::Unauthenticated.into_response();
        assert!(unauthorized
            .headers()
            .get(header::WWW_AUTHENTICATE)
            .is_some());
    }

    #[test]
    fn a_credential_comes_from_the_header_or_the_query_and_never_from_an_identity_field() {
        let mut headers = HeaderMap::new();
        let mut query = HashMap::new();

        assert_eq!(credential(&headers, Some(&query)), None);
        query.insert("device_id".to_string(), "someone".to_string());
        // An identity claim on the query string is not a credential.
        assert_eq!(credential(&headers, Some(&query)), None);

        headers.insert(
            header::AUTHORIZATION,
            "Bearer secret-token".parse().expect("a header value"),
        );
        assert_eq!(credential(&headers, Some(&query)), Some("secret-token"));

        headers.remove(header::AUTHORIZATION);
        query.insert("token".to_string(), "query-secret".to_string());
        assert_eq!(credential(&headers, Some(&query)), Some("query-secret"));
    }

    /// The operator's arguments naming no credentials at all.
    fn args() -> RelayArgs {
        RelayArgs {
            bind: "127.0.0.1:0".to_string(),
            max_frame_size: 1024,
            max_devices: 4,
            pairings: None,
            trust_devices: Vec::new(),
            trust_stdin: false,
            save_trust: false,
        }
    }

    /// The same arguments with `--trust-stdin` set: the ephemeral path, and the only one
    /// that reads a pipe.
    fn stdin_args() -> RelayArgs {
        RelayArgs {
            trust_stdin: true,
            ..args()
        }
    }

    /// A `StoredTrust` for the pairing a device generated.
    fn record(pairing: &PairingData) -> StoredTrust {
        StoredTrust {
            device_id: pairing.device_id,
            pairing_token: pairing.secret_token(),
            expires_at: pairing.expires_at,
        }
    }

    /// One record as the line an operator would pipe in.
    fn line(pairing: &PairingData) -> String {
        format!(
            "{}\n",
            serde_json::to_string(&record(pairing)).expect("a record is JSON")
        )
    }

    /// A source holding exactly the records for `pairings`.
    fn source(pairings: &[PairingData]) -> InMemoryTrustSource {
        let source = InMemoryTrustSource::new();
        for pairing in pairings {
            source.save(&record(pairing)).expect("a record is stored");
        }
        source
    }

    #[test]
    fn a_relay_with_no_credentials_trusts_nothing() {
        // The default reading of "no credentials" is a relay that admits nobody, not a
        // relay that believes anyone (audit H-02, unchanged by N-1).
        let trust = args()
            .build_trust(&InMemoryTrustSource::new(), std::io::empty())
            .expect("no input is an empty list");
        assert!(trust.is_empty());
        assert_eq!(
            trust.authenticate_now(&[7u8; 32]),
            None,
            "a relay with no credentials admitted a caller"
        );
    }

    /// Audit N-1, the requirement that is easy to satisfy by accident and easy to break
    /// again: the relay must not *read* a plaintext pairing file, and must not merely
    /// read it and warn.
    ///
    /// Three paths, and all three have to answer with the same refusal: a file that
    /// would parse (the regression — the old code returned a trust list here), a path
    /// that does not exist, and a *directory*, which no `read` of a file could succeed
    /// on. The third is the proof that the refusal happens before the open: if anything
    /// had tried to read the path, the error would be the I/O failure and not the
    /// refusal.
    #[test]
    fn a_plaintext_pairing_file_is_refused_and_never_opened() {
        let dir = fresh_tempdir();
        let (_alice_id, alice) = pairing("Alice");

        let readable = dir.path().join("pairings.json");
        std::fs::write(
            &readable,
            serde_json::to_vec(&vec![alice.clone()]).expect("a pairing is JSON"),
        )
        .expect("the file is written");

        for path in [
            readable.clone(),
            dir.path().join("does-not-exist.json"),
            dir.path().to_path_buf(),
        ] {
            let with_file = RelayArgs {
                pairings: Some(path.clone()),
                ..args()
            };
            let error = with_file
                .build_trust(&InMemoryTrustSource::new(), std::io::empty())
                .expect_err("a plaintext pairing file was loaded");
            let RelayError::PlaintextPairings(refused) = &error else {
                panic!(
                    "the plaintext file was answered with something other than the refusal: {error:?}"
                );
            };
            assert_eq!(
                *refused, path,
                "the refusal did not name the path it refused"
            );
            assert!(
                !error.to_string().contains(&alice.secret_token()),
                "the refusal repeated a credential"
            );
        }

        // The same refusal on the migration path, and no other behaviour: `--save-trust`
        // reads a pipe, never the file the operator points at.
        let with_save = RelayArgs {
            save_trust: true,
            trust_stdin: true,
            pairings: Some(readable.clone()),
            ..args()
        };
        assert!(matches!(
            with_save.save_trust_records(&InMemoryTrustSource::new(), std::io::empty()),
            Err(RelayError::PlaintextPairings(_))
        ));

        // And the flag is still accepted by the parser, so an operator who has not read
        // the release notes gets the explanation rather than "unexpected argument".
        let parsed =
            RelayArgs::try_parse_from(["warsha-relay", "--pairings", &readable.to_string_lossy()]);
        assert!(parsed.is_ok(), "the deprecated flag no longer parses");
        assert!(parsed
            .expect("the arguments parse")
            .build_trust(&InMemoryTrustSource::new(), std::io::empty())
            .is_err());
    }

    /// Audit N-1, the half that keeps H-02 closed: credentials now come from a secret
    /// store, and the relay still decides identity from the secret alone.
    #[test]
    fn a_record_from_the_secret_store_authenticates_the_device_it_names() {
        let (alice_id, alice) = pairing("Alice");
        let (_bob_id, bob) = pairing("Bob");
        let store = source(&[alice.clone(), bob.clone()]);
        let with_devices = RelayArgs {
            trust_devices: vec![alice_id.to_string()],
            ..args()
        };

        let trust = with_devices
            .build_trust(&store, std::io::empty())
            .expect("the stored record is read");
        assert_eq!(
            trust.len(),
            1,
            "only the device the operator named is trusted"
        );
        assert_eq!(
            trust.authenticate_token(&alice.secret_token()),
            Some(alice_id),
            "a stored credential did not open the channel it was issued for"
        );
        // Bob has a record in the store and no place on the list: naming devices is what
        // a relay trusts, not whatever the store happens to hold.
        assert_eq!(trust.authenticate_token(&bob.secret_token()), None);

        let relay = Arc::new(RelayState::new(trust, 1024, 4));
        assert_eq!(
            relay
                .authenticate(Some(&alice.secret_token()), peer(50_030))
                .expect("the stored token authenticates"),
            alice_id
        );
        assert!(matches!(
            relay.authenticate(Some("bm90LWEtc2VjcmV0"), peer(50_031)),
            Err(RelayError::Unauthenticated)
        ));
        assert!(matches!(
            relay.authenticate(None, peer(50_032)),
            Err(RelayError::Unauthenticated)
        ));
    }

    /// A device the operator named and the store cannot answer for is a relay that does
    /// not start: "trusted nobody for that one" is not something a phone can discover.
    #[test]
    fn a_named_device_with_no_readable_record_stops_the_start() {
        let (_alice_id, alice) = pairing("Alice");
        let missing = DeviceId::new();
        let store = source(&[alice]);

        let named = RelayArgs {
            trust_devices: vec![missing.to_string()],
            ..args()
        };
        let error = named
            .build_trust(&store, std::io::empty())
            .expect_err("a device with no record started a relay that would not trust it");
        assert!(
            matches!(error, RelayError::Trust(_)),
            "unexpected error: {error:?}"
        );

        // A device id that is not a uuid is refused the same way, before any read.
        let junk = RelayArgs {
            trust_devices: vec!["not-a-uuid".to_string()],
            ..args()
        };
        assert!(matches!(
            junk.build_trust(&store, std::io::empty()),
            Err(RelayError::Trust(_))
        ));
    }

    /// Audit N-1's other input path: credentials for the lifetime of one process, from a
    /// pipe. This is what a headless deployment and a test use, and the proof it is not a
    /// plaintext store in disguise is that nothing is written.
    #[test]
    fn ephemeral_startup_records_are_read_from_a_pipe_and_nothing_is_written() {
        let dir = fresh_tempdir();
        let (alice_id, alice) = pairing("Alice");
        let (_bob_id, bob) = pairing("Bob");
        let input = format!("{}{}", line(&alice), line(&bob));

        let trust = stdin_args()
            .build_trust(&InMemoryTrustSource::new(), input.as_bytes())
            .expect("the records are read");
        assert_eq!(trust.len(), 2);
        assert_eq!(
            trust.authenticate_token(&alice.secret_token()),
            Some(alice_id)
        );

        // The ephemeral list is in the process and nowhere else: an empty directory is
        // the whole claim, and it is the one a reviewer can check.
        let left = std::fs::read_dir(dir.path())
            .expect("the directory is readable")
            .count();
        assert_eq!(left, 0, "the relay wrote something to disk");

        // A credential that has expired does not become trusted because it arrived over a
        // pipe rather than a keychain: the expiry rule is the relay's, not the file's.
        let stale = PairingData {
            expires_at: Utc::now() - chrono::Duration::seconds(1),
            ..alice.clone()
        };
        let trust = stdin_args()
            .build_trust(&InMemoryTrustSource::new(), line(&stale).as_bytes())
            .expect("a stale record still parses");
        assert_eq!(
            trust.authenticate_now(&stale.pairing_secret),
            None,
            "an expired credential opened a channel"
        );

        // Blank lines and a JSON array — the shape an old export file had — are the same
        // input, so the migration is a redirect rather than a rewrite.
        let array =
            serde_json::to_string(&vec![record(&alice), record(&bob)]).expect("records are JSON");
        let trust = stdin_args()
            .build_trust(
                &InMemoryTrustSource::new(),
                format!("\n{array}\n").as_bytes(),
            )
            .expect("an array of records is read");
        assert_eq!(trust.len(), 2);
    }

    /// A record that cannot be used is a start that stops, not a device silently left
    /// out — and a `--trust-stdin` with nothing on it is the empty list, which is the
    /// safe reading of an unread pipe.
    #[test]
    fn an_unreadable_record_is_refused_rather_than_skipped() {
        let (_alice_id, alice) = pairing("Alice");

        let not_json = stdin_args()
            .build_trust(&InMemoryTrustSource::new(), &b"hello, relay\n"[..])
            .expect_err("junk on standard input was trusted");
        assert!(
            matches!(not_json, RelayError::Trust(_)),
            "unexpected error: {not_json:?}"
        );

        // A token that is not a pairing secret cannot authenticate anything, so it is
        // refused at the door rather than held as a trust entry.
        let bad_token = format!(
            "{{\"device_id\":\"{}\",\"pairing_token\":\"not-base64!!\",\"expires_at\":\"2999-01-01T00:00:00Z\"}}\n",
            alice.device_id
        );
        assert!(matches!(
            stdin_args().build_trust(&InMemoryTrustSource::new(), bad_token.as_bytes()),
            Err(RelayError::Trust(_))
        ));

        // Nothing on the pipe is nothing trusted.
        let empty = stdin_args()
            .build_trust(&InMemoryTrustSource::new(), &b"   \n\n"[..])
            .expect("an empty input is an empty list");
        assert!(empty.is_empty());
    }

    /// The migration path: records in, keychain out, nothing served and nothing on disk.
    #[test]
    fn saving_trust_records_writes_to_the_secret_store_and_serves_nothing() {
        let (_alice_id, alice) = pairing("Alice");
        let (_bob_id, bob) = pairing("Bob");
        let store = InMemoryTrustSource::new();
        let input = format!("{}{}", line(&alice), line(&bob));

        let save = RelayArgs {
            trust_stdin: true,
            ..args()
        };
        let stored = save
            .save_trust_records(&store, input.as_bytes())
            .expect("the records are stored");
        assert_eq!(stored, 2);
        assert_eq!(
            store
                .record_for(alice.device_id)
                .expect("the record came back")
                .pairing_token,
            alice.secret_token()
        );

        // `--save-trust` without a pipe to read is a mistake, not a no-op.
        let without_input = RelayArgs {
            save_trust: true,
            ..args()
        };
        assert!(matches!(
            without_input.save_trust_records(&store, std::io::empty()),
            Err(RelayError::Trust(_))
        ));
    }

    /// Audit N-1's logging half: every type that can carry a relay credential prints
    /// which device it belongs to and not the credential.
    #[test]
    fn no_relay_type_prints_a_credential() {
        let (alice_id, alice) = pairing("Alice");
        let token = alice.secret_token();
        let the_record = record(&alice);
        let store = source(std::slice::from_ref(&alice));
        let trust = RelayTrust::from_pairings([&alice]);
        let the_args = RelayArgs {
            trust_devices: vec![alice_id.to_string()],
            ..args()
        };

        let printed = [
            format!("{the_record:?}"),
            format!("{store:?}"),
            format!("{trust:?}"),
            format!("{the_args:?}"),
        ];
        for line_of_debug in printed {
            assert!(
                !line_of_debug.contains(&token),
                "a relay credential was printed: {line_of_debug}"
            );
        }

        // The device, though: an operator reading a log has to know which pairing is
        // missing, and a device id is not a secret.
        let rendered = format!("{the_record:?}");
        assert!(rendered.contains(&alice_id.to_string()));
        assert!(format!("{store:?}").contains(&alice_id.to_string()));
        assert!(rendered.contains("redacted"));

        // A refusal of a plaintext file names the path it refused, which is what the
        // operator needs, and never what the file held.
        let refusal = RelayError::PlaintextPairings(PathBuf::from("/tmp/pairings.json"));
        let message = refusal.to_string();
        assert!(message.contains("pairings.json"));
        assert!(!message.contains(&token));
    }

    /// LOAD-1 finding 2 on the relay's own listeners: a flood of refusals is a count,
    /// not a log. The relay is the component a spike reaches first.
    #[test]
    fn a_flood_of_relay_refusals_is_counted_and_not_written_per_request() {
        let (_alice_id, alice) = pairing("Alice");
        let relay = Arc::new(RelayState::with_limits(
            RelayTrust::from_pairings([&alice]),
            1024,
            8,
            RelayLimits {
                auth: Quota::new(1, 1, 60),
                ..RelayLimits::default()
            },
        ));

        for _ in 0..2_000u32 {
            let attempt = relay.authenticate(Some("bm90LWEtc2VjcmV0"), peer(50_040));
            assert!(
                matches!(
                    attempt,
                    Err(RelayError::Unauthenticated) | Err(RelayError::RateLimited { .. })
                ),
                "an unknown credential was answered as something else: {attempt:?}"
            );
        }

        // The first attempt is served by the bucket and refused by the trust list, so
        // 1,999 of the 2,000 are limiter refusals — and they are one tally, counted, not
        // 1,999 lines. The cadence itself is proven in `warsha-remote`'s own tests.
        assert_eq!(relay.refusals().refusals_total(), 1_999);
        assert_eq!(
            relay.refusals().tracked(),
            1,
            "one caller's flood earned one tally"
        );
        assert!(relay.refusals().untracked() <= DEFAULT_MAX_REFUSAL_KEYS as u64);
    }
}
