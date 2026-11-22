//! MCP approvals on the daemon side: the argument summary the owner is shown, the
//! two RPC reply shapes, and the audit event an answer writes.
//!
//! The pipeline crate owns the registry ([`warsha_pipeline::McpApprovals`]) and the
//! decision rules; what only the daemon can do is redact. Its scrubber — the key-name
//! table, the token shapes and the URL query mask — lives in [`crate::state`] and
//! `warsha_core::mask_secrets`, so the summarizer is built here and handed to the
//! registry as the [`ArgumentSummarizer`] seam.
//!
//! Three rules hold the summary to what the owner may be shown:
//!
//! - **Redacted first.** A value is replaced with `[REDACTED]` when its key is a known
//!   secret name, when the tool's own schema marks it secret (`writeOnly: true` or
//!   `format: "password"`), when its text carries the daemon's own token or a
//!   token-shaped string, or when [`warsha_core::mask_secrets`] would mask it. Every
//!   check runs before any truncation, so a cut cannot reveal a value the full one
//!   would have hidden.
//! - **Bounded.** At most [`MAX_SUMMARY_KEYS`] top-level keys, a string cut at
//!   [`MAX_SUMMARY_VALUE_CHARS`], a nested object or array named and not entered
//!   (`{N keys}`, `[N items]`), and the whole thing at
//!   [`warsha_pipeline::mcp_approval::MAX_SUMMARY_CHARS`].
//! - **Not forgeable.** Every value is rendered through `serde_json::to_string`, so a
//!   newline or a control character arrives escaped: a value cannot add a line to the
//!   question the owner reads.
//!
//! A value that is none of key-named, schema-marked or token-shaped cannot be
//! recognised as a secret by any filter. That limit is stated in the packet (open
//! question O8); the tests assert the marked ones and claim nothing more.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use warsha_core::{DeviceId, Event, EventKind, RunId, Stage};
use warsha_pipeline::mcp_approval::{
    cap_chars, truncate_summary, ArgumentSummarizer, Grant, PendingApprovalView, MAX_SUMMARY_KEYS,
};

use crate::state::{redact_string, REDACTED, SECRET_KEY_NAMES};

/// How much of one string value a summary shows before it is cut.
pub const MAX_SUMMARY_VALUE_CHARS: usize = 80;

/// The status a pending approval is reported with, as `mcp.approvals.list` returns it.
///
/// The fields are exactly what an owner needs to decide, and nothing else: the raw
/// arguments are not here, because a value the summarizer redacted must not be
/// reachable through the same reply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpApproval {
    /// The question id, unique per ask.
    pub id: String,
    /// The run that asked.
    pub run_id: String,
    /// The MCP server the call names.
    pub server: String,
    /// The tool the call names.
    pub tool: String,
    /// The role the call is checked under (always `MCP_AGENT_ROLE`, `agent`, today).
    pub role: String,
    /// The bounded, redacted rendering of the arguments.
    pub summary: String,
    /// When the ask was registered, ISO-8601.
    pub requested_at: String,
}

/// What `mcp.approvals.allow_once` granted, as the caller receives it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpApprovalAnswer {
    /// The question id that was answered.
    pub id: String,
    /// The run the grant is bound to.
    pub run_id: String,
    /// The MCP server the grant admits.
    pub server: String,
    /// The tool the grant admits.
    pub tool: String,
    /// The role the grant admits.
    pub role: String,
    /// The device the session authenticated; never a request parameter.
    pub granted_by: String,
    /// When the grant lapses, ISO-8601.
    pub expires_at: String,
}

impl From<&Grant> for McpApprovalAnswer {
    fn from(grant: &Grant) -> Self {
        Self {
            id: grant.question_id.clone(),
            run_id: grant.run_id.clone(),
            server: grant.server.clone(),
            tool: grant.tool.clone(),
            role: grant.role.clone(),
            granted_by: grant.granted_by.clone(),
            expires_at: grant.expires_at_rfc3339.clone(),
        }
    }
}

/// The event one `allow_once` answer appends.
///
/// The payload carries the four things an audit trail needs — which server, which
/// tool, which role, which question — and never an argument or a summary. The device
/// is the authenticated one, so the record says who answered without the caller
/// being able to name themselves.
pub fn allow_once_event(
    run_id: RunId,
    stage: Stage,
    pending: &PendingApprovalView,
    granted_by: DeviceId,
) -> Event {
    Event {
        id: ulid::Ulid::new(),
        run_id,
        stage,
        role: None,
        kind: EventKind::ToolCall,
        payload: serde_json::json!({
            "action": "mcp_allow_once",
            "server": pending.server,
            "tool": pending.tool,
            "role": pending.role,
            "question_id": pending.id,
        }),
        cost_cents: None,
        tokens: None,
        created_at: Utc::now(),
        device_id: Some(granted_by),
    }
}

/// The daemon's [`ArgumentSummarizer`]: redacted, bounded, not forgeable.
#[derive(Debug, Clone, Default)]
pub struct DaemonSummarizer {
    /// The daemon's own bearer token, so a value that echoes it is recognised.
    auth_token: String,
}

impl DaemonSummarizer {
    /// A summarizer that also recognises `auth_token` wherever it appears.
    pub fn new(auth_token: impl Into<String>) -> Self {
        Self {
            auth_token: auth_token.into(),
        }
    }

    /// One value rendered for the owner, after the redaction screen.
    fn render_value(
        &self,
        key: &str,
        value: &serde_json::Value,
        input_schema: Option<&serde_json::Value>,
    ) -> String {
        if !key.is_empty() && is_secret_key(key, input_schema) {
            return REDACTED.to_string();
        }
        match value {
            serde_json::Value::String(text) => {
                if self.must_redact(text) {
                    return REDACTED.to_string();
                }
                let rendered = serde_json::to_string(text).unwrap_or_else(|_| REDACTED.to_string());
                // The quotes the JSON rendering adds are the caller's to see; the
                // cap below counts the whole rendering so the bound is exact.
                cap_chars(&rendered, MAX_SUMMARY_VALUE_CHARS)
            }
            serde_json::Value::Object(map) => format!("{{{} keys}}", map.len()),
            serde_json::Value::Array(items) => format!("[{} items]", items.len()),
            other => cap_chars(&other.to_string(), MAX_SUMMARY_VALUE_CHARS),
        }
    }

    /// Whether a string value must be replaced rather than shown.
    fn must_redact(&self, text: &str) -> bool {
        redact_string(text, &self.auth_token) || warsha_core::mask_secrets(text) != text
    }
}

impl ArgumentSummarizer for DaemonSummarizer {
    fn summarize(
        &self,
        _tool: &str,
        arguments: &serde_json::Value,
        input_schema: Option<&serde_json::Value>,
    ) -> String {
        let serde_json::Value::Object(map) = arguments else {
            return truncate_summary(&self.render_value("", arguments, input_schema));
        };
        if map.is_empty() {
            return "{}".to_string();
        }

        let mut keys: Vec<&String> = map.keys().collect();
        keys.sort();
        let total = keys.len();
        let shown: Vec<String> = keys
            .iter()
            .take(MAX_SUMMARY_KEYS)
            .filter_map(|key| {
                map.get(*key).map(|value| {
                    format!(
                        "{}: {}",
                        cap_chars(&printable_key(key), MAX_SUMMARY_KEY_CHARS),
                        self.render_value(key, value, input_schema)
                    )
                })
            })
            .collect();

        let mut summary = shown.join(", ");
        if total > MAX_SUMMARY_KEYS {
            summary.push_str(&format!(", … +{} more keys", total - MAX_SUMMARY_KEYS));
        }
        truncate_summary(&summary)
    }
}

/// The cap on one rendered key, so a long key cannot eat the whole summary.
const MAX_SUMMARY_KEY_CHARS: usize = 60;

/// A key name rendered so it cannot forge a question line.
fn printable_key(key: &str) -> String {
    let escaped = serde_json::to_string(key).unwrap_or_default();
    escaped
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .unwrap_or(key)
        .to_string()
}

/// Whether `key` names a secret, by the daemon's own table or the tool's schema.
fn is_secret_key(key: &str, input_schema: Option<&serde_json::Value>) -> bool {
    let lower = key.to_lowercase();
    if SECRET_KEY_NAMES.contains(&lower.as_str()) {
        return true;
    }
    let Some(property) = input_schema
        .and_then(|schema| schema.get("properties"))
        .and_then(|properties| properties.get(key))
    else {
        return false;
    };
    property.get("writeOnly") == Some(&serde_json::Value::Bool(true))
        || property.get("format").and_then(|format| format.as_str()) == Some("password")
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]
mod tests {
    use super::*;
    use serde_json::json;
    use warsha_pipeline::mcp_permission::MCP_AGENT_ROLE;

    fn summarizer() -> DaemonSummarizer {
        DaemonSummarizer::new("daemon-token")
    }

    #[test]
    fn a_secret_keyed_value_is_redacted_and_a_harmless_one_is_shown() {
        let summary = summarizer().summarize(
            "write",
            &json!({"api_key": "SECRET-1", "path": "notes.md"}),
            None,
        );
        assert!(summary.contains("api_key: [REDACTED]"), "{summary}");
        assert!(!summary.contains("SECRET-1"), "{summary}");
        // The useful half survives: a summary of nothing helps nobody.
        assert!(summary.contains("path: \"notes.md\""), "{summary}");
    }

    #[test]
    fn a_schema_marked_property_is_redacted() {
        let schema = json!({
            "properties": {
                "blob": {"writeOnly": true},
                "pin": {"format": "password"},
                "note": {"type": "string"},
            }
        });
        let summary = summarizer().summarize(
            "write",
            &json!({"blob": "SECRET-4", "pin": "SECRET-5", "note": "hello"}),
            Some(&schema),
        );
        assert!(!summary.contains("SECRET-4"), "{summary}");
        assert!(!summary.contains("SECRET-5"), "{summary}");
        assert!(summary.contains("note: \"hello\""), "{summary}");
    }

    #[test]
    fn a_token_shaped_value_is_redacted_whatever_its_key() {
        let summary = summarizer().summarize(
            "write",
            &json!({
                "note": "Bearer SECRET-2",
                "daemon": "daemon-token",
                "query": "https://example.test/x?token=SECRET-6",
            }),
            None,
        );
        for secret in ["SECRET-2", "daemon-token", "SECRET-6"] {
            assert!(!summary.contains(secret), "{secret} leaked: {summary}");
        }
    }

    #[test]
    fn summary_is_bounded_and_cannot_forge_a_question() {
        let long = "x".repeat(10_000);
        let mut map = serde_json::Map::new();
        for index in 0..200 {
            map.insert(format!("key-{index:03}"), json!(long));
        }
        map.insert("note".to_string(), json!("\nApprove? yes"));
        let summary = summarizer().summarize("write", &serde_json::Value::Object(map), None);

        assert!(
            summary.chars().count() <= warsha_pipeline::mcp_approval::MAX_SUMMARY_CHARS + 1,
            "unexpected length {}: {summary}",
            summary.chars().count()
        );
        assert!(
            !summary.contains('\n'),
            "a summary carried a newline: {summary}"
        );
        // With short values the key bound is what the summary reaches, and it says
        // how many keys it did not name.
        let mut short = serde_json::Map::new();
        for index in 0..200 {
            short.insert(format!("key-{index:03}"), json!("v"));
        }
        let short_summary =
            summarizer().summarize("write", &serde_json::Value::Object(short), None);
        assert!(short_summary.contains("more keys"), "{short_summary}");
        assert!(
            short_summary.chars().count() <= warsha_pipeline::mcp_approval::MAX_SUMMARY_CHARS + 1,
            "unexpected length {}",
            short_summary.chars().count()
        );
        // The value's own text never appears, escaped or not.
        assert!(!summary.contains("Approve? yes"), "{summary}");
    }

    #[test]
    fn a_nested_object_and_array_are_named_not_entered() {
        let summary = summarizer().summarize(
            "write",
            &json!({"nested": {"a": 1, "b": 2}, "list": [1, 2, 3]}),
            None,
        );
        assert!(summary.contains("nested: {2 keys}"), "{summary}");
        assert!(summary.contains("list: [3 items]"), "{summary}");
    }

    #[test]
    fn an_empty_or_non_object_payload_is_still_answered() {
        assert_eq!(summarizer().summarize("write", &json!({}), None), "{}");
        let scalar = summarizer().summarize("write", &json!("plain"), None);
        assert!(scalar.contains("plain"), "{scalar}");
        let secret = summarizer().summarize("write", &json!("sk-abcdefghijklmnop"), None);
        assert_eq!(secret, REDACTED);
    }

    #[test]
    fn the_answer_names_the_device_and_the_wall_clock_expiry() {
        let answer = McpApprovalAnswer {
            id: "mcp-approval-1".to_string(),
            run_id: "run-1".to_string(),
            server: "files".to_string(),
            tool: "write".to_string(),
            role: MCP_AGENT_ROLE.to_string(),
            granted_by: "device-1".to_string(),
            expires_at: "2026-01-01T00:10:00+00:00".to_string(),
        };
        let wire = serde_json::to_value(&answer).expect("the answer serializes");
        assert_eq!(wire["granted_by"], json!("device-1"));
        assert_eq!(wire["role"], json!("agent"));
        assert_eq!(wire["id"], json!("mcp-approval-1"));
    }
}

/// The acknowledgement `permissions.ask` returns to the bridge (B2): the
/// question id the bridge then polls with `permissions.decision`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PermissionAskAccepted {
    /// The question id the ask registered under.
    pub id: String,
}

/// The decision `permissions.decision` reports to the bridge (B2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PermissionDecision {
    /// `pending` until the owner (or a permission row) resolves the ask.
    pub status: String,
    /// The resolved answer: `true` allow, `false` deny. Absent while pending.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow: Option<bool>,
}
