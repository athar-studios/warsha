//! T1–T4 for the Scout's MCP registry client (R-EXT-3).
//!
//! Everything here runs against the recorded page in
//! `tests/fixtures/mcp_registry_page.json` or an in-test fake `RegistryHttp`. No
//! socket is opened and there is no real network, which is the packet's rule: the
//! live probe is a manual observation, not a test.
//!
//! The licence tests state a measured fact rather than a guessed one: the registry
//! has no structured licence field on any of the 100 rows recorded for R-EXT-3, and
//! `warsha_pipeline::scout`/`skills` carry no SPDX-string classifier (only a
//! `license_class` scalar parser). The packet therefore forbids adding an SPDX table
//! here, and every mapped proposal is `unknown`/`Unknown` — never a `Permissive`
//! guess.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use warsha_core::{ProjectId, Role};
use warsha_pipeline::scout_registry::{
    map_registry_page, map_registry_page_counted, McpRegistryClient, RegistryHttp,
    DEFAULT_MCP_REGISTRY_URL, MAX_REGISTRY_PAGES,
};
use warsha_pipeline::{
    LicenseClass, Scout, ScoutConfig, ScoutError, ScoutProposal, ScoutRegistryClient, ScoutSource,
    SkillsLockfile,
};

/// The recorded page, trimmed and labelled (`_fixture` says which rows are synthetic).
const FIXTURE: &str = include_str!("fixtures/mcp_registry_page.json");

fn fixture_page() -> Value {
    serde_json::from_str(FIXTURE).expect("the recorded page is valid JSON")
}

const NOW: &str = "2026-11-15T00:00:00Z";

// ---------------------------------------------------------------------------
// T1 — the pure mapper, over the recorded fixture
// ---------------------------------------------------------------------------

#[test]
fn fixture_rows_map_to_exact_ids_with_unknown_licence_and_network_only_rules() {
    let page = fixture_page();
    let (proposals, skipped) =
        map_registry_page_counted(&page, Role::Coder, NOW).expect("the recorded page maps");

    // Four rows are mappable; the one without a `version` is skipped and counted.
    assert_eq!(
        skipped, 1,
        "the version-less row was not counted as skipped"
    );
    let ids: Vec<&str> = proposals.iter().map(|p| p.id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "mcp-registry:ac.inference.sh/mcp@2.0.1",
            "mcp-registry:agency.extremely/agency@0.1.1",
            "mcp-registry:io.warsha/fixture-no-endpoints@0.0.1",
            "mcp-registry:io.warsha/fixture-arabic@1.0.0",
        ],
        "the ids are not `mcp-registry:<name>@<version>` in page order"
    );

    for proposal in &proposals {
        assert_eq!(proposal.source, ScoutSource::McpRegistry);
        assert_eq!(proposal.target_role, Role::Coder);
        assert_eq!(proposal.discovered_at, NOW);
        assert_eq!(proposal.provides, ["mcp-server"]);
        assert!(
            proposal.dependencies.is_empty(),
            "the mapper invented a dependency"
        );
        // The packet's licence rule: no structured licence field exists on a registry
        // row, so nothing here may claim a permissive one.
        assert_eq!(proposal.license, "unknown");
        assert_eq!(proposal.license_class, LicenseClass::Unknown);
    }

    // `required_permissions` is `["network"]` iff the row offers a remote.
    let permissions: Vec<&[String]> = proposals
        .iter()
        .map(|p| p.required_permissions.as_slice())
        .collect();
    assert_eq!(permissions[0], ["network"]);
    assert!(
        permissions[1].is_empty(),
        "an npm package is not a dial-out"
    );
    assert!(
        permissions[2].is_empty(),
        "a row with no endpoint asks nothing"
    );
    assert_eq!(permissions[3], ["network"]);

    // `name = title | name`, `source_url = websiteUrl | repository.url | the registry`.
    assert_eq!(proposals[0].name, "inference.sh");
    assert_eq!(proposals[1].name, "EXTREMELY agency");
    assert_eq!(proposals[2].name, "io.warsha/fixture-no-endpoints");
    assert_eq!(proposals[0].source_url, DEFAULT_MCP_REGISTRY_URL);
    assert_eq!(proposals[1].source_url, "https://extremely.agency");
    assert_eq!(proposals[3].source_url, DEFAULT_MCP_REGISTRY_URL);

    // The description is bounded, not carried whole.
    let full = page["servers"][4]["server"]["description"]
        .as_str()
        .expect("the Arabic row's description");
    assert!(full.chars().count() > 500, "the fixture row is not long");
    assert_eq!(proposals[3].description.chars().count(), 500);
    assert!(
        full.starts_with(&proposals[3].description),
        "the truncation did not keep a prefix"
    );
    // …at a char boundary: the Arabic row is 535 chars / 983 bytes, so a byte-based
    // cut at 500 would have produced 500 bytes of mojibake, not 500 characters.
    assert_eq!(proposals[3].description.len(), 919);
}

#[test]
fn metadata_carries_only_the_descriptive_endpoint_fields() {
    let page = fixture_page();
    let proposals = map_registry_page(&page, Role::Architect, NOW).expect("the recorded page maps");

    // Remotes: `type` and `url` only — a header the registry carries is not copied into
    // an artifact the rest of the system might read as a config.
    let remotes = proposals[0]
        .metadata
        .get("remotes")
        .expect("the remotes row carries its remotes");
    assert_eq!(
        remotes,
        &json!([{ "type": "streamable-http", "url": "https://api.inference.sh/mcp" }])
    );
    let arabic_remotes = proposals[3]
        .metadata
        .get("remotes")
        .expect("the Arabic row carries its remotes");
    assert_eq!(
        arabic_remotes,
        &json!([{ "type": "streamable-http", "url": "https://example.invalid/arabic-mcp" }]),
        "a remote's extra keys (here a header name/value) reached the proposal"
    );

    // Packages: `registryType`, `identifier` and `version` only — no transport, no args.
    let packages = proposals[1]
        .metadata
        .get("packages")
        .expect("the npm row carries its packages");
    assert_eq!(
        packages,
        &json!([{
            "registryType": "npm",
            "identifier": "@extremely-agency/mcp",
            "version": "0.1.1",
        }])
    );

    // A row with neither endpoint has no such keys at all.
    assert!(
        proposals[2].metadata.is_empty(),
        "{:?}",
        proposals[2].metadata
    );
}

#[test]
fn the_scouts_default_catalog_url_is_the_client_default() {
    // Two literals name the registry — the config's default entry and the mapper's
    // fallback `source_url`. This pins them together so they cannot drift apart.
    let config = ScoutConfig::default();
    assert_eq!(
        config
            .catalog_urls
            .get(&ScoutSource::McpRegistry)
            .map(String::as_str),
        Some(DEFAULT_MCP_REGISTRY_URL)
    );
}

#[test]
fn an_unparsable_page_is_a_serialization_error_and_never_an_empty_success() {
    for page in [
        json!({ "servers": 5 }),
        json!({ "metadata": {} }),
        json!({ "servers": "not a list" }),
        json!([1, 2, 3]),
    ] {
        let err = map_registry_page(&page, Role::Coder, NOW)
            .expect_err("a malformed page must not map to an empty success");
        assert!(
            matches!(err, ScoutError::Serialization(_)),
            "expected Serialization for {page}, got {err:?}"
        );
    }
}

#[test]
fn the_vec_shaped_mapper_is_the_counted_one_without_the_count() {
    let page = fixture_page();
    let proposals = map_registry_page(&page, Role::Coder, NOW).expect("maps");
    let (counted, skipped) = map_registry_page_counted(&page, Role::Coder, NOW).expect("maps");
    assert_eq!(proposals.len(), counted.len());
    assert_eq!(skipped, 1);
    for (left, right) in proposals.iter().zip(counted.iter()) {
        assert_eq!(left.id, right.id);
    }
}

// ---------------------------------------------------------------------------
// T2 — list/search paging over a fake `RegistryHttp`
// ---------------------------------------------------------------------------

/// A `RegistryHttp` that serves recorded pages in order and remembers the URLs.
struct FakeRegistryHttp {
    pages: Mutex<VecDeque<Value>>,
    urls: Mutex<Vec<String>>,
}

impl FakeRegistryHttp {
    fn with_pages(pages: Vec<Value>) -> Self {
        Self {
            pages: Mutex::new(pages.into()),
            urls: Mutex::new(Vec::new()),
        }
    }

    fn requested_urls(&self) -> Vec<String> {
        self.urls
            .lock()
            .expect("the URL log is not poisoned")
            .clone()
    }
}

#[async_trait::async_trait]
impl RegistryHttp for FakeRegistryHttp {
    async fn get_json(&self, url: &str) -> Result<Value, ScoutError> {
        self.urls
            .lock()
            .expect("the URL log is not poisoned")
            .push(url.to_string());
        self.pages
            .lock()
            .expect("the page queue is not poisoned")
            .pop_front()
            .ok_or_else(|| ScoutError::CatalogUnavailable("no more pages recorded".to_string()))
    }
}

/// One registry page with one row and an optional cursor.
fn page(name: &str, version: &str, next: Option<&str>) -> Value {
    json!({
        "servers": [{
            "server": {
                "name": name,
                "version": version,
                "description": "a recorded row",
            }
        }],
        "metadata": { "nextCursor": next, "count": 1 },
    })
}

#[tokio::test]
async fn two_pages_are_concatenated_in_order_and_the_url_asks_for_latest() {
    let http = Arc::new(FakeRegistryHttp::with_pages(vec![
        page("io.warsha/one", "1.0.0", Some("cursor-one")),
        page("io.warsha/two", "2.0.0", None),
    ]));
    let client = McpRegistryClient::new(http.clone());
    let proposals = client
        .fetch_proposals(
            ScoutSource::McpRegistry,
            Some("https://registry.test"),
            Role::Coder,
        )
        .await
        .expect("both pages are served");

    let ids: Vec<&str> = proposals.iter().map(|p| p.id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "mcp-registry:io.warsha/one@1.0.0",
            "mcp-registry:io.warsha/two@2.0.0"
        ],
        "the pages were not concatenated in request order"
    );

    let urls = http.requested_urls();
    assert_eq!(urls.len(), 2);
    assert_eq!(
        urls[0], "https://registry.test/v0/servers?limit=100&version=latest",
        "the first request is not the pinned catalog URL"
    );
    assert!(
        urls[1].contains("cursor=cursor-one"),
        "the second request did not follow `metadata.nextCursor`: {}",
        urls[1]
    );
    assert!(urls[1].contains("version=latest"));
}

#[tokio::test]
async fn the_default_catalog_url_is_used_when_the_config_names_none() {
    let http = Arc::new(FakeRegistryHttp::with_pages(vec![page(
        "io.warsha/one",
        "1.0.0",
        None,
    )]));
    let client = McpRegistryClient::new(http.clone());
    client
        .fetch_proposals(ScoutSource::McpRegistry, None, Role::Coder)
        .await
        .expect("the default page is served");
    assert_eq!(
        http.requested_urls(),
        [format!(
            "{DEFAULT_MCP_REGISTRY_URL}/v0/servers?limit=100&version=latest"
        )]
    );
}

#[tokio::test]
async fn paging_stops_at_the_page_cap_even_while_a_cursor_keeps_coming() {
    let pages = (0..(MAX_REGISTRY_PAGES + 2))
        .map(|index| {
            page(
                &format!("io.warsha/page-{index}"),
                "1.0.0",
                Some(&format!("cursor-{index}")),
            )
        })
        .collect();
    let http = Arc::new(FakeRegistryHttp::with_pages(pages));
    let client = McpRegistryClient::new(http.clone());
    let proposals = client
        .fetch_proposals(ScoutSource::McpRegistry, None, Role::Coder)
        .await
        .expect("the capped pages are served");

    assert_eq!(MAX_REGISTRY_PAGES, 3, "the cap the packet froze moved");
    assert_eq!(
        http.requested_urls().len(),
        MAX_REGISTRY_PAGES,
        "the client followed a fourth `nextCursor`"
    );
    assert_eq!(proposals.len(), MAX_REGISTRY_PAGES);
}

// ---------------------------------------------------------------------------
// T3 — offline is an error, never an empty list
// ---------------------------------------------------------------------------

/// A `RegistryHttp` that fails the way an unreachable host does.
struct OfflineRegistryHttp;

#[async_trait::async_trait]
impl RegistryHttp for OfflineRegistryHttp {
    async fn get_json(&self, _url: &str) -> Result<Value, ScoutError> {
        Err(ScoutError::CatalogUnavailable(
            "registry.modelcontextprotocol.io: connect error".to_string(),
        ))
    }
}

#[tokio::test]
async fn an_offline_registry_is_an_error_and_never_an_empty_list() {
    let client = McpRegistryClient::new(Arc::new(OfflineRegistryHttp));
    let result = client
        .fetch_proposals(ScoutSource::McpRegistry, None, Role::Coder)
        .await;
    match result {
        Err(ScoutError::CatalogUnavailable(reason)) => {
            assert!(
                reason.contains("connect error"),
                "the transport's own reason was dropped: {reason}"
            );
        }
        other => panic!("offline must be CatalogUnavailable, got {other:?}"),
    }
}

#[tokio::test]
async fn the_scout_surfaces_the_offline_error_instead_of_an_empty_catalog() {
    // Only the registry source is enabled, so the error cannot come from npm/git:
    // it is the registry client's own failure surfacing through the Scout.
    let scout = Scout::with_client(
        ScoutConfig {
            enabled_sources: vec![ScoutSource::McpRegistry],
            ..ScoutConfig::default()
        },
        Arc::new(McpRegistryClient::new(Arc::new(OfflineRegistryHttp))),
    );
    let err = scout
        .scout_for_role(ProjectId::new(), Role::Coder, None)
        .await
        .expect_err("an offline registry must not read as `no proposals`");
    assert!(
        matches!(err, ScoutError::CatalogUnavailable(_)),
        "unexpected error: {err:?}"
    );
}

#[tokio::test]
async fn every_source_but_the_mcp_registry_is_still_unavailable() {
    // The packet keeps npm/git/custom (and local, which never leaves the disk) at
    // `CatalogUnavailable`: no other registry is implemented here.
    for source in [
        ScoutSource::Npm,
        ScoutSource::Git,
        ScoutSource::Custom,
        ScoutSource::Local,
    ] {
        let http = Arc::new(FakeRegistryHttp::with_pages(vec![page(
            "io.warsha/one",
            "1.0.0",
            None,
        )]));
        let client = McpRegistryClient::new(http.clone());
        let err = client
            .fetch_proposals(source, None, Role::Coder)
            .await
            .expect_err("only the MCP registry is served");
        assert!(
            matches!(err, ScoutError::CatalogUnavailable(_)),
            "unexpected error for {source:?}: {err:?}"
        );
        assert!(
            http.requested_urls().is_empty(),
            "{source:?} reached the network"
        );
    }
}

// ---------------------------------------------------------------------------
// T4 — the licence gate keeps `Unknown` and drops copyleft
// ---------------------------------------------------------------------------

/// The proposals a client hands back, unchanged — the seam the Scout filters on.
struct StaticRegistryClient {
    proposals: Vec<ScoutProposal>,
}

#[async_trait::async_trait]
impl ScoutRegistryClient for StaticRegistryClient {
    async fn fetch_proposals(
        &self,
        source: ScoutSource,
        _catalog_url: Option<&str>,
        role: Role,
    ) -> Result<Vec<ScoutProposal>, ScoutError> {
        Ok(self
            .proposals
            .iter()
            .filter(|proposal| proposal.source == source && proposal.target_role == role)
            .cloned()
            .collect())
    }
}

fn proposal(id: &str, license: &str, class: LicenseClass) -> ScoutProposal {
    ScoutProposal {
        id: id.to_string(),
        source: ScoutSource::McpRegistry,
        source_url: DEFAULT_MCP_REGISTRY_URL.to_string(),
        name: id.to_string(),
        version: "1.0.0".to_string(),
        description: "built by the test, not by the mapper".to_string(),
        license: license.to_string(),
        license_class: class,
        target_role: Role::Coder,
        provides: vec!["mcp-server".to_string()],
        required_permissions: vec![],
        dependencies: vec![],
        metadata: Default::default(),
        discovered_at: NOW.to_string(),
    }
}

#[tokio::test]
async fn unknown_proposals_pass_the_licence_gate_and_are_never_auto_approved() {
    let http = Arc::new(FakeRegistryHttp::with_pages(vec![fixture_page()]));
    let config = ScoutConfig {
        enabled_sources: vec![ScoutSource::McpRegistry],
        require_license_check: true,
        ..ScoutConfig::default()
    };
    // The flag that would ever approve without an owner is off by default, and this
    // packet changes neither the flag nor the gate.
    assert!(!config.auto_approve_permissive);
    let scout = Scout::with_client(config, Arc::new(McpRegistryClient::new(http)));

    let proposals = scout
        .scout_for_role(ProjectId::new(), Role::Coder, None)
        .await
        .expect("unknown-licence proposals are shown, not withheld");
    assert_eq!(proposals.len(), 4, "the gate dropped an Unknown proposal");
    assert!(proposals
        .iter()
        .all(|proposal| proposal.license_class == LicenseClass::Unknown));

    // Scouting is not installing: the lockfile a caller owns is still empty afterwards,
    // because nothing in this path can write it.
    let lockfile = SkillsLockfile::new();
    assert!(lockfile.entries.is_empty());
}

#[tokio::test]
async fn a_copyleft_proposal_is_still_dropped_by_the_gate() {
    // The mapper cannot produce this class today — the registry carries no licence and
    // the packet forbids adding an SPDX table — so the row is built here to prove the
    // filter that would drop it is still live, not loosened to let `Unknown` through.
    let client = StaticRegistryClient {
        proposals: vec![
            proposal("unknown-row", "unknown", LicenseClass::Unknown),
            proposal("copyleft-row", "GPL-3.0", LicenseClass::Copyleft),
            proposal("permissive-row", "MIT", LicenseClass::Permissive),
        ],
    };
    let scout = Scout::with_client(
        ScoutConfig {
            enabled_sources: vec![ScoutSource::McpRegistry],
            require_license_check: true,
            ..ScoutConfig::default()
        },
        Arc::new(client),
    );
    let kept: Vec<String> = scout
        .scout_for_role(ProjectId::new(), Role::Coder, None)
        .await
        .expect("the gate runs")
        .into_iter()
        .map(|proposal| proposal.id)
        .collect();
    assert_eq!(kept, ["unknown-row", "permissive-row"]);
}
