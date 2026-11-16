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

// TODO: Implement refresh_catalog with RPC and diffing logic.
// This will require daemon-side RPC hook to fetch from URL, verify, and store.

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
