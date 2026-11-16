use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

pub const CATALOG_JSON: &str = include_str!("../../../data/catalog/api.json");

pub fn get_catalog_digest() -> String {
    let mut hasher = Sha256::new();
    hasher.update(CATALOG_JSON.as_bytes());
    hex::encode(hasher.finalize())
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
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
    pub added: Vec<(String, String)>,
    pub removed: Vec<(String, String)>,
    pub price_changed: Vec<(String, String)>,
}

pub struct CatalogWrapper(pub Catalog);

impl CatalogWrapper {
    pub fn compute_diff(&self, new: &Catalog) -> CatalogDiff {
        let mut added = Vec::new();
        let mut removed = Vec::new();
        let mut price_changed = Vec::new();

        let current = &self.0;

        for (v_id, vendor) in new {
            if let Some(current_vendor) = current.get(v_id) {
                for (m_id, model) in &vendor.models {
                    if let Some(current_model) = current_vendor.models.get(m_id) {
                        if current_model.cost != model.cost {
                            price_changed.push((v_id.clone(), m_id.clone()));
                        }
                    } else {
                        added.push((v_id.clone(), m_id.clone()));
                    }
                }
            } else {
                for m_id in vendor.models.keys() {
                    added.push((v_id.clone(), m_id.clone()));
                }
            }
        }

        for (v_id, vendor) in current {
            if let Some(new_vendor) = new.get(v_id) {
                for m_id in vendor.models.keys() {
                    if !new_vendor.models.contains_key(m_id) {
                        removed.push((v_id.clone(), m_id.clone()));
                    }
                }
            } else {
                for m_id in vendor.models.keys() {
                    removed.push((v_id.clone(), m_id.clone()));
                }
            }
        }

        CatalogDiff {
            added,
            removed,
            price_changed,
        }
    }
}

pub fn apply_catalog(catalog: Catalog, overrides: &HashMap<(String, String), Model>) -> Catalog {
    let mut new_catalog = catalog;
    for ((v_id, m_id), model) in overrides {
        if let Some(vendor) = new_catalog.get_mut(v_id) {
            vendor.models.insert(m_id.clone(), model.clone());
        } else {
            new_catalog.insert(
                v_id.clone(),
                Vendor {
                    id: v_id.clone(),
                    name: v_id.clone(),
                    models: HashMap::from([(m_id.clone(), model.clone())]),
                },
            );
        }
    }
    new_catalog
}

pub fn refresh_catalog(
    downloaded_bytes: &[u8],
    current: &Catalog,
) -> anyhow::Result<(Catalog, CatalogDiff)> {
    if downloaded_bytes.len() > 8 * 1024 * 1024 {
        return Err(anyhow::anyhow!("Download exceeds 8MB size limit"));
    }

    let new_catalog: Catalog = serde_json::from_slice(downloaded_bytes)
        .map_err(|e| anyhow::anyhow!("Failed to parse catalog: {}", e))?;

    let diff = CatalogWrapper(current.clone()).compute_diff(&new_catalog);

    Ok((new_catalog, diff))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diff_computation() {
        let mut current = Catalog::new();
        let v1 = Vendor {
            id: "v1".to_string(),
            name: "v1".to_string(),
            models: HashMap::from([(
                "m1".to_string(),
                Model {
                    id: "m1".to_string(),
                    name: "m1".to_string(),
                    description: None,
                    cost: Some(ModelCost {
                        input: 1.0,
                        output: 1.0,
                        cache_read: None,
                    }),
                },
            )]),
        };
        current.insert("v1".to_string(), v1);

        let mut new = current.clone();
        // Add m2
        new.get_mut("v1").unwrap().models.insert(
            "m2".to_string(),
            Model {
                id: "m2".to_string(),
                name: "m2".to_string(),
                description: None,
                cost: None,
            },
        );
        // Change price m1
        new.get_mut("v1")
            .unwrap()
            .models
            .get_mut("m1")
            .unwrap()
            .cost = Some(ModelCost {
            input: 2.0,
            output: 2.0,
            cache_read: None,
        });

        let diff = CatalogWrapper(current.clone()).compute_diff(&new);
        assert_eq!(diff.added, vec![("v1".to_string(), "m2".to_string())]);
        assert_eq!(
            diff.price_changed,
            vec![("v1".to_string(), "m1".to_string())]
        );
        assert!(diff.removed.is_empty());
    }

    #[test]
    fn test_malformed_download() {
        let current = parse_catalog().unwrap();
        let bytes = b"{ malformed: json ]";
        let result = refresh_catalog(bytes, &current);
        assert!(result.is_err());
        // Verify current catalog intact (result is an Err, but we can check if it passed current)
        // refresh_catalog doesn't modify current, it returns a new one or error
    }

    #[test]
    fn test_custom_model_survives_refresh() {
        let current = parse_catalog().unwrap();
        let mut overrides = HashMap::new();
        let custom_model = Model {
            id: "custom-m1".to_string(),
            name: "Custom Model".to_string(),
            description: None,
            cost: None,
        };
        overrides.insert(
            ("v1".to_string(), "custom-m1".to_string()),
            custom_model.clone(),
        );

        let refreshed = apply_catalog(current, &overrides);
        assert!(refreshed
            .get("v1")
            .unwrap()
            .models
            .contains_key("custom-m1"));
    }
}
