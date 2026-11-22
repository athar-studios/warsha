//! The Scout's MCP registry client (R-EXT-3): a real, paged read of the public MCP
//! registry, mapped to [`ScoutProposal`]s without inventing a fact about a row.
//!
//! Two pieces, split so the pipeline stays free of a network default:
//!
//! - [`RegistryHttp`] — the one operation this client needs from a transport: a GET
//!   that returns parsed JSON, or an explicit failure. The daemon implements it over
//!   `reqwest` (`warshad::registry_http`), which is where an HTTP client is allowed
//!   to live (R2: `warsha-pipeline` may not depend on `warshad`, and `reqwest` is not
//!   a pipeline dependency).
//! - [`McpRegistryClient`] — the `ScoutRegistryClient` that pages
//!   `{catalog}/v0/servers?limit=100&version=latest` through that seam.
//!
//! `Scout::new` still wires [`ProductionScoutRegistryClient`](crate::scout::ProductionScoutRegistryClient),
//! which returns `CatalogUnavailable`; this client is opt-in through
//! [`Scout::with_client`](crate::scout::Scout::with_client). That keeps the pipeline's
//! default honest and keeps the daemon from dialling anything nobody asked for.
//!
//! **No recording and no dialling.** A row's `remotes` are descriptive data that
//! travels in `metadata`; nothing here calls `mcp.connect`, touches an `McpManager`,
//! or writes a Connections row. Turning a proposal into a recorded server is a later,
//! owner-approved flow.
//!
//! **Offline is an error.** A transport failure, a non-2xx answer, a page that is not
//! JSON and a page that does not parse all end as `ScoutError::CatalogUnavailable` or
//! `ScoutError::Serialization` — never `Ok(vec![])`.

use std::fmt;
use std::sync::Arc;

use chrono::Utc;
use serde::Deserialize;
use serde_json::Value;
use warsha_core::Role;

use crate::scout::{
    LicenseClass, Result, ScoutError, ScoutProposal, ScoutRegistryClient, ScoutSource,
};

/// The public MCP registry, the same base URL `ScoutConfig::default()` carries for
/// [`ScoutSource::McpRegistry`](crate::scout::ScoutSource::McpRegistry).
pub const DEFAULT_MCP_REGISTRY_URL: &str = "https://registry.modelcontextprotocol.io";

/// How many pages one fetch follows, cursor included.
///
/// The registry pages by `metadata.nextCursor`; a bounded walk is the difference
/// between a catalog read and an unbounded crawl of someone else's server. Three
/// pages is 300 rows at the registry's own `limit=100` — more proposals than
/// `ScoutConfig::max_proposals_per_role` (10 by default) can use.
pub const MAX_REGISTRY_PAGES: usize = 3;

/// Rows asked for per page.
pub const REGISTRY_PAGE_LIMIT: usize = 100;

/// The longest description a proposal carries, in characters (not bytes).
pub const MAX_DESCRIPTION_CHARS: usize = 500;

/// The `provides` entry every registry proposal carries.
pub const REGISTRY_PROVIDE: &str = "mcp-server";

/// The `required_permissions` entry a row with a `remotes` array carries.
pub const REGISTRY_NETWORK_PERMISSION: &str = "network";

/// One GET, answered as parsed JSON.
///
/// The implementor owns what a failure is — a `reqwest` error, a non-2xx status, a
/// body over its own cap — and must answer `Err(ScoutError::CatalogUnavailable(..))`
/// for all of them. Returning `Ok` with an empty page for a failure would turn
/// "cannot reach the catalog" into "the catalog is empty", which the Scout would then
/// report as a successful search with no results.
#[async_trait::async_trait]
pub trait RegistryHttp: Send + Sync {
    /// Fetch `url` and parse the body as JSON.
    async fn get_json(&self, url: &str) -> Result<Value>;
}

/// A `ScoutRegistryClient` over an MCP registry that serves paged JSON.
pub struct McpRegistryClient {
    http: Arc<dyn RegistryHttp>,
}

impl McpRegistryClient {
    /// A client that reads through `http`.
    pub fn new(http: Arc<dyn RegistryHttp>) -> Self {
        Self { http }
    }
}

impl fmt::Debug for McpRegistryClient {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("McpRegistryClient")
            .finish_non_exhaustive()
    }
}

/// The URL of one page: the pinned catalog query plus the cursor when there is one.
fn page_url(catalog_url: &str, cursor: Option<&str>) -> String {
    let base = catalog_url.trim().trim_end_matches('/');
    let mut url = format!("{base}/v0/servers?limit={REGISTRY_PAGE_LIMIT}&version=latest");
    if let Some(cursor) = cursor {
        url.push_str("&cursor=");
        url.push_str(&percent_encode(cursor));
    }
    url
}

/// Percent-encode everything outside RFC 3986's unreserved set.
///
/// A cursor is opaque and today reads like `ai.agenticaffiliate/…-mcp:0.19.0`; `:` and
/// `/` are legal in a query only when encoded, and the registry is free to put
/// anything at all in the field. Encoding here is the difference between a URL that
/// says what the server asked for and one that breaks at the next cursor shape. No
/// `url` crate is pulled in for it: this is the whole job.
fn percent_encode(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(*byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

/// The page envelope: `{"servers": [...], "metadata": {...}}`.
#[derive(Deserialize)]
struct RegistryPage {
    servers: Vec<RegistryRow>,
}

/// One `servers` entry: the registry wraps the server object and its `_meta`.
#[derive(Deserialize)]
struct RegistryRow {
    server: RegistryServer,
}

/// The server object, as far as this mapper reads it.
///
/// Every fact that is not on the row stays absent: there is deliberately no
/// `license` field here, because the registry does not carry one (measured: 0 of the
/// 100 rows recorded for this packet had a licence key) and this packet adds no SPDX
/// table to guess one from prose. Absent therefore maps to `unknown`/`Unknown`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryServer {
    name: Option<String>,
    description: Option<String>,
    version: Option<String>,
    title: Option<String>,
    website_url: Option<String>,
    repository: Option<RegistryRepository>,
    remotes: Option<Vec<Value>>,
    packages: Option<Vec<Value>>,
}

/// A row's `repository` object; only `url` is read.
#[derive(Deserialize)]
struct RegistryRepository {
    url: Option<String>,
}

/// Map one registry page to proposals, and count the rows that were skipped.
///
/// The count is the part a caller can act on — a page whose rows all lack a `version`
/// is a registry problem, not a silent empty catalog — so it is returned here and
/// logged by [`McpRegistryClient`].
pub fn map_registry_page_counted(
    value: &Value,
    role: Role,
    now: &str,
) -> Result<(Vec<ScoutProposal>, usize)> {
    let page: RegistryPage = serde_json::from_value(value.clone())?;
    let mut proposals = Vec::with_capacity(page.servers.len());
    let mut skipped = 0usize;

    for row in page.servers {
        let server = row.server;
        // A row without a name or a version cannot be identified or pinned, so it is
        // skipped and counted — never defaulted into a proposal with an invented id.
        let (Some(name), Some(version)) = (
            server
                .name
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty()),
            server
                .version
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty()),
        ) else {
            skipped += 1;
            continue;
        };

        let remotes: Vec<Value> = server
            .remotes
            .unwrap_or_default()
            .iter()
            .map(|remote| {
                serde_json::json!({
                    "type": remote.get("type").cloned().unwrap_or(Value::Null),
                    "url": remote.get("url").cloned().unwrap_or(Value::Null),
                })
            })
            .collect();
        let packages: Vec<Value> = server
            .packages
            .unwrap_or_default()
            .iter()
            .map(|package| {
                serde_json::json!({
                    "registryType": package.get("registryType").cloned().unwrap_or(Value::Null),
                    "identifier": package.get("identifier").cloned().unwrap_or(Value::Null),
                    "version": package.get("version").cloned().unwrap_or(Value::Null),
                })
            })
            .collect();

        let mut metadata = std::collections::HashMap::new();
        if !remotes.is_empty() {
            metadata.insert("remotes".to_string(), Value::Array(remotes));
        }
        if !packages.is_empty() {
            metadata.insert("packages".to_string(), Value::Array(packages));
        }

        let source_url = server
            .website_url
            .as_deref()
            .map(str::trim)
            .filter(|url| !url.is_empty())
            .or_else(|| {
                server
                    .repository
                    .as_ref()
                    .and_then(|repository| repository.url.as_deref())
                    .map(str::trim)
                    .filter(|url| !url.is_empty())
            })
            .unwrap_or(DEFAULT_MCP_REGISTRY_URL)
            .to_string();

        let display_name = server
            .title
            .as_deref()
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .unwrap_or(name);

        let has_remotes = metadata.contains_key("remotes");

        proposals.push(ScoutProposal {
            id: format!("mcp-registry:{name}@{version}"),
            source: ScoutSource::McpRegistry,
            source_url,
            name: display_name.to_string(),
            version: version.to_string(),
            description: truncate_chars(server.description.as_deref().unwrap_or_default()),
            // Honest by construction: no structured licence exists on a row, and no
            // SPDX classifier exists in this crate to read one out of the prose.
            license: "unknown".to_string(),
            license_class: LicenseClass::Unknown,
            target_role: role,
            provides: vec![REGISTRY_PROVIDE.to_string()],
            required_permissions: if has_remotes {
                vec![REGISTRY_NETWORK_PERMISSION.to_string()]
            } else {
                Vec::new()
            },
            dependencies: Vec::new(),
            metadata,
            discovered_at: now.to_string(),
        });
    }

    Ok((proposals, skipped))
}

/// Map one registry page to proposals (the packet's frozen signature).
///
/// The skipped-row count is [`map_registry_page_counted`]'s second return value; this
/// wrapper exists because a caller that only wants the catalog should not have to
/// destructure a tuple to get it.
pub fn map_registry_page(value: &Value, role: Role, now: &str) -> Result<Vec<ScoutProposal>> {
    map_registry_page_counted(value, role, now).map(|(proposals, _skipped)| proposals)
}

/// `text`, cut to [`MAX_DESCRIPTION_CHARS`] characters.
///
/// `chars().take(n)` walks characters, so a multibyte description — every Arabic one —
/// is cut at a boundary rather than mid-character. Server-supplied text is data: it is
/// bounded here and is never handed to a shell or a command line anywhere downstream.
fn truncate_chars(text: &str) -> String {
    text.chars().take(MAX_DESCRIPTION_CHARS).collect()
}

#[async_trait::async_trait]
impl ScoutRegistryClient for McpRegistryClient {
    async fn fetch_proposals(
        &self,
        source: ScoutSource,
        catalog_url: Option<&str>,
        role: Role,
    ) -> Result<Vec<ScoutProposal>> {
        // Only the MCP registry is implemented by this packet: npm, git and custom
        // catalogs stay explicitly unavailable rather than quietly empty.
        if source != ScoutSource::McpRegistry {
            return Err(ScoutError::CatalogUnavailable(format!(
                "no registry client for {source:?}: this client reads the MCP registry only"
            )));
        }

        let base = catalog_url.unwrap_or(DEFAULT_MCP_REGISTRY_URL);
        let now = Utc::now().to_rfc3339();
        let mut cursor: Option<String> = None;
        let mut proposals = Vec::new();
        let mut skipped = 0usize;

        for _page in 0..MAX_REGISTRY_PAGES {
            let url = page_url(base, cursor.as_deref());
            let value = self.http.get_json(&url).await?;
            let (mut mapped, page_skipped) = map_registry_page_counted(&value, role, &now)?;
            skipped += page_skipped;
            proposals.append(&mut mapped);

            cursor = value
                .get("metadata")
                .and_then(|metadata| metadata.get("nextCursor"))
                .and_then(Value::as_str)
                .map(str::to_string)
                .filter(|next| !next.is_empty());
            if cursor.is_none() {
                break;
            }
        }

        if skipped > 0 {
            // The row itself is not logged: it is server-supplied text. The fact that
            // the page was not fully usable is what an owner needs to see.
            tracing::warn!(
                skipped,
                "registry rows without a name or version were skipped"
            );
        }

        Ok(proposals)
    }
}
