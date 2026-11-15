//! `McpHttpClient` over `reqwest`: Streamable HTTP for `mcp.connect` (R-EXT-4, X3).
//!
//! This is the daemon's half of the split the packet froze: the trait, the request
//! and reply types and the SSE parser live in `warsha_pipeline::mcp_http`, the HTTP
//! client lives here, because `warsha-pipeline` may not depend on `reqwest` (R2 in
//! `docs/ARCH_RULES.md`) and the daemon is where a socket belongs.
//!
//! The rules are the ones `mcp.connect` already enforced for a *recorded* transport,
//! applied to a URL this client is about to dial:
//!
//! - the URL passes [`ProcessPolicy::check_transport_url`](crate::ProcessPolicy::check_transport_url)
//!   before any socket exists — `https` anywhere, a plain `http` only on loopback —
//!   and so does every redirect, so a server cannot bounce this client from TLS to a
//!   plain-`http` host it would never have dialled directly. At most 3 redirects;
//! - one request may take the message's own bound (the connection's
//!   `response_timeout`, 30 s by default), and a `DELETE` gets its own short one;
//! - a JSON reply is capped at 2 MiB and an event stream at 8 MiB, counted while it
//!   is read, so a server that lies about its length cannot make the daemon hold an
//!   unbounded body;
//! - **no credentials leave this process.** The headers are `Accept`,
//!   `Content-Type`, `User-Agent: warsha/<version>`, `Mcp-Session-Id` and
//!   `MCP-Protocol-Version` — no cookies, no `Authorization`, no pairing material.
//!   A `401`/`403` is *reported* ("the server requires authorization, which this
//!   version does not support"), never satisfied: remote credentials need the
//!   keychain design and are out of this packet's scope;
//! - a `404` on a request that carried a session id is the spec's expiry signal and
//!   becomes [`McpHttpError::SessionExpired`]; nothing re-initializes silently.
//!
//! Server text is data: every reason this module carries into an error is bounded
//! and is only ever displayed.

use std::sync::Arc;
use std::time::Duration;

use reqwest::header::{self, HeaderMap};
use reqwest::StatusCode;
use serde_json::Value;
use warsha_pipeline::mcp_http::{
    McpHttpClient, McpHttpError, McpHttpReply, McpHttpRequest, SseDecoder, HTTP_ACCEPT,
};

use crate::ProcessPolicy;

/// The one `User-Agent` this client sends.
const USER_AGENT: &str = concat!("warsha/", env!("CARGO_PKG_VERSION"));

/// The session header the revision names.
const SESSION_HEADER: &str = "Mcp-Session-Id";

/// The revision header every request after `initialize` carries.
const PROTOCOL_HEADER: &str = "MCP-Protocol-Version";

/// The most one JSON-RPC message may weigh.
pub const MAX_MESSAGE_BYTES: usize = 2 * 1024 * 1024;

/// The most one event stream may weigh in total before it is refused.
pub const MAX_STREAM_BYTES: usize = 8 * 1024 * 1024;

/// How many redirects are followed before the chain is refused.
pub const MAX_REDIRECTS: usize = 3;

/// How long the best-effort `DELETE` may take.
pub const CLOSE_TIMEOUT: Duration = Duration::from_secs(5);

/// The longest reason string a failure carries.
const MAX_REASON_CHARS: usize = 200;

/// How much of a non-2xx body is read to make a reason out of.
const MAX_REASON_BYTES: usize = 1024;

/// What a `401`/`403` is reported as, in the words the owner needs.
const AUTHORIZATION_REFUSED: &str =
    "the server requires authorization, which this version does not support";

/// `McpHttpClient` for a remote MCP server, over `reqwest`.
pub struct ReqwestMcpHttp {
    /// The daemon's own transport policy, re-applied to every URL and redirect.
    policy: Arc<ProcessPolicy>,
    client: reqwest::Client,
}

impl ReqwestMcpHttp {
    /// A client that refuses what the daemon's policy refuses.
    ///
    /// Fallible for the same reason every other HTTP client in this workspace is
    /// (`warsha_git::GitHubClient::new`): building one can fail at the TLS backend,
    /// and a caller is entitled to hear that instead of a panic. The redirect policy
    /// is the daemon's: the cap first, then the same URL check the first request
    /// went through, so a redirect cannot reach what a direct dial could not.
    pub fn new(policy: ProcessPolicy) -> Result<Self, McpHttpError> {
        let policy = Arc::new(policy);
        let redirect_policy = Arc::clone(&policy);
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .redirect(reqwest::redirect::Policy::custom(move |attempt| {
                if attempt.previous().len() >= MAX_REDIRECTS {
                    return attempt.error(format!(
                        "redirect limit of {MAX_REDIRECTS} redirects reached"
                    ));
                }
                if let Err(reason) = redirect_policy.check_transport_url(attempt.url().as_str()) {
                    return attempt.error(reason);
                }
                attempt.follow()
            }))
            .build()
            .map_err(|error| {
                McpHttpError::Unavailable(format!(
                    "could not build the MCP HTTP client: {}",
                    short(&error.to_string())
                ))
            })?;
        Ok(Self { policy, client })
    }

    /// The check every URL this client dials goes through, before a socket exists.
    fn check(&self, url: &str) -> Result<(), McpHttpError> {
        self.policy.check_transport_url(url).map_err(|reason| {
            McpHttpError::Unavailable(format!("the endpoint was refused: {reason}"))
        })
    }
}

/// One error and its whole source chain, shortened to a bound.
///
/// `reqwest`'s own `Display` names the request, not the reason: a refused redirect
/// and a DNS failure would read the same. The chain is where the policy's sentence
/// and the resolver's error actually are.
fn describe(error: &(dyn std::error::Error + 'static)) -> String {
    let mut text = error.to_string();
    let mut source = error.source();
    while let Some(inner) = source {
        text.push_str(": ");
        text.push_str(&inner.to_string());
        source = inner.source();
    }
    short(&text)
}

/// `text`, cut to [`MAX_REASON_CHARS`] characters.
fn short(text: &str) -> String {
    text.chars().take(MAX_REASON_CHARS).collect()
}

/// A failed request, as the one of this client's errors that describes it.
fn transport_failure(error: &reqwest::Error) -> McpHttpError {
    if error.is_timeout() {
        McpHttpError::Timeout
    } else {
        McpHttpError::Unavailable(format!("the request failed: {}", describe(error)))
    }
}

/// The header value at `name`, if it is a string this client can read.
fn header_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

/// Read a body, refusing one past `cap` while it is being read.
async fn read_capped(mut response: reqwest::Response, cap: usize) -> Result<Vec<u8>, McpHttpError> {
    // A declared length past the cap is refused before the body is read at all…
    if response
        .content_length()
        .is_some_and(|length| length > cap as u64)
    {
        return Err(McpHttpError::Oversize);
    }
    // …and an undeclared one is refused while it is being read, so a server that
    // lies about its length cannot make this process hold an unbounded body.
    let mut body: Vec<u8> = Vec::new();
    loop {
        let chunk = response.chunk().await.map_err(|error| {
            McpHttpError::Unavailable(format!("the reply failed mid-body: {}", describe(&error)))
        })?;
        let Some(chunk) = chunk else { break };
        if body.len() + chunk.len() > cap {
            return Err(McpHttpError::Oversize);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// The bounded reason a non-2xx reply is reported with.
async fn reason_of(mut response: reqwest::Response) -> String {
    let mut body: Vec<u8> = Vec::new();
    while body.len() < MAX_REASON_BYTES {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                let room = MAX_REASON_BYTES - body.len();
                body.extend_from_slice(&chunk[..chunk.len().min(room)]);
            }
            // A body that fails to read is not this reason's problem: the status is
            // what the caller is told about.
            Ok(None) | Err(_) => break,
        }
    }
    let text = String::from_utf8_lossy(&body).trim().to_string();
    if text.is_empty() {
        "the server gave no reason".to_string()
    } else {
        short(&text)
    }
}

/// The reply to `expect_id` out of an event stream.
///
/// Messages that are not the reply — notifications, server-to-client requests, a
/// keep-alive comment — are skipped: this client speaks one request at a time and
/// only the answer to it matters. A stream that ends without that answer is a
/// protocol failure, not an empty success.
async fn read_event_stream(
    mut response: reqwest::Response,
    expect_id: &Value,
    session_id: Option<String>,
) -> Result<McpHttpReply, McpHttpError> {
    let mut decoder = SseDecoder::new();
    let mut total = 0usize;
    loop {
        let chunk = response.chunk().await.map_err(|error| {
            if error.is_timeout() {
                McpHttpError::Timeout
            } else {
                McpHttpError::Unavailable(format!("the stream failed: {}", describe(&error)))
            }
        })?;
        let Some(chunk) = chunk else { break };
        total += chunk.len();
        if total > MAX_STREAM_BYTES {
            return Err(McpHttpError::Oversize);
        }
        for event in decoder.push(&chunk) {
            let Ok(message) = serde_json::from_str::<Value>(&event.data) else {
                // A `data:` line that is not JSON is not a reply to this request.
                continue;
            };
            if message.get("id") != Some(expect_id) {
                continue;
            }
            return Ok(McpHttpReply {
                message: Some(message),
                session_id,
            });
        }
    }
    Err(McpHttpError::Protocol(
        "an event stream that ended without the reply".to_string(),
    ))
}

#[async_trait::async_trait]
impl McpHttpClient for ReqwestMcpHttp {
    async fn post(&self, url: &str, req: McpHttpRequest) -> Result<McpHttpReply, McpHttpError> {
        // Before a socket: the URL is a transport the daemon would accept as a
        // recorded MCP server, or it is not dialled at all.
        self.check(url)?;
        let expect_id = req.expect_id.clone();
        let timeout = req.timeout;
        let had_session = req.session_id.is_some();

        let mut builder = self
            .client
            .post(url)
            .timeout(timeout)
            .header(header::ACCEPT, HTTP_ACCEPT)
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::USER_AGENT, USER_AGENT)
            .body(req.body.to_string());
        if let Some(session_id) = req.session_id.as_deref() {
            builder = builder.header(SESSION_HEADER, session_id);
        }
        if let Some(version) = req.protocol_version.as_deref() {
            builder = builder.header(PROTOCOL_HEADER, version);
        }
        let response = builder
            .send()
            .await
            .map_err(|error| transport_failure(&error))?;

        let status = response.status();
        let session_id = header_value(response.headers(), SESSION_HEADER);
        if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            // Reported, never satisfied: this client has no credential to offer.
            return Err(McpHttpError::Status {
                code: status.as_u16(),
                reason: AUTHORIZATION_REFUSED.to_string(),
            });
        }
        if status == StatusCode::NOT_FOUND && had_session {
            // The revision's expiry signal. A `404` to a request with no session is
            // just a wrong endpoint, and reads as one below.
            return Err(McpHttpError::SessionExpired);
        }
        if !status.is_success() {
            return Err(McpHttpError::Status {
                code: status.as_u16(),
                reason: reason_of(response).await,
            });
        }
        let Some(expect_id) = expect_id else {
            // A notification is answered `202 Accepted`; its body, if any, is not a
            // reply to anything.
            return Ok(McpHttpReply {
                message: None,
                session_id,
            });
        };

        let content_type = header_value(response.headers(), header::CONTENT_TYPE.as_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if content_type.starts_with("application/json") {
            let body = read_capped(response, MAX_MESSAGE_BYTES).await?;
            let message: Value = serde_json::from_slice(&body).map_err(|error| {
                McpHttpError::Protocol(format!(
                    "a JSON body that does not parse: {}",
                    short(&error.to_string())
                ))
            })?;
            if message.get("id") != Some(&expect_id) {
                return Err(McpHttpError::Protocol(
                    "a JSON reply carrying another id".to_string(),
                ));
            }
            return Ok(McpHttpReply {
                message: Some(message),
                session_id,
            });
        }
        if content_type.starts_with("text/event-stream") {
            return read_event_stream(response, &expect_id, session_id).await;
        }
        let described = if content_type.is_empty() {
            "none".to_string()
        } else {
            short(&content_type)
        };
        Err(McpHttpError::Protocol(format!(
            "a reply of type `{described}`, which is neither JSON nor an event stream"
        )))
    }

    async fn close(&self, url: &str, session_id: &str) -> Result<(), McpHttpError> {
        self.check(url)?;
        let response = self
            .client
            .delete(url)
            .timeout(CLOSE_TIMEOUT)
            .header(header::USER_AGENT, USER_AGENT)
            .header(SESSION_HEADER, session_id)
            .send()
            .await
            .map_err(|error| transport_failure(&error))?;
        let status = response.status();
        // The revision says a server may refuse the method; `404` means the session
        // is already gone. Both are what a teardown wanted.
        if status.is_success()
            || status == StatusCode::METHOD_NOT_ALLOWED
            || status == StatusCode::NOT_FOUND
        {
            return Ok(());
        }
        Err(McpHttpError::Status {
            code: status.as_u16(),
            reason: reason_of(response).await,
        })
    }
}

#[cfg(test)]
#[path = "tests/mcp_http.rs"]
mod tests;
