//! MCP transports — the connection layer behind `mcp.*` (PLAN.md M20).
//!
//! [`crate::mcp`] (M12) records *what* an MCP server is: its name, its transport,
//! its command, its per-project permissions. This module is the other half — it
//! opens the connection. The two are separate types on purpose, because the
//! M12 record is a registry row and this one is a live session:
//!
//! ```text
//! mcp::McpServerConfig        mcp_transport::McpServerConfig
//!   transport: unit enum         transport: carries its url
//!   permissions, project, env    exactly what a spawn needs
//! ```
//!
//! What is real and what is not:
//!
//! - **Stdio is real.** [`McpManager::connect`] spawns the server's command
//!   through the daemon's [`ProcessManager`], so `process.list` sees it, and
//!   [`McpManager::send`] writes the frame to the child's stdin. The MCP JSON-RPC
//!   handshake (`initialize`, `tools/list`, notifications) is **not** implemented:
//!   bytes are forwarded verbatim, and the caller supplies a frame the server can
//!   parse.
//! - **Http and WebSocket are recorded, not connected.** The configuration is
//!   stored and reported as [`McpStatus::Disconnected`] with no process id, so
//!   `mcp.list` tells the truth about a transport that was never dialled.
//!   [`McpServerConfig::is_wired`] is the one predicate that says so.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::Mutex;

use crate::process_spawn::{ProcessError, ProcessManager, ProcessStatus};

/// How to reach an MCP server.
///
/// The url lives in the variant, so an `Http` transport that has no url cannot be
/// constructed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum McpTransport {
    /// A child process spoken to over stdin/stdout.
    Stdio,
    /// An HTTP endpoint (recorded only).
    Http {
        /// The endpoint the transport was configured for.
        url: String,
    },
    /// A WebSocket endpoint (recorded only).
    WebSocket {
        /// The endpoint the transport was configured for.
        url: String,
    },
}

impl McpTransport {
    /// Stable snake_case tag; also the serde `kind`.
    pub fn as_str(&self) -> &'static str {
        match self {
            McpTransport::Stdio => "stdio",
            McpTransport::Http { .. } => "http",
            McpTransport::WebSocket { .. } => "websocket",
        }
    }

    /// The url the transport carries, if it carries one.
    pub fn url(&self) -> Option<&str> {
        match self {
            McpTransport::Stdio => None,
            McpTransport::Http { url } | McpTransport::WebSocket { url } => Some(url),
        }
    }
}

/// Everything a connection needs from its caller.
///
/// `command` and `args` are only read for [`McpTransport::Stdio`]; an `Http` or
/// `WebSocket` config with them still connects nothing, because nothing dials a
/// url here yet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpServerConfig {
    /// The name `mcp.disconnect`/`mcp.send` address the server by.
    pub name: String,
    /// How to reach it.
    pub transport: McpTransport,
    /// The program to spawn, for the stdio transport.
    pub command: Option<String>,
    /// That program's arguments.
    pub args: Vec<String>,
}

impl McpServerConfig {
    /// A stdio server: the program and its arguments.
    pub fn new_stdio(
        name: impl Into<String>,
        command: impl Into<String>,
        args: Vec<String>,
    ) -> Self {
        McpServerConfig {
            name: name.into(),
            transport: McpTransport::Stdio,
            command: Some(command.into()),
            args,
        }
    }

    /// An HTTP server: recorded, not dialled.
    pub fn new_http(name: impl Into<String>, url: impl Into<String>) -> Self {
        McpServerConfig {
            name: name.into(),
            transport: McpTransport::Http { url: url.into() },
            command: None,
            args: Vec::new(),
        }
    }

    /// A WebSocket server: recorded, not dialled.
    pub fn new_websocket(name: impl Into<String>, url: impl Into<String>) -> Self {
        McpServerConfig {
            name: name.into(),
            transport: McpTransport::WebSocket { url: url.into() },
            command: None,
            args: Vec::new(),
        }
    }

    /// True only for the transport that actually connects.
    pub fn is_wired(&self) -> bool {
        matches!(self.transport, McpTransport::Stdio)
    }
}

/// Where a connection is in its life.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum McpStatus {
    /// No connection: never opened, already closed, or only recorded.
    Disconnected,
    /// A connection is being established.
    Connecting,
    /// A stdio server process is running and its stdin is open.
    Connected,
    /// The connection failed; the message says why.
    Error(String),
}

impl McpStatus {
    /// Stable snake_case tag; also the serde representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            McpStatus::Disconnected => "disconnected",
            McpStatus::Connecting => "connecting",
            McpStatus::Connected => "connected",
            McpStatus::Error(_) => "error",
        }
    }

    /// True for [`McpStatus::Connected`] only.
    pub fn is_connected(&self) -> bool {
        matches!(self, McpStatus::Connected)
    }
}

/// One server's configuration and its current state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpConnection {
    /// What the caller asked for.
    pub config: McpServerConfig,
    /// Where the connection is now.
    pub status: McpStatus,
    /// The managed process behind a stdio connection.
    pub process_id: Option<String>,
}

/// Everything that can go wrong connecting, sending or disconnecting.
#[derive(Debug, Error)]
pub enum McpTransportError {
    /// No server with that name was connected.
    #[error("no MCP server named `{0}`")]
    NotFound(String),
    /// The name is blank, so nothing could address the connection.
    #[error("an MCP server needs a name")]
    EmptyName,
    /// A server with that name is already recorded.
    #[error("MCP server `{0}` is already connected; disconnect it first")]
    Duplicate(String),
    /// A stdio server was configured without a command to run.
    #[error("MCP server `{0}` needs a command for the stdio transport")]
    MissingCommand(String),
    /// The server is not connected, so there is nothing to send to.
    #[error("MCP server `{name}` is not connected (status: {status})")]
    NotConnected {
        /// The server that was addressed.
        name: String,
        /// Its status, as the tag the RPC reports.
        status: String,
    },
    /// The transport is recorded but nothing dials it yet.
    #[error("MCP server `{0}` uses a transport that is recorded but not wired yet")]
    NotWired(String),
    /// The server process could not be started.
    #[error("could not start MCP server `{name}`: {source}")]
    Spawn {
        /// The server that failed to start.
        name: String,
        /// Why the spawn failed.
        #[source]
        source: ProcessError,
    },
    /// The frame could not be written to the server.
    #[error("could not write to MCP server `{name}`: {source}")]
    Send {
        /// The server the frame was aimed at.
        name: String,
        /// Why the write failed.
        #[source]
        source: ProcessError,
    },
    /// The server process could not be stopped.
    #[error("could not stop MCP server `{name}`: {source}")]
    Stop {
        /// The server that was being disconnected.
        name: String,
        /// Why the stop failed.
        #[source]
        source: ProcessError,
    },
}

/// Connect, list, address and close MCP servers.
#[async_trait]
pub trait McpManager: Send + Sync {
    /// Connect `config`'s server, or record it when its transport is not wired.
    async fn connect(&self, config: McpServerConfig) -> Result<(), McpTransportError>;

    /// Close the connection and stop the process behind it.
    async fn disconnect(&self, name: &str) -> Result<(), McpTransportError>;

    /// Every connection, in the order it was first recorded.
    async fn list(&self) -> Vec<McpConnection>;

    /// Write one frame to a connected server, returning the frame that went out.
    async fn send(&self, name: &str, payload: &str) -> Result<String, McpTransportError>;
}

/// An [`McpManager`] over the daemon's [`ProcessManager`].
///
/// One connection per name. A stdio connection owns exactly one managed process;
/// disconnecting stops it, and the process stays visible in `process.list` as a
/// stopped record — the manager never deletes history it does not own.
pub struct InMemoryMcpManager {
    processes: Arc<dyn ProcessManager>,
    connections: Mutex<Vec<McpConnection>>,
}

impl InMemoryMcpManager {
    /// A manager that spawns stdio servers through `processes`.
    pub fn new(processes: Arc<dyn ProcessManager>) -> Self {
        InMemoryMcpManager {
            processes,
            connections: Mutex::new(Vec::new()),
        }
    }

    /// Set a connection's status, if it is still recorded.
    async fn set_status(&self, name: &str, status: McpStatus) {
        let mut connections = self.connections.lock().await;
        if let Some(connection) = connections
            .iter_mut()
            .find(|connection| connection.config.name == name)
        {
            connection.status = status;
        }
    }

    /// The status a stdio connection should report, asked of the process.
    ///
    /// A process that is no longer running turns the connection into an error
    /// naming what happened, so `mcp.list` never shows `connected` for a server
    /// that has already exited.
    async fn observed_status(&self, connection: &McpConnection) -> McpStatus {
        let Some(process_id) = connection.process_id.as_deref() else {
            return connection.status.clone();
        };
        match self.processes.status(process_id).await {
            Ok(ProcessStatus::Running) | Ok(ProcessStatus::Starting) => McpStatus::Connected,
            Ok(status) => McpStatus::Error(format!("process {process_id} is {}", status.as_str())),
            Err(_) => McpStatus::Error(format!("process {process_id} is gone")),
        }
    }
}

#[async_trait]
impl McpManager for InMemoryMcpManager {
    async fn connect(&self, config: McpServerConfig) -> Result<(), McpTransportError> {
        let name = config.name.trim().to_string();
        if name.is_empty() {
            return Err(McpTransportError::EmptyName);
        }
        {
            let connections = self.connections.lock().await;
            if connections
                .iter()
                .any(|connection| connection.config.name == name)
            {
                return Err(McpTransportError::Duplicate(name));
            }
        }

        // The lock is not held across a spawn: starting a process is the slow step
        // and no other RPC should wait on it.
        let (status, process_id) = if config.is_wired() {
            let Some(command) = config
                .command
                .as_deref()
                .map(str::trim)
                .filter(|command| !command.is_empty())
            else {
                return Err(McpTransportError::MissingCommand(name));
            };
            match self
                .processes
                .spawn(command, &config.args, &HashMap::new())
                .await
            {
                Ok(process_id) => (McpStatus::Connected, Some(process_id)),
                Err(source) => {
                    let message = source.to_string();
                    self.connections.lock().await.push(McpConnection {
                        config,
                        status: McpStatus::Error(message),
                        process_id: None,
                    });
                    return Err(McpTransportError::Spawn { name, source });
                }
            }
        } else {
            // Recorded, not dialled: no HTTP client and no WebSocket client is
            // wired, and saying `connected` here would be a lie the panel shows.
            (McpStatus::Disconnected, None)
        };

        self.connections.lock().await.push(McpConnection {
            config,
            status,
            process_id,
        });
        Ok(())
    }

    async fn disconnect(&self, name: &str) -> Result<(), McpTransportError> {
        let connection = self
            .connections
            .lock()
            .await
            .iter()
            .find(|connection| connection.config.name == name)
            .cloned()
            .ok_or_else(|| McpTransportError::NotFound(name.to_string()))?;

        if let Some(process_id) = connection.process_id.as_deref() {
            // A process that already exited is what "disconnected" asks for, so
            // only a real failure is reported.
            if let Err(error) = self.processes.stop(process_id).await {
                if !matches!(
                    error,
                    ProcessError::NotRunning(_) | ProcessError::NotFound(_)
                ) {
                    self.set_status(name, McpStatus::Error(error.to_string()))
                        .await;
                    return Err(McpTransportError::Stop {
                        name: name.to_string(),
                        source: error,
                    });
                }
            }
        }

        let mut connections = self.connections.lock().await;
        if let Some(connection) = connections
            .iter_mut()
            .find(|connection| connection.config.name == name)
        {
            connection.status = McpStatus::Disconnected;
            connection.process_id = None;
        }
        Ok(())
    }

    async fn list(&self) -> Vec<McpConnection> {
        let connections = self.connections.lock().await.clone();
        let mut listed = Vec::with_capacity(connections.len());
        for mut connection in connections {
            if connection.process_id.is_some() {
                connection.status = self.observed_status(&connection).await;
            }
            listed.push(connection);
        }
        listed
    }

    async fn send(&self, name: &str, payload: &str) -> Result<String, McpTransportError> {
        let connection = self
            .connections
            .lock()
            .await
            .iter()
            .find(|connection| connection.config.name == name)
            .cloned()
            .ok_or_else(|| McpTransportError::NotFound(name.to_string()))?;

        if !connection.config.is_wired() {
            return Err(McpTransportError::NotWired(name.to_string()));
        }
        let status = self.observed_status(&connection).await;
        let (Some(process_id), McpStatus::Connected) = (connection.process_id.as_deref(), &status)
        else {
            self.set_status(name, status.clone()).await;
            return Err(McpTransportError::NotConnected {
                name: name.to_string(),
                status: status.as_str().to_string(),
            });
        };

        // One frame per line: the MCP stdio framing. The handshake that would make
        // the frame meaningful (`initialize`, then `tools/list`) is not sent here.
        let mut frame = payload.to_string();
        frame.push('\n');
        match self
            .processes
            .write_stdin(process_id, frame.as_bytes())
            .await
        {
            Ok(()) => Ok(payload.to_string()),
            Err(source) => {
                let message = source.to_string();
                self.set_status(name, McpStatus::Error(message)).await;
                Err(McpTransportError::Send {
                    name: name.to_string(),
                    source,
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process_spawn::InMemoryProcessManager;
    use std::time::Duration;

    /// A stdio server that stays up until the test disconnects it.
    #[cfg(windows)]
    fn long_running() -> (String, Vec<String>) {
        (
            "cmd".to_string(),
            vec!["/C".to_string(), "ping -n 30 127.0.0.1 >nul".to_string()],
        )
    }

    /// A stdio server that stays up until the test disconnects it (Unix half).
    #[cfg(not(windows))]
    fn long_running() -> (String, Vec<String>) {
        (
            "sh".to_string(),
            vec!["-c".to_string(), "sleep 30".to_string()],
        )
    }

    /// A server that exits as soon as it starts.
    #[cfg(windows)]
    fn exits_at_once() -> (String, Vec<String>) {
        (
            "cmd".to_string(),
            vec!["/C".to_string(), "exit 0".to_string()],
        )
    }

    /// A server that exits as soon as it starts (Unix half).
    #[cfg(not(windows))]
    fn exits_at_once() -> (String, Vec<String>) {
        (
            "sh".to_string(),
            vec!["-c".to_string(), "exit 0".to_string()],
        )
    }

    fn manager() -> (Arc<dyn ProcessManager>, InMemoryMcpManager) {
        let processes = InMemoryProcessManager::shared();
        let mcp = InMemoryMcpManager::new(processes.clone());
        (processes, mcp)
    }

    #[tokio::test]
    async fn connect_stdio_spawns_the_server_command() {
        let (processes, mcp) = manager();
        let (command, args) = long_running();

        mcp.connect(McpServerConfig::new_stdio("files", command, args))
            .await
            .expect("the server connects");

        let listed = mcp.list().await;
        let connection = listed.first().expect("the connection is listed");
        assert_eq!(connection.config.name, "files");
        assert_eq!(connection.status, McpStatus::Connected);
        let process_id = connection
            .process_id
            .clone()
            .expect("a stdio connection names its process");
        assert_eq!(
            processes
                .status(&process_id)
                .await
                .expect("the process is tracked"),
            ProcessStatus::Running
        );
    }

    #[tokio::test]
    async fn connect_http_is_recorded_and_not_dialled() {
        let (processes, mcp) = manager();

        mcp.connect(McpServerConfig::new_http(
            "remote",
            "https://mcp.example/mcp",
        ))
        .await
        .expect("the config is recorded");

        let listed = mcp.list().await;
        let connection = listed.first().expect("the connection is listed");
        assert_eq!(connection.status, McpStatus::Disconnected);
        assert_eq!(connection.process_id, None);
        assert!(!connection.config.is_wired());
        assert_eq!(
            connection.config.transport.url(),
            Some("https://mcp.example/mcp")
        );
        assert!(processes.list().await.is_empty(), "nothing was spawned");
    }

    #[tokio::test]
    async fn connect_websocket_is_recorded_and_not_dialled() {
        let (processes, mcp) = manager();

        mcp.connect(McpServerConfig::new_websocket(
            "live",
            "wss://mcp.example/ws",
        ))
        .await
        .expect("the config is recorded");

        let listed = mcp.list().await;
        let connection = listed.first().expect("the connection is listed");
        assert_eq!(connection.config.transport.as_str(), "websocket");
        assert_eq!(connection.status, McpStatus::Disconnected);
        assert_eq!(connection.process_id, None);
        assert!(processes.list().await.is_empty());
    }

    #[tokio::test]
    async fn connect_stdio_without_a_command_is_an_error() {
        let (_processes, mcp) = manager();
        let config = McpServerConfig {
            name: "broken".to_string(),
            transport: McpTransport::Stdio,
            command: None,
            args: Vec::new(),
        };

        let error = mcp
            .connect(config)
            .await
            .expect_err("nothing can be spawned without a command");

        assert!(matches!(error, McpTransportError::MissingCommand(_)));
        assert!(mcp.list().await.is_empty());
    }

    #[tokio::test]
    async fn a_blank_or_duplicate_name_is_refused() {
        let (_processes, mcp) = manager();
        let blank = McpServerConfig::new_http("   ", "https://mcp.example/mcp");
        assert!(matches!(
            mcp.connect(blank).await,
            Err(McpTransportError::EmptyName)
        ));

        mcp.connect(McpServerConfig::new_http(
            "remote",
            "https://mcp.example/mcp",
        ))
        .await
        .expect("the config is recorded");
        let error = mcp
            .connect(McpServerConfig::new_http("remote", "https://other.example"))
            .await
            .expect_err("one connection per name");
        assert!(matches!(error, McpTransportError::Duplicate(_)));
        assert_eq!(mcp.list().await.len(), 1);
    }

    #[tokio::test]
    async fn connect_stdio_that_cannot_spawn_is_reported_as_an_error() {
        let (_processes, mcp) = manager();

        let error = mcp
            .connect(McpServerConfig::new_stdio(
                "ghost",
                "warsha-definitely-not-a-real-binary",
                Vec::new(),
            ))
            .await
            .expect_err("a missing binary cannot connect");

        assert!(matches!(error, McpTransportError::Spawn { .. }));
        let listed = mcp.list().await;
        let connection = listed.first().expect("the failure is listed");
        assert!(matches!(connection.status, McpStatus::Error(_)));
        assert_eq!(connection.process_id, None);
    }

    #[tokio::test]
    async fn disconnect_stops_the_process_and_clears_the_connection() {
        let (processes, mcp) = manager();
        let (command, args) = long_running();
        mcp.connect(McpServerConfig::new_stdio("files", command, args))
            .await
            .expect("the server connects");
        let process_id = mcp
            .list()
            .await
            .first()
            .and_then(|connection| connection.process_id.clone())
            .expect("the connection names its process");

        mcp.disconnect("files")
            .await
            .expect("the server disconnects");

        let listed = mcp.list().await;
        let connection = listed.first().expect("the connection is still listed");
        assert_eq!(connection.status, McpStatus::Disconnected);
        assert_eq!(connection.process_id, None);
        assert_eq!(
            processes
                .status(&process_id)
                .await
                .expect("the process is still tracked"),
            ProcessStatus::Stopped
        );
    }

    #[tokio::test]
    async fn disconnect_of_an_unknown_or_repeated_server() {
        let (_processes, mcp) = manager();
        assert!(matches!(
            mcp.disconnect("nobody").await,
            Err(McpTransportError::NotFound(_))
        ));

        mcp.connect(McpServerConfig::new_http(
            "remote",
            "https://mcp.example/mcp",
        ))
        .await
        .expect("the config is recorded");
        mcp.disconnect("remote")
            .await
            .expect("the first close is fine");
        mcp.disconnect("remote")
            .await
            .expect("closing an unrecorded transport again is fine");
    }

    #[tokio::test]
    async fn list_reports_a_server_that_exited_as_an_error() {
        let (_processes, mcp) = manager();
        let (command, args) = exits_at_once();
        mcp.connect(McpServerConfig::new_stdio("short-lived", command, args))
            .await
            .expect("the server connects");

        // The child exits on its own; `list` asks the process, so the connection
        // stops claiming to be connected.
        let mut status = McpStatus::Connected;
        for _ in 0..100 {
            status = mcp
                .list()
                .await
                .first()
                .map(|connection| connection.status.clone())
                .expect("the connection is listed");
            if !status.is_connected() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(matches!(status, McpStatus::Error(_)), "got {status:?}");
    }

    #[tokio::test]
    async fn send_writes_the_frame_to_a_connected_server() {
        let (_processes, mcp) = manager();
        let (command, args) = long_running();
        mcp.connect(McpServerConfig::new_stdio("files", command, args))
            .await
            .expect("the server connects");

        let frame = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#;
        let sent = mcp
            .send("files", frame)
            .await
            .expect("the frame is written");

        assert_eq!(sent, frame);
        assert!(mcp.list().await[0].status.is_connected());
    }

    #[tokio::test]
    async fn send_to_a_disconnected_or_unwired_server_is_refused() {
        let (_processes, mcp) = manager();
        assert!(matches!(
            mcp.send("nobody", "{}").await,
            Err(McpTransportError::NotFound(_))
        ));

        mcp.connect(McpServerConfig::new_http(
            "remote",
            "https://mcp.example/mcp",
        ))
        .await
        .expect("the config is recorded");
        assert!(matches!(
            mcp.send("remote", "{}").await,
            Err(McpTransportError::NotWired(_))
        ));

        let (command, args) = long_running();
        mcp.connect(McpServerConfig::new_stdio("files", command, args))
            .await
            .expect("the server connects");
        mcp.disconnect("files")
            .await
            .expect("the server disconnects");
        assert!(matches!(
            mcp.send("files", "{}").await,
            Err(McpTransportError::NotConnected { .. })
        ));
    }
}
