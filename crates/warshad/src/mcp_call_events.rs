//! The MCP call log: what an agent tool call did, written to the run's own event log.
//!
//! `warsha-pipeline` calls the MCP transport but holds no store (OD-EXT2-a), so the
//! loop hands every phase of a call to this recorder through the [`McpCallObserver`]
//! seam. What is written is the call, never its content: the phase, the server, the
//! tool, the role the permission table was consulted under, and — on the phase that
//! queued one — the approval question's id. No argument, no result, no summary, no
//! secret: the same rule `allow_once_event` follows for the owner's answer, applied to
//! the call the answer admitted.
//!
//! A failed append is logged and swallowed. The tool has already run by the time the
//! outcome is recorded, so an audit line that will not land is a reason to say so in
//! the daemon's log — never a reason to turn a successful call into a failed turn.
//!
//! The kind is the existing [`EventKind::ToolCall`], which the desktop already filters
//! for and the client already renders; this module adds emitters, not a kind.

use std::sync::Arc;

use async_trait::async_trait;
use chrono::Utc;
use serde_json::{json, Map, Value};
use tracing::warn;
use ulid::Ulid;
use warsha_core::{Event, EventKind, RunId};
use warsha_pipeline::{McpCallEvent, McpCallObserver, MCP_AGENT_ROLE};
use warsha_store::Store;

/// Records an agent MCP tool call's phases on the run's event log.
///
/// The store is the daemon's one append point, and `Store::append_event` publishes on
/// the live bus, so a client subscribed through `runs.subscribe` or `/events` sees the
/// call without a second channel (R-EXT-2 T8).
pub struct StoreMcpCallObserver {
    store: Arc<Store>,
}

impl StoreMcpCallObserver {
    /// A recorder writing to `store`.
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }

    /// The payload of one phase: the four identifying fields, plus the question id the
    /// approval-required phase queued. This is the whole event, so a caller cannot add
    /// an argument to it by accident.
    fn payload(event: &McpCallEvent) -> Value {
        let mut payload = Map::new();
        payload.insert("action".to_string(), json!("mcp_call"));
        payload.insert("phase".to_string(), json!(event.phase.as_str()));
        payload.insert("server".to_string(), json!(event.server));
        payload.insert("tool".to_string(), json!(event.tool));
        payload.insert("role".to_string(), json!(MCP_AGENT_ROLE));
        if let Some(question_id) = &event.question_id {
            payload.insert("question_id".to_string(), json!(question_id));
        }
        Value::Object(payload)
    }
}

#[async_trait]
impl McpCallObserver for StoreMcpCallObserver {
    async fn record(&self, run_id: &str, event: McpCallEvent) {
        let Ok(id) = run_id.parse::<Ulid>() else {
            // A loop bound to something that is not a run id cannot have a run's log
            // to write to; say so and let the call proceed.
            warn!("an agent MCP call named `{run_id}`, which is not a run id; not recorded");
            return;
        };
        let run_id = RunId(id);
        // The stage is the run's, read at the moment of the call: the loop does not
        // carry one, and a stage a caller supplied would be a claim, not a record.
        let stage = match self.store.get_run(run_id).await {
            Ok(run) => run.current_stage,
            Err(error) => {
                warn!(
                    "the mcp_call event for run {} was not written: {error}",
                    run_id.0
                );
                return;
            }
        };
        let record = Event {
            id: Ulid::new(),
            run_id,
            stage,
            // A call is the run's, not an agent role's: the role is in the payload,
            // where the permission table's key already lives.
            role: None,
            kind: EventKind::ToolCall,
            payload: Self::payload(&event),
            cost_cents: None,
            tokens: None,
            created_at: Utc::now(),
            device_id: None,
        };
        if let Err(error) = self.store.append_event(&record).await {
            // Never fails the call: the transport already answered, and the turn's
            // own result is what the owner reads.
            warn!(
                "the mcp_call event for run {} did not land: {error}",
                run_id.0
            );
        }
    }
}
