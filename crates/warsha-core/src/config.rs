//! Custom models, integrations and file browsing types (PLAN.md Wave 2).
//!
//! These are the settings-shaped records the desktop config screens read and
//! write through the daemon: user-added models that sit beside the built-in
//! catalogue, the connection status and configuration of external
//! integrations, the result of a live integration test, and the two shapes
//! the in-app file browser moves around.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// A user-registered model on a known provider, beyond the built-in catalogue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CustomModelRecord {
    /// Provider the model belongs to, e.g. `open_router`.
    pub provider: String,
    /// Model id as the provider names it.
    pub model_id: String,
    /// Display label shown in pickers; falls back to `model_id` when absent.
    pub display_name: Option<String>,
    /// Context window in tokens, when the user declared one.
    pub context_window: Option<u32>,
    /// Whether the model may be routed to.
    pub enabled: bool,
}

/// The status of one external integration (GitHub, Slack, ...).
///
/// `details` carries whatever the integration wants to show — org name, bot
/// identity, last sync — as opaque JSON; the store persists it, the UI renders
/// it, and nothing in between interprets it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IntegrationStatus {
    /// Stable integration identifier, e.g. `github`.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Whether the integration currently connects.
    pub connected: bool,
    /// When it was last configured, if ever.
    pub configured_at: Option<DateTime<Utc>>,
    /// Free-form status details shown beside the connection state.
    pub details: Option<serde_json::Value>,
}

/// The configuration the owner supplies for one integration.
///
/// Token material is *not* durable here: `token` and `bot_token` exist so the
/// settings RPC can carry them into the keychain on the way in; a read that
/// returns them has already redacted them to `None`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct IntegrationConfig {
    /// Personal access token, accepted on write, never echoed on read.
    pub token: Option<String>,
    /// Webhook endpoint the integration posts to.
    pub webhook_url: Option<String>,
    /// Bot token (e.g. Slack), accepted on write, never echoed on read.
    pub bot_token: Option<String>,
    /// Default channel or conversation to act in.
    pub channel: Option<String>,
    /// Organisation, workspace or account slug.
    pub org: Option<String>,
}

/// The outcome of a live integration test ("check connection").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IntegrationTestResult {
    /// Coarse status: `ok`, `error`, `unconfigured`.
    pub status: String,
    /// Human-readable message: what succeeded, or the first failure worth
    /// showing the owner.
    pub message: String,
}

/// One entry in a directory listing for the in-app file browser.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileEntry {
    /// Base name of the entry.
    pub name: String,
    /// Full path relative to the browsing root.
    pub path: String,
    /// Whether the entry is a directory.
    pub is_dir: bool,
    /// Size in bytes for files; 0 for directories.
    pub size_bytes: u64,
}

/// The text content of one file, for the viewer pane.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileContent {
    /// Path the content was read from, relative to the browsing root.
    pub path: String,
    /// The file's text; binary files are rejected before this is built.
    pub content: String,
    /// Best-guess MIME type, e.g. `text/markdown` or `application/json`.
    pub mime_type: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_model_round_trips_through_json() {
        let model = CustomModelRecord {
            provider: "open_router".to_string(),
            model_id: "qwen/qwen3-coder".to_string(),
            display_name: Some("Qwen Coder".to_string()),
            context_window: Some(262_144),
            enabled: true,
        };
        let encoded = serde_json::to_string(&model).expect("encodes");
        let decoded: CustomModelRecord = serde_json::from_str(&encoded).expect("decodes");
        assert_eq!(decoded, model);
    }

    #[test]
    fn integration_status_round_trips_with_details() {
        let status = IntegrationStatus {
            id: "github".to_string(),
            name: "GitHub".to_string(),
            connected: true,
            configured_at: Some(DateTime::from_timestamp(1_735_689_600, 0).unwrap_or_default()),
            details: Some(serde_json::json!({ "org": "warsha" })),
        };
        let encoded = serde_json::to_string(&status).expect("encodes");
        let decoded: IntegrationStatus = serde_json::from_str(&encoded).expect("decodes");
        assert_eq!(decoded.id, status.id);
        assert_eq!(decoded.connected, status.connected);
        assert_eq!(decoded.configured_at, status.configured_at);
    }

    #[test]
    fn integration_config_defaults_to_all_empty() {
        let config = IntegrationConfig::default();
        assert_eq!(config.token, None);
        assert_eq!(config.webhook_url, None);
        assert_eq!(config.bot_token, None);
        assert_eq!(config.channel, None);
        assert_eq!(config.org, None);
    }

    #[test]
    fn file_shapes_round_trip() {
        let entry = FileEntry {
            name: "README.md".to_string(),
            path: "docs/README.md".to_string(),
            is_dir: false,
            size_bytes: 1_024,
        };
        let encoded = serde_json::to_string(&entry).expect("encodes");
        assert_eq!(
            serde_json::from_str::<FileEntry>(&encoded).expect("decodes"),
            entry
        );

        let content = FileContent {
            path: "docs/README.md".to_string(),
            content: "# Warsha".to_string(),
            mime_type: "text/markdown".to_string(),
        };
        let encoded = serde_json::to_string(&content).expect("encodes");
        assert_eq!(
            serde_json::from_str::<FileContent>(&encoded).expect("decodes"),
            content
        );
    }
}
