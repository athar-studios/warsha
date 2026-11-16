use crate::secrets::SecretStore;
use crate::{ProviderError, Result};

/// A wrapper around a `SecretStore` that supports chunking for tokens.
#[derive(Debug, Clone)]
pub struct ChunkedSecretStore<S: SecretStore> {
    inner: S,
    chunk_size: usize,
}

impl<S: SecretStore> ChunkedSecretStore<S> {
    pub fn new(inner: S) -> Self {
        Self {
            inner,
            chunk_size: 256, // Safe limit for most platforms
        }
    }

    pub async fn store(&self, account: &str, secret: &str) -> Result<()> {
        let bytes = secret.as_bytes();
        let chunks: Vec<&[u8]> = bytes.chunks(self.chunk_size).collect();

        // Store number of chunks
        self.inner
            .store(&format!("{account}_chunks"), &chunks.len().to_string())
            .await?;

        for (i, chunk) in chunks.iter().enumerate() {
            let chunk_str = String::from_utf8_lossy(chunk);
            self.inner
                .store(&format!("{account}_chunk_{i}"), &chunk_str)
                .await?;
        }
        Ok(())
    }

    pub async fn load(&self, account: &str) -> Result<String> {
        let num_chunks_str = self.inner.load(&format!("{account}_chunks")).await?;
        let num_chunks: usize = num_chunks_str
            .parse()
            .map_err(|_| ProviderError::Auth("invalid chunk count".into()))?;

        let mut secret = String::new();
        for i in 0..num_chunks {
            let chunk = self.inner.load(&format!("{account}_chunk_{i}")).await?;
            secret.push_str(&chunk);
        }
        Ok(secret)
    }

    pub async fn delete(&self, account: &str) -> Result<()> {
        let num_chunks_str = self.inner.load(&format!("{account}_chunks")).await?;
        if let Ok(count) = num_chunks_str.parse::<usize>() {
            for i in 0..count {
                let _ = self.inner.delete(&format!("{account}_chunk_{i}")).await;
            }
        }
        let _ = self.inner.delete(&format!("{account}_chunks")).await;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::InMemorySecretStore;
    use std::sync::Arc;

    #[tokio::test]
    async fn chunked_store_round_trip() {
        let inner = Arc::new(InMemorySecretStore::new());
        let store = ChunkedSecretStore::new(Arc::clone(&inner));
        let secret = "a".repeat(1000); // Larger than 256 chunk size

        store.store("test_account", &secret).await.expect("stored");
        let loaded = store.load("test_account").await.expect("loaded");
        assert_eq!(loaded, secret);

        store.delete("test_account").await.expect("deleted");
        assert!(store.load("test_account").await.is_err());
    }
}
