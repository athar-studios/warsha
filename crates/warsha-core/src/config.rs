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
    /// Modification time, if available.
    pub mtime: Option<DateTime<Utc>>,
    /// Whether the entry is protected and content should not be served.
    #[serde(default)]
    pub protected: bool,
    /// Short git porcelain status code (e.g. `"M"`, `"A"`, `"??"`), when in a git repo.
    #[serde(default)]
    pub git_status: Option<String>,
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

/// Side-by-side diff payload for one file (`files.diff`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileDiff {
    /// Path the diff was built for, relative to the browsing root.
    pub path: String,
    /// Git ref used for the base side (e.g. `"HEAD"` or a run base commit SHA).
    pub base_ref: String,
    /// File text at `base_ref` (empty string when the file does not exist at `base_ref`).
    pub base_content: String,
    /// Current file text on disk.
    pub current_content: String,
    /// Best-guess MIME type, e.g. `text/rust`.
    pub mime_type: String,
}

/// Owner-written definition of a custom coding CLI backend (R-NEXT N2).
///
/// Contains NO secrets: API keys stay in the OS keychain or host environment;
/// `env_names` names only the environment variables to forward.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CustomBackendDefinition {
    /// Canonical identifier used to select this backend (e.g. `"my-custom-cli"`).
    pub name: String,
    /// Human-friendly display label.
    pub display_name: String,
    /// Executable name on PATH or absolute path.
    pub executable: String,
    /// Argument template containing a `{prompt}` placeholder.
    pub args_template: Vec<String>,
    /// Output format: `"plain"`, `"stream-json"`, or `"jsonl"`.
    pub output_format: String,
    /// Environment variable names to forward (no secret values stored here).
    #[serde(default)]
    pub env_names: Vec<String>,
    /// Optional permission mapping reference (e.g. `"claude-code"`, `"codex-cli"`).
    #[serde(default)]
    pub permission_mapping: Option<String>,
}

impl CustomBackendDefinition {
    /// Validate a custom backend definition.
    pub fn validate(&self) -> Result<(), String> {
        if self.name.trim().is_empty() {
            return Err("custom backend name cannot be empty".to_string());
        }
        if self.executable.trim().is_empty() {
            return Err(format!(
                "custom backend `{}` has missing or empty executable",
                self.name
            ));
        }
        if !self
            .args_template
            .iter()
            .any(|arg| arg.contains("{prompt}"))
        {
            return Err(format!(
                "custom backend `{}` is missing required `{{prompt}}` placeholder in args_template",
                self.name
            ));
        }
        if !matches!(
            self.output_format.as_str(),
            "plain" | "stream-json" | "jsonl"
        ) {
            return Err(format!(
                "custom backend `{}` has unknown output format `{}`",
                self.name, self.output_format
            ));
        }
        Ok(())
    }

    /// Returns true if any argument carries a permission-skipping flag.
    ///
    /// Custom backends are permitted to carry these flags (unlike shipped catalog entries);
    /// this boolean provides the warning data surfaced to the owner.
    pub fn has_permission_skipping_flag(&self) -> bool {
        const SKIP_SUBSTRINGS: &[&str] = &[
            "dangerously-skip-permissions",
            "dangerously-bypass-approvals-and-sandbox",
            "bypass-permissions",
            "skip-permissions",
            "no-verify",
        ];
        self.args_template
            .iter()
            .any(|arg| SKIP_SUBSTRINGS.iter().any(|sub| arg.contains(sub)))
    }
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
            mtime: None,
            protected: false,
            git_status: Some("M".to_string()),
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

        let diff = FileDiff {
            path: "docs/README.md".to_string(),
            base_ref: "HEAD".to_string(),
            base_content: "# Old".to_string(),
            current_content: "# Warsha".to_string(),
            mime_type: "text/markdown".to_string(),
        };
        let encoded = serde_json::to_string(&diff).expect("encodes");
        assert_eq!(
            serde_json::from_str::<FileDiff>(&encoded).expect("decodes"),
            diff
        );
    }

    #[test]
    fn custom_backend_definition_validates_and_detects_skip_flags() {
        let valid = CustomBackendDefinition {
            name: "my-cli".to_string(),
            display_name: "My CLI".to_string(),
            executable: "my-cli".to_string(),
            args_template: vec!["run".to_string(), "{prompt}".to_string()],
            output_format: "plain".to_string(),
            env_names: vec!["API_KEY".to_string()],
            permission_mapping: None,
        };
        assert!(valid.validate().is_ok());
        assert!(!valid.has_permission_skipping_flag());

        let mut invalid_exe = valid.clone();
        invalid_exe.executable = "".to_string();
        assert!(invalid_exe.validate().is_err());

        let mut invalid_prompt = valid.clone();
        invalid_prompt.args_template = vec!["run".to_string()];
        assert!(invalid_prompt.validate().is_err());

        let mut invalid_format = valid.clone();
        invalid_format.output_format = "xml".to_string();
        assert!(invalid_format.validate().is_err());

        let mut skipping = valid.clone();
        skipping.args_template = vec![
            "--dangerously-skip-permissions".to_string(),
            "{prompt}".to_string(),
        ];
        assert!(skipping.validate().is_ok());
        assert!(skipping.has_permission_skipping_flag());
    }
}
