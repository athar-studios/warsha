//! Run modes — where `warshad` listens, and who is allowed to reach it (PLAN.md M20).
//!
//! Warsha runs in one of three places, and the difference is not cosmetic: it
//! decides which socket the daemon opens and which peers it will answer.
//!
//! - **Local** — one machine. The daemon binds `127.0.0.1`, so nothing off the
//!   host can open a connection, and the config carries no allow-list and no relay.
//! - **SelfHosted** — the owner's own server or a machine on their LAN. The daemon
//!   binds an explicit non-loopback interface (`0.0.0.0` by default) and must carry
//!   an explicit host allow-list, because "listen everywhere" without naming who
//!   may connect is an open port, not a mode.
//! - **Hosted** — the relay-backed mode. The API binds `127.0.0.1` and is reached
//!   only through a relay URL; the relay moves ciphertext, so the API is never
//!   exposed directly.
//!
//! [`RunModeConfig::validate`] is the one place those rules are enforced, and it
//! returns a [`RunModeError`] naming the rule that failed rather than a sentence
//! the caller has to parse. [`RunModeConfig::for_mode`] gives a starting point
//! that is valid for Local, and deliberately *not* valid for the other two until
//! the caller supplies the allow-list (SelfHosted) or the relay URL (Hosted) —
//! an unconfigured SelfHosted daemon must not quietly come up listening on
//! `0.0.0.0`.
//!
//! Phone pairing is shared by all three modes, and [`RunModeConfig::requires_pairing`]
//! is `true` in every one of them: a phone is a remote device even when the daemon
//! is local. [`PairingStore`] is the lifecycle (create, list, revoke, is_revoked)
//! and [`InMemoryPairingStore`] is the implementation that ships here. The QR
//! handshake, the one-time secret's format and the E2E channel are the M6 device
//! flow's job (`warsha-remote`); this module stores what that flow decides.
//!
//! Both survive a restart through `warsha-store`:
//! [`RunModeConfig::save_to_store`]/[`RunModeConfig::load_from_store`] keep one
//! row per mode in `run_modes`, and [`InMemoryPairingStore::save_to_store`]/
//! [`InMemoryPairingStore::load_from_store`] keep the pairing rows in
//! `pairing_devices`. The pairing table holds the one-time secret as the M6 flow
//! minted it — the QR channel has to hand the same value back to the device — and
//! `Debug` redacts it on both sides so it cannot reach a log.
//!
//! Nothing here opens a socket: `bind_host` is data a later daemon reads. The
//! relay is a URL string, not a connection, and no code in this module dials it.

use serde::{Deserialize, Serialize};
use std::fmt;
use warsha_store::{SqliteStore, StoreError, StoredPairing, StoredRunMode};

/// The only two spellings of "this machine" the daemon binds.
pub const LOOPBACK_HOST: &str = "127.0.0.1";
/// The default bind for SelfHosted: every IPv4 interface.
pub const WILDCARD_HOST: &str = "0.0.0.0";
/// The name form of loopback, accepted wherever `127.0.0.1` is.
pub const LOCALHOST: &str = "localhost";

/// Where a Warsha daemon runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunMode {
    /// One machine: loopback only, no allow-list, no relay.
    #[default]
    Local,
    /// The owner's own host or LAN: an explicit bind plus an explicit allow-list.
    SelfHosted,
    /// Relay-backed: loopback binding, remote devices arrive through the relay.
    Hosted,
}

impl RunMode {
    /// Every mode, in display order.
    pub fn all() -> [RunMode; 3] {
        [RunMode::Local, RunMode::SelfHosted, RunMode::Hosted]
    }

    /// Stable snake_case tag; also the serde representation the desktop reads.
    pub fn as_str(self) -> &'static str {
        match self {
            RunMode::Local => "local",
            RunMode::SelfHosted => "self_hosted",
            RunMode::Hosted => "hosted",
        }
    }

    /// Readable name for a badge, a log line or a config file comment.
    pub fn label(self) -> &'static str {
        match self {
            RunMode::Local => "Local",
            RunMode::SelfHosted => "Self-hosted",
            RunMode::Hosted => "Hosted",
        }
    }
}

/// Where the API binds and who may reach it, for one mode.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RunModeConfig {
    /// Which of the three modes this config describes.
    pub mode: RunMode,
    /// The interface the API binds, e.g. `127.0.0.1` or `0.0.0.0`.
    pub bind_host: String,
    /// Hosts a SelfHosted daemon will answer; empty in Local.
    pub allowed_hosts: Vec<String>,
    /// Relay endpoint for Hosted; `None` in every other mode.
    pub relay_url: Option<String>,
}

impl Default for RunModeConfig {
    fn default() -> Self {
        Self::for_mode(RunMode::Local)
    }
}

impl RunModeConfig {
    /// The starting config for a mode.
    ///
    /// Local is valid as returned. SelfHosted comes back bound to `0.0.0.0` with
    /// an empty allow-list, and Hosted comes back on loopback with no relay: both
    /// are refused by [`RunModeConfig::validate`] until the caller supplies the
    /// missing piece, which is the point.
    pub fn for_mode(mode: RunMode) -> Self {
        match mode {
            RunMode::Local => Self {
                mode,
                bind_host: LOOPBACK_HOST.to_string(),
                allowed_hosts: Vec::new(),
                relay_url: None,
            },
            RunMode::SelfHosted => Self {
                mode,
                bind_host: WILDCARD_HOST.to_string(),
                allowed_hosts: Vec::new(),
                relay_url: None,
            },
            RunMode::Hosted => Self {
                mode,
                bind_host: LOOPBACK_HOST.to_string(),
                allowed_hosts: Vec::new(),
                relay_url: None,
            },
        }
    }

    /// Builder: set the bind interface.
    pub fn with_bind_host(mut self, host: impl Into<String>) -> Self {
        self.bind_host = host.into();
        self
    }

    /// Builder: replace the host allow-list.
    pub fn with_allowed_hosts<I, S>(mut self, hosts: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.allowed_hosts = hosts.into_iter().map(Into::into).collect();
        self
    }

    /// Builder: set the relay endpoint (Hosted only).
    pub fn with_relay_url(mut self, url: impl Into<String>) -> Self {
        self.relay_url = Some(url.into());
        self
    }

    /// True when the listening socket cannot be reached from another machine.
    ///
    /// This is a statement about the bind only. Hosted answers `true` because the
    /// API binds loopback and remote devices arrive through the relay; whether a
    /// relay is reachable is a different question, and nothing here checks it.
    pub fn is_loopback_only(&self) -> bool {
        is_loopback_host(&self.bind_host)
    }

    /// True when a phone has to finish the pairing flow before it can act.
    ///
    /// Always `true`: a phone is a remote device in Local, SelfHosted and Hosted
    /// alike, and a loopback bind does not make someone else's phone local. The
    /// method exists so a caller asks the config instead of remembering the rule.
    pub fn requires_pairing(&self) -> bool {
        true
    }

    /// Enforce the mode's rules.
    ///
    /// The checks are deliberately structural, not a parse: a host is compared as
    /// a trimmed string (case-insensitively for `localhost`), and a relay is any
    /// non-blank URL. Reachability is nobody's business here.
    pub fn validate(&self) -> Result<(), RunModeError> {
        let host = self.bind_host.trim();
        if host.is_empty() {
            return Err(RunModeError::BlankBindHost { mode: self.mode });
        }

        match self.mode {
            RunMode::Local => {
                if !is_loopback_host(host) {
                    return Err(RunModeError::InvalidBindHost {
                        mode: self.mode,
                        host: host.to_string(),
                    });
                }
                if !self.allowed_hosts.is_empty() {
                    return Err(RunModeError::AllowedHostsNotPermitted {
                        mode: self.mode,
                        count: self.allowed_hosts.len(),
                    });
                }
                if self.relay_url.is_some() {
                    return Err(RunModeError::RelayUrlNotPermitted { mode: self.mode });
                }
            }
            RunMode::SelfHosted => {
                if is_loopback_host(host) {
                    return Err(RunModeError::InvalidBindHost {
                        mode: self.mode,
                        host: host.to_string(),
                    });
                }
                if self.allowed_hosts.is_empty() {
                    return Err(RunModeError::AllowedHostsRequired { mode: self.mode });
                }
                for allowed in &self.allowed_hosts {
                    if !is_host_name(allowed) {
                        return Err(RunModeError::InvalidAllowedHost {
                            host: allowed.clone(),
                        });
                    }
                }
            }
            RunMode::Hosted => {
                if !is_loopback_host(host) {
                    return Err(RunModeError::InvalidBindHost {
                        mode: self.mode,
                        host: host.to_string(),
                    });
                }
                match &self.relay_url {
                    Some(url) if !url.trim().is_empty() => {}
                    _ => return Err(RunModeError::RelayUrlRequired { mode: self.mode }),
                }
            }
        }

        Ok(())
    }

    /// Persist this config for its own mode, replacing the previous row.
    ///
    /// The row is keyed by [`RunMode::as_str`], so the three modes never collide:
    /// switching to Hosted does not erase the Local config, and switching back
    /// still finds it. The whole struct is serialised, so an allow-list or a
    /// relay URL comes back exactly as it went in.
    pub fn save_to_store(&self, store: &SqliteStore) -> Result<(), StoreError> {
        store.save_run_mode(&StoredRunMode {
            mode: self.mode.as_str().to_string(),
            config_json: serde_json::to_string(self)?,
        })
    }

    /// Load the stored config for `mode`, or `None` when it was never saved.
    ///
    /// The config is returned as stored and is **not** validated here:
    /// [`RunModeConfig::validate`] stays the one gate a daemon must pass before
    /// it binds, so an old row that is no longer legal is read back and then
    /// refused, rather than being silently repaired.
    pub fn load_from_store(
        store: &SqliteStore,
        mode: RunMode,
    ) -> Result<Option<RunModeConfig>, StoreError> {
        match store.load_run_mode(mode.as_str())? {
            None => Ok(None),
            Some(row) => {
                let config: RunModeConfig = serde_json::from_str(&row.config_json)?;
                Ok(Some(config))
            }
        }
    }
}

/// True for the two accepted spellings of "this machine".
///
/// `::1` is deliberately absent: the daemon binds IPv4 and reports one address,
/// so accepting a v6 literal here would validate a config nothing can bind.
pub fn is_loopback_host(host: &str) -> bool {
    let host = host.trim();
    host.eq_ignore_ascii_case(LOOPBACK_HOST) || host.eq_ignore_ascii_case(LOCALHOST)
}

/// True when an allow-list entry looks like a host name or `host:port`.
///
/// One non-blank token: no whitespace, no slash, no scheme. A full URL in an
/// allow-list is a configuration mistake worth naming — the list holds hosts.
fn is_host_name(candidate: &str) -> bool {
    let entry = candidate.trim();
    !entry.is_empty() && !entry.contains(|c: char| c.is_whitespace() || c == '/')
}

/// A rejected run-mode config or pairing operation.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RunModeError {
    /// `bind_host` was empty or only whitespace.
    #[error("{mode:?} mode needs a bind host")]
    BlankBindHost { mode: RunMode },
    /// The host is not allowed in this mode.
    #[error("{mode:?} mode cannot bind {host}")]
    InvalidBindHost { mode: RunMode, host: String },
    /// SelfHosted without an allow-list.
    #[error("{mode:?} mode requires an allowed-host list")]
    AllowedHostsRequired { mode: RunMode },
    /// Local with an allow-list.
    #[error("{mode:?} mode cannot carry an allowed-host list ({count} entries)")]
    AllowedHostsNotPermitted { mode: RunMode, count: usize },
    /// An allow-list entry that is not a host.
    #[error("{host:?} is not a host name")]
    InvalidAllowedHost { host: String },
    /// Hosted without a relay.
    #[error("{mode:?} mode requires a relay URL")]
    RelayUrlRequired { mode: RunMode },
    /// Local with a relay.
    #[error("{mode:?} mode cannot carry a relay URL")]
    RelayUrlNotPermitted { mode: RunMode },
    /// A pairing was requested without a device id.
    #[error("device id must not be blank")]
    BlankDeviceId,
    /// A pairing was requested without a secret.
    #[error("pairing secret must not be blank")]
    BlankSecret,
    /// The device id already has a pairing record.
    #[error("device {device_id} is already paired")]
    DeviceAlreadyPaired { device_id: String },
    /// No pairing record for that device id.
    #[error("device {device_id} is not paired")]
    PairingNotFound { device_id: String },
}

/// Shown in place of a secret by the [`fmt::Debug`] impl.
pub const REDACTED_SECRET: &str = "<redacted>";

/// One paired phone.
///
/// `secret` is the one-time secret the QR carried. It is `Debug`-redacted so a
/// stray `tracing::debug!("{:?}", pairing)` cannot put it in a log; the field is
/// still serialised, because the pairing channel has to hand it to the device.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PhonePairing {
    /// Stable device id, minted by the M6 device flow.
    pub device_id: String,
    /// The one-time secret; never logged.
    pub secret: String,
    /// Unix seconds the pairing was created.
    pub created_at: u64,
    /// True once the owner revoked it; a revoked device stays in the store.
    pub revoked: bool,
}

impl PhonePairing {
    /// Build a pairing record.
    pub fn new(device_id: impl Into<String>, secret: impl Into<String>, created_at: u64) -> Self {
        Self {
            device_id: device_id.into(),
            secret: secret.into(),
            created_at,
            revoked: false,
        }
    }

    /// True while the device is allowed to act.
    pub fn is_active(&self) -> bool {
        !self.revoked
    }
}

impl fmt::Debug for PhonePairing {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PhonePairing")
            .field("device_id", &self.device_id)
            .field("secret", &REDACTED_SECRET)
            .field("created_at", &self.created_at)
            .field("revoked", &self.revoked)
            .finish()
    }
}

/// Lifecycle of the phones paired with this daemon.
///
/// Every mode implements the same trait, so revocation is honoured in Local,
/// SelfHosted and Hosted alike: a revoked record is not deleted, it is marked, so
/// "was this device ever paired, and when was it cut off" stays answerable.
pub trait PairingStore {
    /// Record a new pairing.
    ///
    /// Refuses a blank device id or secret, and refuses a device id that already
    /// has a record — including a revoked one, so re-pairing has to be an
    /// explicit, visible act with a fresh id rather than a silent resurrection.
    fn create(
        &mut self,
        device_id: &str,
        secret: &str,
        created_at: u64,
    ) -> Result<PhonePairing, RunModeError>;

    /// Every pairing, active and revoked, in creation order.
    fn list(&self) -> Vec<PhonePairing>;

    /// Mark a device revoked. Idempotent: a second revoke is not an error.
    fn revoke(&mut self, device_id: &str) -> Result<PhonePairing, RunModeError>;

    /// Whether a paired device is revoked. An unknown device is an error, not
    /// `false`, so "no record" can never read as "active".
    fn is_revoked(&self, device_id: &str) -> Result<bool, RunModeError>;

    /// Every pairing that is still allowed to act.
    fn active(&self) -> Vec<PhonePairing> {
        self.list()
            .into_iter()
            .filter(PhonePairing::is_active)
            .collect()
    }
}

/// Pairings held in memory for the lifetime of the process.
///
/// No persistence: `warsha-store`'s `devices` table and its migrations are the
/// place a durable store would live, and that crate is outside this batch.
#[derive(Debug, Default, Clone)]
pub struct InMemoryPairingStore {
    pairings: Vec<PhonePairing>,
}

impl InMemoryPairingStore {
    /// An empty store.
    pub fn new() -> Self {
        Self::default()
    }

    /// How many records exist, revoked ones included.
    pub fn len(&self) -> usize {
        self.pairings.len()
    }

    /// True when nothing has ever been paired.
    pub fn is_empty(&self) -> bool {
        self.pairings.is_empty()
    }

    /// The record for a device id, if any.
    pub fn get(&self, device_id: &str) -> Option<&PhonePairing> {
        let device_id = device_id.trim();
        self.pairings
            .iter()
            .find(|pairing| pairing.device_id == device_id)
    }

    /// Persist every pairing — revoked ones included — into the SQLite store.
    ///
    /// Revocation is a value on the row, not a delete, so a revoked device is
    /// written the same way as an active one and comes back revoked.
    pub fn save_to_store(&self, store: &SqliteStore) -> Result<(), StoreError> {
        for pairing in &self.pairings {
            store.save_pairing(&StoredPairing {
                device_id: pairing.device_id.clone(),
                secret: pairing.secret.clone(),
                created_at: pairing.created_at,
                revoked: pairing.revoked,
            })?;
        }
        Ok(())
    }

    /// Read the pairings back into a store, oldest first.
    ///
    /// The result is a fresh [`InMemoryPairingStore`], so the caller gets the
    /// same `create`/`list`/`revoke` behaviour it had before the restart rather
    /// than a read-only view. A device already paired under the same id is kept
    /// as stored: this is a reload, not a re-pairing.
    pub fn load_from_store(store: &SqliteStore) -> Result<InMemoryPairingStore, StoreError> {
        let pairings = store
            .load_pairings()?
            .into_iter()
            .map(|row| PhonePairing {
                device_id: row.device_id,
                secret: row.secret,
                created_at: row.created_at,
                revoked: row.revoked,
            })
            .collect();
        Ok(Self { pairings })
    }
}

impl PairingStore for InMemoryPairingStore {
    fn create(
        &mut self,
        device_id: &str,
        secret: &str,
        created_at: u64,
    ) -> Result<PhonePairing, RunModeError> {
        let device_id = device_id.trim();
        if device_id.is_empty() {
            return Err(RunModeError::BlankDeviceId);
        }
        if secret.trim().is_empty() {
            return Err(RunModeError::BlankSecret);
        }
        if self.get(device_id).is_some() {
            return Err(RunModeError::DeviceAlreadyPaired {
                device_id: device_id.to_string(),
            });
        }

        let pairing = PhonePairing::new(device_id, secret, created_at);
        self.pairings.push(pairing.clone());
        Ok(pairing)
    }

    fn list(&self) -> Vec<PhonePairing> {
        self.pairings.clone()
    }

    fn revoke(&mut self, device_id: &str) -> Result<PhonePairing, RunModeError> {
        let device_id = device_id.trim();
        let pairing = self
            .pairings
            .iter_mut()
            .find(|pairing| pairing.device_id == device_id)
            .ok_or_else(|| RunModeError::PairingNotFound {
                device_id: device_id.to_string(),
            })?;
        pairing.revoked = true;
        Ok(pairing.clone())
    }

    fn is_revoked(&self, device_id: &str) -> Result<bool, RunModeError> {
        self.get(device_id)
            .map(|pairing| pairing.revoked)
            .ok_or_else(|| RunModeError::PairingNotFound {
                device_id: device_id.trim().to_string(),
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn for_mode_local_binds_loopback_and_carries_nothing_else() {
        let config = RunModeConfig::for_mode(RunMode::Local);
        assert_eq!(config.mode, RunMode::Local);
        assert_eq!(config.bind_host, LOOPBACK_HOST);
        assert!(config.allowed_hosts.is_empty());
        assert_eq!(config.relay_url, None);
        assert!(config.is_loopback_only());
        assert!(config.validate().is_ok());
    }

    #[test]
    fn for_mode_self_hosted_binds_every_interface_but_needs_an_allow_list() {
        let config = RunModeConfig::for_mode(RunMode::SelfHosted);
        assert_eq!(config.bind_host, WILDCARD_HOST);
        assert!(config.allowed_hosts.is_empty());
        assert_eq!(config.relay_url, None);
        assert!(!config.is_loopback_only());
        // The default self-hosted bind is an open socket until the owner names
        // who may connect, so this config is refused rather than trusted.
        assert!(matches!(
            config.validate(),
            Err(RunModeError::AllowedHostsRequired { .. })
        ));
    }

    #[test]
    fn for_mode_hosted_is_loopback_and_refused_until_a_relay_is_set() {
        let config = RunModeConfig::for_mode(RunMode::Hosted);
        assert_eq!(config.bind_host, LOOPBACK_HOST);
        assert!(config.is_loopback_only());
        assert_eq!(config.relay_url, None);
        assert!(matches!(
            config.validate(),
            Err(RunModeError::RelayUrlRequired { .. })
        ));

        let config = config.with_relay_url("wss://relay.example.invalid");
        assert!(config.validate().is_ok());
    }

    #[test]
    fn the_three_modes_have_stable_tags_labels_and_serde() {
        let expected = [
            (RunMode::Local, "local", "Local"),
            (RunMode::SelfHosted, "self_hosted", "Self-hosted"),
            (RunMode::Hosted, "hosted", "Hosted"),
        ];
        assert_eq!(RunMode::all().len(), expected.len());
        for (index, (mode, tag, label)) in expected.iter().enumerate() {
            assert_eq!(RunMode::all()[index], *mode);
            assert_eq!(mode.as_str(), *tag);
            assert_eq!(mode.label(), *label);
            let json = serde_json::to_value(mode).expect("mode serialises");
            assert_eq!(json, serde_json::json!(tag));
            let back: RunMode = serde_json::from_value(json).expect("mode deserialises");
            assert_eq!(back, *mode);
        }
        assert_eq!(RunMode::default(), RunMode::Local);
        assert_eq!(
            RunModeConfig::default(),
            RunModeConfig::for_mode(RunMode::Local)
        );
    }

    #[test]
    fn local_accepts_both_loopback_spellings_and_refuses_everything_else() {
        for host in ["127.0.0.1", "localhost", " LOCALHOST "] {
            let config = RunModeConfig::for_mode(RunMode::Local).with_bind_host(host);
            assert!(config.validate().is_ok(), "`{host}` should be loopback");
        }
        for host in ["0.0.0.0", "192.168.1.10", "example.com", "::1"] {
            let config = RunModeConfig::for_mode(RunMode::Local).with_bind_host(host);
            assert!(
                matches!(
                    config.validate(),
                    Err(RunModeError::InvalidBindHost {
                        mode: RunMode::Local,
                        ..
                    })
                ),
                "`{host}` should be refused in Local"
            );
        }
    }

    #[test]
    fn local_refuses_an_allow_list_and_a_relay() {
        let with_hosts = RunModeConfig::for_mode(RunMode::Local)
            .with_allowed_hosts(["phone.local".to_string(), "tablet.local".to_string()]);
        assert_eq!(
            with_hosts.validate(),
            Err(RunModeError::AllowedHostsNotPermitted {
                mode: RunMode::Local,
                count: 2
            })
        );

        let with_relay =
            RunModeConfig::for_mode(RunMode::Local).with_relay_url("wss://relay.invalid");
        assert_eq!(
            with_relay.validate(),
            Err(RunModeError::RelayUrlNotPermitted {
                mode: RunMode::Local
            })
        );
    }

    #[test]
    fn self_hosted_validates_with_an_explicit_bind_and_allow_list() {
        let config = RunModeConfig::for_mode(RunMode::SelfHosted)
            .with_bind_host("192.168.1.10")
            .with_allowed_hosts(["warsha.lan", "10.0.0.5:8443"]);
        assert!(config.validate().is_ok());

        let wildcard = RunModeConfig::for_mode(RunMode::SelfHosted)
            .with_allowed_hosts(["warsha.lan".to_string()]);
        assert!(wildcard.validate().is_ok());
    }

    #[test]
    fn self_hosted_refuses_loopback_and_malformed_allow_list_entries() {
        let loopback = RunModeConfig::for_mode(RunMode::SelfHosted)
            .with_bind_host(LOOPBACK_HOST)
            .with_allowed_hosts(["warsha.lan".to_string()]);
        assert_eq!(
            loopback.validate(),
            Err(RunModeError::InvalidBindHost {
                mode: RunMode::SelfHosted,
                host: LOOPBACK_HOST.to_string()
            })
        );

        for entry in ["", "  ", "https://warsha.lan", "warsha lan"] {
            let config = RunModeConfig::for_mode(RunMode::SelfHosted)
                .with_allowed_hosts([entry.to_string()]);
            assert!(
                matches!(
                    config.validate(),
                    Err(RunModeError::InvalidAllowedHost { .. })
                ),
                "`{entry}` should not be accepted as a host"
            );
        }
    }

    #[test]
    fn hosted_refuses_a_non_loopback_bind_and_a_blank_relay() {
        let exposed = RunModeConfig::for_mode(RunMode::Hosted)
            .with_bind_host(WILDCARD_HOST)
            .with_relay_url("wss://relay.invalid");
        assert_eq!(
            exposed.validate(),
            Err(RunModeError::InvalidBindHost {
                mode: RunMode::Hosted,
                host: WILDCARD_HOST.to_string()
            })
        );

        let blank_relay = RunModeConfig::for_mode(RunMode::Hosted).with_relay_url("   ");
        assert_eq!(
            blank_relay.validate(),
            Err(RunModeError::RelayUrlRequired {
                mode: RunMode::Hosted
            })
        );
    }

    #[test]
    fn a_blank_bind_host_is_refused_in_every_mode() {
        for mode in RunMode::all() {
            let config = RunModeConfig::for_mode(mode)
                .with_bind_host("   ")
                .with_allowed_hosts(["warsha.lan".to_string()]);
            assert_eq!(
                config.validate(),
                Err(RunModeError::BlankBindHost { mode }),
                "{mode:?} accepted a blank bind host"
            );
        }
    }

    #[test]
    fn is_loopback_only_reads_the_bind_host_only() {
        let local = RunModeConfig::for_mode(RunMode::Local);
        let self_hosted = RunModeConfig::for_mode(RunMode::SelfHosted);
        let hosted = RunModeConfig::for_mode(RunMode::Hosted);

        assert!(local.is_loopback_only());
        assert!(!self_hosted.is_loopback_only());
        // Hosted binds loopback and is reached through the relay, so its socket
        // is not reachable off-host — that is what the predicate answers.
        assert!(hosted.is_loopback_only());
        assert!(hosted.with_bind_host("localhost").is_loopback_only());
        assert!(!self_hosted
            .with_bind_host("192.168.1.20")
            .is_loopback_only());
    }

    #[test]
    fn every_mode_requires_pairing_for_remote_devices() {
        for mode in RunMode::all() {
            assert!(
                RunModeConfig::for_mode(mode).requires_pairing(),
                "{mode:?} must require pairing"
            );
        }
    }

    #[test]
    fn pairing_create_list_and_revoke_round_trip() {
        let mut store = InMemoryPairingStore::new();
        assert!(store.is_empty());

        let created = store
            .create("device-1", "one-time-secret", 1_700_000_000)
            .expect("first pairing");
        assert_eq!(created.device_id, "device-1");
        assert!(created.is_active());
        assert_eq!(created.created_at, 1_700_000_000);

        store
            .create(" device-2 ", "another-secret", 1_700_000_100)
            .expect("second pairing");
        let listed = store.list();
        assert_eq!(listed.len(), 2);
        // Creation order, and the id is stored trimmed.
        assert_eq!(listed[0].device_id, "device-1");
        assert_eq!(listed[1].device_id, "device-2");
        assert_eq!(store.active().len(), 2);

        let revoked = store.revoke("device-1").expect("revoke");
        assert!(revoked.revoked);
        assert!(!revoked.is_active());
        assert_eq!(store.is_revoked("device-1"), Ok(true));
        assert_eq!(store.is_revoked("device-2"), Ok(false));
        assert_eq!(store.active().len(), 1);

        // Revocation marks the record; it does not delete it.
        assert_eq!(store.len(), 2);
        assert_eq!(store.list()[0].secret, "one-time-secret");
    }

    #[test]
    fn revoking_is_idempotent_and_an_unknown_device_is_an_error() {
        let mut store = InMemoryPairingStore::new();
        store
            .create("device-1", "secret", 1)
            .expect("pairing is created");

        store.revoke("device-1").expect("first revoke");
        let second = store.revoke("device-1").expect("second revoke is fine");
        assert!(second.revoked);

        assert_eq!(
            store.revoke("device-9"),
            Err(RunModeError::PairingNotFound {
                device_id: "device-9".to_string()
            })
        );
        // An unknown device is never reported as active.
        assert_eq!(
            store.is_revoked("device-9"),
            Err(RunModeError::PairingNotFound {
                device_id: "device-9".to_string()
            })
        );
    }

    #[test]
    fn pairing_refuses_blank_ids_blank_secrets_and_a_second_record() {
        let mut store = InMemoryPairingStore::new();
        assert_eq!(
            store.create("  ", "secret", 1),
            Err(RunModeError::BlankDeviceId)
        );
        assert_eq!(
            store.create("device-1", " \t", 1),
            Err(RunModeError::BlankSecret)
        );
        assert!(store.is_empty());

        store
            .create("device-1", "secret", 1)
            .expect("pairing is created");
        assert_eq!(
            store.create("device-1", "new-secret", 2),
            Err(RunModeError::DeviceAlreadyPaired {
                device_id: "device-1".to_string()
            })
        );

        // A revoked device cannot be quietly re-paired under the same id: the
        // record stays revoked until the owner pairs a fresh device id.
        store.revoke("device-1").expect("revoke");
        assert_eq!(
            store.create("device-1", "new-secret", 3),
            Err(RunModeError::DeviceAlreadyPaired {
                device_id: "device-1".to_string()
            })
        );
        assert_eq!(store.is_revoked("device-1"), Ok(true));
    }

    #[test]
    fn debug_never_prints_the_pairing_secret() {
        let pairing = PhonePairing::new("device-1", "super-secret-value", 42);
        let rendered = format!("{pairing:?}");
        assert!(rendered.contains("device-1"));
        assert!(rendered.contains(REDACTED_SECRET));
        assert!(!rendered.contains("super-secret-value"));

        let config = RunModeConfig::for_mode(RunMode::Hosted)
            .with_relay_url("wss://relay.invalid")
            .with_allowed_hosts(["warsha.lan".to_string()]);
        let back: RunModeConfig =
            serde_json::from_value(serde_json::to_value(&config).expect("config serialises"))
                .expect("config deserialises");
        assert_eq!(back, config);
        assert_eq!(back.mode, RunMode::Hosted);

        let json = serde_json::to_value(&pairing).expect("pairing serialises");
        assert_eq!(json["device_id"], "device-1");
        assert_eq!(json["secret"], "super-secret-value");
        assert_eq!(json["revoked"], false);
    }

    /// A `warsha-store` database on a temporary file, with the M20 schema applied.
    fn temp_sqlite_store() -> (SqliteStore, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let path = dir.path().join("warsha.db");
        let store = SqliteStore::open(&path.to_string_lossy()).expect("the store opens");
        store.migrate().expect("the schema is applied");
        (store, dir)
    }

    #[test]
    fn run_mode_config_round_trips_through_the_sqlite_store() {
        let (store, _dir) = temp_sqlite_store();
        assert_eq!(
            RunModeConfig::load_from_store(&store, RunMode::Local).expect("the read works"),
            None
        );

        let local = RunModeConfig::for_mode(RunMode::Local);
        let hosted = RunModeConfig::for_mode(RunMode::Hosted)
            .with_relay_url("wss://relay.example.invalid")
            .with_allowed_hosts(["warsha.lan".to_string()]);
        local.save_to_store(&store).expect("local is written");
        hosted.save_to_store(&store).expect("hosted is written");

        assert_eq!(
            RunModeConfig::load_from_store(&store, RunMode::Local).expect("the read works"),
            Some(local)
        );
        let loaded_hosted =
            RunModeConfig::load_from_store(&store, RunMode::Hosted).expect("the read works");
        let loaded_hosted = loaded_hosted.expect("hosted was saved");
        assert_eq!(loaded_hosted, hosted);
        // Saving one mode did not overwrite the other, and the loaded config is
        // still valid for its mode.
        assert_eq!(loaded_hosted.mode, RunMode::Hosted);
        assert!(loaded_hosted.validate().is_ok());
        assert_eq!(
            RunModeConfig::load_from_store(&store, RunMode::SelfHosted).expect("the read works"),
            None
        );
    }

    #[test]
    fn run_mode_config_saves_replace_the_row_for_that_mode() {
        let (store, _dir) = temp_sqlite_store();
        RunModeConfig::for_mode(RunMode::Hosted)
            .with_relay_url("wss://first.invalid")
            .save_to_store(&store)
            .expect("the first write");
        let replaced =
            RunModeConfig::for_mode(RunMode::Hosted).with_relay_url("wss://second.invalid");
        replaced.save_to_store(&store).expect("the second write");

        let loaded = RunModeConfig::load_from_store(&store, RunMode::Hosted)
            .expect("the read works")
            .expect("the row exists");
        assert_eq!(loaded.relay_url.as_deref(), Some("wss://second.invalid"));
        assert_eq!(loaded, replaced);
    }

    #[test]
    fn pairings_round_trip_through_the_sqlite_store() {
        let (store, _dir) = temp_sqlite_store();
        let mut memory = InMemoryPairingStore::new();
        memory
            .create("device-1", "one-time-secret", 1_700_000_000)
            .expect("the first pairing");
        memory
            .create("device-2", "another-secret", 1_700_000_100)
            .expect("the second pairing");
        memory.revoke("device-1").expect("device-1 is revoked");

        memory
            .save_to_store(&store)
            .expect("the pairings are written");

        let reloaded = InMemoryPairingStore::load_from_store(&store).expect("the rows are read");
        assert_eq!(reloaded.list(), memory.list());
        assert_eq!(reloaded.len(), 2);
        // Revocation survived the round trip: the row is there, the device is not
        // allowed to act, and its secret is unchanged.
        assert_eq!(reloaded.is_revoked("device-1"), Ok(true));
        assert_eq!(reloaded.is_revoked("device-2"), Ok(false));
        assert_eq!(reloaded.active().len(), 1);
        let first = reloaded.get("device-1").expect("the row exists");
        assert_eq!(first.secret, "one-time-secret");
        assert_eq!(first.created_at, 1_700_000_000);
        // The secret never prints on either side of the store.
        assert!(!format!("{first:?}").contains("one-time-secret"));
        let stored = store.load_pairings().expect("the rows are readable");
        assert!(!format!("{stored:?}").contains("one-time-secret"));
    }
}
