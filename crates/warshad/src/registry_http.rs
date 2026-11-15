//! `RegistryHttp` over `reqwest`, for the Scout's MCP registry client (R-EXT-3).
//!
//! This is the daemon's half of the split the packet froze (D-EXT-1): the trait and
//! the mapper live in `warsha_pipeline::scout_registry`, the HTTP client lives here,
//! because `warsha-pipeline` may not depend on a daemon (`docs/ARCH_RULES.md` R2) and
//! `reqwest` is not one of its dependencies.
//!
//! The rules are the ones `mcp.connect` already enforces for a recorded transport,
//! applied to a URL this daemon is about to dial:
//!
//! - the URL passes [`ProcessPolicy::check_transport_url`](crate::ProcessPolicy::check_transport_url)
//!   before any socket exists: `https`/`wss` anywhere, a plain `http`/`ws` only on
//!   loopback (which is what lets an in-process test server work and refuses a LAN or
//!   internet host over plain http);
//! - a 10 s timeout, a 2 MiB body cap, and at most 3 redirects, each re-checked
//!   against the same policy;
//! - exactly two headers leave the process — `User-Agent: warsha/<version>` and
//!   `Accept: application/json`. No credentials, no cookies, no auth: the public
//!   registry needs none, and this client has none to send;
//! - every failure — non-2xx, timeout, DNS, oversize, refused redirect — becomes
//!   `ScoutError::CatalogUnavailable(<short reason>)`. This client never answers
//!   `Ok(empty)`, because an unreachable registry and an empty one are different
//!   facts and the Scout reports the difference.
//!
//! Nothing here records a server or calls `mcp.connect`: the JSON this returns is
//! data for a proposal, and a proposal's `remotes` stay descriptive.

use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use warsha_pipeline::scout_registry::RegistryHttp;
use warsha_pipeline::ScoutError;

use crate::ProcessPolicy;

/// The one `User-Agent` this client sends.
const USER_AGENT: &str = concat!("warsha/", env!("CARGO_PKG_VERSION"));

/// The most a registry response body may weigh.
pub const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

/// How long one request may take, redirects included.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// How many redirects are followed before the chain is refused.
pub const MAX_REDIRECTS: usize = 3;

/// The longest reason string a failure carries into a proposal error.
const MAX_REASON_CHARS: usize = 200;

/// `RegistryHttp` for the public MCP registry, over `reqwest`.
pub struct ReqwestRegistryHttp {
    /// The daemon's own transport policy, re-applied to every URL and redirect.
    policy: Arc<ProcessPolicy>,
    client: reqwest::Client,
}

impl ReqwestRegistryHttp {
    /// A client that refuses what the daemon's policy refuses.
    ///
    /// Fallible for the same reason every other HTTP client in this workspace is
    /// (`warsha_git::GitHubClient::new`): building one can fail at the TLS backend,
    /// and a caller is entitled to hear that instead of a panic. No caller exists in
    /// this packet — the daemon opts in when a packet adds a consumer.
    pub fn new(policy: ProcessPolicy) -> Result<Self, ScoutError> {
        let policy = Arc::new(policy);
        let redirect_policy = Arc::clone(&policy);
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(REQUEST_TIMEOUT)
            .redirect(reqwest::redirect::Policy::custom(move |attempt| {
                // The cap first: past it, the target is irrelevant.
                if attempt.previous().len() >= MAX_REDIRECTS {
                    return attempt.error(format!(
                        "redirect limit of {MAX_REDIRECTS} redirects reached"
                    ));
                }
                // Then the same check the first URL went through, so a server cannot
                // bounce this client from `https://` to a plain `http` host it would
                // never have dialled directly.
                if let Err(reason) = redirect_policy.check_transport_url(attempt.url().as_str()) {
                    return attempt.error(reason);
                }
                attempt.follow()
            }))
            .build()
            .map_err(|error| {
                ScoutError::CatalogUnavailable(format!(
                    "could not build the registry HTTP client: {}",
                    short(&error.to_string())
                ))
            })?;
        Ok(Self { policy, client })
    }
}

/// One error and its whole source chain, shortened to a bound.
///
/// `reqwest`'s own `Display` names the request, not the reason: a refused redirect and
/// a DNS failure would read the same. The chain is where the policy's sentence and the
/// resolver's error actually are, and this is the string a report quotes.
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

#[async_trait::async_trait]
impl RegistryHttp for ReqwestRegistryHttp {
    async fn get_json(&self, url: &str) -> Result<Value, ScoutError> {
        // Before a socket: the URL is a transport the daemon would accept as a
        // recorded MCP server, or it is not dialled at all.
        self.policy.check_transport_url(url).map_err(|reason| {
            ScoutError::CatalogUnavailable(format!("registry URL refused: {reason}"))
        })?;

        let mut response = self
            .client
            .get(url)
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|error| {
                ScoutError::CatalogUnavailable(format!(
                    "registry request failed: {}",
                    describe(&error)
                ))
            })?;

        let status = response.status();
        if !status.is_success() {
            return Err(ScoutError::CatalogUnavailable(format!(
                "registry answered HTTP {status}"
            )));
        }

        // A declared length past the cap is refused before the body is read at all.
        if response
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
        {
            return Err(too_large());
        }

        // …and an undeclared one is refused while it is being read, so a server that
        // lies about its length cannot make this process hold an unbounded body.
        let mut body: Vec<u8> = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|error| {
            ScoutError::CatalogUnavailable(format!(
                "registry response failed: {}",
                describe(&error)
            ))
        })? {
            if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
                return Err(too_large());
            }
            body.extend_from_slice(&chunk);
        }

        // A body that is not JSON is a parse failure, not a transport one: the server
        // answered, and what it answered cannot be read.
        serde_json::from_slice(&body).map_err(ScoutError::Serialization)
    }
}

/// The one refusal an oversize body gets, whichever way its size showed up.
fn too_large() -> ScoutError {
    ScoutError::CatalogUnavailable("registry response body is larger than 2 MiB".to_string())
}

#[cfg(test)]
#[path = "tests/registry_http.rs"]
mod tests;
