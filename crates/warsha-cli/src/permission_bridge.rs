//! The claude-code permission bridge (B2): a stdin/stdout loop that forwards
//! the CLI's permission asks to the daemon's approval queue and writes the
//! decision back. Launched as `warsha mcp permission-bridge <run-id>` with the
//! run-scoped token in `WARSHA_RUN_TOKEN` — env-only, memory-only, and it
//! expires with the run (§3.2).

use std::time::Duration;

use jsonrpsee::core::client::ClientT;
use jsonrpsee::http_client::HttpClient;
use jsonrpsee::rpc_params;
use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncWrite, AsyncWriteExt};

/// How often the bridge re-polls the daemon for a decision.
const POLL_INTERVAL: Duration = Duration::from_millis(500);

/// How long the bridge waits before it denies on its own (B2: the run's asks
/// must not hang the CLI forever — the daemon's queue already expires them).
const DECISION_TIMEOUT: Duration = Duration::from_secs(30 * 60);

/// The ask line the bridge forwards, as the CLI's MCP layer formats it.
#[derive(Deserialize)]
struct PermissionAsk {
    server: String,
    tool: String,
    #[serde(default)]
    arguments: Option<serde_json::Value>,
    #[serde(default)]
    summary: Option<String>,
}

/// The daemon's answer to a forwarded ask.
#[derive(Deserialize)]
struct PermissionAskAccepted {
    id: String,
}

/// The decision the bridge polls for.
#[derive(Deserialize)]
struct PermissionDecision {
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    allow: Option<bool>,
}

/// Serve the bridge for one run: read ask lines from stdin, forward each to
/// the daemon, poll for the decision, and write `{"allow": bool}` back.
pub async fn serve(client: &HttpClient, run_id: &str) -> anyhow::Result<()> {
    let mut lines = tokio::io::BufReader::new(tokio::io::stdin()).lines();
    let mut writer = tokio::io::stdout();

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let ask: PermissionAsk = match serde_json::from_str(&line) {
            Ok(ask) => ask,
            Err(error) => {
                // A line the bridge cannot parse is denied, never guessed.
                write_decision(&mut writer, false).await?;
                tracing::warn!(%error, "permission-bridge: unparseable ask line");
                continue;
            }
        };
        let arguments = ask.arguments.unwrap_or(serde_json::Value::Null);
        let summary = ask.summary.unwrap_or_default();
        let accepted: PermissionAskAccepted = client
            .request(
                "permissions.ask",
                rpc_params![run_id, ask.server, ask.tool, arguments, summary],
            )
            .await
            .map_err(|error| anyhow::anyhow!("the daemon refused the ask: {error}"))?;
        let allow = wait_for_decision(client, &accepted.id).await?;
        write_decision(&mut writer, allow).await?;
    }
    Ok(())
}

/// Poll the daemon until the ask resolves, deny past the cap.
async fn wait_for_decision(client: &HttpClient, id: &str) -> anyhow::Result<bool> {
    let started = std::time::Instant::now();
    loop {
        tokio::time::sleep(POLL_INTERVAL).await;
        let decision: PermissionDecision = client
            .request("permissions.decision", rpc_params![id])
            .await
            .map_err(|error| anyhow::anyhow!("the daemon refused the decision poll: {error}"))?;
        if decision.status.as_deref() == Some("resolved") {
            return Ok(decision.allow.unwrap_or(false));
        }
        if started.elapsed() > DECISION_TIMEOUT {
            // Unanswered past the cap = deny (fail closed).
            return Ok(false);
        }
    }
}

/// Write one decision line the CLI's MCP layer parses.
async fn write_decision<W: AsyncWrite + Unpin>(writer: &mut W, allow: bool) -> std::io::Result<()> {
    let line = serde_json::json!({ "allow": allow });
    writer.write_all(line.to_string().as_bytes()).await?;
    writer.write_all(b"\n").await?;
    writer.flush().await
}
