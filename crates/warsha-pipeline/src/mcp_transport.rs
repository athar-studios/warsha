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
//! - **Stdio is real, handshake included.** [`McpManager::connect`] spawns the
//!   server's command through the daemon's [`ProcessManager`], so `process.list`
//!   sees it, and then speaks the protocol: `initialize`, read the reply,
//!   `notifications/initialized`, `tools/list`, read the reply. The tool names
//!   that reply carried travel on the connection, so `mcp.list` reports what the
//!   server said it can do instead of an empty promise, and a server that is not
//!   an MCP server is reported rather than recorded as connected.
//! - **An answer is waited for, and only so long.** Each connection keeps a
//!   cursor into its process's stdout ([`ProcessManager::read_stdout`]), and the
//!   handshake reads one reply per request within [`RESPONSE_TIMEOUT`]. A server
//!   that never answers fails `connect` with [`McpTransportError::Timeout`] and
//!   is stopped with the connection it did not earn. Lines that are not JSON (a
//!   server may log to stdout) and replies carrying another id are skipped, so a
//!   chatty server is not mistaken for a silent one.
//!   [`McpManager::send`] stays the raw seam it was: one framed line out, the
//!   frame back, and no waiting — a caller driving a method this client does not
//!   is the caller's own protocol.
//! - **Http and WebSocket are recorded, not connected.** The configuration is
//!   stored and reported as [`McpStatus::Disconnected`] with no process id, so
//!   `mcp.list` tells the truth about a transport that was never dialled.
//!   [`McpServerConfig::is_wired`] is the one predicate that says so.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;
use tokio::sync::Mutex;

use crate::process_spawn::{ProcessError, ProcessManager, ProcessStatus};

/// The MCP revision this client speaks, sent as `protocolVersion`.
pub const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

/// How long a stdio server is given to answer one request.
///
/// The handshake is two requests, so a server that never answers costs the caller
/// this once per request rather than hanging the daemon on a pipe that stays open.
pub const RESPONSE_TIMEOUT: Duration = Duration::from_secs(5);

/// How often the reply reader asks its process what it has printed.
const RESPONSE_POLL_INTERVAL: Duration = Duration::from_millis(20);

/// The id the `initialize` request carries, echoed back by the reply.
const INITIALIZE_REQUEST_ID: u64 = 1;

/// The id the `tools/list` request carries, echoed back by the reply.
const TOOLS_LIST_REQUEST_ID: u64 = 2;

/// The name this client reports to a server in `initialize`.
const CLIENT_NAME: &str = "warsha-daemon";

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
    /// The tool names the server's `tools/list` reply carried, in its own order.
    ///
    /// Empty until the handshake has run: an `Http`/`WebSocket` config is recorded
    /// without one, and a server whose handshake failed has no list to report.
    /// Only the names travel: a description is the server's to show, and nothing
    /// here has a screen to show it on.
    pub tools: Vec<String>,
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
    /// The server's output could not be read.
    #[error("could not read from MCP server `{name}`: {source}")]
    Read {
        /// The server whose output was being read.
        name: String,
        /// Why the read failed.
        #[source]
        source: ProcessError,
    },
    /// The server did not answer in time.
    #[error("MCP server `{name}` did not answer `{method}` within {seconds}s")]
    Timeout {
        /// The server that stayed silent.
        name: String,
        /// The method that went unanswered.
        method: String,
        /// How long it was given, in seconds.
        seconds: u64,
    },
    /// The server answered, but not with something this client can use.
    #[error("MCP server `{name}` answered `{method}` with {problem}")]
    Protocol {
        /// The server that answered badly.
        name: String,
        /// The method it answered.
        method: String,
        /// What was wrong with the reply.
        problem: String,
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
///
/// The stdout cursor lives here rather than on the connection because it is a
/// reader's position, not a server's state: [`McpConnection`] is what `mcp.list`
/// reports, and a cursor in that record would have to be invented for a
/// connection that has no process to read from.
pub struct InMemoryMcpManager {
    processes: Arc<dyn ProcessManager>,
    connections: Mutex<Vec<McpConnection>>,
    cursors: Mutex<HashMap<String, usize>>,
}

impl InMemoryMcpManager {
    /// A manager that spawns stdio servers through `processes`.
    pub fn new(processes: Arc<dyn ProcessManager>) -> Self {
        InMemoryMcpManager {
            processes,
            connections: Mutex::new(Vec::new()),
            cursors: Mutex::new(HashMap::new()),
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

    /// Write one newline-framed JSON frame to a server's stdin.
    async fn write_frame(
        &self,
        name: &str,
        process_id: &str,
        frame: &Value,
    ) -> Result<(), McpTransportError> {
        let mut encoded = frame.to_string();
        encoded.push('\n');
        self.processes
            .write_stdin(process_id, encoded.as_bytes())
            .await
            .map_err(|source| McpTransportError::Send {
                name: name.to_string(),
                source,
            })
    }

    /// The stdout lines the server has printed since the last call.
    ///
    /// The cursor advances past what it hands back, so a reply is read once.
    async fn read_new_lines(
        &self,
        name: &str,
        process_id: &str,
    ) -> Result<Vec<String>, McpTransportError> {
        let offset = self
            .cursors
            .lock()
            .await
            .get(name)
            .copied()
            .unwrap_or_default();
        let lines = self
            .processes
            .read_stdout(process_id, offset)
            .await
            .map_err(|source| McpTransportError::Read {
                name: name.to_string(),
                source,
            })?;
        if !lines.is_empty() {
            *self
                .cursors
                .lock()
                .await
                .entry(name.to_string())
                .or_default() += lines.len();
        }
        Ok(lines)
    }

    /// Send one request and wait for the reply that carries its id.
    ///
    /// The wait is bounded by [`RESPONSE_TIMEOUT`]: a server that never answers is
    /// an error the caller can act on, not a daemon parked on a pipe. A JSON-RPC
    /// error is a reply, so it is reported as [`McpTransportError::Protocol`]
    /// rather than waited past.
    async fn request(
        &self,
        name: &str,
        process_id: &str,
        frame: &Value,
        method: &str,
    ) -> Result<Value, McpTransportError> {
        let id = frame.get("id").cloned().unwrap_or(Value::Null);
        self.write_frame(name, process_id, frame).await?;

        let deadline = Instant::now() + RESPONSE_TIMEOUT;
        loop {
            for line in self.read_new_lines(name, process_id).await? {
                let Ok(reply) = serde_json::from_str::<Value>(&line) else {
                    // A server is free to log to stdout; only JSON lines are replies.
                    continue;
                };
                if reply.get("id") != Some(&id) {
                    continue;
                }
                if let Some(error) = reply.get("error") {
                    return Err(McpTransportError::Protocol {
                        name: name.to_string(),
                        method: method.to_string(),
                        problem: format!("error {error}"),
                    });
                }
                return Ok(reply);
            }
            if Instant::now() >= deadline {
                return Err(McpTransportError::Timeout {
                    name: name.to_string(),
                    method: method.to_string(),
                    seconds: RESPONSE_TIMEOUT.as_secs(),
                });
            }
            tokio::time::sleep(RESPONSE_POLL_INTERVAL).await;
        }
    }

    /// The protocol's opening: `initialize`, then `tools/list`, and the tool names.
    ///
    /// The `notifications/initialized` note the revision asks a client to send
    /// follows the first reply; a notification has no id and is not answered, so
    /// nothing waits on it. The two requests are answered in turn rather than
    /// pipelined, because a reply is only meaningful if the request before it was
    /// accepted.
    async fn handshake(
        &self,
        name: &str,
        process_id: &str,
    ) -> Result<Vec<String>, McpTransportError> {
        let initialize = json!({
            "jsonrpc": "2.0",
            "id": INITIALIZE_REQUEST_ID,
            "method": "initialize",
            "params": {
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {
                    "name": CLIENT_NAME,
                    "version": env!("CARGO_PKG_VERSION"),
                },
            },
        });
        let reply = self
            .request(name, process_id, &initialize, "initialize")
            .await?;
        if reply.get("result").is_none() {
            return Err(McpTransportError::Protocol {
                name: name.to_string(),
                method: "initialize".to_string(),
                problem: "a reply with no `result`".to_string(),
            });
        }

        self.write_frame(
            name,
            process_id,
            &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
        )
        .await?;

        let reply = self
            .request(
                name,
                process_id,
                &json!({
                    "jsonrpc": "2.0",
                    "id": TOOLS_LIST_REQUEST_ID,
                    "method": "tools/list",
                    "params": {},
                }),
                "tools/list",
            )
            .await?;
        let tools = reply
            .get("result")
            .and_then(|result| result.get("tools"))
            .and_then(Value::as_array)
            .ok_or_else(|| McpTransportError::Protocol {
                name: name.to_string(),
                method: "tools/list".to_string(),
                problem: "a reply with no `tools` array".to_string(),
            })?;
        Ok(tools
            .iter()
            .filter_map(|tool| tool.get("name").and_then(Value::as_str))
            .map(str::to_string)
            .collect())
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
        if !config.is_wired() {
            // Recorded, not dialled: no HTTP client and no WebSocket client is
            // wired, and saying `connected` here would be a lie the panel shows.
            self.connections.lock().await.push(McpConnection {
                config,
                status: McpStatus::Disconnected,
                process_id: None,
                tools: Vec::new(),
            });
            return Ok(());
        }

        let Some(command) = config
            .command
            .as_deref()
            .map(str::trim)
            .filter(|command| !command.is_empty())
        else {
            return Err(McpTransportError::MissingCommand(name));
        };
        let process_id = match self
            .processes
            .spawn(command, &config.args, &HashMap::new())
            .await
        {
            Ok(process_id) => process_id,
            Err(source) => {
                let message = source.to_string();
                self.connections.lock().await.push(McpConnection {
                    config,
                    status: McpStatus::Error(message),
                    process_id: None,
                    tools: Vec::new(),
                });
                return Err(McpTransportError::Spawn { name, source });
            }
        };

        match self.handshake(&name, &process_id).await {
            Ok(tools) => {
                self.connections.lock().await.push(McpConnection {
                    config,
                    status: McpStatus::Connected,
                    process_id: Some(process_id),
                    tools,
                });
                Ok(())
            }
            Err(error) => {
                // A server that will not handshake is not a connection: the child
                // goes with the attempt, so a wrong command does not leave a
                // process running that nothing will ever address again.
                if let Err(stop) = self.processes.stop(&process_id).await {
                    tracing::warn!("could not stop the MCP server `{name}`: {stop}");
                }
                self.connections.lock().await.push(McpConnection {
                    config,
                    status: McpStatus::Error(error.to_string()),
                    process_id: None,
                    tools: Vec::new(),
                });
                Err(error)
            }
        }
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

        // The next connection under this name reads its server's output from the
        // start: a cursor into a stopped process's transcript would misplace every
        // reply the new server sends.
        self.cursors.lock().await.remove(name);

        let mut connections = self.connections.lock().await;
        if let Some(connection) = connections
            .iter_mut()
            .find(|connection| connection.config.name == name)
        {
            connection.status = McpStatus::Disconnected;
            connection.process_id = None;
            connection.tools.clear();
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

        // One frame per line: the MCP stdio framing. `send` is the raw seam — the
        // handshake in `connect` is what reads replies — so a caller driving a
        // method this client does not knows its own protocol and its own answers.
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
    use serde_json::{json, Value};
    use std::io::BufRead;

    /// The tool names the scripted server answers `tools/list` with.
    ///
    /// The child is this same test binary, so both halves read one list: a server
    /// that answered something else would be a different server.
    const PROBE_TOOLS: [&str; 2] = ["read_file", "write_file"];

    /// A stdio MCP server, run as a child of this test binary.
    ///
    /// A daemon starts an MCP server with the program and arguments it was
    /// configured with and no environment of its own, so the child identifies
    /// itself by the arguments it was started with — `--exact` names this probe —
    /// and answers from the constants above. `--ignored` selects an ignored test,
    /// and `--nocapture` is what lets its `println!` reach the pipe the manager
    /// reads instead of libtest's in-memory buffer. The guard makes the probe
    /// harmless if a full ignored run ever reaches it: only a run pointed at
    /// `--exact` is a child of a test.
    #[test]
    #[ignore = "a child process, not a test"]
    fn mcp_server_probe() {
        if !std::env::args().any(|arg| arg == "--exact") {
            return;
        }
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            let Ok(request) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            // A notification has no id and is not answered.
            let Some(id) = request.get("id").cloned() else {
                continue;
            };
            let method = request.get("method").and_then(Value::as_str).unwrap_or("");
            let result = match method {
                "initialize" => json!({
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "warsha-test-server", "version": "1.0.0" },
                }),
                "tools/list" => json!({
                    "tools": PROBE_TOOLS
                        .iter()
                        .map(|name| json!({ "name": name }))
                        .collect::<Vec<Value>>(),
                }),
                _ => {
                    println!(
                        "{}",
                        json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": { "code": -32601, "message": "unknown method" },
                        })
                    );
                    continue;
                }
            };
            println!(
                "{}",
                json!({ "jsonrpc": "2.0", "id": id, "result": result })
            );
        }
    }

    /// A stdio server that stays up and answers nothing at all.
    #[test]
    #[ignore = "a child process, not a test"]
    fn mcp_server_silent_probe() {
        if !std::env::args().any(|arg| arg == "--exact") {
            return;
        }
        std::thread::sleep(Duration::from_secs(30));
    }

    /// A stdio server that answers `initialize` with a protocol error.
    #[test]
    #[ignore = "a child process, not a test"]
    fn mcp_server_error_probe() {
        if !std::env::args().any(|arg| arg == "--exact") {
            return;
        }
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            let Ok(request) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let Some(id) = request.get("id").cloned() else {
                continue;
            };
            println!(
                "{}",
                json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32600, "message": "no handshake for you" },
                })
            );
        }
    }

    /// A server configuration pointing at one probe of this test binary.
    fn server_config(name: &str, test: &str) -> McpServerConfig {
        let exe = std::env::current_exe().expect("the test binary names itself");
        McpServerConfig::new_stdio(
            name,
            exe.to_string_lossy().into_owned(),
            vec![
                "--exact".to_string(),
                format!("mcp_transport::tests::{test}"),
                "--ignored".to_string(),
                "--nocapture".to_string(),
            ],
        )
    }

    fn manager() -> (Arc<dyn ProcessManager>, InMemoryMcpManager) {
        let processes = InMemoryProcessManager::shared();
        let mcp = InMemoryMcpManager::new(processes.clone());
        (processes, mcp)
    }

    #[tokio::test]
    async fn connect_stdio_handshakes_and_reports_the_servers_tools() {
        let (processes, mcp) = manager();

        mcp.connect(server_config("files", "mcp_server_probe"))
            .await
            .expect("the server connects");

        let listed = mcp.list().await;
        let connection = listed.first().expect("the connection is listed");
        assert_eq!(connection.config.name, "files");
        assert_eq!(connection.status, McpStatus::Connected);
        assert_eq!(
            connection.tools,
            PROBE_TOOLS.map(str::to_string).to_vec(),
            "the tools come from the server's own `tools/list` reply"
        );
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
        mcp.disconnect("files").await.expect("the server closes");
    }

    #[tokio::test]
    async fn a_server_that_never_answers_is_a_clean_error() {
        let (processes, mcp) = manager();

        let error = mcp
            .connect(server_config("silent", "mcp_server_silent_probe"))
            .await
            .expect_err("a silent server never completes the handshake");

        assert!(
            matches!(
                &error,
                McpTransportError::Timeout { method, .. } if method == "initialize"
            ),
            "got {error:?}"
        );
        // The connection is recorded as the failure it was, and the server it
        // started is not left running behind a connection nobody has.
        let listed = mcp.list().await;
        let connection = listed.first().expect("the failure is listed");
        assert!(matches!(connection.status, McpStatus::Error(_)));
        assert_eq!(connection.process_id, None);
        assert!(connection.tools.is_empty());
        let stopped = processes.list().await;
        assert_eq!(stopped.len(), 1, "the server was started then stopped");
        assert_eq!(stopped[0].status, ProcessStatus::Stopped);
    }

    #[tokio::test]
    async fn a_server_that_answers_with_an_error_is_reported() {
        let (_processes, mcp) = manager();

        let error = mcp
            .connect(server_config("angry", "mcp_server_error_probe"))
            .await
            .expect_err("a protocol error is not a connection");

        assert!(
            matches!(
                &error,
                McpTransportError::Protocol { method, problem, .. }
                    if method == "initialize" && problem.contains("no handshake for you")
            ),
            "got {error:?}"
        );
        assert!(matches!(mcp.list().await[0].status, McpStatus::Error(_)));
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
        assert!(
            connection.tools.is_empty(),
            "a transport that was never dialled reports no tools"
        );
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
        mcp.connect(server_config("files", "mcp_server_probe"))
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
        assert!(connection.tools.is_empty());
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
    async fn list_reports_a_server_whose_process_has_gone_as_an_error() {
        let (processes, mcp) = manager();
        mcp.connect(server_config("files", "mcp_server_probe"))
            .await
            .expect("the server connects");
        let process_id = mcp.list().await[0]
            .process_id
            .clone()
            .expect("the connection names its process");

        // The child is killed behind the connection's back: `list` asks the
        // process, so the connection stops claiming to be connected.
        processes
            .stop(&process_id)
            .await
            .expect("the server is stopped");

        let status = mcp.list().await[0].status.clone();
        assert!(matches!(status, McpStatus::Error(_)), "got {status:?}");
    }

    #[tokio::test]
    async fn send_writes_the_frame_to_a_connected_server() {
        let (_processes, mcp) = manager();
        mcp.connect(server_config("files", "mcp_server_probe"))
            .await
            .expect("the server connects");

        let frame = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#;
        let sent = mcp
            .send("files", frame)
            .await
            .expect("the frame is written");

        assert_eq!(sent, frame);
        assert!(mcp.list().await[0].status.is_connected());
        mcp.disconnect("files").await.expect("the server closes");
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

        mcp.connect(server_config("files", "mcp_server_probe"))
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
