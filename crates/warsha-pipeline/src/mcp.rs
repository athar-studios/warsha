//! MCP (Model Context Protocol) Support — MCP servers per project/agent

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;
use ulid::Ulid;
use warsha_core::*;

#[derive(Error, Debug)]
pub enum McpError {
    #[error("MCP server not found: {0}")]
    ServerNotFound(String),
    #[error("Tool not found: {0}")]
    ToolNotFound(String),
    #[error("Permission denied: {0}")]
    PermissionDenied(String),
    #[error("Approval required: {0}")]
    ApprovalRequired(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, McpError>;

/// MCP transport type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum McpTransport {
    Stdio,
    Http,
    WebSocket,
}

/// MCP server configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub transport: McpTransport,
    pub command: Option<String>,          // for stdio
    pub args: Vec<String>,                // for stdio
    pub url: Option<String>,              // for HTTP/WebSocket
    pub headers: HashMap<String, String>, // for HTTP/WebSocket
    pub env: HashMap<String, String>,
    pub project_id: Option<ProjectId>, // None = global/shared
    pub agent_role: Option<Role>,      // None = project-wide
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

impl McpServerConfig {
    pub fn new_stdio(name: String, command: String, args: Vec<String>) -> Self {
        Self {
            id: Ulid::new().to_string(),
            name,
            transport: McpTransport::Stdio,
            command: Some(command),
            args,
            url: None,
            headers: HashMap::new(),
            env: HashMap::new(),
            project_id: None,
            agent_role: None,
            enabled: true,
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
        }
    }

    pub fn new_http(name: String, url: String) -> Self {
        Self {
            id: Ulid::new().to_string(),
            name,
            transport: McpTransport::Http,
            command: None,
            args: vec![],
            url: Some(url),
            headers: HashMap::new(),
            env: HashMap::new(),
            project_id: None,
            agent_role: None,
            enabled: true,
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
        }
    }

    pub fn for_project(mut self, project_id: ProjectId) -> Self {
        self.project_id = Some(project_id);
        self
    }

    pub fn for_agent(mut self, role: Role) -> Self {
        self.agent_role = Some(role);
        self
    }
}

/// MCP tool definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    pub annotations: Option<McpToolAnnotations>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolAnnotations {
    pub title: Option<String>,
    pub read_only: Option<bool>,
    pub destructive: Option<bool>,
    pub idempotent: Option<bool>,
}

/// MCP tool call request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolCall {
    pub tool_name: String,
    pub arguments: serde_json::Value,
    pub caller_role: Role,
    pub caller_device: DeviceId,
}

/// MCP tool call result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolResult {
    pub content: Vec<McpContent>,
    pub is_error: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum McpContent {
    Text { text: String },
    Image { data: String, mime_type: String },
    Resource { resource: McpResource },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpResource {
    pub uri: String,
    pub mime_type: Option<String>,
    pub text: Option<String>,
}

/// Tool permission state
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolPermission {
    Allowed,
    Denied,
    Pending, // Awaiting first-use approval
    Revoked,
}

/// Tool permission entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolPermissionEntry {
    pub tool_name: String,
    pub server_id: String,
    pub permission: ToolPermission,
    pub role: Role,
    pub granted_by: Option<DeviceId>,
    pub granted_at: Option<String>,
    pub expires_at: Option<String>,
    pub scope: PermissionScope,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionScope {
    Project, // All agents in project
    Role,    // Specific role only
    Session, // Current run only
}

/// MCP registry managing servers and permissions
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct McpRegistry {
    pub servers: HashMap<String, McpServerConfig>,
    pub tools: HashMap<String, McpTool>, // server_id::tool_name -> tool
    pub permissions: HashMap<String, ToolPermissionEntry>, // server_id::tool_name::role -> permission
}

impl McpRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_server(&mut self, config: McpServerConfig) -> Result<()> {
        if self.servers.contains_key(&config.id) {
            return Err(McpError::ServerNotFound(format!(
                "Server {} already exists",
                config.id
            )));
        }
        self.servers.insert(config.id.clone(), config);
        Ok(())
    }

    pub fn remove_server(&mut self, server_id: &str) -> Result<()> {
        self.servers
            .remove(server_id)
            .ok_or_else(|| McpError::ServerNotFound(server_id.to_string()))?;
        // Also remove associated tools and permissions
        self.tools
            .retain(|k, _| !k.starts_with(&format!("{}::", server_id)));
        self.permissions
            .retain(|k, _| !k.starts_with(&format!("{}::", server_id)));
        Ok(())
    }

    pub fn get_server(&self, server_id: &str) -> Option<&McpServerConfig> {
        self.servers.get(server_id)
    }

    pub fn list_servers(
        &self,
        project_id: Option<ProjectId>,
        role: Option<Role>,
    ) -> Vec<&McpServerConfig> {
        self.servers
            .values()
            .filter(|s| s.enabled)
            .filter(|s| project_id.is_none_or(|p| s.project_id == Some(p)))
            .filter(|s| role.is_none_or(|r| s.agent_role == Some(r)))
            .collect()
    }

    pub fn register_tool(&mut self, server_id: &str, tool: McpTool) {
        let key = format!("{}::{}", server_id, tool.name);
        self.tools.insert(key, tool);
    }

    pub fn get_tool(&self, server_id: &str, tool_name: &str) -> Option<&McpTool> {
        self.tools.get(&format!("{}::{}", server_id, tool_name))
    }

    /// Every registered tool.
    ///
    /// The tool would need to carry its `server_id` for this to filter per
    /// server, so the id is accepted for API stability and ignored for now.
    pub fn list_tools(&self, _server_id: &str) -> Vec<&McpTool> {
        self.tools.values().collect()
    }

    /// Check if tool is allowed for role
    pub fn check_permission(&self, server_id: &str, tool_name: &str, role: Role) -> ToolPermission {
        let key = format!("{}::{}::{}", server_id, tool_name, role as i32);
        self.permissions
            .get(&key)
            .map(|p| p.permission)
            .unwrap_or(ToolPermission::Pending)
    }

    /// Request approval for a tool
    pub fn request_approval(
        &mut self,
        server_id: &str,
        tool_name: &str,
        role: Role,
        _device: DeviceId,
    ) {
        let key = format!("{}::{}::{}", server_id, tool_name, role as i32);
        let entry = self.permissions.entry(key).or_insert(ToolPermissionEntry {
            tool_name: tool_name.to_string(),
            server_id: server_id.to_string(),
            permission: ToolPermission::Pending,
            role,
            granted_by: None,
            granted_at: None,
            expires_at: None,
            scope: PermissionScope::Role,
        });
        entry.permission = ToolPermission::Pending;
    }

    /// Grant approval
    pub fn grant_approval(
        &mut self,
        server_id: &str,
        tool_name: &str,
        role: Role,
        device: DeviceId,
        scope: PermissionScope,
    ) -> Result<()> {
        let key = format!("{}::{}::{}", server_id, tool_name, role as i32);
        let entry = self
            .permissions
            .get_mut(&key)
            .ok_or_else(|| McpError::ToolNotFound(format!("{}::{}", server_id, tool_name)))?;

        entry.permission = ToolPermission::Allowed;
        entry.granted_by = Some(device);
        entry.granted_at = Some(Utc::now().to_rfc3339());
        entry.scope = scope;
        Ok(())
    }

    /// Deny approval
    pub fn deny_approval(&mut self, server_id: &str, tool_name: &str, role: Role) -> Result<()> {
        let key = format!("{}::{}::{}", server_id, tool_name, role as i32);
        let entry = self
            .permissions
            .get_mut(&key)
            .ok_or_else(|| McpError::ToolNotFound(format!("{}::{}", server_id, tool_name)))?;

        entry.permission = ToolPermission::Denied;
        Ok(())
    }

    /// Revoke permission
    pub fn revoke_permission(
        &mut self,
        server_id: &str,
        tool_name: &str,
        role: Role,
    ) -> Result<()> {
        let key = format!("{}::{}::{}", server_id, tool_name, role as i32);
        let entry = self
            .permissions
            .get_mut(&key)
            .ok_or_else(|| McpError::ToolNotFound(format!("{}::{}", server_id, tool_name)))?;

        entry.permission = ToolPermission::Revoked;
        Ok(())
    }
}

/// MCP client for daemon to connect to servers
pub struct McpClient {
    registry: McpRegistry,
}

impl McpClient {
    pub fn new(registry: McpRegistry) -> Self {
        Self { registry }
    }

    /// Call a tool on an MCP server
    pub async fn call_tool(&self, call: McpToolCall) -> Result<McpToolResult> {
        // Check permission
        let perm =
            self.registry
                .check_permission(&call.tool_name, &call.tool_name, call.caller_role);
        match perm {
            ToolPermission::Allowed => {}
            ToolPermission::Pending => {
                return Err(McpError::ApprovalRequired(format!(
                    "Tool {} requires approval",
                    call.tool_name
                )))
            }
            ToolPermission::Denied => {
                return Err(McpError::PermissionDenied(format!(
                    "Tool {} is denied",
                    call.tool_name
                )))
            }
            ToolPermission::Revoked => {
                return Err(McpError::PermissionDenied(format!(
                    "Tool {} access revoked",
                    call.tool_name
                )))
            }
        }

        // In real implementation, connect via stdio/HTTP/WebSocket
        // For now, return mock result
        Ok(McpToolResult {
            content: vec![McpContent::Text {
                text: format!("Mock result for tool {}", call.tool_name),
            }],
            is_error: false,
        })
    }

    /// List available tools for a role
    ///
    /// Permission filtering would happen here; the role is accepted for API
    /// stability and ignored until permissions are stored per tool.
    pub fn available_tools(&self, _role: Role) -> Vec<&McpTool> {
        self.registry.tools.values().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mcp_server_config() {
        let config = McpServerConfig::new_stdio(
            "filesystem".to_string(),
            "npx".to_string(),
            vec![
                "-y".to_string(),
                "@modelcontextprotocol/server-filesystem".to_string(),
                "/tmp".to_string(),
            ],
        );

        assert_eq!(config.transport, McpTransport::Stdio);
        assert_eq!(config.command, Some("npx".to_string()));
    }

    #[test]
    fn test_mcp_registry() {
        let mut registry = McpRegistry::new();

        let config = McpServerConfig::new_stdio(
            "test-server".to_string(),
            "echo".to_string(),
            vec!["hello".to_string()],
        );

        registry.add_server(config.clone()).unwrap();
        assert!(registry.get_server(&config.id).is_some());
    }

    #[test]
    fn test_permission_flow() {
        let mut registry = McpRegistry::new();
        let server_id = "test-server".to_string();
        let tool_name = "read_file".to_string();
        let role = Role::Coder;
        let device = DeviceId::new();

        // Initially pending
        assert_eq!(
            registry.check_permission(&server_id, &tool_name, role),
            ToolPermission::Pending
        );

        // Request approval
        registry.request_approval(&server_id, &tool_name, role, device);
        assert_eq!(
            registry.check_permission(&server_id, &tool_name, role),
            ToolPermission::Pending
        );

        // Grant approval
        registry
            .grant_approval(&server_id, &tool_name, role, device, PermissionScope::Role)
            .unwrap();
        assert_eq!(
            registry.check_permission(&server_id, &tool_name, role),
            ToolPermission::Allowed
        );

        // Revoke
        registry
            .revoke_permission(&server_id, &tool_name, role)
            .unwrap();
        assert_eq!(
            registry.check_permission(&server_id, &tool_name, role),
            ToolPermission::Revoked
        );
    }
}
