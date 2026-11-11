//! MCP transports — the connection layer behind `mcp.*` (PLAN.md M20).
//!
//! [`crate::mcp`] (M12) records *what* an MCP server is — its name, its
//! transport, its per-project permissions — in [`crate::mcp::McpServerRecord`].
//! This module is the other half: it opens the connection. The launch type is
//! the one [`McpServerConfig`] the whole pipeline shares; what a caller may not
//! put on the wire (the environment a child is given, the bound on its reply)
//! travels beside it in [`McpLaunchOptions`], because those are launch inputs,
//! not part of a server's identity.
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
//! - **The child gets a named environment, never the daemon's.** The environment
//!   in [`McpLaunchOptions`] is the only one the server sees, on top of the
//!   process manager's fixed floor; the daemon resolves a pack's keychain
//!   references and hands the result to [`McpManager::connect_with`], so a
//!   variable nobody named never reaches the server (KEEL K5a).
//! - **An answer is waited for, and only so long.** Each connection keeps a
//!   cursor into its process's stdout ([`ProcessManager::read_stdout`]), and the
//!   handshake reads one reply per request within the server's
//!   [`McpLaunchOptions::response_timeout`] (30 s by default). A server that
//!   never answers fails `connect` with [`McpTransportError::Timeout`], a server
//!   that exits first fails with [`McpTransportError::Exited`], and a failed
//!   connection is stopped with the child it did not earn. Lines that are not
//!   JSON (a server may log to stdout) and replies carrying another id are
//!   skipped, so a chatty server is not mistaken for a silent one.
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
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;
use tokio::sync::Mutex;

use crate::process_spawn::{ProcessError, ProcessManager, ProcessStatus};

/// The MCP revision this client speaks, sent as `protocolVersion`.
pub const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

/// How long a stdio server is given to answer one request by default.
///
/// The handshake is two requests, so a server that never answers costs the caller
/// this once per request rather than hanging the daemon on a pipe that stays open.
/// A per-server launch may name its own bound in [`McpLaunchOptions`]; this is
/// what a connection that names none uses (KEEL K5a).
pub const DEFAULT_RESPONSE_TIMEOUT: Duration = Duration::from_secs(30);

/// The historical name of [`DEFAULT_RESPONSE_TIMEOUT`], kept for callers that
/// spelled the bound out.
pub const RESPONSE_TIMEOUT: Duration = DEFAULT_RESPONSE_TIMEOUT;

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

/// What a launch adds to a [`McpServerConfig`]: the environment and the bound.
///
/// These are launch inputs rather than part of a server's identity: `mcp.connect`
/// is a wire method and a wire caller has no business dictating a child's
/// environment, while the daemon's plugin path resolves a pack's keychain
/// references and passes exactly those variables here. The process manager's
/// fixed floor still applies underneath, and it never inherits the daemon's own
/// environment (KEEL K5a).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpLaunchOptions {
    /// The variables the child is given, on top of the process manager's floor.
    pub env: HashMap<String, String>,
    /// How long one request may wait for its reply.
    pub response_timeout: Duration,
}

impl Default for McpLaunchOptions {
    fn default() -> Self {
        McpLaunchOptions {
            env: HashMap::new(),
            response_timeout: DEFAULT_RESPONSE_TIMEOUT,
        }
    }
}

impl McpLaunchOptions {
    /// Options that hand the child exactly `env` and keep the default bound.
    pub fn with_env(env: HashMap<String, String>) -> Self {
        McpLaunchOptions {
            env,
            response_timeout: DEFAULT_RESPONSE_TIMEOUT,
        }
    }

    /// The same options under a different per-server bound.
    pub fn with_response_timeout(mut self, timeout: Duration) -> Self {
        self.response_timeout = timeout;
        self
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
    /// Full tool definitions parsed from the server's `tools/list` reply.
    #[serde(default)]
    pub tool_definitions: Vec<crate::mcp::McpTool>,
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
    /// The server process exited before answering.
    ///
    /// Reported as soon as the exit is observed rather than waiting out the
    /// timeout: a process that is gone will never answer, and a refused pack
    /// should fail while the owner is still looking at it (KEEL K5a/K5b).
    #[error("MCP server `{name}` exited ({status}) before answering `{method}`")]
    Exited {
        /// The server that exited.
        name: String,
        /// The method that went unanswered.
        method: String,
        /// The terminal status the process reached.
        status: String,
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

    /// Connect the same server with the environment and bound it was launched
    /// with.
    ///
    /// The default exists so implementations that record rather than launch keep
    /// compiling: a transport with nothing to spawn has no environment to apply.
    /// [`InMemoryMcpManager`] overrides it, and it is the only implementation that
    /// starts a child.
    async fn connect_with(
        &self,
        config: McpServerConfig,
        _options: McpLaunchOptions,
    ) -> Result<(), McpTransportError> {
        self.connect(config).await
    }

    /// Close the connection and stop the process behind it.
    async fn disconnect(&self, name: &str) -> Result<(), McpTransportError>;

    /// Every connection, in the order it was first recorded.
    async fn list(&self) -> Vec<McpConnection>;

    /// Write one frame to a connected server, returning the frame that went out.
    async fn send(&self, name: &str, payload: &str) -> Result<String, McpTransportError>;

    /// Call a tool on an MCP server.
    async fn call_tool(
        &self,
        name: &str,
        tool: &str,
        arguments: serde_json::Value,
    ) -> Result<crate::mcp::McpToolResult, McpTransportError>;
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
    /// Names explicitly closed via `disconnect`, so a subsequent `connect` can
    /// replace the stopped tombstone while a duplicate unwired registration still
    /// refuses without a prior `disconnect`.
    disconnected: Mutex<HashSet<String>>,
    cursors: Mutex<HashMap<String, usize>>,
    launches: Mutex<HashMap<String, McpLaunchOptions>>,
    next_request_id: AtomicU64,
}

impl InMemoryMcpManager {
    /// A manager that spawns stdio servers through `processes`.
    pub fn new(processes: Arc<dyn ProcessManager>) -> Self {
        InMemoryMcpManager {
            processes,
            connections: Mutex::new(Vec::new()),
            disconnected: Mutex::new(HashSet::new()),
            cursors: Mutex::new(HashMap::new()),
            launches: Mutex::new(HashMap::new()),
            next_request_id: AtomicU64::new(100),
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

    /// How long this server is allowed to take for one reply.
    ///
    /// A connection that was recorded without a launch (an HTTP server, a test
    /// double) uses the default; a stdio launch keeps the bound its caller named.
    async fn response_timeout(&self, name: &str) -> Duration {
        self.launches
            .lock()
            .await
            .get(name)
            .map(|options| options.response_timeout)
            .unwrap_or(DEFAULT_RESPONSE_TIMEOUT)
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
    /// The wait is bounded by the server's own
    /// [`McpLaunchOptions::response_timeout`] (30 s by default): a server that
    /// never answers is an error the caller can act on, not a daemon parked on a
    /// pipe. A JSON-RPC error is a reply, so it is reported as
    /// [`McpTransportError::Protocol`] rather than waited past.
    async fn request(
        &self,
        name: &str,
        process_id: &str,
        frame: &Value,
        method: &str,
    ) -> Result<Value, McpTransportError> {
        let timeout = self.response_timeout(name).await;
        self.request_with_timeout(name, process_id, frame, method, timeout)
            .await
    }

    /// Send one request and wait for the reply with a specified timeout.
    ///
    /// Each poll also asks the process manager whether the child is still alive:
    /// an exited server will never answer, and waiting out the timeout for it
    /// would make a refused pack look like a slow one (KEEL K5b).
    async fn request_with_timeout(
        &self,
        name: &str,
        process_id: &str,
        frame: &Value,
        method: &str,
        timeout: Duration,
    ) -> Result<Value, McpTransportError> {
        let id = frame.get("id").cloned().unwrap_or(Value::Null);
        self.write_frame(name, process_id, frame).await?;

        let deadline = Instant::now() + timeout;
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
            match self.processes.status(process_id).await {
                Ok(status) if status.is_terminal() => {
                    return Err(McpTransportError::Exited {
                        name: name.to_string(),
                        method: method.to_string(),
                        status: status.as_str().to_string(),
                    });
                }
                Ok(_) => {}
                // A process the manager no longer tracks is as gone as one that
                // exited; the transport reports it rather than waiting.
                Err(_) => {
                    return Err(McpTransportError::Exited {
                        name: name.to_string(),
                        method: method.to_string(),
                        status: "gone".to_string(),
                    });
                }
            }
            if Instant::now() >= deadline {
                return Err(McpTransportError::Timeout {
                    name: name.to_string(),
                    method: method.to_string(),
                    seconds: timeout.as_secs(),
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
    ) -> Result<(Vec<String>, Vec<crate::mcp::McpTool>), McpTransportError> {
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

        let mut tool_names = Vec::new();
        let mut tool_definitions = Vec::new();

        for tool_val in tools {
            let tool_name = tool_val
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if !tool_name.is_empty() {
                tool_names.push(tool_name.clone());
            }
            let description = tool_val
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let input_schema = tool_val
                .get("inputSchema")
                .or_else(|| tool_val.get("input_schema"))
                .cloned()
                .unwrap_or_else(|| json!({ "type": "object" }));
            let annotations = tool_val
                .get("annotations")
                .and_then(|a| serde_json::from_value(a.clone()).ok());

            tool_definitions.push(crate::mcp::McpTool {
                name: tool_name,
                description,
                input_schema,
                annotations,
            });
        }

        Ok((tool_names, tool_definitions))
    }

    /// Call a tool with a specific timeout.
    pub async fn call_tool_with_timeout(
        &self,
        name: &str,
        tool: &str,
        arguments: Value,
        timeout: Duration,
    ) -> Result<crate::mcp::McpToolResult, McpTransportError> {
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

        let id = self.next_request_id.fetch_add(1, Ordering::SeqCst);
        let frame = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/call",
            "params": {
                "name": tool,
                "arguments": arguments,
            }
        });

        let reply = self
            .request_with_timeout(name, process_id, &frame, "tools/call", timeout)
            .await?;

        let result_val = reply
            .get("result")
            .ok_or_else(|| McpTransportError::Protocol {
                name: name.to_string(),
                method: "tools/call".to_string(),
                problem: "a reply with no `result`".to_string(),
            })?;

        let is_error = result_val
            .get("isError")
            .or_else(|| result_val.get("is_error"))
            .and_then(Value::as_bool)
            .unwrap_or(false);

        let mut content = Vec::new();
        if let Some(items) = result_val.get("content").and_then(Value::as_array) {
            for item in items {
                let item_type = item.get("type").and_then(Value::as_str).unwrap_or("text");
                match item_type {
                    "text" => {
                        let text = item
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        content.push(crate::mcp::McpContent::Text { text });
                    }
                    "image" => {
                        let data = item
                            .get("data")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        let mime_type = item
                            .get("mimeType")
                            .or_else(|| item.get("mime_type"))
                            .and_then(Value::as_str)
                            .unwrap_or("image/png")
                            .to_string();
                        content.push(crate::mcp::McpContent::Image { data, mime_type });
                    }
                    "resource" => {
                        if let Some(resource_val) = item.get("resource") {
                            let uri = resource_val
                                .get("uri")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string();
                            let mime_type = resource_val
                                .get("mimeType")
                                .or_else(|| resource_val.get("mime_type"))
                                .and_then(Value::as_str)
                                .map(str::to_string);
                            let text = resource_val
                                .get("text")
                                .and_then(Value::as_str)
                                .map(str::to_string);
                            content.push(crate::mcp::McpContent::Resource {
                                resource: crate::mcp::McpResource {
                                    uri,
                                    mime_type,
                                    text,
                                },
                            });
                        }
                    }
                    _ => {
                        if let Some(text) = item.get("text").and_then(Value::as_str) {
                            content.push(crate::mcp::McpContent::Text {
                                text: text.to_string(),
                            });
                        }
                    }
                }
            }
        } else if let Some(text) = result_val.as_str() {
            content.push(crate::mcp::McpContent::Text {
                text: text.to_string(),
            });
        } else if let Some(text) = result_val.get("text").and_then(Value::as_str) {
            content.push(crate::mcp::McpContent::Text {
                text: text.to_string(),
            });
        } else if !result_val.is_null() && !result_val.as_object().is_some_and(|o| o.is_empty()) {
            content.push(crate::mcp::McpContent::Text {
                text: result_val.to_string(),
            });
        }

        Ok(crate::mcp::McpToolResult { content, is_error })
    }
}

#[async_trait]
impl McpManager for InMemoryMcpManager {
    async fn connect(&self, config: McpServerConfig) -> Result<(), McpTransportError> {
        self.connect_with(config, McpLaunchOptions::default()).await
    }

    async fn connect_with(
        &self,
        config: McpServerConfig,
        options: McpLaunchOptions,
    ) -> Result<(), McpTransportError> {
        let name = config.name.trim().to_string();
        if name.is_empty() {
            return Err(McpTransportError::EmptyName);
        }
        {
            let connections = self.connections.lock().await;
            let was_disconnected = self.disconnected.lock().await.contains(&name);
            if let Some(existing) = connections
                .iter()
                .find(|connection| connection.config.name == name)
            {
                // A live connection or an active unwired record blocks a duplicate
                // connect; an explicitly disconnected server or a failed attempt is
                // a tombstone and may be replaced.
                let is_tombstone =
                    was_disconnected || matches!(existing.status, McpStatus::Error(_));
                if !is_tombstone {
                    return Err(McpTransportError::Duplicate(name));
                }
            }
        }
        // Drop the stale tombstone before the new record is pushed.
        self.disconnected.lock().await.remove(&name);
        self.connections
            .lock()
            .await
            .retain(|connection| connection.config.name != name);

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
                tool_definitions: Vec::new(),
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
        // The environment the caller named is the only one the child is handed;
        // the process manager clears the daemon's own and applies its floor.
        let process_id = match self
            .processes
            .spawn(command, &config.args, &options.env)
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
                    tool_definitions: Vec::new(),
                });
                return Err(McpTransportError::Spawn { name, source });
            }
        };

        // The bound and the environment are remembered before the handshake, so
        // the two requests it sends already honour the per-server timeout.
        self.launches.lock().await.insert(name.clone(), options);
        match self.handshake(&name, &process_id).await {
            Ok((tools, tool_definitions)) => {
                self.connections.lock().await.push(McpConnection {
                    config,
                    status: McpStatus::Connected,
                    process_id: Some(process_id),
                    tools,
                    tool_definitions,
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
                self.launches.lock().await.remove(&name);
                self.connections.lock().await.push(McpConnection {
                    config,
                    status: McpStatus::Error(error.to_string()),
                    process_id: None,
                    tools: Vec::new(),
                    tool_definitions: Vec::new(),
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
        // reply the new server sends. Its launch inputs go with the connection, so
        // a reconnect starts from what its own caller names.
        self.cursors.lock().await.remove(name);
        self.launches.lock().await.remove(name);
        self.disconnected.lock().await.insert(name.to_string());

        let mut connections = self.connections.lock().await;
        if let Some(connection) = connections
            .iter_mut()
            .find(|connection| connection.config.name == name)
        {
            connection.status = McpStatus::Disconnected;
            connection.process_id = None;
            connection.tools.clear();
            connection.tool_definitions.clear();
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

    async fn call_tool(
        &self,
        name: &str,
        tool: &str,
        arguments: Value,
    ) -> Result<crate::mcp::McpToolResult, McpTransportError> {
        let timeout = self.response_timeout(name).await;
        self.call_tool_with_timeout(name, tool, arguments, timeout)
            .await
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
    const PROBE_TOOLS: [&str; 4] = ["read_file", "write_file", "echo", "create_table"];

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
                        .map(|name| json!({
                            "name": name,
                            "description": format!("{name} description"),
                            "inputSchema": { "type": "object" },
                        }))
                        .collect::<Vec<Value>>(),
                }),
                "tools/call" => {
                    let tool_name = request
                        .get("params")
                        .and_then(|p| p.get("name"))
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let arguments = request
                        .get("params")
                        .and_then(|p| p.get("arguments"))
                        .cloned()
                        .unwrap_or(json!({}));
                    match tool_name {
                        "echo" => json!({
                            "content": [{
                                "type": "text",
                                "text": arguments
                                    .get("msg")
                                    .and_then(Value::as_str)
                                    .unwrap_or("echoed")
                            }],
                            "isError": false,
                        }),
                        "create_table" => json!({
                            "content": [{
                                "type": "text",
                                "text": format!(
                                    "table '{}' created",
                                    arguments
                                        .get("name")
                                        .and_then(Value::as_str)
                                        .unwrap_or("users")
                                )
                            }],
                            "isError": false,
                        }),
                        _ => json!({
                            "content": [{
                                "type": "text",
                                "text": format!("called {tool_name}")
                            }],
                            "isError": false,
                        }),
                    }
                }
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

    /// A stdio server that completes handshake, but times out on tools/call.
    #[test]
    #[ignore = "a child process, not a test"]
    fn mcp_server_call_timeout_probe() {
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
            let method = request.get("method").and_then(Value::as_str).unwrap_or("");
            let result = match method {
                "initialize" => json!({
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "warsha-test-server", "version": "1.0.0" },
                }),
                "tools/list" => json!({
                    "tools": [{ "name": "echo", "description": "echo tool", "inputSchema": { "type": "object" } }],
                }),
                "tools/call" => loop {
                    std::thread::park();
                },
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

    /// A stdio server that completes handshake, but answers tools/call with a protocol error.
    #[test]
    #[ignore = "a child process, not a test"]
    fn mcp_server_call_error_probe() {
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
            let method = request.get("method").and_then(Value::as_str).unwrap_or("");
            let result = match method {
                "initialize" => json!({
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "warsha-test-server", "version": "1.0.0" },
                }),
                "tools/list" => json!({
                    "tools": [{ "name": "echo", "description": "echo tool", "inputSchema": { "type": "object" } }],
                }),
                "tools/call" => {
                    println!(
                        "{}",
                        json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": { "code": -32000, "message": "tool execution failed internally" },
                        })
                    );
                    continue;
                }
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
        loop {
            std::thread::park();
        }
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
        assert_eq!(connection.tool_definitions.len(), PROBE_TOOLS.len());
        assert_eq!(connection.tool_definitions[0].name, PROBE_TOOLS[0]);
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

    #[tokio::test]
    async fn test_mcp_call_tool_success() {
        let (_processes, mcp) = manager();
        mcp.connect(server_config("files", "mcp_server_probe"))
            .await
            .expect("the server connects");

        let res = mcp
            .call_tool("files", "echo", json!({ "msg": "hello from test" }))
            .await
            .expect("call_tool succeeds");

        assert!(!res.is_error);
        assert_eq!(res.content.len(), 1);
        match &res.content[0] {
            crate::mcp::McpContent::Text { text } => assert_eq!(text, "hello from test"),
            _ => panic!("expected text content"),
        }
        mcp.disconnect("files").await.expect("the server closes");
    }

    #[tokio::test]
    async fn test_mcp_call_tool_timeout() {
        let (_processes, mcp) = manager();
        mcp.connect(server_config("slow", "mcp_server_call_timeout_probe"))
            .await
            .expect("the server connects");

        let err = mcp
            .call_tool_with_timeout("slow", "echo", json!({}), Duration::from_millis(150))
            .await
            .expect_err("calling a hanging tool must timeout");

        assert!(
            matches!(&err, McpTransportError::Timeout { method, .. } if method == "tools/call"),
            "got {err:?}"
        );
        mcp.disconnect("slow").await.expect("the server closes");
    }

    #[tokio::test]
    async fn test_mcp_call_tool_protocol_error() {
        let (_processes, mcp) = manager();
        mcp.connect(server_config("bad", "mcp_server_call_error_probe"))
            .await
            .expect("the server connects");

        let err = mcp
            .call_tool("bad", "echo", json!({}))
            .await
            .expect_err("calling a failing tool must report protocol error");

        assert!(
            matches!(
                &err,
                McpTransportError::Protocol { method, problem, .. }
                    if method == "tools/call" && problem.contains("tool execution failed internally")
            ),
            "got {err:?}"
        );
        mcp.disconnect("bad").await.expect("the server closes");
    }

    /// KEEL K5a: what a launch hands a child, and how long it waits.
    ///
    /// The probes are ordinary tests that return immediately unless the marker
    /// their parent passes names them, so a plain `cargo test` run costs a few
    /// no-op functions and no ignored-test budget.
    mod spawn_hardening {
        use super::*;
        use std::time::Instant;

        const ENV_MARKER: &str = "WARSHA_K5_MCP_ENV_PROBE";
        const SILENT_MARKER: &str = "WARSHA_K5_MCP_SILENT_PROBE";
        const EXIT_MARKER: &str = "WARSHA_K5_MCP_EXIT_PROBE";
        const DAEMON_ONLY: &str = "WARSHA_K5_DAEMON_ONLY";

        /// A stdio server that answers `tools/list` with its whole environment.
        ///
        /// The dump is the description of its one tool, so the parent reads the
        /// child's environment through the normal handshake rather than a side
        /// channel the process manager would have to grow.
        #[test]
        fn env_probe() {
            if std::env::var_os(ENV_MARKER).is_none() {
                return;
            }
            // libtest writes `test <name> ... ` on stdout without a newline
            // before a non-ignored test starts; this ends that line so every
            // reply below is a clean JSON line.
            println!();
            let mut dump: Vec<String> = std::env::vars()
                .map(|(key, value)| format!("{key}={value}"))
                .collect();
            dump.sort();
            let dump = dump.join(";");
            for line in std::io::stdin().lock().lines() {
                let Ok(line) = line else { break };
                let Ok(request) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                let Some(id) = request.get("id").cloned() else {
                    continue;
                };
                let method = request.get("method").and_then(Value::as_str).unwrap_or("");
                let result = match method {
                    "initialize" => json!({
                        "protocolVersion": MCP_PROTOCOL_VERSION,
                        "capabilities": {},
                        "serverInfo": { "name": "env-probe", "version": "1.0.0" },
                    }),
                    "tools/list" => json!({
                        "tools": [{
                            "name": "env",
                            "description": format!("ENVDUMP {dump}"),
                            "inputSchema": { "type": "object" },
                        }],
                    }),
                    _ => json!({}),
                };
                println!(
                    "{}",
                    json!({ "jsonrpc": "2.0", "id": id, "result": result })
                );
            }
        }

        /// A stdio server that stays up and answers nothing.
        #[test]
        fn silent_probe() {
            if std::env::var_os(SILENT_MARKER).is_none() {
                return;
            }
            loop {
                std::thread::park();
            }
        }

        /// A stdio server that reads one frame and exits without answering.
        #[test]
        fn exit_probe() {
            if std::env::var_os(EXIT_MARKER).is_none() {
                return;
            }
            let mut line = String::new();
            let _ = std::io::stdin().lock().read_line(&mut line);
            std::process::exit(0);
        }

        /// A configuration pointing at one probe of this test binary.
        fn probe_config(name: &str, probe: &str) -> McpServerConfig {
            let exe = std::env::current_exe().expect("the test binary names itself");
            McpServerConfig::new_stdio(
                name,
                exe.to_string_lossy().into_owned(),
                vec![
                    "--exact".to_string(),
                    format!("mcp_transport::tests::spawn_hardening::{probe}"),
                    "--nocapture".to_string(),
                    "--test-threads".to_string(),
                    "1".to_string(),
                ],
            )
        }

        fn manager() -> (Arc<dyn ProcessManager>, InMemoryMcpManager) {
            let processes = InMemoryProcessManager::shared();
            let mcp = InMemoryMcpManager::new(processes.clone());
            (processes, mcp)
        }

        #[tokio::test]
        async fn a_launch_hands_the_child_only_the_manifest_environment() {
            let (_processes, mcp) = manager();
            std::env::set_var(DAEMON_ONLY, "leak");

            let mut env = HashMap::new();
            env.insert(ENV_MARKER.to_string(), "1".to_string());
            env.insert(
                "WARSHA_K5_MANIFEST_KEY".to_string(),
                "manifest-value".to_string(),
            );
            // A caller-supplied PATH is replaced by the trusted daemon PATH, not honoured.
            env.insert("PATH".to_string(), "/tmp/attacker-bin".to_string());

            mcp.connect_with(
                probe_config("env", "env_probe"),
                McpLaunchOptions::with_env(env),
            )
            .await
            .expect("the env probe connects");

            let connection = &mcp.list().await[0];
            let description = &connection.tool_definitions[0].description;
            std::env::remove_var(DAEMON_ONLY);

            assert!(
                description.contains("WARSHA_K5_MANIFEST_KEY=manifest-value"),
                "a manifest-named variable must reach the child: {description}"
            );
            let trusted_path = crate::command_policy::child_path();
            assert!(
                description.contains(&format!("PATH={trusted_path}")),
                "the child's PATH must be the trusted daemon PATH: {description}"
            );
            assert!(
                !description.contains("/tmp/attacker-bin"),
                "a caller-supplied PATH must be refused: {description}"
            );
            assert!(
                !description.contains(&format!("{DAEMON_ONLY}=leak")),
                "the daemon's own environment must not be inherited: {description}"
            );
            assert!(
                !description.contains("HOME="),
                "the user profile must not be inherited: {description}"
            );
            mcp.disconnect("env").await.expect("the server closes");
        }

        #[tokio::test]
        async fn a_response_timeout_is_per_server_with_a_thirty_second_default() {
            assert_eq!(DEFAULT_RESPONSE_TIMEOUT, Duration::from_secs(30));
            let (_processes, mcp) = manager();

            let mut env = HashMap::new();
            env.insert(SILENT_MARKER.to_string(), "1".to_string());
            let started = Instant::now();
            let error = mcp
                .connect_with(
                    probe_config("silent", "silent_probe"),
                    McpLaunchOptions::with_env(env)
                        .with_response_timeout(Duration::from_millis(250)),
                )
                .await
                .expect_err("a silent server never completes the handshake");
            let waited = started.elapsed();

            assert!(
                matches!(
                    &error,
                    McpTransportError::Timeout { method, .. } if method == "initialize"
                ),
                "got {error:?}"
            );
            assert!(
                waited < Duration::from_secs(10),
                "the per-server bound must win over the 30 s default; waited {waited:?}"
            );
        }

        #[tokio::test]
        async fn a_server_that_exits_is_reported_without_waiting_for_the_timeout() {
            let (_processes, mcp) = manager();

            let mut env = HashMap::new();
            env.insert(EXIT_MARKER.to_string(), "1".to_string());
            let started = Instant::now();
            let error = mcp
                .connect_with(
                    probe_config("exits", "exit_probe"),
                    McpLaunchOptions::with_env(env),
                )
                .await
                .expect_err("a server that dies cannot complete the handshake");
            let waited = started.elapsed();

            assert!(
                matches!(
                    &error,
                    McpTransportError::Exited { method, .. } if method == "initialize"
                ),
                "got {error:?}"
            );
            assert!(
                waited < DEFAULT_RESPONSE_TIMEOUT,
                "a gone process is reported, not waited on; waited {waited:?}"
            );
        }
    }
}

/// Review-driven repairs: a disconnected or failed record is a tombstone, not a
/// permanent duplicate.
#[cfg(test)]
mod review_repair {
    use super::*;

    fn manager() -> InMemoryMcpManager {
        InMemoryMcpManager::new(crate::process_spawn::InMemoryProcessManager::shared())
    }

    #[tokio::test]
    async fn a_disconnected_server_can_be_reconnected() {
        let mcp = manager();
        let config = McpServerConfig::new_http("srv", "https://mcp.example/mcp");
        mcp.connect(config.clone()).await.expect("records");
        mcp.disconnect("srv").await.expect("disconnects");
        mcp.connect(config)
            .await
            .expect("a disconnected name can be connected again");
    }

    #[tokio::test]
    async fn a_failed_connect_can_be_retried() {
        let mcp = manager();
        let config = McpServerConfig::new_stdio("bad", "/nonexistent-warsha-probe", vec![]);
        assert!(mcp.connect(config.clone()).await.is_err());
        match mcp.connect(config).await {
            Err(McpTransportError::Spawn { .. }) => {}
            other => panic!("a retry must reach spawn again, not Duplicate: {other:?}"),
        }
    }
}
