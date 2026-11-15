//! T5 (R-EXT-3): `ReqwestRegistryHttp` against an in-process loopback server.
//!
//! Nothing here reaches the real network: every test binds `127.0.0.1:0`, so the port
//! is the kernel's and no fixed port is ever taken. The two refusals are proved on
//! hosts that cannot resolve (`registry.invalid`), which is what makes a message
//! about `loopback` evidence that the check ran before a socket was opened rather
//! than after a failed dial.
//!
//! The rules these pin are the packet's: same `check_transport_url` as `mcp.connect`
//! (TLS anywhere, plain http on loopback only), a 10 s timeout, a 2 MiB body cap,
//! at most 3 re-checked redirects, one `User-Agent: warsha/<version>` and one
//! `Accept: application/json` — no credentials, no cookies, no other header.

use super::{ReqwestRegistryHttp, MAX_REDIRECTS, MAX_RESPONSE_BYTES};
use axum::{
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    routing::get,
    Router,
};
use warsha_pipeline::scout_registry::RegistryHttp;
use warsha_pipeline::ScoutError;

/// A client whose policy is built the way the daemon builds it, over a fresh data
/// directory (the policy holds the path; it is never written to here).
fn client() -> ReqwestRegistryHttp {
    let temp = crate::test_util::fresh_tempdir();
    ReqwestRegistryHttp::new(crate::ProcessPolicy::from_config(&[], temp.path()))
        .expect("the registry HTTP client builds")
}

/// Serve `app` on an ephemeral loopback port and return its base URL.
async fn spawn(app: Router) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("an ephemeral loopback port");
    let address = listener.local_addr().expect("the bound address");
    tokio::spawn(async move {
        // The server ends when the test's runtime does; the handle is not joined and
        // never needs to be, because every request in these tests is answered.
        let _ = axum::serve(listener, app).await;
    });
    format!("http://{address}")
}

async fn ok_json() -> impl IntoResponse {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        r#"{"servers":[],"metadata":{"nextCursor":null}}"#,
    )
}

/// Echo the two headers the client is allowed to send, so the test reads them off the
/// wire instead of trusting the builder.
async fn echo_headers(headers: HeaderMap) -> impl IntoResponse {
    let read = |name: &str| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string()
    };
    let mut names: Vec<String> = headers
        .keys()
        .map(|name| name.as_str().to_string())
        .collect();
    names.sort_unstable();
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        serde_json::json!({
            "user_agent": read("user-agent"),
            "accept": read("accept"),
            "cookie": read("cookie"),
            "authorization": read("authorization"),
            "names": names,
        })
        .to_string(),
    )
}

async fn server_error() -> impl IntoResponse {
    (StatusCode::INTERNAL_SERVER_ERROR, "not today")
}

async fn huge_body() -> impl IntoResponse {
    (StatusCode::OK, vec![b'x'; MAX_RESPONSE_BYTES + 1])
}

/// A redirect that leaves loopback for a plain `http` host.
async fn redirect_off_loopback() -> impl IntoResponse {
    (
        StatusCode::FOUND,
        [(header::LOCATION, "http://registry.invalid/v0/servers")],
    )
}

/// One hop of a chain longer than [`MAX_REDIRECTS`].
async fn chain_hop() -> impl IntoResponse {
    (StatusCode::FOUND, [(header::LOCATION, "/r1")])
}

async fn chain_hop_1() -> impl IntoResponse {
    (StatusCode::FOUND, [(header::LOCATION, "/r2")])
}
async fn chain_hop_2() -> impl IntoResponse {
    (StatusCode::FOUND, [(header::LOCATION, "/r3")])
}
async fn chain_hop_3() -> impl IntoResponse {
    (StatusCode::FOUND, [(header::LOCATION, "/r4")])
}
async fn chain_hop_4() -> impl IntoResponse {
    (StatusCode::FOUND, [(header::LOCATION, "/ok")])
}

/// Two hops, inside the cap.
async fn short_chain() -> impl IntoResponse {
    (StatusCode::FOUND, [(header::LOCATION, "/hop")])
}
async fn short_chain_end() -> impl IntoResponse {
    (StatusCode::FOUND, [(header::LOCATION, "/ok")])
}

fn app() -> Router {
    Router::new()
        .route("/ok", get(ok_json))
        .route("/echo", get(echo_headers))
        .route("/fail", get(server_error))
        .route("/huge", get(huge_body))
        .route("/off-loopback", get(redirect_off_loopback))
        .route("/r0", get(chain_hop))
        .route("/r1", get(chain_hop_1))
        .route("/r2", get(chain_hop_2))
        .route("/r3", get(chain_hop_3))
        .route("/r4", get(chain_hop_4))
        .route("/short", get(short_chain))
        .route("/hop", get(short_chain_end))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_200_answer_is_parsed_json() {
    let base = spawn(app()).await;
    let value = client()
        .get_json(&format!("{base}/ok"))
        .await
        .expect("a 200 JSON answer parses");
    assert_eq!(value["servers"], serde_json::json!([]));
    assert_eq!(value["metadata"]["nextCursor"], serde_json::Value::Null);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_request_carries_warsha_user_agent_accept_json_and_nothing_else() {
    let base = spawn(app()).await;
    let value = client()
        .get_json(&format!("{base}/echo"))
        .await
        .expect("the echo answers");
    assert_eq!(
        value["user_agent"],
        serde_json::json!(format!("warsha/{}", env!("CARGO_PKG_VERSION"))),
        "the User-Agent is not `warsha/<version>`"
    );
    assert_eq!(value["accept"], serde_json::json!("application/json"));
    assert_eq!(value["cookie"], serde_json::json!(""), "a cookie was sent");
    assert_eq!(
        value["authorization"],
        serde_json::json!(""),
        "an Authorization header was sent"
    );
    let names: Vec<String> =
        serde_json::from_value(value["names"].clone()).expect("the header names are strings");
    let unexpected: Vec<&String> = names
        .iter()
        .filter(|name| {
            !matches!(
                name.as_str(),
                "accept" | "user-agent" | "host" | "accept-encoding" | "content-length"
            )
        })
        .collect();
    assert!(
        unexpected.is_empty(),
        "the client sent headers the packet does not allow: {unexpected:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_500_answer_is_catalog_unavailable() {
    let base = spawn(app()).await;
    let err = client()
        .get_json(&format!("{base}/fail"))
        .await
        .expect_err("a 500 must not read as an empty page");
    assert!(
        matches!(&err, ScoutError::CatalogUnavailable(reason) if reason.contains("500")),
        "expected CatalogUnavailable naming the status, got: {err:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_body_over_two_mib_is_catalog_unavailable() {
    let base = spawn(app()).await;
    let err = client()
        .get_json(&format!("{base}/huge"))
        .await
        .expect_err("an oversize body must be refused");
    assert!(
        matches!(&err, ScoutError::CatalogUnavailable(reason) if reason.contains("2 MiB")),
        "expected CatalogUnavailable for the size cap, got: {err:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_plain_http_host_off_loopback_is_refused_before_any_request() {
    // `registry.invalid` cannot resolve: a message about `loopback` can only come from
    // the policy check, which ran before any socket was opened.
    let err = client()
        .get_json("http://registry.invalid/v0/servers?limit=100&version=latest")
        .await
        .expect_err("plain http off loopback must be refused");
    let reason = match &err {
        ScoutError::CatalogUnavailable(reason) => reason.clone(),
        other => panic!("expected CatalogUnavailable, got {other:?}"),
    };
    assert!(
        reason.contains("loopback"),
        "the refusal did not come from the transport policy: {reason}"
    );
    assert!(
        !reason.contains("dns") && !reason.contains("connect"),
        "the client dialled a host it should have refused: {reason}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_redirect_to_a_plain_http_remote_host_is_refused() {
    let base = spawn(app()).await;
    let err = client()
        .get_json(&format!("{base}/off-loopback"))
        .await
        .expect_err("a redirect off loopback must be refused");
    let reason = match &err {
        ScoutError::CatalogUnavailable(reason) => reason.clone(),
        other => panic!("expected CatalogUnavailable, got {other:?}"),
    };
    assert!(
        reason.contains("loopback"),
        "the redirect target was not re-checked: {reason}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_redirect_chain_longer_than_three_is_refused() {
    let base = spawn(app()).await;
    let err = client()
        .get_json(&format!("{base}/r0"))
        .await
        .expect_err("a chain past the cap must be refused");
    let reason = match &err {
        ScoutError::CatalogUnavailable(reason) => reason.clone(),
        other => panic!("expected CatalogUnavailable, got {other:?}"),
    };
    assert!(
        reason.contains("redirect"),
        "the cap of {MAX_REDIRECTS} redirects was not the refusal: {reason}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_redirect_chain_inside_the_cap_is_followed() {
    let base = spawn(app()).await;
    let value = client()
        .get_json(&format!("{base}/short"))
        .await
        .expect("two redirects are inside the cap");
    assert_eq!(value["servers"], serde_json::json!([]));
}
