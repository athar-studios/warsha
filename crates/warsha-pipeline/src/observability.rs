//! Observability — an in-tree, OpenTelemetry-shaped tracer for the Advanced-mode
//! timeline.
//!
//! Spans carry a kind, a parent, attributes and a status like OTel spans, but
//! they live in memory in this process: no exporter, no extra dependency.
//! Every attribute value passes through [`crate::guardrails::mask_secrets`]
//! before it is stored.

use chrono::{DateTime, Utc};
use std::collections::HashMap;
use ulid::Ulid;

use crate::guardrails::mask_secrets;

/// Attribute key that scopes a span (and its descendants) to one pipeline run.
pub const RUN_ID_ATTRIBUTE: &str = "run_id";

/// What a span represents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SpanKind {
    /// One agent step (a role acting on a stage).
    AgentStep,
    /// A prompt assembly or provider call.
    Prompt,
    /// A tool call issued by an agent.
    ToolCall,
    /// A tool result returned to an agent.
    ToolResult,
    /// A call to an MCP server.
    McpCall,
}

impl SpanKind {
    /// Stable snake_case tag for logs and UI.
    pub fn as_str(self) -> &'static str {
        match self {
            SpanKind::AgentStep => "agent_step",
            SpanKind::Prompt => "prompt",
            SpanKind::ToolCall => "tool_call",
            SpanKind::ToolResult => "tool_result",
            SpanKind::McpCall => "mcp_call",
        }
    }
}

impl std::fmt::Display for SpanKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Outcome of a span.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum SpanStatus {
    /// Finished without error.
    #[default]
    Ok,
    /// Finished with an error message.
    Error(String),
}

/// One traced unit of work.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Span {
    /// Unique span id.
    pub id: String,
    /// Id of the span that contains this one, if any.
    pub parent_id: Option<String>,
    /// What the span represents.
    pub kind: SpanKind,
    /// Human-readable name, e.g. the role or the tool name.
    pub name: String,
    /// When the span started.
    pub started_at: DateTime<Utc>,
    /// When the span ended; `None` while it is still open.
    pub ended_at: Option<DateTime<Utc>>,
    /// Attributes, always stored masked.
    pub attributes: HashMap<String, String>,
    /// Outcome of the span.
    pub status: SpanStatus,
}

impl Span {
    /// True when the span has not been ended yet.
    pub fn is_open(&self) -> bool {
        self.ended_at.is_none()
    }

    /// Wall-clock duration of the span, in milliseconds.
    pub fn duration_ms(&self) -> Option<i64> {
        self.ended_at
            .map(|ended| (ended - self.started_at).num_milliseconds())
    }
}

/// In-memory span collector.
///
/// Spans are returned in start order, which is the order the Advanced-mode
/// timeline renders them in.
#[derive(Debug, Clone, Default)]
pub struct Tracer {
    spans: Vec<Span>,
}

impl Tracer {
    /// Create an empty tracer.
    pub fn new() -> Self {
        Self::default()
    }

    /// Start a span, returning its id.
    ///
    /// Attribute values are masked with [`mask_secrets`] before storage.
    pub fn start_span(
        &mut self,
        kind: SpanKind,
        name: impl Into<String>,
        parent_id: Option<&str>,
        attributes: HashMap<String, String>,
    ) -> String {
        let id = Ulid::new().to_string();
        let span = Span {
            id: id.clone(),
            parent_id: parent_id.map(str::to_string),
            kind,
            name: name.into(),
            started_at: Utc::now(),
            ended_at: None,
            attributes: sanitize_attributes(attributes),
            status: SpanStatus::Ok,
        };
        self.spans.push(span);
        id
    }

    /// End an open span, returning it.
    ///
    /// Returns `None` when the id is unknown or the span already ended.
    pub fn end_span(&mut self, id: &str, status: SpanStatus) -> Option<Span> {
        let span = self.spans.iter_mut().rev().find(|span| span.id == id)?;
        if span.ended_at.is_some() {
            return None;
        }
        span.ended_at = Some(Utc::now());
        span.status = status;
        Some(span.clone())
    }

    /// Every span, in start order.
    pub fn spans(&self) -> &[Span] {
        &self.spans
    }

    /// The spans attributed to `run_id`, in start order.
    ///
    /// The needle is masked the same way the stored attribute was, so run ids
    /// that look like opaque tokens still match.
    pub fn spans_for_run(&self, run_id: &str) -> Vec<&Span> {
        let needle = mask_secrets(run_id);
        self.spans
            .iter()
            .filter(|span| {
                span.attributes
                    .get(RUN_ID_ATTRIBUTE)
                    .is_some_and(|value| *value == needle)
            })
            .collect()
    }

    /// The span with `id`, if it was recorded here.
    pub fn span(&self, id: &str) -> Option<&Span> {
        self.spans.iter().find(|span| span.id == id)
    }

    /// Number of recorded spans.
    pub fn len(&self) -> usize {
        self.spans.len()
    }

    /// True when no span has been started yet.
    pub fn is_empty(&self) -> bool {
        self.spans.is_empty()
    }
}

/// Mask every attribute value and its key before storage.
fn sanitize_attributes(attributes: HashMap<String, String>) -> HashMap<String, String> {
    attributes
        .into_iter()
        .map(|(key, value)| (mask_secrets(&key), mask_secrets(&value)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attributes(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect()
    }

    #[test]
    fn spans_are_returned_in_start_order_with_parents() {
        let mut tracer = Tracer::new();
        assert!(tracer.is_empty());

        let mut step_attributes = attributes(&[(RUN_ID_ATTRIBUTE, "run-1"), ("role", "coder")]);
        step_attributes.insert("step".to_string(), "1".to_string());
        let step = tracer.start_span(SpanKind::AgentStep, "coder", None, step_attributes);

        let mut prompt_attributes = attributes(&[(RUN_ID_ATTRIBUTE, "run-1"), ("model", "mock")]);
        prompt_attributes.insert("prompt".to_string(), "write a test".to_string());
        let prompt = tracer.start_span(SpanKind::Prompt, "prompt", Some(&step), prompt_attributes);

        let mut call_attributes = attributes(&[(RUN_ID_ATTRIBUTE, "run-1")]);
        call_attributes.insert("tool".to_string(), "read_file".to_string());
        let call = tracer.start_span(
            SpanKind::ToolCall,
            "read_file",
            Some(&prompt),
            call_attributes,
        );

        let mut other_attributes = attributes(&[(RUN_ID_ATTRIBUTE, "run-2")]);
        other_attributes.insert("tool".to_string(), "grep".to_string());
        tracer.start_span(SpanKind::McpCall, "grep", None, other_attributes);

        let names: Vec<&str> = tracer
            .spans()
            .iter()
            .map(|span| span.name.as_str())
            .collect();
        assert_eq!(names, vec!["coder", "prompt", "read_file", "grep"]);
        assert_eq!(tracer.len(), 4);

        let run_one = tracer.spans_for_run("run-1");
        assert_eq!(run_one.len(), 3);
        assert_eq!(run_one[1].parent_id.as_deref(), Some(step.as_str()));
        assert_eq!(run_one[2].parent_id.as_deref(), Some(prompt.as_str()));
        assert_eq!(tracer.spans_for_run("run-2").len(), 1);
        assert!(tracer.spans_for_run("run-3").is_empty());

        assert!(tracer.span(&call).is_some());
        assert!(tracer.span(&step).is_some_and(Span::is_open));
    }

    #[test]
    fn ending_a_span_sets_status_and_duration() {
        let mut tracer = Tracer::new();
        let id = tracer.start_span(
            SpanKind::ToolResult,
            "read_file",
            None,
            attributes(&[(RUN_ID_ATTRIBUTE, "run-1")]),
        );

        let ended = tracer.end_span(&id, SpanStatus::Error("tool failed".to_string()));
        let ended = match ended {
            Some(span) => span,
            None => panic!("span {id} should have ended"),
        };

        assert_eq!(ended.status, SpanStatus::Error("tool failed".to_string()));
        assert!(!ended.is_open());
        assert!(ended.ended_at.is_some());
        assert!(ended.duration_ms().is_some_and(|ms| ms >= 0));

        // Ending twice does nothing.
        assert!(tracer.end_span(&id, SpanStatus::Ok).is_none());
        assert!(tracer.end_span("missing", SpanStatus::Ok).is_none());
    }

    #[test]
    fn attributes_are_masked_before_storage() {
        let mut tracer = Tracer::new();
        let id = tracer.start_span(
            SpanKind::Prompt,
            "prompt",
            None,
            attributes(&[
                (RUN_ID_ATTRIBUTE, "run-1"),
                ("api_key", "sk-abc123def456ghi789"),
                (
                    "authorization",
                    "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
                ),
                ("owner", "moe@example.com"),
            ]),
        );

        let span = match tracer.span(&id) {
            Some(span) => span,
            None => panic!("span {id} should exist"),
        };

        assert_eq!(
            span.attributes.get("api_key").map(String::as_str),
            Some(crate::guardrails::REDACTED)
        );
        assert_eq!(
            span.attributes.get("owner").map(String::as_str),
            Some(crate::guardrails::REDACTED)
        );
        let authorization = span
            .attributes
            .get("authorization")
            .map(String::as_str)
            .unwrap_or_default();
        assert!(authorization.contains(crate::guardrails::REDACTED));

        let rendered = format!("{:?}", span.attributes);
        assert!(!rendered.contains("sk-abc123def456ghi789"));
        assert!(!rendered.contains("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"));
        assert!(!rendered.contains("moe@example.com"));
        assert_eq!(
            span.attributes.get(RUN_ID_ATTRIBUTE).map(String::as_str),
            Some("run-1")
        );
    }

    #[test]
    fn span_kinds_have_stable_tags() {
        let kinds = [
            (SpanKind::AgentStep, "agent_step"),
            (SpanKind::Prompt, "prompt"),
            (SpanKind::ToolCall, "tool_call"),
            (SpanKind::ToolResult, "tool_result"),
            (SpanKind::McpCall, "mcp_call"),
        ];
        for (kind, tag) in kinds {
            assert_eq!(kind.as_str(), tag);
            assert_eq!(kind.to_string(), tag);
        }
    }
}
