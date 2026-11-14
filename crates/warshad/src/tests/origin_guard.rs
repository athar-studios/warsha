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
}
