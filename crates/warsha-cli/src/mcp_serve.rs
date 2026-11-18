//! Stdio MCP server (`warsha mcp serve`).
//!
//! Speaks newline-delimited JSON-RPC 2.0 (MCP protocol revision `2024-11-05`)
//! over an `AsyncBufRead` input stream and `AsyncWrite` output stream.
//!
//! **Critical security invariant (`SECURITY.md` + `PROGRAM_PLAN.md` §2.8):**
//! Only the five safe tools (`list_projects`, `list_runs`, `run_status`,
//! `pending_gates`, `start_run`) are advertised or callable. Gate-decision tools
//! (`gates.approve`, `gates.reject`, `gates.changes`) and secret/plugin/device
//! mutation tools are never exposed or dispatched.

use crate::Result;
use jsonrpsee::core::client::ClientT;
use jsonrpsee::http_client::HttpClient;
use jsonrpsee::rpc_params;
use serde::Serialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt};
use ulid::Ulid;
use uuid::Uuid;
use warsha_core::{DeviceId, Project, ProjectId, Run, RunId};
use warshad::{GateSummary, GateSummaryState};

/// MCP protocol version implemented by this server.
pub const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

/// MCP server name advertised during `initialize`.
pub const SERVER_NAME: &str = "warsha-mcp";

/// JSON-RPC 2.0 standard error codes.
const JSON_RPC_PARSE_ERROR: i64 = -32700;
const JSON_RPC_INVALID_REQUEST: i64 = -32600;
const JSON_RPC_METHOD_NOT_FOUND: i64 = -32601;
const JSON_RPC_INVALID_PARAMS: i64 = -32602;

/// The five safe MCP tool names exposed by `warsha mcp serve`.
pub const ALLOWED_TOOLS: [&str; 5] = [
    "list_projects",
    "list_runs",
    "run_status",
    "pending_gates",
    "start_run",
];

/// Serve the MCP protocol over process stdin/stdout using the authenticated
/// daemon RPC client.
///
/// `stdout` is strictly reserved for newline-delimited JSON-RPC 2.0 frames;
/// tracing in `main.rs` is configured to write only to `stderr`.
pub async fn serve_stdio(client: &HttpClient) -> Result<()> {
    let stdin = tokio::io::BufReader::new(tokio::io::stdin());
    let stdout = tokio::io::stdout();
    serve(stdin, stdout, client).await
}

/// Serve newline-delimited JSON-RPC 2.0 MCP frames from `reader` to `writer`
/// using `client` to call the Warsha daemon.
pub async fn serve<R, W>(reader: R, mut writer: W, client: &HttpClient) -> Result<()>
where
    R: AsyncBufRead + Unpin + Send,
    W: AsyncWrite + Unpin + Send,
{
    let mut lines = reader.lines();
    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let Some(response) = handle_line(&line, client).await else {
            continue;
        };
        let mut encoded = serde_json::to_string(&response)?;
        encoded.push('\n');
        writer.write_all(encoded.as_bytes()).await?;
        writer.flush().await?;
    }
    Ok(())
}

/// Return the MCP tool metadata definitions for `tools/list`.
pub fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "list_projects",
            "description": "List all Warsha projects.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        }),
        json!({
            "name": "list_runs",
            "description": "List all pipeline runs for a Warsha project.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project_id": {
                        "type": "string",
                        "description": "Project UUID."
                    }
                },
                "required": ["project_id"]
            }
        }),
        json!({
            "name": "run_status",
            "description": "Get status, current stage, and gate states for a run.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "run_id": {
                        "type": "string",
                        "description": "Run ULID."
                    }
                },
                "required": ["run_id"]
            }
        }),
        json!({
            "name": "pending_gates",
            "description": "List pending approval gates for a run.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "run_id": {
                        "type": "string",
                        "description": "Run ULID."
                    }
                },
                "required": ["run_id"]
            }
        }),
        json!({
            "name": "start_run",
            "description": "Start a new pipeline run for an existing project. Modes: agent (default, executes), plan (stops at the plan-approval gate before code), spec-file (plan from a spec file inside the repository).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project_id": {
                        "type": "string",
                        "description": "Project UUID."
                    },
                    "idea": {
                        "type": "string",
                        "description": "Idea description or task brief for the run."
                    },
                    "run_mode": {
                        "type": "string",
                        "description": "Optional run mode: agent, plan, or spec-file. Defaults to agent.",
                        "enum": ["agent", "plan", "spec-file", "ask"]
                    },
                    "spec_file_path": {
                        "type": "string",
                        "description": "Spec-file mode: path of the spec file inside the repository, taken as the run's brief (treated as untrusted data)."
                    }
                },
                "required": ["project_id", "idea"]
            }
        }),
    ]
}

async fn handle_line(line: &str, client: &HttpClient) -> Option<Value> {
    let request: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(err) => {
            return Some(json_rpc_error(
                Value::Null,
                JSON_RPC_PARSE_ERROR,
                format!("Parse error: {err}"),
            ));
        }
    };

    let Some(obj) = request.as_object() else {
        return Some(json_rpc_error(
            Value::Null,
            JSON_RPC_INVALID_REQUEST,
            "Invalid Request: expected JSON object",
        ));
    };

    // Notifications omit `id` and must never produce a response frame.
    let id = obj.get("id").cloned()?;

    if !(id.is_null() || id.is_string() || id.is_number()) {
        return Some(json_rpc_error(
            Value::Null,
            JSON_RPC_INVALID_REQUEST,
            "Invalid Request: `id` must be a string, number, or null",
        ));
    }

    if obj.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return Some(json_rpc_error(
            id,
            JSON_RPC_INVALID_REQUEST,
            "Invalid Request: `jsonrpc` must be \"2.0\"",
        ));
    }

    let Some(method) = obj.get("method").and_then(Value::as_str) else {
        return Some(json_rpc_error(
            id,
            JSON_RPC_INVALID_REQUEST,
            "Invalid Request: missing string `method`",
        ));
    };

    if method.starts_with("notifications/") && id.is_null() {
        return None;
    }

    let params = obj.get("params").cloned().unwrap_or(Value::Null);

    match method {
        "initialize" => Some(json_rpc_result(id, handle_initialize())),
        "ping" => Some(json_rpc_result(id, json!({}))),
        "tools/list" => Some(json_rpc_result(
            id,
            json!({
                "tools": tool_definitions()
            }),
        )),
        "tools/call" => Some(handle_tools_call(id, params, client).await),
        other => Some(json_rpc_error(
            id,
            JSON_RPC_METHOD_NOT_FOUND,
            format!("Method not found: {other}"),
        )),
    }
}

fn handle_initialize() -> Value {
    json!({
        "protocolVersion": MCP_PROTOCOL_VERSION,
        "capabilities": {
            "tools": {}
        },
        "serverInfo": {
            "name": SERVER_NAME,
            "version": env!("CARGO_PKG_VERSION")
        }
    })
}

async fn handle_tools_call(id: Value, params: Value, client: &HttpClient) -> Value {
    let Some(params_obj) = params.as_object() else {
        return json_rpc_error(
            id,
            JSON_RPC_INVALID_PARAMS,
            "Invalid params: expected object",
        );
    };

    let Some(tool_name) = params_obj.get("name").and_then(Value::as_str) else {
        return json_rpc_error(
            id,
            JSON_RPC_INVALID_PARAMS,
            "Invalid params: missing string `name`",
        );
    };

    let arguments = match params_obj.get("arguments") {
        None | Some(Value::Null) => json!({}),
        Some(value) if value.is_object() => value.clone(),
        Some(_) => {
            return json_rpc_result(id, tool_error("Invalid arguments: expected JSON object"));
        }
    };

    tracing::debug!(tool = %tool_name, "dispatching MCP tool call");

    match tool_name {
        "list_projects" => json_rpc_result(id, call_list_projects(client).await),
        "list_runs" => json_rpc_result(id, call_list_runs(client, &arguments).await),
        "run_status" => json_rpc_result(id, call_run_status(client, &arguments).await),
        "pending_gates" => json_rpc_result(id, call_pending_gates(client, &arguments).await),
        "start_run" => json_rpc_result(id, call_start_run(client, &arguments).await),
        unknown => json_rpc_error(
            id,
            JSON_RPC_METHOD_NOT_FOUND,
            format!("Unknown tool: {unknown}"),
        ),
    }
}

async fn call_list_projects(client: &HttpClient) -> Value {
    match client
        .request::<Vec<Project>, _>("projects.list", rpc_params![])
        .await
    {
        Ok(projects) => tool_ok_json(&projects),
        Err(err) => tool_error(format!("Daemon RPC error (projects.list): {err}")),
    }
}

async fn call_list_runs(client: &HttpClient, args: &Value) -> Value {
    let project_id = match parse_project_id(args) {
        Ok(id) => id,
        Err(msg) => return tool_error(msg),
    };
    match client
        .request::<Vec<Run>, _>("runs.list", (project_id,))
        .await
    {
        Ok(runs) => tool_ok_json(&runs),
        Err(err) => tool_error(format!("Daemon RPC error (runs.list): {err}")),
    }
}

async fn call_run_status(client: &HttpClient, args: &Value) -> Value {
    let run_id = match parse_run_id(args) {
        Ok(id) => id,
        Err(msg) => return tool_error(msg),
    };
    match client.request::<Run, _>("runs.get", (run_id,)).await {
        Ok(run) => tool_ok_json(&run),
        Err(err) => tool_error(format!("Daemon RPC error (runs.get): {err}")),
    }
}

async fn call_pending_gates(client: &HttpClient, args: &Value) -> Value {
    let run_id = match parse_run_id(args) {
        Ok(id) => id,
        Err(msg) => return tool_error(msg),
    };
    match client
        .request::<Vec<GateSummary>, _>("gates.list", (run_id, None::<DeviceId>))
        .await
    {
        Ok(gates) => {
            let pending: Vec<GateSummary> = gates
                .into_iter()
                .filter(|gate| matches!(gate.state, GateSummaryState::Pending))
                .collect();
            tool_ok_json(&pending)
        }
        Err(err) => tool_error(format!("Daemon RPC error (gates.list): {err}")),
    }
}

async fn call_start_run(client: &HttpClient, args: &Value) -> Value {
    let project_id = match parse_project_id(args) {
        Ok(id) => id,
        Err(msg) => return tool_error(msg),
    };
    let idea = match parse_non_empty_string(args, "idea") {
        Ok(idea) => idea,
        Err(msg) => return tool_error(msg),
    };
    // D4: optional run mode + spec-file path. The wire keeps trailing positional
    // Options so an older client tuple still parses; a mode the daemon cannot
    // parse is passed through rather than second-guessed here (the RPC layer
    // already defaults unknown modes to `agent`).
    let run_mode = args
        .get("run_mode")
        .and_then(Value::as_str)
        .map(str::to_string);
    let spec_file_path = args
        .get("spec_file_path")
        .and_then(Value::as_str)
        .map(str::to_string);
    match client
        .request::<Run, _>("runs.start", (project_id, idea, run_mode, spec_file_path))
        .await
    {
        Ok(run) => tool_ok_json(&run),
        Err(err) => tool_error(format!("Daemon RPC error (runs.start): {err}")),
    }
}

fn parse_project_id(args: &Value) -> std::result::Result<ProjectId, String> {
    let raw = args
        .get("project_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Missing required argument `project_id`".to_string())?;
    Uuid::parse_str(raw)
        .map(ProjectId)
        .map_err(|err| format!("Invalid `project_id` UUID `{raw}`: {err}"))
}

fn parse_run_id(args: &Value) -> std::result::Result<RunId, String> {
    let raw = args
        .get("run_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Missing required argument `run_id`".to_string())?;
    Ulid::from_string(raw)
        .map(RunId)
        .map_err(|err| format!("Invalid `run_id` ULID `{raw}`: {err}"))
}

fn parse_non_empty_string(args: &Value, field: &str) -> std::result::Result<String, String> {
    let raw = args
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Missing required string argument `{field}`"))?;
    if raw.trim().is_empty() {
        return Err(format!("Argument `{field}` must not be empty"));
    }
    Ok(raw.to_string())
}

fn tool_ok_json<T: Serialize>(value: &T) -> Value {
    match serde_json::to_string_pretty(value) {
        Ok(text) => json!({
            "content": [{
                "type": "text",
                "text": text
            }],
            "isError": false
        }),
        Err(err) => tool_error(format!("Failed to serialize tool response: {err}")),
    }
}

fn tool_error(message: impl Into<String>) -> Value {
    json!({
        "content": [{
            "type": "text",
            "text": message.into()
        }],
        "isError": true
    })
}

fn json_rpc_result(id: Value, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    })
}

fn json_rpc_error(id: Value, code: i64, message: impl Into<String>) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message.into()
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonrpsee::http_client::HttpClientBuilder;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    fn dummy_client() -> HttpClient {
        HttpClientBuilder::default()
            .build("http://127.0.0.1:1")
            .expect("dummy http client builds")
    }

    async fn send_line(writer: &mut tokio::io::DuplexStream, value: &Value) {
        let mut encoded = serde_json::to_string(value).expect("serialize request");
        encoded.push('\n');
        writer
            .write_all(encoded.as_bytes())
            .await
            .expect("write request");
        writer.flush().await.expect("flush request");
    }

    async fn read_reply(
        reader: &mut tokio::io::Lines<BufReader<tokio::io::DuplexStream>>,
    ) -> Value {
        let line = tokio::time::timeout(std::time::Duration::from_secs(2), reader.next_line())
            .await
            .expect("reply did not time out")
            .expect("read line succeeds")
            .expect("unexpected EOF before reply");
        serde_json::from_str(&line).expect("reply is valid JSON")
    }

    #[tokio::test]
    async fn handshake_notifications_and_tools_list_over_duplex_streams() {
        let (client_tx, server_rx) = tokio::io::duplex(8192);
        let (server_tx, client_rx) = tokio::io::duplex(8192);

        let client = dummy_client();
        let server_task = tokio::spawn(async move {
            serve(BufReader::new(server_rx), server_tx, &client)
                .await
                .expect("serve succeeds");
        });

        let mut writer = client_tx;
        let mut reader = BufReader::new(client_rx).lines();

        // 1. initialize
        send_line(
            &mut writer,
            &json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": { "name": "test-client", "version": "0.1.0" }
                }
            }),
        )
        .await;

        let init_reply = read_reply(&mut reader).await;
        assert_eq!(init_reply["jsonrpc"], "2.0");
        assert_eq!(init_reply["id"], 1);
        assert_eq!(init_reply["result"]["protocolVersion"], "2024-11-05");
        assert_eq!(init_reply["result"]["capabilities"], json!({ "tools": {} }));
        assert_eq!(init_reply["result"]["serverInfo"]["name"], "warsha-mcp");
        assert_eq!(
            init_reply["result"]["serverInfo"]["version"],
            env!("CARGO_PKG_VERSION")
        );

        // 2. notifications/initialized (no `id` -> MUST NOT emit any response line)
        send_line(
            &mut writer,
            &json!({
                "jsonrpc": "2.0",
                "method": "notifications/initialized"
            }),
        )
        .await;

        // 3. tools/list — if notification erroneously emitted a line, id 2 would not be next.
        send_line(
            &mut writer,
            &json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list",
                "params": {}
            }),
        )
        .await;

        let list_reply = read_reply(&mut reader).await;
        assert_eq!(list_reply["id"], 2);
        let tools = list_reply["result"]["tools"]
            .as_array()
            .expect("tools array present");

        let names: Vec<&str> = tools
            .iter()
            .map(|t| t["name"].as_str().expect("tool has string name"))
            .collect();
        assert_eq!(
            names,
            vec![
                "list_projects",
                "list_runs",
                "run_status",
                "pending_gates",
                "start_run",
            ],
            "tools/list must expose ONLY the five safe tools"
        );

        // Verify schemas of required arguments
        let schema_of = |name: &str| -> &Value {
            tools
                .iter()
                .find(|t| t["name"] == name)
                .expect("tool present")
                .get("inputSchema")
                .expect("inputSchema present")
        };
        assert_eq!(schema_of("list_runs")["required"], json!(["project_id"]));
        assert_eq!(schema_of("run_status")["required"], json!(["run_id"]));
        assert_eq!(schema_of("pending_gates")["required"], json!(["run_id"]));
        assert_eq!(
            schema_of("start_run")["required"],
            json!(["project_id", "idea"])
        );

        // Security invariant: no gate decision or secret/plugin mutation tool exposed.
        for forbidden_substring in [
            "approve",
            "reject",
            "request_changes",
            "changes",
            "secret",
            "plugin",
            "provider",
            "device",
            "pair",
        ] {
            for name in &names {
                assert!(
                    !name.contains(forbidden_substring),
                    "security invariant violated: exposed tool `{name}` matches `{forbidden_substring}`"
                );
            }
        }

        // Close client write half -> server exits cleanly.
        drop(writer);
        assert!(reader.next_line().await.expect("eof").is_none());
        server_task.await.expect("server task finishes cleanly");
    }

    #[tokio::test]
    async fn unknown_tools_and_forbidden_gate_calls_fail_safely() {
        let (client_tx, server_rx) = tokio::io::duplex(8192);
        let (server_tx, client_rx) = tokio::io::duplex(8192);

        let client = dummy_client();
        let server_task = tokio::spawn(async move {
            serve(BufReader::new(server_rx), server_tx, &client)
                .await
                .expect("serve succeeds");
        });

        let mut writer = client_tx;
        let mut reader = BufReader::new(client_rx).lines();

        for (idx, tool_name) in [
            "approve_gate",
            "reject_gate",
            "request_changes",
            "gates.approve",
            "providers.add",
            "nonexistent_tool",
        ]
        .iter()
        .enumerate()
        {
            let id = idx as u64 + 10;
            send_line(
                &mut writer,
                &json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "method": "tools/call",
                    "params": {
                        "name": tool_name,
                        "arguments": {}
                    }
                }),
            )
            .await;

            let reply = read_reply(&mut reader).await;
            assert_eq!(reply["id"], id);
            assert!(
                reply.get("result").is_none(),
                "unknown/forbidden tool `{tool_name}` must not succeed"
            );
            assert_eq!(
                reply["error"]["code"], JSON_RPC_METHOD_NOT_FOUND,
                "expected -32601 for `{tool_name}`, got {reply}"
            );
        }

        // Unknown JSON-RPC method returns -32601
        send_line(
            &mut writer,
            &json!({
                "jsonrpc": "2.0",
                "id": 99,
                "method": "resources/list"
            }),
        )
        .await;
        let method_err = read_reply(&mut reader).await;
        assert_eq!(method_err["id"], 99);
        assert_eq!(method_err["error"]["code"], JSON_RPC_METHOD_NOT_FOUND);

        // Malformed JSON produces -32700 parse error without crashing loop
        writer
            .write_all(b"{not json\n")
            .await
            .expect("write malformed");
        writer.flush().await.expect("flush");
        let parse_err = read_reply(&mut reader).await;
        assert_eq!(parse_err["id"], Value::Null);
        assert_eq!(parse_err["error"]["code"], JSON_RPC_PARSE_ERROR);

        // Invalid UUID/ULID arguments fail with MCP ToolResult isError: true
        send_line(
            &mut writer,
            &json!({
                "jsonrpc": "2.0",
                "id": 100,
                "method": "tools/call",
                "params": {
                    "name": "list_runs",
                    "arguments": { "project_id": "not-a-uuid" }
                }
            }),
        )
        .await;
        let bad_uuid = read_reply(&mut reader).await;
        assert_eq!(bad_uuid["id"], 100);
        assert_eq!(bad_uuid["result"]["isError"], true);

        send_line(
            &mut writer,
            &json!({
                "jsonrpc": "2.0",
                "id": 101,
                "method": "tools/call",
                "params": {
                    "name": "pending_gates",
                    "arguments": { "run_id": "not-a-ulid" }
                }
            }),
        )
        .await;
        let bad_ulid = read_reply(&mut reader).await;
        assert_eq!(bad_ulid["id"], 101);
        assert_eq!(bad_ulid["result"]["isError"], true);

        // Missing required arguments produce MCP ToolResult isError: true
        for (req_id, tool_name, arguments) in [
            (102u64, "list_runs", json!({})),
            (103u64, "run_status", json!({})),
            (104u64, "pending_gates", json!({})),
            (
                105u64,
                "start_run",
                json!({ "project_id": "11111111-1111-4111-8111-111111111111" }),
            ),
            (
                106u64,
                "start_run",
                json!({ "project_id": "11111111-1111-4111-8111-111111111111", "idea": "   " }),
            ),
        ] {
            send_line(
                &mut writer,
                &json!({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "method": "tools/call",
                    "params": { "name": tool_name, "arguments": arguments }
                }),
            )
            .await;
            let reply = read_reply(&mut reader).await;
            assert_eq!(reply["id"], req_id);
            assert_eq!(
                reply["result"]["isError"], true,
                "missing/empty args for `{tool_name}` must return isError: true"
            );
        }

        drop(writer);
        server_task.await.expect("server exits cleanly");
    }
}
