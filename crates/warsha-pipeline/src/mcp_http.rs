//! The Streamable HTTP transport's seam: what the manager asks for, and what a
//! client answers with (R-EXT-4, X3).
//!
//! The MCP revision this module speaks (2025-06-18, "Streamable HTTP") puts every
//! JSON-RPC message on a fresh `POST` to one endpoint: the reply to a request is
//! either one `application/json` object or a `text/event-stream` whose `data:`
//! lines are JSON-RPC messages, and a notification is answered `202 Accepted` with
//! no body. Sessions are the server's idea — an `Mcp-Session-Id` it hands out in
//! the `initialize` reply, which the client echoes on every later request — and an
//! expired one is a `404`.
//!
//! Two halves, split the way R-EXT-2 and R-EXT-3 split theirs:
//!
//! - **This module is the half that knows no HTTP library.** [`McpHttpClient`] is
//!   the trait, [`McpHttpRequest`]/[`McpHttpReply`] are what crosses it, and
//!   [`McpHttpError`] is every way it can fail. `warsha-pipeline` has no `reqwest`
//!   and may not gain one (`docs/ARCH_RULES.md` R2 keeps the pipeline free of the
//!   daemon's stack and of an HTTP client); the daemon implements the trait
//!   (`warshad::mcp_http::ReqwestMcpHttp`) and injects it with
//!   [`InMemoryMcpManager::with_http_client`](crate::mcp_transport::InMemoryMcpManager::with_http_client).
//! - **The SSE parser is here, and it is pure.** [`SseDecoder`] turns bytes into
//!   events with no socket, no runtime and no timer, so the part with the fiddly
//!   cases — `\r\n` versus `\n`, multi-line `data:`, comments, a chunk that ends
//!   mid-line or mid-character — is tested by feeding it byte slices. That is why
//!   no `eventsource` crate was added: the parser is the whole of what such a
//!   crate would bring, and this one is ~90 lines and offline.
//!
//! A manager with **no** client injected keeps today's recorded-only behaviour for
//! an `http` config, so the pipeline has no network default: nothing here opens a
//! socket, and a caller that wants one says so by injecting a client.

use std::time::Duration;

use async_trait::async_trait;
use serde_json::Value;
use thiserror::Error;

/// The MCP revision this client speaks over Streamable HTTP.
///
/// The stdio transport keeps [`MCP_PROTOCOL_VERSION`](crate::mcp_transport::MCP_PROTOCOL_VERSION)
/// (2024-11-05): the two are separate constants because the transports are
/// separate revisions, and switching the stdio handshake's version would change a
/// path this packet must leave alone.
pub const HTTP_PROTOCOL_VERSION: &str = "2025-06-18";

/// The `Accept` this client always sends: JSON or SSE, whichever the server picks.
pub const HTTP_ACCEPT: &str = "application/json, text/event-stream";

/// One JSON-RPC message on its way out.
#[derive(Debug, Clone)]
pub struct McpHttpRequest {
    /// The whole JSON-RPC message: a request, or a notification (no `id`).
    pub body: Value,
    /// For a request, the `id` the reply must carry; `None` for a notification.
    pub expect_id: Option<Value>,
    /// The `Mcp-Session-Id` to send, once a server has issued one.
    pub session_id: Option<String>,
    /// The `MCP-Protocol-Version` to send, once `initialize` has negotiated one.
    pub protocol_version: Option<String>,
    /// How long this one message may take, connection and body together.
    pub timeout: Duration,
}

impl McpHttpRequest {
    /// A message that expects the reply carrying `expect_id`.
    pub fn new(body: Value, expect_id: Option<Value>, timeout: Duration) -> Self {
        McpHttpRequest {
            body,
            expect_id,
            session_id: None,
            protocol_version: None,
            timeout,
        }
    }

    /// The same message, sent inside the session the server issued.
    ///
    /// A session is optional — a server may serve without one — so this is separate
    /// from [`McpHttpRequest::with_protocol_version`], which applies after
    /// `initialize` whether or not a session id came with it.
    pub fn with_session(mut self, session_id: impl Into<String>) -> Self {
        self.session_id = Some(session_id.into());
        self
    }

    /// The same message, carrying the negotiated `MCP-Protocol-Version`.
    pub fn with_protocol_version(mut self, protocol_version: impl Into<String>) -> Self {
        self.protocol_version = Some(protocol_version.into());
        self
    }
}

/// What came back from one `POST`.
#[derive(Debug, Clone, Default)]
pub struct McpHttpReply {
    /// The JSON-RPC message whose `id` matched the request; `None` for a notification.
    pub message: Option<Value>,
    /// The `Mcp-Session-Id` the server sent, if it sent one.
    pub session_id: Option<String>,
}

/// Everything that can go wrong dialling an MCP server over HTTP.
///
/// The shapes are the caller's: `Status` keeps the code so a `401` can be told
/// from a `500`, `SessionExpired` is a `404` on a request that carried a session
/// id (the spec's expiry signal, and never a moment to silently re-initialize),
/// and `Protocol` is a server that answered with something this client cannot
/// read. The text in each variant is a short reason for the owner; no body is
/// ever carried whole, and nothing is interpolated into a command.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum McpHttpError {
    /// No answer at all: DNS, connection refused, TLS, or a refused policy check.
    #[error("{0}")]
    Unavailable(String),
    /// The server answered with a non-2xx status that is not a session expiry.
    #[error("HTTP {code}: {reason}")]
    Status {
        /// The status code the server answered with.
        code: u16,
        /// A short reason, at most 200 characters.
        reason: String,
    },
    /// The session the request named is gone; the connection must be re-made.
    #[error("session expired")]
    SessionExpired,
    /// The message did not complete inside its timeout.
    #[error("no answer inside the timeout")]
    Timeout,
    /// The reply was larger than the transport's cap.
    #[error("reply is larger than the transport's limit")]
    Oversize,
    /// The answer was not something this client can read as a JSON-RPC reply.
    #[error("{0}")]
    Protocol(String),
}

/// POST one JSON-RPC message, and tear the session down afterwards.
///
/// An implementation dials a URL and therefore owns the policy that bounds it: the
/// TCP/TLS timeouts, the response caps, the redirect re-check, and the refusal of
/// anything that would send the daemon's own credentials anywhere. The trait says
/// what a manager needs; the daemon says how far its client may go.
#[async_trait]
pub trait McpHttpClient: Send + Sync {
    /// POST one JSON-RPC message.
    ///
    /// For a request, returns the reply whose `id` matches `req.expect_id`, decoded
    /// from a JSON body or from the SSE stream. For a notification
    /// (`expect_id: None`) returns `Ok(McpHttpReply { message: None, .. })` on 2xx.
    async fn post(&self, url: &str, req: McpHttpRequest) -> Result<McpHttpReply, McpHttpError>;

    /// Best-effort session teardown (`DELETE`). `405` and `404` are `Ok`.
    async fn close(&self, url: &str, session_id: &str) -> Result<(), McpHttpError>;
}

/// One `text/event-stream` event, as the transport layer reads it.
///
/// `data` is the `data:` lines joined with `\n`, which is what the spec says a
/// consumer sees; `event` and `id` are kept because the format has them and a
/// later packet (resumability) will need `id`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SseEvent {
    /// The `event:` field, if the event named one.
    pub event: Option<String>,
    /// The `id:` field, if the event carried one.
    pub id: Option<String>,
    /// The `data:` lines, joined with a newline.
    pub data: String,
}

/// A `text/event-stream` parser that never needs a socket.
///
/// Bytes go in, complete events come out. A chunk may end anywhere — in the middle
/// of a line, of a `data:` field, or of a multi-byte UTF-8 character — and the
/// partial bytes wait for the next [`SseDecoder::push`], because lines are only
/// decoded once a terminator has arrived. A UTF-8 continuation byte is never
/// `\n`/`\r` (they are `0x80..=0xBF`, the terminators are `0x0A`/`0x0D`), so
/// scanning bytes cannot split a character.
///
/// The format's rules, as implemented: `\r\n`, `\n` and a lone `\r` all end a line;
/// a blank line dispatches the event; `data:` lines accumulate and are joined with
/// `\n`; one leading space after the colon is stripped; a line starting with `:` is
/// a comment and is ignored; unknown fields are ignored; an event with no `data:`
/// line is not dispatched (the spec's own rule — it is not an event).
#[derive(Debug, Default)]
pub struct SseDecoder {
    /// The bytes of the line being read, with its terminator not yet consumed.
    line: Vec<u8>,
    /// The previous byte was `\r`, so a `\n` now is the second half of one break.
    after_cr: bool,
    /// The `data:` lines of the event being built.
    data: Vec<String>,
    /// Its `event:` field, if it has one yet.
    event: Option<String>,
    /// Its `id:` field, if it has one yet.
    id: Option<String>,
}

impl SseDecoder {
    /// A decoder at the start of a stream.
    pub fn new() -> Self {
        SseDecoder::default()
    }

    /// Feed the next chunk, returning every event it completed.
    pub fn push(&mut self, chunk: &[u8]) -> Vec<SseEvent> {
        let mut events = Vec::new();
        for &byte in chunk {
            match byte {
                b'\n' if self.after_cr => {
                    // The second half of a CRLF whose `\r` already ended the line.
                    self.after_cr = false;
                }
                b'\n' | b'\r' => {
                    self.after_cr = byte == b'\r';
                    self.end_line(&mut events);
                }
                _ => {
                    self.after_cr = false;
                    self.line.push(byte);
                }
            }
        }
        events
    }

    /// Finish the current line, dispatching the event when the line was blank.
    fn end_line(&mut self, events: &mut Vec<SseEvent>) {
        if self.line.is_empty() {
            self.dispatch(events);
            return;
        }
        // A line is only decoded once it is complete, which is what keeps a chunk
        // that ended mid-character from becoming a replacement character.
        let line = String::from_utf8_lossy(&self.line).into_owned();
        self.line.clear();
        if line.starts_with(':') {
            // A comment: the format's keep-alive, and nothing a caller reads.
            return;
        }
        let (field, value) = match line.split_once(':') {
            Some((field, value)) => (field, value.strip_prefix(' ').unwrap_or(value)),
            // A field with no colon has an empty value, per the format.
            None => (line.as_str(), ""),
        };
        match field {
            "data" => self.data.push(value.to_string()),
            "event" => self.event = Some(value.to_string()),
            // `id` is kept for a later packet (resumability); nothing reads it yet.
            "id" => self.id = Some(value.to_string()),
            _ => {}
        }
    }

    /// Dispatch the event being built, if it has data.
    fn dispatch(&mut self, events: &mut Vec<SseEvent>) {
        let data = std::mem::take(&mut self.data);
        let event = self.event.take();
        let id = self.id.take();
        if data.is_empty() {
            // The spec's rule: no `data:` line, no event. The fields do not carry
            // into the next event either, so a stray `event:` cannot rename one.
            return;
        }
        events.push(SseEvent {
            event,
            id,
            data: data.join("\n"),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feed `chunks` in order and collect every event they completed.
    fn decode(chunks: &[&[u8]]) -> Vec<SseEvent> {
        let mut decoder = SseDecoder::new();
        let mut events = Vec::new();
        for chunk in chunks {
            events.extend(decoder.push(chunk));
        }
        events
    }

    #[test]
    fn a_lf_and_a_crlf_stream_decode_the_same_events() {
        let lf = decode(&[b"data: {\"id\":1}\n\n"]);
        let crlf = decode(&[b"data: {\"id\":1}\r\n\r\n"]);
        assert_eq!(lf.len(), 1);
        assert_eq!(lf, crlf);
        assert_eq!(lf[0].data, r#"{"id":1}"#);
    }

    #[test]
    fn a_crlf_split_across_two_chunks_is_one_line_break() {
        // The `\r` ends the line; the `\n` in the next chunk must not end another
        // one, or the event would dispatch one line early.
        let events = decode(&[b"data: {}\r", b"\n\r\n"]);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].data, "{}");
    }

    #[test]
    fn multi_line_data_joins_with_newlines_and_comments_are_ignored() {
        let events = decode(&[b": keep-alive\ndata: first\ndata: second\n\n"]);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].data, "first\nsecond");
    }

    #[test]
    fn event_and_id_fields_travel_on_the_event() {
        let events = decode(&[b"event: message\nid: 7\ndata: x\n\n"]);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event.as_deref(), Some("message"));
        assert_eq!(events[0].id.as_deref(), Some("7"));
    }

    #[test]
    fn an_event_without_data_is_not_an_event() {
        let events = decode(&[b"event: ping\n\n"]);
        assert!(events.is_empty(), "a field-only block dispatches nothing");
    }

    #[test]
    fn a_chunk_split_mid_line_waits_for_the_rest() {
        let events = decode(&[b"data: {\"jsonrpc\"", b":\"2.0\"}\n\n"]);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].data, r#"{"jsonrpc":"2.0"}"#);
    }

    #[test]
    fn a_chunk_split_mid_multibyte_character_loses_nothing() {
        // Arabic in a JSON string, handed over one byte at a time: a `data:` value
        // that is never allowed to complete a line until the last byte arrives.
        let payload = "data: {\"text\":\"مرحبا\"}\n\n".as_bytes().to_vec();
        let chunks: Vec<&[u8]> = payload.chunks(1).collect();
        let events = decode(&chunks);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].data, "{\"text\":\"مرحبا\"}");
    }

    #[test]
    fn two_events_in_one_chunk_are_both_returned_in_order() {
        let events = decode(&[b"data: one\n\ndata: two\n\n"]);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].data, "one");
        assert_eq!(events[1].data, "two");
    }

    #[test]
    fn a_field_without_a_colon_has_an_empty_value() {
        let events = decode(&[b"data\n\n"]);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].data, "", "an empty value is still a data line");
    }
}
