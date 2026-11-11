//! MCP tool permissions — the `server::tool::role` check in front of the transport.
//!
//! Every agent-initiated tool call consults this table before `mcp.call_tool`: a
//! missing row is `Ask`, never `Allow`, and `ask`/`deny` never reach the transport
//! (KEEL K6). The table is an in-memory snapshot loaded from the store at startup,
//! so the check is synchronous and cannot drift per call.

use std::collections::HashMap;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

/// The role string every agent-initiated MCP call is checked under.
pub const MCP_AGENT_ROLE: &str = "agent";

/// What the daemon may do with one `server::tool` for one role.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ToolPermission {
    /// Call the transport.
    Allow,
    /// Do not call the transport; queue one approval question.
    #[default]
    Ask,
    /// Do not call the transport and do not ask.
    Deny,
}

impl ToolPermission {
    /// Parse a stored permission, defaulting anything unrecognised to `Ask`.
    ///
    /// This is the total mapping the store uses: a row written by an older build,
    /// or a typo, must never become `Allow` by accident.
    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "allow" => Self::Allow,
            "deny" => Self::Deny,
            _ => Self::Ask,
        }
    }

    /// The wire and storage spelling.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Allow => "allow",
            Self::Ask => "ask",
            Self::Deny => "deny",
        }
    }

    /// Strict parse for an RPC that must reject an unknown value instead of
    /// silently asking; the error names the three accepted spellings.
    pub fn parse_strict(raw: &str) -> Result<Self, String> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "allow" => Ok(Self::Allow),
            "ask" => Ok(Self::Ask),
            "deny" => Ok(Self::Deny),
            other => Err(format!(
                "`{other}` is not an MCP permission; use `allow`, `ask` or `deny`"
            )),
        }
    }
}

/// A missing or unknown permission string deserializes to `Ask`, never `Allow`.
impl<'de> Deserialize<'de> for ToolPermission {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        Ok(Self::parse(&raw))
    }
}

/// A synchronous permission lookup the agent loop can call without awaiting.
pub trait McpPermissionSource: Send + Sync {
    /// Exact `(server, tool, role)`, then `(server, "*", role)`, then [`ToolPermission::Ask`].
    fn check_permission(&self, server: &str, tool: &str, role: &str) -> ToolPermission;
}

/// The in-memory table the daemon loads from the store and updates through RPC.
#[derive(Debug, Default)]
pub struct StaticPermissions {
    rows: RwLock<HashMap<(String, String, String), ToolPermission>>,
}

impl StaticPermissions {
    /// An empty table: every lookup is `Ask`.
    pub fn new() -> Self {
        Self::default()
    }

    /// A table from stored rows.
    pub fn from_rows(
        rows: impl IntoIterator<Item = (String, String, String, ToolPermission)>,
    ) -> Self {
        let rows = rows
            .into_iter()
            .map(|(server, tool, role, permission)| ((server, tool, role), permission))
            .collect();
        Self {
            rows: RwLock::new(rows),
        }
    }

    /// Insert or replace one row.
    pub fn set(&self, server: &str, tool: &str, role: &str, permission: ToolPermission) {
        let mut rows = self
            .rows
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        rows.insert(
            (server.to_string(), tool.to_string(), role.to_string()),
            permission,
        );
    }

    /// Every row, in key order.
    pub fn snapshot(&self) -> Vec<(String, String, String, ToolPermission)> {
        let rows = self
            .rows
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut rows: Vec<_> = rows
            .iter()
            .map(|((server, tool, role), permission)| {
                (server.clone(), tool.clone(), role.clone(), *permission)
            })
            .collect();
        rows.sort();
        rows
    }

    /// Load every row from the store; a read error leaves the table at `Ask`.
    pub async fn load_from<S: McpPermissionStore>(store: &S) -> Self {
        match store.load_mcp_permissions().await {
            Ok(rows) => Self::from_rows(rows),
            Err(_) => Self::new(),
        }
    }
}

impl McpPermissionSource for StaticPermissions {
    fn check_permission(&self, server: &str, tool: &str, role: &str) -> ToolPermission {
        let rows = self
            .rows
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        rows.get(&(server.to_string(), tool.to_string(), role.to_string()))
            .or_else(|| rows.get(&(server.to_string(), "*".to_string(), role.to_string())))
            .copied()
            .unwrap_or(ToolPermission::Ask)
    }
}

/// A source that asks for everything: the loop's fail-closed default.
#[derive(Debug, Default)]
pub struct AskEverything;

impl McpPermissionSource for AskEverything {
    fn check_permission(&self, _server: &str, _tool: &str, _role: &str) -> ToolPermission {
        ToolPermission::Ask
    }
}

/// The store seam the daemon implements (`crates/warsha-store`).
#[async_trait::async_trait]
pub trait McpPermissionStore: Send + Sync {
    /// Upsert one `(server, tool, role)` row.
    async fn set_mcp_permission(
        &self,
        server: &str,
        tool: &str,
        role: &str,
        permission: ToolPermission,
        updated_at: &str,
    ) -> Result<(), String>;

    /// Every stored row, mapped through [`ToolPermission::parse`].
    async fn load_mcp_permissions(
        &self,
    ) -> Result<Vec<(String, String, String, ToolPermission)>, String>;
}

#[cfg(test)]
mod mcp_permission {
    use super::*;

    fn rows() -> Vec<(String, String, String, ToolPermission)> {
        vec![
            (
                "files".to_string(),
                "read".to_string(),
                "agent".to_string(),
                ToolPermission::Allow,
            ),
            (
                "files".to_string(),
                "*".to_string(),
                "agent".to_string(),
                ToolPermission::Deny,
            ),
            (
                "files".to_string(),
                "write".to_string(),
                "reviewer".to_string(),
                ToolPermission::Allow,
            ),
        ]
    }

    #[test]
    fn a_missing_row_is_ask_and_unknown_strings_never_allow() {
        let table = StaticPermissions::from_rows(rows());
        assert_eq!(
            table.check_permission("files", "write", "coder"),
            ToolPermission::Ask
        );
        assert_eq!(
            table.check_permission("files", "search", "agent"),
            ToolPermission::Deny
        );
        assert_eq!(ToolPermission::parse("ALLOW"), ToolPermission::Allow);
        assert_eq!(ToolPermission::parse("permit"), ToolPermission::Ask);
        assert_eq!(ToolPermission::default(), ToolPermission::Ask);
        assert!(ToolPermission::parse_strict("permit").is_err());
    }

    #[test]
    fn exact_beats_the_wildcard_and_a_role_cannot_borrow_another_roles_allow() {
        let table = StaticPermissions::from_rows(rows());
        assert_eq!(
            table.check_permission("files", "read", "agent"),
            ToolPermission::Allow
        );
        assert_eq!(
            table.check_permission("files", "search", "agent"),
            ToolPermission::Deny
        );
        // The reviewer's exact allow is the reviewer's; the agent's row is its wildcard.
        assert_eq!(
            table.check_permission("files", "write", "reviewer"),
            ToolPermission::Allow
        );
        assert_eq!(
            table.check_permission("files", "write", "coder"),
            ToolPermission::Ask
        );
    }

    #[test]
    fn set_replaces_and_snapshot_round_trips() {
        let table = StaticPermissions::new();
        table.set("git", "commit", "agent", ToolPermission::Allow);
        table.set("git", "commit", "agent", ToolPermission::Deny);
        assert_eq!(
            table.check_permission("git", "commit", "agent"),
            ToolPermission::Deny
        );
        assert_eq!(
            table.snapshot(),
            vec![(
                "git".to_string(),
                "commit".to_string(),
                "agent".to_string(),
                ToolPermission::Deny
            )]
        );
    }

    #[test]
    fn ask_everything_always_asks() {
        assert_eq!(
            AskEverything.check_permission("anything", "at-all", "agent"),
            ToolPermission::Ask
        );
    }

    #[tokio::test]
    async fn load_from_uses_the_store_or_falls_back_to_ask() {
        struct Store(Result<Vec<(String, String, String, ToolPermission)>, String>);

        #[async_trait::async_trait]
        impl McpPermissionStore for Store {
            async fn set_mcp_permission(
                &self,
                _server: &str,
                _tool: &str,
                _role: &str,
                _permission: ToolPermission,
                _updated_at: &str,
            ) -> Result<(), String> {
                Ok(())
            }

            async fn load_mcp_permissions(
                &self,
            ) -> Result<Vec<(String, String, String, ToolPermission)>, String> {
                self.0.clone()
            }
        }

        let loaded = StaticPermissions::load_from(&Store(Ok(rows()))).await;
        assert_eq!(
            loaded.check_permission("files", "read", "agent"),
            ToolPermission::Allow
        );
        let failed = StaticPermissions::load_from(&Store(Err("database is locked".into()))).await;
        assert_eq!(
            failed.check_permission("files", "read", "agent"),
            ToolPermission::Ask
        );
    }
}
