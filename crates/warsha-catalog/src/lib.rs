use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

pub const CATALOG_JSON: &str = include_str!("../../../data/catalog/api.json");

pub fn get_catalog_digest() -> String {
    let mut hasher = Sha256::new();
    hasher.update(CATALOG_JSON.as_bytes());
    hex::encode(hasher.finalize())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelCost {
    pub input: f64,
    pub output: f64,
    #[serde(default)]
    pub cache_read: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Model {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub cost: Option<ModelCost>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Vendor {
    pub id: String,
    pub name: String,
    pub models: HashMap<String, Model>,
}

pub type Catalog = HashMap<String, Vendor>;

pub fn parse_catalog() -> anyhow::Result<Catalog> {
    serde_json::from_str(CATALOG_JSON)
        .map_err(|e| anyhow::anyhow!("Failed to parse catalog: {}", e))
}

pub struct CatalogDiff {
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub price_changed: Vec<String>,
}

pub struct CatalogWrapper(pub Catalog);

impl CatalogWrapper {
    pub fn compute_diff(&self, _new: &Catalog) -> CatalogDiff {
        // TODO: Implement actual diff logic
        CatalogDiff {
            added: vec![],
            removed: vec![],
            price_changed: vec![],
        }
    }
}

pub fn refresh_catalog(downloaded_bytes: &[u8], current: &Catalog) -> anyhow::Result<(Catalog, CatalogDiff)> {
    if downloaded_bytes.len() > 8 * 1024 * 1024 {
        return Err(anyhow::anyhow!("Download exceeds 8MB size limit"));
    }

    let new_catalog: Catalog = serde_json::from_slice(downloaded_bytes)
        .map_err(|e| anyhow::anyhow!("Failed to parse catalog: {}", e))?;

    let diff = CatalogWrapper(current.clone()).compute_diff(&new_catalog);

    Ok((new_catalog, diff))
}

pub fn apply_catalog(catalog: Catalog, _diff: &CatalogDiff) -> Catalog {
    // TODO: Implement apply logic
    catalog
}

// TODO: Implement daemon-side RPC hook to fetch from URL, verify, and store.
// Daemon method needed: `catalog::refresh() -> Result<CatalogUpdateInfo>`

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_catalog_digest() {
        let expected_digest = "a5cd1e38815591e227991fc1a637fd78e85b3e140376ea1ddd16a65ee979cdf0";
        assert_eq!(get_catalog_digest(), expected_digest);
    }

    #[test]
    fn test_parse_catalog() {
        let catalog = parse_catalog().expect("Catalog should parse");
        assert!(!catalog.is_empty());
    }
}
