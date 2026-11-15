use super::*;
use jsonrpsee::core::http_helpers::Body;
use std::future::Ready;
use std::task::{Context, Poll};
use tower::Service;

#[derive(Clone)]
struct Accepting;

impl tower::Service<HttpRequest<Body>> for Accepting {
    type Response = HttpResponse;
    type Error = BoxError;
    type Future = Ready<std::result::Result<Self::Response, Self::Error>>;

    fn poll_ready(&mut self, _cx: &mut Context<'_>) -> Poll<std::result::Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, _req: HttpRequest<Body>) -> Self::Future {
        std::future::ready(Ok(HttpResponse::new(Body::empty())))
    }
}

fn request(origin: Option<&str>) -> HttpRequest<Body> {
    let mut builder = axum::http::Request::builder().uri("/").method("POST");
    if let Some(origin) = origin {
        builder = builder.header(axum::http::header::ORIGIN, origin);
    }
    builder.body(Body::empty()).expect("the request builds")
}

async fn status(service: &mut RpcAuthService<Accepting>, origin: Option<&str>) -> u16 {
    Service::call(service, request(origin))
        .await
        .expect("the layer answers")
        .status()
        .as_u16()
}

#[tokio::test]
async fn an_unlisted_origin_is_refused_before_the_credential() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = crate::tests::test_state(temp.path()).await;
    let mut service = RpcAuthService {
        inner: Accepting,
        state,
    };
    assert_eq!(status(&mut service, Some("http://evil.example")).await, 403);
}

#[test]
fn the_app_origins_are_always_allowed() {
    let configured = vec!["http://localhost:5173".to_string()];
    assert!(origin_allowed(&configured, "tauri://localhost"));
    assert!(origin_allowed(&configured, "http://tauri.localhost"));
    assert!(origin_allowed(&configured, "http://localhost:5173"));
    assert!(!origin_allowed(&configured, "http://evil.example"));
}

/// R-UI-7 T1: the Android shell's asset origin is the app's own origin, so it is
/// admitted against a config that lists nothing at all — the smoke config's shape.
#[test]
fn app_origin_for_the_android_shell_is_allowed() {
    const ANDROID_SHELL_ORIGIN: &str = "https://appassets.androidplatform.net";
    assert!(origin_allowed(&[], ANDROID_SHELL_ORIGIN));
    assert!(origin_allowed(
        &["http://localhost:5173".to_string()],
        ANDROID_SHELL_ORIGIN
    ));
    // One entry added to the list the desktop already carried: nothing was removed.
    let app_origins = crate::auth::APP_ORIGINS;
    assert!(app_origins.contains(&"tauri://localhost"));
    assert!(app_origins.contains(&"http://tauri.localhost"));
    assert!(app_origins.contains(&ANDROID_SHELL_ORIGIN));
    assert_eq!(app_origins.len(), 3);
}

/// R-UI-7 T2 — the regression guard for OD-UI7. `null` is what a `file:` document
/// presents and what any hostile page can force a browser to send; it identifies no
/// one, so it is refused whether or not an operator listed it.
#[test]
fn null_origin_is_still_refused() {
    assert!(!origin_allowed(&[], "null"));
    assert!(!origin_allowed(
        &[
            "http://localhost:5173".to_string(),
            "https://appassets.androidplatform.net".to_string(),
        ],
        "null"
    ));
    // The refusal is of the value, not of the word's neighbourhood.
    assert!(!origin_allowed(&[], "NULL"));
    assert!(!origin_allowed(
        &[],
        "https://appassets.androidplatform.net/null"
    ));
}

/// R-UI-7 T3: the new admission is one exact string. Every near miss — the cleartext
/// scheme, a suffix an attacker can register, another port, a trailing slash — is refused.
#[test]
fn lookalike_origins_are_refused() {
    let configured = vec!["http://localhost:5173".to_string()];
    for lookalike in [
        "http://appassets.androidplatform.net",
        "https://appassets.androidplatform.net.evil.example",
        "https://appassets.androidplatform.net:8443",
        "https://appassets.androidplatform.net/",
        "appassets.androidplatform.net",
        "https://appassets.androidplatform.net.",
    ] {
        assert!(
            !origin_allowed(&configured, lookalike),
            "{lookalike} must not be admitted"
        );
    }
}

/// R-UI-7 T4 — Step 2 measured that pairing needs CORS: with a config that lists no origin, the
/// preflight for the page's `POST /rpc` came back without `Access-Control-Allow-Origin`, so a
/// browser refused to read the answer even though the WebSocket gate had admitted the origin. The
/// layer now admits the app's own origins too; `null` is still never echoed.
#[tokio::test]
async fn a_preflight_from_the_android_shell_origin_is_answered_with_cors_headers() {
    const ANDROID_SHELL_ORIGIN: &str = "https://appassets.androidplatform.net";
    fn preflight(origin: &str) -> HttpRequest<Body> {
        axum::http::Request::builder()
            .method("OPTIONS")
            .uri("/rpc")
            .header(axum::http::header::ORIGIN, origin)
            .header(axum::http::header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
            .header(
                axum::http::header::ACCESS_CONTROL_REQUEST_HEADERS,
                "content-type,authorization",
            )
            .body(Body::empty())
            .expect("the preflight builds")
    }

    // The union itself, over the empty list the smoke config produces: the app's own origins are
    // there whatever the configuration says.
    let from_empty_config = crate::auth::cors_origins(&[]);
    assert!(from_empty_config
        .iter()
        .any(|origin| origin == ANDROID_SHELL_ORIGIN));
    assert!(!from_empty_config.iter().any(|origin| origin == "null"));

    // …and the layer the HTTP listener actually runs echoes it. The test state's configuration
    // lists no Android origin, so the header can only come from the union.
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = crate::tests::test_state(temp.path()).await;
    assert!(!state
        .config
        .allowed_origins
        .iter()
        .any(|origin| origin == ANDROID_SHELL_ORIGIN));
    let app = crate::http::http_app(state);

    let allowed = tower::ServiceExt::oneshot(app.clone(), preflight(ANDROID_SHELL_ORIGIN))
        .await
        .expect("the app answers a preflight");
    assert_eq!(
        allowed
            .headers()
            .get(axum::http::header::ACCESS_CONTROL_ALLOW_ORIGIN),
        Some(&axum::http::HeaderValue::from_static(ANDROID_SHELL_ORIGIN)),
        "the shell's origin must be allowed to read the reply"
    );

    let null = tower::ServiceExt::oneshot(app, preflight("null"))
        .await
        .expect("the app answers a preflight");
    assert!(
        null.headers()
            .get(axum::http::header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none(),
        "`null` is never allowed to read a reply"
    );
}

#[tokio::test]
async fn the_app_origins_and_no_origin_reach_the_auth_check() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = crate::tests::test_state(temp.path()).await;
    let mut service = RpcAuthService {
        inner: Accepting,
        state,
    };
    // No token is sent, so passing the origin guard means the auth refusal (401).
    assert_eq!(status(&mut service, None).await, 401);
    assert_eq!(status(&mut service, Some("tauri://localhost")).await, 401);
    assert_eq!(
        status(&mut service, Some("http://tauri.localhost")).await,
        401
    );
    // R-UI-7: the Android shell's asset origin passes the origin guard and is then
    // refused for the reason that matters — no credential (401, never 403).
    assert_eq!(
        status(&mut service, Some("https://appassets.androidplatform.net")).await,
        401
    );
    // …and `null`, the origin a `file:` document presents, is still refused first.
    assert_eq!(status(&mut service, Some("null")).await, 403);
}
