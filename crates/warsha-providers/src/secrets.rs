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
use std::sync::Mutex;

use async_trait::async_trait;
use warsha_core::CredentialsRef;

use crate::{delete_key, load_key, store_key, ProviderError, Result};

/// The keychain service every Warsha provider key is stored under.
///
/// One service for all providers, with the owner's name for the provider as the
/// account: a fixed service is what makes the entries findable (and wipeable) as
/// a group, and the per-provider account is what keeps them apart.
pub const PROVIDER_KEYCHAIN_SERVICE: &str = "warsha-provider";

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

/// An in-process secret store: the test double, and nothing the daemon defaults to.
///
/// It is deliberately not a file-backed store. The point of the keychain is that
/// the secret never touches the disk the configuration is on, and a fallback file
/// would be exactly the plaintext key the OS keychain exists to avoid.
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

#[cfg(test)]
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
    fn the_keychain_store_names_the_service_and_the_account() {
        let credentials = KeychainSecretStore::credentials("my-gateway");
        match credentials {
            CredentialsRef::Keychain { service, account } => {
                assert_eq!(service, PROVIDER_KEYCHAIN_SERVICE);
                assert_eq!(account, "my-gateway");
            }
            other => panic!("expected a keychain reference, got {other:?}"),
        }
    }
}
