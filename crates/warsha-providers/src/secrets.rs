//! Where a provider's API key lives (PLAN.md M20, provider-RPC batch).
//!
//! A provider's *configuration* — its name, kind and base URL — is a settings row
//! in `warsha-store`. Its *secret* is not, and must never be: an API key in a
//! SQLite file is a key in every backup, every `SELECT *` pasted into a bug
//! report and every crash dump. So the two halves are stored in the two places
//! that suit them, and [`SecretStore`] is the one seam between the daemon and the
//! half that holds the secret:
//!
//! - **[`KeychainSecretStore`]** is what the daemon uses: the OS keychain, through
//!   the `store_key`/`load_key`/`delete_key` functions that already exist in
//!   [`crate::openai`]. This module adds no second keychain: it addresses the one
//!   seam that crate already had, under one service name
//!   ([`PROVIDER_KEYCHAIN_SERVICE`]) and with the provider's own name as the
//!   keychain *account*, so two providers cannot collide on one entry and a
//!   provider renamed by its owner is a different entry.
//! - **[`InMemorySecretStore`]** is the test double. The OS keychain is not
//!   available in a headless CI container or a WSL shell with no D-Bus secret
//!   service — `keyring` refuses with `PlatformFailure` there — so an integration
//!   test that drove `providers.add` through the real keychain would be a test of
//!   the runner, not of the daemon. The daemon therefore takes its store as a
//!   parameter, defaulting to the keychain.
//!
//! Nothing here logs a key, returns a key in an error and stores a key anywhere
//! but the store it was handed. `InMemorySecretStore`'s `Debug` impl prints the
//! accounts it holds and not the values, for the same reason `StoredPairing`'s
//! does.

use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::RwLock as StdRwLock;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex as TokioMutex;
use warsha_core::CredentialsRef;
use zeroize::Zeroize;

use crate::{delete_key, load_key, store_key, ProviderError, Result};

/// The keychain service every Warsha provider key is stored under.
///
/// One service for all providers, with the owner's name for the provider as the
/// account: a fixed service is what makes the entries findable (and wipeable) as
/// a group, and the per-provider account is what keeps them apart.
pub const PROVIDER_KEYCHAIN_SERVICE: &str = "warsha-provider";

/// The maximum duration to wait for an OS keychain operation before timing out.
///
/// On Linux with a locked keyring, or headless environments without secret service,
/// blocking calls to `keyring` can hang indefinitely waiting for user prompts or D-Bus responses.
/// Bounding keychain operations prevents wedging startup, health probes, or provider management.
pub const KEYCHAIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

/// One provider key, addressed by the provider's name.
///
/// Async because the keychain seam it wraps is (`store_key`/`load_key` are
/// `async`); a synchronous implementation would have to block the daemon's
/// runtime on a keychain prompt.
#[async_trait]
pub trait SecretStore: Send + Sync + fmt::Debug {
    /// Store `key` for `account`, replacing whatever was there.
    async fn store(&self, account: &str, key: &str) -> Result<()>;

    /// Read the key for `account`; an account with no entry is an error.
    async fn load(&self, account: &str) -> Result<String>;

    /// Forget `account`'s key. Deleting an account that has no entry is fine —
    /// removal is idempotent by design.
    async fn delete(&self, account: &str) -> Result<()>;
}

/// The OS keychain — Windows Credential Manager, macOS Keychain, or the freedesktop
/// Secret Service — under [`PROVIDER_KEYCHAIN_SERVICE`].
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct KeychainSecretStore;

impl KeychainSecretStore {
    /// The keychain service every provider key is filed under.
    pub const SERVICE: &'static str = PROVIDER_KEYCHAIN_SERVICE;

    /// The keychain store.
    pub fn new() -> Self {
        Self
    }

    /// The `CredentialsRef` that addresses `account` in the OS keychain.
    ///
    /// This is the address the crate's existing key helpers already understand,
    /// so there is exactly one piece of code in the workspace that names the
    /// keychain and this is not a second one.
    fn credentials(account: &str) -> CredentialsRef {
        CredentialsRef::Keychain {
            service: Self::SERVICE.to_string(),
            account: account.to_string(),
        }
    }
}

#[async_trait]
impl SecretStore for KeychainSecretStore {
    async fn store(&self, account: &str, key: &str) -> Result<()> {
        store_key(&Self::credentials(account), Self::SERVICE, account, key).await
    }

    async fn load(&self, account: &str) -> Result<String> {
        load_key(&Self::credentials(account), Self::SERVICE, account).await
    }

    async fn delete(&self, account: &str) -> Result<()> {
        delete_key(&Self::credentials(account)).await
    }
}

#[async_trait]
impl<S: SecretStore + ?Sized> SecretStore for Arc<S> {
    async fn store(&self, account: &str, key: &str) -> Result<()> {
        self.as_ref().store(account, key).await
    }

    async fn load(&self, account: &str) -> Result<String> {
        self.as_ref().load(account).await
    }

    async fn delete(&self, account: &str) -> Result<()> {
        self.as_ref().delete(account).await
    }
}
/// An in-memory store for tests and headless environments.
///
/// Storing credentials in plaintext on disk was explicitly rejected here to avoid plaintext keys
/// touching disk. Per the owner decision dated 2026-11-21, an ENCRYPTED file-backed store
/// ([`EncryptedFileSecretStore`]) is now approved strictly as a fallback when the OS keychain
/// is locked or unavailable, using XChaCha20-Poly1305 with random nonces and 0600 file
/// permissions so plaintext keys never touch the disk.
#[derive(Default)]
pub struct InMemorySecretStore {
    entries: Mutex<HashMap<String, String>>,
}

impl fmt::Debug for InMemorySecretStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // The accounts, never the keys: a `Debug` that printed the map would make
        // `tracing::debug!("{store:?}")` a way to leak every key in the process.
        f.debug_struct("InMemorySecretStore")
            .field("accounts", &self.accounts())
            .finish()
    }
}

impl InMemorySecretStore {
    /// An empty store.
    pub fn new() -> Self {
        Self::default()
    }

    /// What is stored for `account`, for a test that asserts the seam was used.
    pub fn key_for(&self, account: &str) -> Option<String> {
        self.lock().get(account).cloned()
    }

    /// Every account holding a key, in name order.
    pub fn accounts(&self) -> Vec<String> {
        let mut names: Vec<String> = self.lock().keys().cloned().collect();
        names.sort();
        names
    }

    /// The map, with a poisoned lock read as the panic it is rather than
    /// panicking again in a drop.
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
        match self.entries.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

#[async_trait]
impl SecretStore for InMemorySecretStore {
    async fn store(&self, account: &str, key: &str) -> Result<()> {
        self.lock().insert(account.to_string(), key.to_string());
        Ok(())
    }

    async fn load(&self, account: &str) -> Result<String> {
        self.lock().get(account).cloned().ok_or_else(|| {
            ProviderError::Auth(format!("no API key is stored for provider {account}"))
        })
    }

    async fn delete(&self, account: &str) -> Result<()> {
        self.lock().remove(account);
        Ok(())
    }
}

/// Master key file name in data_dir
pub const SECRETS_KEY_FILE: &str = "provider-secrets.key";
/// Encrypted secrets map file name in data_dir
pub const SECRETS_MAP_FILE: &str = "provider-secrets.enc.json";

#[cfg(unix)]
fn set_restricted_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn set_restricted_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn create_restricted_file(path: &Path) -> std::io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true).mode(0o600);
    options.open(path)
}

#[cfg(not(unix))]
fn create_restricted_file(path: &Path) -> std::io::Result<std::fs::File> {
    std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)
}

fn get_or_create_master_key(key_path: &Path) -> Result<[u8; 32]> {
    if key_path.exists() {
        let bytes = std::fs::read(key_path)
            .map_err(|_| ProviderError::Auth("fallback load failed".to_string()))?;
        if bytes.len() != 32 {
            return Err(ProviderError::Auth("fallback load failed".to_string()));
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&bytes);
        Ok(key)
    } else {
        let mut key = [0u8; 32];
        rand::rng().fill_bytes(&mut key);
        let mut file = create_restricted_file(key_path)
            .map_err(|_| ProviderError::Auth("fallback store failed".to_string()))?;
        std::io::Write::write_all(&mut file, &key)
            .map_err(|_| ProviderError::Auth("fallback store failed".to_string()))?;
        let _ = set_restricted_permissions(key_path);
        Ok(key)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EncryptedSecretEntry {
    nonce: String,
    ciphertext: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct EncryptedSecretsFile {
    version: u32,
    #[serde(default)]
    accounts: HashMap<String, EncryptedSecretEntry>,
}

/// An encrypted file-backed secret store that keeps provider keys in an AEAD-encrypted
/// JSON file (`provider-secrets.enc.json`) with restricted permissions (0600 on Unix)
/// under the daemon's data directory.
///
/// Encryption uses XChaCha20-Poly1305 with a cryptographically random 24-byte nonce
/// per entry. The 32-byte wrapping key is generated once at data_dir (`provider-secrets.key`)
/// with restricted permissions (0600 on Unix).
///
/// Security tradeoff:
/// This protects against offline disk reads and backup exposures, but does NOT protect
/// against a local attacker with full access to `data_dir` (the same threat model as `warsha.db`).
/// Plaintext secrets never touch disk and are never written to log files.
#[derive(Clone)]
pub struct EncryptedFileSecretStore {
    data_dir: PathBuf,
    key_path: PathBuf,
    file_path: PathBuf,
    lock: Arc<TokioMutex<()>>,
}

impl fmt::Debug for EncryptedFileSecretStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Redact everything except file path: secrets must never leak via Debug.
        f.debug_struct("EncryptedFileSecretStore")
            .field("file_path", &self.file_path)
            .finish()
    }
}

impl EncryptedFileSecretStore {
    /// Create a new encrypted file secret store in `data_dir`.
    pub fn new(data_dir: impl AsRef<Path>) -> Result<Self> {
        let dir = data_dir.as_ref().to_path_buf();
        Ok(Self {
            key_path: dir.join(SECRETS_KEY_FILE),
            file_path: dir.join(SECRETS_MAP_FILE),
            data_dir: dir,
            lock: Arc::new(TokioMutex::new(())),
        })
    }

    /// Path to the encrypted JSON file.
    pub fn file_path(&self) -> &Path {
        &self.file_path
    }

    /// Path to the master key file.
    pub fn key_path(&self) -> &Path {
        &self.key_path
    }
}

#[async_trait]
impl SecretStore for EncryptedFileSecretStore {
    async fn store(&self, account: &str, secret: &str) -> Result<()> {
        let _guard = self.lock.lock().await;

        if !self.data_dir.exists() {
            std::fs::create_dir_all(&self.data_dir)
                .map_err(|_| ProviderError::Auth("fallback store failed".to_string()))?;
        }

        let mut master_key = get_or_create_master_key(&self.key_path)?;

        let mut file_content = if self.file_path.exists() {
            let data = std::fs::read_to_string(&self.file_path)
                .map_err(|_| ProviderError::Auth("fallback store failed".to_string()))?;
            serde_json::from_str::<EncryptedSecretsFile>(&data)
                .map_err(|_| ProviderError::Auth("fallback store failed".to_string()))?
        } else {
            EncryptedSecretsFile {
                version: 1,
                accounts: HashMap::new(),
            }
        };

        let mut nonce_bytes = [0u8; 24];
        rand::rng().fill_bytes(&mut nonce_bytes);

        let cipher = XChaCha20Poly1305::new(Key::from_slice(&master_key));
        master_key.zeroize();

        let ciphertext = cipher
            .encrypt(XNonce::from_slice(&nonce_bytes), secret.as_bytes())
            .map_err(|_| ProviderError::Auth("fallback store failed".to_string()))?;

        let entry = EncryptedSecretEntry {
            nonce: BASE64_STANDARD.encode(nonce_bytes),
            ciphertext: BASE64_STANDARD.encode(ciphertext),
        };

        file_content.version = 1;
        file_content.accounts.insert(account.to_string(), entry);

        let json_bytes = serde_json::to_vec_pretty(&file_content)
            .map_err(|_| ProviderError::Auth("fallback store failed".to_string()))?;

        let tmp_path = self.file_path.with_extension("tmp");
        let mut tmp_file = create_restricted_file(&tmp_path)
            .map_err(|_| ProviderError::Auth("fallback store failed".to_string()))?;
        std::io::Write::write_all(&mut tmp_file, &json_bytes)
            .map_err(|_| ProviderError::Auth("fallback store failed".to_string()))?;
        let _ = set_restricted_permissions(&tmp_path);
        std::fs::rename(&tmp_path, &self.file_path)
            .map_err(|_| ProviderError::Auth("fallback store failed".to_string()))?;
        let _ = set_restricted_permissions(&self.file_path);

        Ok(())
    }

    async fn load(&self, account: &str) -> Result<String> {
        let _guard = self.lock.lock().await;

        if !self.file_path.exists() {
            return Err(ProviderError::Auth(format!(
                "no API key is stored for provider {account}"
            )));
        }

        let data = std::fs::read_to_string(&self.file_path)
            .map_err(|_| ProviderError::Auth("fallback load failed".to_string()))?;
        let file_content: EncryptedSecretsFile = serde_json::from_str(&data)
            .map_err(|_| ProviderError::Auth("fallback load failed".to_string()))?;

        let entry = file_content.accounts.get(account).ok_or_else(|| {
            ProviderError::Auth(format!("no API key is stored for provider {account}"))
        })?;

        let nonce_bytes = BASE64_STANDARD
            .decode(&entry.nonce)
            .map_err(|_| ProviderError::Auth("fallback load failed".to_string()))?;
        if nonce_bytes.len() != 24 {
            return Err(ProviderError::Auth("fallback load failed".to_string()));
        }

        let ciphertext_bytes = BASE64_STANDARD
            .decode(&entry.ciphertext)
            .map_err(|_| ProviderError::Auth("fallback load failed".to_string()))?;

        let mut master_key = get_or_create_master_key(&self.key_path)?;
        let cipher = XChaCha20Poly1305::new(Key::from_slice(&master_key));
        master_key.zeroize();

        let decrypted = cipher
            .decrypt(XNonce::from_slice(&nonce_bytes), ciphertext_bytes.as_ref())
            .map_err(|_| ProviderError::Auth("fallback load failed".to_string()))?;

        let key_str = String::from_utf8(decrypted)
            .map_err(|_| ProviderError::Auth("fallback load failed".to_string()))?;

        Ok(key_str)
    }

    async fn delete(&self, account: &str) -> Result<()> {
        let _guard = self.lock.lock().await;

        if !self.file_path.exists() {
            return Ok(());
        }

        let data = match std::fs::read_to_string(&self.file_path) {
            Ok(d) => d,
            Err(_) => return Ok(()),
        };
        let mut file_content: EncryptedSecretsFile = match serde_json::from_str(&data) {
            Ok(c) => c,
            Err(_) => return Ok(()),
        };

        if file_content.accounts.remove(account).is_some() {
            let json_bytes = serde_json::to_vec_pretty(&file_content)
                .map_err(|_| ProviderError::Auth("fallback store failed".to_string()))?;
            let tmp_path = self.file_path.with_extension("tmp");
            let mut tmp_file = create_restricted_file(&tmp_path)
                .map_err(|_| ProviderError::Auth("fallback store failed".to_string()))?;
            std::io::Write::write_all(&mut tmp_file, &json_bytes)
                .map_err(|_| ProviderError::Auth("fallback store failed".to_string()))?;
            let _ = set_restricted_permissions(&tmp_path);
            std::fs::rename(&tmp_path, &self.file_path)
                .map_err(|_| ProviderError::Auth("fallback store failed".to_string()))?;
            let _ = set_restricted_permissions(&self.file_path);
        }

        Ok(())
    }
}

/// A secret store that tries the primary store first (typically the OS keychain),
/// and seamlessly falls back to a secondary encrypted store (typically [`EncryptedFileSecretStore`])
/// if the primary store is locked, unavailable, or times out.
#[derive(Clone)]
pub struct FallbackSecretStore {
    primary: Arc<dyn SecretStore>,
    fallback: Arc<dyn SecretStore>,
    primary_timeout: Duration,
}

impl FallbackSecretStore {
    /// Create a new fallback secret store with default 1.5s primary timeout.
    pub fn new(primary: Arc<dyn SecretStore>, fallback: Arc<dyn SecretStore>) -> Self {
        Self {
            primary,
            fallback,
            primary_timeout: Duration::from_millis(1500),
        }
    }

    /// Override the primary store timeout.
    pub fn with_primary_timeout(mut self, timeout: Duration) -> Self {
        self.primary_timeout = timeout;
        self
    }

    /// Reference to the primary secret store.
    pub fn primary(&self) -> &Arc<dyn SecretStore> {
        &self.primary
    }

    /// Reference to the fallback secret store.
    pub fn fallback(&self) -> &Arc<dyn SecretStore> {
        &self.fallback
    }
}

impl fmt::Debug for FallbackSecretStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("FallbackSecretStore")
            .field("primary", &self.primary)
            .field("fallback", &self.fallback)
            .finish()
    }
}

#[async_trait]
impl SecretStore for FallbackSecretStore {
    async fn store(&self, account: &str, key: &str) -> Result<()> {
        match tokio::time::timeout(self.primary_timeout, self.primary.store(account, key)).await {
            Ok(Ok(())) => Ok(()),
            Ok(Err(primary_err)) => {
                tracing::warn!(
                    account,
                    "OS keychain store failed; falling back to encrypted secret store: {primary_err}"
                );
                self.fallback.store(account, key).await
            }
            Err(_) => {
                tracing::warn!(
                    account,
                    timeout_secs = self.primary_timeout.as_secs_f32(),
                    "OS keychain store timed out; falling back to encrypted secret store"
                );
                self.fallback.store(account, key).await
            }
        }
    }

    async fn load(&self, account: &str) -> Result<String> {
        match tokio::time::timeout(self.primary_timeout, self.primary.load(account)).await {
            Ok(Ok(val)) => Ok(val),
            Ok(Err(primary_err)) => match self.fallback.load(account).await {
                Ok(val) => Ok(val),
                Err(_) => Err(primary_err),
            },
            Err(_) => match self.fallback.load(account).await {
                Ok(val) => Ok(val),
                Err(_) => Err(ProviderError::Auth(format!(
                    "keychain timed out after {}s",
                    self.primary_timeout.as_secs()
                ))),
            },
        }
    }

    async fn delete(&self, account: &str) -> Result<()> {
        let _ = tokio::time::timeout(self.primary_timeout, self.primary.delete(account)).await;
        let _ = self.fallback.delete(account).await;
        Ok(())
    }
}

static GLOBAL_FALLBACK_STORE: StdRwLock<Option<Arc<dyn SecretStore>>> = StdRwLock::new(None);

/// Register a global fallback secret store used by adapter key loading/storage helpers.
pub fn set_fallback_store(store: Arc<dyn SecretStore>) {
    if let Ok(mut lock) = GLOBAL_FALLBACK_STORE.write() {
        *lock = Some(store);
    }
}

/// Clear any registered global fallback secret store.
pub fn clear_fallback_store() {
    if let Ok(mut lock) = GLOBAL_FALLBACK_STORE.write() {
        *lock = None;
    }
}

/// Retrieve the currently registered global fallback secret store, if any.
pub fn fallback_store() -> Option<Arc<dyn SecretStore>> {
    GLOBAL_FALLBACK_STORE
        .read()
        .ok()
        .and_then(|lock| lock.clone())
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn store_load_and_delete_round_trip() {
        let store = InMemorySecretStore::new();

        store
            .store("open_router", "sk-or-canary")
            .await
            .expect("stored");
        assert_eq!(
            store.load("open_router").await.expect("loaded"),
            "sk-or-canary"
        );
        assert_eq!(
            store.key_for("open_router").as_deref(),
            Some("sk-or-canary")
        );

        store.delete("open_router").await.expect("deleted");
        assert!(store.load("open_router").await.is_err());
        // Deleting what is not there is not an error: removal is idempotent.
        store.delete("open_router").await.expect("delete again");
    }

    #[tokio::test]
    async fn two_providers_do_not_share_one_entry() {
        let store = InMemorySecretStore::new();
        store
            .store("open_router", "sk-or-canary")
            .await
            .expect("stored");
        store
            .store("deep_seek", "sk-ds-canary")
            .await
            .expect("stored");

        assert_eq!(store.accounts(), vec!["deep_seek", "open_router"]);
        assert_eq!(
            store.load("open_router").await.expect("loaded"),
            "sk-or-canary"
        );
        assert_eq!(
            store.load("deep_seek").await.expect("loaded"),
            "sk-ds-canary"
        );

        // Removing one leaves the other alone.
        store.delete("open_router").await.expect("deleted");
        assert_eq!(
            store.load("deep_seek").await.expect("loaded"),
            "sk-ds-canary"
        );
    }

    #[tokio::test]
    async fn a_re_store_replaces_the_previous_key() {
        let store = InMemorySecretStore::new();
        store.store("kimi", "sk-old").await.expect("stored");
        store.store("kimi", "sk-new").await.expect("replaced");

        assert_eq!(store.load("kimi").await.expect("loaded"), "sk-new");
        assert_eq!(store.accounts(), vec!["kimi"]);
    }

    #[tokio::test]
    async fn debug_prints_accounts_and_not_keys() {
        let store = InMemorySecretStore::new();
        store.store("glm", "sk-glm-canary").await.expect("stored");

        let rendered = format!("{store:?}");
        assert!(rendered.contains("glm"), "the account is not a secret");
        // `HashMap`'s own `Debug` would print the value, so this store must not
        // derive it — this is the assertion that keeps that true.
        assert!(
            !rendered.contains("sk-glm-canary"),
            "a key must never be printable: {rendered}"
        );
    }

    #[test]
    fn the_keychain_store_names_the_service_and_the_account() -> Result<()> {
        let credentials = KeychainSecretStore::credentials("my-gateway");
        match credentials {
            CredentialsRef::Keychain { service, account } => {
                assert_eq!(service, PROVIDER_KEYCHAIN_SERVICE);
                assert_eq!(account, "my-gateway");
                Ok(())
            }
            other => Err(ProviderError::Auth(format!(
                "expected a keychain reference, got {other:?}"
            ))),
        }
    }

    #[derive(Debug)]
    struct FailingSecretStore;

    #[async_trait]
    impl SecretStore for FailingSecretStore {
        async fn store(&self, _account: &str, _key: &str) -> Result<()> {
            Err(ProviderError::Auth("keychain is locked".to_string()))
        }
        async fn load(&self, _account: &str) -> Result<String> {
            Err(ProviderError::Auth("keychain is locked".to_string()))
        }
        async fn delete(&self, _account: &str) -> Result<()> {
            Err(ProviderError::Auth("keychain is locked".to_string()))
        }
    }

    #[derive(Debug)]
    struct HangingSecretStore;

    #[async_trait]
    impl SecretStore for HangingSecretStore {
        async fn store(&self, _account: &str, _key: &str) -> Result<()> {
            tokio::time::sleep(Duration::from_secs(60)).await;
            Ok(())
        }
        async fn load(&self, _account: &str) -> Result<String> {
            tokio::time::sleep(Duration::from_secs(60)).await;
            Ok("hung".to_string())
        }
        async fn delete(&self, _account: &str) -> Result<()> {
            tokio::time::sleep(Duration::from_secs(60)).await;
            Ok(())
        }
    }

    #[tokio::test]
    async fn keychain_primary_does_not_create_file_or_consult_fallback() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let fallback = Arc::new(EncryptedFileSecretStore::new(tmp.path()).expect("store"));
        let primary = Arc::new(InMemorySecretStore::new());
        let store = FallbackSecretStore::new(primary.clone(), fallback.clone());

        store
            .store("openai", "sk-secret-key-1234")
            .await
            .expect("stored");

        // Primary has the key
        assert_eq!(
            primary.load("openai").await.expect("loaded"),
            "sk-secret-key-1234"
        );

        // Fallback file was NOT created
        assert!(
            !fallback.file_path().exists(),
            "fallback file must not exist when primary succeeds"
        );
    }

    #[tokio::test]
    async fn fallback_on_lock_stores_to_encrypted_file() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let fallback = Arc::new(EncryptedFileSecretStore::new(tmp.path()).expect("store"));
        let primary = Arc::new(FailingSecretStore);
        let store = FallbackSecretStore::new(primary, fallback.clone());

        let secret_key = "sk-fallback-test-secret-9999";
        store
            .store("openai", secret_key)
            .await
            .expect("stored to fallback");

        // File exists
        assert!(fallback.file_path().exists(), "fallback file must exist");

        // Raw bytes do not contain secret_key
        let raw_bytes = std::fs::read(fallback.file_path()).expect("read file");
        let raw_content = String::from_utf8_lossy(&raw_bytes);
        assert!(
            !raw_content.contains(secret_key),
            "raw content must never contain plaintext secret"
        );
    }

    #[tokio::test]
    async fn encrypted_at_rest_permissions_and_ciphertext() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let store = EncryptedFileSecretStore::new(tmp.path()).expect("store");
        let secret_key = "sk-plaintext-must-not-appear-on-disk";

        store
            .store("test-provider", secret_key)
            .await
            .expect("stored");

        assert!(store.file_path().exists());
        assert!(store.key_path().exists());

        let raw_file = std::fs::read(store.file_path()).expect("read file");
        let raw_key = std::fs::read(store.key_path()).expect("read key file");

        assert_eq!(raw_key.len(), 32);
        assert!(!String::from_utf8_lossy(&raw_file).contains(secret_key));

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let file_perms = std::fs::metadata(store.file_path())
                .expect("metadata")
                .permissions()
                .mode();
            let key_perms = std::fs::metadata(store.key_path())
                .expect("metadata")
                .permissions()
                .mode();
            assert_eq!(file_perms & 0o777, 0o600, "secrets file must be 0600");
            assert_eq!(key_perms & 0o777, 0o600, "key file must be 0600");
        }
    }

    #[tokio::test]
    async fn read_from_fallback_when_keychain_fails() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let fallback = Arc::new(EncryptedFileSecretStore::new(tmp.path()).expect("store"));
        let primary = Arc::new(FailingSecretStore);
        let store = FallbackSecretStore::new(primary, fallback.clone());

        // Pre-populate fallback
        fallback
            .store("anthropic", "sk-ant-fallback-key")
            .await
            .expect("stored");

        // Store load falls back to encrypted file
        let loaded = store.load("anthropic").await.expect("loaded from fallback");
        assert_eq!(loaded, "sk-ant-fallback-key");
    }

    #[tokio::test]
    async fn no_logging_of_secrets() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let store = EncryptedFileSecretStore::new(tmp.path()).expect("store");
        let sensitive_key = "sk-ultra-secret-key-material-do-not-leak";

        // Debug output does not leak
        let debug_str = format!("{store:?}");
        assert!(!debug_str.contains(sensitive_key));

        let fallback_store = FallbackSecretStore::new(
            Arc::new(InMemorySecretStore::new()),
            Arc::new(store.clone()),
        );
        let fb_debug = format!("{fallback_store:?}");
        assert!(!fb_debug.contains(sensitive_key));

        // Non-existent key error does not leak
        let err = store.load("missing_provider").await.unwrap_err();
        let err_str = err.to_string();
        assert!(!err_str.contains(sensitive_key));
        assert!(err_str.contains("no API key is stored for provider missing_provider"));

        // Corrupted file error does not leak key
        std::fs::write(store.file_path(), b"corrupted data").expect("write corrupt");
        let err = store.load("test").await.unwrap_err();
        let err_str = err.to_string();
        assert!(err_str.contains("fallback load failed"));
        assert!(!err_str.contains(sensitive_key));
    }

    #[tokio::test]
    async fn delete_semantics_removes_from_both_and_is_idempotent() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let fallback = Arc::new(EncryptedFileSecretStore::new(tmp.path()).expect("store"));
        let primary = Arc::new(InMemorySecretStore::new());
        let store = FallbackSecretStore::new(primary.clone(), fallback.clone());

        // Store in both
        primary
            .store("openai", "key-primary")
            .await
            .expect("primary store");
        fallback
            .store("openai", "key-fallback")
            .await
            .expect("fallback store");

        assert!(primary.load("openai").await.is_ok());
        assert!(fallback.load("openai").await.is_ok());

        // Delete removes from both
        store.delete("openai").await.expect("delete");
        assert!(primary.load("openai").await.is_err());
        assert!(fallback.load("openai").await.is_err());

        // Second delete is idempotent Ok
        store.delete("openai").await.expect("second delete is ok");
    }

    #[tokio::test]
    async fn fallback_on_keychain_timeout() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let fallback = Arc::new(EncryptedFileSecretStore::new(tmp.path()).expect("store"));
        let primary = Arc::new(HangingSecretStore);
        let store = FallbackSecretStore::new(primary, fallback.clone())
            .with_primary_timeout(Duration::from_millis(50));

        let secret = "sk-timeout-key";
        store
            .store("openai", secret)
            .await
            .expect("stored despite timeout");
        assert_eq!(fallback.load("openai").await.expect("loaded"), secret);

        let loaded = store
            .load("openai")
            .await
            .expect("loaded despite primary timeout");
        assert_eq!(loaded, secret);
    }
}
