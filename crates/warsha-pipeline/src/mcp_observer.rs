//! The MCP call seam: what an agent tool call did, told to whoever records events.
//!
//! `AgentLoop` calls the MCP transport, but it holds no store and must not learn one
//! (OD-EXT2-a): the pipeline defines this trait and the daemon implements it, the
//! same shape [`crate::RunLiveness`] and the `ArgumentSummarizer` seam already use.
//! A loop with no observer wired — every unit test, and the daemon-wide loop that
//! turns for no run — behaves exactly as it did before this module existed.
//!
//! What crosses the seam is deliberately poor: a phase, a server, a tool and the
//! question id an `Ask` queued. Never an argument, never a result, never the redacted
//! summary. The owner's approval is already audited by `mcp_approvals`
//! (`allow_once_event`); this is the other half — the call itself, which used to leave
//! no trace in the run's log at all.

use async_trait::async_trait;

/// Where in its life one agent MCP tool call is.
///
/// `Requested` is written before the permission row is consulted, so every phase that
/// follows it belongs to a call the owner can see was asked for. The rest are
/// exclusive: a call ends `Succeeded`, `Failed`, `Denied` or `ApprovalRequired`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpCallPhase {
    /// The turn asked for `server::tool`; nothing has been decided yet.
    Requested,
    /// The permission row is `Ask` and no grant was spent: the owner has a question.
    ApprovalRequired,
    /// The permission row is `Deny`: the transport was never reached.
    Denied,
    /// The transport returned without an error.
    Succeeded,
    /// No server advertised the tool, no manager was wired, or the transport failed.
    Failed,
}

impl McpCallPhase {
    /// The wire and payload spelling, snake_case like every other event value.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Requested => "requested",
            Self::ApprovalRequired => "approval_required",
            Self::Denied => "denied",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
        }
    }
}

/// One observable moment of one agent MCP tool call.
///
/// `question_id` is set only on [`McpCallPhase::ApprovalRequired`]: it is the id
/// `mcp.approvals.list` reports and `mcp.approvals.allow_once` takes, so the event and
/// the Inbox item name the same question.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpCallEvent {
    /// Where in the call's life this is.
    pub phase: McpCallPhase,
    /// The MCP server the call names; empty when no server could be resolved.
    pub server: String,
    /// The tool the call names.
    pub tool: String,
    /// The queued approval question, on an `approval_required` phase only.
    pub question_id: Option<String>,
}

impl McpCallEvent {
    /// The event for one phase of one call.
    pub fn new(phase: McpCallPhase, server: impl Into<String>, tool: impl Into<String>) -> Self {
        Self {
            phase,
            server: server.into(),
            tool: tool.into(),
            question_id: None,
        }
    }

    /// The same event carrying the question an approval-required phase queued.
    pub fn with_question_id(mut self, question_id: Option<String>) -> Self {
        self.question_id = question_id;
        self
    }
}

/// Where an agent MCP tool call is recorded; implemented by the daemon, not here.
///
/// `record` is async because the only implementation that matters appends to the
/// store, and the store is async: a fire-and-forget seam could not promise the
/// `seq` order T2 asserts, so the call is awaited in phase order instead. A recorder
/// that fails must log and return — it may never fail the tool call, and it may never
/// change what the turn answers.
#[async_trait]
pub trait McpCallObserver: Send + Sync {
    /// Record one phase of one call. Never fails the call that produced it.
    async fn record(&self, run_id: &str, event: McpCallEvent);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// A recorder that keeps what it saw, in order.
    #[derive(Default)]
    struct Collector {
        seen: Mutex<Vec<(String, McpCallEvent)>>,
    }

    #[async_trait]
    impl McpCallObserver for Collector {
        async fn record(&self, run_id: &str, event: McpCallEvent) {
            self.seen
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push((run_id.to_string(), event));
        }
    }

    #[tokio::test]
    async fn a_phase_names_itself_in_snake_case() {
        let phases = [
            (McpCallPhase::Requested, "requested"),
            (McpCallPhase::ApprovalRequired, "approval_required"),
            (McpCallPhase::Denied, "denied"),
            (McpCallPhase::Succeeded, "succeeded"),
            (McpCallPhase::Failed, "failed"),
        ];
        for (phase, name) in phases {
            assert_eq!(phase.as_str(), name);
        }
    }

    #[tokio::test]
    async fn an_event_carries_the_call_and_only_the_question_id() {
        let event = McpCallEvent::new(McpCallPhase::Requested, "srv", "echo");
        assert_eq!(event.server, "srv");
        assert_eq!(event.tool, "echo");
        assert_eq!(event.question_id, None);

        let asked = event.with_question_id(Some("q-1".to_string()));
        assert_eq!(asked.question_id.as_deref(), Some("q-1"));

        let collector = Collector::default();
        collector.record("run-1", asked.clone()).await;
        let seen = collector
            .seen
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        assert_eq!(seen, vec![("run-1".to_string(), asked)]);
    }
}
