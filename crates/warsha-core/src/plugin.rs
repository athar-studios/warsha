//! Plugin / MCP system types — tool servers Warsha ships pre-bundled
//! (PLAN.md Wave 2).
//!
//! A [`PluginDefinition`] describes one MCP-style tool pack: how to launch it
//! (transport, command, args, env), whether it is active, and the tools it
//! exposes. [`bundled_plugins`] returns the seven community packs Warsha
//! installs by default.

use serde::{Deserialize, Serialize};

/// One MCP plugin pack.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginDefinition {
    /// Stable identifier, e.g. `github-mcp`.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// One-paragraph description of what the pack gives the factory.
    pub description: String,
    /// Transport kind: `stdio` or `http`.
    pub transport: String,
    /// Executable to launch for stdio transports; `None` for HTTP packs that
    /// point at an externally managed server.
    pub command: Option<String>,
    /// Arguments passed to the command (e.g. the `npx` package specifier).
    pub args: Vec<String>,
    /// Environment the server needs. Values are *references* to secrets
    /// (`${env:GITHUB_TOKEN}` style), never secret material itself.
    pub env: std::collections::HashMap<String, String>,
    /// Whether the pack is active for new runs.
    pub enabled: bool,
    /// The tools this pack exposes to agents.
    pub tools: Vec<PluginToolDefinition>,
    /// Upstream source, e.g. `github.com/modelcontextprotocol/servers`.
    pub source: String,
}

/// One tool an MCP plugin exposes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginToolDefinition {
    /// Tool name as the model sees it.
    pub name: String,
    /// Description the model reads before calling it.
    pub description: String,
    /// JSON Schema for the parameters, as a string, when published.
    pub parameters_json: Option<String>,
}

const MCP_SERVERS: &str = "github.com/modelcontextprotocol/servers";

/// The seven bundled MCP plugin packs.
pub fn bundled_plugins() -> Vec<PluginDefinition> {
    vec![
        github_mcp(),
        slack_mcp(),
        filesystem_mcp(),
        git_mcp(),
        memory_mcp(),
        sequential_thinking_mcp(),
        security_strix_pack(),
    ]
}

fn npx_package(package: &str) -> Vec<String> {
    vec![package.to_string()]
}

fn tool(name: &str, description: &str) -> PluginToolDefinition {
    PluginToolDefinition {
        name: name.to_string(),
        description: description.to_string(),
        parameters_json: None,
    }
}

/// GitHub: issues, PRs, CI and code search for the ticket-to-PR loop.
fn github_mcp() -> PluginDefinition {
    let mut env = std::collections::HashMap::new();
    env.insert(
        "GITHUB_PERSONAL_ACCESS_TOKEN".to_string(),
        "${secrets:github-token}".to_string(),
    );
    PluginDefinition {
        id: "github-mcp".to_string(),
        name: "GitHub".to_string(),
        description: "Repository operations: create and read issues, open and review \
             pull requests, watch CI runs and search code across branches. The backbone \
             of the ticket-to-PR factory."
            .to_string(),
        transport: "stdio".to_string(),
        command: Some("npx".to_string()),
        args: npx_package("@modelcontextprotocol/server-github"),
        env,
        enabled: true,
        tools: vec![
            tool("create_issue", "Open an issue with title, body and labels."),
            tool(
                "list_issues",
                "List issues filtered by state, label or assignee.",
            ),
            tool(
                "create_pull_request",
                "Open a PR from a head branch to a base branch.",
            ),
            tool(
                "review_pull_request",
                "Submit a review with comments and an approval state.",
            ),
            tool("get_workflow_run", "Read the status and logs of a CI run."),
            tool("search_code", "Search repository code by query."),
        ],
        source: MCP_SERVERS.to_string(),
    }
}

/// Slack: release notes, gate notifications and human escalation.
fn slack_mcp() -> PluginDefinition {
    let mut env = std::collections::HashMap::new();
    env.insert(
        "SLACK_BOT_TOKEN".to_string(),
        "${secrets:slack-bot-token}".to_string(),
    );
    PluginDefinition {
        id: "slack-mcp".to_string(),
        name: "Slack".to_string(),
        description: "Channel messaging for the factory: post gate decisions and review \
             requests, read thread replies as structured feedback, and escalate blocked \
             runs to humans where they are actually watching."
            .to_string(),
        transport: "stdio".to_string(),
        command: Some("npx".to_string()),
        args: npx_package("@modelcontextprotocol/server-slack"),
        env,
        enabled: false,
        tools: vec![
            tool("post_message", "Send a message to a channel or user."),
            tool(
                "read_messages",
                "Fetch recent messages and thread replies from a channel.",
            ),
            tool(
                "add_reaction",
                "React to a message as a lightweight acknowledgement.",
            ),
            tool("list_channels", "List channels the bot can see."),
        ],
        source: MCP_SERVERS.to_string(),
    }
}

/// Filesystem: sandboxed project file access.
fn filesystem_mcp() -> PluginDefinition {
    let mut env = std::collections::HashMap::new();
    env.insert(
        "WARSHA_ALLOWED_ROOT".to_string(),
        "${config:workspace-root}".to_string(),
    );
    PluginDefinition {
        id: "filesystem-mcp".to_string(),
        name: "Filesystem".to_string(),
        description: "Root-fenced file access for agents: read, write, list, search and \
             change metadata strictly inside the allowed project directories. Disabled \
             roots are invisible, not merely refused."
            .to_string(),
        transport: "stdio".to_string(),
        command: Some("npx".to_string()),
        args: npx_package("@modelcontextprotocol/server-filesystem"),
        env,
        enabled: true,
        tools: vec![
            tool("read_file", "Read a UTF-8 file inside an allowed root."),
            tool(
                "write_file",
                "Create or replace a file inside an allowed root.",
            ),
            tool("list_directory", "List entries with sizes and timestamps."),
            tool(
                "search_files",
                "Recursively find files by glob or substring.",
            ),
            tool("get_file_info", "Read metadata without reading contents."),
        ],
        source: MCP_SERVERS.to_string(),
    }
}

/// Git: local repository operations without shell escape.
fn git_mcp() -> PluginDefinition {
    PluginDefinition {
        id: "git-mcp".to_string(),
        name: "Git".to_string(),
        description: "Structured git operations for worktree fleets: status, diffs, \
             commits on a branch, log history, and worktree add/remove for isolated \
             agent lanes — no raw shell."
            .to_string(),
        transport: "stdio".to_string(),
        command: Some("npx".to_string()),
        args: npx_package("@modelcontextprotocol/server-git"),
        env: std::collections::HashMap::new(),
        enabled: true,
        tools: vec![
            tool(
                "git_status",
                "Summarise staged, unstaged and untracked changes.",
            ),
            tool(
                "git_diff",
                "Show the diff for a path range or staged changes.",
            ),
            tool("git_commit", "Commit staged changes with a message."),
            tool("git_log", "Read commit history with filters."),
            tool(
                "git_create_branch",
                "Create and check out a branch from a base ref.",
            ),
            tool(
                "git_create_worktree",
                "Add an isolated worktree for a task lane.",
            ),
        ],
        source: MCP_SERVERS.to_string(),
    }
}

/// Memory: persistent knowledge graph across runs.
fn memory_mcp() -> PluginDefinition {
    PluginDefinition {
        id: "memory-mcp".to_string(),
        name: "Memory".to_string(),
        description: "A persistent entity-relation knowledge graph the factory can \
             write into: remember decisions, preferences and project facts across runs, \
             and query them back when a new agent needs the history."
            .to_string(),
        transport: "stdio".to_string(),
        command: Some("npx".to_string()),
        args: npx_package("@modelcontextprotocol/server-memory"),
        env: std::collections::HashMap::new(),
        enabled: true,
        tools: vec![
            tool(
                "create_entities",
                "Add entities with typed attributes to the graph.",
            ),
            tool("create_relations", "Connect entities with named relations."),
            tool(
                "search_nodes",
                "Find entities and relations matching a query.",
            ),
            tool(
                "open_nodes",
                "Fetch a named subgraph by entity identifiers.",
            ),
            tool(
                "delete_entities",
                "Remove entities and their incident relations.",
            ),
        ],
        source: MCP_SERVERS.to_string(),
    }
}

/// Sequential thinking: an explicit, revisable reasoning scaffold.
fn sequential_thinking_mcp() -> PluginDefinition {
    PluginDefinition {
        id: "sequential-thinking-mcp".to_string(),
        name: "Sequential Thinking".to_string(),
        description: "A structured thinking tool for hard steps: numbered thoughts, \
             explicit revision of earlier ones, branching for alternatives, and a \
             verdict gate that forces the agent to state confidence before acting."
            .to_string(),
        transport: "stdio".to_string(),
        command: Some("npx".to_string()),
        args: npx_package("@modelcontextprotocol/server-sequential-thinking"),
        env: std::collections::HashMap::new(),
        enabled: true,
        tools: vec![tool(
            "sequentialthinking",
            "Record, revise or branch a numbered reasoning step with a total-steps estimate.",
        )],
        source: MCP_SERVERS.to_string(),
    }
}

/// Strix: security scanning and dynamic testing pack.
fn security_strix_pack() -> PluginDefinition {
    PluginDefinition {
        id: "security-strix-pack".to_string(),
        name: "Strix Security".to_string(),
        description: "Agentic security testing for the review stage: static vulnerability \
             analysis, dependency audit, and instrumented dynamic testing of the running \
             app, with findings that gate a release like any other receipt."
            .to_string(),
        transport: "stdio".to_string(),
        command: Some("uvx".to_string()),
        args: npx_package("strix-mcp"),
        env: std::collections::HashMap::new(),
        enabled: false,
        tools: vec![
            tool(
                "scan_codebase",
                "Run static analysis for injection, auth and secrets issues.",
            ),
            tool(
                "audit_dependencies",
                "Check declared dependencies against advisory databases.",
            ),
            tool(
                "dynamic_test",
                "Exercise the running application for exploitable behaviour.",
            ),
            tool(
                "report_findings",
                "Emit a structured findings report with severities.",
            ),
        ],
        source: "github.com/usestrix/strix".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_plugins_ship_the_seven_packs() {
        let ids: Vec<String> = bundled_plugins().into_iter().map(|p| p.id).collect();
        assert_eq!(
            ids,
            [
                "github-mcp",
                "slack-mcp",
                "filesystem-mcp",
                "git-mcp",
                "memory-mcp",
                "sequential-thinking-mcp",
                "security-strix-pack",
            ]
        );
    }

    #[test]
    fn plugin_envs_hold_references_not_secrets() {
        for plugin in bundled_plugins() {
            for (key, value) in &plugin.env {
                assert!(
                    value.starts_with("${secrets:") || value.starts_with("${config:"),
                    "plugin {} env {key} must reference the keychain or config",
                    plugin.id
                );
            }
        }
    }

    #[test]
    fn every_enabled_stdio_pack_has_a_command() {
        for plugin in bundled_plugins() {
            if plugin.enabled && plugin.transport == "stdio" {
                assert!(plugin.command.is_some(), "plugin {}", plugin.id);
                assert!(!plugin.tools.is_empty(), "plugin {}", plugin.id);
            }
        }
    }

    #[test]
    fn plugins_round_trip_through_json() {
        for plugin in bundled_plugins() {
            let encoded = serde_json::to_string(&plugin).expect("encodes");
            let decoded: PluginDefinition = serde_json::from_str(&encoded).expect("decodes");
            assert_eq!(decoded, plugin);
        }
    }
}
